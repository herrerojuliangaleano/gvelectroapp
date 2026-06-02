import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Eye,
  FileText, MapPin, Package, Plus, Printer, RefreshCw, Send, Truck, X,
} from 'lucide-react';
import {
  can,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForRemito,
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
import { computeLogisticsAlerts, getWarrantyStatusMeta } from '../warrantyFlow';
import { isWarrantyPrivilegedUser } from '../warrantyAccess';
import { canCrossSelectBranches } from '../branchAccess';
import { WarrantyQuickCreateModal } from '../components/WarrantyQuickCreateModal';
import { WarrantyDetailDrawer } from '../components/WarrantyDetailDrawer';
import { useMobileFab } from '../components/MobileFab';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpDataTable,
  ErpField,
  ErpKpiCard,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  erpBtnGhost,
  erpBtnPrimary,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpColumn,
  type ErpRowAction,
} from '../components/ProUI';

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

function flowToneToBadgeTone(tone?: string): ErpBadgeTone {
  switch (tone) {
    case 'success': case 'green': return 'success';
    case 'warning': case 'amber': case 'yellow': return 'warning';
    case 'danger': case 'red': return 'danger';
    case 'info': case 'blue': case 'cyan': return 'info';
    case 'violet': case 'purple': return 'violet';
    default: return 'neutral';
  }
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

async function printPdf(code: string) {
  try {
    const blob = await downloadRemitoPdf(code);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => {
        setTimeout(() => { win.print(); setTimeout(() => URL.revokeObjectURL(url), 3000); }, 400);
      });
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = `${code}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  } catch (e: unknown) {
    alert((e as Error).message || 'Error al imprimir PDF');
  }
}

// ─── main page ────────────────────────────────────────────────────────────────

export function WarrantySucursalPage() {
  const currentUser  = getCurrentUserFromStorage();
  const branchName   = (currentUser?.branch_name || currentUser?.sucursal || '').trim();
  const isPrivileged = isWarrantyPrivilegedUser(currentUser) || canCrossSelectBranches(currentUser);
  const [selectedBranch, setSelectedBranch] = useState(branchName);
  const [showCreate, setShowCreate] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  useMobileFab(can('warranties.create') ? {
    label: 'Nueva garantía',
    icon: <Plus size={22} />,
    onClick: () => setShowCreate(true),
  } : null, []);

  // ── warranty list state ──
  const [data, setData]         = useState<WarrantyListResponse | null>(null);
  const [loadingW, setLoadingW] = useState(true);
  const [errorW, setErrorW]     = useState('');
  const [wTab, setWTab]         = useState<'pending' | 'transito' | 'done'>('pending');

  // ── remito / generate state ──
  const [options, setOptions]             = useState<WarrantyOptions | null>(null);
  const [showGen, setShowGen]             = useState(false);
  const [available, setAvailable]         = useState<AvailableWarrantyForRemito[]>([]);
  const [availLoading, setAvailLoading]   = useState(false);
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [genNota, setGenNota]             = useState('');
  const [genLoading, setGenLoading]       = useState(false);
  const [genError, setGenError]           = useState('');
  const [lastGenerated, setLastGenerated] = useState<WarrantyRemitoInfo[]>([]);

  async function loadWarranties() {
    setLoadingW(true);
    setErrorW('');
    try {
      const result = await fetchWarranties({ limit: 300, sucursal: selectedBranch || undefined, sucursal_logistics: 1 });
      setData(result);
    } catch (err) {
      setErrorW(err instanceof Error ? err.message : 'No se pudo cargar las garantías de la sucursal');
    } finally {
      setLoadingW(false);
    }
  }

  async function loadAvailable() {
    if (!selectedBranch) return;
    setAvailLoading(true); setSelected(new Set());
    try {
      const res = await fetchAvailableWarrantiesForRemito(selectedBranch);
      setAvailable(res?.items ?? []);
    } catch { setAvailable([]); }
    finally { setAvailLoading(false); }
  }

  useEffect(() => {
    fetchWarrantyOptions().then(setOptions).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadWarranties();
  }, [selectedBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  function openGenerate() {
    setShowGen(true);
    loadAvailable();
  }

  const norm = (v?: string | null) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const dest = centralDepositName(options);
    if (!dest) { setGenError('No se encontró el depósito destino.'); return; }
    if (norm(selectedBranch) === norm(dest)) {
      setGenError('No se puede generar un remito de despacho desde el mismo depósito de destino. Este flujo es para enviar desde una sucursal al depósito central.');
      return;
    }
    if (selected.size === 0) { setGenError('Seleccioná al menos una garantía.'); return; }
    setGenLoading(true); setGenError('');
    try {
      const res = await generateRemitos({
        destino_deposito: dest,
        warranty_codes: Array.from(selected),
        nota: genNota.trim() || undefined,
        sucursal: selectedBranch || undefined,
      });
      setLastGenerated(res.remitos);
      setSelected(new Set()); setAvailable([]); setGenNota(''); setShowGen(false);
      await loadWarranties();
    } catch (e: unknown) {
      setGenError((e as Error).message || 'Error al generar remito');
    } finally { setGenLoading(false); }
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

  const destino = centralDepositName(options);
  const selectedIsDeposit = useMemo(() => {
    if (!selectedBranch) return false;
    if (norm(selectedBranch) === norm(destino)) return true;
    const match = (options?.branches_operativas ?? []).find((b) => norm(b.name) === norm(selectedBranch));
    return match?.type === 'deposit';
  }, [selectedBranch, destino, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const WARRANTY_TABS = [
    { id: 'pending'  as const, label: 'Necesitan despacho', count: needsDispatch.length, items: needsDispatch },
    { id: 'transito' as const, label: 'En tránsito',         count: inTransit.length,    items: inTransit },
    { id: 'done'     as const, label: 'En depósito',          count: arrived.length,      items: arrived },
  ];

  const activeWItems = useMemo(() => {
    const list = WARRANTY_TABS.find((t) => t.id === wTab)?.items || [];
    return [...list].sort((a, b) => {
      const aU = a.estado_retiro_proveedor === 'retiro_solicitado' ? 1 : 0;
      const bU = b.estado_retiro_proveedor === 'retiro_solicitado' ? 1 : 0;
      if (aU !== bU) return bU - aU;
      return Number(b.dias_pendiente || 0) - Number(a.dias_pendiente || 0);
    });
  }, [wTab, needsDispatch, inTransit, arrived]); // eslint-disable-line react-hooks/exhaustive-deps

  const canGenerateRemito = can('warranties.remitos.generate') || can('warranties.remitos.dispatch');

  // Columnas para desktop
  const columns: ErpColumn<WarrantySummary>[] = [
    {
      key: 'id',
      header: 'N.º',
      width: 130,
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-mono">{row.id_garantia}</span>
          {row.estado_retiro_proveedor === 'retiro_solicitado' && <ErpBadge tone="solid-danger">Retiro solicitado</ErpBadge>}
        </div>
      ),
    },
    {
      key: 'producto',
      header: 'Producto',
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-stack-primary">{row.producto_principal || 'Sin producto'}</span>
          <span className="erp-cell-stack-secondary">{[row.marca, row.serie ? `S/N ${row.serie}` : ''].filter(Boolean).join(' · ') || '—'}</span>
        </div>
      ),
    },
    {
      key: 'ubicacion',
      header: 'Ubicación',
      width: 160,
      muted: true,
      render: (row) => (
        <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-[color:var(--text-3)]" />{row.ubicacion_actual_label || row.ubicacion_actual || 'En sucursal'}</span>
      ),
    },
    {
      key: 'estado',
      header: 'Estado',
      width: 150,
      render: (row) => {
        if (row.transit_status === 'en_transito') return <ErpBadge tone="warning">En tránsito</ErpBadge>;
        if (row.transit_status === 'en_deposito') return <ErpBadge tone="success">En depósito</ErpBadge>;
        const meta = getWarrantyStatusMeta(row.estado);
        return <ErpBadge tone={flowToneToBadgeTone(meta.tone)}>{meta.shortLabel || row.estado}</ErpBadge>;
      },
    },
    {
      key: 'dias',
      header: 'Días',
      width: 80,
      align: 'right',
      render: (row) => {
        const d = Number(row.dias_pendiente || 0);
        if (d <= 0) return <span className="text-[color:var(--text-3)]">—</span>;
        if (d >= 15) return <ErpBadge tone="solid-danger">{d}d</ErpBadge>;
        if (d >= 7) return <ErpBadge tone="warning">{d}d</ErpBadge>;
        return <span className="tabular-nums text-[color:var(--text-2)]">{d}d</span>;
      },
    },
  ];

  const rowActions: ErpRowAction<WarrantySummary>[] = [
    { key: 'view', label: 'Vista rápida', icon: <Eye size={14} />, onClick: (row) => setDrawerId(row.id_garantia) },
    {
      key: 'dispatch',
      label: 'Despachar a depósito',
      icon: <Send size={14} />,
      hidden: (row) => !canGenerateRemito || row.transit_status === 'en_transito' || row.transit_status === 'en_deposito',
      onClick: () => openGenerate(),
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title={selectedBranch ? `Garantías — ${selectedBranch}` : 'Mi sucursal'}
        description="Cargá garantías, despachá equipos al depósito central y seguí el tránsito de tu sucursal."
        actions={
          <>
            {can('warranties.create') && (
              <button type="button" onClick={() => setShowCreate(true)} className={erpBtnPrimary}>
                <Plus size={14} /> Nueva garantía
              </button>
            )}
            {canGenerateRemito && selectedBranch && !selectedIsDeposit && (
              <button type="button" onClick={openGenerate} className={erpBtnSecondary}>
                <Send size={14} /> Despachar a {destino || 'depósito'}
              </button>
            )}
            <button type="button" onClick={loadWarranties} className={erpBtnGhost}>
              <RefreshCw size={14} className={loadingW ? 'erp-spin' : ''} /> Actualizar
            </button>
          </>
        }
      />

      {/* Selector de sucursal para privilegiados */}
      {isPrivileged && options?.branches_operativas && options.branches_operativas.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-[color:var(--text-3)]">Sucursal / Depósito:</span>
          <div style={{ minWidth: 220 }}>
            <ErpSelect value={selectedBranch} onChange={(e) => { setShowGen(false); setSelectedBranch(e.target.value); }} style={{ height: 32, fontSize: 13 }}>
              {options.branches_operativas.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </ErpSelect>
          </div>
        </div>
      )}

      {errorW && <ErpNotice tone="error">{errorW}</ErpNotice>}

      {/* Aviso cuando se está viendo un depósito: el botón "Despachar" no aplica.
          Pasa típicamente con usuarios admin cuya branch primaria es Chiclana. */}
      {canGenerateRemito && selectedIsDeposit && (
        <ErpNotice tone="info" title="Estás viendo un depósito">
          Desde un depósito no se despacha a depósito. Para generar un remito interno,
          elegí una sucursal física (Caseros, Lanús, Canning, Norcenter…) en el selector
          de arriba.
        </ErpNotice>
      )}

      {urgentCount > 0 && (
        <ErpNotice tone="error" title={urgentCount === 1 ? '1 caso URGENTE' : `${urgentCount} casos URGENTES`}>
          El proveedor solicitó retiro. Despachá a depósito lo antes posible.
        </ErpNotice>
      )}

      {/* KPIs */}
      <section className="erp-kpi-row" aria-label="Resumen de la sucursal">
        <ErpKpiCard
          label="Necesitan despacho"
          value={needsDispatch.length}
          detail={needsDispatch.length > 0 ? 'Equipos para enviar al depósito' : 'Todo despachado'}
          variant={needsDispatch.length > 0 ? 'alert' : 'default'}
          icon={<Package size={13} />}
        />
        <ErpKpiCard
          label="En tránsito"
          value={inTransit.length}
          detail={inTransit.length > 0 ? 'En camino al depósito central' : 'Sin envíos abiertos'}
          icon={<Truck size={13} />}
        />
        <ErpKpiCard
          label="En depósito"
          value={arrived.length}
          detail="Confirmados en el depósito"
          variant="success"
          icon={<CheckCircle2 size={13} />}
        />
        <ErpKpiCard
          label="Urgentes"
          value={urgentCount}
          detail={urgentCount > 0 ? 'Retiro solicitado por proveedor' : 'Sin urgencias'}
          variant={urgentCount > 0 ? 'danger' : 'default'}
          icon={<AlertTriangle size={13} />}
        />
      </section>

      {/* Tabla de garantías con tabs */}
      <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div className="erp-tab-bar">
            {WARRANTY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`erp-tab ${wTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setWTab(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="erp-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        <ErpDataTable<WarrantySummary>
          columns={columns}
          rows={activeWItems}
          rowKey={(row) => row.id_garantia}
          loading={loadingW}
          onRowClick={(row) => setDrawerId(row.id_garantia)}
          rowActions={rowActions}
          empty={{
            title: wTab === 'pending' ? 'No hay equipos pendientes de despacho'
              : wTab === 'transito' ? 'No hay remitos en tránsito'
              : 'No hay recepciones confirmadas',
            description: wTab === 'pending' ? 'Cargá una garantía o esperá nuevos ingresos.' : 'Cambiá de pestaña para ver otras garantías.',
            cta: wTab === 'pending' && can('warranties.create')
              ? <button type="button" onClick={() => setShowCreate(true)} className={erpBtnPrimary}><Plus size={14} /> Nueva garantía</button>
              : undefined,
          }}
          renderMobileCard={(row) => {
            const d = Number(row.dias_pendiente || 0);
            const isUrgent = row.estado_retiro_proveedor === 'retiro_solicitado';
            const alerts = computeLogisticsAlerts(row).filter((a) => a.targetRole === 'encargado' || a.targetRole === 'all');
            return (
              <div className="erp-mcard" style={isUrgent ? { borderColor: 'rgba(239,68,68,0.4)', background: 'var(--danger-soft)' } : undefined}>
                <div className="erp-mcard-head">
                  <span className="erp-mcard-title"><span className="erp-cell-mono">{row.id_garantia}</span></span>
                  {row.transit_status === 'en_transito' ? <ErpBadge tone="warning">En tránsito</ErpBadge>
                   : row.transit_status === 'en_deposito' ? <ErpBadge tone="success">En depósito</ErpBadge>
                   : <ErpBadge tone={flowToneToBadgeTone(getWarrantyStatusMeta(row.estado).tone)}>{getWarrantyStatusMeta(row.estado).shortLabel || row.estado}</ErpBadge>}
                </div>
                <div className="erp-mcard-title" style={{ fontWeight: 600 }}>{row.producto_principal || 'Sin producto'}</div>
                <div className="erp-mcard-sub">{[row.marca, row.serie ? `S/N ${row.serie}` : ''].filter(Boolean).join(' · ') || '—'}</div>
                <div className="erp-mcard-meta">
                  <span><MapPin size={10} /> {row.ubicacion_actual_label || row.ubicacion_actual || 'En sucursal'}</span>
                  {d > 0 && <span><Clock size={10} /> {d}d</span>}
                  {isUrgent && <ErpBadge tone="solid-danger">Retiro solicitado</ErpBadge>}
                </div>
                {alerts.length > 0 && (
                  <div className="mt-1 text-[11px] text-[color:var(--warning-soft-text)]">
                    ⚠ {alerts[0].message}
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>

      {/* Panel de generación de remito */}
      {selectedBranch && canGenerateRemito && showGen && !selectedIsDeposit && (
        <ErpCard
          title={<span className="inline-flex items-center gap-2"><Send size={14} /> Despachar al depósito central</span>}
          subtitle={`${selectedBranch} → ${destino}`}
          actions={<ErpButton size="sm" variant="ghost" leftIcon={<X size={13} />} onClick={() => { setShowGen(false); setAvailable([]); setSelected(new Set()); }}>Cerrar</ErpButton>}
        >
          {availLoading && (
            <div className="erp-inline-spinner"><RefreshCw size={14} className="erp-spin" /> Cargando garantías disponibles…</div>
          )}
          {!availLoading && available.length === 0 && (
            <ErpNotice tone="info">
              No hay garantías disponibles para remito en <strong>{selectedBranch}</strong>. Aparecen cuando están en la sucursal y no tienen remito activo.
            </ErpNotice>
          )}
          {!availLoading && available.length > 0 && (
            <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-3 py-2">
                <input
                  type="checkbox"
                  className="erp-checkbox"
                  checked={selected.size === available.length && available.length > 0}
                  onChange={() => setSelected(selected.size === available.length ? new Set() : new Set(available.map((w) => w.warranty_code)))}
                />
                <span className="text-[12.5px] font-semibold">
                  {selected.size > 0 ? `${selected.size} de ${available.length} seleccionadas` : `${available.length} disponibles`}
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {available.map((w) => (
                  <label
                    key={w.warranty_code}
                    className={`flex cursor-pointer items-start gap-3 border-b border-[color:var(--divider)] px-3 py-2.5 transition-colors last:border-b-0 ${selected.has(w.warranty_code) ? 'bg-[color:var(--primary-soft)]' : 'hover:bg-[color:var(--surface-hover)]'}`}
                  >
                    <input
                      type="checkbox"
                      className="erp-checkbox mt-1"
                      checked={selected.has(w.warranty_code)}
                      onChange={() => setSelected((p) => {
                        const n = new Set(p);
                        if (n.has(w.warranty_code)) n.delete(w.warranty_code); else n.add(w.warranty_code);
                        return n;
                      })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="erp-cell-mono text-[12.5px] font-semibold">{w.warranty_code}</span>
                        {w.estado && <ErpBadge tone="neutral" withDot={false}>{w.estado}</ErpBadge>}
                        {w.marca && <span className="text-[10.5px] text-[color:var(--text-3)]">{w.marca}</span>}
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] text-[color:var(--text-2)]">
                        {w.producto || '—'}{w.serie ? ` · Serie: ${w.serie}` : ''}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleGenerate} className="mt-3 erp-stack-3">
            <ErpField label="Nota (opcional)">
              <input
                className="erp-input"
                placeholder="Ej: viaje del miércoles, bulto 2…"
                value={genNota}
                onChange={(e) => setGenNota(e.target.value)}
              />
            </ErpField>
            {genError && <ErpNotice tone="error">{genError}</ErpNotice>}
            <div className="erp-form-actions">
              <ErpButton type="button" variant="ghost" onClick={() => { setShowGen(false); setAvailable([]); setSelected(new Set()); }}>Cancelar</ErpButton>
              <ErpButton type="submit" variant="primary" disabled={selected.size === 0} loading={genLoading} leftIcon={<Send size={14} />}>
                {selected.size > 0 ? `Generar remito (${selected.size})` : 'Generar remito'}
              </ErpButton>
            </div>
          </form>
        </ErpCard>
      )}

      {/* Remitos generados */}
      {lastGenerated.length > 0 && (
        <ErpNotice tone="success" title={lastGenerated.length === 1 ? 'Remito generado' : `${lastGenerated.length} remitos generados`}>
          <div className="erp-stack-2 mt-1">
            {lastGenerated.map((r) => (
              <div key={r.remito_code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2">
                <div className="min-w-0">
                  <span className="font-mono text-[13px] font-semibold text-[color:var(--text)]">{r.remito_code}</span>
                  <span className="ml-2 text-[11.5px] text-[color:var(--text-2)]">{r.warranties_count} prod. · {r.origen_sucursal} <ArrowRight size={10} className="inline align-middle" /> {r.destino_deposito}</span>
                </div>
                <div className="flex gap-1.5">
                  <ErpButton size="sm" variant="secondary" leftIcon={<Printer size={12} />} onClick={() => printPdf(r.remito_code)}>Imprimir</ErpButton>
                  <ErpButton size="sm" variant="ghost" leftIcon={<FileText size={12} />} onClick={() => downloadPdf(r.remito_code)}>PDF</ErpButton>
                </div>
              </div>
            ))}
          </div>
        </ErpNotice>
      )}

      <WarrantyQuickCreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { loadWarranties(); }}
        options={options}
        defaultSucursal={selectedBranch || branchName}
        centralDeposit={destino}
        existingWarranties={items}
      />

      <WarrantyDetailDrawer
        open={drawerId !== null}
        warrantyId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => loadWarranties()}
      />
    </div>
  );
}
