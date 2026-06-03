"""Matching híbrido SKU ↔ Descripción ↔ Catálogo de productos.

Problema operativo:
- Los SKUs y descripciones cambian con frecuencia en el catálogo PVP.
- Si en el GFK aparece un SKU viejo y en el catálogo ya tiene otro, el match
  por SKU falla → el producto aparece en "no catalogados" aunque conceptual-
  mente sea el mismo.
- Mismo si cambia la descripción.

Estrategia de matching (en orden de prioridad):
  1. SKU normalizado (con sku_key — limpia outlet, espacios, mayúsculas).
  2. Descripción normalizada (sin tildes, sin espacios extra, uppercase).
  3. Alias manual (tabla psi_product_aliases — Sprint 5.3).

Si los tres fallan → producto va a la bandeja "no catalogados" con UI para
asignación manual.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable

from ..models.products import Product


def normalize_descripcion(value: object) -> str:
    """Normaliza una descripción para comparación.

    Preserva la marca de outlet (`(O)`/OUTLET) porque distingue producto.
    """
    if value is None:
        return ""
    text = str(value)
    # NFKD + sin combining
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    # Uppercase
    text = text.upper().strip()
    # Colapsar espacios y normalizar paréntesis "( O )" → "(O)"
    text = re.sub(r"\(\s*([Oo0])\s*\)", r"(O)", text)
    text = re.sub(r"\s+", " ", text)
    return text


def build_product_indexes(products: Iterable[Product]) -> dict[str, dict]:
    """Construye índices invertidos del catálogo para matching rápido.

    Returns:
        {
          "by_sku":  {sku_normalized: product},
          "by_desc": {descripcion_normalizada: product},
        }

    Si hay duplicados en el catálogo (mismo sku_normalized o misma descripción
    normalizada), gana el último (no garantizado, no es ideal pero es raro).
    """
    by_sku: dict[str, Product] = {}
    by_desc: dict[str, Product] = {}
    for p in products:
        sku_key_value = str(p.sku_normalized or "").strip()
        if sku_key_value:
            by_sku[sku_key_value] = p
        desc_key_value = normalize_descripcion(p.descripcion)
        if desc_key_value:
            by_desc[desc_key_value] = p
    return {"by_sku": by_sku, "by_desc": by_desc}


def resolve_product(
    *,
    sku_normalized: str | None,
    descripcion: str | None,
    indexes: dict[str, dict],
) -> Product | None:
    """Busca un producto en el catálogo por SKU primero, descripción después.

    Returns el Product encontrado o None si no matchea ningún criterio.
    """
    # 1. Por SKU normalizado
    if sku_normalized:
        match = indexes.get("by_sku", {}).get(sku_normalized)
        if match is not None:
            return match
    # 2. Por descripción normalizada
    if descripcion:
        norm = normalize_descripcion(descripcion)
        if norm:
            match = indexes.get("by_desc", {}).get(norm)
            if match is not None:
                return match
    return None
