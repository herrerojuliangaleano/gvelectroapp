import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, FileDown, Filter, History,
  Link2, Package, PackageX, RefreshCw, Search, Settings2, Tag, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  can, createPSIAdjustment, createPSIAlias, exportPSIPdf, fetchPSIOptions, fetchPSIReport,
  revertPSIAdjustment, searchPSIProducts,
} from '../api/client';
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

  // Modal de ajuste
  const [adjustRow, setAdjustRow] = useState<PSIReportRow | null>(null);
  // Drawer de historial
  const [historialRow, setHistorialRow] = useState<PSIReportRow | null>(null);
  // Modal de asociar producto al catálogo (no-catalogados)
  const [aliasRow, setAliasRow] = useState<PSINoCatalogadoRow | null>(null);
  // Modal de exportar PDF
  const [exportOpen, setExportOpen] = useState(false);

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
          {canExport && report && (report.items.length > 0) && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20"
            >
              <FileDown size={14} /> Exportar PDF
            </button>
          )}
          {report?.data_freshness?.gfk_files_used?.length ? (
            <span className="ml-auto text-xs text-slate-500">
              GFK consultados: <b className="text-slate-300">{report.data_freshness.gfk_files_used.map((f) => `#${f.correlativo}`).join(', ')}</b>
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
            SKUs que aparecen en el GFK pero no matchean ningún producto del catálogo (ni por descripción ni por SKU).
            Para incluir sus ventas en el reporte, podés <b>asociarlos manualmente</b> a un producto del catálogo.
            La asociación se persiste y se aplica automáticamente las próximas veces.
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
                    {canAdjust && <th className="px-3 py-2 text-center">Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {report.no_catalogados.map((nc, i) => (
                    <tr key={`${nc.sku_raw}-${i}`} className="border-t border-amber-500/15 text-amber-100/90">
                      <td className="px-3 py-2 font-mono text-xs">{nc.sku_raw}</td>
                      <td className="px-3 py-2 max-w-md truncate" title={nc.descripcion_raw}>{nc.descripcion_raw}</td>
                      <td className="px-3 py-2 text-right font-bold">{nc.cantidad_total}</td>
                      <td className="px-3 py-2 text-xs text-amber-200/70">{nc.sucursales.join(', ')}</td>
                      {canAdjust && (
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => setAliasRow(nc)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/20"
                          >
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
        </section>
      )}

      {/* Aviso si no hay GFK para el rango */}
      {report?.data_freshness?.no_gfk_available && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle size={14} className="mr-2 inline text-amber-300" />
          <b>No hay archivo GFK que cubra este rango.</b> Generá el GFK con la herramienta{' '}
          <a href="/herramientas" className="underline">Herramientas → Generar GFK</a> con un rango que incluya este período y volvé a aplicar los filtros.
          Sin GFK, el sell out aparece en cero (pero el stock se sigue mostrando).
        </div>
      )}

      {/* Footer informativo */}
      {report && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">
          <BarChart3 size={12} className="mr-2 inline" />
          Cache stock: {report.data_freshness.stock_fetched_at?.slice(11, 19) || '—'} ·
          Cache GFK: {report.data_freshness.ventas_fetched_at?.slice(11, 19) || '—'}
          {report.data_freshness.gfk_files_used.length > 0 && (
            <> · <span className="text-slate-400">{report.data_freshness.gfk_files_used.length} GFK consultados</span></>
          )}
          <Tag size={12} className="mx-2 inline" />
          Filtros activos: {report.filters_applied.marcas.length} marcas · {report.filters_applied.tipos.length} tipos · {report.filters_applied.condicion}
          {!canExport && <span className="ml-3 text-slate-600">· Export PDF no disponible (Sprint 5)</span>}
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

      {/* Modal de asociar producto al catálogo (no-catalogados) */}
      {aliasRow && (
        <AliasModal
          row={aliasRow}
          onClose={() => setAliasRow(null)}
          onSuccess={() => { setAliasRow(null); load(true); }}
        />
      )}

      {/* Modal de exportar PDF */}
      {exportOpen && report && (
        <ExportPdfModal
          filters={{
            marcas, tipos, condicion,
            periodo_inicio: periodoInicio, periodo_fin: periodoFin, mode,
          }}
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
  row, periodoInicio, periodoFin, onClose, onSuccess,
}: {
  row: PSIReportRow;
  periodoInicio: string;
  periodoFin: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [target, setTarget] = useState<PSITarget>('sell_out');
  const [sucursal, setSucursal] = useState<string>('CASEROS');
  // En modo 'sell_out' o 'stock' usamos `delta`. En 'both' se usan independientes:
  //   ventaDelta → suma a sell_out (y se escribe al GFK)
  //   stockDelta → suma al stock (negativo descuenta). Default −ventaDelta cuando el
  //                gerente activa 'Ambos' (caso típico "vendí N más, descontar N").
  const [delta, setDelta] = useState<number>(1);
  const [ventaDelta, setVentaDelta] = useState<number>(1);
  const [stockDelta, setStockDelta] = useState<number>(-1);
  const [fechaMode, setFechaMode] = useState<'manual' | 'random'>('random');
  const [fechaManual, setFechaManual] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Previews
  const sellOutNew = target === 'stock' ? row.sell_out
    : target === 'both' ? row.sell_out + ventaDelta
    : row.sell_out + delta;
  const stockNew = target === 'sell_out' ? row.stock
    : target === 'stock' ? row.stock + delta
    : row.stock + stockDelta;

  // Validación según target
  const valid =
    (fechaMode === 'random' || (!!fechaManual && fechaManual >= periodoInicio && fechaManual <= periodoFin)) &&
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

      if (target === 'both') {
        // Disparamos 2 ajustes (uno para venta, otro para stock) si ambos != 0.
        // Uno solo si alguno es 0.
        if (ventaDelta !== 0) {
          await createPSIAdjustment({ ...base, target: 'sell_out', cantidad_delta: ventaDelta });
        }
        if (stockDelta !== 0) {
          await createPSIAdjustment({ ...base, target: 'stock', cantidad_delta: stockDelta });
        }
      } else {
        await createPSIAdjustment({ ...base, target, cantidad_delta: delta });
      }
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

        {/* Selector de target */}
        <div className="mt-4">
          <label className={labelClass}>Tipo de ajuste</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: 'sell_out', label: 'Venta', desc: 'Solo sell out (al GFK)' },
              { value: 'stock',    label: 'Stock', desc: 'Solo stock (Postgres)' },
              { value: 'both',     label: 'Ambos', desc: 'Venta +Δ y stock −Δ' },
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
          {target === 'stock'
            ? 'Solo se registra en la base. El stock efectivo del PSI se ajusta; el sheet de Stock no se toca. Es reversible.'
            : 'Escribe una fila al GFK que cubre la fecha del ajuste (TipoVendedor=AJUSTE, Nombre=PSI-id). Es reversible.'}
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
// Modal: Exportar PDF
// ──────────────────────────────────────────────────────────────────────────

function ExportPdfModal({
  filters, onClose,
}: {
  filters: {
    marcas: string[]; tipos: string[]; condicion: PSICondicionFilter;
    periodo_inicio: string; periodo_fin: string; mode: PSIMode;
  };
  onClose: () => void;
}) {
  // Título default sugerido
  const defaultTitle = useMemo(() => {
    const marca = filters.marcas[0] ? filters.marcas[0].toUpperCase() : 'GENERAL';
    const pi = filters.periodo_inicio.split('-').slice(1).reverse().join('/');
    const pf = filters.periodo_fin.split('-').slice(1).reverse().join('/');
    return `PSI ${marca} ${pi} al ${pf}`;
  }, [filters]);

  const [titulo, setTitulo] = useState(defaultTitle);
  const [logo, setLogo] = useState<'GV' | 'ABC' | 'NONE'>('GV');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setGenerating(true); setError('');
    try {
      const blob = await exportPSIPdf({
        titulo: titulo.trim() || 'PSI',
        logo,
        marcas: filters.marcas,
        tipos: filters.tipos,
        condicion: filters.condicion,
        periodo_inicio: filters.periodo_inicio,
        periodo_fin: filters.periodo_fin,
        mode: filters.mode,
      });
      // Descargar
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (titulo.trim() || 'psi').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase();
      a.download = `psi-${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el PDF.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-black text-white">Exportar PSI a PDF</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        <div className="mt-4 grid gap-3">
          <div>
            <label className={labelClass}>Título</label>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className={inputClass}
              autoFocus
            />
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
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">Cancelar</button>
          <button
            onClick={handleGenerate}
            disabled={generating || !titulo.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-60"
          >
            <FileDown size={14} /> {generating ? 'Generando...' : 'Generar y descargar'}
          </button>
        </div>
      </div>
    </div>
  );
}
