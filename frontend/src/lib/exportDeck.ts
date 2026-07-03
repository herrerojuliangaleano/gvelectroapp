/**
 * Exportación de "decks": captura secciones del DOM tal como se ven (alta
 * resolución) y arma un PowerPoint (.pptx) o un PDF apaisado, 1 slide/página
 * por sección. Las librerías pesadas (pptxgenjs, jspdf, html-to-image) se
 * cargan con dynamic import SOLO al exportar — no entran al bundle inicial.
 */

export interface DeckSection {
  node: HTMLElement;
  title: string;
}

export interface DeckMeta {
  /** Título grande de la portada (ej. "SAMSUNG"). */
  title: string;
  /** Subtítulo (ej. "Informe comercial · ElectroGV"). */
  subtitle: string;
  /** Período legible (ej. "01/04/2026 – 31/05/2026"). */
  period: string;
  /** Pie chico en cada slide (fuente / aviso). */
  footer?: string;
  /** Nombre base del archivo, sin extensión. */
  fileName: string;
}

const SLIDE_BG = '0B1220';
const SLIDE_BG_CSS = '#0b1220';
const TEXT_MUTED = '93A4C3';

interface Captured {
  dataUrl: string;
  width: number;
  height: number;
}

async function captureNode(node: HTMLElement): Promise<Captured> {
  const { toPng } = await import('html-to-image');
  const rect = node.getBoundingClientRect();
  // ~2200px de ancho objetivo: nítido en proyector sin explotar memoria.
  const pixelRatio = Math.min(3, Math.max(2, 2200 / Math.max(1, rect.width)));
  const dataUrl = await toPng(node, {
    pixelRatio,
    backgroundColor: SLIDE_BG_CSS,
    cacheBust: true,
    filter: (el) => !(el instanceof HTMLElement && el.dataset?.exportSkip === 'true'),
  });
  return { dataUrl, width: rect.width * pixelRatio, height: rect.height * pixelRatio };
}

function fit(img: Captured, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = img.width / Math.max(1, img.height);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

export async function exportDeckToPptx(meta: DeckMeta, sections: DeckSection[], onProgress?: (done: number, total: number) => void) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE_169', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE_169';

  // Portada
  const cover = pptx.addSlide();
  cover.background = { color: SLIDE_BG };
  cover.addText(meta.subtitle.toUpperCase(), { x: 0.7, y: 2.15, w: 12, h: 0.5, fontSize: 16, color: TEXT_MUTED, charSpacing: 4 });
  cover.addText(meta.title, { x: 0.7, y: 2.6, w: 12, h: 1.5, fontSize: 54, bold: true, color: 'FFFFFF' });
  cover.addText(meta.period, { x: 0.7, y: 4.15, w: 12, h: 0.6, fontSize: 20, color: TEXT_MUTED });
  if (meta.footer) {
    cover.addText(meta.footer, { x: 0.7, y: 6.9, w: 12, h: 0.4, fontSize: 10, color: TEXT_MUTED });
  }

  let done = 0;
  for (const section of sections) {
    const img = await captureNode(section.node);
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText(section.title, { x: 0.5, y: 0.22, w: 12.3, h: 0.5, fontSize: 18, bold: true, color: 'FFFFFF' });
    if (meta.footer) {
      slide.addText(meta.footer, { x: 0.5, y: 7.08, w: 12.3, h: 0.35, fontSize: 9, color: TEXT_MUTED });
    }
    const area = { w: 12.4, h: 6.15 };
    const { w, h } = fit(img, area.w, area.h);
    slide.addImage({ data: img.dataUrl, x: (13.333 - w) / 2, y: 0.8 + (area.h - h) / 2, w, h });
    done += 1;
    onProgress?.(done, sections.length);
  }

  await pptx.writeFile({ fileName: `${meta.fileName}.pptx` });
}

export async function exportDeckToPdf(meta: DeckMeta, sections: DeckSection[], onProgress?: (done: number, total: number) => void) {
  const { jsPDF } = await import('jspdf');
  // A4 apaisado en puntos: 841.89 × 595.28
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const paintBg = () => {
    pdf.setFillColor(11, 18, 32);
    pdf.rect(0, 0, pageW, pageH, 'F');
  };

  // Portada
  paintBg();
  pdf.setTextColor(147, 164, 195);
  pdf.setFontSize(13);
  pdf.text(meta.subtitle.toUpperCase(), 56, 220);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(42);
  pdf.setFont('helvetica', 'bold');
  pdf.text(meta.title, 56, 275);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(16);
  pdf.setTextColor(147, 164, 195);
  pdf.text(meta.period, 56, 310);
  if (meta.footer) {
    pdf.setFontSize(8);
    pdf.text(meta.footer, 56, pageH - 28);
  }

  let done = 0;
  for (const section of sections) {
    const img = await captureNode(section.node);
    pdf.addPage();
    paintBg();
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(section.title, 40, 34);
    pdf.setFont('helvetica', 'normal');
    if (meta.footer) {
      pdf.setFontSize(7.5);
      pdf.setTextColor(147, 164, 195);
      pdf.text(meta.footer, 40, pageH - 18);
    }
    const area = { w: pageW - 80, h: pageH - 90 };
    const { w, h } = fit(img, area.w, area.h);
    pdf.addImage(img.dataUrl, 'PNG', (pageW - w) / 2, 48 + (area.h - h) / 2, w, h);
    done += 1;
    onProgress?.(done, sections.length);
  }

  pdf.save(`${meta.fileName}.pdf`);
}
