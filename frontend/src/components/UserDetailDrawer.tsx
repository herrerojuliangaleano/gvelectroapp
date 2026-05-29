import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, KeyRound, Power, Trash2, X } from 'lucide-react';
import {
  activateUser,
  approveEmployeePhoto,
  can,
  deactivateUser,
  deleteUser,
  fetchOperationalStructure,
  fetchPermissions,
  fetchRoles,
  rejectEmployeePhoto,
  requestEmployeePhoto,
  resetUserPassword,
  saveUser,
} from '../api/client';
import { EmployeePhoto } from './EmployeePhoto';
import {
  ErpBadge,
  ErpButton,
  ErpDrawer,
  ErpField,
  ErpInfoGrid,
  ErpInfoRow,
  ErpInput,
  ErpNotice,
  ErpSelect,
  ErpTabBar,
  type ErpBadgeTone,
} from './ProUI';
import type { BranchInfo, CompanyInfo, PermissionInfo, RoleInfo, UserInfo } from '../types';

const PHOTO_LABEL: Record<string, { label: string; tone: ErpBadgeTone }> = {
  sin_foto: { label: 'Sin foto', tone: 'neutral' },
  pendiente_aprobacion: { label: 'Pendiente de aprobación', tone: 'warning' },
  solicitada_nuevamente: { label: 'Solicitada nuevamente', tone: 'warning' },
  aprobada: { label: 'Aprobada', tone: 'success' },
  rechazada: { label: 'Rechazada', tone: 'danger' },
};

function userRoles(u: UserInfo): string[] {
  const out: string[] = [];
  for (const r of [u.role, ...(u.roles || [])]) { const v = String(r || '').trim(); if (v && !out.includes(v)) out.push(v); }
  return out;
}

type Tab = 'resumen' | 'roles' | 'alcance' | 'historial';

export function UserDetailDrawer({
  user,
  roleLabel,
  open,
  onClose,
  onChanged,
}: {
  user: UserInfo | null;
  roleLabel: (name: string) => string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Catálogos para matriz de permisos (U-04) y editor de alcance (U-05).
  const [rolesCatalog, setRolesCatalog] = useState<RoleInfo[]>([]);
  const [permsCatalog, setPermsCatalog] = useState<PermissionInfo[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [scopeCompany, setScopeCompany] = useState('');
  const [scopeBranches, setScopeBranches] = useState<string[]>([]);
  const [savingScope, setSavingScope] = useState(false);
  // Edición de identidad/roles (U-03) — reemplaza al editor legacy.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editSecondary, setEditSecondary] = useState<string[]>([]);
  const [savingUser, setSavingUser] = useState(false);

  useEffect(() => { if (open) { setTab('resumen'); setMsg(null); setErr(null); } }, [open, user?.username]);

  useEffect(() => {
    if (!open) return;
    fetchRoles().then(setRolesCatalog).catch(() => undefined);
    fetchPermissions().then(setPermsCatalog).catch(() => undefined);
    fetchOperationalStructure().then((s) => { setCompanies(s.companies || []); setBranches(s.branches || []); }).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!user) return;
    setScopeCompany(user.company_id || '');
    setScopeBranches((user.branches || []).map((b) => b.id));
    setEditName(user.display_name);
    setEditRole(user.role);
    setEditSecondary((user.roles || []).filter((r) => r !== user.role));
    setEditing(false);
  }, [user?.username, open]);

  const effectivePerms = useMemo(() => {
    if (!user) return { all: false, byGroup: new Map<string, { id: string; label: string; roles: string[] }[]>(), count: 0 };
    const roleNames = [user.role, ...(user.roles || [])].map((r) => String(r || '').trim()).filter(Boolean);
    const roleMap = new Map(rolesCatalog.map((r) => [r.name, r]));
    if (roleNames.some((rn) => (roleMap.get(rn)?.permissions || []).includes('*'))) {
      return { all: true, byGroup: new Map<string, { id: string; label: string; roles: string[] }[]>(), count: 0 };
    }
    const grant = new Map<string, string[]>();
    for (const rn of roleNames) {
      for (const p of roleMap.get(rn)?.permissions || []) {
        if (!grant.has(p)) grant.set(p, []);
        grant.get(p)!.push(rn);
      }
    }
    const labelOf = new Map(permsCatalog.map((p) => [p.id, p.label]));
    const groupOf = new Map(permsCatalog.map((p) => [p.id, p.group || 'Otros']));
    const byGroup = new Map<string, { id: string; label: string; roles: string[] }[]>();
    for (const [pid, rs] of grant) {
      const g = groupOf.get(pid) || 'Otros';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push({ id: pid, label: labelOf.get(pid) || pid, roles: rs });
    }
    return { all: false, byGroup, count: grant.size };
  }, [user, rolesCatalog, permsCatalog]);

  if (!user) return <ErpDrawer open={open} onClose={onClose} title="Usuario"><div /></ErpDrawer>;

  const emp = user.employee;
  const photo = PHOTO_LABEL[String(emp?.photo_status || 'sin_foto')] || PHOTO_LABEL.sin_foto;
  const canManage = can('users.manage');
  const canApprove = can('employees.photo.approve');
  const photoPending = ['pendiente_aprobacion', 'solicitada_nuevamente'].includes(String(emp?.photo_status || ''));

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setWorking(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(okMsg); onChanged?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo completar la acción'); }
    finally { setWorking(false); }
  }

  function toggleScopeBranch(id: string) {
    setScopeBranches((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  async function saveScope() {
    if (!user) return;
    setSavingScope(true); setErr(null); setMsg(null);
    try {
      await saveUser({
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        roles: user.roles && user.roles.length ? user.roles : [user.role],
        company_id: scopeCompany || undefined,
        branch_id: scopeBranches[0] || undefined,
        branch_ids: scopeBranches,
        is_active: user.is_active,
      });
      setMsg('Alcance actualizado.');
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar el alcance');
    } finally {
      setSavingScope(false);
    }
  }

  const scopeBranchOptions = branches.filter((b) => !scopeCompany || b.company_id === scopeCompany);

  function toggleEditSecondary(name: string) {
    setEditSecondary((prev) => (prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name]));
  }

  async function saveUserEdit() {
    if (!user) return;
    if (!editRole) { setErr('Elegí un rol principal.'); return; }
    setSavingUser(true); setErr(null); setMsg(null);
    try {
      await saveUser({
        username: user.username,
        display_name: editName.trim() || user.display_name,
        role: editRole,
        roles: [editRole, ...editSecondary.filter((r) => r !== editRole)],
        company_id: user.company_id || undefined,
        branch_id: user.branch_id || undefined,
        branch_ids: (user.branches || []).map((b) => b.id),
        is_active: user.is_active,
      });
      setMsg('Usuario actualizado.');
      setEditing(false);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar el usuario');
    } finally {
      setSavingUser(false);
    }
  }

  return (
    <ErpDrawer
      open={open}
      onClose={onClose}
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Usuario</span>
          <ErpBadge tone={user.is_active ? 'success' : 'neutral'}>{user.is_active ? 'Activo' : 'Inactivo'}</ErpBadge>
          {userRoles(user).length > 1 && <ErpBadge tone="violet">Multi-rol</ErpBadge>}
        </div>
      }
      subtitle={
        <div className="mt-1.5">
          <div className="text-[15px] font-semibold leading-tight text-[color:var(--text)]">{user.display_name}</div>
          <div className="mt-0.5 font-mono text-[12px] text-[color:var(--text-3)]">{user.username}</div>
        </div>
      }
    >
      <div className="erp-stack-4">
        {msg && <ErpNotice tone="success">{msg}</ErpNotice>}
        {err && <ErpNotice tone="error">{err}</ErpNotice>}

        <ErpTabBar
          tabs={[{ key: 'resumen', label: 'Resumen' }, { key: 'roles', label: 'Roles y permisos' }, { key: 'alcance', label: 'Alcance' }, { key: 'historial', label: 'Historial' }]}
          active={tab}
          onChange={(k) => setTab(k as Tab)}
        />

        {tab === 'resumen' && (
          <div className="erp-stack-4">
            <section className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Empleado vinculado</span>
                {emp?.id && <Link to={`/administracion/empleados/${encodeURIComponent(emp.id)}`} onClick={onClose} className="text-[12px] font-semibold text-[color:var(--primary)]">Ver legajo →</Link>}
              </div>
              {emp && String(emp.dni || '').trim() ? (
                <ErpInfoGrid columns={2}>
                  <ErpInfoRow label="DNI" value={<span className="font-mono">{emp.dni}</span>} />
                  <ErpInfoRow label="Puesto" value={emp.position || '—'} />
                  <ErpInfoRow label="Sucursal de trabajo" value={emp.work_branch_name || emp.branch_name || '—'} />
                  <ErpInfoRow label="Estado laboral" value={emp.status || '—'} />
                </ErpInfoGrid>
              ) : (
                <div className="text-[12.5px] text-[color:var(--text-3)]">Este usuario no tiene un empleado vinculado.</div>
              )}
            </section>

            <section className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Roles asignados</div>
              <div className="flex flex-wrap gap-1.5">
                {userRoles(user).map((r) => <span key={r} className="erp-tag erp-tag-primary">{roleLabel(r)}</span>)}
              </div>
            </section>

            <section className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Alcance operativo</div>
              <div className="text-[12.5px] text-[color:var(--text-2)]">{user.company_name || 'Sin empresa'} · <strong>{(user.branches || []).length} sucursales</strong></div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(user.branches || []).map((b) => <span key={b.id} className="erp-tag">{b.name}{b.is_primary ? ' · principal' : ''}</span>)}
              </div>
            </section>

            <section className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Foto profesional</span>
                <ErpBadge tone={photo.tone}>{photo.label}</ErpBadge>
              </div>
              <div className="flex items-center gap-3">
                <EmployeePhoto username={user.username} name={user.display_name} hasPhoto={String(emp?.photo_status || '') === 'aprobada' || photoPending} size="md" />
                <div className="flex flex-wrap gap-1.5">
                  {canApprove && photoPending && (
                    <>
                      <ErpButton size="sm" variant="primary" loading={working} leftIcon={<Check size={13} />} onClick={() => run(() => approveEmployeePhoto(user.username), 'Foto aprobada.')}>Aprobar</ErpButton>
                      <ErpButton size="sm" variant="danger" loading={working} leftIcon={<X size={13} />} onClick={() => run(() => rejectEmployeePhoto(user.username), 'Foto rechazada.')}>Rechazar</ErpButton>
                    </>
                  )}
                  {canApprove && !photoPending && (
                    <ErpButton size="sm" variant="secondary" loading={working} onClick={() => run(() => requestEmployeePhoto(user.username), 'Foto solicitada al empleado.')}>
                      {String(emp?.photo_status || '') === 'sin_foto' ? 'Solicitar foto' : 'Solicitar nueva'}
                    </ErpButton>
                  )}
                </div>
              </div>
            </section>

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <ErpButton size="sm" variant="secondary" loading={working} leftIcon={<KeyRound size={13} />} onClick={() => run(() => resetUserPassword(user.username), 'Contraseña reseteada. El usuario deberá crearla en el próximo ingreso.')}>Resetear contraseña</ErpButton>
                {user.is_active
                  ? <ErpButton size="sm" variant="danger" loading={working} leftIcon={<Power size={13} />} onClick={() => run(() => deactivateUser(user.username), 'Usuario desactivado.')}>Desactivar</ErpButton>
                  : <ErpButton size="sm" variant="primary" loading={working} leftIcon={<Power size={13} />} onClick={() => run(() => activateUser(user.username), 'Usuario activado.')}>Activar</ErpButton>}
                <ErpButton size="sm" variant="ghost" loading={working} leftIcon={<Trash2 size={13} />} onClick={async () => {
                  if (!window.confirm(`¿Eliminar el usuario ${user.username}? Esta acción no se puede deshacer.`)) return;
                  await run(() => deleteUser(user.username), 'Usuario eliminado.');
                  onClose();
                }}>Eliminar</ErpButton>
              </div>
            )}
          </div>
        )}

        {tab === 'roles' && editing && (
          <div className="erp-stack-3">
            <ErpField label="Nombre visible"><ErpInput value={editName} onChange={(e) => setEditName(e.target.value)} /></ErpField>
            <ErpField label="Rol principal" required>
              <ErpSelect value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                <option value="">— Elegí rol —</option>
                {rolesCatalog.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
              </ErpSelect>
            </ErpField>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-2)]">Roles secundarios</div>
              <div className="grid gap-1.5">
                {rolesCatalog.filter((r) => r.name !== editRole).map((r) => (
                  <label key={r.name} className="flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-1.5 text-[12.5px]">
                    <input type="checkbox" checked={editSecondary.includes(r.name)} onChange={() => toggleEditSecondary(r.name)} />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => setEditing(false)}>Cancelar</button>
              <ErpButton variant="primary" size="sm" loading={savingUser} onClick={saveUserEdit}>Guardar</ErpButton>
            </div>
          </div>
        )}

        {tab === 'roles' && !editing && (
          <div className="erp-stack-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {userRoles(user).map((r) => <span key={r} className="erp-tag erp-tag-primary">{roleLabel(r)}</span>)}
              </div>
              {canManage && <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => setEditing(true)}>Editar nombre y roles</button>}
            </div>
            {effectivePerms.all ? (
              <ErpNotice tone="success" title="Acceso total">Este usuario tiene un rol con todos los permisos (comodín *).</ErpNotice>
            ) : (
              <>
                <div className="text-[12.5px] text-[color:var(--text-2)]"><strong>{effectivePerms.count}</strong> permisos efectivos (unión de sus roles).</div>
                {[...effectivePerms.byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, perms]) => (
                  <div key={group} className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5">
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">{group} · {perms.length}</div>
                    <ul className="erp-stack-1">
                      {perms.sort((a, b) => a.label.localeCompare(b.label)).map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 text-[12px]">
                          <span className="text-[color:var(--text)]">{p.label}</span>
                          <span className="text-[10.5px] text-[color:var(--text-3)]">{p.roles.map(roleLabel).join(', ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {effectivePerms.count === 0 && <div className="text-[12.5px] text-[color:var(--text-3)]">Sin permisos (¿faltan roles o catálogo?).</div>}
              </>
            )}
            <ErpNotice tone="info">Para cambiar qué permite cada rol, usá Roles y permisos. Acá ves el resultado efectivo del usuario.</ErpNotice>
          </div>
        )}

        {tab === 'alcance' && (
          <div className="erp-stack-3">
            <ErpNotice tone="info">El alcance limita los permisos: sin alcance no hay acceso a los movimientos de esa unidad.</ErpNotice>
            <ErpField label="Empresa">
              <ErpSelect value={scopeCompany} onChange={(e) => setScopeCompany(e.target.value)} disabled={!canManage}>
                <option value="">Todas / sin definir</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ErpSelect>
            </ErpField>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-2)]">Sucursales asignadas <span className="text-[color:var(--text-3)]">({scopeBranches.length})</span></div>
              <div className="grid max-h-72 gap-1.5 overflow-auto">
                {scopeBranchOptions.map((b) => (
                  <label key={b.id} className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[12.5px] ${scopeBranches.includes(b.id) ? 'border-[color:var(--primary)] bg-[color:var(--primary-soft)]' : 'border-[color:var(--border)] bg-[color:var(--surface-2)]'}`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={scopeBranches.includes(b.id)} disabled={!canManage} onChange={() => toggleScopeBranch(b.id)} />
                      <span>{b.name}{scopeBranches[0] === b.id ? ' · principal' : ''}</span>
                    </span>
                    <span className="text-[10.5px] text-[color:var(--text-3)]">{b.type}</span>
                  </label>
                ))}
                {scopeBranchOptions.length === 0 && <span className="text-[12.5px] text-[color:var(--text-3)]">No hay sucursales para esta empresa.</span>}
              </div>
            </div>
            {canManage && (
              <div className="flex justify-end">
                <ErpButton variant="primary" size="sm" loading={savingScope} onClick={saveScope}>Guardar alcance</ErpButton>
              </div>
            )}
          </div>
        )}

        {tab === 'historial' && (
          <ErpInfoGrid columns={2}>
            <ErpInfoRow label="Último acceso" value={user.last_login_at || '—'} />
            <ErpInfoRow label="Último movimiento" value={user.last_movement_at ? `${user.last_movement || ''} · ${user.last_movement_at}` : '—'} />
          </ErpInfoGrid>
        )}
      </div>
    </ErpDrawer>
  );
}
