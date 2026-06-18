"""Seed del catálogo: abreviaturas ERP + plantillas por rubro (desde docs/16).

Idempotente. Cubre los 54 rubros del análisis + ESTUFA/FRIGOBAR/SARTEN
(detectados fuera del mapa, agregados a su familia natural). Las opciones de
los selects son un punto de partida derivado del doc; se editan desde la
pantalla de configuración.

OMISIÓN POR PRODUCTO: el template marca `obligatorio` como sugerencia para el
formulario, pero el motor de generación omite limpio cualquier campo que el
producto deje vacío (una heladera sin freezer, una TV sin cierto dato, etc.).
La activación valida solo el núcleo (familia/rubro/marca/sku/condición +
descripciones + Puma), no cada campo del template — así se puede omitir lo que
no aplica sin que la app lo exija.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .db import db_session
from .models.catalog import CatalogAbbreviation, CatalogTemplate

# ── Diccionario de abreviaturas ERP (docs/16 §9 + prefijos de rubro) ────
ABBREVIATIONS: list[tuple[str, str]] = [
    # rubros
    ("AIRE ACONDICIONADO", "A/A"), ("LAVARROPAS", "LAV"), ("LAVASECARROPAS", "LAVASEC"),
    ("LAVAVAJILLAS", "LAVAVAJ"), ("SECARROPAS", "SEC"), ("HELADERA", "HEL"),
    ("FREEZER", "FREEZER"), ("TERMOTANQUE", "TERMO"), ("PURIFICADOR", "PURIF"),
    ("ASPIRADORA", "ASP"), ("CAFETERA", "CAF"), ("LICUADORA", "LIC"),
    ("PROCESADORA", "PROC"), ("MULTIPROCESADORA", "MULTIPROC"), ("SANDWICHERA", "SAND"),
    ("VENTILADOR", "VENT"), ("CONVECTOR", "CONV"), ("CALOVENTOR", "CALOV"),
    ("PARLANTE", "PARL"), ("BARRA DE SONIDO", "SOUNDBAR"), ("MICROONDAS", "MICRO"),
    ("MINICOMPONENTE", "MINICOMP"), ("BATIDORA", "BAT"), ("EXPRIMIDOR", "EXPRIM"),
    ("PICADORA", "PICAD"), ("TOSTADORA", "TOST"), ("VAPORIZADOR", "VAPOR"),
    ("QUITAPELUSAS", "QUITAPEL"), ("LIMPIADOR ZAP", "LIMP ZAP"), ("TORRE DE LAVADO", "TORRE LAV"),
    # función / tecnología / energía / sistema / etc.
    ("FRIO/CALOR", "F/C"), ("FRIO SOLO", "F/S"), ("INVERTER", "INV"), ("ON OFF", "ON/OFF"),
    ("DIGITAL", "DIG"), ("ELECTRICO", "ELEC"), ("ELECTRICA", "ELEC"), ("EMPOTRABLE", "EMPOT"),
    ("INDUCCION", "IND"), ("VITROCERAMICO", "VITRO"), ("NO FROST", "NF"), ("CICLICA", "CICL"),
    ("CARGA FRONTAL", "FRONT"), ("CARGA SUPERIOR", "SUP"), ("CONDENSACION", "COND"),
    ("GOOGLE TV", "GTV"), ("ANDROID TV", "ATV"), ("SMART TV", "SMART"), ("BLUETOOTH", "BT"),
    ("MULTIGAS", "MGAS"), ("GAS NATURAL", "GN"), ("GAS ENVASADO", "GL"), ("CON GRILL", "C/GRILL"),
    # colores / materiales
    ("BLANCO", "BCO"), ("BLANCA", "BCA"), ("NEGRO", "NGO"), ("NEGRA", "NGA"), ("GRIS", "GRIS"),
    ("ACERO", "AC"), ("ACERO INOXIDABLE", "INOX"), ("INOXIDABLE", "INOX"), ("SILVER", "SILVER"),
    # unidades
    ("CENTIMETROS", "CM"), ("LITROS", "L"), ("KILOS", "KG"), ("REVOLUCIONES", "RPM"),
    ("HORNALLAS", "H"), ("QUEMADORES", "Q"),
]

# ── Opciones / helpers de campos ────────────────────────────────────────
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


def C(oblig: bool = True) -> dict[str, Any]:
    return {"name": "color", "label": "Color/material", "type": "select", "obligatorio": oblig, "opciones": COLORES}


def N(name: str, label: str, sc: str, se: str, oblig: bool = True) -> dict[str, Any]:
    return {"name": name, "label": label, "type": "number", "obligatorio": oblig, "sufijo_comercial": sc, "sufijo_erp": se}


def POT(oblig: bool = True) -> dict[str, Any]:
    return N("potencia", "Potencia (W)", "W", "W", oblig)


def LIT(oblig: bool = True, label: str = "Capacidad (litros)") -> dict[str, Any]:
    return N("litros", label, "litros", "L", oblig)


def CAP(oblig: bool = True, label: str = "Capacidad") -> dict[str, Any]:
    return {"name": "capacidad", "label": label, "type": "text", "obligatorio": oblig}


def SEL(name: str, label: str, opciones: list[dict[str, str]], oblig: bool = True) -> dict[str, Any]:
    return {"name": name, "label": label, "type": "select", "obligatorio": oblig, "opciones": opciones}


def T(name: str, label: str, oblig: bool = True) -> dict[str, Any]:
    return {"name": name, "label": label, "type": "text", "obligatorio": oblig}


# opciones reutilizables
OPT_INVERTER = [{"valor": "inverter", "comercial": "inverter", "erp": "INV"}, {"valor": "on_off", "comercial": "", "erp": ""}]
OPT_GAS = [
    {"valor": "multigas", "comercial": "multigas", "erp": "MGAS"},
    {"valor": "gas_natural", "comercial": "gas natural", "erp": "GN"},
    {"valor": "gas_envasado", "comercial": "gas envasado", "erp": "GL"},
]
OPT_ENERGIA = [
    {"valor": "electrico", "comercial": "eléctrico", "erp": "ELEC"},
    {"valor": "gas", "comercial": "a gas", "erp": "GAS"},
]


def _t(familia: str, rubro: str, campos: list[dict], com: str, erp: str, sub: str) -> dict[str, Any]:
    return {
        "familia_app": familia, "rubro_app": rubro, "campos_obligatorios": campos,
        "formato_descripcion_comercial": com, "formato_descripcion_erp": erp, "formato_subrubro": sub,
    }


# ── Las 54 plantillas (docs/16 §7) + 3 fuera de mapa ────────────────────
TEMPLATES: list[dict[str, Any]] = [
    # ===== LÍNEA BLANCA =====
    _t("LÍNEA BLANCA", "HELADERA",
       [SEL("sistema", "Sistema", [{"valor": "no_frost", "comercial": "no frost", "erp": "NF"}, {"valor": "ciclica", "comercial": "cíclica", "erp": "CICL"}]),
        LIT(), C(), N("puertas", "Puertas", "puertas", "P", False)],
       "Heladera {marca} {modelo} {sistema} {litros} {color}", "HEL {marca} {modelo} {sistema} {litros} {color}", "{sistema} {litros}"),
    _t("LÍNEA BLANCA", "FREEZER",
       [SEL("formato", "Formato", [{"valor": "horizontal", "comercial": "horizontal", "erp": "HORIZ"}, {"valor": "vertical", "comercial": "vertical", "erp": "VERT"}]),
        LIT(), C()],
       "Freezer {marca} {modelo} {formato} {litros} {color}", "FREEZER {marca} {modelo} {formato} {litros} {color}", "{formato} {litros}"),
    _t("LÍNEA BLANCA", "EXHIBIDORA",
       [LIT(), N("puertas", "Puertas", "puertas", "P"), C(False)],
       "Heladera exhibidora {marca} {modelo} {litros} {puertas} {color}", "EXHIBIDORA {marca} {modelo} {litros} {puertas}", "{litros} {puertas}"),
    _t("LÍNEA BLANCA", "LAVARROPAS",
       [N("kg", "Carga (kg)", "kg", "KG"),
        SEL("tipo_carga", "Tipo de carga", [{"valor": "frontal", "comercial": "carga frontal", "erp": "FRONT"}, {"valor": "superior", "comercial": "carga superior", "erp": "SUP"}]),
        N("rpm", "RPM", "rpm", "RPM"), SEL("tecnologia", "Tecnología", OPT_INVERTER, False), C()],
       "Lavarropas {marca} {modelo} {kg} {tipo_carga} {rpm} {tecnologia} {color}", "LAV {marca} {modelo} {kg} {tipo_carga} {rpm} {tecnologia}", "{kg} {tipo_carga} {rpm}"),
    _t("LÍNEA BLANCA", "LAVASECARROPAS",
       [N("kg_lavado", "Kg lavado", "", ""), N("kg_secado", "Kg secado", "kg", "KG"), N("rpm", "RPM", "rpm", "RPM"),
        SEL("tecnologia", "Tecnología", OPT_INVERTER, False), C(False)],
       "Lavasecarropas {marca} {modelo} {kg_lavado}+{kg_secado} {rpm} {tecnologia} {color}", "LAVASEC {marca} {modelo} {kg_lavado}+{kg_secado} {rpm}", "{kg_lavado}+{kg_secado} {rpm}"),
    _t("LÍNEA BLANCA", "LAVAVAJILLAS",
       [N("cubiertos", "Cubiertos", "cubiertos", "CUB"), C(False)],
       "Lavavajillas {marca} {modelo} {cubiertos} {color}", "LAVAVAJ {marca} {modelo} {cubiertos} {color}", "{cubiertos}"),
    _t("LÍNEA BLANCA", "SECARROPAS",
       [N("kg", "Carga (kg)", "kg", "KG"),
        SEL("sistema", "Sistema", [{"valor": "calor", "comercial": "por calor", "erp": "CALOR"}, {"valor": "condensacion", "comercial": "condensación", "erp": "COND"}, {"valor": "bomba", "comercial": "bomba de calor", "erp": "BOMBA"}]),
        C(False)],
       "Secarropas {marca} {modelo} {kg} {sistema} {color}", "SEC {marca} {modelo} {kg} {sistema}", "{kg} {sistema}"),
    _t("LÍNEA BLANCA", "TORRE DE LAVADO",
       [N("kg_lavado", "Kg lavado", "", ""), N("kg_secado", "Kg secado", "kg", "KG"),
        SEL("tecnologia", "Tecnología", OPT_INVERTER, False), C(False)],
       "Torre de lavado {marca} {modelo} {kg_lavado}/{kg_secado} {tecnologia} {color}", "TORRE LAV {marca} {modelo} {kg_lavado}/{kg_secado} {color}", "{kg_lavado}/{kg_secado}"),
    _t("LÍNEA BLANCA", "FRIGOBAR",
       [LIT(), C()],
       "Frigobar {marca} {modelo} {litros} {color}", "FRIGOBAR {marca} {modelo} {litros} {color}", "{litros}"),
    # ===== COCINA =====
    _t("COCINA", "COCINA",
       [N("ancho_cm", "Ancho (cm)", "cm", "CM"), SEL("combustible", "Combustible", OPT_GAS), N("hornallas", "Hornallas", "hornallas", "H"), C()],
       "Cocina {marca} {modelo} {ancho_cm} {combustible} {hornallas} {color}", "COCINA {marca} {modelo} {ancho_cm} {hornallas} {color}", "{ancho_cm} {combustible} {hornallas}"),
    _t("COCINA", "ANAFE",
       [SEL("energia", "Energía", [{"valor": "electrico", "comercial": "eléctrico", "erp": "ELEC"}, {"valor": "gas", "comercial": "a gas", "erp": "GAS"}, {"valor": "induccion", "comercial": "inducción", "erp": "IND"}, {"valor": "vitroceramico", "comercial": "vitrocerámico", "erp": "VITRO"}]),
        N("zonas", "Hornallas/zonas", "zonas", "Z"), N("ancho_cm", "Ancho (cm)", "cm", "CM"), C(False)],
       "Anafe {marca} {modelo} {energia} {zonas} {ancho_cm} {color}", "ANAFE {marca} {modelo} {energia} {zonas} {ancho_cm}", "{energia} {zonas} {ancho_cm}"),
    _t("COCINA", "HORNO",
       [SEL("energia", "Energía", OPT_ENERGIA),
        SEL("instalacion", "Instalación", [{"valor": "empotrable", "comercial": "empotrable", "erp": "EMPOT"}, {"valor": "mesada", "comercial": "de mesada", "erp": "MESADA"}]),
        N("litros", "Capacidad (litros)", "litros", "L", False), C(False)],
       "Horno {marca} {modelo} {energia} {instalacion} {litros} {color}", "HORNO {marca} {modelo} {energia} {instalacion} {litros}", "{energia} {instalacion} {litros}"),
    _t("COCINA", "MICROONDAS",
       [LIT(), SEL("control", "Control", [{"valor": "digital", "comercial": "digital", "erp": "DIG"}, {"valor": "perilla", "comercial": "perilla", "erp": "PER"}]),
        SEL("grill", "Grill", [{"valor": "si", "comercial": "con grill", "erp": "C/GRILL"}, {"valor": "no", "comercial": "", "erp": ""}], False), C(False)],
       "Microondas {marca} {modelo} {litros} {control} {grill} {color}", "MICRO {marca} {modelo} {litros} {control} {grill}", "{litros} {grill}"),
    _t("COCINA", "CAMPANA",
       [N("ancho_cm", "Ancho (cm)", "cm", "CM"), C(False)],
       "Campana {marca} {modelo} {ancho_cm} {color}", "CAMPANA {marca} {modelo} {ancho_cm} {color}", "{ancho_cm}"),
    # ===== CLIMATIZACIÓN =====
    _t("CLIMATIZACIÓN", "AIRE ACONDICIONADO",
       [N("capacidad", "Capacidad (W/frigorías)", "W", "W"),
        SEL("funcion", "Función", [{"valor": "frio_calor", "comercial": "frío/calor", "erp": "F/C"}, {"valor": "frio_solo", "comercial": "frío solo", "erp": "F/S"}]),
        SEL("tecnologia", "Tecnología", [{"valor": "inverter", "comercial": "inverter", "erp": "INV"}, {"valor": "on_off", "comercial": "on/off", "erp": "ON/OFF"}]), C(False)],
       "Aire acondicionado {marca} {modelo} {capacidad} {funcion} {tecnologia} {color}", "A/A {marca} {modelo} {capacidad} {funcion} {tecnologia}", "{capacidad} {funcion} {tecnologia}"),
    _t("CLIMATIZACIÓN", "TERMOTANQUE",
       [LIT(), SEL("energia", "Energía", OPT_GAS + [{"valor": "electrico", "comercial": "eléctrico", "erp": "ELEC"}])],
       "Termotanque {marca} {modelo} {litros} {energia}", "TERMO {marca} {modelo} {litros} {energia}", "{litros} {energia}"),
    _t("CLIMATIZACIÓN", "CALEFON",
       [N("litros", "Litros/minuto", "litros", "L"), SEL("gas", "Tipo de gas", OPT_GAS), C(False)],
       "Calefón {marca} {modelo} {litros} {gas} {color}", "CALEFON {marca} {modelo} {litros} {gas}", "{litros} {gas}"),
    _t("CLIMATIZACIÓN", "CALOVENTOR",
       [POT(), T("formato", "Formato", False), C(False)],
       "Caloventor {marca} {modelo} {potencia} {formato} {color}", "CALOV {marca} {modelo} {potencia} {formato}", "{potencia} {formato}"),
    _t("CLIMATIZACIÓN", "CONVECTOR",
       [POT(), T("tipo", "Tipo (vidrio/aire)", False), C(False)],
       "Convector {marca} {modelo} {potencia} {tipo} {color}", "CONV {marca} {modelo} {potencia} {tipo}", "{potencia} {tipo}"),
    _t("CLIMATIZACIÓN", "PANEL",
       [POT(), C(False)],
       "Panel calefactor {marca} {modelo} {potencia} {color}", "PANEL {marca} {modelo} {potencia} {color}", "{potencia}"),
    _t("CLIMATIZACIÓN", "PURIFICADOR",
       [T("dato_clave", "Ancho/potencia", True), C(False)],
       "Purificador {marca} {modelo} {dato_clave} {color}", "PURIF {marca} {modelo} {dato_clave} {color}", "{dato_clave}"),
    _t("CLIMATIZACIÓN", "VENTILADOR",
       [SEL("tipo", "Tipo", [{"valor": "pie", "comercial": "de pie", "erp": "PIE"}, {"valor": "techo", "comercial": "de techo", "erp": "TECHO"}, {"valor": "industrial", "comercial": "industrial", "erp": "IND"}, {"valor": "mesa", "comercial": "de mesa", "erp": "MESA"}]),
        N("pulgadas", "Pulgadas", "\"", "\"", False), C(False)],
       "Ventilador {marca} {modelo} {tipo} {pulgadas} {color}", "VENT {marca} {modelo} {tipo} {pulgadas} {color}", "{tipo} {pulgadas}"),
    _t("CLIMATIZACIÓN", "ESTUFA",
       [SEL("energia", "Energía", OPT_GAS + [{"valor": "electrica", "comercial": "eléctrica", "erp": "ELEC"}]), POT(False), C(False)],
       "Estufa {marca} {modelo} {energia} {potencia} {color}", "ESTUFA {marca} {modelo} {energia} {potencia}", "{energia} {potencia}"),
    # ===== TV / AUDIO =====
    _t("TV / AUDIO", "TV",
       [N("pulgadas", "Pulgadas", "\"", "\""),
        SEL("resolucion", "Resolución", [{"valor": "hd", "comercial": "HD", "erp": "HD"}, {"valor": "fhd", "comercial": "Full HD", "erp": "FHD"}, {"valor": "4k", "comercial": "4K", "erp": "4K"}]),
        SEL("sistema_operativo", "Sistema operativo", [{"valor": "google_tv", "comercial": "Google TV", "erp": "GTV"}, {"valor": "android_tv", "comercial": "Android TV", "erp": "ATV"}, {"valor": "smart", "comercial": "Smart", "erp": "SMART"}])],
       "Smart TV {marca} {modelo} {pulgadas} {resolucion} {sistema_operativo}", "TV {marca} {modelo} {pulgadas} {resolucion} {sistema_operativo}", "{pulgadas} {resolucion}"),
    _t("TV / AUDIO", "MONITOR",
       [N("pulgadas", "Pulgadas", "\"", "\""), SEL("resolucion", "Resolución", [{"valor": "fhd", "comercial": "Full HD", "erp": "FHD"}, {"valor": "2k", "comercial": "2K", "erp": "2K"}, {"valor": "4k", "comercial": "4K", "erp": "4K"}], False),
        N("hz", "Frecuencia (Hz)", "Hz", "HZ", False)],
       "Monitor {marca} {modelo} {pulgadas} {resolucion} {hz}", "MONITOR {marca} {modelo} {pulgadas} {hz}", "{pulgadas} {resolucion}"),
    _t("TV / AUDIO", "PARLANTE",
       [T("tipo", "Tipo", False), POT(), C(False)],
       "Parlante {marca} {modelo} {tipo} {potencia} Bluetooth {color}", "PARL {marca} {modelo} {tipo} {potencia} BT", "{tipo} {potencia}"),
    _t("TV / AUDIO", "MINICOMPONENTE",
       [POT(), T("conectividad", "Conectividad", False)],
       "Minicomponente {marca} {modelo} {potencia} {conectividad}", "MINICOMP {marca} {modelo} {potencia} BT", "{potencia}"),
    _t("TV / AUDIO", "BARRA DE SONIDO",
       [T("canales", "Canales", False), POT()],
       "Barra de sonido {marca} {modelo} {canales} {potencia} Bluetooth", "SOUNDBAR {marca} {modelo} {canales} {potencia}", "{canales} {potencia}"),
    # ===== PEQUEÑOS ELECTROS =====
    _t("PEQUEÑOS ELECTROS", "ASPIRADORA",
       [SEL("tipo", "Tipo", [{"valor": "vertical", "comercial": "vertical", "erp": "VERT"}, {"valor": "robot", "comercial": "robot", "erp": "ROBOT"}, {"valor": "trineo", "comercial": "trineo", "erp": "TRINEO"}, {"valor": "mano", "comercial": "de mano", "erp": "MANO"}]),
        POT(), C(False)],
       "Aspiradora {marca} {modelo} {tipo} {potencia} {color}", "ASP {marca} {modelo} {tipo} {potencia}", "{tipo} {potencia}"),
    _t("PEQUEÑOS ELECTROS", "CAFETERA",
       [T("tipo", "Tipo", False), CAP(True, "Presión (bar)/capacidad"), C(False)],
       "Cafetera {marca} {modelo} {tipo} {capacidad} {color}", "CAF {marca} {modelo} {tipo} {capacidad}", "{tipo} {capacidad}"),
    _t("PEQUEÑOS ELECTROS", "FREIDORA",
       [SEL("tipo", "Tipo", [{"valor": "aire", "comercial": "de aire", "erp": "AIRE"}, {"valor": "aceite", "comercial": "de aceite", "erp": "ACEITE"}]),
        LIT(), POT(False), SEL("control", "Control", [{"valor": "digital", "comercial": "digital", "erp": "DIG"}, {"valor": "manual", "comercial": "manual", "erp": "MAN"}], False)],
       "Freidora {marca} {modelo} {tipo} {litros} {potencia} {control}", "FREIDORA {marca} {modelo} {tipo} {litros} {potencia}", "{tipo} {litros}"),
    _t("PEQUEÑOS ELECTROS", "LICUADORA",
       [POT(), N("litros", "Capacidad (litros)", "litros", "L", False), C(False)],
       "Licuadora {marca} {modelo} {potencia} {litros} {color}", "LIC {marca} {modelo} {potencia} {litros}", "{potencia} {litros}"),
    _t("PEQUEÑOS ELECTROS", "BATIDORA",
       [SEL("tipo", "Tipo", [{"valor": "mano", "comercial": "de mano", "erp": "MANO"}, {"valor": "mesa", "comercial": "de mesa", "erp": "MESA"}, {"valor": "planetaria", "comercial": "planetaria", "erp": "PLAN"}]),
        POT(), C(False)],
       "Batidora {marca} {modelo} {tipo} {potencia} {color}", "BAT {marca} {modelo} {tipo} {potencia}", "{tipo} {potencia}"),
    _t("PEQUEÑOS ELECTROS", "PAVA",
       [LIT(), T("material", "Material", False), C(False)],
       "Pava eléctrica {marca} {modelo} {litros} {material} {color}", "PAVA {marca} {modelo} {litros} {color}", "{litros} {material}"),
    _t("PEQUEÑOS ELECTROS", "TOSTADORA",
       [N("ranuras", "Ranuras", "ranuras", "R"), POT(False), C(False)],
       "Tostadora {marca} {modelo} {ranuras} {potencia} {color}", "TOST {marca} {modelo} {ranuras} {potencia}", "{ranuras}"),
    _t("PEQUEÑOS ELECTROS", "PLANCHA",
       [SEL("tipo", "Tipo", [{"valor": "vapor", "comercial": "a vapor", "erp": "VAPOR"}, {"valor": "seca", "comercial": "seca", "erp": "SECA"}]), POT(False), C(False)],
       "Plancha {marca} {modelo} {tipo} {potencia} {color}", "PLANCHA {marca} {modelo} {tipo} {potencia}", "{tipo}"),
    _t("PEQUEÑOS ELECTROS", "PROCESADORA",
       [POT(), N("litros", "Capacidad bowl (L)", "litros", "L", False), C(False)],
       "Procesadora {marca} {modelo} {potencia} {litros} {color}", "PROC {marca} {modelo} {potencia} {litros}", "{potencia} {litros}"),
    _t("PEQUEÑOS ELECTROS", "MULTIPROCESADORA",
       [POT(False), CAP(False), C(False)],
       "Multiprocesadora {marca} {modelo} {potencia} {capacidad} {color}", "MULTIPROC {marca} {modelo} {potencia}", "{potencia}"),
    _t("PEQUEÑOS ELECTROS", "PICADORA",
       [POT(), N("litros", "Capacidad (L)", "litros", "L", False), C(False)],
       "Picadora {marca} {modelo} {potencia} {litros} {color}", "PICAD {marca} {modelo} {potencia} {litros}", "{potencia}"),
    _t("PEQUEÑOS ELECTROS", "CHOPPER",
       [POT(), N("litros", "Capacidad (L)", "litros", "L", False), C(False)],
       "Mini chopper {marca} {modelo} {potencia} {litros} {color}", "CHOPPER {marca} {modelo} {potencia}", "{potencia}"),
    _t("PEQUEÑOS ELECTROS", "EXPRIMIDOR",
       [CAP(False), POT(False), C(False)],
       "Exprimidor {marca} {modelo} {capacidad} {potencia} {color}", "EXPRIM {marca} {modelo} {capacidad} {potencia}", "{capacidad}"),
    _t("PEQUEÑOS ELECTROS", "EXTRACTOR",
       [POT(), N("litros", "Capacidad (L)", "litros", "L", False), C(False)],
       "Extractor {marca} {modelo} {potencia} {litros} {color}", "EXTRACTOR {marca} {modelo} {potencia}", "{potencia}"),
    _t("PEQUEÑOS ELECTROS", "MIXER",
       [POT(), T("accesorios", "Accesorios", False)],
       "Mixer {marca} {modelo} {potencia} {accesorios}", "MIXER {marca} {modelo} {potencia}", "{potencia}"),
    _t("PEQUEÑOS ELECTROS", "MOLINO",
       [T("tipo", "Tipo (café/semillas)", False), CAP(False)],
       "Molino {marca} {modelo} {tipo} {capacidad}", "MOLINO {marca} {modelo} {tipo}", "{tipo}"),
    _t("PEQUEÑOS ELECTROS", "MOLINILLO",
       [T("tipo", "Tipo (café/semillas)", False), CAP(False)],
       "Molinillo {marca} {modelo} {tipo} {capacidad}", "MOLINILLO {marca} {modelo} {tipo}", "{tipo}"),
    _t("PEQUEÑOS ELECTROS", "ARROCERA",
       [CAP(True, "Capacidad"), POT(False), C(False)],
       "Arrocera {marca} {modelo} {capacidad} {color}", "ARROCERA {marca} {modelo} {capacidad}", "{capacidad}"),
    _t("PEQUEÑOS ELECTROS", "MULTIOLLA",
       [LIT(), POT(False), T("funciones", "Funciones", False)],
       "Multiolla {marca} {modelo} {litros} {funciones}", "MULTIOLLA {marca} {modelo} {litros}", "{litros}"),
    _t("PEQUEÑOS ELECTROS", "SANDWICHERA",
       [T("placas", "Placas/posiciones", False), POT(False), C(False)],
       "Sandwichera {marca} {modelo} {placas} {potencia} {color}", "SAND {marca} {modelo} {placas} {potencia}", "{placas}"),
    _t("PEQUEÑOS ELECTROS", "ESPUMADOR",
       [N("capacidad_ml", "Capacidad (ml)", "ml", "ML"), C(False)],
       "Espumador de leche {marca} {modelo} {capacidad_ml} {color}", "ESPUMADOR {marca} {modelo} {capacidad_ml}", "{capacidad_ml}"),
    _t("PEQUEÑOS ELECTROS", "JARRA",
       [LIT(), T("material", "Material", False), C(False)],
       "Jarra eléctrica {marca} {modelo} {litros} {material} {color}", "JARRA {marca} {modelo} {litros} {color}", "{litros}"),
    _t("PEQUEÑOS ELECTROS", "SOPERA",
       [CAP(True), POT(False), C(False)],
       "Sopera eléctrica {marca} {modelo} {capacidad} {color}", "SOPERA {marca} {modelo} {capacidad}", "{capacidad}"),
    _t("PEQUEÑOS ELECTROS", "VAPORIZADOR",
       [T("tipo", "Tipo", False), POT(False)],
       "Vaporizador {marca} {modelo} {tipo} {potencia}", "VAPOR {marca} {modelo} {tipo} {potencia}", "{tipo}"),
    _t("PEQUEÑOS ELECTROS", "YOGURTERA",
       [CAP(True), N("frascos", "Frascos", "frascos", "FR", False)],
       "Yogurtera {marca} {modelo} {capacidad} {frascos}", "YOGURTERA {marca} {modelo} {capacidad}", "{capacidad}"),
    _t("PEQUEÑOS ELECTROS", "QUITAPELUSAS",
       [T("tipo", "Tipo", False), C(False)],
       "Quitapelusas {marca} {modelo} eléctrico {color}", "QUITAPEL {marca} {modelo} ELEC", "{tipo}"),
    _t("PEQUEÑOS ELECTROS", "LIMPIADOR ZAP",
       [T("tipo", "Tipo", False)],
       "Limpiador de zapatillas {marca} {modelo} {tipo}", "LIMP ZAP {marca} {modelo}", "{tipo}"),
    _t("PEQUEÑOS ELECTROS", "CERVECERA",
       [LIT(), C(False)],
       "Cervecera {marca} {modelo} {litros} {color}", "CERVECERA {marca} {modelo} {litros}", "{litros}"),
    _t("PEQUEÑOS ELECTROS", "SARTEN",
       [N("diametro_cm", "Diámetro (cm)", "cm", "CM", False), T("material", "Material", False)],
       "Sartén eléctrico {marca} {modelo} {diametro_cm} {material}", "SARTEN {marca} {modelo} {diametro_cm}", "{diametro_cm}"),
]


def seed_catalog() -> dict[str, int]:
    """Carga abreviaturas y plantillas faltantes. Idempotente."""
    abbr_created = tpl_created = tpl_updated = 0
    with db_session() as session:
        existentes = {a.texto_original for a in session.scalars(select(CatalogAbbreviation)).all()}
        for largo, abrev in ABBREVIATIONS:
            if largo not in existentes:
                session.add(CatalogAbbreviation(texto_original=largo, abreviatura_erp=abrev, activo=True))
                abbr_created += 1
        for t in TEMPLATES:
            row = session.scalar(select(CatalogTemplate).where(
                CatalogTemplate.familia_app == t["familia_app"], CatalogTemplate.rubro_app == t["rubro_app"]))
            if row:
                row.campos_obligatorios = t["campos_obligatorios"]
                row.formato_descripcion_base = t["formato_descripcion_comercial"]
                row.formato_descripcion_comercial = t["formato_descripcion_comercial"]
                row.formato_descripcion_erp = t["formato_descripcion_erp"]
                row.formato_subrubro = t["formato_subrubro"]
                tpl_updated += 1
            else:
                session.add(CatalogTemplate(
                    familia_app=t["familia_app"], rubro_app=t["rubro_app"],
                    campos_obligatorios=t["campos_obligatorios"],
                    formato_descripcion_base=t["formato_descripcion_comercial"],
                    formato_descripcion_comercial=t["formato_descripcion_comercial"],
                    formato_descripcion_erp=t["formato_descripcion_erp"],
                    formato_subrubro=t["formato_subrubro"], activo=True))
                tpl_created += 1
        session.commit()
    return {"abreviaturas_creadas": abbr_created, "plantillas_creadas": tpl_created, "plantillas_actualizadas": tpl_updated}


def abbreviations_map() -> dict[str, str]:
    from .catalog_generator import norm_key
    out: dict[str, str] = {}
    with db_session() as session:
        for a in session.scalars(select(CatalogAbbreviation).where(CatalogAbbreviation.activo.is_(True))).all():
            out[norm_key(a.texto_original)] = a.abreviatura_erp
    return out
