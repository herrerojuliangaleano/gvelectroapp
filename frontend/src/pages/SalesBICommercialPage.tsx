import {
  AlertTriangle, ArrowRight, BarChart3, Building2, CalendarRange, Check, Download, Eye,
  FileSpreadsheet, GitCompare, Layers3, Loader2, MoreVertical, MousePointerClick, Package,
  Presentation, RefreshCw, Search, Settings2, Tags, Target, Trophy,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  can,
  exportSalesBICommercialPdf,
  exportSalesBICommercialXlsx,
  fetchSalesBICommercialOptions,
  fetchSalesBICommercialReport,
} from '../api/client';
import type {
  SalesBICommercialMatrixRow,
  SalesBICommercialMix,
  SalesBICommercialOptions,
  SalesBICommercialProduct,
  SalesBICommercialProductPresence,
  SalesBICommercialReport,
} from '../types';
import {
  CHART_ANIM, CHART_TOOLTIP_ITEM_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE,
  ChartCard, EmptyChartState, KpiCard, Tabs, cn, money, num,
} from '../components/SalesBIWidgets';

type CommercialKind = 'brands' | 'lines' | 'branches';
type CommercialTab = 'overview' | 'brands' | 'lines' | 'branches' | 'products' | 'compare' | 'periods' | 'opportunities' | 'presentation';
type MetricMode = 'units' | 'pvp' | 'both';
type OpportunityLevel = 'critica' | 'alta' | 'media' | 'info';

interface OpportunityCardModel {
  id: string;
  level: OpportunityLevel;
  rule: string;
  title: string;
  tags: string[];
  summary: string;
  metric: string;
  observed: string;
  threshold: string;
  formula: string;
  action: string;
  branch?: string;
  line?: string;
  brand?: string;
}

const KIND_META: Record<CommercialKind, { label: string; title: string; icon: ReactNode; color: string }> = {
  brands: { label: 'Marcas', title: 'BI comercial por marcas', icon: <Tags size={15} />, color: 'var(--chart-blue)' },
  lines: { label: 'Lineas', title: 'BI comercial por lineas', icon: <Layers3 size={15} />, color: 'var(--chart-violet)' },
  branches: { label: 'Sucursales', title: 'Perfil comercial de sucursales', icon: <Building2 size={15} />, color: 'var(--chart-teal)' },
};

const PALETTE = [
  'var(--chart-blue)',
  'var(--chart-violet)',
  'var(--chart-teal)',
  'var(--chart-amber)',
  '#ec4899',
  '#64748b',
  '#22c55e',
  '#f97316',
];

const inputClass = 'h-11 w-full rounded-xl border border-white/15 bg-slate-950/40 px-3 text-sm font-medium text-white outline-none transition focus:border-[color:var(--chart-blue)]';

function kindFromPath(pathname: string): CommercialKind {
  if (pathname.includes('/lineas')) return 'lines';
  if (pathname.includes('/sucursales')) return 'branches';
  return 'brands';
}

function tabFromKind(kind: CommercialKind): CommercialTab {
  if (kind === 'lines') return 'lines';
  if (kind === 'branches') return 'branches';
  return 'brands';
}

function kindForTab(tab: CommercialTab): CommercialKind {
  if (tab === 'lines') return 'lines';
  if (tab === 'branches' || tab === 'opportunities') return 'branches';
  return 'brands';
}

function toCsv(value: string) {
  return value.trim() || undefined;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function colorFor(index: number) {
  return PALETTE[index % PALETTE.length];
}

function metricValue(row: Pick<SalesBICommercialMix, 'total_vendido' | 'unidades'>, mode: MetricMode) {
  return mode === 'units' ? row.unidades : row.total_vendido;
}

function metricFormatter(mode: MetricMode) {
  return mode === 'units' ? num : money;
}

function metricLabel(mode: MetricMode) {
  if (mode === 'units') return 'Unidades';
  if (mode === 'pvp') return 'PVP vendido';
  return 'PVP y unidades';
}

function metricDisplay(row: Pick<SalesBICommercialMix, 'total_vendido' | 'unidades'>, mode: MetricMode) {
  if (mode === 'units') return `${num(row.unidades)} u`;
  if (mode === 'pvp') return money(row.total_vendido);
  return `${money(row.total_vendido)} · ${num(row.unidades)} u`;
}

function hasMetricRows(rows: Array<Pick<SalesBICommercialMix, 'total_vendido' | 'unidades'>>, mode: MetricMode) {
  return rows.some((row) => {
    if (mode === 'units') return Number(row.unidades || 0) > 0;
    if (mode === 'pvp') return Number(row.total_vendido || 0) > 0;
    return Number(row.total_vendido || 0) > 0 || Number(row.unidades || 0) > 0;
  });
}

function hasDailyData(report: SalesBICommercialReport, mode: MetricMode) {
  return hasMetricRows(report.daily_series, mode);
}

function hasSeriesData(rows: Array<Record<string, string | number>>, keys: string[]) {
  return rows.some((row) => keys.some((key) => Number(row[key] || 0) > 0));
}

function shareSubtitle(row?: SalesBICommercialMix) {
  if (!row) return '';
  return `${num(row.unidades)} unidades · ${row.participacion_pct.toFixed(1)}%`;
}

function rowByName(rows: SalesBICommercialMix[], name: string) {
  return rows.find((row) => row.name === name) || rows[0] || null;
}

function matrixByName(rows: SalesBICommercialMatrixRow[] | undefined, name: string) {
  return (rows || []).find((row) => row.name === name) || null;
}

function matrixItem(row: SalesBICommercialMatrixRow | null, name: string) {
  return row?.items.find((item) => item.name === name) || null;
}

function matrixSeriesRows(matrix: SalesBICommercialMatrixRow[] | undefined, keys: string[], mode: MetricMode) {
  return (matrix || []).map((row) => {
    const out: Record<string, string | number> = { name: row.name };
    keys.forEach((key) => {
      const item = matrixItem(row, key);
      out[key] = item ? metricValue(item, mode) : 0;
    });
    return out;
  });
}

function productPresenceRows(report: SalesBICommercialReport): SalesBICommercialProductPresence[] {
  return report.product_presence?.length ? report.product_presence : report.top_products.map((product) => ({
    ...product,
    branches: [],
    branch_count: 0,
    is_common: false,
    is_exclusive: false,
    exclusive_branch: '',
    branch_metrics: [],
  }));
}

function isoDate(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function previousRange(fechaDesde: string, fechaHasta: string) {
  const start = parseIsoDate(fechaDesde);
  const end = parseIsoDate(fechaHasta);
  if (!start || !end || end < start) return null;
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { fecha_desde: isoDate(previousStart), fecha_hasta: isoDate(previousEnd) };
}

function pctDelta(current: number, previous?: number) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function deltaLabel(delta: number | null) {
  if (delta === null || Number.isNaN(delta)) return 's/d';
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

function safePct(value: number) {
  return Math.max(0, Math.min(100, value || 0));
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$ ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$ ${(value / 1_000).toFixed(0)}K`;
  return money(value);
}

function MetricModeSelector({ value, onChange }: { value: MetricMode; onChange: (mode: MetricMode) => void }) {
  const options: Array<{ value: MetricMode; label: string; icon: string }> = [
    { value: 'units', label: 'Unidades', icon: '#' },
    { value: 'pvp', label: 'PVP', icon: '$' },
    { value: 'both', label: 'Ambos', icon: '◇' },
  ];
  return (
    <div className="flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/40 p-1 sm:w-auto" style={{ scrollbarWidth: 'none' }}>
      <span className="hidden px-2 text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)] sm:inline">Medir en</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black transition',
            value === option.value
              ? 'bg-[color:var(--chart-blue)] text-white shadow-[0_8px_24px_-10px_var(--chart-blue)]'
              : 'text-[color:var(--text-2)] hover:bg-white/[0.06] hover:text-white',
          )}
        >
          <span>{option.icon}</span>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">{label}</span>
      {children}
    </label>
  );
}

function ViewMenu({
  presentation,
  setPresentation,
  onExportPdf,
  exporting,
}: {
  presentation: boolean;
  setPresentation: (value: boolean) => void;
  onExportPdf: () => void;
  exporting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition',
          presentation
            ? 'border-amber-500/35 bg-amber-500/15 text-amber-200'
            : 'border-white/15 text-[color:var(--text)] hover:bg-white/10',
        )}
      >
        <MoreVertical size={16} />
        <span className="hidden sm:inline">{presentation ? 'Presentacion' : 'Vista'}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-white/10 bg-[color:var(--surface)] p-2 shadow-2xl">
          <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">
            Modo de visualizacion
          </div>
          <button
            type="button"
            onClick={() => { setPresentation(false); setOpen(false); }}
            className={cn('flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.06]', !presentation && 'bg-white/[0.05]')}
          >
            <Eye className="mt-0.5 text-[color:var(--chart-blue)]" size={17} />
            <span>
              <span className="block text-sm font-black text-white">Modo interno</span>
              <span className="text-xs text-[color:var(--text-3)]">Puede mostrar costo, diferencia y margen si tu usuario tiene permiso.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setPresentation(true); setOpen(false); }}
            className={cn('mt-1 flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.06]', presentation && 'bg-amber-500/10')}
          >
            <Presentation className="mt-0.5 text-amber-300" size={17} />
            <span>
              <span className="block text-sm font-black text-white">Modo presentacion</span>
              <span className="text-xs text-[color:var(--text-3)]">Oculta rentabilidad interna para reuniones con marcas.</span>
            </span>
          </button>
          <div className="my-2 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => { onExportPdf(); setOpen(false); }}
            disabled={exporting}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-bold text-[color:var(--text)] hover:bg-white/[0.06] disabled:opacity-40"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Exportar PDF
          </button>
        </div>
      )}
    </div>
  );
}

function DailyArea({
  report,
  mode,
  previousReport,
}: {
  report: SalesBICommercialReport;
  mode: MetricMode;
  previousReport?: SalesBICommercialReport | null;
}) {
  const showPvp = mode !== 'units';
  const showUnits = mode !== 'pvp';
  if (!hasDailyData(report, mode)) {
    return <EmptyChartState minHeight={280} description="No hay ventas registradas para el rango y filtros seleccionados." />;
  }
  // Si el comparador esta activo y hay datos del periodo anterior, alineamos
  // por indice (el rango es comparable en cantidad de dias). El frontend
  // pinta esa serie como linea punteada gris para no competir con la actual.
  const data = previousReport
    ? report.daily_series.map((row, index) => {
        const prev = previousReport.daily_series[index];
        return {
          ...row,
          anterior_total_vendido: prev?.total_vendido ?? 0,
          anterior_unidades: prev?.unidades ?? 0,
        };
      })
    : report.daily_series;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
        <defs>
          <linearGradient id="commercialDailyPvp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-blue)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="commercialDailyUnits" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-violet)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-violet)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
        <XAxis dataKey="fecha" tick={{ fill: '#B8C5DA', fontSize: 11 }} tickMargin={8} />
        <YAxis yAxisId="pvp" hide />
        <YAxis yAxisId="units" hide />
        <Tooltip
          formatter={(value, name) => {
            const isUnits = name === 'unidades' || name === 'Unid. anterior';
            const label = name === 'unidades' ? 'Unidades' : name === 'PVP' ? 'PVP vendido' : String(name);
            const formatted = isUnits ? `${num(Number(value))} u` : money(Number(value));
            return [formatted, label];
          }}
          labelFormatter={(label) => String(label).toUpperCase()}
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
        />
        {previousReport && showPvp && (
          <Line
            yAxisId="pvp"
            type="monotone"
            dataKey="anterior_total_vendido"
            name="PVP anterior"
            stroke="var(--chart-ghost)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive
            animationDuration={CHART_ANIM.duration}
            animationEasing={CHART_ANIM.easing}
          />
        )}
        {previousReport && showUnits && (
          <Line
            yAxisId="units"
            type="monotone"
            dataKey="anterior_unidades"
            name="Unid. anterior"
            stroke="var(--chart-ghost)"
            strokeWidth={2}
            strokeDasharray="3 4"
            dot={false}
            isAnimationActive
            animationDuration={CHART_ANIM.duration}
            animationEasing={CHART_ANIM.easing}
          />
        )}
        {showPvp && (
          <Area
            yAxisId="pvp"
            type="monotone"
            dataKey="total_vendido"
            name="PVP"
            stroke="var(--chart-blue)"
            strokeWidth={2.5}
            fill="url(#commercialDailyPvp)"
            isAnimationActive
            animationDuration={CHART_ANIM.duration}
            animationEasing={CHART_ANIM.easing}
          />
        )}
        {showUnits && (
          <Line
            yAxisId="units"
            type="monotone"
            dataKey="unidades"
            name="unidades"
            stroke="var(--chart-violet)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive
            animationDuration={CHART_ANIM.duration}
            animationEasing={CHART_ANIM.easing}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RankingBars({
  data,
  color,
  mode,
  onSelect,
}: {
  data: SalesBICommercialMix[];
  color: string;
  mode: MetricMode;
  onSelect?: (name: string) => void;
}) {
  const rows = data.slice(0, 10).map((row) => ({ ...row, metric_value: metricValue(row, mode) }));
  if (!hasMetricRows(rows, mode)) {
    return <EmptyChartState minHeight={300} description="No hay valores suficientes para armar el ranking con estos filtros." />;
  }
  const format = metricFormatter(mode);
  const handleSelect = (data: unknown) => {
    const payload = data as { name?: string; payload?: SalesBICommercialMix };
    const name = payload.payload?.name || payload.name;
    if (name) onSelect?.(name);
  };
  // Label de la metrica que se muestra en el tooltip (Unidades / PVP vendido /
  // PVP + unidades). Sin esto Recharts caia al dataKey crudo "metric_value".
  const tooltipMetricLabel = metricLabel(mode);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 18, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
        <Tooltip
          formatter={(value) => [format(Number(value)), tooltipMetricLabel]}
          labelFormatter={(label) => String(label).toUpperCase()}
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: 'rgba(96,165,250,0.10)' }}
        />
        <Bar
          dataKey="metric_value"
          name={tooltipMetricLabel}
          radius={[0, 8, 8, 0]}
          cursor={onSelect ? 'pointer' : 'default'}
          onClick={handleSelect}
          isAnimationActive
          animationDuration={CHART_ANIM.duration}
          animationEasing={CHART_ANIM.easing}
        >
          {rows.map((_, idx) => <Cell key={idx} fill={idx === 0 ? color : colorFor(idx)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ShareBars({
  rows,
  mode,
  onSelect,
  limit = 8,
}: {
  rows: SalesBICommercialMix[];
  mode: MetricMode;
  onSelect?: (name: string) => void;
  limit?: number;
}) {
  const data = rows.slice(0, limit);
  const max = Math.max(1, ...data.map((row) => metricValue(row, mode)));
  const total = Math.max(1, data.reduce((acc, row) => acc + metricValue(row, mode), 0));
  if (!hasMetricRows(data, mode)) {
    return <EmptyChartState minHeight={280} description="No hay participacion disponible para este mix." />;
  }
  return (
    <div className="space-y-3">
      {data.map((row, index) => {
        const value = metricValue(row, mode);
        const share = (value / total) * 100;
        const width = Math.max(5, (value / max) * 100);
        return (
          <button
            key={row.name}
            type="button"
            onClick={() => onSelect?.(row.name)}
            className="grid w-full gap-2 rounded-xl bg-white/[0.035] px-3 py-3 text-left transition hover:bg-white/[0.07] sm:grid-cols-[160px_1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(index) }} />
                <span className="truncate text-sm font-black text-white">{row.name}</span>
              </div>
              <div className="mt-1 text-[11px] text-[color:var(--text-3)]">{share.toFixed(1)}% del mix visible</div>
            </div>
            <div className="min-w-0">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${width}%`, background: colorFor(index) }}
                />
              </div>
            </div>
            <div className="text-right text-sm font-black text-[color:var(--text)]">{metricDisplay(row, mode)}</div>
          </button>
        );
      })}
    </div>
  );
}

function MixList({
  title,
  rows,
  mode,
  onSelect,
}: {
  title: string;
  rows: SalesBICommercialMix[];
  mode: MetricMode;
  onSelect?: (name: string) => void;
}) {
  const max = Math.max(1, ...rows.map((row) => metricValue(row, mode)));
  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-4">
      <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 8).map((row, index) => {
          const value = metricValue(row, mode);
          return (
            <button
              type="button"
              key={row.name}
              onClick={() => onSelect?.(row.name)}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-left transition hover:bg-white/[0.06]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-[color:var(--text)]">{row.name}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: colorFor(index) }} />
                </div>
                <div className="mt-1 text-xs text-[color:var(--text-3)]">{shareSubtitle(row)}</div>
              </div>
              <div className="text-right text-sm font-black text-[color:var(--text)]">{metricDisplay(row, mode)}</div>
            </button>
          );
        })}
        {rows.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-[color:var(--text-3)]">Sin datos.</div>}
      </div>
    </section>
  );
}

function SummaryKpis({ report, previousReport }: { report: SalesBICommercialReport; previousReport?: SalesBICommercialReport | null }) {
  const showMargin = report.sensitive.include_margin && typeof report.totals.margen_porcentaje === 'number';
  const previous = previousReport?.totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <KpiCard label="Vendido" value={report.totals.total_vendido} prev={previous?.total_vendido} format={money} accent="blue" />
      <KpiCard label="Unidades" value={report.totals.unidades} prev={previous?.unidades} format={num} accent="teal" />
      <KpiCard label="Lineas" value={report.totals.lineas} prev={previous?.lineas} format={num} accent="violet" />
      <KpiCard label="SKUs" value={report.totals.productos} prev={previous?.productos} format={num} accent="amber" />
      <KpiCard label="PVP prom. unidad" value={report.totals.pvp_promedio} prev={previous?.pvp_promedio} format={money} accent="positive" />
      {showMargin ? (
        <KpiCard label="Margen %" value={report.totals.margen_porcentaje || 0} prev={previous?.margen_porcentaje} format={(value) => `${value.toFixed(1)}%`} accent="negative" />
      ) : (
        <KpiCard label="Sin vincular" value={report.unmatched_count} format={num} accent="negative" />
      )}
    </div>
  );
}

function BrandDetail({
  report,
  selectedBrand,
  setSelectedBrand,
  mode,
}: {
  report: SalesBICommercialReport;
  selectedBrand: string;
  setSelectedBrand: (brand: string) => void;
  mode: MetricMode;
}) {
  const brand = rowByName(report.brand_mix, selectedBrand);
  const brandLines = matrixByName(report.brand_line_matrix, brand?.name || '');
  const brandBranches = matrixByName(report.brand_branch_matrix, brand?.name || '');
  const brandTrend = matrixSeriesRows(report.date_brand_matrix, brand ? [brand.name] : [], mode);
  const brandProducts = report.top_products.filter((product) => product.marca === brand?.name).slice(0, 10);
  if (!brand) return null;
  const brandTrendHasData = hasSeriesData(brandTrend, [brand.name]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[color:var(--chart-blue)] text-xl font-black text-white shadow-inner">
              {brand.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Marca</div>
              <h2 className="text-3xl font-black text-[color:var(--text)]">{brand.name}</h2>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Pill>{num(brand.productos)} SKUs</Pill>
                <Pill tone="blue">{brand.participacion_pct.toFixed(1)}% participacion</Pill>
                <Pill tone="amber">{num(brand.unidades)} unidades</Pill>
              </div>
            </div>
          </div>
          <Field label="Cambiar marca">
            <select value={brand.name} onChange={(event) => setSelectedBrand(event.target.value)} className={inputClass}>
              {report.brand_mix.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <ParticipationBlock label="Participacion total" value={brand.participacion_pct} color="var(--chart-blue)" subtitle={`de ${money(report.totals.total_vendido)}`} />
          <ParticipationBlock label="Unidades sobre total" value={(brand.unidades / Math.max(1, report.totals.unidades)) * 100} color="var(--chart-violet)" subtitle={`${num(brand.unidades)} unidades`} />
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Ranking</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-black text-[color:var(--chart-positive)]">#{report.brand_mix.findIndex((row) => row.name === brand.name) + 1}</span>
              <span className="text-xs text-[color:var(--text-3)]">de {report.brand_mix.length} marcas</span>
            </div>
            <div className="mt-1 text-xs text-[color:var(--text-3)]">en el periodo seleccionado</div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Mix por sucursal" subtitle={`Donde se vende ${brand.name}`}>
          <RankingBars data={brandBranches?.items || []} color="var(--chart-blue)" mode={mode} />
        </ChartCard>
        <ChartCard title="Mix por linea comercial" subtitle="Categorias donde aporta">
          <RankingBars data={brandLines?.items || []} color="var(--chart-amber)" mode={mode} />
        </ChartCard>
      </div>

      <ChartCard title={`Evolucion de ${brand.name}`} subtitle="Tendencia diaria dentro del periodo">
        {brandTrendHasData ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={brandTrend} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="brandTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-blue)" stopOpacity={0.38} />
                  <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
              <XAxis dataKey="name" tick={{ fill: '#B8C5DA', fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                formatter={(value, name) => [metricFormatter(mode)(Number(value)), name]}
                labelFormatter={(label) => String(label).toUpperCase()}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Area type="monotone" dataKey={brand.name} stroke="var(--chart-blue)" strokeWidth={2.5} fill="url(#brandTrendFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChartState minHeight={300} description="No hay evolucion diaria para esta marca en el rango seleccionado." />
        )}
      </ChartCard>

      <TopProductsTable
        rows={brandProducts}
        title={`Top productos - ${brand.name}`}
        subtitle="Productos que empujan la marca"
        showCosts={report.sensitive.include_costs && !report.presentation}
        showMargin={report.sensitive.include_margin && !report.presentation}
      />
    </div>
  );
}

function LinesDetail({
  report,
  selectedLine,
  setSelectedLine,
  mode,
  previousReport,
}: {
  report: SalesBICommercialReport;
  selectedLine: string;
  setSelectedLine: (line: string) => void;
  mode: MetricMode;
  previousReport?: SalesBICommercialReport | null;
}) {
  const line = rowByName(report.line_mix, selectedLine);
  // El backend (`/lines/report`) NO siempre devuelve las matrices cruzadas
  // — en producción están faltando por completo. Sin el `|| []` defensivo
  // un .map sobre undefined explota y como la app no tiene ErrorBoundary,
  // se cae toda la pantalla.
  const branchRows = (report.branch_line_matrix || [])
    .map((row) => {
      const item = matrixItem(row, line?.name || '');
      return item ? { ...item, name: row.name } : null;
    })
    .filter((row): row is SalesBICommercialMix => Boolean(row));
  const leaders = report.brands_by_line?.find((row) => row.line === line?.name)?.leaders || [];
  const lineNames = (report.line_mix || []).slice(0, 6).map((row) => row.name);
  const lineTrend = matrixSeriesRows(report.date_line_matrix, lineNames, mode);
  const branchComposition = (report.branch_line_matrix || []).map((row) => {
    const out: Record<string, string | number> = { name: row.name };
    lineNames.forEach((lineName) => {
      const item = matrixItem(row, lineName);
      out[lineName] = item ? metricValue(item, mode) : 0;
    });
    return out;
  });
  const lineTrendHasData = hasSeriesData(lineTrend, lineNames);
  const branchCompositionHasData = hasSeriesData(branchComposition, lineNames);
  if (!line) return null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-5">
        <div className="mb-5 flex flex-wrap gap-2">
          {report.line_mix.map((row, index) => (
            <button
              key={row.name}
              type="button"
              onClick={() => setSelectedLine(row.name)}
              className={cn(
                'rounded-xl px-3 py-2 text-xs font-black transition',
                row.name === line.name ? 'text-white shadow-lg' : 'bg-white/[0.04] text-[color:var(--text-2)] hover:bg-white/[0.08] hover:text-white',
              )}
              style={row.name === line.name ? { background: colorFor(index) } : undefined}
            >
              {row.name}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <KpiCard label="Vendido" value={line.total_vendido} format={money} accent="blue" />
          <KpiCard label="Unidades" value={line.unidades} format={num} accent="teal" />
          <KpiCard label="Lineas" value={line.lineas} format={num} accent="violet" />
          <KpiCard label="SKUs" value={line.productos} format={num} accent="amber" />
          <KpiCard label="PVP prom. unidad" value={line.pvp_promedio} format={money} accent="positive" />
          <KpiCard label="Participacion" value={line.participacion_pct} format={(value) => `${value.toFixed(1)}%`} accent="violet" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Mix por linea" subtitle={`Participacion sobre el total · ${metricLabel(mode)}`}>
          <ShareBars rows={report.line_mix} mode={mode} onSelect={setSelectedLine} />
        </ChartCard>
        <ChartCard title="Ranking de lineas" subtitle="Busqueda visual por peso comercial" className="lg:col-span-2">
          <RankingBars data={report.line_mix} color="var(--chart-violet)" mode={mode} onSelect={setSelectedLine} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`Sucursales fuertes en ${line.name}`} subtitle="Distribucion de la linea por sucursal">
          <RankingBars data={branchRows} color="var(--chart-teal)" mode={mode} />
        </ChartCard>
        <ChartCard title={`Marcas lideres en ${line.name}`} subtitle="Top marcas dentro de la linea">
          <RankingBars data={leaders} color="var(--chart-amber)" mode={mode} />
        </ChartCard>
      </div>

      <Heatmap report={report} mode={mode} setSelectedLine={setSelectedLine} previousReport={previousReport} />

      <ChartCard title="Evolucion por linea" subtitle="Tendencia diaria de las lineas principales">
        {lineTrendHasData ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={lineTrend} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
              <XAxis dataKey="name" tick={{ fill: '#B8C5DA', fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                formatter={(value, name) => [metricFormatter(mode)(Number(value)), name]}
                labelFormatter={(label) => String(label).toUpperCase()}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {lineNames.map((name, index) => (
                <Line key={name} type="monotone" dataKey={name} stroke={colorFor(index)} strokeWidth={2.2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChartState minHeight={320} description="No hay evolucion diaria suficiente para las lineas seleccionadas." />
        )}
      </ChartCard>

      <ChartCard title="Composicion por sucursal" subtitle="Stacked: como se forma el total de cada sucursal">
        {branchCompositionHasData ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={branchComposition} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
              <XAxis dataKey="name" tick={{ fill: '#B8C5DA', fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                formatter={(value, name) => [metricFormatter(mode)(Number(value)), name]}
                labelFormatter={(label) => String(label).toUpperCase()}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {lineNames.map((name, index) => (
                <Bar key={name} dataKey={name} stackId="lineas" fill={colorFor(index)} radius={index === lineNames.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChartState minHeight={320} description="No hay composicion por sucursal para mostrar con estos filtros." />
        )}
      </ChartCard>
    </div>
  );
}

function BranchDetail({
  report,
  selectedBranch,
  setSelectedBranch,
  mode,
}: {
  report: SalesBICommercialReport;
  selectedBranch: string;
  setSelectedBranch: (branch: string) => void;
  mode: MetricMode;
}) {
  const branch = rowByName(report.branch_mix, selectedBranch);
  const lineMatrix = matrixByName(report.branch_line_matrix, branch?.name || '');
  const brandMatrix = matrixByName(report.branch_brand_matrix, branch?.name || '');
  const profile = report.profiles?.find((row) => row.sucursal === branch?.name);
  const branchTrend = matrixSeriesRows(report.date_branch_matrix, branch ? [branch.name] : [], mode);
  const branchProducts = productPresenceRows(report)
    .filter((product) => product.branches.includes(branch?.name || ''))
    .sort((a, b) => b.total_vendido - a.total_vendido)
    .slice(0, 10);
  const benchmarkData = report.line_mix.map((line) => {
    const item = matrixItem(lineMatrix, line.name);
    return {
      name: line.name,
      sucursal: item?.participacion_pct || 0,
      red: line.participacion_pct || 0,
    };
  });
  if (!branch) return null;
  const branchTrendHasData = hasSeriesData(branchTrend, [branch.name]);
  const benchmarkHasData = benchmarkData.some((row) => row.sucursal > 0 || row.red > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {report.branch_mix.map((row) => (
          <button
            key={row.name}
            type="button"
            onClick={() => setSelectedBranch(row.name)}
            className={cn(
              'rounded-2xl px-4 py-3 text-left transition sm:min-w-[130px]',
              row.name === branch.name
                ? 'bg-[color:var(--chart-blue)] text-white shadow-lg shadow-blue-500/20'
                : 'bg-[color:var(--surface)] text-[color:var(--text-2)] hover:bg-white/[0.06] hover:text-white',
            )}
          >
            <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">Sucursal</div>
            <div className="text-lg font-black">{row.name}</div>
            <div className="text-xs opacity-80">{mode === 'units' ? `${num(row.unidades)} u` : money(row.total_vendido)}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Vendido" value={branch.total_vendido} format={money} accent="blue" />
        <KpiCard label="Unidades" value={branch.unidades} format={num} accent="teal" />
        <KpiCard label="Lineas" value={branch.lineas} format={num} accent="violet" />
        <KpiCard label="SKUs" value={branch.productos} format={num} accent="amber" />
        <KpiCard label="PVP prom. unidad" value={branch.pvp_promedio} format={money} accent="positive" />
        <KpiCard label="Participacion red" value={branch.participacion_pct} format={(value) => `${value.toFixed(1)}%`} accent="violet" />
      </div>

      {profile && (
        <ChartCard title={`Perfil comercial · ${branch.name}`} subtitle="Deteccion automatica a partir de Ventas Vs. Costos">
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Caracteristicas</div>
              <ul className="mt-2 space-y-1.5">
                {profile.profile_notes.map((note) => (
                  <li key={note} className="flex gap-2 text-sm text-[color:var(--text-2)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--chart-blue)]" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--chart-positive)]">Fortalezas</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.fortalezas.map((item) => <Pill key={item} tone="positive">{item}</Pill>)}
                {profile.fortalezas.length === 0 && <span className="text-sm text-[color:var(--text-3)]">Sin destaque fuerte.</span>}
              </div>
              <div className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--chart-negative)]">Debilidades</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.debilidades.map((item) => <Pill key={item} tone="negative">{item}</Pill>)}
                {profile.debilidades.length === 0 && <span className="text-sm text-[color:var(--text-3)]">Sin alerta principal.</span>}
              </div>
            </div>
            <div className="space-y-2">
              <ProfileTag label="Perfil PVP" value={profile.pvp_profile} />
              <ProfileTag label="Variedad de surtido" value={profile.variety} />
              <ProfileTag label="Linea principal" value={profile.top_line || '-'} />
              <ProfileTag label="Marca principal" value={profile.top_brand || '-'} />
            </div>
          </div>
        </ChartCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Mix por linea comercial" subtitle={`Composicion de ${branch.name}`}>
          <RankingBars data={lineMatrix?.items || []} color="var(--chart-blue)" mode={mode} />
        </ChartCard>
        <ChartCard title="Mix por marca" subtitle={`Top marcas en ${branch.name}`}>
          <RankingBars data={brandMatrix?.items || []} color="var(--chart-violet)" mode={mode} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`${branch.name} vs promedio de red`} subtitle="Share por linea: sucursal contra consolidado">
          {benchmarkHasData ? (
            <BranchLineBenchmark branchName={branch.name} rows={benchmarkData} />
          ) : (
            <EmptyChartState minHeight={300} description="No hay mix por linea suficiente para comparar esta sucursal con la red." />
          )}
        </ChartCard>
        <ChartCard title="Comparacion con otras sucursales" subtitle={metricLabel(mode)}>
          <RankingBars data={report.branch_mix} color="var(--chart-teal)" mode={mode} onSelect={setSelectedBranch} />
        </ChartCard>
      </div>

      <ChartCard title={`Evolucion de ${branch.name}`} subtitle="Tendencia diaria de la sucursal">
        {branchTrendHasData ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={branchTrend} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="branchTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-teal)" stopOpacity={0.36} />
                  <stop offset="100%" stopColor="var(--chart-teal)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
              <XAxis dataKey="name" tick={{ fill: '#B8C5DA', fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                formatter={(value, name) => [metricFormatter(mode)(Number(value)), name]}
                labelFormatter={(label) => String(label).toUpperCase()}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Area type="monotone" dataKey={branch.name} stroke="var(--chart-teal)" strokeWidth={2.5} fill="url(#branchTrendFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChartState minHeight={300} description="No hay evolucion diaria para esta sucursal en el rango seleccionado." />
        )}
      </ChartCard>

      <TopProductsTable
        rows={branchProducts}
        title={`Productos movidos - ${branch.name}`}
        subtitle="Productos destacados por sucursal"
        showCosts={report.sensitive.include_costs && !report.presentation}
        showMargin={report.sensitive.include_margin && !report.presentation}
      />

      {!report.presentation && (report.opportunities?.length || 0) > 0 && (
        <Opportunities report={report} />
      )}
    </div>
  );
}

function Heatmap({
  report,
  mode,
  setSelectedLine,
  previousReport,
}: {
  report: SalesBICommercialReport;
  mode: MetricMode;
  setSelectedLine?: (line: string) => void;
  /** Si esta presente, cada celda muestra delta % vs misma celda del rango
   *  comparado debajo del $ amount (mockup del gerente). */
  previousReport?: SalesBICommercialReport | null;
}) {
  const lines = (report.line_mix || []).slice(0, 10);
  const matrixRows = report.branch_line_matrix || [];
  const previousMatrix = previousReport?.branch_line_matrix || [];
  const max = Math.max(
    1,
    ...matrixRows.flatMap((row) => row.items.map((item) => metricValue(item, mode))),
  );
  const format = metricFormatter(mode);
  if (!matrixRows.length || !hasMetricRows(matrixRows.map((row) => row.total), mode)) {
    return (
      <ChartCard title="Heatmap sucursal x linea" subtitle={`${metricLabel(mode)} · color por intensidad`}>
        <EmptyChartState description="No hay cruces de sucursal y linea para los filtros seleccionados." />
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title="Heatmap sucursal x linea"
      subtitle={previousReport
        ? `${metricLabel(mode)} · color por intensidad · % chico = variacion vs periodo anterior · clic para filtrar`
        : `${metricLabel(mode)} · color por intensidad · clic para enfocar linea`}
    >
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">
              <th className="px-2 py-2 text-left">Sucursal</th>
              {lines.map((line, index) => (
                <th key={line.name} className="px-2 py-2 text-right" style={{ color: colorFor(index) }}>{line.name}</th>
              ))}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrixRows.map((row) => {
              const prevRow = matrixByName(previousMatrix, row.name);
              return (
                <tr key={row.name} className="border-t border-white/5">
                  <td className="px-2 py-2 font-black text-white">{row.name}</td>
                  {lines.map((line, index) => {
                    const item = matrixItem(row, line.name);
                    const value = item ? metricValue(item, mode) : 0;
                    const intensity = value / max;
                    // Variacion vs misma celda del periodo comparado, si lo hay.
                    const prevItem = prevRow ? matrixItem(prevRow, line.name) : null;
                    const prevValue = prevItem ? metricValue(prevItem, mode) : 0;
                    const delta = previousReport && prevValue > 0
                      ? ((value - prevValue) / prevValue) * 100
                      : null;
                    return (
                      <td key={line.name} className="px-2 py-2 text-right font-mono tabular-nums">
                        <button
                          type="button"
                          onClick={() => setSelectedLine?.(line.name)}
                          className="block w-full rounded-lg px-2 py-1 text-right transition hover:ring-2 hover:ring-blue-400"
                          style={{
                            background: `color-mix(in oklch, ${colorFor(index)} ${Math.round(16 + intensity * 62)}%, transparent)`,
                            color: intensity > 0.55 ? '#fff' : '#cbd5e1',
                          }}
                        >
                          <div>{format(value)}</div>
                          {delta !== null ? (
                            <div className={cn(
                              'text-[10px] font-black',
                              delta >= 0 ? 'text-emerald-200' : 'text-rose-200',
                            )}>
                              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                            </div>
                          ) : (
                            <div className="text-[10px] opacity-80">{item ? `${item.participacion_pct.toFixed(1)}%` : '-'}</div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right font-mono font-black text-[color:var(--chart-positive)]">{format(metricValue(row.total, mode))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function BranchLineBenchmark({
  branchName,
  rows,
}: {
  branchName: string;
  rows: Array<{ name: string; sucursal: number; red: number }>;
}) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.sucursal - b.red) - Math.abs(a.sucursal - a.red));
  return (
    <div className="space-y-3">
      {sorted.map((row, index) => {
        const gap = row.sucursal - row.red;
        const tone = gap >= 0 ? 'text-emerald-200 bg-emerald-500/15' : 'text-rose-200 bg-rose-500/15';
        return (
          <div key={row.name} className="rounded-xl bg-white/[0.035] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(index) }} />
                  <span className="truncate text-sm font-black text-white">{row.name}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--text-3)]">{branchName} vs promedio de red</div>
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums', tone)}>
                {gap >= 0 ? '+' : ''}{gap.toFixed(1)} pp
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              <div>
                <div className="mb-1 flex justify-between text-[11px] font-bold text-[color:var(--text-3)]">
                  <span>{branchName}</span>
                  <span>{row.sucursal.toFixed(1)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[color:var(--chart-blue)]" style={{ width: `${safePct(row.sucursal)}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] font-bold text-[color:var(--text-3)]">
                  <span>Red</span>
                  <span>{row.red.toFixed(1)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[color:var(--chart-ghost)]" style={{ width: `${safePct(row.red)}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopProductsTable({
  rows,
  title = 'Top productos',
  subtitle = 'Productos con mayor PVP vendido',
  showCosts = false,
  showMargin = false,
}: {
  rows: SalesBICommercialProduct[];
  title?: string;
  subtitle?: string;
  showCosts?: boolean;
  showMargin?: boolean;
}) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <EmptyChartState description="No hay productos para mostrar en este periodo." />
      ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">
            <tr>
              <th className="px-3 py-3 text-left">SKU</th>
              <th className="px-3 py-3 text-left">Producto</th>
              <th className="px-3 py-3 text-left">Marca</th>
              <th className="px-3 py-3 text-left">Linea</th>
              <th className="px-3 py-3 text-right">Unid.</th>
              <th className="px-3 py-3 text-right">Vendido</th>
              {showCosts && <th className="px-3 py-3 text-right">Costo</th>}
              {showMargin && <th className="px-3 py-3 text-right">Margen</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 16).map((product) => (
              <tr key={`${product.sku}-${product.producto}`} className="border-t border-white/5">
                <td className="px-3 py-3 font-mono text-xs text-[color:var(--text-2)]">{product.sku || '-'}</td>
                <td className="max-w-[460px] px-3 py-3 font-black text-[color:var(--text)]">{product.producto}</td>
                <td className="px-3 py-3 text-[color:var(--text-2)]">{product.marca}</td>
                <td className="px-3 py-3 text-[color:var(--text-2)]">{product.tipo_producto}</td>
                <td className="px-3 py-3 text-right text-[color:var(--text-2)]">{num(product.unidades)}</td>
                <td className="px-3 py-3 text-right font-black text-[color:var(--text)]">{money(product.total_vendido)}</td>
                {showCosts && <td className="px-3 py-3 text-right font-mono text-amber-200">{money(product.costo_total || 0)}</td>}
                {showMargin && (
                  <td className="px-3 py-3 text-right">
                    <span className="rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-black text-amber-100">
                      {(product.margen_porcentaje || 0).toFixed(1)}%
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </ChartCard>
  );
}

function Opportunities({ report }: { report: SalesBICommercialReport }) {
  return (
    <ChartCard title="Oportunidades internas" subtitle="Lineas que pesan menos en una sucursal contra el consolidado">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {report.opportunities!.slice(0, 9).map((item) => (
          <div key={`${item.sucursal}-${item.tipo_producto}`} className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
            <div className="text-sm font-black text-amber-100">{item.sucursal}</div>
            <div className="mt-1 text-lg font-black text-[color:var(--text)]">{item.tipo_producto}</div>
            <div className="mt-2 text-xs text-amber-100/80">
              Sucursal {item.participacion_sucursal.toFixed(1)}% vs empresa {item.participacion_empresa.toFixed(1)}%.
            </div>
            <div className="mt-3 rounded-xl bg-black/15 px-3 py-2 text-xs text-[color:var(--text-2)]">{item.reason}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

function CompareCandidates({ report }: { report: SalesBICommercialReport }) {
  if ((report.compare_candidates?.length || 0) === 0) return null;
  return (
    <ChartCard title="Comparaciones sugeridas" subtitle="Marcas cercanas por volumen para reuniones comerciales" action={<GitCompare size={16} className="text-[color:var(--text-3)]" />}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {report.compare_candidates!.slice(0, 6).map((candidate) => (
          <div key={`${candidate.brand}-${candidate.suggested_compare}`} className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
            <span className="font-black text-[color:var(--text)]">{candidate.brand}</span>
            <span className="text-[color:var(--text-3)]"> vs </span>
            <span className="font-black text-[color:var(--chart-blue)]">{candidate.suggested_compare}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

function SearchableProducts({ rows }: { rows: SalesBICommercialProduct[] }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => (
      row.sku.toLowerCase().includes(needle)
      || row.producto.toLowerCase().includes(needle)
      || row.marca.toLowerCase().includes(needle)
      || row.tipo_producto.toLowerCase().includes(needle)
    ));
  }, [q, rows]);
  return (
    <section className="space-y-3">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[color:var(--text-3)]" />
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar SKU, producto, marca o linea..."
          className="h-11 w-full rounded-xl border border-white/15 bg-slate-950/40 pl-9 pr-3 text-sm font-medium text-white outline-none transition focus:border-[color:var(--chart-blue)]"
        />
      </div>
      <TopProductsTable rows={filtered} />
    </section>
  );
}

function ParticipationBlock({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: number;
  color: string;
  subtitle?: string;
}) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-black tabular-nums" style={{ color }}>{safe.toFixed(1)}%</span>
        {subtitle && <span className="text-xs text-[color:var(--text-3)]">{subtitle}</span>}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${safe}%`, background: color }} />
      </div>
    </div>
  );
}

function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'blue' | 'amber' | 'positive' | 'negative' }) {
  const toneClass = {
    default: 'bg-white/5 text-[color:var(--text-2)] ring-white/10',
    blue: 'bg-blue-500/15 text-blue-200 ring-blue-500/30',
    amber: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
    positive: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
    negative: 'bg-rose-500/15 text-rose-200 ring-rose-500/30',
  }[tone];
  return <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset', toneClass)}>{children}</span>;
}

function ProfileTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-3)]">{label}</span>
      <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-black text-blue-200 ring-1 ring-inset ring-blue-500/30">{value}</span>
    </div>
  );
}

function OverviewDashboard({
  brandsReport,
  branchesReport,
  previousReport,
  mode,
  setActiveTab,
  setSelectedBrand,
  setSelectedBranch,
  setSelectedLine,
}: {
  brandsReport: SalesBICommercialReport;
  branchesReport?: SalesBICommercialReport;
  previousReport?: SalesBICommercialReport | null;
  mode: MetricMode;
  setActiveTab: (tab: CommercialTab) => void;
  setSelectedBrand: (brand: string) => void;
  setSelectedBranch: (branch: string) => void;
  setSelectedLine: (line: string) => void;
}) {
  const branchReport = branchesReport || brandsReport;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs font-semibold text-blue-200">
        <MousePointerClick size={15} />
        Hace clic en barras, celdas o filas para abrir el perfil de marca, linea o sucursal.
      </div>

      <SummaryKpis report={brandsReport} previousReport={previousReport} />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <ChartCard title="Evolucion diaria" subtitle={`${brandsReport.filters.fecha_desde} al ${brandsReport.filters.fecha_hasta} · ${metricLabel(mode)}`}>
          <DailyArea report={brandsReport} mode={mode} previousReport={previousReport} />
        </ChartCard>
        <ChartCard title="Ranking de marcas" subtitle="Click para abrir perfil">
          <RankingBars
            data={brandsReport.brand_mix}
            color="var(--chart-blue)"
            mode={mode}
            onSelect={(name) => {
              setSelectedBrand(name);
              setActiveTab('brands');
            }}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MixList
          title="Mix por marca"
          rows={brandsReport.brand_mix}
          mode={mode}
          onSelect={(name) => {
            setSelectedBrand(name);
            setActiveTab('brands');
          }}
        />
        <MixList
          title="Mix por linea"
          rows={brandsReport.line_mix}
          mode={mode}
          onSelect={(name) => {
            setSelectedLine(name);
            setActiveTab('lines');
          }}
        />
        <MixList
          title="Mix por sucursal"
          rows={brandsReport.branch_mix}
          mode={mode}
          onSelect={(name) => {
            setSelectedBranch(name);
            setActiveTab('branches');
          }}
        />
      </div>

      <BranchRankingTable
        report={branchReport}
        mode={mode}
        onSelect={(branch) => {
          setSelectedBranch(branch);
          setActiveTab('branches');
        }}
      />

      <BrandBranchMatrix
        report={brandsReport}
        mode={mode}
        onBrand={(brand) => {
          setSelectedBrand(brand);
          setActiveTab('brands');
        }}
        onBranch={(branch) => {
          setSelectedBranch(branch);
          setActiveTab('branches');
        }}
      />

      <TopProductsTable rows={brandsReport.top_products} />
    </div>
  );
}

/** Sparkline inline SVG sin recharts — pensado para tablas con muchas filas
 *  donde montar un BarChart o LineChart por celda seria costoso. */
function MiniSparkline({
  values,
  width = 84,
  height = 22,
  color = 'var(--chart-blue)',
  fillOpacity = 0.18,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}) {
  if (!values || values.length < 2 || values.every((v) => v === 0)) {
    return <span className="text-[10px] text-[color:var(--text-3)]">—</span>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = (i * stepX).toFixed(2);
    const y = (height - 2 - ((v - min) / range) * (height - 4)).toFixed(2);
    return `${x},${y}`;
  });
  const polyline = points.join(' ');
  // Area cerrada para dar volumen visual a la tendencia
  const area = `${0},${height} ${polyline} ${width},${height}`;
  return (
    <svg width={width} height={height} className="block" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polygon points={area} fill={color} fillOpacity={fillOpacity} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function BranchRankingTable({
  report,
  mode,
  onSelect,
}: {
  report: SalesBICommercialReport;
  mode: MetricMode;
  onSelect: (branch: string) => void;
}) {
  const max = Math.max(1, ...report.branch_mix.map((row) => metricValue(row, mode)));
  const format = metricFormatter(mode);
  // Por cada sucursal, armar la serie diaria a partir de date_branch_matrix
  // (cada row es una fecha, cada item es una sucursal). Sin la matriz, la
  // columna TENDENCIA muestra un dash en lugar de crashear.
  const dailyByBranch = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const dateRow of report.date_branch_matrix || []) {
      for (const branchItem of dateRow.items) {
        const list = map.get(branchItem.name) ?? [];
        list.push(metricValue(branchItem, mode));
        map.set(branchItem.name, list);
      }
    }
    return map;
  }, [report.date_branch_matrix, mode]);
  return (
    <ChartCard title="Ranking de sucursales" subtitle="Comparativo comercial por sucursal · clic para abrir perfil">
      <div className="overflow-x-auto">
        <table className="min-w-[1000px] w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Sucursal</th>
              <th className="px-3 py-2 text-right">Unidades</th>
              <th className="px-3 py-2 text-right">PVP</th>
              <th className="px-3 py-2 text-right">Lineas</th>
              <th className="px-3 py-2 text-right">SKUs</th>
              <th className="px-3 py-2 text-right">PVP prom. unidad</th>
              <th className="px-3 py-2 text-right">Part.</th>
              <th className="px-3 py-2 text-left">Tendencia</th>
              <th className="px-3 py-2 text-left">Peso</th>
            </tr>
          </thead>
          <tbody>
            {report.branch_mix.map((branch, index) => {
              const value = metricValue(branch, mode);
              const trend = dailyByBranch.get(branch.name) ?? [];
              return (
                <tr
                  key={branch.name}
                  className="cursor-pointer border-t border-white/5 transition hover:bg-blue-500/10"
                  onClick={() => onSelect(branch.name)}
                >
                  <td className="px-3 py-3 text-[color:var(--text-3)]">#{index + 1}</td>
                  <td className="px-3 py-3 font-black text-white">{branch.name}</td>
                  <td className="px-3 py-3 text-right font-mono text-violet-200">{num(branch.unidades)}</td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-200">{money(branch.total_vendido)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{num(branch.lineas)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{num(branch.productos)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{money(branch.pvp_promedio)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{branch.participacion_pct.toFixed(1)}%</td>
                  <td className="px-3 py-3">
                    <MiniSparkline values={trend} color="var(--chart-blue)" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-[color:var(--chart-blue)]" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
                    </div>
                    <div className="mt-1 text-[10px] text-[color:var(--text-3)]">{format(value)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function BrandBranchMatrix({
  report,
  mode,
  onBrand,
  onBranch,
}: {
  report: SalesBICommercialReport;
  mode: MetricMode;
  onBrand: (brand: string) => void;
  onBranch: (branch: string) => void;
}) {
  const branches = (report.branch_mix || []).slice(0, 8);
  // brand_branch_matrix puede no venir del backend (mismo caso que
  // branch_line_matrix). Sin `|| []` la matriz crashea el overview.
  const brands = (report.brand_branch_matrix || []).slice(0, 12);
  const max = Math.max(
    1,
    ...brands.flatMap((brand) => brand.items.map((item) => metricValue(item, mode))),
  );
  const format = metricFormatter(mode);
  return (
    <ChartCard title="Matriz sucursal x marca" subtitle="Donde aporta cada marca dentro de la red">
      <div className="overflow-x-auto">
        <table className="min-w-[860px] w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">
              <th className="px-2 py-2 text-left">Marca</th>
              {branches.map((branch) => <th key={branch.name} className="px-2 py-2 text-right">{branch.name}</th>)}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand, brandIndex) => (
              <tr key={brand.name} className="border-t border-white/5">
                <td className="px-2 py-2">
                  <button type="button" onClick={() => onBrand(brand.name)} className="inline-flex items-center gap-2 font-black text-white hover:text-blue-200">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(brandIndex) }} />
                    {brand.name}
                  </button>
                </td>
                {branches.map((branch) => {
                  const item = matrixItem(brand, branch.name);
                  const value = item ? metricValue(item, mode) : 0;
                  const intensity = value / max;
                  return (
                    <td key={branch.name} className="px-2 py-2 text-right font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          onBrand(brand.name);
                          onBranch(branch.name);
                        }}
                        className="w-full rounded-lg px-2 py-1 text-right transition hover:ring-2 hover:ring-blue-400"
                        style={{
                          background: `rgba(59, 130, 246, ${0.08 + intensity * 0.45})`,
                          color: intensity > 0.55 ? '#eff6ff' : '#cbd5e1',
                        }}
                      >
                        {value ? format(value) : '-'}
                      </button>
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right font-mono font-black text-emerald-200">{format(metricValue(brand.total, mode))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function ProductsDashboard({
  report,
  mode,
  setActiveTab,
  setSelectedBrand,
  setSelectedLine,
}: {
  report: SalesBICommercialReport;
  mode: MetricMode;
  setActiveTab: (tab: CommercialTab) => void;
  setSelectedBrand: (brand: string) => void;
  setSelectedLine: (line: string) => void;
}) {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [line, setLine] = useState('');
  const [sort, setSort] = useState<'pvp' | 'units' | 'avg'>('pvp');
  const products = useMemo(() => productPresenceRows(report), [report]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((product) => !brand || product.marca === brand)
      .filter((product) => !line || product.tipo_producto === line)
      .filter((product) => (
        !needle
        || product.sku.toLowerCase().includes(needle)
        || product.producto.toLowerCase().includes(needle)
        || product.marca.toLowerCase().includes(needle)
        || product.tipo_producto.toLowerCase().includes(needle)
      ))
      .sort((a, b) => {
        if (sort === 'units') return b.unidades - a.unidades;
        if (sort === 'avg') return b.pvp_promedio - a.pvp_promedio;
        return b.total_vendido - a.total_vendido;
      });
  }, [brand, line, products, q, sort]);
  const byBrand = report.brand_mix.slice(0, 8);
  const byLine = report.line_mix.slice(0, 8);
  const commonProducts = products.filter((product) => product.is_common).slice(0, 8);
  const exclusiveProducts = products.filter((product) => product.is_exclusive).slice(0, 8);
  const showCosts = report.sensitive.include_costs && !report.presentation;
  const showMargin = report.sensitive.include_margin && !report.presentation;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[color:var(--text-3)]" />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Buscar SKU, producto, marca o linea..." className={`${inputClass} pl-9`} />
          </div>
          <select value={brand} onChange={(event) => setBrand(event.target.value)} className={inputClass}>
            <option value="">Todas las marcas</option>
            {report.brand_mix.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
          </select>
          <select value={line} onChange={(event) => setLine(event.target.value)} className={inputClass}>
            <option value="">Todas las lineas</option>
            {report.line_mix.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as 'pvp' | 'units' | 'avg')} className={inputClass}>
            <option value="pvp">Ordenar por PVP</option>
            <option value="units">Ordenar por unidades</option>
            <option value="avg">Ordenar por PVP prom. unidad</option>
          </select>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Productos por marca" subtitle="Concentracion del surtido vendido">
          <RankingBars data={byBrand} color="var(--chart-blue)" mode={mode} onSelect={(name) => { setSelectedBrand(name); setActiveTab('brands'); }} />
        </ChartCard>
        <ChartCard title="Productos por linea" subtitle="Lineas con mayor movimiento">
          <RankingBars data={byLine} color="var(--chart-violet)" mode={mode} onSelect={(name) => { setSelectedLine(name); setActiveTab('lines'); }} />
        </ChartCard>
      </div>

      <TopProductsTable
        rows={filtered}
        title="Productos vendidos"
        subtitle={`${num(filtered.length)} resultados - fuente: Ventas Vs. Costos`}
        showCosts={showCosts}
        showMargin={showMargin}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProductPresenceList
          title="Productos en todas las sucursales"
          subtitle="Surtido comun"
          rows={commonProducts}
          empty="Todavia no hay productos presentes en todas las sucursales con estos filtros."
        />
        <ProductPresenceList
          title="Productos exclusivos por sucursal"
          subtitle="Solo se movieron en una sucursal del periodo"
          rows={exclusiveProducts}
          empty="No hay productos exclusivos detectados con estos filtros."
        />
      </div>
    </div>
  );
}

function ProductPresenceList({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: SalesBICommercialProductPresence[];
  empty: string;
}) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <div className="space-y-2">
        {rows.map((product) => (
          <div key={`${product.sku}-${product.producto}-${product.exclusive_branch}`} className="grid gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-sm sm:grid-cols-[110px_1fr_auto] sm:items-center">
            <div className="font-mono text-xs font-black text-blue-200">{product.sku || '-'}</div>
            <div className="min-w-0">
              <div className="truncate font-black text-white">{product.producto}</div>
              <div className="text-xs text-[color:var(--text-3)]">{product.marca} - {product.tipo_producto}</div>
            </div>
            <div className="flex flex-wrap gap-1 justify-start sm:justify-end">
              {(product.is_exclusive ? [product.exclusive_branch] : product.branches).map((branch) => (
                <Pill key={branch} tone={product.is_exclusive ? 'amber' : 'positive'}>{branch}</Pill>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-[color:var(--text-3)]">{empty}</div>
        )}
      </div>
    </ChartCard>
  );
}

function CompareDashboard({
  report,
  mode,
  selectedBrand,
  setSelectedBrand,
}: {
  report: SalesBICommercialReport;
  mode: MetricMode;
  selectedBrand: string;
  setSelectedBrand: (brand: string) => void;
}) {
  const [otherBrand, setOtherBrand] = useState('');
  const [thirdBrand, setThirdBrand] = useState('');
  const brandA = rowByName(report.brand_mix, selectedBrand);
  const fallbackOther = report.brand_mix.find((row) => row.name !== brandA?.name)?.name || '';
  const fallbackThird = report.brand_mix.find((row) => row.name !== brandA?.name && row.name !== (otherBrand || fallbackOther))?.name || '';
  const brandB = rowByName(report.brand_mix, otherBrand || fallbackOther);
  const brandC = rowByName(report.brand_mix, thirdBrand || fallbackThird);
  useEffect(() => {
    if (!otherBrand && fallbackOther) setOtherBrand(fallbackOther);
    if (otherBrand === brandA?.name && fallbackOther) setOtherBrand(fallbackOther);
  }, [brandA?.name, fallbackOther, otherBrand]);
  useEffect(() => {
    if (!thirdBrand && fallbackThird) setThirdBrand(fallbackThird);
    if ((thirdBrand === brandA?.name || thirdBrand === brandB?.name) && fallbackThird) setThirdBrand(fallbackThird);
  }, [brandA?.name, brandB?.name, fallbackThird, thirdBrand]);
  if (!brandA || !brandB || !brandC) return null;

  const selected = [
    { key: 'A', side: 'A' as const, color: 'var(--chart-blue)', brand: brandA },
    { key: 'B', side: 'B' as const, color: 'var(--chart-violet)', brand: brandB },
    { key: 'C', side: 'C' as const, color: 'var(--chart-teal)', brand: brandC },
  ];
  const rows: Array<{ label: string; values: number[]; format: (value: number) => string; sensitive?: boolean }> = [
    { label: 'Vendido', values: selected.map((item) => item.brand.total_vendido), format: money },
    { label: 'Unidades', values: selected.map((item) => item.brand.unidades), format: num },
    { label: 'Lineas', values: selected.map((item) => item.brand.lineas), format: num },
    { label: 'SKUs', values: selected.map((item) => item.brand.productos), format: num },
    { label: 'PVP prom. unidad', values: selected.map((item) => item.brand.pvp_promedio), format: money },
    { label: 'Participacion', values: selected.map((item) => item.brand.participacion_pct), format: (value) => `${value.toFixed(1)}%` },
  ];
  if (report.sensitive.include_margin) {
    rows.push({
      label: 'Margen',
      values: selected.map((item) => item.brand.margen_porcentaje || 0),
      format: (value) => `${value.toFixed(1)}%`,
      sensitive: true,
    });
  }
  const winCounts = selected.map(() => 0);
  rows.forEach((row) => {
    const winnerIndex = row.values.indexOf(Math.max(...row.values));
    winCounts[winnerIndex] += 1;
  });
  const globalWinnerIndex = winCounts.indexOf(Math.max(...winCounts));
  const globalWinner = selected[globalWinnerIndex];
  const capabilityRows = rows.filter((row) => !row.sensitive);
  const branchCompare = report.branch_mix.map((branch) => ({
    name: branch.name,
    A: metricValue(matrixItem(matrixByName(report.brand_branch_matrix, brandA.name), branch.name) || { total_vendido: 0, unidades: 0 }, mode),
    B: metricValue(matrixItem(matrixByName(report.brand_branch_matrix, brandB.name), branch.name) || { total_vendido: 0, unidades: 0 }, mode),
    C: metricValue(matrixItem(matrixByName(report.brand_branch_matrix, brandC.name), branch.name) || { total_vendido: 0, unidades: 0 }, mode),
  }));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr] xl:items-stretch">
        <CompareBrandCard side="A" color="var(--chart-blue)" brand={brandA} brands={report.brand_mix} onChange={setSelectedBrand} />
        <div className="flex items-center justify-center text-3xl font-black text-[color:var(--text-3)]">VS</div>
        <CompareBrandCard side="B" color="var(--chart-violet)" brand={brandB} brands={report.brand_mix.filter((row) => row.name !== brandA.name)} onChange={setOtherBrand} />
        <div className="flex items-center justify-center text-3xl font-black text-[color:var(--text-3)]">VS</div>
        <CompareBrandCard side="C" color="var(--chart-teal)" brand={brandC} brands={report.brand_mix.filter((row) => row.name !== brandA.name && row.name !== brandB.name)} onChange={setThirdBrand} />
      </div>

      <ChartCard title="Duelo de KPIs" subtitle="Marca el ganador de cada metrica">
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">
                <th className="px-3 py-2 text-left">Metrica</th>
                {selected.map((item) => <th key={item.key} className="px-3 py-2 text-right">{item.brand.name}</th>)}
                <th className="px-3 py-2 text-right">Lider</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const max = Math.max(...row.values);
                const winnerIndex = row.values.indexOf(max);
                return (
                  <tr key={row.label} className="border-t border-white/5">
                    <td className="px-3 py-3 font-bold text-[color:var(--text-2)]">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td key={`${row.label}-${selected[index].key}`} className={cn('px-3 py-3 text-right font-mono', index === winnerIndex ? 'font-black text-emerald-200' : 'text-[color:var(--text-2)]')}>
                        {index === winnerIndex && <Check className="mr-1 inline h-3.5 w-3.5" />}
                        {row.format(value)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right">
                      <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-black text-emerald-200">
                        {selected[winnerIndex].brand.name}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Perfil comparativo" subtitle="Barras normalizadas por metrica">
          <CapabilityComparisonBars rows={capabilityRows} selected={selected} />
        </ChartCard>
        <ChartCard title="Marcas en sucursales" subtitle="Que marca empuja cada sucursal">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={branchCompare}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
              <XAxis dataKey="name" tick={{ fill: '#B8C5DA', fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                formatter={(value, name) => [metricFormatter(mode)(Number(value)), name]}
                labelFormatter={(label) => String(label).toUpperCase()}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="A" name={brandA.name} fill="var(--chart-blue)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="B" name={brandB.name} fill="var(--chart-violet)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="C" name={brandC.name} fill="var(--chart-teal)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Conclusion automatica" subtitle="Resumen comparativo para lectura rapida">
        {(() => {
          // Calcula la metrica donde el ganador global mas se diferencia
          // del runner-up. Y la metrica donde el runner-up gana al ganador
          // global (si la hay), para dar contexto matizado.
          const winnerIdx = globalWinnerIndex;
          const runnerCandidates = selected
            .map((_, i) => i)
            .filter((i) => i !== winnerIdx)
            .sort((a, b) => winCounts[b] - winCounts[a]);
          const runnerIdx = runnerCandidates[0];
          const winner = selected[winnerIdx];
          const runner = runnerIdx !== undefined ? selected[runnerIdx] : null;

          // Mayor brecha del ganador vs runner-up (en % relativo)
          type Gap = { label: string; pct: number; format: (n: number) => string; winnerVal: number };
          const gaps: Gap[] = rows.map((row) => {
            const w = row.values[winnerIdx] || 0;
            const r = runnerIdx !== undefined ? (row.values[runnerIdx] || 0) : 0;
            const pct = r ? ((w - r) / Math.abs(r)) * 100 : 0;
            return { label: row.label, pct, format: row.format, winnerVal: w };
          });
          const winnerBiggest = gaps
            .filter((g) => g.pct > 0)
            .sort((a, b) => b.pct - a.pct)[0];
          const runnerStrongest = runnerIdx !== undefined
            ? gaps.filter((g) => g.pct < 0).sort((a, b) => a.pct - b.pct)[0]
            : null;

          const sentences: string[] = [];
          sentences.push(
            `${winner.brand.name} supera a ${runner?.brand.name ?? 'los demas'} en ${winCounts[winnerIdx]} de ${rows.length} metricas.`,
          );
          if (winnerBiggest) {
            sentences.push(
              `Mayor diferencia en ${winnerBiggest.label.toLowerCase()} (+${winnerBiggest.pct.toFixed(1)}%).`,
            );
          }
          if (runnerStrongest && runner) {
            sentences.push(
              `${runner.brand.name} mantiene ventaja en ${runnerStrongest.label.toLowerCase()}, lo que sugiere un posicionamiento distinto.`,
            );
          }

          return (
            <p className="text-sm leading-6 text-[color:var(--text-2)]">
              {sentences.map((s, i) => {
                // resalta los nombres de marca dentro del texto
                const highlighted = s
                  .replace(winner.brand.name, `__W__${winner.brand.name}__`)
                  .replace(runner?.brand.name || ' ', `__R__${runner?.brand.name || ''}__`);
                const parts = highlighted.split(/(__[WR]__[^_]+__)/g);
                return (
                  <span key={i}>
                    {parts.map((part, j) => {
                      if (part.startsWith('__W__')) {
                        return <span key={j} className="font-black" style={{ color: 'var(--chart-blue)' }}>{part.slice(5, -2)}</span>;
                      }
                      if (part.startsWith('__R__')) {
                        return <span key={j} className="font-black" style={{ color: 'var(--chart-violet)' }}>{part.slice(5, -2)}</span>;
                      }
                      return part;
                    })}
                    {i < sentences.length - 1 && ' '}
                  </span>
                );
              })}
            </p>
          );
        })()}
      </ChartCard>
    </div>
  );
}

function CompareBrandCard({
  side,
  color,
  brand,
  brands,
  onChange,
}: {
  side: 'A' | 'B' | 'C';
  color: string;
  brand: SalesBICommercialMix;
  brands: SalesBICommercialMix[];
  onChange: (brand: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-black text-white" style={{ background: color }}>
          {brand.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Lado {side}</div>
          <div className="text-2xl font-black text-white">{brand.name}</div>
          <div className="text-xs text-[color:var(--text-3)]">{money(brand.total_vendido)} · {num(brand.unidades)} u</div>
        </div>
      </div>
      <select value={brand.name} onChange={(event) => onChange(event.target.value)} className={`${inputClass} mt-4`}>
        {brands.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
      </select>
    </section>
  );
}

function CapabilityComparisonBars({
  rows,
  selected,
}: {
  rows: Array<{ label: string; values: number[]; format: (value: number) => string }>;
  selected: Array<{ key: string; color: string; brand: SalesBICommercialMix }>;
}) {
  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const max = Math.max(1, ...row.values);
        const winnerIndex = row.values.indexOf(Math.max(...row.values));
        return (
          <div key={row.label} className="rounded-xl bg-white/[0.035] px-3 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-black text-white">{row.label}</div>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-black text-emerald-200">
                Lidera {selected[winnerIndex].brand.name}
              </span>
            </div>
            <div className="space-y-2.5">
              {selected.map((item, index) => {
                const value = row.values[index] || 0;
                const width = Math.max(4, (value / max) * 100);
                return (
                  <div key={`${row.label}-${item.key}`} className="grid gap-2 sm:grid-cols-[130px_1fr_auto] sm:items-center">
                    <div className="truncate text-xs font-black text-[color:var(--text-2)]">{item.brand.name}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: `${width}%`, background: item.color }}
                      />
                    </div>
                    <div className={cn('text-right text-xs font-mono font-black', index === winnerIndex ? 'text-emerald-200' : 'text-[color:var(--text-2)]')}>
                      {row.format(value)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeriodsDashboard({
  report,
  previousReport,
  mode,
  compareEnabled,
  compareDesde,
  compareHasta,
}: {
  report: SalesBICommercialReport;
  previousReport: SalesBICommercialReport | null;
  mode: MetricMode;
  compareEnabled: boolean;
  compareDesde: string;
  compareHasta: string;
}) {
  if (!compareEnabled) {
    return (
      <ChartCard title="Comparacion desactivada" subtitle="Activala desde los filtros para elegir otro rango">
        <EmptyChartState
          title="Sin rango comparado"
          description="Activa 'Comparar contra otro periodo', elegi las fechas y presiona Aplicar para ver evolucion, marcas y sucursales contra ese rango."
        />
      </ChartCard>
    );
  }

  if (!previousReport) {
    return (
      <ChartCard title="Sin datos comparados" subtitle={`${compareDesde || '-'} al ${compareHasta || '-'}`}>
        <EmptyChartState
          title="No se pudo cargar el rango comparado"
          description="Revisa las fechas de comparacion y presiona Aplicar nuevamente."
        />
      </ChartCard>
    );
  }

  const daily = report.daily_series.map((row, index) => {
    const prev = previousReport.daily_series[index];
    return {
      dia: index + 1,
      actual: mode === 'units' ? row.unidades : row.total_vendido,
      anterior: prev ? (mode === 'units' ? prev.unidades : prev.total_vendido) : 0,
    };
  });
  const rows = report.brand_mix.slice(0, 14).map((brand) => {
    const prev = previousReport.brand_mix.find((row) => row.name === brand.name);
    return {
      brand,
      prev,
      delta: pctDelta(metricValue(brand, mode), prev ? metricValue(prev, mode) : undefined),
    };
  });
  const rangeLabel = `${report.filters.fecha_desde} al ${report.filters.fecha_hasta} vs ${compareDesde} al ${compareHasta}`;
  return (
    <div className="space-y-5">
      <ChartCard title="Evolucion comparada" subtitle={rangeLabel}>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={daily} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
            <XAxis dataKey="dia" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
            <YAxis hide />
            <Tooltip
              formatter={(value, name) => [metricFormatter(mode)(Number(value)), name]}
              labelFormatter={(label) => `Dia ${label}`}
              contentStyle={CHART_TOOLTIP_STYLE}
              labelStyle={CHART_TOOLTIP_LABEL_STYLE}
              itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--chart-blue)" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="anterior" name="Anterior" stroke="var(--chart-ghost)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Marca por marca" subtitle="Actual vs rango comparado, ordenado por peso actual">
        <div className="overflow-x-auto">
          <table className="min-w-[820px] w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">
                <th className="px-3 py-2 text-left">Marca</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Anterior</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2 text-right">Unidades</th>
                <th className="px-3 py-2 text-right">SKUs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ brand, prev, delta }) => (
                <tr key={brand.name} className="border-t border-white/5">
                  <td className="px-3 py-3 font-black text-white">{brand.name}</td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-200">{metricFormatter(mode)(metricValue(brand, mode))}</td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{prev ? metricFormatter(mode)(metricValue(prev, mode)) : '-'}</td>
                  <td className="px-3 py-3 text-right">
                    <span className={cn('rounded-full px-2 py-1 text-[11px] font-black', (delta || 0) >= 0 ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200')}>
                      {deltaLabel(delta)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{num(brand.unidades)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[color:var(--text-2)]">{num(brand.productos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard title="Sucursales" subtitle="Actual vs rango comparado: quien empuja y quien retrocede">
        <div className="grid gap-3 md:grid-cols-2">
          {report.branch_mix.map((branch) => {
            const prev = previousReport.branch_mix.find((row) => row.name === branch.name);
            const delta = pctDelta(metricValue(branch, mode), prev ? metricValue(prev, mode) : undefined);
            return (
              <section key={branch.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Sucursal</div>
                    <div className="text-2xl font-black text-white">{branch.name}</div>
                  </div>
                  <span className={cn('rounded-lg px-2 py-1 text-xs font-black', (delta || 0) >= 0 ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200')}>
                    {deltaLabel(delta)}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MiniMetric label="Vendido" value={money(branch.total_vendido)} />
                  <MiniMetric label="Lineas" value={num(branch.lineas)} />
                  <MiniMetric label="PVP prom. unidad" value={money(branch.pvp_promedio)} />
                </div>
              </section>
            );
          })}
        </div>
      </ChartCard>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/15 px-3 py-2 text-center">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--text-3)]">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function buildOpportunityCards({
  branchReport,
  brandsReport,
  previousReport,
}: {
  branchReport: SalesBICommercialReport;
  brandsReport: SalesBICommercialReport;
  previousReport: SalesBICommercialReport | null;
}): OpportunityCardModel[] {
  const cards: OpportunityCardModel[] = [];
  (branchReport.opportunities || []).forEach((item) => {
    const level: OpportunityLevel = item.gap_pct >= 14 ? 'critica' : item.gap_pct >= 10 ? 'alta' : item.gap_pct >= 7 ? 'media' : 'info';
    cards.push({
      id: `branch-line-${item.sucursal}-${item.tipo_producto}`,
      level,
      rule: 'Sucursal debil en linea',
      title: `${item.sucursal} debil en ${item.tipo_producto}`,
      tags: [item.sucursal, item.tipo_producto],
      summary: `${item.sucursal} vende ${item.participacion_sucursal.toFixed(1)}% de ${item.tipo_producto}, contra ${item.participacion_empresa.toFixed(1)}% de la red.`,
      metric: `Desvio de participacion en ${item.tipo_producto} vs red`,
      observed: `-${item.gap_pct.toFixed(1)} pts`,
      threshold: '< -7 pts',
      formula: 'participacion_red - participacion_sucursal',
      action: `Revisar exhibicion y stock en ${item.sucursal}. Disparar accion focalizada en ${item.tipo_producto}.`,
      branch: item.sucursal,
      line: item.tipo_producto,
    });
  });

  if (previousReport) {
    brandsReport.brand_mix.slice(0, 16).forEach((brand) => {
      const previous = previousReport.brand_mix.find((row) => row.name === brand.name);
      const delta = pctDelta(brand.total_vendido, previous?.total_vendido);
      if (delta === null) return;
      if (delta <= -4 || delta >= 8) {
        const falling = delta <= -4;
        cards.push({
          id: `brand-delta-${brand.name}`,
          level: falling ? (delta <= -10 ? 'critica' : 'alta') : 'media',
          rule: falling ? 'Marca en caida' : 'Marca en crecimiento',
          title: `${brand.name} ${falling ? 'muestra caida' : 'crece de forma sostenida'}`,
          tags: [brand.name],
          summary: falling
            ? `${brand.name} cae vs rango comparado. Verificar mix de producto, stock y exhibicion.`
            : `${brand.name} suma ${money(brand.total_vendido - (previous?.total_vendido || 0))} contra el rango comparado.`,
          metric: 'Variacion PVP vs rango comparado',
          observed: deltaLabel(delta),
          threshold: falling ? '< -4%' : '>= 8%',
          formula: '(actual - anterior) / anterior',
          action: falling ? 'Revisar negociacion de precio y rotar productos foco.' : 'Monitorear. Si la tendencia se mantiene, escalar accion comercial.',
          brand: brand.name,
        });
      }
    });
  }

  brandsReport.line_mix.forEach((line) => {
    const unitShare = brandsReport.totals.unidades ? (line.unidades / brandsReport.totals.unidades) * 100 : 0;
    const pvpShare = line.participacion_pct || 0;
    const ratio = pvpShare ? unitShare / pvpShare : 0;
    if (ratio >= 1.8) {
      cards.push({
        id: `line-imbalance-${line.name}`,
        level: 'info',
        rule: 'Linea desbalanceada',
        title: `${line.name} tracciona volumen, bajo valor`,
        tags: [line.name],
        summary: `${line.name} concentra ${unitShare.toFixed(1)}% de las unidades pero ${pvpShare.toFixed(1)}% del PVP.`,
        metric: 'Ratio share unidades / share PVP',
        observed: `${ratio.toFixed(2)}x`,
        threshold: '>= 1.8x',
        formula: '(unidades_linea / unidades_total) / (pvp_linea / pvp_total)',
        action: 'No leer como caida. Usar la linea para traccion y complemento de PVP.',
        line: line.name,
      });
    }
  });

  const priority: Record<OpportunityLevel, number> = { critica: 0, alta: 1, media: 2, info: 3 };
  return cards.sort((a, b) => priority[a.level] - priority[b.level]);
}

function opportunityStyle(level: OpportunityLevel) {
  return {
    critica: {
      border: 'border-rose-500/40',
      bg: 'bg-rose-500/10',
      text: 'text-rose-200',
      badge: 'bg-rose-500/15 text-rose-100',
      icon: <AlertTriangle className="h-5 w-5 text-rose-200" />,
    },
    alta: {
      border: 'border-amber-500/40',
      bg: 'bg-amber-500/10',
      text: 'text-amber-200',
      badge: 'bg-amber-500/15 text-amber-100',
      icon: <AlertTriangle className="h-5 w-5 text-amber-200" />,
    },
    media: {
      border: 'border-blue-500/35',
      bg: 'bg-blue-500/10',
      text: 'text-blue-200',
      badge: 'bg-blue-500/15 text-blue-100',
      icon: <BarChart3 className="h-5 w-5 text-blue-200" />,
    },
    info: {
      border: 'border-emerald-500/35',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-200',
      badge: 'bg-emerald-500/15 text-emerald-100',
      icon: <Target className="h-5 w-5 text-emerald-200" />,
    },
  }[level];
}

function AdvancedOpportunitiesDashboard({
  report,
  brandsReport,
  previousReport,
  setActiveTab,
  setSelectedBranch,
  setSelectedLine,
  setSelectedBrand,
}: {
  report: SalesBICommercialReport;
  brandsReport: SalesBICommercialReport;
  previousReport: SalesBICommercialReport | null;
  setActiveTab: (tab: CommercialTab) => void;
  setSelectedBranch: (branch: string) => void;
  setSelectedLine: (line: string) => void;
  setSelectedBrand: (brand: string) => void;
}) {
  const [showRules, setShowRules] = useState(false);
  const [filter, setFilter] = useState<OpportunityLevel | 'todas'>('todas');
  const cards = useMemo(() => buildOpportunityCards({ branchReport: report, brandsReport, previousReport }), [brandsReport, previousReport, report]);
  const filtered = cards.filter((card) => filter === 'todas' || card.level === filter);
  const counts = {
    critica: cards.filter((card) => card.level === 'critica').length,
    alta: cards.filter((card) => card.level === 'alta').length,
    media: cards.filter((card) => card.level === 'media').length,
    info: cards.filter((card) => card.level === 'info').length,
  };
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <OpportunityStat label="Total" value={cards.length} color="var(--chart-blue)" />
            <OpportunityStat label="Criticas" value={counts.critica} color="var(--chart-negative)" />
            <OpportunityStat label="Alta" value={counts.alta} color="var(--chart-amber)" />
            <OpportunityStat label="Media" value={counts.media} color="var(--chart-blue)" />
            <OpportunityStat label="Info" value={counts.info} color="var(--chart-positive)" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['todas', 'critica', 'alta', 'media', 'info'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  'h-9 rounded-xl px-3 text-xs font-black uppercase transition',
                  filter === value ? 'bg-[color:var(--chart-blue)] text-white' : 'bg-white/[0.04] text-[color:var(--text-2)] hover:bg-white/[0.08]',
                )}
              >
                {value}
              </button>
            ))}
            <button type="button" onClick={() => setShowRules((value) => !value)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs font-black text-white hover:bg-white/10">
              <Settings2 size={15} />
              Reglas
            </button>
          </div>
        </div>
        {showRules && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <RuleInfo title="Sucursal debil en linea" description="Detecta lineas cuyo peso en una sucursal cae contra el consolidado." />
            <RuleInfo title="Marca en caida / crecimiento" description="Compara la marca contra el rango elegido en el comparador de periodo." />
            <RuleInfo title="Linea desbalanceada" description="Detecta lineas que mueven muchas unidades pero aportan menos PVP relativo." />
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((item) => {
          const style = opportunityStyle(item.level);
          return (
            <div key={item.id} className={cn('rounded-2xl border p-5', style.border, style.bg)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/15">
                    {style.icon}
                  </div>
                  <div>
                    <div className={cn('text-[10px] font-black uppercase tracking-[0.18em]', style.text)}>{item.level} - regla: {item.rule}</div>
                    <div className="text-lg font-black text-white">{item.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => <Pill key={tag} tone={item.level === 'critica' ? 'negative' : item.level === 'alta' ? 'amber' : 'blue'}>{tag}</Pill>)}
                    </div>
                  </div>
                </div>
                <div className={cn('rounded-xl px-3 py-1 text-sm font-black', style.badge)}>{item.observed}</div>
              </div>
              <p className="mt-3 text-sm text-[color:var(--text-2)]">{item.summary}</p>
              <div className="mt-3 grid gap-2 rounded-xl bg-black/15 p-3 md:grid-cols-3">
                <RuleInfo title="Metrica" description={item.metric} />
                <RuleInfo title="Umbral" description={item.threshold} />
                <RuleInfo title="Formula" description={item.formula} />
              </div>
              <div className="mt-3 rounded-xl bg-black/15 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Accion sugerida</div>
                <div className="mt-1 flex items-start gap-2 text-sm text-white">
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                  {item.action}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (item.branch) {
                    setSelectedBranch(item.branch);
                    if (item.line) setSelectedLine(item.line);
                    setActiveTab('branches');
                  } else if (item.brand) {
                    setSelectedBrand(item.brand);
                    setActiveTab('brands');
                  } else if (item.line) {
                    setSelectedLine(item.line);
                    setActiveTab('lines');
                  }
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-blue-200 hover:text-white"
              >
                Ver detalle <ArrowRight size={13} />
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <ChartCard title="Sin oportunidades detectadas" subtitle="No hay gaps relevantes con los filtros actuales">
            <div className="py-10 text-center text-sm text-[color:var(--text-3)]">Proba ampliar el rango o quitar filtros.</div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function OpportunitiesDashboard({
  report,
  setActiveTab,
  setSelectedBranch,
  setSelectedLine,
}: {
  report: SalesBICommercialReport;
  setActiveTab: (tab: CommercialTab) => void;
  setSelectedBranch: (branch: string) => void;
  setSelectedLine: (line: string) => void;
}) {
  const [showRules, setShowRules] = useState(false);
  const items = report.opportunities || [];
  const high = items.filter((item) => item.gap_pct >= 12).length;
  const medium = items.filter((item) => item.gap_pct >= 7 && item.gap_pct < 12).length;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <OpportunityStat label="Total" value={items.length} color="var(--chart-blue)" />
            <OpportunityStat label="Alta" value={high} color="var(--chart-negative)" />
            <OpportunityStat label="Media" value={medium} color="var(--chart-amber)" />
          </div>
          <button type="button" onClick={() => setShowRules((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-bold text-white hover:bg-white/10">
            <Settings2 size={16} />
            Reglas
          </button>
        </div>
        {showRules && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <RuleInfo title="Sucursal debil en linea" description="Detecta lineas cuyo peso en una sucursal cae contra el consolidado." />
            <RuleInfo title="Oportunidad de surtido" description="Cruza baja participacion con perfil comercial de la sucursal." />
            <RuleInfo title="Modo interno" description="Estas recomendaciones no se muestran en modo presentacion externo." />
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <div key={`${item.sucursal}-${item.tipo_producto}`} className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
                  <AlertTriangle className="h-5 w-5 text-amber-200" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">Oportunidad</div>
                  <div className="text-lg font-black text-white">{item.sucursal} · {item.tipo_producto}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Pill tone="amber">{item.participacion_sucursal.toFixed(1)}% sucursal</Pill>
                    <Pill tone="blue">{item.participacion_empresa.toFixed(1)}% empresa</Pill>
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-black/20 px-3 py-1 text-sm font-black text-amber-100">{item.gap_pct.toFixed(1)} pts</div>
            </div>
            <p className="mt-3 text-sm text-[color:var(--text-2)]">{item.reason}</p>
            <div className="mt-3 rounded-xl bg-black/15 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Accion sugerida</div>
              <div className="mt-1 flex items-start gap-2 text-sm text-white">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                Revisar exhibicion, stock y oferta de {item.tipo_producto} en {item.sucursal}.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedBranch(item.sucursal);
                setSelectedLine(item.tipo_producto);
                setActiveTab('branches');
              }}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-blue-200 hover:text-white"
            >
              Ver detalle <ArrowRight size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <ChartCard title="Sin oportunidades detectadas" subtitle="No hay gaps relevantes con los filtros actuales">
            <div className="py-10 text-center text-sm text-[color:var(--text-3)]">Probá ampliar el rango o quitar filtros.</div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function OpportunityStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[color:var(--text-3)]">{label}</div>
      <div className="text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function RuleInfo({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl bg-slate-950/40 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-[color:var(--text-3)]">{description}</div>
    </div>
  );
}

function PresentationDashboard({
  report,
  selectedBrand,
  setSelectedBrand,
}: {
  report: SalesBICommercialReport;
  selectedBrand: string;
  setSelectedBrand: (brand: string) => void;
}) {
  const brand = rowByName(report.brand_mix, selectedBrand);
  if (!brand) return null;
  const branchMatrix = matrixByName(report.brand_branch_matrix, brand.name);
  const lineMatrix = matrixByName(report.brand_line_matrix, brand.name);
  const similar = report.compare_candidates?.filter((row) => row.brand === brand.name).slice(0, 3) || [];
  const topProducts = report.top_products.filter((row) => row.marca === brand.name).slice(0, 8);
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
        <div className="text-sm font-black text-amber-100">Vista lista para marcas y proveedores</div>
        <p className="mt-1 text-sm text-amber-100/80">
          No muestra costos, diferencia ni margen. Sirve para reuniones externas con ventas, unidades, participacion, mix y productos.
        </p>
      </section>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[color:var(--chart-blue)]">Informe de marca</div>
            <h2 className="mt-1 text-4xl font-black text-white">{brand.name}</h2>
            <p className="mt-1 text-sm text-[color:var(--text-2)]">Fuente: Ventas Vs. Costos · {report.filters.fecha_desde} al {report.filters.fecha_hasta}</p>
          </div>
          <Field label="Marca">
            <select value={brand.name} onChange={(event) => setSelectedBrand(event.target.value)} className={inputClass}>
              {report.brand_mix.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="PVP vendido" value={brand.total_vendido} format={money} accent="blue" />
          <KpiCard label="Unidades" value={brand.unidades} format={num} accent="teal" />
          <KpiCard label="Participacion" value={brand.participacion_pct} format={(value) => `${value.toFixed(1)}%`} accent="violet" />
          <KpiCard label="SKUs" value={brand.productos} format={num} accent="amber" />
          <KpiCard label="PVP prom. unidad" value={brand.pvp_promedio} format={money} accent="positive" />
        </div>
      </section>

      {similar.length > 0 && (
        <ChartCard title="Versus marcas similares de la red" subtitle="Comparativa segura, sin rentabilidad interna">
          <div className="grid gap-2 md:grid-cols-3">
            {similar.map((candidate) => (
              <div key={`${candidate.brand}-${candidate.suggested_compare}`} className="rounded-xl bg-white/[0.04] px-3 py-3">
                <div className="text-sm font-black text-white">{brand.name} vs {candidate.suggested_compare}</div>
                <div className="mt-1 text-xs text-[color:var(--text-3)]">{candidate.reason}</div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Participacion por sucursal" subtitle={`Distribucion de ${brand.name}`}>
          <ShareBars rows={branchMatrix?.items || []} mode="pvp" />
        </ChartCard>
        <ChartCard title="Lineas comerciales donde aporta" subtitle="Mix de la marca">
          <RankingBars data={lineMatrix?.items || []} color="var(--chart-blue)" mode="pvp" />
        </ChartCard>
      </div>

      <ChartCard title="Evolucion de la marca" subtitle="Evolucion diaria del periodo seleccionado">
        <DailyArea report={report} mode="pvp" />
      </ChartCard>

      <TopProductsTable rows={topProducts.length ? topProducts : report.top_products.slice(0, 8)} />
    </div>
  );
}

export function SalesBICommercialPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const kind = kindFromPath(location.pathname);
  const [activeTab, setActiveTab] = useState<CommercialTab>(() => tabFromKind(kind));
  const activeKind = kindForTab(activeTab);
  const meta = KIND_META[activeKind];
  const [options, setOptions] = useState<SalesBICommercialOptions | null>(null);
  const [reports, setReports] = useState<Partial<Record<CommercialKind, SalesBICommercialReport>>>({});
  const [previousReport, setPreviousReport] = useState<SalesBICommercialReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [tipoVenta, setTipoVenta] = useState('');
  const [marca, setMarca] = useState('');
  const [linea, setLinea] = useState('');
  const [presentation, setPresentation] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDesde, setCompareDesde] = useState('');
  const [compareHasta, setCompareHasta] = useState('');
  const [metricMode, setMetricMode] = useState<MetricMode>('units');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedLine, setSelectedLine] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');

  useEffect(() => {
    setActiveTab(tabFromKind(kind));
  }, [kind]);

  useEffect(() => {
    fetchSalesBICommercialOptions()
      .then((data) => {
        setOptions(data);
        const nextDesde = fechaDesde || data.period_start || '';
        const nextHasta = fechaHasta || data.period_end || '';
        setFechaDesde((prev) => prev || nextDesde);
        setFechaHasta((prev) => prev || nextHasta);
        const previous = previousRange(nextDesde, nextHasta);
        if (previous) {
          setCompareDesde((prev) => prev || previous.fecha_desde);
          setCompareHasta((prev) => prev || previous.fecha_hasta);
        }
      })
      .catch(() => setOptions({ period_start: '', period_end: '', marcas: [], tipos: [], sucursales: [], empresas: [], tipo_ventas: ['local', 'online'] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (compareEnabled) return;
    const previous = previousRange(fechaDesde, fechaHasta);
    if (!previous) return;
    setCompareDesde(previous.fecha_desde);
    setCompareHasta(previous.fecha_hasta);
  }, [compareEnabled, fechaDesde, fechaHasta]);

  const params = useMemo(() => ({
    fecha_desde: fechaDesde || undefined,
    fecha_hasta: fechaHasta || undefined,
    sucursal: toCsv(sucursal),
    tipo_venta: toCsv(tipoVenta),
    marca: toCsv(marca),
    tipo_producto: toCsv(linea),
    presentation,
  }), [fechaDesde, fechaHasta, sucursal, tipoVenta, marca, linea, presentation]);

  async function loadReport() {
    setLoading(true);
    setError('');
    try {
      const previousParams = compareEnabled && compareDesde && compareHasta
        ? { ...params, fecha_desde: compareDesde, fecha_hasta: compareHasta }
        : null;
      const [brands, lines, branches, previousBrands] = await Promise.all([
        fetchSalesBICommercialReport('brands', params),
        fetchSalesBICommercialReport('lines', params),
        fetchSalesBICommercialReport('branches', params),
        previousParams ? fetchSalesBICommercialReport('brands', previousParams) : Promise.resolve(null),
      ]);
      setReports({ brands, lines, branches });
      setPreviousReport(previousBrands);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el informe comercial.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const base = reports.brands || reports.lines || reports.branches;
    if (!base) return;
    setSelectedBrand((current) => (base.brand_mix.some((row) => row.name === current) ? current : base.brand_mix[0]?.name || ''));
    setSelectedLine((current) => (base.line_mix.some((row) => row.name === current) ? current : base.line_mix[0]?.name || ''));
    setSelectedBranch((current) => (base.branch_mix.some((row) => row.name === current) ? current : base.branch_mix[0]?.name || ''));
  }, [reports]);

  async function handleExport(type: 'pdf' | 'xlsx') {
    const exportReport = reports[activeKind];
    if (!exportReport) return;
    setExporting(type);
    try {
      const payload = { ...params, kind: activeKind, presentation: activeTab === 'presentation' ? true : presentation, titulo: meta.title };
      const blob = type === 'pdf' ? await exportSalesBICommercialPdf(payload) : await exportSalesBICommercialXlsx(payload);
      downloadBlob(blob, `bi-comercial-${activeTab}.${type === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el informe.');
    } finally {
      setExporting(null);
    }
  }

  function setPreset(preset: string) {
    const today = new Date();
    let nextDesde = fechaDesde;
    let nextHasta = fechaHasta;
    if (preset === 'today') {
      nextDesde = isoDate(today);
      nextHasta = isoDate(today);
    } else if (preset === 'yesterday') {
      const y = addDays(today, -1);
      nextDesde = isoDate(y);
      nextHasta = isoDate(y);
    } else if (preset === 'week') {
      nextDesde = isoDate(addDays(today, -((today.getDay() + 6) % 7)));
      nextHasta = isoDate(today);
    } else if (preset === 'previousWeek') {
      const end = addDays(addDays(today, -((today.getDay() + 6) % 7)), -1);
      nextDesde = isoDate(addDays(end, -6));
      nextHasta = isoDate(end);
    } else if (preset === 'month') {
      nextDesde = isoDate(startOfMonth(today));
      nextHasta = isoDate(today);
    } else if (preset === 'previousMonth') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      nextDesde = isoDate(start);
      nextHasta = isoDate(endOfMonth(start));
    } else {
      nextDesde = isoDate(addDays(today, -29));
      nextHasta = isoDate(today);
    }
    setFechaDesde(nextDesde);
    setFechaHasta(nextHasta);
    const previous = previousRange(nextDesde, nextHasta);
    if (previous && !compareEnabled) {
      setCompareDesde(previous.fecha_desde);
      setCompareHasta(previous.fecha_hasta);
    }
  }

  function toggleCompare(enabled: boolean) {
    setCompareEnabled(enabled);
    if (!enabled) {
      setPreviousReport(null);
      return;
    }
    if (!compareDesde || !compareHasta) {
      const previous = previousRange(fechaDesde, fechaHasta);
      if (previous) {
        setCompareDesde(previous.fecha_desde);
        setCompareHasta(previous.fecha_hasta);
      }
    }
  }

  const tabs = [
    { value: 'overview', label: 'Resumen', shortLabel: 'Resumen', icon: <BarChart3 size={14} /> },
    { value: 'brands', label: 'Marcas', shortLabel: 'Marcas', icon: <Tags size={14} /> },
    { value: 'lines', label: 'Lineas', shortLabel: 'Lineas', icon: <Layers3 size={14} /> },
    { value: 'branches', label: 'Sucursales', shortLabel: 'Suc.', icon: <Building2 size={14} /> },
    { value: 'products', label: 'Productos', shortLabel: 'Prod.', icon: <Package size={14} /> },
    { value: 'compare', label: 'Comparador', shortLabel: 'Comp.', icon: <Trophy size={14} /> },
    { value: 'periods', label: 'Periodos', shortLabel: 'Per.', icon: <CalendarRange size={14} /> },
    { value: 'opportunities', label: 'Oportunidades', shortLabel: 'Oport.', icon: <AlertTriangle size={14} /> },
    { value: 'presentation', label: 'Presentacion', shortLabel: 'Pres.', icon: <Presentation size={14} /> },
  ];

  const activeReport = reports[activeKind] || null;
  const brandsReport = reports.brands || activeReport;
  const linesReport = reports.lines || brandsReport;
  const branchesReport = reports.branches || brandsReport;

  function handleTabChange(value: string) {
    const tab = value as CommercialTab;
    setActiveTab(tab);
    if (tab === 'brands') navigate('/ventas-bi/marcas');
    if (tab === 'lines') navigate('/ventas-bi/lineas');
    if (tab === 'branches') navigate('/ventas-bi/sucursales');
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[color:var(--chart-blue)]">Fuente: Ventas Vs. Costos</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[color:var(--text)] sm:text-4xl">{meta.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--text-2)]">
            Analisis comercial comparable por producto. No incluye medios de pago, senas, recibos, remitos ni vendedores.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('sales_bi.import') && (
            <button
              type="button"
              onClick={() => navigate('/ventas-bi/comercial/importar')}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-bold text-[color:var(--text)] hover:bg-white/10"
            >
              <FileSpreadsheet size={16} />
              Importar
            </button>
          )}
          {can('sales_bi.export') && (
            <>
              <button type="button" onClick={() => handleExport('xlsx')} disabled={!activeReport || !!exporting} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-3 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40">
                {exporting === 'xlsx' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Excel
              </button>
              <ViewMenu
                presentation={presentation}
                setPresentation={setPresentation}
                onExportPdf={() => handleExport('pdf')}
                exporting={exporting === 'pdf'}
              />
            </>
          )}
        </div>
      </header>

      <section className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="Desde"><input type="date" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} className={inputClass} /></Field>
          <Field label="Hasta"><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} className={inputClass} /></Field>
          <Field label="Sucursal"><select value={sucursal} onChange={(event) => setSucursal(event.target.value)} className={inputClass}><option value="">Todas</option>{options?.sucursales.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
          <Field label="Tipo venta"><select value={tipoVenta} onChange={(event) => setTipoVenta(event.target.value)} className={inputClass}><option value="">Local + online</option><option value="local">Local</option><option value="online">Online</option></select></Field>
          <Field label="Marca"><select value={marca} onChange={(event) => setMarca(event.target.value)} className={inputClass}><option value="">Todas</option>{options?.marcas.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
          <Field label="Linea"><select value={linea} onChange={(event) => setLinea(event.target.value)} className={inputClass}><option value="">Todas</option>{(options?.categorias ?? options?.tipos ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPreset('today')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Hoy</button>
            <button type="button" onClick={() => setPreset('yesterday')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Ayer</button>
            <button type="button" onClick={() => setPreset('week')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Semana actual</button>
            <button type="button" onClick={() => setPreset('previousWeek')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Semana anterior</button>
            <button type="button" onClick={() => setPreset('month')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Mes actual</button>
            <button type="button" onClick={() => setPreset('previousMonth')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Mes anterior</button>
            <button type="button" onClick={() => setPreset('last30')} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[color:var(--text-2)] hover:bg-white/10">Ultimos 30 dias</button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <MetricModeSelector value={metricMode} onChange={setMetricMode} />
            <div className="flex gap-2">
              <button type="button" onClick={loadReport} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-4 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Aplicar
              </button>
              <button type="button" onClick={() => { setSucursal(''); setTipoVenta(''); setMarca(''); setLinea(''); }} className="rounded-xl border border-white/15 px-4 text-sm font-bold text-[color:var(--text-2)] hover:bg-white/10 hover:text-white">
                Limpiar
              </button>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
          <label className="flex cursor-pointer items-center gap-3">
            <span className={cn(
              'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
              compareEnabled ? 'bg-[color:var(--chart-violet)]' : 'bg-[color:var(--border-strong)]',
            )}>
              <span className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                compareEnabled ? 'translate-x-4' : 'translate-x-0.5',
              )}
              />
            </span>
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(event) => toggleCompare(event.target.checked)}
              className="sr-only"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[color:var(--text)]">Comparar contra otro periodo</div>
              <div className="text-[11px] text-[color:var(--text-3)]">
                {compareEnabled
                  ? 'Los KPIs, periodos y oportunidades usan el rango comparado elegido.'
                  : 'Ver solo los datos del rango actual sin comparacion.'}
              </div>
            </div>
          </label>
          {compareEnabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Comparar desde"><input type="date" value={compareDesde} onChange={(event) => setCompareDesde(event.target.value)} className={inputClass} /></Field>
              <Field label="Comparar hasta"><input type="date" value={compareHasta} onChange={(event) => setCompareHasta(event.target.value)} className={inputClass} /></Field>
            </div>
          )}
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={handleTabChange} tabs={tabs} />

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {loading && !activeReport ? (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-[color:var(--text-2)]">
          <Loader2 size={18} className="animate-spin" />
          Cargando informe comercial...
        </div>
      ) : activeReport && brandsReport ? (
        <>
          {activeTab === 'overview' && (
            <OverviewDashboard
              brandsReport={brandsReport}
              branchesReport={branchesReport || undefined}
              previousReport={previousReport}
              mode={metricMode}
              setActiveTab={setActiveTab}
              setSelectedBrand={setSelectedBrand}
              setSelectedBranch={setSelectedBranch}
              setSelectedLine={setSelectedLine}
            />
          )}

          {activeTab === 'brands' && (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <ChartCard title="Evolucion diaria" subtitle={`${brandsReport.filters.fecha_desde} al ${brandsReport.filters.fecha_hasta} · ${metricLabel(metricMode)}`}>
                  <DailyArea report={brandsReport} mode={metricMode} previousReport={previousReport} />
                </ChartCard>
                <ChartCard title="Ranking de marcas" subtitle={metricLabel(metricMode)}>
                  <RankingBars data={brandsReport.brand_mix} color="var(--chart-blue)" mode={metricMode} onSelect={setSelectedBrand} />
                </ChartCard>
              </div>
              <BrandDetail report={brandsReport} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} mode={metricMode} />
              <div className="grid gap-4 lg:grid-cols-3">
                <MixList title="Mix por marca" rows={brandsReport.brand_mix} mode={metricMode} onSelect={setSelectedBrand} />
                <MixList title="Mix por linea" rows={brandsReport.line_mix} mode={metricMode} onSelect={(name) => { setSelectedLine(name); setActiveTab('lines'); }} />
                <MixList title="Mix por sucursal" rows={brandsReport.branch_mix} mode={metricMode} onSelect={(name) => { setSelectedBranch(name); setActiveTab('branches'); }} />
              </div>
              <CompareCandidates report={brandsReport} />
            </>
          )}

          {activeTab === 'lines' && linesReport && (
            <LinesDetail report={linesReport} selectedLine={selectedLine} setSelectedLine={setSelectedLine} mode={metricMode} previousReport={previousReport} />
          )}

          {activeTab === 'branches' && branchesReport && (
            <BranchDetail report={branchesReport} selectedBranch={selectedBranch} setSelectedBranch={setSelectedBranch} mode={metricMode} />
          )}

          {activeTab === 'products' && (
            <ProductsDashboard report={brandsReport} mode={metricMode} setActiveTab={setActiveTab} setSelectedBrand={setSelectedBrand} setSelectedLine={setSelectedLine} />
          )}

          {activeTab === 'compare' && (
            <CompareDashboard report={brandsReport} mode={metricMode} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} />
          )}

          {activeTab === 'periods' && (
            <PeriodsDashboard
              report={brandsReport}
              previousReport={previousReport}
              mode={metricMode}
              compareEnabled={compareEnabled}
              compareDesde={compareDesde}
              compareHasta={compareHasta}
            />
          )}

          {activeTab === 'opportunities' && branchesReport && (
            <AdvancedOpportunitiesDashboard
              report={branchesReport}
              brandsReport={brandsReport}
              previousReport={previousReport}
              setActiveTab={setActiveTab}
              setSelectedBranch={setSelectedBranch}
              setSelectedLine={setSelectedLine}
              setSelectedBrand={setSelectedBrand}
            />
          )}

          {activeTab === 'presentation' && (
            <PresentationDashboard report={brandsReport} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} />
          )}
        </>
      ) : null}
    </div>
  );
}
