from __future__ import annotations

import base64
import io
import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from PIL import Image, ImageDraw, ImageFont

from ...brand_assets import brand_logo_path
from ...price_cost_rules import require_price_announcement_permission
from . import CurrentUser, PriceCostUpdateModel, db_session, require_current_user, sheet_money

router = APIRouter(prefix="/api/price-cost-updates", tags=["price-cost-updates"])

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# ── Lienzo ────────────────────────────────────────────────────────────────
IMAGE_W = 1080
IMAGE_H = 1620                      # vertical alargado para que entre todo el contenido
MARGIN = 56

# ── Tipos de cambio ───────────────────────────────────────────────────────
CHANGE_AUMENTO = "AUMENTO"
CHANGE_BAJA = "BAJA"
CHANGE_NUEVO = "NUEVO"
CHANGE_SIN_CAMBIO = "SIN_CAMBIO"

# ── Paleta ────────────────────────────────────────────────────────────────
COL_HERO_FROM      = "#0F1E55"      # azul oscuro top del hero
COL_HERO_TO        = "#2347B5"      # azul más vivo bottom del hero
COL_TITLE_WHITE    = "#FFFFFF"
COL_TITLE_ACCENT   = "#F5C84B"      # amarillo "Nuevos precios" (palabra "precios")
COL_HERO_SUB       = "#C8D4F4"
COL_TEXT_1         = "#0F172A"
COL_TEXT_2         = "#334155"
COL_TEXT_3         = "#64748B"
COL_CARD_BG        = "#FFFFFF"
COL_CARD_BORDER    = "#E5E9F2"
COL_PAGE_BG        = "#F5F6FB"      # fondo general muy suave
COL_STRIKE         = "#94A3B8"      # gris para precio anterior tachado

# Estados (badge bg + text + price)
COL_AUMENTO_BG     = "#FEF3C7"
COL_AUMENTO_TEXT   = "#92400E"      # texto badge
COL_AUMENTO_PRICE  = "#B45309"      # precio amarillo "oscuro" para leer bien sobre blanco
COL_BAJA_BG        = "#D1FAE5"
COL_BAJA_TEXT      = "#065F46"
COL_BAJA_PRICE     = "#047857"
COL_NUEVO_BG       = "#DBEAFE"
COL_NUEVO_TEXT     = "#1E40AF"
COL_NUEVO_PRICE    = "#1D4ED8"

# Barra vertical de marca (color rotativo por orden de aparición)
BRAND_BAR_COLORS = ["#E11D48", "#1D4ED8", "#0F172A", "#7C3AED", "#D97706", "#0891B2", "#059669"]

# Footer
COL_FOOTER_BG      = "#0B1224"
COL_FOOTER_TEXT    = "#CBD5E1"
COL_FOOTER_STRONG  = "#FFFFFF"

# ── Layout ────────────────────────────────────────────────────────────────
ROW_H              = 96             # alto cada fila producto
BRAND_HEADER_H     = 56
ROW_GAP            = 10             # gap vertical entre filas
SECTION_GAP        = 22             # gap entre secciones de marca
HERO_H             = 290
FOOTER_H           = 64
MAX_BODY_ROWS_PER_PAGE = 9          # cantidad razonable de filas por imagen


class AnnouncementImageRequest(BaseModel):
    update_ids: list[int] = Field(min_length=1, max_length=160)
    logo_brand: str = "gv_electro"
    title: str = "Nuevos precios"
    vigencia: str = ""              # opcional: texto libre "Jueves 4 de junio 2026". Si vacío usa hoy.


class AnnouncementImageOut(BaseModel):
    filename: str
    mime_type: str = "image/png"
    data_url: str
    brand_names: list[str]
    product_count: int
    page: int
    total_pages: int


class AnnouncementImagesOut(BaseModel):
    message: str
    generated_at: str
    brand_names: list[str]
    product_count: int
    images: list[AnnouncementImageOut]


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ["DejaVuSans-Bold.ttf", "Arial Bold.ttf"] if bold else ["DejaVuSans.ttf", "Arial.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    try:
        return float(draw.textlength(text, font=font))
    except Exception:
        box = draw.textbbox((0, 0), text, font=font)
        return float(box[2] - box[0])


def _wrap(draw: ImageDraw.ImageDraw, text: Any, font: ImageFont.ImageFont, max_w: int, max_lines: int) -> list[str]:
    words = re.sub(r"\s+", " ", str(text or "").strip()).split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if _text_width(draw, candidate, font) <= max_w:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if len(lines) == max_lines and len(" ".join(words)) > len(" ".join(lines)):
        tail = lines[-1]
        while tail and _text_width(draw, f"{tail}...", font) > max_w:
            tail = tail[:-1].rstrip()
        lines[-1] = f"{tail}..." if tail else "..."
    return lines or [""]


def _safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip().lower())
    return re.sub(r"-+", "-", value).strip("-") or "precios"


def _load_logo(logo_brand: str) -> Image.Image | None:
    path = brand_logo_path(logo_brand)
    if not path:
        return None
    try:
        logo = Image.open(path).convert("RGBA")
        logo.thumbnail((96, 96), Image.LANCZOS)
        return logo
    except Exception:
        return None


def _classify(row: dict[str, Any]) -> str:
    """Clasifica la actualización por tipo de cambio."""
    ant = row.get("valor_anterior")
    nuevo = row.get("valor_nuevo_dec")
    if ant is None or float(ant) == 0:
        return CHANGE_NUEVO
    if nuevo is None:
        return CHANGE_SIN_CAMBIO
    if float(nuevo) > float(ant):
        return CHANGE_AUMENTO
    if float(nuevo) < float(ant):
        return CHANGE_BAJA
    return CHANGE_SIN_CAMBIO


def _classify_summary(rows: list[dict[str, Any]]) -> tuple[int, int, int]:
    """Devuelve (aumentos, bajas, nuevos) — útil para el mensaje, no para dibujarlo."""
    aumentos = sum(1 for r in rows if r["change"] == CHANGE_AUMENTO)
    bajas    = sum(1 for r in rows if r["change"] == CHANGE_BAJA)
    nuevos   = sum(1 for r in rows if r["change"] == CHANGE_NUEVO)
    return aumentos, bajas, nuevos


def _brand_sentence(brands: list[str]) -> str:
    values = [b for b in brands if b]
    if not values:
        return "las marcas seleccionadas"
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} y {values[1]}"
    return f"{', '.join(values[:-1])} y {values[-1]}"


def _format_vigencia(value: str) -> str:
    """Si viene texto libre, lo usa. Sino, hoy en formato 'Jueves DD de MMM YYYY'."""
    if value and value.strip():
        return value.strip()
    now = datetime.now(AR_TZ)
    dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    return f"{dias[now.weekday()]} {now.day} de {meses[now.month - 1]} {now.year}"


# ──────────────────────────────────────────────────────────────────────────
# Paginación: agrupa por marca y respeta MAX_BODY_ROWS_PER_PAGE
# ──────────────────────────────────────────────────────────────────────────

def _paginate(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    pages: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    body_rows_on_page = 0
    last_brand = ""

    for row in rows:
        brand = str(row["marca"] or "Sin marca")
        needs_header = brand != last_brand
        if current and body_rows_on_page + 1 > MAX_BODY_ROWS_PER_PAGE:
            pages.append(current)
            current = []
            body_rows_on_page = 0
            last_brand = ""
            needs_header = True
        if needs_header:
            current.append({"kind": "brand", "marca": brand})
            last_brand = brand
        current.append({"kind": "row", **row})
        body_rows_on_page += 1
    if current:
        pages.append(current)
    return pages


# ──────────────────────────────────────────────────────────────────────────
# Render: hero + body + footer
# ──────────────────────────────────────────────────────────────────────────

def _gradient_hero(draw: ImageDraw.ImageDraw, image: Image.Image) -> None:
    """Pinta el hero con un degradado vertical azul oscuro → azul vivo."""
    # Simple gradient interpolando ambos colores fila a fila.
    def _hex_to_rgb(h: str) -> tuple[int, int, int]:
        h = h.lstrip("#")
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    a = _hex_to_rgb(COL_HERO_FROM)
    b = _hex_to_rgb(COL_HERO_TO)
    for y in range(HERO_H):
        t = y / max(1, HERO_H - 1)
        r = int(a[0] + (b[0] - a[0]) * t)
        g = int(a[1] + (b[1] - a[1]) * t)
        bl = int(a[2] + (b[2] - a[2]) * t)
        draw.line([(0, y), (IMAGE_W, y)], fill=(r, g, bl))


def _draw_hero(
    draw: ImageDraw.ImageDraw,
    image: Image.Image,
    *,
    title: str,
    vigencia: str,
    total_productos: int,
    logo_brand: str,
    empresa_label: str,
) -> None:
    """Hero con logo + ELECTRO GV (sin 'LISTA MAYORISTA') + título + vigencia."""
    _gradient_hero(draw, image)

    # ── Logo box (cuadrado blanco con logo dentro)
    logo_box_x = MARGIN
    logo_box_y = 50
    logo_box_size = 96
    draw.rounded_rectangle(
        (logo_box_x, logo_box_y, logo_box_x + logo_box_size, logo_box_y + logo_box_size),
        radius=16, fill=COL_TITLE_WHITE,
    )
    logo = _load_logo(logo_brand)
    if logo:
        # Centrar el logo dentro del cuadrado
        lw, lh = logo.size
        lx = logo_box_x + (logo_box_size - lw) // 2
        ly = logo_box_y + (logo_box_size - lh) // 2
        image.alpha_composite(logo, (lx, ly))
    else:
        # Texto "GV" como placeholder
        ph_font = _font(36, bold=True)
        ph_text = "GV"
        pw = _text_width(draw, ph_text, ph_font)
        draw.text(
            (logo_box_x + (logo_box_size - pw) // 2, logo_box_y + 24),
            ph_text, fill=COL_TEXT_1, font=ph_font,
        )

    # ── Empresa al costado del logo
    empresa_font = _font(34, bold=True)
    draw.text(
        (logo_box_x + logo_box_size + 22, logo_box_y + 28),
        (empresa_label or "ELECTRO GV").upper(),
        fill=COL_TITLE_WHITE, font=empresa_font,
    )

    # ── Título grande "Nuevos precios" (con "precios" amarillo)
    # Detectamos la palabra final para resaltarla. Si el título es custom,
    # usamos amarillo en la última palabra.
    parts = title.strip().split()
    if not parts:
        parts = ["Nuevos", "precios"]
    title_font = _font(74, bold=True)
    title_y = logo_box_y + logo_box_size + 30
    cursor_x = MARGIN
    for idx, word in enumerate(parts):
        is_accent = (idx == len(parts) - 1)
        color = COL_TITLE_ACCENT if is_accent else COL_TITLE_WHITE
        draw.text((cursor_x, title_y), word, fill=color, font=title_font)
        cursor_x += int(_text_width(draw, word, title_font)) + 18

    # ── Vigencia + total productos
    sub_font = _font(22)
    sub_text = f"Vigencia: {vigencia} · {total_productos} productos actualizados"
    draw.text((MARGIN, title_y + 92), sub_text, fill=COL_HERO_SUB, font=sub_font)


def _draw_brand_header(
    draw: ImageDraw.ImageDraw,
    *,
    y: int,
    marca: str,
    cambios_count: int,
    bar_color: str,
) -> int:
    """Header de sección por marca. Devuelve nuevo y."""
    brand_font = _font(30, bold=True)
    count_font = _font(18)

    # Barra vertical de color
    bar_w = 6
    bar_h = 30
    bar_x = MARGIN
    bar_y = y + (BRAND_HEADER_H - bar_h) // 2
    draw.rounded_rectangle((bar_x, bar_y, bar_x + bar_w, bar_y + bar_h), radius=3, fill=bar_color)

    # Nombre marca
    draw.text((bar_x + bar_w + 14, y + 12), marca.upper(), fill=COL_TEXT_1, font=brand_font)

    # "N cambios" a la derecha
    cambios_text = f"{cambios_count} cambio{'s' if cambios_count != 1 else ''}"
    cw = _text_width(draw, cambios_text, count_font)
    draw.text((IMAGE_W - MARGIN - cw, y + 22), cambios_text, fill=COL_TEXT_3, font=count_font)

    return y + BRAND_HEADER_H


def _draw_product_row(
    draw: ImageDraw.ImageDraw,
    *,
    y: int,
    entry: dict[str, Any],
) -> int:
    """Tarjeta de producto: descripción GRANDE arriba, SKU + badge debajo, precios a la derecha.

    Devuelve nuevo y (después de la fila).
    """
    row_left = MARGIN
    row_right = IMAGE_W - MARGIN
    row_bottom = y + ROW_H

    # ── Fondo card
    draw.rounded_rectangle(
        (row_left, y, row_right, row_bottom),
        radius=14, fill=COL_CARD_BG, outline=COL_CARD_BORDER, width=1,
    )

    # ── Columna izquierda: DESCRIPCIÓN grande + SKU + badge debajo
    desc_font = _font(24, bold=True)
    sku_font  = _font(20, bold=True)
    badge_font = _font(14, bold=True)

    inner_x = row_left + 24
    desc_max_w = (row_right - 380) - inner_x   # reservar derecha para los precios

    # Descripción (1 línea con elipsis)
    desc_lines = _wrap(draw, entry.get("producto"), desc_font, desc_max_w, 1)
    desc_y = y + 14
    draw.text((inner_x, desc_y), desc_lines[0], fill=COL_TEXT_1, font=desc_font)

    # SKU + badge en la misma línea
    sku_y = y + ROW_H - 38
    sku_text = str(entry.get("sku") or "")
    draw.text((inner_x, sku_y), sku_text, fill=COL_TEXT_2, font=sku_font)

    # Badge a la derecha del SKU
    change = entry.get("change") or CHANGE_SIN_CAMBIO
    if change != CHANGE_SIN_CAMBIO:
        badge_bg, badge_fg = {
            CHANGE_AUMENTO: (COL_AUMENTO_BG, COL_AUMENTO_TEXT),
            CHANGE_BAJA:    (COL_BAJA_BG,    COL_BAJA_TEXT),
            CHANGE_NUEVO:   (COL_NUEVO_BG,   COL_NUEVO_TEXT),
        }[change]
        sku_w = _text_width(draw, sku_text, sku_font)
        badge_x = inner_x + int(sku_w) + 14
        badge_padding_x = 12
        badge_padding_y = 4
        badge_text_w = _text_width(draw, change, badge_font)
        badge_w = int(badge_text_w) + 2 * badge_padding_x
        badge_h = 24
        badge_y = sku_y + (sku_font.size - badge_h) // 2 + 4 if hasattr(sku_font, "size") else sku_y - 2
        draw.rounded_rectangle(
            (badge_x, badge_y, badge_x + badge_w, badge_y + badge_h),
            radius=6, fill=badge_bg,
        )
        draw.text(
            (badge_x + badge_padding_x, badge_y + badge_padding_y),
            change, fill=badge_fg, font=badge_font,
        )

    # ── Columna derecha: precio nuevo (color por tipo) + precio anterior tachado
    price_new = str(entry.get("valor_nuevo") or "")
    price_old = str(entry.get("valor_anterior_text") or "")

    price_new_font = _font(34, bold=True)
    price_old_font = _font(18)

    if change == CHANGE_AUMENTO:
        price_color = COL_AUMENTO_PRICE
    elif change == CHANGE_BAJA:
        price_color = COL_BAJA_PRICE
    elif change == CHANGE_NUEVO:
        price_color = COL_NUEVO_PRICE
    else:
        price_color = COL_TEXT_1

    price_new_w = _text_width(draw, price_new, price_new_font)
    price_x = row_right - 24 - int(price_new_w)
    price_new_y = y + ROW_H - 56

    # Precio anterior (arriba, tachado) — solo si hay y es distinto
    if price_old and change in (CHANGE_AUMENTO, CHANGE_BAJA):
        old_w = _text_width(draw, price_old, price_old_font)
        old_x = row_right - 24 - int(old_w)
        old_y = y + 18
        draw.text((old_x, old_y), price_old, fill=COL_STRIKE, font=price_old_font)
        # Línea de tachado
        strike_y = old_y + 11
        draw.line(
            (old_x - 2, strike_y, old_x + int(old_w) + 2, strike_y),
            fill=COL_STRIKE, width=2,
        )

    draw.text((price_x, price_new_y), price_new, fill=price_color, font=price_new_font)

    return row_bottom + ROW_GAP


def _draw_footer(draw: ImageDraw.ImageDraw, *, contacto: str) -> None:
    """Franja oscura abajo con texto de aviso + contacto."""
    draw.rectangle((0, IMAGE_H - FOOTER_H, IMAGE_W, IMAGE_H), fill=COL_FOOTER_BG)

    foot_font = _font(16)
    foot_bold = _font(16, bold=True)

    left_text = "Lista sujeta a stock · Precios finales sin IVA"
    draw.text((MARGIN, IMAGE_H - FOOTER_H + 22), left_text, fill=COL_FOOTER_TEXT, font=foot_font)

    # Contacto a la derecha (con marca strong)
    if contacto:
        contact_w = _text_width(draw, contacto, foot_bold)
        draw.text(
            (IMAGE_W - MARGIN - int(contact_w), IMAGE_H - FOOTER_H + 22),
            contacto, fill=COL_FOOTER_STRONG, font=foot_bold,
        )


def _render_page(
    entries: list[dict[str, Any]],
    *,
    title: str,
    vigencia: str,
    total_productos: int,
    logo_brand: str,
    empresa_label: str,
    contacto: str,
    brand_count_global: dict[str, int],
) -> bytes:
    image = Image.new("RGBA", (IMAGE_W, IMAGE_H), COL_PAGE_BG)
    draw = ImageDraw.Draw(image)

    _draw_hero(
        draw, image,
        title=title,
        vigencia=vigencia,
        total_productos=total_productos,
        logo_brand=logo_brand,
        empresa_label=empresa_label,
    )

    # Cuerpo: arranca debajo del hero con un poco de aire
    y = HERO_H + 32

    brand_idx = 0  # para color de barra rotativo
    for entry in entries:
        if entry["kind"] == "brand":
            marca = str(entry["marca"])
            bar_color = BRAND_BAR_COLORS[brand_idx % len(BRAND_BAR_COLORS)]
            brand_idx += 1
            y = _draw_brand_header(
                draw,
                y=y + (SECTION_GAP if entries.index(entry) > 0 else 0),
                marca=marca,
                cambios_count=brand_count_global.get(marca, 0),
                bar_color=bar_color,
            )
            y += 4
            continue

        y = _draw_product_row(draw, y=y, entry=entry)

    _draw_footer(draw, contacto=contacto)

    out = io.BytesIO()
    image.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


# ──────────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────────

@router.post("/announcements/images", response_model=AnnouncementImagesOut)
def generate_announcement_images(
    payload: AnnouncementImageRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    require_price_announcement_permission(user)
    ids = list(dict.fromkeys(int(x) for x in payload.update_ids if int(x) > 0))
    if not ids:
        raise HTTPException(status_code=400, detail="Selecciona al menos una actualizacion de precio.")

    with db_session() as session:
        rows_db = session.scalars(
            select(PriceCostUpdateModel).where(
                PriceCostUpdateModel.id.in_(ids),
                PriceCostUpdateModel.type == "price",
                PriceCostUpdateModel.estado != "Cancelado",
            )
        ).all()

    if len(rows_db) != len(ids):
        raise HTTPException(status_code=400, detail="Algunas actualizaciones no existen, no son de precio o estan canceladas.")

    rows: list[dict[str, Any]] = []
    for row in rows_db:
        valor_ant: Decimal | None = row.valor_anterior  # type: ignore[assignment]
        valor_new: Decimal = row.valor_nuevo  # type: ignore[assignment]
        rec = {
            "id": int(row.id),
            "marca": str(row.marca or "Sin marca").strip() or "Sin marca",
            "sku": str(row.sku or ""),
            "producto": str(row.producto or ""),
            "valor_anterior_dec": valor_ant,
            "valor_nuevo_dec": valor_new,
            "valor_anterior_text": sheet_money(valor_ant) if valor_ant is not None else "",
            "valor_nuevo": sheet_money(valor_new),
        }
        rec["change"] = _classify(rec)
        rows.append(rec)
    rows.sort(key=lambda item: (item["marca"].lower(), item["producto"].lower(), item["sku"].lower()))

    brands = list(dict.fromkeys(row["marca"] for row in rows))
    brand_count_global: dict[str, int] = {}
    for r in rows:
        brand_count_global[r["marca"]] = brand_count_global.get(r["marca"], 0) + 1

    now = datetime.now(AR_TZ)
    generated_at = now.strftime("%d/%m/%Y %H:%M")
    vigencia_text = _format_vigencia(payload.vigencia)

    aumentos, bajas, nuevos = _classify_summary(rows)
    msg_parts = []
    if aumentos: msg_parts.append(f"{aumentos} aumento{'s' if aumentos != 1 else ''}")
    if bajas:    msg_parts.append(f"{bajas} baja{'s' if bajas != 1 else ''}")
    if nuevos:   msg_parts.append(f"{nuevos} nuevo{'s' if nuevos != 1 else ''}")
    detail = ", ".join(msg_parts) if msg_parts else "sin cambios"
    message = f"Nuevos precios {generated_at} — {detail} en {_brand_sentence(brands)}."

    # Empresa label (por logo)
    empresa_label = "ELECTRO GV" if (payload.logo_brand or "").lower() in ("gv", "gv_electro") else (
        "ELECTRO ABC" if (payload.logo_brand or "").lower() in ("abc", "abc_electro") else "ELECTRO"
    )
    contacto = "ELECTRO GV  ·  WhatsApp +54 11 5555-0000"

    pages = _paginate(rows)
    total = len(pages)
    stamp = now.strftime("%Y%m%d-%H%M")
    images: list[AnnouncementImageOut] = []
    for index, entries in enumerate(pages, start=1):
        png = _render_page(
            entries,
            title=(payload.title or "Nuevos precios").strip() or "Nuevos precios",
            vigencia=vigencia_text,
            total_productos=len(rows),
            logo_brand=payload.logo_brand,
            empresa_label=empresa_label,
            contacto=contacto,
            brand_count_global=brand_count_global,
        )
        page_brands = list(dict.fromkeys(str(entry.get("marca") or "") for entry in entries if entry.get("kind") == "row"))
        filename = f"nuevos-precios-{stamp}-{index:02d}-{_safe_filename('-'.join(page_brands[:2]))}.png"
        data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        images.append(
            AnnouncementImageOut(
                filename=filename,
                data_url=data_url,
                brand_names=page_brands,
                product_count=sum(1 for entry in entries if entry.get("kind") == "row"),
                page=index,
                total_pages=total,
            )
        )

    return AnnouncementImagesOut(
        message=message,
        generated_at=generated_at,
        brand_names=brands,
        product_count=len(rows),
        images=images,
    )
