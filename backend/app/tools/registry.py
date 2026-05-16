from __future__ import annotations

from typing import Any

ToolDef = dict[str, Any]

TOOLS: dict[str, ToolDef] = {
    "gpd": {
        "id": "gpd",
        "name": "Generar Planillas Diarias",
        "description": "Genera copias de las planillas diarias para cada sucursal en Google Drive.",
        "icon": "📋",
        "color": "#3B82F6",
        "script": "scripts/Generar Planillas Diarias/gpd.py",
        "runner": "legacy_subprocess",
        "fields": [],
        "stdin_template": [""],
    },
    "cc": {
        "id": "cc",
        "name": "Congelar Carpeta",
        "description": "Reemplaza fórmulas por valores fijos en todos los Google Sheets de una carpeta.",
        "icon": "🧊",
        "color": "#06B6D4",
        "script": "scripts/Congelar carpeta/cc.py",
        "runner": "legacy_subprocess",
        "dangerous": True,
        "fields": [
            {"name": "carpeta_url", "label": "Link o ID de la carpeta de Drive", "type": "text", "required": True, "placeholder": "https://drive.google.com/drive/folders/..."},
            {"name": "subcarpetas", "label": "Procesar subcarpetas", "type": "checkbox", "default": False},
            {"name": "hojas_ocultas", "label": "Incluir hojas ocultas", "type": "checkbox", "default": False},
            {"name": "modo_prueba", "label": "Modo prueba sin modificar archivos", "type": "checkbox", "default": True, "help": "Dejalo activado para revisar sin congelar."},
            {"name": "confirmacion_real", "label": "Confirmo que quiero modificar archivos reales si modo prueba está desactivado", "type": "checkbox", "default": False},
        ],
    },
    "cf": {
        "id": "cf",
        "name": "Comprobar Facturas",
        "description": "Cruza comprobantes ARCA contra planillas de ventas y colorea coincidencias.",
        "icon": "🧾",
        "color": "#10B981",
        "script": "scripts/Comprobar Facturas/cf.py",
        "runner": "legacy_subprocess",
        "stage_uploads": [{"field": "archivos_arca", "target": "scripts/Comprobar Facturas/arca"}],
        "fields": [
            {"name": "fecha", "label": "Fecha a procesar", "type": "date", "required": True},
            {"name": "planilla_url", "label": "URL de la planilla de ventas", "type": "text", "required": True},
            {"name": "archivos_arca", "label": "CSV de ARCA", "type": "multi_file", "required": False, "accept": ".csv"},
        ],
    },
    "cer": {
        "id": "cer",
        "name": "Limpiar Comprobantes",
        "description": "Procesa comprobantes emitidos y recibidos de ARCA con la lógica original y sube resultados a Drive.",
        "icon": "🗂️",
        "color": "#8B5CF6",
        "script": "scripts/Limpiar Comprobantes Emitidos y Recibidos/cer.py",
        "runner": "legacy_subprocess",
        "stage_uploads": [
            {"field": "archivos_mes_actual", "target": "scripts/Limpiar Comprobantes Emitidos y Recibidos/Comprobantes/actual"},
            {"field": "archivos_mes_pasado", "target": "scripts/Limpiar Comprobantes Emitidos y Recibidos/Comprobantes/mes_pasado"},
            {"field": "archivos_otro_periodo", "target": "scripts/Limpiar Comprobantes Emitidos y Recibidos/Comprobantes/otro_periodo"},
        ],
        "fields": [
            # ── Flujo principal ───────────────────────────────────────────────
            {"name": "archivos_mes_actual", "label": "Archivos MES ACTUAL", "type": "multi_file", "required": False, "validate_filename": "arca", "help": "Subí los emitidos y recibidos de GV y ABC correspondientes al mes actual. Obligatorio solo si procesás mes actual o automático desde el día de corte."},
            {"name": "archivos_mes_pasado", "label": "Archivos MES PASADO", "type": "multi_file", "required": False, "validate_filename": "arca", "help": "Subí acá los archivos del mes anterior completo. Necesario en automático del día 1 al 10 o si elegís mes actual + anterior."},
            {"name": "periodos", "label": "Períodos a procesar", "type": "select", "required": True, "default": "auto", "options": [
                {"label": "Automático: día 1 al 10 → anterior + actual; desde el 11 → solo actual", "value": "auto"},
                {"label": "Solo mes actual", "value": "actual"},
                {"label": "Mes actual + mes anterior", "value": "actual_y_anterior"},
                {"label": "Solo mes anterior", "value": "anterior"},
            ]},
            {"name": "fecha_referencia", "label": "Fecha de referencia", "type": "date", "required": False, "help": "Vacío = hoy. Sirve para decidir mes actual/anterior y nombrar el reporte."},
            {"name": "dia_corte_mes_anterior", "label": "Día de corte mes anterior", "type": "number", "required": False, "default": 11, "help": "Con 11: del día 1 al 10 procesa mes anterior + actual. Desde el 11 solo mes actual."},
            # ── Otro rango (colapsable) ───────────────────────────────────────
            {"type": "section", "name": "_otro_rango", "label": "Seleccionar otro rango", "collapsible": True, "default_open": False, "help": "Para procesar un período distinto al flujo mensual: año completo, año pasado o un rango libre."},
            {"name": "rango_tipo", "label": "Tipo de período", "type": "select", "section": "_otro_rango", "default": "anio_pasado", "options": [
                {"label": "Este año completo", "value": "anio_actual"},
                {"label": "Año pasado completo", "value": "anio_pasado"},
                {"label": "Rango personalizado", "value": "personalizado"},
            ]},
            {"name": "archivos_otro_periodo", "label": "Archivos del período", "type": "multi_file", "required": False, "section": "_otro_rango", "validate_filename": "arca", "help": "Subí los emitidos y recibidos correspondientes al rango elegido."},
            {"name": "fecha_desde_otro", "label": "Desde (solo rango personalizado)", "type": "date", "required": False, "section": "_otro_rango"},
            {"name": "fecha_hasta_otro", "label": "Hasta (solo rango personalizado)", "type": "date", "required": False, "section": "_otro_rango"},
        ],
        "stdin_template": [""],
    },
    "eb": {
        "id": "eb",
        "name": "Limpiar Extractos Bancarios",
        "description": "Normaliza extractos de Galicia/Supervielle y los sube a Google Sheets.",
        "icon": "🏦",
        "color": "#F59E0B",
        "script": "scripts/Limpiar Extractos Bancarios/eb.py",
        "runner": "legacy_subprocess",
        "dialog_directory_field": "archivos_extractos",
        "fields": [
            {"name": "archivos_extractos", "label": "Extractos bancarios", "type": "multi_file", "required": True, "accept": ".xlsx,.xls,.csv"},
        ],
        "stdin_template": [""],
    },
    "gg": {
        "id": "gg",
        "name": "Generar GFK",
        "description": "Genera el reporte GFK según rango de fechas.",
        "icon": "📊",
        "color": "#EF4444",
        "script": "scripts/Generar GFK/gg.py",
        "runner": "legacy_subprocess",
        "fields": [
            {"name": "fecha_inicio", "label": "Fecha inicio", "type": "date", "required": True},
            {"name": "fecha_fin", "label": "Fecha fin", "type": "date", "required": True},
        ],
    },
    "ncm": {
        "id": "ncm",
        "name": "Normalizar Carpeta Mensual",
        "description": "Normaliza productos de planillas diarias contra Productos PVP.",
        "icon": "📁",
        "color": "#EC4899",
        "script": "scripts/Normalizar Carpeta Mensual/ncm.py",
        "runner": "legacy_subprocess",
        "fields": [
            {"name": "origen_url", "label": "Carpeta origen con planillas diarias", "type": "text", "required": True},
            {"name": "master_url", "label": "Archivo Productos PVP", "type": "text", "required": True},
            {"name": "destino_url", "label": "Carpeta destino", "type": "text", "required": True},
            {"name": "titulo", "label": "Nombre del archivo de salida", "type": "text", "required": False, "placeholder": "Opcional"},
        ],
    },
    "ncmc": {
        "id": "ncmc",
        "name": "Normalizar Carpeta Mensual con Cantidades",
        "description": "Normaliza carpeta mensual incluyendo cantidades.",
        "icon": "📁+",
        "color": "#F97316",
        "script": "scripts/Normalizar Carpeta Mensual/ncmc.py",
        "runner": "legacy_subprocess",
        "fields": [
            {"name": "origen_url", "label": "Carpeta origen con planillas diarias", "type": "text", "required": True},
            {"name": "master_url", "label": "Archivo Productos PVP", "type": "text", "required": True},
            {"name": "destino_url", "label": "Carpeta destino", "type": "text", "required": True},
            {"name": "titulo", "label": "Nombre del archivo de salida", "type": "text", "required": False, "placeholder": "Opcional"},
        ],
    },
    "nvsc": {
        "id": "nvsc",
        "name": "Normalizar Ventas VS Costos",
        "description": "Normaliza y cruza archivos de ventas contra la planilla madre.",
        "icon": "📈",
        "color": "#14B8A6",
        "script": "scripts/Normalizar Ventas VS Costos/nvsc.py",
        "runner": "legacy_subprocess",
        "fields": [
            {"name": "alcance", "label": "Alcance", "type": "select", "required": True, "default": "todo", "options": [
                {"label": "Grupo Económico", "value": "todo"},
                {"label": "Caseros", "value": "caseros"},
                {"label": "Canning", "value": "canning"},
                {"label": "Norte", "value": "norte"},
                {"label": "Sur", "value": "sur"},
            ]},
            {"name": "cantidad", "label": "Cantidad de archivos", "type": "number", "required": False, "default": 4},
            {"name": "ventas_urls", "label": "Links de ventas, uno por línea", "type": "textarea", "required": True},
            {"name": "master_url", "label": "Planilla madre Productos PVP", "type": "text", "required": True},
            {"name": "destino_url", "label": "Carpeta destino", "type": "text", "required": True},
            {"name": "titulo", "label": "Nombre del archivo de salida", "type": "text", "required": False},
        ],
    },
    "vsc": {
        "id": "vsc",
        "name": "Ventas VS Costos",
        "description": "Sincroniza datos del libro diario hacia el libro mensual.",
        "icon": "💰",
        "color": "#84CC16",
        "script": "scripts/Ventas VS Costos/vsc.py",
        "runner": "legacy_subprocess",
        "fields": [
            {"name": "mensual_url", "label": "URL del libro mensual", "type": "text", "required": True},
            {"name": "diario_url", "label": "URL del libro diario/central", "type": "text", "required": True},
            {"name": "reset_control", "label": "Resetear control de fechas cargadas", "type": "checkbox", "default": False},
        ],
    },
}

TOOL_METADATA: dict[str, dict[str, Any]] = {
    "gpd": {"category": "Google Sheets", "tags": ["drive", "diario"], "recommended_device": "PC", "weight": "medio"},
    "cc": {"category": "Google Sheets", "tags": ["modifica archivos", "modo prueba"], "recommended_device": "PC", "weight": "pesado"},
    "cf": {"category": "ARCA / Comprobantes", "tags": ["facturas", "csv"], "recommended_device": "PC", "weight": "medio"},
    "cer": {"category": "ARCA / Comprobantes", "tags": ["emitidos", "recibidos", "mes actual/anterior"], "recommended_device": "PC", "weight": "medio"},
    "eb": {"category": "Bancos", "tags": ["extractos", "excel"], "recommended_device": "PC", "weight": "medio"},
    "gg": {"category": "Reportes", "tags": ["GFK", "fechas"], "recommended_device": "PC", "weight": "medio"},
    "ncm": {"category": "Ventas / Normalización", "tags": ["mensual", "productos"], "recommended_device": "PC", "weight": "pesado"},
    "ncmc": {"category": "Ventas / Normalización", "tags": ["cantidades", "mensual"], "recommended_device": "PC", "weight": "pesado"},
    "nvsc": {"category": "Ventas / Costos", "tags": ["costos", "normalización"], "recommended_device": "PC", "weight": "pesado"},
    "vsc": {"category": "Ventas / Costos", "tags": ["mensual", "sincronización"], "recommended_device": "PC", "weight": "medio"},
}


def list_tools() -> list[ToolDef]:
    return [public_tool(t) for t in TOOLS.values()]


def get_tool(tool_id: str) -> ToolDef | None:
    return TOOLS.get(tool_id)


def public_tool(tool: ToolDef) -> ToolDef:
    meta = TOOL_METADATA.get(tool["id"], {})
    return {
        "id": tool["id"],
        "name": tool["name"],
        "description": tool["description"],
        "icon": tool["icon"],
        "color": tool["color"],
        "dangerous": bool(tool.get("dangerous", False)),
        "fields": tool.get("fields", []),
        "category": meta.get("category", "General"),
        "tags": meta.get("tags", []),
        "recommended_device": meta.get("recommended_device", "PC"),
        "weight": meta.get("weight", "medio"),
    }
