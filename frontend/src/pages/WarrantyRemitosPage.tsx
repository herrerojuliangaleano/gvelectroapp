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
  getCurrentUserFromStorage,
} from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpField,
  ErpInput,
  ErpKpiCard,
  ErpLoadingState,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  ErpTag,
  erpBtnGhost,
} from '../components/ProUI';
import { canCrossSelectBranches } from '../branchAccess';
import type {
  AvailableWarrantyForRemito,
  ProviderDeliveryWarranty,
  WarrantyRemitoInfo,
} from '../types';

// ── Permisos ──────────────────────────────────────────────────────────────────
const canDepositTransfer  = () => can('warranties.remitos.deposit_transfer');
const canProviderDelivery = () => can('warranties.remitos.provider_delivery');

// ── PDF helpers ───────────────────────────────────────────────────────────────

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

export function WarrantyRemitosPage({
  embedded = false,
  section = 'all',
}: {
  embedded?: boolean;
  /** Qué secciones mostrar:
   *  - 'all': movimiento depósito→depósito + entrega a proveedor (default).
   *  - 'transfer': solo movimiento entre depósitos (operación de depósito).
   *  - 'provider': solo entrega a proveedor (posventa). */
  section?: 'all' | 'transfer' | 'provider';
} = {}) {
  const currentUser = getCurrentUserFromStorage();
  const hasCrossSelect = canCrossSelectBranches(currentUser);
  const showTransfer = section === 'all' || section === 'transfer';
  const showProvider = section === 'all' || section === 'provider';

  // Origen + destinos posibles del backend
  const [transferOrigen,    setTransferOrigen]    = useState('');
  const [transferOrigenes,  setTransferOrigenes]  = useState<Array<{ id: string; name: string; code: string; company_id: string }>>([]);
  const [transferDestinos,  setTransferDestinos]  = useState<Array<{ id: string; name: string; code: string; company_id: string }>>([]);
  const [transferDestino,   setTransferDestino]   = useState('');
  const [transferNota,      setTransferNota]      = useState('');
  const [transferAvailable, setTransferAvailable] = useState<AvailableWarrantyForRemito[]>([]);
  const [transferSelected,  setTransferSelected]  = useState<Set<string>>(new Set());
  const [transferLoading,   setTransferLoading]   = useState(false);
  const [transferError,     setTransferError]     = useState('');
  const [transferResult,    setTransferResult]    = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);

  // Entrega al proveedor
  const [pdWarranties,      setPdWarranties]      = useState<ProviderDeliveryWarranty[]>([]);
  const [pdLoading,         setPdLoading]         = useState(false);
  const [pdError,           setPdError]           = useState('');
  const [pdResult,          setPdResult]          = useState<{ count: number; remitos: WarrantyRemitoInfo[] } | null>(null);
  const [pdSelected,        setPdSelected]        = useState<Set<string>>(new Set());
  const [pdFilterProvider,  setPdFilterProvider]  = useState('');
  const [pdNota,            setPdNota]            = useState('');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    if (canDepositTransfer()) loadDepositTransferOptions();
    if (canProviderDelivery()) loadProviderDelivery();
  }, []);

  // Cuando cambia el origen, recargar las garantías disponibles para ESE origen
  useEffect(() => {
    if (!canDepositTransfer()) return;
    if (!transferOrigen) {
      setTransferAvailable([]);
      return;
    }
    loadAvailableForOrigen(transferOrigen);
  }, [transferOrigen]);

  // ── Loaders ───────────────────────────────────────────────────────────────

  async function loadDepositTransferOptions() {
    setTransferLoading(true);
    setTransferError('');
    try {
      const opts = await fetchDepositTransferOptions();
      const posibles = opts.origenes_posibles ?? [];
      setTransferOrigenes(posibles);
      setTransferDestinos(opts.destinos || []);
      // Default: el origen sugerido por el backend, o el único posible.
      const defaultOrigen = opts.origen_deposito || (posibles.length === 1 ? posibles[0].name : '');
      setTransferOrigen(defaultOrigen);
      setTransferDestino((current) => current || opts.destinos?.[0]?.name || '');
    } catch (e: unknown) {
      setTransferError((e as Error).message || 'No se pudo cargar la operación de depósito');
    } finally {
      setTransferLoading(false);
    }
  }

  async function loadAvailableForOrigen(origen: string) {
    setTransferLoading(true);
    setTransferError('');
    try {
      const available = await fetchAvailableWarrantiesForDepositTransfer(origen);
      setTransferAvailable(available.items || []);
      setTransferSelected(new Set());
    } catch (e: unknown) {
      setTransferAvailable([]);
      setTransferError((e as Error).message || 'No se pudieron cargar las garantías del depósito');
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
    if (!transferOrigen.trim()) { setTransferError('Seleccioná el depósito de origen.'); return; }
    if (!transferDestino.trim()) { setTransferError('Seleccioná el depósito destino.'); return; }
    if (transferDestino.trim().toLowerCase() === transferOrigen.trim().toLowerCase()) {
      setTransferError('El depósito destino debe ser distinto del origen.'); return;
    }
    if (transferSelected.size === 0) { setTransferError('Seleccioná al menos una garantía para mover.'); return; }
    setTransferLoading(true);
    setTransferError('');
    setTransferResult(null);
    try {
      const res = await generateDepositTransferRemito({
        destino_deposito: transferDestino.trim(),
        warranty_codes: Array.from(transferSelected),
        nota: transferNota.trim() || undefined,
        origen_deposito: transferOrigen.trim(),
      });
      setTransferResult({ count: res.count, remitos: res.remitos });
      setTransferNota('');
      await loadAvailableForOrigen(transferOrigen);
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
      if (next.has(code)) next.delete(code); else next.add(code);
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
      if (next.has(code)) next.delete(code); else next.add(code);
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

  // Filtrar destinos: no puedo mover hacia el mismo origen
  const destinosFiltrados = useMemo(
    () => transferDestinos.filter((d) => d.name.trim().toLowerCase() !== transferOrigen.trim().toLowerCase()),
    [transferDestinos, transferOrigen],
  );

  const sinPermisos = !depositTransfer && !providerDelivery;

  return (
    <div className="erp-stack-6">
      {!embedded && (
        <ErpPageHeader
          title="Operaciones de remitos"
          description="Generá movimientos internos entre depósitos y remitos de entrega al proveedor. Cada operación requiere su permiso correspondiente."
          actions={
            <>
              {depositTransfer && (
                <button type="button" onClick={loadDepositTransferOptions} disabled={transferLoading} className={erpBtnGhost}>
                  <RefreshCw size={14} className={transferLoading ? 'erp-spin' : ''} /> Actualizar depósito
                </button>
              )}
              {providerDelivery && (
                <button type="button" onClick={loadProviderDelivery} disabled={pdLoading} className={erpBtnGhost}>
                  <RefreshCw size={14} className={pdLoading ? 'erp-spin' : ''} /> Actualizar proveedor
                </button>
              )}
            </>
          }
        />
      )}

      <section className="erp-kpi-row" aria-label="Resumen">
        {depositTransfer && showTransfer && (
          <>
            <ErpKpiCard
              label="Depósitos accesibles"
              value={transferOrigenes.length}
              detail={hasCrossSelect ? 'Acceso multi-sucursal por permiso' : transferOrigenes.length > 1 ? 'Multi-asignación' : transferOrigenes.length === 1 ? 'Único depósito asignado' : 'Sin depósitos asignados'}
              variant={transferOrigenes.length === 0 ? 'danger' : 'default'}
              icon={<Building2 size={13} />}
            />
            <ErpKpiCard
              label="Garantías en origen"
              value={transferOrigen ? transferAvailable.length : '—'}
              detail={transferOrigen ? `Disponibles para mover desde ${transferOrigen}` : 'Elegí un depósito de origen'}
              icon={<Truck size={13} />}
            />
            <ErpKpiCard
              label="Seleccionadas"
              value={transferSelected.size}
              detail={transferSelected.size > 0 ? `de ${transferAvailable.length} disponibles` : 'Marcá garantías para mover'}
              variant={transferSelected.size > 0 ? 'alert' : 'default'}
            />
          </>
        )}
        {providerDelivery && showProvider && (
          <ErpKpiCard
            label="Listas para proveedor"
            value={pdWarranties.length}
            detail={pdProviders.size > 0 ? `${pdProviders.size} proveedor${pdProviders.size === 1 ? '' : 'es'}` : 'Sin retiros confirmados'}
            icon={<Building2 size={13} />}
          />
        )}
      </section>

      {sinPermisos && (
        <ErpCard>
          <div className="erp-empty-state" style={{ border: 0, background: 'transparent', padding: 0 }}>
            <div className="erp-empty-icon"><Truck size={20} /></div>
            <h4 className="erp-empty-title">Sin operaciones disponibles</h4>
            <p className="erp-empty-description">Tu usuario no tiene los permisos <strong>warranties.remitos.deposit_transfer</strong> ni <strong>warranties.remitos.provider_delivery</strong>. Pedile a un administrador que te los asigne si necesitás operar.</p>
          </div>
        </ErpCard>
      )}

      {/* ── Movimiento depósito → depósito ───────────────────────────────── */}
      {depositTransfer && showTransfer && (
        <ErpCard
          title={<span className="inline-flex items-center gap-2"><Truck size={14} /> Movimiento depósito → depósito</span>}
          subtitle="Permite mover garantías que ya están físicamente en un depósito hacia otro depósito de guarda."
        >
          <form onSubmit={handleDepositTransfer} className="erp-stack-3">
            {/* Origen y destino: selector cuando hay opciones múltiples */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ErpField label="Depósito de origen" required hint={hasCrossSelect ? 'Tenés acceso multi-sucursal: podés operar cualquier depósito.' : transferOrigenes.length > 1 ? `Tenés ${transferOrigenes.length} depósitos asignados.` : undefined}>
                {transferOrigenes.length > 1 || (hasCrossSelect && transferOrigenes.length > 0) ? (
                  <ErpSelect value={transferOrigen} onChange={(e) => setTransferOrigen(e.target.value)}>
                    <option value="">— Elegí depósito de origen —</option>
                    {transferOrigenes.map((d) => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
                  </ErpSelect>
                ) : transferOrigen ? (
                  <div className="erp-info-row" style={{ borderColor: 'var(--primary)', background: 'var(--primary-soft)' }}>
                    <span className="erp-info-label">Asignado</span>
                    <span className="erp-info-value">{transferOrigen}</span>
                  </div>
                ) : (
                  <ErpInput value="" disabled placeholder="Sin depósito disponible" />
                )}
              </ErpField>
              <ErpField label="Depósito destino" required>
                <ErpSelect value={transferDestino} onChange={(e) => setTransferDestino(e.target.value)} disabled={!transferOrigen}>
                  <option value="">— Elegí depósito destino —</option>
                  {destinosFiltrados.map((d) => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
                </ErpSelect>
              </ErpField>
            </div>

            {/* Si no hay origen, explicación clara */}
            {!transferOrigen && transferOrigenes.length === 0 && (
              <ErpNotice tone="error" title="Tu usuario no tiene depósitos asignados">
                Asigná tu usuario a una sucursal de tipo <strong>depósito</strong> en <strong>Empresas y sucursales</strong>, o pedile a un admin que te dé el permiso <strong>branches.cross_select</strong> para operar todos los depósitos.
              </ErpNotice>
            )}

            {/* Lista de garantías disponibles */}
            {transferOrigen && (
              <>
                {transferLoading && transferAvailable.length === 0 ? (
                  <ErpLoadingState title={`Cargando garantías de ${transferOrigen}`} />
                ) : transferAvailable.length === 0 ? (
                  <ErpNotice tone="info">No hay garantías disponibles para mover desde <strong>{transferOrigen}</strong>.</ErpNotice>
                ) : (
                  <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="flex flex-col gap-2 border-b border-[color:var(--border)] px-3 py-2 sm:flex-row sm:items-center">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" className="erp-checkbox" checked={transferSelected.size === transferAvailable.length} onChange={toggleTransferAll} />
                        <span className="text-[12.5px] font-semibold">
                          {transferSelected.size > 0
                            ? `${transferSelected.size} de ${transferAvailable.length} seleccionadas`
                            : `${transferAvailable.length} disponibles`}
                        </span>
                      </label>
                      <span className="text-[11.5px] text-[color:var(--text-3)] sm:ml-auto">Origen: <strong>{transferOrigen}</strong></span>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {transferAvailable.map((w) => (
                        <label
                          key={`transfer-${w.warranty_code}`}
                          className={`flex cursor-pointer items-start gap-3 border-b border-[color:var(--divider)] px-3 py-2.5 transition-colors last:border-b-0 ${transferSelected.has(w.warranty_code) ? 'bg-[color:var(--primary-soft)]' : 'hover:bg-[color:var(--surface-hover)]'}`}
                        >
                          <input type="checkbox" className="erp-checkbox mt-1" checked={transferSelected.has(w.warranty_code)} onChange={() => toggleTransferCode(w.warranty_code)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="erp-cell-mono text-[12.5px] font-semibold">{w.warranty_code}</span>
                              {w.estado && <ErpBadge tone="neutral" withDot={false}>{w.estado}</ErpBadge>}
                              {w.marca && <span className="text-[10.5px] uppercase tracking-wide text-[color:var(--text-3)]">{w.marca}</span>}
                            </div>
                            <div className="mt-0.5 text-[12.5px] text-[color:var(--text)] truncate">{w.producto || 'Producto sin nombre'}</div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[color:var(--text-3)]">
                              {w.sku && <span>SKU: {w.sku}</span>}
                              {w.serie && <span>Serie: {w.serie}</span>}
                              {w.falla && <span className="truncate">Falla: {w.falla}</span>}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <ErpField label="Nota para el movimiento (opcional)">
              <ErpInput value={transferNota} onChange={(e) => setTransferNota(e.target.value)} placeholder="Ej: traslado a guarda / estantería" />
            </ErpField>

            {transferError && <ErpNotice tone="error">{transferError}</ErpNotice>}

            {transferResult && (
              <ErpNotice tone="success" title={`${transferResult.count} remito${transferResult.count === 1 ? '' : 's'} generado${transferResult.count === 1 ? '' : 's'}`}>
                <div className="mt-1 erp-stack-2">
                  {transferResult.remitos.map((r) => (
                    <div key={`transfer-result-${r.remito_code}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2">
                      <div className="min-w-0">
                        <span className="font-mono text-[12.5px] font-semibold text-[color:var(--text)]">{r.remito_code}</span>
                        <span className="ml-2 text-[11.5px] text-[color:var(--text-2)]">{r.origen_sucursal} <ArrowRight size={10} className="inline align-middle" /> {r.destino_deposito}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <ErpButton size="sm" variant="secondary" leftIcon={<Download size={12} />} onClick={() => handleDownloadPdf(r.remito_code)}>PDF</ErpButton>
                        <ErpButton size="sm" variant="primary" leftIcon={<Printer size={12} />} onClick={() => printRemitoPdf(r.remito_code)}>Imprimir</ErpButton>
                      </div>
                    </div>
                  ))}
                </div>
              </ErpNotice>
            )}

            <div className="erp-form-actions">
              <ErpButton
                type="submit"
                variant="primary"
                disabled={!transferOrigen || !transferDestino.trim() || transferSelected.size === 0}
                loading={transferLoading}
                leftIcon={<Truck size={14} />}
              >
                {transferSelected.size > 0 ? `Generar movimiento (${transferSelected.size})` : 'Generar movimiento interno'}
              </ErpButton>
            </div>
          </form>
        </ErpCard>
      )}

      {/* ── Entrega al proveedor ─────────────────────────────────────────── */}
      {providerDelivery && showProvider && (
        <ErpCard
          title={<span className="inline-flex items-center gap-2"><Building2 size={14} /> Entrega al proveedor</span>}
          subtitle="Generá un remito para acompañar el traslado físico de garantías desde el depósito al proveedor. Solo aparecen garantías con retiro confirmado como listo."
        >
          <form onSubmit={handleProviderDelivery} className="erp-stack-3">
            {pdProviders.size > 1 && (
              <ErpField label="Filtrar por proveedor">
                <ErpSelect value={pdFilterProvider} onChange={(e) => { setPdFilterProvider(e.target.value); setPdSelected(new Set()); }}>
                  <option value="">— Todos los proveedores ({pdWarranties.length}) —</option>
                  {[...pdProviders.entries()].map(([prov, items]) => (
                    <option key={prov} value={prov}>{prov} ({items.length})</option>
                  ))}
                </ErpSelect>
              </ErpField>
            )}

            {pdLoading && pdFilteredWarranties.length === 0 ? (
              <ErpLoadingState title="Cargando garantías listas para proveedor" />
            ) : pdFilteredWarranties.length === 0 ? (
              <ErpNotice tone="info">No hay garantías listas para entrega al proveedor en este momento.</ErpNotice>
            ) : (
              <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="flex flex-col gap-2 border-b border-[color:var(--border)] px-3 py-2 sm:flex-row sm:items-center">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="erp-checkbox"
                      checked={pdFilteredWarranties.every((w) => pdSelected.has(w.warranty_code))}
                      onChange={() => togglePdAll(pdFilteredWarranties.map((w) => w.warranty_code))}
                    />
                    <span className="text-[12.5px] font-semibold">
                      {pdSelected.size > 0
                        ? `${pdSelected.size} seleccionada${pdSelected.size === 1 ? '' : 's'}`
                        : `${pdFilteredWarranties.length} lista${pdFilteredWarranties.length === 1 ? '' : 's'} para retiro`}
                    </span>
                  </label>
                  <span className="text-[11.5px] text-[color:var(--text-3)] sm:ml-auto inline-flex items-center gap-1">
                    <MapPin size={11} /> En depósito · Proveedor confirmó retiro
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {pdFilteredWarranties.map((w) => (
                    <label
                      key={`pd-${w.warranty_code}`}
                      className={`flex cursor-pointer items-start gap-3 border-b border-[color:var(--divider)] px-3 py-2.5 transition-colors last:border-b-0 ${pdSelected.has(w.warranty_code) ? 'bg-[color:var(--violet-soft)]' : 'hover:bg-[color:var(--surface-hover)]'}`}
                    >
                      <input type="checkbox" className="erp-checkbox mt-1" checked={pdSelected.has(w.warranty_code)} onChange={() => togglePdCode(w.warranty_code)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="erp-cell-mono text-[12.5px] font-semibold">{w.warranty_code}</span>
                          {w.provider_name && <ErpBadge tone="violet" withDot={false}>{w.provider_name}</ErpBadge>}
                          {w.marca && <span className="text-[10.5px] uppercase tracking-wide text-[color:var(--text-3)]">{w.marca}</span>}
                          {w.deposito && (
                            <span className="text-[10.5px] inline-flex items-center gap-0.5 text-[color:var(--text-3)]">
                              <MapPin size={9} />{w.deposito}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-[color:var(--text)] truncate">{w.producto || 'Producto sin nombre'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[color:var(--text-3)]">
                          {w.sku && <span>SKU: {w.sku}</span>}
                          {w.serie && <span>Serie: {w.serie}</span>}
                          {w.falla && <span className="truncate">Falla: {w.falla}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <ErpField label="Nota para el remito (opcional)">
              <ErpInput value={pdNota} onChange={(e) => setPdNota(e.target.value)} placeholder="Ej: urgente, coordinar con técnico" />
            </ErpField>

            {pdError && <ErpNotice tone="error">{pdError}</ErpNotice>}

            {pdResult && (
              <ErpNotice tone="success" title={`${pdResult.count} remito${pdResult.count === 1 ? '' : 's'} de entrega generado${pdResult.count === 1 ? '' : 's'}`}>
                <div className="mt-1 erp-stack-2">
                  {pdResult.remitos.map((r) => (
                    <div key={`pd-result-${r.remito_code}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2">
                      <div className="min-w-0">
                        <span className="font-mono text-[12.5px] font-semibold text-[color:var(--text)]">{r.remito_code}</span>
                        <span className="ml-2 text-[11.5px] text-[color:var(--text-2)]">{r.origen_sucursal} <ArrowRight size={10} className="inline align-middle" /> {r.destino_deposito}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <ErpButton size="sm" variant="secondary" leftIcon={<Download size={12} />} onClick={() => handleDownloadPdf(r.remito_code)}>PDF</ErpButton>
                        <ErpButton size="sm" variant="primary" leftIcon={<Printer size={12} />} onClick={() => printRemitoPdf(r.remito_code)}>Imprimir</ErpButton>
                      </div>
                    </div>
                  ))}
                </div>
              </ErpNotice>
            )}

            <div className="erp-form-actions">
              <ErpButton
                type="submit"
                variant="primary"
                disabled={pdSelected.size === 0}
                loading={pdLoading}
                leftIcon={<Send size={14} />}
              >
                {pdSelected.size > 0 ? `Generar remito de entrega (${pdSelected.size})` : 'Generar remito de entrega al proveedor'}
              </ErpButton>
            </div>
          </form>
        </ErpCard>
      )}

      {/* Indicador de scope al final */}
      {!sinPermisos && (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[color:var(--text-3)]">
          <ErpTag>Tu scope:</ErpTag>
          {transferOrigenes.length > 0 ? (
            transferOrigenes.slice(0, 6).map((d) => <ErpTag key={d.id || d.name}>{d.name}</ErpTag>)
          ) : (
            <span>Sin depósitos accesibles</span>
          )}
          {transferOrigenes.length > 6 && <ErpTag>+{transferOrigenes.length - 6}</ErpTag>}
          {hasCrossSelect && <ErpTag tone="primary">branches.cross_select</ErpTag>}
        </div>
      )}
    </div>
  );
}
