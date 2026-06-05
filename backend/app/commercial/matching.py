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
from ..product_catalog import has_outlet_marker, sku_key


# Zero-width chars: invisibles pero rompen la igualdad de strings.
# Aparecen pegando desde web/Excel/Google Sheets.
_ZERO_WIDTH = "​‌‍⁠﻿"

# Comillas tipográficas (curly) → comilla recta ASCII
_FANCY_SINGLE_QUOTES = "‘’ʼ`´"  # ‘ ’ ʼ ` ´
_FANCY_DOUBLE_QUOTES = "“”″‶"        # “ ” ″ ‶


def normalize_descripcion(value: object) -> str:
    """Normaliza una descripción para comparación contra el catálogo.

    Pensada para ser tolerante a las diferencias chiquitas que aparecen entre
    lo cargado a mano en una planilla y lo guardado en el catálogo:
    espacios extras, espacios duros (NBSP / narrow-NBSP), zero-width chars,
    comillas tipográficas vs rectas, primas vs comillas, acentos,
    mayúsculas/minúsculas, paréntesis con espacios alrededor del (O).

    Preserva la marca de outlet (`(O)`/OUTLET) porque distingue producto.
    """
    if value is None:
        return ""
    text = str(value)
    # 1. Borrar zero-width invisibles (ZWSP, ZWNJ, ZWJ, WJ, BOM).
    text = re.sub(f"[{_ZERO_WIDTH}]", "", text)
    # 2. Comillas/primas fancy → ASCII. Hacer esto ANTES de NFKD porque
    #    NFKD descompone `″` (U+2033 double prime) en `′′` (dos U+2032),
    #    y nos quedaríamos con `''` en lugar de `"`.
    text = re.sub(f"[{_FANCY_SINGLE_QUOTES}]", "'", text)
    text = re.sub(f"[{_FANCY_DOUBLE_QUOTES}]", '"', text)
    # 3. NFKD descompone caracteres compatibles. Convierte NBSP / NNBSP en
    #    espacios normales y separa los acentos en combining marks.
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    # 3b. Después de NFKD pueden quedar primes individuales (U+2032 ′)
    #     que sobrevivieron a la descomposición de quotes dobles.
    text = text.replace("′", "'")
    # 4. Uppercase + trim.
    text = text.upper().strip()
    # 5. Marca outlet "( O )" / "(o)" / "(0)" → "(O)".
    text = re.sub(r"\(\s*([Oo0])\s*\)", r"(O)", text)
    # 6. Colapsar runs de whitespace (todo \s Unicode) → un solo espacio.
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _product_condition(product: Product) -> str:
    cond = str(getattr(product, "condicion_producto", "") or "").strip().upper()
    if cond in {"PRIMERA", "OUTLET"}:
        return cond
    return "OUTLET" if has_outlet_marker(getattr(product, "sku", ""), getattr(product, "descripcion", "")) else "PRIMERA"


def _incoming_condition(sku_normalized: str | None, descripcion: str | None) -> str:
    return "OUTLET" if has_outlet_marker(sku_normalized or "", descripcion or "") else "PRIMERA"


def _sku_base_key(value: object) -> str:
    """SKU comparable sin marcador outlet explicito."""
    key = sku_key(value)
    return re.sub(r"\((?:O|0)\)", "", key)


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
    by_sku_condition: dict[tuple[str, str], Product] = {}
    by_desc: dict[str, Product] = {}
    by_id: dict[int, Product] = {}
    for p in products:
        by_id[int(p.id)] = p
        sku_key_value = str(p.sku_normalized or "").strip()
        if sku_key_value:
            by_sku[sku_key_value] = p
            sku_base = _sku_base_key(sku_key_value)
            if sku_base:
                by_sku_condition[(sku_base, _product_condition(p))] = p
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
        "by_sku_condition": by_sku_condition,
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
    # 2. Alias manual por descripcion.
    if descripcion:
        norm = normalize_descripcion(descripcion)
        if norm:
            match = indexes.get("by_alias_desc", {}).get(norm)
            if match is not None:
                return match
    # 3. SKU base + condicion detectada. Esto evita mezclar primera/outlet
    # cuando el GFK limpia el modelo pero mantiene "(O)" en la descripcion.
    incoming_condition = _incoming_condition(sku_normalized, descripcion)
    if sku_normalized:
        sku_base = _sku_base_key(sku_normalized)
        if sku_base:
            match = indexes.get("by_sku_condition", {}).get((sku_base, incoming_condition))
            if match is not None:
                return match
    # 4. SKU normalizado exacto, solo si no contradice la condicion detectada.
    if sku_normalized:
        match = indexes.get("by_sku", {}).get(sku_normalized)
        if match is not None and _product_condition(match) == incoming_condition:
            return match
    # 5. Alias manual por SKU.
    if sku_normalized:
        match = indexes.get("by_alias_sku", {}).get(sku_normalized)
        if match is not None:
            return match
    return None
