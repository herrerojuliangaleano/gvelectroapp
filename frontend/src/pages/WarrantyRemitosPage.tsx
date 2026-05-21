import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Download,
  MapPin,
  Printer,
  RefreshCw,
  Send,
  Truck,
} from 'lucide-react';
import {
  can,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForDepositTransfer,
  fetchAvailableWarrantiesForProviderDelivery,
  fetchDepositTransferOptions,
  generateDepositTransferRemito,
  generateProviderDeliveryRemito,
} from '../api/client';
import type {
  AvailableWarrantyForRemito,
  ProviderDeliveryWarranty,
  WarrantyRemitoInfo,
} from '../types';

// ── Permisos ──────────────────────────────────────────────────────────────────
const canDepositTransfer  = () => can('warranties.remitos.deposit_transfer');
const canProviderDelivery = () => can('warranties.remitos.provider_delivery');

// ── PDF helpers ───────────────────────────────────────────────────────────────

/** Abre el PDF en un iframe oculto y dispara el diálogo de impresión nativo. */
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

// ── Main component ────────────────────────────────────────────────────────────

export function WarrantyRemitosPage() {
  // Movimiento depósito → depósito
  const [transferOrigen,    setTransferOrigen]    = useState('');
  const [transferDestinos,  setTransferDestinos]  = useState<Array<{ id: string; name: string; code: string; company_id: string }>>([]);
  const [transferDestino,   setTransferDestino]   = useState('');
  const [transferNota,      setTransferNota]      = useState('');
  const [transferAvailable, setTransferAvailable] = useState<AvailableWarrantyForRemito[]>([]);
  const [transferSelected,  setTransferSelected]  = useState<Set<string>>(new Set());
  const [transferLoading,   setTransferLoading]   = useState(false);
  const [transferError,     setTransferError]     = useState('');
  const [transferResult,    setTransferResult]    = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);

  // Entrega al proveedor (deposito_a_proveedor)
  const [pdWarranties,      setPdWarranties]      = useState<ProviderDeliveryWarranty[]>([]);
  const [pdLoading,         setPdLoading]         = useState(false);
  const [pdError,           setPdError]           = useState('');
  const [pdResult,          setPdResult]          = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);
  const [pdSelected,        setPdSelected]        = useState<Set<string>>(new Set());
  const [pdFilterProvider,  setPdFilterProvider]  = useState('');
  const [pdNota,            setPdNota]            = useState('');

  // Asegurar que la página arranca desde el top
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    if (canDepositTransfer()) loadDepositTransfer();
    if (canProviderDelivery()) loadProviderDelivery();
  }, []);

  // ── Loaders ───────────────────────────────────────────────────────────────

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
      setTransferDestino((current) => current || opts.destinos?.[0]?.name || '');
      setTransferAvailable(available.items || []);
      setTransferSelected(new Set());
    } catch (e: unknown) {
      setTransferError((e as Error).message || 'No se pudo cargar movimiento entre depósitos');
    } finally {
      setTransferLoading(false);
    }
  }

  async function loadProviderDelivery() {
    setPdLoading(true);
    setPdError('');
    try {
      const res = await fetchAvailableWarrantiesForProviderDelivery();
      setPdWarranties(Array.isArray(res.items) ? res.items : []);
      setPdSelected(new Set());
    } catch (e: unknown) {
      setPdError((e as Error).message || 'No se pudieron cargar las garantías listas para proveedor');
    } finally {
      setPdLoading(false);
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

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
      setTransferError((e as Error).message || 'No se pudo generar el movimiento');
    } finally {
      setTransferLoading(false);
    }
  }

  async function handleProviderDelivery(e: FormEvent) {
    e.preventDefault();
    if (pdSelected.size === 0) { setPdError('Seleccioná al menos una garantía para incluir.'); return; }
    const selectedWarranties = pdWarranties.filter((w) => pdSelected.has(w.warranty_code));
    const proveedores = [...new Set(selectedWarranties.map((w) => w.provider_name).filter(Boolean))];
    if (proveedores.length !== 1) { setPdError('Seleccioná garantías de un solo proveedor por remito.'); return; }
    const proveedor = proveedores[0];
    setPdLoading(true);
    setPdError('');
    setPdResult(null);
    try {
      const res = await generateProviderDeliveryRemito({
        warranty_codes: Array.from(pdSelected),
        proveedor,
        nota: pdNota.trim() || undefined,
      });
      setPdResult({ count: res.count, remitos: res.remitos });
      setPdNota('');
      setPdSelected(new Set());
      await loadProviderDelivery();
    } catch (e: unknown) {
      setPdError((e as Error).message || 'Error al generar el remito de entrega');
    } finally {
      setPdLoading(false);
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

  function togglePdCode(code: string) {
    setPdSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function togglePdAll(codes: string[]) {
    setPdSelected((prev) => {
      if (codes.every((c) => prev.has(c))) {
        const next = new Set(prev);
        codes.forEach((c) => next.delete(c));
        return next;
      }
      const next = new Set(prev);
      codes.forEach((c) => next.add(c));
      return next;
    });
  }

  // ── Datos derivados ───────────────────────────────────────────────────────

  const pdProviders = useMemo(() => {
    const map = new Map<string, ProviderDeliveryWarranty[]>();
    for (const w of pdWarranties) {
      const key = w.provider_name || 'Sin proveedor';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(w);
    }
    return map;
  }, [pdWarranties]);

  const pdFilteredWarranties = useMemo(
    () => (pdFilterProvider ? (pdProviders.get(pdFilterProvider) ?? []) : pdWarranties),
    [pdFilterProvider, pdProviders, pdWarranties],
  );

  const depositTransfer  = canDepositTransfer();
  const providerDelivery = canProviderDelivery();

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">

      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950/40 p-5 shadow-2xl shadow-blue-950/20">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-blue-500/15 p-3 ring-1 ring-blue-400/30">
              <Truck className="h-8 w-8 text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Operaciones de remitos</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Movimientos internos entre depósitos y entrega física de garantías al proveedor.
                Requiere permisos específicos de depósito.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {depositTransfer  && <span className="rounded-full bg-cyan-500/20 px-3 py-1 font-semibold text-cyan-200">Movimiento depósito</span>}
                {providerDelivery && <span className="rounded-full bg-violet-500/20 px-3 py-1 font-semibold text-violet-200">Entrega proveedor</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Movimiento depósito → depósito */}
      {depositTransfer && (
        <section className="rounded-3xl border border-cyan-500/30 bg-slate-950 p-5 shadow-xl shadow-cyan-950/10">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-cyan-200">
                <Truck className="h-5 w-5" /> Movimiento depósito → depósito
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Solo para personal de depósito. Permite mover garantías que ya están físicamente en tu depósito hacia otro depósito de guarda.
              </p>
            </div>
            <button type="button" onClick={loadDepositTransfer} disabled={transferLoading} className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50">
              <RefreshCw className={`mr-2 inline h-4 w-4 ${transferLoading ? 'animate-spin' : ''}`} />Actualizar
            </button>
          </div>

          <form onSubmit={handleDepositTransfer} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100">
                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200/70">Origen asignado</div>
                <div className="mt-1 font-black">{transferOrigen || 'Depósito no asignado'}</div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-400">Destino</span>
                <select className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none" value={transferDestino} onChange={(e) => setTransferDestino(e.target.value)}>
                  <option value="">— Seleccioná depósito destino —</option>
                  {transferDestinos.map((d) => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
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
                    <input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={transferSelected.size === transferAvailable.length} onChange={toggleTransferAll} />
                    <span className="text-sm font-bold text-white">
                      {transferSelected.size > 0 ? `${transferSelected.size} de ${transferAvailable.length} seleccionadas` : `${transferAvailable.length} garantías disponibles en depósito`}
                    </span>
                  </label>
                  <span className="text-xs text-slate-500 sm:ml-auto">No se muestra seguimiento global: solo garantías disponibles para mover.</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
                  {transferAvailable.map((w) => (
                    <label key={`transfer-${w.warranty_code}`} className={`flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-800/70 ${transferSelected.has(w.warranty_code) ? 'bg-cyan-950/30' : ''}`}>
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-cyan-500" checked={transferSelected.has(w.warranty_code)} onChange={() => toggleTransferCode(w.warranty_code)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-black text-white">{w.warranty_code}</span>
                          {w.estado && <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">{w.estado}</span>}
                          {w.marca  && <span className="text-[10px] uppercase tracking-wide text-slate-500">{w.marca}</span>}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {w.sku   && <span>SKU: {w.sku}</span>}
                          {w.serie && <span>Serie: {w.serie}</span>}
                          {w.falla && <span>Falla: {w.falla}</span>}
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
              <span className="text-xs font-semibold text-slate-400">Nota para el movimiento (opcional)</span>
              <input className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none" placeholder="Ej: traslado a guarda / estantería" value={transferNota} onChange={(e) => setTransferNota(e.target.value)} />
            </label>

            {transferError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />{transferError}
              </div>
            )}

            {transferResult && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="mb-3 font-bold"><CheckCircle2 className="mr-2 inline h-4 w-4" />Movimiento generado</div>
                <div className="space-y-2">
                  {transferResult.remitos.map((r) => (
                    <div key={`transfer-result-${r.remito_code}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-slate-950 px-3 py-2">
                      <div>
                        <span className="font-mono text-sm font-black text-white">{r.remito_code}</span>
                        <span className="ml-3 text-xs text-slate-400">{r.origen_sucursal} → {r.destino_deposito}</span>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleDownloadPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"><Download className="h-3.5 w-3.5" /> PDF</button>
                        <button type="button" onClick={() => printRemitoPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"><Printer className="h-3.5 w-3.5" /> Imprimir</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button type="submit" disabled={transferLoading || !transferDestino.trim() || transferSelected.size === 0} className="rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-black text-white hover:bg-cyan-500 disabled:opacity-50">
              {transferLoading ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Truck className="mr-2 inline h-4 w-4" />}
              {transferSelected.size > 0 ? `Generar movimiento (${transferSelected.size})` : 'Generar movimiento interno'}
            </button>
          </form>
        </section>
      )}

      {/* Entrega al proveedor */}
      {providerDelivery && (
        <section className="rounded-3xl border border-violet-500/30 bg-slate-950 p-5 shadow-xl shadow-violet-950/10">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-violet-200">
                <Building2 className="h-5 w-5" />
                Entrega al proveedor
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Generá un remito para acompañar el traslado físico de garantías desde el depósito al proveedor. Solo aparecen garantías con retiro confirmado como listo.
              </p>
            </div>
            <button type="button" onClick={loadProviderDelivery} disabled={pdLoading} className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50">
              <RefreshCw className={`mr-2 inline h-4 w-4 ${pdLoading ? 'animate-spin' : ''}`} />Actualizar
            </button>
          </div>

          <form onSubmit={handleProviderDelivery} className="space-y-4">
            {/* Filtro por proveedor */}
            {pdProviders.size > 1 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Filtrar por proveedor</label>
                <select
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white focus:border-violet-500 focus:outline-none"
                  value={pdFilterProvider}
                  onChange={(e) => { setPdFilterProvider(e.target.value); setPdSelected(new Set()); }}
                >
                  <option value="">— Todos los proveedores ({pdWarranties.length}) —</option>
                  {[...pdProviders.entries()].map(([prov, items]) => (
                    <option key={prov} value={prov}>{prov} ({items.length})</option>
                  ))}
                </select>
              </div>
            )}

            {pdLoading && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
                <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />Cargando garantías listas para proveedor...
              </div>
            )}

            {!pdLoading && pdFilteredWarranties.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
                <div className="flex flex-col gap-2 border-b border-slate-700 px-4 py-3 sm:flex-row sm:items-center">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-violet-500"
                      checked={pdFilteredWarranties.every((w) => pdSelected.has(w.warranty_code))}
                      onChange={() => togglePdAll(pdFilteredWarranties.map((w) => w.warranty_code))}
                    />
                    <span className="text-sm font-bold text-white">
                      {pdSelected.size > 0 ? `${pdSelected.size} seleccionada(s)` : `${pdFilteredWarranties.length} garantía(s) listas para retiro`}
                    </span>
                  </label>
                  <span className="text-xs text-violet-300/60 sm:ml-auto">
                    <MapPin className="mr-1 inline h-3 w-3" />En depósito · Proveedor confirmó retiro
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
                  {pdFilteredWarranties.map((w) => (
                    <label key={`pd-${w.warranty_code}`} className={`flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-800/70 ${pdSelected.has(w.warranty_code) ? 'bg-violet-950/30' : ''}`}>
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-violet-500" checked={pdSelected.has(w.warranty_code)} onChange={() => togglePdCode(w.warranty_code)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-black text-white">{w.warranty_code}</span>
                          {w.provider_name && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-300">{w.provider_name}</span>}
                          {w.marca        && <span className="text-[10px] uppercase tracking-wide text-slate-500">{w.marca}</span>}
                          {w.deposito     && <span className="text-[10px] text-slate-500"><MapPin className="mr-0.5 inline h-3 w-3" />{w.deposito}</span>}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {w.sku   && <span>SKU: {w.sku}</span>}
                          {w.serie && <span>Serie: {w.serie}</span>}
                          {w.falla && <span>Falla: {w.falla}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!pdLoading && pdWarranties.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
                No hay garantías listas para entrega al proveedor en este momento.
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-400">Nota para el remito (opcional)</span>
              <input
                className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
                placeholder="Ej: urgente, coordinar con técnico"
                value={pdNota}
                onChange={(e) => setPdNota(e.target.value)}
              />
            </label>

            {pdError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />{pdError}
              </div>
            )}

            {pdResult && (
              <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4 text-sm text-violet-100">
                <div className="mb-3 font-bold"><CheckCircle2 className="mr-2 inline h-4 w-4" />{pdResult.count} remito(s) de entrega generado(s)</div>
                <div className="space-y-2">
                  {pdResult.remitos.map((r) => (
                    <div key={`pd-result-${r.remito_code}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-500/20 bg-slate-950 px-3 py-2">
                      <div>
                        <span className="font-mono text-sm font-black text-white">{r.remito_code}</span>
                        <span className="ml-3 text-xs text-slate-400">{r.origen_sucursal} <ArrowRight className="inline h-3 w-3" /> {r.destino_deposito}</span>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleDownloadPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"><Download className="h-3.5 w-3.5" /> PDF</button>
                        <button type="button" onClick={() => printRemitoPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"><Printer className="h-3.5 w-3.5" /> Imprimir</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={pdLoading || pdSelected.size === 0}
              className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pdLoading ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Send className="mr-2 inline h-4 w-4" />}
              {pdSelected.size > 0 ? `Generar remito de entrega (${pdSelected.size})` : 'Generar remito de entrega al proveedor'}
            </button>
          </form>
        </section>
      )}

      {!depositTransfer && !providerDelivery && (
        <div className="rounded-3xl border border-slate-800 bg-slate-950 px-6 py-10 text-center text-slate-400">
          <Truck className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <div className="font-bold text-slate-300">Sin operaciones disponibles</div>
          <p className="mt-1 text-sm">Tu usuario no tiene acceso a operaciones de remitos en esta sección.</p>
        </div>
      )}
    </div>
  );
}
