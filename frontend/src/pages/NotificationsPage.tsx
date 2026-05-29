import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, Check, RefreshCw } from 'lucide-react';
import { fetchNotifications, fetchNotificationSummary, markAllNotificationsRead, markNotificationRead } from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpField,
  ErpKpiCard,
  ErpLoadingState,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  ErpTabBar,
  type ErpBadgeTone,
  type ErpTabDef,
} from '../components/ProUI';
import type { NotificationInfo, NotificationSummary } from '../types';

const priorityLabels: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  critical: 'Crítica',
};

const priorityTone: Record<string, ErpBadgeTone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  critical: 'solid-danger',
};

function notificationLink(item: NotificationInfo): string | null {
  if (item.link_url) return item.link_url;
  if (item.sales_request_id) return `/venta/${item.sales_request_id}`;
  if (item.entity_type === 'warranty' && item.entity_id) return `/warranties/${item.entity_id}`;
  if (item.module === 'warranties') return '/warranties/gestion';
  if (item.module === 'remitos') return '/warranties/remitos';
  if (item.module === 'price_cost') return '/precios-costos';
  return null;
}

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationInfo[]>([]);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [readStatus, setReadStatus] = useState<'unread' | 'all' | 'read'>('unread');
  const [moduleFilter, setModuleFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  const moduleOptions = useMemo(() => summary?.modules || {}, [summary]);

  async function load() {
    setLoading(true);
    try {
      const [nextSummary, nextItems] = await Promise.all([
        fetchNotificationSummary().catch(() => null),
        fetchNotifications({
          readStatus,
          module: moduleFilter || undefined,
          priority: priorityFilter || undefined,
          limit: 100,
        }),
      ]);
      setSummary(nextSummary);
      setItems(nextItems);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar notificaciones');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const h = window.setInterval(load, 10000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(h); window.removeEventListener('focus', onFocus); };
  }, [readStatus, moduleFilter, priorityFilter]);

  async function enableBrowserNotifications() {
    if (typeof Notification === 'undefined') {
      setError('Este navegador no soporta notificaciones.');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      new Notification('Notificaciones activadas', { body: 'Vas a recibir avisos mientras la app esté abierta.' });
    }
  }

  async function read(id: number) {
    await markNotificationRead(id);
    setItems((current) => current.filter((item) => item.id !== id));
    fetchNotificationSummary().then(setSummary).catch(() => undefined);
  }

  async function readAll() {
    await markAllNotificationsRead(moduleFilter || undefined);
    load();
  }

  const tabs: ErpTabDef[] = [
    { key: 'unread', label: 'Pendientes', count: summary?.unread_total },
    { key: 'all', label: 'Todas' },
    { key: 'read', label: 'Leídas' },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Centro de notificaciones"
        description="Bandeja unificada para ventas, precios y costos, garantías, remitos, proveedor y sistema."
        actions={
          <>
            <ErpButton variant="secondary" leftIcon={<RefreshCw size={14} />} onClick={load}>Actualizar</ErpButton>
            <ErpButton variant="primary" leftIcon={<Check size={14} />} onClick={readAll}>Marcar visibles como leídas</ErpButton>
          </>
        }
      />

      <section className="erp-kpi-row" aria-label="Resumen de notificaciones">
        <ErpKpiCard
          label="No leídas"
          value={summary?.unread_total ?? '—'}
          detail="Total pendientes de revisar"
          variant={(summary?.unread_total ?? 0) > 0 ? 'alert' : 'default'}
          icon={<Bell size={13} />}
        />
        <ErpKpiCard
          label="Alta prioridad"
          value={summary?.unread_high_priority ?? '—'}
          detail="Críticas + altas sin leer"
          variant={(summary?.unread_high_priority ?? 0) > 0 ? 'danger' : 'default'}
          icon={<BellRing size={13} />}
        />
        <ErpKpiCard
          label="Permiso del navegador"
          value={permission === 'granted' ? 'Activado' : permission === 'denied' ? 'Bloqueado' : 'Pendiente'}
          detail={permission === 'granted' ? 'Vas a recibir avisos del navegador' : 'Activá para recibir avisos cuando la app no esté visible'}
          variant={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'default'}
        />
        <ErpKpiCard
          label="Módulos con avisos"
          value={Object.keys(summary?.unread_by_module || {}).length}
          detail="Categorías con eventos sin leer"
        />
      </section>

      {permission !== 'granted' && permission !== 'denied' && permission !== 'unsupported' && (
        <ErpNotice
          tone="info"
          title="Activá los avisos del navegador"
          actions={<ErpButton variant="primary" size="sm" onClick={enableBrowserNotifications}>Activar ahora</ErpButton>}
        >
          Te avisa cuando llegan notificaciones nuevas aunque la pestaña esté en segundo plano.
        </ErpNotice>
      )}

      <ErpCard
        title="Filtros"
        subtitle="Acotá la lista por estado, módulo o prioridad"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <ErpTabBar tabs={tabs} active={readStatus} onChange={(key) => setReadStatus(key as 'unread' | 'all' | 'read')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:w-[480px]">
            <ErpField label="Módulo">
              <ErpSelect value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                <option value="">Todos los módulos</option>
                {Object.entries(moduleOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </ErpSelect>
            </ErpField>
            <ErpField label="Prioridad">
              <ErpSelect value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                <option value="">Todas las prioridades</option>
                <option value="critical">Crítica</option>
                <option value="high">Alta</option>
                <option value="normal">Normal</option>
                <option value="low">Baja</option>
              </ErpSelect>
            </ErpField>
          </div>
        </div>
      </ErpCard>

      {summary && Object.keys(summary.unread_by_module).length > 0 && (
        <ErpCard title="Sin leer por módulo" subtitle="Click para filtrar la bandeja">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {Object.entries(summary.unread_by_module).map(([moduleKey, count]) => (
              <button
                key={moduleKey}
                type="button"
                onClick={() => setModuleFilter(moduleKey)}
                className={`erp-info-row text-left transition-colors ${moduleFilter === moduleKey ? 'border-[color:var(--primary)]' : ''}`}
              >
                <span className="erp-info-label">{summary.modules[moduleKey] || moduleKey}</span>
                <span className="erp-info-value text-[22px] font-bold tabular-nums leading-none">{count}</span>
              </button>
            ))}
          </div>
        </ErpCard>
      )}

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      {loading && items.length === 0 && <ErpLoadingState />}

      {!loading && items.length === 0 && (
        <ErpEmptyState
          icon={<Bell size={20} />}
          title="No hay notificaciones"
          description="No encontramos avisos que coincidan con los filtros seleccionados."
        />
      )}

      {items.length > 0 && (
        <div className="erp-stack-2">
          {items.map((item) => {
            const href = notificationLink(item);
            const priority = item.priority || 'normal';
            return (
              <ErpCard key={item.id} size="sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 erp-stack-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ErpBadge tone="primary" withDot={false}>{item.module_label || item.module || 'General'}</ErpBadge>
                      <ErpBadge tone={priorityTone[priority] || 'info'}>{priorityLabels[priority] || priority}</ErpBadge>
                      {item.branch_name && <ErpBadge tone="neutral" withDot={false}>{item.branch_name}</ErpBadge>}
                    </div>
                    <div className="text-[13.5px] font-semibold text-[color:var(--text)]">{item.title}</div>
                    <div className="text-[12.5px] leading-[1.5] text-[color:var(--text-2)]">{item.message}</div>
                    <div className="text-[11.5px] text-[color:var(--text-3)] tabular-nums">
                      {new Date(item.created_at).toLocaleString('es-AR')}
                      {item.event_type && <span> · {item.event_type}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {href && (
                      <Link to={href} className="erp-btn erp-btn-secondary erp-btn-sm">Abrir</Link>
                    )}
                    {!item.read && (
                      <ErpButton size="sm" variant="ghost" leftIcon={<Check size={13} />} onClick={() => read(item.id)}>
                        Marcar leída
                      </ErpButton>
                    )}
                  </div>
                </div>
              </ErpCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
