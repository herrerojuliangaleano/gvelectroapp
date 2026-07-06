"""Escritor de ajustes PSI al INFORME PSI (la "hoja madre" del PSI).

Los ajustes de venta del gerente (+N unidades) se escriben al **INFORME PSI**
que cubre la fecha del ajuste — no al GFK. La fila se agrega con **día y
sucursal al azar dentro del rango** del archivo (misma lógica que el generador
de exámenes), para que quede como una venta real distribuida.

Formato de la fila escrita (columnas A..H del INFORME PSI, ver
`gg.py:SALIDA_PSI_HEADERS`) + una columna oculta I con la marca de revert:

  A Fecha de venta        DD/MM/YYYY (día al azar del rango)
  B Sucursal              (sucursal al azar de las presentes)
  C Descripcion del item  {descripcion}
  D Marca del item        {marca}
  E Modelo del item       {sku}  (con "(O)" si es outlet)
  F Condicion             PRIMERA | OUTLET
  G Precio PVP            {precio_unitario}  (sin margen)
  H Cantidad vendida      {cantidad_delta}
  I (sin header)          PSI-{adjustment_id}   ← marca oculta para revert

El revert busca la fila por la columna I (``PSI-{id}``) y la limpia. Si el
INFORME PSI se regeneró y la fila ya no existe, el ajuste se marca reverted
igual (fail-soft).
"""
from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException

from ..google_sheets import quote_sheet_name, sheets_service
from .psi_informe_reader import (
    PSI_REF_COL_IDX,
    get_most_recent_psi_for_range,
    parse_psi_filename,
    read_sucursales_del_informe,
)

AJUSTE_REF_PREFIX = "PSI-"
# Sucursales de fallback si el INFORME PSI no tuviera filas de dónde tomarlas.
SUCURSALES_FALLBACK = ["CASEROS-LOCAL", "CANNING-LOCAL", "NORCENTER-LOCAL", "LANUS-LOCAL"]


def _get_sheet_name(book_id: str) -> str:
    service = sheets_service()
    meta = service.spreadsheets().get(spreadsheetId=book_id).execute()
    sheets = meta.get("sheets", [])
    if not sheets:
        raise HTTPException(502, "El INFORME PSI no tiene hojas")
    return sheets[0]["properties"]["title"]


def _rango_del_archivo(target: dict[str, Any]) -> tuple[date, date] | None:
    """Rango (inicio, fin) del INFORME PSI destino, para repartir la fecha."""
    fi, ff = target.get("fecha_inicio"), target.get("fecha_fin")
    if isinstance(fi, date) and isinstance(ff, date):
        return fi, ff
    info = parse_psi_filename(target.get("file_name") or "", (fi or date.today()).year if isinstance(fi, date) else date.today().year)
    if info:
        return info["fecha_inicio"], info["fecha_fin"]
    return None


def write_adjustment_to_informe_psi(
    *,
    adjustment_id: int,
    inserted_date: date,
    sucursal: str,
    descripcion: str,
    marca: str,
    sku: str,
    cantidad_delta: int,
    valor_estimado: float | None,
    periodo_inicio: date,
    periodo_fin: date,
    condicion: str | None = None,
) -> tuple[str, str]:
    """Escribe la fila del ajuste al INFORME PSI que cubre ``inserted_date``.

    Elige día y sucursal al azar dentro del rango del archivo. Devuelve
    (file_id, sheet_range) para guardar en sales_psi_adjustments.

    Raises HTTPException 502 si no hay INFORME PSI aplicable.
    """
    target = get_most_recent_psi_for_range(inserted_date, inserted_date)
    if not target:
        target = get_most_recent_psi_for_range(periodo_inicio, periodo_fin)
    if not target:
        raise HTTPException(
            status_code=502,
            detail=(
                f"No hay INFORME PSI que cubra la fecha {inserted_date.strftime('%d/%m/%Y')} "
                "ni el rango del filtro. Generá el GFK (que crea el INFORME PSI) "
                "de ese período primero y volvé a intentarlo."
            ),
        )

    book_id = target["file_id"]
    sheet_name = _get_sheet_name(book_id)
    service = sheets_service()
    rng = _rango_del_archivo(target) or (periodo_inicio, periodo_fin)

    rnd = random.Random(f"{book_id}:{adjustment_id}")
    span = max(0, (rng[1] - rng[0]).days)
    fecha_random = rng[0] + timedelta(days=rnd.randint(0, span)) if span else rng[0]

    sucursales = read_sucursales_del_informe(book_id) or SUCURSALES_FALLBACK
    suc_random = rnd.choice(sucursales)

    cond = (condicion or ("OUTLET" if "(O)" in str(sku) else "PRIMERA")).strip().upper()
    delta = int(cantidad_delta)
    precio_unit = 0.0
    if valor_estimado is not None:
        precio_unit = round(float(valor_estimado) / abs(delta), 2) if delta else float(valor_estimado)

    # A..H (datos) + I (marca oculta de revert).
    fila = [[
        fecha_random.strftime("%d/%m/%Y"),   # A Fecha
        suc_random,                          # B Sucursal
        descripcion or "",                   # C Descripcion
        marca or "",                         # D Marca
        sku or "",                           # E Modelo
        cond,                                # F Condicion
        precio_unit,                         # G Precio PVP
        delta,                               # H Cantidad
        f"{AJUSTE_REF_PREFIX}{adjustment_id}",  # I marca de revert (sin header)
    ]]

    try:
        result = service.spreadsheets().values().append(
            spreadsheetId=book_id,
            range=f"{quote_sheet_name(sheet_name)}!A:I",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": fila},
        ).execute()
    except Exception as exc:
        raise HTTPException(502, f"No pude escribir el ajuste al INFORME PSI: {exc}")

    updated_range = result.get("updates", {}).get("updatedRange", "") or f"{sheet_name}!APPENDED"
    return book_id, updated_range


def revert_adjustment_in_informe_psi(*, adjustment_id: int, book_id: str) -> bool:
    """Borra la fila del ajuste del INFORME PSI (por la columna oculta I).

    Returns True si la encontró y borró, False si no estaba (fail-soft).
    """
    service = sheets_service()
    try:
        sheet_name = _get_sheet_name(book_id)
    except HTTPException:
        return False

    target_ref = f"{AJUSTE_REF_PREFIX}{adjustment_id}"
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=book_id,
            range=f"{quote_sheet_name(sheet_name)}!A:I",
        ).execute()
    except Exception as exc:
        raise HTTPException(502, f"No pude leer el INFORME PSI para revertir: {exc}")

    rows = result.get("values") or []
    target_row_idx: int | None = None
    for i, row in enumerate(rows):
        if len(row) > PSI_REF_COL_IDX and str(row[PSI_REF_COL_IDX]) == target_ref:
            target_row_idx = i + 1  # 1-indexed
            break

    if target_row_idx is None:
        return False

    try:
        service.spreadsheets().values().clear(
            spreadsheetId=book_id,
            range=f"{sheet_name}!A{target_row_idx}:I{target_row_idx}",
            body={},
        ).execute()
    except Exception as exc:
        raise HTTPException(502, f"No pude borrar la fila del INFORME PSI: {exc}")

    return True


# ── Alias de compatibilidad (los nombres viejos apuntaban al GFK) ───────────
write_adjustment_to_gfk = write_adjustment_to_informe_psi
revert_adjustment_in_gfk = revert_adjustment_in_informe_psi
