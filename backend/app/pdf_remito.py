"""
Generación de PDFs para remitos internos de garantías.

Los logos se buscan en:
    backend/storage/logos/gv_electro.png
    backend/storage/logos/abc_electro.png

Regla de negocio:
    REM = traslado físico interno. Puede ser sucursal -> depósito o depósito -> depósito.
    ENV = lote administrativo/proveedor.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    Paragraph,
)

# ── Brand config ────────────────────────────────────────────────────────────

ACCENT_BLUE = HexColor("#0052CC")
ABC_BLUE    = HexColor("#1D6FD1")
GV_BLUE     = HexColor("#0B5ED7")
LIGHT_ROW   = HexColor("#F4F6F9")
BORDER_GREY = HexColor("#CCCCCC")
TEXT_GREY   = HexColor("#555555")
LABEL_GREY  = HexColor("#777777")
SOFT_BLUE   = HexColor("#EAF2FF")

BRANDS: dict[str, dict[str, Any]] = {
    "gv_electro": {
        "name":      "GV Electro",
        "logo_file": "gv_electro.png",
        "accent":    GV_BLUE,
    },
    "abc_electro": {
        "name":      "ABC Electro Outlet Premium",
        "logo_file": "abc_electro.png",
        "accent":    ABC_BLUE,
    },
}

# Fallback legacy si todavía llega solo el nombre de sucursal sin company_id.
ABC_KEYS = ["lanus", "lanús", "canning", "norcenter", "norte", "sur", "abc"]


def get_company_brand(sucursal: str) -> str:
    """Devuelve 'abc_electro' o 'gv_electro' según la sucursal (fallback legacy)."""
    s = (sucursal or "").lower().strip()
    return "abc_electro" if any(k in s for k in ABC_KEYS) else "gv_electro"


def get_logos_dir() -> Path:
    from .config import get_settings
    settings = get_settings()
    primary = settings.storage_dir / "logos"
    if primary.exists():
        return primary
    # En modo laptop a veces STORAGE_DIR=./storage depende del cwd de uvicorn.
    # Fallback estable: backend/storage/logos dentro del proyecto.
    fallback = settings.backend_dir / "storage" / "logos"
    if fallback.exists():
        return fallback
    return primary


def _logo_image(company_brand: str) -> RLImage | None:
    brand = BRANDS.get(company_brand, BRANDS["gv_electro"])
    path = get_logos_dir() / brand["logo_file"]
    if not path.exists():
        return None
    try:
        # Los logos provistos son cuadrados; usar tamaño fijo evita que deformen el encabezado.
        return RLImage(str(path), width=3.2 * cm, height=3.2 * cm)
    except Exception:
        return None


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(str(text or "—"), style)


# ── PDF builder ─────────────────────────────────────────────────────────────

def generate_remito_pdf(remito: dict[str, Any], warranties: list[dict[str, Any]]) -> bytes:
    """Genera el PDF profesional de un remito interno y devuelve los bytes."""
    buffer = BytesIO()
    brand_key = remito.get("company_brand", "gv_electro") or "gv_electro"
    brand = BRANDS.get(str(brand_key), BRANDS["gv_electro"])
    accent = brand["accent"]

    tipo_remito = str(remito.get("tipo_remito") or "sucursal_a_deposito").strip().lower()
    is_deposit_transfer = tipo_remito in {"deposito_a_deposito", "deposit_to_deposit", "deposito_deposito"}
    if is_deposit_transfer:
        title_text = "MOVIMIENTO INTERNO"
        subtitle_text = "TRASLADO DEPÓSITO → DEPÓSITO"
        origin_label = "ORIGEN / DEPÓSITO"
        destination_label = "DESTINO / DEPÓSITO"
        product_section = "PRODUCTOS A MOVER"
        document_note = (
            "Este documento acompaña un movimiento físico interno entre depósitos. "
            "No representa lote ENV, envío al proveedor ni resolución de garantía."
        )
        dispatch_title = "ENTREGA / DEPÓSITO ORIGEN"
        reception_title = "RECEPCIÓN / DEPÓSITO DESTINO"
        observations_title = "Novedades / observaciones del movimiento:"
    else:
        title_text = "REMITO INTERNO"
        subtitle_text = "TRASLADO SUCURSAL → DEPÓSITO"
        origin_label = "ORIGEN / SUCURSAL"
        destination_label = "DESTINO / DEPÓSITO"
        product_section = "PRODUCTOS A TRASLADAR"
        document_note = (
            "Este documento acompaña el movimiento físico interno de productos en garantía. "
            "No representa lote ENV, envío al proveedor ni resolución de garantía."
        )
        dispatch_title = "ENTREGA / DESPACHO"
        reception_title = "RECEPCIÓN EN DEPÓSITO"
        observations_title = "Novedades / observaciones al recibir:"

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=1.35 * cm,
        rightMargin=1.35 * cm,
        topMargin=1.25 * cm,
        bottomMargin=1.5 * cm,
    )
    base = getSampleStyleSheet()

    def S(name: str, **kwargs) -> ParagraphStyle:
        return ParagraphStyle(name, parent=base["Normal"], **kwargs)

    s_title  = S("title", fontSize=19, fontName="Helvetica-Bold", textColor=accent, alignment=TA_RIGHT, leading=22)
    s_sub    = S("sub", fontSize=8, fontName="Helvetica-Bold", textColor=TEXT_GREY, alignment=TA_RIGHT, leading=10)
    s_num    = S("num", fontSize=12, fontName="Helvetica-Bold", textColor=black, alignment=TA_RIGHT)
    s_date   = S("date", fontSize=8, fontName="Helvetica", textColor=TEXT_GREY, alignment=TA_RIGHT)
    s_label  = S("label", fontSize=7, fontName="Helvetica-Bold", textColor=LABEL_GREY, leading=8)
    s_val    = S("value", fontSize=10, fontName="Helvetica", textColor=black, leading=12)
    s_val_b  = S("value_b", fontSize=10, fontName="Helvetica-Bold", textColor=black, leading=12)
    s_th     = S("th", fontSize=7, fontName="Helvetica-Bold", textColor=white, alignment=TA_LEFT)
    s_td     = S("td", fontSize=8, fontName="Helvetica", textColor=black, leading=9)
    s_small  = S("small", fontSize=7, fontName="Helvetica", textColor=LABEL_GREY, leading=9)
    s_note   = S("note", fontSize=8, fontName="Helvetica", textColor=TEXT_GREY, leading=10)
    s_sec    = S("section", fontSize=10, fontName="Helvetica-Bold", textColor=black, spaceBefore=2)
    s_footer = S("footer", fontSize=6.5, fontName="Helvetica", textColor=LABEL_GREY, alignment=TA_CENTER, spaceBefore=4)

    story: list[Any] = []

    # ── Header: logo + título ─────────────────────────────────────────
    logo = _logo_image(str(brand_key))
    logo_cell: Any = logo if logo else Paragraph(f"<b>{brand['name']}</b>", s_val_b)

    hdr = Table(
        [[
            logo_cell,
            [
                Paragraph(title_text, s_title),
                Paragraph(subtitle_text, s_sub),
                Spacer(1, 0.12 * cm),
                Paragraph(f'N° <b>{remito.get("remito_code", "")}</b>', s_num),
                Paragraph(remito.get("created_at_display", ""), s_date),
            ],
        ]],
        colWidths=[4.2 * cm, None],
    )
    hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(hdr)
    story.append(Spacer(1, 0.15 * cm))
    story.append(HRFlowable(width="100%", thickness=2, color=accent))
    story.append(Spacer(1, 0.35 * cm))

    # ── Contexto del remito ───────────────────────────────────────────
    info_rows = [
        [Paragraph("EMPRESA", s_label), Paragraph(origin_label, s_label), Paragraph(destination_label, s_label)],
        [
            Paragraph(brand["name"], s_val_b),
            Paragraph(remito.get("origen_sucursal", "—"), s_val_b),
            Paragraph(remito.get("destino_deposito", "—"), s_val_b),
        ],
    ]
    info = Table(info_rows, colWidths=[5.3 * cm, 5.3 * cm, None])
    info.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GREY),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER_GREY),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(info)

    story.append(Spacer(1, 0.22 * cm))
    story.append(Paragraph(document_note, s_note))

    if remito.get("nota"):
        story.append(Spacer(1, 0.14 * cm))
        story.append(Paragraph(f'Observación interna: <b>{remito.get("nota")}</b>', s_note))

    story.append(Spacer(1, 0.35 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_GREY))
    story.append(Spacer(1, 0.25 * cm))

    # ── Tabla de productos ────────────────────────────────────────────
    story.append(Paragraph(f"{product_section} — {len(warranties)} unidad(es)", s_sec))
    story.append(Spacer(1, 0.22 * cm))

    rows: list[list[Any]] = [[
        Paragraph("ID GARANTÍA", s_th),
        Paragraph("PRODUCTO", s_th),
        Paragraph("SKU", s_th),
        Paragraph("N° SERIE", s_th),
        Paragraph("FALLA", s_th),
    ]]
    for w in warranties:
        rows.append([
            Paragraph(str(w.get("warranty_code", "")), s_td),
            Paragraph(str(w.get("producto", ""))[:48], s_td),
            Paragraph(str(w.get("sku", "—") or "—"), s_td),
            Paragraph(str(w.get("serie", "—") or "—"), s_td),
            Paragraph(str(w.get("falla", ""))[:45], s_td),
        ])

    ts = [
        ("BACKGROUND", (0, 0), (-1, 0), accent),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER_GREY),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            ts.append(("BACKGROUND", (0, i), (-1, i), LIGHT_ROW))

    prod_table = Table(rows, colWidths=[3.3 * cm, 5.7 * cm, 2.3 * cm, 2.4 * cm, None], repeatRows=1)
    prod_table.setStyle(TableStyle(ts))
    story.append(prod_table)
    story.append(Spacer(1, 0.7 * cm))

    # ── Control de entrega ────────────────────────────────────────────
    ctrl = Table(
        [[
            [Paragraph(dispatch_title, s_label),
             Spacer(1, 0.16 * cm),
             Paragraph("Nombre y DNI: ______________________________", s_small),
             Spacer(1, 0.18 * cm),
             Paragraph("Firma: ______________________________________", s_small)],
            [Paragraph(reception_title, s_label),
             Spacer(1, 0.16 * cm),
             Paragraph("Nombre y DNI: ______________________________", s_small),
             Spacer(1, 0.18 * cm),
             Paragraph("Firma: ______________________________________", s_small)],
        ]],
        colWidths=[8.9 * cm, None],
    )
    ctrl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GREY),
        ("LINEAFTER", (0, 0), (0, -1), 0.5, BORDER_GREY),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(ctrl)
    story.append(Spacer(1, 0.35 * cm))

    story.append(Paragraph(observations_title, s_label))
    story.append(Spacer(1, 0.12 * cm))
    story.append(Paragraph("_" * 118, s_small))
    story.append(Spacer(1, 0.16 * cm))
    story.append(Paragraph("_" * 118, s_small))

    # Footer
    story.append(Spacer(1, 0.45 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_GREY))
    story.append(Paragraph(
        f"Remito generado automáticamente — {brand['name']} — Sistema de Garantías",
        s_footer,
    ))

    doc.build(story)
    return buffer.getvalue()
