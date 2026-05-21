import { FormEvent, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  PackageCheck,
  Printer,
  RefreshCw,
  Truck,
  X,
} from 'lucide-react';
import {
  can,
  confirmRemitoArrivalByCode,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForDepositTransfer,
  fetchDepositTransferOptions,
  fetchRemitos,
  generateDepositTransferRemito,
} from '../api/client';
import type {
  AvailableWarrantyForRemito,
  WarrantyRemitoInfo,
} from '../types';

const canReceive       = () => can('warranties.remitos.receive');
const canDepositTransfer = () => can('warranties.remitos.deposit_transfer');

/** Days between a date string and now */
function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

async function printRemitoPdf(remitoCode: string): Promise<void> {
  const blob = await downloadRemitoPdf(remitoCode);
  const url  = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(iframe);
  await new Promise<void>((resolve) => {
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
      catch { window.open(url, '_blank'); }
      setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); resolve(); }, 2000);
    };
    iframe.onerror = () => { document.body.removeChild(iframe); URL.revokeObjectURL(url); window.open(url, '_blank'); resolve(); };
    iframe.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export function WarrantyDepositReceivePage() {
  // ── Remitos en tránsito ───────────────────────────────────────────────────
  const [transitRemitos, setTransitRemitos] = useState<WarrantyRemitoInfo[]>([]);
  const [transitLoading, setTransitLoading] = useState(false);
  const [transitError,   setTransitError]   = useState('');

  // ── Confirmación rápida (código manual) ───────────────────────────────────
  const [quickCode,    setQuickCode]    = useState('');
  const [quickLugar,   setQuickLugar]   = useState('');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError,   setQuickError]   = useState('');

  // ── Confirmación inline por tarjeta ───────────────────────────────────────
  const [confirmingCode,  setConfirmingCode]  = useState<string | null>(null);
  const [confirmLugar,    setConfirmLugar]    = useState('');
  const [confirmLoading,  setConfirmLoading]  = useState(false);
  const [confirmError,    setConfirmError]    = useState('');

  // ── Resultados de la sesión ───────────────────────────────────────────────
  const [recentConfirmed, setRecentConfirmed] = useState<string[]>([]);

  // ── Movimiento depósito → depósito ────────────────────────────────────────
  const [transferOrigen,   setTransferOrigen]   = useState('');
  const [transferDestinos, setTransferDestinos] = useState<Array<{ id: string; name: string; code: string; company_id: string }>>([]);
  const [transferDestino,  setTransferDestino]  = useState('');
  const [transferNota,     setTransferNota]     = useState('');
  const [transferAvailable, setTransferAvailable] = useState<AvailableWarrantyForRemito[]>([]);
  const [transferSelected,  setTransferSelected]  = useState<Set<string>>(new Set());
  const [transferLoading,  setTransferLoading]  = useState(false);
  const [transferError,    setTransferError]    = useState('');
  const [transferResult,   setTransferResult]   = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    loadTransitRemitos();
    if (canDepositTransfer()) loadDepositTransfer();
  }, []);

  // ── Carga ─────────────────────────────────────────────────────────────────

  async function loadTransitRemitos() {
    setTransitLoading(true);
    setTransitError('');
    try {
      const res = await fetchRemitos({ status: 'en_transito' });
      setTransitRemitos(res.items || []);
    } catch (e: unknown) {
      setTransitError((e as Error).message || 'No se pudieron cargar los remitos en tránsito.');
    } finally {
      setTransitLoading(false);
    }
  }

  async function loadDepositTransfer() {
    setTransferLoading(true);
    setTransferError('');
    try {
      const [opts, available] = await Promise.all([
        fetchDepositTransferOptions(),
        fetchAvailableWarrantiesForDepositTransfer(),
      ]);
      setTransferOrigen(opts.origen_deposito || available.origen_deposito || '');
      setTransferDestinos(opts.destinos || []);
      setTransferDestino((cur) => cur || opts.destinos?.[0]?.name || '');
      setTransferAvailable(available.items || []);
      setTransferSelected(new Set());
    } catch (e: unknown) {
      setTransferError((e as Error).message || 'No se pudo cargar movimiento entre depósitos.');
    } finally {
      setTransferLoading(false);
    }
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  async function handleQuickConfirm(e: FormEvent) {
    e.preventDefault();
    const code = quickCode.trim().toUpperCase();
    if (!code) { setQuickError('Ingresá el código del remito.'); return; }
    setQuickLoading(true);
    setQuickError('');
    try {
      const result = await confirmRemitoArrivalByCode({
        remito_code: code,
        lugar_llegada: quickLugar.trim() || undefined,
      });
      setRecentConfirmed((prev) => [`Remito ${result.remito_code} confirmado como llegado.`, ...prev].slice(0, 5));
      setQuickCode('');
      setQuickLugar('');
      await loadTransitRemitos();
    } catch (err: unknown) {
      setQuickError((err as Error).message || 'No se pudo confirmar el remito.');
    } finally {
      setQuickLoading(false);
    }
  }

  async function handleCardConfirm(remitoCode: string) {
    setConfirmLoading(true);
    setConfirmError('');
    try {
      const result = await confirmRemitoArrivalByCode({
        remito_code: remitoCode,
        lugar_llegada: confirmLugar.trim() || undefined,
      });
      setRecentConfirmed((prev) => [`Remito ${result.remito_code} confirmado como llegado.`, ...prev].slice(0, 5));
      setConfirmingCode(null);
      setConfirmLugar('');
      await loadTransitRemitos();
    } catch (err: unknown) {
      setConfirmError((err as Error).message || 'No se pudo confirmar el remito.');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleDepositTransfer(e: FormEvent) {
    e.preventDefault();
    if (!transferDestino.trim()) { setTransferError('Seleccioná depósito destino.'); return; }
    if (transferSelected.size === 0) { setTransferError('Seleccioná al menos una garantía para mover.'); return; }
    setTransferLoading(true);
    setTransferError('');
    setTransferResult(null);
    try {
      const res = await generateDepositTransferRemito({
        destino_deposito: transferDestino.trim(),
        warranty_codes: Array.from(transferSelected),
        nota: transferNota.trim() || undefined,
      });
      setTransferResult({ count: res.count, remitos: res.remitos });
      setTransferNota('');
      await loadDepositTransfer();
    } catch (e: unknown) {
      setTransferError((e as Error).message || 'No se pudo generar el movimiento.');
    } finally {
      setTransferLoading(false);
    }
  }

  async function handleDownloadPdf(remitoCode: string) {
    try {
      const blob = await downloadRemitoPdf(remitoCode);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${remitoCode}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      alert((e as Error).message || 'Error al descargar PDF');
    }
  }

  function toggleTransferCode(code: string) {
    setTransferSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function toggleTransferAll() {
    setTransferSelected(
      transferSelected.size === transferAvailable.length
        ? new Set()
        : new Set(transferAvailable.map((w) => w.warranty_code)),
    );
  }

  // ── Estadísticas rápidas ──────────────────────────────────────────────────
  const lateCount = transitRemitos.filter((r) => {
    const d = daysSince(r.fecha_despacho || r.created_at);
    return d !== null && d >= 2;
  }).length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/30 p-5 shadow-2xl shadow-emerald-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-emerald-500/15 p-3 ring-1 ring-emerald-400/30">
              <PackageCheck className="h-8 w-8 text-emerald-300" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Recepción en depósito</h1>
              <p className="mt-1 text-sm text-slate-300">
                Confirmá la llegada de remitos entrantes y gestioná movimientos entre depósitos.
              </p>
            </div>
          </div>

          {/* KPIs */}
          <div className="flex shrink-0 gap-3">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center">
              <div className="text-2xl font-black text-amber-200">{transitRemitos.length}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/70">En tránsito</div>
            </div>
            {lateCount > 0 && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center">
                <div className="text-2xl font-black text-red-300">{lateCount}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-red-400/70">Demorados</div>
              </div>
            )}
            {recentConfirmed.length > 0 && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center">
                <div className="text-2xl font-black text-emerald-200">{recentConfirmed.length}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/70">Confirmados</div>
              </div>
            )}
          </div>
        </div>

        {/* Confirmaciones recientes */}
        {recentConfirmed.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {recentConfirmed.map((msg, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />{msg}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Confirmar por código ─────────────────────────────────────────── */}
      {canReceive() && (
        <section className="rounded-3xl border border-emerald-500/30 bg-slate-950 p-5 shadow-xl shadow-emerald-950/10">
          <div className="mb-4">
            <h2 className="flex items-center gap-2 text-lg font-black text-emerald-200">
              <PackageCheck className="h-5 w-5" />
              Confirmar llegada por código
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Ingresá el código del PDF impreso para registrar la recepción.
            </p>
          </div>
          <form onSubmit={handleQuickConfirm} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Código del remito</label>
                <input
                  className="rounded-2xl border border-emerald-500/40 bg-slate-900 px-4 py-3 font-mono text-base font-bold text-white placeholder:font-normal placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  placeholder="Ej. GV-R-2026-0001"
                  value={quickCode}
                  onChange={(e) => setQuickCode(e.target.value.toUpperCase())}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Ubicación interna (opcional)</label>
                <input
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  placeholder="Ej. Estante A3"
                  value={quickLugar}
                  onChange={(e) => setQuickLugar(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={quickLoading || !quickCode.trim()}
                className="self-end rounded-2xl bg-emerald-600 px-6 py-3 text-base font-black text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {quickLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : 'Confirmar'}
              </button>
            </div>
            {quickError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />{quickError}
              </div>
            )}
          </form>
        </section>
      )}

      {/* ── Remitos en tránsito ──────────────────────────────────────────── */}
      <section className="rounded-3xl border border-amber-500/20 bg-slate-950 p-5 shadow-xl shadow-amber-950/10">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-amber-200">
              <Truck className="h-5 w-5" />
              Remitos en tránsito
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Remitos despachados que están en camino hacia tu depósito.
            </p>
          </div>
          <button
            type="button"
            onClick={loadTransitRemitos}
            disabled={transitLoading}
            className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`mr-2 inline h-4 w-4 ${transitLoading ? 'animate-spin' : ''}`} />Actualizar
          </button>
        </div>

        {lateCount > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>
              <strong>{lateCount} remito{lateCount !== 1 ? 's' : ''}</strong> lleva{lateCount === 1 ? '' : 'n'} más de 2 días en tránsito sin confirmarse.
            </span>
          </div>
        )}

        {transitLoading && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
            <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />Cargando remitos en tránsito...
          </div>
        )}

        {!transitLoading && transitError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />{transitError}
          </div>
        )}

        {!transitLoading && !transitError && transitRemitos.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500/50" />
            No hay remitos en tránsito hacia tu depósito.
          </div>
        )}

        {!transitLoading && transitRemitos.length > 0 && (
          <div className="space-y-3">
            {transitRemitos.map((r) => {
              const days  = daysSince(r.fecha_despacho || r.created_at);
              const isLate = days !== null && days >= 2;
              const isConfirming = confirmingCode === r.remito_code;

              return (
                <div
                  key={r.remito_code}
                  className={`rounded-2xl border transition ${isLate ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700 bg-slate-900/70'}`}
                >
                  {/* Card header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-black text-white">{r.remito_code}</span>
                        {isLate ? (
                          <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                            <AlertTriangle className="h-3 w-3" />
                            {days}d en tránsito
                          </span>
                        ) : days !== null && (
                          <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                            <Clock className="h-3 w-3" />
                            {days === 0 ? 'Hoy' : `${days}d`}
                          </span>
                        )}
                        <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">
                          {r.warranties_count} producto{r.warranties_count !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="font-semibold text-slate-200">{r.origen_sucursal}</span>
                        <ArrowRight className="h-3 w-3 text-slate-500" />
                        <span className="text-slate-300">{r.destino_deposito}</span>
                      </div>

                      {r.fecha_despacho_display && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Despachado: {r.fecha_despacho_display}
                          {r.despachado_por_name && ` · ${r.despachado_por_name}`}
                        </div>
                      )}
                      {r.nota && (
                        <div className="mt-1 text-[11px] italic text-slate-500">"{r.nota}"</div>
                      )}
                    </div>

                    {canReceive() && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isConfirming) {
                            setConfirmingCode(null);
                            setConfirmLugar('');
                            setConfirmError('');
                          } else {
                            setConfirmingCode(r.remito_code);
                            setConfirmLugar('');
                            setConfirmError('');
                          }
                        }}
                        className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black transition ${
                          isConfirming
                            ? 'border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                            : 'bg-emerald-600 text-white hover:bg-emerald-500'
                        }`}
                      >
                        {isConfirming ? (
                          <><X className="mr-1 inline h-3.5 w-3.5" />Cancelar</>
                        ) : 'Confirmar llegada'}
                      </button>
                    )}
                  </div>

                  {/* Inline confirm form */}
                  {isConfirming && (
                    <div className="border-t border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-xs font-semibold text-slate-400">
                            Ubicación interna (opcional)
                          </label>
                          <input
                            autoFocus
                            className="rounded-xl border border-emerald-500/30 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                            placeholder="Ej. Estante B2"
                            value={confirmLugar}
                            onChange={(e) => setConfirmLugar(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={confirmLoading}
                          onClick={() => handleCardConfirm(r.remito_code)}
                          className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {confirmLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-1.5 inline h-4 w-4" />Confirmar</>}
                        </button>
                      </div>
                      {confirmError && (
                        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{confirmError}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Warranty contents preview */}
                  {r.warranties && r.warranties.length > 0 && (
                    <div className="border-t border-slate-800 px-4 py-3">
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Contenido
                      </div>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {r.warranties.slice(0, 6).map((w) => (
                          <div key={w.warranty_code} className="text-xs text-slate-400">
                            <span className="font-mono font-bold text-slate-200">{w.warranty_code}</span>
                            {w.producto && <span className="ml-1 text-slate-400">· {w.producto}</span>}
                          </div>
                        ))}
                        {r.warranties.length > 6 && (
                          <div className="text-xs text-slate-500">+{r.warranties.length - 6} más...</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Movimiento depósito → depósito ───────────────────────────────── */}
      {canDepositTransfer() && (
        <section className="rounded-3xl border border-cyan-500/30 bg-slate-950 p-5 shadow-xl shadow-cyan-950/10">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-cyan-200">
                <Truck className="h-5 w-5" />
                Movimiento depósito → depósito
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Mové garantías desde tu depósito hacia otro depósito de guarda.
              </p>
            </div>
            <button
              type="button"
              onClick={loadDepositTransfer}
              disabled={transferLoading}
              className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`mr-2 inline h-4 w-4 ${transferLoading ? 'animate-spin' : ''}`} />Actualizar
            </button>
          </div>

          <form onSubmit={handleDepositTransfer} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100">
                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200/70">Tu depósito</div>
                <div className="mt-1 font-black">{transferOrigen || 'Depósito no asignado'}</div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-400">Depósito destino</span>
                <select
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  value={transferDestino}
                  onChange={(e) => setTransferDestino(e.target.value)}
                >
                  <option value="">— Seleccioná depósito destino —</option>
                  {transferDestinos.map((d) => (
                    <option key={d.id || d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {transferLoading && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
                <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />Cargando garantías en depósito...
              </div>
            )}

            {!transferLoading && transferAvailable.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
                <div className="flex flex-col gap-2 border-b border-slate-700 px-4 py-3 sm:flex-row sm:items-center">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-cyan-500"
                      checked={transferSelected.size === transferAvailable.length}
                      onChange={toggleTransferAll}
                    />
                    <span className="text-sm font-bold text-white">
                      {transferSelected.size > 0
                        ? `${transferSelected.size} de ${transferAvailable.length} seleccionadas`
                        : `${transferAvailable.length} garantías disponibles`}
                    </span>
                  </label>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
                  {transferAvailable.map((w) => (
                    <label
                      key={w.warranty_code}
                      className={`flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-800/70 ${transferSelected.has(w.warranty_code) ? 'bg-cyan-950/30' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-cyan-500"
                        checked={transferSelected.has(w.warranty_code)}
                        onChange={() => toggleTransferCode(w.warranty_code)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-black text-white">{w.warranty_code}</span>
                          {w.estado && (
                            <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">{w.estado}</span>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {w.sku && <span>SKU: {w.sku}</span>}
                          {w.serie && <span>Serie: {w.serie}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!transferLoading && transferAvailable.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
                No hay garantías disponibles para mover desde tu depósito.
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-400">Nota (opcional)</span>
              <input
                className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                placeholder="Ej: traslado a guarda / estantería"
                value={transferNota}
                onChange={(e) => setTransferNota(e.target.value)}
              />
            </label>

            {transferError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />{transferError}
              </div>
            )}

            {transferResult && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="mb-3 font-bold">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  Movimiento generado: {transferResult.count} remito{transferResult.count !== 1 ? 's' : ''}
                </div>
                <div className="space-y-2">
                  {transferResult.remitos.map((r) => (
                    <div
                      key={r.remito_code}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-slate-950 px-3 py-2"
                    >
                      <div>
                        <span className="font-mono text-sm font-black text-white">{r.remito_code}</span>
                        <span className="ml-3 text-xs text-slate-400">
                          {r.origen_sucursal} → {r.destino_deposito}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(r.remito_code)}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                        >
                          <Download className="h-3.5 w-3.5" /> PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => printRemitoPdf(r.remito_code)}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          <Printer className="h-3.5 w-3.5" /> Imprimir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={transferLoading || !transferDestino.trim() || transferSelected.size === 0}
              className="rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-black text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {transferLoading
                ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
                : <Truck className="mr-2 inline h-4 w-4" />}
              {transferSelected.size > 0
                ? `Generar movimiento (${transferSelected.size})`
                : 'Generar movimiento interno'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
