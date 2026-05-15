import { FormEvent, useEffect, useState } from 'react';
import { changePassword, fetchMe, fetchMyActivity, setSession, uploadMyEmployeePhoto } from '../api/client';
import { EmployeePhoto } from '../components/EmployeePhoto';
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
    Promise.all([fetchMe(), fetchMyActivity(10)]).then(([me, activity]) => { setUser(me); setEvents(activity); }).catch((err) => setError(err.message));
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
    setError('');
    setMessage('');
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
    <div className="mx-auto max-w-5xl">
      <div className="mb-6"><h1 className="text-2xl font-black sm:text-3xl">Mi usuario</h1><p className="mt-2 text-sm text-slate-400">Datos de sesión, permisos y últimos movimientos.</p></div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">{message}</div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 sm:flex-row sm:items-center">
            <EmployeePhoto username={user?.username} name={user?.employee?.display_name || user?.display_name} hasPhoto={hasPhoto} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-white">Foto profesional</h2>
              <p className="mt-1 text-sm leading-6 text-blue-100">Subí una foto de frente, con buena luz y fondo limpio. Se usará para identificación interna y futuras funciones de gestión.</p>
              <div className="mt-2 text-xs font-bold text-blue-200">Estado: {photoStatusLabel(user?.employee?.photo_status)}</div>
              <form onSubmit={uploadPhoto} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input id="employee-photo-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} className="w-full rounded-xl border border-blue-400/30 bg-slate-950/70 px-3 py-2 text-sm" />
                <button disabled={photoLoading || !photoFile} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{photoLoading ? 'Subiendo...' : 'Subir foto'}</button>
              </form>
            </div>
          </div>
          <h2 className="mb-4 text-lg font-black">Datos de cuenta</h2>
          {user && <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Nombre visible" value={user.display_name} />
            <Info label="Usuario" value={user.username} />
            <Info label="Rol principal" value={user.role} />
            <Info label="Roles asignados" value={(user.roles || [user.role]).join(', ')} />
            <Info label="Empresa principal" value={user.company_name || 'Sin empresa'} />
            <Info label="Sucursal principal" value={user.branch_name || user.sucursal || 'Sin sucursal'} />
            <Info label="Tipo de sucursal" value={branchTypeLabel(user.branch_type)} />
            <Info label="Estado" value={user.is_active === false ? 'Bloqueado' : 'Activo'} />
          </div>}
          <h3 className="mb-3 mt-6 text-sm font-black uppercase text-slate-400">Empleado vinculado</h3>
          {user?.employee ? <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Nombre laboral" value={user.employee.display_name || [user.employee.first_name, user.employee.last_name].filter(Boolean).join(' ') || user.display_name} />
            <Info label="DNI" value={user.employee.dni || 'Pendiente'} />
            <Info label="Puesto" value={user.employee.position || 'Sin puesto'} />
            <Info label="Foto profesional" value={photoStatusLabel(user.employee.photo_status)} />
          </div> : <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">Tu usuario todavía no tiene empleado vinculado.</div>}
          <h3 className="mb-3 mt-6 text-sm font-black uppercase text-slate-400">Sucursales asignadas</h3>
          {user?.branches?.length ? <div className="flex flex-wrap gap-2">{user.branches.map((branch) => <span key={branch.id} className={`rounded-full border px-3 py-1 text-xs ${branch.is_primary ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{branch.name} · {branch.company_name}{branch.is_primary ? ' · principal' : ''}</span>)}</div> : <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">Tu usuario todavía no tiene sucursal operativa vinculada.</div>}
          <h3 className="mb-3 mt-6 text-sm font-black uppercase text-slate-400">Permisos efectivos</h3>
          <div className="flex flex-wrap gap-2">{(user?.permissions || []).map((p) => <span key={p} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">{p}</span>)}</div>
        </div>
        <form onSubmit={submit} className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <h2 className="mb-4 text-lg font-black">Cambiar contraseña</h2>
          <label className="mb-3 block"><span className="mb-1 block text-xs font-bold text-slate-400">Nueva contraseña</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" /></label>
          <label className="mb-4 block"><span className="mb-1 block text-xs font-bold text-slate-400">Repetir contraseña</span><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" /></label>
          <button disabled={loading} className="w-full rounded-xl bg-blue-500 px-4 py-3 font-bold text-white disabled:opacity-50">{loading ? 'Guardando...' : 'Actualizar contraseña'}</button>
        </form>
      </div>
      <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
        <h2 className="mb-4 text-lg font-black">Últimos movimientos</h2>
        <div className="space-y-3">{events.map((e) => <div key={e.id} className="rounded-2xl bg-slate-900/70 p-3 text-sm"><div className="font-bold text-white">{e.event_type}</div><div className="text-slate-400">{new Date(e.created_at).toLocaleString()} · {e.message || e.resource_type || '-'}</div></div>)}</div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-900/70 p-4"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 font-bold text-white">{value}</div></div>;
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
