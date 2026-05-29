import { Bell, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CurrentUser, SystemPublicStatus } from '../types';

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || name[0]?.toUpperCase() || '?';
}

function syncState(status: SystemPublicStatus | null): { className: string; label: string } {
  if (!status) return { className: 'erp-sync is-err', label: 'Sin conexión' };
  if (status.available) return { className: 'erp-sync is-ok', label: 'Backend OK' };
  if (status.mode === 'maintenance') return { className: 'erp-sync is-sync', label: 'Mantenimiento' };
  return { className: 'erp-sync', label: 'Cerrado' };
}

export function Topbar({
  user,
  status,
  unread,
  canSeeNotifications,
  branchLabel,
}: {
  user: CurrentUser | null;
  status: SystemPublicStatus | null;
  unread: number;
  canSeeNotifications: boolean;
  branchLabel: string;
}) {
  const navigate = useNavigate();
  const sync = syncState(status);

  return (
    <header className="erp-topbar hidden lg:flex" role="banner">
      <div className="erp-topbar-search" role="search">
        <Search size={15} className="erp-topbar-search-icon" aria-hidden="true" />
        <input
          type="search"
          placeholder="Buscar en el sistema..."
          aria-label="Buscar"
          // En esta fase la búsqueda no está cableada; queda visual.
          onKeyDown={(event) => { if (event.key === 'Escape') (event.currentTarget as HTMLInputElement).blur(); }}
        />
        <span className="erp-topbar-kbd" aria-hidden="true">⌘K</span>
      </div>

      <div className="erp-topbar-spacer" />

      {branchLabel && (
        <button type="button" className="erp-topbar-pill" title={branchLabel} onClick={() => navigate('/me')}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--primary)' }} aria-hidden="true" />
          <span className="truncate max-w-[180px]">{branchLabel}</span>
        </button>
      )}

      <span className={sync.className} aria-live="polite">
        <span className="erp-sync-dot" aria-hidden="true" />
        <span>{sync.label}</span>
      </span>

      <button type="button" className="erp-topbar-icon-btn" aria-label="Sincronizar" title="Sincronizar" onClick={() => window.location.reload()}>
        <RefreshCw size={16} />
      </button>

      {canSeeNotifications && (
        <button
          type="button"
          className="erp-topbar-icon-btn"
          aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
          title="Notificaciones"
          onClick={() => navigate('/notificaciones')}
        >
          <Bell size={16} />
          {unread > 0 ? (
            <span className="erp-topbar-badge">{unread > 99 ? '99+' : unread}</span>
          ) : (
            <span className="erp-topbar-dot" aria-hidden="true" style={{ display: 'none' }} />
          )}
        </button>
      )}

      <button type="button" className="erp-topbar-avatar" aria-label="Mi usuario" title={user?.display_name || user?.username || 'Usuario'} onClick={() => navigate('/me')}>
        {initials(user?.display_name || user?.username || '?')}
      </button>
    </header>
  );
}
