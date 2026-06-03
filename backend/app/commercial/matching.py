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


def build_product_indexes(
    products: Iterable[Product],
    aliases: Iterable[object] | None = None,
) -> dict[str, dict]:
    """Construye índices invertidos del catálogo + aliases manuales.

    Args:
        products: catálogo activo.
        aliases: instancias de PSIProductAlias (opcional). Si están, agregan
            entradas a by_alias_sku / by_alias_desc.

    Returns:
        {
          "by_sku":         {sku_normalized: product},
          "by_desc":        {descripcion_normalizada: product},
          "by_alias_sku":   {alias_sku_norm: product},
          "by_alias_desc":  {alias_desc_norm: product},
        }
    """
    by_sku: dict[str, Product] = {}
    by_desc: dict[str, Product] = {}
    by_id: dict[int, Product] = {}
    for p in products:
        by_id[int(p.id)] = p
        sku_key_value = str(p.sku_normalized or "").strip()
        if sku_key_value:
            by_sku[sku_key_value] = p
        desc_key_value = normalize_descripcion(p.descripcion)
        if desc_key_value:
            by_desc[desc_key_value] = p

    by_alias_sku: dict[str, Product] = {}
    by_alias_desc: dict[str, Product] = {}
    for alias in aliases or []:
        target = by_id.get(int(getattr(alias, "product_id", 0) or 0))
        if target is None:
            continue
        sku_norm = (getattr(alias, "alias_sku_norm", None) or "").strip()
        if sku_norm:
            by_alias_sku[sku_norm] = target
        desc_norm = (getattr(alias, "alias_desc_norm", None) or "").strip()
        if desc_norm:
            by_alias_desc[desc_norm] = target

    return {
        "by_sku": by_sku,
        "by_desc": by_desc,
        "by_alias_sku": by_alias_sku,
        "by_alias_desc": by_alias_desc,
    }


def resolve_product(
    *,
    sku_normalized: str | None,
    descripcion: str | None,
    indexes: dict[str, dict],
) -> Product | None:
    """Busca un producto en el catálogo.

    Orden de prioridad (validado con el gerente — Sprint 5):
      1. Descripción normalizada (más robusto: los SKUs cambian, la descripción
         operativa rara vez).
      2. SKU normalizado (fallback para casos donde la descripción difiere).
      3. Alias manual por descripción (Sprint 5.3, si está cargado).
      4. Alias manual por SKU (Sprint 5.3).

    Returns el Product encontrado o None si no matchea ningún criterio.
    """
    # 1. Descripción del producto en el catálogo
    if descripcion:
        norm = normalize_descripcion(descripcion)
        if norm:
            match = indexes.get("by_desc", {}).get(norm)
            if match is not None:
                return match
    # 2. SKU normalizado
    if sku_normalized:
        match = indexes.get("by_sku", {}).get(sku_normalized)
        if match is not None:
            return match
    # 3-4. Aliases manuales (cargados en indexes['by_alias_desc'] y ['by_alias_sku'])
    if descripcion:
        norm = normalize_descripcion(descripcion)
        if norm:
            match = indexes.get("by_alias_desc", {}).get(norm)
            if match is not None:
                return match
    if sku_normalized:
        match = indexes.get("by_alias_sku", {}).get(sku_normalized)
        if match is not None:
            return match
    return None
