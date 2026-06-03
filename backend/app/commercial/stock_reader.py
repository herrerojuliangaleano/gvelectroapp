"""Reader de la hoja "Stock" del libro de Stock en Drive.

Estructura esperada de la hoja (fila 1 = header):
    A: MARCA | B: TIPO | C: DESCRIPCION | D: SKU | E: PVP | F: COSTO VIGENTE | G: STOCK INICIO

Output del reader:
    dict { sku_normalized: int(stock) }

El SKU se normaliza con ``product_catalog.sku_key`` para soportar las variantes
inconsistentes de outlet en el sheet ('(O)', '(o)', ' (O)', '(0)', etc.).
La condición OUTLET/PRIMERA NO se determina acá — sale del catálogo de
productos (``products.condicion_producto``).

Cache:
    Key 'stock:{book_id}:{sheet_name}'
    TTL DEFAULT_TTL_SECONDS (15 min)
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..google_sheets import quote_sheet_name, sheets_service
from ..operational_config import load_operational_config
from ..product_catalog import sku_key
from . import cache_get, cache_set


def _commercial_config() -> dict[str, Any]:
    root = load_operational_config()
    commercial = root.get("commercial") if isinstance(root, dict) else None
    if not isinstance(commercial, dict):
        commercial = {}
    return commercial


def _stock_config() -> tuple[str, str]:
    cfg = _commercial_config()
    book_id = str(cfg.get("stock_book_id") or "").strip()
    sheet_name = str(cfg.get("stock_sheet_name") or "Stock").strip() or "Stock"
    if not book_id:
        raise HTTPException(
            status_code=500,
            detail=(
                "Falta configurar 'commercial.stock_book_id' en operational_config. "
                "Es el file_id del libro Stock en Google Drive."
            ),
        )
    return book_id, sheet_name


def _parse_int(value: Any) -> int:
    """Parsea un valor del Sheet a int. Acepta '0', '', '24', '24.0', etc."""
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    text = text.replace(".", "").replace(",", "")
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return 0


def load_stock_data(force_refresh: bool = False) -> dict[str, Any]:
    """Carga la hoja Stock con todos los campos necesarios para matching.

    Returns:
        {
          "stock_map":      {sku_norm: int}  cantidades
          "meta_by_sku":    {sku_norm: {sku_raw, descripcion_raw, marca, tipo}}
        }
    """
    book_id, sheet_name = _stock_config()
    cache_key = f"stock_full:{book_id}:{sheet_name}"

    if not force_refresh:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    service = sheets_service()
    rng = f"{quote_sheet_name(sheet_name)}!A1:G50000"
    result = service.spreadsheets().values().get(
        spreadsheetId=book_id,
        range=rng,
        valueRenderOption="UNFORMATTED_VALUE",
        dateTimeRenderOption="FORMATTED_STRING",
    ).execute()
    rows = result.get("values", [])

    if not rows:
        empty = {"stock_map": {}, "meta_by_sku": {}}
        cache_set(cache_key, empty)
        return empty

    # Esperado: A=MARCA, B=TIPO, C=DESCRIPCION, D=SKU, E=PVP, F=COSTO, G=STOCK
    stock_map: dict[str, int] = {}
    meta_by_sku: dict[str, dict[str, Any]] = {}
    for raw in rows[1:]:
        if len(raw) < 4:
            continue
        marca_raw = str(raw[0] if len(raw) > 0 else "").strip()
        tipo_raw = str(raw[1] if len(raw) > 1 else "").strip()
        desc_raw = str(raw[2] if len(raw) > 2 else "").strip()
        sku_raw = str(raw[3] if len(raw) > 3 else "").strip()
        stock_raw = raw[6] if len(raw) > 6 else 0
        key = sku_key(sku_raw)
        if not key:
            continue
        stock_map[key] = _parse_int(stock_raw)
        meta_by_sku[key] = {
            "sku_raw": sku_raw,
            "descripcion_raw": desc_raw,
            "marca": marca_raw,
            "tipo": tipo_raw,
        }

    payload = {"stock_map": stock_map, "meta_by_sku": meta_by_sku}
    cache_set(cache_key, payload)
    return payload


def load_stock_map(force_refresh: bool = False) -> dict[str, int]:
    """Wrapper de compatibilidad: solo el dict {sku_norm: cantidad}."""
    return load_stock_data(force_refresh=force_refresh)["stock_map"]


def lookup_stock(sku: str, stock_map: dict[str, int] | None = None) -> int:
    """Devuelve el stock de un SKU (0 si no está)."""
    if stock_map is None:
        stock_map = load_stock_map()
    return stock_map.get(sku_key(sku), 0)
