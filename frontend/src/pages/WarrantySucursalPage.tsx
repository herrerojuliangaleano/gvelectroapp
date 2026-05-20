import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock,
  MapPin, Package, RefreshCw, Send, Truck,
} from 'lucide-react';
import { can, fetchWarranties, getCurrentUserFromStorage } from '../api/client';
import type { WarrantySummary, WarrantyListResponse } from '../types';
import { computeLogisticsAlerts } from '../warrantyFlow';

// ─── helpers ─────────────────────────────────────────────────────────────────

const FINAL_ESTADOS = new Set(['10 - FINALIZADO', '9 - ANULADA', '8 - RECHAZADO']);

function SucursalCard({ item }: { item: WarrantySummary }) {
  const alerts = computeLogisticsAlerts(item).filter((a) => a.targetRole === 'encargado' || a.targetRole === 'all');
  const isUrgent = item.estado_retiro_proveedor === 'retiro_solicitado';

  return (
    <div className={`rounded-2xl border p-4 ${
      isUrgent
        ? 'border-red-500/40 bg-red-500/5'
        : item.transit_status === 'en_transito'
        ? 'border-amber-500/25 bg-amber-500/5'
        : 'border-slate-700 bg-slate-950/60'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
            className="font-mono text-lg font-black text-white hover:text-blue-200"
          >
            {item.id_garantia}
          </Link>
          {isUrgent && (
            <span className="rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-black text-red-200">
              ⚠ Retiro solicitado
            </span>
          )}
          {item.transit_status === 'en_transito' && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-200">
              <Truck size={11} className="mr-1 inline" />En tránsito
            </span>
          )}
          {item.transit_status === 'en_deposito' && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-200">
              <CheckCircle2 size={11} className="mr-1 inline" />Llegó a depósito
            </span>
          )}
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-400">
          <Clock size={11} className="mr-1 inline" />{item.dias_pendiente ?? 0}d
        </span>
      </div>

      {/* Product */}
      <div className="mt-2 font-semibold text-slate-100">{item.producto_principal || 'Sin producto'}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
        {item.marca && <span><span className="text-slate-500">Marca:</span> {item.marca}</span>}
        {item.sku && <span><span className="text-slate-500">SKU:</span> {item.sku}</span>}
        {item.serie && <span><span className="text-slate-500">Serie:</span> {item.serie}</span>}
      </div>

      {/* Location */}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
        <MapPin size={12} className="shrink-0 text-slate-500" />
        <span>{item.ubicacion_actual_label || item.ubicacion_actual || 'En sucursal'}</span>
      </div>

      {/* Remito info — solo para usuarios con permiso de remitos */}
      {(can('warranties.remitos.view') || can('warranties.remitos.generate') || can('warranties.remitos.dispatch')) && item.remito_interno && (
        <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-1.5 font-mono text-xs text-slate-300">
          REM: {item.remito_interno}
        </div>
      )}

      {/* Alerts for encargado */}
      {alerts.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
                alert.priority === 'high' ? 'border-red-500/50 bg-red-500/10 text-red-100' : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
              }`}
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <div>
                <div>{alert.message}</div>
                <div className="mt-0.5 font-normal opacity-75">→ {alert.action}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800"
        >
          <ArrowRight size={13} /> Ver detalle
        </Link>
        {item.transit_status !== 'en_transito' && item.transit_status !== 'en_deposito' && (
          <Link
            to="/warranties/despacho"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/10"
          >
            <Send size={13} /> Despachar a depósito
          </Link>
        )}
        {item.transit_status === 'en_transito' && (
          <Link
            to="/warranties/remitos"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/10"
          >
            <Truck size={13} /> Ver remito
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function WarrantySucursalPage() {
  const currentUser = getCurrentUserFromStorage();
  const branchName = currentUser?.branch_name || currentUser?.sucursal || '';

  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'pending' | 'transito' | 'done'>('pending');

  async function load() {
    setLoading(true);
    setError('');
    try {
      // Backend auto-filters to user's branch for non-privileged users
      const result = await fetchWarranties({ limit: 300 });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar las garantías de tu sucursal');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const items = useMemo(() => data?.items || [], [data]);

  // Necesitan ir al depósito (en sucursal, sin remito activo, no finalizadas)
  const needsDispatch = useMemo(
    () => items.filter((item) =>
      !FINAL_ESTADOS.has(item.estado || '') &&
      !item.cancelled &&
      item.transit_status !== 'en_transito' &&
      item.transit_status !== 'en_deposito' &&
      item.ubicacion_actual !== 'deposito' &&
      item.ubicacion_actual !== 'proveedor' &&
      item.ubicacion_actual !== 'en_transito_proveedor'
    ),
    [items],
  );

  // En tránsito (remito despachado, esperando confirmación)
  const inTransit = useMemo(
    () => items.filter((item) => item.transit_status === 'en_transito'),
    [items],
  );

  // Llegaron a depósito (confirmado)
  const arrived = useMemo(
    () => items.filter((item) => item.transit_status === 'en_deposito'),
    [items],
  );

  const urgentCount = useMemo(
    () => needsDispatch.filter((item) => item.estado_retiro_proveedor === 'retiro_solicitado').length,
    [needsDispatch],
  );

  const TABS = [
    { id: 'pending' as const, label: 'Necesitan ir al depósito', count: needsDispatch.length, items: needsDispatch },
    { id: 'transito' as const, label: 'En tránsito',             count: inTransit.length,    items: inTransit },
    { id: 'done'    as const, label: 'Llegaron al depósito',     count: arrived.length,      items: arrived },
  ];

  const activeItems = TABS.find((t) => t.id === activeTab)?.items || [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-100">
            <Send size={13} /> Logística de Sucursal
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">
            {branchName ? `Garantías — ${branchName}` : 'Mis garantías'}
          </h1>
          <p className="mt-1 text-slate-400">
            Equipos que deben despacharse al depósito, en tránsito y recibidos.
          </p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900">
          <RefreshCw size={18} /> Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>
      )}

      {/* Urgency banner */}
      {urgentCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100">
          <AlertTriangle size={18} className="shrink-0 text-red-400" />
          {urgentCount === 1
            ? '1 caso URGENTE: el proveedor solicitó retiro. Despachar a depósito lo antes posible.'
            : `${urgentCount} casos URGENTES: el proveedor solicitó retiro. Despachar a depósito lo antes posible.`}
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all ${
              activeTab === tab.id
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                : 'border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            {tab.label}
            <span className={`rounded-full border px-1.5 py-0.5 text-xs font-black ${
              activeTab === tab.id ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {loading && (
        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-6 text-center text-slate-400">
          <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
          Cargando garantías...
        </div>
      )}

      {!loading && activeItems.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center">
          <Package size={36} className="mx-auto mb-3 text-slate-600" />
          <div className="font-bold text-slate-400">
            {activeTab === 'pending' ? 'No hay equipos pendientes de despacho.' :
             activeTab === 'transito' ? 'No hay remitos en tránsito actualmente.' :
             'No hay recepciones confirmadas recientemente.'}
          </div>
        </div>
      )}

      {!loading && activeItems.length > 0 && (
        <div className="space-y-3">
          {activeItems
            .sort((a, b) => {
              // Urgentes primero
              const aU = a.estado_retiro_proveedor === 'retiro_solicitado' ? 1 : 0;
              const bU = b.estado_retiro_proveedor === 'retiro_solicitado' ? 1 : 0;
              if (aU !== bU) return bU - aU;
              return Number(b.dias_pendiente || 0) - Number(a.dias_pendiente || 0);
            })
            .map((item) => (
              <SucursalCard key={item.id_garantia} item={item} />
            ))}
        </div>
      )}

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/warranties/despacho"
          className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm font-bold text-amber-100 hover:bg-amber-500/10"
        >
          <Send size={20} className="shrink-0 text-amber-400" />
          <div>
            <div>Despachar a Chiclana</div>
            <div className="text-xs font-normal text-slate-400">Generar remito interno desde tu sucursal</div>
          </div>
          <ArrowRight size={16} className="ml-auto text-amber-400" />
        </Link>
        <Link
          to="/warranties/remitos"
          className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm font-bold text-slate-100 hover:bg-slate-900"
        >
          <Truck size={20} className="shrink-0 text-slate-400" />
          <div>
            <div>Ver remitos</div>
            <div className="text-xs font-normal text-slate-400">Estado y seguimiento de todos tus remitos</div>
          </div>
          <ArrowRight size={16} className="ml-auto text-slate-500" />
        </Link>
      </div>
    </div>
  );
}
