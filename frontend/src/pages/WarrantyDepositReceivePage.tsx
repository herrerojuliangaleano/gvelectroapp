import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  PackageCheck,
  Plus,
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
  fetchWarrantyOptions,
  generateDepositTransferRemito,
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
  erpBtnPrimary,
} from '../components/ProUI';
import { canCrossSelectBranches } from '../branchAccess';
import { WarrantyQuickCreateModal } from '../components/WarrantyQuickCreateModal';
import type {
  AvailableWarrantyForRemito,
  WarrantyOptions,
  WarrantyRemitoInfo,
  WarrantySummary,
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
  const win = window.open(url, '_blank');
  if (win) {
    win.addEventListener('load', () => {
      setTimeout(() => {
        win.print();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }, 400);
    });
  } else {
    const a = document.createElement('a');
    a.href = url; a.download = `${remitoCode}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function WarrantyDepositReceivePage() {
  const currentUser = getCurrentUserFromStorage();
  const hasCrossSelect = canCrossSelectBranches(currentUser);

  // ── Alta de garantía (cliente que llega directo al depósito) ──────────────
  const [showCreate, setShowCreate] = useState(false);
  const [warrantyOptions, setWarrantyOptions] = useState<WarrantyOptions | null>(null);

  // ── Remitos en tránsito ───────────────────────────────────────────────────
  const [transitRemitos, setTransitRemitos] = useState<WarrantyRemitoInfo[]>([]);
  const [transitLoading, setTransitLoading] = useState(false);
  const [transitError,   setTransitError]   = useState('');

  // ── Confirmación rápida (código manual) ───────────────────────────────────
  const [quickCode,    setQuickCode]    = useState('');
  const [quickLugar,   setQuickLugar]   = useState('');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError,   setQuickError]   = useState('');
  const [recentConfirmed, setRecentConfirmed] = useState<string[]>([]);

  // ── Movimiento depósito → depósito ────────────────────────────────────────
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    loadTransitRemitos();
    if (canDepositTransfer()) loadDepositTransferOptions();
    if (can('warranties.create')) {
      fetchWarrantyOptions().then(setWarrantyOptions).catch(() => undefined);
    }
  }, []);

  // Al cambiar el origen, recargar garantías disponibles para ESE origen
  useEffect(() => {
    if (!canDepositTransfer()) return;
    if (!transferOrigen) {
      setTransferAvailable([]);
      return;
    }
    loadAvailableForOrigen(transferOrigen);
  }, [transferOrigen]);

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

  async function loadDepositTransferOptions() {
    setTransferLoading(true);
    setTransferError('');
    try {
      const opts = await fetchDepositTransferOptions();
      const posibles = opts.origenes_posibles ?? [];
      setTransferOrigenes(posibles);
      setTransferDestinos(opts.destinos || []);
      const defaultOrigen = opts.origen_deposito || (posibles.length === 1 ? posibles[0].name : '');
      setTransferOrigen(defaultOrigen);
      setTransferDestino((cur) => cur || opts.destinos?.[0]?.name || '');
    } catch (e: unknown) {
      setTransferError((e as Error).message || 'No se pudo cargar movimiento entre depósitos.');
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
    if (!transferOrigen.trim()) { setTransferError('Seleccioná el depósito de origen.'); return; }
    if (!transferDestino.trim()) { setTransferError('Seleccioná depósito destino.'); return; }
    if (transferDestino.trim().toLowerCase() === transferOrigen.trim().toLowerCase()) {
      setTransferError('El destino debe ser distinto del origen.'); return;
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
      setTimeout(() => URL.revokeObjectURL(url), 2000);
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

  // ── Estadísticas rápidas ──────────────────────────────────────────────────
  const lateCount = transitRemitos.filter((r) => {
    const d = daysSince(r.fecha_despacho || r.created_at);
    return d !== null && d >= 2;
  }).length;

  const byBranch = useMemo(() => {
    const acc: Record<string, { count: number; maxDays: number; hasLate: boolean }> = {};
    for (const r of transitRemitos) {
      const key = r.origen_sucursal || 'Sin sucursal';
      if (!acc[key]) acc[key] = { count: 0, maxDays: 0, hasLate: false };
      acc[key].count++;
      const days = daysSince(r.fecha_despacho || r.created_at) ?? 0;
      if (days > acc[key].maxDays) acc[key].maxDays = days;
      if (days >= 2) acc[key].hasLate = true;
    }
    return acc;
  }, [transitRemitos]);

  const destinosFiltrados = useMemo(
    () => transferDestinos.filter((d) => d.name.trim().toLowerCase() !== transferOrigen.trim().toLowerCase()),
    [transferDestinos, transferOrigen],
  );

  const noPermissions = !canReceive() && !canDepositTransfer();

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Recepción en depósito"
        description="Confirmá la llegada de remitos entrantes, cargá garantías de clientes que llegan al depósito y gestioná movimientos entre depósitos."
        actions={
          <>
            {can('warranties.create') && (
              <button type="button" onClick={() => setShowCreate(true)} className={erpBtnPrimary}>
                <Plus size={14} /> Nueva garantía
              </button>
            )}
            <button type="button" onClick={loadTransitRemitos} disabled={transitLoading} className={erpBtnGhost}>
              <RefreshCw size={14} className={transitLoading ? 'erp-spin' : ''} /> Actualizar
            </button>
          </>
        }
      />

      {/* KPIs */}
      <section className="erp-kpi-row" aria-label="Resumen de recepción">
        <ErpKpiCard
          label="En tránsito"
          value={transitRemitos.length}
          detail={transitRemitos.length > 0 ? 'Esperando confirmación de llegada' : 'Sin remitos en camino'}
          variant={transitRemitos.length > 0 ? 'alert' : 'default'}
          icon={<Truck size={13} />}
        />
        <ErpKpiCard
          label="Demorados (≥2d)"
          value={lateCount}
          detail={lateCount > 0 ? 'Coordinar con la sucursal origen' : 'Sin atrasos'}
          variant={lateCount > 0 ? 'danger' : 'default'}
          icon={<AlertTriangle size={13} />}
        />
        <ErpKpiCard
          label="Confirmados (sesión)"
          value={recentConfirmed.length}
          detail={recentConfirmed.length > 0 ? 'Recibidos durante esta sesión' : 'Sin confirmaciones aún'}
          variant={recentConfirmed.length > 0 ? 'success' : 'default'}
          icon={<CheckCircle2 size={13} />}
        />
        {canDepositTransfer() && (
          <ErpKpiCard
            label="Depósitos accesibles"
            value={transferOrigenes.length}
            detail={hasCrossSelect ? 'Acceso multi-sucursal' : transferOrigenes.length === 1 ? 'Único depósito asignado' : transferOrigenes.length > 1 ? 'Multi-asignación' : 'Sin depósitos asignados'}
            variant={transferOrigenes.length === 0 ? 'danger' : 'default'}
          />
        )}
      </section>

      {noPermissions && (
        <ErpCard>
          <div className="erp-empty-state" style={{ border: 0, background: 'transparent', padding: 0 }}>
            <div className="erp-empty-icon"><PackageCheck size={20} /></div>
            <h4 className="erp-empty-title">Sin operaciones disponibles</h4>
            <p className="erp-empty-description">
              Tu usuario no tiene los permisos <strong>warranties.remitos.receive</strong> ni <strong>warranties.remitos.deposit_transfer</strong>. Pedile a un administrador que te los asigne si necesitás operar.
            </p>
          </div>
        </ErpCard>
      )}

      {/* Confirmaciones recientes */}
      {recentConfirmed.length > 0 && (
        <div className="erp-stack-2">
          {recentConfirmed.map((msg, i) => (
            <ErpNotice key={i} tone="success">{msg}</ErpNotice>
          ))}
        </div>
      )}

      {/* ── Confirmar por código ─────────────────────────────────────────── */}
      {canReceive() && (
        <ErpCard
          title={<span className="inline-flex items-center gap-2"><PackageCheck size={14} /> Confirmar llegada por código</span>}
          subtitle="Ingresá el código del PDF impreso para registrar la recepción del remito."
        >
          <form onSubmit={handleQuickConfirm} className="erp-stack-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]">
              <ErpField label="Código del remito" required>
                <ErpInput
                  value={quickCode}
                  onChange={(e) => setQuickCode(e.target.value.toUpperCase())}
                  placeholder="Ej. GV-R-2026-0001"
                  style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}
                />
              </ErpField>
              <ErpField label="Ubicación interna (opcional)">
                <ErpInput
                  value={quickLugar}
                  onChange={(e) => setQuickLugar(e.target.value)}
                  placeholder="Ej. Estante A3"
                />
              </ErpField>
              <ErpField label="">
                <ErpButton
                  type="submit"
                  variant="primary"
                  disabled={!quickCode.trim()}
                  loading={quickLoading}
                  leftIcon={<CheckCircle2 size={14} />}
                >
                  Confirmar
                </ErpButton>
              </ErpField>
            </div>
            {quickError && <ErpNotice tone="error">{quickError}</ErpNotice>}
          </form>
        </ErpCard>
      )}

      {/* ── Remitos en tránsito ──────────────────────────────────────────── */}
      <ErpCard
        title={<span className="inline-flex items-center gap-2"><Truck size={14} /> Remitos en tránsito</span>}
        subtitle="Remitos despachados que están en camino hacia tu depósito."
      >
        {lateCount > 0 && (
          <div className="mb-3">
            <ErpNotice tone="error" title={`${lateCount} remito${lateCount !== 1 ? 's' : ''} demorado${lateCount !== 1 ? 's' : ''}`}>
              Lleva{lateCount === 1 ? '' : 'n'} más de 2 días en tránsito sin confirmación. Coordiná con la sucursal de origen.
            </ErpNotice>
          </div>
        )}

        {transitLoading && transitRemitos.length === 0 && <ErpLoadingState />}

        {!transitLoading && transitError && <ErpNotice tone="error">{transitError}</ErpNotice>}

        {!transitLoading && !transitError && transitRemitos.length === 0 && (
          <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] py-6 text-center">
            <CheckCircle2 className="mx-auto mb-2" size={20} style={{ color: 'var(--success-soft-text)' }} />
            <div className="text-[12.5px] text-[color:var(--text-2)]">No hay remitos en tránsito hacia tu depósito.</div>
          </div>
        )}

        {!transitLoading && transitRemitos.length > 0 && (
          <div className="erp-stack-2">
            {Object.entries(byBranch)
              .sort((a, b) => b[1].maxDays - a[1].maxDays)
              .map(([branch, info]) => (
                <div
                  key={branch}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                  style={info.hasLate
                    ? { borderColor: 'rgba(239,68,68,0.32)', background: 'var(--danger-soft)' }
                    : { borderColor: 'var(--border)', background: 'var(--surface-2)' }
                  }
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Truck size={14} className={info.hasLate ? 'text-[color:var(--danger-soft-text)]' : 'text-[color:var(--warning-soft-text)]'} />
                    <span className="truncate font-semibold text-[13px] text-[color:var(--text)]">{branch}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ErpBadge tone={info.hasLate ? 'danger' : 'warning'}>
                      {info.count} en tránsito
                    </ErpBadge>
                    {info.maxDays >= 2 ? (
                      <ErpBadge tone="solid-danger">
                        {info.maxDays}d
                      </ErpBadge>
                    ) : info.maxDays > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-2)] tabular-nums">
                        <Clock size={10} />{info.maxDays}d
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            <p className="mt-1 text-center text-[11.5px] text-[color:var(--text-3)]">
              Usá el código impreso en el remito para confirmar la llegada arriba ↑
            </p>
          </div>
        )}
      </ErpCard>

      {/* ── Movimiento depósito → depósito ───────────────────────────────── */}
      {canDepositTransfer() && (
        <ErpCard
          title={<span className="inline-flex items-center gap-2"><Truck size={14} /> Movimiento depósito → depósito</span>}
          subtitle="Mové garantías que están físicamente en un depósito hacia otro depósito de guarda."
          actions={
            <button type="button" onClick={loadDepositTransferOptions} disabled={transferLoading} className={erpBtnGhost}>
              <RefreshCw size={14} className={transferLoading ? 'erp-spin' : ''} /> Actualizar
            </button>
          }
        >
          <form onSubmit={handleDepositTransfer} className="erp-stack-3">
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

            {!transferOrigen && transferOrigenes.length === 0 && (
              <ErpNotice tone="error" title="Tu usuario no tiene depósitos asignados">
                Asigná tu usuario a una sucursal tipo <strong>depósito</strong> en <strong>Empresas y sucursales</strong>, o pedile a un admin que te dé <strong>branches.cross_select</strong>.
              </ErpNotice>
            )}

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
                          key={w.warranty_code}
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
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <ErpField label="Nota (opcional)">
              <ErpInput value={transferNota} onChange={(e) => setTransferNota(e.target.value)} placeholder="Ej: traslado a guarda / estantería" />
            </ErpField>

            {transferError && <ErpNotice tone="error">{transferError}</ErpNotice>}

            {transferResult && (
              <ErpNotice tone="success" title={`${transferResult.count} remito${transferResult.count === 1 ? '' : 's'} generado${transferResult.count === 1 ? '' : 's'}`}>
                <div className="mt-1 erp-stack-2">
                  {transferResult.remitos.map((r) => (
                    <div key={r.remito_code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2">
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

      {/* Scope indicator */}
      {!noPermissions && (
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

      <WarrantyQuickCreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { loadTransitRemitos(); }}
        options={warrantyOptions}
        defaultSucursal={currentUser?.branch_name || currentUser?.sucursal || ''}
        centralDeposit={warrantyOptions?.warranty_central_deposit?.name || currentUser?.branch_name || ''}
      />
    </div>
  );
}
