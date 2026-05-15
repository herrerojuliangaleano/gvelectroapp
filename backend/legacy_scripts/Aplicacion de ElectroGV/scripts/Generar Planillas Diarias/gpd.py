from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


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



# ============================================================
# CONFIGURACIÓN GENERAL
# ============================================================

# Carpeta donde está este script
BASE_DIR = Path(__file__).resolve().parent

# Archivos de OAuth que deben estar junto al .py

# Scopes necesarios:
# - drive: para copiar archivos, moverlos, renombrarlos
# - spreadsheets: para editar celdas dentro de los Sheets

# Nombre de la pestaña que vas a modificar dentro de cada copia
NOMBRE_HOJA_OBJETIVO = "Planilla"

# ============================================================
# ACÁ PONÉ TUS IDs REALES
# ============================================================
# Copiá el ID desde la URL del Google Sheet:
# https://docs.google.com/spreadsheets/d/ID_AQUI/edit
#
# Copiá el ID desde la URL de la carpeta:
# https://drive.google.com/drive/folders/ID_AQUI

PLANTILLA_SUCURSALES_ID = "1J4spN4uJyZiRKMfhq9HJ-iH7KrjL090vpbsRh1WqJgI"
PLANTILLA_CASEROS_ID = "1bGg0pwTOcHU3X1zGuo7ApFhk7-FRg35o2dt42e7TDDQ"

CARPETA_SUR_ID = "1MkPh57vcvbfO4JJXRsd9Y2ohxNpKaRqH"
CARPETA_NORTE_ID = "1Ob6c5A_gnmaeRjvMTyYdLkahAjvPkc2i"
CARPETA_CANNING_ID = "17RRqQzglHVxhxM-QL-t5fsrhqESqGCsx"
CARPETA_CASEROS_ID = "1aaUJyDOuC5DRX9-qquo_sjste1OL5Vfc"


# ============================================================
# OAUTH / SERVICIOS GOOGLE
# ============================================================

def obtener_servicios_google():
    """
    Crea y devuelve los servicios de Google Drive y Google Sheets usando OAuth de escritorio.

    Flujo:
    1) Si existe token.json, intenta reutilizarlo.
    2) Si el token expiró pero tiene refresh_token, lo renueva.
    3) Si no hay token válido, abre el navegador para autorizar.
    4) Guarda el token nuevo en token.json.

    Requisitos:
    - credentials.json junto a este .py
    - token.json se crea solo en la primera autorización
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
                    f"No encontré {CREDENTIALS_FILE.name} en:\n{CREDENTIALS_FILE}\n\n"
                    "Poné el archivo descargado desde Google Cloud en la misma carpeta que este script."
                )

            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE),
                SCOPES,
            )
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)

    return drive_service, sheets_service


# ============================================================
# FECHAS
# ============================================================

def fecha_hoy_celda() -> str:
    """Fecha para escribir dentro del sheet, formato dd/mm/aaaa."""
    return datetime.now().strftime("%d/%m/%Y")


def fecha_hoy_archivo() -> str:
    """Fecha para el nombre del archivo, formato dd-mm-aaaa."""
    return datetime.now().strftime("%d-%m-%Y")


# ============================================================
# DRIVE / SHEETS
# ============================================================

def copiar_spreadsheet(
    drive_service,
    spreadsheet_id_origen: str,
    nombre_nuevo: str,
    folder_id_destino: str,
) -> str:
    """
    Copia un Google Sheets completo dentro de una carpeta específica de Drive.

    Devuelve:
        El ID del nuevo spreadsheet copiado.
    """
    copia = drive_service.files().copy(
        fileId=spreadsheet_id_origen,
        body={
            "name": nombre_nuevo,
            "parents": [folder_id_destino],
        },
    ).execute()

    return copia["id"]


def escribir_valores(
    sheets_service,
    spreadsheet_id: str,
    rango: str,
    valores: List[List[str]],
) -> None:
    """
    Escribe valores en un rango específico del spreadsheet.

    Ejemplo:
        rango = "Planilla!B1:C1"
        valores = [[fecha_hoy_celda(), "SUR"]]
    """
    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=rango,
        valueInputOption="USER_ENTERED",
        body={"values": valores},
    ).execute()


def renombrar_pestana(
    sheets_service,
    spreadsheet_id: str,
    sheet_id: int,
    nuevo_titulo: str,
) -> None:
    """
    Renombra una pestaña específica dentro del spreadsheet.

    Ojo:
    - sheet_id es el ID interno de la pestaña, no el nombre.
    - No se usa normalmente si no hace falta cambiar el nombre de la hoja.
    """
    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sheet_id,
                            "title": nuevo_titulo,
                        },
                        "fields": "title",
                    }
                }
            ]
        },
    ).execute()


def obtener_sheet_id_por_nombre(sheets_service, spreadsheet_id: str, nombre_hoja: str) -> int:
    """
    Busca el sheetId interno de una pestaña a partir de su nombre.
    """
    metadata = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties(sheetId,title)",
    ).execute()

    for sheet in metadata.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("title") == nombre_hoja:
            return props["sheetId"]

    raise ValueError(
        f"No se encontró la hoja '{nombre_hoja}' dentro del spreadsheet {spreadsheet_id}"
    )


# ============================================================
# PROCESO PRINCIPAL
# ============================================================

def generar_archivo(
    drive_service,
    sheets_service,
    template_id: str,
    nombre_archivo: str,
    folder_id: str,
    sucursal: str,
) -> str:
    """
    1) Copia la plantilla
    2) Renombra el archivo copiado
    3) Escribe fecha y sucursal en la hoja objetivo

    Devuelve:
        ID del archivo generado.
    """
    # 1. Copiar archivo dentro de la carpeta destino
    nuevo_spreadsheet_id = copiar_spreadsheet(
        drive_service=drive_service,
        spreadsheet_id_origen=template_id,
        nombre_nuevo=nombre_archivo,
        folder_id_destino=folder_id,
    )

    # 2. Escribir datos en la hoja objetivo
    escribir_valores(
        sheets_service=sheets_service,
        spreadsheet_id=nuevo_spreadsheet_id,
        rango=f"{NOMBRE_HOJA_OBJETIVO}!B1:C1",
        valores=[[fecha_hoy_celda(), sucursal]],
    )

    return nuevo_spreadsheet_id


def main() -> None:
    """
    Genera todas las copias necesarias usando las plantillas de Google Sheets.
    Cada copia:
    - conserva validaciones y protecciones
    - recibe nombre con la fecha actual
    - se guarda en la carpeta correspondiente
    - se actualiza en B1 y C1
    """
    drive_service, sheets_service = obtener_servicios_google()
    hoy = fecha_hoy_archivo()

    trabajos: List[Tuple[str, str, str, str]] = [
        (
            PLANTILLA_SUCURSALES_ID,
            f"Planilla Ventas SUR - {hoy}",
            CARPETA_SUR_ID,
            "SUR",
        ),
        (
            PLANTILLA_SUCURSALES_ID,
            f"Planilla Ventas NORTE - {hoy}",
            CARPETA_NORTE_ID,
            "NORTE",
        ),
        (
            PLANTILLA_SUCURSALES_ID,
            f"Planilla Ventas CANNING - {hoy}",
            CARPETA_CANNING_ID,
            "CANNING",
        ),
        (
            PLANTILLA_CASEROS_ID,
            f"Planilla Ventas - {hoy}",
            CARPETA_CASEROS_ID,
            "CASEROS",
        ),
    ]

    generados: List[Tuple[str, str]] = []

    for template_id, nombre_archivo, carpeta_id, sucursal in trabajos:
        if "PEGAR_ID_" in template_id or "PEGAR_ID_" in carpeta_id:
            raise ValueError(
                "Todavía hay IDs sin completar en la configuración. "
                "Revisá PLANTILLA_* y CARPETA_*."
            )

        print(f"Generando: {nombre_archivo} ...")
        nuevo_id = generar_archivo(
            drive_service=drive_service,
            sheets_service=sheets_service,
            template_id=template_id,
            nombre_archivo=nombre_archivo,
            folder_id=carpeta_id,
            sucursal=sucursal,
        )
        generados.append((nombre_archivo, nuevo_id))
        print(f"  OK -> {nombre_archivo}")

    print("\nListo. Se generaron estos archivos:")
    for nombre, file_id in generados:
        print(f"- {nombre} | ID: {file_id}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}")
    finally:
        input("\nPresioná Enter para salir...")