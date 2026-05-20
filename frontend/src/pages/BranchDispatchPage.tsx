import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock,
  FileText, Package, Plus, RefreshCw, Send, Truck, X,
} from 'lucide-react';
import {
  can,
  getCurrentUserFromStorage,
  dispatchRemito,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForRemito,
  fetchRemitos,
  fetchWarrantyOptions,
  generateRemitos,
} from '../api/client';
import type { AvailableWarrantyForRemito, WarrantyRemitoInfo, WarrantyOptions } from '../types';

// ── permission helpers ────────────────────────────────────────────────────────

const canDispatch = () => can('warranties.remitos.dispatch');
const canGenerate = () => can('warranties.remitos.generate');

// ── helpers ───────────────────────────────────────────────────────────────────

function centralDepositName(options: WarrantyOptions | null): string {
  const cfg = options?.warranty_central_deposit?.name?.trim();
  if (cfg) return cfg;
  const byChiclana = (options?.branches_operativas ?? []).find(
    (b) => b.type === 'deposit' && `${b.code} ${b.name}`.toLowerCase().includes('chiclana'),
  );
  if (byChiclana?.name) return byChiclana.name;
  return (options?.depositos ?? []).find((d) => d.toLowerCase().includes('chiclana')) ?? 'Depósito Chiclana';
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

type Tab = 'pendiente' | 'en_transito' | 'llegado';

// ── main page ─────────────────────────────────────────────────────────────────

export function BranchDispatchPage() {
  const currentUser  = getCurrentUserFromStorage();
  const branchName   = (currentUser?.branch_name || currentUser?.sucursal || '').trim();
  const isPhysical   = (currentUser?.branch_type || '').toLowerCase() !== 'deposit';
  const autoSucursal = isPhysical ? branchName : '';

  const [options, setOptions]   = useState<WarrantyOptions | null>(null);
  const [remitos, setRemitos]   = useState<WarrantyRemitoInfo[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('pendiente');

  // Generate panel
  const [showGen, setShowGen]             = useState(false);
  const [available, setAvailable]         = useState<AvailableWarrantyForRemito[]>([]);
  const [availLoading, setAvailLoading]   = useState(false);
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [genNota, setGenNota]             = useState('');
  const [genLoading, setGenLoading]       = useState(false);
  const [genError, setGenError]           = useState('');
  const [lastGenerated, setLastGenerated] = useState<WarrantyRemitoInfo[]>([]);

  // Dispatch per remito
  const [dispLoading, setDispLoading] = useState<Record<string, boolean>>({});
  const [dispError, setDispError]     = useState<Record<string, string>>({});

  async function loadRemitos(suc: string) {
    if (!suc.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await fetchRemitos({ origen_sucursal: suc.trim(), limit: 200 });
      setRemitos(res?.items ?? []);
    } catch (e: unknown) {
      setError((e as Error).message || 'No se pudieron cargar los remitos');
      setRemitos([]);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    fetchWarrantyOptions().then(setOptions).catch(() => {});
    if (autoSucursal) loadRemitos(autoSucursal);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAvailable() {
    const suc = autoSucursal;
    if (!suc) return;
    setAvailLoading(true); setSelected(new Set());
    try {
      const res = await fetchAvailableWarrantiesForRemito(suc);
      setAvailable(res?.items ?? []);
    } catch { setAvailable([]); }
    finally { setAvailLoading(false); }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const destino = centralDepositName(options);
    if (!destino) { setGenError('No se encontró el depósito destino.'); return; }
    if (selected.size === 0) { setGenError('Seleccioná al menos una garantía.'); return; }
    setGenLoading(true); setGenError('');
    try {
      const res = await generateRemitos({
        destino_deposito: destino,
        warranty_codes: Array.from(selected),
        nota: genNota.trim() || undefined,
      });
      setLastGenerated(res.remitos);
      setSelected(new Set()); setAvailable([]); setGenNota(''); setShowGen(false);
      await loadRemitos(autoSucursal);
      setActiveTab('pendiente');
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
      setActiveTab('en_transito');
    } catch (e: unknown) {
      setDispError((p) => ({ ...p, [remito.remito_code]: (e as Error).message || 'Error al despachar' }));
    } finally {
      setDispLoading((p) => ({ ...p, [remito.remito_code]: false }));
    }
  }

  const pendientes  = useMemo(() => remitos.filter((r) => r.status === 'pendiente'),  [remitos]);
  const enTransito  = useMemo(() => remitos.filter((r) => r.status === 'en_transito'), [remitos]);
  const llegados    = useMemo(() => remitos.filter((r) => r.status === 'llegado'),     [remitos]);

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'pendiente',   label: 'Pendientes de despacho', count: pendientes.length },
    { id: 'en_transito', label: 'En tránsito',             count: enTransito.length },
    { id: 'llegado',     label: 'Llegaron',                count: llegados.length },
  ];
  const activeItems = activeTab === 'pendiente' ? pendientes : activeTab === 'en_transito' ? enTransito : llegados;

  const destino = centralDepositName(options);

  return (
    <div className="mx-auto max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-100">
            <Send size={13} /> Despacho a depósito
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">
            {autoSucursal ? `Despacho — ${autoSucursal}` : 'Despacho a depósito'}
          </h1>
          <p className="mt-1 text-slate-400">
            Generá remitos internos e indicá la salida del bulto hacia {destino || 'Depósito Chiclana'}.
          </p>
        </div>
        <div className="flex gap-2">
          {canGenerate() && autoSucursal && (
            <button
              onClick={() => { setShowGen((v) => !v); if (!showGen) loadAvailable(); }}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 font-bold transition-all ${
                showGen
                  ? 'border-slate-600 bg-slate-800 text-slate-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
              }`}
            >
              {showGen ? <X size={16} /> : <Plus size={16} />}
              {showGen ? 'Cancelar' : 'Nuevo remito'}
            </button>
          )}
          <button
            onClick={() => loadRemitos(autoSucursal)}
            disabled={loading || !autoSucursal}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 font-bold text-slate-100 hover:bg-slate-900 disabled:opacity-40"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* Sin sucursal asignada */}
      {!autoSucursal && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-amber-400" />
          <div className="font-bold text-amber-200">Tu usuario no tiene una sucursal física asignada.</div>
          <div className="mt-1 text-sm text-slate-400">Para despachar garantías, tu cuenta debe estar vinculada a una sucursal operativa (no depósito).</div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
          <AlertTriangle size={16} className="shrink-0" />{error}
        </div>
      )}

      {/* Panel generar remito */}
      {showGen && canGenerate() && autoSucursal && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Send size={18} className="text-emerald-400" />
            <h2 className="text-base font-black text-emerald-200">Nuevo remito interno</h2>
          </div>

          {/* Destino fijo */}
          <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm">
            <span><span className="text-slate-500">Origen:</span> <span className="font-bold text-slate-200">{autoSucursal}</span></span>
            <span className="text-slate-600">→</span>
            <span><span className="text-slate-500">Destino:</span> <span className="font-bold text-emerald-200">{destino}</span></span>
          </div>

          {/* Lista de garantías disponibles */}
          {availLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
              <RefreshCw size={14} className="animate-spin" /> Cargando garantías disponibles...
            </div>
          )}
          {!availLoading && available.length === 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 py-8 text-center">
              <Package size={28} className="mx-auto mb-2 text-slate-600" />
              <p className="text-sm text-slate-400">No hay garantías disponibles para remito en <strong className="text-slate-300">{autoSucursal}</strong>.</p>
              <p className="mt-1 text-xs text-slate-500">Las garantías aparecen cuando están en la sucursal y no tienen remito activo.</p>
            </div>
          )}
          {!availLoading && available.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-xl border border-slate-700">
              {/* Cabecera con selección total */}
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
                    : `${available.length} garantías disponibles`}
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
                      onChange={() => setSelected((p) => { const n = new Set(p); n.has(w.warranty_code) ? n.delete(w.warranty_code) : n.add(w.warranty_code); return n; })}
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

          {/* Nota + botón */}
          <form onSubmit={handleGenerate} className="space-y-3">
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="Nota opcional: viaje del miércoles, bulto 2..."
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
                {selected.size > 0 ? `Generar remito (${selected.size} garantías)` : 'Generar remito'}
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

      {/* Remitos recién generados */}
      {lastGenerated.length > 0 && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
              <CheckCircle2 size={16} />
              {lastGenerated.length === 1 ? 'Remito generado' : `${lastGenerated.length} remitos generados`} — descargá el PDF para acompañar el envío
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

      {/* Tabs + lista */}
      {autoSucursal && (
        <>
          <div className="flex flex-wrap gap-2">
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

          {loading && (
            <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
              <span className="text-slate-400">Cargando remitos...</span>
            </div>
          )}

          {!loading && activeItems.length === 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-950/60 py-10 text-center">
              <Truck size={32} className="mx-auto mb-3 text-slate-600" />
              <div className="font-bold text-slate-400">
                {activeTab === 'pendiente' ? 'No hay remitos pendientes de despacho.' :
                 activeTab === 'en_transito' ? 'No hay remitos en tránsito.' :
                 'Todavía no llegó ningún remito al depósito.'}
              </div>
              {activeTab === 'pendiente' && canGenerate() && (
                <button
                  onClick={() => { setShowGen(true); loadAvailable(); }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20"
                >
                  <Plus size={15} /> Generar primer remito
                </button>
              )}
            </div>
          )}

          {!loading && activeItems.length > 0 && (
            <div className="space-y-3">
              {activeItems.map((r) => (
                <RemitoCard
                  key={r.remito_code}
                  remito={r}
                  canDoDispatch={canDispatch() && r.status === 'pendiente'}
                  dispatching={dispLoading[r.remito_code] ?? false}
                  dispatchErr={dispError[r.remito_code] ?? ''}
                  onDispatch={() => handleDispatch(r)}
                  onDownload={() => downloadPdf(r.remito_code)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/warranties/sucursal"
          className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm font-bold text-slate-100 hover:bg-slate-900"
        >
          <Send size={20} className="shrink-0 text-amber-400" />
          <div>
            <div>Logística de mi sucursal</div>
            <div className="text-xs font-normal text-slate-400">Equipos pendientes, en tránsito y recibidos</div>
          </div>
          <ArrowRight size={16} className="ml-auto text-slate-500" />
        </Link>
        <Link
          to="/warranties/remitos"
          className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm font-bold text-slate-100 hover:bg-slate-900"
        >
          <Truck size={20} className="shrink-0 text-slate-400" />
          <div>
            <div>Ver todos mis remitos</div>
            <div className="text-xs font-normal text-slate-400">Seguimiento completo con timers</div>
          </div>
          <ArrowRight size={16} className="ml-auto text-slate-500" />
        </Link>
      </div>
    </div>
  );
}

// ── RemitoCard ────────────────────────────────────────────────────────────────

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
  const isTransit  = remito.status === 'en_transito';
  const isArrived  = remito.status === 'llegado';

  return (
    <div className={`rounded-2xl border p-4 ${
      isArrived  ? 'border-emerald-500/25 bg-emerald-500/5' :
      isTransit  ? 'border-amber-500/25 bg-amber-500/5' :
      'border-slate-700 bg-slate-950/60'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-black text-white">{remito.remito_code}</span>
            <StatusBadge status={remito.status} />
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {remito.warranties_count} producto{remito.warranties_count !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
            <span><span className="text-slate-500">Destino:</span> {remito.destino_deposito}</span>
            {remito.created_at_display && (
              <span><span className="text-slate-500">Creado:</span> {remito.created_at_display}</span>
            )}
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
              {dispatching
                ? <RefreshCw size={13} className="animate-spin" />
                : <Send size={13} />}
              {dispatching ? 'Despachando...' : 'Marcar salida'}
            </button>
          )}
        </div>
      </div>

      {/* Lista de garantías */}
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

function StatusBadge({ status }: { status: WarrantyRemitoInfo['status'] }) {
  if (status === 'llegado')
    return <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-300">LLEGÓ AL DEPÓSITO</span>;
  if (status === 'en_transito')
    return <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-300">EN TRÁNSITO</span>;
  return <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-bold text-blue-300">PENDIENTE</span>;
}
