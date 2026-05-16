import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchNotifications, fetchNotificationSummary, markAllNotificationsRead, markNotificationRead } from '../api/client';
import type { NotificationInfo, NotificationSummary } from '../types';

const priorityLabels: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  critical: 'Crítica',
};

const priorityClasses: Record<string, string> = {
  low: 'border-slate-700 bg-slate-800/50 text-slate-200',
  normal: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
  high: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
  critical: 'border-red-500/50 bg-red-500/10 text-red-100',
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-4xl">🔔</div>
            <h1 className="mt-2 text-3xl font-black">Centro de notificaciones</h1>
            <p className="mt-1 max-w-3xl text-slate-400">
              Bandeja unificada para ventas, precios/costos, garantías, remitos, proveedor y sistema. Esta fase prepara la base para push nativo en Android.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[340px]">
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-3">
              <div className="text-xs font-bold uppercase text-blue-200/80">No leídas</div>
              <div className="mt-1 text-2xl font-black text-white">{summary?.unread_total ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="text-xs font-bold uppercase text-amber-200/80">Alta prioridad</div>
              <div className="mt-1 text-2xl font-black text-white">{summary?.unread_high_priority ?? '—'}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setReadStatus('unread')} className={`rounded-xl px-4 py-2 text-sm font-bold ${readStatus === 'unread' ? 'bg-blue-500 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>Pendientes</button>
            <button onClick={() => setReadStatus('all')} className={`rounded-xl px-4 py-2 text-sm font-bold ${readStatus === 'all' ? 'bg-blue-500 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>Todas</button>
            <button onClick={() => setReadStatus('read')} className={`rounded-xl px-4 py-2 text-sm font-bold ${readStatus === 'read' ? 'bg-blue-500 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>Leídas</button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100">
              <option value="">Todos los módulos</option>
              {Object.entries(moduleOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100">
              <option value="">Todas las prioridades</option>
              <option value="critical">Crítica</option>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baja</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={enableBrowserNotifications} className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100">Activar avisos del navegador</button>
          <button onClick={readAll} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold hover:bg-slate-800">Marcar visibles como leídas</button>
          <button onClick={load} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold hover:bg-slate-800">Actualizar</button>
          <span className="text-xs text-slate-500">Permiso Chrome: {permission}</span>
        </div>
      </div>

      {summary && Object.keys(summary.unread_by_module).length > 0 && (
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Object.entries(summary.unread_by_module).map(([moduleKey, count]) => (
            <button key={moduleKey} onClick={() => setModuleFilter(moduleKey)} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left hover:bg-slate-800/80">
              <div className="text-xs font-bold uppercase text-slate-500">{summary.modules[moduleKey] || moduleKey}</div>
              <div className="mt-1 text-2xl font-black text-white">{count}</div>
            </button>
          ))}
        </div>
      )}

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
      {loading && <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-slate-300">Cargando notificaciones...</div>}

      <div className="space-y-3">
        {items.map((item) => {
          const href = notificationLink(item);
          const priority = item.priority || 'normal';
          return (
            <div key={item.id} className={`rounded-2xl border p-4 ${priorityClasses[priority] || priorityClasses.normal}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-black uppercase tracking-wide">{item.module_label || item.module || 'General'}</span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-black uppercase tracking-wide">{priorityLabels[priority] || priority}</span>
                    {item.branch_name && <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-bold text-slate-200">{item.branch_name}</span>}
                  </div>
                  <div className="mt-2 font-black text-white">{item.title}</div>
                  <div className="mt-1 text-sm text-slate-200/90">{item.message}</div>
                  <div className="mt-2 text-xs text-slate-400">
                    {new Date(item.created_at).toLocaleString('es-AR')}
                    {item.event_type && <span> · {item.event_type}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {href && <Link to={href} className="rounded-lg border border-slate-600 bg-slate-950/40 px-3 py-2 text-xs font-bold hover:bg-slate-900">Abrir</Link>}
                  {!item.read && <button onClick={() => read(item.id)} className="rounded-lg border border-green-500/40 px-3 py-2 text-xs font-bold text-green-100 hover:bg-green-500/10">Marcar leída</button>}
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && !loading && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No hay notificaciones para los filtros seleccionados.</div>}
      </div>
    </div>
  );
}
