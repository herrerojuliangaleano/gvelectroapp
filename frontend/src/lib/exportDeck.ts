/**
 * Exportación de "decks": captura secciones del DOM tal como se ven (alta
 * resolución) y arma un PowerPoint (.pptx) o un PDF apaisado, 1 slide/página
 * por sección + portada, agenda y cierre nativos.
 *
 * Reglas (skill powerpoint): fuentes web-safe (Arial), colores SIN '#' en
 * PptxGenJS, layouts full-slide. Las librerías pesadas (pptxgenjs, jspdf,
 * html-to-image) se cargan con dynamic import SOLO al exportar.
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
  /** Si viene, genera slide de agenda con estos títulos. */
  agenda?: string[];
  /** Texto del slide de cierre (default "Gracias"). */
  closing?: string;
}

const FONT = 'Arial';
const SLIDE_BG = '0B1220';
const SLIDE_BG_CSS = '#0b1220';
const TEXT_MUTED = '93A4C3';
const ACCENT = '60A5FA';

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
  pptx.author = 'ElectroGV';
  pptx.company = 'ElectroGV';
  pptx.title = `${meta.title} — ${meta.subtitle}`;
  pptx.subject = meta.period;

  const addFooter = (slide: ReturnType<typeof pptx.addSlide>, pageNo: number, total: number) => {
    if (meta.footer) {
      slide.addText(meta.footer, { x: 0.5, y: 7.08, w: 10.5, h: 0.35, fontSize: 9, color: TEXT_MUTED, fontFace: FONT });
    }
    slide.addText(`${pageNo} / ${total}`, { x: 12.3, y: 7.08, w: 0.9, h: 0.35, fontSize: 9, color: TEXT_MUTED, fontFace: FONT, align: 'right' });
  };

  const totalSlides = 1 + (meta.agenda?.length ? 1 : 0) + sections.length + 1;
  let pageNo = 1;

  // Portada
  const cover = pptx.addSlide();
  cover.background = { color: SLIDE_BG };
  cover.addShape('rect', { x: 0.7, y: 2.05, w: 2.2, h: 0.07, fill: { color: ACCENT } });
  cover.addText(meta.subtitle.toUpperCase(), { x: 0.7, y: 2.25, w: 12, h: 0.5, fontSize: 16, color: TEXT_MUTED, charSpacing: 4, fontFace: FONT });
  cover.addText(meta.title, { x: 0.7, y: 2.7, w: 12, h: 1.5, fontSize: 54, bold: true, color: 'FFFFFF', fontFace: FONT });
  cover.addText(meta.period, { x: 0.7, y: 4.25, w: 12, h: 0.6, fontSize: 20, color: TEXT_MUTED, fontFace: FONT });
  if (meta.footer) {
    cover.addText(meta.footer, { x: 0.7, y: 6.9, w: 12, h: 0.4, fontSize: 10, color: TEXT_MUTED, fontFace: FONT });
  }

  // Agenda
  if (meta.agenda?.length) {
    pageNo += 1;
    const agenda = pptx.addSlide();
    agenda.background = { color: SLIDE_BG };
    agenda.addText('AGENDA', { x: 0.7, y: 0.55, w: 12, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', charSpacing: 3, fontFace: FONT });
    const half = Math.ceil(meta.agenda.length / 2);
    const col = (items: string[], startIdx: number, x: number) => {
      agenda.addText(
        items.map((t, i) => ({
          text: `${String(startIdx + i + 1).padStart(2, '0')}   ${t}\n`,
          options: { fontSize: 16, color: 'FFFFFF', fontFace: FONT, breakLine: true, paraSpaceAfter: 12 },
        })),
        { x, y: 1.5, w: 5.9, h: 5.2, valign: 'top' },
      );
    };
    col(meta.agenda.slice(0, half), 0, 0.8);
    if (meta.agenda.length > half) col(meta.agenda.slice(half), half, 6.9);
    addFooter(agenda, pageNo, totalSlides);
  }

  let done = 0;
  for (const section of sections) {
    const img = await captureNode(section.node);
    pageNo += 1;
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText(section.title, { x: 0.5, y: 0.22, w: 12.3, h: 0.5, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: FONT });
    addFooter(slide, pageNo, totalSlides);
    const area = { w: 12.4, h: 6.15 };
    const { w, h } = fit(img, area.w, area.h);
    slide.addImage({ data: img.dataUrl, x: (13.333 - w) / 2, y: 0.8 + (area.h - h) / 2, w, h });
    done += 1;
    onProgress?.(done, sections.length);
  }

  // Cierre
  pageNo += 1;
  const closing = pptx.addSlide();
  closing.background = { color: SLIDE_BG };
  closing.addShape('rect', { x: 0.7, y: 3.0, w: 2.2, h: 0.07, fill: { color: ACCENT } });
  closing.addText(meta.closing || 'Gracias', { x: 0.7, y: 3.2, w: 12, h: 1.2, fontSize: 44, bold: true, color: 'FFFFFF', fontFace: FONT });
  closing.addText(`ElectroGV · ${meta.period}`, { x: 0.7, y: 4.4, w: 12, h: 0.5, fontSize: 16, color: TEXT_MUTED, fontFace: FONT });

  await pptx.writeFile({ fileName: `${meta.fileName}.pptx` });
}

export async function exportDeckToPdf(meta: DeckMeta, sections: DeckSection[], onProgress?: (done: number, total: number) => void) {
  const { jsPDF } = await import('jspdf');
  // A4 apaisado en puntos: 841.89 × 595.28
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const totalPages = 1 + (meta.agenda?.length ? 1 : 0) + sections.length + 1;
  let pageNo = 1;

  const paintBg = () => {
    pdf.setFillColor(11, 18, 32);
    pdf.rect(0, 0, pageW, pageH, 'F');
  };
  const paintFooter = () => {
    pdf.setFontSize(7.5);
    pdf.setTextColor(147, 164, 195);
    if (meta.footer) pdf.text(meta.footer, 40, pageH - 18);
    pdf.text(`${pageNo} / ${totalPages}`, pageW - 60, pageH - 18);
  };

  // Portada
  paintBg();
  pdf.setFillColor(96, 165, 250);
  pdf.rect(56, 196, 130, 5, 'F');
  pdf.setTextColor(147, 164, 195);
  pdf.setFontSize(13);
  pdf.text(meta.subtitle.toUpperCase(), 56, 225);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(42);
  pdf.setFont('helvetica', 'bold');
  pdf.text(meta.title, 56, 275);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(16);
  pdf.setTextColor(147, 164, 195);
  pdf.text(meta.period, 56, 310);
  paintFooter();

  // Agenda
  if (meta.agenda?.length) {
    pdf.addPage();
    pageNo += 1;
    paintBg();
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('AGENDA', 56, 70);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(13);
    const half = Math.ceil(meta.agenda.length / 2);
    meta.agenda.forEach((t, i) => {
      const colX = i < half ? 60 : pageW / 2 + 20;
      const rowY = 115 + (i % half) * 30;
      pdf.setTextColor(96, 165, 250);
      pdf.text(String(i + 1).padStart(2, '0'), colX, rowY);
      pdf.setTextColor(255, 255, 255);
      pdf.text(t, colX + 30, rowY);
    });
    paintFooter();
  }

  let done = 0;
  for (const section of sections) {
    const img = await captureNode(section.node);
    pdf.addPage();
    pageNo += 1;
    paintBg();
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(section.title, 40, 34);
    pdf.setFont('helvetica', 'normal');
    paintFooter();
    const area = { w: pageW - 80, h: pageH - 90 };
    const { w, h } = fit(img, area.w, area.h);
    pdf.addImage(img.dataUrl, 'PNG', (pageW - w) / 2, 48 + (area.h - h) / 2, w, h);
    done += 1;
    onProgress?.(done, sections.length);
  }

  // Cierre
  pdf.addPage();
  pageNo += 1;
  paintBg();
  pdf.setFillColor(96, 165, 250);
  pdf.rect(56, 250, 130, 5, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(38);
  pdf.setFont('helvetica', 'bold');
  pdf.text(meta.closing || 'Gracias', 56, 300);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(14);
  pdf.setTextColor(147, 164, 195);
  pdf.text(`ElectroGV · ${meta.period}`, 56, 330);
  paintFooter();

  pdf.save(`${meta.fileName}.pdf`);
}
