import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  MapPin,
  Printer,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { can, downloadRemitoPdf, fetchRemito, fetchRemitos } from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpDataTable,
  ErpDrawer,
  ErpEmptyState,
  ErpErrorState,
  ErpField,
  ErpFilterBar,
  ErpInfoGrid,
  ErpInfoRow,
  ErpKpiCard,
  ErpLoadingState,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  ErpTimeline,
  ErpTimelineItem,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpColumn,
  type ErpFilterChipDef,
  type ErpRowAction,
} from '../components/ProUI';
import { useMobileFab } from '../components/MobileFab';
import type { WarrantyRemitoInfo, WarrantyRemitosResponse } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => undefined);
}

async function printRemitoPdf(remitoCode: string): Promise<void> {
  const blob = await downloadRemitoPdf(remitoCode);
  const url = URL.createObjectURL(blob);
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

function calcDuration(startIso?: string | null, endIso?: string | null): { label: string; hours: number } | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = end - start;
  if (ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(ms / 3600000);
  if (totalMinutes < 60) return { label: `${totalMinutes} min`, hours: 0 };
  if (totalHours < 24) return { label: `${totalHours} h`, hours: totalHours };
  const days = Math.floor(totalHours / 24);
  const remH = totalHours % 24;
  return { label: remH > 0 ? `${days}d ${remH}h` : `${days}d`, hours: totalHours };
}

function statusTone(status?: string): ErpBadgeTone {
  if (status === 'llegado') return 'success';
  if (status === 'en_transito') return 'warning';
  return 'neutral';
}

function statusLabel(status?: string): string {
  if (status === 'llegado') return 'Llegado';
  if (status === 'en_transito') return 'En tránsito';
  if (status === 'pendiente') return 'Pendiente';
  return status || '—';
}

function tipoRemitoTone(tipo?: string): ErpBadgeTone {
  if (tipo === 'sucursal_a_deposito') return 'violet';
  if (tipo === 'deposito_a_deposito') return 'info';
  if (tipo === 'deposito_a_proveedor') return 'primary';
  return 'neutral';
}

function tipoRemitoLabel(tipo?: string): string {
  if (tipo === 'sucursal_a_deposito') return 'Suc → Dep';
  if (tipo === 'deposito_a_deposito') return 'Dep → Dep';
  if (tipo === 'deposito_a_proveedor') return 'Dep → Prov';
  return tipo || 'Remito';
}

// ── Main component ────────────────────────────────────────────────────────────

export function WarrantyRemitoTrackingPage() {
  const [data, setData] = useState<WarrantyRemitosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pendiente' | 'en_transito' | 'llegado' | 'atrasados'>('all');
  const [drawerRemito, setDrawerRemito] = useState<WarrantyRemitoInfo | null>(null);

  // FAB mobile: nuevo remito (apunta al hub de operaciones).
  useMobileFab(can('warranties.remitos.generate') || can('warranties.remitos.deposit_transfer') || can('warranties.remitos.provider_delivery') ? {
    label: 'Nuevo remito',
    icon: <Truck size={20} />,
    to: '/warranties/remitos',
  } : null, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filterStatus) params.status = filterStatus;
      if (filterBranch.trim()) params.origen_sucursal = filterBranch.trim();
      const res = await fetchRemitos(params);
      setData(res);
    } catch (e: unknown) {
      setError((e as Error).message || 'Error al cargar remitos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filterStatus, filterBranch]);

  async function handleDownloadPdf(remitoCode: string) {
    try {
      const blob = await downloadRemitoPdf(remitoCode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${remitoCode}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      alert((e as Error).message || 'Error al descargar PDF');
    }
  }

  const remitos = useMemo<WarrantyRemitoInfo[]>(
    () => (Array.isArray(data?.items) ? data!.items : []),
    [data],
  );

  const allBranches = useMemo(
    () => [...new Set(remitos.map((r) => r.origen_sucursal).filter(Boolean))].sort(),
    [remitos],
  );

  function isDelayed(r: WarrantyRemitoInfo): boolean {
    if (r.status !== 'en_transito') return false;
    const d = calcDuration(r.fecha_despacho, null);
    return !!d && d.hours >= 120; // 5 días o más
  }

  const tabCounts = useMemo(() => {
    return {
      all: remitos.length,
      pendiente: remitos.filter((r) => r.status === 'pendiente').length,
      en_transito: remitos.filter((r) => r.status === 'en_transito').length,
      llegado: remitos.filter((r) => r.status === 'llegado').length,
      atrasados: remitos.filter(isDelayed).length,
    };
  }, [remitos]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = remitos;
    if (activeTab !== 'all') {
      if (activeTab === 'atrasados') list = list.filter(isDelayed);
      else list = list.filter((r) => r.status === activeTab);
    }
    if (q) {
      list = list.filter((r) =>
        r.remito_code.toLowerCase().includes(q) ||
        r.origen_sucursal.toLowerCase().includes(q) ||
        r.destino_deposito.toLowerCase().includes(q) ||
        (r.proveedor || '').toLowerCase().includes(q) ||
        r.warranty_ids.some((id) => id.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [remitos, search, activeTab]);

  const filterChips: ErpFilterChipDef[] = [
    {
      key: 'branch',
      label: filterBranch ? `Sucursal: ${filterBranch}` : 'Sucursal',
      active: !!filterBranch,
      onClear: () => setFilterBranch(''),
    },
    {
      key: 'status',
      label: filterStatus ? `Estado: ${statusLabel(filterStatus)}` : 'Estado',
      active: !!filterStatus,
      onClear: () => setFilterStatus(''),
    },
  ];

  const rowActions: ErpRowAction<WarrantyRemitoInfo>[] = [
    {
      key: 'view',
      label: 'Vista rápida',
      icon: <Eye size={14} />,
      onClick: (row) => setDrawerRemito(row),
    },
    {
      key: 'pdf',
      label: 'Descargar PDF',
      icon: <Download size={14} />,
      onClick: (row) => handleDownloadPdf(row.remito_code),
    },
    {
      key: 'print',
      label: 'Imprimir',
      icon: <Printer size={14} />,
      onClick: (row) => printRemitoPdf(row.remito_code),
    },
    {
      key: 'copy',
      label: 'Copiar código',
      icon: <Copy size={14} />,
      onClick: (row) => copyText(row.remito_code),
    },
  ];

  const columns: ErpColumn<WarrantyRemitoInfo>[] = [
    {
      key: 'code',
      header: 'N.º',
      width: 160,
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-mono">{row.remito_code}</span>
          {row.shipment_code && row.shipment_code !== row.remito_code && (
            <span className="erp-cell-stack-secondary font-mono">{row.shipment_code}</span>
          )}
        </div>
      ),
    },
    {
      key: 'tipo',
      header: 'Tipo',
      width: 110,
      render: (row) => <ErpBadge tone={tipoRemitoTone(row.tipo_remito)}>{tipoRemitoLabel(row.tipo_remito)}</ErpBadge>,
    },
    {
      key: 'origen_destino',
      header: 'Origen → Destino',
      render: (row) => (
        <div className="erp-cell-stack">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[color:var(--text)]">
            <MapPin size={11} className="text-[color:var(--text-3)]" />
            <span className="truncate">{row.origen_sucursal || '—'}</span>
            <ArrowRight size={11} className="text-[color:var(--text-3)]" />
            <span className="truncate">{row.destino_deposito || '—'}</span>
          </div>
          {row.proveedor && (
            <span className="erp-cell-stack-secondary">Proveedor: {row.proveedor}</span>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Ítems',
      width: 70,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.warranties_count}</span>,
    },
    {
      key: 'despacho',
      header: 'Despacho',
      width: 130,
      muted: true,
      render: (row) => row.fecha_despacho_display || (row.status === 'pendiente' ? <span className="text-[color:var(--text-3)]">Sin despachar</span> : '—'),
    },
    {
      key: 'tiempo',
      header: 'Tiempo',
      width: 130,
      render: (row) => {
        if (row.status === 'pendiente') {
          const d = calcDuration(row.created_at);
          if (!d) return <span className="text-[color:var(--text-3)]">—</span>;
          return <span className="inline-flex items-center gap-1 text-[11.5px] text-[color:var(--text-2)]"><Clock size={11} />Creado hace {d.label}</span>;
        }
        if (row.status === 'en_transito') {
          const d = calcDuration(row.fecha_despacho, null);
          if (!d) return <span className="text-[color:var(--text-3)]">—</span>;
          if (d.hours >= 120) return <ErpBadge tone="solid-danger">{d.label} atrasado</ErpBadge>;
          if (d.hours >= 48) return <ErpBadge tone="warning">{d.label}</ErpBadge>;
          return <span className="inline-flex items-center gap-1 text-[11.5px] text-[color:var(--text-2)]"><Truck size={11} />{d.label}</span>;
        }
        if (row.status === 'llegado') {
          const d = calcDuration(row.fecha_despacho, row.fecha_llegada);
          if (!d) return <span className="text-[color:var(--text-3)]">—</span>;
          return <span className="inline-flex items-center gap-1 text-[11.5px] text-[color:var(--success-soft-text)]"><CheckCircle2 size={11} />{d.label}</span>;
        }
        return null;
      },
    },
    {
      key: 'status',
      header: 'Estado',
      width: 120,
      render: (row) => <ErpBadge tone={statusTone(row.status)}>{statusLabel(row.status).toUpperCase()}</ErpBadge>,
    },
    {
      key: 'created_by',
      header: 'Responsable',
      width: 140,
      muted: true,
      render: (row) => row.created_by_name || '—',
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Historial de remitos"
        description="Seguimiento global de remitos internos: tránsito, llegada y trazabilidad por sucursal."
        actions={
          <button type="button" onClick={load} className={erpBtnSecondary} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'erp-spin' : ''} /> Actualizar
          </button>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      <section className="erp-kpi-row" aria-label="Resumen de remitos">
        <ErpKpiCard
          label="Total"
          value={remitos.length}
          detail="Remitos en la vista"
          icon={<Truck size={13} />}
        />
        <ErpKpiCard
          label="Pendientes preparación"
          value={tabCounts.pendiente}
          detail={tabCounts.pendiente > 0 ? 'Sin despachar todavía' : 'Sin pendientes'}
        />
        <ErpKpiCard
          label="En tránsito"
          value={tabCounts.en_transito}
          detail={tabCounts.atrasados > 0 ? `${tabCounts.atrasados} atrasados (≥5d)` : 'Sin atrasos'}
          variant={tabCounts.atrasados > 0 ? 'danger' : tabCounts.en_transito > 0 ? 'alert' : 'default'}
        />
        <ErpKpiCard
          label="Llegados"
          value={tabCounts.llegado}
          detail="Recibidos correctamente"
          variant="success"
          icon={<CheckCircle2 size={13} />}
        />
      </section>

      {/* Tabla con tabs + filterbar */}
      <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="erp-tab-bar">
            {([
              { key: 'all', label: 'Todos', count: tabCounts.all },
              { key: 'pendiente', label: 'Pendientes', count: tabCounts.pendiente },
              { key: 'en_transito', label: 'En tránsito', count: tabCounts.en_transito },
              { key: 'atrasados', label: 'Atrasados', count: tabCounts.atrasados },
              { key: 'llegado', label: 'Llegados', count: tabCounts.llegado },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`erp-tab ${activeTab === tab.key ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
                <span className="erp-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>
          <div className="text-[12px] text-[color:var(--text-3)] tabular-nums">
            {filteredItems.length} de {remitos.length}
          </div>
        </div>

        <ErpFilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Código de remito, sucursal, proveedor o garantía..."
          chips={filterChips}
          onReset={() => { setSearch(''); setFilterBranch(''); setFilterStatus(''); setActiveTab('all'); }}
          extra={
            <div className="flex items-center gap-2">
              <ErpField label="">
                <ErpSelect value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="h-8" style={{ height: 32, fontSize: 12 }}>
                  <option value="">Todas las sucursales</option>
                  {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                </ErpSelect>
              </ErpField>
              <ErpField label="">
                <ErpSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-8" style={{ height: 32, fontSize: 12 }}>
                  <option value="">Todos los estados</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="en_transito">En tránsito</option>
                  <option value="llegado">Llegado</option>
                </ErpSelect>
              </ErpField>
            </div>
          }
        />

        <ErpDataTable<WarrantyRemitoInfo>
          columns={columns}
          rows={filteredItems}
          rowKey={(row) => row.remito_code}
          loading={loading}
          onRowClick={(row) => setDrawerRemito(row)}
          rowActions={rowActions}
          empty={{
            title: 'No hay remitos para mostrar',
            description: 'Ajustá los filtros o esperá a que se generen movimientos.',
          }}
          renderMobileCard={(row) => {
            const d = row.status === 'pendiente'
              ? calcDuration(row.created_at)
              : row.status === 'en_transito'
                ? calcDuration(row.fecha_despacho, null)
                : calcDuration(row.fecha_despacho, row.fecha_llegada);
            const isDelayed = row.status === 'en_transito' && d && d.hours >= 120;
            return (
              <div className="erp-mcard">
                <div className="erp-mcard-head">
                  <span className="erp-mcard-title">
                    <span className="erp-cell-mono">{row.remito_code}</span>
                    <ErpBadge tone={tipoRemitoTone(row.tipo_remito)}>{tipoRemitoLabel(row.tipo_remito)}</ErpBadge>
                  </span>
                  <ErpBadge tone={statusTone(row.status)}>{statusLabel(row.status).toUpperCase()}</ErpBadge>
                </div>
                <div className="erp-mcard-sub flex items-center gap-1.5">
                  <MapPin size={11} className="text-[color:var(--text-3)]" />
                  {row.origen_sucursal || '—'} <ArrowRight size={11} className="text-[color:var(--text-3)]" /> {row.destino_deposito || '—'}
                </div>
                <div className="erp-mcard-meta">
                  <span><strong>{row.warranties_count}</strong> ítems</span>
                  {row.fecha_despacho_display && <span>Salió: {row.fecha_despacho_display}</span>}
                  {isDelayed && d ? <ErpBadge tone="solid-danger">{d.label} atrasado</ErpBadge>
                   : row.status === 'en_transito' && d ? <span><Truck size={10} className="inline" /> {d.label}</span>
                   : row.status === 'llegado' && d ? <span><CheckCircle2 size={10} className="inline" /> {d.label}</span>
                   : null}
                </div>
              </div>
            );
          }}
        />
      </div>

      <RemitoDetailDrawer
        remito={drawerRemito}
        onClose={() => setDrawerRemito(null)}
        onDownloadPdf={handleDownloadPdf}
        onPrint={printRemitoPdf}
      />
    </div>
  );
}

// ── Drawer de detalle ────────────────────────────────────────────────────────

function RemitoDetailDrawer({
  remito,
  onClose,
  onDownloadPdf,
  onPrint,
}: {
  remito: WarrantyRemitoInfo | null;
  onClose: () => void;
  onDownloadPdf: (code: string) => Promise<void>;
  onPrint: (code: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<WarrantyRemitoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!remito) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(remito);
    // Si tiene warranties precargadas (algunos endpoints las devuelven), no recargamos.
    // Para tener seguro la lista completa, pedimos detalle.
    fetchRemito(remito.remito_code)
      .then((value) => { if (alive) { setDetail(value); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); /* no error, usamos el row */ });
    return () => { alive = false; };
  }, [remito]);

  const r = detail || remito;
  const d = r?.status === 'pendiente'
    ? calcDuration(r?.created_at)
    : r?.status === 'en_transito'
      ? calcDuration(r?.fecha_despacho, null)
      : calcDuration(r?.fecha_despacho, r?.fecha_llegada);
  const isDelayed = r?.status === 'en_transito' && d && d.hours >= 120;
  const isWarning = r?.status === 'en_transito' && d && d.hours >= 48 && d.hours < 120;

  return (
    <ErpDrawer
      open={remito !== null}
      onClose={onClose}
      title={
        r ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Remito</span>
            <ErpBadge tone={tipoRemitoTone(r.tipo_remito)}>{tipoRemitoLabel(r.tipo_remito)}</ErpBadge>
            <ErpBadge tone={statusTone(r.status)}>{statusLabel(r.status).toUpperCase()}</ErpBadge>
            {isDelayed && d && <ErpBadge tone="solid-danger">{d.label} atrasado</ErpBadge>}
          </div>
        ) : 'Remito'
      }
      subtitle={
        r ? (
          <div className="mt-1.5">
            <div className="text-[15px] font-semibold text-[color:var(--text)] leading-tight font-mono">{r.remito_code}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[color:var(--text-2)]">
              <span>{r.origen_sucursal}</span>
              <ArrowRight size={11} />
              <span>{r.destino_deposito}</span>
            </div>
          </div>
        ) : null
      }
      headerActions={
        r && (
          <>
            <ErpButton size="sm" variant="secondary" leftIcon={<Download size={13} />} onClick={() => onDownloadPdf(r.remito_code)}>
              PDF
            </ErpButton>
            <ErpButton size="sm" variant="primary" leftIcon={<Printer size={13} />} onClick={() => onPrint(r.remito_code)}>
              Imprimir
            </ErpButton>
          </>
        )
      }
    >
      {loading && !detail && <ErpLoadingState />}
      {error && <ErpErrorState description={error} />}
      {r && (
        <div className="erp-stack-4">
          {isDelayed && d && (
            <ErpNotice tone="error" title={`En tránsito hace ${d.label}`}>
              El remito supera los 5 días en tránsito sin confirmación de llegada. Coordiná con el depósito destino.
            </ErpNotice>
          )}
          {isWarning && d && (
            <ErpNotice tone="warning" title={`${d.label} en tránsito`}>
              Se acerca al umbral de 5 días sin confirmación. Verificá con el depósito.
            </ErpNotice>
          )}

          <ErpInfoGrid columns={2}>
            <ErpInfoRow label="Origen" value={<span className="inline-flex items-center gap-1"><MapPin size={11} className="text-[color:var(--text-3)]" />{r.origen_sucursal || '—'}</span>} />
            <ErpInfoRow label="Destino" value={<span className="inline-flex items-center gap-1"><MapPin size={11} className="text-[color:var(--text-3)]" />{r.destino_deposito || '—'}</span>} />
            <ErpInfoRow label="Tipo" value={tipoRemitoLabel(r.tipo_remito)} />
            <ErpInfoRow label="Empresa" value={r.company_name || '—'} />
            <ErpInfoRow label="Creado por" value={r.created_by_name || '—'} />
            <ErpInfoRow label="Fecha de creación" value={r.created_at_display || '—'} />
            {r.fecha_despacho_display && <ErpInfoRow label="Despachado" value={r.fecha_despacho_display} />}
            {r.despachado_por_name && <ErpInfoRow label="Despachado por" value={r.despachado_por_name} />}
            {r.fecha_llegada_display && <ErpInfoRow label="Llegada" value={r.fecha_llegada_display} />}
            {r.recibido_por_name && <ErpInfoRow label="Recibido por" value={r.recibido_por_name} />}
            {r.proveedor && <ErpInfoRow label="Proveedor" value={r.proveedor} />}
            <ErpInfoRow label="Total ítems" value={<span className="tabular-nums">{r.warranties_count}</span>} />
          </ErpInfoGrid>

          {r.nota && (
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-1">Nota</div>
              <div className="text-[12.5px] text-[color:var(--text)] leading-[1.55]">{r.nota}</div>
            </div>
          )}

          {/* Timeline de estado */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[color:var(--text)]">Cronología</h3>
            </div>
            <ErpTimeline>
              <ErpTimelineItem
                state="ok"
                title="Remito creado"
                meta={<>{r.created_at_display} · {r.created_by_name}</>}
              />
              {r.fecha_despacho_display ? (
                <ErpTimelineItem
                  state={r.status === 'en_transito' ? (isDelayed ? 'err' : isWarning ? 'warn' : 'now') : 'ok'}
                  title="Despachado"
                  meta={<>{r.fecha_despacho_display}{r.despachado_por_name ? ` · ${r.despachado_por_name}` : ''}</>}
                />
              ) : r.status === 'pendiente' ? (
                <ErpTimelineItem state="warn" title="Esperando despacho" meta="Sin fecha de despacho confirmada" />
              ) : null}
              {r.fecha_llegada_display ? (
                <ErpTimelineItem
                  state="ok"
                  title="Llegada confirmada"
                  meta={<>{r.fecha_llegada_display}{r.recibido_por_name ? ` · ${r.recibido_por_name}` : ''}</>}
                />
              ) : r.status === 'en_transito' ? (
                <ErpTimelineItem
                  state={isDelayed ? 'err' : 'now'}
                  title={isDelayed ? 'Atrasado — sin confirmación' : 'En tránsito'}
                  meta={d ? `Hace ${d.label}` : undefined}
                />
              ) : null}
            </ErpTimeline>
          </div>

          {/* Lista de garantías incluidas */}
          {(r.warranties && r.warranties.length > 0) || r.warranty_ids.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-[color:var(--text)]">Garantías incluidas</h3>
                <span className="text-[11.5px] text-[color:var(--text-3)] tabular-nums">{r.warranties_count} ítem{r.warranties_count === 1 ? '' : 's'}</span>
              </div>
              <div className="erp-stack-2">
                {r.warranties && r.warranties.length > 0 ? (
                  r.warranties.map((w) => (
                    <div key={w.warranty_code} className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-[12.5px] font-semibold text-[color:var(--text)]">{w.warranty_code}</span>
                          <div className="mt-0.5 text-[12.5px] text-[color:var(--text-2)] truncate">{w.producto || 'Sin producto'}</div>
                          {(w.sku || w.serie) && (
                            <div className="mt-0.5 text-[11px] text-[color:var(--text-3)] tabular-nums">
                              {w.sku && <>SKU: {w.sku}</>}{w.sku && w.serie ? ' · ' : ''}{w.serie && <>Serie: {w.serie}</>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {r.warranty_ids.map((id) => (
                      <span key={id} className="erp-tag font-mono">{id}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ErpEmptyState title="Sin garantías" description="Este remito no tiene garantías asociadas." />
          )}
        </div>
      )}
    </ErpDrawer>
  );
}
