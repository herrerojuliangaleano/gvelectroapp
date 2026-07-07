import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, FileDown, Filter, History,
  Link2, Package, PackageX, RefreshCw, Search, Settings2, Tag, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  applyPendingPSIAdjustments, can, createPSIAdjustment, createPSIAlias, exportPSIPdf, exportPSIXlsx, fetchPSIOptions, fetchPSIReport,
  revertPSIAdjustment, searchPSIProducts,
} from '../api/client';
import {
  ErpCard,
  ErpField,
  ErpKpiCard,
  ErpNotice,
  ErpPageHeader,
  erpBtnGhost,
  erpBtnPrimary,
  erpBtnSecondary,
} from '../components/ProUI';
import type {
  PSIAdjustmentInfo, PSICondicionFilter, PSIMode, PSINoCatalogadoRow, PSIOptionsResponse,
  PSIProductSearchRow, PSIReportResponse, PSIReportRow, PSITarget,
} from '../types';

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60';
const labelClass = 'mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400';

// ── Helpers de fechas ─────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultRange(): { inicio: string; fin: string } {
  // Default: lunes hace 14 días → domingo hace 7 días (2 semanas completas previas)
  const today = new Date();
  const dayOfWeek = today.getDay() || 7; // domingo=7
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - dayOfWeek + 1 - 14);
  const sunday = new Date(lastMonday);
  sunday.setDate(lastMonday.getDate() + 13);
  return { inicio: isoDate(lastMonday), fin: isoDate(sunday) };
}

// ── Chip multi-select ──────────────────────────────────────────────────────

function MultiSelect({
  label, options, value, onChange, placeholder,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  }

  return (
    <div className="relative">
      <label className={labelClass}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-[42px] flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm text-slate-100 hover:border-blue-400"
      >
        {value.length === 0 && <span className="text-slate-500">{placeholder}</span>}
        {value.map((v) => (
          <span
            key={v}
            onClick={(e) => { e.stopPropagation(); toggle(v); }}
            className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-200 hover:bg-blue-500/30 cursor-pointer"
          >
            {v} ×
          </span>
        ))}
        <ChevronDown size={16} className="ml-auto text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="border-b border-slate-800 p-2">
            <div className="flex items-center gap-2 rounded-lg bg-slate-950 px-2 py-1">
              <Search size={14} className="text-slate-500" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-sm text-slate-100 outline-none"
              />
              {value.length > 0 && (
                <button onClick={() => onChange([])} className="text-xs font-bold text-slate-400 hover:text-slate-200">Limpiar</button>
              )}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Sin resultados</div>}
            {filtered.map((opt) => {
              const checked = value.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ${
                    checked ? 'bg-blue-500/15 text-blue-200' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <input type="checkbox" checked={checked} readOnly className="h-3.5 w-3.5" />
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-slate-800 p-2 text-right">
            <button onClick={() => setOpen(false)} className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────

function KPI({ label, value, accent }: { label: string; value: string | number; accent?: 'green' | 'amber' | 'red' | 'blue' }) {
  const accentCls =
    accent === 'green' ? 'text-emerald-300'
    : accent === 'amber' ? 'text-amber-300'
    : accent === 'red' ? 'text-red-300'
    : accent === 'blue' ? 'text-blue-300'
    : 'text-white';
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-black ${accentCls}`}>{value}</div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────

export function PSIPage() {
  const [options, setOptions] = useState<PSIOptionsResponse | null>(null);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [condicion, setCondicion] = useState<PSICondicionFilter>('TODO');
  const initialRange = useMemo(() => defaultRange(), []);
  const [periodoInicio, setPeriodoInicio] = useState(initialRange.inicio);
  const [periodoFin, setPeriodoFin] = useState(initialRange.fin);

  const [report, setReport] = useState<PSIReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showNoCatalogados, setShowNoCatalogados] = useState(true);
  const [mode, setMode] = useState<PSIMode>('default');
  const [excludeZeroActivity, setExcludeZeroActivity] = useState(false);
  const [localStockAdjustments, setLocalStockAdjustments] = useState<Record<number, number>>({});
  const [savingPending, setSavingPending] = useState(false);
  const [success, setSuccess] = useState('');

  // Modal de ajuste
  const [adjustRow, setAdjustRow] = useState<PSIReportRow | null>(null);
  // Drawer de historial
  const [historialRow, setHistorialRow] = useState<PSIReportRow | null>(null);
  // Modal de asociar producto al catálogo (no-catalogados)
  const [aliasRow, setAliasRow] = useState<PSINoCatalogadoRow | null>(null);
  // Modal de exportar reporte
  const [exportOpen, setExportOpen] = useState(false);
  // Overrides por producto para el reporte (se editan en la tabla principal, no en el modal).
  const [exportExcluded, setExportExcluded] = useState<Record<number, boolean>>({});
  const [pvpOvr, setPvpOvr] = useState<Record<number, number>>({});
  const [inicioOvr, setInicioOvr] = useState<Record<number, number>>({});
  const [finalOvr, setFinalOvr] = useState<Record<number, number>>({});

  const canExport = can('psi.export');
  const canAdjust = can('psi.adjust');

  useEffect(() => { fetchPSIOptions().then(setOptions).catch(() => {}); }, []);

  async function load(forceRefresh = false) {
    if (forceRefresh) setLocalStockAdjustments({});
    setLoading(true); setError('');
    try {
      const data = await fetchPSIReport({
        marcas, tipos, condicion, periodo_inicio: periodoInicio, periodo_fin: periodoFin,
        mode, exclude_zero_activity: excludeZeroActivity, force_refresh: forceRefresh,
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el PSI');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Recargar cuando cambia el modo o el filtro 0/0.
  useEffect(() => { load(false); }, [mode, excludeZeroActivity]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetExportOverrides() {
    setExportExcluded({}); setPvpOvr({}); setInicioOvr({}); setFinalOvr({});
  }

  function applyFilters() {
    setLocalStockAdjustments({});
    resetExportOverrides();
    load(false);
  }
  function clearFilters() {
    setMarcas([]); setTipos([]); setCondicion('TODO');
    const r = defaultRange(); setPeriodoInicio(r.inicio); setPeriodoFin(r.fin);
    setMode('default');
    setExcludeZeroActivity(false);
    setLocalStockAdjustments({});
    resetExportOverrides();
  }

  function applyLocalStockAdjustment(productId: number, delta: number) {
    setLocalStockAdjustments((current) => {
      const nextDelta = (current[productId] || 0) + delta;
      const next = { ...current };
      if (nextDelta === 0) delete next[productId];
      else next[productId] = nextDelta;
      return next;
    });
  }

  const stockAdjustmentList = useMemo(
    () => Object.entries(localStockAdjustments).map(([productId, delta]) => ({ product_id: Number(productId), delta })),
    [localStockAdjustments],
  );

  const items: PSIReportRow[] = useMemo(() => {
    const rows = (report?.items || []).map((r) => {
      const delta = localStockAdjustments[r.product_id] || 0;
      if (!delta) return r;
      return {
        ...r,
        stock: r.stock + delta,
        stock_adjustment_delta: r.stock_adjustment_delta + delta,
        has_pending_adjustment: true,
      };
    });
    if (!excludeZeroActivity) return rows;
    return rows.filter((r) => !(r.stock === 0 && r.sell_out === 0));
  }, [report, localStockAdjustments, excludeZeroActivity]);

  const displayedTotals = useMemo(() => {
    const base = report?.totals || { stock: 0, sell_out: 0, ajustes_pendientes: 0, productos_visibles: 0, productos_no_catalogados: 0 };
    return {
      ...base,
      stock: items.reduce((sum, r) => sum + r.stock, 0),
      sell_out: items.reduce((sum, r) => sum + r.sell_out, 0),
      productos_visibles: items.length,
    };
  }, [report, items]);

  // ── Valores del reporte por producto (editables en la tabla principal) ─────
  // Default: final = stock del sistema; inicio = final + sell-out; PVP = del catálogo.
  const defExportFinal = (r: PSIReportRow) => (r.product_id in finalOvr ? finalOvr[r.product_id] : r.stock);
  const defExportInicio = (r: PSIReportRow) => (r.product_id in inicioOvr ? inicioOvr[r.product_id] : defExportFinal(r) + r.sell_out);
  const defExportPvp = (r: PSIReportRow) => (r.product_id in pvpOvr ? pvpOvr[r.product_id] : (r.pvp ?? 0));
  const includedExportItems = useMemo(() => items.filter((r) => !exportExcluded[r.product_id]), [items, exportExcluded]);

  async function handleSavePendingToGfk() {
    if (!report || report.totals.ajustes_pendientes <= 0) return;
    setSavingPending(true); setError(''); setSuccess('');
    try {
      const productIds = items.filter((r) => r.ajuste_delta !== 0).map((r) => r.product_id);
      if (productIds.length === 0) {
        setError('No hay ajustes pendientes visibles para guardar con estos filtros.');
        return;
      }
      const result = await applyPendingPSIAdjustments({
        periodo_inicio: periodoInicio,
        periodo_fin: periodoFin,
        product_ids: productIds,
      });
      setSuccess(result.message);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los ajustes en GFK');
    } finally {
      setSavingPending(false);
    }
  }

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="PSI · Compras, Ventas e Inventario"
        actions={
          <>
            <button onClick={() => load(true)} disabled={loading} className={erpBtnGhost}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refrescar (sin cache)
            </button>
            {canAdjust && report && report.totals.ajustes_pendientes > 0 && (
              <button onClick={handleSavePendingToGfk} disabled={savingPending} className={erpBtnPrimary}>
                <CheckCircle2 size={14} /> {savingPending ? 'Guardando...' : `Guardar en GFK (${report.totals.ajustes_pendientes})`}
              </button>
            )}
            {canExport && report && (report.items.length > 0) && (
              <button type="button" onClick={() => setExportOpen(true)} className={erpBtnPrimary}>
                <FileDown size={14} /> Exportar
              </button>
            )}
          </>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}
      {success && <ErpNotice tone="success">{success}</ErpNotice>}

      {report?.data_freshness?.no_gfk_available && (
        <ErpNotice tone="warning" title="No hay archivo GFK que cubra este rango">
          Generá el GFK con la herramienta <a className="underline" href="/herramientas">Herramientas → Generar GFK</a> con un rango que incluya este período y volvé a aplicar los filtros. Sin GFK, el sell out aparece en cero (pero el stock se sigue mostrando).
        </ErpNotice>
      )}

      {/* KPIs */}
      {report && (
        <section className="erp-kpi-row" aria-label="Resumen del PSI">
          <ErpKpiCard label="Productos visibles" value={displayedTotals.productos_visibles} icon={<Package size={13} />} />
          <ErpKpiCard label="Stock total"        value={displayedTotals.stock} />
          <ErpKpiCard label="Sell out (rango)"   value={displayedTotals.sell_out} variant="default" detail={report.data_freshness.gfk_files_used.length ? `GFK consultados: ${report.data_freshness.gfk_files_used.map((f) => `#${f.correlativo}`).join(', ')}` : undefined} />
          <ErpKpiCard label="Ajustes pendientes" value={displayedTotals.ajustes_pendientes} variant={displayedTotals.ajustes_pendientes > 0 ? 'alert' : 'default'} icon={<AlertTriangle size={13} />} />
        </section>
      )}

      {/* Filtros */}
      <ErpCard title="Filtros" subtitle="Marcas, tipos, condición y rango de fechas (los GFK que cubren el rango se consolidan)">
        <form onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MultiSelect label="Marcas" options={options?.marcas || []} value={marcas} onChange={setMarcas} placeholder="Todas las marcas" />
            <MultiSelect label="Tipos"  options={options?.tipos  || []} value={tipos}  onChange={setTipos}  placeholder="Todos los tipos" />
            <ErpField label="Condición">
              <div className="flex gap-1.5">
                {(['TODO', 'PRIMERA', 'OUTLET'] as PSICondicionFilter[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCondicion(c)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-[12.5px] font-semibold transition ${
                      condicion === c
                        ? 'border-[color:var(--accent-1)] bg-[color:var(--accent-1)]/15 text-[color:var(--accent-1)]'
                        : 'border-[color:var(--border-2)] bg-[color:var(--bg-3)] text-[color:var(--text-2)] hover:bg-[color:var(--bg-4)]'
                    }`}
                  >
                    {c === 'TODO' ? 'Todas' : c === 'PRIMERA' ? 'Primera' : 'Outlet'}
                  </button>
                ))}
              </div>
            </ErpField>
            <div className="grid grid-cols-2 gap-2">
              <ErpField label="Desde">
                <input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} className="erp-input" />
              </ErpField>
              <ErpField label="Hasta">
                <input type="date" value={periodoFin} onChange={(e) => setPeriodoFin(e.target.value)} className="erp-input" />
              </ErpField>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={loading} className={erpBtnPrimary}>
              {loading ? 'Cargando…' : 'Aplicar'}
            </button>
            <button type="button" onClick={clearFilters} className={erpBtnGhost}>Limpiar</button>
            <button
              type="button"
              onClick={() => setExcludeZeroActivity((v) => !v)}
              className={excludeZeroActivity ? erpBtnPrimary : erpBtnSecondary}
              title="Ocultar productos que quedan con stock 0 y sell out 0 en la tabla y en el export."
            >
              <PackageX size={14} /> {excludeZeroActivity ? 'Ocultar 0/0: ON' : 'Ocultar 0/0'}
            </button>
            {canAdjust && (
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'advanced' ? 'default' : 'advanced'))}
                className={mode === 'advanced' ? erpBtnPrimary : erpBtnSecondary}
                title="Mostrar todos los productos del catálogo filtrado (incluso sin stock/ventas) para poder ajustar cualquiera"
              >
                <Settings2 size={14} /> {mode === 'advanced' ? 'Ajustes avanzados: ON' : 'Ajustes avanzados'}
              </button>
            )}
          </div>
        </form>
      </ErpCard>

      {/* Tabla principal */}
      <ErpCard
        title="Productos"
        subtitle={displayedTotals.productos_visibles ? `${displayedTotals.productos_visibles} producto${displayedTotals.productos_visibles === 1 ? '' : 's'} visible${displayedTotals.productos_visibles === 1 ? '' : 's'}` : undefined}
      >
        {canExport && items.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold uppercase tracking-wide text-[color:var(--text-3)]">Reporte</span>
            <span className="text-[color:var(--text-2)]">{includedExportItems.length} de {items.length} productos</span>
            <button type="button" onClick={() => setExportExcluded({})} className={erpBtnGhost} style={{ padding: '2px 8px', fontSize: 12 }}>Todos</button>
            <button type="button" onClick={() => setExportExcluded(Object.fromEntries(items.map((r) => [r.product_id, true])))} className={erpBtnGhost} style={{ padding: '2px 8px', fontSize: 12 }}>Ninguno</button>
            <span className="text-[color:var(--text-4)]">Tildá los productos y editá PVP / stock inicio-final; después «Exportar».</span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                {canExport && <th style={{ textAlign: 'center' }} title="Incluir en el reporte">✓</th>}
                <th>Marca</th>
                <th>Tipo</th>
                <th>SKU</th>
                <th>Descripción</th>
                <th style={{ textAlign: 'center' }}>Cond.</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th style={{ textAlign: 'right' }}>Sell out</th>
                {canExport && <th style={{ textAlign: 'right' }} title="Precio para el reporte">PVP</th>}
                {canExport && <th style={{ textAlign: 'right' }} title="Stock inicio (final + sell-out)">Inicio</th>}
                {canExport && <th style={{ textAlign: 'right' }} title="Stock final (del sistema)">Final</th>}
                <th style={{ textAlign: 'right' }}>Δ ajuste</th>
                {canAdjust && <th style={{ textAlign: 'center' }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.product_id} className={canExport && exportExcluded[r.product_id] ? 'opacity-45' : undefined}>
                  {canExport && (
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!exportExcluded[r.product_id]}
                        onChange={(e) => setExportExcluded((s) => ({ ...s, [r.product_id]: !e.target.checked }))}
                        className="h-4 w-4 accent-blue-500"
                        title="Incluir en el reporte"
                      />
                    </td>
                  )}
                  <td className="font-semibold">{r.marca}</td>
                  <td className="text-[color:var(--text-3)]">{r.tipo}</td>
                  <td className="font-mono text-[12px]">{r.sku}</td>
                  <td className="max-w-md truncate" title={r.descripcion}>{r.descripcion}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`erp-badge ${r.condicion === 'OUTLET' ? 'erp-badge-warning' : 'erp-badge-neutral'}`}>
                      {r.condicion === 'OUTLET' ? 'OUT' : 'PRI'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }} className={`tabular-nums font-semibold ${r.stock <= 0 ? 'text-[color:var(--danger-2)]' : ''}`}>
                    {r.stock}
                  </td>
                  <td style={{ textAlign: 'right' }} className="tabular-nums font-semibold text-[color:var(--success-2)]">
                    {r.historial_ajustes.length > 0 ? (
                      <button onClick={() => setHistorialRow(r)} className="hover:underline" title="Ver historial de ajustes">
                        {r.sell_out}
                        {r.has_pending_adjustment && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />}
                      </button>
                    ) : r.sell_out}
                  </td>
                  {canExport && (
                    <>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          value={defExportPvp(r)}
                          onChange={(e) => setPvpOvr((s) => ({ ...s, [r.product_id]: Number(e.target.value) }))}
                          className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-[13px] tabular-nums text-slate-100 outline-none focus:border-blue-400"
                          title="PVP para el reporte"
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          value={defExportInicio(r)}
                          onChange={(e) => setInicioOvr((s) => ({ ...s, [r.product_id]: Number(e.target.value) }))}
                          className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-[13px] tabular-nums text-slate-100 outline-none focus:border-blue-400"
                          title="Stock inicio"
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          value={defExportFinal(r)}
                          onChange={(e) => setFinalOvr((s) => ({ ...s, [r.product_id]: Number(e.target.value) }))}
                          className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-[13px] tabular-nums text-slate-100 outline-none focus:border-blue-400"
                          title="Stock final"
                        />
                      </td>
                    </>
                  )}
                  <td style={{ textAlign: 'right' }} className="tabular-nums text-[color:var(--text-4)]">
                    {r.ajuste_delta !== 0 || r.stock_adjustment_delta !== 0 ? (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        {r.ajuste_delta !== 0 && (
                          <span className={r.ajuste_delta > 0 ? 'text-[color:var(--success-2)]' : 'text-[color:var(--danger-2)]'}>
                            Venta {r.ajuste_delta > 0 ? `+${r.ajuste_delta}` : r.ajuste_delta}
                          </span>
                        )}
                        {r.stock_adjustment_delta !== 0 && (
                          <span className={r.stock_adjustment_delta > 0 ? 'text-amber-300' : 'text-orange-300'}>
                            Stock {r.stock_adjustment_delta > 0 ? `+${r.stock_adjustment_delta}` : r.stock_adjustment_delta}
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  {canAdjust && (
                    <td style={{ textAlign: 'center' }}>
                      <button onClick={() => setAdjustRow(r)} className={erpBtnGhost} style={{ padding: '2px 8px', fontSize: 12 }} title="Crear ajuste">
                        +/−
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8 + (canAdjust ? 1 : 0) + (canExport ? 4 : 0)} className="text-center text-[color:var(--text-3)]" style={{ padding: '48px 12px' }}>
                  No hay productos para los filtros aplicados.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ErpCard>

      {/* No catalogados */}
      {report?.no_catalogados && report.no_catalogados.length > 0 && (
        <ErpCard
          title={(
            <span className="flex items-center gap-2">
              <PackageX size={16} /> Productos no catalogados
              <span className="erp-badge erp-badge-warning">{report.no_catalogados.length}</span>
            </span>
          ) as any}
          subtitle="SKUs del GFK que no matchean ningún producto del catálogo. Asociá manualmente para incluirlos en el reporte; la asociación queda persistida."
          actions={
            <button onClick={() => setShowNoCatalogados((v) => !v)} className={erpBtnGhost}>
              {showNoCatalogados ? 'Ocultar' : 'Mostrar'}
              <ChevronDown size={14} className={`transition-transform ${showNoCatalogados ? 'rotate-180' : ''}`} />
            </button>
          }
        >
          {showNoCatalogados && (
            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>SKU (raw)</th>
                    <th>Descripción</th>
                    <th style={{ textAlign: 'right' }}>Cantidad</th>
                    <th>Sucursales</th>
                    {canAdjust && <th style={{ textAlign: 'center' }}>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {report.no_catalogados.map((nc, i) => (
                    <tr key={`${nc.sku_raw}-${i}`}>
                      <td className="font-mono text-[12px]">{nc.sku_raw}</td>
                      <td className="max-w-md truncate" title={nc.descripcion_raw}>{nc.descripcion_raw}</td>
                      <td style={{ textAlign: 'right' }} className="tabular-nums font-semibold">{nc.cantidad_total}</td>
                      <td className="text-[12px] text-[color:var(--text-3)]">{nc.sucursales.join(', ')}</td>
                      {canAdjust && (
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => setAliasRow(nc)} className={erpBtnSecondary} style={{ padding: '2px 8px', fontSize: 12 }}>
                            <Link2 size={12} /> Asociar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ErpCard>
      )}

      {/* Footer informativo */}
      {report && (
        <div className="text-[11.5px] text-[color:var(--text-3)] flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <span className="inline-flex items-center gap-1">
            <BarChart3 size={11} /> Cache stock: {report.data_freshness.stock_fetched_at?.slice(11, 19) || '—'}
          </span>
          <span>·</span>
          <span>Cache GFK: {report.data_freshness.ventas_fetched_at?.slice(11, 19) || '—'}</span>
          {report.data_freshness.gfk_files_used.length > 0 && (
            <>
              <span>·</span>
              <span>{report.data_freshness.gfk_files_used.length} GFK consultados</span>
            </>
          )}
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Tag size={11} /> {report.filters_applied.marcas.length} marcas · {report.filters_applied.tipos.length} tipos · {report.filters_applied.condicion}
          </span>
        </div>
      )}

      {/* Modal de ajuste */}
      {adjustRow && (
        <AdjustModal
          row={adjustRow}
          periodoInicio={periodoInicio}
          periodoFin={periodoFin}
          onClose={() => setAdjustRow(null)}
          onStockAdjustment={applyLocalStockAdjustment}
          onSuccess={() => { setAdjustRow(null); load(false); }}
        />
      )}

      {/* Drawer de historial */}
      {historialRow && (
        <HistorialDrawer
          row={historialRow}
          onClose={() => setHistorialRow(null)}
          onReverted={() => { setHistorialRow(null); load(false); }}
        />
      )}

      {/* Modal de asociar producto al catálogo (no-catalogados) */}
      {aliasRow && (
        <AliasModal
          row={aliasRow}
          onClose={() => setAliasRow(null)}
          onSuccess={() => { setAliasRow(null); load(true); }}
        />
      )}

      {/* Modal de exportar reporte */}
      {exportOpen && report && (
        <ExportReportModal
          filters={{
            marcas, tipos, condicion,
            periodo_inicio: periodoInicio, periodo_fin: periodoFin, mode,
            exclude_zero_activity: excludeZeroActivity,
          }}
          stockAdjustments={stockAdjustmentList}
          items={items}
          includedItems={includedExportItems}
          pvpOverrides={pvpOvr}
          inicioOverrides={inicioOvr}
          finalOverrides={finalOvr}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// Modal de ajuste
// ──────────────────────────────────────────────────────────────────────────

const SUCURSALES = ['CASEROS', 'SUR', 'NORTE', 'CANNING'];

/**
 * Input numérico con botones + arriba y − abajo. El número en el medio es
 * editable a mano. Acepta enteros (incluyendo negativos).
 */
function DeltaStepper({
  label, value, onChange, tone = 'blue', hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  tone?: 'blue' | 'emerald' | 'amber';
  hint?: string;
}) {
  const accent =
    tone === 'emerald' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20'
    : tone === 'amber' ? 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20'
    : 'border-blue-500/40 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20';
  const numColor =
    value > 0 ? 'text-emerald-300'
    : value < 0 ? 'text-red-300'
    : 'text-slate-400';

  function parseValue(text: string): number {
    if (text === '' || text === '-') return 0;
    const n = parseInt(text, 10);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex flex-col items-stretch overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className={`flex items-center justify-center border-b border-slate-800 px-3 py-2 text-xl font-black ${accent}`}
          aria-label="Aumentar"
        >
          +
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="-?[0-9]*"
          value={value}
          onChange={(e) => onChange(parseValue(e.target.value))}
          className={`bg-transparent px-3 py-3 text-center text-3xl font-black outline-none focus:bg-slate-900 ${numColor}`}
        />
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          className={`flex items-center justify-center border-t border-slate-800 px-3 py-2 text-xl font-black ${accent}`}
          aria-label="Disminuir"
        >
          −
        </button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}


function AdjustModal({
  row, periodoInicio, periodoFin, onClose, onSuccess, onStockAdjustment,
}: {
  row: PSIReportRow;
  periodoInicio: string;
  periodoFin: string;
  onClose: () => void;
  onSuccess: () => void;
  onStockAdjustment: (productId: number, delta: number) => void;
}) {
  const [target, setTarget] = useState<PSITarget>('sell_out');
  const [sucursal, setSucursal] = useState<string>('CASEROS');
  // En modo 'sell_out' o 'stock' usamos `delta`. En 'both' se usan independientes:
  //   ventaDelta → suma a sell_out como pendiente.
  //   stockDelta → suma al stock solo en memoria (temporal).
  const [delta, setDelta] = useState<number>(1);
  const [ventaDelta, setVentaDelta] = useState<number>(1);
  const [stockDelta, setStockDelta] = useState<number>(-1);
  const [fechaMode, setFechaMode] = useState<'manual' | 'random'>('random');
  const [fechaManual, setFechaManual] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const involvesSale = target === 'sell_out' || target === 'both';

  // Previews
  const sellOutNew = target === 'stock' ? row.sell_out
    : target === 'both' ? row.sell_out + ventaDelta
    : row.sell_out + delta;
  const stockNew = target === 'sell_out' ? row.stock
    : target === 'stock' ? row.stock + delta
    : row.stock + stockDelta;

  // Validación según target
  const valid =
    (!involvesSale || fechaMode === 'random' || (!!fechaManual && fechaManual >= periodoInicio && fechaManual <= periodoFin)) &&
    (target === 'both' ? (ventaDelta !== 0 || stockDelta !== 0) : delta !== 0);

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const base = {
        product_id: row.product_id,
        sucursal,
        periodo_inicio: periodoInicio,
        periodo_fin: periodoFin,
        fecha_mode: fechaMode,
        fecha_manual: fechaMode === 'manual' ? fechaManual : null,
        reason: reason.trim(),
      } as const;

      let needsReload = false;
      if (target === 'both') {
        if (ventaDelta !== 0) {
          await createPSIAdjustment({ ...base, target: 'sell_out', cantidad_delta: ventaDelta });
          needsReload = true;
        }
        if (stockDelta !== 0) {
          onStockAdjustment(row.product_id, stockDelta);
        }
      } else if (target === 'stock') {
        onStockAdjustment(row.product_id, delta);
      } else {
        await createPSIAdjustment({ ...base, target, cantidad_delta: delta });
        needsReload = true;
      }
      if (needsReload) onSuccess();
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el ajuste.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white">Ajustar PSI</h2>
            <p className="mt-1 text-sm text-slate-400">
              <span className="font-mono">{row.sku}</span> · {row.descripcion}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        {/* Selector de target */}
        <div className="mt-4">
          <label className={labelClass}>Tipo de ajuste</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: 'sell_out', label: 'Venta', desc: 'Pendiente hasta guardar' },
              { value: 'stock',    label: 'Stock', desc: 'Temporal, no se guarda' },
              { value: 'both',     label: 'Ambos', desc: 'Venta pendiente + stock temporal' },
            ] as { value: PSITarget; label: string; desc: string }[]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTarget(opt.value)}
                className={`rounded-xl border px-3 py-2 text-left text-xs ${
                  target === opt.value
                    ? 'border-blue-400 bg-blue-500/15 text-blue-100'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="font-black">{opt.label}</div>
                <div className="mt-0.5 opacity-70">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Preview de valores */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-950/60 p-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">Sell out</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg text-slate-400">{row.sell_out}</span>
              <span className="text-slate-600">→</span>
              <span className={`text-2xl font-black ${target === 'stock' ? 'text-slate-500' : sellOutNew > row.sell_out ? 'text-emerald-300' : sellOutNew < row.sell_out ? 'text-red-300' : 'text-slate-500'}`}>
                {sellOutNew}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Stock</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg text-slate-400">{row.stock}</span>
              <span className="text-slate-600">→</span>
              <span className={`text-2xl font-black ${target === 'sell_out' ? 'text-slate-500' : stockNew > row.stock ? 'text-emerald-300' : stockNew < row.stock ? 'text-red-300' : 'text-slate-500'}`}>
                {stockNew}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {target === 'both' ? (
            <div className="grid grid-cols-2 gap-3">
              <DeltaStepper
                label="Δ Venta (al GFK)"
                value={ventaDelta}
                onChange={setVentaDelta}
                tone="emerald"
              />
              <DeltaStepper
                label="Δ Stock"
                value={stockDelta}
                onChange={setStockDelta}
                tone="amber"
                hint="Negativo descuenta del stock."
              />
            </div>
          ) : (
            <DeltaStepper
              label="Cantidad del ajuste"
              value={delta}
              onChange={setDelta}
              tone="blue"
            />
          )}

          {involvesSale && (
            <>
              <div>
                <label className={labelClass}>Sucursal del ajuste</label>
                <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className={inputClass}>
                  {SUCURSALES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className={labelClass}>Fecha que va al GFK al guardar</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input type="radio" name="fmode" checked={fechaMode === 'random'} onChange={() => setFechaMode('random')} />
                    <span>Aleatoria dentro del rango (<b className="text-slate-300">{periodoInicio} → {periodoFin}</b>)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input type="radio" name="fmode" checked={fechaMode === 'manual'} onChange={() => setFechaMode('manual')} />
                    <span>Elegir manualmente:</span>
                    <input
                      type="date"
                      value={fechaManual}
                      min={periodoInicio}
                      max={periodoFin}
                      onChange={(e) => setFechaManual(e.target.value)}
                      disabled={fechaMode !== 'manual'}
                      className={`${inputClass} flex-1`}
                    />
                  </label>
                </div>
              </div>
            </>
          )}

          <div>
            <label className={labelClass}>Motivo (opcional)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="venta web no registrada, etc."
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100/90">
          <AlertTriangle size={12} className="mr-1 inline" />
          {target === 'stock'
            ? 'El stock se ajusta solo en esta pantalla. Limpiar, aplicar filtros o refrescar sin cache elimina este ajuste.'
            : 'La venta queda pendiente. No se escribe al GFK hasta tocar Guardar en GFK.'}
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving || !valid}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-60"
          >
            {saving ? 'Guardando...' : target === 'stock' ? 'Aplicar temporal' : 'Agregar pendiente'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// Drawer de historial
// ──────────────────────────────────────────────────────────────────────────

function HistorialDrawer({ row, onClose, onReverted }: { row: PSIReportRow; onClose: () => void; onReverted: () => void }) {
  const [reverting, setReverting] = useState<number | null>(null);
  const [error, setError] = useState('');
  const canAdjust = can('psi.adjust');

  async function handleRevert(adj: PSIAdjustmentInfo) {
    if (!window.confirm(`¿Revertir el ajuste de ${adj.delta > 0 ? '+' : ''}${adj.delta} unidades del ${adj.fecha}?`)) return;
    setReverting(adj.id); setError('');
    try {
      await revertPSIAdjustment(adj.id);
      onReverted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo revertir.');
    } finally {
      setReverting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="w-full max-w-md overflow-y-auto border-l border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black text-white">
              <History size={18} /> Historial de ajustes
            </h3>
            <p className="mt-1 text-xs text-slate-400 font-mono">{row.sku}</p>
            <p className="text-xs text-slate-500">{row.descripcion}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        )}

        <div className="mt-4 space-y-3">
          {row.historial_ajustes.length === 0 && (
            <p className="text-sm text-slate-500">Sin ajustes en este rango.</p>
          )}
          {row.historial_ajustes.map((adj) => {
            const statusColor =
              adj.status === 'applied_to_sheet' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : adj.status === 'pending' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : adj.status === 'reverted' ? 'border-slate-700 bg-slate-900 text-slate-400 line-through opacity-70'
              : 'border-red-500/40 bg-red-500/10 text-red-200';
            const canRevertThis = canAdjust && (adj.status === 'applied_to_sheet' || adj.status === 'pending');
            return (
              <div key={adj.id} className={`rounded-2xl border p-3 ${statusColor}`}>
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-bold">
                    {adj.delta > 0 ? `+${adj.delta}` : adj.delta} unidades
                  </div>
                  <span className="text-xs uppercase tracking-wide">
                    {adj.status === 'applied_to_sheet' ? <CheckCircle2 size={12} className="inline" /> : null} {adj.status}
                  </span>
                </div>
                <div className="mt-1 text-xs">
                  {adj.fecha} · {adj.sucursal} · {adj.fecha_mode}
                </div>
                {adj.reason && <div className="mt-1 text-xs italic opacity-90">"{adj.reason}"</div>}
                <div className="mt-1 text-[10px] opacity-60">id #{adj.id}{adj.created_by ? ` · ${adj.created_by}` : ''}</div>
                {canRevertThis && (
                  <button
                    onClick={() => handleRevert(adj)}
                    disabled={reverting === adj.id}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-red-500/40 px-2 py-1 text-xs font-bold text-red-200 hover:bg-red-500/10 disabled:opacity-60"
                  >
                    <Trash2 size={12} /> {reverting === adj.id ? 'Procesando...' : adj.status === 'pending' ? 'Descartar' : 'Revertir'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// Modal: Asociar producto del catálogo a un SKU no catalogado
// ──────────────────────────────────────────────────────────────────────────

function AliasModal({
  row, onClose, onSuccess,
}: {
  row: PSINoCatalogadoRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [query, setQuery] = useState<string>(row.descripcion_raw);
  const [results, setResults] = useState<PSIProductSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PSIProductSearchRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Search con debounce simple
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchPSIProducts(trimmed, 20);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function handleSave() {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await createPSIAlias({
        product_id: selected.id,
        alias_sku: row.sku_raw || undefined,
        alias_desc: row.descripcion_raw || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el alias.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white">Asociar a producto del catálogo</h2>
            <p className="mt-1 text-sm text-slate-400">
              El SKU/descripción del GFK no matchea ningún producto. Asocialo manualmente —
              quedará guardado para próximas consultas.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        {/* Origen */}
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-100/90">
          <div className="text-xs text-amber-200/70 uppercase tracking-wide font-bold">Origen del GFK</div>
          <div className="mt-1"><b className="font-mono text-amber-200">{row.sku_raw}</b></div>
          <div className="text-xs">{row.descripcion_raw}</div>
          <div className="mt-1 text-[11px] text-amber-200/70">{row.cantidad_total} unidades en {row.sucursales.join(', ')}</div>
        </div>

        {/* Búsqueda */}
        <div className="mt-4">
          <label className={labelClass}>Buscar producto del catálogo</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Descripción, SKU o marca (mínimo 2 caracteres)"
            className={inputClass}
            autoFocus
          />
        </div>

        {/* Resultados */}
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
          {searching && (
            <div className="p-4 text-center text-sm text-slate-500">Buscando...</div>
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <div className="p-4 text-center text-sm text-slate-500">Sin resultados.</div>
          )}
          {!searching && results.length > 0 && (
            <ul className="divide-y divide-slate-800">
              {results.map((p) => (
                <li
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`cursor-pointer p-3 text-sm hover:bg-slate-800/60 ${selected?.id === p.id ? 'bg-blue-500/15' : ''}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className={`font-mono text-xs ${selected?.id === p.id ? 'text-blue-200' : 'text-slate-400'}`}>{p.sku}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${p.condicion === 'OUTLET' ? 'text-amber-300' : 'text-emerald-400'}`}>
                      {p.condicion}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">{p.marca} · {p.tipo}</span>
                  </div>
                  <div className={`mt-0.5 text-sm ${selected?.id === p.id ? 'text-white' : 'text-slate-300'}`}>{p.descripcion}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <div className="mt-3 rounded-xl border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-blue-100">
            <b>Se asociará con:</b> <span className="font-mono">{selected.sku}</span> — {selected.descripcion}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving || !selected}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-60"
          >
            <Link2 size={14} /> {saving ? 'Asociando...' : 'Asociar al catálogo'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// Modal: Exportar reporte
// ──────────────────────────────────────────────────────────────────────────

const PSI_EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'descripcion', label: 'Descripción' },
  { key: 'marca', label: 'Marca' },
  { key: 'pvp', label: 'PVP' },
  { key: 'stock_inicio', label: 'Stock inicio' },
  { key: 'stock_final', label: 'Stock final' },
  { key: 'sell_out', label: 'Sell-out' },
];

function ExportReportModal({
  filters, stockAdjustments, items, includedItems, pvpOverrides, inicioOverrides, finalOverrides, onClose,
}: {
  filters: {
    marcas: string[]; tipos: string[]; condicion: PSICondicionFilter;
    periodo_inicio: string; periodo_fin: string; mode: PSIMode;
    exclude_zero_activity: boolean;
  };
  stockAdjustments: { product_id: number; delta: number }[];
  items: PSIReportRow[];
  includedItems: PSIReportRow[];
  pvpOverrides: Record<number, number>;
  inicioOverrides: Record<number, number>;
  finalOverrides: Record<number, number>;
  onClose: () => void;
}) {
  const defaultTitle = useMemo(() => {
    const marca = filters.marcas[0] ? filters.marcas[0].toUpperCase() : 'GENERAL';
    const pi = filters.periodo_inicio.split('-').slice(1).reverse().join('/');
    const pf = filters.periodo_fin.split('-').slice(1).reverse().join('/');
    return `${marca} ${pi} al ${pf}`;
  }, [filters]);

  const [titulo, setTitulo] = useState(defaultTitle);
  const [logo, setLogo] = useState<'GV' | 'ABC' | 'NONE'>('GV');
  const [cols, setCols] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PSI_EXPORT_COLUMNS.map((c) => [c.key, true])),
  );
  const [generating, setGenerating] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState('');

  const selectedColumns = PSI_EXPORT_COLUMNS.filter((c) => cols[c.key]).map((c) => c.key);
  const canGenerate = selectedColumns.length > 0 && includedItems.length > 0;

  async function handleGenerate(format: 'pdf' | 'xlsx') {
    setGenerating(format); setError('');
    try {
      const payload = {
        titulo: titulo.trim(),
        logo,
        columns: selectedColumns,
        marcas: filters.marcas,
        tipos: filters.tipos,
        condicion: filters.condicion,
        periodo_inicio: filters.periodo_inicio,
        periodo_fin: filters.periodo_fin,
        mode: filters.mode,
        exclude_zero_activity: filters.exclude_zero_activity,
        stock_adjustments: stockAdjustments,
        stock_inicio_overrides: inicioOverrides,
        stock_final_overrides: finalOverrides,
        pvp_overrides: pvpOverrides,
        // Solo mandamos IDs si es un subconjunto; vacío = todos.
        include_product_ids: includedItems.length === items.length ? [] : includedItems.map((r) => r.product_id),
      };
      const blob = format === 'pdf' ? await exportPSIPdf(payload) : await exportPSIXlsx(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (titulo.trim() || 'reporte').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase();
      a.download = `psi-${slug}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `No se pudo generar el ${format.toUpperCase()}.`);
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 p-6 pb-3">
          <h2 className="text-lg font-black text-white">Exportar reporte</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        <div className="grid gap-4 overflow-y-auto px-6">
          <div>
            <label className={labelClass}>Título del PDF <span className="font-normal text-slate-500">(vacío = sin título)</span></label>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Sin título"
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass}>Columnas a mostrar</label>
            <div className="flex flex-wrap gap-2">
              {PSI_EXPORT_COLUMNS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCols((s) => ({ ...s, [c.key]: !s[c.key] }))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                    cols[c.key]
                      ? 'border-blue-400 bg-blue-500/15 text-blue-100'
                      : 'border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {cols[c.key] ? '✓ ' : ''}{c.label}
                </button>
              ))}
            </div>
            {selectedColumns.length === 0 && <p className="mt-1 text-xs text-amber-300">Elegí al menos una columna.</p>}
            {selectedColumns.length > 0 && includedItems.length === 0 && <p className="mt-1 text-xs text-amber-300">No hay productos seleccionados. Tildá al menos uno en la tabla.</p>}
          </div>

          <div>
            <label className={labelClass}>Logo</label>
            <div className="grid grid-cols-3 gap-2">
              {(['GV', 'ABC', 'NONE'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setLogo(opt)}
                  className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                    logo === opt
                      ? 'border-blue-400 bg-blue-500/15 text-blue-100'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {opt === 'NONE' ? 'Sin logo' : opt}
                </button>
              ))}
            </div>
          </div>

          {/* La selección de productos + PVP/stock inicio-final se edita en la tabla principal. */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-xs text-slate-400">
            <span className="font-bold text-slate-200">{includedItems.length} de {items.length} productos</span> seleccionados para el reporte.
            {' '}Elegí productos y editá PVP / stock inicio-final desde la tabla.
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        )}

        <div className="flex justify-end gap-2 p-6 pt-4">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">Cancelar</button>
          <button
            onClick={() => handleGenerate('xlsx')}
            disabled={!!generating || !canGenerate}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
          >
            <FileDown size={14} /> {generating === 'xlsx' ? 'Generando...' : 'Excel (.xlsx)'}
          </button>
          <button
            onClick={() => handleGenerate('pdf')}
            disabled={!!generating || !canGenerate}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-60"
          >
            <FileDown size={14} /> {generating === 'pdf' ? 'Generando...' : 'PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
