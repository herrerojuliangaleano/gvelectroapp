/**
 * Informe de marca — "dashboard como presentación" (joint business review).
 *
 * Vista pensada para sentarse frente a un proveedor (ej. Samsung): secciones
 * que cuentan la historia de la marca en ElectroGV, cada una
 * exportable 1:1 como slide de PowerPoint o página de PDF (tal como se ve).
 *
 * La sección Evolución permite cambiar la granularidad (día/semana/mes/
 * bimestre/trimestre) y hacer drill-down: clic en un mes → ver ese mes día a día.
 *
 * Seguridad: el backend NUNCA envía costos ni márgenes en este informe.
 */
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight, CheckCircle2, FileDown, FileSpreadsheet, Lightbulb, ListChecks,
  Image as ImageIcon, Loader2, Palette, Presentation, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  deleteSalesBIBrandLogo, downloadSalesBIBrandDossierXlsx, fetchSalesBIBrandDossier, updateSalesBIBrandStyle, uploadSalesBIBrandLogo,
} from '../api/client';
import type { SalesBIBrandDossier, SalesBICommercialMix } from '../types';
import {
  CHART_ANIM, CHART_TOOLTIP_ITEM_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE,
  DeltaPill, EmptyChartState, KpiCard, ParticipationBar, cn, money, num,
} from './SalesBIWidgets';
import { exportBrandDossierEditablePptx } from '../lib/exportBrandDossierEditable';
import { exportDeckToPdf, exportDeckToPptx, type DeckSection } from '../lib/exportDeck';

const BRAND_COLOR = 'var(--chart-blue)';
const POSITIVE = 'var(--chart-positive)';
const MARKET_COLOR = '#64748b';
const COMP_COLORS = ['var(--chart-violet)', 'var(--chart-teal)', 'var(--chart-amber)'];

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Granularity = 'daily' | 'weekly' | 'monthly' | 'bimonthly' | 'quarterly';

const GRAN_LABELS: Record<Granularity, string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
};

function monthLabel(mes: string) {
  const [year, month] = mes.split('-').map(Number);
  return `${MESES_CORTOS[(month || 1) - 1]} ${String(year || 0).slice(2)}`;
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

function bucketOf(fechaIso: string, gran: Granularity): string {
  if (gran === 'daily') return fechaIso;
  const [y, m, d] = fechaIso.split('-').map(Number);
  if (gran === 'weekly') {
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dow = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  }
  if (gran === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
  if (gran === 'bimonthly') return `${y}-B${Math.floor(((m || 1) - 1) / 2) + 1}`;
  return `${y}-T${Math.floor(((m || 1) - 1) / 3) + 1}`;
}

function bucketLabel(key: string, gran: Granularity): string {
  if (gran === 'daily' || gran === 'weekly') {
    const [, month, day] = key.split('-');
    return `${day}/${month}`;
  }
  if (gran === 'monthly') return monthLabel(key);
  const [year, tag] = key.split('-');
  const yy = String(year).slice(2);
  const n = Number(tag.slice(1));
  if (gran === 'bimonthly') {
    const a = MESES_CORTOS[(n - 1) * 2];
    const b = MESES_CORTOS[(n - 1) * 2 + 1];
    return `${a}-${b} ${yy}`;
  }
  return `T${n} ${yy}`;
}

function Slide({
  title, subtitle, takeaway, action, children, refCb,
}: {
  title: string;
  subtitle?: string;
  /** "La lectura": qué significa lo que se ve. Se exporta como parte del slide. */
  takeaway?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  refCb: (el: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={refCb}
      className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-5 backdrop-blur sm:p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black uppercase tracking-[0.14em] text-[color:var(--text)]">
            <span className="mr-2 inline-block h-[3px] w-6 translate-y-[-3px] rounded-full bg-[color:var(--chart-blue)]" />
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-[color:var(--text-3)]">{subtitle}</p>}
        </div>
        {action}
      </header>
      {takeaway && (
        <p className="rounded-r-xl border-l-2 border-[color:var(--chart-blue)] bg-[color:var(--chart-blue)]/[0.07] px-3.5 py-2 text-[13.5px] font-semibold leading-5 text-[color:var(--text)]">
          {takeaway}
        </p>
      )}
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
  const [exporting, setExporting] = useState<'ppt' | 'ppt-editable' | 'pdf' | 'xlsx' | null>(null);
  const [exportProgress, setExportProgress] = useState('');
  const [selectedTipos, setSelectedTipos] = useState<string[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);
  const [brandStyleSaving, setBrandStyleSaving] = useState(false);
  const [brandColorDraft, setBrandColorDraft] = useState('#1E3A8A');
  const [gran, setGran] = useState<Granularity>('monthly');
  const [drill, setDrill] = useState<string | null>(null);
  // Métrica del informe: solo unidades, solo pesos, o ambas (default).
  const [metric, setMetric] = useState<'units' | 'pvp' | 'both'>('both');
  const mfmt = metric === 'units' ? num : money;

  const slideRefs = useRef<Record<string, HTMLElement | null>>({});

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
      tipos: selectedTipos.length ? selectedTipos.join(',') : undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setDossier(data);
        setBrandColorDraft(data.brand_style?.primary_color || '#1E3A8A');
        setDrill(null);
        // Granularidad inicial acorde al rango.
        const from = new Date(data.filters.fecha_desde);
        const to = new Date(data.filters.fecha_hasta);
        const span = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
        setGran(span <= 45 ? 'daily' : span <= 130 ? 'weekly' : span <= 400 ? 'monthly' : 'quarterly');
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el informe'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [marca, fechaDesde, fechaHasta, sucursal, tipoVenta, competidores, selectedTipos]);

  // ── Serie de evolución con granularidad + drill-down ─────────────────
  const spanDays = useMemo(() => {
    if (!dossier) return 0;
    const from = new Date(dossier.filters.fecha_desde);
    const to = new Date(dossier.filters.fecha_hasta);
    return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  }, [dossier]);

  const granOptions = useMemo(() => {
    const opts: Granularity[] = ['daily', 'weekly', 'monthly'];
    if (spanDays >= 100) opts.push('bimonthly');
    if (spanDays >= 150) opts.push('quarterly');
    return opts;
  }, [spanDays]);

  const evolucion = useMemo(() => {
    if (!dossier) return [];
    const daily = dossier.daily_series || [];
    if (drill) {
      // Drill-down: día a día dentro del bucket seleccionado.
      return daily
        .filter((d) => bucketOf(d.fecha, gran) === drill)
        .map((d) => ({
          key: d.fecha,
          label: bucketLabel(d.fecha, 'daily'),
          brand_pvp: d.brand_pvp,
          brand_unidades: d.brand_unidades,
          share_pvp_pct: d.share_pvp_pct,
          share_units_pct: d.market_unidades ? Number(((d.brand_unidades / d.market_unidades) * 100).toFixed(2)) : 0,
        }));
    }
    const buckets = new Map<string, { brand_pvp: number; brand_unidades: number; market_pvp: number; market_unidades: number }>();
    daily.forEach((d) => {
      const k = bucketOf(d.fecha, gran);
      const acc = buckets.get(k) || { brand_pvp: 0, brand_unidades: 0, market_pvp: 0, market_unidades: 0 };
      acc.brand_pvp += d.brand_pvp;
      acc.brand_unidades += d.brand_unidades;
      acc.market_pvp += d.market_pvp;
      acc.market_unidades += d.market_unidades || 0;
      buckets.set(k, acc);
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({
        key: k,
        label: bucketLabel(k, gran),
        brand_pvp: Number(v.brand_pvp.toFixed(2)),
        brand_unidades: v.brand_unidades,
        share_pvp_pct: v.market_pvp ? Number(((v.brand_pvp / v.market_pvp) * 100).toFixed(2)) : 0,
        share_units_pct: v.market_unidades ? Number(((v.brand_unidades / v.market_unidades) * 100).toFixed(2)) : 0,
      }));
  }, [dossier, gran, drill]);

  const compList = dossier?.filters.competidores || [];
  const competencia = useMemo(() => {
    if (!dossier) return [];
    return dossier.monthly_series.map((m) => {
      const row: Record<string, number | string> = { label: monthLabel(m.mes) };
      row[dossier.marca] = metric === 'units' ? m.brand_unidades : m.brand_pvp;
      compList.forEach((c) => { row[c] = (metric === 'units' ? m.competidores[c]?.unidades : m.competidores[c]?.total_vendido) ?? 0; });
      return row;
    });
  }, [dossier, compList, metric]);

  const categorias = useMemo(() => (dossier?.categories || []).filter((c) => c.market_pvp > 0), [dossier]);
  const donut = useMemo(
    () => categorias.filter((c) => c.brand_pvp > 0).map((c) => ({ name: c.categoria, value: metric === 'units' ? c.brand_unidades : c.brand_pvp })),
    [categorias, metric],
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
  const matriz = useMemo(
    () => categorias.map((c) => ({
      categoria: c.categoria,
      mercado: metric === 'units' ? c.market_unidades : c.market_pvp,
      share: metric === 'units' ? c.share_units_pct : c.share_pvp_pct,
      facturacion: Math.max(1, metric === 'units' ? c.brand_unidades : c.brand_pvp),
    })),
    [categorias, metric],
  );

  // Share apilado semanal (marca + competidores + OTRAS).
  const shareStack = useMemo(() => {
    const src = dossier?.share_series || [];
    if (!src.length) return { rows: [] as Array<Record<string, number | string>>, names: [] as string[] };
    const names = Object.keys(src[0].values).filter((n) => n !== 'OTRAS');
    const rows = src.map((w) => ({
      label: bucketLabel(w.semana, 'weekly'),
      ...(metric === 'units' ? (w.values_units || w.values) : w.values),
    }));
    return { rows, names };
  }, [dossier, metric]);

  // Evolución por categoría (unidades de la marca), diaria o semanal según rango.
  const catEvo = useMemo(() => {
    const src = dossier?.category_daily || [];
    if (!src.length) return { rows: [] as Array<Record<string, number | string>>, cats: [] as string[], gran: 'daily' as Granularity };
    const cats = Object.keys(src[0].values);
    const granCat: Granularity = spanDays > 45 ? 'weekly' : 'daily';
    const buckets = new Map<string, Record<string, number>>();
    src.forEach((d) => {
      const k = bucketOf(d.fecha, granCat);
      const acc = buckets.get(k) || {};
      cats.forEach((c) => { acc[c] = (acc[c] || 0) + ((metric === 'pvp' ? d.values[c]?.total_vendido : d.values[c]?.unidades) || 0); });
      buckets.set(k, acc);
    });
    const rows = Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ label: bucketLabel(k, granCat), ...v }));
    return { rows, cats, gran: granCat };
  }, [dossier, spanDays, metric]);

  // Cara a cara: filas del ranking para la marca + competidores.
  const duel = useMemo(() => {
    if (!dossier) return null;
    const names = [dossier.marca, ...compList];
    const rows = names
      .map((n) => dossier.ranking.find((r) => r.name === n))
      .filter((r): r is SalesBIBrandDossier['ranking'][number] => !!r);
    return rows.length >= 2 ? rows : null;
  }, [dossier, compList]);

  const branchDuel = useMemo(() => {
    const src = dossier?.branch_compare || [];
    if (!src.length) return { rows: [] as Array<Record<string, number | string>>, names: [] as string[] };
    const names = Object.keys(src[0].values);
    const rows = src.map((b) => {
      const row: Record<string, number | string> = { sucursal: b.sucursal };
      names.forEach((n) => { row[n] = (metric === 'units' ? b.values[n]?.unidades : b.values[n]?.total_vendido) || 0; });
      return row;
    });
    return { rows, names };
  }, [dossier, metric]);

  const duelColor = (name: string) => (name === dossier?.marca ? BRAND_COLOR : COMP_COLORS[compList.indexOf(name) % COMP_COLORS.length]);

  const hasPrev = !!dossier && (dossier.totals.brand_prev.unidades > 0 || dossier.totals.market_prev.unidades > 0);
  const momentum = dossier?.category_momentum || [];
  const movers = dossier?.product_movers || { up: [], down: [] };
  const hasMovers = movers.up.length > 0 || movers.down.length > 0;
  const bands = dossier?.price_bands || null;

  // ── Registro dinámico de slides (algunas dependen de los datos) ──────
  const slides = useMemo(() => {
    if (!dossier) return [] as Array<{ id: string; title: string }>;
    const list: Array<{ id: string; title: string }> = [
      { id: 'resumen', title: 'Resumen ejecutivo' },
      { id: 'evolucion', title: 'Evolución de ventas' },
      { id: 'competencia', title: 'Posición competitiva' },
    ];
    if (compList.length) list.push({ id: 'cara', title: 'Cara a cara' });
    if (momentum.length) list.push({ id: 'momentum', title: 'Momentum por categoría' });
    list.push({ id: 'categorias', title: 'Participación por categoría' });
    if ((dossier.category_daily || []).length > 1) list.push({ id: 'categorias-evolucion', title: 'Evolución por categoría' });
    if (matriz.length >= 3) list.push({ id: 'oportunidad', title: 'Matriz de oportunidad' });
    if (bands) list.push({ id: 'bandas', title: 'Gamas de precio' });
    list.push({ id: 'tipos', title: 'Tipos de producto' });
    list.push({ id: 'productos', title: 'Productos destacados' });
    if ((dossier.product_branch_metrics || []).length) list.push({ id: 'producto-sucursal', title: 'Producto × punto de venta' });
    if (hasMovers) list.push({ id: 'movers', title: 'Dinámica de productos' });
    list.push({ id: 'sucursales', title: 'Presencia por sucursal' });
    list.push({ id: 'precios', title: 'Posicionamiento de precio' });
    list.push({ id: 'conclusiones', title: 'Conclusiones y próximos pasos' });
    return list;
  }, [dossier, momentum.length, matriz.length, bands, hasMovers, compList.length]);

  const refCb = (id: string) => (el: HTMLElement | null) => { slideRefs.current[id] = el; };

  // ── Export ────────────────────────────────────────────────────────────
  async function handleExport(kind: 'ppt' | 'ppt-editable' | 'pdf' | 'xlsx') {
    if (!dossier || exporting) return;
    if (kind === 'xlsx') {
      setExporting('xlsx');
      setExportProgress('Generando Excel...');
      try {
        const blob = await downloadSalesBIBrandDossierXlsx({
          marca: dossier.marca,
          fecha_desde: fechaDesde || undefined,
          fecha_hasta: fechaHasta || undefined,
          sucursal: sucursal || undefined,
          tipo_venta: tipoVenta || undefined,
          competidores: compList.length ? compList.join(',') : undefined,
          tipos: (dossier.selected_tipos || selectedTipos).length ? (dossier.selected_tipos || selectedTipos).join(',') : undefined,
          metric,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `informe-${dossier.marca.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dossier.filters.fecha_desde}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo exportar el Excel');
      } finally {
        setExporting(null);
        setExportProgress('');
      }
      return;
    }
    if (kind === 'ppt-editable') {
      setExporting(kind);
      setExportProgress('Armando deck editable...');
      try {
        await exportBrandDossierEditablePptx(dossier, metric);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo exportar el informe editable');
      } finally {
        setExporting(null);
        setExportProgress('');
      }
      return;
    }
    const sections: DeckSection[] = slides
      .map((s) => {
        const node = slideRefs.current[s.id];
        return node ? { node, title: s.title } : null;
      })
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
      agenda: slides.map((s) => s.title),
      closing: 'Gracias',
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

  function toggleTipo(name: string) {
    const current = selectedTipos.length ? selectedTipos : (dossier?.selected_tipos || []);
    setSelectedTipos((prev) => {
      const base = prev.length ? prev : current;
      if (base.includes(name)) {
        const next = base.filter((t) => t !== name);
        return next.length ? next : base;
      }
      return [...base, name];
    });
  }

  async function handleLogoFile(file?: File | null) {
    if (!file || !dossier) return;
    setLogoUploading(true);
    setError('');
    try {
      const brand_logo = await uploadSalesBIBrandLogo(dossier.marca, file);
      setDossier((current) => (current ? { ...current, brand_logo } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el logo');
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleDeleteLogo() {
    if (!dossier?.brand_logo?.exists) return;
    setLogoUploading(true);
    setError('');
    try {
      const brand_logo = await deleteSalesBIBrandLogo(dossier.marca);
      setDossier((current) => (current ? { ...current, brand_logo } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el logo');
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleSaveBrandStyle() {
    if (!dossier) return;
    const normalized = brandColorDraft.trim().startsWith('#') ? brandColorDraft.trim() : `#${brandColorDraft.trim()}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      setError('El color de marca debe tener formato HEX, por ejemplo #1428A0.');
      return;
    }
    setBrandStyleSaving(true);
    setError('');
    try {
      const brand_style = await updateSalesBIBrandStyle(dossier.marca, normalized.toUpperCase());
      setBrandColorDraft(brand_style.primary_color);
      setDossier((current) => (current ? { ...current, brand_style } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el color de marca');
    } finally {
      setBrandStyleSaving(false);
    }
  }

  if (!brandNames.length) {
    return <EmptyChartState minHeight={320} description="Importa datos comerciales para armar el informe de marca." />;
  }

  const share = dossier?.share;
  const brandTot = dossier?.totals.brand;
  const marketTot = dossier?.totals.market;
  const availableTipos = dossier?.available_tipos || [];
  const activeTipos = selectedTipos.length ? selectedTipos : (dossier?.selected_tipos || []);
  const safeBrandColor = /^#[0-9a-fA-F]{6}$/.test(brandColorDraft) ? brandColorDraft : '#1E3A8A';

  return (
    <div className="space-y-4">
      {/* ── Controles del informe (no se exportan) ─────────────────── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-4 backdrop-blur lg:flex-row lg:items-center lg:justify-between" data-export-skip="true">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Marca</span>
            <select
              value={marca}
              onChange={(e) => { setCompetidores([]); setSelectedTipos([]); setMarca(e.target.value); }}
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
          <div className="flex items-center gap-1 rounded-full border border-white/15 p-1">
            {([['units', '# Unidades'], ['pvp', '$ PVP'], ['both', 'Ambos']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMetric(value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-bold transition',
                  metric === value ? 'bg-[color:var(--chart-blue)] text-white' : 'text-[color:var(--text-2)] hover:bg-white/10',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {availableTipos.length > 0 && (
            <div className="flex max-w-5xl flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/30 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-3)]">Tipos PPT</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-[color:var(--text-3)]">
                  {activeTipos.length} de {availableTipos.length}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedTipos(availableTipos)}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-black text-[color:var(--text-2)] hover:border-[color:var(--chart-blue)] hover:text-white"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTipos([])}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-black text-[color:var(--text-2)] hover:border-white/25 hover:text-white"
                >
                  Default
                </button>
              </div>
              <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto pr-1">
                {availableTipos.map((name) => {
                  const active = activeTipos.includes(name);
                  return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleTipo(name)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-black transition',
                      active
                        ? 'border-[color:var(--chart-blue)] bg-[color:var(--chart-blue)]/20 text-white'
                        : 'border-white/10 text-[color:var(--text-3)] hover:border-white/25 hover:text-white',
                    )}
                    title={active ? 'Incluido en el PowerPoint editable' : 'Agregar al PowerPoint editable'}
                  >
                    {name}
                  </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
            <ShieldCheck size={12} /> Sin costos ni márgenes
          </span>
          {dossier && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/30 px-2.5 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white">
                {dossier.brand_logo?.data_url
                  ? <img src={dossier.brand_logo.data_url} alt="" className="h-full w-full object-contain" />
                  : <ImageIcon size={16} className="text-slate-500" />}
              </div>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs font-bold text-white hover:bg-white/10">
                {logoUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {dossier.brand_logo?.exists ? 'Cambiar logo' : 'Logo marca'}
                <input
                  type="file"
                  accept="image/png"
                  className="hidden"
                  disabled={logoUploading}
                  onChange={(e) => {
                    void handleLogoFile(e.target.files?.[0]);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              {dossier.brand_logo?.exists && (
                <button
                  type="button"
                  onClick={() => void handleDeleteLogo()}
                  disabled={logoUploading}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[color:var(--text-3)] hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40"
                  title="Borrar logo guardado"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <div className="mx-1 h-6 w-px bg-white/10" />
              <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-bold text-white">
                <Palette size={14} className="text-[color:var(--text-3)]" />
                <input
                  type="color"
                  value={safeBrandColor}
                  onChange={(e) => setBrandColorDraft(e.target.value.toUpperCase())}
                  className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                  title="Color principal de la marca en PowerPoint"
                />
                <input
                  value={brandColorDraft}
                  onChange={(e) => setBrandColorDraft(e.target.value.toUpperCase())}
                  className="h-6 w-20 rounded-md border border-white/10 bg-slate-950/60 px-1.5 font-mono text-[11px] text-white outline-none focus:border-[color:var(--chart-blue)]"
                  title="Color HEX de marca"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSaveBrandStyle()}
                disabled={brandStyleSaving || brandColorDraft.toUpperCase() === (dossier.brand_style?.primary_color || '').toUpperCase()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-40"
                title="Guardar color para esta marca"
              >
                {brandStyleSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Guardar color
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            disabled={!dossier || !!exporting}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/50 px-3.5 text-sm font-bold text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
            title="Descarga los datos crudos del informe en Excel"
          >
            {exporting === 'xlsx' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {exporting === 'xlsx' ? exportProgress : 'Excel (datos)'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('ppt-editable')}
            disabled={!dossier || !!exporting}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-3.5 text-sm font-bold text-slate-950 hover:brightness-110 disabled:opacity-40"
            title="Genera un PowerPoint con graficos y tablas editables"
          >
            {exporting === 'ppt-editable' ? <Loader2 size={16} className="animate-spin" /> : <Presentation size={16} />}
            {exporting === 'ppt-editable' ? exportProgress : 'PowerPoint editable'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('ppt')}
            disabled={!dossier || !!exporting}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-3.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40"
          >
            {exporting === 'ppt' ? <Loader2 size={16} className="animate-spin" /> : <Presentation size={16} />}
            {exporting === 'ppt' ? exportProgress : 'PowerPoint visual'}
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
          {/* Resumen ejecutivo */}
          <Slide title="Resumen ejecutivo" subtitle={`${dossier.marca} en ElectroGV · ${fmtDate(dossier.filters.fecha_desde)} al ${fmtDate(dossier.filters.fecha_hasta)}`} refCb={refCb('resumen')}>
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

          {/* Evolución con granularidad + drill-down */}
          <Slide
            title="Evolución de ventas" takeaway={dossier.narratives?.evolucion}
            subtitle={drill
              ? `Día a día de ${bucketLabel(drill, gran)} · clic en "Volver" para salir`
              : `Vista ${GRAN_LABELS[gran].toLowerCase()} · ${gran !== 'daily' ? 'clic en una barra para ver ese período día a día' : 'facturación, share y unidades'}`}
            refCb={refCb('evolucion')}
            action={(
              <div className="flex flex-wrap items-center gap-1.5" data-export-skip="true">
                {drill ? (
                  <button
                    type="button"
                    onClick={() => setDrill(null)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--chart-blue)] px-3 py-1 text-xs font-bold text-[color:var(--chart-blue)] hover:bg-[color:var(--chart-blue)]/10"
                  >
                    <ArrowLeft size={12} /> Volver a {GRAN_LABELS[gran].toLowerCase()}
                  </button>
                ) : (
                  granOptions.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => { setGran(g); setDrill(null); }}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-bold transition',
                        g === gran ? 'bg-[color:var(--chart-blue)] text-white' : 'border border-white/15 text-[color:var(--text-2)] hover:bg-white/10',
                      )}
                    >
                      {GRAN_LABELS[g]}
                    </button>
                  ))
                )}
              </div>
            )}
          >
            <div className={cn('grid gap-4', metric === 'both' && 'xl:grid-cols-2')}>
              {metric !== 'units' && (
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Facturación y share %</div>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={evolucion} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis yAxisId="pvp" tickFormatter={compactMoney} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={52} />
                    <YAxis yAxisId="share" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={38} />
                    <Tooltip
                      formatter={(value, name) => (String(name).startsWith('Share') ? [`${Number(value).toFixed(1)}%`, name] : [money(Number(value)), name])}
                      contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      yAxisId="pvp"
                      dataKey="brand_pvp"
                      name="Facturación"
                      fill={BRAND_COLOR}
                      radius={[6, 6, 0, 0]}
                      cursor={!drill && gran !== 'daily' ? 'pointer' : 'default'}
                      onClick={(data) => {
                        const payload = data as { payload?: { key?: string } };
                        const key = payload?.payload?.key;
                        if (key && !drill && gran !== 'daily') setDrill(key);
                      }}
                      isAnimationActive animationDuration={CHART_ANIM.duration}
                    />
                    <Line yAxisId="share" dataKey="share_pvp_pct" name="Share $ %" stroke={POSITIVE} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line yAxisId="share" dataKey="share_units_pct" name="Share unidades %" stroke="var(--chart-teal)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              )}
              {metric !== 'pvp' && (
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Unidades vendidas</div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={evolucion} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#B8C5DA', fontSize: 10 }} width={44} />
                    <Tooltip formatter={(value) => [num(Number(value)), 'Unidades']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Bar
                      dataKey="brand_unidades"
                      name="Unidades"
                      fill="var(--chart-teal)"
                      radius={[6, 6, 0, 0]}
                      cursor={!drill && gran !== 'daily' ? 'pointer' : 'default'}
                      onClick={(data) => {
                        const payload = data as { payload?: { key?: string } };
                        const key = payload?.payload?.key;
                        if (key && !drill && gran !== 'daily') setDrill(key);
                      }}
                      isAnimationActive animationDuration={CHART_ANIM.duration}
                    >
                      {evolucion.length <= 16 && <LabelList dataKey="brand_unidades" position="top" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => num(Number(v))} />}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              )}
            </div>
            {shareStack.rows.length > 1 && (
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Peso sobre el total de la empresa · {dossier.marca} vs competidores · semanal · share en {metric === 'units' ? 'unidades' : 'facturación'}</div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={shareStack.rows} stackOffset="expand" margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={40} />
                    <Tooltip
                      formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
                      contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {[...shareStack.names, 'OTRAS'].map((name) => (
                      <Area
                        key={name}
                        dataKey={name}
                        stackId="share"
                        stroke="none"
                        fill={name === 'OTRAS' ? '#475569' : duelColor(name)}
                        fillOpacity={0.85}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Slide>

          {/* Posición competitiva */}
          <Slide title="Posición competitiva" takeaway={dossier.narratives?.competencia} subtitle={`Ranking de marcas y evolución vs ${compList.join(', ') || 'competidores'}`} refCb={refCb('competencia')}>
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Ranking por facturación (top {dossier.ranking.length})</div>
                <ResponsiveContainer width="100%" height={Math.max(280, dossier.ranking.length * 26)}>
                  <BarChart data={dossier.ranking} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(value) => [mfmt(Number(value)), metric === 'units' ? 'Unidades' : 'Facturación']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                    <Bar dataKey={metric === 'units' ? 'unidades' : 'total_vendido'} radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
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
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">{metric === 'units' ? 'Unidades mensuales' : 'Facturación mensual'}: {dossier.marca} vs competidores</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={competencia} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                    <YAxis tickFormatter={metric === 'units' ? ((v: number) => num(v)) : compactMoney} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={52} />
                    <Tooltip formatter={(value, name) => [mfmt(Number(value)), String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
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

          {/* Cara a cara con la competencia */}
          {compList.length >= 1 && duel && (
            <Slide title="Cara a cara" subtitle={`${dossier.marca} vs ${compList.join(' · ')} · el líder de cada métrica queda marcado`} refCb={refCb('cara')}>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[color:var(--text-3)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Métrica</th>
                        {duel.map((r) => (
                          <th key={r.name} className="px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: duelColor(r.name) }} />
                              {r.name}
                            </span>
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right">Líder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Vendido', fmt: (v: number) => money(v), get: (r: typeof duel[number]) => r.total_vendido },
                        { label: 'Unidades', fmt: (v: number) => num(v), get: (r: typeof duel[number]) => r.unidades },
                        { label: 'SKUs', fmt: (v: number) => num(v), get: (r: typeof duel[number]) => r.productos },
                        { label: 'PVP prom. unidad', fmt: (v: number) => money(v), get: (r: typeof duel[number]) => r.pvp_promedio },
                        { label: 'Participación', fmt: (v: number) => `${v.toFixed(1)}%`, get: (r: typeof duel[number]) => r.participacion_pct || 0 },
                      ].map((m) => {
                        const vals = duel.map(m.get);
                        const max = Math.max(...vals);
                        const winner = duel[vals.indexOf(max)].name;
                        return (
                          <tr key={m.label} className="border-t border-white/5">
                            <td className="px-3 py-2.5 font-bold text-[color:var(--text)]">{m.label}</td>
                            {duel.map((r, i) => (
                              <td key={r.name} className={cn('px-3 py-2.5 text-right tabular-nums', r.name === winner ? 'font-black text-[color:var(--chart-positive)]' : 'text-[color:var(--text-2)]')}>
                                {r.name === winner && '✓ '}{m.fmt(vals[i])}
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-right">
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase" style={{ background: 'rgba(255,255,255,0.06)', color: duelColor(winner) }}>{winner}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Quién empuja cada sucursal ({metric === 'units' ? 'unidades' : 'facturación'})</div>
                  {branchDuel.rows.length ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={branchDuel.rows} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                        <XAxis dataKey="sucursal" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                        <YAxis tickFormatter={metric === 'units' ? ((v: number) => num(v)) : compactMoney} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={52} />
                        <Tooltip formatter={(value, name) => [mfmt(Number(value)), String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {branchDuel.names.map((name) => (
                          <Bar key={name} dataKey={name} fill={duelColor(name)} radius={[5, 5, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyChartState minHeight={280} />}
                </div>
              </div>
            </Slide>
          )}

          {/* Momentum por categoría (solo con período anterior) */}
          {momentum.length > 0 && (
            <Slide title="Momentum por categoría" takeaway={dossier.narratives?.momentum} subtitle={`Crecimiento de ${dossier.marca} vs el mercado (${fmtDate(dossier.filters.prev_desde)} – ${fmtDate(dossier.filters.prev_hasta)} → período actual)`} refCb={refCb('momentum')}>
              <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                <ResponsiveContainer width="100%" height={Math.max(260, momentum.length * 52)}>
                  <BarChart data={momentum} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} />
                    <YAxis type="category" dataKey="categoria" width={130} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={0} stroke="#94a3b8" />
                    <Bar dataKey="brand_growth_pct" name={dossier.marca} fill={BRAND_COLOR} radius={[0, 5, 5, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} />
                    <Bar dataKey="market_growth_pct" name="Mercado" fill={MARKET_COLOR} radius={[0, 5, 5, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {momentum.map((m) => (
                    <div key={m.categoria} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                      <div>
                        <div className="text-sm font-black text-[color:var(--text)]">{m.categoria}</div>
                        <div className="text-[11px] text-[color:var(--text-3)]">marca {m.brand_growth_pct >= 0 ? '+' : ''}{m.brand_growth_pct}% · mercado {m.market_growth_pct >= 0 ? '+' : ''}{m.market_growth_pct}%</div>
                      </div>
                      <span className={cn('inline-flex items-center gap-1 text-sm font-black tabular-nums', m.outperform_pts >= 0 ? 'text-[color:var(--chart-positive)]' : 'text-[color:var(--chart-negative)]')}>
                        {m.outperform_pts >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {m.outperform_pts >= 0 ? '+' : ''}{m.outperform_pts} pts
                      </span>
                    </div>
                  ))}
                  <p className="text-[11px] leading-5 text-[color:var(--text-3)]">
                    "+pts" = la marca crece más que el mercado en esa categoría (gana share). "−pts" = pierde terreno aunque facture más.
                  </p>
                </div>
              </div>
            </Slide>
          )}

          {/* Categorías */}
          <Slide title="Participación por categoría" takeaway={dossier.narratives?.categorias} subtitle="Share de la marca dentro de cada categoría y mix propio" refCb={refCb('categorias')}>
            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="space-y-2.5">
                {categorias.map((c) => {
                  const catShare = metric === 'units' ? c.share_units_pct : c.share_pvp_pct;
                  const width = Math.max(3, Math.min(100, catShare));
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
                          <span className="text-sm font-black tabular-nums text-[color:var(--text)]">{catShare.toFixed(1)}%{metric === 'units' ? ' u' : ''}</span>
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
                      <Tooltip formatter={(value, name) => [mfmt(Number(value)), String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChartState minHeight={280} />}
              </div>
            </div>
          </Slide>

          {/* Evolución por categoría */}
          {catEvo.rows.length > 1 && (
            <Slide title="Evolución por categoría" subtitle={`${metric === 'pvp' ? 'Facturación' : 'Unidades'} de ${dossier.marca} por categoría · vista ${catEvo.gran === 'weekly' ? 'semanal' : 'diaria'}`} refCb={refCb('categorias-evolucion')}>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={catEvo.rows} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                  <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
                  <YAxis tickFormatter={metric === 'pvp' ? compactMoney : ((v: number) => num(v))} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={52} />
                  <Tooltip formatter={(value, name) => [metric === 'pvp' ? money(Number(value)) : num(Number(value)), String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {catEvo.cats.map((cat, i) => (
                    <Line
                      key={cat}
                      dataKey={cat}
                      stroke={[BRAND_COLOR, 'var(--chart-violet)', 'var(--chart-teal)', 'var(--chart-amber)', '#ec4899'][i % 5]}
                      strokeWidth={i === 0 ? 3 : 2}
                      dot={{ r: 2.5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Slide>
          )}

          {/* Matriz de oportunidad */}
          {matriz.length >= 3 && (
            <Slide title="Matriz de oportunidad" takeaway={dossier.narratives?.oportunidad} subtitle={`Tamaño de la categoría vs share de ${dossier.marca} · burbuja = facturación de la marca · línea = share global (${share.pvp_pct.toFixed(1)}%)`} refCb={refCb('oportunidad')}>
              <ResponsiveContainer width="100%" height={380}>
                <ScatterChart margin={{ top: 24, right: 40, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                  <XAxis type="number" dataKey="mercado" name="Mercado" tickFormatter={metric === 'units' ? ((v: number) => num(v)) : compactMoney} tick={{ fill: '#B8C5DA', fontSize: 10 }} label={{ value: metric === 'units' ? 'Tamaño de la categoría (unidades totales)' : 'Tamaño de la categoría (facturación total)', fill: '#94a3b8', fontSize: 11, position: 'insideBottom', offset: -4 }} />
                  <YAxis type="number" dataKey="share" name="Share" tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={44} label={{ value: 'Share de la marca', angle: -90, fill: '#94a3b8', fontSize: 11, position: 'insideLeft' }} />
                  <ZAxis type="number" dataKey="facturacion" range={[120, 900]} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Mercado') return [money(Number(value)), 'Mercado de la categoría'];
                      if (name === 'Share') return [`${Number(value).toFixed(1)}%`, `Share de ${dossier.marca}`];
                      return [money(Number(value)), 'Facturación de la marca'];
                    }}
                    contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                    cursor={{ strokeDasharray: '3 3' }}
                  />
                  <ReferenceLine y={metric === 'units' ? share.units_pct : share.pvp_pct} stroke="#94a3b8" strokeDasharray="4 3" />
                  <Scatter data={matriz} isAnimationActive animationDuration={CHART_ANIM.duration}>
                    {matriz.map((m) => (
                      <Cell key={m.categoria} fill={m.share >= (metric === 'units' ? share.units_pct : share.pvp_pct) ? BRAND_COLOR : 'var(--chart-amber)'} fillOpacity={0.85} />
                    ))}
                    <LabelList dataKey="categoria" position="top" style={{ fill: '#B8C5DA', fontSize: 10, fontWeight: 700 }} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-[11px] leading-5 text-[color:var(--text-3)]">
                Ámbar bajo la línea = categorías grandes donde la marca está sub-representada → la oportunidad de crecimiento más directa.
              </p>
            </Slide>
          )}

          {/* Bandas de precio */}
          {bands && (
            <Slide
              title="Gamas de precio" takeaway={dossier.narratives?.bandas}
              subtitle={`Entrada hasta ${money(bands.cortes.entrada_hasta)} · Media hasta ${money(bands.cortes.media_hasta)} · Premium el resto (terciles del mercado en unidades)`}
              refCb={refCb('bandas')}
            >
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Dónde concentra unidades: {dossier.marca} vs el mercado</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={bands.bands} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                      <XAxis dataKey="banda" tick={{ fill: '#B8C5DA', fontSize: 12 }} />
                      <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={40} />
                      <Tooltip formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="brand_mix_units_pct" name={`Mix ${dossier.marca}`} fill={BRAND_COLOR} radius={[6, 6, 0, 0]}>
                        <LabelList dataKey="brand_mix_units_pct" position="top" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(0)}%`} />
                      </Bar>
                      <Bar dataKey="market_mix_units_pct" name="Mix mercado" fill={MARKET_COLOR} radius={[6, 6, 0, 0]}>
                        <LabelList dataKey="market_mix_units_pct" position="top" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(0)}%`} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Share de {dossier.marca} dentro de cada gama</div>
                  {bands.bands.map((b) => (
                    <div key={b.banda} className="rounded-xl bg-white/[0.03] px-3.5 py-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-black text-[color:var(--text)]">{b.banda}</span>
                        <span className="text-sm font-black tabular-nums text-[color:var(--text)]">{b.share_units_pct.toFixed(1)}% <span className="text-[11px] font-bold text-[color:var(--text-3)]">en unidades</span></span>
                      </div>
                      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, Math.min(100, b.share_units_pct))}%`, background: b.share_units_pct >= share.units_pct ? BRAND_COLOR : 'var(--chart-amber)' }} />
                        <div className="absolute inset-y-0 w-0.5 bg-white/60" style={{ left: `${Math.min(100, share.units_pct)}%` }} title="Share global" />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[11px] text-[color:var(--text-3)]">
                        <span>{num(b.brand_unidades)} u de {num(b.market_unidades)} del mercado</span>
                        <span>{b.corte_max ? `${money(b.corte_min)} – ${money(b.corte_max)}` : `desde ${money(b.corte_min)}`}</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] leading-5 text-[color:var(--text-3)]">
                    La marquita blanca es el share global ({share.units_pct.toFixed(1)}%). Gama en ámbar = la marca rinde por debajo de su promedio → hueco de surtido o precio.
                  </p>
                </div>
              </div>
            </Slide>
          )}

          {/* Tipos */}
          <Slide title="Tipos de producto" takeaway={dossier.narratives?.tipos} subtitle={`En qué tipos de producto juega ${dossier.marca} y cuánto pesa en cada uno`} refCb={refCb('tipos')}>
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
                  <Bar dataKey={metric === 'units' ? 'unidades' : 'total_vendido'} name={metric === 'units' ? 'Unidades' : 'Facturación'} fill={BRAND_COLOR} radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                    <LabelList dataKey="share_pvp_pct" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(1)}% del tipo`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState minHeight={240} />}
          </Slide>

          {/* Productos */}
          <Slide title="Productos destacados" takeaway={dossier.narratives?.productos} subtitle={`Top ${dossier.top_products.length} productos por facturación`} refCb={refCb('productos')}>
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

          {/* Producto × punto de venta */}
          {(dossier.product_branch_metrics || []).length > 0 && (
            <Slide title="Producto × punto de venta" subtitle={`Qué productos de ${dossier.marca} empujan cada sucursal · unidades y facturación`} refCb={refCb('producto-sucursal')}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-[color:var(--text-3)]">
                    <tr>
                      <th className="px-3 py-2 text-left">Producto</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      {dossier.branches.slice(0, 4).map((b) => (
                        <th key={b.sucursal} className="px-3 py-2 text-right">{b.sucursal}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(dossier.product_branch_metrics || []).slice(0, 8).map((row) => (
                      <tr key={`${row.sku}-${row.producto}`} className="border-t border-white/5 align-top">
                        <td className="max-w-[340px] px-3 py-2.5">
                          <div className="truncate font-bold text-[color:var(--text)]">{row.producto}</div>
                          <div className="text-[11px] text-[color:var(--text-3)]">{row.tipo_producto || row.sku}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <div className="font-black text-[color:var(--text)]">{num(row.total_unidades)} u</div>
                          <div className="text-[11px] text-[color:var(--text-3)]">{money(row.total_vendido)}</div>
                        </td>
                        {dossier.branches.slice(0, 4).map((b) => {
                          const cell = row.branches?.[b.sucursal];
                          return (
                            <td key={b.sucursal} className="px-3 py-2.5 text-right tabular-nums">
                              <div className={cn('font-bold', cell?.unidades ? 'text-[color:var(--text)]' : 'text-[color:var(--text-3)]')}>{num(cell?.unidades || 0)} u</div>
                              <div className="text-[11px] text-[color:var(--text-3)]">{cell?.total_vendido ? money(cell.total_vendido) : '—'}</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] leading-5 text-[color:var(--text-3)]">
                Lectura para la visita: muestra con qué modelos la marca empuja cada punto de venta y dónde falta rotación.
              </p>
            </Slide>
          )}

          {/* Dinámica de productos (movers, solo con período anterior) */}
          {hasMovers && (
            <Slide title="Dinámica de productos" takeaway={dossier.narratives?.movers} subtitle="Productos que más subieron y bajaron en unidades vs el período anterior" refCb={refCb('movers')}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[color:var(--chart-positive)]"><ArrowUpRight size={14} /> En alza</div>
                  <div className="space-y-2">
                    {movers.up.map((m) => (
                      <div key={`${m.sku}-${m.producto}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[color:var(--text)]">{m.producto}</div>
                          <div className="text-[11px] text-[color:var(--text-3)]">{m.tipo_producto || m.sku}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-black text-[color:var(--chart-positive)]">+{num(m.delta_unidades)} u</div>
                          <div className="text-[11px] tabular-nums text-[color:var(--text-3)]">{num(m.unidades_prev)} → {num(m.unidades)}</div>
                        </div>
                      </div>
                    ))}
                    {movers.up.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-[color:var(--text-3)]">Sin subas relevantes.</div>}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[color:var(--chart-negative)]"><ArrowDownRight size={14} /> En baja</div>
                  <div className="space-y-2">
                    {movers.down.map((m) => (
                      <div key={`${m.sku}-${m.producto}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[color:var(--text)]">{m.producto}</div>
                          <div className="text-[11px] text-[color:var(--text-3)]">{m.tipo_producto || m.sku}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-black text-[color:var(--chart-negative)]">{num(m.delta_unidades)} u</div>
                          <div className="text-[11px] tabular-nums text-[color:var(--text-3)]">{num(m.unidades_prev)} → {num(m.unidades)}</div>
                        </div>
                      </div>
                    ))}
                    {movers.down.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-[color:var(--text-3)]">Sin bajas relevantes.</div>}
                  </div>
                </div>
              </div>
            </Slide>
          )}

          {/* Sucursales */}
          <Slide title="Presencia por sucursal" subtitle={`Peso de ${dossier.marca} en cada punto de venta · ACUMULADO del ${fmtDate(dossier.filters.fecha_desde)} al ${fmtDate(dossier.filters.fecha_hasta)} (no es un solo mes)`} takeaway={dossier.narratives?.sucursales} refCb={refCb('sucursales')}>
            <div className={cn('grid gap-4', metric === 'both' && 'xl:grid-cols-2')}>
              {metric !== 'units' && (
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Share en facturación ($)</div>
                <ResponsiveContainer width="100%" height={Math.max(220, dossier.branches.length * 38)}>
                  <BarChart data={dossier.branches} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="sucursal" width={110} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Share $ en la sucursal']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                    <Bar dataKey="share_in_branch_pct" fill={BRAND_COLOR} radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                      <LabelList dataKey="share_in_branch_pct" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              )}
              {metric !== 'pvp' && (
              <div>
                <div className="mb-2 text-xs font-bold text-[color:var(--text-3)]">Share en unidades</div>
                <ResponsiveContainer width="100%" height={Math.max(220, dossier.branches.length * 38)}>
                  <BarChart data={dossier.branches} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="sucursal" width={110} tick={{ fill: '#B8C5DA', fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Share unidades en la sucursal']} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: 'rgba(96,165,250,0.10)' }} />
                    <Bar dataKey="share_units_in_branch_pct" fill="var(--chart-teal)" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={CHART_ANIM.duration}>
                      <LabelList dataKey="share_units_in_branch_pct" position="right" style={{ fill: '#B8C5DA', fontSize: 10 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              )}
            </div>
            <p className="text-[11px] leading-5 text-[color:var(--text-3)]">
              ⚠ "Marca u" y "Total u" son los ACUMULADOS de todo el período seleccionado ({fmtDate(dossier.filters.fecha_desde)} – {fmtDate(dossier.filters.fecha_hasta)}), no de un mes puntual. Para ver un mes, ajustá el rango de fechas arriba.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-[color:var(--text-3)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Sucursal</th>
                    <th className="px-3 py-2 text-right">Marca u</th>
                    <th className="px-3 py-2 text-right">Total u</th>
                    <th className="px-3 py-2 text-right">Share u</th>
                    <th className="px-3 py-2 text-right">Marca $</th>
                    <th className="px-3 py-2 text-right">Share $</th>
                    <th className="px-3 py-2 text-right">Mix marca</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.branches.map((b) => (
                    <tr key={b.sucursal} className="border-t border-white/5">
                      <td className="px-3 py-2 font-bold text-[color:var(--text)]">{b.sucursal}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(b.brand_unidades)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-2)]">{b.market_unidades != null ? num(b.market_unidades) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(b.share_units_in_branch_pct ?? 0).toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.brand_pvp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.share_in_branch_pct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-2)]">{b.brand_mix_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Slide>

          {/* Precios */}
          <Slide title="Posicionamiento de precio" takeaway={dossier.narratives?.precios} subtitle="Índice de precio por categoría (100 = precio promedio del mercado)" refCb={refCb('precios')}>
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

          {/* Conclusiones */}
          <Slide title="Conclusiones y próximos pasos" subtitle={`Síntesis del período para ${dossier.marca}`} refCb={refCb('conclusiones')}>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[color:var(--chart-positive)]">
                  <CheckCircle2 size={15} /> Fortalezas
                </div>
                <ul className="space-y-2.5">
                  {dossier.conclusions.fortalezas.map((t) => (
                    <li key={t} className="text-sm leading-5 text-[color:var(--text-2)]">{t}</li>
                  ))}
                  {dossier.conclusions.fortalezas.length === 0 && <li className="text-xs text-[color:var(--text-3)]">—</li>}
                </ul>
              </div>
              <div className="rounded-2xl bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[color:var(--chart-amber)]">
                  <Lightbulb size={15} /> Oportunidades
                </div>
                <ul className="space-y-2.5">
                  {dossier.conclusions.oportunidades.map((t) => (
                    <li key={t} className="text-sm leading-5 text-[color:var(--text-2)]">{t}</li>
                  ))}
                  {dossier.conclusions.oportunidades.length === 0 && <li className="text-xs text-[color:var(--text-3)]">—</li>}
                </ul>
              </div>
              <div className="rounded-2xl bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[color:var(--chart-blue)]">
                  <ListChecks size={15} /> Próximos pasos
                </div>
                <ul className="space-y-2.5">
                  {dossier.conclusions.acciones.map((t) => (
                    <li key={t} className="text-sm leading-5 text-[color:var(--text-2)]">{t}</li>
                  ))}
                </ul>
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
