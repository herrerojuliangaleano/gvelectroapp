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
const BRAND_COLOR_BY_KEY: Record<string, string> = {
  SAMSUNG: '1428A0',
  MIDEA: '0098D1',
  DREAN: '2A6FBA',
  WHIRLPOOL: 'EEB111',
  ENOVA: '7B3FB3',
};
const TYPE_COLOR_BY_KEY: Array<[string[], string]> = [
  [['HELADERA', 'REFRIGERADOR', 'FREEZER'], '3E9FC5'],
  [['LAVADO', 'LAVARROPAS', 'LAVASECA', 'LAVASECARROPAS', 'SECARROPAS'], '2A9D8F'],
  [['A/A', 'AA', 'AIRE', 'ACONDICIONADO', 'CLIMATIZACION'], '4E8EDB'],
  [['TV', 'TELEVISION', 'TELEVISOR', 'AUDIO'], '7B61B8'],
];
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

function ratioPct(part: number, whole: number): number {
  return whole ? (part / whole) * 100 : 0;
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

function competitorColor(name: string, index: number): string {
  return BRAND_COLOR_BY_KEY[normalizeLabel(name)] || COMPETITOR_COLORS[index % COMPETITOR_COLORS.length];
}

function typeColor(name: string, index: number): string {
  const key = normalizeLabel(name);
  const preset = TYPE_COLOR_BY_KEY.find(([aliases]) => aliases.some((alias) => key.includes(alias)));
  return preset?.[1] || TYPE_COLORS[index % TYPE_COLORS.length];
}

function colorsForTypes(names: string[]): string[] {
  return names.map((name, index) => typeColor(name, index));
}

function brandCompetitorRestChartData(brandName: string, competitorNames: string[], labels: string[], values: number[]) {
  const highlighted = [brandName, ...competitorNames];
  const highlightedKeys = highlighted.map(normalizeLabel);
  return [
    ...highlighted.map((name) => ({
      name,
      labels,
      values: values.map((value, index) => (normalizeLabel(labels[index]) === normalizeLabel(name) ? value : 0)),
    })),
    {
      name: 'Otras marcas',
      labels,
      values: values.map((value, index) => (highlightedKeys.includes(normalizeLabel(labels[index])) ? 0 : value)),
    },
  ];
}

function brandCompetitorChartData(brandName: string, competitorNames: string[], labels: string[], values: number[]) {
  const highlighted = [brandName, ...competitorNames];
  return highlighted.map((name) => ({
    name,
    labels,
    values: values.map((value, index) => (normalizeLabel(labels[index]) === normalizeLabel(name) ? value : 0)),
  }));
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
  if (metric === 'both') {
    await exportBrandDossierEditablePptx(dossier, 'units');
    await exportBrandDossierEditablePptx(dossier, 'pvp');
    return;
  }
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
  const mode = metric;
  const isUnits = mode === 'units';
  const metricTitle = isUnits ? 'Unidades' : 'Facturación';
  const metricNoun = isUnits ? 'unidades' : 'facturación';
  const metricFmt = isUnits ? '#,##0' : '$ #,##0';
  const metricValue = (units: number, pvp: number) => (isUnits ? units : pvp);
  const metricText = (units: number, pvp: number) => (isUnits ? `${num(units)} u` : compactMoney(pvp));
  const shareTitle = isUnits ? 'Share unidades' : 'Share facturación';
  const brand = dossier.totals.brand;
  const brandPrev = dossier.totals.brand_prev;
  const market = dossier.totals.market;
  const marketPrev = dossier.totals.market_prev;
  const brandGrowth = growth(metricValue(brand.unidades, brand.total_vendido), metricValue(brandPrev.unidades, brandPrev.total_vendido));
  const activeShare = isUnits ? dossier.share.units_pct : dossier.share.pvp_pct;
  const prevShare = isUnits ? ratioPct(brandPrev.unidades, marketPrev.unidades) : dossier.share.prev_pvp_pct;
  const shareDelta = activeShare - prevShare;
  const activeRank = isUnits ? dossier.share.rank_units : dossier.share.rank_pvp;
  const brandColor = pptColor(dossier.brand_style?.primary_color);
  const brandColorDeep = mixColor(brandColor, INK, 0.18);
  const brandColorSoft = mixColor(brandColor, 'FFFFFF', 0.56);
  const brandChartColors = [brandColor, brandColorSoft];
  const isMetricCompatibleText = (text: string | undefined) => {
    const value = String(text || '').trim();
    if (!value) return false;
    const normalized = normalizeLabel(value);
    if (isUnits) return !/(FACTURACION|PVP|PESOS?|\$)/.test(normalized);
    return !/\b(UNIDADES?|UNID|U)\b/.test(normalized);
  };
  const metricSafeText = (text: string | undefined, fallback: string) => (
    isMetricCompatibleText(text) ? String(text) : fallback
  );
  const metricSafeList = (items: string[] | undefined) => (items || []).filter(isMetricCompatibleText);
  const summaryHighlights = metricSafeList(dossier.highlights).slice(0, 5);
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
  cover.addText(`INFORME COMERCIAL EDITABLE · ${metricTitle.toUpperCase()}`, { x: 0.75, y: 1.55, w: 9.5, h: 0.32, fontFace: FONT, fontSize: 13, bold: true, color: brandColorSoft, charSpacing: 2.5, margin: 0 });
  cover.addText(dossier.marca, { x: 0.75, y: 2.05, w: 11.7, h: 0.95, fontFace: FONT, fontSize: 42, bold: true, color: 'FFFFFF', margin: 0, fit: 'shrink' });
  cover.addText(period, { x: 0.78, y: 3.08, w: 8.5, h: 0.35, fontFace: FONT, fontSize: 15, color: 'CBD5E1', margin: 0 });
  cover.addText('Fuente: Ventas Vs. Costos · gráficos y tablas editables en PowerPoint', { x: 0.78, y: 6.75, w: 9.5, h: 0.28, fontFace: FONT, fontSize: 9, color: 'CBD5E1', margin: 0 });
  addBrandLogo(cover, dossier, 9.75, 1.55, 2.5, 2.5, true, brandColor);
  page.value += 1;

  const summary = addBase('Resumen ejecutivo', `${dossier.marca} en ElectroGV · lectura por ${metricNoun}`);
  addKpi(
    summary,
    0.55,
    1.1,
    2.0,
    metricTitle,
    metricText(brand.unidades, brand.total_vendido),
    brandGrowth == null ? undefined : `${brandGrowth >= 0 ? '+' : ''}${pct(brandGrowth)} vs anterior`,
    brandColor,
  );
  addKpi(summary, 2.75, 1.1, 1.75, shareTitle, pct(activeShare), `${shareDelta >= 0 ? '+' : ''}${shareDelta.toFixed(1)} pts`, brandColorDeep);
  addKpi(summary, 4.7, 1.1, 1.55, 'Ranking', activeRank ? `#${activeRank}` : 's/d', `${dossier.share.total_brands} marcas`, GREEN);
  addKpi(summary, 6.45, 1.1, 1.55, 'Productos', num(brand.productos), 'activos', VIOLET);
  if (!isUnits) addKpi(summary, 8.2, 1.1, 1.85, 'Precio índice', dossier.price_index_global.toFixed(0), '100 = mercado', brandColor);
  addTable(summary, [
    ['Lecturas principales'],
    ...(summaryHighlights.length ? summaryHighlights : [`Lectura enfocada en ${metricNoun} para el periodo.`]).map((h) => [h]),
  ], 0.55, 2.35, 5.75, 3.5, [5.75]);
  addTable(summary, [
    ['Métrica', dossier.marca, 'Mercado', shareTitle],
    [metricTitle, metricText(brand.unidades, brand.total_vendido), metricText(market.unidades, market.total_vendido), pct(activeShare)],
    ['Productos activos', num(brand.productos), num(market.productos), ''],
    ...(!isUnits ? [['PVP promedio', money(brand.pvp_promedio), money(market.pvp_promedio), '']] : []),
  ], 6.55, 2.35, 6.15, 2.35, [1.55, 1.55, 1.6, 1.45]);
  addTakeaway(summary, metricSafeText(dossier.narratives?.resumen || summaryHighlights[0], `Resumen enfocado en ${metricNoun} para el periodo.`), 6.55, 5.15, 6.15);

  const branchRowsForProvider = [...dossier.branches].sort((a, b) => metricValue(b.brand_unidades, b.brand_pvp) - metricValue(a.brand_unidades, a.brand_pvp));
  const branchColumns = branchRowsForProvider.map((row) => row.sucursal).slice(0, 4);
  const tipoRows = [...(dossier.tipo_zone_matrix || [])]
    .sort((a, b) => (isUnits ? b.brand_unidades - a.brand_unidades : b.brand_pvp - a.brand_pvp));
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
  const rowMetric = (row: { unidades?: number; total_vendido?: number; brand_unidades?: number; brand_pvp?: number }) => (
    isUnits
      ? (row.unidades ?? row.brand_unidades ?? 0)
      : (row.total_vendido ?? row.brand_pvp ?? 0)
  );
  const rowMetricText = (row: { unidades?: number; total_vendido?: number; brand_unidades?: number; brand_pvp?: number }) => (
    metricText(row.unidades ?? row.brand_unidades ?? 0, row.total_vendido ?? row.brand_pvp ?? 0)
  );
  const metricShare = (brandUnits: number, brandPvp: number, totalUnits: number, totalPvp: number) => (
    isUnits ? ratioPct(brandUnits, totalUnits) : ratioPct(brandPvp, totalPvp)
  );
  const zoneShare = (row: { share_units_pct?: number; share_pvp_pct?: number }) => (
    isUnits ? (row.share_units_pct || 0) : (row.share_pvp_pct || 0)
  );
  const zoneMix = (row: { brand_mix_units_pct?: number; brand_mix_pvp_pct?: number }) => (
    isUnits ? (row.brand_mix_units_pct || 0) : (row.brand_mix_pvp_pct || 0)
  );
  const categoryRank = (row: SalesBIBrandDossier['categories'][number]) => (
    isUnits
      ? (row.rank_units_in_categoria ?? null)
      : (row.rank_pvp_in_categoria ?? row.rank_in_categoria ?? null)
  );
  const categoryLeader = (row: SalesBIBrandDossier['categories'][number]) => (
    isUnits
      ? (row.leader_units_name || row.leader_name || 's/d')
      : (row.leader_pvp_name || row.leader_name || 's/d')
  );

  const providerMonthly = addBase(`${metricTitle} mensuales`, `${dossier.marca} por mes · ${metricNoun}`);
  const providerMonthlyRows = dossier.monthly_series;
  const providerMonthlyLabels = providerMonthlyRows.map((row) => monthLabel(row.mes));
  addChart(providerMonthly, 'line', chartData(metricTitle, providerMonthlyLabels, providerMonthlyRows.map((row) => metricValue(row.brand_unidades, row.brand_pvp))), {
    x: 0.85, y: 1.15, w: 11.45, h: 4.85,
    catAxisLabelRotate: 45,
    valAxisLabelFormatCode: metricFmt,
    lineSize: 2.4,
    showMarker: true,
    chartColors: [brandColor],
  });
  addTakeaway(providerMonthly, `Vista proveedor: evolución mensual continua de ${dossier.marca}, sin comparar años incompletos.`, 0.55, 6.35, 12.15);

  const providerBranches = addBase('Puntos de venta', `${dossier.marca} por sucursal · ${metricNoun}`);
  addChart(providerBranches, 'bar', chartData(metricTitle, branchRowsForProvider.map((row) => row.sucursal), branchRowsForProvider.map((row) => metricValue(row.brand_unidades, row.brand_pvp))), {
    x: 0.85, y: 1.15, w: 11.45, h: 4.85,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: metricFmt,
    chartColors: [brandColor],
  });
  addTakeaway(providerBranches, `Lectura para visita: peso de la marca en cada punto de venta medido por ${metricNoun}.`, 0.55, 6.35, 12.15);

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
        brand_mix_units_pct: ratioPct(row.brand_unidades, brand.unidades),
        brand_mix_pvp_pct: row.brand_mix_pct || ratioPct(row.brand_pvp, brand.total_vendido),
      }));

  const providerZoneMix = addBase('Venta por zona', `Cómo se reparte la venta de ${dossier.marca}`);
  const shareMetricValues = shareSource.map((row) => zoneMix(row) / 100);
  addChart(providerZoneMix, 'pie', chartData(isUnits ? 'Mix unidades' : 'Mix facturación', shareSource.map((row) => row.zona), shareMetricValues), {
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
  addTable(providerZoneMix, [
    ['Zona', metricTitle, isUnits ? 'Mix unidades' : 'Mix facturación'],
    ...shareSource.map((row) => [
      row.zona,
      metricText(row.brand_unidades, row.brand_pvp),
      pct(zoneMix(row)),
    ]),
  ], 5.85, 1.15, 6.45, 3.15, [1.6, 2.05, 1.7], 7.2);
  addTakeaway(providerZoneMix, 'Esta vista muestra distribucion propia de la marca: CABA = Caseros, GBA = Canning + Lanus + Norcenter, Venta Web separado cuando existe.', 5.85, 4.75, 6.45);

  const providerShare = addBase('In-house share por zona', `Participación de ${dossier.marca} sobre la venta total`);
  addChart(providerShare, 'bar', chartData(shareTitle, shareSource.map((row) => row.zona), shareSource.map((row) => zoneShare(row) / 100)), {
    x: 0.65, y: 1.1, w: 6.25, h: 4.85,
    barDir: 'col',
    valAxisLabelFormatCode: '0.0%',
    chartColors: [brandColor],
  });
  addTable(providerShare, [
    ['Zona', dossier.marca, 'Total zona', shareTitle],
    ...shareSource.map((row) => [
      row.zona,
      metricText(row.brand_unidades, row.brand_pvp),
      isUnits ? num(row.market_unidades || 0) : compactMoney(row.market_pvp || 0),
      pct(zoneShare(row)),
    ]),
  ], 7.2, 1.15, 5.45, 3.6, [0.95, 1.4, 1.35, 1.05], 7);
  addTakeaway(providerShare, 'Métrica nueva pedida: mide cuánto aporta la marca sobre el total vendido de cada zona, no cómo se reparte la venta propia de la marca.', 7.2, 5.05, 5.45);

  const providerTypeBranch = addBase('Tipos x punto de venta', `${metricTitle} por tipo y zona`);
  addTable(providerTypeBranch, [
    ['Tipo', 'Total', ...zoneNames],
    ...tipoRows.slice(0, 9).map((row) => [
      row.tipo,
      metricText(row.brand_unidades, row.brand_pvp),
      ...zoneNames.map((zoneName) => {
        const value = row.zones?.[zoneName];
        return value ? metricText(value.brand_unidades, value.brand_pvp) : metricText(0, 0);
      }),
    ]),
  ], 0.55, 1.1, 12.2, 5.75, [2.2, 1.55, ...zoneNames.map(() => 2.1)], 6.6);
  addTakeaway(providerTypeBranch, 'El foco deja de ser producto puntual y pasa a tipos: permite ver donde empuja cada familia comercial por zona.', 0.55, 6.55, 12.15);

  const evolution = addBase('Participación mensual', `${dossier.marca}: ${shareTitle.toLowerCase()} sobre el total vendido`);
  const monthly = dossier.monthly_series.slice(-12);
  const evoLabels = monthly.map((row) => monthLabel(row.mes));
  addChart(evolution, 'line', chartData(shareTitle, evoLabels, monthly.map((row) => (isUnits ? row.share_units_pct : row.share_pvp_pct) / 100)), {
    x: 0.55, y: 1.15, w: 7.55, h: 4.8,
    catAxisLabelRotate: 45,
    valAxisLabelFormatCode: '0.0%',
    lineSize: 2.5,
    showMarker: true,
    chartColors: brandChartColors,
  });
  addTable(evolution, [
    ['Mes', shareTitle, dossier.marca],
    ...monthly.slice(-8).map((row) => [monthLabel(row.mes), pct(isUnits ? row.share_units_pct : row.share_pvp_pct), metricText(row.brand_unidades, row.brand_pvp)]),
  ], 8.35, 1.15, 4.15, 4.8, [0.85, 1.1, 1.45]);
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
        return ((isUnits ? row?.share_units_pct : row?.share_pvp_pct) || 0) / 100;
      }),
    )), {
      x: 0.55, y: 1.1, w: 7.4, h: 4.85,
      barDir: 'col',
      valAxisLabelFormatCode: '0.0%',
      chartColors: colorsForTypes(tipoBlocks.map((block) => block.tipo)),
    });
    addTable(shareByTipo, [
      ['Tipo', shareTitle, dossier.marca],
      ...tipoBlocks.slice(0, 7).map((block) => {
        const totals = block.rows.reduce((acc, row) => ({
          bu: acc.bu + row.brand_unidades,
          bp: acc.bp + row.brand_pvp,
          mu: acc.mu + row.market_unidades,
          mp: acc.mp + row.market_pvp,
        }), { bu: 0, bp: 0, mu: 0, mp: 0 });
        return [
          block.tipo,
          pct(metricShare(totals.bu, totals.bp, totals.mu, totals.mp)),
          metricText(totals.bu, totals.bp),
        ];
      }),
    ], 8.25, 1.1, 4.2, 4.85, [1.25, 1.05, 1.45], 7);
    addTakeaway(shareByTipo, 'Sirve para ver si la marca gana o pierde peso dentro de Heladeras, Lavado, A/A, Television y otros tipos seleccionados.');
  }

  const ranking = addBase('Ranking competitivo', `${dossier.marca} frente al resto de marcas`);
  const comparisonRows = dossier.comparison_ranking?.length ? dossier.comparison_ranking : null;
  const rankRows = [...(dossier.filters.comparison_closed && comparisonRows ? comparisonRows : dossier.ranking)]
    .sort((a, b) => rowMetric(b) - rowMetric(a))
    .slice(0, 10);
  const rankShareTotalUnits = dossier.filters.comparison_closed ? rankRows.reduce((acc, row) => acc + row.unidades, 0) : market.unidades;
  const rankShareTotalPvp = dossier.filters.comparison_closed ? rankRows.reduce((acc, row) => acc + row.total_vendido, 0) : market.total_vendido;
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
    : (dossier.filters.comparison_closed
        ? brandCompetitorChartData(dossier.marca, dossier.filters.competidores || [], rankRows.map((row) => row.name), rankRows.map(rowMetric))
        : brandCompetitorRestChartData(dossier.marca, dossier.filters.competidores || [], rankRows.map((row) => row.name), rankRows.map(rowMetric))), {
    x: 0.55, y: 1.1, w: 5.7, h: 5.2,
    barDir: 'col',
    barGrouping: 'stacked',
    showLegend: rankingStack.length > 0,
    valAxisLabelFormatCode: metricFmt,
    catAxisLabelFontSize: 7,
    chartColors: rankingStack.length
      ? colorsForTypes(rankingStack.map((series) => series.name))
      : [brandColor, ...(dossier.filters.competidores || []).map(competitorColor), ...(dossier.filters.comparison_closed ? [] : [REST_COLOR])],
  });
  addTable(ranking, [
    ['Marca', metricTitle, 'Productos', shareTitle],
    ...rankRows.map((row) => [
      row.name,
      rowMetricText(row),
      num(row.productos),
      pct(metricShare(row.unidades, row.total_vendido, rankShareTotalUnits, rankShareTotalPvp)),
    ]),
  ], 6.55, 1.1, 6.15, 5.2, [1.85, 1.45, 0.9, 1.05]);
  addTakeaway(ranking, metricSafeText(dossier.narratives?.competencia, `${metricTitle}: ranking ordenado por ${metricNoun}.`));

  rankingByTipo
    .filter((block) => selectedTipos.includes(block.tipo))
    .forEach((block) => {
      const typedRanking = addBase(`Ranking competitivo · ${block.tipo}`, `${metricTitle} por marca dentro de ${block.tipo}`);
      const rows = [...block.rows].sort((a, b) => rowMetric(b) - rowMetric(a)).slice(0, 8);
      const typedShareTotalUnits = dossier.filters.comparison_closed ? rows.reduce((acc, row) => acc + row.unidades, 0) : block.market.unidades;
      const typedShareTotalPvp = dossier.filters.comparison_closed ? rows.reduce((acc, row) => acc + row.total_vendido, 0) : block.market.total_vendido;
      addChart(typedRanking, 'bar', dossier.filters.comparison_closed
        ? brandCompetitorChartData(dossier.marca, dossier.filters.competidores || [], rows.map((row) => row.name), rows.map(rowMetric))
        : brandCompetitorRestChartData(dossier.marca, dossier.filters.competidores || [], rows.map((row) => row.name), rows.map(rowMetric)), {
        x: 0.55, y: 1.1, w: 6.0, h: 4.9,
        barDir: 'col',
        barGrouping: 'stacked',
        showLegend: false,
        valAxisLabelFormatCode: metricFmt,
        catAxisLabelRotate: 35,
        chartColors: [brandColor, ...(dossier.filters.competidores || []).map(competitorColor), ...(dossier.filters.comparison_closed ? [] : [REST_COLOR])],
      });
      addTable(typedRanking, [
        ['Marca', metricTitle, 'Productos', shareTitle],
        ...rows.map((row) => [
          row.name,
          rowMetricText(row),
          num(row.productos),
          pct(metricShare(row.unidades, row.total_vendido, typedShareTotalUnits, typedShareTotalPvp)),
        ]),
      ], 6.9, 1.1, 5.7, 4.65, [1.45, 1.4, 0.85, 1.05], 6.8);
      addTakeaway(typedRanking, `${block.tipo}: ranking separado para no mezclar categorias con tickets y comportamientos distintos.`, 6.9, 5.95, 5.7);
    });

  const competitors = dossier.filters.competidores || [];
  if (competitors.length) {
    const comp = addBase('Marca vs competidores', `Comparación directa contra ${competitors.join(', ')}`);
    addChart(comp, 'bar', [
      { name: dossier.marca, labels: evoLabels, values: monthly.map((row) => (isUnits ? row.brand_unidades : row.brand_pvp)) },
      ...competitors.map((name) => ({ name, labels: evoLabels, values: monthly.map((row) => (isUnits ? row.competidores?.[name]?.unidades : row.competidores?.[name]?.total_vendido) || 0) })),
    ], {
      x: 0.55, y: 1.1, w: 7.1, h: 4.95,
      barDir: 'col',
      catAxisLabelRotate: 45,
      valAxisLabelFormatCode: metricFmt,
      chartColors: [brandColor, ...competitors.map(competitorColor)],
    });
    const duelRows = [dossier.marca, ...competitors]
      .map((name) => dossier.ranking.find((row) => row.name === name))
      .filter(Boolean) as SalesBIBrandDossier['ranking'];
    addTable(comp, [
      ['Marca', metricTitle, 'Líneas', shareTitle],
      ...duelRows.map((row) => [
        row.name,
        rowMetricText(row),
        num(row.lineas),
        pct(metricShare(row.unidades, row.total_vendido, rankShareTotalUnits, rankShareTotalPvp)),
      ]),
    ], 7.9, 1.1, 4.85, 3.5, [1.2, 1.35, 0.75, 1.0]);
    addTakeaway(comp, metricSafeText(dossier.narratives?.competencia, `${metricTitle}: comparacion directa contra las marcas elegidas.`), 7.9, 4.95, 4.85);

    const monthlyDetail = addBase('Detalle mensual competitivo', `${dossier.marca} y comparables seleccionados · todos los meses`);
    const tableNames = [dossier.marca, ...competitors].slice(0, 7);
    const cellValue = (row: SalesBIBrandDossier['monthly_series'][number], name: string) => {
      const data = name === dossier.marca
        ? { unidades: row.brand_unidades, total_vendido: row.brand_pvp }
        : row.competidores?.[name] || { unidades: 0, total_vendido: 0 };
      return isUnits ? `${num(data.unidades)} u` : compactMoney(data.total_vendido);
    };
    addTable(monthlyDetail, [
      ['Mes', ...tableNames],
      ...dossier.monthly_series.map((row) => [monthLabel(row.mes), ...tableNames.map((name) => cellValue(row, name))]),
    ], 0.45, 1.05, 12.4, 5.75, [0.72, ...tableNames.map(() => 11.65 / tableNames.length)], 5.8);
    addTakeaway(monthlyDetail, 'Tabla pensada para auditoría rápida: la comparación queda cerrada a las marcas o grupos elegidos, sin sumar competidores externos.');

    // Mismo duelo por período, pero solo sobre los tipos seleccionados.
    const monthlyTipos = (dossier.competitor_period_bars_tipos || []).slice(-12);
    const tiposHayDato = monthlyTipos.some((row) =>
      (row.brand_unidades || row.brand_pvp) ||
      competitors.some((name) => row.competidores?.[name]?.unidades || row.competidores?.[name]?.total_vendido));
    if (selectedTipos.length && tiposHayDato) {
      const tiposLabel = selectedTipos.join(', ');
      const compTipos = addBase('Marca vs competidores (tipos)', `Comparación directa contra ${competitors.join(', ')} · solo ${tiposLabel}`);
      const evoLabelsTipos = monthlyTipos.map((row) => monthLabel(row.mes));
      addChart(compTipos, 'bar', [
        { name: dossier.marca, labels: evoLabelsTipos, values: monthlyTipos.map((row) => (isUnits ? row.brand_unidades : row.brand_pvp)) },
        ...competitors.map((name) => ({ name, labels: evoLabelsTipos, values: monthlyTipos.map((row) => (isUnits ? row.competidores?.[name]?.unidades : row.competidores?.[name]?.total_vendido) || 0) })),
      ], {
        x: 0.55, y: 1.1, w: 7.1, h: 4.95,
        barDir: 'col',
        catAxisLabelRotate: 45,
        valAxisLabelFormatCode: metricFmt,
        chartColors: [brandColor, ...competitors.map(competitorColor)],
      });
      // Tabla: total del período por marca, sumando únicamente los tipos elegidos.
      const totalFor = (name: string) => monthlyTipos.reduce((acc, row) => {
        const data = name === dossier.marca
          ? { unidades: row.brand_unidades, total_vendido: row.brand_pvp }
          : row.competidores?.[name] || { unidades: 0, total_vendido: 0 };
        return acc + (isUnits ? (data.unidades || 0) : (data.total_vendido || 0));
      }, 0);
      const totalRows = [dossier.marca, ...competitors]
        .map((name) => ({ name, value: totalFor(name) }))
        .sort((a, b) => b.value - a.value);
      addTable(compTipos, [
        ['Marca', metricTitle],
        ...totalRows.map((r) => [r.name, isUnits ? `${num(r.value)} u` : compactMoney(r.value)]),
      ], 7.9, 1.1, 4.85, 3.5, [2.4, 2.45]);
      addTakeaway(compTipos, `Comparación acotada a ${tiposLabel}: mismo duelo por período pero solo sobre los tipos del foco elegido, sin arrastrar el resto del catálogo.`, 7.9, 4.95, 4.85);
    }
  }

  const cats = addBase('Categorías y oportunidades', `Dónde participa ${dossier.marca}`);
  const categoryRows = [...dossier.categories]
    .sort((a, b) => metricValue(b.brand_unidades, b.brand_pvp) - metricValue(a.brand_unidades, a.brand_pvp))
    .slice(0, 8);
  addChart(cats, 'bar', chartData(
    `${shareTitle} %`,
    categoryRows.map((row) => row.categoria),
    categoryRows.map((row) => (isUnits ? row.share_units_pct : row.share_pvp_pct) / 100),
  ), {
    x: 0.55, y: 1.1, w: 5.8, h: 4.9,
    barDir: 'bar',
    valAxisLabelFormatCode: '0.0%',
    showLegend: false,
    chartColors: [brandColor],
  });
  addTable(cats, [
    ['Categoría', metricTitle, shareTitle, 'Rank', 'Líder', ...(!isUnits ? ['Índice'] : [])],
    ...categoryRows.map((row) => [
      row.categoria,
      metricText(row.brand_unidades, row.brand_pvp),
      pct(isUnits ? row.share_units_pct : row.share_pvp_pct),
      categoryRank(row) ? `#${categoryRank(row)}` : 's/d',
      categoryLeader(row),
      ...(!isUnits ? [row.price_index.toFixed(0)] : []),
    ]),
  ], 6.65, 1.1, 6.0, 4.9, isUnits ? [1.2, 1.2, 0.85, 0.5, 1.3] : [1.2, 1.25, 0.85, 0.55, 1.25, 0.6]);
  addTakeaway(cats, metricSafeText(dossier.narratives?.categorias || dossier.narratives?.oportunidad, `${shareTitle}: participacion por categoria segun ${metricNoun}.`));

  if (dossier.price_bands?.bands?.length) {
    const bands = addBase('Gamas de precio', `${shareTitle} por posicionamiento de precio`);
    const bandRows = dossier.price_bands.bands;
    const bandBrandPvpTotal = bandRows.reduce((acc, row) => acc + row.brand_pvp, 0);
    addChart(bands, 'bar', chartData(shareTitle, bandRows.map((row) => row.banda), bandRows.map((row) => (isUnits ? row.share_units_pct : row.share_pvp_pct) / 100)), {
      x: 0.55, y: 1.1, w: 6.1, h: 4.8,
      barDir: 'col',
      valAxisLabelFormatCode: '0.0%',
      showLegend: false,
      chartColors: [brandColor],
    });
    addTable(bands, [
      ['Gama', metricTitle, shareTitle, 'Mix marca'],
      ...bandRows.map((row) => [
        row.banda,
        metricText(row.brand_unidades, row.brand_pvp),
        pct(isUnits ? row.share_units_pct : row.share_pvp_pct),
        pct(isUnits ? row.brand_mix_units_pct : (row.brand_mix_pvp_pct || ratioPct(row.brand_pvp, bandBrandPvpTotal))),
      ]),
    ], 7.05, 1.1, 5.1, 3.6, [1.25, 1.35, 1.1, 1.1]);
    addTakeaway(bands, metricSafeText(dossier.narratives?.bandas, `${shareTitle}: participacion por gama de precio.`), 7.05, 5.05, 5.1);
  }

  if (dossier.price_bands_by_tipo?.length) {
    const bandsByTipo = addBase('Gamas de precio por tipo', 'Participación de la marca por gama dentro de tipos clave');
    const bandTipoRows = dossier.price_bands_by_tipo
      .filter((block) => !selectedTipos.length || selectedTipos.includes(block.tipo))
      .flatMap((block) => {
        const blockBrandPvpTotal = block.bands.reduce((acc, band) => acc + band.brand_pvp, 0);
        return block.bands.map((band) => ({
          tipo: block.tipo,
          banda: band.banda,
          share: isUnits ? band.share_units_pct : band.share_pvp_pct,
          mix: isUnits ? band.brand_mix_units_pct : (band.brand_mix_pvp_pct || ratioPct(band.brand_pvp, blockBrandPvpTotal)),
          unidades: band.brand_unidades,
          pvp: band.brand_pvp,
        }));
      })
      .sort((a, b) => metricValue(b.unidades, b.pvp) - metricValue(a.unidades, a.pvp))
      .slice(0, 12);
    addTable(bandsByTipo, [
      ['Tipo', 'Gama', metricTitle, shareTitle, 'Mix marca'],
      ...bandTipoRows.map((row) => [row.tipo, row.banda, metricText(row.unidades, row.pvp), pct(row.share), pct(row.mix)]),
    ], 0.55, 1.15, 12.15, 4.8, [1.75, 1.5, 1.35, 1.0, 1.0], 7);
    addTakeaway(bandsByTipo, 'Lectura comercial: permite ver si la marca compite mejor en entrada, media o premium dentro de cada tipo seleccionado.');

    dossier.price_bands_by_tipo
      .filter((block) => !selectedTipos.length || selectedTipos.includes(block.tipo))
      .forEach((block) => {
        const bandsByTypeSlide = addBase(`Gamas de precio · ${block.tipo}`, `${shareTitle} de ${dossier.marca} por gama`);
        addChart(bandsByTypeSlide, 'bar', chartData(shareTitle, block.bands.map((band) => band.banda), block.bands.map((band) => (isUnits ? band.share_units_pct : band.share_pvp_pct) / 100)), {
          x: 0.55, y: 1.1, w: 6.65, h: 4.85,
          barDir: 'col',
          valAxisLabelFormatCode: '0.0%',
          showLegend: false,
          chartColors: [brandColor],
        });
        addTable(bandsByTypeSlide, [
          ['Gama', dossier.marca, 'Mercado', shareTitle],
          ...block.bands.map((band) => [
            band.banda,
            metricText(band.brand_unidades, band.brand_pvp),
            metricText(band.market_unidades, band.market_pvp),
            pct(isUnits ? band.share_units_pct : band.share_pvp_pct),
          ]),
        ], 7.55, 1.2, 4.85, 3.25, [0.95, 1.3, 1.25, 0.95], 6.8);
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
  ).sort((a, b) => metricValue(b.brand_unidades, b.brand_pvp) - metricValue(a.brand_unidades, a.brand_pvp)).slice(0, 12);
  addTable(typesSlide, [
    ['Tipo', metricTitle, shareTitle, ...zoneNames],
    ...typeRows.map((row) => {
      const zoneTotals = Object.values(row.zones || {}).reduce((acc, value) => ({
        brandUnits: acc.brandUnits + value.brand_unidades,
        brandPvp: acc.brandPvp + value.brand_pvp,
        marketUnits: acc.marketUnits + value.market_unidades,
        marketPvp: acc.marketPvp + value.market_pvp,
      }), { brandUnits: 0, brandPvp: 0, marketUnits: 0, marketPvp: 0 });
      const fallbackMarket = dossier.tipos_top.find((item) => item.tipo === row.tipo);
      const shareText = zoneTotals.marketUnits || zoneTotals.marketPvp
        ? pct(metricShare(zoneTotals.brandUnits, zoneTotals.brandPvp, zoneTotals.marketUnits, zoneTotals.marketPvp))
        : pct(isUnits ? (fallbackMarket?.share_units_pct || 0) : (fallbackMarket?.share_pvp_pct || 0));
      return [
        row.tipo,
        metricText(row.brand_unidades, row.brand_pvp),
        shareText,
        ...zoneNames.map((zoneName) => {
          const value = row.zones?.[zoneName];
          return value ? metricText(value.brand_unidades, value.brand_pvp) : metricText(0, 0);
        }),
      ];
    }),
  ], 0.55, 1.05, 12.2, 5.35, [1.75, 1.25, 0.9, ...zoneNames.map(() => 1.25)], 6.9);
  addTakeaway(typesSlide, metricSafeText(dossier.narratives?.tipos, `Vista enfocada en ${metricNoun}: tipos comerciales, no productos puntuales.`));

  const typeShareRows = typeRows
    .map((row) => {
      const zoneTotals = Object.values(row.zones || {}).reduce((acc, value) => ({
        brandUnits: acc.brandUnits + value.brand_unidades,
        brandPvp: acc.brandPvp + value.brand_pvp,
        marketUnits: acc.marketUnits + value.market_unidades,
        marketPvp: acc.marketPvp + value.market_pvp,
      }), { brandUnits: 0, brandPvp: 0, marketUnits: 0, marketPvp: 0 });
      const fallback = dossier.tipos_top.find((item) => item.tipo === row.tipo);
      const marketUnits = zoneTotals.marketUnits || fallback?.market_unidades || 0;
      const marketPvp = zoneTotals.marketPvp || fallback?.market_pvp || 0;
      return {
        tipo: row.tipo,
        brand_unidades: row.brand_unidades,
        brand_pvp: row.brand_pvp,
        market_unidades: marketUnits,
        market_pvp: marketPvp,
        share: metricShare(row.brand_unidades, row.brand_pvp, marketUnits, marketPvp),
      };
    })
    .filter((row) => row.brand_unidades || row.brand_pvp || row.market_unidades || row.market_pvp)
    .sort((a, b) => b.share - a.share)
    .slice(0, 10);
  if (typeShareRows.length) {
    const typeShareSlide = addBase('Share por tipo', `${dossier.marca}: participacion dentro de cada tipo`);
    addChart(typeShareSlide, 'bar', chartData(shareTitle, typeShareRows.map((row) => row.tipo), typeShareRows.map((row) => row.share / 100)), {
      x: 0.55, y: 1.1, w: 6.1, h: 4.9,
      barDir: 'bar',
      valAxisLabelFormatCode: '0.0%',
      showLegend: false,
      chartColors: [brandColor],
    });
    addTable(typeShareSlide, [
      ['Tipo', dossier.marca, 'Mercado', shareTitle],
      ...typeShareRows.map((row) => [
        row.tipo,
        metricText(row.brand_unidades, row.brand_pvp),
        isUnits ? `${num(row.market_unidades)} u` : compactMoney(row.market_pvp),
        pct(row.share),
      ]),
    ], 7.0, 1.1, 5.35, 4.55, [1.25, 1.25, 1.25, 1.0], 6.8);
    addTakeaway(typeShareSlide, `Nuevo corte por ${metricNoun}: identifica en que tipos la marca gana share real y donde queda espacio comercial.`, 7.0, 5.9, 5.35);
  }

  const branches = addBase('Presencia por zona', `Peso de ${dossier.marca} en CABA, GBA y Venta Web`);
  const zonePresenceRows = shareSource.slice(0, 8);
  addChart(branches, 'bar', chartData(metricTitle, zonePresenceRows.map((row) => row.zona), zonePresenceRows.map((row) => (
    isUnits ? row.brand_unidades : row.brand_pvp
  ))), {
    x: 0.55, y: 1.1, w: 5.8, h: 4.9,
    barDir: 'col',
    showLegend: false,
    valAxisLabelFormatCode: metricFmt,
    chartColors: [brandColor],
  });
  addTable(branches, [
    ['Zona', metricTitle, shareTitle, 'Mix marca'],
    ...zonePresenceRows.map((row) => [
      row.zona,
      metricText(row.brand_unidades, row.brand_pvp),
      pct(zoneShare(row)),
      pct(zoneMix(row)),
    ]),
  ], 6.65, 1.1, 5.8, 4.0, [1.15, 1.45, 1.05, 1.05], 7);
  addTakeaway(branches, 'La presencia queda agrupada por zona para mostrar CABA, GBA y Venta Web sin dispersar la lectura por sucursales.', 6.65, 5.45, 5.8);

  const closing = addBase('Conclusiones y próximos pasos', 'Lectura accionable para reunión comercial');
  addTwoColumnList(closing, 0.55, 1.15, 3.9, 'Fortalezas', metricSafeList(dossier.conclusions.fortalezas), GREEN);
  addTwoColumnList(closing, 4.72, 1.15, 3.9, 'Oportunidades', metricSafeList(dossier.conclusions.oportunidades), AMBER);
  addTwoColumnList(closing, 8.88, 1.15, 3.9, 'Acciones sugeridas', metricSafeList(dossier.conclusions.acciones), brandColor);

  await pptx.writeFile({
    fileName: `informe-editable-${cleanFileName(dossier.marca)}-${dossier.filters.fecha_desde}-${mode}.pptx`,
    compression: true,
  });
}
