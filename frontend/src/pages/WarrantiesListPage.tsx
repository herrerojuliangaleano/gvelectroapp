import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  ClipboardCheck,
  Copy,
  Eye,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { WarrantyDetailDrawer } from '../components/WarrantyDetailDrawer';
import { WarrantyQuickCreateModal } from '../components/WarrantyQuickCreateModal';
import { useMobileFab } from '../components/MobileFab';
import { canCrossSelectBranches } from '../branchAccess';
import {
  can,
  fetchWarranties,
  fetchWarrantyCounters,
  fetchWarrantyOptions,
  getCurrentUserFromStorage,
  resyncWarrantyCounters,
} from '../api/client';
import {
  ErpBadge,
  ErpCard,
  ErpDataTable,
  ErpField,
  ErpFilterBar,
  ErpInfoGrid,
  ErpInfoRow,
  ErpKpiCard,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  ErpTag,
  erpBtnGhost,
  erpBtnPrimary,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpColumn,
  type ErpFilterChipDef,
  type ErpRowAction,
} from '../components/ProUI';
import type {
  WarrantyCounterInfo,
  WarrantyListResponse,
  WarrantyOptions,
  WarrantySummary,
} from '../types';
import {
  CANONICAL_WARRANTY_STATUSES,
  getReviewStatusMeta,
  getWarrantyStatusMeta,
} from '../warrantyFlow';

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => undefined);
}

function optionKey(value: string) {
  return (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*\d+\s*[-.)]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function stripOptionPrefix(value: string) {
  return (value || '').replace(/^\s*\d+\s*[-.)]\s*/g, '').replace(/\s+/g, ' ').trim();
}

function uniqueOptions(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const clean = stripOptionPrefix(String(value || ''));
    const key = optionKey(clean);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function normalizeDepositOption(value: string) {
  const clean = stripOptionPrefix(value);
  const key = optionKey(clean);
  if (!key) return '';
  if (key === 'DEPOSITO CHICLANA' || key === 'CHICLANA') return 'Depósito Chiclana';
  if (key === 'DEPOSITO CORRALES' || key === 'CORRALES') return 'Depósito Corrales';
  if (key === 'DEPOSITO CACHI' || key === 'CACHI') return 'Depósito Cachi';
  return clean;
}

// Mapeo de tonos del flujo (warrantyFlow) → tonos del nuevo Badge ERP
function flowToneToBadgeTone(tone?: string): ErpBadgeTone {
  switch (tone) {
    case 'success':
    case 'green':
      return 'success';
    case 'warning':
    case 'amber':
    case 'yellow':
      return 'warning';
    case 'danger':
    case 'red':
      return 'danger';
    case 'info':
    case 'blue':
    case 'cyan':
      return 'info';
    case 'violet':
    case 'purple':
      return 'violet';
    default:
      return 'neutral';
  }
}

export function WarrantiesListPage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUserFromStorage();
  // El usuario opera solo en su sucursal si NO tiene permisos globales de gestión
  // ni el permiso explícito `branches.cross_select` que le permite tocar otras
  // sucursales. Decisión 100% por permisos (canCrossSelectBranches ya incluye
  // los permisos de gestión globales).
  const isBranchOperator = !canCrossSelectBranches(currentUser);
  const assignedBranch = currentUser?.branch_name || currentUser?.sucursal || '';
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [counters, setCounters] = useState<WarrantyCounterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', sucursal: isBranchOperator ? assignedBranch : '', estado: '', deposito: '', tipo_ingreso: '', fecha_desde: '', fecha_hasta: '' });
  const [activeTab, setActiveTab] = useState<'all' | 'pendientes' | 'proveedor' | 'demoradas' | 'resueltas'>('all');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Operador de sucursal → carga rápida en modal (1 producto, caso 90%).
  // Gestor / multi-sucursal → carga avanzada en /warranties/new (multi-producto).
  const useQuickCreate = isBranchOperator;

  // FAB mobile: Nueva garantía si tiene permiso.
  useMobileFab(can('warranties.create') ? {
    label: 'Nueva garantía',
    icon: <Plus size={22} />,
    ...(useQuickCreate ? { onClick: () => setShowQuickCreate(true) } : { to: '/warranties/new' }),
  } : null, [can('warranties.create'), useQuickCreate]);

  const estados = useMemo(() => {
    const fromBackend = (options?.estados || []).filter((estado) => CANONICAL_WARRANTY_STATUSES.includes(estado));
    return fromBackend.length ? fromBackend : CANONICAL_WARRANTY_STATUSES;
  }, [options]);

  const sucursalOptions = useMemo(() => {
    const branchNames = (options?.branches_operativas ?? [])
      .filter((b) => b.type === 'physical')
      .map((b) => b.name);
    return uniqueOptions(branchNames.length ? branchNames : (options?.sucursales || []));
  }, [options]);

  const depositoOptions = useMemo(() => {
    const branchNames = (options?.branches_operativas ?? [])
      .filter((b) => b.type === 'deposit')
      .map((b) => normalizeDepositOption(b.name));
    const fallback = (options?.depositos || []).map(normalizeDepositOption);
    return uniqueOptions(branchNames.length ? branchNames : fallback);
  }, [options]);

  const items = data?.items || [];

  const correctionItems = useMemo(
    () => items.filter((i) => i.review_status === 'requiere_correccion'),
    [items],
  );

  const resumen = useMemo(() => {
    const bySucursal: Record<string, number> = {};
    const byDeposito: Record<string, number> = {};
    items.forEach((item) => {
      const suc = item.sucursal || 'SIN SUCURSAL';
      const dep = (item as any).lugar_llegada || item.deposito || 'SIN DEPÓSITO';
      bySucursal[suc] = (bySucursal[suc] || 0) + 1;
      byDeposito[dep] = (byDeposito[dep] || 0) + 1;
    });
    const top = (obj: Record<string, number>) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { bySucursal: top(bySucursal), byDeposito: top(byDeposito) };
  }, [items]);

  const tabCounts = useMemo(() => {
    const counts = { all: items.length, pendientes: 0, proveedor: 0, demoradas: 0, resueltas: 0 };
    for (const item of items) {
      const est = (item.estado || '').toUpperCase();
      const dias = item.dias_pendiente || 0;
      if (est.includes('INGRES') || est.includes('REVISIÓN') || est.includes('REVISION')) counts.pendientes++;
      if (est.includes('PROVEEDOR') || est.includes('ENVIAD')) counts.proveedor++;
      if (dias >= 15) counts.demoradas++;
      if (est.includes('RESUEL') || est.includes('FINALIZ')) counts.resueltas++;
    }
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'all') return items;
    return items.filter((item) => {
      const est = (item.estado || '').toUpperCase();
      const dias = item.dias_pendiente || 0;
      if (activeTab === 'pendientes') return est.includes('INGRES') || est.includes('REVISIÓN') || est.includes('REVISION');
      if (activeTab === 'proveedor') return est.includes('PROVEEDOR') || est.includes('ENVIAD');
      if (activeTab === 'demoradas') return dias >= 15;
      if (activeTab === 'resueltas') return est.includes('RESUEL') || est.includes('FINALIZ');
      return true;
    });
  }, [items, activeTab]);

  async function load(extra = filters) {
    setLoading(true);
    setError('');
    try {
      const effectiveFilters = isBranchOperator
        ? { ...extra, sucursal: assignedBranch, estado: '', deposito: '' }
        : extra;
      const [opts, warranties] = await Promise.all([fetchWarrantyOptions(), fetchWarranties({ ...effectiveFilters, limit: 500 })]);
      setOptions(opts);
      setData(warranties);
      if (can('warranties.manage')) {
        fetchWarrantyCounters().then((res) => setCounters(res.counters)).catch(() => setCounters([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las garantías');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    load(isBranchOperator ? { ...filters, sucursal: assignedBranch, estado: '', deposito: '' } : filters);
  }

  async function resyncCounters() {
    setError('');
    try {
      const res = await resyncWarrantyCounters();
      setCounters(res.counters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron resincronizar contadores');
    }
  }

  const filterChips: ErpFilterChipDef[] = isBranchOperator ? [] : [
    {
      key: 'sucursal',
      label: filters.sucursal ? `Sucursal: ${filters.sucursal}` : 'Sucursal',
      active: !!filters.sucursal,
      onClear: () => { const next = { ...filters, sucursal: '' }; setFilters(next); load(next); },
    },
    {
      key: 'estado',
      label: filters.estado ? `Estado: ${filters.estado}` : 'Estado',
      active: !!filters.estado,
      onClear: () => { const next = { ...filters, estado: '' }; setFilters(next); load(next); },
    },
    {
      key: 'deposito',
      label: filters.deposito ? `Lugar: ${filters.deposito}` : 'Depósito',
      active: !!filters.deposito,
      onClear: () => { const next = { ...filters, deposito: '' }; setFilters(next); load(next); },
    },
  ];

  const rowActions: ErpRowAction<WarrantySummary>[] = [
    {
      key: 'quickview',
      label: 'Vista rápida',
      icon: <Eye size={14} />,
      onClick: (row) => setDrawerId(row.id_garantia),
    },
    {
      key: 'edit',
      label: 'Editar completo',
      icon: <PencilLine size={14} />,
      onClick: (row) => navigate(`/warranties/${encodeURIComponent(row.id_garantia)}`),
    },
    {
      key: 'copy',
      label: 'Copiar ID',
      icon: <Copy size={14} />,
      onClick: (row) => copyText(row.id_garantia),
    },
  ];

  const columns: ErpColumn<WarrantySummary>[] = [
    {
      key: 'id_garantia',
      header: 'N.º',
      width: 120,
      render: (row) => <span className="erp-cell-mono">{row.id_garantia}</span>,
    },
    {
      key: 'producto',
      header: 'Cliente / Producto',
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-stack-primary">{row.producto_principal || 'Sin producto'}</span>
          <span className="erp-cell-stack-secondary">
            {row.cliente_nombre || 'Sin cliente'}{row.cantidad_items > 1 ? ` · ${row.cantidad_items} ítems` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'sucursal',
      header: 'Sucursal',
      width: 140,
      render: (row) => <span className="truncate">{row.sucursal || '—'}</span>,
    },
    {
      key: 'lugar',
      header: 'Lugar actual',
      width: 160,
      render: (row) => <span className="truncate">{row.ubicacion_actual_label || row.lugar_llegada || row.deposito || '—'}</span>,
    },
    {
      key: 'ingreso',
      header: 'Ingreso',
      width: 110,
      align: 'right',
      muted: true,
      render: (row) => row.ingreso || '—',
    },
    {
      key: 'dias',
      header: 'Días',
      width: 80,
      align: 'right',
      render: (row) => {
        const dias = row.dias_pendiente || 0;
        if (dias <= 0) return <span className="text-[color:var(--text-3)]">—</span>;
        if (dias >= 15) return <ErpBadge tone="solid-danger">{dias}d</ErpBadge>;
        if (dias >= 7) return <ErpBadge tone="warning">{dias}d</ErpBadge>;
        return <span className="tabular-nums text-[color:var(--text-2)]">{dias}d</span>;
      },
    },
    {
      key: 'estado',
      header: 'Estado',
      width: 160,
      render: (row) => {
        const meta = getWarrantyStatusMeta(row.estado);
        return (
          <div className="flex flex-col gap-1">
            <ErpBadge tone={flowToneToBadgeTone(meta.tone)}>{meta.shortLabel || row.estado}</ErpBadge>
            {row.review_status && (
              <ErpBadge tone={flowToneToBadgeTone(getReviewStatusMeta(row.review_status).tone)}>
                {row.review_status_label || getReviewStatusMeta(row.review_status).label}
              </ErpBadge>
            )}
          </div>
        );
      },
    },
    {
      key: 'responsable',
      header: 'Responsable',
      width: 140,
      muted: true,
      render: (row) => row.responsable || '—',
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title={isBranchOperator ? 'Garantías en mi sucursal' : 'Consulta de garantías'}
        description={isBranchOperator
          ? 'Garantías que todavía están físicamente en tu sucursal. Al despacharse a Chiclana salen de esta vista.'
          : 'Buscá, filtrá y seguí la trazabilidad de cualquier garantía. Para operar usá Mi espacio, Panel gestor o Posventa.'}
        actions={
          <>
            <button onClick={() => load()} className={erpBtnGhost}><RefreshCw size={14} /> Actualizar</button>
            {can('warranties.create') && (
              useQuickCreate
                ? <button type="button" onClick={() => setShowQuickCreate(true)} className={erpBtnPrimary}><Plus size={14} /> Nueva garantía</button>
                : <Link to="/warranties/new" className={erpBtnPrimary}><Plus size={14} /> Nueva garantía</Link>
            )}
          </>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      {isBranchOperator && (
        <ErpNotice tone="info">
          Estás viendo solo garantías ubicadas en <strong>{assignedBranch || 'tu sucursal'}</strong>. Cuando se genera o despacha un remito hacia Depósito Chiclana, la garantía deja de aparecer acá y se sigue desde Remitos o Gestión.
        </ErpNotice>
      )}

      {correctionItems.length > 0 && (
        <ErpNotice
          tone="warning"
          title={isBranchOperator
            ? `${correctionItems.length} garantía${correctionItems.length !== 1 ? 's' : ''} requiere${correctionItems.length !== 1 ? 'n' : ''} corrección`
            : `${correctionItems.length} garantía${correctionItems.length !== 1 ? 's' : ''} marcada${correctionItems.length !== 1 ? 's' : ''} para corrección`}
        >
          <div>
            {isBranchOperator
              ? 'El revisor devolvió estas garantías con observaciones. Revisá cada una y corregí los datos antes de reenviarlas.'
              : 'Estas garantías fueron devueltas a sus sucursales de origen para corrección.'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {correctionItems.slice(0, 8).map((item) => (
              <Link
                key={item.id_garantia}
                to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
                className="erp-badge erp-badge-warning"
              >
                <span className="erp-badge-dot" aria-hidden="true" /> {item.id_garantia}
              </Link>
            ))}
            {correctionItems.length > 8 && (
              <span className="erp-badge erp-badge-neutral">+{correctionItems.length - 8}</span>
            )}
          </div>
        </ErpNotice>
      )}

      {data && (
        <section className="erp-kpi-row" aria-label="Resumen del listado">
          <ErpKpiCard label="Total visibles" value={items.length} detail={`${filteredItems.length} en la vista actual`} icon={<ShieldCheck size={13} />} />
          <ErpKpiCard label="Pendientes revisión" value={tabCounts.pendientes} variant={tabCounts.pendientes > 0 ? 'alert' : 'default'} />
          <ErpKpiCard label="En proveedor" value={tabCounts.proveedor} />
          <ErpKpiCard label="Demoradas (≥15d)" value={tabCounts.demoradas} variant={tabCounts.demoradas > 0 ? 'danger' : 'default'} icon={<AlertTriangle size={13} />} />
        </section>
      )}

      {/* Resumen por sucursal y por lugar (admin/gestor) */}
      {data && !isBranchOperator && (resumen.bySucursal.length > 0 || resumen.byDeposito.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ErpCard title="Por sucursal" size="sm" subtitle="Top 5 con más garantías abiertas">
            <ErpInfoGrid columns={2}>
              {resumen.bySucursal.map(([name, count]) => (
                <ErpInfoRow key={name} label={name} value={<span className="tabular-nums">{count}</span>} />
              ))}
              {resumen.bySucursal.length === 0 && <span className="text-[12.5px] text-[color:var(--text-3)]">Sin datos.</span>}
            </ErpInfoGrid>
          </ErpCard>
          <ErpCard title="Por lugar actual" size="sm" subtitle="Top 5 ubicaciones físicas">
            <ErpInfoGrid columns={2}>
              {resumen.byDeposito.map(([name, count]) => (
                <ErpInfoRow key={name} label={name} value={<span className="tabular-nums">{count}</span>} />
              ))}
              {resumen.byDeposito.length === 0 && <span className="text-[12.5px] text-[color:var(--text-3)]">Sin datos.</span>}
            </ErpInfoGrid>
          </ErpCard>
        </div>
      )}

      {/* Filtros explícitos en form (selects amplios, una sola vez al "Aplicar") */}
      {!isBranchOperator && (
        <ErpCard title="Filtros avanzados" subtitle="Refiná por sucursal, estado, lugar o tipo de ingreso">
          <form onSubmit={submit}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <ErpField label="Sucursal">
                <ErpSelect value={filters.sucursal} onChange={(e) => setFilters({ ...filters, sucursal: e.target.value })}>
                  <option value="">Todas</option>
                  {sucursalOptions.map((op) => <option key={op} value={op}>{op}</option>)}
                </ErpSelect>
              </ErpField>
              <ErpField label="Estado">
                <ErpSelect value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}>
                  <option value="">Todos</option>
                  {estados.map((op) => <option key={op} value={op}>{op}</option>)}
                </ErpSelect>
              </ErpField>
              <ErpField label="Depósito / lugar">
                <ErpSelect value={filters.deposito} onChange={(e) => setFilters({ ...filters, deposito: e.target.value })}>
                  <option value="">Todos</option>
                  {depositoOptions.map((op) => <option key={op} value={op}>{op}</option>)}
                </ErpSelect>
              </ErpField>
              <ErpField label="Tipo de ingreso">
                <ErpSelect value={filters.tipo_ingreso} onChange={(e) => setFilters({ ...filters, tipo_ingreso: e.target.value })}>
                  <option value="">Todos</option>
                  {(options?.tipos_ingreso || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </ErpSelect>
              </ErpField>
              <div className="flex items-end">
                <button type="submit" className={`${erpBtnPrimary} w-full`}>Aplicar</button>
              </div>
            </div>
          </form>
        </ErpCard>
      )}

      {/* Tabla con tabs + filterbar integrados */}
      <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="erp-tab-bar">
            {([
              { key: 'all', label: 'Todas', count: tabCounts.all },
              { key: 'pendientes', label: 'Pendientes', count: tabCounts.pendientes },
              { key: 'proveedor', label: 'En proveedor', count: tabCounts.proveedor },
              { key: 'demoradas', label: 'Demoradas', count: tabCounts.demoradas },
              { key: 'resueltas', label: 'Resueltas', count: tabCounts.resueltas },
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
            {filteredItems.length} de {items.length}
          </div>
        </div>

        <ErpFilterBar
          search={filters.q}
          onSearch={(value) => setFilters({ ...filters, q: value })}
          searchPlaceholder="ID, SKU, serie, producto..."
          chips={filterChips}
          onReset={() => {
            const cleared = { q: '', sucursal: isBranchOperator ? assignedBranch : '', estado: '', deposito: '', tipo_ingreso: '', fecha_desde: '', fecha_hasta: '' };
            setFilters(cleared);
            load(cleared);
            setActiveTab('all');
          }}
          extra={
            <button type="button" className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => load()}>
              Buscar
            </button>
          }
        />

        <ErpDataTable<WarrantySummary>
          columns={columns}
          rows={filteredItems}
          rowKey={(row) => row.id_garantia}
          loading={loading}
          onRowClick={(row) => setDrawerId(row.id_garantia)}
          rowActions={rowActions}
          rowClassName={(row) => row.review_status === 'requiere_correccion' ? 'erp-row-correction' : undefined}
          empty={{
            title: isBranchOperator ? 'No hay garantías en tu sucursal' : 'No hay garantías para mostrar',
            description: isBranchOperator
              ? 'Las garantías despachadas a Chiclana ya no aparecen en este listado. Se siguen desde Remitos o Gestión.'
              : 'Ajustá los filtros o cargá una nueva garantía.',
            cta: can('warranties.create') ? <Link to="/warranties/new" className={erpBtnPrimary}><Plus size={14} /> Nueva garantía</Link> : undefined,
          }}
          renderMobileCard={(row) => {
            const meta = getWarrantyStatusMeta(row.estado);
            const dias = row.dias_pendiente || 0;
            return (
              <div className="erp-mcard">
                <div className="erp-mcard-head">
                  <span className="erp-mcard-title">
                    <span className="erp-cell-mono">{row.id_garantia}</span>
                  </span>
                  <ErpBadge tone={flowToneToBadgeTone(meta.tone)}>{meta.shortLabel || row.estado}</ErpBadge>
                </div>
                <div className="erp-mcard-title" style={{ fontWeight: 600 }}>{row.producto_principal || 'Sin producto'}</div>
                <div className="erp-mcard-sub">
                  {row.cliente_nombre || 'Sin cliente'}{row.cantidad_items > 1 ? ` · ${row.cantidad_items} ítems` : ''}
                </div>
                <div className="erp-mcard-meta">
                  <span>📍 {row.sucursal || '—'}</span>
                  <span>Ingreso: {row.ingreso || '—'}</span>
                  {dias >= 15 ? <ErpBadge tone="solid-danger">{dias}d</ErpBadge>
                   : dias >= 7 ? <ErpBadge tone="warning">{dias}d</ErpBadge>
                   : dias > 0 ? <span>{dias}d</span> : null}
                </div>
              </div>
            );
          }}
        />
      </div>

      <WarrantyDetailDrawer
        open={drawerId !== null}
        warrantyId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => load()}
      />

      <WarrantyQuickCreateModal
        open={showQuickCreate}
        onClose={() => setShowQuickCreate(false)}
        onCreated={() => load()}
        options={options}
        defaultSucursal={assignedBranch}
        centralDeposit={(options?.warranty_central_deposit?.name || 'Depósito Chiclana')}
        existingWarranties={items}
      />
    </div>
  );
}
