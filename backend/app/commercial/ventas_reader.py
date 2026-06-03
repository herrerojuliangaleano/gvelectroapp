"""Reader del libro mensual de Ventas en Drive.

Encuentra el libro `Ventas Vs. Costos…` de cada mes que cae en el rango
solicitado, lee las hojas visibles ``Ventas GV Total``, ``Ventas ABC Canning``,
``Ventas ABC-Norte``, ``Ventas ABC-Sur`` y agrega las ventas por SKU.

Columnas esperadas (header en fila 1, con sinónimos manejados):
    fecha | tipo de venta | marca | tipo | descripcion | sku | cantidad

Output:
    {
        "ventas_agg": { sku_normalized: total_cantidad_en_rango },
        "ventas_raw": [{ sku_raw, sku_norm, descripcion_raw, fecha, sucursal,
                         cantidad, tipo_venta }, ...],
    }

Cache:
    Key 'ventas:{year}:{month}'
    TTL DEFAULT_TTL_SECONDS (15 min). Una entrada por mes (no por rango).
    El filtrado por rango se hace después.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from ..google_sheets import drive_service, quote_sheet_name, sheets_service
from ..operational_config import load_operational_config
from ..product_catalog import sku_key
from . import cache_get, cache_set


# ──────────────────────────────────────────────────────────────────────────
# Constantes (espejo de las que usa gg.py para máxima compatibilidad)
# ──────────────────────────────────────────────────────────────────────────

NOMBRES_MES = [
    "",  # placeholder para 1-indexing
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

HOJAS_POR_SUCURSAL = {
    "Ventas GV Total":     "CASEROS",
    "Ventas ABC Canning":  "CANNING",
    "Ventas ABC-Norte":    "NORTE",
    "Ventas ABC-Sur":      "SUR",
}

COLUMN_SYNONYMS = {
    "fecha": ["fecha", "fecha de venta", "fecha venta"],
    "tipo de venta": ["tipo de venta", "tipo venta", "canal", "modalidad"],
    "marca": ["marca"],
    "tipo": ["tipo"],
    "descripcion": ["descripcion", "descripción", "detalle", "producto"],
    "sku": ["sku", "codigo sku", "código sku", "cod sku", "codigo", "código"],
    "cantidad": ["cantidad", "cant", "cant vendida", "unidades"],
}


# ──────────────────────────────────────────────────────────────────────────
# Helpers locales
# ──────────────────────────────────────────────────────────────────────────

def _normalize_header(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", text)


def _find_column(headers: list[str], canonical: str) -> int | None:
    """Encuentra el índice de columna para un canónico (probando sinónimos)."""
    normalized = [_normalize_header(h) for h in headers]
    aliases = COLUMN_SYNONYMS.get(canonical, [canonical])
    for alias in aliases:
        target = _normalize_header(alias)
        for i, h in enumerate(normalized):
            if h == target:
                return i
    return None


def _parse_fecha(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except (TypeError, ValueError):
            continue
    return None


def _parse_int(value: Any) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    text = text.replace(".", "").replace(",", "")
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return 0


def _meses_entre(fecha_inicio: date, fecha_fin: date) -> list[tuple[int, int]]:
    """Lista de (year, month) que cubre el rango (inclusive)."""
    out: list[tuple[int, int]] = []
    cur = date(fecha_inicio.year, fecha_inicio.month, 1)
    end = date(fecha_fin.year, fecha_fin.month, 1)
    while cur <= end:
        out.append((cur.year, cur.month))
        nxt_m = cur.month + 1
        nxt_y = cur.year
        if nxt_m > 12:
            nxt_m = 1
            nxt_y += 1
        cur = date(nxt_y, nxt_m, 1)
    return out


# ──────────────────────────────────────────────────────────────────────────
# Resolución del libro mensual en Drive
# ──────────────────────────────────────────────────────────────────────────

def _year_folder_id() -> str:
    root = load_operational_config()
    commercial = root.get("commercial") if isinstance(root, dict) else None
    if not isinstance(commercial, dict):
        commercial = {}
    year_folder_id = str(commercial.get("year_folder_id") or "").strip()
    if not year_folder_id:
        raise HTTPException(
            status_code=500,
            detail=(
                "Falta configurar 'commercial.year_folder_id' en operational_config. "
                "Es el folder_id del año vigente en Drive (ej: '2026/')."
            ),
        )
    return year_folder_id


def _escape_drive_value(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def _buscar_subcarpeta(drive, parent_id: str, name: str) -> dict[str, Any] | None:
    q = (
        f"name = '{_escape_drive_value(name)}' "
        f"and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    res = drive.files().list(
        q=q, fields="files(id, name)", pageSize=10,
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    files = res.get("files") or []
    return files[0] if files else None


def _buscar_archivo_por_nombre_parcial(drive, folder_id: str, partial: str) -> dict[str, Any] | None:
    """Busca un archivo cuyo nombre contenga el texto (case-sensitive en Drive)."""
    q = (
        f"name contains '{_escape_drive_value(partial)}' "
        f"and '{folder_id}' in parents "
        "and trashed = false"
    )
    res = drive.files().list(
        q=q, fields="files(id, name, mimeType)", pageSize=20,
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    files = res.get("files") or []
    # Preferir Google Sheets nativos
    sheets = [f for f in files if f.get("mimeType") == "application/vnd.google-apps.spreadsheet"]
    return (sheets or files)[0] if (sheets or files) else None


def _resolve_year_root_folder(drive, year: int) -> str:
    """Resuelve la carpeta raíz del año.

    El config ``commercial.year_folder_id`` puede apuntar a:
    - La carpeta del año directamente (contiene 01-Enero/, 02-Febrero/, ...)
    - Una carpeta padre que contiene sub-carpetas '2025/', '2026/', etc.

    Si lo configurado contiene sub-carpetas tipo 'MM-Mes', usamos esa.
    Si no, buscamos una sub-carpeta con el año pedido como nombre.
    """
    configured = _year_folder_id()
    if month_folder_first_seen(drive, configured):
        # Tiene sub-carpetas tipo MM-Mes → ya estamos en la carpeta del año
        return configured
    # Buscar sub-carpeta con nombre = año (ej "2026")
    sub = _buscar_subcarpeta(drive, configured, str(year))
    if sub:
        return sub["id"]
    # Fallback: usar el configured tal cual (el siguiente paso fallará silencioso)
    return configured


def month_folder_first_seen(drive, parent_id: str) -> str | None:
    """Devuelve el primer nombre de sub-carpeta del padre que matchea 'MM-Mes', o None."""
    res = drive.files().list(
        q=f"'{parent_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields="files(id, name)", pageSize=20,
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    for f in res.get("files", []):
        name = str(f.get("name", ""))
        # Patrón MM-Mes (ej "01-Enero", "12-Diciembre")
        if len(name) >= 4 and name[:2].isdigit() and name[2] == "-":
            return name
    return None


def find_monthly_book_id(year: int, month: int) -> str | None:
    """Devuelve el file_id del libro mensual de (year, month), o None si no existe."""
    drive = drive_service()
    year_root = _resolve_year_root_folder(drive, year)
    mes_folder_name = f"{month:02d}-{NOMBRES_MES[month]}"
    folder = _buscar_subcarpeta(drive, year_root, mes_folder_name)
    if not folder:
        return None
    archivo = _buscar_archivo_por_nombre_parcial(drive, folder["id"], "Ventas Vs. Costos")
    return archivo["id"] if archivo else None


# ──────────────────────────────────────────────────────────────────────────
# Lectura de hojas del libro mensual
# ──────────────────────────────────────────────────────────────────────────

def _read_sheet_data(book_id: str, sheet_name: str) -> list[dict[str, Any]]:
    """Lee una hoja del libro y devuelve list[dict] con keys canónicos."""
    service = sheets_service()
    rng = f"{quote_sheet_name(sheet_name)}!A1:Z50000"
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=book_id,
            range=rng,
            valueRenderOption="UNFORMATTED_VALUE",
            dateTimeRenderOption="FORMATTED_STRING",
        ).execute()
    except Exception:
        # Hoja inexistente o sin permisos — devolver vacío en lugar de propagar
        return []
    rows = result.get("values", [])
    if not rows or len(rows) < 2:
        return []
    headers = [str(h or "").strip() for h in rows[0]]
    col_idx = {key: _find_column(headers, key) for key in COLUMN_SYNONYMS.keys()}
    out: list[dict[str, Any]] = []
    for raw in rows[1:]:
        def cell(canonical: str) -> Any:
            idx = col_idx.get(canonical)
            if idx is None or idx >= len(raw):
                return None
            return raw[idx]
        out.append({
            "fecha":         _parse_fecha(cell("fecha")),
            "tipo_venta":    str(cell("tipo de venta") or "").strip(),
            "marca":         str(cell("marca") or "").strip(),
            "tipo":          str(cell("tipo") or "").strip(),
            "descripcion":   str(cell("descripcion") or "").strip(),
            "sku_raw":       str(cell("sku") or "").strip(),
            "sku_norm":      sku_key(cell("sku")),
            "cantidad":      _parse_int(cell("cantidad")),
        })
    return out


def _load_month_raw(year: int, month: int, force_refresh: bool = False) -> list[dict[str, Any]]:
    """Carga TODAS las filas de TODAS las hojas (Ventas X Total) de un mes."""
    cache_key = f"ventas:{year}:{month:02d}"
    if not force_refresh:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached
    book_id = find_monthly_book_id(year, month)
    if not book_id:
        cache_set(cache_key, [])
        return []
    rows_all: list[dict[str, Any]] = []
    for sheet_name, sucursal in HOJAS_POR_SUCURSAL.items():
        rows = _read_sheet_data(book_id, sheet_name)
        for r in rows:
            r["sucursal"] = sucursal
            r["source_book"] = book_id
        rows_all.extend(rows)
    cache_set(cache_key, rows_all)
    return rows_all


# ──────────────────────────────────────────────────────────────────────────
# API pública del reader
# ──────────────────────────────────────────────────────────────────────────

def load_ventas(periodo_inicio: date, periodo_fin: date, force_refresh: bool = False) -> dict[str, Any]:
    """Carga las ventas del rango.

    Returns:
        dict con:
            - "ventas_raw": list[dict] cada fila con fecha/sucursal/sku_norm/cantidad/...
            - "ventas_agg": dict {sku_norm: total_cantidad}
            - "by_sku_meta": dict {sku_norm: {first_sku_raw, first_descripcion, sucursales}}
            - "months_used": list de (year, month) que se leyeron
    """
    if periodo_fin < periodo_inicio:
        raise HTTPException(400, "periodo_fin no puede ser menor que periodo_inicio")

    months = _meses_entre(periodo_inicio, periodo_fin)
    raw_all: list[dict[str, Any]] = []
    for (y, m) in months:
        raw_all.extend(_load_month_raw(y, m, force_refresh=force_refresh))

    # Filtrar por rango (la cache es por mes entero)
    filtered = [
        r for r in raw_all
        if r.get("fecha") and periodo_inicio <= r["fecha"] <= periodo_fin
    ]

    # Agregar por sku_norm
    ventas_agg: dict[str, int] = {}
    by_sku_meta: dict[str, dict[str, Any]] = {}
    for r in filtered:
        key = r.get("sku_norm") or ""
        if not key:
            continue
        ventas_agg[key] = ventas_agg.get(key, 0) + int(r.get("cantidad") or 0)
        meta = by_sku_meta.setdefault(key, {
            "first_sku_raw": r.get("sku_raw") or "",
            "first_descripcion": r.get("descripcion") or "",
            "sucursales": set(),
        })
        meta["sucursales"].add(r.get("sucursal") or "")

    # Set → list para serialización
    for key, meta in by_sku_meta.items():
        meta["sucursales"] = sorted([s for s in meta["sucursales"] if s])

    return {
        "ventas_raw": filtered,
        "ventas_agg": ventas_agg,
        "by_sku_meta": by_sku_meta,
        "months_used": months,
    }
