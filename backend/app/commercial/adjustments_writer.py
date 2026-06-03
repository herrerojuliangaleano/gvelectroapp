"""Escritor de ajustes PSI al libro mensual de ventas en Drive.

Cada ajuste se escribe como una fila más en la hoja oculta ``BASE_<SUCURSAL>``
del libro mensual del mes correspondiente. La fila es marcada para diferenciarla
de las cargas operativas (TipoVenta=AJUSTE, Remito=PSI-{id}).

Cuando `gg.py` (la herramienta GFK) lee el libro mensual, ve estas filas como
ventas normales — por lo tanto el ajuste queda automáticamente reflejado en el
reporte GFK sin pasos extra.

El revert busca la fila por `Remito="PSI-{id}"` (no por rango fijo) para
sobrevivir reordenamientos manuales del sheet.

Ver docs/10-modulo-comercial-fase1.md §11 para algoritmo completo.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import HTTPException

from ..google_sheets import quote_sheet_name, sheets_service
from .ventas_reader import find_monthly_book_id


# ──────────────────────────────────────────────────────────────────────────
# Esquema de las hojas BASE_*
# ──────────────────────────────────────────────────────────────────────────

# Columnas de las hojas BASE_<SUCURSAL> en el libro mensual:
#   A Fecha | B Sucursal | C TipoVenta | D Remito | E Descripcion |
#   F SKU   | G Cantidad | H Valor
BASE_SHEET_COLUMNS = ["Fecha", "Sucursal", "TipoVenta", "Remito",
                      "Descripcion", "SKU", "Cantidad", "Valor"]

# La sucursal del ajuste se concatena con un sufijo para hacerla identificable
# visualmente en el sheet sin romper la compatibilidad con los scripts viejos.
AJUSTE_SUCURSAL_SUFFIX = "-AJUSTE_PSI"
AJUSTE_TIPO_VENTA = "AJUSTE"
AJUSTE_REMITO_PREFIX = "PSI-"


# ──────────────────────────────────────────────────────────────────────────
# Escritura
# ──────────────────────────────────────────────────────────────────────────

def write_adjustment_to_monthly_book(
    *,
    adjustment_id: int,
    inserted_date: date,
    sucursal: str,
    descripcion: str,
    sku: str,
    cantidad_delta: int,
    valor_estimado: float | None,
) -> tuple[str, str]:
    """Escribe la fila del ajuste al libro mensual.

    Returns:
        (file_id_libro_mensual, sheet_range_escrito)

    Raises:
        HTTPException si no se puede encontrar el libro o falla la escritura.
    """
    year = inserted_date.year
    month = inserted_date.month

    book_id = find_monthly_book_id(year, month)
    if not book_id:
        raise HTTPException(
            status_code=502,
            detail=(
                f"No encontré el libro mensual de {month:02d}/{year} en Drive. "
                "Verificá que exista la carpeta y el archivo 'Ventas Vs. Costos…'."
            ),
        )

    service = sheets_service()
    sheet_name = f"BASE_{sucursal}"

    # 1. Calcular próxima fila vacía en la columna A
    try:
        existing = service.spreadsheets().values().get(
            spreadsheetId=book_id,
            range=f"{quote_sheet_name(sheet_name)}!A:A",
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No pude leer la hoja {sheet_name} del libro mensual: {exc}",
        )

    values = existing.get("values") or []
    next_row = len(values) + 1  # 1-indexed
    if next_row < 2:
        next_row = 2  # nunca pisar la fila de encabezados

    # 2. Armar la fila respetando el esquema A..H del libro mensual
    fila = [[
        inserted_date.strftime("%d/%m/%Y"),                # A Fecha
        f"{sucursal}{AJUSTE_SUCURSAL_SUFFIX}",             # B Sucursal (marcada como ajuste)
        AJUSTE_TIPO_VENTA,                                 # C TipoVenta
        f"{AJUSTE_REMITO_PREFIX}{adjustment_id}",          # D Remito (identifica el ajuste)
        descripcion or "",                                  # E Descripcion
        sku or "",                                          # F SKU
        int(cantidad_delta),                                # G Cantidad
        float(valor_estimado) if valor_estimado is not None else 0,  # H Valor
    ]]

    target_range = f"{sheet_name}!A{next_row}:H{next_row}"

    try:
        service.spreadsheets().values().update(
            spreadsheetId=book_id,
            range=target_range,
            valueInputOption="USER_ENTERED",
            body={"values": fila},
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No pude escribir el ajuste al libro mensual: {exc}",
        )

    return book_id, target_range


def revert_adjustment_in_monthly_book(
    *,
    adjustment_id: int,
    book_id: str,
    sucursal: str,
) -> bool:
    """Borra la fila del ajuste del libro mensual.

    La identifica por `Remito="PSI-{adjustment_id}"` (no por rango fijo, que
    podría haberse desplazado si alguien insertó filas a mano).

    Returns:
        True si encontró y borró la fila, False si no encontró.

    Raises:
        HTTPException si falla la lectura o el clear.
    """
    service = sheets_service()
    sheet_name = f"BASE_{sucursal}"
    target_remito = f"{AJUSTE_REMITO_PREFIX}{adjustment_id}"

    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=book_id,
            range=f"{quote_sheet_name(sheet_name)}!A:H",
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No pude leer la hoja {sheet_name} para revertir: {exc}",
        )

    rows = result.get("values") or []
    target_row_idx: int | None = None
    for i, row in enumerate(rows):
        # Columna D (índice 3) tiene el Remito
        if len(row) > 3 and str(row[3]) == target_remito:
            target_row_idx = i + 1  # 1-indexed
            break

    if target_row_idx is None:
        return False

    clear_range = f"{sheet_name}!A{target_row_idx}:H{target_row_idx}"
    try:
        service.spreadsheets().values().clear(
            spreadsheetId=book_id,
            range=clear_range,
            body={},
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No pude borrar la fila del libro mensual: {exc}",
        )

    return True
