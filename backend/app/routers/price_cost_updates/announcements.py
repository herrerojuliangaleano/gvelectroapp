"""Anuncios de precios — flyer PNG estilo story de WhatsApp/IG (v5).

Spec exacta del gerente:
  Lienzo 1080×1800, render con Chromium headless desde HTML+CSS.
  - Hero degradado azul marino con logo grande a la derecha (sin label de texto).
  - Sin chips de resumen (los vendedores solo quieren ver los productos).
  - Blocks por marca con barra vertical de color.
  - Cards con DESCRIPCIÓN protagonista en JetBrains Mono Bold + SKU debajo en
    Inter Medium (wrap natural, sin truncar) + badge inline.
  - Precios con tabular-nums; antiguo tachado arriba en gris, nuevo coloreado
    por tipo abajo (AUMENTO rojo, BAJA verde, NUEVO azul).
  - Footer dark con la fecha de vigencia.

Render pipeline:
  1. Pre-paginar items por alto visual, manteniendo agrupación por marca.
  2. Por cada página: generar HTML+CSS y guardar en storage/runs/announcements/.
  3. Levantar Chromium una vez por request, abrir el HTML por `page.goto(file://)`,
     esperar a que las fuentes carguen y screenshotear 1080×1800.

Tipografía:
  Inter           storage/fonts/Inter-Variable.ttf
  JetBrains Mono  storage/fonts/JetBrainsMono-Variable.ttf
"""
from __future__ import annotations

import base64
import html as html_lib
import re
import secrets
import shutil
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ...brand_assets import brand_logo_path
from ...config import get_settings
from ...price_cost_rules import require_price_announcement_permission, require_price_announcement_view_permission
from . import (
    CurrentUser,
    LOCK,
    PriceAnnouncementBatchItemModel,
    PriceAnnouncementBatchModel,
    PriceCostUpdateModel,
    _current_user_id,
    _dt,
    _user_public,
    db_session,
    record_history,
    require_current_user,
    utc_now_dt,
)

router = APIRouter(prefix="/api/price-cost-updates", tags=["price-cost-updates"])

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# ── Lienzo ─────────────────────────────────────────────────────────────────
IMAGE_W = 1080
IMAGE_H = 1800
MIN_IMAGE_H = 1080
MAX_PRODUCTS_PER_PAGE = 18
ANNOUNCEMENT_PRICE_DISPLAY_OFFSET = Decimal("10")
HERO_H = 220
FOOTER_H = 56
BODY_PADDING_TOP = 28
BODY_PADDING_BOTTOM = 28
PAGE_HEIGHT_SAFETY = 36
PAGE_BODY_AVAILABLE_H = IMAGE_H - HERO_H - FOOTER_H - BODY_PADDING_TOP - BODY_PADDING_BOTTOM
BRAND_HEADER_ESTIMATED_H = 58
CARD_ESTIMATED_H = 112

# ── Paths ──────────────────────────────────────────────────────────────────
_BACKEND_ROOT = Path(__file__).resolve().parents[3]
INTER_PATH = _BACKEND_ROOT / "storage" / "fonts" / "Inter-Variable.ttf"
MONO_PATH  = _BACKEND_ROOT / "storage" / "fonts" / "JetBrainsMono-Variable.ttf"

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
    "ESLABON DE LUJO": "#22C55E",
}
BRAND_DEFAULT_COLOR = "#475569"


class AnnouncementImageRequest(BaseModel):
    update_ids: list[int] = Field(min_length=1, max_length=300)
    logo_brand: str = "gv_electro"
    title: str = "Nuevos precios"
    vigencia: str = ""


class AnnouncementImageOut(BaseModel):
    filename: str
    mime_type: str = "image/png"
    data_url: str
    brand_names: list[str]
    product_count: int
    page: int
    total_pages: int


class AnnouncementImagesOut(BaseModel):
    batch_id: int | None = None
    message: str
    generated_at: str
    brand_names: list[str]
    product_count: int
    images: list[AnnouncementImageOut]


class AnnouncementBatchOut(BaseModel):
    id: int
    message: str
    generated_at: str
    generated_by: str | None = None
    generated_by_name: str | None = None
    brand_names: list[str]
    product_count: int
    image_count: int
    logo_brand: str
    vigencia: str


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _money_display(value: Any) -> str:
    """Formatea el precio comercial de placa, restando $10 al valor real."""
    if value is None or value == "":
        return ""
    try:
        d = Decimal(str(value)) - ANNOUNCEMENT_PRICE_DISPLAY_OFFSET
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
    # Incluye hora porque el mismo día puede haber dos listas (mañana / tarde).
    return f"{dias[now.weekday()]} {now.day} de {meses[now.month - 1]} {now.year} · {now.strftime('%H:%M')}"


def _safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip().lower())
    return re.sub(r"-+", "-", value).strip("-") or "precios"


def _brand_color(marca: str) -> str:
    key = marca.upper().strip()
    return BRAND_COLORS.get(key, BRAND_DEFAULT_COLOR)


def _esc(text: Any) -> str:
    return html_lib.escape(str(text or ""))


def _file_uri(path: Path) -> str:
    return path.as_uri() if path.exists() else ""


def _is_new_entry(row: dict[str, Any]) -> bool:
    return str(row.get("change") or "").upper() == "NUEVO"


def _estimated_row_height(row: dict[str, Any]) -> int:
    height = CARD_ESTIMATED_H
    product_len = len(str(row.get("producto") or ""))
    sku_len = len(str(row.get("sku") or ""))
    if product_len > 64:
        height += 14
    if product_len > 100:
        height += 12
    if sku_len > 24:
        height += 8
    return height


def _page_has_new_entries(entries: list[dict[str, Any]]) -> bool:
    return any(entry.get("kind") == "row" and _is_new_entry(entry) for entry in entries)


def _page_entry_mix(entries: list[dict[str, Any]]) -> tuple[int, int]:
    new_count = 0
    price_count = 0
    for entry in entries:
        if entry.get("kind") != "row":
            continue
        if _is_new_entry(entry):
            new_count += 1
        else:
            price_count += 1
    return new_count, price_count


def _page_estimated_body_height(entries: list[dict[str, Any]]) -> int:
    height = 0
    for entry in entries:
        if entry.get("kind") == "brand":
            height += BRAND_HEADER_ESTIMATED_H
        elif entry.get("kind") == "row":
            height += _estimated_row_height(entry)
    return height


def _page_image_height(entries: list[dict[str, Any]]) -> int:
    content_height = (
        HERO_H
        + BODY_PADDING_TOP
        + _page_estimated_body_height(entries)
        + BODY_PADDING_BOTTOM
        + FOOTER_H
        + PAGE_HEIGHT_SAFETY
    )
    return max(MIN_IMAGE_H, min(IMAGE_H, content_height))


def _page_brand_counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in entries:
        if entry.get("kind") != "row":
            continue
        marca = str(entry.get("marca") or "Sin marca")
        counts[marca] = counts.get(marca, 0) + 1
    return counts


def _title_text_for_counts(new_count: int, price_count: int) -> str:
    if new_count and price_count:
        return "Nuevos precios e ingresos"
    if new_count:
        return "Nuevo ingreso" if new_count == 1 else "Nuevos ingresos"
    return "Nuevos precios"


def _hero_title_html(new_count: int, price_count: int) -> str:
    if new_count and price_count:
        return 'Nuevos <span class="accent-price">precios</span> e <span class="accent-new">ingresos</span>'
    if new_count:
        prefix = "Nuevo" if new_count == 1 else "Nuevos"
        word = "ingreso" if new_count == 1 else "ingresos"
        return f'{prefix} <span class="accent-new">{word}</span>'
    return 'Nuevos <span class="accent-price">precios</span>'


def _row_dict_from_update(row: PriceCostUpdateModel) -> dict[str, Any]:
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
        "auto_created": bool(row.auto_created),
    }
    rec["change"] = _classify(rec)
    rec["is_new_entry"] = _is_new_entry(rec)
    return rec


def _row_dict_from_batch_item(item: PriceAnnouncementBatchItemModel) -> dict[str, Any]:
    valor_ant: Decimal | None = item.valor_anterior  # type: ignore[assignment]
    valor_new: Decimal = item.valor_nuevo  # type: ignore[assignment]
    rec = {
        "id": int(item.update_id or 0),
        "marca": str(item.marca or "Sin marca").strip() or "Sin marca",
        "sku": str(item.sku or ""),
        "producto": str(item.producto or ""),
        "valor_anterior_dec": valor_ant,
        "valor_nuevo_dec": valor_new,
        "valor_anterior_text": _money_display(valor_ant),
        "valor_nuevo_text": _money_display(valor_new),
        "auto_created": bool(item.auto_created),
        "change": str(item.change_kind or "NUEVO"),
    }
    rec["is_new_entry"] = _is_new_entry(rec)
    return rec


def _sort_announcement_rows(rows: list[dict[str, Any]]) -> None:
    rows.sort(
        key=lambda item: (
            0 if item["is_new_entry"] else 1,
            item["marca"].lower(),
            item["producto"].lower(),
            item["sku"].lower(),
        )
    )


def _render_announcement_rows(
    *,
    rows: list[dict[str, Any]],
    logo_brand: str,
    vigencia_text: str,
    hero_title_override: str | None = None,
    count_word: str = "cambio",
) -> tuple[list[list[dict[str, Any]]], list[bytes]]:
    logo_path = brand_logo_path(logo_brand)
    logo_uri = logo_path.as_uri() if logo_path else ""
    pages = _paginate(rows)
    page_heights = [_page_image_height(entries) for entries in pages]
    html_pages = [
        _build_html(
            page_entries=entries,
            vigencia=vigencia_text,
            total_productos=len(rows),
            logo_uri=logo_uri,
            image_height=page_heights[index],
            hero_title_override=hero_title_override,
            count_word=count_word,
        )
        for index, entries in enumerate(pages)
    ]
    return pages, _render_pages_to_png(html_pages, page_heights)


def _batch_out(session, batch: PriceAnnouncementBatchModel) -> AnnouncementBatchOut:
    generated_by, generated_by_name = _user_public(session, batch.generated_by_user_id)
    return AnnouncementBatchOut(
        id=int(batch.id),
        message=str(batch.message or ""),
        generated_at=_dt(batch.generated_at),
        generated_by=generated_by,
        generated_by_name=generated_by_name,
        brand_names=list(batch.brand_names or []),
        product_count=int(batch.product_count or 0),
        image_count=int(batch.image_count or 0),
        logo_brand=str(batch.logo_brand or "gv_electro"),
        vigencia=str(batch.vigencia or ""),
    )


def _images_out_from_pngs(
    *,
    pages: list[list[dict[str, Any]]],
    png_bytes_list: list[bytes],
    stamp: str,
) -> list[AnnouncementImageOut]:
    total = len(pages)
    images: list[AnnouncementImageOut] = []
    for index, (entries, png) in enumerate(zip(pages, png_bytes_list), start=1):
        page_brands = list(dict.fromkeys(str(entry.get("marca") or "") for entry in entries if entry.get("kind") == "row"))
        new_count, price_count = _page_entry_mix(entries)
        if new_count and price_count:
            prefix = "nuevos-precios-ingresos"
        elif new_count:
            prefix = "nuevos-ingresos"
        else:
            prefix = "nuevos-precios"
        filename = f"{prefix}-{stamp}-{index:02d}-{_safe_filename('-'.join(page_brands[:2]))}.png"
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
    return images


# ──────────────────────────────────────────────────────────────────────────
# Paginación
# ──────────────────────────────────────────────────────────────────────────

def _paginate(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Paginas por alto visual, manteniendo agrupacion por marca."""
    pages: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    products_on_page = 0
    estimated_height = 0
    last_brand = ""
    for row in rows:
        brand = str(row["marca"] or "Sin marca")
        row_height = _estimated_row_height(row)
        needs_brand_header = brand != last_brand
        extra_height = row_height + (BRAND_HEADER_ESTIMATED_H if needs_brand_header else 0)

        if current and (
            products_on_page >= MAX_PRODUCTS_PER_PAGE
            or estimated_height + extra_height > PAGE_BODY_AVAILABLE_H
        ):
            pages.append(current)
            current = []
            products_on_page = 0
            estimated_height = 0
            last_brand = ""
            needs_brand_header = True

        if needs_brand_header:
            current.append({"kind": "brand", "marca": brand})
            estimated_height += BRAND_HEADER_ESTIMATED_H
            last_brand = brand
        current.append({"kind": "row", **row})
        estimated_height += row_height
        products_on_page += 1
    if current:
        pages.append(current)
    return pages


# ──────────────────────────────────────────────────────────────────────────
# HTML / CSS
# ──────────────────────────────────────────────────────────────────────────

_CSS_TEMPLATE = """
* { margin: 0; padding: 0; box-sizing: border-box; }

@font-face {
  font-family: 'Inter';
  src: url('__INTER_URI__') format('truetype-variations'),
       url('__INTER_URI__') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('__MONO_URI__') format('truetype-variations'),
       url('__MONO_URI__') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}

html, body {
  width: 1080px;
  background: #F5F7FB;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  text-rendering: optimizeLegibility;
}

.page {
  width: 1080px;
  height: __PAGE_HEIGHT__px;
  position: relative;
  background: #F5F7FB;
  overflow: hidden;
}

/* ── Hero ──────────────────────────────────────────────────────── */
.hero {
  height: 220px;
  background: linear-gradient(135deg, #0A1A3F 0%, #14306B 100%);
  padding: 32px 40px;
  position: relative;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hero-content {
  flex: 1;
  min-width: 0;
}
.hero h1 {
  font-size: 64px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.05;
}
.hero h1 .accent,
.hero h1 .accent-price { color: #F5B544; }
.hero h1 .accent-new { color: #2563EB; }
.hero h1 .accent-reingreso { color: #A78BFA; }
.hero .vigencia {
  margin-top: 24px;
  font-size: 18px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
}
.hero .logo-box {
  flex: 0 0 auto;
  width: 140px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 32px;
}
.hero .logo-box img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}
.hero .logo-fallback {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: #FFFFFF;
  color: #0A1A3F;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 48px;
  letter-spacing: 0.02em;
}

/* ── Body ──────────────────────────────────────────────────────── */
.body {
  padding: 28px 40px 0;
}

/* ── Brand block ───────────────────────────────────────────────── */
.brand-block { margin-top: 4px; }
.brand-block:first-child { margin-top: 0; }
.brand-header {
  display: flex;
  align-items: center;
  margin: 16px 0 10px;
}
.brand-bar {
  width: 6px;
  height: 28px;
  border-radius: 3px;
  margin-right: 12px;
}
.brand-name {
  font-size: 28px;
  font-weight: 700;
  color: #0F172A;
  letter-spacing: 0.01em;
}
.brand-count {
  margin-left: auto;
  font-size: 14px;
  font-weight: 500;
  color: #94A3B8;
}

/* ── Card ──────────────────────────────────────────────────────── */
.card {
  background: #FFFFFF;
  border: 1px solid #E5E9F0;
  border-radius: 14px;
  padding: 18px 22px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  min-height: 92px;
}
.card .info {
  flex: 1;
  min-width: 0;
  padding-right: 18px;
}
.card .desc {
  font-family: 'JetBrains Mono', 'Inter', monospace;
  font-weight: 700;
  font-size: 18px;
  color: #0F172A;
  line-height: 1.3;
  letter-spacing: -0.01em;
  /* Permite wrap pero corta a 2 líneas con ellipsis */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.card .sku-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.card .sku {
  font-size: 15px;
  font-weight: 500;
  color: #334155;
  line-height: 1.3;
  letter-spacing: 0.01em;
  /* Wrap natural — no truncate */
  word-break: break-word;
}
.badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  text-transform: uppercase;
}
.badge .icon {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  font-family: 'Inter', sans-serif;
}
/* Ámbar para AUMENTO (hace juego con "precios" del título). */
.badge.AUMENTO { background: #FEF3C7; color: #92400E; }
.badge.BAJA    { background: #D1FAE5; color: #065F46; }
.badge.NUEVO   { background: #DBEAFE; color: #1E40AF; }
/* Reingreso que mantiene el precio: violeta propio, distinto de aumento/baja/nuevo. */
.badge.REINGRESO { background: #EDE9FE; color: #6D28D9; }

.card .prices {
  flex: 0 0 auto;
  width: 280px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  font-family: 'JetBrains Mono', monospace;
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
}
.card .price-old {
  font-size: 14px;
  font-weight: 500;
  color: #94A3B8;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  margin-bottom: 4px;
  white-space: nowrap;
}
.card .price-new {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
/* AUMENTO ahora va en ámbar (mismo lenguaje visual que el título). */
.card.AUMENTO .price-new { color: #D97706; }
.card.BAJA    .price-new { color: #059669; }
.card.NUEVO   .price-new { color: #2563EB; }
.card.REINGRESO .price-new { color: #6D28D9; }

/* ── Footer ────────────────────────────────────────────────────── */
.footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: #0B1224;
  color: #FFFFFF;
  padding: 0 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
"""


def _build_html(
    *,
    page_entries: list[dict[str, Any]],
    vigencia: str,
    total_productos: int,
    logo_uri: str,
    image_height: int = IMAGE_H,
    hero_title_override: str | None = None,
    count_word: str = "cambio",
) -> str:
    """Construye el HTML completo de una página."""

    css = (
        _CSS_TEMPLATE
        .replace("__INTER_URI__", _file_uri(INTER_PATH))
        .replace("__MONO_URI__", _file_uri(MONO_PATH))
        .replace("__PAGE_HEIGHT__", str(int(image_height)))
    )

    # Hero — logo a la derecha (mas grande, sin label de texto)
    if logo_uri:
        hero_logo = f'<div class="logo-box"><img src="{logo_uri}" alt=""></div>'
    else:
        hero_logo = '<div class="logo-fallback">GV</div>'

    brand_count_page = _page_brand_counts(page_entries)
    new_count, price_count = _page_entry_mix(page_entries)
    # hero_title_override es HTML de confianza (constante nuestra, no input de usuario).
    hero_title = hero_title_override if hero_title_override else _hero_title_html(new_count, price_count)
    body_html: list[str] = []
    brand_block_open = False
    for entry in page_entries:
        if entry["kind"] == "brand":
            if brand_block_open:
                body_html.append("</div>")
            marca = str(entry["marca"])
            bar_color = _brand_color(marca)
            count = brand_count_page.get(marca, 0)
            count_text = f"{count} {count_word}" if count == 1 else f"{count} {count_word}s"
            body_html.append(
                f'''<div class="brand-block">
                    <div class="brand-header">
                      <div class="brand-bar" style="background: {bar_color}"></div>
                      <div class="brand-name">{_esc(marca.upper())}</div>
                      <div class="brand-count">{_esc(count_text)}</div>
                    </div>'''
            )
            brand_block_open = True
            continue
        # Card de producto
        change = entry.get("change") or "NUEVO"
        price_old = entry.get("valor_anterior_text") or ""
        price_new = entry.get("valor_nuevo_text") or ""
        old_html = (
            f'<div class="price-old">{_esc(price_old)}</div>'
            if change in ("AUMENTO", "BAJA") and price_old else ""
        )
        # Icono inline en el badge: ↑ aumento, ↓ baja, ★ nuevo.
        # Usamos Unicode geométrico (no emoji) para que mantenga el color del badge.
        badge_icon = {"AUMENTO": "↑", "BAJA": "↓", "NUEVO": "★", "REINGRESO": "↺"}.get(change, "")
        body_html.append(
            f'''<div class="card {change}">
                <div class="info">
                  <div class="desc">{_esc(entry.get("producto", ""))}</div>
                  <div class="sku-row">
                    <span class="sku">{_esc(entry.get("sku", ""))}</span>
                    <span class="badge {change}"><span class="icon">{badge_icon}</span>{_esc(change)}</span>
                  </div>
                </div>
                <div class="prices">
                  {old_html}
                  <div class="price-new">{_esc(price_new)}</div>
                </div>
              </div>'''
        )

    # Cerrar el último brand-block (todos los products terminan dentro de un brand-block abierto)
    if brand_block_open:
        body_html.append("</div>")

    productos_label = "producto actualizado" if total_productos == 1 else "productos actualizados"
    footer_text = f"Vigencia: {_esc(vigencia)}"

    html_doc = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>{css}</style>
</head>
<body>
<div class="page">
  <div class="hero">
    <div class="hero-content">
      <h1>{hero_title}</h1>
      <div class="vigencia">Vigencia: {_esc(vigencia)} · {total_productos} {productos_label}</div>
    </div>
    {hero_logo}
  </div>
  <div class="body">
    {''.join(body_html)}
  </div>
  <div class="footer">{footer_text}</div>
</div>
</body>
</html>
"""
    return html_doc


# ──────────────────────────────────────────────────────────────────────────
# Render via Chromium headless
# ──────────────────────────────────────────────────────────────────────────

def _render_pages_to_png(html_pages: list[str], page_heights: list[int] | None = None) -> list[bytes]:
    """Lanza Chromium una sola vez y renderiza N paginas a PNG 1080 x alto variable."""
    # Import lazy: si Playwright no está instalado, error 500 con mensaje claro.
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=(
                "Playwright no esta instalado en el container. "
                "Rebuildea el backend con `docker compose build backend` para que se instale Chromium."
            ),
        ) from exc

    settings = get_settings()
    runs_dir = settings.storage_dir / "runs" / "announcements"
    runs_dir.mkdir(parents=True, exist_ok=True)

    # Para cada página, escribir un archivo HTML temporal
    session_dir = runs_dir / f"render-{secrets.token_hex(6)}"
    session_dir.mkdir(parents=True, exist_ok=True)

    output: list[bytes] = []
    try:
        html_files: list[Path] = []
        for i, html in enumerate(html_pages, start=1):
            fp = session_dir / f"page-{i:02d}.html"
            fp.write_text(html, encoding="utf-8")
            html_files.append(fp)

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                heights = page_heights or [IMAGE_H for _ in html_files]
                for fp, page_height in zip(html_files, heights):
                    context = browser.new_context(
                        viewport={"width": IMAGE_W, "height": int(page_height)},
                        device_scale_factor=1,
                    )
                    page = context.new_page()
                    page.goto(fp.as_uri(), wait_until="domcontentloaded")
                    # Esperar que las fuentes se carguen completamente
                    page.evaluate("async () => { await document.fonts.ready; }")
                    png = page.screenshot(
                        type="png",
                        clip={"x": 0, "y": 0, "width": IMAGE_W, "height": int(page_height)},
                        omit_background=False,
                    )
                    output.append(png)
                    context.close()
            finally:
                browser.close()
    finally:
        try:
            shutil.rmtree(session_dir, ignore_errors=True)
        except Exception:
            pass

    return output


# ──────────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────────

class ReingresoItem(BaseModel):
    producto: str = Field(min_length=1)
    marca: str = "Sin marca"
    sku: str = ""
    precio: float


class ReingresoImageRequest(BaseModel):
    items: list[ReingresoItem] = Field(min_length=1, max_length=100)
    logo_brand: str = "gv_electro"
    vigencia: str = ""


@router.post("/announcements/reingreso", response_model=AnnouncementImagesOut)
def generate_reingreso_images(
    payload: ReingresoImageRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    """Genera la placa de 'Reingreso de:' (mismo estilo, color neutral, precio mantenido).

    A diferencia de /images, los productos los elige el usuario a mano (no salen de
    actualizaciones de precio) y no se persiste tanda.
    """
    require_price_announcement_permission(user)

    rows: list[dict[str, Any]] = []
    for it in payload.items:
        rows.append({
            "id": 0,
            "marca": (it.marca or "Sin marca").strip() or "Sin marca",
            "sku": (it.sku or "").strip(),
            "producto": (it.producto or "").strip(),
            "valor_anterior_dec": None,
            "valor_nuevo_dec": Decimal(str(it.precio)),
            "valor_anterior_text": "",
            "valor_nuevo_text": _money_display(it.precio),
            "change": "REINGRESO",
            "is_new_entry": False,
            "auto_created": False,
        })
    _sort_announcement_rows(rows)

    vigencia_text = _format_vigencia(payload.vigencia)
    pages, png_bytes_list = _render_announcement_rows(
        rows=rows, logo_brand=payload.logo_brand, vigencia_text=vigencia_text,
        hero_title_override='Nuevo <span class="accent-reingreso">reingreso</span>', count_word="producto",
    )

    now = datetime.now(AR_TZ)
    stamp = now.strftime("%Y%m%d-%H%M%S")
    images = _images_out_from_pngs(pages=pages, png_bytes_list=png_bytes_list, stamp=stamp)
    brands = list(dict.fromkeys(r["marca"] for r in rows))
    n = len(rows)
    return AnnouncementImagesOut(
        batch_id=None,
        message=f"Reingreso de {n} producto{'s' if n != 1 else ''} {now.strftime('%d/%m/%Y %H:%M')}.",
        generated_at=now.strftime("%d/%m/%Y %H:%M"),
        brand_names=brands,
        product_count=n,
        images=images,
    )


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

    rows = [_row_dict_from_update(row) for row in rows_db]
    _sort_announcement_rows(rows)

    brands = list(dict.fromkeys(row["marca"] for row in rows))

    aumentos_total = sum(1 for r in rows if r["change"] == "AUMENTO")
    bajas_total    = sum(1 for r in rows if r["change"] == "BAJA")
    nuevos_total   = sum(1 for r in rows if r["change"] == "NUEVO")

    now = datetime.now(AR_TZ)
    generated_at = now.strftime("%d/%m/%Y %H:%M")
    vigencia_text = _format_vigencia(payload.vigencia)

    # Mensaje (para WhatsApp share / log)
    msg_parts = []
    if aumentos_total: msg_parts.append(f"{aumentos_total} aumento{'s' if aumentos_total != 1 else ''}")
    if bajas_total:    msg_parts.append(f"{bajas_total} baja{'s' if bajas_total != 1 else ''}")
    if nuevos_total:   msg_parts.append(f"{nuevos_total} nuevo{'s' if nuevos_total != 1 else ''}")
    detail = ", ".join(msg_parts) if msg_parts else "sin cambios"
    message_title = _title_text_for_counts(nuevos_total, aumentos_total + bajas_total)
    message = f"{message_title} {generated_at} - {detail}."

    # Logo
    logo_path = brand_logo_path(payload.logo_brand)
    logo_uri = logo_path.as_uri() if logo_path else ""

    # Paginar + construir HTML
    pages = _paginate(rows)
    total = len(pages)
    html_pages = [
        _build_html(
            page_entries=entries,
            vigencia=vigencia_text,
            total_productos=len(rows),
            logo_uri=logo_uri,
            image_height=_page_image_height(entries),
        )
        for entries in pages
    ]

    # Render todas las páginas en una sola sesión de Chromium
    png_bytes_list = _render_pages_to_png(html_pages, [_page_image_height(entries) for entries in pages])

    batch_id: int | None = None
    now_db = utc_now_dt()
    with LOCK, db_session() as session:
        batch = PriceAnnouncementBatchModel(
            title=payload.title or message_title,
            message=message,
            logo_brand=payload.logo_brand,
            vigencia=vigencia_text,
            brand_names=brands,
            product_count=len(rows),
            image_count=total,
            generated_by_user_id=_current_user_id(session, user),
            generated_at=now_db,
        )
        session.add(batch)
        session.flush()
        batch_id = int(batch.id)

        db_rows_by_id = {
            int(row.id): row
            for row in session.scalars(select(PriceCostUpdateModel).where(PriceCostUpdateModel.id.in_(ids))).all()
        }
        actor_user_id = _current_user_id(session, user)
        for sort_order, rec in enumerate(rows, start=1):
            update_id = int(rec["id"])
            session.add(
                PriceAnnouncementBatchItemModel(
                    batch_id=batch_id,
                    update_id=update_id if update_id else None,
                    sort_order=sort_order,
                    type="price",
                    producto=str(rec.get("producto") or ""),
                    sku=str(rec.get("sku") or ""),
                    marca=str(rec.get("marca") or "Sin marca"),
                    valor_anterior=rec.get("valor_anterior_dec"),
                    valor_nuevo=rec.get("valor_nuevo_dec"),
                    change_kind=str(rec.get("change") or "NUEVO"),
                    auto_created=bool(rec.get("auto_created")),
                )
            )
            db_row = db_rows_by_id.get(update_id)
            if db_row and not db_row.announcement_archived_at:
                db_row.announcement_archived_at = now_db
                db_row.announcement_archived_by_user_id = actor_user_id
                db_row.updated_at = now_db
                record_history(
                    session,
                    update_id,
                    user,
                    "anuncio_archivado",
                    {"batch_id": batch_id, "reason": "announcement_generated"},
                )
        session.commit()

    stamp = now.strftime("%Y%m%d-%H%M")
    images = _images_out_from_pngs(pages=pages, png_bytes_list=png_bytes_list, stamp=stamp)

    return AnnouncementImagesOut(
        batch_id=batch_id,
        message=message,
        generated_at=generated_at,
        brand_names=brands,
        product_count=len(rows),
        images=images,
    )


@router.get("/announcements/batches", response_model=list[AnnouncementBatchOut])
def list_announcement_batches(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    limit: int = 30,
):
    require_price_announcement_view_permission(user)
    limit = max(1, min(int(limit or 30), 100))
    with db_session() as session:
        batches = session.scalars(
            select(PriceAnnouncementBatchModel)
            .order_by(PriceAnnouncementBatchModel.generated_at.desc(), PriceAnnouncementBatchModel.id.desc())
            .limit(limit)
        ).all()
        return [_batch_out(session, batch) for batch in batches]


@router.post("/announcements/batches/{batch_id}/images", response_model=AnnouncementImagesOut)
def regenerate_announcement_batch_images(
    batch_id: int,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    require_price_announcement_permission(user)
    with db_session() as session:
        batch = session.get(PriceAnnouncementBatchModel, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Lote de anuncios no encontrado")
        items = session.scalars(
            select(PriceAnnouncementBatchItemModel)
            .where(PriceAnnouncementBatchItemModel.batch_id == batch_id)
            .order_by(PriceAnnouncementBatchItemModel.sort_order.asc(), PriceAnnouncementBatchItemModel.id.asc())
        ).all()
        if not items:
            raise HTTPException(status_code=400, detail="El lote no tiene productos para regenerar")
        rows = [_row_dict_from_batch_item(item) for item in items]
        brand_names = list(batch.brand_names or list(dict.fromkeys(row["marca"] for row in rows)))
        message = str(batch.message or "")
        vigencia_text = str(batch.vigencia or _format_vigencia(""))
        logo_brand = str(batch.logo_brand or "gv_electro")

    pages, png_bytes_list = _render_announcement_rows(
        rows=rows,
        logo_brand=logo_brand,
        vigencia_text=vigencia_text,
    )
    now = datetime.now(AR_TZ)
    generated_at = now.strftime("%d/%m/%Y %H:%M")
    stamp = now.strftime("%Y%m%d-%H%M")
    images = _images_out_from_pngs(pages=pages, png_bytes_list=png_bytes_list, stamp=stamp)

    return AnnouncementImagesOut(
        batch_id=batch_id,
        message=message,
        generated_at=generated_at,
        brand_names=brand_names,
        product_count=len(rows),
        images=images,
    )
