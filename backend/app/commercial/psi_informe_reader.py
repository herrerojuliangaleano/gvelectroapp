"""Reader de los archivos INFORME PSI generados por `gg.py` (junto al GFK).

A diferencia del GFK (que informa el outlet como primera y con precio +10%), el
INFORME PSI trae la data CRUDA para planificación: outlet distinguido (columna
Condicion + "(O)" en el modelo) y PVP real sin margen. El PSI del app lee de acá.

Ubicación en Drive (carpeta FIJA, no cuelga del año):
  ``<PSI_INFORME_FOLDER_ID>/<MM-Mes AAAA>/INFORME PSI del DD#MM al DD#MM``
  ej: ``.../04-Abril 2026/INFORME PSI del 01#04 al 30#04``

Columnas (espejo de `gg.py:SALIDA_PSI_HEADERS`):
  Fecha de venta | Sucursal | Descripcion del item | Marca del item |
  Modelo del item (SKU, con "(O)" si outlet) | Condicion (PRIMERA/OUTLET) |
  Precio PVP | Cantidad vendida

Los ajustes del PSI se escriben a ESTA hoja (ver `adjustments_writer`) con una
columna oculta a la derecha (``PSI-{id}``) para poder revertirlos.

Devuelve la misma forma que `gfk_reader` para que el router pueda alternar la
fuente sin cambiar la lógica de conteo.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from ..google_sheets import drive_service, quote_sheet_name, sheets_service
from ..product_catalog import sku_key
from . import cache_get, cache_set
from .ventas_reader import NOMBRES_MES

# Carpeta destino de los INFORME PSI (misma que gg.py:PSI_FOLDER_ID).
PSI_INFORME_FOLDER_ID = "19EzczD80Bp_TDYaV0PnRLQdlDJ_3xwJI"

# Índice (0-based) de la columna oculta donde el writer deja la marca "PSI-{id}".
# No tiene header, así que el reader no la mapea; solo el revert la busca.
PSI_REF_COL_IDX = 8  # columna I (después de las 8 columnas de datos A..H)

# "INFORME PSI del DD#MM al DD#MM" (sin correlativo, a diferencia del GFK).
PSI_FILENAME_RX = re.compile(
    r"INFORME\s+PSI\s+del\s+(\d{1,2})#(\d{1,2})\s+al\s+(\d{1,2})#(\d{1,2})",
    re.IGNORECASE,
)


def parse_psi_filename(name: str, year: int) -> dict[str, Any] | None:
    m = PSI_FILENAME_RX.search(str(name or ""))
    if not m:
        return None
    di, mi, df, mf = m.groups()
    try:
        fecha_inicio = date(year, int(mi), int(di))
        fecha_fin = date(year, int(mf), int(df))
    except (TypeError, ValueError):
        return None
    return {"fecha_inicio": fecha_inicio, "fecha_fin": fecha_fin}


def _escape_drive_value(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


# ──────────────────────────────────────────────────────────────────────────
# Listado en Drive
# ──────────────────────────────────────────────────────────────────────────

def _month_folder_candidates(year: int, month: int) -> list[str]:
    """Nombres posibles de la subcarpeta del mes (formato de gg.py y variantes)."""
    nombre = NOMBRES_MES[month]
    return [
        f"{month:02d}-{nombre} {year}",   # "04-Abril 2026" (formato actual de gg.py)
        f"{month:02d}-{nombre}",          # sin año
        f"{month:02d} {year}",
        f"{month:02d}",
        f"{nombre} {year}",
    ]


def list_psi_files_in_month(year: int, month: int) -> list[dict[str, Any]]:
    """Lista los INFORME PSI de un mes en ``<FOLDER>/<MM-Mes AAAA>/``."""
    drive = drive_service()

    month_folder_id: str | None = None
    for cand in _month_folder_candidates(year, month):
        r = drive.files().list(
            q=(
                f"'{PSI_INFORME_FOLDER_ID}' in parents "
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
        info = parse_psi_filename(f["name"], year)
        if not info:
            continue
        parsed.append({
            "file_id": f["id"],
            "file_name": f["name"],
            "modified_time": f.get("modifiedTime"),
            **info,
        })
    parsed.sort(key=lambda x: (x["fecha_inicio"], x.get("modified_time") or ""), reverse=True)
    return parsed


def list_psi_files_covering_range(periodo_inicio: date, periodo_fin: date) -> list[dict[str, Any]]:
    """INFORME PSI con overlap con el rango. Sin correlativo: dedup por
    (fecha_inicio, fecha_fin) quedándose con el más reciente (modifiedTime)."""
    if periodo_fin < periodo_inicio:
        return []

    seen: dict[tuple[date, date], dict[str, Any]] = {}
    cur_y, cur_m = periodo_inicio.year, periodo_inicio.month
    while True:
        for f in list_psi_files_in_month(cur_y, cur_m):
            if f["fecha_fin"] < periodo_inicio or f["fecha_inicio"] > periodo_fin:
                continue
            key = (f["fecha_inicio"], f["fecha_fin"])
            existing = seen.get(key)
            if existing is None or (f.get("modified_time") or "") > (existing.get("modified_time") or ""):
                seen[key] = f
        if (cur_y, cur_m) == (periodo_fin.year, periodo_fin.month):
            break
        cur_m += 1
        if cur_m > 12:
            cur_m = 1
            cur_y += 1

    out = list(seen.values())
    out.sort(key=lambda x: x["fecha_inicio"])
    return out


# ──────────────────────────────────────────────────────────────────────────
# Lectura
# ──────────────────────────────────────────────────────────────────────────

def _normalize_header(value: Any) -> str:
    import unicodedata
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", text)


def _find_header_row(rows: list[list[Any]]) -> int:
    for i, row in enumerate(rows[:10]):
        for cell in row:
            if _normalize_header(cell) == "fecha de venta":
                return i
    return 0  # el INFORME PSI tiene el header en la fila 1


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


def _parse_float(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("$", "").replace(" ", "")
    # Formato AR: puntos de miles, coma decimal.
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def read_psi_informe_file(file_id: str) -> list[dict[str, Any]]:
    """Lee un INFORME PSI y devuelve list[dict] con las MISMAS keys que
    `gfk_reader.read_gfk_file` (+ ``condicion`` y ``precio``)."""
    cache_key = f"psi_informe:{file_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    service = sheets_service()
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

    col_fecha    = find_col("Fecha de venta")
    col_sucursal = find_col("Sucursal") or find_col("N°/Nombre de la sucursal")
    col_desc     = find_col("Descripcion del item")
    col_marca    = find_col("Marca del item")
    col_modelo   = find_col("Modelo del item")
    col_condicion = find_col("Condicion")
    col_precio   = find_col("Precio PVP") or find_col("Precio unitario GMV")
    col_cantidad = find_col("Cantidad vendida")

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
            "condicion": str(cell(col_condicion) or "").strip().upper(),
            "precio": _parse_float(cell(col_precio)),
            "cantidad": _parse_int(cell(col_cantidad)),
            "nombre_vendedor": "",
            "source_file_id": file_id,
            "source_row": i,
        })

    cache_set(cache_key, out)
    return out


# ──────────────────────────────────────────────────────────────────────────
# API pública (misma forma que gfk_reader)
# ──────────────────────────────────────────────────────────────────────────

def load_psi_sales_for_range(periodo_inicio: date, periodo_fin: date, force_refresh: bool = False) -> dict[str, Any]:
    """Igual firma/forma que `gfk_reader.load_gfk_sales_for_range`.

    Devuelve además ``source = "informe_psi"`` y ``no_informe_psi_available``.
    Si no hay ningún INFORME PSI que cubra el rango, ``rows`` viene vacío y la
    flag en True (el router cae al GFK viejo)."""
    if periodo_fin < periodo_inicio:
        raise HTTPException(400, "periodo_fin no puede ser menor que periodo_inicio")

    files = list_psi_files_covering_range(periodo_inicio, periodo_fin)
    if not files:
        return {
            "source": "informe_psi",
            "files_used": [],
            "rows": [],
            "agg_by_sku": {},
            "by_sku_meta": {},
            "no_gfk_available": True,
            "no_informe_psi_available": True,
        }

    if force_refresh:
        from . import cache_invalidate
        for f in files:
            cache_invalidate(f"psi_informe:{f['file_id']}")

    all_rows: list[dict[str, Any]] = []
    for f in files:
        all_rows.extend(read_psi_informe_file(f["file_id"]))

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
        "source": "informe_psi",
        "files_used": [
            {
                "file_id": f["file_id"],
                "file_name": f["file_name"],
                "correlativo": 0,
                "fecha_inicio": f["fecha_inicio"].strftime("%Y-%m-%d"),
                "fecha_fin": f["fecha_fin"].strftime("%Y-%m-%d"),
            }
            for f in files
        ],
        "rows": filtered,
        "agg_by_sku": agg,
        "by_sku_meta": meta,
        "no_gfk_available": False,
        "no_informe_psi_available": False,
    }


def get_most_recent_psi_for_range(periodo_inicio: date, periodo_fin: date) -> dict[str, Any] | None:
    """INFORME PSI más reciente (por modifiedTime) que cubra el rango."""
    files = list_psi_files_covering_range(periodo_inicio, periodo_fin)
    if not files:
        return None
    return max(files, key=lambda x: x.get("modified_time") or "")


def read_sucursales_del_informe(file_id: str) -> list[str]:
    """Sucursales distintas presentes en un INFORME PSI (para repartir ajustes
    al azar de forma plausible)."""
    rows = read_psi_informe_file(file_id)
    vistas: list[str] = []
    seen: set[str] = set()
    for r in rows:
        s = (r.get("sucursal_text") or "").strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            vistas.append(s)
    return vistas
