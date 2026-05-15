import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  activateUser,
  deactivateUser,
  deleteUser,
  fetchOperationalStructure,
  fetchRoles,
  fetchUsers,
  getCurrentUsername,
  repairUserBranchLinks,
  repairUserEmployees,
  repairUserLegacyRoles,
  requestEmployeePhoto,
  approveEmployeePhoto,
  rejectEmployeePhoto,
  resetUserPassword,
  saveUser,
} from '../api/client';
import { EmployeePhoto } from '../components/EmployeePhoto';
import { KpiCard, Notice, PageHeader, Panel, SearchField, primaryButtonClass, proInputClass, secondaryButtonClass } from '../components/ProUI';
import type { BranchInfo, EmployeeInfo, RoleInfo, UserBranchAssignment, UserInfo } from '../types';

type UserForm = {
  username: string;
  display_name: string;
  role: string;
  roles: string[];
  branch_id: string;
  branch_ids: string[];
  employee: Partial<EmployeeInfo>;
  is_active: boolean;
};

const emptyForm: UserForm = {
  username: '',
  display_name: '',
  role: 'VENDEDOR',
  roles: ['VENDEDOR'],
  branch_id: '',
  branch_ids: [],
  employee: { dni: '', first_name: '', last_name: '', phone: '', personal_email: '', position: '', photo_status: 'sin_foto', status: 'activo' },
  is_active: true,
};

function branchTypeLabel(type?: string | null) {
  if (type === 'web') return 'WEB';
  if (type === 'physical') return 'Física';
  if (type === 'deposit') return 'Depósito';
  if (type === 'admin') return 'Administración';
  return 'Sin tipo';
}

function cleanIds(ids: Array<string | null | undefined>) {
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function userRoleKeys(user: UserInfo): string[] {
  return cleanIds([user.role, ...(user.roles || [])]);
}

function roleLabel(roles: RoleInfo[], roleName: string) {
  return roles.find((role) => role.name === roleName)?.label || roleName;
}

function userBranchIds(user: UserInfo): string[] {
  return cleanIds([
    user.branch_id || '',
    ...(user.branches || []).map((branch) => branch.id),
    ...(user.branch_ids || []),
  ]);
}

function userPrimaryAssignment(user: UserInfo, branchById: Map<string, BranchInfo>): UserBranchAssignment | null {
  const explicit = (user.branches || []).find((branch) => branch.is_primary) || (user.branches || [])[0];
  if (explicit) return explicit;
  const primaryId = user.branch_id || userBranchIds(user)[0] || '';
  const branch = primaryId ? branchById.get(primaryId) : null;
  if (branch) {
    return {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      type: branch.type,
      company_id: branch.company_id,
      company_name: branch.company_name,
      parent_branch_id: branch.parent_branch_id,
      parent_branch_name: branch.parent_branch_name,
      is_primary: true,
    };
  }
  if (user.branch_name || user.company_name || user.branch_id) {
    return {
      id: user.branch_id || 'legacy',
      name: user.branch_name || user.sucursal || 'Sin sucursal',
      code: user.branch_code || '',
      type: user.branch_type || '',
      company_id: user.company_id || '',
      company_name: user.company_name || '',
      is_primary: true,
    };
  }
  return null;
}

function userAssignments(user: UserInfo, branchById: Map<string, BranchInfo>): UserBranchAssignment[] {
  const direct = user.branches || [];
  if (direct.length) return direct;
  const ids = userBranchIds(user);
  const assignments = ids
    .map((id, index) => {
      const branch = branchById.get(id);
      if (!branch) return null;
      return {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        type: branch.type,
        company_id: branch.company_id,
        company_name: branch.company_name,
        parent_branch_id: branch.parent_branch_id,
        parent_branch_name: branch.parent_branch_name,
        is_primary: id === user.branch_id || (!user.branch_id && index === 0),
      } satisfies UserBranchAssignment;
    })
    .filter(Boolean) as UserBranchAssignment[];
  if (assignments.length && !assignments.some((item) => item.is_primary)) assignments[0].is_primary = true;
  return assignments;
}

function branchLabel(branch?: BranchInfo | UserBranchAssignment | null) {
  if (!branch) return 'Sucursal sin vincular';
  const company = branch.company_name ? ` · ${branch.company_name}` : '';
  return `${branch.name}${company}`;
}

function employeeFullName(employee?: EmployeeInfo | null, fallback = '') {
  if (!employee) return fallback;
  return employee.display_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ') || fallback;
}

function photoStatusLabel(status?: string | null) {
  if (status === 'aprobada') return 'Foto aprobada';
  if (status === 'pendiente_aprobacion') return 'Foto pendiente';
  if (status === 'rechazada') return 'Foto rechazada';
  if (status === 'solicitada_nuevamente') return 'Foto solicitada';
  return 'Sin foto';
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [companyFilter, setCompanyFilter] = useState('');
  const [branchTypeFilter, setBranchTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busyRepair, setBusyRepair] = useState(false);
  const currentUsername = getCurrentUsername();

  async function load() {
    const [loadedUsers, loadedRoles, structure] = await Promise.all([fetchUsers(), fetchRoles(), fetchOperationalStructure()]);
    setUsers(loadedUsers);
    setRoles(loadedRoles);
    setBranches(structure.branches || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar usuarios'));
  }, []);

  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const companies = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) map.set(branch.company_id, branch.company_name || branch.company_id);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [branches]);

  const filteredBranches = useMemo(() => {
    let list = companyFilter ? activeBranches.filter((branch) => branch.company_id === companyFilter) : activeBranches;
    if (branchTypeFilter) list = list.filter((branch) => branch.type === branchTypeFilter);
    return [...list].sort((a, b) => `${a.company_name} ${a.type} ${a.name}`.localeCompare(`${b.company_name} ${b.type} ${b.name}`));
  }, [activeBranches, companyFilter, branchTypeFilter]);

  const stats = useMemo(() => {
    const withMany = users.filter((user) => userBranchIds(user).length > 1).length;
    const withoutBranch = users.filter((user) => !userPrimaryAssignment(user, branchById)).length;
    const legacyOnly = users.filter((user) => !userPrimaryAssignment(user, branchById) && !!user.sucursal).length;
    const multiRole = users.filter((user) => userRoleKeys(user).length > 1).length;
    const withoutDni = users.filter((user) => !String(user.employee?.dni || '').trim()).length;
    const photoPending = users.filter((user) => (user.employee?.photo_status || 'sin_foto') !== 'aprobada').length;
    return {
      total: users.length,
      active: users.filter((user) => user.is_active).length,
      withMany,
      multiRole,
      withoutBranch,
      legacyOnly,
      withoutDni,
      photoPending,
    };
  }, [branchById, users]);

  const userGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (!q) return true;
      const assignments = userAssignments(u, branchById);
      const haystack = [
        u.username,
        u.display_name,
        u.role,
        ...(u.roles || []),
        u.sucursal,
        u.company_name,
        u.branch_name,
        u.employee?.dni,
        u.employee?.first_name,
        u.employee?.last_name,
        u.employee?.display_name,
        u.employee?.position,
        ...assignments.map((b) => `${b.name} ${b.company_name} ${b.type}`),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
    const map = new Map<string, UserInfo[]>();
    for (const user of filtered) {
      const primary = userPrimaryAssignment(user, branchById);
      const companyName = primary?.company_name || user.company_name || 'Sin empresa';
      const branchName = primary?.name || user.branch_name || '';
      const key = primary ? `${companyName} / ${branchName}` : (user.sucursal ? `Sin vincular / anterior: ${user.sucursal}` : 'Sin vincular');
      map.set(key, [...(map.get(key) || []), user]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [branchById, search, users]);

  function setPrimaryRole(roleName: string) {
    setForm((prev) => {
      const roles = prev.roles.includes(roleName) ? prev.roles : [roleName, ...prev.roles];
      return { ...prev, role: roleName, roles };
    });
  }

  function toggleRole(roleName: string) {
    setForm((prev) => {
      const exists = prev.roles.includes(roleName);
      let nextRoles = exists ? prev.roles.filter((item) => item !== roleName) : [...prev.roles, roleName];
      if (nextRoles.length === 0) nextRoles = [prev.role || roleName];
      const primary = nextRoles.includes(prev.role) ? prev.role : nextRoles[0];
      return { ...prev, role: primary, roles: nextRoles };
    });
  }

  function setPrimary(branchId: string) {
    setForm((prev) => {
      const ids = prev.branch_ids.includes(branchId) ? prev.branch_ids : [...prev.branch_ids, branchId];
      return { ...prev, branch_id: branchId, branch_ids: ids };
    });
  }

  function toggleBranch(branchId: string) {
    setForm((prev) => {
      const exists = prev.branch_ids.includes(branchId);
      const ids = exists ? prev.branch_ids.filter((id) => id !== branchId) : [...prev.branch_ids, branchId];
      const primary = ids.includes(prev.branch_id) ? prev.branch_id : (ids[0] || '');
      return { ...prev, branch_ids: ids, branch_id: primary };
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const primary = form.branch_id ? branchById.get(form.branch_id) : null;
      await saveUser({
        ...form,
        roles: form.roles.includes(form.role) ? form.roles : [form.role, ...form.roles],
        sucursal: primary?.name || '',
        company_id: primary?.company_id || '',
        branch_id: form.branch_id,
        branch_ids: form.branch_ids,
        employee: {
          ...form.employee,
          display_name: [form.employee.first_name, form.employee.last_name].filter(Boolean).join(' ') || form.display_name,
          company_id: primary?.company_id || '',
          branch_id: form.branch_id,
          status: form.is_active ? 'activo' : 'inactivo',
        },
      });
      setMessage(editing ? 'Usuario actualizado correctamente.' : 'Usuario creado. Primer ingreso: contraseña en blanco; luego debe crear su contraseña.');
      setForm(emptyForm);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    }
  }

  function edit(user: UserInfo) {
    const ids = userBranchIds(user);
    const primary = userPrimaryAssignment(user, branchById);
    setForm({
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      roles: userRoleKeys(user),
      branch_id: primary?.id && primary.id !== 'legacy' ? primary.id : (user.branch_id || ids[0] || ''),
      branch_ids: ids,
      employee: {
        dni: user.employee?.dni || '',
        first_name: user.employee?.first_name || '',
        last_name: user.employee?.last_name || '',
        phone: user.employee?.phone || '',
        personal_email: user.employee?.personal_email || '',
        position: user.employee?.position || '',
        photo_status: user.employee?.photo_status || 'sin_foto',
        status: user.employee?.status || (user.is_active ? 'activo' : 'inactivo'),
      },
      is_active: user.is_active,
    });
    setCompanyFilter(primary?.company_id || user.company_id || '');
    setEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setForm(emptyForm);
    setEditing(false);
    setCompanyFilter('');
  }

  async function toggle(user: UserInfo) {
    setError('');
    setMessage('');
    try {
      if (user.is_active) await deactivateUser(user.username);
      else await activateUser(user.username);
      setMessage(user.is_active ? `Usuario ${user.username} bloqueado.` : `Usuario ${user.username} activado.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el usuario');
    }
  }

  async function resetPassword(user: UserInfo) {
    if (!confirm(`¿Blanquear la contraseña de ${user.display_name}?\n\nVa a poder entrar con contraseña vacía y el sistema le pedirá crear una nueva.`)) return;
    setError('');
    setMessage('');
    try {
      await resetUserPassword(user.username);
      setMessage(`Contraseña blanqueada para ${user.display_name}. Primer ingreso: contraseña vacía.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo blanquear la contraseña');
    }
  }

  async function remove(user: UserInfo) {
    if (!confirm(`¿Eliminar definitivamente el usuario ${user.username}?\n\nEsta acción no borra movimientos históricos, pero el usuario ya no podrá iniciar sesión.`)) return;
    setError('');
    setMessage('');
    try {
      await deleteUser(user.username);
      setMessage(`Usuario ${user.username} eliminado.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el usuario');
    }
  }

  async function photoAction(user: UserInfo, action: 'request' | 'approve' | 'reject') {
    setError('');
    setMessage('');
    try {
      if (action === 'request') {
        await requestEmployeePhoto(user.username);
        setMessage(`Se solicitó foto profesional a ${user.display_name}.`);
      } else if (action === 'approve') {
        await approveEmployeePhoto(user.username);
        setMessage(`Foto profesional aprobada para ${user.display_name}.`);
      } else {
        await rejectEmployeePhoto(user.username);
        setMessage(`Foto profesional rechazada para ${user.display_name}.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la foto');
    }
  }

  async function runRepair() {
    setBusyRepair(true);
    setError('');
    setMessage('');
    try {
      const result = await repairUserBranchLinks();
      setMessage(`Vínculos revisados: ${result.total}. Actualizados: ${result.changed}. Sincronizados: ${result.synced}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron reparar los vínculos');
    } finally {
      setBusyRepair(false);
    }
  }

  async function runRoleRepair() {
    setBusyRepair(true);
    setError('');
    setMessage('');
    try {
      const result = await repairUserLegacyRoles();
      setMessage(`Roles legacy revisados: ${result.total}. Usuarios sincronizados: ${result.synced}. Usuarios actualizados: ${result.changed_users}. Roles creados: ${result.created_roles}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron reparar los roles legacy');
    } finally {
      setBusyRepair(false);
    }
  }

  async function runEmployeeRepair() {
    setBusyRepair(true);
    setError('');
    setMessage('');
    try {
      const result = await repairUserEmployees();
      setMessage(`Empleados revisados: ${result.total}. Creados: ${result.created}. Actualizados: ${result.updated}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron preparar los empleados');
    } finally {
      setBusyRepair(false);
    }
  }


  async function copyAccess(user: UserInfo) {
    const assignments = userAssignments(user, branchById);
    const branchesText = assignments.map((b) => `${b.is_primary ? 'Principal: ' : '- '}${b.name}${b.company_name ? ` (${b.company_name})` : ''}`).join('\n') || user.sucursal || 'Sin sucursal';
    const rolesText = userRoleKeys(user).map((role) => roleLabel(roles, role)).join(', ') || user.role;
    const text = `Usuario: ${user.username}\nRoles: ${rolesText}\nContraseña: dejá en blanco la primera vez.\nSucursal/es asignadas:\n${branchesText}\nAl ingresar al sistema te va a pedir crear una contraseña.`;
    await navigator.clipboard.writeText(text);
    setMessage(`Datos de acceso copiados para ${user.display_name}.`);
  }

  const selectedPrimary = form.branch_id ? branchById.get(form.branch_id) : null;
  const selectedAssignments = form.branch_ids.map((id) => branchById.get(id)).filter(Boolean) as BranchInfo[];
  const selectedHasDeposit = selectedAssignments.some((branch) => branch.type === 'deposit');
  const selectedHasPhysical = selectedAssignments.some((branch) => branch.type === 'physical');
  const selectedCanManageWarranties = form.roles.some((roleName) => {
    const role = roles.find((item) => item.name === roleName);
    const perms = role?.permissions || [];
    return perms.includes('*') || perms.includes('warranties.manage') || perms.includes('warranties.manage_provider');
  });

  return (
    <div className="pro-page">
      <PageHeader
        eyebrow="Administración"
        title="Usuarios"
        description="Accesos, roles, empleados vinculados y alcance operativo por empresa o sucursal."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Usuarios" value={stats.total} tone="blue" />
        <KpiCard label="Activos" value={stats.active} tone="green" />
        <KpiCard label="Multi-sucursal" value={stats.withMany} />
        <KpiCard label="Multi-rol" value={stats.multiRole} />
        <KpiCard label="Sin DNI" value={stats.withoutDni} tone={stats.withoutDni > 0 ? 'amber' : 'slate'} />
        <KpiCard label="Foto pendiente" value={stats.photoPending} tone={stats.photoPending > 0 ? 'amber' : 'slate'} />
        <KpiCard label="Sin sucursal" value={stats.withoutBranch} tone={stats.withoutBranch > 0 ? 'amber' : 'slate'} />
        <KpiCard label="Legacy" value={stats.legacyOnly} tone={stats.legacyOnly > 0 ? 'amber' : 'slate'} />
      </div>

      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {message && <div className="mb-4"><Notice tone="success">{message}</Notice></div>}

      <form onSubmit={submit} className="mb-8 pro-panel">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-400">Usuario</span>
            <input required disabled={editing} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim().toLowerCase() })} className={`${proInputClass} disabled:opacity-60`} placeholder="cchaparro" />
          </label>
          <label className="block xl:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-400">Nombre visible</span>
            <input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={proInputClass} placeholder="Claudio Chaparro" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-400">Rol principal</span>
            <select value={form.role} onChange={(e) => setPrimaryRole(e.target.value)} className={proInputClass}>
              {roles.map((role) => <option key={role.name} value={role.name}>{role.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-400">Empresa</span>
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className={proInputClass}>
              <option value="">Todas</option>
              {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <div className="flex gap-2 sm:self-end">
            <button className={primaryButtonClass}>{editing ? 'Actualizar' : 'Crear usuario'}</button>
            {editing && <button type="button" onClick={cancelEdit} className={secondaryButtonClass}>Cancelar</button>}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <div className="mb-3">
            <div className="text-sm font-black text-white">Empleado vinculado</div>
            <div className="text-xs text-slate-500">El usuario es el acceso al sistema. El empleado guarda DNI, datos laborales y queda preparado para foto profesional y recibos.</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-400">DNI</span>
              <input value={form.employee.dni || ''} onChange={(e) => setForm({ ...form, employee: { ...form.employee, dni: e.target.value } })} className={proInputClass} placeholder="Sin puntos" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-400">Nombre</span>
              <input value={form.employee.first_name || ''} onChange={(e) => setForm({ ...form, employee: { ...form.employee, first_name: e.target.value } })} className={proInputClass} placeholder="Nombre" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-400">Apellido</span>
              <input value={form.employee.last_name || ''} onChange={(e) => setForm({ ...form, employee: { ...form.employee, last_name: e.target.value } })} className={proInputClass} placeholder="Apellido" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-400">Puesto</span>
              <input value={form.employee.position || ''} onChange={(e) => setForm({ ...form, employee: { ...form.employee, position: e.target.value } })} className={proInputClass} placeholder="Vendedor, depósito..." />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-400">Teléfono</span>
              <input value={form.employee.phone || ''} onChange={(e) => setForm({ ...form, employee: { ...form.employee, phone: e.target.value } })} className={proInputClass} placeholder="11..." />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-400">Email personal</span>
              <input value={form.employee.personal_email || ''} onChange={(e) => setForm({ ...form, employee: { ...form.employee, personal_email: e.target.value } })} className={proInputClass} placeholder="empleado@mail.com" />
            </label>
          </div>
          <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100">
            El DNI queda como identificador único del empleado para recibos, pero la clave interna sigue siendo un ID técnico. La foto profesional se sube desde Mi usuario y administración puede aprobarla, rechazarla o solicitarla nuevamente. Estado actual: <b>{photoStatusLabel(form.employee.photo_status)}</b>.
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_.9fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-white">Roles asignados</div>
                <div className="text-xs text-slate-500">Podés asignar varios roles. Los permisos efectivos son la suma de todos.</div>
              </div>
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, role: 'VENDEDOR', roles: ['VENDEDOR'] }))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">Reset</button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {roles.map((role) => {
                const checked = form.roles.includes(role.name);
                const primary = form.role === role.name;
                return (
                  <div key={role.name} className={`rounded-xl border p-3 ${checked ? 'border-blue-500/50 bg-blue-500/10' : 'border-slate-800 bg-slate-900/70'}`}>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" checked={checked} onChange={() => toggleRole(role.name)} className="mt-1" />
                      <span>
                        <span className="block font-bold text-white">{role.label}</span>
                        <span className="block text-xs text-slate-500">{role.name} · {role.permissions.includes('*') ? 'permiso total' : `${role.permissions.length} permisos`}</span>
                      </span>
                    </label>
                    <button type="button" disabled={!checked} onClick={() => setPrimaryRole(role.name)} className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold ${primary ? 'border-green-500/50 bg-green-500/10 text-green-200' : 'border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40'}`}>{primary ? 'Principal' : 'Marcar principal'}</button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
            <div className="font-black text-white">Permisos efectivos</div>
            <p className="mt-2 leading-6">Este usuario tendrá la suma de permisos de <b>{form.roles.length}</b> rol/es asignados. El rol principal se mantiene para compatibilidad con módulos viejos.</p>
            <div className="mt-3 flex flex-wrap gap-2">{form.roles.map((role) => <span key={role} className="rounded-full border border-blue-400/30 px-2 py-1 text-xs">{roleLabel(roles, role)}</span>)}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_.9fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-white">Unidad operativa asignada</div>
                <div className="text-xs text-slate-500">Sucursal física, depósito, web o administración. Marcá una o más; una debe quedar como principal.</div>
              </div>
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, branch_id: '', branch_ids: [] }))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">Limpiar</button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {(['', 'physical', 'deposit', 'web', 'admin'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBranchTypeFilter(t)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                    branchTypeFilter === t
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {t === '' ? 'Todas' : t === 'physical' ? 'Física' : t === 'deposit' ? 'Depósito' : t === 'web' ? 'WEB' : 'Admin'}
                </button>
              ))}
              <span className="self-center text-xs text-slate-500">{filteredBranches.length} unidad/es</span>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {filteredBranches.map((branch) => {
                const checked = form.branch_ids.includes(branch.id);
                const primary = form.branch_id === branch.id;
                return (
                  <div key={branch.id} className={`rounded-xl border p-3 ${checked ? 'border-blue-500/50 bg-blue-500/10' : 'border-slate-800 bg-slate-900/70'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex min-w-0 items-start gap-3">
                        <input type="checkbox" checked={checked} onChange={() => toggleBranch(branch.id)} className="mt-1" />
                        <span className="min-w-0">
                          <span className="block font-bold text-white">{branch.name}</span>
                          <span className="block text-xs text-slate-400">{branch.company_name} · {branchTypeLabel(branch.type)}{branch.parent_branch_name ? ` · base ${branch.parent_branch_name}` : ''}</span>
                        </span>
                      </label>
                      <button type="button" disabled={!checked} onClick={() => setPrimary(branch.id)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${primary ? 'border-green-500/50 bg-green-500/10 text-green-200' : 'border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40'}`}>{primary ? 'Principal' : 'Marcar principal'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
            <div className="font-black text-white">Alcance operativo</div>
            <p className="mt-2 leading-6">
              La unidad principal es el <b>default operativo</b> del usuario: <b>{branchLabel(selectedPrimary)}</b>.
              No limita por sí sola todo lo que puede hacer; las acciones reales salen de sus roles/permisos.
            </p>
            <div className="mt-3 space-y-1.5 text-xs text-blue-100/70">
              <div><span className="font-bold text-blue-200">Vendedor/sucursal:</span> si solo tiene alcance físico y no gestión, carga automáticamente como cliente en su sucursal.</div>
              <div><span className="font-bold text-blue-200">Depósito operativo:</span> si tiene rol DEPOSITO sin gestión, carga automáticamente como cliente en su depósito, recibe remitos y mueve depósito → depósito.</div>
              <div><span className="font-bold text-blue-200">Gestor/encargado/admin:</span> puede tener sucursal + depósito asignados y cargar desde cualquier origen permitido por sus permisos.</div>
              <div><span className="font-bold text-blue-200">WEB:</span> venta online — no carga garantías de mostrador salvo permiso de gestión.</div>
            </div>
            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
              <div className={`rounded-xl border p-3 ${selectedHasPhysical ? 'border-green-500/30 bg-green-500/10 text-green-100' : 'border-slate-700 text-slate-400'}`}>Sucursal física: {selectedHasPhysical ? 'asignada' : 'no asignada'}</div>
              <div className={`rounded-xl border p-3 ${selectedHasDeposit ? 'border-green-500/30 bg-green-500/10 text-green-100' : 'border-slate-700 text-slate-400'}`}>Depósito: {selectedHasDeposit ? 'asignado' : 'no asignado'}</div>
              <div className={`rounded-xl border p-3 ${selectedCanManageWarranties ? 'border-blue-500/30 bg-blue-500/10 text-blue-100' : 'border-slate-700 text-slate-400'}`}>Gestión garantías: {selectedCanManageWarranties ? 'habilitada por rol' : 'no habilitada'}</div>
            </div>
            {form.branch_ids.length === 0 && <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">Este usuario quedaría sin unidad operativa asignada.</div>}
            {selectedHasDeposit && selectedHasPhysical && !selectedCanManageWarranties && (
              <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
                Tiene sucursal y depósito, pero no tiene rol de gestión. Va a operar con reglas acotadas según su rol principal. Si es encargado/gestor, agregale un rol con permisos de gestión de garantías.
              </div>
            )}
          </div>
        </div>
      </form>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-md"><SearchField value={search} onChange={setSearch} placeholder="Buscar usuario, nombre, rol, empresa o sucursal..." /></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busyRepair} onClick={runRepair} className="rounded-xl border border-amber-500/50 px-4 py-3 text-sm font-bold text-amber-100 disabled:opacity-50">
            {busyRepair ? 'Reparando...' : 'Reparar sucursales legacy'}
          </button>
          <button type="button" disabled={busyRepair} onClick={runRoleRepair} className="rounded-xl border border-blue-500/50 px-4 py-3 text-sm font-bold text-blue-100 disabled:opacity-50">
            {busyRepair ? 'Reparando...' : 'Reparar roles legacy'}
          </button>
          <button type="button" disabled={busyRepair} onClick={runEmployeeRepair} className="rounded-xl border border-green-500/50 px-4 py-3 text-sm font-bold text-green-100 disabled:opacity-50">
            {busyRepair ? 'Reparando...' : 'Preparar empleados'}
          </button>
          <div className="text-sm text-slate-500">{users.length} usuario/s configurados</div>
        </div>
      </div>

      <div className="space-y-6">
        {userGroups.map(([groupName, group]) => (
          <section key={groupName}>
            <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">{groupName} · {group.length} usuario/s</h2>
            <div className="space-y-3">
              {group.map((u) => {
                const isSelf = u.username === currentUsername;
                const assignments = userAssignments(u, branchById);
                const primary = userPrimaryAssignment(u, branchById);
                return (
                  <div key={u.username} className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="grid gap-4 xl:grid-cols-[.85fr_1fr_1.15fr_.75fr_1.35fr_.8fr_1fr_auto] xl:items-center">
                      <div><div className="text-xs font-bold uppercase text-slate-500">Usuario</div><div className="font-black text-white">{u.username}</div></div>
                      <div><div className="text-xs font-bold uppercase text-slate-500">Nombre</div><div>{u.display_name}</div></div>
                      <div className="flex items-center gap-3">
                        <EmployeePhoto username={u.username} name={employeeFullName(u.employee, u.display_name)} hasPhoto={!!u.employee?.photo_url} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold uppercase text-slate-500">Empleado</div>
                          <div className="truncate font-bold text-white">{employeeFullName(u.employee, u.display_name)}</div>
                          <div className="text-xs text-slate-400">DNI: {u.employee?.dni || 'pendiente'} · {u.employee?.position || 'Sin puesto'}</div>
                          <div className="mt-1 text-xs text-slate-500">{photoStatusLabel(u.employee?.photo_status)}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase text-slate-500">Roles</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {userRoleKeys(u).map((role) => <span key={role} className={`rounded-lg px-2 py-1 text-xs font-bold ${role === u.role ? 'bg-blue-500/15 text-blue-200' : 'bg-slate-900 text-slate-300'}`}>{roleLabel(roles, role)}</span>)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase text-slate-500">Alcance</div>
                        {assignments.length ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {assignments.map((branch) => <span key={branch.id} className={`rounded-full border px-2 py-1 text-xs ${branch.is_primary ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-slate-700 text-slate-300'}`}>{branch.name}{branch.is_primary ? ' · principal' : ''}</span>)}
                          </div>
                        ) : (
                          <div className="text-sm text-amber-200">{u.sucursal ? `Sin vincular · anterior: ${u.sucursal}` : 'Sucursal sin vincular'}</div>
                        )}
                        {primary?.company_name && <div className="mt-1 text-xs text-slate-500">{primary.company_name} · {branchTypeLabel(primary.type)}</div>}
                      </div>
                      <div><div className="text-xs font-bold uppercase text-slate-500">Estado</div><div className={u.is_active ? 'text-green-300' : 'text-red-300'}>{u.is_active ? 'Activo' : 'Bloqueado'} · {u.must_change_password ? 'Debe crear clave' : 'Clave OK'}</div></div>
                      <div><div className="text-xs font-bold uppercase text-slate-500">Último movimiento</div><div className="text-sm text-slate-300">{u.last_movement_at ? `${u.last_movement || '-'} · ${new Date(u.last_movement_at).toLocaleString()}` : 'Sin movimientos'}</div></div>
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <button onClick={() => photoAction(u, 'request')} className="rounded-lg border border-blue-600/60 px-3 py-2 text-blue-200">Pedir foto</button>
                        <button disabled={!u.employee?.photo_url} onClick={() => photoAction(u, 'approve')} className="rounded-lg border border-green-600/60 px-3 py-2 text-green-200 disabled:cursor-not-allowed disabled:opacity-40">Aprobar foto</button>
                        <button disabled={!u.employee?.photo_url} onClick={() => photoAction(u, 'reject')} className="rounded-lg border border-orange-600/60 px-3 py-2 text-orange-200 disabled:cursor-not-allowed disabled:opacity-40">Rechazar foto</button>
                        <button onClick={() => edit(u)} className="rounded-lg border border-slate-700 px-3 py-2">Editar</button>
                        <button onClick={() => copyAccess(u)} className="rounded-lg border border-blue-600/60 px-3 py-2 text-blue-200">Copiar acceso</button>
                        <button disabled={isSelf} onClick={() => toggle(u)} className="rounded-lg border border-slate-700 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">{u.is_active ? 'Bloquear' : 'Activar'}</button>
                        <button disabled={isSelf} onClick={() => resetPassword(u)} className="rounded-lg border border-yellow-600/60 px-3 py-2 text-yellow-200 disabled:cursor-not-allowed disabled:opacity-40">Blanquear</button>
                        <button disabled={isSelf} onClick={() => remove(u)} className="rounded-lg border border-red-600/60 px-3 py-2 text-red-200 disabled:cursor-not-allowed disabled:opacity-40">Eliminar</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${danger ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-800 bg-slate-950/60'}`}><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>;
}
