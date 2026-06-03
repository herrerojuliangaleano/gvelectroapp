"""Renderer del PDF del PSI.

Layout (referencia: hoja "PSI SMART LIFE 8/05 AL 18/05" del Drive):

  +--------+-----------------------------------------------+
  |  LOGO  |                  TÍTULO                       |
  +--------+-----------------------------------------------+
  |                                                        |
  |  SKU | DESCRIPCION                | STOCK | SELL OUT  |
  |  --- | -------------------------- | ----- | --------  |
  |  ... | ...                        | ...   | ...       |
  |                                                        |
  |  TOTALES: stock=N, sell_out=N                         |
  |  Filtros: ...                                         |
  +--------------------------------------------------------+

Logo configurable: GV / ABC / sin logo.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..config import get_settings
from ..operational_config import load_operational_config


def _logo_path(logo: str) -> Path | None:
    """Resuelve la ruta del logo según la elección del usuario.

    Busca primero la ruta configurada en operational_config.commercial.logos,
    después cae al default ``storage/brand/{logo}-electro.png``.
    """
    logo_norm = (logo or "").upper()
    if logo_norm == "NONE":
        return None
    cfg = load_operational_config().get("commercial", {}) or {}
    logos = cfg.get("logos", {}) or {}
    settings = get_settings()
    backend_root = settings.storage_dir.parent  # backend/

    key = "gv_path" if logo_norm == "GV" else "abc_path" if logo_norm == "ABC" else None
    if not key:
        return None
    rel = str(logos.get(key) or "")
    if rel:
        path = (backend_root / rel).resolve() if not Path(rel).is_absolute() else Path(rel)
        if path.exists():
            return path
    # Fallback al patrón estándar
    fallback = backend_root / "storage" / "brand" / f"{logo_norm.lower()}-electro.png"
    return fallback if fallback.exists() else None


def render_psi_pdf(
    *,
    titulo: str,
    items: list[dict[str, Any]],
    totals: dict[str, Any],
    filters_applied: dict[str, Any],
    gfk_files_used: list[dict[str, Any]] | None = None,
    logo: str = "GV",
) -> bytes:
    """Genera el PDF del reporte PSI.

    Args:
        titulo: ej "PSI SMART LIFE 8/05 AL 18/05".
        items: list de PSIReportRow serializados (mismo shape que /report).
        totals: dict con stock, sell_out, productos_visibles, etc.
        filters_applied: filtros que se aplicaron.
        gfk_files_used: opcional, info de los GFK consultados.
        logo: "GV" | "ABC" | "NONE".

    Returns:
        bytes del PDF.
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=1.2 * cm,
        rightMargin=1.2 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.2 * cm,
        title=titulo,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TituloPSI",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        alignment=TA_CENTER,
        textColor=black,
        spaceAfter=12,
    )
    subtitle_style = ParagraphStyle(
        "SubtituloPSI",
        parent=styles["Normal"],
        fontSize=9,
        alignment=TA_CENTER,
        textColor=HexColor("#6B7280"),
        spaceAfter=12,
    )
    cell_style = ParagraphStyle(
        "CeldaPSI",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
    )

    story: list = []

    # Header: logo + título lado a lado
    logo_p = _logo_path(logo)
    if logo_p:
        try:
            img = RLImage(str(logo_p), width=3.5 * cm, height=2.0 * cm)
            img.hAlign = "LEFT"
            header_table = Table(
                [[img, Paragraph(titulo, title_style)]],
                colWidths=[4.0 * cm, 14.5 * cm],
            )
            header_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN",  (1, 0), (1, 0), "CENTER"),
            ]))
            story.append(header_table)
        except Exception:
            # Si falla cargar la imagen, fallback a solo título
            story.append(Paragraph(titulo, title_style))
    else:
        story.append(Paragraph(titulo, title_style))

    # Subtítulo con filtros
    filt = filters_applied or {}
    filtros_txt_parts: list[str] = []
    if filt.get("marcas"):
        filtros_txt_parts.append(f"Marcas: {', '.join(filt['marcas'])}")
    if filt.get("tipos"):
        filtros_txt_parts.append(f"Tipos: {', '.join(filt['tipos'])}")
    cond = filt.get("condicion")
    if cond and cond != "TODO":
        filtros_txt_parts.append(f"Condición: {cond}")
    if filt.get("periodo_inicio") and filt.get("periodo_fin"):
        filtros_txt_parts.append(f"Rango: {filt['periodo_inicio']} → {filt['periodo_fin']}")
    if filtros_txt_parts:
        story.append(Paragraph(" · ".join(filtros_txt_parts), subtitle_style))
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#D1D5DB"), spaceBefore=4, spaceAfter=10))

    # Tabla de productos
    headers = ["SKU", "Descripción", "Marca", "Stock", "Sell out"]
    data: list[list[Any]] = [headers]
    for r in items:
        data.append([
            Paragraph(str(r.get("sku") or ""), cell_style),
            Paragraph(str(r.get("descripcion") or ""), cell_style),
            Paragraph(str(r.get("marca") or ""), cell_style),
            str(r.get("stock") or 0),
            str(r.get("sell_out") or 0),
        ])
    if len(data) == 1:
        data.append([Paragraph("Sin productos para los filtros aplicados.", cell_style), "", "", "", ""])

    table = Table(
        data,
        colWidths=[3.0 * cm, 8.5 * cm, 3.0 * cm, 1.8 * cm, 2.2 * cm],
        repeatRows=1,
    )
    table.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0), HexColor("#1E3A8A")),
        ("TEXTCOLOR",      (0, 0), (-1, 0), white),
        ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, 0), 9),
        ("ALIGN",          (3, 0), (-1, -1), "RIGHT"),
        ("ALIGN",          (0, 0), (2, 0),   "LEFT"),
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#F9FAFB")]),
        ("GRID",           (0, 0), (-1, -1), 0.25, HexColor("#E5E7EB")),
        ("LEFTPADDING",    (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 4),
        ("TOPPADDING",     (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 3),
    ]))
    story.append(table)

    # Footer: totales + GFK + filtros
    story.append(Spacer(1, 0.4 * cm))
    totals_text = (
        f"<b>Totales</b> · "
        f"Productos: {totals.get('productos_visibles', 0)} · "
        f"Stock: {totals.get('stock', 0)} · "
        f"Sell out: {totals.get('sell_out', 0)} · "
        f"Ajustes pendientes: {totals.get('ajustes_pendientes', 0)}"
    )
    story.append(Paragraph(totals_text, ParagraphStyle(
        "TotalesPSI", parent=styles["Normal"], fontSize=9, textColor=black,
    )))

    if gfk_files_used:
        gfk_text = "<b>GFK consultados:</b> " + ", ".join(
            f"#{int(f.get('correlativo') or 0)} ({f.get('fecha_inicio', '')} → {f.get('fecha_fin', '')})"
            for f in gfk_files_used
        )
        story.append(Paragraph(gfk_text, ParagraphStyle(
            "GFKPSI", parent=styles["Normal"], fontSize=8, textColor=HexColor("#6B7280"),
        )))

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
