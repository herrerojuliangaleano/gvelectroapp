"""Motor de generación de descripciones del catálogo (módulo Maestro).

Genera, a partir de datos estructurados (familia/rubro + campos + marca/modelo
+ condición), la descripción comercial y la descripción ERP (máx 50). Lo
consumen el Alta guiada y la Normalización diaria.

Reglas (ver docs/16 §5-6 y docs/15):
- El usuario NO escribe descripción libre. Esta función la arma.
- Comercial: legible, con "(OUTLET)" si condicion=OUTLET.
- ERP: MAYÚSCULAS, sin tildes, sin dobles espacios, abreviaturas, SIN OUTLET,
  máx 50 con cascada de reducción.
- SKU comercial: sku_base, + " (O)" si OUTLET.

Estructura de un template (catalog_templates.campos_obligatorios = lista):
  {"name","label","type":"text|number|select","obligatorio":bool,
   "sufijo_comercial","sufijo_erp",            # para number (ej "litros"/"L")
   "opciones":[{"valor","comercial","erp"}]}   # para select

formato_descripcion_comercial / _erp usan placeholders {marca} {modelo} y
{<name>} de cada campo.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

ERP_MAX = 50


def strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def collapse_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def norm_erp_text(text: str) -> str:
    """MAYÚSCULAS, sin tildes, sin dobles espacios."""
    return collapse_spaces(strip_accents(text).upper())


def norm_key(text: str) -> str:
    """Clave para buscar en el diccionario de abreviaturas (sin tilde, upper, 1 espacio)."""
    return collapse_spaces(strip_accents(text).upper())


def apply_abbreviations(text: str, abbr_map: dict[str, str]) -> str:
    """Reemplaza palabras/frases largas por su abreviatura. abbr_map ya viene
    normalizado (clave norm_key → abreviatura). Aplica frases más largas
    primero para no romper multi-palabra (ej "NO FROST" antes que "FROST")."""
    if not abbr_map:
        return text
    out = " " + norm_erp_text(text) + " "
    for largo in sorted(abbr_map, key=len, reverse=True):
        if not largo:
            continue
        abrev = abbr_map[largo]
        # límites de palabra tolerantes (espacios); largo ya está normalizado.
        out = re.sub(rf"(?<=\s){re.escape(largo)}(?=\s)", abrev, out)
    return collapse_spaces(out)


def _field_comercial(field: dict[str, Any], value: Any) -> str:
    """Valor visible (comercial) de un campo según su valor cargado."""
    if value is None or str(value).strip() == "":
        return ""
    ftype = field.get("type", "text")
    if ftype == "select":
        for op in field.get("opciones", []):
            if norm_key(op.get("valor")) == norm_key(value) or norm_key(op.get("comercial")) == norm_key(value):
                return str(op.get("comercial") or op.get("valor") or "")
        return str(value)
    if ftype == "number":
        suf = field.get("sufijo_comercial", "")
        return f"{str(value).strip()} {suf}".strip() if suf else str(value).strip()
    return str(value).strip()


def _field_erp(field: dict[str, Any], value: Any) -> str:
    """Valor ERP (corto) de un campo según su valor cargado."""
    if value is None or str(value).strip() == "":
        return ""
    ftype = field.get("type", "text")
    if ftype == "select":
        for op in field.get("opciones", []):
            if norm_key(op.get("valor")) == norm_key(value) or norm_key(op.get("comercial")) == norm_key(value):
                return str(op.get("erp") or op.get("comercial") or op.get("valor") or "")
        return str(value)
    if ftype == "number":
        suf = field.get("sufijo_erp", "")
        # ERP pega la unidad sin espacio: 328L, 56CM, 1400RPM
        return f"{str(value).strip()}{suf}" if suf else str(value).strip()
    return str(value).strip()


def _render(formato: str, values: dict[str, str]) -> str:
    """Reemplaza {clave} por su valor; placeholders faltantes → vacío."""
    def repl(m: re.Match) -> str:
        return str(values.get(m.group(1), "")).strip()
    return collapse_spaces(re.sub(r"\{(\w+)\}", repl, formato or ""))


def generate(
    template: dict[str, Any],
    field_values: dict[str, Any],
    *,
    marca: str,
    modelo: str,
    sku_base: str,
    condicion: str,
    abbr_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Devuelve dict con sku_comercial, descripcion_base, descripcion_comercial,
    descripcion_erp, descripcion_erp_len, estado_erp, subrubro."""
    abbr_map = abbr_map or {}
    campos = template.get("campos_obligatorios") or []
    es_outlet = norm_key(condicion) == "OUTLET"

    # ── valores comercial / erp por campo ──────────────────────────────
    com_vals: dict[str, str] = {"marca": str(marca or "").strip(), "modelo": str(modelo or "").strip()}
    erp_vals: dict[str, str] = {"marca": str(marca or "").strip(), "modelo": str(modelo or "").strip()}
    for f in campos:
        name = f.get("name")
        if not name:
            continue
        com_vals[name] = _field_comercial(f, field_values.get(name))
        erp_vals[name] = _field_erp(f, field_values.get(name))

    # ── descripción base (comercial sin "(OUTLET)") ────────────────────
    descripcion_base = _render(template.get("formato_descripcion_comercial", ""), com_vals)
    # Primera letra mayúscula, resto como vino (legible).
    if descripcion_base:
        descripcion_base = descripcion_base[0].upper() + descripcion_base[1:]
    descripcion_comercial = descripcion_base + (" (OUTLET)" if es_outlet else "")

    # ── subrubro ───────────────────────────────────────────────────────
    subrubro = _render(template.get("formato_subrubro", ""), com_vals)

    # ── descripción ERP con cascada de 50 ──────────────────────────────
    erp_full = norm_erp_text(_render(template.get("formato_descripcion_erp", ""), erp_vals))
    estado_erp = "OK_ERP_50"
    erp = erp_full
    if len(erp) > ERP_MAX:
        # paso 1: abreviar con diccionario
        erp = apply_abbreviations(erp, abbr_map)
        estado_erp = "AJUSTADO_AUTOMATICO"
    if len(erp) > ERP_MAX:
        # paso 2: quitar campos opcionales y re-render
        erp_vals_oblig = dict(erp_vals)
        for f in campos:
            if not f.get("obligatorio", True) and f.get("name"):
                erp_vals_oblig[f["name"]] = ""
        erp = apply_abbreviations(norm_erp_text(_render(template.get("formato_descripcion_erp", ""), erp_vals_oblig)), abbr_map)
        estado_erp = "AJUSTADO_AUTOMATICO"
    if len(erp) > ERP_MAX:
        # paso 3: núcleo = rubro_abrev + marca + modelo + primer dato clave
        rubro_abrev = abbr_map.get(norm_key(template.get("rubro_app", "")), norm_erp_text(template.get("rubro_app", "")))
        dato_clave = ""
        for f in campos:
            if f.get("obligatorio", True) and f.get("name") and erp_vals.get(f["name"]):
                dato_clave = erp_vals[f["name"]]
                break
        erp = collapse_spaces(f"{rubro_abrev} {erp_vals['marca']} {erp_vals['modelo']} {dato_clave}")
        estado_erp = "AJUSTADO_AUTOMATICO"
    if len(erp) > ERP_MAX:
        erp = erp[:ERP_MAX]
        estado_erp = "REQUIERE_REVISION_ERP"

    sku_comercial = (str(sku_base or "").strip() + " (O)") if es_outlet else str(sku_base or "").strip()

    return {
        "sku_comercial": sku_comercial,
        "descripcion_base": descripcion_base,
        "descripcion_comercial": descripcion_comercial,
        "descripcion_erp": erp,
        "descripcion_erp_len": len(erp),
        "estado_erp": estado_erp,
        "subrubro": subrubro,
    }


# ── Validaciones (docs/16 §13) ──────────────────────────────────────────

def validate_for_activation(producto: dict[str, Any]) -> list[str]:
    """Errores que impiden ACTIVAR un producto. Lista vacía = OK.
    (No incluye chequeos de unicidad SKU/Puma — esos van contra la DB en el
    service.)"""
    errs: list[str] = []
    req = {
        "familia_app": "familia", "rubro_app": "rubro", "marca": "marca",
        "sku_base": "SKU base", "condicion": "condición",
        "descripcion_comercial": "descripción comercial", "descripcion_erp": "descripción ERP",
    }
    for campo, label in req.items():
        if not str(producto.get(campo) or "").strip():
            errs.append(f"Falta {label}.")
    erp = str(producto.get("descripcion_erp") or "")
    if len(erp) > ERP_MAX:
        errs.append(f"La descripción ERP supera {ERP_MAX} caracteres ({len(erp)}).")
    # Sin Puma no se activa (decisión 2026-06).
    if not str(producto.get("codigo_puma") or "").strip():
        errs.append("Falta código Puma (no se puede activar sin Puma).")
    # Reglas OUTLET.
    if norm_key(producto.get("condicion")) == "OUTLET":
        if not str(producto.get("sku_comercial") or "").strip().endswith("(O)"):
            errs.append("Producto OUTLET: el SKU comercial debe terminar en (O).")
        if "(OUTLET)" not in str(producto.get("descripcion_comercial") or "").upper():
            errs.append("Producto OUTLET: la descripción comercial debe incluir (OUTLET).")
        if "OUTLET" in norm_erp_text(producto.get("descripcion_erp")):
            errs.append("Producto OUTLET: la descripción ERP NO debe incluir OUTLET.")
    return errs
