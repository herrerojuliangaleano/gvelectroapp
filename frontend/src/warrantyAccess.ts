import type { CurrentUser } from './types';
import { can } from './api/client';

const PRIVILEGED_ROLES = new Set(['SUPERADMIN', 'GERENTE', 'ADMINISTRADOR', 'ADMIN', 'GESTOR', 'GESTOR_GARANTIAS', 'JEFE_POSVENTA']);

export function roleKeys(user: CurrentUser | null | undefined): string[] {
  if (!user) return [];
  const values = [user.role, ...(user.roles || [])];
  return Array.from(new Set(values.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean)));
}

/**
 * Encargado de Depósito (rol DEPOSITO).
 * Solo ve /warranties/deposito: recibe remitos y mueve entre depósitos.
 * Queda excluido de todas las pantallas de gestión/listados.
 */
export function isPlainDepositOperator(user: CurrentUser | null | undefined): boolean {
  const roles = roleKeys(user);
  return roles.includes('DEPOSITO') && !roles.some((r) => PRIVILEGED_ROLES.has(r));
}

/**
 * Cadete de Depósito (rol CADETE_DEPOSITO).
 * Ve su lista de garantías (como vendedor) + puede confirmar llegada de remitos.
 * NO es "plain deposit operator" — no se lo redirige ni se lo bloquea del listado.
 */
export function isCadeteDeposito(user: CurrentUser | null | undefined): boolean {
  const roles = roleKeys(user);
  return roles.includes('CADETE_DEPOSITO') && !roles.some((r) => PRIVILEGED_ROLES.has(r));
}

export function isWarrantyPrivilegedUser(user: CurrentUser | null | undefined): boolean {
  const roles = roleKeys(user);
  return roles.some((r) => PRIVILEGED_ROLES.has(r)) || can('warranties.manage_provider') || can('warranties.export') || can('warranties.review');
}

export function isBranchWarrantyOperator(user: CurrentUser | null | undefined): boolean {
  if (!user || isPlainDepositOperator(user) || isWarrantyPrivilegedUser(user)) return false;
  const branchType = String(user.branch_type || '').toLowerCase();
  const roles = roleKeys(user);
  return branchType === 'physical' || roles.includes('VENDEDOR') || roles.includes('VENDEDOR_WEB') || roles.includes('VENTA_WEB');
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
 * Solo usuarios que NO son depósito puro y tienen alguno de esos permisos.
 */
export function canUseRemitosHub(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && !isCadeteDeposito(user)
    && (can('warranties.remitos.deposit_transfer') || can('warranties.remitos.provider_delivery'));
}

/**
 * Acceso a la página /warranties/deposito (WarrantyDepositReceivePage).
 * - Encargado de Depósito (DEPOSITO): recibe remitos + mueve entre depósitos.
 * - Cadete de Depósito (CADETE_DEPOSITO): solo confirma llegada de remitos.
 */
export function canSeeDepositReceivePage(user: CurrentUser | null | undefined): boolean {
  if (isPlainDepositOperator(user)) {
    return can('warranties.remitos.receive') || can('warranties.remitos.deposit_transfer');
  }
  if (isCadeteDeposito(user)) {
    return can('warranties.remitos.receive');
  }
  return false;
}

export function canSeeGestorPanel(user: CurrentUser | null | undefined): boolean {
  // Gestor panel absorbs revision panel — users with warranties.review access also land here
  return !isPlainDepositOperator(user) && !isCadeteDeposito(user)
    && (can('warranties.gestor.panel') || can('warranties.manage') || can('warranties.review'));
}

export function canSeeSucursalLogistics(user: CurrentUser | null | undefined): boolean {
  return can('warranties.sucursal.logistics');
}

export function canSeeRemitoTracking(user: CurrentUser | null | undefined): boolean {
  // Cadete y depósito puro no ven el historial global de remitos
  if (isPlainDepositOperator(user) || isCadeteDeposito(user)) return false;
  return can('warranties.remitos.view');
}
