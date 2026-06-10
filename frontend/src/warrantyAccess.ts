import type { CurrentUser } from './types';
import { can } from './api/client';

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO DE DECISIÓN
//   - "Identidad operativa" (qué pantalla redirige, dónde vive un usuario) = rol.
//     Roles DEPOSITO y CADETE_DEPOSITO definen flujos físicos específicos.
//   - "Capacidad" (¿qué acciones puede hacer?) = SIEMPRE permiso (can('...')).
//     No mirar rol. Si un admin le da el permiso a otro usuario, debe poder hacerlo
//     sin importar su rol.
// ─────────────────────────────────────────────────────────────────────────────

export function roleKeys(user: CurrentUser | null | undefined): string[] {
  if (!user) return [];
  const values = [user.role, ...(user.roles || [])];
  return Array.from(new Set(values.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean)));
}

/**
 * Encargado de Depósito.
 * Identidad operativa: trabaja físicamente en un depósito y solo confirma
 * remitos/movimientos. Se identifica por:
 *   - branch_type='deposit' (fuente principal, decidida por el admin al asignar
 *     la sucursal), o
 *   - rol DEPOSITO (compat fallback).
 *
 * Si el mismo usuario suma permisos de gestión global o `branches.cross_select`,
 * deja de ser "plain" y pasa a ver el resto de la app con los permisos que tenga.
 */
export function isPlainDepositOperator(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  const branchType = String(user.branch_type || '').toLowerCase();
  const isInDeposit = branchType === 'deposit' || roleKeys(user).includes('DEPOSITO');
  if (!isInDeposit) return false;
  // Capacidades que sacan del modo "plain":
  if (
    can('warranties.manage') || can('warranties.manage_provider') || can('warranties.export') ||
    can('warranties.review') || can('warranties.gestor.panel') || can('warranties.dashboard') ||
    can('branches.cross_select')
  ) return false;
  // Si puede crear garantías, es más bien "cadete" — se decide por isCadeteDeposito.
  if (can('warranties.create')) return false;
  return true;
}

/**
 * Cadete de Depósito. Trabaja físicamente en un depósito **y** además carga
 * garantías de clientes que las llevan al depósito. Se identifica por:
 *   - estar en una sucursal de depósito (`branch_type='deposit'` o rol DEPOSITO/
 *     CADETE_DEPOSITO), **y**
 *   - tener permiso `warranties.create`.
 *
 * Si el usuario tiene `branches.cross_select` o permisos de gestión global,
 * deja de clasificar como cadete y opera con sus permisos plenos.
 */
export function isCadeteDeposito(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  const roles = roleKeys(user);
  const branchType = String(user.branch_type || '').toLowerCase();
  const isInDeposit = branchType === 'deposit' || roles.includes('DEPOSITO') || roles.includes('CADETE_DEPOSITO');
  if (!isInDeposit) return false;
  if (
    can('warranties.manage') || can('warranties.manage_provider') || can('warranties.export') ||
    can('warranties.review') || can('warranties.gestor.panel') || can('warranties.dashboard') ||
    can('branches.cross_select')
  ) return false;
  // Para ser "cadete" hace falta poder crear garantías. Sin ese permiso, es
  // un encargado puro (isPlainDepositOperator).
  if (!can('warranties.create')) return false;
  return true;
}

/**
 * Indica si el usuario tiene **capacidad** de gestión global de garantías.
 * Se decide 100% por permisos. Si un admin habilita `warranties.review` a un
 * vendedor, este vendedor pasa a ser "privileged" para este propósito.
 */
export function isWarrantyPrivilegedUser(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  return (
    can('warranties.manage') ||
    can('warranties.manage_provider') ||
    can('warranties.export') ||
    can('warranties.review') ||
    can('warranties.gestor.panel') ||
    can('warranties.dashboard')
  );
}

/**
 * Operador de sucursal: usuario que NO tiene permisos privilegiados de gestión
 * global y trabaja en una sucursal física. Sirve para que las pantallas filtren
 * la vista a su sucursal asignada.
 *
 * Decisión por permisos. Como fallback se acepta branch_type='physical', que es
 * una clasificación operativa real (la sucursal física donde está ese usuario),
 * pero NO se mira el rol.
 */
export function isBranchWarrantyOperator(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  if (isPlainDepositOperator(user)) return false;
  if (isWarrantyPrivilegedUser(user)) return false;
  // Capacidad de operar sucursal: permiso o branch_type físico.
  const branchType = String(user.branch_type || '').toLowerCase();
  return (
    can('warranties.sucursal.logistics') ||
    can('warranties.create') ||
    can('warranties.view') ||
    branchType === 'physical'
  );
}

export function canSeeWarrantyList(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.view');
}

export function canSeeWarrantyDashboard(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.dashboard');
}

export function canSeeWarrantyReview(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.review');
}

export function canSeeWarrantyProviderManagement(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.manage_provider');
}

export function canSeeWarrantyExport(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.export');
}

export function canSeeWarrantySync(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && (can('warranties.sync_to_sheet') || can('warranties.sync_from_sheet') || can('warranties.sync_logs'));
}

export function canSeeWarrantyConfig(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.config');
}

/**
 * Acceso a la página /warranties/remitos.
 * Contiene: Movimiento depósito→depósito (deposit_transfer) y Entrega al proveedor (provider_delivery).
 *
 * Fase 0 roles/permisos: decision 100% por permiso. Antes habia un veto
 * `!isPlainDepositOperator && !isCadeteDeposito` que bloqueaba combos
 * multi-rol validos (ej. DEPOSITO + ENCARGADO_SUCURSAL con el permiso
 * deposit_transfer quedaba afuera por su "identidad" de deposito).
 * La identidad operativa solo decide redirects/landing, nunca capacidad.
 */
export function canUseRemitosHub(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  return can('warranties.remitos.deposit_transfer') || can('warranties.remitos.provider_delivery');
}

/**
 * Acceso a la página /warranties/deposito (WarrantyDepositReceivePage).
 *
 * Decisión 100% por permisos. Si el admin asigna `warranties.remitos.receive` o
 * `warranties.remitos.deposit_transfer` a cualquier rol (incluido Jefe de Posventa,
 * Gestor, Gerente, etc.), ese usuario puede operar la recepción en depósito.
 *
 * Antes esta función solo dejaba pasar a usuarios con identidad operativa
 * DEPOSITO/CADETE_DEPOSITO, lo que era una restricción artificial.
 */
export function canSeeDepositReceivePage(user: CurrentUser | null | undefined): boolean {
  if (!user) return false;
  return can('warranties.remitos.receive') || can('warranties.remitos.deposit_transfer');
}

export function canSeeGestorPanel(user: CurrentUser | null | undefined): boolean {
  // Gestor panel absorbs revision panel — users with warranties.review access also land here.
  // Fase 0 roles/permisos: decision por permiso, sin veto de identidad deposito.
  if (!user) return false;
  return can('warranties.gestor.panel') || can('warranties.manage') || can('warranties.review');
}

export function canSeeSucursalLogistics(user: CurrentUser | null | undefined): boolean {
  return can('warranties.sucursal.logistics');
}

export function canSeeRemitoTracking(user: CurrentUser | null | undefined): boolean {
  // Fase 0 roles/permisos: decision por permiso, sin veto de identidad.
  // El historial global requiere `warranties.remitos.view`, que los roles de
  // deposito no tienen en el catalogo — si el admin se lo da explicitamente,
  // debe funcionar.
  if (!user) return false;
  return can('warranties.remitos.view');
}
