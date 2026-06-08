import {
  Building2, Download, FileSpreadsheet, GitCompare, Layers3, Loader2, RefreshCw, Tags,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Area, AreaChart,
} from 'recharts';
import {
  can,
  exportSalesBICommercialPdf,
  exportSalesBICommercialXlsx,
  fetchSalesBICommercialOptions,
  fetchSalesBICommercialReport,
} from '../api/client';
import type { SalesBICommercialMix, SalesBICommercialOptions, SalesBICommercialReport } from '../types';
import {
  CHART_ANIM, CHART_TOOLTIP_STYLE, ChartCard, KpiCard, Tabs, money, num,
} from '../components/SalesBIWidgets';

type CommercialKind = 'brands' | 'lines' | 'branches';

const KIND_META: Record<CommercialKind, { label: string; title: string; icon: ReactNode; color: string }> = {
  brands: { label: 'Marcas', title: 'BI comercial por marcas', icon: <Tags size={15} />, color: 'var(--chart-blue)' },
  lines: { label: 'Lineas', title: 'BI comercial por lineas', icon: <Layers3 size={15} />, color: 'var(--chart-violet)' },
  branches: { label: 'Sucursales', title: 'Perfil comercial de sucursales', icon: <Building2 size={15} />, color: 'var(--chart-teal)' },
};

const inputClass = 'h-11 w-full rounded-xl border border-white/15 bg-slate-950/40 px-3 text-sm font-medium text-white outline-none transition focus:border-[color:var(--chart-blue)]';

function kindFromPath(pathname: string): CommercialKind {
  if (pathname.includes('/lineas')) return 'lines';
  if (pathname.includes('/sucursales')) return 'branches';
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

function RankingBars({ data, color }: { data: SalesBICommercialMix[]; color: string }) {
  const rows = data.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 18, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={108} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
        <Tooltip formatter={(value) => money(Number(value))} contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="total_vendido" radius={[0, 8, 8, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing}>
          {rows.map((_, idx) => <Cell key={idx} fill={idx === 0 ? color : 'color-mix(in oklch, var(--chart-blue) 70%, var(--chart-teal))'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DailyArea({ report }: { report: SalesBICommercialReport }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={report.daily_series} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
        <defs>
          <linearGradient id="commercialDaily" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-blue)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.14)" />
        <XAxis dataKey="fecha" tick={{ fill: '#B8C5DA', fontSize: 11 }} tickMargin={8} />
        <YAxis hide />
        <Tooltip formatter={(value) => money(Number(value))} contentStyle={CHART_TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="total_vendido" stroke="var(--chart-blue)" strokeWidth={2.5} fill="url(#commercialDaily)" isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MixTable({ title, rows }: { title: string; rows: SalesBICommercialMix[] }) {
  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-4">
      <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 8).map((row) => (
          <div key={row.name} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[color:var(--text)]">{row.name}</div>
              <div className="text-xs text-[color:var(--text-3)]">{num(row.unidades)} unidades · {row.participacion_pct.toFixed(1)}%</div>
            </div>
            <div className="text-right text-sm font-black text-[color:var(--text)]">{money(row.total_vendido)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-[color:var(--text-3)]">Sin datos.</div>}
      </div>
    </section>
  );
}

export function SalesBICommercialPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const kind = kindFromPath(location.pathname);
  const meta = KIND_META[kind];
  const [options, setOptions] = useState<SalesBICommercialOptions | null>(null);
  const [report, setReport] = useState<SalesBICommercialReport | null>(null);
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

  useEffect(() => {
    fetchSalesBICommercialOptions()
      .then((data) => {
        setOptions(data);
        setFechaDesde((prev) => prev || data.period_start || '');
        setFechaHasta((prev) => prev || data.period_end || '');
      })
      .catch(() => setOptions({ period_start: '', period_end: '', marcas: [], tipos: [], sucursales: [], empresas: [], tipo_ventas: ['local', 'online'] }));
  }, []);

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
      const data = await fetchSalesBICommercialReport(kind, params);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el informe comercial.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function handleExport(type: 'pdf' | 'xlsx') {
    if (!report) return;
    setExporting(type);
    try {
      const payload = { ...params, kind, presentation, titulo: meta.title };
      const blob = type === 'pdf' ? await exportSalesBICommercialPdf(payload) : await exportSalesBICommercialXlsx(payload);
      downloadBlob(blob, `bi-comercial-${kind}.${type === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el informe.');
    } finally {
      setExporting(null);
    }
  }

  const tabs = [
    { value: 'brands', label: 'Marcas', icon: <Tags size={14} /> },
    { value: 'lines', label: 'Lineas', icon: <Layers3 size={14} /> },
    { value: 'branches', label: 'Sucursales', icon: <Building2 size={14} /> },
  ];

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
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-[color:var(--text)] hover:bg-white/10"
            >
              <FileSpreadsheet size={16} />
              Importar
            </button>
          )}
          {can('sales_bi.export') && (
            <>
              <button type="button" onClick={() => handleExport('pdf')} disabled={!report || !!exporting} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-[color:var(--text)] hover:bg-white/10 disabled:opacity-40">
                {exporting === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                PDF
              </button>
              <button type="button" onClick={() => handleExport('xlsx')} disabled={!report || !!exporting} className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-3 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40">
                {exporting === 'xlsx' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Excel
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={kind} onValueChange={(value) => navigate(`/ventas-bi/${value === 'brands' ? 'marcas' : value === 'lines' ? 'lineas' : 'sucursales'}`)} tabs={tabs} />
        <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-[color:var(--text-2)]">
          <input type="checkbox" checked={presentation} onChange={(e) => setPresentation(e.target.checked)} className="accent-blue-500" />
          Modo presentacion
        </label>
      </div>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Desde"><input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className={inputClass} /></Field>
          <Field label="Hasta"><input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className={inputClass} /></Field>
          <Field label="Sucursal"><select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className={inputClass}><option value="">Todas</option>{options?.sucursales.map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
          <Field label="Tipo venta"><select value={tipoVenta} onChange={(e) => setTipoVenta(e.target.value)} className={inputClass}><option value="">Ambos</option><option value="local">Local</option><option value="online">Online</option></select></Field>
          <Field label="Marca"><select value={marca} onChange={(e) => setMarca(e.target.value)} className={inputClass}><option value="">Todas</option>{options?.marcas.map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
          <Field label="Linea"><select value={linea} onChange={(e) => setLinea(e.target.value)} className={inputClass}><option value="">Todas</option>{options?.tipos.map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={loadReport} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Aplicar
          </button>
          <button type="button" onClick={() => { setSucursal(''); setTipoVenta(''); setMarca(''); setLinea(''); }} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-[color:var(--text-2)] hover:bg-white/10 hover:text-white">
            Limpiar
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {loading && !report ? (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-[color:var(--text-2)]">
          <Loader2 size={18} className="animate-spin" />
          Cargando informe comercial...
        </div>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="Vendido" value={report.totals.total_vendido} format={money} accent="blue" />
            <KpiCard label="Unidades" value={report.totals.unidades} format={num} accent="teal" />
            <KpiCard label="Lineas" value={report.totals.lineas} format={num} accent="violet" />
            <KpiCard label="Productos" value={report.totals.productos} format={num} accent="amber" />
            <KpiCard label="PVP promedio" value={report.totals.pvp_promedio} format={money} accent="positive" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <ChartCard title="Evolucion diaria" subtitle={`${report.filters.fecha_desde} al ${report.filters.fecha_hasta}`}>
              <DailyArea report={report} />
            </ChartCard>
            <ChartCard title={`Ranking de ${meta.label.toLowerCase()}`} subtitle="Ordenado por vendido">
              <RankingBars data={report.ranking} color={meta.color} />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <MixTable title="Mix por marca" rows={report.brand_mix} />
            <MixTable title="Mix por linea" rows={report.line_mix} />
            <MixTable title="Mix por sucursal" rows={report.branch_mix} />
          </div>

          {kind === 'branches' && !report.presentation && (report.opportunities?.length || 0) > 0 && (
            <ChartCard title="Oportunidades internas" subtitle="Lineas que pesan menos en una sucursal contra el consolidado">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {report.opportunities!.slice(0, 6).map((item) => (
                  <div key={`${item.sucursal}-${item.tipo_producto}`} className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                    <div className="text-sm font-black text-amber-100">{item.sucursal}</div>
                    <div className="mt-1 text-lg font-black text-[color:var(--text)]">{item.tipo_producto}</div>
                    <div className="mt-2 text-xs text-amber-100/80">
                      Sucursal {item.participacion_sucursal.toFixed(1)}% vs empresa {item.participacion_empresa.toFixed(1)}%.
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>
          )}

          <ChartCard title="Top productos" subtitle="Productos con mayor PVP vendido">
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
                  </tr>
                </thead>
                <tbody>
                  {report.top_products.slice(0, 16).map((product) => (
                    <tr key={`${product.sku}-${product.producto}`} className="border-t border-white/5">
                      <td className="px-3 py-3 font-mono text-xs text-[color:var(--text-2)]">{product.sku || '-'}</td>
                      <td className="max-w-[460px] px-3 py-3 font-bold text-[color:var(--text)]">{product.producto}</td>
                      <td className="px-3 py-3 text-[color:var(--text-2)]">{product.marca}</td>
                      <td className="px-3 py-3 text-[color:var(--text-2)]">{product.tipo_producto}</td>
                      <td className="px-3 py-3 text-right text-[color:var(--text-2)]">{num(product.unidades)}</td>
                      <td className="px-3 py-3 text-right font-black text-[color:var(--text)]">{money(product.total_vendido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {kind === 'brands' && (report.compare_candidates?.length || 0) > 0 && (
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
          )}
        </>
      ) : null}
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
