import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, FileText, Globe2, Plus, Receipt, Search, User } from 'lucide-react';
import { can, fetchSalesWebOptions, fetchSalesWebRequests, getCurrentUserFromStorage } from '../api/client';
import { canCrossSelectBranches } from '../branchAccess';
import { useMobileFab } from '../components/MobileFab';
import {
  ErpBadge,
  ErpCard,
  ErpDataTable,
  ErpField,
  ErpFilterBar,
  ErpKpiCard,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  erpBtnPrimary,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpColumn,
  type ErpFilterChipDef,
  type ErpRowAction,
} from '../components/ProUI';
import type { SalesWebOptions, SalesWebRequest } from '../types';

const STATUS_ORDER = ['Pendiente', 'En proceso', 'Completado', 'Enviado a venta web', 'Cancelado'];

function displaySalesStatus(estado: string) {
  return estado === 'Enviado a venta web' ? 'Enviado a venta' : estado;
}

function statusTone(estado: string): ErpBadgeTone {
  switch (estado) {
    case 'Pendiente': return 'warning';
    case 'En proceso': return 'info';
    case 'Completado': return 'success';
    case 'Enviado a venta web': return 'violet';
    case 'Cancelado': return 'danger';
    default: return 'neutral';
  }
}

// Mantenemos el export para retrocompatibilidad con SalesWebDetailPage.
export function StatusBadge({ estado }: { estado: string }) {
  return <ErpBadge tone={statusTone(estado)}>{displaySalesStatus(estado)}</ErpBadge>;
}

type ListMode = 'auto' | 'mine' | 'admin';

export function SalesWebListPage({ mode = 'auto', defaultEstado = '' }: { mode?: ListMode; defaultEstado?: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SalesWebRequest[]>([]);
  const [options, setOptions] = useState<SalesWebOptions | null>(null);
  const [estado, setEstado] = useState(defaultEstado);
  const [sucursal, setSucursal] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const user = getCurrentUserFromStorage();
  const canManageAll = can('sales_web.manage');
  const canManageBranch = can('sales_web.branch_manage') || can('sales_web.take') || can('sales_web.complete') || can('sales_web.send') || can('sales_web.cancel');
  const canChooseAnyBranch = canManageAll || canCrossSelectBranches(user);
  const mineOnly = mode === 'mine' || (!canManageAll && !canManageBranch && mode !== 'admin');
  const adminView = mode === 'admin' && (canManageAll || canManageBranch);

  // FAB mobile: Nueva venta si tiene permiso.
  useMobileFab(can('sales_web.create') ? {
    label: 'Nueva venta',
    icon: <Plus size={22} />,
    to: '/venta/nueva',
  } : null, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [reqs, opts] = await Promise.all([
        fetchSalesWebRequests({ estado: estado || undefined, q: q || undefined, mine: mineOnly, active_only: mineOnly, sucursal: sucursal || undefined }),
        fetchSalesWebOptions(),
      ]);
      setItems(reqs);
      setOptions(opts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar ventas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [mode, estado, sucursal]);

  function search(e: FormEvent) {
    e.preventDefault();
    load();
  }

  const sorted = useMemo(() => [...items].sort((a, b) => {
    const oa = STATUS_ORDER.indexOf(a.estado);
    const ob = STATUS_ORDER.indexOf(b.estado);
    if (oa !== ob) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    return b.id - a.id;
  }), [items]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((item) =>
      String(item.numero_solicitud || '').toLowerCase().includes(query) ||
      String(item.apellido_nombre || '').toLowerCase().includes(query) ||
      String(item.dni || '').toLowerCase().includes(query) ||
      String(item.telefono || '').toLowerCase().includes(query) ||
      String(item.vendedor_nombre || '').toLowerCase().includes(query) ||
      String(item.numero_remito_prefactura || '').toLowerCase().includes(query),
    );
  }, [sorted, q]);

  const statusCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of STATUS_ORDER) out[st] = 0;
    for (const item of items) out[item.estado] = (out[item.estado] || 0) + 1;
    return out;
  }, [items]);

  const title = mineOnly ? 'Mis ventas' : 'Bandeja de ventas';
  const subtitle = mineOnly
    ? 'Seguimiento de tus ventas: pendientes, en proceso, completadas y enviadas.'
    : canManageAll
      ? 'Bandeja general por sucursal operativa para tomar, facturar y gestionar ventas.'
      : `Bandeja de trabajo de ${user?.sucursal || 'tu sucursal'}.`;

  const filterChips: ErpFilterChipDef[] = [
    {
      key: 'estado',
      label: estado ? `Estado: ${displaySalesStatus(estado)}` : 'Estado',
      active: !!estado,
      onClear: () => setEstado(''),
    },
    ...(canChooseAnyBranch || !user?.sucursal ? [{
      key: 'sucursal',
      label: sucursal ? `Sucursal: ${sucursal}` : 'Sucursal',
      active: !!sucursal,
      onClear: () => setSucursal(''),
    }] : []),
  ];

  const rowActions: ErpRowAction<SalesWebRequest>[] = [
    {
      key: 'view',
      label: 'Abrir',
      icon: <Eye size={14} />,
      onClick: (row) => navigate(`/venta/${row.id}`),
    },
  ];

  const columns: ErpColumn<SalesWebRequest>[] = [
    {
      key: 'numero',
      header: 'Venta',
      width: 130,
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-mono">{row.numero_solicitud}</span>
          <ErpBadge tone={statusTone(row.estado)}>{displaySalesStatus(row.estado)}</ErpBadge>
        </div>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-stack-primary">{row.apellido_nombre}</span>
          <span className="erp-cell-stack-secondary">DNI {row.dni} · {row.telefono} · {row.items.length} prod.</span>
        </div>
      ),
    },
    {
      key: 'sucursal',
      header: 'Sucursal',
      width: 130,
      muted: true,
      render: (row) => row.sucursal || '—',
    },
    {
      key: 'vendedor',
      header: 'Vendedor',
      width: 150,
      muted: true,
      render: (row) => row.vendedor_nombre || '—',
    },
    {
      key: 'fecha',
      header: 'Creado',
      width: 130,
      align: 'right',
      muted: true,
      render: (row) => (
        <div className="erp-cell-stack" style={{ textAlign: 'right' }}>
          <span>{row.created_at_text}</span>
          {row.numero_remito_prefactura && <span className="text-[color:var(--success-soft-text)] text-[11px]">Remito: {row.numero_remito_prefactura}</span>}
        </div>
      ),
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title={title}
        description={subtitle}
        actions={
          <>
            {!mineOnly && can('sales_web.view') && (
              <Link to="/venta/mis-solicitudes" className={erpBtnSecondary}>
                <User size={14} /> Mis ventas
              </Link>
            )}
            {can('sales_web.create') && (
              <Link to="/venta/nueva" className={erpBtnPrimary}>
                <Plus size={14} /> Nueva venta
              </Link>
            )}
          </>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      {/* KPIs por estado */}
      <section className="erp-kpi-row is-five" aria-label="Resumen por estado">
        {STATUS_ORDER.map((st) => {
          const isSelected = estado === st;
          const tone = statusTone(st);
          return (
            <button
              key={st}
              type="button"
              onClick={() => setEstado(isSelected ? '' : st)}
              className={`erp-kpi text-left ${isSelected ? 'is-alert' : ''}`}
              style={isSelected ? { borderColor: 'var(--primary)', background: 'var(--primary-soft)' } : undefined}
              aria-pressed={isSelected}
            >
              <div className="erp-kpi-label">
                <ErpBadge tone={tone}>{displaySalesStatus(st)}</ErpBadge>
              </div>
              <div className="erp-kpi-value">{statusCounts[st] || 0}</div>
              <div className="erp-kpi-detail">{st === 'Pendiente' ? 'Para tomar' : st === 'Cancelado' ? 'Anuladas' : 'En esta vista'}</div>
            </button>
          );
        })}
      </section>

      {/* Tabla / cards mobile + filtros */}
      <div className="erp-card erp-card-flat" style={{ padding: 0, overflow: 'hidden' }}>
        <form onSubmit={search}>
          <ErpFilterBar
            search={q}
            onSearch={setQ}
            searchPlaceholder="Buscar por venta, DNI, cliente, teléfono o vendedor..."
            chips={filterChips}
            onReset={() => { setEstado(''); setSucursal(''); setQ(''); }}
            extra={
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <ErpField label="">
                  <ErpSelect value={estado} onChange={(e) => setEstado(e.target.value)} style={{ height: 32, fontSize: 12, minWidth: 140 }}>
                    <option value="">Todos los estados</option>
                    {options?.estados.map((st) => <option key={st} value={st}>{displaySalesStatus(st)}</option>)}
                  </ErpSelect>
                </ErpField>
                <ErpField label="">
                  <ErpSelect value={sucursal} onChange={(e) => setSucursal(e.target.value)} disabled={!canChooseAnyBranch && !!user?.sucursal} style={{ height: 32, fontSize: 12, minWidth: 140 }}>
                    <option value="">{canChooseAnyBranch ? 'Todas las sucursales' : (user?.sucursal || 'Mi sucursal')}</option>
                    {options?.sucursales.map((s) => <option key={s} value={s}>{s}</option>)}
                  </ErpSelect>
                </ErpField>
              </div>
            }
          />
        </form>

        <ErpDataTable<SalesWebRequest>
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          loading={loading}
          onRowClick={(row) => navigate(`/venta/${row.id}`)}
          rowActions={rowActions}
          empty={{
            title: q || estado || sucursal ? 'Sin resultados con esos filtros' : 'No hay ventas para mostrar',
            description: q || estado || sucursal ? 'Probá limpiar los filtros para ver todas las ventas.' : (can('sales_web.create') ? 'Cargá la primera desde el botón de arriba.' : 'No hay ventas asignadas todavía.'),
            cta: can('sales_web.create') ? <Link to="/venta/nueva" className={erpBtnPrimary}><Plus size={14} /> Nueva venta</Link> : undefined,
          }}
          renderMobileCard={(row) => (
            <div className="erp-mcard">
              <div className="erp-mcard-head">
                <span className="erp-mcard-title">
                  <Receipt size={13} className="text-[color:var(--text-3)]" />
                  <span className="erp-cell-mono">{row.numero_solicitud}</span>
                </span>
                <ErpBadge tone={statusTone(row.estado)}>{displaySalesStatus(row.estado)}</ErpBadge>
              </div>
              <div className="erp-mcard-title" style={{ fontWeight: 600 }}>{row.apellido_nombre}</div>
              <div className="erp-mcard-sub">DNI {row.dni} · {row.telefono}</div>
              <div className="erp-mcard-meta">
                <span><Globe2 size={10} /> {row.sucursal || '—'}</span>
                <span><User size={10} /> {row.vendedor_nombre || '—'}</span>
                <span>{row.items.length} prod.</span>
                {row.numero_remito_prefactura && <span className="text-[color:var(--success-soft-text)]"><FileText size={10} /> {row.numero_remito_prefactura}</span>}
              </div>
              <div className="erp-mcard-meta">
                <span>{row.created_at_text}</span>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
