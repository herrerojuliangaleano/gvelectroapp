import type { CurrentUser } from './types';
import { can } from './api/client';

const PRIVILEGED_ROLES = new Set(['SUPERADMIN', 'GERENTE', 'ADMINISTRADOR', 'ADMIN', 'GESTOR', 'GESTOR_GARANTIAS', 'JEFE_POSVENTA']);

export function roleKeys(user: CurrentUser | null | undefined): string[] {
  if (!user) return [];
  const values = [user.role, ...(user.roles || [])];
  return Array.from(new Set(values.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean)));
}

export function isPlainDepositOperator(user: CurrentUser | null | undefined): boolean {
  const roles = roleKeys(user);
  return roles.includes('DEPOSITO') && !roles.some((r) => PRIVILEGED_ROLES.has(r));
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

export function canUseBranchDispatch(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.remitos.dispatch');
}

export function canUseRemitosHub(user: CurrentUser | null | undefined): boolean {
  return can('warranties.remitos.view') || can('warranties.remitos.generate') || can('warranties.remitos.receive') || can('warranties.remitos.deposit_transfer');
}

export function canSeeDepositReceivePage(user: CurrentUser | null | undefined): boolean {
  return isPlainDepositOperator(user) && canUseRemitosHub(user);
}

export function canGenerateProviderDelivery(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && can('warranties.remitos.provider_delivery');
}

export function isGestorGarantias(user: CurrentUser | null | undefined): boolean {
  const roles = roleKeys(user);
  return roles.includes('GESTOR_GARANTIAS') || roles.includes('GESTOR');
}

export function isJefePosventa(user: CurrentUser | null | undefined): boolean {
  return roleKeys(user).includes('JEFE_POSVENTA');
}

export function isEncargadoSucursal(user: CurrentUser | null | undefined): boolean {
  return roleKeys(user).includes('ENCARGADO_SUCURSAL');
}

export function canSeeGestorPanel(user: CurrentUser | null | undefined): boolean {
  return !isPlainDepositOperator(user) && (can('warranties.gestor.panel') || can('warranties.manage'));
}

export function canSeeSucursalLogistics(user: CurrentUser | null | undefined): boolean {
  return can('warranties.sucursal.logistics');
}

export function canSeeRemitoTracking(user: CurrentUser | null | undefined): boolean {
  return can('warranties.remitos.view');
}
