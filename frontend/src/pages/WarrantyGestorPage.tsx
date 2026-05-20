import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Clock,
  MapPin, Package, RefreshCw, ShieldCheck, Truck, Wrench, XCircle,
} from 'lucide-react';
import { can, fetchWarranties } from '../api/client';
import type { WarrantySummary, WarrantyListResponse } from '../types';
import {
  computeLogisticsAlerts, flowToneClass, getWarrantyStatusMeta, getReviewStatusMeta,
  alertPriorityClass, type LogisticsAlert,
} from '../warrantyFlow';

// ─── helpers ─────────────────────────────────────────────────────────────────

const FINAL_ESTADOS = new Set(['10 - FINALIZADO', '9 - ANULADA', '8 - RECHAZADO']);

function priorityDot(priority: LogisticsAlert['priority']) {
  if (priority === 'high')   return 'bg-red-400';
  if (priority === 'medium') return 'bg-amber-400';
  return 'bg-slate-500';
}

function BandejaBadge({ count, priority = 'base' }: { count: number; priority?: 'base' | 'warn' | 'danger' | 'ok' }) {
  const cls =
    priority === 'danger' ? 'border-red-500/50 bg-red-500/15 text-red-100' :
    priority === 'warn'   ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' :
    priority === 'ok'     ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' :
    'border-slate-600 bg-slate-800 text-slate-200';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${cls}`}>{count}</span>
  );
}

function SectionHeader({ title, icon, count, priority = 'base' }: {
  title: string; icon: ReactNode; count: number; priority?: 'base' | 'warn' | 'danger' | 'ok';
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <span className="text-slate-400">{icon}</span>
      <span className="font-black text-slate-100">{title}</span>
      <BandejaBadge count={count} priority={priority} />
    </div>
  );
}

function GestorCard({ item }: { item: WarrantySummary }) {
  const alerts = computeLogisticsAlerts(item);
  const topAlert = alerts.find((a) => a.targetRole !== 'posventa') || alerts[0];
  const statusMeta = getWarrantyStatusMeta(item.estado);
  const reviewMeta = getReviewStatusMeta(item.review_status);

  return (
    <div className={`rounded-2xl border p-4 ${topAlert?.priority === 'high' ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700 bg-slate-950/60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* ID + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
            className="font-mono text-lg font-black text-white hover:text-blue-200"
          >
            {item.id_garantia}
          </Link>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${flowToneClass(statusMeta.tone)}`}>
            {statusMeta.shortLabel}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${flowToneClass(reviewMeta.tone)}`}>
            {item.review_status_label || reviewMeta.label}
          </span>
        </div>
        {/* Days badge */}
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">
          <Clock size={11} className="mr-1 inline" />{item.dias_pendiente ?? 0}d
        </span>
      </div>

      {/* Product + meta */}
      <div className="mt-2 text-slate-200 font-semibold">{item.producto_principal || 'Sin producto'}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
        {item.sucursal && <span><span className="text-slate-500">Sucursal:</span> {item.sucursal}</span>}
        {item.provider_name && <span><span className="text-slate-500">Proveedor:</span> {item.provider_name}</span>}
        {item.marca && <span><span className="text-slate-500">Marca:</span> {item.marca}</span>}
        {item.serie && <span><span className="text-slate-500">Serie:</span> {item.serie}</span>}
      </div>

      {/* Location */}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
        <MapPin size={12} className="shrink-0 text-slate-500" />
        <span>{item.ubicacion_actual_label || item.ubicacion_actual || (item.transit_status === 'en_transito' ? 'En tránsito' : '—')}</span>
        {item.transit_status === 'en_transito' && (
          <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">En tránsito</span>
        )}
        {item.transit_status === 'en_deposito' && (
          <span className="ml-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">En depósito</span>
        )}
      </div>

      {/* Alerts */}
      {alerts.filter((a) => a.targetRole !== 'posventa').length > 0 && (
        <div className="mt-3 space-y-1.5">
          {alerts.filter((a) => a.targetRole !== 'posventa').map((alert, idx) => (
            <div key={idx} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${alertPriorityClass(alert.priority)}`}>
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${priorityDot(alert.priority)}`} />
              <div className="min-w-0 flex-1">
                <div>{alert.message}</div>
                <div className="mt-0.5 font-normal opacity-75">→ {alert.action}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-bold text-blue-200 hover:bg-blue-500/10"
        >
          <ArrowRight size={13} /> Ver detalle
        </Link>
        {(item.review_status === 'pendiente_revision' || item.review_status === 'en_revision') && can('warranties.review') && (
          <Link
            to={`/warranties/revision`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-bold text-violet-200 hover:bg-violet-500/10"
          >
            <ClipboardCheck size={13} /> Ir a revisión
          </Link>
        )}
        {(item.transit_status === 'en_transito' || item.origen_ingreso === 'sucursal') && can('warranties.remitos.view') && (
          <Link
            to="/warranties/remitos"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/10"
          >
            <Truck size={13} /> Remitos
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function WarrantyGestorPage() {
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<string>('revision');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await fetchWarranties({ limit: 500 });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el panel del gestor');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const allActive = useMemo(
    () => (data?.items || []).filter((item) => !FINAL_ESTADOS.has(item.estado || '') && !item.cancelled),
    [data],
  );

  // ── Bandejas ──────────────────────────────────────────────────────────────
  const pendingReview = useMemo(
    () => allActive.filter((item) => !item.review_status || item.review_status === 'pendiente_revision' || item.review_status === 'en_revision'),
    [allActive],
  );
  const needsCorrection = useMemo(
    () => allActive.filter((item) => item.review_status === 'requiere_correccion'),
    [allActive],
  );
  const readyForPosventa = useMemo(
    () => allActive.filter((item) => item.review_status === 'revisada' && item.estado === '1 - INGRESO'),
    [allActive],
  );
  const inTransit = useMemo(
    () => allActive.filter((item) => item.transit_status === 'en_transito'),
    [allActive],
  );
  const logisticsAlerts = useMemo(
    () => allActive.filter((item) => {
      const alerts = computeLogisticsAlerts(item);
      return alerts.some((a) => a.targetRole !== 'posventa');
    }),
    [allActive],
  );
  const pickupRequested = useMemo(
    () => allActive.filter((item) => item.estado_retiro_proveedor === 'retiro_solicitado'),
    [allActive],
  );

  const TABS = [
    { id: 'revision',     label: 'Revisión pendiente',  count: pendingReview.length,    priority: 'base'   as const, items: pendingReview },
    { id: 'correccion',   label: 'Requieren corrección', count: needsCorrection.length,  priority: 'warn'   as const, items: needsCorrection },
    { id: 'posventa',     label: 'Listas para Posventa', count: readyForPosventa.length, priority: 'ok'     as const, items: readyForPosventa },
    { id: 'transito',     label: 'En tránsito',          count: inTransit.length,        priority: 'warn'   as const, items: inTransit },
    { id: 'logistica',    label: 'Alertas logísticas',   count: logisticsAlerts.length,  priority: logisticsAlerts.some((i) => computeLogisticsAlerts(i).some((a) => a.priority === 'high' && a.targetRole !== 'posventa')) ? 'danger' as const : 'warn' as const, items: logisticsAlerts },
    { id: 'retiro',       label: 'Retiro solicitado',    count: pickupRequested.length,  priority: pickupRequested.length > 0 ? 'danger' as const : 'base' as const, items: pickupRequested },
  ];

  const activeTabData = TABS.find((t) => t.id === activeTab) || TABS[0];

  const totalAlerts = needsCorrection.length + pickupRequested.length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-violet-100">
            <Wrench size={13} /> Panel interno — Gestor de Garantías
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Mesa de trabajo</h1>
          <p className="mt-1 text-slate-400">Control interno, revisión, logística y preparación para Posventa.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900">
          <RefreshCw size={18} /> Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>
      )}

      {/* KPI summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-2xl border p-4 text-left transition-all ${
              activeTab === tab.id ? 'ring-2 ring-blue-500/60' :
              tab.priority === 'danger' ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10' :
              tab.priority === 'warn'   ? 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10' :
              tab.priority === 'ok'     ? 'border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10' :
              'border-slate-700 bg-slate-950/50 hover:bg-slate-900'
            }`}
          >
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{tab.label}</div>
            <div className={`mt-1 text-3xl font-black ${
              tab.priority === 'danger' ? 'text-red-300' :
              tab.priority === 'warn'   ? 'text-amber-300' :
              tab.priority === 'ok'     ? 'text-emerald-300' : 'text-white'
            }`}>{tab.count}</div>
          </button>
        ))}
      </div>

      {/* Alerts summary */}
      {totalAlerts > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm font-bold text-red-100">
          <AlertTriangle size={18} className="shrink-0 text-red-400" />
          {totalAlerts === 1
            ? 'Hay 1 caso que requiere atención urgente.'
            : `Hay ${totalAlerts} casos que requieren atención urgente.`}
        </div>
      )}

      {/* Active tab content */}
      <div>
        <SectionHeader
          title={activeTabData.label}
          icon={
            activeTab === 'revision'   ? <ClipboardCheck size={18} /> :
            activeTab === 'correccion' ? <XCircle size={18} /> :
            activeTab === 'posventa'   ? <CheckCircle2 size={18} /> :
            activeTab === 'transito'   ? <Truck size={18} /> :
            activeTab === 'retiro'     ? <AlertTriangle size={18} /> :
            <ShieldCheck size={18} />
          }
          count={activeTabData.count}
          priority={activeTabData.priority}
        />

        {loading && (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-6 text-center text-slate-400">
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-blue-400" />
            Cargando garantías...
          </div>
        )}

        {!loading && activeTabData.items.length === 0 && (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-6 text-center">
            <Package size={32} className="mx-auto mb-2 text-slate-600" />
            <div className="font-bold text-slate-400">Sin casos en esta bandeja.</div>
          </div>
        )}

        {!loading && activeTabData.items.length > 0 && (
          <div className="mt-3 space-y-3">
            {activeTabData.items
              .sort((a, b) => {
                // High-priority alerts first, then by days descending
                const aHigh = computeLogisticsAlerts(a).some((al) => al.priority === 'high' && al.targetRole !== 'posventa');
                const bHigh = computeLogisticsAlerts(b).some((al) => al.priority === 'high' && al.targetRole !== 'posventa');
                if (aHigh && !bHigh) return -1;
                if (!aHigh && bHigh) return 1;
                return Number(b.dias_pendiente || 0) - Number(a.dias_pendiente || 0);
              })
              .map((item) => (
                <GestorCard key={item.id_garantia} item={item} />
              ))}
          </div>
        )}
      </div>

      {/* Link to review page */}
      {can('warranties.review') && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
          También podés usar la{' '}
          <Link to="/warranties/revision" className="font-bold text-blue-300 hover:text-blue-200">
            Bandeja de revisión
          </Link>{' '}
          para acciones rápidas en masa sobre el proceso de revisión interna.
        </div>
      )}
    </div>
  );
}
