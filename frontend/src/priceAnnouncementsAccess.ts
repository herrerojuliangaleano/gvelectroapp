import { can } from './api/client';
import type { CurrentUser } from './types';

/**
 * Fase 0 roles/permisos: decision 100% por permiso.
 *
 * Antes habia un fallback por nombre de rol (ANNOUNCEMENT_ROLES = SUPERADMIN,
 * GERENTE, ...) que hacia que la pantalla de Roles no reflejara la realidad:
 * un GERENTE accedia aunque el admin le sacara el permiso del rol. Los roles
 * que dependian del fallback recibieron `price_announcements.view/generate`
 * en la tabla `roles` (reparacion de datos 2026-06-10).
 */
export function canUsePriceAnnouncements(user: CurrentUser | null): boolean {
  if (!user || user.must_change_password) return false;
  return can('price_announcements.generate') || can('price_announcements.view');
}
