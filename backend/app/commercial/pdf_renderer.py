"""Renderer del PDF del PSI — diseño ejecutivo.

Layout (referencia: mockup compartido con el gerente):

  +----+ ELECTRO GV  [Reporte PSI]              Marca: ...
  | GV | Reporte de Stock y Sell-Out por marca  Período: ...
  +----+ Generado DD/MM/YYYY HH:MM              Sucursales: ...
                                                Responsable: ... (si GERENTE_COMERCIAL)
                                                Pág. 1/N
  ─────────────────────────────────────────────────────────
  Resumen ejecutivo

  [ STOCK TOTAL ]   [ SELL OUT TOTAL ]

  ┌─────┬───────────────┬───────┬──────┬───────┬─────────┬──────┬───────┐
  │ SKU │ DESCRIPCIÓN   │ MARCA │ STOCK│ SELL  │ ROTACIÓN│ COB. │ ESTADO│
  │     │               │       │      │ OUT   │ ▰▰▱▱ %  │ (M)  │       │
  └─────┴───────────────┴───────┴──────┴───────┴─────────┴──────┴───────┘

  ● OK / cobertura sana   ● Reponer o exceso   ● Quiebre / crítico   ● Sin venta
  Electro GV · Reporte PSI · Confidencial — uso interno   Pág. N/N
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
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


AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# ──────────────────────────────────────────────────────────────────────────
# Paleta
# ──────────────────────────────────────────────────────────────────────────

# Constantes hex como STRINGS (para usar en <font color="#XXXXXX"> de Paragraph)
H_TEXT_1     = "#0F172A"
H_TEXT_2     = "#334155"
H_TEXT_3     = "#64748B"
H_BORDER     = "#E2E8F0"
H_SUBTLE_BG  = "#F8FAFC"
H_ACCENT     = "#2563EB"
H_SUCCESS    = "#10B981"
H_WARNING    = "#F59E0B"
H_DANGER     = "#EF4444"
H_MUTED      = "#94A3B8"
H_BAR_FILL   = "#6366F1"

# Versiones HexColor (para TableStyle / colores nativos de reportlab)
C_TEXT_1     = HexColor(H_TEXT_1)
C_TEXT_2     = HexColor(H_TEXT_2)
C_TEXT_3     = HexColor(H_TEXT_3)
C_BORDER     = HexColor(H_BORDER)
C_SUBTLE_BG  = HexColor(H_SUBTLE_BG)
C_ACCENT     = HexColor(H_ACCENT)
C_SUCCESS    = HexColor(H_SUCCESS)
C_WARNING    = HexColor(H_WARNING)
C_DANGER     = HexColor(H_DANGER)
C_MUTED      = HexColor(H_MUTED)
C_BAR_FILL   = HexColor(H_BAR_FILL)

# ──────────────────────────────────────────────────────────────────────────
# Estado / clasificación
# ──────────────────────────────────────────────────────────────────────────

ESTADO_OK         = "OK"
ESTADO_REPONER    = "Reponer"
ESTADO_SIN_VENTA  = "Sin venta"
ESTADO_QUIEBRE    = "Quiebre"
ESTADO_CRITICO    = "Crítico"
ESTADO_EXCESO     = "Exceso"
ESTADO_AJUSTE     = "Ajuste stock"

ESTADO_COLORS: dict[str, tuple[HexColor, HexColor]] = {
    # (text_color, background_color)
    ESTADO_OK:        (HexColor("#065F46"), HexColor("#D1FAE5")),
    ESTADO_REPONER:   (HexColor("#92400E"), HexColor("#FEF3C7")),
    ESTADO_SIN_VENTA: (HexColor("#475569"), HexColor("#E2E8F0")),
    ESTADO_QUIEBRE:   (HexColor("#7F1D1D"), HexColor("#FECACA")),
    ESTADO_CRITICO:   (HexColor("#7F1D1D"), HexColor("#FECACA")),
    ESTADO_EXCESO:    (HexColor("#1E3A8A"), HexColor("#DBEAFE")),
    ESTADO_AJUSTE:    (HexColor("#92400E"), HexColor("#FEF3C7")),
}

ESTADO_DOT_GROUP: dict[str, HexColor] = {
    ESTADO_OK:        C_SUCCESS,
    ESTADO_REPONER:   C_WARNING,
    ESTADO_EXCESO:    C_WARNING,
    ESTADO_SIN_VENTA: C_MUTED,
    ESTADO_QUIEBRE:   C_DANGER,
    ESTADO_CRITICO:   C_DANGER,
    ESTADO_AJUSTE:    C_WARNING,
}


def _calc_metrics(stock: int, sell_out: int) -> dict[str, Any]:
    """Calcula rotación, cobertura y estado de un producto."""
    s = int(stock or 0)
    v = int(sell_out or 0)
    # Rotación: % del stock actual que se vendió, capped al 100% (visual)
    if s > 0:
        rotacion_pct = min(100, round(v * 100 / s))
    else:
        rotacion_pct = 100 if v > 0 else 0
    # Cobertura en meses (asume sell_out = ventas del último mes)
    if v > 0:
        cobertura_m: Optional[float] = round(s / v, 1) if s > 0 else 0.0
    else:
        cobertura_m = None

    # Estado
    if s < 0:
        estado = ESTADO_AJUSTE
    elif s == 0 and v > 0:
        estado = ESTADO_QUIEBRE
    elif v == 0:
        estado = ESTADO_SIN_VENTA
    elif cobertura_m is not None and cobertura_m < 0.5:
        estado = ESTADO_CRITICO
    elif cobertura_m is not None and cobertura_m < 1.5:
        estado = ESTADO_REPONER
    elif cobertura_m is not None and cobertura_m > 6:
        estado = ESTADO_EXCESO
    else:
        estado = ESTADO_OK

    return {
        "rotacion_pct": rotacion_pct,
        "cobertura_m":  cobertura_m,
        "estado":       estado,
    }


# ──────────────────────────────────────────────────────────────────────────
# Logo
# ──────────────────────────────────────────────────────────────────────────

def _logo_path(logo: str) -> Optional[Path]:
    logo_norm = (logo or "").upper()
    if logo_norm == "NONE":
        return None
    cfg = load_operational_config().get("commercial", {}) or {}
    logos = cfg.get("logos", {}) or {}
    settings = get_settings()
    backend_root = settings.storage_dir.parent

    key = "gv_path" if logo_norm == "GV" else "abc_path" if logo_norm == "ABC" else None
    if not key:
        return None
    rel = str(logos.get(key) or "")
    if rel:
        path = (backend_root / rel).resolve() if not Path(rel).is_absolute() else Path(rel)
        if path.exists():
            return path
    fallback = backend_root / "storage" / "brand" / f"{logo_norm.lower()}-electro.png"
    return fallback if fallback.exists() else None


# ──────────────────────────────────────────────────────────────────────────
# Helpers de armado
# ──────────────────────────────────────────────────────────────────────────

def _rotacion_cell(pct: int) -> Table:
    """Celda con barra horizontal + porcentaje a la derecha."""
    pct = max(0, min(100, int(pct or 0)))
    # Barra: ancho total 28mm dividido entre fill + resto
    bar_total_mm = 22
    fill_mm = bar_total_mm * pct / 100
    bar = Table(
        [[
            Table([[""]], colWidths=[fill_mm * mm if fill_mm > 0 else 0.01 * mm], rowHeights=[2.5 * mm],
                  style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), C_BAR_FILL),
                                    ("BOX",        (0, 0), (-1, -1), 0, C_BAR_FILL)])),
            Table([[""]], colWidths=[(bar_total_mm - fill_mm) * mm if (bar_total_mm - fill_mm) > 0 else 0.01 * mm],
                  rowHeights=[2.5 * mm],
                  style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HexColor("#E5E7EB")),
                                    ("BOX",        (0, 0), (-1, -1), 0, HexColor("#E5E7EB"))])),
        ]],
        colWidths=[fill_mm * mm if fill_mm > 0 else 0.01 * mm, (bar_total_mm - fill_mm) * mm if (bar_total_mm - fill_mm) > 0 else 0.01 * mm],
        rowHeights=[2.5 * mm],
        style=TableStyle([
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]),
    )
    pct_text = Paragraph(
        f'<font color="#475569">{pct}%</font>',
        ParagraphStyle("RotPct", fontName="Helvetica", fontSize=8, alignment=TA_RIGHT),
    )
    container = Table(
        [[bar, pct_text]],
        colWidths=[bar_total_mm * mm, 10 * mm],
        style=TableStyle([
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]),
    )
    return container


def _estado_badge(estado: str) -> Table:
    """Pill con color por estado."""
    fg, bg = ESTADO_COLORS.get(estado, (C_TEXT_2, C_SUBTLE_BG))
    p = Paragraph(
        f'<font color="#{fg.hexval()[2:]}"><b>{estado}</b></font>',
        ParagraphStyle("EstBadge", fontName="Helvetica-Bold", fontSize=8, alignment=TA_CENTER),
    )
    badge = Table(
        [[p]],
        colWidths=[20 * mm],
        rowHeights=[5.5 * mm],
        style=TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), bg),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 3),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 3),
            ("TOPPADDING",    (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ("ROUNDEDCORNERS", [3, 3, 3, 3]),
        ]),
    )
    return badge


def _meta_lines(meta_pairs: list[tuple[str, str]]) -> Paragraph:
    """Bloque derecho con líneas 'Label: value' alineadas a la derecha."""
    lines = []
    for label, value in meta_pairs:
        lines.append(
            f'<font color="{H_TEXT_3}"><b>{label}:</b></font>'
            f' <font color="{H_TEXT_2}">{value}</font>'
        )
    style = ParagraphStyle("Meta", fontName="Helvetica", fontSize=8.5, alignment=TA_RIGHT, leading=12)
    return Paragraph("<br/>".join(lines), style)


# ──────────────────────────────────────────────────────────────────────────
# Render principal
# ──────────────────────────────────────────────────────────────────────────

def render_psi_pdf(
    *,
    titulo: str,
    items: list[dict[str, Any]],
    totals: dict[str, Any],
    filters_applied: dict[str, Any],
    gfk_files_used: list[dict[str, Any]] | None = None,
    logo: str = "GV",
    responsable: Optional[str] = None,
    responsable_area: str = "Comercial",
    empresa_nombre: Optional[str] = None,
) -> bytes:
    """Genera el PDF del reporte PSI.

    Args:
        titulo: título principal (no se muestra prominente, queda como meta).
        items: list de PSIReportRow serializados.
        totals: dict con stock, sell_out, productos_visibles.
        filters_applied: filtros que se aplicaron (marcas/tipos/condicion/periodo).
        gfk_files_used: opcional, info de los GFK consultados.
        logo: "GV" | "ABC" | "NONE".
        responsable: nombre del responsable a mostrar. Si None → no se imprime.
            Política: solo se debería pasar si el usuario es GERENTE_COMERCIAL.
        responsable_area: área del responsable (por defecto "Comercial").
        empresa_nombre: "ELECTRO GV" / "ELECTRO ABC SRL". Si None se infiere del logo.
    """
    buffer = BytesIO()
    # A4 landscape para que la tabla rica entre cómoda
    page_size = landscape(A4)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=1.2 * cm,
        rightMargin=1.2 * cm,
        topMargin=1.0 * cm,
        bottomMargin=1.2 * cm,
        title=titulo,
    )

    styles = getSampleStyleSheet()
    h1_style = ParagraphStyle(
        "H1",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        alignment=TA_LEFT,
        textColor=C_TEXT_1,
        spaceAfter=2,
    )
    h2_style = ParagraphStyle(
        "H2",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        textColor=C_TEXT_1,
        spaceBefore=4,
        spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "Sub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        textColor=C_TEXT_3,
        leading=11,
    )
    tag_style = ParagraphStyle(
        "Tag",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        textColor=white,
        alignment=TA_CENTER,
    )
    cell_style = ParagraphStyle(
        "Cell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=10.5,
        textColor=C_TEXT_2,
    )
    cell_style_bold = ParagraphStyle(
        "CellB",
        parent=cell_style,
        fontName="Helvetica-Bold",
        textColor=C_TEXT_1,
    )

    # Empresa por defecto según logo
    if empresa_nombre is None:
        empresa_nombre = "ELECTRO GV" if logo.upper() == "GV" else "ELECTRO ABC SRL" if logo.upper() == "ABC" else "ELECTRO"

    # ─── HEADER ────────────────────────────────────────────────────────
    now_local = datetime.now(AR_TZ)
    fecha_generado = now_local.strftime("%d/%m/%Y %H:%M")

    # Tag "Reporte PSI" como tabla con fondo
    tag = Table(
        [[Paragraph("Reporte PSI", tag_style)]],
        colWidths=[24 * mm],
        rowHeights=[5 * mm],
        style=TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_ACCENT),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]),
    )

    # Línea 1: título + tag
    titulo_table = Table(
        [[Paragraph(empresa_nombre, h1_style), tag]],
        colWidths=[60 * mm, 28 * mm],
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]),
    )

    # Bloque izquierdo: logo + título + subtítulo
    logo_p = _logo_path(logo)
    if logo_p:
        try:
            logo_img = RLImage(str(logo_p), width=14 * mm, height=14 * mm)
            logo_img.hAlign = "LEFT"
        except Exception:
            logo_img = Paragraph("", sub_style)
    else:
        # Círculo gris con las iniciales
        initials = "GV" if logo.upper() == "GV" else "ABC" if logo.upper() == "ABC" else ""
        logo_img = Table(
            [[Paragraph(f'<font color="{H_TEXT_2}"><b>{initials}</b></font>',
                        ParagraphStyle("Logo", fontSize=10, alignment=TA_CENTER))]],
            colWidths=[14 * mm], rowHeights=[14 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), C_SUBTLE_BG),
                ("BOX",        (0, 0), (-1, -1), 1, C_BORDER),
                ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
            ]),
        )

    subtitle = Paragraph(
        f"Reporte de Stock y Sell-Out por marca · Generado {fecha_generado}",
        sub_style,
    )
    left_block = Table(
        [[logo_img, [titulo_table, subtitle]]],
        colWidths=[18 * mm, 110 * mm],
        style=TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]),
    )

    # ─── HEADER derecho: metadata ──────────────────────────────────────
    filt = filters_applied or {}
    marcas_list = filt.get("marcas") or []
    tipos_list  = filt.get("tipos")  or []
    marca_text = ", ".join(marcas_list) if marcas_list else "Todas"
    tipos_text = f"Todos ({len(filt.get('tipos') or []) or '—'})" if not tipos_list else ", ".join(tipos_list)
    pi = filt.get("periodo_inicio") or ""
    pf = filt.get("periodo_fin") or ""

    def _fmt_date(iso: str) -> str:
        try:
            d = datetime.strptime(iso, "%Y-%m-%d")
            return d.strftime("%d/%m/%Y")
        except (TypeError, ValueError):
            return iso

    periodo_text = f"{_fmt_date(pi)} → {_fmt_date(pf)}" if pi and pf else "—"

    meta_pairs: list[tuple[str, str]] = [
        ("Marca",      marca_text),
        ("Período",    periodo_text),
        ("Sucursales", "Todas"),
    ]
    if filt.get("condicion") and filt["condicion"] != "TODO":
        meta_pairs.append(("Condición", filt["condicion"]))
    if responsable:
        full = f"{responsable} · {responsable_area}" if responsable_area else responsable
        meta_pairs.append(("Responsable", full))

    right_block = _meta_lines(meta_pairs)

    header_table = Table(
        [[left_block, right_block]],
        colWidths=[145 * mm, 120 * mm],
        style=TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]),
    )

    story: list = [header_table, Spacer(1, 4 * mm)]

    # ─── RESUMEN EJECUTIVO ──────────────────────────────────────────────
    story.append(Paragraph("Resumen ejecutivo", h2_style))
    story.append(Spacer(1, 2 * mm))

    def _kpi_card(label: str, value: str) -> Table:
        return Table(
            [
                [Paragraph(f'<font color="{H_TEXT_3}" size="7"><b>{label}</b></font>',
                           ParagraphStyle("KPILabel", fontSize=7, alignment=TA_LEFT, leading=8))],
                [Paragraph(f'<font color="{H_TEXT_1}" size="22"><b>{value}</b></font>',
                           ParagraphStyle("KPIValue", fontSize=22, alignment=TA_LEFT, leading=26))],
            ],
            colWidths=[55 * mm],
            style=TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), C_SUBTLE_BG),
                ("BOX",           (0, 0), (-1, -1), 0.5, C_BORDER),
                ("LEFTPADDING",   (0, 0), (-1, -1), 8),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                ("TOPPADDING",    (0, 0), (0, 0), 8),
                ("TOPPADDING",    (0, 1), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 10),
            ]),
        )

    stock_total = int(totals.get("stock") or 0)
    sell_total  = int(totals.get("sell_out") or 0)
    kpi_row = Table(
        [[_kpi_card("STOCK TOTAL", f"{stock_total:,}".replace(",", ".")),
          _kpi_card("SELL OUT TOTAL", f"{sell_total:,}".replace(",", "."))]],
        colWidths=[55 * mm, 55 * mm],
        style=TableStyle([
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 8),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ]),
    )
    story.append(kpi_row)
    story.append(Spacer(1, 6 * mm))

    # ─── TABLA DE PRODUCTOS ──────────────────────────────────────────────
    headers_row = [
        Paragraph(f'<font color="{H_TEXT_3}"><b>SKU</b></font>',         cell_style),
        Paragraph(f'<font color="{H_TEXT_3}"><b>DESCRIPCIÓN</b></font>', cell_style),
        Paragraph(f'<font color="{H_TEXT_3}"><b>MARCA</b></font>',       cell_style),
        Paragraph(f'<font color="{H_TEXT_3}"><b>STOCK</b></font>',       ParagraphStyle("HRA", parent=cell_style, alignment=TA_RIGHT)),
        Paragraph(f'<font color="{H_TEXT_3}"><b>SELL-OUT</b></font>',    ParagraphStyle("HRA", parent=cell_style, alignment=TA_RIGHT)),
        Paragraph(f'<font color="{H_TEXT_3}"><b>ROTACIÓN</b></font>',    cell_style),
        Paragraph(f'<font color="{H_TEXT_3}"><b>COB. (M)</b></font>',    ParagraphStyle("HRA", parent=cell_style, alignment=TA_RIGHT)),
        Paragraph(f'<font color="{H_TEXT_3}"><b>ESTADO</b></font>',      ParagraphStyle("HRC", parent=cell_style, alignment=TA_CENTER)),
    ]
    data_rows: list[list[Any]] = [headers_row]

    for r in items:
        stock = int(r.get("stock") or 0)
        sell  = int(r.get("sell_out") or 0)
        metrics = _calc_metrics(stock, sell)
        cobertura = metrics["cobertura_m"]
        cob_text = "—" if cobertura is None else f"{cobertura:.1f}".replace(".", ",")

        # Color del sell-out: verde si rotó bien, gris normal
        sell_color = C_SUCCESS if metrics["rotacion_pct"] >= 80 and sell > 0 else C_TEXT_1
        stock_color = C_DANGER if stock < 0 else (C_TEXT_3 if stock == 0 else C_TEXT_1)

        data_rows.append([
            Paragraph(str(r.get("sku") or ""), cell_style_bold),
            Paragraph(str(r.get("descripcion") or ""), cell_style),
            Paragraph(str(r.get("marca") or ""), cell_style),
            Paragraph(f'<font color="#{stock_color.hexval()[2:]}"><b>{stock}</b></font>',
                      ParagraphStyle("StRa", parent=cell_style, alignment=TA_RIGHT)),
            Paragraph(f'<font color="#{sell_color.hexval()[2:]}"><b>{sell}</b></font>',
                      ParagraphStyle("SoRa", parent=cell_style, alignment=TA_RIGHT)),
            _rotacion_cell(metrics["rotacion_pct"]),
            Paragraph(cob_text, ParagraphStyle("CbRa", parent=cell_style, alignment=TA_RIGHT)),
            _estado_badge(metrics["estado"]),
        ])

    if len(data_rows) == 1:
        data_rows.append([
            Paragraph("Sin productos para los filtros aplicados.", cell_style),
            "", "", "", "", "", "", "",
        ])

    col_widths = [
        28 * mm,  # SKU
        85 * mm,  # Descripción
        20 * mm,  # Marca
        17 * mm,  # Stock
        20 * mm,  # Sell-out
        34 * mm,  # Rotación
        17 * mm,  # Cob.
        25 * mm,  # Estado
    ]
    main_table = Table(data_rows, colWidths=col_widths, repeatRows=1)
    main_table.setStyle(TableStyle([
        # Header
        ("BACKGROUND",     (0, 0), (-1, 0), C_SUBTLE_BG),
        ("LINEBELOW",      (0, 0), (-1, 0), 0.5, C_BORDER),
        # Rows
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW",      (0, 1), (-1, -1), 0.25, C_BORDER),
        # Padding
        ("LEFTPADDING",    (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 4),
        ("TOPPADDING",     (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 5),
    ]))
    story.append(main_table)

    # ─── FOOTER ────────────────────────────────────────────────────────
    story.append(Spacer(1, 4 * mm))

    def _legend_dot(estado: str, label: str) -> str:
        color_hex = "#" + ESTADO_DOT_GROUP.get(estado, C_MUTED).hexval()[2:]
        return (
            f'<font color="{color_hex}" size="11">●</font> '
            f'<font color="{H_TEXT_3}">{label}</font>'
        )

    legend_text = "    ".join([
        _legend_dot(ESTADO_OK,        "OK / cobertura sana"),
        _legend_dot(ESTADO_REPONER,   "Reponer o exceso"),
        _legend_dot(ESTADO_QUIEBRE,   "Quiebre / crítico"),
        _legend_dot(ESTADO_SIN_VENTA, "Sin venta"),
    ])
    story.append(Paragraph(legend_text, ParagraphStyle("Legend", fontSize=8, leading=12)))

    # Funciones para pintar el footer con número de página
    def _on_page(canv, doc_obj):
        canv.saveState()
        canv.setFont("Helvetica", 7.5)
        canv.setFillColor(C_TEXT_3)
        # Izquierda
        canv.drawString(1.2 * cm, 0.5 * cm,
                        f"{empresa_nombre.title()} · Reporte PSI · Confidencial — uso interno")
        # Derecha: Pág. X/Y
        page_text = f"Pág. {doc_obj.page}"
        canv.drawRightString(page_size[0] - 1.2 * cm, 0.5 * cm, page_text)
        canv.restoreState()

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
