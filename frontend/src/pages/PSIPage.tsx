import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, Filter, History, Package,
  PackageX, RefreshCw, Search, Settings2, Tag, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  can, createPSIAdjustment, fetchPSIOptions, fetchPSIReport, revertPSIAdjustment,
} from '../api/client';
import type {
  PSIAdjustmentInfo, PSICondicionFilter, PSIMode, PSIOptionsResponse,
  PSIReportResponse, PSIReportRow,
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

  // Modal de ajuste
  const [adjustRow, setAdjustRow] = useState<PSIReportRow | null>(null);
  // Drawer de historial
  const [historialRow, setHistorialRow] = useState<PSIReportRow | null>(null);

  const canExport = can('psi.export');
  const canAdjust = can('psi.adjust');

  useEffect(() => { fetchPSIOptions().then(setOptions).catch(() => {}); }, []);

  async function load(forceRefresh = false) {
    setLoading(true); setError('');
    try {
      const data = await fetchPSIReport({
        marcas, tipos, condicion, periodo_inicio: periodoInicio, periodo_fin: periodoFin,
        mode, force_refresh: forceRefresh,
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el PSI');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Recargar cuando cambia el modo (default ↔ advanced)
  useEffect(() => { load(false); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters() { load(false); }
  function clearFilters() {
    setMarcas([]); setTipos([]); setCondicion('TODO');
    const r = defaultRange(); setPeriodoInicio(r.inicio); setPeriodoFin(r.fin);
    setMode('default');
  }

  const items: PSIReportRow[] = report?.items || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-blue-300">
            <TrendingUp size={14} /> Comercial
          </p>
          <h1 className="mt-1 text-3xl font-black text-white">PSI · Planificación de Ventas e Inventario</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Consolidado por marca / tipo / condición. Cruza el catálogo con el stock actual y las ventas del rango.
            Los ajustes manuales se aplican al libro mensual y aparecen automáticamente en el GFK.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900 disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refrescar (sin cache)
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-100">
          <AlertTriangle size={14} className="mr-2 inline" />{error}
        </div>
      )}

      {/* Filtros */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-300">
          <Filter size={14} /> Filtros
        </h2>
        <div className="grid gap-4 lg:grid-cols-4">
          <MultiSelect
            label="Marcas"
            options={options?.marcas || []}
            value={marcas}
            onChange={setMarcas}
            placeholder="Todas las marcas"
          />
          <MultiSelect
            label="Tipos"
            options={options?.tipos || []}
            value={tipos}
            onChange={setTipos}
            placeholder="Todos los tipos"
          />
          <div>
            <label className={labelClass}>Condición</label>
            <div className="flex gap-2">
              {(['TODO', 'PRIMERA', 'OUTLET'] as PSICondicionFilter[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCondicion(c)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold ${
                    condicion === c
                      ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {c === 'TODO' ? 'Todas' : c === 'PRIMERA' ? 'Primera' : 'Outlet'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Desde</label>
              <input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Hasta</label>
              <input type="date" value={periodoFin} onChange={(e) => setPeriodoFin(e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={applyFilters}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-60"
          >
            {loading ? 'Cargando...' : 'Aplicar'}
          </button>
          <button onClick={clearFilters} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">
            Limpiar
          </button>
          {canAdjust && (
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'advanced' ? 'default' : 'advanced'))}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold ${
                mode === 'advanced'
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                  : 'border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900'
              }`}
              title="Mostrar todos los productos del catálogo filtrado (incluso sin stock/ventas) para poder ajustar cualquiera"
            >
              <Settings2 size={14} /> {mode === 'advanced' ? 'Ajustes avanzados: ON' : 'Ajustes avanzados'}
            </button>
          )}
          {report?.data_freshness?.months_used?.length ? (
            <span className="ml-auto text-xs text-slate-500">
              Meses leídos: <b className="text-slate-300">{report.data_freshness.months_used.join(', ')}</b>
            </span>
          ) : null}
        </div>
      </section>

      {/* KPIs */}
      {report && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPI label="Productos visibles"   value={report.totals.productos_visibles} accent="blue" />
          <KPI label="Stock total"          value={report.totals.stock} />
          <KPI label="Sell out (rango)"     value={report.totals.sell_out} accent="green" />
          <KPI label="Ajustes pendientes"   value={report.totals.ajustes_pendientes} accent={report.totals.ajustes_pendientes > 0 ? 'amber' : undefined} />
        </div>
      )}

      {/* Tabla principal */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black text-white">
            <Package size={18} /> Productos
            {report?.totals.productos_visibles ? <span className="text-xs font-normal text-slate-500">({report.totals.productos_visibles})</span> : null}
          </h2>
          {!canAdjust && <span className="text-xs text-slate-500">Sin permiso para ajustar</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Marca</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 text-center">Cond.</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Sell out</th>
                <th className="px-3 py-2 text-right">Δ ajuste</th>
                {canAdjust && <th className="px-3 py-2 text-center">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.product_id} className="border-t border-slate-800 text-slate-200 hover:bg-slate-900/50">
                  <td className="px-3 py-2 whitespace-nowrap font-semibold">{r.marca}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.tipo}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.sku}</td>
                  <td className="px-3 py-2 max-w-md truncate" title={r.descripcion}>{r.descripcion}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                      r.condicion === 'OUTLET' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {r.condicion === 'OUTLET' ? 'OUT' : 'PRI'}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${r.stock <= 0 ? 'text-red-300' : 'text-slate-200'}`}>{r.stock}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-200">
                    {r.historial_ajustes.length > 0 ? (
                      <button onClick={() => setHistorialRow(r)} className="hover:underline" title="Ver historial de ajustes">
                        {r.sell_out}
                        {r.has_pending_adjustment && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />}
                      </button>
                    ) : r.sell_out}
                  </td>
                  <td className={`px-3 py-2 text-right ${r.ajuste_delta > 0 ? 'text-emerald-300' : r.ajuste_delta < 0 ? 'text-red-300' : 'text-slate-600'}`}>
                    {r.ajuste_delta !== 0 ? (r.ajuste_delta > 0 ? `+${r.ajuste_delta}` : r.ajuste_delta) : '—'}
                  </td>
                  {canAdjust && (
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setAdjustRow(r)}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-300 hover:bg-slate-800"
                        title="Crear ajuste"
                      >
                        +/−
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={canAdjust ? 9 : 8} className="px-3 py-12 text-center text-slate-500">
                  No hay productos para los filtros aplicados.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* No catalogados */}
      {report?.no_catalogados && report.no_catalogados.length > 0 && (
        <section className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-5">
          <button
            onClick={() => setShowNoCatalogados((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h2 className="flex items-center gap-2 text-lg font-black text-amber-100">
              <PackageX size={18} /> Productos no catalogados
              <span className="text-xs font-normal text-amber-200/70">({report.no_catalogados.length})</span>
            </h2>
            <ChevronDown size={20} className={`text-amber-300 transition-transform ${showNoCatalogados ? 'rotate-180' : ''}`} />
          </button>
          <p className="mt-1 text-sm text-amber-200/80">
            SKUs que aparecen en el libro mensual pero no están en el catálogo de productos. Sus ventas no se cuentan en el reporte.
            Creá el producto en <code className="rounded bg-slate-800 px-1 text-amber-200">/admin/product-catalog</code> con el SKU correspondiente.
          </p>
          {showNoCatalogados && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-amber-200/60">
                  <tr>
                    <th className="px-3 py-2">SKU (raw)</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2">Sucursales</th>
                  </tr>
                </thead>
                <tbody>
                  {report.no_catalogados.map((nc, i) => (
                    <tr key={`${nc.sku_raw}-${i}`} className="border-t border-amber-500/15 text-amber-100/90">
                      <td className="px-3 py-2 font-mono text-xs">{nc.sku_raw}</td>
                      <td className="px-3 py-2 max-w-md truncate" title={nc.descripcion_raw}>{nc.descripcion_raw}</td>
                      <td className="px-3 py-2 text-right font-bold">{nc.cantidad_total}</td>
                      <td className="px-3 py-2 text-xs text-amber-200/70">{nc.sucursales.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Footer informativo */}
      {report && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">
          <BarChart3 size={12} className="mr-2 inline" />
          Cache stock: {report.data_freshness.stock_fetched_at?.slice(11, 19) || '—'} ·
          Cache ventas: {report.data_freshness.ventas_fetched_at?.slice(11, 19) || '—'} ·
          <Tag size={12} className="mx-2 inline" />
          Filtros activos: {report.filters_applied.marcas.length} marcas · {report.filters_applied.tipos.length} tipos · {report.filters_applied.condicion}
          {!canExport && <span className="ml-3 text-slate-600">· Export PDF no disponible (Fase 1 — Sprint 4)</span>}
        </div>
      )}

      {/* Modal de ajuste */}
      {adjustRow && (
        <AdjustModal
          row={adjustRow}
          periodoInicio={periodoInicio}
          periodoFin={periodoFin}
          onClose={() => setAdjustRow(null)}
          onSuccess={() => { setAdjustRow(null); load(true); }}
        />
      )}

      {/* Drawer de historial */}
      {historialRow && (
        <HistorialDrawer
          row={historialRow}
          onClose={() => setHistorialRow(null)}
          onReverted={() => { setHistorialRow(null); load(true); }}
        />
      )}
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// Modal de ajuste
// ──────────────────────────────────────────────────────────────────────────

const SUCURSALES = ['CASEROS', 'SUR', 'NORTE', 'CANNING'];

function AdjustModal({
  row, periodoInicio, periodoFin, onClose, onSuccess,
}: {
  row: PSIReportRow;
  periodoInicio: string;
  periodoFin: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [sucursal, setSucursal] = useState<string>('CASEROS');
  const [delta, setDelta] = useState<number>(1);
  const [fechaMode, setFechaMode] = useState<'manual' | 'random'>('random');
  const [fechaManual, setFechaManual] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sellOutNew = row.sell_out + delta;
  const valid = delta !== 0 && (fechaMode === 'random' || (!!fechaManual && fechaManual >= periodoInicio && fechaManual <= periodoFin));

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await createPSIAdjustment({
        product_id: row.product_id,
        sucursal,
        cantidad_delta: delta,
        periodo_inicio: periodoInicio,
        periodo_fin: periodoFin,
        fecha_mode: fechaMode,
        fecha_manual: fechaMode === 'manual' ? fechaManual : null,
        reason: reason.trim(),
      });
      onSuccess();
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
            <h2 className="text-lg font-black text-white">Ajustar sell out</h2>
            <p className="mt-1 text-sm text-slate-400">
              <span className="font-mono">{row.sku}</span> · {row.descripcion}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        <div className="mt-4 rounded-xl bg-slate-950/60 p-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-400">Sell out actual</span>
            <span className="text-2xl font-black text-slate-200">{row.sell_out}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-slate-400">Nuevo</span>
            <span className={`text-2xl font-black ${delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-red-300' : 'text-slate-500'}`}>
              {sellOutNew}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <div>
            <label className={labelClass}>Cantidad del ajuste (delta)</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDelta(delta - 1)} className="rounded-xl border border-slate-700 px-3 py-2 text-lg font-black text-slate-200 hover:bg-slate-800">−</button>
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(parseInt(e.target.value || '0', 10) || 0)}
                className={`${inputClass} text-center text-lg font-bold`}
              />
              <button type="button" onClick={() => setDelta(delta + 1)} className="rounded-xl border border-slate-700 px-3 py-2 text-lg font-black text-slate-200 hover:bg-slate-800">+</button>
            </div>
          </div>

          <div>
            <label className={labelClass}>Sucursal del ajuste</label>
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className={inputClass}>
              {SUCURSALES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClass}>Fecha que va al GFK</label>
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
          Esta acción escribe una fila al libro mensual del rango (TipoVenta=AJUSTE, Remito=PSI-id). Es reversible.
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
            {saving ? 'Guardando...' : 'Guardar y aplicar'}
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
            const canRevertThis = canAdjust && adj.status === 'applied_to_sheet';
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
                    <Trash2 size={12} /> {reverting === adj.id ? 'Revirtiendo...' : 'Revertir'}
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
