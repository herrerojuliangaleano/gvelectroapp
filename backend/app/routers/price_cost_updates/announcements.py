from __future__ import annotations

import base64
import io
import re
from datetime import datetime
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
IMAGE_W = 1080
IMAGE_H = 1350
MARGIN = 58
ROW_H = 62
BRAND_H = 46
MAX_UNITS = 17


class AnnouncementImageRequest(BaseModel):
    update_ids: list[int] = Field(min_length=1, max_length=160)
    logo_brand: str = "gv_electro"
    title: str = "Cambios de precios"


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


def _brand_sentence(brands: list[str]) -> str:
    values = [b for b in brands if b]
    if not values:
        return "las marcas seleccionadas"
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} y {values[1]}"
    return f"{', '.join(values[:-1])} y {values[-1]}"


def _safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip().lower())
    return re.sub(r"-+", "-", value).strip("-") or "precios"


def _load_logo(logo_brand: str) -> Image.Image | None:
    path = brand_logo_path(logo_brand)
    if not path:
        return None
    try:
        logo = Image.open(path).convert("RGBA")
        logo.thumbnail((104, 104), Image.LANCZOS)
        return logo
    except Exception:
        return None


def _paginate(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    pages: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    units = 0
    last_brand = ""
    for row in rows:
        brand = str(row["marca"] or "Sin marca")
        needs_header = brand != last_brand or not current
        needed = (1 if needs_header else 0) + 1
        if current and units + needed > MAX_UNITS:
            pages.append(current)
            current = []
            units = 0
            last_brand = ""
            needs_header = True
            needed = 2
        if needs_header:
            current.append({"kind": "brand", "marca": brand})
            units += 1
            last_brand = brand
        current.append({"kind": "row", **row})
        units += 1
    if current:
        pages.append(current)
    return pages


def _draw_header(draw: ImageDraw.ImageDraw, image: Image.Image, *, title: str, generated_at: str, logo_brand: str, page: int, total_pages: int) -> None:
    logo = _load_logo(logo_brand)
    if logo:
        image.alpha_composite(logo, (MARGIN, 52))
        text_x = MARGIN + 126
    else:
        text_x = MARGIN
    title_font = _font(48, bold=True)
    sub_font = _font(24)
    small_font = _font(21, bold=True)
    draw.text((text_x, 54), title, fill="#1D4ED8", font=title_font)
    draw.text((text_x, 112), f"Generado {generated_at}", fill="#475569", font=sub_font)
    page_text = f"Parte {page}/{total_pages}" if total_pages > 1 else "Lista para compartir"
    draw.text((IMAGE_W - MARGIN - _text_width(draw, page_text, small_font), 72), page_text, fill="#0F172A", font=small_font)


def _render_page(entries: list[dict[str, Any]], *, title: str, generated_at: str, logo_brand: str, page: int, total_pages: int) -> bytes:
    image = Image.new("RGBA", (IMAGE_W, IMAGE_H), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    _draw_header(draw, image, title=title, generated_at=generated_at, logo_brand=logo_brand, page=page, total_pages=total_pages)

    header_font = _font(21, bold=True)
    brand_font = _font(27, bold=True)
    row_font = _font(22)
    sku_font = _font(21, bold=True)
    price_font = _font(23, bold=True)
    foot_font = _font(19)

    y = 210
    table_left = MARGIN
    table_right = IMAGE_W - MARGIN
    draw.rounded_rectangle((table_left, y, table_right, y + 48), radius=12, fill="#0F172A")
    draw.text((table_left + 20, y + 14), "SKU", fill="#E2E8F0", font=header_font)
    draw.text((table_left + 228, y + 14), "DESCRIPCION", fill="#E2E8F0", font=header_font)
    draw.text((table_right - 170, y + 14), "PRECIO", fill="#E2E8F0", font=header_font)
    y += 56

    for entry in entries:
        if entry["kind"] == "brand":
            draw.rounded_rectangle((table_left, y, table_right, y + BRAND_H), radius=10, fill="#DBEAFE")
            draw.text((table_left + 20, y + 9), str(entry["marca"]).upper(), fill="#1E3A8A", font=brand_font)
            y += BRAND_H + 8
            continue

        row_top = y
        row_bottom = y + ROW_H
        draw.line((table_left, row_bottom, table_right, row_bottom), fill="#E2E8F0", width=2)
        draw.text((table_left + 20, row_top + 14), str(entry["sku"])[:17], fill="#0F172A", font=sku_font)
        lines = _wrap(draw, entry["producto"], row_font, 482, 2)
        for idx, line in enumerate(lines):
            draw.text((table_left + 228, row_top + 9 + idx * 25), line, fill="#334155", font=row_font)
        price = str(entry["valor_nuevo"])
        draw.text((table_right - 24 - _text_width(draw, price, price_font), row_top + 16), price, fill="#0F172A", font=price_font)
        y += ROW_H

    footer = "Precios sujetos a disponibilidad y vigencia comercial."
    draw.text((MARGIN, IMAGE_H - 62), footer, fill="#64748B", font=foot_font)

    out = io.BytesIO()
    image.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


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

    rows = [
        {
            "id": int(row.id),
            "marca": str(row.marca or "Sin marca").strip() or "Sin marca",
            "sku": str(row.sku or ""),
            "producto": str(row.producto or ""),
            "valor_nuevo": sheet_money(row.valor_nuevo),
        }
        for row in rows_db
    ]
    rows.sort(key=lambda item: (item["marca"].lower(), item["producto"].lower(), item["sku"].lower()))
    brands = list(dict.fromkeys(row["marca"] for row in rows))
    now = datetime.now(AR_TZ)
    generated_at = now.strftime("%d/%m/%Y %H:%M")
    message = f"Cambios de precios {generated_at} en {_brand_sentence(brands)}."

    pages = _paginate(rows)
    total = len(pages)
    stamp = now.strftime("%Y%m%d-%H%M")
    images: list[AnnouncementImageOut] = []
    for index, entries in enumerate(pages, start=1):
        png = _render_page(
            entries,
            title=(payload.title or "Cambios de precios").strip(),
            generated_at=generated_at,
            logo_brand=payload.logo_brand,
            page=index,
            total_pages=total,
        )
        page_brands = list(dict.fromkeys(str(entry.get("marca") or "") for entry in entries if entry.get("kind") == "row"))
        filename = f"cambios-precios-{stamp}-{index:02d}-{_safe_filename('-'.join(page_brands[:2]))}.png"
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
