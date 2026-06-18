"""Sugeridor de normalización (Carril A — acelerar la migración).

Toma una descripción legacy + la plantilla del rubro y PROPONE valores para
el armador: condición (OUTLET por "(O)"), campos numéricos (por unidad), campos
select (matcheando opciones comercial/ERP) y las correcciones de typos del
doc 16 §11. Es genérico: se maneja por la plantilla, no hardcodea rubros.

No decide nada solo: la pantalla precarga estas sugerencias y el operador las
revisa/corrige antes de guardar.
"""
from __future__ import annotations

import re
from typing import Any

from .catalog_generator import norm_erp_text

# ── Typos reales detectados (doc 16 §11). Se corrigen sobre el texto
#    normalizado (MAYÚSCULAS, sin tildes) antes de matchear. ──────────────
TYPOS: list[tuple[str, str]] = [
    ("FREZEER", "FREEZER"),
    ("ORNALLAS", "HORNALLAS"),
    ("ELCETRICO", "ELECTRICO"),
    ("CONDESACION", "CONDENSACION"),
    ("MULTIROCESADORA", "MULTIPROCESADORA"),
]

# Alias de unidades por sufijo ERP. El más largo primero para no cortar
# (LTS antes que L). Permite reconocer "194 L", "20 LTS", "55 LITROS".
UNIT_ALIASES: dict[str, list[str]] = {
    "KG": ["KILOS", "KGS", "KG"],
    "L": ["LITROS", "LTS", "LT", "L"],
    "RPM": ["REVOLUCIONES", "RPM"],
    "W": ["WATTS", "WATT", "W"],
    "CM": ["CENTIMETROS", "CMS", "CM"],
    '"': ["PULGADAS", "PULG", '"', "''"],
    "CUB": ["CUBIERTOS", "CUB"],
    "P": ["PUERTAS", "P"],
    "H": ["HORNALLAS", "H"],
    "Q": ["QUEMADORES", "Q"],
}


def correct_typos(norm_desc: str) -> tuple[str, list[dict[str, str]]]:
    """Corrige typos conocidos sobre el texto ya normalizado. Devuelve el
    texto corregido + la lista de correcciones aplicadas (para mostrarlas)."""
    out = norm_desc
    applied: list[dict[str, str]] = []
    for bad, good in TYPOS:
        if re.search(r"(?<![A-Z0-9])" + re.escape(bad) + r"(?![A-Z0-9])", out):
            out = re.sub(r"(?<![A-Z0-9])" + re.escape(bad) + r"(?![A-Z0-9])", good, out)
            applied.append({"de": bad, "a": good})
    # "2O LTS" / "1O KG": O usada como 0 pegada a un dígito antes de unidad
    fixed = re.sub(r"(?<=\d)O(?=\s*(?:LTS|LITROS|L|KG|KILOS|W|RPM|CM|CUB|H|Q)\b)", "0", out)
    if fixed != out:
        applied.append({"de": "2O", "a": "20"})
        out = fixed
    return out, applied


def _aliases_for(field: dict[str, Any]) -> list[str]:
    suf = str(field.get("sufijo_erp") or "").strip().upper()
    if suf and suf in UNIT_ALIASES:
        return UNIT_ALIASES[suf]
    if suf:
        return [suf]
    sc = str(field.get("sufijo_comercial") or "").strip().upper()
    if sc and sc in UNIT_ALIASES:
        return UNIT_ALIASES[sc]
    return [sc] if sc else []


def _clean_number(raw: str) -> str:
    """Normaliza formato argentino: '1.000'→'1000' (miles), '7.0'→'7.0' (decimal),
    '7,5'→'7.5' (coma decimal), '1.234,56'→'1234.56'."""
    s = raw.strip()
    if "," in s:  # coma decimal; los puntos son miles
        return s.replace(".", "").replace(",", ".")
    if s.count(".") > 1:  # varios puntos → todos miles
        return s.replace(".", "")
    if "." in s:
        intpart, _, frac = s.partition(".")
        if len(frac) == 3:  # 3 dígitos tras el punto → separador de miles
            return intpart + frac
        return s  # decimal (7.0, 2.5, 10.50)
    return s


def _extract_number(field: dict[str, Any], norm_desc: str) -> str | None:
    aliases = [a for a in _aliases_for(field) if a]
    if not aliases:
        return None
    alt = "|".join(re.escape(a) for a in sorted(aliases, key=len, reverse=True))
    m = re.search(r"(\d+(?:[.,]\d+)*)\s*(?:" + alt + r")(?![A-Z])", norm_desc)
    if not m:
        return None
    return _clean_number(m.group(1))


def _match_select(field: dict[str, Any], norm_desc: str) -> str | None:
    for opt in field.get("opciones") or []:
        for key in (opt.get("comercial"), opt.get("erp")):
            k = norm_erp_text(key or "")
            if not k:
                continue
            if re.search(r"(?<![A-Z0-9])" + re.escape(k) + r"(?![A-Z0-9])", norm_desc):
                return opt.get("valor")
    return None


def suggest(descripcion: str, sku: str, template: dict[str, Any] | None) -> dict[str, Any]:
    """Devuelve sugerencias para precargar el armador desde el legacy."""
    raw_desc = str(descripcion or "")
    raw_sku = str(sku or "")
    is_outlet = bool(re.search(r"\(O\)", raw_sku, re.I) or re.search(r"\(O\)|OUTLET", raw_desc, re.I))
    sku_base = re.sub(r"\s*\(O\)\s*$", "", raw_sku, flags=re.I).strip()

    norm_desc, typos = correct_typos(norm_erp_text(raw_desc))

    campos: dict[str, str] = {}
    if template:
        for field in template.get("campos_obligatorios") or []:
            ftype = field.get("type")
            name = field.get("name")
            if not name:
                continue
            if ftype == "number":
                val = _extract_number(field, norm_desc)
            elif ftype == "select":
                val = _match_select(field, norm_desc)
            else:
                val = None
            if val:
                campos[name] = val

    return {
        "condicion": "OUTLET" if is_outlet else "PRIMERA",
        "sku_base": sku_base,
        "modelo": sku_base,
        "campos": campos,
        "typos": typos,
        "es_outlet": is_outlet,
    }
