import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock,
  FileText, MapPin, Package, Plus, RefreshCw, Send, Truck, X,
} from 'lucide-react';
import {
  can,
  dispatchRemito,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForRemito,
  fetchRemitos,
  fetchWarranties,
  fetchWarrantyOptions,
  generateRemitos,
  getCurrentUserFromStorage,
} from '../api/client';
import type {
  AvailableWarrantyForRemito,
  WarrantyListResponse,
  WarrantyOptions,
  WarrantyRemitoInfo,
  WarrantySummary,
} from '../types';
import { computeLogisticsAlerts } from '../warrantyFlow';

// ─── constants ────────────────────────────────────────────────────────────────

const FINAL_ESTADOS = new Set(['10 - FINALIZADO', '9 - ANULADA', '8 - RECHAZADO']);

// ─── helpers ─────────────────────────────────────────────────────────────────

function centralDepositName(options: WarrantyOptions | null): string {
  const cfg = options?.warranty_central_deposit?.name?.trim();
  if (cfg) return cfg;
  const byChiclana = (options?.branches_operativas ?? []).find(
    (b) => b.type === 'deposit' && `${b.code} ${b.name}`.toLowerCase().includes('chiclana'),
  );
  if (byChiclana?.name) return byChiclana.name;
  return (options?.depositos ?? []).find((d) => d.toLowerCase().includes('chiclana')) ?? 'Deposito Chiclana';
}

async function downloadPdf(code: string) {
  try {
    const blob = await downloadRemitoPdf(code);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${code}.pdf`; a.click();
    URL.revokeObjectURL(url);
  } catch (e: unknown) {
    alert((e as Error).message || 'Error al descargar PDF');
  }
}

// ─── sub-components ────────────────────────────────────────────────────────────

function RemitoStatusBadge({ status }: { status: WarrantyRemitoInfo['status'] }) {
  if (status === 'llegado')
    return <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-300">LLEGO AL DEPOSITO</span>;
  if (status === 'en_transito')
    return <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-300">EN TRANSITO</span>;
  return <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-bold text-blue-300">PENDIENTE</span>;
}

function RemitoCard({
  remito, canDoDispatch, dispatching, dispatchErr, onDispatch, onDownload,
}: {
  remito: WarrantyRemitoInfo;
  canDoDispatch: boolean;
  dispatching: boolean;
  dispatchErr: string;
  onDispatch: () => void;
  onDownload: () => void;
}) {
  const isTransit = remito.status === 'en_transito';
  const isArrived = remito.status === 'llegado';

  return (
    <div className={`rounded-2xl border p-4 ${
      isArrived ? 'border-emerald-500/25 bg-emerald-500/5' :
      isTransit ? 'border-amber-500/25 bg-amber-500/5' :
      'border-slate-700 bg-slate-950/60'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-black text-white">{remito.remito_code}</span>
            <RemitoStatusBadge status={remito.status} />
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {remito.warranties_count} producto{remito.warranties_count !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
            <span><span className="text-slate-500">Destino:</span> {remito.destino_deposito}</span>
            {remito.created_at_display && <span><span className="text-slate-500">Creado:</span> {remito.created_at_display}</span>}
            {remito.fecha_despacho_display && (
              <span>
                <Clock size={11} className="mr-0.5 inline text-amber-400" />
                <span className="text-slate-500">Salida:</span> {remito.fecha_despacho_display}
              </span>
            )}
            {remito.fecha_llegada_display && (
              <span>
                <CheckCircle2 size={11} className="mr-0.5 inline text-emerald-400" />
                <span className="text-slate-500">Llegada:</span> {remito.fecha_llegada_display}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            <FileText size={13} /> PDF
          </button>
          {canDoDispatch && (
            <button
              onClick={onDispatch}
              disabled={dispatching}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {dispatching ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
              {dispatching ? 'Despachando...' : 'Marcar salida'}
            </button>
          )}
        </div>
      </div>

      {(remito.warranties ?? []).length > 0 && (
        <div className="mt-3 space-y-1 border-t border-slate-800 pt-3">
          {remito.warranties!.map((w) => (
            <div key={w.warranty_code} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-slate-300">{w.warranty_code}</span>
              <span className="text-slate-600">·</span>
              <span>{w.producto || '—'}</span>
              {w.serie && <span className="text-slate-500">Serie: {w.serie}</span>}
            </div>
          ))}
        </div>
      )}

      {dispatchErr && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
          <AlertTriangle size={13} className="shrink-0" />{dispatchErr}
        </div>
      )}
    </div>
  );
}

function SucursalCard({ item, onOpenGenerate }: { item: WarrantySummary; onOpenGenerate: () => void }) {
  const alerts = computeLogisticsAlerts(item).filter((a) => a.targetRole === 'encargado' || a.targetRole === 'all');
  const isUrgent = item.estado_retiro_proveedor === 'retiro_solicitado';
  const canGenerateRemito = can('warranties.remitos.generate') || can('warranties.remitos.dispatch');

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
              Retiro solicitado
            </span>
          )}
          {item.transit_status === 'en_transito' && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-200">
              <Truck size={11} className="mr-1 inline" />En transito
            </span>
          )}
          {item.transit_status === 'en_deposito' && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-200">
              <CheckCircle2 size={11} className="mr-1 inline" />Llego a deposito
            </span>
          )}
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-400">
          <Clock size={11} className="mr-1 inline" />{item.dias_pendiente ?? 0}d
        </span>
      </div>

      <div className="mt-2 font-semibold text-slate-100">{item.producto_principal || 'Sin producto'}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
        {item.marca && <span><span className="text-slate-500">Marca:</span> {item.marca}</span>}
        {item.sku && <span><span className="text-slate-500">SKU:</span> {item.sku}</span>}
        {item.serie && <span><span className="text-slate-500">Serie:</span> {item.serie}</span>}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
        <MapPin size={12} className="shrink-0 text-slate-500" />
        <span>{item.ubicacion_actual_label || item.ubicacion_actual || 'En sucursal'}</span>
      </div>

      {(can('warranties.remitos.view') || can('warranties.remitos.generate') || can('warranties.remitos.dispatch')) && item.remito_interno && (
        <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-1.5 font-mono text-xs text-slate-300">
          REM: {item.remito_interno}
        </div>
      )}

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

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800"
        >
          <ArrowRight size={13} /> Ver detalle
        </Link>
        {item.transit_status !== 'en_transito' && item.transit_status !== 'en_deposito' && canGenerateRemito && (
          <button
            onClick={onOpenGenerate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/10"
          >
            <Send size={13} /> Generar remito
          </button>
        )}
        {item.transit_status === 'en_transito' && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-400/70">
            <Truck size={13} /> Remito activo (ver abajo)
          </span>
        )}
      </div>
    </div>
  );
}

// ─── types ────────────────────────────────────────────────────────────────────

type RemitoTabId = 'pendiente' | 'en_transito' | 'llegado';

// ─── main page ────────────────────────────────────────────────────────────────

export function WarrantySucursalPage() {
  const currentUser  = getCurrentUserFromStorage();
  const branchName   = (currentUser?.branch_name || currentUser?.sucursal || '').trim();
  const autoSucursal = branchName;

  // ── warranty list state ──
  const [data, setData]         = useState<WarrantyListResponse | null>(null);
  const [loadingW, setLoadingW] = useState(true);
  const [errorW, setErrorW]     = useState('');
  const [wTab, setWTab]         = useState<'pending' | 'transito' | 'done'>('pending');

  // ── remito state ──
  const [options, setOptions]             = useState<WarrantyOptions | null>(null);
  const [remitos, setRemitos]             = useState<WarrantyRemitoInfo[]>([]);
  const [loadingR, setLoadingR]           = useState(false);
  const [errorR, setErrorR]               = useState('');
  const [remitoTab, setRemitoTab]         = useState<RemitoTabId>('pendiente');
  const [showGen, setShowGen]             = useState(false);
  const [available, setAvailable]         = useState<AvailableWarrantyForRemito[]>([]);
  const [availLoading, setAvailLoading]   = useState(false);
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [genNota, setGenNota]             = useState('');
  const [genLoading, setGenLoading]       = useState(false);
  const [genError, setGenError]           = useState('');
  const [lastGenerated, setLastGenerated] = useState<WarrantyRemitoInfo[]>([]);
  const [dispLoading, setDispLoading]     = useState<Record<string, boolean>>({});
  const [dispError, setDispError]         = useState<Record<string, string>>({});

  const remitosRef = useRef<HTMLDivElement>(null);

  const canUseRemitos = can('warranties.remitos.generate') || can('warranties.remitos.dispatch') || can('warranties.remitos.view');

  async function loadWarranties() {
    setLoadingW(true);
    setErrorW('');
    try {
      const result = await fetchWarranties({ limit: 300 });
      setData(result);
    } catch (err) {
      setErrorW(err instanceof Error ? err.message : 'No se pudo cargar las garantias de tu sucursal');
    } finally {
      setLoadingW(false);
    }
  }

  async function loadRemitosList() {
    if (!autoSucursal) return;
    setLoadingR(true); setErrorR('');
    try {
      const res = await fetchRemitos({ origen_sucursal: autoSucursal, limit: 200 });
      setRemitos(res?.items ?? []);
    } catch (e: unknown) {
      setErrorR((e as Error).message || 'No se pudieron cargar los remitos');
      setRemitos([]);
    } finally { setLoadingR(false); }
  }

  async function loadAvailable() {
    if (!autoSucursal) return;
    setAvailLoading(true); setSelected(new Set());
    try {
      const res = await fetchAvailableWarrantiesForRemito(autoSucursal);
      setAvailable(res?.items ?? []);
    } catch { setAvailable([]); }
    finally { setAvailLoading(false); }
  }

  useEffect(() => {
    loadWarranties();
    if (autoSucursal) {
      fetchWarrantyOptions().then(setOptions).catch(() => {});
      if (canUseRemitos) loadRemitosList();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openGenerate() {
    setShowGen(true);
    loadAvailable();
    setTimeout(() => {
      remitosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const destino = centralDepositName(options);
    if (!destino) { setGenError('No se encontro el deposito destino.'); return; }
    if (selected.size === 0) { setGenError('Selecciona al menos una garantia.'); return; }
    setGenLoading(true); setGenError('');
    try {
      const res = await generateRemitos({
        destino_deposito: destino,
        warranty_codes: Array.from(selected),
        nota: genNota.trim() || undefined,
      });
      setLastGenerated(res.remitos);
      setSelected(new Set()); setAvailable([]); setGenNota(''); setShowGen(false);
      await loadRemitosList();
      await loadWarranties();
      setRemitoTab('pendiente');
    } catch (e: unknown) {
      setGenError((e as Error).message || 'Error al generar remito');
    } finally { setGenLoading(false); }
  }

  async function handleDispatch(remito: WarrantyRemitoInfo) {
    setDispLoading((p) => ({ ...p, [remito.remito_code]: true }));
    setDispError((p) => ({ ...p, [remito.remito_code]: '' }));
    try {
      await dispatchRemito(remito.remito_code, { lugar_salida: remito.origen_sucursal });
      setRemitos((prev) =>
        prev.map((r) => r.remito_code === remito.remito_code ? { ...r, status: 'en_transito' } : r),
      );
      setRemitoTab('en_transito');
    } catch (e: unknown) {
      setDispError((p) => ({ ...p, [remito.remito_code]: (e as Error).message || 'Error al despachar' }));
    } finally {
      setDispLoading((p) => ({ ...p, [remito.remito_code]: false }));
    }
  }

  // ── warranty derived state ──
  const items = useMemo(() => data?.items || [], [data]);

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
  const inTransit   = useMemo(() => items.filter((item) => item.transit_status === 'en_transito'), [items]);
  const arrived     = useMemo(() => items.filter((item) => item.transit_status === 'en_deposito'), [items]);
  const urgentCount = useMemo(
    () => needsDispatch.filter((item) => item.estado_retiro_proveedor === 'retiro_solicitado').length,
    [needsDispatch],
  );

  // ── remito derived state ──
  const rPendientes = useMemo(() => remitos.filter((r) => r.status === 'pendiente'), [remitos]);
  const rEnTransito = useMemo(() => remitos.filter((r) => r.status === 'en_transito'), [remitos]);
  const rLlegados   = useMemo(() => remitos.filter((r) => r.status === 'llegado'), [remitos]);

  const destino = centralDepositName(options);

  const WARRANTY_TABS = [
    { id: 'pending'  as const, label: 'Necesitan ir al deposito', count: needsDispatch.length, items: needsDispatch },
    { id: 'transito' as const, label: 'En transito',              count: inTransit.length,    items: inTransit },
    { id: 'done'     as const, label: 'Llegaron al deposito',     count: arrived.length,      items: arrived },
  ];

  const REMITO_TABS: { id: RemitoTabId; label: string; count: number; items: WarrantyRemitoInfo[] }[] = [
    { id: 'pendiente',   label: 'Pendientes de despacho', count: rPendientes.length, items: rPendientes },
    { id: 'en_transito', label: 'En transito',            count: rEnTransito.length, items: rEnTransito },
    { id: 'llegado',     label: 'Llegaron',               count: rLlegados.length,   items: rLlegados },
  ];

  const activeWItems = WARRANTY_TABS.find((t) => t.id === wTab)?.items || [];
  const activeRItems = REMITO_TABS.find((t) => t.id === remitoTab)?.items || [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-100">
            <Send size={13} /> Logistica de Sucursal
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">
            {branchName ? `Garantias — ${branchName}` : 'Mis garantias'}
          </h1>
          <p className="mt-1 text-slate-400">
            Equipos pendientes, remitos en transito y recepciones confirmadas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('warranties.remitos.generate') && autoSucursal && (
            <button
              onClick={openGenerate}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 font-bold text-emerald-200 hover:bg-emerald-500/20"
            >
              <Plus size={16} /> Nuevo remito
            </button>
          )}
          <button
            onClick={() => { loadWarranties(); if (autoSucursal && canUseRemitos) loadRemitosList(); }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 font-bold text-slate-100 hover:bg-slate-900"
          >
            <RefreshCw size={16} className={(loadingW || loadingR) ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {errorW && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{errorW}</div>}

      {urgentCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100">
          <AlertTriangle size={18} className="shrink-0 text-red-400" />
          {urgentCount === 1
            ? '1 caso URGENTE: el proveedor solicito retiro. Despachar a deposito lo antes posible.'
            : `${urgentCount} casos URGENTES: el proveedor solicito retiro. Despachar a deposito lo antes posible.`}
        </div>
      )}

      {/* ── Section 1: Garantias ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Garantias de mi sucursal</h2>

        <div className="flex flex-wrap gap-2">
          {WARRANTY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setWTab(tab.id)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all ${
                wTab === tab.id
                  ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                  : 'border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              {tab.label}
              <span className={`rounded-full border px-1.5 py-0.5 text-xs font-black ${
                wTab === tab.id ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {loadingW && (
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-6 text-center text-slate-400">
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
            Cargando garantias...
          </div>
        )}

        {!loadingW && activeWItems.length === 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center">
            <Package size={36} className="mx-auto mb-3 text-slate-600" />
            <div className="font-bold text-slate-400">
              {wTab === 'pending'  ? 'No hay equipos pendientes de despacho.' :
               wTab === 'transito' ? 'No hay remitos en transito actualmente.' :
               'No hay recepciones confirmadas recientemente.'}
            </div>
            {wTab === 'pending' && can('warranties.remitos.generate') && (
              <button
                onClick={openGenerate}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20"
              >
                <Plus size={15} /> Generar remito
              </button>
            )}
          </div>
        )}

        {!loadingW && activeWItems.length > 0 && (
          <div className="space-y-3">
            {activeWItems
              .sort((a, b) => {
                const aU = a.estado_retiro_proveedor === 'retiro_solicitado' ? 1 : 0;
                const bU = b.estado_retiro_proveedor === 'retiro_solicitado' ? 1 : 0;
                if (aU !== bU) return bU - aU;
                return Number(b.dias_pendiente || 0) - Number(a.dias_pendiente || 0);
              })
              .map((item) => (
                <SucursalCard key={item.id_garantia} item={item} onOpenGenerate={openGenerate} />
              ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Remitos ───────────────────────────────────────────────── */}
      {autoSucursal && canUseRemitos && (
        <section ref={remitosRef} className="space-y-4 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Remitos de mi sucursal</h2>
            {can('warranties.remitos.generate') && (
              <button
                onClick={() => { setShowGen((v) => !v); if (!showGen) loadAvailable(); }}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-all ${
                  showGen
                    ? 'border-slate-600 bg-slate-800 text-slate-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                }`}
              >
                {showGen ? <X size={15} /> : <Plus size={15} />}
                {showGen ? 'Cancelar' : 'Nuevo remito'}
              </button>
            )}
          </div>

          {/* Generate panel */}
          {showGen && can('warranties.remitos.generate') && (
            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Send size={18} className="text-emerald-400" />
                <h3 className="text-base font-black text-emerald-200">Nuevo remito interno</h3>
              </div>
              <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm">
                <span><span className="text-slate-500">Origen:</span> <span className="font-bold text-slate-200">{autoSucursal}</span></span>
                <span className="text-slate-600">→</span>
                <span><span className="text-slate-500">Destino:</span> <span className="font-bold text-emerald-200">{destino}</span></span>
              </div>

              {availLoading && (
                <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                  <RefreshCw size={14} className="animate-spin" /> Cargando garantias disponibles...
                </div>
              )}
              {!availLoading && available.length === 0 && (
                <div className="rounded-xl border border-slate-700 bg-slate-900/60 py-8 text-center">
                  <Package size={28} className="mx-auto mb-2 text-slate-600" />
                  <p className="text-sm text-slate-400">No hay garantias disponibles para remito en <strong className="text-slate-300">{autoSucursal}</strong>.</p>
                  <p className="mt-1 text-xs text-slate-500">Las garantias aparecen cuando estan en la sucursal y no tienen remito activo.</p>
                </div>
              )}
              {!availLoading && available.length > 0 && (
                <div className="mb-4 overflow-hidden rounded-xl border border-slate-700">
                  <div className="flex items-center gap-3 border-b border-slate-700 bg-slate-800/60 px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500"
                      checked={selected.size === available.length && available.length > 0}
                      onChange={() => setSelected(
                        selected.size === available.length ? new Set() : new Set(available.map((w) => w.warranty_code)),
                      )}
                    />
                    <span className="flex-1 text-xs font-semibold text-slate-300">
                      {selected.size > 0
                        ? `${selected.size} de ${available.length} seleccionadas`
                        : `${available.length} garantias disponibles`}
                    </span>
                  </div>
                  <div className="max-h-64 divide-y divide-slate-800 overflow-y-auto">
                    {available.map((w) => (
                      <label
                        key={w.warranty_code}
                        className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-800/50 ${
                          selected.has(w.warranty_code) ? 'bg-emerald-950/30' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-emerald-500"
                          checked={selected.has(w.warranty_code)}
                          onChange={() => setSelected((p) => {
                            const n = new Set(p);
                            n.has(w.warranty_code) ? n.delete(w.warranty_code) : n.add(w.warranty_code);
                            return n;
                          })}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-white">{w.warranty_code}</span>
                            {w.estado && <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300">{w.estado}</span>}
                            {w.marca && <span className="text-[10px] text-slate-500">{w.marca}</span>}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-400">
                            {w.producto || '—'}
                            {w.serie && <span className="ml-2 text-slate-500">Serie: {w.serie}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleGenerate} className="space-y-3">
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  placeholder="Nota opcional: viaje del miercoles, bulto 2..."
                  value={genNota}
                  onChange={(e) => setGenNota(e.target.value)}
                />
                {genError && (
                  <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    <AlertTriangle size={14} className="shrink-0" />{genError}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={genLoading || selected.size === 0}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {genLoading ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                    {selected.size > 0 ? `Generar remito (${selected.size} garantias)` : 'Generar remito'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowGen(false); setAvailable([]); setSelected(new Set()); }}
                    className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Last generated */}
          {lastGenerated.length > 0 && (
            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                  <CheckCircle2 size={16} />
                  {lastGenerated.length === 1 ? 'Remito generado' : `${lastGenerated.length} remitos generados`} — descarga el PDF para acompanar el envio
                </div>
                <button onClick={() => setLastGenerated([])} className="text-slate-500 hover:text-slate-300">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-2">
                {lastGenerated.map((r) => (
                  <div
                    key={r.remito_code}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-slate-900 px-4 py-3"
                  >
                    <div>
                      <span className="font-mono text-base font-black text-white">{r.remito_code}</span>
                      <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-slate-400">
                        <span>{r.warranties_count} producto{r.warranties_count !== 1 ? 's' : ''}</span>
                        <span className="text-slate-600">·</span>
                        <span>{r.origen_sucursal} → {r.destino_deposito}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => downloadPdf(r.remito_code)}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      <FileText size={13} /> PDF
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {errorR && (
            <div className="flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              <AlertTriangle size={16} className="shrink-0" />{errorR}
            </div>
          )}

          {/* Remito tabs */}
          <div className="flex flex-wrap gap-2">
            {REMITO_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRemitoTab(tab.id)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all ${
                  remitoTab === tab.id
                    ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                    : 'border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                {tab.label}
                <span className={`rounded-full border px-1.5 py-0.5 text-xs font-black ${
                  remitoTab === tab.id ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}>{tab.count}</span>
              </button>
            ))}
          </div>

          {loadingR && (
            <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
              <span className="text-slate-400">Cargando remitos...</span>
            </div>
          )}

          {!loadingR && activeRItems.length === 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-950/60 py-10 text-center">
              <Truck size={32} className="mx-auto mb-3 text-slate-600" />
              <div className="font-bold text-slate-400">
                {remitoTab === 'pendiente'   ? 'No hay remitos pendientes de despacho.' :
                 remitoTab === 'en_transito' ? 'No hay remitos en transito.' :
                 'Todavia no llego ningun remito al deposito.'}
              </div>
              {remitoTab === 'pendiente' && can('warranties.remitos.generate') && (
                <button
                  onClick={() => { setShowGen(true); loadAvailable(); }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20"
                >
                  <Plus size={15} /> Generar primer remito
                </button>
              )}
            </div>
          )}

          {!loadingR && activeRItems.length > 0 && (
            <div className="space-y-3">
              {activeRItems.map((r) => (
                <RemitoCard
                  key={r.remito_code}
                  remito={r}
                  canDoDispatch={can('warranties.remitos.dispatch') && r.status === 'pendiente'}
                  dispatching={dispLoading[r.remito_code] ?? false}
                  dispatchErr={dispError[r.remito_code] ?? ''}
                  onDispatch={() => handleDispatch(r)}
                  onDownload={() => downloadPdf(r.remito_code)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Quick link to remitos hub */}
      {can('warranties.remitos.view') && (
        <Link
          to="/warranties/remito-historial"
          className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm font-bold text-slate-100 hover:bg-slate-900"
        >
          <Truck size={20} className="shrink-0 text-slate-400" />
          <div>
            <div>Historial global de remitos</div>
            <div className="text-xs font-normal text-slate-400">Seguimiento completo de todas las sucursales</div>
          </div>
          <ArrowRight size={16} className="ml-auto text-slate-500" />
        </Link>
      )}
    </div>
  );
}
