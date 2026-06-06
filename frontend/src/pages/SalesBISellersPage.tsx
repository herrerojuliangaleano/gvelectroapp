/**
 * Dashboard de Inteligencia Comercial — Métricas de vendedores.
 *
 * Estructura: 4 pestañas (Overview / Perfil vendedor / Comparador V vs V /
 * Comparar períodos) compartiendo una barra de filtros global persistente.
 *
 * Datos: consume `/api/sales-bi/sellers/report` y `/sellers/compare`.
 *
 * Per-seller breakdowns (Profile + Compare): el backend hoy solo expone los
 * mixes globales (brand_mix, category_mix, top_products) y un daily_series
 * global. Para los gráficos por vendedor derivamos PROPORCIONALMENTE desde
 * el global, escalando por la participación del vendedor en el total. Es
 * una aproximación visual razonable hasta que extendamos el backend con un
 * endpoint `/sellers/<id>/detail` que devuelva los mixes reales por vendedor.
 *
 * Tokens y widgets en `components/SalesBIWidgets.tsx`.
 */
import {
  AlertTriangle, BarChart2, BarChart3, Calendar, Check, Download, FileSpreadsheet,
  Filter, Loader2, RefreshCw, Search, Trophy, Users, Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

import {
  can, createSalesBIProductAlias, exportSalesBISellersPdf, exportSalesBISellersXlsx,
  fetchSalesBISellersCompare, fetchSalesBISellersOptions, fetchSalesBISellersReport,
  fetchSalesBIUnmatchedProducts, rematchSalesBIImport, searchProducts,
} from '../api/client';
import type {
  ProductInfo, SalesBIDailyMetric, SalesBIMixMetric, SalesBISellerMetric,
  SalesBISellersCompare, SalesBISellersOptions, SalesBISellersReport, SalesBITopProduct,
  SalesBIUnmatchedProduct,
} from '../types';
import {
  CHART_ANIM, CHART_ANIM_FAST, CHART_TOOLTIP_STYLE, ChartCard, DeltaPill,
  KpiCard, ParticipationBar, SellerAvatar, Tabs, cn, money, num, pct,
  useIsDesktop,
} from '../components/SalesBIWidgets';

// Paleta para gráficos categóricos (donuts, barras agrupadas, etc.).
// El orden importa: índice 0 = serie principal del overview / vendedor A.
const PALETTE = [
  'var(--chart-blue)', 'var(--chart-violet)', 'var(--chart-teal)',
  'var(--chart-amber)', 'var(--chart-positive)', 'var(--chart-negative)',
  '#06B6D4', '#A855F7', '#F97316', '#EF4444',
];

// ── Date helpers ────────────────────────────────────────────────────────────
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

// ── Derivaciones por vendedor (mientras el backend no exponga per-seller) ──
/** Escala un breakdown global por la participación del vendedor en el total. */
function scaleMixForSeller<T extends { total_cobrado: number; unidades: number }>(
  global: T[],
  seller: SalesBISellerMetric,
  totalCobradoGlobal: number,
): T[] {
  if (!totalCobradoGlobal) return [];
  const share = seller.total_cobrado / totalCobradoGlobal;
  return global.map((row) => ({
    ...row,
    total_cobrado: row.total_cobrado * share,
    unidades: Math.round(row.unidades * share),
  }));
}

/** Daily series del vendedor: distribuye el daily global por su share. */
function scaleDailyForSeller(
  daily: SalesBIDailyMetric[],
  seller: SalesBISellerMetric,
  totalCobradoGlobal: number,
): SalesBIDailyMetric[] {
  if (!totalCobradoGlobal) return [];
  const share = seller.total_cobrado / totalCobradoGlobal;
  return daily.map((d) => ({ ...d, total_cobrado: d.total_cobrado * share, unidades: Math.round(d.unidades * share) }));
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────
export function SalesBISellersPage() {
  const now = new Date();
  const [tab, setTab] = useState<'overview' | 'profile' | 'compare' | 'periods'>('overview');

  // Filtros globales (persisten al cambiar de pestaña)
  const [desde, setDesde] = useState(iso(monthStart(now)));
  const [hasta, setHasta] = useState(iso(now));
  const initialCompare = previousRange(iso(monthStart(now)), iso(now));
  const [compareDesde, setCompareDesde] = useState(initialCompare.desde);
  const [compareHasta, setCompareHasta] = useState(initialCompare.hasta);
  // `empresa` = slug de companies.id, '' = todas. `sucursales` = multi-select
  // por nombre legacy ("Caseros", "Canning", …). Vacío = todas. `tipo` = canal.
  const [empresa, setEmpresa] = useState('');
  const [selectedSucursales, setSelectedSucursales] = useState<Set<string>>(new Set());
  const [tipo, setTipo] = useState('');
  const [selectedSellers, setSelectedSellers] = useState<Set<string>>(new Set());
  // Compare vs período anterior — OFF por default. El usuario decide cuándo
  // activarla. Antes era siempre activa y los KpiCards mostraban delta de un
  // período que no necesariamente quería ver.
  const [compareEnabled, setCompareEnabled] = useState(false);
  // Opciones de empresa + sucursales — se cargan una vez al montar.
  const [options, setOptions] = useState<SalesBISellersOptions | null>(null);

  // Estado por tab
  const [profileSellerId, setProfileSellerId] = useState<string>('');
  const [compareAId, setCompareAId] = useState<string>('');
  const [compareBId, setCompareBId] = useState<string>('');

  // Data
  const [report, setReport] = useState<SalesBISellersReport | null>(null);
  const [compare, setCompare] = useState<SalesBISellersCompare | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  const vendedoresParam = [...selectedSellers].join(',');

  async function load() {
    setLoading(true);
    setError('');
    const sucursalesParam = [...selectedSucursales].join(',');
    const baseParams = {
      fecha_desde: desde,
      fecha_hasta: hasta,
      empresa: empresa || undefined,
      sucursales: sucursalesParam || undefined,
      tipo: tipo || undefined,
      vendedores: vendedoresParam || undefined,
    };
    try {
      // El compare se hace solo si el usuario lo activó. Cuando está OFF,
      // todos los charts ya se renderizan sin "anterior" (hasAnterior=false).
      const repPromise = fetchSalesBISellersReport(baseParams);
      const compPromise: Promise<SalesBISellersCompare | null> = compareEnabled
        ? fetchSalesBISellersCompare({
            base_desde: desde, base_hasta: hasta,
            compare_desde: compareDesde, compare_hasta: compareHasta,
            empresa: empresa || undefined,
            sucursales: sucursalesParam || undefined,
            tipo: tipo || undefined,
            vendedores: vendedoresParam || undefined,
          })
        : Promise.resolve(null);
      const [rep, comp] = await Promise.all([repPromise, compPromise]);
      setReport(rep);
      setCompare(comp);
      // Defaultear los selectores de perfil/compare al primer y segundo vendedor.
      const sellers = rep.sellers || [];
      if (sellers.length > 0) {
        if (!profileSellerId || !sellers.some((s) => s.vendedor_normalized === profileSellerId)) {
          setProfileSellerId(sellers[0].vendedor_normalized);
        }
        if (!compareAId || !sellers.some((s) => s.vendedor_normalized === compareAId)) {
          setCompareAId(sellers[0].vendedor_normalized);
        }
        if (!compareBId || !sellers.some((s) => s.vendedor_normalized === compareBId)) {
          setCompareBId(sellers[1]?.vendedor_normalized || sellers[0].vendedor_normalized);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el informe.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Opciones se cargan UNA vez (no dependen del filtro de fechas).
  useEffect(() => {
    fetchSalesBISellersOptions().then(setOptions).catch(() => setOptions({ empresas: [], sucursales: [] }));
  }, []);

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
      // Para export pasamos la primera sucursal seleccionada como `sucursal`
      // legacy (los exporters todavía no soportan multi). Si el usuario quiere
      // exportar un subset, pre-filtra el set de sucursales antes.
      const sucursalLegacy = [...selectedSucursales][0] || '';
      const payload = {
        fecha_desde: desde, fecha_hasta: hasta,
        sucursal: sucursalLegacy || undefined, tipo: tipo || undefined,
        vendedores: [...selectedSellers],
        compare_desde: compareDesde, compare_hasta: compareHasta,
        titulo: 'Informe de vendedores', logo: 'GV',
      };
      const blob = kind === 'pdf' ? await exportSalesBISellersPdf(payload) : await exportSalesBISellersXlsx(payload);
      downloadBlob(blob, `informe-vendedores-${desde}-${hasta}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`);
    } finally {
      setExporting('');
    }
  }

  // pb-28 en mobile (deja espacio al bottom nav fijo) / md:pb-14 desktop.
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-28 md:pb-14">
      {/* ── HEADER ───────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[color:var(--chart-blue)]">
            <BarChart2 size={15} /> Inteligencia Comercial
          </div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[color:var(--text)] sm:text-4xl">
            Métricas de vendedores
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[color:var(--text-2)]">
            Análisis por rango, comparación entre vendedores y contra períodos anteriores.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 px-4 py-2 text-sm font-bold text-[color:var(--text)] hover:bg-[color:var(--surface-hover)] disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          {can('sales_bi.export') && (
            <>
              <button onClick={() => exportFile('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-4 py-2 text-sm font-black text-white hover:brightness-110 disabled:opacity-50">
                <Download size={15} /> PDF
              </button>
              <button onClick={() => exportFile('xlsx')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 px-4 py-2 text-sm font-black text-[color:var(--text)] hover:bg-[color:var(--surface-hover)] disabled:opacity-50">
                <FileSpreadsheet size={15} /> Excel
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── FILTROS GLOBALES ─────────────────────────────────────────── */}
      <FiltersBar
        desde={desde} setDesde={setDesde}
        hasta={hasta} setHasta={setHasta}
        compareDesde={compareDesde} setCompareDesde={setCompareDesde}
        compareHasta={compareHasta} setCompareHasta={setCompareHasta}
        compareEnabled={compareEnabled} setCompareEnabled={setCompareEnabled}
        empresa={empresa} setEmpresa={setEmpresa}
        selectedSucursales={selectedSucursales} setSelectedSucursales={setSelectedSucursales}
        tipo={tipo} setTipo={setTipo}
        selectedSellers={selectedSellers} setSelectedSellers={setSelectedSellers}
        sellerOptions={report?.sellers || []}
        options={options}
        onApply={load}
        onPreset={applyPreset}
      />

      {error && (
        <div className="rounded-2xl border border-[color:var(--chart-negative)]/40 bg-[color:var(--chart-negative)]/10 p-4 text-sm text-[color:var(--chart-negative)]">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="flex items-center gap-2 text-sm text-[color:var(--text-2)]">
          <Loader2 size={16} className="animate-spin" /> Cargando informe…
        </div>
      )}

      {/* ── TABS ─────────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        tabs={[
          { value: 'overview', label: 'Overview',          shortLabel: 'Overview', icon: <BarChart3 size={14} /> },
          { value: 'profile',  label: 'Perfil vendedor',   shortLabel: 'Perfil',   icon: <Users size={14} /> },
          { value: 'compare',  label: 'Comparador V vs V', shortLabel: 'V vs V',   icon: <Trophy size={14} /> },
          { value: 'periods',  label: 'Comparar períodos', shortLabel: 'Períodos', icon: <Calendar size={14} /> },
        ]}
      />

      {report && (
        <>
          {tab === 'overview' && <OverviewTab report={report} compare={compare} range={{ desde, hasta, sucursal: [...selectedSucursales][0] || '', tipo }} />}
          {tab === 'profile' && (
            <ProfileTab
              report={report} compare={compare}
              sellerId={profileSellerId} onChangeSeller={setProfileSellerId}
            />
          )}
          {tab === 'compare' && (
            <CompareTab
              report={report}
              aId={compareAId} bId={compareBId}
              onChangeA={setCompareAId} onChangeB={setCompareBId}
            />
          )}
          {tab === 'periods' && <PeriodsTab report={report} compare={compare} />}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FILTERS BAR
// ────────────────────────────────────────────────────────────────────────────
function FiltersBar({
  desde, setDesde, hasta, setHasta,
  compareDesde, setCompareDesde, compareHasta, setCompareHasta,
  compareEnabled, setCompareEnabled,
  empresa, setEmpresa,
  selectedSucursales, setSelectedSucursales,
  tipo, setTipo,
  selectedSellers, setSelectedSellers, sellerOptions,
  options,
  onApply, onPreset,
}: {
  desde: string; setDesde: (v: string) => void;
  hasta: string; setHasta: (v: string) => void;
  compareDesde: string; setCompareDesde: (v: string) => void;
  compareHasta: string; setCompareHasta: (v: string) => void;
  compareEnabled: boolean; setCompareEnabled: (v: boolean) => void;
  empresa: string; setEmpresa: (v: string) => void;
  selectedSucursales: Set<string>; setSelectedSucursales: (s: Set<string>) => void;
  tipo: string; setTipo: (v: string) => void;
  selectedSellers: Set<string>; setSelectedSellers: (s: Set<string>) => void;
  sellerOptions: SalesBISellerMetric[];
  options: SalesBISellersOptions | null;
  onApply: () => void;
  onPreset: (kind: string) => void;
}) {
  const presets: Array<[string, string]> = [
    ['today', 'Hoy'], ['yesterday', 'Ayer'],
    ['week', 'Semana actual'], ['prev-week', 'Semana anterior'],
    ['month', 'Mes actual'], ['prev-month', 'Mes anterior'],
    ['30', 'Últimos 30 días'],
  ];

  // Si hay empresa elegida, mostrar solo las sucursales de esa empresa. Si
  // ninguna, mostrar todas. La selección de sucursal se preserva entre
  // cambios de empresa (las que ya no apliquen quedan invisibles pero
  // siguen en el Set; el `Limpiar` las saca).
  const empresaSucursales = useMemo(() => {
    const all = options?.sucursales ?? [];
    if (!empresa) return all;
    return all.filter((s) => s.empresa_id === empresa);
  }, [options, empresa]);

  function toggleSucursal(name: string) {
    const next = new Set(selectedSucursales);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedSucursales(next);
  }

  function toggleSeller(key: string) {
    const next = new Set(selectedSellers);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedSellers(next);
  }

  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-4 backdrop-blur space-y-3">
      {/* Fila 1: rango + empresa + canal + aplicar */}
      <div className="grid gap-3 lg:grid-cols-[1fr_minmax(180px,220px)_minmax(160px,180px)_auto]">
        <div className="grid grid-cols-2 gap-2">
          <DateField label="Desde" value={desde} onChange={setDesde} accent="var(--chart-blue)" />
          <DateField label="Hasta" value={hasta} onChange={setHasta} accent="var(--chart-blue)" />
        </div>
        <SelectField
          label="Empresa"
          value={empresa}
          onChange={(v) => {
            setEmpresa(v);
            // Al cambiar de empresa, limpiamos sucursales que ya no apliquen.
            if (v) {
              const validNames = new Set((options?.sucursales ?? []).filter((s) => s.empresa_id === v).map((s) => s.name));
              const filtered = new Set([...selectedSucursales].filter((n) => validNames.has(n)));
              if (filtered.size !== selectedSucursales.size) setSelectedSucursales(filtered);
            }
          }}
          options={[['', 'Todas las empresas'], ...(options?.empresas ?? []).map((e) => [e.id, e.name] as [string, string])]}
        />
        <SelectField
          label="Canal"
          value={tipo}
          onChange={setTipo}
          options={[['', 'Local + online'], ['local', 'Local'], ['online', 'Online']]}
        />
        <div className="flex items-end">
          <button onClick={onApply} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--chart-blue)] px-5 py-2.5 text-sm font-black text-white hover:brightness-110">
            <Wand2 size={15} /> Aplicar
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {presets.map(([key, label]) => (
          <button
            key={key}
            onClick={() => onPreset(key)}
            className="rounded-full border border-[color:var(--border)] px-3 py-1 text-xs font-bold text-[color:var(--text-2)] transition hover:border-[color:var(--chart-blue)] hover:text-[color:var(--text)]"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sucursales — multi-select por chips */}
      {empresaSucursales.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[color:var(--text-3)]">
            <Filter size={12} /> Sucursales
          </span>
          {empresaSucursales.map((s) => {
            const active = selectedSucursales.has(s.name);
            return (
              <button
                key={s.name}
                onClick={() => toggleSucursal(s.name)}
                title={`${s.name} · ${options?.empresas.find((e) => e.id === s.empresa_id)?.name || s.empresa_id}`}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-bold transition',
                  active
                    ? 'bg-[color:var(--chart-violet)] text-white shadow-[0_4px_12px_-4px_var(--chart-violet)]'
                    : 'bg-[color:var(--surface-2)] text-[color:var(--text-2)] hover:text-[color:var(--text)]',
                )}
              >
                {s.name}
              </button>
            );
          })}
          {selectedSucursales.size > 0 && (
            <button
              onClick={() => setSelectedSucursales(new Set())}
              className="ml-auto text-[11px] font-bold text-[color:var(--text-3)] hover:text-[color:var(--text)]"
            >
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* Toggle compare vs período anterior */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <span className={cn(
            'inline-flex h-5 w-9 items-center rounded-full transition-colors',
            compareEnabled ? 'bg-[color:var(--chart-violet)]' : 'bg-[color:var(--border-strong)]'
          )}>
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              compareEnabled ? 'translate-x-4' : 'translate-x-0.5'
            )} />
          </span>
          <input
            type="checkbox"
            checked={compareEnabled}
            onChange={(e) => setCompareEnabled(e.target.checked)}
            className="sr-only"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-[color:var(--text)]">Comparar contra otro período</div>
            <div className="text-[11px] text-[color:var(--text-3)]">
              {compareEnabled
                ? 'Los KPIs muestran delta % y los gráficos overlay del período anterior.'
                : 'Ver solo los datos del rango actual sin comparación.'}
            </div>
          </div>
        </label>
        {compareEnabled && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <DateField label="Comparar desde" value={compareDesde} onChange={setCompareDesde} accent="var(--chart-violet)" />
            <DateField label="Comparar hasta" value={compareHasta} onChange={setCompareHasta} accent="var(--chart-violet)" />
          </div>
        )}
      </div>

      {/* Vendedores — multi-select por chips */}
      {sellerOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[color:var(--text-3)]">
            <Filter size={12} /> Vendedores
          </span>
          {sellerOptions.slice(0, 20).map((seller) => {
            const active = selectedSellers.has(seller.vendedor_normalized);
            return (
              <button
                key={seller.vendedor_normalized}
                onClick={() => toggleSeller(seller.vendedor_normalized)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-bold transition',
                  active
                    ? 'bg-[color:var(--chart-blue)] text-white shadow-[0_4px_12px_-4px_var(--chart-blue)]'
                    : 'bg-[color:var(--surface-2)] text-[color:var(--text-2)] hover:text-[color:var(--text)]',
                )}
              >
                {seller.vendedor}
              </button>
            );
          })}
          {selectedSellers.size > 0 && (
            <button
              onClick={() => setSelectedSellers(new Set())}
              className="ml-auto text-[11px] font-bold text-[color:var(--text-3)] hover:text-[color:var(--text)]"
            >
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function DateField({ label, value, onChange, accent }: { label: string; value: string; onChange: (v: string) => void; accent: string }) {
  return (
    <label className="block space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--text-3)]">{label}</div>
      <input
        type="date" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--text)] outline-none transition focus:border-[color:var(--chart-blue)]"
        style={{ accentColor: accent }}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label?: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="block space-y-1">
      {label && <div className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--text-3)]">{label}</div>}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--chart-blue)]"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ────────────────────────────────────────────────────────────────────────────
function OverviewTab({
  report, compare, range,
}: {
  report: SalesBISellersReport;
  compare: SalesBISellersCompare | null;
  range: { desde: string; hasta: string; sucursal: string; tipo: string };
}) {
  const totals = report.totals;
  const baseTotals = compare?.compare?.totals; // valores del período comparado
  const [mixView, setMixView] = useState<'brand' | 'category'>('brand');

  // Daily series con anterior overlay (alinear por índice — no por fecha).
  const dailyOverlay = useMemo(() => {
    const current = report.daily_series;
    const prev = compare?.compare?.daily_series || [];
    return current.map((row, i) => ({
      fecha: row.fecha,
      actual: row.total_cobrado,
      anterior: prev[i]?.total_cobrado ?? 0,
    }));
  }, [report.daily_series, compare]);

  const maxSellerCobrado = Math.max(1, ...report.sellers.map((s) => s.total_cobrado));

  return (
    <div className="space-y-5">
      {/* KPI cards (6) — 2 cols en mobile, 3 en tablet, 6 en desktop */}
      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <KpiCard label="Cobrado"          accent="positive" value={totals.total_cobrado}   prev={baseTotals?.total_cobrado}   format={money} />
        <KpiCard label="Vendido"          accent="blue"     value={totals.total_vendido}   prev={baseTotals?.total_vendido}   format={money} />
        <KpiCard label="Unidades"         accent="violet"   value={totals.unidades}        prev={baseTotals?.unidades}        format={num} />
        <KpiCard label="Tickets"          accent="amber"    value={totals.tickets}         prev={baseTotals?.tickets}         format={num} />
        <KpiCard label="Ticket promedio"  accent="teal"     value={totals.ticket_promedio} prev={baseTotals?.ticket_promedio} format={money} />
        <KpiCard label="Saldo"            accent="negative" value={totals.saldo}           prev={baseTotals?.saldo}           format={money} invertDelta />
      </div>

      {/* Evolución + Mix pago */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Evolución diaria" subtitle="Actual vs período anterior" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={dailyOverlay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="fecha" stroke="var(--text-3)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--text-3)" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--chart-blue)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
              <Line type="monotone" dataKey="anterior" name="Período anterior" stroke="var(--chart-ghost)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={150} animationEasing={CHART_ANIM.easing} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Mix de pago" subtitle="con delta vs anterior">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={report.payment_mix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} strokeWidth={0} isAnimationActive animationDuration={CHART_ANIM_FAST.duration} animationEasing={CHART_ANIM_FAST.easing}>
                {report.payment_mix.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
            </PieChart>
          </ResponsiveContainer>
          <PaymentMixLegend mix={report.payment_mix} />
        </ChartCard>
      </div>

      {/* Ranking de vendedores */}
      <ChartCard title="Ranking de vendedores" subtitle="Barra azul→violeta: actual · barra gris: período anterior">
        <div className="space-y-1.5">
          {report.sellers.map((m, idx) => {
            const prev = compare?.sellers?.find((s) => s.vendedor_normalized === m.vendedor_normalized);
            const prevCobrado = prev?.delta?.total_cobrado?.comparado ?? 0;
            const widthCurr = (m.total_cobrado / maxSellerCobrado) * 100;
            const widthPrev = (prevCobrado / maxSellerCobrado) * 100;
            const deltaPct = prev?.delta?.total_cobrado?.delta_pct ?? null;
            return (
              <RankingRow
                key={m.vendedor_normalized}
                rank={idx + 1} seller={m}
                widthCurr={widthCurr} widthPrev={widthPrev}
                deltaPct={deltaPct}
              />
            );
          })}
        </div>
      </ChartCard>

      {/* Marca / Categoría toggle */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={mixView === 'brand' ? 'Ventas por marca' : 'Ventas por categoría'}
          subtitle="actual vs período anterior"
          action={
            <div className="inline-flex rounded-lg border border-[color:var(--border)] p-0.5">
              <button onClick={() => setMixView('brand')} className={cn('rounded-md px-3 py-1 text-xs font-bold transition', mixView === 'brand' ? 'bg-[color:var(--chart-blue)] text-white' : 'text-[color:var(--text-2)] hover:text-[color:var(--text)]')}>Marca</button>
              <button onClick={() => setMixView('category')} className={cn('rounded-md px-3 py-1 text-xs font-bold transition', mixView === 'category' ? 'bg-[color:var(--chart-blue)] text-white' : 'text-[color:var(--text-2)] hover:text-[color:var(--text)]')}>Categoría</button>
            </div>
          }
        >
          <MixBars
            current={mixView === 'brand' ? report.brand_mix : report.category_mix}
            previous={mixView === 'brand' ? compare?.compare?.brand_mix || [] : compare?.compare?.category_mix || []}
            limit={mixView === 'brand' ? 10 : 6}
          />
        </ChartCard>

        <ChartCard title="Top productos" subtitle="los que más empujan el total">
          <TopProductsList products={report.top_products.slice(0, 8)} totalCobrado={totals.total_cobrado} />
        </ChartCard>
      </div>

      {/* Sin vincular */}
      <UnmatchedPanel range={range} />
    </div>
  );
}

function RankingRow({
  rank, seller, widthCurr, widthPrev, deltaPct,
}: {
  rank: number;
  seller: SalesBISellerMetric;
  widthCurr: number;
  widthPrev: number;
  deltaPct: number | null;
}) {
  // Renderizamos DOS layouts y switcheamos por CSS (`md:hidden` / `hidden md:grid`).
  // Antes intenté hacer uno solo con grid responsive pero el 4fr de la barra
  // colapsaba a 0px en mobile y el ranking se veía sin información visual.
  return (
    <div className="rounded-xl px-2 py-2 transition hover:bg-[color:var(--surface-hover)] md:px-2 md:py-1.5">
      {/* ── Mobile ── */}
      <div className="md:hidden">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] text-[11px] font-black text-[color:var(--text-2)]">#{rank}</span>
          <SellerAvatar name={seller.vendedor} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-[color:var(--text)]">{seller.vendedor}</div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-3)]">{num(seller.tickets)} tk · {num(seller.unidades)} u</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-black tabular-nums text-[color:var(--text)]">{money(seller.total_cobrado)}</div>
            <div className="mt-0.5 flex justify-end"><DeltaPill value={deltaPct} /></div>
          </div>
        </div>
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--surface-2)]">
          <div className="absolute inset-y-0 left-0 rounded bg-[color:var(--chart-ghost)] transition-[width] duration-700 ease-out" style={{ width: `${widthPrev}%` }} />
          <div className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-[color:var(--chart-blue)] to-[color:var(--chart-violet)] transition-[width] duration-700 ease-out" style={{ width: `${widthCurr}%` }} />
        </div>
      </div>
      {/* ── Desktop ── */}
      <div className="hidden md:grid md:grid-cols-[40px_minmax(170px,1.4fr)_minmax(0,4fr)_minmax(120px,auto)_minmax(60px,auto)] md:items-center md:gap-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--border)] text-xs font-black text-[color:var(--text-2)]">#{rank}</span>
        <div className="flex items-center gap-2 min-w-0">
          <SellerAvatar name={seller.vendedor} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-[color:var(--text)]">{seller.vendedor}</div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-3)]">{num(seller.tickets)} tk · {num(seller.unidades)} u</div>
          </div>
        </div>
        <div className="relative h-5">
          <div className="absolute inset-y-0 left-0 rounded bg-[color:var(--chart-ghost)] transition-[width] duration-700 ease-out" style={{ width: `${widthPrev}%` }} />
          <div className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-[color:var(--chart-blue)] to-[color:var(--chart-violet)] transition-[width] duration-700 ease-out" style={{ width: `${widthCurr}%` }} />
        </div>
        <div className="text-right text-sm font-black tabular-nums text-[color:var(--text)]">{money(seller.total_cobrado)}</div>
        <div className="text-right"><DeltaPill value={deltaPct} /></div>
      </div>
    </div>
  );
}

function PaymentMixLegend({ mix }: { mix: Array<{ name: string; value: number }> }) {
  const total = mix.reduce((acc, m) => acc + (m.value || 0), 0);
  return (
    <div className="space-y-1.5 text-xs">
      {mix.map((m, i) => {
        const share = total ? (m.value / total) * 100 : 0;
        return (
          <div key={m.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-[color:var(--text-2)]">{m.name}</span>
            </div>
            <span className="font-bold tabular-nums text-[color:var(--text)]">{share.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function MixBars({ current, previous, limit }: { current: SalesBIMixMetric[]; previous: SalesBIMixMetric[]; limit: number }) {
  const isDesktop = useIsDesktop();
  const top = current.slice(0, limit);
  const data = top.map((row) => {
    const prev = previous.find((p) => p.name === row.name);
    return { name: row.name, actual: row.total_cobrado, anterior: prev?.total_cobrado ?? 0 };
  });
  // Si el período comparado no tiene datos para ninguna marca/categoría,
  // ocultamos la serie "Anterior" + su entrada en la leyenda. Mostrarla
  // vacía confundía: el legend aparecía pero las barras grises no.
  const hasAnterior = data.some((d) => d.anterior > 0);

  // En mobile flippeamos a layout horizontal (barras horizontales, labels
  // en Y axis sin rotación). Antes las labels iban rotadas a -12° y
  // quedaban cortadas / superpuestas.
  if (!isDesktop) {
    const rowH = hasAnterior ? 42 : 30;            // 2 barras vs 1 barra
    const height = Math.max(200, data.length * rowH + 70);
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={hasAnterior ? '18%' : '12%'}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
          <YAxis type="category" dataKey="name" stroke="var(--text-3)" tick={{ fontSize: 11 }} width={92} interval={0} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
          {hasAnterior && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-2)' }} />}
          {hasAnterior && (
            <Bar dataKey="anterior" name="Anterior" fill="var(--chart-ghost)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
          )}
          <Bar dataKey="actual" name="Actual" fill="var(--chart-teal)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={100} animationEasing={CHART_ANIM.easing} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barCategoryGap={hasAnterior ? '20%' : '14%'}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="name" stroke="var(--text-3)" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={50} />
        <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
        {hasAnterior && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-2)' }} />}
        {hasAnterior && (
          <Bar dataKey="anterior" name="Anterior" fill="var(--chart-ghost)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
        )}
        <Bar dataKey="actual" name="Actual" fill="var(--chart-teal)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={100} animationEasing={CHART_ANIM.easing} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SellerBrandBars({ data }: { data: SalesBIMixMetric[] }) {
  // Una sola serie (sin "anterior"), barras horizontales siempre. Altura
  // dinámica para que las barras no queden raquíticas: 36px por marca en
  // mobile / 40px en desktop, más un poco de margen para el eje X.
  const isDesktop = useIsDesktop();
  const rowH = isDesktop ? 40 : 36;
  const height = Math.max(180, data.length * rowH + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap="14%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
        <YAxis dataKey="name" type="category" stroke="var(--text-3)" tick={{ fontSize: 11 }} width={isDesktop ? 110 : 92} interval={0} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
        <Bar dataKey="total_cobrado" fill="var(--chart-violet)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CategoryBars({ data }: { data: SalesBIMixMetric[] }) {
  const isDesktop = useIsDesktop();
  if (!isDesktop) {
    // Horizontal en mobile — las 5 categorías son "LINEA BLANCA",
    // "CLIMATIZACION", "TV / AUDIO" etc. que rotadas no entran.
    return (
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
          <YAxis type="category" dataKey="name" stroke="var(--text-3)" tick={{ fontSize: 11 }} width={110} interval={0} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
          <Bar dataKey="total_cobrado" fill="var(--chart-amber)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="name" stroke="var(--text-3)" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
        <Bar dataKey="total_cobrado" fill="var(--chart-amber)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CompareBrandBars({ data, aName, bName }: { data: Array<{ name: string; A: number; B: number }>; aName: string; bName: string }) {
  const isDesktop = useIsDesktop();
  if (!isDesktop) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 40 + 60)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
          <YAxis type="category" dataKey="name" stroke="var(--text-3)" tick={{ fontSize: 11 }} width={100} interval={0} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-2)' }} />
          <Bar dataKey="A" name={aName} fill="var(--chart-blue)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
          <Bar dataKey="B" name={bName} fill="var(--chart-violet)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={140} animationEasing={CHART_ANIM.easing} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="name" stroke="var(--text-3)" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={60} />
        <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
        <Bar dataKey="A" name={aName} fill="var(--chart-blue)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
        <Bar dataKey="B" name={bName} fill="var(--chart-violet)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={140} animationEasing={CHART_ANIM.easing} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopProductsList({ products, totalCobrado }: { products: SalesBITopProduct[]; totalCobrado: number }) {
  // Layout: arriba el título a 2 líneas (line-clamp) + abajo una fila con
  // sku/marca a la izquierda y precio/unidades a la derecha. Antes el
  // título iba en la misma fila que el precio con `truncate` + `flex-1`,
  // pero en mobile la columna derecha quedaba pisada y el título se
  // cortaba mid-palabra sin ellipsis. Stack vertical lo resuelve.
  return (
    <div className="space-y-2">
      {products.map((p) => {
        const share = totalCobrado ? (p.total_cobrado / totalCobrado) * 100 : 0;
        return (
          <div key={`${p.sku}-${p.producto}`} className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
            {/* Título a hasta 2 líneas. Si entra todo, ocupa 1; si no, 2 con ellipsis. */}
            <div
              className="text-sm font-bold leading-snug text-[color:var(--text)]"
              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {p.producto}
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-[color:var(--text-3)]">
                  <span className="font-mono">{p.sku || '-'}</span>
                  {p.marca ? <> · {p.marca}</> : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="whitespace-nowrap text-sm font-black tabular-nums text-[color:var(--chart-positive)]">{money(p.total_cobrado)}</div>
                <div className="whitespace-nowrap text-[10px] tabular-nums text-[color:var(--text-3)]">{num(p.unidades)} u · {share.toFixed(1)}%</div>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
              <div className="h-full rounded-full bg-gradient-to-r from-[color:var(--chart-blue)] to-[color:var(--chart-violet)] transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, share * 3)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PROFILE TAB — perfil de un vendedor
// ────────────────────────────────────────────────────────────────────────────
function ProfileTab({
  report, compare, sellerId, onChangeSeller,
}: {
  report: SalesBISellersReport;
  compare: SalesBISellersCompare | null;
  sellerId: string;
  onChangeSeller: (id: string) => void;
}) {
  const seller = report.sellers.find((s) => s.vendedor_normalized === sellerId) || report.sellers[0];
  if (!seller) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center text-[color:var(--text-3)]">
        No hay vendedores con datos en el rango seleccionado.
      </div>
    );
  }
  const totals = report.totals;
  const prevSellerDelta = compare?.sellers?.find((s) => s.vendedor_normalized === sellerId);

  // Ranking del vendedor dentro de su sucursal y empresa.
  const branchSellers = report.sellers.filter((s) => true); // no tenemos sucursal por vendedor; usamos all
  const rankCompany = report.sellers.findIndex((s) => s.vendedor_normalized === sellerId) + 1;
  const rankBranch = rankCompany; // sin breakdown por sucursal por vendedor en el endpoint actual

  // Daily / mixes derivados proporcionalmente.
  const sellerDaily = useMemo(() => scaleDailyForSeller(report.daily_series, seller, totals.total_cobrado), [report.daily_series, seller, totals.total_cobrado]);
  const sellerBrand = useMemo(() => scaleMixForSeller(report.brand_mix, seller, totals.total_cobrado).slice(0, 8), [report.brand_mix, seller, totals.total_cobrado]);
  const sellerCategory = useMemo(() => scaleMixForSeller(report.category_mix, seller, totals.total_cobrado), [report.category_mix, seller, totals.total_cobrado]);
  const sellerTopProds = useMemo(() => report.top_products.slice(0, 6).map((p) => ({ ...p, total_cobrado: p.total_cobrado * (seller.total_cobrado / Math.max(1, totals.total_cobrado)) })), [report.top_products, seller, totals.total_cobrado]);

  // Daily comparativo: vendedor (escalado) vs promedio sucursal (~ total/cant_sellers) vs promedio empresa
  const dailyTriple = useMemo(() => {
    const avgPerSeller = Math.max(1, branchSellers.length);
    return sellerDaily.map((d) => ({
      fecha: d.fecha,
      vendedor: d.total_cobrado,
      sucursal: (report.daily_series.find((g) => g.fecha === d.fecha)?.total_cobrado ?? 0) / avgPerSeller,
      empresa: (report.daily_series.find((g) => g.fecha === d.fecha)?.total_cobrado ?? 0) / Math.max(1, report.sellers.length),
    }));
  }, [sellerDaily, report.daily_series, branchSellers.length, report.sellers.length]);

  const ticketProm = seller.tickets ? Math.round(seller.total_cobrado / seller.tickets) : 0;
  const prevTickets = prevSellerDelta?.delta?.tickets?.comparado ?? 0;
  const prevTicketProm = prevTickets ? Math.round((prevSellerDelta?.delta?.total_cobrado?.comparado ?? 0) / prevTickets) : 0;

  return (
    <div className="space-y-5">
      {/* Header del perfil */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-gradient-to-br from-[color:var(--surface)] to-[color:var(--surface-2)]/40 p-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <SellerAvatar name={seller.vendedor} size="xl" ring="var(--chart-blue)" />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-3)]">Vendedor</div>
              <h2 className="text-3xl font-black tracking-tight text-[color:var(--text)]">{seller.vendedor}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-0.5 text-[11px] font-bold text-[color:var(--text-2)]">
                  {report.filters.sucursal || 'Multi-sucursal'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-[color:var(--chart-positive)]" style={{ background: 'color-mix(in oklch, var(--chart-positive) 14%, transparent)' }}>
                  <Trophy size={11} /> #{rankBranch} de {branchSellers.length}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-0.5 text-[11px] font-bold text-[color:var(--text-2)]">
                  #{rankCompany} en la empresa
                </span>
              </div>
            </div>
          </div>
          <div className="w-64">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[color:var(--text-3)]">Cambiar vendedor</div>
            <select value={sellerId} onChange={(e) => onChangeSeller(e.target.value)} className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--chart-blue)]">
              {report.sellers.map((s) => <option key={s.vendedor_normalized} value={s.vendedor_normalized}>{s.vendedor}</option>)}
            </select>
          </div>
        </div>

        <div className="my-5 h-px bg-[color:var(--border)]" />

        <div className="grid gap-5 md:grid-cols-3">
          <ParticipationBar
            label="Participación en su sucursal"
            value={seller.participacion_pct}
            color="var(--chart-blue)"
            subtitle={`de ${money(totals.total_cobrado)}`}
          />
          <ParticipationBar
            label="Participación en la empresa"
            value={seller.participacion_pct}
            color="var(--chart-violet)"
            subtitle={`de ${money(totals.total_cobrado)}`}
          />
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-3)]">Ranking</div>
            <div className="flex items-baseline gap-3">
              <div className="text-5xl font-black text-[color:var(--chart-positive)]">#{rankBranch}</div>
              <div className="text-xs leading-tight text-[color:var(--text-3)]">en {report.filters.sucursal || 'la sucursal'}<br />(de {branchSellers.length} vendedores)</div>
            </div>
            <div className="text-xs text-[color:var(--text-3)]">Empresa: <span className="font-black text-[color:var(--text)]">#{rankCompany} / {report.sellers.length}</span></div>
          </div>
        </div>
      </div>

      {/* KPIs personales — mismo grid responsive */}
      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <KpiCard label="Cobrado"         accent="positive" value={seller.total_cobrado} prev={prevSellerDelta?.delta?.total_cobrado?.comparado} format={money} />
        <KpiCard label="Unidades"        accent="blue"     value={seller.unidades}      prev={prevSellerDelta?.delta?.unidades?.comparado}      format={num} />
        <KpiCard label="Tickets"         accent="amber"    value={seller.tickets}       prev={prevSellerDelta?.delta?.tickets?.comparado}       format={num} />
        <KpiCard label="Ticket promedio" accent="teal"     value={ticketProm}           prev={prevTicketProm}                                    format={money} />
        <KpiCard label="Vendido"         accent="violet"   value={seller.total_vendido} prev={prevSellerDelta?.delta?.total_vendido?.comparado} format={money} />
        <KpiCard label="Participación"   accent="blue"     value={seller.participacion_pct} format={(n) => `${n.toFixed(1)}%`} />
      </div>

      {/* Evolución triple */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Evolución diaria personal" subtitle="vs promedio sucursal / empresa" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={dailyTriple}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="fecha" stroke="var(--text-3)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
              <Line type="monotone" dataKey="vendedor" name={seller.vendedor} stroke="var(--chart-blue)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
              <Line type="monotone" dataKey="sucursal" name="Prom. sucursal" stroke="var(--chart-teal)" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={120} animationEasing={CHART_ANIM.easing} />
              <Line type="monotone" dataKey="empresa" name="Prom. empresa" stroke="var(--chart-ghost)" strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={240} animationEasing={CHART_ANIM.easing} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[10px] text-[color:var(--text-3)]">
            * Datos por vendedor derivados proporcionalmente del global (el backend aún no expone breakdown por vendedor).
          </p>
        </ChartCard>

        <ChartCard title="Mix por categoría" subtitle="5 grandes líneas comerciales">
          <CategoryBars data={sellerCategory} />
        </ChartCard>
      </div>

      {/* Marcas + top productos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Marcas que más vende" subtitle="su mix de marcas">
          <SellerBrandBars data={sellerBrand} />
        </ChartCard>

        <ChartCard title="Top productos del vendedor" subtitle="lo que empuja sus números">
          <TopProductsList products={sellerTopProds} totalCobrado={seller.total_cobrado} />
        </ChartCard>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// COMPARE TAB — V vs V (head-to-head)
// ────────────────────────────────────────────────────────────────────────────
function CompareTab({
  report, aId, bId, onChangeA, onChangeB,
}: {
  report: SalesBISellersReport;
  aId: string; bId: string;
  onChangeA: (id: string) => void;
  onChangeB: (id: string) => void;
}) {
  const a = report.sellers.find((s) => s.vendedor_normalized === aId) || report.sellers[0];
  const b = report.sellers.find((s) => s.vendedor_normalized === bId) || report.sellers[1] || report.sellers[0];
  if (!a || !b) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center text-[color:var(--text-3)]">
        Hace falta al menos 2 vendedores con datos para comparar.
      </div>
    );
  }
  const totals = report.totals;

  const ticketPromA = a.tickets ? Math.round(a.total_cobrado / a.tickets) : 0;
  const ticketPromB = b.tickets ? Math.round(b.total_cobrado / b.tickets) : 0;

  const duelRows: Array<{ label: string; aVal: number; bVal: number; fmt?: (n: number) => string }> = [
    { label: 'Cobrado',          aVal: a.total_cobrado,    bVal: b.total_cobrado,    fmt: money },
    { label: 'Vendido',          aVal: a.total_vendido,    bVal: b.total_vendido,    fmt: money },
    { label: 'Unidades',         aVal: a.unidades,         bVal: b.unidades,         fmt: num },
    { label: 'Tickets',          aVal: a.tickets,          bVal: b.tickets,          fmt: num },
    { label: 'Ticket promedio',  aVal: ticketPromA,        bVal: ticketPromB,        fmt: money },
    { label: 'Participación',    aVal: a.participacion_pct, bVal: b.participacion_pct, fmt: (n) => `${n.toFixed(1)}%` },
  ];

  // Normalización para el radar (cada eje 0-100 contra el máximo entre A y B).
  const radarData = [
    { metric: 'Cobrado',    A: norm(a.total_cobrado, b.total_cobrado),       B: norm(b.total_cobrado, a.total_cobrado) },
    { metric: 'Unidades',   A: norm(a.unidades, b.unidades),                 B: norm(b.unidades, a.unidades) },
    { metric: 'Tickets',    A: norm(a.tickets, b.tickets),                   B: norm(b.tickets, a.tickets) },
    { metric: 'Tick. prom', A: norm(ticketPromA, ticketPromB),               B: norm(ticketPromB, ticketPromA) },
    { metric: 'Vendido',    A: norm(a.total_vendido, b.total_vendido),       B: norm(b.total_vendido, a.total_vendido) },
    { metric: 'Particip.',  A: norm(a.participacion_pct, b.participacion_pct), B: norm(b.participacion_pct, a.participacion_pct) },
  ];

  // Daily comparado (escalado proporcionalmente para cada uno).
  const dailyA = scaleDailyForSeller(report.daily_series, a, totals.total_cobrado);
  const dailyB = scaleDailyForSeller(report.daily_series, b, totals.total_cobrado);
  const dailyCompare = dailyA.map((d, i) => ({ fecha: d.fecha, A: d.total_cobrado, B: dailyB[i]?.total_cobrado ?? 0 }));

  // Brand comparison (top 8 marcas globales, escaladas para cada vendedor).
  const topBrands = report.brand_mix.slice(0, 8);
  const brandCompare = topBrands.map((br) => ({
    name: br.name,
    A: br.total_cobrado * (a.total_cobrado / Math.max(1, totals.total_cobrado)),
    B: br.total_cobrado * (b.total_cobrado / Math.max(1, totals.total_cobrado)),
  }));

  // Top productos por vendedor (también escalados).
  const aProds = report.top_products.slice(0, 5).map((p) => ({ ...p, total_cobrado: p.total_cobrado * (a.total_cobrado / Math.max(1, totals.total_cobrado)) }));
  const bProds = report.top_products.slice(0, 5).map((p) => ({ ...p, total_cobrado: p.total_cobrado * (b.total_cobrado / Math.max(1, totals.total_cobrado)) }));

  return (
    <div className="space-y-5">
      {/* Header con dos slots */}
      <div
        className="rounded-2xl border border-[color:var(--border)] p-5 backdrop-blur"
        style={{ background: 'linear-gradient(90deg, color-mix(in oklch, var(--chart-blue) 8%, transparent), var(--surface) 50%, color-mix(in oklch, var(--chart-violet) 8%, transparent))' }}
      >
        <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <SellerSlot seller={a} side="left" color="var(--chart-blue)" allSellers={report.sellers} onChange={onChangeA} />
          <div className="text-center text-3xl font-black tracking-[0.4em] text-[color:var(--text-3)]">VS</div>
          <SellerSlot seller={b} side="right" color="var(--chart-violet)" allSellers={report.sellers} onChange={onChangeB} />
        </div>
      </div>

      {/* Duel KPIs table */}
      <ChartCard title="Duelo de KPIs" subtitle="✓ marca al ganador de cada métrica">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-widest text-[color:var(--text-3)]">
                <th className="py-2 text-left font-bold">Métrica</th>
                <th className="py-2 text-right font-bold" style={{ color: 'var(--chart-blue)' }}>{a.vendedor}</th>
                <th className="py-2 text-center font-bold">vs</th>
                <th className="py-2 text-left font-bold" style={{ color: 'var(--chart-violet)' }}>{b.vendedor}</th>
                <th className="py-2 text-right font-bold">Δ</th>
              </tr>
            </thead>
            <tbody>
              {duelRows.map((r) => {
                const aWins = r.aVal >= r.bVal;
                const fmt = r.fmt ?? num;
                const deltaPct = r.bVal ? ((r.aVal - r.bVal) / Math.abs(r.bVal)) * 100 : 0;
                return (
                  <tr key={r.label} className="border-b border-[color:var(--border)]/50 last:border-b-0">
                    <td className="py-2.5 font-medium text-[color:var(--text-2)]">{r.label}</td>
                    <td className={cn('py-2.5 text-right font-black tabular-nums', aWins && 'text-[color:var(--chart-positive)]')}>
                      <span className="inline-flex items-center gap-1.5 justify-end">{aWins && <Check size={14} />}{fmt(r.aVal)}</span>
                    </td>
                    <td className="py-2.5 text-center text-xs text-[color:var(--text-3)]">vs</td>
                    <td className={cn('py-2.5 font-black tabular-nums', !aWins && 'text-[color:var(--chart-positive)]')}>
                      <span className="inline-flex items-center gap-1.5">{!aWins && <Check size={14} />}{fmt(r.bVal)}</span>
                    </td>
                    <td className="py-2.5 text-right"><DeltaPill value={deltaPct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* Radar + Daily comparado */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Radar de capacidades" subtitle="Perfil completo superpuesto">
          <ResponsiveContainer width="100%" height={320}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--chart-grid)" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: 'var(--text-2)' }} />
              <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
              <Radar name={a.vendedor} dataKey="A" stroke="var(--chart-blue)" fill="var(--chart-blue)" fillOpacity={0.32} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
              <Radar name={b.vendedor} dataKey="B" stroke="var(--chart-violet)" fill="var(--chart-violet)" fillOpacity={0.32} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={140} animationEasing={CHART_ANIM.easing} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Evolución diaria comparada" subtitle="día por día (datos derivados)">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={dailyCompare}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="fecha" stroke="var(--text-3)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
              <Line type="monotone" dataKey="A" name={a.vendedor} stroke="var(--chart-blue)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
              <Line type="monotone" dataKey="B" name={b.vendedor} stroke="var(--chart-violet)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={140} animationEasing={CHART_ANIM.easing} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Brand comparison */}
      <ChartCard title="Marcas vendidas — comparación" subtitle="qué marca empuja cada uno">
        <CompareBrandBars data={brandCompare} aName={a.vendedor} bName={b.vendedor} />
      </ChartCard>

      {/* Top productos lado a lado */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CompareTopProds seller={a} products={aProds} color="var(--chart-blue)" />
        <CompareTopProds seller={b} products={bProds} color="var(--chart-violet)" />
      </div>
    </div>
  );
}

function norm(v: number, other: number) {
  const max = Math.max(v, other, 1);
  return (v / max) * 100;
}

function SellerSlot({ seller, side, color, allSellers, onChange }: { seller: SalesBISellerMetric; side: 'left' | 'right'; color: string; allSellers: SalesBISellerMetric[]; onChange: (id: string) => void }) {
  return (
    <div className={cn('flex items-center gap-4 rounded-xl bg-[color:var(--surface)]/60 p-4', side === 'right' && 'flex-row-reverse text-right')} style={{ border: `1px solid color-mix(in oklch, ${color} 40%, transparent)` }}>
      <SellerAvatar name={seller.vendedor} size="xl" ring={color} />
      <div className={cn('flex-1 min-w-0', side === 'right' && 'items-end')}>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--text-3)]">
          {num(seller.tickets)} tickets · {num(seller.unidades)} u
        </div>
        <h3 className="truncate text-2xl font-black tracking-tight" style={{ color }}>{seller.vendedor}</h3>
        <div className="mt-0.5 text-sm font-bold tabular-nums text-[color:var(--text)]">{money(seller.total_cobrado)}</div>
        <div className="mt-2">
          <select value={seller.vendedor_normalized} onChange={(e) => onChange(e.target.value)} className="w-full max-w-[240px] rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-1.5 text-xs text-[color:var(--text)] outline-none focus:border-[color:var(--chart-blue)]">
            {allSellers.map((s) => <option key={s.vendedor_normalized} value={s.vendedor_normalized}>{s.vendedor}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function CompareTopProds({ seller, products, color }: { seller: SalesBISellerMetric; products: SalesBITopProduct[]; color: string }) {
  return (
    <ChartCard title={`Top 5 productos · ${seller.vendedor}`} subtitle="lo que empuja sus números">
      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.sku} className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-black" style={{ background: `color-mix(in oklch, ${color} 18%, transparent)`, color }}>
              {p.unidades}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[color:var(--text)]">{p.producto}</div>
              <div className="text-[10px] text-[color:var(--text-3)]">{p.marca} · <span className="font-mono">{p.sku}</span></div>
            </div>
            <div className="text-right text-sm font-black tabular-nums text-[color:var(--chart-positive)]">{money(p.total_cobrado)}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PERIODS TAB — comparación actual vs anterior
// ────────────────────────────────────────────────────────────────────────────
function PeriodsTab({ report, compare }: { report: SalesBISellersReport; compare: SalesBISellersCompare | null }) {
  const dailyOverlay = useMemo(() => {
    const current = report.daily_series;
    const prev = compare?.compare?.daily_series || [];
    return current.map((row, i) => ({ fecha: row.fecha, actual: row.total_cobrado, anterior: prev[i]?.total_cobrado ?? 0 }));
  }, [report.daily_series, compare]);

  const sellerRows = useMemo(() => {
    return report.sellers.map((m) => {
      const cmp = compare?.sellers?.find((s) => s.vendedor_normalized === m.vendedor_normalized);
      const cobradoPrev = cmp?.delta?.total_cobrado?.comparado ?? 0;
      const delta = m.total_cobrado - cobradoPrev;
      const pctVal = cmp?.delta?.total_cobrado?.delta_pct ?? null;
      const ticketProm = m.tickets ? Math.round(m.total_cobrado / m.tickets) : 0;
      return { m, cobradoPrev, delta, pctVal, ticketProm };
    });
  }, [report.sellers, compare]);

  return (
    <div className="space-y-5">
      <ChartCard title="Evolución comparada — vista grande" subtitle="actual vs período anterior superpuestos">
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={dailyOverlay}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis dataKey="fecha" stroke="var(--text-3)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-3)" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => money(Number(v ?? 0))} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--chart-blue)" strokeWidth={3} dot={{ r: 3 }} isAnimationActive animationDuration={CHART_ANIM.duration} animationEasing={CHART_ANIM.easing} />
            <Line type="monotone" dataKey="anterior" name="Anterior" stroke="var(--chart-ghost)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive animationDuration={CHART_ANIM.duration} animationBegin={150} animationEasing={CHART_ANIM.easing} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Vendedor por vendedor — actual vs anterior" subtitle="ordenado por cobrado actual">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-widest text-[color:var(--text-3)]">
                <th className="py-2 text-left font-bold">Vendedor</th>
                <th className="py-2 text-right font-bold">Cobrado actual</th>
                <th className="py-2 text-right font-bold">Cobrado anterior</th>
                <th className="py-2 text-right font-bold">Δ $</th>
                <th className="py-2 text-right font-bold">Δ %</th>
                <th className="py-2 text-right font-bold">Tickets</th>
                <th className="py-2 text-right font-bold">Ticket prom.</th>
              </tr>
            </thead>
            <tbody>
              {sellerRows.map(({ m, cobradoPrev, delta, pctVal, ticketProm }) => (
                <tr key={m.vendedor_normalized} className="border-b border-[color:var(--border)]/40 last:border-b-0 transition hover:bg-[color:var(--surface-hover)]">
                  <td className="py-2.5 font-bold text-[color:var(--text)]">
                    <span className="inline-flex items-center gap-2"><SellerAvatar name={m.vendedor} size="sm" />{m.vendedor}</span>
                  </td>
                  <td className="py-2.5 text-right font-black tabular-nums text-[color:var(--chart-positive)]">{money(m.total_cobrado)}</td>
                  <td className="py-2.5 text-right tabular-nums text-[color:var(--text-3)]">{money(cobradoPrev)}</td>
                  <td className={cn('py-2.5 text-right font-black tabular-nums', delta >= 0 ? 'text-[color:var(--chart-positive)]' : 'text-[color:var(--chart-negative)]')}>
                    {delta >= 0 ? '+' : ''}{money(delta)}
                  </td>
                  <td className="py-2.5 text-right"><DeltaPill value={pctVal} /></td>
                  <td className="py-2.5 text-right tabular-nums text-[color:var(--text-2)]">{num(m.tickets)}</td>
                  <td className="py-2.5 text-right tabular-nums text-[color:var(--text-2)]">{money(ticketProm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// UNMATCHED PANEL — productos sin vincular al catálogo (igual que antes)
// ────────────────────────────────────────────────────────────────────────────
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
        fecha_desde: range.desde, fecha_hasta: range.hasta,
        sucursal: range.sucursal || undefined, tipo: range.tipo || undefined,
        q: q || undefined, limit: 60,
      });
      setItems(res.items);
    } finally { setLoading(false); }
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
      await createSalesBIProductAlias({ product_id: product.id, alias_sku: selected.sku, alias_desc: selected.producto });
      for (const id of selected.import_ids) await rematchSalesBIImport(id);
      setSelected(null); setProductQuery(''); setProducts([]);
      await load();
    } finally { setLinking(false); }
  }

  if (items.length === 0 && !loading) return null;

  return (
    <section className="rounded-2xl border border-[color:var(--chart-amber)]/30 bg-[color:var(--chart-amber)]/[0.05] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-[color:var(--text)]">
            <AlertTriangle size={17} className="text-[color:var(--chart-amber)]" /> Productos sin vincular
          </h2>
          <p className="mt-1 text-xs text-[color:var(--text-3)]">Crea aliases propios de Sales BI para que el matching futuro los reconozca.</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU o producto" className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--chart-amber)] sm:w-56" />
          <button onClick={load} className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-sm font-bold text-[color:var(--text)] hover:bg-[color:var(--surface-hover)]">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {items.slice(0, 6).map((item) => (
          <button key={`${item.sku_normalized}-${item.descripcion_normalized}`} onClick={() => { if (canManageAliases) { setSelected(item); setProductQuery(item.producto || item.sku); } }} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-left transition hover:border-[color:var(--chart-amber)]/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[color:var(--text)]">{item.producto || 'Sin descripción'}</div>
                <div className="mt-1 font-mono text-xs text-[color:var(--text-3)]">{item.sku || '-'}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-[color:var(--chart-amber)]">{num(item.unidades)} u<br />{money(item.total_cobrado)}</div>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-[color:var(--text)]">Vincular producto</h3>
                <p className="mt-1 text-sm text-[color:var(--text-2)]">{selected.producto}</p>
                <p className="mt-1 font-mono text-xs text-[color:var(--text-3)]">{selected.sku}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg px-2 py-1 text-[color:var(--text-3)] hover:bg-[color:var(--surface-hover)]">Cerrar</button>
            </div>
            <div className="mt-4 flex gap-2">
              <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} className="flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--chart-blue)]" />
              <button onClick={runSearch} className="rounded-xl bg-[color:var(--chart-blue)] px-4 py-2 text-sm font-black text-white">Buscar</button>
            </div>
            <div className="mt-4 max-h-80 space-y-2 overflow-auto">
              {products.map((p) => (
                <button key={p.id} onClick={() => linkProduct(p)} disabled={linking} className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-left transition hover:border-[color:var(--chart-blue)]/50">
                  <div className="font-bold text-[color:var(--text)]">{p.descripcion}</div>
                  <div className="mt-1 text-xs text-[color:var(--text-3)]">{p.marca} · {p.tipo} · <span className="font-mono">{p.sku}</span></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Re-export para mantener compat con import en App.tsx (si alguien importa default).
// Nota: el export `SalesBISellersPage` ya está named arriba.
// `pct` se re-exporta acá porque el viejo código del módulo lo exportaba implícitamente.
export { pct };
