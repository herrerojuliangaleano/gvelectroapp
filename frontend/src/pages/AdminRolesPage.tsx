// Roles y permisos — Fase 1 de la reorganización (2026-06-10).
//
// Los roles se agrupan en DEPARTAMENTOS (Administración / Gerencia /
// Posventa / Encargados / Depósito / Ventas), editables desde esta misma
// pantalla. El árbol es: departamento → roles → usuarios.
//
// Regla del sistema (Fase 0): la capacidad la deciden SIEMPRE los permisos
// del usuario (unión de todos sus roles). El departamento es organizativo,
// no afecta permisos.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { can, createRoleGroup, deleteRoleGroup, fetchPermissions, fetchRoleGroups, fetchRoles, fetchUsers, updateRole, updateRoleGroup } from '../api/client';
import type { PermissionInfo, RoleGroupInfo, RoleInfo, UserInfo } from '../types';

const UNGROUPED = '__sin_departamento__';

export function AdminRolesPage() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [groups, setGroups] = useState<RoleGroupInfo[]>([]);
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selected, setSelected] = useState<RoleInfo | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canManage = can('roles.manage');

  async function load() {
    const [r, g, p, u] = await Promise.all([
      fetchRoles(),
      fetchRoleGroups().catch(() => [] as RoleGroupInfo[]),
      fetchPermissions(),
      fetchUsers().catch(() => [] as UserInfo[]),
    ]);
    setRoles(r);
    setGroups(g);
    setPermissions(p);
    setUsers(u);
    setSelected((current) => (current ? r.find((x) => x.name === current.name) || r[0] : r[0]));
  }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, PermissionInfo[]>();
    for (const permission of permissions) {
      const group = permission.group || 'Otros';
      map.set(group, [...(map.get(group) || []), permission]);
    }
    return Array.from(map.entries());
  }, [permissions]);

  const userCountByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of users) {
      const roleKeys = Array.from(new Set([user.role, ...(user.roles || [])].filter(Boolean)));
      for (const role of roleKeys) counts.set(role, (counts.get(role) || 0) + 1);
    }
    return counts;
  }, [users]);

  // Árbol: departamento → roles. Los roles sin grupo van a una sección extra.
  const tree = useMemo(() => {
    const byGroup = new Map<string, RoleInfo[]>();
    for (const role of roles) {
      const key = role.group || UNGROUPED;
      byGroup.set(key, [...(byGroup.get(key) || []), role]);
    }
    for (const list of byGroup.values()) list.sort((a, b) => b.level - a.level);
    const sections: { key: string; label: string; group: RoleGroupInfo | null; roles: RoleInfo[] }[] = [];
    for (const g of groups) {
      sections.push({ key: g.name, label: g.label, group: g, roles: byGroup.get(g.name) || [] });
    }
    if (byGroup.has(UNGROUPED)) {
      sections.push({ key: UNGROUPED, label: 'Sin departamento', group: null, roles: byGroup.get(UNGROUPED) || [] });
    }
    return sections;
  }, [roles, groups]);

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
      await updateRole(selected.name, { label: selected.label, level: selected.level, permissions: selected.permissions, group: selected.group ?? '' });
      setMessage('Rol actualizado. Cerrá y volvé a iniciar sesión si cambiaste permisos de tu propio rol.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
  }

  async function addGroup() {
    const label = window.prompt('Nombre del nuevo departamento (ej: Sistemas):');
    if (!label?.trim()) return;
    setError(''); setMessage('');
    try {
      const maxOrder = Math.max(0, ...groups.map((g) => g.sort_order));
      await createRoleGroup({ label: label.trim(), sort_order: maxOrder + 10 });
      setMessage(`Departamento "${label.trim()}" creado. Asigná roles eligiéndolo en el editor de cada rol.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear el departamento'); }
  }

  async function renameGroup(group: RoleGroupInfo) {
    const label = window.prompt('Nuevo nombre del departamento:', group.label);
    if (!label?.trim() || label.trim() === group.label) return;
    setError(''); setMessage('');
    try {
      await updateRoleGroup(group.id, { label: label.trim() });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo renombrar'); }
  }

  async function removeGroup(group: RoleGroupInfo, roleCount: number) {
    const warning = roleCount > 0
      ? `El departamento "${group.label}" tiene ${roleCount} rol/es que quedarán sin departamento. ¿Eliminar igual?`
      : `¿Eliminar el departamento "${group.label}"?`;
    if (!window.confirm(warning)) return;
    setError(''); setMessage('');
    try {
      await deleteRoleGroup(group.id);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo eliminar'); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">Roles y permisos</h1>
          <p className="mt-2 text-sm text-slate-400">Estructura: departamento → roles → usuarios. Un usuario puede tener varios roles y sus permisos se suman.</p>
        </div>
        {canManage && (
          <button onClick={addGroup} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-200 hover:bg-slate-800">
            <FolderPlus size={15} /> Nuevo departamento
          </button>
        )}
      </div>
      <div className="mb-5 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
        Los roles definen <b>qué puede hacer</b> un usuario (la capacidad la deciden siempre los permisos, nunca el nombre del rol). El departamento agrupa roles por área. La empresa y la sucursal se asignan desde <b>Usuarios</b> y definen <b>dónde opera</b>.
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">{message}</div>}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">

        {/* ── Árbol departamentos → roles ── */}
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-3 self-start">
          {tree.map((section) => {
            const isCollapsed = collapsed[section.key];
            return (
              <div key={section.key} className="mb-2">
                <div className="flex items-center gap-1 rounded-xl px-2 py-2">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [section.key]: !isCollapsed }))}
                    className="flex flex-1 items-center gap-2 text-left text-xs font-black uppercase tracking-wide text-slate-400 hover:text-slate-200"
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    {section.label}
                    <span className="font-bold normal-case tracking-normal text-slate-600">{section.roles.length}</span>
                  </button>
                  {canManage && section.group && (
                    <>
                      <button onClick={() => renameGroup(section.group!)} title="Renombrar departamento" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"><Pencil size={13} /></button>
                      <button onClick={() => removeGroup(section.group!, section.roles.length)} title="Eliminar departamento" className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
                {!isCollapsed && section.roles.map((role) => (
                  <button
                    key={role.name}
                    onClick={() => setSelected(role)}
                    className={`mb-1.5 ml-4 block w-[calc(100%-1rem)] rounded-xl px-3.5 py-2.5 text-left text-sm font-bold ${selected?.name === role.name ? 'bg-blue-500 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
                  >
                    <div>{role.label}</div>
                    <div className="text-xs opacity-80">nivel {role.level} · {userCountByRole.get(role.name) || 0} usuario/s</div>
                  </button>
                ))}
                {!isCollapsed && section.roles.length === 0 && (
                  <div className="ml-4 rounded-xl border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-600">Sin roles. Asignalos desde el editor de cada rol.</div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Editor del rol seleccionado ── */}
        {selected && (
          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
              <b className="text-white">{selected.label}</b> está asignado a <b>{userCountByRole.get(selected.name) || 0}</b> usuario/s. Si este rol se combina con otros, el usuario recibe la suma de permisos.
            </div>
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Nombre visible</span><input value={selected.label} onChange={(e) => setSelected({ ...selected, label: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Nivel</span><input type="number" value={selected.level} onChange={(e) => setSelected({ ...selected, level: Number(e.target.value) })} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" /></label>
              <label>
                <span className="mb-1 block text-xs font-bold text-slate-400">Departamento</span>
                <select value={selected.group || ''} onChange={(e) => setSelected({ ...selected, group: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3">
                  <option value="">Sin departamento</option>
                  {groups.map((g) => <option key={g.name} value={g.name}>{g.label}</option>)}
                </select>
              </label>
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
            {canManage && <button onClick={save} className="mt-5 rounded-xl bg-blue-500 px-5 py-3 font-bold text-white">Guardar rol</button>}
          </div>
        )}
      </div>
    </div>
  );
}
