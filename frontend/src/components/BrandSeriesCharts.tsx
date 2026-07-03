/**
 * Gráficos de evolución COMPARADA por marca para la pestaña Marcas:
 * 1. "Evolución por marca": líneas del top 6 de marcas en el tiempo.
 * 2. "Impacto en la empresa": área apilada 100% con el share de cada marca.
 * Consumen `report.brand_series` (top 6 + OTRAS, granularidad automática).
 */
import { useMemo } from 'react';
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { SalesBICommercialReport } from '../types';
import {
  CHART_TOOLTIP_ITEM_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE,
  ChartCard, EmptyChartState, money, num,
} from './SalesBIWidgets';

type MetricMode = 'units' | 'pvp' | 'both';
type BrandSeries = NonNullable<SalesBICommercialReport['brand_series']>;

const SERIES_COLORS = [
  'var(--chart-blue)',
  'var(--chart-violet)',
  'var(--chart-teal)',
  'var(--chart-amber)',
  '#ec4899',
  '#22c55e',
];
const OTRAS_COLOR = '#475569';

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function keyLabel(key: string, granularity: BrandSeries['granularity']) {
  if (granularity === 'monthly') {
    const [year, month] = key.split('-').map(Number);
    return `${MESES_CORTOS[(month || 1) - 1]} ${String(year || 0).slice(2)}`;
  }
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
}

function granularityLabel(granularity: BrandSeries['granularity']) {
  if (granularity === 'daily') return 'diaria';
  if (granularity === 'weekly') return 'semanal';
  return 'mensual';
}

function compactMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}MM`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function BrandSeriesCharts({
  series, mode, onSelectBrand,
}: {
  series?: BrandSeries;
  mode: MetricMode;
  onSelectBrand?: (name: string) => void;
}) {
  const useUnits = mode === 'units';
  const metricOf = (v: { total_vendido: number; unidades: number }) => (useUnits ? v.unidades : v.total_vendido);

  const { evolution, shares, brands } = useMemo(() => {
    if (!series || !series.rows.length) return { evolution: [], shares: [], brands: [] as string[] };
    const names = series.top_brands;
    const evolutionRows = series.rows.map((row) => {
      const out: Record<string, number | string> = { label: keyLabel(row.key, series.granularity) };
      names.forEach((n) => { out[n] = metricOf(row.brands[n] || { total_vendido: 0, unidades: 0 }); });
      return out;
    });
    const shareRows = series.rows.map((row) => {
      const total = Math.max(1e-9, useUnits ? row.market_unidades : row.market_pvp);
      const out: Record<string, number | string> = { label: keyLabel(row.key, series.granularity) };
      [...names, 'OTRAS'].forEach((n) => {
        const v = row.brands[n] || { total_vendido: 0, unidades: 0 };
        out[n] = Number(((metricOf(v) / total) * 100).toFixed(2));
      });
      return out;
    });
    return { evolution: evolutionRows, shares: shareRows, brands: names };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, useUnits]);

  if (!series || !series.rows.length || !brands.length) {
    return null;
  }

  const fmt = useUnits ? (v: number) => num(v) : (v: number) => money(v);
  const axisFmt = useUnits ? (v: number) => num(v) : compactMoney;
  const gran = granularityLabel(series.granularity);
  const metricName = useUnits ? 'unidades' : 'PVP vendido';

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Evolución por marca"
        subtitle={`Top ${brands.length} marcas · ${metricName} · vista ${gran} (clic en la leyenda para ir a la marca)`}
      >
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={evolution} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
            <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
            <YAxis tickFormatter={axisFmt} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={54} />
            <Tooltip
              formatter={(value, name) => [fmt(Number(value)), String(name)]}
              contentStyle={CHART_TOOLTIP_STYLE}
              labelStyle={CHART_TOOLTIP_LABEL_STYLE}
              itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, cursor: onSelectBrand ? 'pointer' : 'default' }}
              onClick={(entry) => { const name = String(entry?.value || ''); if (name && name !== 'OTRAS') onSelectBrand?.(name); }}
            />
            {brands.map((name, i) => (
              <Line
                key={name}
                dataKey={name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={i === 0 ? 3 : 2}
                dot={{ r: 2.5 }}
                activeDot={{ r: 4, onClick: () => onSelectBrand?.(name) }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Impacto en la empresa"
        subtitle={`Participación % de cada marca sobre el total · ${metricName} · vista ${gran}`}
      >
        {shares.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={shares} margin={{ top: 8, right: 12, left: 8, bottom: 4 }} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
              <XAxis dataKey="label" tick={{ fill: '#B8C5DA', fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: '#B8C5DA', fontSize: 10 }} width={40} />
              <Tooltip
                formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, cursor: onSelectBrand ? 'pointer' : 'default' }}
                onClick={(entry) => { const name = String(entry?.value || ''); if (name && name !== 'OTRAS') onSelectBrand?.(name); }}
              />
              {[...brands, 'OTRAS'].map((name, i) => (
                <Area
                  key={name}
                  dataKey={name}
                  stackId="share"
                  stroke="none"
                  fill={name === 'OTRAS' ? OTRAS_COLOR : SERIES_COLORS[i % SERIES_COLORS.length]}
                  fillOpacity={0.85}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : <EmptyChartState minHeight={300} />}
      </ChartCard>
    </div>
  );
}
