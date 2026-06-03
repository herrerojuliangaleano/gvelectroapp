"""Escritor de ajustes PSI al GFK más reciente del rango.

Fase 1 v2 — los ajustes ahora se escriben al **archivo GFK** (el reporte
oficial), no al libro mensual. El GFK queda como **fuente única visible** del
gerente, y cuando se regenera, los ajustes existentes se re-aplican al nuevo.

Formato de la fila escrita (columnas A..M del GFK, ver `gg.py:SALIDA_HEADERS`):

  A Fecha de venta                 DD/MM/YYYY
  B N°/Nombre de la sucursal        {sucursal}-AJUSTE_PSI
  C ID del item                     (vacío)
  D EAN del item                    (vacío)
  E Descripcion del item            {descripcion}
  F Marca del item                  {marca}
  G Modelo del item                 {sku}  (limpio, sin "(O)")
  H Familia de productos            (vacío)
  I Tipo de vendedor                AJUSTE
  J Nombre / identificacion         PSI-{adjustment_id}   ← clave para revert
  K Moneda de la venta              ARS
  L Precio unitario GMV             {valor_estimado}
  M Cantidad vendida                {cantidad_delta}

El revert busca la fila por la columna J (`Nombre / identificacion del vendedor
= PSI-{id}`) y la limpia. Si el GFK se regeneró y la fila ya no existe, marca
el ajuste como reverted igual (fail-soft).

Ver `docs/10-modulo-comercial-fase1.md` §11 y `gg.py` para el formato GFK.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import HTTPException

from ..google_sheets import quote_sheet_name, sheets_service
from .gfk_reader import GFK_HEADERS, get_most_recent_gfk_for_range


AJUSTE_SUCURSAL_SUFFIX = "-AJUSTE_PSI"
AJUSTE_TIPO_VENDEDOR = "AJUSTE"
AJUSTE_VENDEDOR_PREFIX = "PSI-"


def _get_sheet_name(book_id: str) -> str:
    """Devuelve el nombre de la primera hoja del GFK (típicamente el rango)."""
    service = sheets_service()
    meta = service.spreadsheets().get(spreadsheetId=book_id).execute()
    sheets = meta.get("sheets", [])
    if not sheets:
        raise HTTPException(502, "El GFK no tiene hojas")
    return sheets[0]["properties"]["title"]


def write_adjustment_to_gfk(
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
) -> tuple[str, str]:
    """Escribe la fila del ajuste al GFK que cubre ``inserted_date``.

    Prioriza el GFK cuyo rango contiene la fecha del ajuste (no el rango del
    filtro PSI), para que la venta quede archivada en el período correcto.
    Si no hay un GFK que cubra esa fecha, intenta el más reciente del rango
    del filtro como fallback.

    Returns:
        (file_id, sheet_range) → para guardar en sales_psi_adjustments.

    Raises:
        HTTPException 502 si no hay ningún GFK aplicable (el operador tiene
        que correr la herramienta GFK primero).
    """
    # Buscar GFK que cubra la fecha exacta del ajuste
    target = get_most_recent_gfk_for_range(inserted_date, inserted_date)
    if not target:
        # Fallback: el más reciente del rango del filtro
        target = get_most_recent_gfk_for_range(periodo_inicio, periodo_fin)
    if not target:
        raise HTTPException(
            status_code=502,
            detail=(
                f"No hay archivo GFK que cubra la fecha {inserted_date.strftime('%d/%m/%Y')} "
                "ni el rango del filtro. Generá el GFK con la herramienta "
                "'Generar GFK' primero y volvé a intentarlo."
            ),
        )

    book_id = target["file_id"]
    sheet_name = _get_sheet_name(book_id)
    service = sheets_service()

    # Armar fila en formato GFK (A..M)
    fila = [[
        inserted_date.strftime("%d/%m/%Y"),                # A Fecha
        f"{sucursal}{AJUSTE_SUCURSAL_SUFFIX}",             # B Sucursal
        "",                                                 # C ID
        "",                                                 # D EAN
        descripcion or "",                                  # E Descripcion
        marca or "",                                        # F Marca
        sku or "",                                          # G Modelo (SKU)
        "",                                                 # H Familia
        AJUSTE_TIPO_VENDEDOR,                              # I Tipo vendedor
        f"{AJUSTE_VENDEDOR_PREFIX}{adjustment_id}",        # J Nombre/identificación
        "ARS",                                              # K Moneda
        float(valor_estimado) if valor_estimado is not None else 0,  # L Precio GMV
        int(cantidad_delta),                                # M Cantidad
    ]]

    # Usamos values.append (no values.update) para que expanda la grilla
    # automáticamente si la hoja está al límite de filas. Append busca la
    # próxima fila vacía dentro del table range.
    try:
        result = service.spreadsheets().values().append(
            spreadsheetId=book_id,
            range=f"{quote_sheet_name(sheet_name)}!A:M",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": fila},
        ).execute()
    except Exception as exc:
        raise HTTPException(502, f"No pude escribir el ajuste al GFK: {exc}")

    # El response incluye 'updates.updatedRange' con el rango efectivo (ej: "Hoja!A1486:M1486")
    updated_range = result.get("updates", {}).get("updatedRange", "")
    if not updated_range:
        # Fallback razonable: dejar marca aunque no sepamos la fila exacta
        updated_range = f"{sheet_name}!APPENDED"

    return book_id, updated_range


def revert_adjustment_in_gfk(
    *,
    adjustment_id: int,
    book_id: str,
) -> bool:
    """Borra la fila del ajuste del GFK.

    La identifica por columna J (Nombre / identificación = PSI-{id}).
    Returns True si encontró y borró, False si no estaba (fail-soft).
    """
    service = sheets_service()
    try:
        sheet_name = _get_sheet_name(book_id)
    except HTTPException:
        return False

    target_id = f"{AJUSTE_VENDEDOR_PREFIX}{adjustment_id}"

    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=book_id,
            range=f"{quote_sheet_name(sheet_name)}!A:M",
        ).execute()
    except Exception as exc:
        raise HTTPException(502, f"No pude leer el GFK para revertir: {exc}")

    rows = result.get("values") or []
    target_row_idx: int | None = None
    for i, row in enumerate(rows):
        # Columna J (índice 9) tiene Nombre/identificación
        if len(row) > 9 and str(row[9]) == target_id:
            target_row_idx = i + 1  # 1-indexed
            break

    if target_row_idx is None:
        return False

    clear_range = f"{sheet_name}!A{target_row_idx}:M{target_row_idx}"
    try:
        service.spreadsheets().values().clear(
            spreadsheetId=book_id,
            range=clear_range,
            body={},
        ).execute()
    except Exception as exc:
        raise HTTPException(502, f"No pude borrar la fila del GFK: {exc}")

    return True


# ──────────────────────────────────────────────────────────────────────────
# Compatibilidad con código viejo (Sprint 3) — alias deprecados
# ──────────────────────────────────────────────────────────────────────────

def write_adjustment_to_monthly_book(*args, **kwargs):  # pragma: no cover
    raise NotImplementedError(
        "Función reemplazada en Sprint 4 por write_adjustment_to_gfk(). "
        "El PSI ahora opera sobre el archivo GFK, no sobre el libro mensual."
    )


def revert_adjustment_in_monthly_book(*args, **kwargs):  # pragma: no cover
    raise NotImplementedError(
        "Función reemplazada en Sprint 4 por revert_adjustment_in_gfk()."
    )
