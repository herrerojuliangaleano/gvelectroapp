import { useEffect, useMemo, useState } from 'react';
import { Check, Camera, RefreshCw, X } from 'lucide-react';
import { approveEmployeePhoto, can, fetchUsers, rejectEmployeePhoto } from '../api/client';
import { EmployeePhoto } from '../components/EmployeePhoto';
import { ErpButton, ErpEmptyState, ErpErrorState, ErpLoadingState, ErpNotice, ErpPageHeader } from '../components/ProUI';
import type { UserInfo } from '../types';

const PENDING = new Set(['pendiente_aprobacion', 'solicitada_nuevamente']);

/**
 * U-06 · Aprobación de foto profesional.
 * Cola de fotos pendientes con vista y acciones aprobar / rechazar.
 */
export function PhotoApprovalPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canApprove = can('employees.photo.approve');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUsers((await fetchUsers()) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las fotos pendientes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const pending = useMemo(
    () => users.filter((u) => PENDING.has(String(u.employee?.photo_status || ''))),
    [users],
  );

  async function act(username: string, kind: 'approve' | 'reject') {
    setWorking(`${username}:${kind}`);
    setMsg(null);
    try {
      if (kind === 'approve') await approveEmployeePhoto(username);
      else await rejectEmployeePhoto(username);
      setMsg(kind === 'approve' ? 'Foto aprobada.' : 'Foto rechazada.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la acción');
    } finally {
      setWorking(null);
    }
  }

  return (
    <div>
      <ErpPageHeader
        title="Aprobación de fotos profesionales"
        description="Cola de fotos subidas por los empleados, pendientes de aprobación."
        actions={<button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={load}><RefreshCw size={14} /> Actualizar</button>}
      />

      {msg && <div className="mb-3"><ErpNotice tone="success">{msg}</ErpNotice></div>}

      {loading ? (
        <ErpLoadingState />
      ) : error ? (
        <ErpErrorState description={error} retry={load} />
      ) : pending.length === 0 ? (
        <ErpEmptyState icon={<Camera size={20} />} title="No hay fotos pendientes" description="Cuando un empleado suba una foto, va a aparecer acá para revisar." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pending.map((u) => (
            <div key={u.username} className="erp-card flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <EmployeePhoto username={u.username} name={u.display_name} hasPhoto size="lg" />
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[color:var(--text)]">{u.display_name}</div>
                  <div className="truncate font-mono text-[11.5px] text-[color:var(--text-3)]">{u.username}</div>
                  <div className="mt-1 text-[11.5px] text-[color:var(--text-2)]">
                    {String(u.employee?.photo_status) === 'solicitada_nuevamente' ? 'Reenviada tras solicitud' : 'Pendiente de aprobación'}
                  </div>
                </div>
              </div>
              {canApprove && (
                <div className="flex gap-2">
                  <ErpButton variant="primary" size="sm" fullWidth loading={working === `${u.username}:approve`} leftIcon={<Check size={14} />} onClick={() => act(u.username, 'approve')}>Aprobar</ErpButton>
                  <ErpButton variant="danger" size="sm" fullWidth loading={working === `${u.username}:reject`} leftIcon={<X size={14} />} onClick={() => act(u.username, 'reject')}>Rechazar</ErpButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
