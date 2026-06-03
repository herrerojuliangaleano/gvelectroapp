"""Renderer del PDF del PSI — diseño ejecutivo simplificado (v3).

Layout pedido por el gerente:

  +----+  Reporte PSI                                 Marca: ...
  |LOGO|  ELECTRO GV                                  Período: ...
  +----+  Reporte de Stock y Sell-Out por marca       Sucursales: Todas
          Generado DD/MM/YYYY HH:MM                   Responsable: ... (si GERENTE_COMERCIAL)

         [ STOCK TOTAL ]    [ SELL OUT TOTAL ]

  ┌─────┬───────────────┬───────┬────────┬──────────┐
  │ SKU │ DESCRIPCIÓN   │ MARCA │ STOCK  │ SELL-OUT │
  └─────┴───────────────┴───────┴────────┴──────────┘
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    Image as RLImage,
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

H_TEXT_1     = "#0F172A"
H_TEXT_2     = "#334155"
H_TEXT_3     = "#64748B"
H_BORDER     = "#E2E8F0"
H_SUBTLE_BG  = "#F8FAFC"
H_ACCENT     = "#2563EB"
H_SUCCESS    = "#10B981"
H_DANGER     = "#EF4444"

C_TEXT_1     = HexColor(H_TEXT_1)
C_TEXT_2     = HexColor(H_TEXT_2)
C_TEXT_3     = HexColor(H_TEXT_3)
C_BORDER     = HexColor(H_BORDER)
C_SUBTLE_BG  = HexColor(H_SUBTLE_BG)
C_ACCENT     = HexColor(H_ACCENT)
C_SUCCESS    = HexColor(H_SUCCESS)
C_DANGER     = HexColor(H_DANGER)


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
    candidates: list[Path] = []
    rel = str(logos.get(key) or "")
    if rel:
        candidates.append((backend_root / rel).resolve() if not Path(rel).is_absolute() else Path(rel))
    # Fallbacks razonables
    candidates.append(backend_root / "storage" / "logos" / f"{logo_norm.lower()}_electro.png")
    candidates.append(backend_root / "storage" / "brand"  / f"{logo_norm.lower()}-electro.png")
    for path in candidates:
        if path.exists():
            return path
    return None


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _meta_lines(meta_pairs: list[tuple[str, str]]) -> Paragraph:
    """Bloque metadata derecha — líneas 'Label: value'."""
    lines = []
    for label, value in meta_pairs:
        lines.append(
            f'<font color="{H_TEXT_3}"><b>{label}:</b></font>'
            f' <font color="{H_TEXT_2}">{value}</font>'
        )
    style = ParagraphStyle("Meta", fontName="Helvetica", fontSize=9, alignment=TA_RIGHT, leading=13)
    return Paragraph("<br/>".join(lines), style)


def _kpi_card(label: str, value: str) -> Table:
    return Table(
        [
            [Paragraph(f'<font color="{H_TEXT_3}" size="7.5"><b>{label}</b></font>',
                       ParagraphStyle("KPILabel", fontSize=7.5, alignment=TA_LEFT, leading=9))],
            [Paragraph(f'<font color="{H_TEXT_1}" size="24"><b>{value}</b></font>',
                       ParagraphStyle("KPIValue", fontSize=24, alignment=TA_LEFT, leading=28))],
        ],
        colWidths=[60 * mm],
        style=TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_SUBTLE_BG),
            ("BOX",           (0, 0), (-1, -1), 0.5, C_BORDER),
            ("LEFTPADDING",   (0, 0), (-1, -1), 10),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (0, 0), 10),
            ("TOPPADDING",    (0, 1), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 12),
        ]),
    )


# ──────────────────────────────────────────────────────────────────────────
# Render principal
# ──────────────────────────────────────────────────────────────────────────

def render_psi_pdf(
    *,
    titulo: str,                 # se mantiene para compat con caller, no se imprime
    items: list[dict[str, Any]],
    totals: dict[str, Any],
    filters_applied: dict[str, Any],
    gfk_files_used: list[dict[str, Any]] | None = None,
    logo: str = "GV",
    responsable: Optional[str] = None,
    responsable_area: str = "Comercial",
    empresa_nombre: Optional[str] = None,
) -> bytes:
    """Genera el PDF del PSI con layout simplificado (v3).

    Args:
        responsable: solo se imprime si != None (política: pasar solo si el
            usuario tiene rol GERENTE_COMERCIAL).
    """
    buffer = BytesIO()
    page_size = A4  # vertical (caben las 5 columnas cómodas)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.2 * cm,
        title=titulo,
    )

    styles = getSampleStyleSheet()
    h_title = ParagraphStyle(
        "HTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        alignment=TA_LEFT,
        textColor=C_ACCENT,
        spaceAfter=2,
    )
    h_subtitle = ParagraphStyle(
        "HSub",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        alignment=TA_LEFT,
        textColor=C_TEXT_1,
        spaceAfter=2,
    )
    sub_style = ParagraphStyle(
        "Sub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        textColor=C_TEXT_3,
        leading=11,
    )
    cell_style = ParagraphStyle(
        "Cell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=11,
        textColor=C_TEXT_2,
    )
    cell_bold = ParagraphStyle("CellB", parent=cell_style, fontName="Helvetica-Bold", textColor=C_TEXT_1)

    # Empresa por defecto según logo
    if empresa_nombre is None:
        empresa_nombre = "ELECTRO GV" if logo.upper() == "GV" else "ELECTRO ABC SRL" if logo.upper() == "ABC" else "ELECTRO"

    # ─── HEADER ───────────────────────────────────────────────────────────
    now_local = datetime.now(AR_TZ)
    fecha_generado = now_local.strftime("%d/%m/%Y %H:%M")

    logo_p = _logo_path(logo)
    if logo_p:
        try:
            logo_img: Any = RLImage(str(logo_p), width=18 * mm, height=18 * mm, kind="proportional")
            logo_img.hAlign = "LEFT"
        except Exception:
            logo_img = Paragraph("", sub_style)
    else:
        logo_img = Paragraph("", sub_style)

    # Bloque izquierdo: logo + (Reporte PSI / Empresa / subtítulos)
    titulo_block = [
        Paragraph("Reporte PSI", h_title),
        Paragraph(empresa_nombre, h_subtitle),
        Paragraph(
            f"Reporte de Stock y Sell-Out por marca · Generado {fecha_generado}",
            sub_style,
        ),
    ]
    left_block = Table(
        [[logo_img, titulo_block]],
        colWidths=[22 * mm, 110 * mm],
        style=TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]),
    )

    # ─── HEADER derecho: metadata ────────────────────────────────────────
    filt = filters_applied or {}
    marcas_list = filt.get("marcas") or []
    marca_text = ", ".join(marcas_list) if marcas_list else "Todas"
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
        colWidths=[132 * mm, 50 * mm],
        style=TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]),
    )

    story: list = [header_table, Spacer(1, 7 * mm)]

    # ─── KPIs ────────────────────────────────────────────────────────────
    stock_total = int(totals.get("stock") or 0)
    sell_total  = int(totals.get("sell_out") or 0)
    kpi_row = Table(
        [[
            _kpi_card("STOCK TOTAL", f"{stock_total:,}".replace(",", ".")),
            _kpi_card("SELL OUT TOTAL", f"{sell_total:,}".replace(",", ".")),
        ]],
        colWidths=[60 * mm, 60 * mm],
        style=TableStyle([
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 8),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ]),
        hAlign="LEFT",
    )
    story.append(kpi_row)
    story.append(Spacer(1, 7 * mm))

    # ─── TABLA SIMPLE ─────────────────────────────────────────────────────
    header_h = ParagraphStyle("H", parent=cell_style, fontName="Helvetica-Bold", textColor=C_TEXT_3)
    header_h_right = ParagraphStyle("HR", parent=header_h, alignment=TA_RIGHT)

    headers_row = [
        Paragraph("SKU",         header_h),
        Paragraph("DESCRIPCIÓN", header_h),
        Paragraph("MARCA",       header_h),
        Paragraph("STOCK",       header_h_right),
        Paragraph("SELL-OUT",    header_h_right),
    ]
    data_rows: list[list[Any]] = [headers_row]

    for r in items:
        stock = int(r.get("stock") or 0)
        sell  = int(r.get("sell_out") or 0)
        stock_color = H_DANGER if stock < 0 else (H_TEXT_3 if stock == 0 else H_TEXT_1)
        # Color verde en sell-out solo si vendió "bien" (>= 80% del stock actual)
        if stock > 0 and sell >= stock * 0.8:
            sell_color = H_SUCCESS
        elif sell == 0:
            sell_color = H_TEXT_3
        else:
            sell_color = H_TEXT_1

        data_rows.append([
            Paragraph(str(r.get("sku") or ""), cell_bold),
            Paragraph(str(r.get("descripcion") or ""), cell_style),
            Paragraph(str(r.get("marca") or ""), cell_style),
            Paragraph(
                f'<font color="{stock_color}"><b>{stock}</b></font>',
                ParagraphStyle("StRa", parent=cell_style, alignment=TA_RIGHT),
            ),
            Paragraph(
                f'<font color="{sell_color}"><b>{sell}</b></font>',
                ParagraphStyle("SoRa", parent=cell_style, alignment=TA_RIGHT),
            ),
        ])

    if len(data_rows) == 1:
        data_rows.append([
            Paragraph("Sin productos para los filtros aplicados.", cell_style),
            "", "", "", "",
        ])

    # A4 vertical: ancho útil ~ 18 cm
    col_widths = [
        32 * mm,  # SKU
        78 * mm,  # Descripción
        25 * mm,  # Marca
        20 * mm,  # Stock
        25 * mm,  # Sell-out
    ]
    main_table = Table(data_rows, colWidths=col_widths, repeatRows=1)
    main_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), C_SUBTLE_BG),
        ("LINEBELOW",     (0, 0), (-1, 0), 0.5, C_BORDER),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW",     (0, 1), (-1, -1), 0.25, C_BORDER),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(main_table)

    # Sin footer, sin leyenda, sin paginación visible (queda mínimo).
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


# ──────────────────────────────────────────────────────────────────────────
# Export Excel (.xlsx)
# ──────────────────────────────────────────────────────────────────────────

def render_psi_xlsx(
    *,
    titulo: str,
    items: list[dict[str, Any]],
    totals: dict[str, Any],
    filters_applied: dict[str, Any],
    empresa_nombre: Optional[str] = None,
    responsable: Optional[str] = None,
    responsable_area: str = "Comercial",
    logo: str = "GV",
) -> bytes:
    """Genera el reporte PSI como Excel (.xlsx).

    Estructura del workbook:
      - Pestaña "Reporte PSI" con: metadata arriba, KPIs, y tabla de
        productos (SKU/Descripción/Marca/Stock/Sell-out).
    """
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Reporte PSI"

    if empresa_nombre is None:
        empresa_nombre = "ELECTRO GV" if logo.upper() == "GV" else "ELECTRO ABC SRL" if logo.upper() == "ABC" else "ELECTRO"

    now_local = datetime.now(AR_TZ)
    fecha_generado = now_local.strftime("%d/%m/%Y %H:%M")

    filt = filters_applied or {}
    marca_text = ", ".join(filt.get("marcas") or []) or "Todas"
    pi = filt.get("periodo_inicio") or ""
    pf = filt.get("periodo_fin") or ""

    def _fmt_date(iso: str) -> str:
        try:
            return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")
        except (TypeError, ValueError):
            return iso

    periodo_text = f"{_fmt_date(pi)} → {_fmt_date(pf)}" if pi and pf else "—"

    # Estilos
    title_font   = Font(name="Calibri", size=18, bold=True, color="2563EB")
    subt_font    = Font(name="Calibri", size=12, bold=True, color="0F172A")
    meta_label   = Font(name="Calibri", size=10, bold=True, color="64748B")
    meta_value   = Font(name="Calibri", size=10, color="334155")
    kpi_label    = Font(name="Calibri", size=9,  bold=True, color="64748B")
    kpi_value    = Font(name="Calibri", size=20, bold=True, color="0F172A")
    header_font  = Font(name="Calibri", size=10, bold=True, color="64748B")
    header_fill  = PatternFill("solid", fgColor="F8FAFC")
    border_thin  = Side(style="thin",  color="E2E8F0")
    grid_border  = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    # ── Header (filas 1-5)
    ws["A1"] = "Reporte PSI"
    ws["A1"].font = title_font
    ws["A2"] = empresa_nombre
    ws["A2"].font = subt_font
    ws["A3"] = f"Reporte de Stock y Sell-Out por marca · Generado {fecha_generado}"
    ws["A3"].font = Font(name="Calibri", size=10, color="64748B")

    # Metadata derecha (columnas D-E filas 1-5)
    meta_pairs = [
        ("Marca",      marca_text),
        ("Período",    periodo_text),
        ("Sucursales", "Todas"),
    ]
    if filt.get("condicion") and filt["condicion"] != "TODO":
        meta_pairs.append(("Condición", filt["condicion"]))
    if responsable:
        meta_pairs.append(("Responsable", f"{responsable} · {responsable_area}" if responsable_area else responsable))

    for i, (label, value) in enumerate(meta_pairs, start=1):
        ws.cell(row=i, column=4, value=f"{label}:").font = meta_label
        ws.cell(row=i, column=4).alignment = Alignment(horizontal="right")
        ws.cell(row=i, column=5, value=value).font = meta_value

    # ── KPIs (filas 7-9)
    stock_total = int(totals.get("stock") or 0)
    sell_total  = int(totals.get("sell_out") or 0)
    ws["A7"] = "STOCK TOTAL"
    ws["A7"].font = kpi_label
    ws["B7"] = "SELL OUT TOTAL"
    ws["B7"].font = kpi_label
    ws["A8"] = stock_total
    ws["A8"].font = kpi_value
    ws["A8"].number_format = "#,##0"
    ws["B8"] = sell_total
    ws["B8"].font = kpi_value
    ws["B8"].number_format = "#,##0"

    # ── Tabla (a partir de la fila 11)
    table_start_row = 11
    headers = ["SKU", "Descripción", "Marca", "Stock", "Sell-out"]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=table_start_row, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = grid_border
        cell.alignment = Alignment(horizontal="right" if h in ("Stock", "Sell-out") else "left")

    for offset, r in enumerate(items, start=1):
        row = table_start_row + offset
        ws.cell(row=row, column=1, value=str(r.get("sku") or "")).font = Font(name="Calibri", size=10, bold=True)
        ws.cell(row=row, column=2, value=str(r.get("descripcion") or ""))
        ws.cell(row=row, column=3, value=str(r.get("marca") or ""))
        stock_cell = ws.cell(row=row, column=4, value=int(r.get("stock") or 0))
        stock_cell.alignment = Alignment(horizontal="right")
        stock_cell.number_format = "#,##0"
        sell_cell = ws.cell(row=row, column=5, value=int(r.get("sell_out") or 0))
        sell_cell.alignment = Alignment(horizontal="right")
        sell_cell.number_format = "#,##0"
        for c in range(1, 6):
            ws.cell(row=row, column=c).border = grid_border

    # Anchos de columna
    widths = [16, 50, 16, 12, 14]
    for col_idx, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(col_idx)].width = w

    # Freeze top-left para que el header de tabla quede fijo al scrollear
    ws.freeze_panes = ws.cell(row=table_start_row + 1, column=1)

    buf = BytesIO()
    wb.save(buf)
    data = buf.getvalue()
    buf.close()
    return data
