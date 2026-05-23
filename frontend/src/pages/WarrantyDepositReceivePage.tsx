import { FormEvent, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  PackageCheck,
  Printer,
  RefreshCw,
  Truck,
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
  // Abrir en nueva pestaña y disparar print() cuando cargue el PDF.
  // El iframe oculto es bloqueado por Chrome en PDFs; la ventana externa funciona siempre.
  const win = window.open(url, '_blank');
  if (win) {
    win.addEventListener('load', () => {
      setTimeout(() => {
        win.print();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }, 400);
    });
  } else {
    // Fallback si el popup fue bloqueado: descargar
    const a = document.createElement('a');
    a.href = url; a.download = `${remitoCode}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
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
      a.href = url; a.download = `${remitoCode}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      // Revocar con delay para que el browser tenga tiempo de iniciar la descarga
      setTimeout(() => URL.revokeObjectURL(url), 2000);
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

  // Resumen agrupado por sucursal de origen
  const byBranch = transitRemitos.reduce<Record<string, { count: number; maxDays: number; hasLate: boolean }>>((acc, r) => {
    const key = r.origen_sucursal || 'Sin sucursal';
    if (!acc[key]) acc[key] = { count: 0, maxDays: 0, hasLate: false };
    acc[key].count++;
    const days = daysSince(r.fecha_despacho || r.created_at) ?? 0;
    if (days > acc[key].maxDays) acc[key].maxDays = days;
    if (days >= 2) acc[key].hasLate = true;
    return acc;
  }, {});

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
          <div className="space-y-2">
            {Object.entries(byBranch)
              .sort((a, b) => b[1].maxDays - a[1].maxDays) // más demorados primero
              .map(([branch, info]) => (
                <div
                  key={branch}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                    info.hasLate
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-slate-700 bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Truck className={`h-4 w-4 shrink-0 ${info.hasLate ? 'text-red-400' : 'text-amber-400'}`} />
                    <span className="font-semibold text-white truncate">{branch}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${
                      info.hasLate
                        ? 'bg-red-500/20 text-red-200'
                        : 'bg-amber-500/20 text-amber-200'
                    }`}>
                      {info.count} remito{info.count !== 1 ? 's' : ''} en tránsito
                    </span>
                    {info.maxDays >= 2 ? (
                      <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                        <AlertTriangle className="h-3 w-3" />{info.maxDays}d
                      </span>
                    ) : info.maxDays > 0 ? (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
                        <Clock className="h-3 w-3" />{info.maxDays}d
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            <p className="pt-1 text-center text-xs text-slate-500">
              Usá el código impreso en el remito para confirmar la llegada ↑
            </p>
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
