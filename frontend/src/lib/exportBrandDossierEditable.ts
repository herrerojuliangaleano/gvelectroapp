import type { SalesBIBrandDossier } from '../types';

type PptxModule = typeof import('pptxgenjs');

const FONT = 'Arial';
const BG = 'F8FAFC';
const INK = '0F172A';
const MUTED = '64748B';
const LINE = 'CBD5E1';
const BLUE = '2563EB';
const TEAL = '0F766E';
const VIOLET = '7C3AED';
const AMBER = 'D97706';
const GREEN = '059669';
const RED = 'DC2626';
const CARD = 'FFFFFF';
const SOFT_BLUE = 'DBEAFE';

const COLORS = [BLUE, VIOLET, TEAL, AMBER, 'E11D48', '0891B2', '65A30D', '9333EA'];
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

function growth(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function chartData(name: string, labels: string[], values: number[]) {
  return [{ name, labels, values }];
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

function addKpi(slide: any, x: number, y: number, w: number, label: string, value: string, note?: string, accent = BLUE) {
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
  slide.addShape('roundRect', { x, y, w, h: 0.36, rectRadius: 0.05, fill: { color: SOFT_BLUE }, line: { color: 'BFDBFE', pt: 0.6 } });
  slide.addText(text, { x: x + 0.15, y: y + 0.09, w: w - 0.3, h: 0.18, fontFace: FONT, fontSize: 8, color: INK, bold: true, margin: 0, fit: 'shrink' });
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
    chartColors: COLORS,
    dataLabelFontFace: FONT,
    dataLabelFontSize: 7,
    dataLabelColor: INK,
    ...options,
  });
}

function addTable(slide: any, rows: Array<Array<string>>, x: number, y: number, w: number, h: number, widths?: number[], fontSize = 8) {
  const tableRows = rows.map((row, rowIndex) => row.map((cell) => (
    textCell(cell, rowIndex === 0, rowIndex === 0 ? 'FFFFFF' : INK, rowIndex === 0 ? BLUE : 'FFFFFF', rowIndex === 0 ? Math.max(fontSize, 7.5) : fontSize)
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

export async function exportBrandDossierEditablePptx(dossier: SalesBIBrandDossier): Promise<void> {
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
  const brand = dossier.totals.brand;
  const brandPrev = dossier.totals.brand_prev;
  const brandGrowth = growth(brand.total_vendido, brandPrev.total_vendido);
  const page = { value: 1 };
  const addBase = (slideTitle: string, subtitle?: string) => {
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    title(slide, slideTitle, subtitle);
    footer(slide, period, page.value);
    page.value += 1;
    return slide;
  };

  const cover = pptx.addSlide();
  cover.background = { color: INK };
  cover.addShape('rect', { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: INK } });
  cover.addShape('rect', { x: 0.75, y: 1.35, w: 1.5, h: 0.07, fill: { color: BLUE } });
  cover.addText('INFORME COMERCIAL EDITABLE', { x: 0.75, y: 1.55, w: 9.5, h: 0.32, fontFace: FONT, fontSize: 13, bold: true, color: '93C5FD', charSpacing: 2.5, margin: 0 });
  cover.addText(dossier.marca, { x: 0.75, y: 2.05, w: 11.7, h: 0.95, fontFace: FONT, fontSize: 42, bold: true, color: 'FFFFFF', margin: 0, fit: 'shrink' });
  cover.addText(period, { x: 0.78, y: 3.08, w: 8.5, h: 0.35, fontFace: FONT, fontSize: 15, color: 'CBD5E1', margin: 0 });
  cover.addText('Fuente: Ventas Vs. Costos · gráficos y tablas editables en PowerPoint', { x: 0.78, y: 6.75, w: 9.5, h: 0.28, fontFace: FONT, fontSize: 9, color: 'CBD5E1', margin: 0 });
  cover.addShape('roundRect', { x: 9.75, y: 1.55, w: 2.5, h: 2.5, rectRadius: 0.18, fill: { color: '1E3A8A' }, line: { color: '60A5FA', pt: 1.2 } });
  cover.addText('GV\nElectro', { x: 10.12, y: 2.05, w: 1.75, h: 0.95, fontFace: FONT, fontSize: 22, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
  page.value += 1;

  const summary = addBase('Resumen ejecutivo', `${dossier.marca} en ElectroGV · lectura rápida`);
  addKpi(summary, 0.55, 1.1, 1.9, 'Facturación', compactMoney(brand.total_vendido), brandGrowth == null ? undefined : `${brandGrowth >= 0 ? '+' : ''}${pct(brandGrowth)} vs anterior`, BLUE);
  addKpi(summary, 2.65, 1.1, 1.55, 'Unidades', num(brand.unidades), undefined, TEAL);
  addKpi(summary, 4.4, 1.1, 1.55, 'Productos', num(brand.productos), 'activos', VIOLET);
  addKpi(summary, 6.15, 1.1, 1.75, 'Share PVP', pct(dossier.share.pvp_pct), `${dossier.share.delta_pts >= 0 ? '+' : ''}${dossier.share.delta_pts.toFixed(1)} pts`, AMBER);
  addKpi(summary, 8.1, 1.1, 1.6, 'Ranking', dossier.share.rank_pvp ? `#${dossier.share.rank_pvp}` : 's/d', `${dossier.share.total_brands} marcas`, GREEN);
  addKpi(summary, 9.9, 1.1, 1.85, 'Precio índice', dossier.price_index_global.toFixed(0), '100 = mercado', BLUE);
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
  const productBranchRows = (dossier.product_branch_metrics?.length
    ? [...dossier.product_branch_metrics]
    : dossier.top_products.map((product) => ({
        sku: product.sku,
        producto: product.producto,
        tipo_producto: product.tipo_producto,
        total_unidades: product.unidades,
        total_vendido: product.total_vendido,
        branches: {} as Record<string, { unidades: number; total_vendido: number }>,
      }))
  ).sort((a, b) => (b.total_unidades - a.total_unidades) || (b.total_vendido - a.total_vendido));

  const providerMonthly = addBase('Ventas mensuales', `${dossier.marca} por mes · unidades y pesos`);
  const providerMonthlyRows = dossier.monthly_series;
  const providerMonthlyLabels = providerMonthlyRows.map((row) => monthLabel(row.mes));
  addChart(providerMonthly, 'line', chartData('Unidades', providerMonthlyLabels, providerMonthlyRows.map((row) => row.brand_unidades)), {
    x: 0.55, y: 1.15, w: 5.85, h: 4.85,
    catAxisLabelRotate: 45,
    valAxisLabelFormatCode: '#,##0',
    lineSize: 2.4,
    showMarker: true,
  });
  addChart(providerMonthly, 'line', chartData('Pesos', providerMonthlyLabels, providerMonthlyRows.map((row) => row.brand_pvp)), {
    x: 6.85, y: 1.15, w: 5.85, h: 4.85,
    catAxisLabelRotate: 45,
    valAxisLabelFormatCode: '$ #,##0',
    lineSize: 2.4,
    showMarker: true,
  });
  addTakeaway(providerMonthly, `Vista proveedor: evolución mensual continua de ${dossier.marca}, sin comparar años incompletos.`, 0.55, 6.35, 12.15);

  const providerBranches = addBase('Puntos de venta', `${dossier.marca} por sucursal · unidades y pesos`);
  addChart(providerBranches, 'bar', chartData('Unidades', branchRowsForProvider.map((row) => row.sucursal), branchRowsForProvider.map((row) => row.brand_unidades)), {
    x: 0.55, y: 1.15, w: 5.85, h: 4.85,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: '#,##0',
  });
  addChart(providerBranches, 'bar', chartData('Pesos', branchRowsForProvider.map((row) => row.sucursal), branchRowsForProvider.map((row) => row.brand_pvp)), {
    x: 6.85, y: 1.15, w: 5.85, h: 4.85,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: '$ #,##0',
  });
  addTakeaway(providerBranches, 'Lectura para visita: peso de la marca en cada punto de venta, separado en volumen y facturacion.', 0.55, 6.35, 12.15);

  const providerShare = addBase('In-house share por punto de venta', `Participacion de ${dossier.marca} sobre la venta total de cada sucursal`);
  addChart(providerShare, 'bar', chartData('Share unidades %', branchRowsForProvider.map((row) => row.sucursal), branchRowsForProvider.map((row) => branchShareUnits(row) / 100)), {
    x: 0.55, y: 1.1, w: 5.7, h: 3.8,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: '0.0%',
  });
  addChart(providerShare, 'bar', chartData('Share pesos %', branchRowsForProvider.map((row) => row.sucursal), branchRowsForProvider.map((row) => row.share_in_branch_pct / 100)), {
    x: 6.95, y: 1.1, w: 5.7, h: 3.8,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: '0.0%',
  });
  addTable(providerShare, [
    ['Sucursal', `${dossier.marca} u`, 'Total u', 'Share u', `${dossier.marca} $`, 'Share $'],
    ...branchRowsForProvider.map((row) => [
      row.sucursal,
      num(row.brand_unidades),
      row.market_unidades != null ? num(row.market_unidades) : 's/d',
      pct(branchShareUnits(row)),
      compactMoney(row.brand_pvp),
      pct(row.share_in_branch_pct),
    ]),
  ], 0.75, 5.25, 11.75, 1.15, [1.8, 1.2, 1.2, 1.1, 1.5, 1.1], 6.8);

  const providerProductBranch = addBase('Producto x punto de venta', 'Unidades y pesos por producto y sucursal');
  addTable(providerProductBranch, [
    ['Producto', 'Total', ...branchColumns],
    ...productBranchRows.slice(0, 8).map((row) => [
      `${row.sku}\n${row.producto}`,
      `${num(row.total_unidades)} u\n${compactMoney(row.total_vendido)}`,
      ...branchColumns.map((branchName) => {
        const value = row.branches?.[branchName];
        return value ? `${num(value.unidades)} u\n${compactMoney(value.total_vendido)}` : '0 u\n$ 0';
      }),
    ]),
  ], 0.55, 1.1, 12.2, 5.75, [3.2, 1.35, ...branchColumns.map(() => 1.9)], 6.2);
  addTakeaway(providerProductBranch, 'Detalle solicitado: permite ver que productos empujan la marca en cada punto de venta.', 0.55, 6.55, 12.15);

  const evolution = addBase('Participación mensual', `${dossier.marca}: share sobre el total vendido`);
  const monthly = dossier.monthly_series.slice(-12);
  const evoLabels = monthly.map((row) => monthLabel(row.mes));
  addChart(evolution, 'line', [
    { name: 'Share pesos', labels: evoLabels, values: monthly.map((row) => row.share_pvp_pct / 100) },
    { name: 'Share unidades', labels: evoLabels, values: monthly.map((row) => row.share_units_pct / 100) },
  ], {
    x: 0.55, y: 1.15, w: 7.55, h: 4.8,
    catAxisLabelRotate: 45,
    valAxisLabelFormatCode: '0.0%',
    lineSize: 2.5,
    showMarker: true,
  });
  addTable(evolution, [
    ['Mes', 'Share u', 'Share $', `${dossier.marca} u`, `${dossier.marca} $`],
    ...monthly.slice(-8).map((row) => [monthLabel(row.mes), pct(row.share_units_pct), pct(row.share_pvp_pct), num(row.brand_unidades), compactMoney(row.brand_pvp)]),
  ], 8.35, 1.15, 4.15, 4.8, [0.75, 0.8, 0.8, 0.85, 1.15]);
  addTakeaway(evolution, `Participación mensual: muestra cuánto pesa ${dossier.marca} dentro del total, sin compararlo contra una escala de mercado mucho más grande.`);

  const ranking = addBase('Ranking competitivo', `${dossier.marca} frente al resto de marcas`);
  const rankRows = dossier.ranking.slice(0, 10);
  addChart(ranking, 'bar', chartData('Facturación', rankRows.map((row) => row.name), rankRows.map((row) => row.total_vendido)), {
    x: 0.55, y: 1.1, w: 5.7, h: 5.2,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: '$ #,##0',
    catAxisLabelFontSize: 7,
  });
  addTable(ranking, [
    ['Marca', 'Facturación', 'Unidades', 'Productos', 'Share'],
    ...rankRows.map((row) => [row.name, compactMoney(row.total_vendido), num(row.unidades), num(row.productos), pct(row.participacion_pct)]),
  ], 6.55, 1.1, 6.15, 5.2, [1.85, 1.25, 0.85, 0.75, 0.9]);
  addTakeaway(ranking, dossier.narratives?.competencia);

  const competitors = dossier.filters.competidores || [];
  if (competitors.length) {
    const comp = addBase('Marca vs competidores', `Comparación directa contra ${competitors.join(', ')}`);
    addChart(comp, 'line', [
      { name: dossier.marca, labels: evoLabels, values: monthly.map((row) => row.brand_pvp) },
      ...competitors.map((name) => ({ name, labels: evoLabels, values: monthly.map((row) => row.competidores?.[name]?.total_vendido || 0) })),
    ], {
      x: 0.55, y: 1.1, w: 7.1, h: 4.95,
      catAxisLabelRotate: 45,
      valAxisLabelFormatCode: '$ #,##0',
      lineSize: 2.25,
      showMarker: true,
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
  addChart(cats, 'bar', chartData('Share PVP %', categoryRows.map((row) => row.categoria), categoryRows.map((row) => row.share_pvp_pct / 100)), {
    x: 0.55, y: 1.1, w: 5.8, h: 4.9,
    barDir: 'bar',
    valAxisLabelFormatCode: '0.0%',
    showLegend: false,
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
    const bands = addBase('Bandas de precio', 'Mix de unidades por posicionamiento de precio');
    const bandRows = dossier.price_bands.bands;
    addChart(bands, 'bar', [
      { name: `Mix ${dossier.marca}`, labels: bandRows.map((row) => row.banda), values: bandRows.map((row) => row.brand_mix_units_pct / 100) },
      { name: 'Mix mercado', labels: bandRows.map((row) => row.banda), values: bandRows.map((row) => row.market_mix_units_pct / 100) },
    ], {
      x: 0.55, y: 1.1, w: 6.1, h: 4.8,
      barDir: 'col',
      valAxisLabelFormatCode: '0.0%',
    });
    addTable(bands, [
      ['Banda', `Unid. ${dossier.marca}`, 'Share unid.', 'Facturación'],
      ...bandRows.map((row) => [row.banda, num(row.brand_unidades), pct(row.share_units_pct), compactMoney(row.brand_pvp)]),
    ], 7.05, 1.1, 5.1, 3.6, [1.45, 1.2, 1.15, 1.3]);
    addTakeaway(bands, dossier.narratives?.bandas, 7.05, 5.05, 5.1);
  }

  const products = addBase('Productos destacados', `Top productos de ${dossier.marca}`);
  addTable(products, [
    ['SKU', 'Producto', 'Tipo', 'Unid.', 'Facturación', 'Share'],
    ...dossier.top_products.slice(0, 12).map((row) => [
      row.sku,
      row.producto,
      row.tipo_producto,
      num(row.unidades),
      compactMoney(row.total_vendido),
      pct(row.participacion_pct),
    ]),
  ], 0.55, 1.05, 12.2, 5.35, [1.15, 5.3, 1.75, 0.65, 1.25, 0.75]);
  addTakeaway(products, dossier.narratives?.productos);

  const branches = addBase('Presencia por sucursal', `Peso de ${dossier.marca} en cada sucursal`);
  const branchRows = dossier.branches.slice(0, 8);
  addChart(branches, 'bar', chartData('Facturación', branchRows.map((row) => row.sucursal), branchRows.map((row) => row.brand_pvp)), {
    x: 0.55, y: 1.1, w: 5.8, h: 4.9,
    barDir: 'bar',
    showLegend: false,
    valAxisLabelFormatCode: '$ #,##0',
  });
  addTable(branches, [
    ['Sucursal', 'Facturación', 'Unidades', 'Share suc.', 'Mix marca'],
    ...branchRows.map((row) => [
      row.sucursal,
      compactMoney(row.brand_pvp),
      num(row.brand_unidades),
      pct(row.share_in_branch_pct),
      pct(row.brand_mix_pct),
    ]),
  ], 6.65, 1.1, 5.8, 4.0, [1.25, 1.3, 0.85, 1.0, 1.0]);
  addTakeaway(branches, dossier.narratives?.sucursales, 6.65, 5.45, 5.8);

  const closing = addBase('Conclusiones y próximos pasos', 'Lectura accionable para reunión comercial');
  addTwoColumnList(closing, 0.55, 1.15, 3.9, 'Fortalezas', dossier.conclusions.fortalezas, GREEN);
  addTwoColumnList(closing, 4.72, 1.15, 3.9, 'Oportunidades', dossier.conclusions.oportunidades, AMBER);
  addTwoColumnList(closing, 8.88, 1.15, 3.9, 'Acciones sugeridas', dossier.conclusions.acciones, BLUE);

  await pptx.writeFile({
    fileName: `informe-editable-${cleanFileName(dossier.marca)}-${dossier.filters.fecha_desde}.pptx`,
    compression: true,
  });
}
