import os
import re
import sys
import time
from pathlib import Path
from typing import List, Dict, Any

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



# =========================================================
# CONFIGURACIÓN GENERAL
# =========================================================

# Alcances mínimos necesarios:
# - Sheets: para poder escribir y congelar fórmulas -> valores
# - Drive metadata readonly: para poder listar archivos de una carpeta

# Valores por defecto al iniciar el script
DEFAULT_RECURSIVE = False                # Entrar o no en subcarpetas
DEFAULT_INCLUDE_HIDDEN_SHEETS = False    # Incluir hojas ocultas o no
DEFAULT_DRY_RUN = True                   # True = solo muestra qué haría

# Pausa pequeña entre archivos para ir más tranquilo con la API
DELAY_BETWEEN_FILES_SECONDS = 0.20

# MIME TYPES de Drive
MIME_FOLDER = "application/vnd.google-apps.folder"
MIME_SPREADSHEET = "application/vnd.google-apps.spreadsheet"


# =========================================================
# UTILIDADES
# =========================================================

def clean_text(value) -> str:
    """
    Convierte cualquier valor a texto limpio.
    """
    if value is None:
        return ""
    return str(value).strip()


def extract_folder_id(url_or_id: str) -> str:
    """
    Extrae el ID de carpeta desde:
    - un link de Google Drive
    - o un ID crudo

    Ejemplos válidos:
    https://drive.google.com/drive/folders/XXXXXXXXXXXX
    XXXXXXXXXXXX
    """
    text = clean_text(url_or_id)

    # Caso 1: viene un link de carpeta
    match = re.search(r"/folders/([a-zA-Z0-9_-]+)", text)
    if match:
        return match.group(1)

    # Caso 2: viene el ID crudo
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", text):
        return text

    raise ValueError(f"No pude extraer el folderId desde: {url_or_id}")


def parse_yes_no(user_input: str, default: bool) -> bool:
    """
    Convierte respuestas del usuario en True/False.
    """
    text = clean_text(user_input).lower()

    if text == "":
        return default

    if text in {"s", "si", "sí", "y", "yes"}:
        return True

    if text in {"n", "no"}:
        return False

    return default


def col_to_a1(col_idx_1_based: int) -> str:
    """
    Convierte número de columna a letras A1:
    1 -> A
    26 -> Z
    27 -> AA
    """
    result = ""
    n = col_idx_1_based

    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result

    return result


def a1_range(max_row: int, max_col: int) -> str:
    """
    Devuelve un rango A1 desde A1 hasta la última fila/columna usada.
    """
    return f"A1:{col_to_a1(max_col)}{max_row}"


# =========================================================
# AUTENTICACIÓN GOOGLE
# =========================================================

def get_google_services():
    """
    Autentica con OAuth usando credentials.json y token.json.
    Devuelve:
    - sheets_service
    - drive_service

    IMPORTANTE:
    Si cambiás los SCOPES y ya tenías token.json de antes,
    borrá token.json y volvé a ejecutar.
    """
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    "No encontré credentials.json en la misma carpeta del script."
                )

            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials.json",
                SCOPES
            )
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)

    return sheets_service, drive_service


# =========================================================
# GOOGLE DRIVE
# =========================================================

def get_drive_file_metadata(drive_service, file_id: str) -> dict:
    """
    Obtiene metadatos básicos de un archivo/carpeta de Drive.
    Se usa para validar que el ID recibido exista y sea carpeta.
    """
    return (
        drive_service.files()
        .get(
            fileId=file_id,
            fields="id,name,mimeType,parents",
            supportsAllDrives=True,
        )
        .execute()
    )


def list_folder_children(drive_service, folder_id: str) -> List[dict]:
    """
    Lista todos los hijos directos de una carpeta.
    """
    query = f"'{folder_id}' in parents and trashed = false"

    files = []
    page_token = None

    while True:
        response = (
            drive_service.files()
            .list(
                q=query,
                fields="nextPageToken, files(id,name,mimeType)",
                orderBy="name_natural",
                pageSize=1000,
                pageToken=page_token,
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
            )
            .execute()
        )

        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")

        if not page_token:
            break

    return files


def list_spreadsheets_in_folder(
    drive_service,
    root_folder_id: str,
    recursive: bool = False
) -> List[dict]:
    """
    Busca todos los Google Sheets dentro de una carpeta.
    Si recursive=True, entra también en subcarpetas.
    """
    spreadsheets = []
    pending_folders = [root_folder_id]
    visited_folders = set()

    while pending_folders:
        current_folder_id = pending_folders.pop(0)

        if current_folder_id in visited_folders:
            continue
        visited_folders.add(current_folder_id)

        children = list_folder_children(drive_service, current_folder_id)

        for item in children:
            mime_type = item.get("mimeType", "")

            if mime_type == MIME_SPREADSHEET:
                spreadsheets.append(item)

            elif recursive and mime_type == MIME_FOLDER:
                pending_folders.append(item["id"])

    return spreadsheets


# =========================================================
# GOOGLE SHEETS
# =========================================================

def get_used_ranges_by_sheet(
    sheets_service,
    spreadsheet_id: str,
    include_hidden_sheets: bool = False
) -> List[Dict[str, Any]]:
    """
    Detecta el rango realmente usado de cada hoja.

    Importante:
    No se basa solo en lo visible, sino en userEnteredValue,
    lo cual permite detectar:
    - fórmulas
    - textos
    - números
    - booleanos
    aunque alguna fórmula devuelva vacío visualmente.

    Devuelve una lista con:
    [
        {
            "sheet_id": 123,
            "sheet_name": "Planilla",
            "max_row": 237,
            "max_col": 45
        },
        ...
    ]
    """
    spreadsheet = (
        sheets_service.spreadsheets()
        .get(
            spreadsheetId=spreadsheet_id,
            includeGridData=True,
            fields=(
                "sheets("
                "properties(sheetId,title,hidden,sheetType),"
                "data(startRow,startColumn,rowData(values(userEnteredValue)))"
                ")"
            ),
        )
        .execute()
    )

    used_ranges = []

    for sheet in spreadsheet.get("sheets", []):
        props = sheet.get("properties", {})
        sheet_id = props.get("sheetId")
        sheet_name = props.get("title", "Sin nombre")
        hidden = props.get("hidden", False)
        sheet_type = props.get("sheetType", "GRID")

        # Solo procesamos hojas normales
        if sheet_type != "GRID":
            continue

        # Si está oculta y el usuario no quiere incluirlas, se omite
        if hidden and not include_hidden_sheets:
            continue

        max_row = 0
        max_col = 0

        for data_block in sheet.get("data", []):
            start_row = data_block.get("startRow", 0)
            start_col = data_block.get("startColumn", 0)

            for local_r_idx, row in enumerate(data_block.get("rowData", [])):
                cells = row.get("values", [])
                last_used_col_in_this_row = 0

                for local_c_idx, cell in enumerate(cells):
                    if "userEnteredValue" in cell:
                        absolute_col = start_col + local_c_idx + 1
                        if absolute_col > last_used_col_in_this_row:
                            last_used_col_in_this_row = absolute_col

                if last_used_col_in_this_row > 0:
                    absolute_row = start_row + local_r_idx + 1

                    if absolute_row > max_row:
                        max_row = absolute_row

                    if last_used_col_in_this_row > max_col:
                        max_col = last_used_col_in_this_row

        if max_row > 0 and max_col > 0:
            used_ranges.append({
                "sheet_id": sheet_id,
                "sheet_name": sheet_name,
                "max_row": max_row,
                "max_col": max_col,
            })

    return used_ranges


def freeze_sheet_used_range(
    sheets_service,
    spreadsheet_id: str,
    sheet_id: int,
    max_row: int,
    max_col: int
):
    """
    Congela una hoja convirtiendo fórmulas en valores fijos.

    Cómo lo hace:
    - toma el rango usado
    - lo copia sobre sí mismo
    - usando PASTE_VALUES

    Eso deja el valor actual fijo y rompe las fórmulas.
    """
    body = {
        "requests": [
            {
                "copyPaste": {
                    "source": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": max_row,
                        "startColumnIndex": 0,
                        "endColumnIndex": max_col,
                    },
                    "destination": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": max_row,
                        "startColumnIndex": 0,
                        "endColumnIndex": max_col,
                    },
                    "pasteType": "PASTE_VALUES",
                    "pasteOrientation": "NORMAL",
                }
            }
        ]
    }

    (
        sheets_service.spreadsheets()
        .batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        )
        .execute()
    )


# =========================================================
# PROCESO PRINCIPAL
# =========================================================

def process_folder_freeze(
    sheets_service,
    drive_service,
    source_folder_id: str,
    recursive: bool,
    include_hidden_sheets: bool,
    dry_run: bool,
):
    """
    Valida la carpeta, busca todos los Google Sheets y congela
    todas las hojas detectadas con datos.
    """
    print("\n[3/6] Validando acceso a la carpeta...")

    folder_meta = get_drive_file_metadata(drive_service, source_folder_id)
    folder_name = folder_meta.get("name", "(sin nombre)")
    folder_mime = folder_meta.get("mimeType", "")

    if folder_mime != MIME_FOLDER:
        raise ValueError(
            f"El ID indicado existe, pero no es una carpeta. "
            f"Nombre: {folder_name} | mimeType: {folder_mime}"
        )

    print(f"   - Carpeta OK: {folder_name}")

    print("[4/6] Buscando Google Sheets dentro de la carpeta...")
    spreadsheets = list_spreadsheets_in_folder(
        drive_service=drive_service,
        root_folder_id=source_folder_id,
        recursive=recursive,
    )

    if not spreadsheets:
        raise ValueError("No encontré Google Sheets dentro de la carpeta indicada.")

    print(f"   - Archivos encontrados: {len(spreadsheets)}\n")

    total_files = len(spreadsheets)
    processed_files = 0
    total_sheets_detected = 0
    total_sheets_frozen = 0
    error_files = 0

    for i, file in enumerate(spreadsheets, start=1):
        spreadsheet_id = file["id"]
        spreadsheet_name = file["name"]

        print("=" * 90)
        print(f"[{i}/{total_files}] Archivo: {spreadsheet_name}")

        try:
            used_ranges = get_used_ranges_by_sheet(
                sheets_service=sheets_service,
                spreadsheet_id=spreadsheet_id,
                include_hidden_sheets=include_hidden_sheets,
            )

            if not used_ranges:
                print("   - No encontré hojas con rango usado.")
                processed_files += 1
                continue

            total_sheets_detected += len(used_ranges)

            for sheet_info in used_ranges:
                sheet_id = sheet_info["sheet_id"]
                sheet_name = sheet_info["sheet_name"]
                max_row = sheet_info["max_row"]
                max_col = sheet_info["max_col"]
                rango = a1_range(max_row, max_col)

                if dry_run:
                    print(f"   - [DRY RUN] Congelaría hoja '{sheet_name}' -> {rango}")
                else:
                    print(f"   - Congelando hoja '{sheet_name}' -> {rango} ...", end="")
                    freeze_sheet_used_range(
                        sheets_service=sheets_service,
                        spreadsheet_id=spreadsheet_id,
                        sheet_id=sheet_id,
                        max_row=max_row,
                        max_col=max_col,
                    )
                    total_sheets_frozen += 1
                    print(" OK")

            processed_files += 1

            if DELAY_BETWEEN_FILES_SECONDS > 0:
                time.sleep(DELAY_BETWEEN_FILES_SECONDS)

        except HttpError as e:
            error_files += 1
            print(f"   - ERROR API: {e}")

        except Exception as e:
            error_files += 1
            print(f"   - ERROR: {e}")

    print("\n" + "=" * 90)
    print("RESUMEN FINAL")
    print("=" * 90)
    print(f"Archivos encontrados:        {total_files}")
    print(f"Archivos procesados:        {processed_files}")
    print(f"Hojas detectadas:           {total_sheets_detected}")
    print(f"Hojas congeladas:           {total_sheets_frozen if not dry_run else 0}")
    print(f"Archivos con error:         {error_files}")
    print(f"Modo prueba (DRY_RUN):      {dry_run}")


# =========================================================
# MAIN
# =========================================================

def main():
    print("=" * 90)
    print("CONGELADOR MASIVO DE GOOGLE SHEETS POR CARPETA")
    print("=" * 90)

    source_folder_url = input("Pegá el link o ID de la carpeta a procesar: ").strip()
    recursive_input = input("¿Procesar subcarpetas también? (s/n, Enter = n): ").strip()
    hidden_input = input("¿Incluir hojas ocultas? (s/n, Enter = n): ").strip()
    dry_run_input = input("¿Modo prueba sin congelar? (s/n, Enter = s): ").strip()

    recursive = parse_yes_no(recursive_input, DEFAULT_RECURSIVE)
    include_hidden_sheets = parse_yes_no(hidden_input, DEFAULT_INCLUDE_HIDDEN_SHEETS)
    dry_run = parse_yes_no(dry_run_input, DEFAULT_DRY_RUN)

    print("\n[1/6] Autenticando con Google...")
    sheets_service, drive_service = get_google_services()

    print("[2/6] Resolviendo folder ID...")
    source_folder_id = extract_folder_id(source_folder_url)
    print(f"   - Folder ID: {source_folder_id}")

    if not dry_run:
        print("\nATENCIÓN:")
        print("Vas a reemplazar fórmulas por valores fijos en múltiples archivos.")
        print("Esta acción es destructiva y no se deshace fácil.\n")

        confirm = input("Escribí SI para continuar: ").strip().upper()
        if confirm != "SI":
            print("Proceso cancelado por el usuario.")
            return

    process_folder_freeze(
        sheets_service=sheets_service,
        drive_service=drive_service,
        source_folder_id=source_folder_id,
        recursive=recursive,
        include_hidden_sheets=include_hidden_sheets,
        dry_run=dry_run,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nERROR GENERAL: {e}")
        sys.exit(1)