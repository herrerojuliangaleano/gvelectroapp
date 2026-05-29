import { can } from './api/client';
import type { BranchInfo, CurrentUser } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Acceso a sucursales — TODO se decide por permiso, NO por rol.
//
// Permisos relevantes (definidos en el backend / roles.json):
//   - branches.cross_select  → puede seleccionar/operar sucursales a las que
//                              NO está asignado (perfil multi-sucursal o
//                              supervisor). Sin este permiso, sólo ve y opera
//                              su(s) sucursal(es) asignada(s).
//   - warranties.manage       → privilegio global (también levanta el filtro
//   warranties.manage_provider  por sucursal asignada).
//   warranties.dashboard
//   warranties.export
//   warranties.review
//   warranties.gestor.panel
//
// Wildcard '*' = override total (superadmin).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El usuario tiene permiso explícito para seleccionar sucursales fuera de su
 * asignación. Si tiene cualquier permiso global de gestión, también levanta
 * el filtro (un gestor por definición ve todas las sucursales).
 */
export function canCrossSelectBranches(user?: CurrentUser | null): boolean {
  if (!user) return false;
  if (user.permissions?.includes('*')) return true;
  return (
    can('branches.cross_select') ||
    can('warranties.manage') ||
    can('warranties.manage_provider') ||
    can('warranties.dashboard') ||
    can('warranties.export') ||
    can('warranties.review') ||
    can('warranties.gestor.panel')
  );
}

/** IDs de sucursales asignadas al usuario (incluyendo la principal). */
export function getAssignedBranchIds(user?: CurrentUser | null): string[] {
  if (!user) return [];
  const ids = new Set<string>();
  if (user.branch_id) ids.add(String(user.branch_id));
  for (const branch of user.branches || []) {
    if (branch.id) ids.add(String(branch.id));
  }
  return Array.from(ids);
}

/** Nombres normalizados (mayúsculas, sin tildes) de las sucursales asignadas. */
export function getAssignedBranchNames(user?: CurrentUser | null): string[] {
  if (!user) return [];
  const names = new Set<string>();
  function normalize(value?: string | null) {
    return (value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toUpperCase();
  }
  const direct = normalize(user.branch_name || user.sucursal);
  if (direct) names.add(direct);
  for (const branch of user.branches || []) {
    const n = normalize(branch.name);
    if (n) names.add(n);
  }
  return Array.from(names);
}

/**
 * Indica si una sucursal está dentro del scope operativo del usuario.
 * Si el usuario tiene `canCrossSelectBranches`, retorna true para cualquier
 * sucursal. Si no, sólo true para las asignadas.
 */
export function isBranchInScope(user: CurrentUser | null | undefined, branch: { id?: string | number | null; name?: string | null }): boolean {
  if (!user) return false;
  if (canCrossSelectBranches(user)) return true;
  const ids = getAssignedBranchIds(user);
  const names = getAssignedBranchNames(user);
  const norm = (value?: string | null) => (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const branchName = norm(branch.name);
  const branchId = branch.id != null ? String(branch.id) : '';
  if (branchId && ids.includes(branchId)) return true;
  if (branchName && names.includes(branchName)) return true;
  return false;
}

/**
 * Filtra una lista de sucursales al scope del usuario. Si tiene
 * `branches.cross_select` retorna la lista entera; si no, sólo las asignadas.
 *
 * Útil para construir selects de sucursal:
 *   <Select options={getBranchOptionsForUser(user, allBranches)} />
 */
export function getBranchOptionsForUser<T extends Pick<BranchInfo, 'id' | 'name'>>(
  user: CurrentUser | null | undefined,
  all: T[],
): T[] {
  if (!user) return [];
  if (canCrossSelectBranches(user)) return all;
  return all.filter((b) => isBranchInScope(user, b));
}

/**
 * `true` si el usuario está restringido a una única sucursal (no tiene
 * cross-select ni más de una asignada). Útil para decidir si mostrar un select
 * o un readonly del nombre.
 */
export function isLockedToSingleBranch(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  if (canCrossSelectBranches(user)) return false;
  const ids = getAssignedBranchIds(user);
  return ids.length === 1;
}
