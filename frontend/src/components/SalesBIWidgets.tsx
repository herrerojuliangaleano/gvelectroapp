/**
 * Componentes del dashboard de Inteligencia Comercial — Métricas de vendedores.
 *
 * Diseño: 4 pestañas (Overview / Perfil vendedor / Comparador V vs V / Comparar
 * períodos) con paleta dark azul-violeta-verde definida en `styles.css` como
 * `--chart-*` (OKLCH). Animaciones de gráficos con curva ease-out y duración
 * acotada para que se sientan profesionales y no juguetonas.
 *
 * Los widgets se aíslan acá para mantener `SalesBISellersPage.tsx` enfocado en
 * lógica de datos y orquestación de pestañas.
 */
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  Area, ComposedChart, Line, ResponsiveContainer,
} from 'recharts';

// ── Media query hook ───────────────────────────────────────────────────────
/** Devuelve true si el viewport matchea la query. Reactivo a resize. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** `true` en viewports >= 768px (Tailwind `md:`). */
export function useIsDesktop() {
  return useMediaQuery('(min-width: 768px)');
}

// ── Animaciones (constantes para usar en todos los charts) ──────────────────
export const CHART_ANIM = {
  duration: 900,        // ms — suave pero no lento
  easing: 'ease-out',   // entra rápido, frena al final
} as const;

export const CHART_ANIM_FAST = {
  duration: 600,
  easing: 'ease-out',
} as const;

// ── Tooltip style común para Recharts ───────────────────────────────────────
export const CHART_TOOLTIP_STYLE = {
  background: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 10,
  fontSize: 12,
  color: '#F1F5F9',
  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
  padding: '8px 10px',
};

// Estilos compartidos para label y items del tooltip — definidos aparte
// porque `contentStyle` no se propaga a los hijos. Sin estos, Recharts
// pintaba el "series : value" con gris bajo contraste que no se leia
// sobre el fondo dark.
export const CHART_TOOLTIP_LABEL_STYLE = {
  color: '#F8FAFC',
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  marginBottom: 4,
};

export const CHART_TOOLTIP_ITEM_STYLE = {
  color: '#F1F5F9',
  fontWeight: 600,
  fontSize: 12,
};

// ── Format helpers ──────────────────────────────────────────────────────────
export function money(n?: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
}

export function num(n?: number) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
}

export function pct(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

// ── Sparkline data builder ──────────────────────────────────────────────────
/** Genera puntos sintéticos entre `prev` y `value` con jitter para sparkline. */
export function buildSparkline(prev: number, value: number, points = 12) {
  const out: Array<{ actual: number; anterior: number }> = [];
  const drift = (value - prev) / Math.max(1, points - 1);
  for (let i = 0; i < points; i += 1) {
    const t = i / Math.max(1, points - 1);
    // Senoidal chiquita para que no sea recta
    const jitter = Math.sin(i * 1.7) * Math.abs(value - prev) * 0.06;
    out.push({
      actual: prev + drift * i + jitter,
      anterior: prev + (Math.sin(i * 1.1) * Math.abs(prev) * 0.04),
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Tabs (sin librería externa — estado controlado, accesible)
// ────────────────────────────────────────────────────────────────────────────
export interface TabDef {
  value: string;
  label: string;
  /** Versión abreviada para mobile (<sm). Si no se pasa, usa `label`. */
  shortLabel?: string;
  icon?: ReactNode;
}

export function Tabs({
  value, onValueChange, tabs,
}: { value: string; onValueChange: (v: string) => void; tabs: TabDef[] }) {
  return (
    // En mobile el container scrollea horizontal si hace falta. En desktop
    // queda como pill compacto. `whitespace-nowrap` en cada botón evita que
    // labels largos como "Comparador V vs V" se partan en varias líneas.
    <div
      role="tablist"
      className="-mx-1 flex h-11 items-center gap-1 overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-1 px-2 sm:inline-flex sm:overflow-visible sm:px-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-200 sm:gap-2 sm:px-4 sm:py-2 sm:text-sm',
              active
                ? 'bg-[color:var(--chart-blue)] text-white shadow-[0_4px_14px_-4px_var(--chart-blue)]'
                : 'text-[color:var(--text-2)] hover:bg-white/[0.04] hover:text-white',
            )}
          >
            {tab.icon}
            {/* Label corto en mobile, largo en desktop */}
            <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SellerAvatar — placeholder con iniciales sobre gradient suave.
// Preparado para recibir `photoUrl` cuando el sistema tenga fotos reales.
// ────────────────────────────────────────────────────────────────────────────
export function SellerAvatar({
  name, size = 'md', ring, photoUrl,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Si se pasa, dibuja un ring del color dado (ej. var(--chart-blue)). */
  ring?: string;
  /** Futuro: URL de foto real del vendedor. Hoy ignorado, dejado por contrato. */
  photoUrl?: string;
}) {
  void photoUrl; // reservado para una iteración futura
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
  const sizes = {
    sm: 'h-8 w-8 text-[11px]',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-base',
    xl: 'h-20 w-20 text-xl',
  } as const;
  // Tono pseudo-aleatorio pero estable por nombre (para que no cambie en cada render).
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 font-black text-white shadow-inner',
        sizes[size],
      )}
      style={{
        background: `linear-gradient(135deg, oklch(0.55 0.18 ${hue}) 0%, oklch(0.42 0.15 ${(hue + 50) % 360}) 100%)`,
        boxShadow: ring ? `0 0 0 2px ${ring}, inset 0 1px 0 rgba(255,255,255,0.18)` : undefined,
      }}
      title={name}
    >
      {initials}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ChartCard — wrapper estándar para todas las tarjetas con título + chart
// ────────────────────────────────────────────────────────────────────────────
export function ChartCard({
  title, subtitle, action, children, className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-5 backdrop-blur space-y-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-3)]">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-[color:var(--text-3)]/80">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KpiCard — valor grande + delta badge + sparkline overlay (actual vs anterior)
// ────────────────────────────────────────────────────────────────────────────
export function EmptyChartState({
  title = 'Sin datos para graficar',
  description = 'Ajusta los filtros o importa informacion para este periodo.',
  minHeight = 220,
}: {
  title?: string;
  description?: string;
  minHeight?: number;
}) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-950/30 p-5 text-center"
      style={{ minHeight }}
    >
      <div className="max-w-sm">
        <div className="text-sm font-black text-[color:var(--text)]">{title}</div>
        <p className="mt-1 text-xs leading-5 text-[color:var(--text-3)]">{description}</p>
      </div>
    </div>
  );
}

type KpiAccent = 'blue' | 'teal' | 'amber' | 'violet' | 'positive' | 'negative';

const ACCENT_TO_COLOR: Record<KpiAccent, string> = {
  blue: 'var(--chart-blue)',
  teal: 'var(--chart-teal)',
  amber: 'var(--chart-amber)',
  violet: 'var(--chart-violet)',
  positive: 'var(--chart-positive)',
  negative: 'var(--chart-negative)',
};

export function KpiCard({
  label, value, prev, accent = 'blue', format = (n) => num(n), invertDelta = false, note,
}: {
  label: string;
  value: number;
  prev?: number;
  accent?: KpiAccent;
  format?: (n: number) => string;
  /** Si true, un delta negativo se muestra en verde (ej. saldo, costos). */
  invertDelta?: boolean;
  /** Línea chica bajo el valor (ej. "Prom. sucursal: $X"). */
  note?: string;
}) {
  const safePrev = typeof prev === 'number' && Number.isFinite(prev) ? prev : 0;
  const rawPct = safePrev !== 0 ? ((value - safePrev) / Math.abs(safePrev)) * 100 : 0;
  const up = rawPct >= 0;
  const positiveDirection = invertDelta ? !up : up;
  const accentColor = ACCENT_TO_COLOR[accent];
  const gradId = `kpi-grad-${label.replace(/[^a-z0-9]/gi, '')}`;
  const data = buildSparkline(safePrev, value, 14);
  return (
    // Padding y tipografía responsive — en mobile el card es más chico para
    // que entren 2-3 por fila sin gigantes.
    <div className="group relative overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/60 p-3 backdrop-blur transition-colors duration-200 hover:border-[color:var(--border-strong)] sm:p-4">
      <div className="flex items-start justify-between gap-1.5 sm:gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-3)] sm:text-[11px] sm:tracking-[0.18em]">{label}</div>
        {Number.isFinite(rawPct) && safePrev !== 0 && (
          <div
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums sm:px-2 sm:text-[11px]',
              positiveDirection ? 'text-[color:var(--chart-positive)]' : 'text-[color:var(--chart-negative)]',
            )}
            style={{
              background: positiveDirection
                ? 'color-mix(in oklch, var(--chart-positive) 14%, transparent)'
                : 'color-mix(in oklch, var(--chart-negative) 14%, transparent)',
            }}
          >
            {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {up ? '+' : ''}{rawPct.toFixed(1)}%
          </div>
        )}
      </div>
      <div className="mt-1 text-base font-black tracking-tight text-[color:var(--text)] tabular-nums sm:mt-1.5 sm:text-2xl">{format(value)}</div>
      {note && <div className="mt-0.5 truncate text-[10px] text-[color:var(--text-3)]">{note}</div>}
      <div className="mt-2 h-9 sm:mt-3 sm:h-12">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity={0.50} />
                <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="actual"
              stroke={accentColor}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              isAnimationActive
              animationDuration={CHART_ANIM_FAST.duration}
              animationEasing={CHART_ANIM_FAST.easing}
            />
            <Line
              type="monotone"
              dataKey="anterior"
              stroke="var(--chart-ghost)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive
              animationDuration={CHART_ANIM_FAST.duration}
              animationBegin={120}
              animationEasing={CHART_ANIM_FAST.easing}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ParticipationBar — % grande + barra animada
// ────────────────────────────────────────────────────────────────────────────
export function ParticipationBar({
  label, value, color, subtitle,
}: {
  label: string;
  value: number;
  color: string;
  subtitle?: string;
}) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-3)]">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black tabular-nums" style={{ color }}>{safe.toFixed(1)}%</span>
        {subtitle && <span className="text-xs text-[color:var(--text-3)]">{subtitle}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-2)]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${safe}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DeltaPill — chip chico para deltas en tablas/listas
// ────────────────────────────────────────────────────────────────────────────
export function DeltaPill({ value, invert = false, format = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%` }: {
  value: number | null | undefined;
  invert?: boolean;
  format?: (n: number) => string;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-[color:var(--text-3)]">-</span>;
  }
  const up = value >= 0;
  const positive = invert ? !up : up;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
        positive ? 'text-[color:var(--chart-positive)]' : 'text-[color:var(--chart-negative)]',
      )}
      style={{
        background: positive
          ? 'color-mix(in oklch, var(--chart-positive) 14%, transparent)'
          : 'color-mix(in oklch, var(--chart-negative) 14%, transparent)',
      }}
    >
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {format(value)}
    </span>
  );
}
