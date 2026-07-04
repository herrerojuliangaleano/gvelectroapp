import type { SalesBIBrandDossier } from '../types';

type PptxModule = typeof import('pptxgenjs');

const FONT = 'Arial';
const BG = 'F8FAFC';
const INK = '0F172A';
const MUTED = '64748B';
const LINE = 'CBD5E1';
const BRAND_FALLBACK = '1428A0';
const TEAL = '21867A';
const VIOLET = '7B61B8';
const AMBER = 'C9892B';
const GREEN = '4B8A5B';
const CARD = 'FFFFFF';
const SOFT_NOTE = 'E7ECF3';
const TABLE_HEADER = '334155';

const TYPE_COLORS = ['2A9D8F', 'D99A2B', '7B61B8', 'D06A7A', '3E8FB8', '6FA35D', 'C06F3E', '7D87C9'];
const COMPETITOR_COLORS = ['C77955', '2A9D8F', '8B6FB4', '6FA35D', 'D49A3A', 'D06A7A'];
const ZONE_COLORS = ['2F6F9F', '5A9B6D', 'D49A3A', '8B6FB4'];
const REST_COLOR = 'C77955';
const MARKET_COLOR = 'D49A3A';
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function money(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function compactMoney(value: number): string {
  const abs = Math.abs(value || 0);
  if (abs >= 1_000_000_000) return `$ ${(value / 1_000_000_000).toFixed(1)}MM`;
  if (abs >= 1_000_000) return `$ ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$ ${(value / 1_000).toFixed(0)}K`;
  return money(value);
}

function num(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value || 0);
}

function pct(value: number, digits = 1): string {
  return `${(value || 0).toFixed(digits)}%`;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function monthLabel(mes: string): string {
  const [year, month] = mes.split('-').map(Number);
  return `${MONTH_LABELS[(month || 1) - 1]} ${String(year || '').slice(2)}`;
}

function cleanFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'marca';
}

function pptColor(hex: string | undefined, fallback = BRAND_FALLBACK): string {
  const clean = (hex || '').replace('#', '').trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(clean) ? clean : fallback;
}

function mixColor(color: string, target: string, amount: number): string {
  const parse = (value: string) => [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  const [r, g, b] = parse(pptColor(color));
  const [tr, tg, tb] = parse(pptColor(target));
  const mix = (from: number, to: number) => Math.round(from + (to - from) * amount).toString(16).padStart(2, '0');
  return `${mix(r, tr)}${mix(g, tg)}${mix(b, tb)}`.toUpperCase();
}

function growth(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function chartData(name: string, labels: string[], values: number[]) {
  return [{ name, labels, values }];
}

function normalizeLabel(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function brandVsRestChartData(brandName: string, labels: string[], values: number[]) {
  const brandKey = normalizeLabel(brandName);
  return [
    {
      name: brandName,
      labels,
      values: values.map((value, index) => (normalizeLabel(labels[index]) === brandKey ? value : 0)),
    },
    {
      name: 'Otras marcas',
      labels,
      values: values.map((value, index) => (normalizeLabel(labels[index]) === brandKey ? 0 : value)),
    },
  ];
}

function branchShareUnits(row: SalesBIBrandDossier['branches'][number]): number {
  if (typeof row.share_units_in_branch_pct === 'number') return row.share_units_in_branch_pct;
  return row.market_unidades ? (row.brand_unidades / row.market_unidades) * 100 : 0;
}

function textCell(text: string, bold = false, color = INK, fill = 'FFFFFF', fontSize = bold ? 8.5 : 8) {
  return {
    text,
    options: {
      bold,
      color,
      fill,
      fontFace: FONT,
      fontSize,
      margin: 0.05,
      border: { type: 'solid', color: LINE, pt: 0.5 },
    },
  };
}

function title(slide: any, value: string, subtitle?: string) {
  slide.addText(value, { x: 0.45, y: 0.28, w: 8.5, h: 0.35, fontFace: FONT, fontSize: 19, bold: true, color: INK, margin: 0 });
  if (subtitle) {
    slide.addText(subtitle, { x: 0.47, y: 0.66, w: 8.7, h: 0.25, fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0 });
  }
}

function footer(slide: any, period: string, page: number) {
  slide.addShape('line', { x: 0.45, y: 7.05, w: 12.45, h: 0, line: { color: LINE, pt: 0.5 } });
  slide.addText(`Fuente: Ventas Vs. Costos · ${period}`, { x: 0.45, y: 7.13, w: 9.2, h: 0.2, fontFace: FONT, fontSize: 7.5, color: MUTED, margin: 0 });
  slide.addText(String(page).padStart(2, '0'), { x: 12.25, y: 7.13, w: 0.65, h: 0.2, fontFace: FONT, fontSize: 7.5, bold: true, color: MUTED, align: 'right', margin: 0 });
}

function addKpi(slide: any, x: number, y: number, w: number, label: string, value: string, note?: string, accent = BRAND_FALLBACK) {
  slide.addShape('roundRect', {
    x, y, w, h: 0.92,
    rectRadius: 0.08,
    fill: { color: CARD },
    line: { color: LINE, pt: 0.8 },
  });
  slide.addShape('rect', { x, y, w: 0.08, h: 0.92, fill: { color: accent }, line: { color: accent, transparency: 100 } });
  slide.addText(label.toUpperCase(), { x: x + 0.18, y: y + 0.13, w: w - 0.25, h: 0.16, fontFace: FONT, fontSize: 6.6, bold: true, color: MUTED, charSpacing: 1.3, margin: 0 });
  slide.addText(value, { x: x + 0.18, y: y + 0.34, w: w - 0.25, h: 0.28, fontFace: FONT, fontSize: 16, bold: true, color: INK, margin: 0, fit: 'shrink' });
  if (note) slide.addText(note, { x: x + 0.18, y: y + 0.67, w: w - 0.25, h: 0.16, fontFace: FONT, fontSize: 6.7, color: MUTED, margin: 0 });
}

function addTakeaway(slide: any, text: string | undefined, x = 0.45, y = 6.55, w = 12.45) {
  if (!text) return;
  slide.addShape('roundRect', { x, y, w, h: 0.36, rectRadius: 0.05, fill: { color: SOFT_NOTE }, line: { color: LINE, pt: 0.6 } });
  slide.addText(text, { x: x + 0.15, y: y + 0.09, w: w - 0.3, h: 0.18, fontFace: FONT, fontSize: 8, color: INK, bold: true, margin: 0, fit: 'shrink' });
}

function addBrandLogo(slide: any, dossier: SalesBIBrandDossier, x: number, y: number, w: number, h: number, dark = false, accent = BRAND_FALLBACK) {
  const data = dossier.brand_logo?.data_url;
  slide.addShape('roundRect', {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: dark ? 'FFFFFF' : 'F8FAFC' },
    line: { color: dark ? accent : LINE, pt: 0.7 },
  });
  if (data) {
    slide.addImage({ data, x: x + 0.08, y: y + 0.08, w: w - 0.16, h: h - 0.16 });
    return;
  }
  const initials = dossier.marca.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'M';
  slide.addText(initials, {
    x: x + 0.08, y: y + h / 2 - 0.18, w: w - 0.16, h: 0.36,
    fontFace: FONT, fontSize: Math.min(18, h * 14), bold: true,
    color: dark ? accent : INK, align: 'center', margin: 0, fit: 'shrink',
  });
}

function addChart(slide: any, type: string, data: any[], options: Record<string, unknown>) {
  slide.addChart(type as any, data, {
    showLegend: true,
    legendPos: 'b',
    legendFontFace: FONT,
    legendFontSize: 7,
    showTitle: false,
    showValue: false,
    showCatName: false,
    showValAxis: true,
    showCatAxis: true,
    catAxisLabelFontFace: FONT,
    valAxisLabelFontFace: FONT,
    catAxisLabelFontSize: 7,
    valAxisLabelFontSize: 7,
    catAxisLabelColor: MUTED,
    valAxisLabelColor: MUTED,
    valGridLine: { color: 'E2E8F0', transparency: 15, pt: 0.5 },
    chartColors: TYPE_COLORS,
    dataLabelFontFace: FONT,
    dataLabelFontSize: 7,
    dataLabelColor: INK,
    ...options,
  });
}

function chartSeries(name: string, labels: string[], values: number[]) {
  return { name, labels, values };
}

function addTable(slide: any, rows: Array<Array<string>>, x: number, y: number, w: number, h: number, widths?: number[], fontSize = 8) {
  const tableRows = rows.map((row, rowIndex) => row.map((cell) => (
    textCell(cell, rowIndex === 0, rowIndex === 0 ? 'FFFFFF' : INK, rowIndex === 0 ? TABLE_HEADER : 'FFFFFF', rowIndex === 0 ? Math.max(fontSize, 7.5) : fontSize)
  )));
  slide.addTable(tableRows, {
    x, y, w, h,
    colW: widths,
    border: { type: 'solid', color: LINE, pt: 0.5 },
    margin: 0.04,
    fontFace: FONT,
    fontSize: 8,
    color: INK,
    valign: 'mid',
    fit: 'shrink',
  });
}

function addTwoColumnList(slide: any, x: number, y: number, w: number, titleText: string, items: string[], accent: string) {
  slide.addShape('roundRect', { x, y, w, h: 4.65, rectRadius: 0.06, fill: { color: CARD }, line: { color: LINE, pt: 0.7 } });
  slide.addText(titleText.toUpperCase(), { x: x + 0.18, y: y + 0.18, w: w - 0.36, h: 0.25, fontFace: FONT, fontSize: 8, bold: true, color: accent, charSpacing: 1.2, margin: 0 });
  const lines = (items.length ? items : ['Sin observaciones para el período.']).slice(0, 8).map((item) => ({ text: `• ${item}\n`, options: { bullet: undefined, breakLine: true } }));
  slide.addText(lines, { x: x + 0.18, y: y + 0.6, w: w - 0.35, h: 3.75, fontFace: FONT, fontSize: 10, color: INK, breakLine: true, valign: 'top', fit: 'shrink' });
}

export async function exportBrandDossierEditablePptx(dossier: SalesBIBrandDossier, metric: 'units' | 'pvp' | 'both' = 'both'): Promise<void> {
  const mod: PptxModule = await import('pptxgenjs');
  const PptxGenJS = mod.default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE_169', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE_169';
  pptx.author = 'ElectroGV';
  pptx.company = 'ElectroGV';
  pptx.subject = 'Informe comercial de marca';
  pptx.title = `${dossier.marca} · Informe comercial editable`;
  pptx.theme = {
    headFontFace: FONT,
    bodyFontFace: FONT,
  };

  const period = `${fmtDate(dossier.filters.fecha_desde)} - ${fmtDate(dossier.filters.fecha_hasta)}`;
  const showU = metric !== 'pvp';
  const showP = metric !== 'units';
  const brand = dossier.totals.brand;
  const brandPrev = dossier.totals.brand_prev;
  const brandGrowth = growth(brand.total_vendido, brandPrev.total_vendido);
  const brandColor = pptColor(dossier.brand_style?.primary_color);
  const brandColorDeep = mixColor(brandColor, INK, 0.18);
  const brandColorSoft = mixColor(brandColor, 'FFFFFF', 0.56);
  const brandChartColors = [brandColor, brandColorSoft];
  const page = { value: 1 };
  const addBase = (slideTitle: string, subtitle?: string) => {
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    title(slide, slideTitle, subtitle);
    addBrandLogo(slide, dossier, 11.75, 0.22, 0.75, 0.75, false, brandColor);
    footer(slide, period, page.value);
    page.value += 1;
    return slide;
  };

  const cover = pptx.addSlide();
  cover.background = { color: INK };
  cover.addShape('rect', { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: INK } });
  cover.addShape('rect', { x: 0.75, y: 1.35, w: 1.5, h: 0.07, fill: { color: brandColor } });
  cover.addText('INFORME COMERCIAL EDITABLE', { x: 0.75, y: 1.55, w: 9.5, h: 0.32, fontFace: FONT, fontSize: 13, bold: true, color: brandColorSoft, charSpacing: 2.5, margin: 0 });
  cover.addText(dossier.marca, { x: 0.75, y: 2.05, w: 11.7, h: 0.95, fontFace: FONT, fontSize: 42, bold: true, color: 'FFFFFF', margin: 0, fit: 'shrink' });
  cover.addText(period, { x: 0.78, y: 3.08, w: 8.5, h: 0.35, fontFace: FONT, fontSize: 15, color: 'CBD5E1', margin: 0 });
  cover.addText('Fuente: Ventas Vs. Costos · gráficos y tablas editables en PowerPoint', { x: 0.78, y: 6.75, w: 9.5, h: 0.28, fontFace: FONT, fontSize: 9, color: 'CBD5E1', margin: 0 });
  addBrandLogo(cover, dossier, 9.75, 1.55, 2.5, 2.5, true, brandColor);
  page.value += 1;

  const summary = addBase('Resumen ejecutivo', `${dossier.marca} en ElectroGV · lectura rápida`);
  addKpi(summary, 0.55, 1.1, 1.9, 'Facturación', compactMoney(brand.total_vendido), brandGrowth == null ? undefined : `${brandGrowth >= 0 ? '+' : ''}${pct(brandGrowth)} vs anterior`, brandColor);
  addKpi(summary, 2.65, 1.1, 1.55, 'Unidades', num(brand.unidades), undefined, TEAL);
  addKpi(summary, 4.4, 1.1, 1.55, 'Productos', num(brand.productos), 'activos', VIOLET);
  addKpi(summary, 6.15, 1.1, 1.75, 'Share PVP', pct(dossier.share.pvp_pct), `${dossier.share.delta_pts >= 0 ? '+' : ''}${dossier.share.delta_pts.toFixed(1)} pts`, brandColorDeep);
  addKpi(summary, 8.1, 1.1, 1.6, 'Ranking', dossier.share.rank_pvp ? `#${dossier.share.rank_pvp}` : 's/d', `${dossier.share.total_brands} marcas`, GREEN);
  addKpi(summary, 9.9, 1.1, 1.85, 'Precio índice', dossier.price_index_global.toFixed(0), '100 = mercado', brandColor);
  addTable(summary, [
    ['Lecturas principales'],
    ...dossier.highlights.slice(0, 5).map((h) => [h]),
  ], 0.55, 2.35, 5.75, 3.5, [5.75]);
  addTable(summary, [
    ['Métrica', dossier.marca, 'Mercado', 'Participación'],
    ['Facturación', money(brand.total_vendido), money(dossier.totals.market.total_vendido), pct(dossier.share.pvp_pct)],
    ['Unidades', num(brand.unidades), num(dossier.totals.market.unidades), pct(dossier.share.units_pct)],
    ['PVP prom.', money(brand.pvp_promedio), money(dossier.totals.market.pvp_promedio), ''],
    ['Productos', num(brand.productos), num(dossier.totals.market.productos), ''],
  ], 6.55, 2.35, 6.15, 2.35, [1.55, 1.55, 1.6, 1.45]);
  addTakeaway(summary, dossier.narratives?.resumen || dossier.highlights[0], 6.55, 5.15, 6.15);

  const branchRowsForProvider = [...dossier.branches].sort((a, b) => b.brand_unidades - a.brand_unidades);
  const branchColumns = branchRowsForProvider.map((row) => row.sucursal).slice(0, 4);
  const tipoRows = [...(dossier.tipo_zone_matrix || [])]
    .sort((a, b) => (metric === 'units' ? b.brand_unidades - a.brand_unidades : b.brand_pvp - a.brand_pvp));
  const selectedTipos = (dossier.selected_tipos?.length
    ? dossier.selected_tipos
    : tipoRows.map((row) => row.tipo).slice(0, 4)
  );
  const rankingByTipo = dossier.ranking_by_tipo || [];
  const monthlyByTipo = dossier.monthly_share_by_tipo || [];
  const zoneRows = dossier.zone_share || [];
  const zoneNames = (zoneRows.length
    ? zoneRows.map((row) => row.zona)
    : branchColumns
  ).slice(0, 4);
  const metricLabel = metric === 'units' ? 'Unidades' : 'Facturación';
  const metricFmt = metric === 'units' ? '#,##0' : '$ #,##0';
  const rowMetric = (row: { unidades?: number; total_vendido?: number; brand_unidades?: number; brand_pvp?: number }) => (
    metric === 'units'
      ? (row.unidades ?? row.brand_unidades ?? 0)
      : (row.total_vendido ?? row.brand_pvp ?? 0)
  );

  const providerMonthly = addBase('Ventas mensuales', `${dossier.marca} por mes · unidades y pesos`);
  const providerMonthlyRows = dossier.monthly_series;
  const providerMonthlyLabels = providerMonthlyRows.map((row) => monthLabel(row.mes));
  const monthlySlots: Array<{ name: string; values: number[]; fmt: string }> = [];
  if (showU) monthlySlots.push({ name: 'Unidades', values: providerMonthlyRows.map((row) => row.brand_unidades), fmt: '#,##0' });
  if (showP) monthlySlots.push({ name: 'Pesos', values: providerMonthlyRows.map((row) => row.brand_pvp), fmt: '$ #,##0' });
  monthlySlots.forEach((slot, i) => {
    addChart(providerMonthly, 'line', chartData(slot.name, providerMonthlyLabels, slot.values), {
      x: monthlySlots.length === 1 ? 3.7 : (i === 0 ? 0.55 : 6.85), y: 1.15, w: 5.85, h: 4.85,
      catAxisLabelRotate: 45,
      valAxisLabelFormatCode: slot.fmt,
      lineSize: 2.4,
      showMarker: true,
      chartColors: [brandChartColors[i % brandChartColors.length]],
    });
  });
  addTakeaway(providerMonthly, `Vista proveedor: evolución mensual continua de ${dossier.marca}, sin comparar años incompletos.`, 0.55, 6.35, 12.15);

  const providerBranches = addBase('Puntos de venta', `${dossier.marca} por sucursal · unidades y pesos`);
  const branchSlots: Array<{ name: string; values: number[]; fmt: string }> = [];
  if (showU) branchSlots.push({ name: 'Unidades', values: branchRowsForProvider.map((row) => row.brand_unidades), fmt: '#,##0' });
  if (showP) branchSlots.push({ name: 'Pesos', values: branchRowsForProvider.map((row) => row.brand_pvp), fmt: '$ #,##0' });
  branchSlots.forEach((slot, i) => {
    addChart(providerBranches, 'bar', chartData(slot.name, branchRowsForProvider.map((row) => row.sucursal), slot.values), {
      x: branchSlots.length === 1 ? 3.7 : (i === 0 ? 0.55 : 6.85), y: 1.15, w: 5.85, h: 4.85,
      barDir: 'bar',
      showLegend: false,
      valAxisLabelFormatCode: slot.fmt,
      chartColors: [brandChartColors[i % brandChartColors.length]],
    });
  });
  addTakeaway(providerBranches, 'Lectura para visita: peso de la marca en cada punto de venta, separado en volumen y facturacion.', 0.55, 6.35, 12.15);

  const providerShare = addBase('In-house share por zona', `CABA, GBA y Venta Web · participacion de ${dossier.marca}`);
  const shareSource = zoneRows.length
    ? zoneRows
    : branchRowsForProvider.map((row) => ({
        zona: row.sucursal,
        brand_unidades: row.brand_unidades,
        brand_pvp: row.brand_pvp,
        market_unidades: row.market_unidades || 0,
        market_pvp: row.market_pvp || 0,
        share_units_pct: branchShareUnits(row),
        share_pvp_pct: row.share_in_branch_pct,
        brand_mix_units_pct: 0,
        brand_mix_pvp_pct: row.brand_mix_pct,
      }));
  const shareMetricValues = shareSource.map((row) => (metric === 'units' ? row.brand_mix_units_pct : row.brand_mix_pvp_pct) / 100);
  addChart(providerShare, 'pie', chartData(metric === 'units' ? 'Mix unidades' : 'Mix pesos', shareSource.map((row) => row.zona), shareMetricValues), {
    x: 0.7, y: 1.08, w: 4.7, h: 4.65,
    showLegend: true,
    legendPos: 'r',
    showValAxis: false,
    showCatAxis: false,
    showValue: false,
    showPercent: true,
    dataLabelPosition: 'bestFit',
    chartColors: ZONE_COLORS,
  });
  addTable(providerShare, [
    ['Zona', `${dossier.marca} u`, 'Total u', 'Share u', `${dossier.marca} $`, 'Share $'],
    ...shareSource.map((row) => [
      row.zona,
      num(row.brand_unidades),
      row.market_unidades != null ? num(row.market_unidades) : 's/d',
      pct(row.share_units_pct),
      compactMoney(row.brand_pvp),
      pct(row.share_pvp_pct),
    ]),
  ], 5.85, 1.15, 6.45, 3.15, [1.2, 1.0, 1.0, 0.9, 1.25, 0.9], 7);
  addTakeaway(providerShare, 'Vista pedida para proveedores: CABA = Caseros, GBA = Canning + Lanus + Norcenter, Venta Web separado cuando existe.', 5.85, 4.75, 6.45);

  const providerTypeBranch = addBase('Tipos x punto de venta', 'Unidades y pesos por tipo y zona');
  addTable(providerTypeBranch, [
    ['Tipo', 'Total', ...zoneNames],
    ...tipoRows.slice(0, 9).map((row) => [
      row.tipo,
      `${num(row.brand_unidades)} u\n${compactMoney(row.brand_pvp)}`,
      ...zoneNames.map((zoneName) => {
        const value = row.zones?.[zoneName];
        return value ? `${num(value.brand_unidades)} u\n${compactMoney(value.brand_pvp)}` : '0 u\n$ 0';
      }),
    ]),
  ], 0.55, 1.1, 12.2, 5.75, [2.2, 1.55, ...zoneNames.map(() => 2.1)], 6.6);
  addTakeaway(providerTypeBranch, 'El foco deja de ser producto puntual y pasa a tipos: permite ver donde empuja cada familia comercial por zona.', 0.55, 6.55, 12.15);

  const evolution = addBase('Participación mensual', `${dossier.marca}: share sobre el total vendido`);
  const monthly = dossier.monthly_series.slice(-12);
  const evoLabels = monthly.map((row) => monthLabel(row.mes));
  addChart(evolution, 'line', [
    ...(showP ? [{ name: 'Share pesos', labels: evoLabels, values: monthly.map((row) => row.share_pvp_pct / 100) }] : []),
    ...(showU ? [{ name: 'Share unidades', labels: evoLabels, values: monthly.map((row) => row.share_units_pct / 100) }] : []),
  ], {
    x: 0.55, y: 1.15, w: 7.55, h: 4.8,
    catAxisLabelRotate: 45,
    valAxisLabelFormatCode: '0.0%',
    lineSize: 2.5,
    showMarker: true,
    chartColors: brandChartColors,
  });
  addTable(evolution, [
    ['Mes', 'Share u', 'Share $', `${dossier.marca} u`, `${dossier.marca} $`],
    ...monthly.slice(-8).map((row) => [monthLabel(row.mes), pct(row.share_units_pct), pct(row.share_pvp_pct), num(row.brand_unidades), compactMoney(row.brand_pvp)]),
  ], 8.35, 1.15, 4.15, 4.8, [0.75, 0.8, 0.8, 0.85, 1.15]);
  addTakeaway(evolution, `Participación mensual: muestra cuánto pesa ${dossier.marca} dentro del total, sin compararlo contra una escala de mercado mucho más grande.`);

  if (monthlyByTipo.length) {
    const shareByTipo = addBase('Participación mensual por tipo', `In-house share de ${dossier.marca} en tipos clave`);
    const monthKeys = Array.from(new Set(monthlyByTipo.flatMap((block) => block.rows.map((row) => row.mes)))).sort().slice(-12);
    const tipoBlocks = selectedTipos
      .map((tipo) => monthlyByTipo.find((block) => block.tipo === tipo))
      .filter(Boolean) as NonNullable<SalesBIBrandDossier['monthly_share_by_tipo']>;
    addChart(shareByTipo, 'bar', tipoBlocks.map((block) => chartSeries(
      block.tipo,
      monthKeys.map(monthLabel),
      monthKeys.map((month) => {
        const row = block.rows.find((item) => item.mes === month);
        return ((metric === 'units' ? row?.share_units_pct : row?.share_pvp_pct) || 0) / 100;
      }),
    )), {
      x: 0.55, y: 1.1, w: 7.4, h: 4.85,
      barDir: 'col',
      valAxisLabelFormatCode: '0.0%',
      chartColors: TYPE_COLORS,
    });
    addTable(shareByTipo, [
      ['Tipo', 'Share u', 'Share $', `${dossier.marca} u`, `${dossier.marca} $`],
      ...tipoBlocks.slice(0, 7).map((block) => {
        const totals = block.rows.reduce((acc, row) => ({
          bu: acc.bu + row.brand_unidades,
          bp: acc.bp + row.brand_pvp,
          mu: acc.mu + row.market_unidades,
          mp: acc.mp + row.market_pvp,
        }), { bu: 0, bp: 0, mu: 0, mp: 0 });
        return [
          block.tipo,
          pct(totals.mu ? (totals.bu / totals.mu) * 100 : 0),
          pct(totals.mp ? (totals.bp / totals.mp) * 100 : 0),
          num(totals.bu),
          compactMoney(totals.bp),
        ];
      }),
    ], 8.25, 1.1, 4.2, 4.85, [1.1, 0.75, 0.75, 0.75, 1.05], 6.7);
    addTakeaway(shareByTipo, 'Sirve para ver si la marca gana o pierde peso dentro de Heladeras, Lavado, A/A, Television y otros tipos seleccionados.');
  }

  const ranking = addBase('Ranking competitivo', `${dossier.marca} frente al resto de marcas`);
  const rankRows = dossier.ranking.slice(0, 10);
  const rankingStack = selectedTipos
    .map((tipo) => {
      const block = rankingByTipo.find((item) => item.tipo === tipo);
      return block ? chartSeries(tipo, rankRows.map((row) => row.name), rankRows.map((row) => {
        const typedRow = block.rows.find((item) => item.name === row.name);
        return typedRow ? rowMetric(typedRow) : 0;
      })) : null;
    })
    .filter(Boolean) as Array<{ name: string; labels: string[]; values: number[] }>;
  addChart(ranking, 'bar', rankingStack.length
    ? rankingStack
    : brandVsRestChartData(dossier.marca, rankRows.map((row) => row.name), rankRows.map(rowMetric)), {
    x: 0.55, y: 1.1, w: 5.7, h: 5.2,
    barDir: 'col',
    barGrouping: 'stacked',
    showLegend: rankingStack.length > 0,
    valAxisLabelFormatCode: metricFmt,
    catAxisLabelFontSize: 7,
    chartColors: rankingStack.length ? TYPE_COLORS : [brandColor, REST_COLOR],
  });
  addTable(ranking, [
    ['Marca', 'Facturación', 'Unidades', 'Productos', 'Share'],
    ...rankRows.map((row) => [row.name, compactMoney(row.total_vendido), num(row.unidades), num(row.productos), pct(row.participacion_pct)]),
  ], 6.55, 1.1, 6.15, 5.2, [1.85, 1.25, 0.85, 0.75, 0.9]);
  addTakeaway(ranking, dossier.narratives?.competencia);

  rankingByTipo
    .filter((block) => selectedTipos.includes(block.tipo))
    .forEach((block) => {
      const typedRanking = addBase(`Ranking competitivo · ${block.tipo}`, `${metricLabel} por marca dentro de ${block.tipo}`);
      const rows = block.rows.slice(0, 8);
      addChart(typedRanking, 'bar', brandVsRestChartData(dossier.marca, rows.map((row) => row.name), rows.map(rowMetric)), {
        x: 0.55, y: 1.1, w: 6.0, h: 4.9,
        barDir: 'col',
        barGrouping: 'stacked',
        showLegend: false,
        valAxisLabelFormatCode: metricFmt,
        catAxisLabelRotate: 35,
        chartColors: [brandColor, REST_COLOR],
      });
      addTable(typedRanking, [
        ['Marca', 'Facturación', 'Unidades', 'Productos', 'Share'],
        ...rows.map((row) => [row.name, compactMoney(row.total_vendido), num(row.unidades), num(row.productos), pct(row.participacion_pct)]),
      ], 6.9, 1.1, 5.7, 4.65, [1.45, 1.15, 0.75, 0.75, 0.85], 6.8);
      addTakeaway(typedRanking, `${block.tipo}: ranking separado para no mezclar categorias con tickets y comportamientos distintos.`, 6.9, 5.95, 5.7);
    });

  const competitors = dossier.filters.competidores || [];
  if (competitors.length) {
    const comp = addBase('Marca vs competidores', `Comparación directa contra ${competitors.join(', ')}`);
    addChart(comp, 'bar', [
      { name: dossier.marca, labels: evoLabels, values: monthly.map((row) => (metric === 'units' ? row.brand_unidades : row.brand_pvp)) },
      ...competitors.map((name) => ({ name, labels: evoLabels, values: monthly.map((row) => (metric === 'units' ? row.competidores?.[name]?.unidades : row.competidores?.[name]?.total_vendido) || 0) })),
    ], {
      x: 0.55, y: 1.1, w: 7.1, h: 4.95,
      barDir: 'col',
      catAxisLabelRotate: 45,
      valAxisLabelFormatCode: metricFmt,
      chartColors: [brandColor, ...COMPETITOR_COLORS],
    });
    const duelRows = [dossier.marca, ...competitors]
      .map((name) => dossier.ranking.find((row) => row.name === name))
      .filter(Boolean) as SalesBIBrandDossier['ranking'];
    addTable(comp, [
      ['Marca', 'Facturación', 'Unidades', 'Líneas', 'PVP prom.', 'Share'],
      ...duelRows.map((row) => [row.name, compactMoney(row.total_vendido), num(row.unidades), num(row.lineas), money(row.pvp_promedio), pct(row.participacion_pct)]),
    ], 7.9, 1.1, 4.85, 3.5, [1.1, 1.05, 0.7, 0.7, 0.9, 0.75]);
    addTakeaway(comp, dossier.narratives?.competencia, 7.9, 4.95, 4.85);
  }

  const cats = addBase('Categorías y oportunidades', `Dónde participa ${dossier.marca}`);
  const categoryRows = dossier.categories.slice(0, 8);
  addChart(cats, 'bar', chartData(
    metric === 'units' ? 'Share unidades %' : 'Share PVP %',
    categoryRows.map((row) => row.categoria),
    categoryRows.map((row) => (metric === 'units' ? row.share_units_pct : row.share_pvp_pct) / 100),
  ), {
    x: 0.55, y: 1.1, w: 5.8, h: 4.9,
    barDir: 'bar',
    valAxisLabelFormatCode: '0.0%',
    showLegend: false,
    chartColors: [brandColor],
  });
  addTable(cats, [
    ['Categoría', 'Facturación marca', 'Share', 'Rank', 'Líder', 'Índice'],
    ...categoryRows.map((row) => [
      row.categoria,
      compactMoney(row.brand_pvp),
      pct(row.share_pvp_pct),
      row.rank_in_categoria ? `#${row.rank_in_categoria}` : 's/d',
      row.leader_name || 's/d',
      row.price_index.toFixed(0),
    ]),
  ], 6.65, 1.1, 6.0, 4.9, [1.25, 1.25, 0.75, 0.55, 1.35, 0.65]);
  addTakeaway(cats, dossier.narratives?.categorias || dossier.narratives?.oportunidad);

  if (dossier.price_bands?.bands?.length) {
    const bands = addBase('Gamas de precio', 'Mix de unidades por posicionamiento de precio');
    const bandRows = dossier.price_bands.bands;
    addChart(bands, 'bar', [
      { name: `Mix ${dossier.marca}`, labels: bandRows.map((row) => row.banda), values: bandRows.map((row) => row.brand_mix_units_pct / 100) },
      { name: 'Mix mercado', labels: bandRows.map((row) => row.banda), values: bandRows.map((row) => row.market_mix_units_pct / 100) },
    ], {
      x: 0.55, y: 1.1, w: 6.1, h: 4.8,
      barDir: 'col',
      valAxisLabelFormatCode: '0.0%',
      chartColors: [brandColor, MARKET_COLOR],
    });
    addTable(bands, [
      ['Gama', `Unid. ${dossier.marca}`, 'Share unid.', 'Facturación'],
      ...bandRows.map((row) => [row.banda, num(row.brand_unidades), pct(row.share_units_pct), compactMoney(row.brand_pvp)]),
    ], 7.05, 1.1, 5.1, 3.6, [1.45, 1.2, 1.15, 1.3]);
    addTakeaway(bands, dossier.narratives?.bandas, 7.05, 5.05, 5.1);
  }

  if (dossier.price_bands_by_tipo?.length) {
    const bandsByTipo = addBase('Gamas de precio por tipo', 'Participación de la marca por gama dentro de tipos clave');
    const bandTipoRows = dossier.price_bands_by_tipo
      .filter((block) => !selectedTipos.length || selectedTipos.includes(block.tipo))
      .flatMap((block) => block.bands.map((band) => ({
        tipo: block.tipo,
        banda: band.banda,
        share: band.share_units_pct,
        mix: band.brand_mix_units_pct,
        unidades: band.brand_unidades,
        pvp: band.brand_pvp,
      })))
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 12);
    addTable(bandsByTipo, [
      ['Tipo', 'Gama', 'Unidades', 'Facturación', 'Share', 'Mix marca'],
      ...bandTipoRows.map((row) => [row.tipo, row.banda, num(row.unidades), compactMoney(row.pvp), pct(row.share), pct(row.mix)]),
    ], 0.55, 1.15, 12.15, 4.8, [1.55, 1.4, 1.0, 1.25, 0.9, 1.0], 7);
    addTakeaway(bandsByTipo, 'Lectura comercial: permite ver si la marca compite mejor en entrada, media o premium dentro de cada tipo seleccionado.');

    dossier.price_bands_by_tipo
      .filter((block) => !selectedTipos.length || selectedTipos.includes(block.tipo))
      .forEach((block) => {
        const bandsByTypeSlide = addBase(`Gamas de precio · ${block.tipo}`, `Mix de unidades de ${dossier.marca} vs mercado`);
        addChart(bandsByTypeSlide, 'bar', [
          { name: dossier.marca, labels: block.bands.map((band) => band.banda), values: block.bands.map((band) => band.brand_mix_units_pct / 100) },
          { name: 'Mercado', labels: block.bands.map((band) => band.banda), values: block.bands.map((band) => band.market_mix_units_pct / 100) },
        ], {
          x: 0.55, y: 1.1, w: 6.65, h: 4.85,
          barDir: 'col',
          valAxisLabelFormatCode: '0.0%',
          chartColors: [brandColor, MARKET_COLOR],
        });
        addTable(bandsByTypeSlide, [
          ['Gama', `${dossier.marca} u`, 'Mercado u', 'Share u', `${dossier.marca} $`, 'Share $'],
          ...block.bands.map((band) => [
            band.banda,
            num(band.brand_unidades),
            num(band.market_unidades),
            pct(band.share_units_pct),
            compactMoney(band.brand_pvp),
            pct(band.share_pvp_pct),
          ]),
        ], 7.55, 1.2, 4.85, 3.25, [0.85, 0.8, 0.85, 0.75, 1.05, 0.75], 6.8);
        addTakeaway(bandsByTypeSlide, `Lectura por tipo: compara si ${dossier.marca} se concentra más en entrada, media o premium dentro de ${block.tipo}.`, 7.55, 4.9, 4.85);
      });
  }

  const typesSlide = addBase('Tipos destacados', `Tipos que empujan a ${dossier.marca}`);
  const typeRows = (tipoRows.length
    ? tipoRows
    : dossier.tipos_top.map((row) => ({
        tipo: row.tipo,
        brand_unidades: row.unidades,
        brand_pvp: row.total_vendido,
        zones: {} as Record<string, { brand_unidades: number; brand_pvp: number; market_unidades: number; market_pvp: number; share_units_pct: number; share_pvp_pct: number }>,
      }))
  ).slice(0, 12);
  addTable(typesSlide, [
    ['Tipo', 'Unid.', 'Facturación', 'Share $', ...zoneNames],
    ...typeRows.map((row) => {
      const market = dossier.tipos_top.find((item) => item.tipo === row.tipo);
      return [
        row.tipo,
        num(row.brand_unidades),
        compactMoney(row.brand_pvp),
        pct(market?.share_pvp_pct || 0),
        ...zoneNames.map((zoneName) => {
          const value = row.zones?.[zoneName];
          return value ? `${num(value.brand_unidades)} u` : '0 u';
        }),
      ];
    }),
  ], 0.55, 1.05, 12.2, 5.35, [1.75, 0.8, 1.25, 0.8, ...zoneNames.map(() => 1.15)], 6.9);
  addTakeaway(typesSlide, dossier.narratives?.tipos || 'Vista para marcas: el foco queda en tipos comerciales, no en productos puntuales.');

  const branches = addBase('Presencia por zona', `Peso de ${dossier.marca} en CABA, GBA y Venta Web`);
  const zonePresenceRows = shareSource.slice(0, 8);
  addChart(branches, 'bar', chartData(metric === 'units' ? 'Unidades' : 'Facturación', zonePresenceRows.map((row) => row.zona), zonePresenceRows.map((row) => (
    metric === 'units' ? row.brand_unidades : row.brand_pvp
  ))), {
    x: 0.55, y: 1.1, w: 5.8, h: 4.9,
    barDir: 'col',
    showLegend: false,
    valAxisLabelFormatCode: metricFmt,
    chartColors: [brandColor],
  });
  addTable(branches, [
    ['Zona', 'Facturación', 'Unidades', 'Share u', 'Share $', 'Mix marca'],
    ...zonePresenceRows.map((row) => [
      row.zona,
      compactMoney(row.brand_pvp),
      num(row.brand_unidades),
      pct(row.share_units_pct),
      pct(row.share_pvp_pct),
      pct(metric === 'units' ? row.brand_mix_units_pct : row.brand_mix_pvp_pct),
    ]),
  ], 6.65, 1.1, 5.8, 4.0, [0.95, 1.15, 0.75, 0.75, 0.75, 0.85], 6.8);
  addTakeaway(branches, 'La presencia queda agrupada por zona para mostrar CABA, GBA y Venta Web sin dispersar la lectura por sucursales.', 6.65, 5.45, 5.8);

  const closing = addBase('Conclusiones y próximos pasos', 'Lectura accionable para reunión comercial');
  addTwoColumnList(closing, 0.55, 1.15, 3.9, 'Fortalezas', dossier.conclusions.fortalezas, GREEN);
  addTwoColumnList(closing, 4.72, 1.15, 3.9, 'Oportunidades', dossier.conclusions.oportunidades, AMBER);
  addTwoColumnList(closing, 8.88, 1.15, 3.9, 'Acciones sugeridas', dossier.conclusions.acciones, brandColor);

  await pptx.writeFile({
    fileName: `informe-editable-${cleanFileName(dossier.marca)}-${dossier.filters.fecha_desde}.pptx`,
    compression: true,
  });
}
