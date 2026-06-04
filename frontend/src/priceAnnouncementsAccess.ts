import { can } from './api/client';
import type { CurrentUser } from './types';

const ANNOUNCEMENT_ROLES = new Set(['SUPERADMIN', 'GERENTE', 'GERENTE_COMERCIAL', 'ADMINISTRADOR', 'ADMIN']);

export function canUsePriceAnnouncements(user: CurrentUser | null): boolean {
  if (!user || user.must_change_password) return false;
  if (can('price_announcements.generate') || can('price_announcements.view')) return true;
  return (user.roles || [user.role]).some((role) => ANNOUNCEMENT_ROLES.has(String(role || '').toUpperCase()));
}
