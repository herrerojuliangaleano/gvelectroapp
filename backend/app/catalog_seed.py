"""Seed del catálogo: abreviaturas ERP + plantillas por rubro (desde docs/16).

Idempotente: se puede correr varias veces. No pisa ediciones manuales de
abreviaturas existentes (solo agrega las que falten); las plantillas se
upsertean por (familia_app, rubro_app).

Cobertura inicial: el diccionario de abreviaturas completo + plantillas de los
rubros de mayor volumen (cubren el grueso de los 1219 productos). El resto de
los rubros se agregan desde la pantalla de configuración (editable).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .db import db_session
from .models.catalog import CatalogAbbreviation, CatalogTemplate

# ── Diccionario de abreviaturas ERP (docs/16 §9) ────────────────────────
ABBREVIATIONS: list[tuple[str, str]] = [
    ("AIRE ACONDICIONADO", "A/A"), ("LAVARROPAS", "LAV"), ("LAVASECARROPAS", "LAVASEC"),
    ("LAVAVAJILLAS", "LAVAVAJ"), ("SECARROPAS", "SEC"), ("HELADERA", "HEL"),
    ("FREEZER", "FREEZER"), ("TERMOTANQUE", "TERMO"), ("PURIFICADOR", "PURIF"),
    ("ASPIRADORA", "ASP"), ("CAFETERA", "CAF"), ("LICUADORA", "LIC"),
    ("PROCESADORA", "PROC"), ("SANDWICHERA", "SAND"), ("VENTILADOR", "VENT"),
    ("CONVECTOR", "CONV"), ("CALOVENTOR", "CALOV"), ("PARLANTE", "PARL"),
    ("BARRA DE SONIDO", "SOUNDBAR"), ("MICROONDAS", "MICRO"), ("EXHIBIDORA", "EXHIBIDORA"),
    ("TORRE DE LAVADO", "TORRE LAV"), ("MINICOMPONENTE", "MINICOMP"), ("MONITOR", "MONITOR"),
    ("FRIO/CALOR", "F/C"), ("FRIO SOLO", "F/S"), ("INVERTER", "INV"), ("ON OFF", "ON/OFF"),
    ("DIGITAL", "DIG"), ("ELECTRICO", "ELEC"), ("ELECTRICA", "ELEC"), ("EMPOTRABLE", "EMPOT"),
    ("INDUCCION", "IND"), ("VITROCERAMICO", "VITRO"), ("BLANCO", "BCO"), ("BLANCA", "BCA"),
    ("NEGRO", "NGO"), ("NEGRA", "NGA"), ("GRIS", "GRIS"), ("ACERO", "AC"),
    ("ACERO INOXIDABLE", "INOX"), ("INOXIDABLE", "INOX"), ("SILVER", "SILVER"),
    ("CARGA FRONTAL", "FRONT"), ("CARGA SUPERIOR", "SUP"), ("CONDENSACION", "COND"),
    ("NO FROST", "NF"), ("CICLICA", "CICL"), ("GOOGLE TV", "GTV"), ("ANDROID TV", "ATV"),
    ("SMART TV", "SMART"), ("BLUETOOTH", "BT"), ("CENTIMETROS", "CM"), ("LITROS", "L"),
    ("KILOS", "KG"), ("REVOLUCIONES", "RPM"), ("HORNALLAS", "H"), ("QUEMADORES", "Q"),
    ("MULTIGAS", "MGAS"), ("GAS NATURAL", "GN"), ("GAS ENVASADO", "GL"),
]

# ── Opciones reutilizables ──────────────────────────────────────────────
COLORES = [
    {"valor": "blanco", "comercial": "blanco", "erp": "BCO"},
    {"valor": "blanca", "comercial": "blanca", "erp": "BCA"},
    {"valor": "negro", "comercial": "negro", "erp": "NGO"},
    {"valor": "negra", "comercial": "negra", "erp": "NGA"},
    {"valor": "gris", "comercial": "gris", "erp": "GRIS"},
    {"valor": "inox", "comercial": "acero inoxidable", "erp": "INOX"},
    {"valor": "acero", "comercial": "acero", "erp": "AC"},
    {"valor": "silver", "comercial": "silver", "erp": "SILVER"},
]
SI_NO = [
    {"valor": "si", "comercial": "", "erp": ""},
    {"valor": "no", "comercial": "", "erp": ""},
]


def _color(obligatorio: bool = True) -> dict[str, Any]:
    return {"name": "color", "label": "Color/material", "type": "select", "obligatorio": obligatorio, "opciones": COLORES}


# ── Plantillas por rubro (docs/16 §7-8) — rubros de mayor volumen ───────
# Cada template: familia_app, rubro_app, campos_obligatorios (lista de campos),
# formato_descripcion_comercial, formato_descripcion_erp, formato_subrubro.
TEMPLATES: list[dict[str, Any]] = [
    {
        "familia_app": "LÍNEA BLANCA", "rubro_app": "HELADERA",
        "campos_obligatorios": [
            {"name": "sistema", "label": "Sistema", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "no_frost", "comercial": "no frost", "erp": "NF"},
                {"valor": "ciclica", "comercial": "cíclica", "erp": "CICL"}]},
            {"name": "litros", "label": "Capacidad (litros)", "type": "number", "obligatorio": True, "sufijo_comercial": "litros", "sufijo_erp": "L"},
            _color(True),
            {"name": "puertas", "label": "Puertas", "type": "number", "obligatorio": False, "sufijo_comercial": "puertas", "sufijo_erp": "P"},
        ],
        "formato_descripcion_comercial": "Heladera {marca} {modelo} {sistema} {litros} {color}",
        "formato_descripcion_erp": "HEL {marca} {modelo} {sistema} {litros} {color}",
        "formato_subrubro": "{sistema} {litros}",
    },
    {
        "familia_app": "LÍNEA BLANCA", "rubro_app": "LAVARROPAS",
        "campos_obligatorios": [
            {"name": "kg", "label": "Carga (kg)", "type": "number", "obligatorio": True, "sufijo_comercial": "kg", "sufijo_erp": "KG"},
            {"name": "tipo_carga", "label": "Tipo de carga", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "frontal", "comercial": "carga frontal", "erp": "FRONT"},
                {"valor": "superior", "comercial": "carga superior", "erp": "SUP"}]},
            {"name": "rpm", "label": "RPM", "type": "number", "obligatorio": True, "sufijo_comercial": "rpm", "sufijo_erp": "RPM"},
            {"name": "tecnologia", "label": "Tecnología", "type": "select", "obligatorio": False, "opciones": [
                {"valor": "inverter", "comercial": "inverter", "erp": "INV"},
                {"valor": "on_off", "comercial": "", "erp": ""}]},
            _color(True),
        ],
        "formato_descripcion_comercial": "Lavarropas {marca} {modelo} {kg} {tipo_carga} {rpm} {tecnologia} {color}",
        "formato_descripcion_erp": "LAV {marca} {modelo} {kg} {tipo_carga} {rpm} {tecnologia}",
        "formato_subrubro": "{kg} {tipo_carga} {rpm}",
    },
    {
        "familia_app": "TV / AUDIO", "rubro_app": "TV",
        "campos_obligatorios": [
            {"name": "pulgadas", "label": "Pulgadas", "type": "number", "obligatorio": True, "sufijo_comercial": "\"", "sufijo_erp": "\""},
            {"name": "resolucion", "label": "Resolución", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "hd", "comercial": "HD", "erp": "HD"},
                {"valor": "fhd", "comercial": "Full HD", "erp": "FHD"},
                {"valor": "4k", "comercial": "4K", "erp": "4K"}]},
            {"name": "sistema_operativo", "label": "Sistema operativo", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "google_tv", "comercial": "Google TV", "erp": "GTV"},
                {"valor": "android_tv", "comercial": "Android TV", "erp": "ATV"},
                {"valor": "smart", "comercial": "Smart", "erp": "SMART"}]},
        ],
        "formato_descripcion_comercial": "Smart TV {marca} {modelo} {pulgadas} {resolucion} {sistema_operativo}",
        "formato_descripcion_erp": "TV {marca} {modelo} {pulgadas} {resolucion} {sistema_operativo}",
        "formato_subrubro": "{pulgadas} {resolucion}",
    },
    {
        "familia_app": "CLIMATIZACIÓN", "rubro_app": "AIRE ACONDICIONADO",
        "campos_obligatorios": [
            {"name": "capacidad", "label": "Capacidad (W/frigorías)", "type": "number", "obligatorio": True, "sufijo_comercial": "W", "sufijo_erp": "W"},
            {"name": "funcion", "label": "Función", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "frio_calor", "comercial": "frío/calor", "erp": "F/C"},
                {"valor": "frio_solo", "comercial": "frío solo", "erp": "F/S"}]},
            {"name": "tecnologia", "label": "Tecnología", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "inverter", "comercial": "inverter", "erp": "INV"},
                {"valor": "on_off", "comercial": "on/off", "erp": "ON/OFF"}]},
            _color(False),
        ],
        "formato_descripcion_comercial": "Aire acondicionado {marca} {modelo} {capacidad} {funcion} {tecnologia} {color}",
        "formato_descripcion_erp": "A/A {marca} {modelo} {capacidad} {funcion} {tecnologia}",
        "formato_subrubro": "{capacidad} {funcion} {tecnologia}",
    },
    {
        "familia_app": "COCINA", "rubro_app": "MICROONDAS",
        "campos_obligatorios": [
            {"name": "litros", "label": "Capacidad (litros)", "type": "number", "obligatorio": True, "sufijo_comercial": "litros", "sufijo_erp": "L"},
            {"name": "control", "label": "Control", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "digital", "comercial": "digital", "erp": "DIG"},
                {"valor": "perilla", "comercial": "perilla", "erp": "PER"}]},
            {"name": "grill", "label": "Grill", "type": "select", "obligatorio": False, "opciones": [
                {"valor": "si", "comercial": "con grill", "erp": "C/GRILL"},
                {"valor": "no", "comercial": "", "erp": ""}]},
            _color(False),
        ],
        "formato_descripcion_comercial": "Microondas {marca} {modelo} {litros} {control} {grill} {color}",
        "formato_descripcion_erp": "MICRO {marca} {modelo} {litros} {control} {grill}",
        "formato_subrubro": "{litros} {grill}",
    },
    {
        "familia_app": "COCINA", "rubro_app": "COCINA",
        "campos_obligatorios": [
            {"name": "ancho_cm", "label": "Ancho (cm)", "type": "number", "obligatorio": True, "sufijo_comercial": "cm", "sufijo_erp": "CM"},
            {"name": "combustible", "label": "Combustible", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "multigas", "comercial": "multigas", "erp": "MGAS"},
                {"valor": "gas_natural", "comercial": "gas natural", "erp": "GN"},
                {"valor": "gas_envasado", "comercial": "gas envasado", "erp": "GL"}]},
            {"name": "hornallas", "label": "Hornallas", "type": "number", "obligatorio": True, "sufijo_comercial": "hornallas", "sufijo_erp": "H"},
            _color(True),
        ],
        "formato_descripcion_comercial": "Cocina {marca} {modelo} {ancho_cm} {combustible} {hornallas} {color}",
        "formato_descripcion_erp": "COCINA {marca} {modelo} {ancho_cm} {hornallas} {color}",
        "formato_subrubro": "{ancho_cm} {combustible} {hornallas}",
    },
    {
        "familia_app": "LÍNEA BLANCA", "rubro_app": "FREEZER",
        "campos_obligatorios": [
            {"name": "formato", "label": "Formato", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "horizontal", "comercial": "horizontal", "erp": "HORIZ"},
                {"valor": "vertical", "comercial": "vertical", "erp": "VERT"}]},
            {"name": "litros", "label": "Capacidad (litros)", "type": "number", "obligatorio": True, "sufijo_comercial": "litros", "sufijo_erp": "L"},
            _color(True),
        ],
        "formato_descripcion_comercial": "Freezer {marca} {modelo} {formato} {litros} {color}",
        "formato_descripcion_erp": "FREEZER {marca} {modelo} {formato} {litros} {color}",
        "formato_subrubro": "{formato} {litros}",
    },
    {
        "familia_app": "LÍNEA BLANCA", "rubro_app": "LAVASECARROPAS",
        "campos_obligatorios": [
            {"name": "kg_lavado", "label": "Kg lavado", "type": "number", "obligatorio": True, "sufijo_comercial": "", "sufijo_erp": ""},
            {"name": "kg_secado", "label": "Kg secado", "type": "number", "obligatorio": True, "sufijo_comercial": "kg", "sufijo_erp": "KG"},
            {"name": "rpm", "label": "RPM", "type": "number", "obligatorio": True, "sufijo_comercial": "rpm", "sufijo_erp": "RPM"},
            {"name": "tecnologia", "label": "Tecnología", "type": "select", "obligatorio": False, "opciones": [
                {"valor": "inverter", "comercial": "inverter", "erp": "INV"}]},
            _color(False),
        ],
        # nota: kg_lavado+kg_secado se muestran juntos en el patrón ("10+6 kg")
        "formato_descripcion_comercial": "Lavasecarropas {marca} {modelo} {kg_lavado}+{kg_secado} {rpm} {tecnologia} {color}",
        "formato_descripcion_erp": "LAVASEC {marca} {modelo} {kg_lavado}+{kg_secado} {rpm}",
        "formato_subrubro": "{kg_lavado}+{kg_secado} {rpm}",
    },
    {
        "familia_app": "COCINA", "rubro_app": "ANAFE",
        "campos_obligatorios": [
            {"name": "energia", "label": "Energía", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "electrico", "comercial": "eléctrico", "erp": "ELEC"},
                {"valor": "gas", "comercial": "a gas", "erp": "GAS"},
                {"valor": "induccion", "comercial": "inducción", "erp": "IND"},
                {"valor": "vitroceramico", "comercial": "vitrocerámico", "erp": "VITRO"}]},
            {"name": "zonas", "label": "Hornallas/zonas", "type": "number", "obligatorio": True, "sufijo_comercial": "zonas", "sufijo_erp": "Z"},
            {"name": "ancho_cm", "label": "Ancho (cm)", "type": "number", "obligatorio": True, "sufijo_comercial": "cm", "sufijo_erp": "CM"},
            _color(False),
        ],
        "formato_descripcion_comercial": "Anafe {marca} {modelo} {energia} {zonas} {ancho_cm} {color}",
        "formato_descripcion_erp": "ANAFE {marca} {modelo} {energia} {zonas} {ancho_cm}",
        "formato_subrubro": "{energia} {zonas} {ancho_cm}",
    },
    {
        "familia_app": "CLIMATIZACIÓN", "rubro_app": "TERMOTANQUE",
        "campos_obligatorios": [
            {"name": "litros", "label": "Capacidad (litros)", "type": "number", "obligatorio": True, "sufijo_comercial": "litros", "sufijo_erp": "L"},
            {"name": "energia", "label": "Energía", "type": "select", "obligatorio": True, "opciones": [
                {"valor": "gas_natural", "comercial": "gas natural", "erp": "GN"},
                {"valor": "gas_envasado", "comercial": "gas envasado", "erp": "GL"},
                {"valor": "electrico", "comercial": "eléctrico", "erp": "ELEC"}]},
        ],
        "formato_descripcion_comercial": "Termotanque {marca} {modelo} {litros} {energia}",
        "formato_descripcion_erp": "TERMO {marca} {modelo} {litros} {energia}",
        "formato_subrubro": "{litros} {energia}",
    },
]


def seed_catalog() -> dict[str, int]:
    """Carga abreviaturas y plantillas faltantes. Idempotente.
    Devuelve conteos de lo creado/actualizado."""
    abbr_created = tpl_created = tpl_updated = 0
    with db_session() as session:
        # ── Abreviaturas: agregar las que falten (no pisar existentes) ──
        existentes = {a.texto_original for a in session.scalars(select(CatalogAbbreviation)).all()}
        for largo, abrev in ABBREVIATIONS:
            if largo not in existentes:
                session.add(CatalogAbbreviation(texto_original=largo, abreviatura_erp=abrev, activo=True))
                abbr_created += 1
        # ── Plantillas: upsert por (familia, rubro) ────────────────────
        for t in TEMPLATES:
            row = session.scalar(
                select(CatalogTemplate).where(
                    CatalogTemplate.familia_app == t["familia_app"],
                    CatalogTemplate.rubro_app == t["rubro_app"],
                )
            )
            if row:
                row.campos_obligatorios = t["campos_obligatorios"]
                row.formato_descripcion_base = t.get("formato_descripcion_base", t["formato_descripcion_comercial"])
                row.formato_descripcion_comercial = t["formato_descripcion_comercial"]
                row.formato_descripcion_erp = t["formato_descripcion_erp"]
                row.formato_subrubro = t["formato_subrubro"]
                tpl_updated += 1
            else:
                session.add(CatalogTemplate(
                    familia_app=t["familia_app"], rubro_app=t["rubro_app"],
                    campos_obligatorios=t["campos_obligatorios"],
                    formato_descripcion_base=t.get("formato_descripcion_base", t["formato_descripcion_comercial"]),
                    formato_descripcion_comercial=t["formato_descripcion_comercial"],
                    formato_descripcion_erp=t["formato_descripcion_erp"],
                    formato_subrubro=t["formato_subrubro"],
                    activo=True,
                ))
                tpl_created += 1
        session.commit()
    return {"abreviaturas_creadas": abbr_created, "plantillas_creadas": tpl_created, "plantillas_actualizadas": tpl_updated}


def abbreviations_map() -> dict[str, str]:
    """Mapa normalizado (clave norm_key → abreviatura) para el generador."""
    from .catalog_generator import norm_key
    out: dict[str, str] = {}
    with db_session() as session:
        for a in session.scalars(select(CatalogAbbreviation).where(CatalogAbbreviation.activo.is_(True))).all():
            out[norm_key(a.texto_original)] = a.abreviatura_erp
    return out
