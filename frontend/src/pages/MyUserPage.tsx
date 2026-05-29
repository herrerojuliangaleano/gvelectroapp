import { FormEvent, useEffect, useState } from 'react';
import { Camera, History, KeyRound, ShieldCheck } from 'lucide-react';
import { changePassword, fetchMe, fetchMyActivity, setSession, uploadMyEmployeePhoto } from '../api/client';
import { EmployeePhoto } from '../components/EmployeePhoto';
import {
  ErpButton,
  ErpCard,
  ErpField,
  ErpInfoGrid,
  ErpInfoRow,
  ErpInput,
  ErpNotice,
  ErpPageHeader,
  ErpTag,
} from '../components/ProUI';
import type { AuditEvent, CurrentUser } from '../types';

export function MyUserPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  useEffect(() => {
    Promise.all([fetchMe(), fetchMyActivity(10)])
      .then(([me, activity]) => { setUser(me); setEvents(activity); })
      .catch((err) => setError(err.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setMessage('');
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    try {
      const res = await changePassword(password);
      setSession(res.token, res.username, res.display_name, res.role, res.permissions, !!res.must_change_password, res.sucursal || '', res);
      setMessage('Contraseña actualizada correctamente.');
      setPassword(''); setConfirm('');
      setUser(res);
      setEvents(await fetchMyActivity(10));
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña'); }
    finally { setLoading(false); }
  }

  async function uploadPhoto(e: FormEvent) {
    e.preventDefault();
    setError(''); setMessage('');
    if (!photoFile) return setError('Elegí una imagen primero.');
    setPhotoLoading(true);
    try {
      const updated = await uploadMyEmployeePhoto(photoFile);
      setUser(updated);
      setPhotoFile(null);
      const input = document.getElementById('employee-photo-input') as HTMLInputElement | null;
      if (input) input.value = '';
      setMessage('Foto profesional subida. Queda pendiente de aprobación por administración.');
      setEvents(await fetchMyActivity(10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la foto');
    } finally {
      setPhotoLoading(false);
    }
  }

  const hasPhoto = !!user?.employee?.photo_url;

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Mi usuario"
        description="Datos de sesión, permisos, foto profesional y últimos movimientos."
      />

      {error && <ErpNotice tone="error" title="No se pudo completar la operación">{error}</ErpNotice>}
      {message && <ErpNotice tone="success">{message}</ErpNotice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="erp-stack-4">
          <ErpCard title="Foto profesional" subtitle="Se usa para identificación interna. Tiene que ser de frente, con buena luz y fondo limpio." actions={<Camera size={14} aria-hidden="true" />}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <EmployeePhoto username={user?.username} name={user?.employee?.display_name || user?.display_name} hasPhoto={hasPhoto} size="lg" />
              <div className="min-w-0 flex-1 erp-stack-3">
                <div className="text-[12.5px] text-[color:var(--text-2)]">
                  Estado: <span className="font-semibold text-[color:var(--text)]">{photoStatusLabel(user?.employee?.photo_status)}</span>
                </div>
                <form onSubmit={uploadPhoto} className="flex flex-col gap-2 sm:flex-row">
                  <ErpInput
                    id="employee-photo-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                    className="sm:flex-1"
                  />
                  <ErpButton type="submit" variant="primary" loading={photoLoading} disabled={!photoFile}>
                    {photoLoading ? 'Subiendo...' : 'Subir foto'}
                  </ErpButton>
                </form>
              </div>
            </div>
          </ErpCard>

          <ErpCard title="Datos de cuenta">
            {user && (
              <ErpInfoGrid columns={2}>
                <ErpInfoRow label="Nombre visible" value={user.display_name} />
                <ErpInfoRow label="Usuario" value={user.username} />
                <ErpInfoRow label="Rol principal" value={user.role} />
                <ErpInfoRow label="Roles asignados" value={(user.roles || [user.role]).join(', ')} />
                <ErpInfoRow label="Empresa principal" value={user.company_name || 'Sin empresa'} />
                <ErpInfoRow label="Sucursal principal" value={user.branch_name || user.sucursal || 'Sin sucursal'} />
                <ErpInfoRow label="Tipo de sucursal" value={branchTypeLabel(user.branch_type)} />
                <ErpInfoRow label="Estado" value={user.is_active === false ? 'Bloqueado' : 'Activo'} />
              </ErpInfoGrid>
            )}
          </ErpCard>

          <ErpCard title="Empleado vinculado">
            {user?.employee ? (
              <ErpInfoGrid columns={2}>
                <ErpInfoRow label="Nombre laboral" value={user.employee.display_name || [user.employee.first_name, user.employee.last_name].filter(Boolean).join(' ') || user.display_name} />
                <ErpInfoRow label="DNI" value={user.employee.dni || 'Pendiente'} />
                <ErpInfoRow label="Puesto" value={user.employee.position || 'Sin puesto'} />
                <ErpInfoRow label="Foto profesional" value={photoStatusLabel(user.employee.photo_status)} />
              </ErpInfoGrid>
            ) : (
              <ErpNotice tone="warning">Tu usuario todavía no tiene empleado vinculado.</ErpNotice>
            )}
          </ErpCard>

          <ErpCard title="Sucursales asignadas">
            {user?.branches?.length ? (
              <div className="flex flex-wrap gap-2">
                {user.branches.map((branch) => (
                  <ErpTag key={branch.id} tone={branch.is_primary ? 'success' : undefined}>
                    {branch.name} · {branch.company_name}{branch.is_primary ? ' · principal' : ''}
                  </ErpTag>
                ))}
              </div>
            ) : (
              <ErpNotice tone="warning">Tu usuario todavía no tiene sucursal operativa vinculada.</ErpNotice>
            )}
          </ErpCard>

          <ErpCard title="Permisos efectivos" subtitle={`Total: ${user?.permissions?.length ?? 0}`} actions={<ShieldCheck size={14} aria-hidden="true" />}>
            <div className="flex flex-wrap gap-1.5">
              {(user?.permissions || []).map((p) => <ErpTag key={p}>{p}</ErpTag>)}
              {(!user?.permissions || user.permissions.length === 0) && (
                <span className="text-[12.5px] text-[color:var(--text-3)]">Sin permisos asignados.</span>
              )}
            </div>
          </ErpCard>
        </div>

        <div className="erp-stack-4">
          <ErpCard title="Cambiar contraseña" actions={<KeyRound size={14} aria-hidden="true" />}>
            <form onSubmit={submit} className="erp-stack-3">
              <ErpField label="Nueva contraseña" hint="Mínimo 6 caracteres." required>
                <ErpInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </ErpField>
              <ErpField label="Repetir contraseña" required>
                <ErpInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </ErpField>
              <div className="erp-form-actions">
                <ErpButton type="submit" variant="primary" loading={loading} fullWidth>
                  {loading ? 'Guardando...' : 'Actualizar contraseña'}
                </ErpButton>
              </div>
            </form>
          </ErpCard>
        </div>
      </div>

      <ErpCard title="Últimos movimientos" subtitle="Tus acciones recientes en el sistema" actions={<History size={14} aria-hidden="true" />}>
        <div className="erp-stack-2">
          {events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-[12.5px]">
              <div className="min-w-0">
                <div className="font-semibold text-[color:var(--text)]">{e.event_type}</div>
                <div className="mt-0.5 text-[color:var(--text-2)]">{e.message || e.resource_type || '—'}</div>
              </div>
              <div className="shrink-0 text-[11.5px] text-[color:var(--text-3)] tabular-nums">{new Date(e.created_at).toLocaleString()}</div>
            </div>
          ))}
          {events.length === 0 && (
            <div className="text-[12.5px] text-[color:var(--text-3)]">Sin actividad reciente.</div>
          )}
        </div>
      </ErpCard>
    </div>
  );
}

function branchTypeLabel(type?: string | null) {
  if (type === 'web') return 'WEB';
  if (type === 'physical') return 'Física';
  if (type === 'deposit') return 'Depósito';
  if (type === 'admin') return 'Administración';
  return 'Sin tipo';
}

function photoStatusLabel(status?: string | null) {
  if (status === 'aprobada') return 'Foto aprobada';
  if (status === 'pendiente_aprobacion') return 'Foto pendiente';
  if (status === 'rechazada') return 'Foto rechazada';
  if (status === 'solicitada_nuevamente') return 'Foto solicitada nuevamente';
  return 'Sin foto';
}
