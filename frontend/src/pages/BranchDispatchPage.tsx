/**
 * Vista de despacho de sucursal.
 *
 * Permite a los vendedores/encargados de sucursal:
 *  - Ver los remitos pendientes de despachar hacia el depósito
 *  - Marcarlos como despachados (en tránsito)
 *  - Ver los que ya están en tránsito esperando confirmación del depósito
 *  - Ver el historial de los que ya llegaron
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  PackageCheck,
  Plus,
  RefreshCw,
  Send,
  Truck,
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

const canDispatch  = () => can('warranties.remitos.dispatch');
const canGenerate  = () => can('warranties.remitos.generate');

function centralWarrantyDepositName(options: WarrantyOptions | null): string {
  const configured = options?.warranty_central_deposit?.name?.trim();
  if (configured && configured.toLowerCase().includes('chiclana')) return configured;
  const branches = options?.branches_operativas ?? [];
  const byChiclana = branches.find((b) => b.type === 'deposit' && `${b.code} ${b.name}`.toLowerCase().includes('chiclana'));
  if (byChiclana?.name) return byChiclana.name;
  const cfgChiclana = options?.depositos?.find((d) => d.toLowerCase().includes('chiclana'));
  return cfgChiclana || 'Depósito Chiclana';
}

// ── helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: WarrantyRemitoInfo['status']) {
  if (status === 'llegado')
    return (
      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
        LLEGÓ AL DEPÓSITO
      </span>
    );
  if (status === 'en_transito')
    return (
      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
        EN TRÁNSITO
      </span>
    );
  return (
    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-300">
      PENDIENTE DE DESPACHO
    </span>
  );
}

async function handleDownloadPdf(remitoCode: string) {
  try {
    const blob = await downloadRemitoPdf(remitoCode);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${remitoCode}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: unknown) {
    alert((e as Error).message || 'Error al descargar PDF');
  }
}

// ── componente principal ──────────────────────────────────────────────────────

export function BranchDispatchPage() {
  const [options, setOptions]         = useState<WarrantyOptions | null>(null);
  const [sucursal, setSucursal]       = useState('');
  const [applied, setApplied]         = useState('');
  const [items, setItems]             = useState<WarrantyRemitoInfo[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  // Por remito: estado de despacho
  const [dispatchLoading, setDispatchLoading] = useState<Record<string, boolean>>({});
  const [dispatchError, setDispatchError]     = useState<Record<string, string>>({});
  const [dispatchOk, setDispatchOk]           = useState<Record<string, boolean>>({});

  // Crear nuevo remito
  const [showCreate, setShowCreate]       = useState(false);
  const [createDestino, setCreateDestino] = useState('');
  const [createNota, setCreateNota]       = useState('');
  const [available, setAvailable]         = useState<AvailableWarrantyForRemito[]>([]);
  const [availLoading, setAvailLoading]   = useState(false);
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError]     = useState('');
  const [lastCreated, setLastCreated]     = useState<WarrantyRemitoInfo[]>([]);

  useEffect(() => {
    const current = getCurrentUserFromStorage();
    const assignedBranch = (current?.branch_name || current?.sucursal || '').trim();
    if (assignedBranch && (current?.branch_type || '').toLowerCase() !== 'deposit') {
      setSucursal(assignedBranch);
      load(assignedBranch);
    }
    fetchWarrantyOptions().then((opts) => {
      setOptions(opts);
      setCreateDestino(centralWarrantyDepositName(opts));
      if (!assignedBranch && opts.sucursales.length === 1) {
        setSucursal(opts.sucursales[0]);
        load(opts.sucursales[0]);
      }
    }).catch(() => {});
  }, []);

  async function load(suc: string) {
    if (!suc.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchRemitos({ origen_sucursal: suc.trim(), limit: 200 } as Parameters<typeof fetchRemitos>[0]);
      setItems(res.items);
      setApplied(suc.trim());
    } catch (e: unknown) {
      setError((e as Error).message || 'Error al cargar remitos');
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailable(suc: string) {
    if (!suc.trim()) return;
    setAvailLoading(true);
    setSelected(new Set());
    try {
      const res = await fetchAvailableWarrantiesForRemito(suc.trim());
      setAvailable(res.items);
    } catch {
      setAvailable([]);
    } finally {
      setAvailLoading(false);
    }
  }

  function toggleSel(code: string) {
    setSelected((p) => { const n = new Set(p); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const destinoFinal = centralWarrantyDepositName(options) || createDestino.trim();
    if (!destinoFinal.trim()) { setCreateError('No se encontró el depósito Chiclana como destino de garantías.'); return; }
    if (selected.size === 0)   { setCreateError('Seleccioná al menos una garantía.'); return; }
    setCreateLoading(true);
    setCreateError('');
    setLastCreated([]);
    try {
      const res = await generateRemitos({
        destino_deposito: destinoFinal.trim(),
        warranty_codes:   Array.from(selected),
        nota:             createNota.trim() || undefined,
      });
      setLastCreated(res.remitos);
      setCreateDestino(centralWarrantyDepositName(options));
      setCreateNota('');
      setSelected(new Set());
      setAvailable([]);
      setShowCreate(false);
      load(sucursal);
    } catch (e: unknown) {
      setCreateError((e as Error).message || 'Error al generar remito');
    } finally {
      setCreateLoading(false);
    }
  }

  async function doDispatch(remito: WarrantyRemitoInfo) {
    setDispatchLoading((p) => ({ ...p, [remito.remito_code]: true }));
    setDispatchError((p) => ({ ...p, [remito.remito_code]: '' }));
    setDispatchOk((p) => ({ ...p, [remito.remito_code]: false }));
    try {
      await dispatchRemito(remito.remito_code, { lugar_salida: remito.origen_sucursal });
      setDispatchOk((p) => ({ ...p, [remito.remito_code]: true }));
      // Actualizar item localmente para no recargar todo
      setItems((prev) =>
        prev.map((r) =>
          r.remito_code === remito.remito_code ? { ...r, status: 'en_transito' } : r,
        ),
      );
    } catch (e: unknown) {
      setDispatchError((p) => ({ ...p, [remito.remito_code]: (e as Error).message || 'Error al despachar' }));
    } finally {
      setDispatchLoading((p) => ({ ...p, [remito.remito_code]: false }));
    }
  }

  const currentUser = getCurrentUserFromStorage();
  const currentBranchType = (currentUser?.branch_type || '').toLowerCase();
  const assignedBranchName = (currentUser?.branch_name || currentUser?.sucursal || '').trim();
  const isAssignedSucursal = Boolean(assignedBranchName && currentBranchType !== 'deposit');

  const sucursales = options?.sucursales ?? [];

  const pendientes = items.filter((r) => r.status === 'pendiente');
  const enTransito = items.filter((r) => r.status === 'en_transito');
  const llegados   = items.filter((r) => r.status === 'llegado');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Send className="h-7 w-7 text-blue-400" />
        <div>
          <h1 className="text-2xl font-black text-white">Despacho a depósito</h1>
          <p className="text-sm text-slate-400">
            Vista rápida para sucursales: generar remitos, imprimir PDF y marcar la salida hacia depósito.
          </p>
        </div>
      </div>

      {/* Selector de sucursal */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <div className="mb-3 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
          Esta pantalla sirve para la operación diaria de la sucursal. El historial completo y la recepción en depósito están en <strong>Garantías → Remitos</strong>.
        </div>
        <label className="mb-1 block text-xs font-semibold text-slate-400">Sucursal de despacho</label>
        <div className="flex gap-2">
          {sucursales.length > 0 ? (
            <select
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
              disabled={isAssignedSucursal}
            >
              <option value="">— Seleccioná tu sucursal —</option>
              {sucursales.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              placeholder="Nombre exacto de tu sucursal, ej: 2 - LANUS"
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
              disabled={isAssignedSucursal}
            />
          )}
          <button
            onClick={() => load(sucursal)}
            disabled={!sucursal.trim() || loading}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {isAssignedSucursal ? 'Actualizar' : 'Ver remitos'}
          </button>
          {isAssignedSucursal && (
            <span className="self-center rounded-full bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300">
              Asignada a tu usuario
            </span>
          )}
          {canGenerate() && sucursal.trim() && applied === sucursal.trim() && (
            <button
              onClick={() => { setShowCreate((v) => !v); if (!showCreate) loadAvailable(sucursal); }}
              className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600"
            >
              <Plus className="h-4 w-4" />
              Crear remito
            </button>
          )}
        </div>
      </section>

      {/* Panel crear remito */}
      {showCreate && canGenerate() && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-emerald-300">
            <Plus className="h-4 w-4" />
            Nuevo remito — elegí qué garantías mandar
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Destino fijo */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400">Destino de garantías</label>
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-100">
                {centralWarrantyDepositName(options)}
                <div className="mt-1 text-xs font-normal text-emerald-200/80">Las sucursales siempre envían garantías a Chiclana.</div>
              </div>
            </div>

            {/* Picker de garantías */}
            {availLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cargando garantías...
              </div>
            )}
            {!availLoading && available.length === 0 && (
              <p className="text-xs text-slate-500">No hay garantías disponibles para remito en <strong className="text-slate-300">{sucursal}</strong>.</p>
            )}
            {!availLoading && available.length > 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-900/60">
                <div className="flex items-center gap-3 border-b border-slate-700 px-3 py-2">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-500"
                    checked={selected.size === available.length && available.length > 0}
                    onChange={() => setSelected(selected.size === available.length ? new Set() : new Set(available.map((w) => w.warranty_code)))} />
                  <span className="flex-1 text-xs font-semibold text-slate-300">
                    {selected.size > 0 ? `${selected.size} de ${available.length} seleccionadas` : `${available.length} garantías disponibles`}
                  </span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {available.map((w) => (
                    <label key={w.warranty_code}
                      className={`flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-800/60 ${selected.has(w.warranty_code) ? 'bg-emerald-950/20' : ''}`}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-500"
                        checked={selected.has(w.warranty_code)} onChange={() => toggleSel(w.warranty_code)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">{w.warranty_code}</span>
                          {w.estado && <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300">{w.estado}</span>}
                          {w.marca && <span className="text-[10px] text-slate-500">{w.marca}</span>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-400">
                          {w.producto || '—'}
                          {w.serie && <span className="ml-2 text-slate-500">· Serie: {w.serie}</span>}
                          {w.falla && <span className="ml-2 text-slate-500">· {w.falla}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Nota */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400">Nota (opcional)</label>
              <input className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                placeholder="Viaje del miércoles, bulto con Canning..." value={createNota} onChange={(e) => setCreateNota(e.target.value)} />
            </div>

            {createError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />{createError}
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={createLoading || selected.size === 0 || !createDestino.trim()}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                {createLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {selected.size > 0 ? `Generar remito (${selected.size} garantías)` : 'Generar remito'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ── Remito(s) recién generado(s) ── */}
      {lastCreated.length > 0 && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {lastCreated.length === 1 ? 'Remito generado' : `${lastCreated.length} remitos generados`} — descargá el PDF para acompañar el envío
          </div>
          <div className="space-y-2">
            {lastCreated.map((r) => (
              <div key={r.remito_code}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-slate-900 px-4 py-3">
                <div className="space-y-0.5">
                  <span className="font-mono text-base font-black text-white">{r.remito_code}</span>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                    <span><span className="text-slate-500">Destino:</span> <strong className="text-slate-200">{r.destino_deposito}</strong></span>
                    <span><span className="text-slate-500">Productos:</span> <strong className="text-slate-200">{r.warranties_count}</strong></span>
                    {r.proveedor && <span><span className="text-slate-500">Proveedor:</span> <strong className="text-slate-200">{r.proveedor}</strong></span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadPdf(r.remito_code)}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Descargar PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setLastCreated([])}
            className="mt-3 text-xs text-slate-500 hover:text-slate-300 underline"
          >
            Cerrar
          </button>
        </section>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {applied && !loading && items.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 py-12 text-center text-slate-400">
          <Truck className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>No hay remitos para <strong className="text-white">{applied}</strong></p>
          <p className="mt-1 text-xs">Cuando generen un remito para esta sucursal aparecerá acá.</p>
        </div>
      )}

      {/* ── Pendientes de despacho ── */}
      {pendientes.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-blue-300">
            <PackageCheck className="h-4 w-4" />
            Pendientes de despacho
            <span className="ml-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-200">
              {pendientes.length}
            </span>
          </h2>
          <div className="space-y-3">
            {pendientes.map((remito) => (
              <RemitoCard
                key={remito.remito_code}
                remito={remito}
                canDispatch={canDispatch()}
                dispatching={dispatchLoading[remito.remito_code] ?? false}
                dispatchErr={dispatchError[remito.remito_code] ?? ''}
                dispatched={dispatchOk[remito.remito_code] ?? false}
                onDispatch={() => doDispatch(remito)}
                onDownload={() => handleDownloadPdf(remito.remito_code)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── En tránsito ── */}
      {enTransito.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-amber-300">
            <Truck className="h-4 w-4" />
            En tránsito — esperando confirmación del depósito
            <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
              {enTransito.length}
            </span>
          </h2>
          <div className="space-y-3">
            {enTransito.map((remito) => (
              <RemitoCard
                key={remito.remito_code}
                remito={remito}
                canDispatch={false}
                dispatching={false}
                dispatchErr=""
                dispatched={false}
                onDispatch={() => {}}
                onDownload={() => handleDownloadPdf(remito.remito_code)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Llegados ── */}
      {llegados.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Llegaron al depósito
            <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-200">
              {llegados.length}
            </span>
          </h2>
          <div className="space-y-3">
            {llegados.map((remito) => (
              <RemitoCard
                key={remito.remito_code}
                remito={remito}
                canDispatch={false}
                dispatching={false}
                dispatchErr=""
                dispatched={false}
                onDispatch={() => {}}
                onDownload={() => handleDownloadPdf(remito.remito_code)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Tarjeta de remito ─────────────────────────────────────────────────────────

function RemitoCard({
  remito,
  canDispatch,
  dispatching,
  dispatchErr,
  dispatched,
  onDispatch,
  onDownload,
}: {
  remito: WarrantyRemitoInfo;
  canDispatch: boolean;
  dispatching: boolean;
  dispatchErr: string;
  dispatched: boolean;
  onDispatch: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Info principal */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-black text-white">{remito.remito_code}</span>
            {statusBadge(remito.status)}
            <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-xs text-slate-300">
              {remito.warranties_count} producto{remito.warranties_count !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span>
              <span className="text-slate-500">Destino:</span>{' '}
              <span className="font-semibold text-slate-200">{remito.destino_deposito}</span>
            </span>
            {remito.proveedor && (
              <span>
                <span className="text-slate-500">Proveedor:</span>{' '}
                <span className="font-semibold text-slate-200">{remito.proveedor}</span>
              </span>
            )}
            <span>
              <span className="text-slate-500">Generado:</span>{' '}
              {remito.created_at_display || remito.created_at}
            </span>
            {remito.fecha_despacho_display && (
              <span>
                <Clock className="mr-0.5 inline h-3 w-3 text-amber-400" />
                <span className="text-slate-500">Despachado:</span>{' '}
                {remito.fecha_despacho_display}
              </span>
            )}
            {remito.fecha_llegada_display && (
              <span>
                <CheckCircle2 className="mr-0.5 inline h-3 w-3 text-emerald-400" />
                <span className="text-slate-500">Llegó:</span>{' '}
                {remito.fecha_llegada_display}
              </span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>
          {canDispatch && remito.status === 'pendiente' && (
            <button
              onClick={onDispatch}
              disabled={dispatching || dispatched}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {dispatching ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : dispatched ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {dispatched ? 'Despachado' : 'Despachar'}
            </button>
          )}
        </div>
      </div>

      {/* Productos */}
      {remito.warranties && remito.warranties.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-slate-800 pt-3">
          {remito.warranties.map((w) => (
            <div key={w.warranty_code} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-slate-300">{w.warranty_code}</span>
              <span className="text-slate-500">·</span>
              <span>{w.producto || '—'}</span>
              {w.serie && <span className="text-slate-500">Serie: {w.serie}</span>}
              {w.falla && <span className="truncate text-slate-500">Falla: {w.falla}</span>}
            </div>
          ))}
        </div>
      )}

      {dispatchErr && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{dispatchErr}
        </div>
      )}
    </div>
  );
}
