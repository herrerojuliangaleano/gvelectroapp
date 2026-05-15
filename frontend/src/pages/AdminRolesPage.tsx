import { useEffect, useMemo, useState } from 'react';
import { fetchPermissions, fetchRoles, fetchUsers, updateRole } from '../api/client';
import type { PermissionInfo, RoleInfo, UserInfo } from '../types';

export function AdminRolesPage() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selected, setSelected] = useState<RoleInfo | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [r, p, u] = await Promise.all([fetchRoles(), fetchPermissions(), fetchUsers().catch(() => [] as UserInfo[])]);
    setRoles(r);
    setPermissions(p);
    setUsers(u);
    setSelected((current) => current ? r.find((x) => x.name === current.name) || r[0] : r[0]);
  }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionInfo[]>();
    for (const permission of permissions) {
      const group = permission.group || 'Otros';
      groups.set(group, [...(groups.get(group) || []), permission]);
    }
    return Array.from(groups.entries());
  }, [permissions]);

  const userCountByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of users) {
      const roleKeys = Array.from(new Set([user.role, ...(user.roles || [])].filter(Boolean)));
      for (const role of roleKeys) counts.set(role, (counts.get(role) || 0) + 1);
    }
    return counts;
  }, [users]);

  function toggle(permission: string) {
    if (!selected) return;
    if (selected.permissions.includes('*')) return;
    const exists = selected.permissions.includes(permission);
    setSelected({ ...selected, permissions: exists ? selected.permissions.filter((p) => p !== permission) : [...selected.permissions, permission] });
  }

  async function save() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await updateRole(selected.name, { label: selected.label, level: selected.level, permissions: selected.permissions });
      setMessage('Rol actualizado. Cerrá y volvé a iniciar sesión si cambiaste permisos de tu propio rol.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6"><h1 className="text-2xl font-black sm:text-3xl">Roles y permisos</h1><p className="mt-2 text-sm text-slate-400">Matriz visual de qué puede ver y ejecutar cada rol. Un usuario puede tener varios roles y sus permisos se suman.</p></div>
      <div className="mb-5 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
        Los roles definen <b>qué puede hacer</b> un usuario. La empresa y la sucursal operativa se asignan desde <b>Usuarios</b> y definen <b>dónde opera</b>. Esta separación evita mezclar permisos con alcance.
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">{message}</div>}
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-3">
          {roles.map((role) => <button key={role.name} onClick={() => setSelected(role)} className={`mb-2 w-full rounded-xl px-4 py-3 text-left text-sm font-bold ${selected?.name === role.name ? 'bg-blue-500 text-white' : 'bg-slate-900 text-slate-300'}`}><div>{role.label}</div><div className="text-xs opacity-80">{role.name} · nivel {role.level} · {userCountByRole.get(role.name) || 0} usuario/s</div></button>)}
        </div>
        {selected && (
          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
              <b className="text-white">{selected.label}</b> está asignado a <b>{userCountByRole.get(selected.name) || 0}</b> usuario/s. Si este rol se combina con otros, el usuario recibe la suma de permisos.
            </div>
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Nombre visible</span><input value={selected.label} onChange={(e) => setSelected({ ...selected, label: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Nivel</span><input type="number" value={selected.level} onChange={(e) => setSelected({ ...selected, level: Number(e.target.value) })} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" /></label>
            </div>
            {selected.permissions.includes('*') && <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">Este rol tiene permiso total (*).</div>}
            <div className="space-y-5">
              {groupedPermissions.map(([group, items]) => (
                <section key={group} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">{group}</h3>
                  <div className="grid gap-2 md:grid-cols-2">
                    {items.map((p) => <label key={p.id} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm"><input disabled={selected.permissions.includes('*')} type="checkbox" checked={selected.permissions.includes('*') || selected.permissions.includes(p.id)} onChange={() => toggle(p.id)} className="mt-1" /><span><span className="block font-bold text-slate-200">{p.label}</span><span className="text-xs text-slate-500">{p.id}</span></span></label>)}
                  </div>
                </section>
              ))}
            </div>
            <button onClick={save} className="mt-5 rounded-xl bg-blue-500 px-5 py-3 font-bold text-white">Guardar permisos</button>
          </div>
        )}
      </div>
    </div>
  );
}
