"""Reader de los archivos GFK generados por la herramienta `gg.py`.

Estos viven en ``Drive/{año}/GFK/{MM}/{N}-Electro GV-ABC - GFK del DD#MM al DD#MM``.
Cada uno cubre un rango semanal (lunes-domingo típico). El PSI lee uno o
varios de estos archivos (todos los que tienen overlap con el rango pedido) y
los consolida para mostrar el reporte.

Estructura interna del Sheet GFK (plantilla):
  - Filas 1-3: header / título / metadata de la plantilla.
  - Fila 3: header oficial con los nombres de columna (SALIDA_HEADERS).
  - Fila 4 en adelante: datos (una fila por venta).

Columnas (espejo de gg.py · SALIDA_HEADERS):
  Fecha de venta | N°/Nombre de la sucursal | ID del item | EAN del item |
  Descripcion del item | Marca del item | Modelo del item (SKU limpio) |
  Familia | Tipo vendedor | Nombre / identificacion del vendedor | Moneda |
  Precio unitario GMV | Cantidad vendida

Nuestros ajustes desde el PSI se identifican porque el campo "Nombre /
identificacion del vendedor" contiene ``PSI-{adjustment_id}``.

Ver `docs/10-modulo-comercial-fase1.md` y `gg.py` para el formato completo.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from ..google_sheets import drive_service, quote_sheet_name, sheets_service
from ..operational_config import load_operational_config
from ..product_catalog import sku_key
from . import cache_get, cache_set
from .ventas_reader import _resolve_year_root_folder, NOMBRES_MES


# ──────────────────────────────────────────────────────────────────────────
# Constantes
# ──────────────────────────────────────────────────────────────────────────

# Columnas del GFK output (espejo del SALIDA_HEADERS de gg.py).
GFK_HEADERS = [
    "Fecha de venta",
    "N°/Nombre de la sucursal",
    "ID del item",
    "EAN del item",
    "Descripcion del item",
    "Marca del item",
    "Modelo del item",
    "Familia de productos (por ejemplo MDA, Telecom, etc)",
    "Tipo de vendedor (tienda oficial o categoria similar)",
    "Nombre / identificacion del vendedor",
    "Moneda de la venta (por ejemplo ARS)",
    "Precio unitario GMV",
    "Cantidad vendida",
]

# Regex para parsear el nombre de un archivo GFK:
#   "{N}-Electro GV-ABC - GFK del DD#MM al DD#MM"
GFK_FILENAME_RX = re.compile(
    r"^(\d+)\s*-\s*Electro.*?GFK\s+del\s+(\d{1,2})#(\d{1,2})\s+al\s+(\d{1,2})#(\d{1,2})",
    re.IGNORECASE,
)

# El GFK se nombra solo con DD#MM (sin año). Asumimos el año vigente al parsear.


# ──────────────────────────────────────────────────────────────────────────
# Helpers de parseo
# ──────────────────────────────────────────────────────────────────────────

def parse_gfk_filename(name: str, year: int) -> dict[str, Any] | None:
    """Extrae correlativo y fechas del nombre del archivo GFK.

    Retorna None si no matchea el patrón conocido.
    """
    m = GFK_FILENAME_RX.search(str(name or ""))
    if not m:
        return None
    n, di, mi, df, mf = m.groups()
    try:
        fecha_inicio = date(year, int(mi), int(di))
        fecha_fin = date(year, int(mf), int(df))
    except (TypeError, ValueError):
        return None
    return {
        "correlativo": int(n),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
    }


def _escape_drive_value(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


# ──────────────────────────────────────────────────────────────────────────
# Listado de GFK en Drive
# ──────────────────────────────────────────────────────────────────────────

def list_gfk_files_in_month(year: int, month: int) -> list[dict[str, Any]]:
    """Lista los archivos GFK de un mes específico en Drive.

    Estructura esperada: ``Drive/{año}/GFK/{MM}/``.
    Acepta también la variante alternativa ``Drive/{año}/GFK/{MM-Mes}/``.
    """
    drive = drive_service()
    year_root = _resolve_year_root_folder(drive, year)

    # Buscar carpeta GFK
    res = drive.files().list(
        q=(
            f"'{year_root}' in parents "
            "and name = 'GFK' "
            "and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false"
        ),
        fields="files(id, name)", pageSize=5,
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    gfks = res.get("files") or []
    if not gfks:
        return []
    gfk_folder_id = gfks[0]["id"]

    # Buscar subcarpeta del mes — probar varios formatos
    candidates = [f"{month:02d}", f"{month:02d}-{NOMBRES_MES[month]}", f"{month}"]
    month_folder_id: str | None = None
    for cand in candidates:
        r = drive.files().list(
            q=(
                f"'{gfk_folder_id}' in parents "
                f"and name = '{_escape_drive_value(cand)}' "
                "and mimeType = 'application/vnd.google-apps.folder' "
                "and trashed = false"
            ),
            fields="files(id, name)", pageSize=5,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        files = r.get("files") or []
        if files:
            month_folder_id = files[0]["id"]
            break

    if not month_folder_id:
        return []

    # Listar todos los Sheets de ese mes
    r = drive.files().list(
        q=(
            f"'{month_folder_id}' in parents "
            "and mimeType = 'application/vnd.google-apps.spreadsheet' "
            "and trashed = false"
        ),
        fields="files(id, name, modifiedTime)", pageSize=100,
        supportsAllDrives=True, includeItemsFromAllDrives=True,
        orderBy="modifiedTime desc",
    ).execute()
    files = r.get("files") or []

    parsed: list[dict[str, Any]] = []
    for f in files:
        info = parse_gfk_filename(f["name"], year)
        if not info:
            continue
        parsed.append({
            "file_id": f["id"],
            "file_name": f["name"],
            "modified_time": f.get("modifiedTime"),
            **info,
        })
    # Orden: por correlativo descendente
    parsed.sort(key=lambda x: x["correlativo"], reverse=True)
    return parsed


def list_gfk_files_covering_range(periodo_inicio: date, periodo_fin: date) -> list[dict[str, Any]]:
    """Devuelve todos los GFK que tienen overlap con el rango pedido.

    Para cada (year, month) que cae en el rango, listamos sus GFK y filtramos
    los que tengan overlap. Si hay duplicados por correlativo, nos quedamos
    con el más reciente (por modifiedTime).
    """
    if periodo_fin < periodo_inicio:
        return []

    # Recorrer cada (year, month) del rango
    seen_correlativos: dict[int, dict[str, Any]] = {}
    cur_y, cur_m = periodo_inicio.year, periodo_inicio.month
    while True:
        for f in list_gfk_files_in_month(cur_y, cur_m):
            # Filtrar por overlap
            if f["fecha_fin"] < periodo_inicio or f["fecha_inicio"] > periodo_fin:
                continue
            # Dedup por correlativo (quedarse con el más reciente)
            existing = seen_correlativos.get(f["correlativo"])
            if existing is None or (f.get("modified_time") or "") > (existing.get("modified_time") or ""):
                seen_correlativos[f["correlativo"]] = f
        if (cur_y, cur_m) == (periodo_fin.year, periodo_fin.month):
            break
        cur_m += 1
        if cur_m > 12:
            cur_m = 1
            cur_y += 1

    out = list(seen_correlativos.values())
    out.sort(key=lambda x: x["fecha_inicio"])
    return out


# ──────────────────────────────────────────────────────────────────────────
# Lectura del GFK
# ──────────────────────────────────────────────────────────────────────────

def _normalize_header(value: Any) -> str:
    import unicodedata
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", text)


def _find_header_row(rows: list[list[Any]]) -> int:
    """Detecta la fila que tiene el header oficial (busca 'fecha de venta')."""
    for i, row in enumerate(rows[:10]):
        for cell in row:
            if _normalize_header(cell) == "fecha de venta":
                return i
    return 2  # fallback: fila 3 (0-indexed = 2) según el formato de la plantilla


def _parse_fecha(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except (TypeError, ValueError):
            continue
    return None


def _parse_int(value: Any) -> int:
    if value is None:
        return 0
    text = str(value).strip().replace(".", "").replace(",", "")
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return 0


def read_gfk_file(file_id: str) -> list[dict[str, Any]]:
    """Lee un archivo GFK y devuelve list[dict] con keys canónicos.

    Keys: fecha, sucursal, descripcion, marca, sku, sku_norm, cantidad,
    nombre_vendedor, source_file_id, source_row.
    """
    cache_key = f"gfk:{file_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    service = sheets_service()
    # El GFK tiene una sola pestaña visible (renombrada al rango). Leemos la primera.
    try:
        meta = service.spreadsheets().get(spreadsheetId=file_id).execute()
        sheets = meta.get("sheets", [])
        if not sheets:
            cache_set(cache_key, [])
            return []
        sheet_name = sheets[0]["properties"]["title"]
    except Exception:
        cache_set(cache_key, [])
        return []

    rng = f"{quote_sheet_name(sheet_name)}!A1:Z50000"
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=file_id,
            range=rng,
            valueRenderOption="UNFORMATTED_VALUE",
            dateTimeRenderOption="FORMATTED_STRING",
        ).execute()
    except Exception:
        cache_set(cache_key, [])
        return []

    raw_rows = result.get("values") or []
    if not raw_rows:
        cache_set(cache_key, [])
        return []

    header_row_idx = _find_header_row(raw_rows)
    headers = [str(h or "").strip() for h in raw_rows[header_row_idx]]

    def find_col(canonical: str) -> int | None:
        target = _normalize_header(canonical)
        for i, h in enumerate(headers):
            if _normalize_header(h) == target:
                return i
        return None

    col_fecha     = find_col("Fecha de venta")
    col_sucursal  = find_col("N°/Nombre de la sucursal") or find_col("Nombre / identificacion del vendedor")
    col_desc      = find_col("Descripcion del item")
    col_marca     = find_col("Marca del item")
    col_modelo    = find_col("Modelo del item")
    col_vendedor  = find_col("Nombre / identificacion del vendedor")
    col_cantidad  = find_col("Cantidad vendida")

    if col_cantidad is None or col_modelo is None:
        cache_set(cache_key, [])
        return []

    out: list[dict[str, Any]] = []
    for i, raw in enumerate(raw_rows[header_row_idx + 1:], start=header_row_idx + 2):
        def cell(idx: int | None) -> Any:
            if idx is None or idx >= len(raw):
                return None
            return raw[idx]
        fecha = _parse_fecha(cell(col_fecha))
        if fecha is None:
            continue
        sku_raw = str(cell(col_modelo) or "").strip()
        if not sku_raw:
            continue
        out.append({
            "fecha": fecha,
            "sucursal_text": str(cell(col_sucursal) or "").strip(),
            "descripcion": str(cell(col_desc) or "").strip(),
            "marca": str(cell(col_marca) or "").strip(),
            "sku_raw": sku_raw,
            "sku_norm": sku_key(sku_raw),
            "cantidad": _parse_int(cell(col_cantidad)),
            "nombre_vendedor": str(cell(col_vendedor) or "").strip(),
            "source_file_id": file_id,
            "source_row": i,  # 1-indexed
        })

    cache_set(cache_key, out)
    return out


# ──────────────────────────────────────────────────────────────────────────
# API pública del reader
# ──────────────────────────────────────────────────────────────────────────

def load_gfk_sales_for_range(periodo_inicio: date, periodo_fin: date, force_refresh: bool = False) -> dict[str, Any]:
    """Carga ventas desde todos los GFK que cubren el rango.

    Returns:
        {
            "files_used": [{file_id, file_name, correlativo, fecha_inicio, fecha_fin}, ...],
            "rows": list[dict],            # filas individuales (filtradas al rango)
            "agg_by_sku": {sku_norm: total_cantidad},
            "by_sku_meta": {sku_norm: {first_sku_raw, first_descripcion, sucursales}},
            "no_gfk_available": bool,      # True si no hay ningún GFK que cubra el rango
        }
    """
    if periodo_fin < periodo_inicio:
        raise HTTPException(400, "periodo_fin no puede ser menor que periodo_inicio")

    files = list_gfk_files_covering_range(periodo_inicio, periodo_fin)
    if not files:
        return {
            "files_used": [],
            "rows": [],
            "agg_by_sku": {},
            "by_sku_meta": {},
            "no_gfk_available": True,
        }

    if force_refresh:
        for f in files:
            from . import cache_invalidate
            cache_invalidate(f"gfk:{f['file_id']}")

    all_rows: list[dict[str, Any]] = []
    for f in files:
        rows = read_gfk_file(f["file_id"])
        all_rows.extend(rows)

    # Filtrar por rango (los GFK pueden tener filas que se salen del overlap exacto)
    filtered = [r for r in all_rows if periodo_inicio <= r["fecha"] <= periodo_fin]

    agg: dict[str, int] = {}
    meta: dict[str, dict[str, Any]] = {}
    for r in filtered:
        sku = r.get("sku_norm") or ""
        if not sku:
            continue
        agg[sku] = agg.get(sku, 0) + int(r.get("cantidad") or 0)
        m = meta.setdefault(sku, {
            "first_sku_raw": r.get("sku_raw") or "",
            "first_descripcion": r.get("descripcion") or "",
            "sucursales": set(),
        })
        if r.get("sucursal_text"):
            m["sucursales"].add(r["sucursal_text"])

    for sku, m in meta.items():
        m["sucursales"] = sorted(list(m["sucursales"]))

    return {
        "files_used": [
            {
                "file_id": f["file_id"],
                "file_name": f["file_name"],
                "correlativo": f["correlativo"],
                "fecha_inicio": f["fecha_inicio"].strftime("%Y-%m-%d"),
                "fecha_fin": f["fecha_fin"].strftime("%Y-%m-%d"),
            }
            for f in files
        ],
        "rows": filtered,
        "agg_by_sku": agg,
        "by_sku_meta": meta,
        "no_gfk_available": False,
    }


def get_most_recent_gfk_for_range(periodo_inicio: date, periodo_fin: date) -> dict[str, Any] | None:
    """Devuelve el GFK más reciente que cubra el rango (por correlativo)."""
    files = list_gfk_files_covering_range(periodo_inicio, periodo_fin)
    if not files:
        return None
    return max(files, key=lambda x: x["correlativo"])
