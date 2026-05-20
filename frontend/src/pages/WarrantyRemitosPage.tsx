import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  MapPin,
  PackageCheck,
  Printer,
  RefreshCw,
  Send,
  Truck,
} from 'lucide-react';
import {
  can,
  confirmRemitoArrivalByCode,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForRemito,
  fetchAvailableWarrantiesForDepositTransfer,
  fetchAvailableWarrantiesForProviderDelivery,
  fetchDepositTransferOptions,
  fetchWarrantyOptions,
  generateDepositTransferRemito,
  generateProviderDeliveryRemito,
  generateRemitos,
  getCurrentUserFromStorage,
} from '../api/client';
import type {
  AvailableWarrantyForRemito,
  ProviderDeliveryWarranty,
  WarrantyOptions,
  WarrantyRemitoInfo,
} from '../types';

// ── Permisos ──────────────────────────────────────────────────────────────────
const canGenerate         = () => can('warranties.remitos.generate');
const canDispatch         = () => can('warranties.remitos.dispatch');
const canReceive          = () => can('warranties.remitos.receive');
const canDepositTransfer  = () => can('warranties.remitos.deposit_transfer');
const canProviderDelivery = () => can('warranties.remitos.provider_delivery');

// ── Helpers ───────────────────────────────────────────────────────────────────

function centralWarrantyDepositName(options: WarrantyOptions | null): string {
  const configured = options?.warranty_central_deposit?.name?.trim();
  if (configured && configured.toLowerCase().includes('chiclana')) return configured;
  const branches = options?.branches_operativas ?? [];
  const byChiclana = branches.find((b) => b.type === 'deposit' && `${b.code} ${b.name}`.toLowerCase().includes('chiclana'));
  if (byChiclana?.name) return byChiclana.name;
  const cfgChiclana = options?.depositos?.find((d) => d.toLowerCase().includes('chiclana'));
  return cfgChiclana || 'Depósito Chiclana';
}


/** Abre el PDF en un iframe oculto y dispara el diálogo de impresión nativo. */
async function printRemitoPdf(remitoCode: string): Promise<void> {
  const blob = await downloadRemitoPdf(remitoCode);
  const url  = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
        resolve();
      }, 2000);
    };
    iframe.onerror = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
      window.open(url, '_blank');
      resolve();
    };
    iframe.src = url;
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export function WarrantyRemitosPage() {
  const [options, setOptions] = useState<WarrantyOptions | null>(null);

  // Generate remitos form
  const [genDestino, setGenDestino] = useState('');
  const [genSucursal, setGenSucursal] = useState('');
  const [genNota, setGenNota] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [genResult, setGenResult] = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);
  const [availableWarranties, setAvailableWarranties] = useState<AvailableWarrantyForRemito[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());

  // Movimiento depósito → depósito
  const [transferOrigen, setTransferOrigen] = useState('');
  const [transferDestinos, setTransferDestinos] = useState<Array<{ id: string; name: string; code: string; company_id: string }>>([]);
  const [transferDestino, setTransferDestino] = useState('');
  const [transferNota, setTransferNota] = useState('');
  const [transferAvailable, setTransferAvailable] = useState<AvailableWarrantyForRemito[]>([]);
  const [transferSelected, setTransferSelected] = useState<Set<string>>(new Set());
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferResult, setTransferResult] = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);

  // Entrega al proveedor (deposito_a_proveedor)
  const [pdWarranties, setPdWarranties]             = useState<ProviderDeliveryWarranty[]>([]);
  const [pdLoading, setPdLoading]                   = useState(false);
  const [pdError, setPdError]                       = useState('');
  const [pdResult, setPdResult]                     = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);
  const [pdSelected, setPdSelected]                 = useState<Set<string>>(new Set());
  const [pdFilterProvider, setPdFilterProvider]     = useState('');
  const [pdNota, setPdNota]                         = useState('');

  // Quick-accept
  const [quickCode, setQuickCode] = useState('');
  const [quickLugar, setQuickLugar] = useState('');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [quickResult, setQuickResult] = useState('');

  const centralDepositName = centralWarrantyDepositName(options);
  const currentUser = useMemo(() => getCurrentUserFromStorage(), []);
  const userBranchName = (currentUser?.branch_name || currentUser?.sucursal || '').trim();
  const userBranchType = (currentUser?.branch_type || '').toLowerCase();
  const lockOriginBranch = userBranchType === 'physical' && Boolean(userBranchName) && !can('warranties.manage');

  // Asegurar que la página arranca desde el top (evita el bug de pantalla azul en Android
  // donde el teclado virtual desplaza el scroll al montar un input con autoFocus)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    fetchWarrantyOptions().then((opts) => {
      setOptions(opts);
      setGenDestino(centralWarrantyDepositName(opts));
      if (lockOriginBranch && userBranchName) {
        setGenSucursal(userBranchName);
        loadAvailableWarranties(userBranchName);
      }
    }).catch(() => {});
    if (canDepositTransfer()) loadDepositTransfer();
    if (canProviderDelivery()) loadProviderDelivery();
  }, []);

  async function loadAvailableWarranties(suc: string) {
    if (!suc.trim()) {
      setAvailableWarranties([]);
      setSelectedCodes(new Set());
      return;
    }
    setAvailableLoading(true);
    setSelectedCodes(new Set());
    try {
      const res = await fetchAvailableWarrantiesForRemito(suc);
      setAvailableWarranties(Array.isArray(res.items) ? res.items : []);
    } catch {
      setAvailableWarranties([]);
    } finally {
      setAvailableLoading(false);
    }
  }

  function toggleCode(code: string) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function toggleAll() {
    if (selectedCodes.size === availableWarranties.length) {
      setSelectedCodes(new Set());
    } else {
      setSelectedCodes(new Set(availableWarranties.map((w) => w.warranty_code)));
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
    if (transferSelected.size === transferAvailable.length) {
      setTransferSelected(new Set());
    } else {
      setTransferSelected(new Set(transferAvailable.map((w) => w.warranty_code)));
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

  async function handleProviderDelivery(e: FormEvent) {
    e.preventDefault();
    if (pdSelected.size === 0) {
      setPdError('Seleccioná al menos una garantía para incluir.');
      return;
    }
    // Infer provider from selected warranties
    const selectedWarranties = pdWarranties.filter((w) => pdSelected.has(w.warranty_code));
    const proveedores = [...new Set(selectedWarranties.map((w) => w.provider_name).filter(Boolean))];
    if (proveedores.length !== 1) {
      setPdError('Seleccioná garantías de un solo proveedor por remito.');
      return;
    }
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

  async function handleDepositTransfer(e: FormEvent) {
    e.preventDefault();
    if (!transferDestino.trim()) {
      setTransferError('Seleccioná depósito destino.');
      return;
    }
    if (transferSelected.size === 0) {
      setTransferError('Seleccioná al menos una garantía para mover.');
      return;
    }
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

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    const destinoFinal = centralDepositName || genDestino.trim();
    if (!destinoFinal.trim()) {
      setGenError('No se encontró el depósito Chiclana como destino de garantías.');
      return;
    }
    if (availableWarranties.length > 0 && selectedCodes.size === 0) {
      setGenError('Seleccioná al menos una garantía para incluir en el remito.');
      return;
    }
    setGenLoading(true);
    setGenError('');
    setGenResult(null);
    try {
      const payload: Parameters<typeof generateRemitos>[0] = {
        destino_deposito: destinoFinal.trim(),
        nota: genNota.trim() || undefined,
      };
      if (selectedCodes.size > 0) {
        payload.warranty_codes = Array.from(selectedCodes);
      } else {
        payload.sucursal = genSucursal.trim() || undefined;
      }
      const res = await generateRemitos(payload);
      setGenResult({ count: res.count, remitos: res.remitos });
      if (!lockOriginBranch) setGenSucursal('');
      setGenNota('');
      setSelectedCodes(new Set());
      setAvailableWarranties([]);
    } catch (e: unknown) {
      setGenError((e as Error).message || 'Error al generar remitos');
    } finally {
      setGenLoading(false);
    }
  }

  async function handleQuickAccept(e: FormEvent) {
    e.preventDefault();
    const code = quickCode.trim().toUpperCase();
    if (!code) {
      setQuickError('Ingresá el código del remito.');
      return;
    }
    setQuickLoading(true);
    setQuickError('');
    setQuickResult('');
    try {
      const result = await confirmRemitoArrivalByCode({
        remito_code: code,
        lugar_llegada: quickLugar.trim() || undefined,
      });
      setQuickResult(`Remito ${result.remito_code} confirmado como llegado.`);
      setQuickCode('');
      setQuickLugar('');
    } catch (err: unknown) {
      setQuickError((err as Error).message || 'No se pudo confirmar el remito');
    } finally {
      setQuickLoading(false);
    }
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

  const depositTransfer = canDepositTransfer();
  const generator = canGenerate();
  const dispatcher = canDispatch();
  const receiver = canReceive();
  const providerDelivery = canProviderDelivery();

  // Garantías agrupadas por proveedor para el flujo de entrega al proveedor
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
              <h1 className="text-2xl font-black text-white">Remitos internos</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Control de traslado físico de garantías desde sucursal hacia depósito. REM no es ENV: acá solo se mueve mercadería internamente.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {generator && <span className="rounded-full bg-blue-500/20 px-3 py-1 font-semibold text-blue-200">Generación</span>}
                {dispatcher && <span className="rounded-full bg-amber-500/20 px-3 py-1 font-semibold text-amber-200">Despacho</span>}
                {receiver  && <span className="rounded-full bg-emerald-500/20 px-3 py-1 font-semibold text-emerald-200">Recepción</span>}
                {depositTransfer && <span className="rounded-full bg-cyan-500/20 px-3 py-1 font-semibold text-cyan-200">Movimiento depósito</span>}
                {providerDelivery && <span className="rounded-full bg-violet-500/20 px-3 py-1 font-semibold text-violet-200">Entrega proveedor</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recepción */}
      {receiver && (
        <section className="rounded-3xl border border-emerald-500/30 bg-slate-950 p-5 shadow-xl shadow-emerald-950/10">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-emerald-200">
                <PackageCheck className="h-5 w-5" />
                Recepción en depósito
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Usá el código impreso en el PDF para confirmar la llegada. Esto actualiza la ubicación de todas las garantías del remito.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              Paso final: <strong>producto recibido</strong>
            </div>
          </div>
          <form onSubmit={handleQuickAccept} className="space-y-3">
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
                {quickLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : 'Confirmar llegada'}
              </button>
            </div>
            {quickError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />{quickError}
              </div>
            )}
            {quickResult && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-sm text-emerald-100">
                <CheckCircle2 className="h-4 w-4 shrink-0" />{quickResult}
              </div>
            )}
          </form>
        </section>
      )}

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

            {transferLoading && <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />Cargando garantías en depósito...</div>}

            {!transferLoading && transferAvailable.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
                <div className="flex flex-col gap-2 border-b border-slate-700 px-4 py-3 sm:flex-row sm:items-center">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={transferSelected.size === transferAvailable.length} onChange={toggleTransferAll} />
                    <span className="text-sm font-bold text-white">{transferSelected.size > 0 ? `${transferSelected.size} de ${transferAvailable.length} seleccionadas` : `${transferAvailable.length} garantías disponibles en depósito`}</span>
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
                          {w.marca && <span className="text-[10px] uppercase tracking-wide text-slate-500">{w.marca}</span>}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {w.sku && <span>SKU: {w.sku}</span>}
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
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">No hay garantías disponibles para mover desde tu depósito.</div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-400">Nota para el movimiento (opcional)</span>
              <input className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none" placeholder="Ej: traslado a guarda / estantería" value={transferNota} onChange={(e) => setTransferNota(e.target.value)} />
            </label>

            {transferError && <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{transferError}</div>}
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
              {transferLoading ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Truck className="mr-2 inline h-4 w-4" />}Generar movimiento interno
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
                          {w.marca && <span className="text-[10px] uppercase tracking-wide text-slate-500">{w.marca}</span>}
                          {w.deposito && <span className="text-[10px] text-slate-500"><MapPin className="mr-0.5 inline h-3 w-3" />{w.deposito}</span>}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {w.sku && <span>SKU: {w.sku}</span>}
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
                        <button type="button" onClick={() => handleDownloadPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500">
                          <Download className="h-3.5 w-3.5" /> PDF
                        </button>
                        <button type="button" onClick={() => printRemitoPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
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
              disabled={pdLoading || pdSelected.size === 0}
              className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pdLoading ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Send className="mr-2 inline h-4 w-4" />}
              Generar remito de entrega al proveedor
            </button>
          </form>
        </section>
      )}

      {/* Despacho / generación */}
      {generator && (
        <section className="rounded-3xl border border-blue-500/30 bg-slate-950 p-5 shadow-xl shadow-blue-950/10">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-blue-200">
                <FileText className="h-5 w-5" />
                Despacho sucursal → depósito
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Seleccioná la sucursal, elegí las garantías disponibles y generá el PDF para acompañar el bulto.
              </p>
            </div>
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
              El PDF usa el logo de la empresa de la sucursal origen.
            </div>
          </div>

          <form onSubmit={handleGenerate} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto]">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">
                  Sucursal de origen <span className="text-red-400">*</span>
                </label>
                {lockOriginBranch ? (
                  <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 px-3 py-3 text-sm font-bold text-blue-100">
                    {userBranchName}
                    <div className="mt-1 text-xs font-normal text-blue-200/80">Tu usuario opera siempre desde esta sucursal.</div>
                  </div>
                ) : (options?.sucursales ?? []).length > 0 ? (
                  <select
                    className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
                    value={genSucursal}
                    onChange={(e) => { setGenSucursal(e.target.value); loadAvailableWarranties(e.target.value); }}
                  >
                    <option value="">— Seleccioná sucursal —</option>
                    {(options?.sucursales ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    placeholder="Nombre de la sucursal"
                    value={genSucursal}
                    onChange={(e) => setGenSucursal(e.target.value)}
                    onBlur={(e) => loadAvailableWarranties(e.target.value)}
                  />
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Destino de garantías</label>
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm font-bold text-emerald-100">
                  {centralDepositName}
                  <div className="mt-1 text-xs font-normal text-emerald-200/80">Las sucursales siempre remiten garantías a Chiclana.</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => loadAvailableWarranties(genSucursal)}
                disabled={!genSucursal.trim() || availableLoading}
                className="self-end rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${availableLoading ? 'animate-spin' : ''}`} />
                  Ver disponibles
                </span>
              </button>
            </div>

            {availableLoading && (
              <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
                <RefreshCw className="h-4 w-4 animate-spin" /> Cargando garantías disponibles...
              </div>
            )}

            {!availableLoading && availableWarranties.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
                <div className="flex flex-col gap-2 border-b border-slate-700 px-4 py-3 sm:flex-row sm:items-center">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-500"
                      checked={selectedCodes.size === availableWarranties.length}
                      onChange={toggleAll}
                    />
                    <span className="text-sm font-bold text-white">
                      {selectedCodes.size > 0
                        ? `${selectedCodes.size} de ${availableWarranties.length} seleccionadas`
                        : `${availableWarranties.length} garantías disponibles`}
                    </span>
                  </label>
                  <span className="text-xs text-slate-500 sm:ml-auto">Solo aparecen garantías en sucursal, sin remito activo.</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
                  {availableWarranties.map((w) => (
                    <label
                      key={w.warranty_code}
                      className={`flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-800/70 ${selectedCodes.has(w.warranty_code) ? 'bg-blue-950/30' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-blue-500"
                        checked={selectedCodes.has(w.warranty_code)}
                        onChange={() => toggleCode(w.warranty_code)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-black text-white">{w.warranty_code}</span>
                          {w.estado && <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">{w.estado}</span>}
                          {w.marca && <span className="text-[10px] uppercase tracking-wide text-slate-500">{w.marca}</span>}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {w.sku && <span>SKU: {w.sku}</span>}
                          {w.serie && <span>Serie: {w.serie}</span>}
                          {w.falla && <span>Falla: {w.falla}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!availableLoading && genSucursal && availableWarranties.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-400">
                No hay garantías disponibles para remito interno en <strong className="text-slate-200">{genSucursal}</strong>.
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400">Nota para el remito (opcional)</label>
              <input
                className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                placeholder="Ej: viaje del miércoles / bulto 2"
                value={genNota}
                onChange={(e) => setGenNota(e.target.value)}
              />
            </div>

            {genError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />{genError}
              </div>
            )}

            {genResult && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                <div className="mb-3 flex items-center gap-2 font-bold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  {genResult.count === 1 ? 'Remito generado' : `${genResult.count} remitos generados`}
                </div>
                <div className="space-y-2">
                  {genResult.remitos.map((r) => (
                    <div key={r.remito_code} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-slate-950 px-3 py-2">
                      <div>
                        <span className="font-mono text-sm font-black text-white">{r.remito_code}</span>
                        <span className="ml-3 text-xs text-slate-400">
                          {r.warranties_count} producto{r.warranties_count !== 1 ? 's' : ''} · {r.origen_sucursal} → {r.destino_deposito}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleDownloadPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                          <Download className="h-3.5 w-3.5" /> PDF
                        </button>
                        <button type="button" onClick={() => printRemitoPdf(r.remito_code)} className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
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
              disabled={genLoading || !genDestino.trim() || !genSucursal.trim()}
              className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {genLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {selectedCodes.size > 0 ? `Generar remito (${selectedCodes.size})` : 'Generar remito interno'}
            </button>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Flujo operativo</h3>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><span className="rounded-full bg-slate-600/40 px-2 py-0.5 font-semibold text-slate-300">PENDIENTE</span>PDF generado</span>
          <ArrowRight className="h-3 w-3 text-slate-600" />
          <span className="flex items-center gap-1.5"><span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">EN TRÁNSITO</span>Salió del origen</span>
          <ArrowRight className="h-3 w-3 text-slate-600" />
          <span className="flex items-center gap-1.5"><span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-300">LLEGADO</span>Recibido en depósito</span>
        </div>
        <p className="mt-2 text-xs text-slate-500"><Clock className="mr-1 inline h-3 w-3" />El remito interno acompaña el bulto. No reemplaza ENV ni gestión con proveedor.</p>
      </section>
    </div>
  );
}
