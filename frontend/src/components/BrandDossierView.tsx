/**
 * Informe de marca — "dashboard como presentación".
 *
 * Vista pensada para sentarse frente a un proveedor (ej. Samsung): 8 secciones
 * numeradas que cuentan la historia de la marca en ElectroGV, cada una
 * exportable 1:1 como slide de PowerPoint o página de PDF (tal como se ve).
 *
 * Seguridad: el backend NUNCA envía costos ni márgenes en este informe.
 */
import { CheckCircle2, FileDown, Loader2, Presentation, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fetchSalesBIBrandDossier } from '../api/client';
import type { SalesBIBrandDossier, SalesBICommercialMix } from '../types';
import {
  CHART_ANIM, CHART_TOOLTIP_ITEM_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE,
  DeltaPill, EmptyChartState, KpiCard, ParticipationBar, cn, money, num,
} from './SalesBIWidgets';
import { exportDeckToPdf, exportDeckToPptx, type DeckSection } from '../lib/exportDeck';

const BRAND_COLOR = 'var(--chart-blue)';
const POSITIVE = 'var(--chart-positive)';
const MARKET_COLOR = '#64748b';
const COMP_COLORS = ['var(--chart-violet)', 'var(--chart-teal)', 'var(--chart-amber)'];

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function monthLabel(mes: string) {
  const [year, month] = mes.split('-').map(Number);
  return `${MESES_CORTOS[(month || 1) - 1]} ${String(year || 0).slice(2)}`;
}

function weekLabel(iso: string) {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

function fmtDate(iso: string) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function compactMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}MM`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

const SLIDE_TITLES = [
  'Resumen ejecutivo',
  'Evolución de ventas',
  'Posición competitiva',
  'Participación por categoría',
  'Tipos de producto',
  'Productos destacados',
  'Presencia por sucursal',
  'Posicionamiento de precio',
];

function Slide({
  index, title, subtitle, children, refCb,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  refCb: (el: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={refCb}
      className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-5 backdrop-blur sm:p-6"
    >
      <header className="flex items-baseline gap-3">
        <span className="text-[13px] font-black tabular-nums text-[color:var(--chart-blue)]">{String(index).padStart(2, '0')}</span>
        <div>
          <h2 className="text-[15px] font-black uppercase tracking-[0.14em] text-[color:var(--text)]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-[color:var(--text-3)]">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function BrandDossierView({
  brands, initialMarca, fechaDesde, fechaHasta, sucursal, tipoVenta,
}: {
  brands: SalesBICommercialMix[];
  initialMarca?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  sucursal?: string;
  tipoVenta?: string;
}) {
  const brandNames = useMemo(() => brands.map((b) => b.name), [brands]);
  const [marca, setMarca] = useState(initialMarca || brandNames[0] || '');
  const [competidores, setCompetidores] = useState<string[]>([]);
  const [dossier, setDossier] = useState<SalesBIBrandDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'ppt' | 'pdf' | null>(null);
  const [exportProgress, setExportProgress] = useState('');

  const slideRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (!marca && brandNames.length) setMarca(brandNames[0]);
  }, [marca, brandNames]);

  useEffect(() => {
    if (!marca) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSalesBIBrandDossier({
      marca,
      fecha_desde: fechaDesde || undefined,
      fecha_hasta: fechaHasta || undefined,
      sucursal: sucursal || undefined,
      tipo_venta: tipoVenta || undefined,
      competidores: competidores.length ? competidores.join(',') : undefined,
    })
      .then((data) => { if (!cancelled) setDossier(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el informe'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [marca, fechaDesde, fechaHasta, sucursal, tipoVenta, competidores]);

  // ── Series derivadas ──────────────────────────────────────────────────
  const useMonthly = (dossier?.monthly_series.length || 0) >= 3;
  const evolucion = useMemo(() => {
    if (!dossier) return [];
    if (useMonthly) {
      return dossier.monthly_series.map((m) => ({
        label: monthLabel(m.mes),
        brand_pvp: m.brand_pvp,
        brand_unidades: m.brand_unidades,
        share_pvp_pct: m.share_pvp_pct,
      }));
    }
    return dossier.weekly_series.map((w) => ({
      label: weekLabel(w.semana),
      brand_pvp: w.brand_pvp,
      brand_unidades: w.brand_unidades,
      share_pvp_pct: w.share_pvp_pct,
    }));
  }, [dossier, useMonthly]);

  const compList = dossier?.filters.competidores || [];
  const competencia = useMemo(() => {
    if (!dossier) return [];
    return dossier.monthly_series.map((m) => {
      const row: Record<string, number | string> = { label: monthLabel(m.mes) };
      row[dossier.marca] = m.brand_pvp;
      compList.forEach((c) => { row[c] = m.competidores[c]?.total_vendido ?? 0; });
      return row;
    });
  }, [dossier, compList]);

  const categorias = useMemo(() => (dossier?.categories || []).filter((c) => c.market_pvp > 0), [dossier]);
  const donut = useMemo(
    () => categorias.filter((c) => c.brand_pvp > 0).map((c) => ({ name: c.categoria, value: c.brand_pvp })),
    [categorias],
  );
  const precios = useMemo(
    () => categorias.filter((c) => c.brand_avg_pvp > 0).map((c) => ({
      categoria: c.categoria,
      index: c.price_index,
      brand_avg: c.brand_avg_pvp,
      market_avg: c.market_avg_pvp,
    })),
    [categorias],
  );

  const hasPrev = !!dossier && (dossier.totals.brand_prev.unidades > 0 || dossier.totals.market_prev.unidades > 0);

  // ── Export ────────────────────────────────────────────────────────────
  async function handleExport(kind: 'ppt' | 'pdf') {
    if (!dossier || exporting) return;
    const sections: DeckSection[] = slideRefs.current
      .map((node, i) => (node ? { node, title: `${String(i + 1).padStart(2, '0')} · ${SLIDE_TITLES[i]}` } : null))
      .filter((s): s is DeckSection => !!s);
    if (!sections.length) return;
    setExporting(kind);
    setExportProgress('Preparando...');
    const meta = {
      title: dossier.marca,
      subtitle: 'Informe comercial · ElectroGV',
      period: `${fmtDate(dossier.filters.fecha_desde)} – ${fmtDate(dossier.filters.fecha_hasta)}`,
      footer: 'Fuente: Ventas vs. Costos · ElectroGV · Documento confidencial',
      fileName: `informe-${dossier.marca.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dossier.filters.fecha_desde}`,
    };
    const onProgress = (done: number, total: number) => setExportProgress(`Slide ${done}/${total}`);
    try {
      if (kind === 'ppt') await exportDeckToPptx(meta, sections, onProgress);
      else await exportDeckToPdf(meta, sections, onProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el informe');
    } finally {
      setExporting(null);
      setExportProgress('');
    }
  }

  function toggleCompetidor(name: string) {
    setCompetidores((current) => {
      if (current.includes(name)) return current.filter((c) => c !== name);
      if (current.length >= 3) return [...current.slice(1), name];
      return [...current, name];
    });
  }

  const refCb = (index: number) => (el: HTMLElement | null) => { slideRefs.current[index] = el; };

  if (!brandNames.length) {
    return <EmptyChartState minHeight={320} description="Importa datos comerciales para armar el informe de marca." />;
  }

  const share = dossier?.share;
  const brandTot = dossier?.totals.brand;
  const marketTot = dossier?.totals.market;

  return (
    <div className="space-y-4">
      {/* ── Controles del informe (no se exportan) ─────────────────── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-4 backdrop-blur lg:flex-row lg:items-center lg:justify-between" data-export-skip="true">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Marca</span>
            <select
              value={marca}
              onChange={(e) => { setCompetidores([]); setMarca(e.target.value); }}
              className="h-10 rounded-xl border border-white/15 bg-slate-950/40 px-3 text-sm font-bold text-white outline-none focus:border-[color:var(--chart-blue)]"
            >
              {brandNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">vs</span>
            {compList.map((name, i) => (
              <button
                key={name}
                type="button"
                onClick={() => toggleCompetidor(name)}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold text-white"
                style={{ borderColor: COMP_COLORS[i % COMP_COLORS.length], background: 'rgba(255,255,255,0.04)' }}
                title="Quitar competidor"
              >
                {name} <X size={11} />
              </button>
            ))}
            <select
              value=""
              onChange={(e) => { if (e.target.value) toggleCompetidor(e.target.value); }}
              className="h-8 rounded-full border border-white/15 bg-slate-950/40 px-2 text-xs font-bold text-[color:var(--text-2)] outline-none"
              title="Agregar competidor"
            >
              <option value="">+ competidor</option>
              {(dossier?.ranking || brands).filter((b) => b.name !== marca && !compList.includes(b.name)).slice(0, 20).map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
            <ShieldCheck size={12} /> Sin costos ni márgenes
          </span>
          <button
            type="button"
            onClick={() => handleExport('ppt')}
            disabled={!dossier || !!exporting}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-3.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40"
          >
            {exporting === 'ppt' ? <Loader2 size={16} className="animate-spin" /> : <Presentation size={16} />}
            {exporting === 'ppt' ? exportProgress : 'PowerPoint'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={!dossier || !!exporting}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3.5 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-40"
          >
            {exporting === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            {exporting === 'pdf' ? exportProgress : 'PDF'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {loading && !dossier && (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-[color:var(--text-2)]">
          <Loader2 size={18} className="animate-spin" /> Armando informe de {marca}...
        </div>
      )}

      {dossier && share && brandTot && marketTot && (
        <div className={cn('space-y-4', loading && 'opacity-60')}>
          {/* 01 · Resumen ejecutivo */}
          <Slide index={1} title={SLIDE_TITLES[0]} subtitle={`${dossier.marca} en ElectroGV · ${fmtDate(dossier.filters.fecha_desde)} al ${fmtDate(dossier.filters.fecha_hasta)}`} refCb={refCb(0)}>
            <div className="grid gap-4 lg:grid-cols-[1.1fr_2fr]">
              <div className="space-y-5 rounded-2xl bg-white/[0.03] p-4">
                <ParticipationBar
                  label="Participación de mercado"
                  value={share.pvp_pct}
                  color={BRAND_COLOR}
                  subtitle={hasPrev ? `${share.delta_pts >= 0 ? '+' : ''}${share.delta_pts.toFixed(1)} pts vs período anterior` : `${money(marketTot.total_vendido)} de mercado`}
                />
                <div className="flex items-end gap-3">
                  <span className="text-5xl font-black text-[color:var(--chart-positive)]">#{share.rank_pvp ?? '—'}</span>
                  <div className="pb-1 text-xs leading-5 text-[color:var(--text-3)]">
                    de {share.total_brands} marcas por facturación
                    {hasPrev && share.rank_prev && share.rank_prev !== share.rank_pvp && (
                      <div>venía de #{share.rank_prev}</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <KpiCard label="Unidades" value={brandTot.unidades} prev={hasPrev ? dossier.totals.brand_prev.unidades : undefined} format={num} accent="teal" />
                <KpiCard label="Facturación" value={brandTot.total_vendido} prev={hasPrev ? dossier.totals.brand_prev.total_vendido : undefined} format={money} accent="blue" />
                <KpiCard label="PVP promedio" value={brandTot.pvp_promedio} format={money} accent="violet" note={`Mercado: ${money(marketTot.pvp_promedio)}`} />
                <KpiCard label="SKUs vendidos" value={brandTot.productos} format={num} accent="amber" />
                <KpiCard label="Share en unidades" value={share.units_pct} format={(v) => `${v.toFixed(1)}%`} accent="positive" />
                <KpiCard label="Índice de precio" value={dossier.price_index_global} format={(v) => v.toFixed(0)} accent={dossier.price_index_global >= 100 ? 'violet' : 'teal'} note="100 = precio promedio del mercado" />
              </div>
            </div>
            {dossier.highlights.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {dossier.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm text-[color:var(--text-2)]">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[color:var(--chart-positive)]" />
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </Slide>

          {/* 02 · Evolución */}
          <Slide index={2} title={SLIDE_TITLES[1]} subtitle={useMonthly ? 'Evolución mensual: facturación y share de mercado' : 'Evolución semanal: facturación y share de mercado'} refCb={refCb(1)}>
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Facturación y share %</div>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={evolucion} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis yAxisId="pvp" tickFormatter={compactMoney} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={52} />
                    <YAxis yAxisId="share" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={38} />
                    <Tooltip
                      formatter={(value, name) => (name === 'Share %' ? [`${Number(value).toFixed(1)}%`, name] : [money(Number(value)), name])}
                      contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="pvp" dataKey="brand_pvp" name="Facturación" fill={BRAND_COLOR} radius={[6, 6, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} />
                    <Line yAxisId="share" dataKey="share_pvp_pct" name="Share %" stroke={POSITIVE} strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Unidades vendidas</div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={evolucion} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#B8C5DA', fontSize: 10 }} width={44} />
                    <Tooltip formatter={(value) => [num(Number(value)), 'Unidades']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Bar dataKey="brand_unidades" name="Unidades" fill="var(--chart-teal)" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                      <LabelList dataKey="brand_unidades" position="top" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => num(Number(v))} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Slide>

          {/* 03 · Posición competitiva */}
          <Slide index={3} title={SLIDE_TITLES[2]} subtitle={`Ranking de marcas y evolución vs ${compList.join(', ') || 'competidores'}`} refCb={refCb(2)}>
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Ranking por facturación (top {dossier.ranking.length})</div>
                <ResponsiveContainer width="100%" height={Math.max(280, dossier.ranking.length * 26)}>
                  <BarChart data={dossier.ranking} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(value) => [money(Number(value)), 'Facturación']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                    <Bar dataKey="total_vendido" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                      {dossier.ranking.map((row) => (
                        <Cell
                          key={row.name}
                          fill={row.is_brand ? BRAND_COLOR : row.is_competitor ? COMP_COLORS[compList.indexOf(row.name) % COMP_COLORS.length] : 'rgba(148,163,184,0.45)'}
                        />
                      ))}
                      <LabelList dataKey="participacion_pct" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Facturación mensual: {dossier.marca} vs competidores</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={competencia} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis tickFormatter={compactMoney} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={52} />
                    <Tooltip formatter={(value, name) => [money(Number(value)), String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line dataKey={dossier.marca} stroke={BRAND_COLOR} strokeWidth={3} dot={{ r: 3.5 }} />
                    {compList.map((c, i) => (
                      <Line key={c} dataKey={c} stroke={COMP_COLORS[i % COMP_COLORS.length]} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2.5 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Slide>

          {/* 04 · Categorías */}
          <Slide index={4} title={SLIDE_TITLES[3]} subtitle="Share de la marca dentro de cada categoría y mix propio" refCb={refCb(3)}>
            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="space-y-2.5">
                {categorias.map((c) => {
                  const width = Math.max(3, Math.min(100, c.share_pvp_pct));
                  const leaderWidth = Math.max(3, Math.min(100, c.leader_share_pct));
                  return (
                    <div key={c.categoria} className="rounded-xl bg-white/[0.03] px-3.5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-black text-[color:var(--text)]">{c.categoria}</span>
                          <span className="text-[11px] text-[color:var(--text-3)]">
                            #{c.rank_in_categoria ?? '—'} de {c.marcas_en_categoria}
                            {c.rank_in_categoria === 1 ? ' · líder' : c.leader_name ? ` · líder: ${c.leader_name} (${c.leader_share_pct.toFixed(1)}%)` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasPrev && <DeltaPill value={c.share_delta_pts} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} pts`} />}
                          <span className="text-sm font-black tabular-nums text-[color:var(--text)]">{c.share_pvp_pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: `${leaderWidth}%`, background: MARKET_COLOR }} />
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${width}%`, background: BRAND_COLOR }} />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[11px] text-[color:var(--text-3)]">
                        <span>{num(c.brand_unidades)} u · {money(c.brand_pvp)}</span>
                        <span>{c.brand_mix_pct.toFixed(1)}% de las ventas de {dossier.marca}</span>
                      </div>
                    </div>
                  );
                })}
                {categorias.length === 0 && <EmptyChartState minHeight={200} />}
              </div>
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Mix de ventas de {dossier.marca}</div>
                {donut.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={donut} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={3} stroke="none">
                        {donut.map((entry, i) => (
                          <Cell key={entry.name} fill={[BRAND_COLOR, 'var(--chart-violet)', 'var(--chart-teal)', 'var(--chart-amber)', '#ec4899', '#64748b'][i % 6]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [money(Number(value)), String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChartState minHeight={280} />}
              </div>
            </div>
          </Slide>

          {/* 05 · Tipos */}
          <Slide index={5} title={SLIDE_TITLES[4]} subtitle={`En qué tipos de producto juega ${dossier.marca} y cuánto pesa en cada uno`} refCb={refCb(4)}>
            {dossier.tipos_top.length ? (
              <ResponsiveContainer width="100%" height={Math.max(280, dossier.tipos_top.length * 30)}>
                <BarChart data={dossier.tipos_top} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="tipo" width={150} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                  <Tooltip
                    formatter={(value, name) => (name === 'Share en el tipo' ? [`${Number(value).toFixed(1)}%`, name] : [money(Number(value)), 'Facturación'])}
                    contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                    cursor={{ fill: 'rgba(96,165,250,0.10)' }}
                  />
                  <Bar dataKey="total_vendido" name="Facturación" fill={BRAND_COLOR} radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                    <LabelList dataKey="share_pvp_pct" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(1)}% del tipo`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState minHeight={240} />}
          </Slide>

          {/* 06 · Productos */}
          <Slide index={6} title={SLIDE_TITLES[5]} subtitle={`Top ${dossier.top_products.length} productos por facturación`} refCb={refCb(5)}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-[color:var(--text-3)]">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-right">Unidades</th>
                    <th className="px-3 py-2 text-right">Facturación</th>
                    <th className="px-3 py-2 text-right">PVP prom.</th>
                    <th className="px-3 py-2 text-right">% marca</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.top_products.map((p, i) => (
                    <tr key={`${p.sku}-${i}`} className="border-t border-white/5">
                      <td className="px-3 py-2 text-[color:var(--text-3)]">{i + 1}</td>
                      <td className="max-w-[380px] truncate px-3 py-2 font-bold text-[color:var(--text)]">{p.producto}</td>
                      <td className="px-3 py-2 text-[color:var(--text-2)]">{p.tipo_producto}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(p.unidades)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.total_vendido)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-2)]">{money(p.pvp_promedio)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-2)]">{(p.participacion_pct || 0).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Slide>

          {/* 07 · Sucursales */}
          <Slide index={7} title={SLIDE_TITLES[6]} subtitle={`Peso de ${dossier.marca} dentro de cada sucursal`} refCb={refCb(6)}>
            <div className="grid gap-4 xl:grid-cols-2">
              <ResponsiveContainer width="100%" height={Math.max(240, dossier.branches.length * 40)}>
                <BarChart data={dossier.branches} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="sucursal" width={120} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Share en la sucursal']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                  <Bar dataKey="share_in_branch_pct" fill="var(--chart-teal)" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                    <LabelList dataKey="share_in_branch_pct" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {dossier.branches.map((b) => (
                  <div key={b.sucursal} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                    <div>
                      <div className="text-sm font-black text-[color:var(--text)]">{b.sucursal}</div>
                      <div className="text-[11px] text-[color:var(--text-3)]">{num(b.brand_unidades)} u · {b.brand_mix_pct.toFixed(1)}% de las ventas de la marca</div>
                    </div>
                    <div className="text-right text-sm font-black tabular-nums text-[color:var(--text)]">{money(b.brand_pvp)}</div>
                  </div>
                ))}
              </div>
            </div>
          </Slide>

          {/* 08 · Precios */}
          <Slide index={8} title={SLIDE_TITLES[7]} subtitle="Índice de precio por categoría (100 = precio promedio del mercado)" refCb={refCb(7)}>
            <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
              {precios.length ? (
                <ResponsiveContainer width="100%" height={Math.max(240, precios.length * 44)}>
                  <BarChart data={precios} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" domain={[0, (dataMax: number) => Math.max(140, Math.ceil(dataMax * 1.1))]} tick={{ fill: '#B8C5DA', fontSize: 10 }} />
                    <YAxis type="category" dataKey="categoria" width={130} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                    <Tooltip
                      formatter={(value, _name, entry) => {
                        const row = entry?.payload as { brand_avg: number; market_avg: number } | undefined;
                        return [`Índice ${Number(value).toFixed(0)} · marca ${money(row?.brand_avg || 0)} vs mercado ${money(row?.market_avg || 0)}`, ''];
                      }}
                      contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                      cursor={{ fill: 'rgba(96,165,250,0.10)' }}
                    />
                    <ReferenceLine x={100} stroke="#94a3b8" strokeDasharray="4 3" label={{ value: 'Mercado', fill: '#94a3b8', fontSize: 10, position: 'top' }} />
                    <Bar dataKey="index" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                      {precios.map((p) => (
                        <Cell key={p.categoria} fill={p.index >= 100 ? 'var(--chart-violet)' : 'var(--chart-teal)'} />
                      ))}
                      <LabelList dataKey="index" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => Number(v).toFixed(0)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChartState minHeight={240} />}
              <div className="space-y-3">
                <div className="rounded-2xl bg-white/[0.03] p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Índice global</div>
                  <div className="mt-1 text-4xl font-black tabular-nums" style={{ color: dossier.price_index_global >= 100 ? 'var(--chart-violet)' : 'var(--chart-teal)' }}>
                    {dossier.price_index_global.toFixed(0)}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[color:var(--text-3)]">
                    {dossier.price_index_global >= 100
                      ? `${dossier.marca} vende en promedio ${(dossier.price_index_global - 100).toFixed(0)}% por encima del precio de mercado de sus categorías: posicionamiento premium.`
                      : `${dossier.marca} vende en promedio ${(100 - dossier.price_index_global).toFixed(0)}% por debajo del precio de mercado de sus categorías.`}
                  </p>
                </div>
                <p className="text-[11px] leading-5 text-[color:var(--text-3)]">
                  Índice ponderado por la facturación de la marca en cada categoría. Violeta = sobre el mercado · turquesa = bajo el mercado.
                </p>
              </div>
            </div>
          </Slide>

          <p className="pb-2 text-center text-[11px] text-[color:var(--text-3)]">
            Fuente: {dossier.source} · Período {fmtDate(dossier.filters.fecha_desde)} – {fmtDate(dossier.filters.fecha_hasta)} · Sin medios de pago, señas, costos ni márgenes.
          </p>
        </div>
      )}
    </div>
  );
}
