"""Anuncios de precios — flyer PNG estilo story de WhatsApp/IG (v4).

Spec exacta del gerente (4/6/2026):
  Lienzo 1080×1800, hero degradado azul marino, chips resumen Aumentos/
  Bajas/Nuevos, blocks por marca con barra vertical, cards de producto
  con DESCRIPCIÓN protagonista en JetBrains Mono Bold + SKU debajo en
  Inter Medium, badges + precios coloreados por tipo. Pensado para
  entenderse en 3 segundos en el celular.

Tipografía:
  Inter (texto general)         storage/fonts/Inter-Variable.ttf
  JetBrains Mono (descripción + precios)  storage/fonts/JetBrainsMono-Variable.ttf

Si una fuente falla, fallback a la otra; si las dos fallan, a Vera/default.
"""
from __future__ import annotations

import base64
import io
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from PIL import Image, ImageDraw, ImageFont

from ...brand_assets import brand_logo_path
from ...price_cost_rules import require_price_announcement_permission
from . import CurrentUser, PriceCostUpdateModel, db_session, require_current_user

router = APIRouter(prefix="/api/price-cost-updates", tags=["price-cost-updates"])

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# ── Lienzo ─────────────────────────────────────────────────────────────────
IMAGE_W = 1080
IMAGE_H = 1800
MAX_PRODUCTS_PER_PAGE = 25
PADDING_X = 40

# ── Header ─────────────────────────────────────────────────────────────────
HERO_H = 220
HERO_FROM = "#0A1A3F"
HERO_TO   = "#14306B"
TITLE_COLOR = "#FFFFFF"
TITLE_ACCENT = "#F5B544"  # ámbar para "precios"
SUB_COLOR = (255, 255, 255, 204)  # white 80%
ELECTRO_LABEL_COLOR = (255, 255, 255, 178)  # 70%

# ── Chips resumen ──────────────────────────────────────────────────────────
CHIP_H = 100
CHIP_GAP = 16
CHIP_COLORS: dict[str, dict[str, str]] = {
    # tipo: { bg, num, label, icon }
    "AUMENTO": {"bg": "#FEF3C7", "num": "#92400E", "label": "#92400E", "icon": "🔺"},
    "BAJA":    {"bg": "#D1FAE5", "num": "#065F46", "label": "#065F46", "icon": "🔻"},
    "NUEVO":   {"bg": "#DBEAFE", "num": "#1E40AF", "label": "#1E40AF", "icon": "✨"},
}
# (Para los chips en sí: se usan amber/verde/azul según spec)
CHIP_BG = {
    "AUMENTO": "#FFFFFF",
    "BAJA":    "#FFFFFF",
    "NUEVO":   "#FFFFFF",
}
CHIP_NUM_COLOR = {
    "AUMENTO": "#F5B544",
    "BAJA":    "#059669",
    "NUEVO":   "#2563EB",
}
CHIP_NUM_COLOR_ZERO = "#94A3B8"

# ── Cards de producto ──────────────────────────────────────────────────────
CARD_BG = "#FFFFFF"
CARD_BORDER = "#E5E9F0"
CARD_RADIUS = 14
CARD_MIN_H = 110
CARD_PAD_X = 20
CARD_PAD_Y = 18
PRICE_COL_W = 280

# Colores texto
TEXT_DESC = "#0F172A"
TEXT_SKU = "#334155"
TEXT_MUTED = "#94A3B8"

# Badges por tipo
BADGE_COLORS: dict[str, tuple[str, str]] = {
    "AUMENTO": ("#FEE2E2", "#991B1B"),
    "BAJA":    ("#D1FAE5", "#065F46"),
    "NUEVO":   ("#DBEAFE", "#1E40AF"),
}
PRICE_NEW_COLORS = {
    "AUMENTO": "#DC2626",   # rojo
    "BAJA":    "#059669",   # verde
    "NUEVO":   "#2563EB",   # azul
}

# Colores por marca (la barra vertical del header de bloque)
BRAND_COLORS: dict[str, str] = {
    "BGH":            "#E11D48",
    "WHIRLPOOL":      "#1D4ED8",
    "BLACK & DECKER": "#0F172A",
    "BLACK&DECKER":   "#0F172A",
    "CANDY":          "#7C3AED",
    "SAMSUNG":        "#1428A0",
    "LG":             "#A50034",
    "PHILIPS":        "#0066CC",
    "PHILCO":         "#E53935",
    "ATMA":           "#FF6B00",
    "PEABODY":        "#0EA5E9",
    "MIDEA":          "#0EA5E9",
    "DREAN":          "#16A34A",
    "ELECTROLUX":     "#0A66C2",
    "NOBLEX":         "#DC2626",
    "OSTER":          "#0EA5E9",
    "SMART LIFE":     "#7C3AED",
}
BRAND_DEFAULT_COLOR = "#475569"

# Footer
FOOTER_BG = "#0B1224"
FOOTER_TEXT = "#CBD5E1"
FOOTER_STRONG = "#FFFFFF"
FOOTER_H = 64

# ── Tipografía ─────────────────────────────────────────────────────────────
_BACKEND_ROOT = Path(__file__).resolve().parents[3]
INTER_PATH    = _BACKEND_ROOT / "storage" / "fonts" / "Inter-Variable.ttf"
MONO_PATH     = _BACKEND_ROOT / "storage" / "fonts" / "JetBrainsMono-Variable.ttf"

WEIGHT_REGULAR  = 400
WEIGHT_MEDIUM   = 500
WEIGHT_SEMIBOLD = 600
WEIGHT_BOLD     = 700


class AnnouncementImageRequest(BaseModel):
    update_ids: list[int] = Field(min_length=1, max_length=300)
    logo_brand: str = "gv_electro"
    title: str = "Nuevos precios"
    vigencia: str = ""              # Texto libre opcional. Si vacío, usa hoy.


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
# Helpers tipográficos
# ──────────────────────────────────────────────────────────────────────────

def _font(family: str, size: int, weight: int = WEIGHT_REGULAR) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """family: 'inter' | 'mono'. Aplica `set_variation_by_axes([weight])` si la fuente lo soporta."""
    path = INTER_PATH if family == "inter" else MONO_PATH
    try:
        if path.exists():
            font = ImageFont.truetype(str(path), size)
            try:
                font.set_variation_by_axes([weight])
            except Exception:
                pass
            return font
    except Exception:
        pass
    # Fallback al otro family + fallbacks de sistema
    try:
        other = MONO_PATH if family == "inter" else INTER_PATH
        if other.exists():
            font = ImageFont.truetype(str(other), size)
            try:
                font.set_variation_by_axes([weight])
            except Exception:
                pass
            return font
    except Exception:
        pass
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if weight >= WEIGHT_BOLD else "DejaVuSans.ttf", size)
    except Exception:
        pass
    try:
        import reportlab as _rl  # type: ignore
        vera_dir = Path(_rl.__file__).parent / "fonts"
        return ImageFont.truetype(str(vera_dir / ("VeraBd.ttf" if weight >= WEIGHT_BOLD else "Vera.ttf")), size)
    except Exception:
        pass
    return ImageFont.load_default()


def _tw(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    try:
        return float(draw.textlength(text, font=font))
    except Exception:
        box = draw.textbbox((0, 0), text, font=font)
        return float(box[2] - box[0])


def _wrap_lines(draw: ImageDraw.ImageDraw, text: Any, font: ImageFont.ImageFont, max_w: int, max_lines: int, *, truncate: bool = True) -> list[str]:
    words = re.sub(r"\s+", " ", str(text or "").strip()).split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if _tw(draw, candidate, font) <= max_w:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if not truncate:
        return lines or [""]
    if len(lines) == max_lines and len(" ".join(words)) > len(" ".join(lines)):
        tail = lines[-1]
        while tail and _tw(draw, f"{tail}…", font) > max_w:
            tail = tail[:-1].rstrip()
        lines[-1] = f"{tail}…" if tail else "…"
    return lines or [""]


# ──────────────────────────────────────────────────────────────────────────
# Helpers de negocio
# ──────────────────────────────────────────────────────────────────────────

def _money_display(value: Any) -> str:
    """Formatea '$ 1.250.000' (locale AR, sin centavos si .00)."""
    if value is None or value == "":
        return ""
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    if d == d.to_integral_value():
        body = f"{int(d):,}".replace(",", ".")
    else:
        body = f"{d:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"$ {body}"


def _classify(row: dict[str, Any]) -> str:
    ant = row.get("valor_anterior_dec")
    nuevo = row.get("valor_nuevo_dec")
    if ant is None or float(ant) == 0:
        return "NUEVO"
    if nuevo is None:
        return "NUEVO"
    try:
        if float(nuevo) > float(ant):
            return "AUMENTO"
        if float(nuevo) < float(ant):
            return "BAJA"
    except Exception:
        return "NUEVO"
    return "NUEVO"


def _format_vigencia(value: str) -> str:
    if value and value.strip():
        return value.strip()
    now = datetime.now(AR_TZ)
    dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    return f"{dias[now.weekday()]} {now.day} de {meses[now.month - 1]} {now.year}"


def _safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip().lower())
    return re.sub(r"-+", "-", value).strip("-") or "precios"


def _brand_color(marca: str) -> str:
    key = marca.upper().strip()
    return BRAND_COLORS.get(key, BRAND_DEFAULT_COLOR)


# ──────────────────────────────────────────────────────────────────────────
# Paginación
# ──────────────────────────────────────────────────────────────────────────

def _paginate(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Páginas de hasta MAX_PRODUCTS_PER_PAGE productos, manteniendo agrupación por marca."""
    pages: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    products_on_page = 0
    last_brand = ""
    for row in rows:
        brand = str(row["marca"] or "Sin marca")
        if products_on_page >= MAX_PRODUCTS_PER_PAGE:
            pages.append(current)
            current = []
            products_on_page = 0
            last_brand = ""
        if brand != last_brand:
            current.append({"kind": "brand", "marca": brand})
            last_brand = brand
        current.append({"kind": "row", **row})
        products_on_page += 1
    if current:
        pages.append(current)
    return pages


# ──────────────────────────────────────────────────────────────────────────
# Render: helpers de dibujo
# ──────────────────────────────────────────────────────────────────────────

def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _draw_gradient(draw: ImageDraw.ImageDraw, *, x0: int, y0: int, x1: int, y1: int, from_hex: str, to_hex: str) -> None:
    a = _hex_to_rgb(from_hex)
    b = _hex_to_rgb(to_hex)
    height = y1 - y0
    for i in range(height):
        t = i / max(1, height - 1)
        r = int(a[0] + (b[0] - a[0]) * t)
        g = int(a[1] + (b[1] - a[1]) * t)
        bl = int(a[2] + (b[2] - a[2]) * t)
        draw.line([(x0, y0 + i), (x1, y0 + i)], fill=(r, g, bl))


def _load_logo(logo_brand: str, target_diameter: int) -> Image.Image | None:
    path = brand_logo_path(logo_brand)
    if not path:
        return None
    try:
        logo = Image.open(path).convert("RGBA")
        logo.thumbnail((target_diameter, target_diameter), Image.LANCZOS)
        return logo
    except Exception:
        return None


def _draw_hero(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    *,
    vigencia: str,
    total_productos: int,
    logo_brand: str,
    empresa_label: str,
) -> None:
    """Hero según spec exacta."""
    # Fondo degradado
    _draw_gradient(draw, x0=0, y0=0, x1=IMAGE_W, y1=HERO_H, from_hex=HERO_FROM, to_hex=HERO_TO)

    # Padding interno: 40px lateral, 32px top, 28px bottom
    pad_top = 32
    pad_bottom = 28

    # Logo circular blanco 56px arriba a la izquierda
    logo_d = 56
    logo_x = PADDING_X
    logo_y = pad_top
    # Círculo blanco de fondo
    draw.ellipse((logo_x, logo_y, logo_x + logo_d, logo_y + logo_d), fill="#FFFFFF")
    logo = _load_logo(logo_brand, logo_d - 8)
    if logo:
        lw, lh = logo.size
        lx = logo_x + (logo_d - lw) // 2
        ly = logo_y + (logo_d - lh) // 2
        image.alpha_composite(logo, (lx, ly))
    else:
        # "GV" como placeholder
        ph_font = _font("inter", 22, WEIGHT_BOLD)
        ph_text = "GV"
        pw = _tw(draw, ph_text, ph_font)
        draw.text(
            (logo_x + (logo_d - pw) // 2, logo_y + 14),
            ph_text, fill="#0A1A3F", font=ph_font,
        )

    # "ELECTRO GV" a la derecha arriba (chico, 70% opacidad)
    label_font = _font("inter", 14, WEIGHT_SEMIBOLD)
    label_text = (empresa_label or "ELECTRO GV").upper()
    label_w = _tw(draw, label_text, label_font)
    draw.text(
        (IMAGE_W - PADDING_X - label_w, pad_top + 4),
        label_text, fill=ELECTRO_LABEL_COLOR, font=label_font,
    )

    # Título grande: "Nuevos precios" 64px peso 700, "precios" en ámbar
    title_font = _font("inter", 64, WEIGHT_BOLD)
    title_y = logo_y + logo_d + 16
    cursor_x = PADDING_X
    parts = ["Nuevos", "precios"]
    for idx, word in enumerate(parts):
        color = TITLE_ACCENT if idx == len(parts) - 1 else TITLE_COLOR
        draw.text((cursor_x, title_y), word, fill=color, font=title_font)
        cursor_x += int(_tw(draw, word, title_font)) + 16

    # Subtítulo: mínimo 24px de separación del baseline del título.
    # El bbox del título font 64 ocupa ~78px de alto visualmente.
    sub_font = _font("inter", 18, WEIGHT_MEDIUM)
    sub_text = f"Vigencia: {vigencia} · {total_productos} productos actualizados"
    sub_y = title_y + 64 + 24  # baseline ~ y+64, +24 de separación
    # Asegurar que no se pase del hero
    if sub_y + 22 > HERO_H - pad_bottom:
        sub_y = HERO_H - pad_bottom - 22
    draw.text((PADDING_X, sub_y), sub_text, fill=SUB_COLOR, font=sub_font)


def _draw_summary_chips(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    *,
    y: int,
    aumentos: int,
    bajas: int,
    nuevos: int,
) -> int:
    """3 chips alineados horizontalmente. Devuelve nuevo y."""
    chip_w = (IMAGE_W - PADDING_X * 2 - CHIP_GAP * 2) // 3
    types = [
        ("AUMENTO", "Aumentos", aumentos),
        ("BAJA",    "Bajas",    bajas),
        ("NUEVO",   "Nuevos",   nuevos),
    ]
    num_font = _font("inter", 38, WEIGHT_BOLD)
    label_font = _font("inter", 14, WEIGHT_SEMIBOLD)
    for i, (key, label, n) in enumerate(types):
        x = PADDING_X + i * (chip_w + CHIP_GAP)
        # Card
        draw.rounded_rectangle(
            (x, y, x + chip_w, y + CHIP_H),
            radius=CARD_RADIUS, fill=CARD_BG, outline=CARD_BORDER, width=1,
        )
        # Número grande
        num_color = CHIP_NUM_COLOR[key] if n > 0 else CHIP_NUM_COLOR_ZERO
        num_text = str(n)
        # Label en mayúscula
        label_text = label.upper()
        # Centrar número arriba + label debajo
        nw = _tw(draw, num_text, num_font)
        lw = _tw(draw, label_text, label_font)
        draw.text((x + (chip_w - nw) // 2, y + 18), num_text, fill=num_color, font=num_font)
        draw.text((x + (chip_w - lw) // 2, y + 64), label_text, fill="#64748B", font=label_font)
    return y + CHIP_H + 24


def _draw_brand_header(
    draw: ImageDraw.ImageDraw,
    *,
    y: int,
    marca: str,
    cambios_count: int,
) -> int:
    """Header de bloque por marca."""
    bar_color = _brand_color(marca)
    bar_w = 6
    bar_h = 28
    bar_x = PADDING_X
    bar_y = y + 6
    draw.rounded_rectangle((bar_x, bar_y, bar_x + bar_w, bar_y + bar_h), radius=3, fill=bar_color)

    brand_font = _font("inter", 28, WEIGHT_BOLD)
    count_font = _font("inter", 14, WEIGHT_MEDIUM)
    draw.text((bar_x + bar_w + 12, y), marca.upper(), fill=TEXT_DESC, font=brand_font)

    count_text = f"{cambios_count} cambio{'s' if cambios_count != 1 else ''}"
    cw = _tw(draw, count_text, count_font)
    draw.text((IMAGE_W - PADDING_X - cw, y + 11), count_text, fill="#94A3B8", font=count_font)

    return y + 44


def _draw_badge(
    draw: ImageDraw.ImageDraw,
    *,
    x: int,
    y: int,
    change: str,
) -> int:
    """Badge pill (radio 999px). Devuelve x al final (para encadenar)."""
    bg, fg = BADGE_COLORS.get(change, ("#E2E8F0", "#475569"))
    font = _font("inter", 11, WEIGHT_BOLD)
    text = change
    tw = _tw(draw, text, font)
    pad_x = 10
    pad_y = 4
    w = int(tw) + 2 * pad_x
    h = 20
    # Capsule: usar radius alto = pill
    draw.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=bg)
    draw.text((x + pad_x, y + 3), text, fill=fg, font=font)
    return x + w


def _draw_product_card(
    draw: ImageDraw.ImageDraw,
    *,
    y: int,
    entry: dict[str, Any],
) -> int:
    """Card horizontal de producto. Calcula alto dinámicamente según wrap del SKU."""
    change = entry.get("change") or "NUEVO"

    # Fonts
    desc_font  = _font("mono",  18, WEIGHT_BOLD)
    sku_font   = _font("inter", 15, WEIGHT_MEDIUM)
    price_new_font = _font("mono", 24, WEIGHT_BOLD)
    price_old_font = _font("mono", 14, WEIGHT_MEDIUM)

    # Layout: x_left + ancho info + ancho precios
    card_x0 = PADDING_X
    card_x1 = IMAGE_W - PADDING_X
    info_x0 = card_x0 + CARD_PAD_X
    info_x1 = card_x1 - CARD_PAD_X - PRICE_COL_W
    info_max_w = info_x1 - info_x0

    # Pre-calcular líneas de descripción (máx 2) y SKU (máx 2, sin truncar)
    desc_lines = _wrap_lines(draw, entry.get("producto"), desc_font, info_max_w, 2, truncate=True)
    sku_lines = _wrap_lines(draw, entry.get("sku"), sku_font, info_max_w, 2, truncate=False)

    desc_line_h = 22
    sku_line_h = 18
    content_h = (
        len(desc_lines) * desc_line_h
        + 6  # gap entre descripción y SKU
        + len(sku_lines) * sku_line_h
        + 24  # alto del badge (con un poco de padding)
    )
    card_h = max(CARD_MIN_H, content_h + CARD_PAD_Y * 2)

    # Fondo del card
    draw.rounded_rectangle(
        (card_x0, y, card_x1, y + card_h),
        radius=CARD_RADIUS, fill=CARD_BG, outline=CARD_BORDER, width=1,
    )

    # ── Columna izquierda
    cursor_y = y + CARD_PAD_Y

    # Descripción
    for line in desc_lines:
        draw.text((info_x0, cursor_y), line, fill=TEXT_DESC, font=desc_font)
        cursor_y += desc_line_h

    # Gap
    cursor_y += 6

    # SKU lines + badge en la misma fila que la última línea del SKU (a la derecha del SKU si entra)
    sku_y_start = cursor_y
    for line in sku_lines:
        draw.text((info_x0, cursor_y), line, fill=TEXT_SKU, font=sku_font)
        cursor_y += sku_line_h

    # Badge: a la derecha de la última línea del SKU
    last_line = sku_lines[-1] if sku_lines else ""
    sku_last_w = _tw(draw, last_line, sku_font)
    badge_y = sku_y_start + (len(sku_lines) - 1) * sku_line_h - 2
    _draw_badge(draw, x=info_x0 + int(sku_last_w) + 12, y=badge_y, change=change)

    # ── Columna derecha: precios
    price_x_right = card_x1 - CARD_PAD_X
    price_new_text = entry.get("valor_nuevo_text") or ""
    price_old_text = entry.get("valor_anterior_text") or ""

    if change in ("AUMENTO", "BAJA") and price_old_text:
        # Precio anterior arriba, tachado
        old_w = _tw(draw, price_old_text, price_old_font)
        old_x = price_x_right - int(old_w)
        old_y = y + CARD_PAD_Y + 4
        draw.text((old_x, old_y), price_old_text, fill=TEXT_MUTED, font=price_old_font)
        # Tachado
        strike_y = old_y + 9
        draw.line(
            (old_x - 2, strike_y, old_x + int(old_w) + 2, strike_y),
            fill=TEXT_MUTED, width=2,
        )

    # Precio nuevo
    new_color = PRICE_NEW_COLORS.get(change, TEXT_DESC)
    new_w = _tw(draw, price_new_text, price_new_font)
    new_x = price_x_right - int(new_w)
    # Centrar verticalmente con respecto al card
    new_y = y + (card_h - 24) // 2 + (8 if change in ("AUMENTO", "BAJA") and price_old_text else 0)
    draw.text((new_x, new_y), price_new_text, fill=new_color, font=price_new_font)

    return y + card_h + 12  # gap entre cards


def _draw_footer(
    draw: ImageDraw.ImageDraw,
    *,
    generado_por: str,
) -> None:
    """Footer: franja oscura con info de quién generó + aviso comercial."""
    draw.rectangle((0, IMAGE_H - FOOTER_H, IMAGE_W, IMAGE_H), fill=FOOTER_BG)

    left_font = _font("inter", 14, WEIGHT_MEDIUM)
    right_font = _font("inter", 14, WEIGHT_SEMIBOLD)

    left_text = "Lista sujeta a stock · Precios finales sin IVA"
    draw.text((PADDING_X, IMAGE_H - FOOTER_H + 22), left_text, fill=FOOTER_TEXT, font=left_font)

    right_text = f"Generado por {generado_por}" if generado_por else "ELECTRO GV"
    rw = _tw(draw, right_text, right_font)
    draw.text(
        (IMAGE_W - PADDING_X - int(rw), IMAGE_H - FOOTER_H + 22),
        right_text, fill=FOOTER_STRONG, font=right_font,
    )


# ──────────────────────────────────────────────────────────────────────────
# Render principal
# ──────────────────────────────────────────────────────────────────────────

def _render_page(
    entries: list[dict[str, Any]],
    *,
    vigencia: str,
    total_productos: int,
    logo_brand: str,
    empresa_label: str,
    generado_por: str,
    aumentos_total: int,
    bajas_total: int,
    nuevos_total: int,
    brand_count_global: dict[str, int],
    show_summary_chips: bool,
) -> bytes:
    image = Image.new("RGBA", (IMAGE_W, IMAGE_H), "#F5F7FB")
    draw = ImageDraw.Draw(image)

    # Hero
    _draw_hero(
        image, draw,
        vigencia=vigencia,
        total_productos=total_productos,
        logo_brand=logo_brand,
        empresa_label=empresa_label,
    )

    # Chips resumen
    y = HERO_H + 24
    if show_summary_chips:
        y = _draw_summary_chips(
            image, draw,
            y=y,
            aumentos=aumentos_total,
            bajas=bajas_total,
            nuevos=nuevos_total,
        )

    # Body
    for i, entry in enumerate(entries):
        if entry["kind"] == "brand":
            marca = str(entry["marca"])
            if i > 0:
                y += 10  # aire antes de un bloque nuevo
            y = _draw_brand_header(
                draw, y=y, marca=marca,
                cambios_count=brand_count_global.get(marca, 0),
            )
            continue
        y = _draw_product_card(draw, y=y, entry=entry)
        if y > IMAGE_H - FOOTER_H - 40:
            break  # safety: no escribir por encima del footer

    _draw_footer(draw, generado_por=generado_por)

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
            "valor_anterior_text": _money_display(valor_ant),
            "valor_nuevo_text": _money_display(valor_new),
        }
        rec["change"] = _classify(rec)
        rows.append(rec)
    rows.sort(key=lambda item: (item["marca"].lower(), item["producto"].lower(), item["sku"].lower()))

    brands = list(dict.fromkeys(row["marca"] for row in rows))
    brand_count_global: dict[str, int] = {}
    for r in rows:
        brand_count_global[r["marca"]] = brand_count_global.get(r["marca"], 0) + 1

    aumentos_total = sum(1 for r in rows if r["change"] == "AUMENTO")
    bajas_total    = sum(1 for r in rows if r["change"] == "BAJA")
    nuevos_total   = sum(1 for r in rows if r["change"] == "NUEVO")

    now = datetime.now(AR_TZ)
    generated_at = now.strftime("%d/%m/%Y %H:%M")
    vigencia_text = _format_vigencia(payload.vigencia)
    generado_por = str(getattr(user, "display_name", "") or getattr(user, "username", "") or "").strip()

    # Mensaje (para WhatsApp share / log)
    msg_parts = []
    if aumentos_total: msg_parts.append(f"{aumentos_total} aumento{'s' if aumentos_total != 1 else ''}")
    if bajas_total:    msg_parts.append(f"{bajas_total} baja{'s' if bajas_total != 1 else ''}")
    if nuevos_total:   msg_parts.append(f"{nuevos_total} nuevo{'s' if nuevos_total != 1 else ''}")
    detail = ", ".join(msg_parts) if msg_parts else "sin cambios"
    message = f"Nuevos precios {generated_at} — {detail}."

    empresa_label = "ELECTRO GV" if (payload.logo_brand or "").lower() in ("gv", "gv_electro") else (
        "ELECTRO ABC" if (payload.logo_brand or "").lower() in ("abc", "abc_electro") else "ELECTRO"
    )

    pages = _paginate(rows)
    total = len(pages)
    stamp = now.strftime("%Y%m%d-%H%M")
    images: list[AnnouncementImageOut] = []
    for index, entries in enumerate(pages, start=1):
        # Solo la primera página muestra los chips resumen
        png = _render_page(
            entries,
            vigencia=vigencia_text,
            total_productos=len(rows),
            logo_brand=payload.logo_brand,
            empresa_label=empresa_label,
            generado_por=generado_por,
            aumentos_total=aumentos_total,
            bajas_total=bajas_total,
            nuevos_total=nuevos_total,
            brand_count_global=brand_count_global,
            show_summary_chips=(index == 1),
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
