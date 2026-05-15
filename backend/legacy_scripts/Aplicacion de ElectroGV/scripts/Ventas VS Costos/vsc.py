#!/usr/bin/env python3
"""
Sincronizador profesional de VSC hacia la planilla mensual.

Qué hace este script:
- Pide por consola la URL del libro mensual y la URL del libro diario/central.
- Se autentica con OAuth de escritorio usando `credentials.json` y `token.json`
  ubicados en la misma carpeta que este archivo.
- Lee una o varias hojas normalizadas del libro diario:
    * Prioriza `VSC_TOTAL`.
    * Si `VSC_TOTAL` no tiene datos, hace fallback a:
      `VSC_SUR_TOTAL`, `VSC_NORTE_TOTAL`, `VSC_CANNING_TOTAL`,
      `VSC_GV_TOTAL` y `EXPORT_TOTAL`.
- Normaliza y filtra las filas:
    * conserva solo filas con fecha válida;
    * conserva solo filas con cantidad y valor;
    * ignora filas con cantidad vacía o cero.
- Agrupa por fecha completa en formato DD/MM/YYYY para evitar duplicados.
- Guarda en un archivo TXT las fechas ya procesadas.
- Agrega los datos al final de las hojas base ocultas del libro mensual:
    * BASE_SUR
    * BASE_NORTE
    * BASE_CANNING
    * BASE_CASEROS

Formato esperado en las hojas base:
    A Fecha
    B Sucursal
    C TipoVenta
    D Remito
    E Descripcion
    F SKU
    G Cantidad
    H Valor

Notas:
- Este script NO toca las columnas con fórmula de las hojas visibles.
- La idea es que las hojas visibles del mensual lean desde las BASE_*.
- El control de duplicados es por fecha completa (`DD/MM/YYYY`).
"""

from __future__ import annotations

import argparse
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, DefaultDict, Dict, Iterable, List, Optional, Sequence, Tuple

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


# =========================================================
# CREDENCIALES UNIFICADAS (apuntan a la raíz de la app)
# =========================================================
_APP_ROOT = Path(__file__).resolve().parent.parent.parent
CREDENTIALS_FILE = _APP_ROOT / "credentials.json"
TOKEN_FILE = _APP_ROOT / "token.json"
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]



# =============================================================================
# Configuración general
# =============================================================================


SCRIPT_DIR = Path(__file__).resolve().parent
CONTROL_FILE = SCRIPT_DIR / "vsc_cargadas.txt"

BASE_HEADERS = [
    "Fecha",
    "Sucursal",
    "TipoVenta",
    "Remito",
    "Descripcion",
    "SKU",
    "Cantidad",
    "Valor",
]

BASE_SHEET_BY_BRANCH = {
    "SUR": "BASE_SUR",
    "NORTE": "BASE_NORTE",
    "CANNING": "BASE_CANNING",
    "CASEROS": "BASE_CASEROS",
    "GV": "BASE_CASEROS",  # alias útil por si aparece el nombre resumido
}

# Si el libro diario no tiene VSC_TOTAL utilizable, probamos estas hojas.
FALLBACK_SOURCE_SHEETS = [
    "VSC_SUR_TOTAL",
    "VSC_NORTE_TOTAL",
    "VSC_CANNING_TOTAL",
    "VSC_GV_TOTAL",
    "EXPORT_TOTAL",
]

# Asumimos que todas las hojas fuente normalizadas usan este formato:
# A Fecha | B Sucursal | C TipoVenta | D Remito | E Descripcion | F SKU | G Cantidad | H Valor
SOURCE_COL_COUNT = 8


# =============================================================================
# Utilidades de texto / números / fechas
# =============================================================================

def normalize_text(value: Any) -> str:
    """Normaliza texto para comparar sin problemas de mayúsculas, espacios y acentos."""
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text


def strip_text(value: Any) -> str:
    """Convierte a string limpio sin alterar demasiado el contenido original."""
    if value is None:
        return ""
    return str(value).replace("\xa0", " ").strip()


def parse_spreadsheet_id(url_or_id: str) -> str:
    """
    Extrae el spreadsheetId desde una URL de Google Sheets o devuelve el valor tal cual
    si ya parece ser un ID.
    """
    text = url_or_id.strip()

    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", text)
    if match:
        return match.group(1)

    # ID típico de Google Sheets: alfanumérico con guiones y guiones bajos.
    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", text):
        return text

    raise ValueError(
        "No pude extraer el ID del spreadsheet. Pegá una URL válida de Google Sheets "
        "o el ID directamente."
    )


def normalize_date(value: Any) -> Optional[str]:
    """
    Normaliza una fecha a formato DD/MM/YYYY.

    Acepta:
    - fechas ya formateadas como texto
    - fechas con guiones o barras
    - serial numérico de Google Sheets/Excel
    """
    if value is None:
        return None

    # Serial de hoja de cálculo.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value <= 0:
            return None
        base = datetime(1899, 12, 30)
        dt = base + timedelta(days=float(value))
        return dt.strftime("%d/%m/%Y")

    text = strip_text(value)
    if not text:
        return None

    # A veces viene con hora al lado.
    text = text.split(" ")[0]

    formats = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).strftime("%d/%m/%Y")
        except ValueError:
            pass

    # Fallback para casos tipo 2/4/2026 o 02/4/2026
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", text)
    if match:
        day, month, year = map(int, match.groups())
        return f"{day:02d}/{month:02d}/{year:04d}"

    return None


def parse_decimal(value: Any) -> Decimal:
    """
    Convierte valores tipo '475.000', '1.200,50', '$ 475.000' o 475000 a Decimal.

    Devuelve 0 si el valor está vacío o no puede interpretarse.
    """
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return Decimal(str(value))

    text = strip_text(value)
    if not text:
        return Decimal("0")

    # Limpieza de moneda y espacios.
    text = text.replace("$", "").replace("U$S", "").replace("u$s", "")
    text = text.replace("ARS", "").replace("USD", "").replace(" ", "")

    # Si tiene coma y punto, asumimos separador decimal el último separador.
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            # 1.234,56 -> 1234.56
            text = text.replace(".", "").replace(",", ".")
        else:
            # 1,234.56 -> 1234.56
            text = text.replace(",", "")
    elif "," in text:
        # 1234,56 -> 1234.56
        text = text.replace(".", "").replace(",", ".")
    else:
        # 1234.56 o 1.234.567 -> 1234.56 / 1234567
        # En nuestro contexto los puntos suelen ser miles.
        text = text.replace(".", "")

    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def decimal_to_number(value: Decimal) -> float:
    """Convierte Decimal a float para enviarlo a Sheets."""
    return float(value)


def normalize_sale_type(value: Any, fallback_sheet_name: str = "") -> str:
    """
    Normaliza el tipo de venta a LOCAL o ONLINE.

    Si el dato viene vacío, usa una heurística simple basada en el nombre de hoja.
    """
    text = normalize_text(value)
    if "online" in text or "on line" in text:
        return "ON LINE"
    if "local" in text:
        return "LOCAL"

    sheet_text = normalize_text(fallback_sheet_name)
    if "online" in sheet_text or "on line" in sheet_text:
        return "ON LINE"

    return "LOCAL"


def destination_base_sheet(sucursal: Any) -> Optional[str]:
    """
    Devuelve el nombre de la hoja BASE_* correspondiente según la sucursal.
    """
    text = normalize_text(sucursal)
    if not text:
        return None

    # Orden importante: primero Canning, luego Norte, luego Sur.
    if "canning" in text:
        return BASE_SHEET_BY_BRANCH["CANNING"]
    if "norte" in text:
        return BASE_SHEET_BY_BRANCH["NORTE"]
    if "sur" in text:
        return BASE_SHEET_BY_BRANCH["SUR"]
    if "caseros" in text or text == "gv" or "g v" in text:
        return BASE_SHEET_BY_BRANCH["CASEROS"]

    return None


# =============================================================================
# OAuth / Google Sheets
# =============================================================================

def get_credentials() -> Credentials:
    """Carga token.json o inicia el flujo OAuth si es la primera vez."""
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())

    if not creds or not creds.valid:
        if not CREDENTIALS_FILE.exists():
            raise FileNotFoundError(
                f"No encontré '{CREDENTIALS_FILE.name}' en la misma carpeta del script."
            )

        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
        creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def build_sheets_service():
    """Construye el cliente de Google Sheets."""
    creds = get_credentials()
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def get_spreadsheet_titles(service, spreadsheet_id: str) -> List[str]:
    """Obtiene los nombres de las hojas del spreadsheet."""
    response = (
        service.spreadsheets()
        .get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties.title",
        )
        .execute()
    )
    return [
        sheet["properties"]["title"]
        for sheet in response.get("sheets", [])
        if "properties" in sheet and "title" in sheet["properties"]
    ]


def ensure_sheet_exists_and_headers(service, spreadsheet_id: str, sheet_name: str) -> None:
    """
    Asegura que exista una hoja con el nombre dado y que tenga los encabezados
    en la primera fila.
    """
    titles = get_spreadsheet_titles(service, spreadsheet_id)

    if sheet_name not in titles:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "requests": [
                    {
                        "addSheet": {
                            "properties": {
                                "title": sheet_name,
                                "gridProperties": {
                                    "rowCount": 1000,
                                    "columnCount": 8,
                                },
                            }
                        }
                    }
                ]
            },
        ).execute()

    # Si la hoja está vacía, escribimos los headers.
    current = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A1:H1",
            valueRenderOption="FORMATTED_VALUE",
        )
        .execute()
    ).get("values", [])

    if not current or not current[0]:
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A1",
            valueInputOption="RAW",
            body={"values": [BASE_HEADERS]},
        ).execute()


def read_sheet_rows(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    a1_range: str = "A2:H",
) -> List[List[Any]]:
    """Lee un rango de una hoja y devuelve una lista de filas."""
    response = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!{a1_range}",
            valueRenderOption="FORMATTED_VALUE",
            dateTimeRenderOption="FORMATTED_STRING",
        )
        .execute()
    )
    return response.get("values", [])


def append_rows(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    rows: List[List[Any]],
) -> None:
    """Agrega varias filas al final de una hoja BASE_*."""
    if not rows:
        return

    service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:H",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()


# =============================================================================
# Control local de fechas ya procesadas
# =============================================================================

def load_processed_dates(control_file: Path = CONTROL_FILE) -> set[str]:
    """Carga las fechas ya procesadas desde el TXT."""
    if not control_file.exists():
        return set()

    processed: set[str] = set()
    with control_file.open("r", encoding="utf-8") as f:
        for line in f:
            text = line.strip()
            if text:
                processed.add(text)
    return processed


def save_processed_dates(processed_dates: set[str], control_file: Path = CONTROL_FILE) -> None:
    """Guarda el conjunto de fechas procesadas en orden ascendente."""
    sorted_dates = sorted(
        processed_dates,
        key=lambda d: datetime.strptime(d, "%d/%m/%Y"),
    )
    with control_file.open("w", encoding="utf-8") as f:
        for date_str in sorted_dates:
            f.write(date_str + "\n")


# =============================================================================
# Lógica de normalización / selección de hojas
# =============================================================================

def source_sheets_to_read(service, daily_spreadsheet_id: str, titles: Sequence[str]) -> List[str]:
    """
    Decide qué hojas del libro diario vamos a leer.

    Regla:
    - Si `VSC_TOTAL` existe y tiene datos útiles, la usamos sola.
    - Si no, hacemos fallback a las hojas específicas disponibles.
    """
    if "VSC_TOTAL" in titles:
        rows = read_sheet_rows(service, daily_spreadsheet_id, "VSC_TOTAL")
        if any(row_is_useful(row) for row in rows):
            return ["VSC_TOTAL"]

    available = [name for name in FALLBACK_SOURCE_SHEETS if name in titles]
    return available


def row_is_useful(row: Sequence[Any]) -> bool:
    """Filtra filas completamente vacías."""
    return any(strip_text(cell) for cell in row)


def normalize_source_row(
    row: Sequence[Any],
    source_sheet_name: str,
) -> Optional[Tuple[str, str, str, str, str, str, float, float]]:
    """
    Convierte una fila fuente al formato final de BASE_*:
        Fecha | Sucursal | TipoVenta | Remito | Descripcion | SKU | Cantidad | Valor

    Devuelve None si la fila no cumple los requisitos mínimos.
    """
    padded = list(row[:SOURCE_COL_COUNT]) + [""] * max(0, SOURCE_COL_COUNT - len(row))
    if len(padded) > SOURCE_COL_COUNT:
        padded = padded[:SOURCE_COL_COUNT]

    fecha = normalize_date(padded[0])
    sucursal = strip_text(padded[1])
    tipo_venta = normalize_sale_type(padded[2], fallback_sheet_name=source_sheet_name)
    remito = strip_text(padded[3])
    descripcion = strip_text(padded[4])
    sku = strip_text(padded[5])
    cantidad_raw = padded[6]
    valor_raw = padded[7]

    if not fecha:
        return None

    if not sucursal:
        return None

    if not descripcion:
        return None

    if valor_raw in (None, ""):
        return None

    cantidad = parse_decimal(cantidad_raw)
    valor = parse_decimal(valor_raw)

    # Regla de negocio actual:
    # si cantidad no tiene valor o es 0, esa fila no se toma.
    if cantidad <= 0:
        return None

    return (
        fecha,
        sucursal,
        tipo_venta,
        remito,
        descripcion,
        sku,
        decimal_to_number(cantidad),
        decimal_to_number(valor),
    )


def group_rows_by_date_and_sheet(
    service,
    daily_spreadsheet_id: str,
    daily_titles: Sequence[str],
) -> "tuple[list[str], dict[str, dict[str, list[list[Any]]]]]":
    """
    Lee el libro diario y devuelve:
    - order_dates: fechas en orden de aparición
    - grouped: dict[fecha][base_sheet] -> filas normalizadas
    """
    source_sheets = source_sheets_to_read(service, daily_spreadsheet_id, daily_titles)

    if not source_sheets:
        raise ValueError(
            "No encontré hojas fuente válidas. Busqué primero `VSC_TOTAL` y luego "
            "VSC_SUR_TOTAL, VSC_NORTE_TOTAL, VSC_CANNING_TOTAL, VSC_GV_TOTAL y EXPORT_TOTAL."
        )

    # Si VSC_TOTAL existe, la usamos sola. Si no, se leerán las específicas.
    grouped: Dict[str, Dict[str, List[List[Any]]]] = {}
    dates_order: List[str] = []

    for sheet_name in source_sheets:
        logging.info("Leyendo hoja fuente: %s", sheet_name)
        rows = read_sheet_rows(service, daily_spreadsheet_id, sheet_name)

        if not rows:
            logging.info("La hoja %s no tiene datos para procesar.", sheet_name)
            continue

        for raw_row in rows:
            if not row_is_useful(raw_row):
                continue

            normalized = normalize_source_row(raw_row, source_sheet_name=sheet_name)
            if normalized is None:
                continue

            fecha, sucursal, tipo_venta, remito, descripcion, sku, cantidad, valor = normalized
            base_sheet = destination_base_sheet(sucursal)

            if base_sheet is None:
                logging.warning(
                    "No pude determinar la BASE_* para la sucursal '%s' (hoja %s). Se omite.",
                    sucursal,
                    sheet_name,
                )
                continue

            if fecha not in grouped:
                grouped[fecha] = defaultdict(list)  # type: ignore[assignment]
                dates_order.append(fecha)

            grouped[fecha][base_sheet].append(
                [
                    fecha,
                    sucursal,
                    tipo_venta,
                    remito,
                    descripcion,
                    sku,
                    cantidad,
                    valor,
                ]
            )

    return dates_order, grouped


# =============================================================================
# Proceso principal
# =============================================================================

def process_and_sync(
    service,
    monthly_spreadsheet_id: str,
    daily_spreadsheet_id: str,
) -> None:
    """Proceso principal de sincronización."""
    _monthly_titles = get_spreadsheet_titles(service, monthly_spreadsheet_id)
    daily_titles = get_spreadsheet_titles(service, daily_spreadsheet_id)

    # Aseguramos que existan las hojas BASE_* en el libro mensual.
    for base_sheet in [
        BASE_SHEET_BY_BRANCH["SUR"],
        BASE_SHEET_BY_BRANCH["NORTE"],
        BASE_SHEET_BY_BRANCH["CANNING"],
        BASE_SHEET_BY_BRANCH["CASEROS"],
    ]:
        ensure_sheet_exists_and_headers(service, monthly_spreadsheet_id, base_sheet)

    processed_dates = load_processed_dates()
    logging.info("Fechas ya procesadas: %s", ", ".join(sorted(processed_dates)) if processed_dates else "(ninguna)")

    dates_order, grouped = group_rows_by_date_and_sheet(
        service=service,
        daily_spreadsheet_id=daily_spreadsheet_id,
        daily_titles=daily_titles,
    )

    if not dates_order:
        logging.info("No se encontraron filas válidas para procesar.")
        return

    new_dates: List[str] = []
    total_rows_written = 0

    for fecha in dates_order:
        if fecha in processed_dates:
            logging.info("La fecha %s ya estaba cargada. Se omite.", fecha)
            continue

        by_sheet = grouped.get(fecha, {})
        if not by_sheet:
            logging.info("La fecha %s no tiene filas útiles. Se omite.", fecha)
            continue

        logging.info("Procesando fecha: %s", fecha)

        # Intentamos escribir todo lo de esa fecha.
        # Si algo falla, no marcamos la fecha como procesada.
        date_success = True
        written_this_date = 0

        for base_sheet, rows in by_sheet.items():
            try:
                append_rows(service, monthly_spreadsheet_id, base_sheet, rows)
                written_this_date += len(rows)
                logging.info("  -> %s: %d filas", base_sheet, len(rows))
            except HttpError as exc:
                date_success = False
                logging.exception(
                    "Error escribiendo en %s para la fecha %s: %s",
                    base_sheet,
                    fecha,
                    exc,
                )
                break

        if date_success:
            processed_dates.add(fecha)
            new_dates.append(fecha)
            total_rows_written += written_this_date
            logging.info("Fecha %s cargada correctamente (%d filas).", fecha, written_this_date)
        else:
            logging.warning(
                "La fecha %s no se marcó como procesada porque hubo un error al escribirla.",
                fecha,
            )

    if new_dates:
        save_processed_dates(processed_dates)
        logging.info("Fechas marcadas como procesadas: %s", ", ".join(new_dates))

    logging.info("Proceso finalizado. Filas nuevas cargadas: %d", total_rows_written)


# =============================================================================
# CLI
# =============================================================================

def parse_args() -> argparse.Namespace:
    """Opciones opcionales por consola (si no se pasan, el script pregunta)."""
    parser = argparse.ArgumentParser(
        description="Sincroniza datos VSC desde un libro diario/central hacia la mensual."
    )
    parser.add_argument(
        "--monthly-url",
        help="URL o ID del libro mensual destino.",
        default=None,
    )
    parser.add_argument(
        "--daily-url",
        help="URL o ID del libro diario/central fuente.",
        default=None,
    )
    parser.add_argument(
        "--reset-control",
        action="store_true",
        help="Borra el archivo de control de fechas antes de ejecutar.",
    )
    return parser.parse_args()


def prompt_if_missing(value: Optional[str], message: str) -> str:
    """Pide un valor por consola si no vino por argumento."""
    if value and value.strip():
        return value.strip()
    entered = input(message).strip()
    if not entered:
        raise ValueError("No se ingresó un valor válido.")
    return entered


def main() -> None:
    """Punto de entrada del script."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    args = parse_args()

    if args.reset_control and CONTROL_FILE.exists():
        CONTROL_FILE.unlink()
        logging.info("Archivo de control eliminado: %s", CONTROL_FILE.name)

    monthly_url = prompt_if_missing(
        args.monthly_url,
        "Pegá la URL o el ID del libro mensual: ",
    )
    daily_url = prompt_if_missing(
        args.daily_url,
        "Pegá la URL o el ID del libro diario/central: ",
    )

    monthly_spreadsheet_id = parse_spreadsheet_id(monthly_url)
    daily_spreadsheet_id = parse_spreadsheet_id(daily_url)

    service = build_sheets_service()

    try:
        process_and_sync(
            service=service,
            monthly_spreadsheet_id=monthly_spreadsheet_id,
            daily_spreadsheet_id=daily_spreadsheet_id,
        )
    except HttpError as exc:
        logging.exception("Error de Google Sheets/API: %s", exc)
        raise
    except Exception as exc:
        logging.exception("Error inesperado: %s", exc)
        raise


if __name__ == "__main__":
    main()
