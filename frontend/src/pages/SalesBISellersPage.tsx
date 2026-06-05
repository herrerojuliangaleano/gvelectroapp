import {
  AlertTriangle, BarChart2, CalendarDays, Download, FileSpreadsheet, Link2,
  Loader2, RefreshCw, Search, TrendingUp, Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  can,
  createSalesBIProductAlias,
  exportSalesBISellersPdf,
  exportSalesBISellersXlsx,
  fetchSalesBISellersCompare,
  fetchSalesBISellersReport,
  fetchSalesBIUnmatchedProducts,
  rematchSalesBIImport,
  searchProducts,
} from '../api/client';
import type {
  ProductInfo,
  SalesBICompareMetric,
  SalesBISellersCompare,
  SalesBISellersReport,
  SalesBIUnmatchedProduct,
} from '../types';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const COLORS = ['#3B82F6', '#14B8A6', '#F59E0B', '#A855F7', '#EF4444', '#22C55E', '#06B6D4'];
const SUCURSALES = ['Caseros', 'Canning', 'Norcenter', 'Lanus'];

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthStart(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function previousRange(desde: string, hasta: string) {
  const d1 = new Date(`${desde}T00:00:00`);
  const d2 = new Date(`${hasta}T00:00:00`);
  const days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
  return { desde: iso(addDays(d1, -days)), hasta: iso(addDays(d1, -1)) };
}

function money(n?: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
}

function num(n?: number) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
}

function pct(n?: number | null) {
  if (n === null || n === undefined) return '-';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
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

function Kpi({ label, value, tone = 'blue' }: { label: string; value: string; tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet' }) {
  const tones = {
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    red: 'border-red-500/30 bg-red-500/10 text-red-200',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-white/45">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function DeltaBadge({ metric }: { metric?: SalesBICompareMetric }) {
  if (!metric) return <span className="text-white/30">-</span>;
  const up = (metric.delta || 0) >= 0;
  return <span className={up ? 'text-emerald-300' : 'text-red-300'}>{money(metric.delta)} · {pct(metric.delta_pct)}</span>;
}

function ChartPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-white/70">{title}</h2>
      <div className="h-64 min-w-0">{children}</div>
    </section>
  );
}

function UnmatchedPanel({ range }: { range: { desde: string; hasta: string; sucursal: string; tipo: string } }) {
  const [items, setItems] = useState<SalesBIUnmatchedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<SalesBIUnmatchedProduct | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [linking, setLinking] = useState(false);
  const canManageAliases = can('sales_bi.aliases.manage');

  async function load() {
    setLoading(true);
    try {
      const res = await fetchSalesBIUnmatchedProducts({
        fecha_desde: range.desde,
        fecha_hasta: range.hasta,
        sucursal: range.sucursal || undefined,
        tipo: range.tipo || undefined,
        q: q || undefined,
        limit: 80,
      });
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [range.desde, range.hasta, range.sucursal, range.tipo]);

  async function runSearch() {
    const trimmed = productQuery.trim() || selected?.producto || selected?.sku || '';
    if (!trimmed) return;
    setProducts(await searchProducts(trimmed, 12));
  }

  async function linkProduct(product: ProductInfo) {
    if (!selected) return;
    setLinking(true);
    try {
      await createSalesBIProductAlias({
        product_id: product.id,
        alias_sku: selected.sku,
        alias_desc: selected.producto,
      });
      for (const id of selected.import_ids) {
        await rematchSalesBIImport(id);
      }
      setSelected(null);
      setProductQuery('');
      setProducts([]);
      await load();
    } finally {
      setLinking(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-white"><AlertTriangle size={17} className="text-amber-300" /> Productos sin vincular</h2>
          <p className="mt-1 text-xs text-white/45">Usa aliases propios de Sales BI. Al vincular, se rematchean las importaciones afectadas.</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU o producto" className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-400 sm:w-56" />
          <button onClick={load} className="rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-white hover:bg-white/10">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {items.length === 0 && <div className="rounded-xl border border-dashed border-white/15 p-5 text-center text-sm text-white/45">No hay productos sin vincular para el rango.</div>}
        {items.slice(0, 8).map((item) => (
          <button
            key={`${item.sku_normalized}-${item.descripcion_normalized}`}
            onClick={() => { if (canManageAliases) { setSelected(item); setProductQuery(item.producto || item.sku); } }}
            className="rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-amber-400/50 hover:bg-amber-500/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-black text-white">{item.producto || 'Sin descripcion'}</div>
                <div className="mt-1 font-mono text-xs text-white/50">{item.sku || '-'}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-amber-200">
                {num(item.unidades)} u.<br />{money(item.total_cobrado)}
              </div>
            </div>
            <div className="mt-2 text-xs text-white/40">{item.sucursales.join(', ')} · {item.first_fecha} al {item.last_fecha}</div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0f172a] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">Vincular producto</h3>
                <p className="mt-1 text-sm text-white/55">{selected.producto}</p>
                <p className="mt-1 font-mono text-xs text-white/35">{selected.sku}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg px-2 py-1 text-white/50 hover:bg-white/10">Cerrar</button>
            </div>
            <div className="mt-4 flex gap-2">
              <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} className="flex-1 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" />
              <button onClick={runSearch} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">Buscar</button>
            </div>
            <div className="mt-4 max-h-80 space-y-2 overflow-auto">
              {products.map((p) => (
                <button key={p.id} onClick={() => linkProduct(p)} disabled={linking} className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left hover:border-blue-400/50">
                  <div className="font-black text-white">{p.descripcion}</div>
                  <div className="mt-1 text-xs text-white/50">{p.marca} · {p.tipo} · <span className="font-mono">{p.sku}</span></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function SalesBISellersPage() {
  const now = new Date();
  const [desde, setDesde] = useState(iso(monthStart(now)));
  const [hasta, setHasta] = useState(iso(now));
  const initialCompare = previousRange(iso(monthStart(now)), iso(now));
  const [compareDesde, setCompareDesde] = useState(initialCompare.desde);
  const [compareHasta, setCompareHasta] = useState(initialCompare.hasta);
  const [sucursal, setSucursal] = useState('');
  const [tipo, setTipo] = useState('');
  const [selectedSellers, setSelectedSellers] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<SalesBISellersReport | null>(null);
  const [compare, setCompare] = useState<SalesBISellersCompare | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  const vendedoresParam = [...selectedSellers].join(',');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [rep, comp] = await Promise.all([
        fetchSalesBISellersReport({ fecha_desde: desde, fecha_hasta: hasta, sucursal: sucursal || undefined, tipo: tipo || undefined, vendedores: vendedoresParam || undefined }),
        fetchSalesBISellersCompare({ base_desde: desde, base_hasta: hasta, compare_desde: compareDesde, compare_hasta: compareHasta, sucursal: sucursal || undefined, tipo: tipo || undefined, vendedores: vendedoresParam || undefined }),
      ]);
      setReport(rep);
      setCompare(comp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el informe.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const sellerOptions = useMemo(() => report?.sellers ?? [], [report]);

  function applyPreset(kind: string) {
    const today = new Date();
    let d1 = today;
    let d2 = today;
    if (kind === 'yesterday') d1 = d2 = addDays(today, -1);
    if (kind === 'week') d1 = addDays(today, -((today.getDay() + 6) % 7));
    if (kind === 'prev-week') {
      const start = addDays(today, -((today.getDay() + 6) % 7) - 7);
      d1 = start; d2 = addDays(start, 6);
    }
    if (kind === 'month') d1 = monthStart(today);
    if (kind === 'prev-month') {
      d1 = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      d2 = new Date(today.getFullYear(), today.getMonth(), 0);
    }
    if (kind === '30') d1 = addDays(today, -29);
    setDesde(iso(d1));
    setHasta(iso(d2));
    const prev = previousRange(iso(d1), iso(d2));
    setCompareDesde(prev.desde);
    setCompareHasta(prev.hasta);
  }

  async function exportFile(kind: 'pdf' | 'xlsx') {
    if (!report) return;
    setExporting(kind);
    try {
      const payload = {
        fecha_desde: desde,
        fecha_hasta: hasta,
        sucursal: sucursal || undefined,
        tipo: tipo || undefined,
        vendedores: [...selectedSellers],
        compare_desde: compareDesde,
        compare_hasta: compareHasta,
        titulo: 'Informe de vendedores',
        logo: 'GV',
      };
      const blob = kind === 'pdf' ? await exportSalesBISellersPdf(payload) : await exportSalesBISellersXlsx(payload);
      downloadBlob(blob, `informe-vendedores-${desde}-${hasta}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`);
    } finally {
      setExporting('');
    }
  }

  const totals = report?.totals;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-14">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-300"><BarChart2 size={15} /> Inteligencia comercial</div>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Métricas de vendedores</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/55">Análisis por rango, comparación entre vendedores y contra períodos anteriores.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/10">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          {can('sales_bi.export') && (
            <>
              <button onClick={() => exportFile('pdf')} disabled={!!exporting} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"><Download size={15} /> PDF</button>
              <button onClick={() => exportFile('xlsx')} disabled={!!exporting} className="flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-black text-white disabled:opacity-50"><FileSpreadsheet size={15} /> Excel</button>
            </>
          )}
        </div>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_180px_160px_auto]">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase text-white/45">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" /></label>
            <label className="text-xs font-bold uppercase text-white/45">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase text-white/45">Comparar desde<input type="date" value={compareDesde} onChange={(e) => setCompareDesde(e.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400" /></label>
            <label className="text-xs font-bold uppercase text-white/45">Comparar hasta<input type="date" value={compareHasta} onChange={(e) => setCompareHasta(e.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400" /></label>
          </div>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="rounded-xl border border-white/15 bg-[#10192b] px-3 py-2 text-sm text-white outline-none focus:border-blue-400">
            <option value="">Todas las sucursales</option>
            {SUCURSALES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-xl border border-white/15 bg-[#10192b] px-3 py-2 text-sm text-white outline-none focus:border-blue-400">
            <option value="">Local + online</option>
            <option value="local">Local</option>
            <option value="online">Online</option>
          </select>
          <button onClick={load} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white hover:bg-blue-500">Aplicar</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ['today', 'Hoy'], ['yesterday', 'Ayer'], ['week', 'Semana actual'], ['prev-week', 'Semana anterior'],
            ['month', 'Mes actual'], ['prev-month', 'Mes anterior'], ['30', 'Últimos 30 días'],
          ].map(([key, label]) => (
            <button key={key} onClick={() => applyPreset(key)} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/60 hover:border-blue-400 hover:text-white">{label}</button>
          ))}
        </div>
        {sellerOptions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="mr-1 flex items-center gap-1 text-xs font-bold uppercase text-white/40"><Users size={13} /> Vendedores</span>
            {sellerOptions.slice(0, 16).map((seller) => (
              <button
                key={seller.vendedor_normalized}
                onClick={() => setSelectedSellers((prev) => {
                  const next = new Set(prev);
                  if (next.has(seller.vendedor_normalized)) next.delete(seller.vendedor_normalized);
                  else next.add(seller.vendedor_normalized);
                  return next;
                })}
                className={`rounded-full px-3 py-1 text-xs font-bold ${selectedSellers.has(seller.vendedor_normalized) ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/65 hover:text-white'}`}
              >
                {seller.vendedor}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {loading && !report && <div className="flex items-center gap-2 text-sm text-white/50"><Loader2 size={16} className="animate-spin" /> Cargando informe...</div>}

      {report && totals && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi label="Cobrado" value={money(totals.total_cobrado)} tone="green" />
            <Kpi label="Vendido" value={money(totals.total_vendido)} />
            <Kpi label="Unidades" value={num(totals.unidades)} tone="violet" />
            <Kpi label="Tickets" value={num(totals.tickets)} />
            <Kpi label="Ticket promedio" value={money(totals.ticket_promedio)} tone="amber" />
            <Kpi label="Saldo" value={money(totals.saldo)} tone={totals.saldo > 0 ? 'red' : 'green'} />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <ChartPanel title="Evolución diaria">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={report.daily_series}>
                  <CartesianGrid stroke="#1f2a44" />
                  <XAxis dataKey="fecha" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#fff' }} />
                  <Line type="monotone" dataKey="total_cobrado" stroke="#3B82F6" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Ranking de vendedores">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.sellers.slice(0, 8)} layout="vertical">
                  <CartesianGrid stroke="#1f2a44" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="vendedor" type="category" width={88} stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#fff' }} />
                  <Bar dataKey="total_cobrado" fill="#3B82F6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Mix de pago">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={report.payment_mix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                    {report.payment_mix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#fff' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="Ventas por marca">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.brand_mix.slice(0, 10)}>
                  <CartesianGrid stroke="#1f2a44" />
                  <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#fff' }} />
                  <Bar dataKey="total_cobrado" fill="#14B8A6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Ventas por categoría">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.category_mix.slice(0, 10)}>
                  <CartesianGrid stroke="#1f2a44" />
                  <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#fff' }} />
                  <Bar dataKey="total_cobrado" fill="#A855F7" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          </section>

          {compare && (
            <section className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-base font-black text-white"><TrendingUp size={17} className="text-violet-300" /> Comparación contra período</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-white/40">Cobrado</div><div className="mt-1 font-black"><DeltaBadge metric={compare.delta.total_cobrado} /></div></div>
                <div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-white/40">Unidades</div><div className="mt-1 font-black">{num(compare.delta.unidades?.delta)} · {pct(compare.delta.unidades?.delta_pct)}</div></div>
                <div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-white/40">Tickets</div><div className="mt-1 font-black">{num(compare.delta.tickets?.delta)} · {pct(compare.delta.tickets?.delta_pct)}</div></div>
                <div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-white/40">Ticket promedio</div><div className="mt-1 font-black"><DeltaBadge metric={compare.delta.ticket_promedio} /></div></div>
              </div>
            </section>
          )}

          <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="mb-3 text-base font-black text-white">Vendedor vs vendedor</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b border-white/10 text-xs uppercase text-white/45"><th className="py-2 text-left">Vendedor</th><th className="text-right">Cobrado</th><th className="text-right">Unid.</th><th className="text-right">Tickets</th><th className="text-right">Part.</th></tr></thead>
                  <tbody>
                    {report.sellers.slice(0, 12).map((s) => (
                      <tr key={s.vendedor_normalized} className="border-b border-white/5">
                        <td className="py-2 font-bold text-white">{s.vendedor}</td>
                        <td className="text-right text-emerald-300">{money(s.total_cobrado)}</td>
                        <td className="text-right text-white/70">{num(s.unidades)}</td>
                        <td className="text-right text-white/70">{num(s.tickets)}</td>
                        <td className="text-right text-blue-300">{s.participacion_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="mb-3 text-base font-black text-white">Top productos</h2>
              <div className="space-y-2">
                {report.top_products.slice(0, 8).map((p) => (
                  <div key={`${p.sku}-${p.producto}`} className="rounded-xl bg-black/20 p-3">
                    <div className="font-black text-white">{p.producto}</div>
                    <div className="mt-1 flex justify-between gap-3 text-xs text-white/50"><span>{p.marca} · {p.sku}</span><span className="text-emerald-300">{money(p.total_cobrado)}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <UnmatchedPanel range={{ desde, hasta, sucursal, tipo }} />
        </>
      )}
    </div>
  );
}
