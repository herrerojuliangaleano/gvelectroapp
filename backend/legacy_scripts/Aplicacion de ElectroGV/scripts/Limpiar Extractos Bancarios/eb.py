from __future__ import annotations

from pathlib import Path
from datetime import datetime
import re
import unicodedata
from typing import Any

import pandas as pd
from tkinter import Tk, filedialog

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



# ============================================================
# CONFIGURACIÓN GENERAL
# ============================================================

BASE_DIR = Path(__file__).resolve().parent


# Carpeta de Drive por sucursal
FOLDER_ID_POR_SUCURSAL = {
    "GV": "1nJaQLUSe-Ih2tbMfIoc1EXndVDODeHH6",
    "ABC": "1QAtfhxFQX1azNSCiIwQmew6AZC-Qw7uM",
}

# Reglas de detección por nombre de archivo
REGLAS = [
    {
        "hoja": "GV_SUPERVIELLE_3",
        "banco": "supervielle",
        "contiene": "004601503-003",
    },
    {
        "hoja": "GV_SUPERVIELLE_4",
        "banco": "supervielle",
        "contiene": "004601503-004",
    },
    {
        "hoja": "GV_GALICIA_BOEDO",
        "banco": "galicia",
        "contiene": "82333939",
    },
    {
        "hoja": "GV_GALICIA_NORCENTER",
        "banco": "galicia",
        "contiene": "82643938",
    },
    {
        "hoja": "ABC_SUPERVIELLE_3",
        "banco": "supervielle",
        "contiene": "005348858-003",
    },{
        "hoja": "ABC_SUPERVIELLE_2",
        "banco": "supervielle",
        "contiene": "005348858-002",
    },
    {
        "hoja": "ABC_GALICIA_LANUS",
        "banco": "galicia",
        "contiene": "85783935",
    },
    {
        "hoja": "ABC_GALICIA_NORTE",
        "banco": "galicia",
        "contiene": "92743935",
    },
    {
        "hoja": "ABC_GALICIA_CANNING",
        "banco": "galicia",
        "contiene": "93113935",
    },
    {
        "hoja": "NAVE",
        "banco": "nave",
        "contiene": "detalle operaciones",
    },
]

COLUMNAS_STD = ["Fecha", "Descripción", "Débitos", "Créditos", "Saldo"]


GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet"


# ============================================================
# AUTENTICACIÓN / GOOGLE API
# ============================================================

def obtener_creds() -> Credentials:
    """
    Obtiene credenciales OAuth.
    Si existe token válido, lo reutiliza.
    Si no, abre el flujo de login local.
    """
    creds = None

    if TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        except Exception:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception:
                try:
                    TOKEN_FILE.unlink(missing_ok=True)
                except Exception:
                    pass
                creds = None

        if not creds or not creds.valid:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    f"No encontré {CREDENTIALS_FILE.name} en: {CREDENTIALS_FILE}\n"
                    "Poné el archivo credentials.json en la misma carpeta que este .py."
                )

            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE),
                SCOPES,
            )
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def crear_services():
    """
    Crea los servicios de Google Drive y Google Sheets.
    """
    creds = obtener_creds()
    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return drive_service, sheets_service


def escapar_query_drive(texto: str) -> str:
    """
    Escapa un texto para usarlo en consultas de Drive.
    """
    return texto.replace("\\", "\\\\").replace("'", "\\'")


def buscar_spreadsheet_en_drive(drive_service, folder_id: str, nombre: str) -> str | None:
    """
    Busca un spreadsheet por nombre dentro de una carpeta de Drive.
    Si existe, devuelve su ID.
    """
    nombre_esc = escapar_query_drive(nombre)

    query = (
        f"name = '{nombre_esc}' and "
        f"'{folder_id}' in parents and "
        f"mimeType = '{GOOGLE_SHEETS_MIME}' and "
        f"trashed = false"
    )

    resultados = drive_service.files().list(
        q=query,
        fields="files(id, name, modifiedTime)",
        pageSize=10,
        orderBy="modifiedTime desc",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
    ).execute()

    files = resultados.get("files", [])
    if not files:
        return None

    return files[0]["id"]


def crear_google_sheet_en_drive(drive_service, titulo: str, folder_id: str) -> str:
    """
    Crea un Google Sheet dentro de una carpeta de Drive.
    Si ya existe uno con el mismo nombre, reutiliza ese archivo.
    """
    existente = buscar_spreadsheet_en_drive(drive_service, folder_id, titulo)
    if existente:
        return existente

    metadata = {
        "name": titulo,
        "mimeType": GOOGLE_SHEETS_MIME,
        "parents": [folder_id],
    }

    created = drive_service.files().create(
        body=metadata,
        fields="id",
        supportsAllDrives=True,
    ).execute()

    return created["id"]


# ============================================================
# UTILIDADES DE TEXTO
# ============================================================

def quitar_tildes(texto: str) -> str:
    """
    Elimina tildes/acentos para hacer comparaciones más robustas.
    """
    texto = str(texto)
    texto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in texto if not unicodedata.combining(c))


def texto_compacto(valor: object) -> str:
    """
    Convierte texto a una versión compacta:
    - sin tildes
    - en minúsculas
    - sin espacios ni signos
    """
    if pd.isna(valor):
        return ""
    texto = quitar_tildes(str(valor)).lower().strip()
    return re.sub(r"[^a-z0-9]+", "", texto)


def coincide_nombre(nombre_archivo: str, contiene) -> bool:
    """
    Verifica si un nombre de archivo contiene uno o más fragmentos.
    """
    nombre = texto_compacto(nombre_archivo)
    if isinstance(contiene, str):
        contiene = [contiene]
    return all(texto_compacto(x) in nombre for x in contiene)


def normalizar_columnas(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normaliza nombres de columnas:
    - minúsculas
    - sin tildes
    - separadas por guiones bajos
    """
    df = df.copy()
    nuevas = []

    for col in df.columns:
        col = quitar_tildes(str(col)).lower().strip()
        col = re.sub(r"[^a-z0-9]+", "_", col)
        col = re.sub(r"_+", "_", col).strip("_")
        nuevas.append(col)

    df.columns = nuevas
    return df


def buscar_columna_flexible(df: pd.DataFrame, candidatos: list[str]) -> str | None:
    """
    Busca una columna con coincidencia flexible.
    Sirve para tolerar variaciones como:
    - debito / debitos / débito / débitos
    - descripcion / descripción / concepto / detalle
    """
    columnas = list(df.columns)
    columnas_compactas = {col: texto_compacto(col) for col in columnas}

    for candidato in candidatos:
        cand = texto_compacto(candidato)
        for col, col_compacta in columnas_compactas.items():
            if col_compacta == cand or cand in col_compacta or col_compacta in cand:
                return col

    return None


def detectar_fila_encabezado(
    df: pd.DataFrame,
    palabras_clave: list[str],
    max_filas: int = 30
) -> int | None:
    """
    Detecta la fila de encabezado buscando palabras clave.
    """
    claves = [texto_compacto(p) for p in palabras_clave]
    limite = min(max_filas, len(df))

    for i in range(limite):
        fila = " ".join(texto_compacto(v) for v in df.iloc[i].tolist())
        if not fila:
            continue
        if all(clave in fila for clave in claves):
            return i

    return None


# ============================================================
# NÚMEROS Y FECHAS
# ============================================================

def to_numero(serie: pd.Series) -> pd.Series:
    """
    Convierte una serie a numérico manejando formatos locales:
    - separador decimal con coma o punto
    - símbolo $
    - texto extra
    - valores negativos entre paréntesis
    """
    s = serie.astype(str).str.strip()
    s = s.replace({"nan": None, "None": None, "": None})

    def convertir(valor: object):
        if valor is None or pd.isna(valor):
            return None

        txt = str(valor).strip()
        txt = txt.replace("$", "").replace("ARS", "").replace(" ", "")
        txt = txt.replace("(", "-").replace(")", "")
        txt = re.sub(r"[^0-9,.\-]", "", txt)

        if txt in {"", "-", ".", ","}:
            return None

        tiene_coma = "," in txt
        tiene_punto = "." in txt

        if tiene_coma and tiene_punto:
            if txt.rfind(",") > txt.rfind("."):
                txt = txt.replace(".", "")
                txt = txt.replace(",", ".")
            else:
                txt = txt.replace(",", "")

        elif tiene_coma:
            txt = txt.replace(".", "")
            txt = txt.replace(",", ".")

        elif tiene_punto:
            partes = txt.split(".")
            if len(partes) > 2:
                txt = "".join(partes[:-1]) + "." + partes[-1]

        return pd.to_numeric(txt, errors="coerce")

    return s.apply(convertir)


def fecha_a_serial_sheets(valor: object) -> float | None:
    """
    Convierte una fecha a serial de Google Sheets (número entero de días desde 30/12/1899).
    Prueba primero formatos explícitos en orden de prioridad para evitar que pandas
    invierta día y mes cuando ambos son ≤ 12 (bug conocido de dayfirst=True).
    """
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None

    txt = str(valor).strip()
    if not txt or txt.lower() in {"nan", "none", "nat"}:
        return None

    epoch = pd.Timestamp("1899-12-30")

    # Formatos explícitos en orden de prioridad (formato argentino primero)
    FORMATOS = [
        "%d/%m/%Y",       # 12/05/2026
        "%d/%m/%y",       # 12/05/26
        "%d-%m-%Y",       # 12-05-2026
        "%d-%m-%y",       # 12-05-26
        "%Y-%m-%d",       # 2026-05-12  (ISO, sin ambigüedad)
        "%Y/%m/%d",       # 2026/05/12
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M",
    ]

    # Quitar fracción de segundos si viene como "2026-05-12 00:00:00.000000"
    txt_base = txt.split(".")[0].strip()

    for fmt in FORMATOS:
        try:
            fecha = datetime.strptime(txt_base, fmt)
            delta = pd.Timestamp(fecha) - epoch
            return float(delta.days)
        except ValueError:
            continue

    # Último recurso: dejar que pandas intente, pero advertir
    fecha_pd = pd.to_datetime(txt, errors="coerce", dayfirst=True)
    if pd.isna(fecha_pd):
        return None
    print(f"[AVISO] Fecha '{txt}' parseada sin formato explícito — verificar resultado.")
    delta = fecha_pd.normalize() - epoch
    return float(delta.days)


def fecha_para_archivo() -> str:
    """
    Fecha segura para nombres de archivo.
    Usamos YYYY-MM-DD para evitar problemas con '/'.
    """
    hoy = datetime.now()
    return hoy.strftime("%Y-%m-%d")


def df_a_valores(df: pd.DataFrame) -> list[list[Any]]:
    """
    Convierte un DataFrame a lista de listas, lista para enviar a Google Sheets.
    """
    salida = [list(df.columns)]
    for _, row in df.iterrows():
        fila = []
        for v in row.tolist():
            if pd.isna(v):
                fila.append("")
            elif hasattr(v, "item"):
                try:
                    fila.append(v.item())
                except Exception:
                    fila.append(v)
            else:
                fila.append(v)
        salida.append(fila)
    return salida


def ordenar_si_hay_fecha(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ordena el DataFrame por la primera columna que contenga 'fecha' en el nombre.
    Los valores ya son seriales numéricos (días desde 30/12/1899), así que ordenar
    por el número directamente es correcto y no requiere re-parsear la fecha.
    """
    df = df.copy()

    columna_fecha = None
    for col in df.columns:
        if "fecha" in texto_compacto(col):
            columna_fecha = col
            break

    if columna_fecha is None:
        return df

    df["_fecha_sort"] = pd.to_numeric(df[columna_fecha], errors="coerce")
    df = (
        df.sort_values("_fecha_sort", kind="mergesort")
        .drop(columns=["_fecha_sort"])
        .reset_index(drop=True)
    )
    return df


# ============================================================
# LECTURA ROBUSTA DE EXCEL
# ============================================================

def leer_hoja_excel(ruta: Path, sheet_name) -> pd.DataFrame:
    """
    Lee una hoja de Excel sin asumir encabezado.
    """
    bruto = pd.read_excel(ruta, sheet_name=sheet_name, header=None, dtype=str)
    bruto = bruto.dropna(how="all").reset_index(drop=True)
    return bruto


def extraer_dataframe(ruta: Path, palabras_clave: list[str]) -> pd.DataFrame:
    """
    Busca la hoja correcta dentro del archivo Excel y extrae un DataFrame limpio.
    """
    libro = pd.ExcelFile(ruta)
    hojas = libro.sheet_names
    ultimo_error = None

    for sheet in hojas:
        try:
            bruto = leer_hoja_excel(ruta, sheet_name=sheet)

            if bruto.empty:
                continue

            fila_header = detectar_fila_encabezado(bruto, palabras_clave, max_filas=30)
            if fila_header is None:
                continue

            df = bruto.iloc[fila_header + 1 :].copy().reset_index(drop=True)
            df.columns = bruto.iloc[fila_header].tolist()
            df = df.dropna(how="all").copy()
            df = normalizar_columnas(df)
            return df

        except Exception as e:
            ultimo_error = e
            continue

    # Fallback simple si no detectó encabezado
    try:
        bruto = leer_hoja_excel(ruta, sheet_name=0)
        if not bruto.empty:
            df = pd.read_excel(ruta, sheet_name=0, dtype=str)
            df = df.dropna(how="all").copy()
            df = normalizar_columnas(df)
            return df
    except Exception as e:
        ultimo_error = e

    raise ValueError(
        f"No pude detectar una hoja válida en '{ruta.name}'. "
        f"Revisá que el archivo tenga las columnas correctas.\n"
        f"Hojas encontradas: {hojas}\n"
        f"Último error: {ultimo_error}"
    )


# ============================================================
# LIMPIEZA POR BANCO
# ============================================================

def limpiar_galicia(ruta: Path) -> pd.DataFrame:
    """
    Limpieza para archivos de Galicia.
    Mantiene el orden de las filas según tu lógica actual.
    """
    df = extraer_dataframe(ruta, ["fecha", "descripcion", "debitos", "creditos", "saldo"])

    col_fecha = buscar_columna_flexible(df, ["fecha"])
    col_desc = buscar_columna_flexible(df, ["descripcion", "descripción", "concepto", "detalle"])
    col_debitos = buscar_columna_flexible(df, ["debitos", "debito", "débitos", "débito"])
    col_creditos = buscar_columna_flexible(df, ["creditos", "credito", "créditos", "crédito"])
    col_saldo = buscar_columna_flexible(df, ["saldo"])

    faltantes = [
        nombre for nombre, col in {
            "Fecha": col_fecha,
            "Descripción": col_desc,
            "Débitos": col_debitos,
            "Créditos": col_creditos,
            "Saldo": col_saldo,
        }.items() if col is None
    ]

    if faltantes:
        raise ValueError(
            f"Galicia: faltan columnas esperadas: {faltantes}\n"
            f"Columnas detectadas: {list(df.columns)}"
        )

    salida = pd.DataFrame({
        "Fecha": df[col_fecha].apply(fecha_a_serial_sheets),
        "Descripción": df[col_desc].astype(str).str.strip(),
        "Débitos": to_numero(df[col_debitos]),
        "Créditos": to_numero(df[col_creditos]),
        "Saldo": to_numero(df[col_saldo]),
    })

    salida = salida.dropna(subset=["Fecha"]).reset_index(drop=True)
    return salida[COLUMNAS_STD]


def limpiar_supervielle(ruta: Path) -> pd.DataFrame:
    """
    Limpieza para archivos de Supervielle.
    Acá se conserva tu inversión de orden original.
    """
    df = extraer_dataframe(ruta, ["fecha", "concepto", "debito", "credito", "saldo"])

    col_fecha = buscar_columna_flexible(df, ["fecha"])
    col_desc = buscar_columna_flexible(df, ["concepto", "descripcion", "descripción", "detalle"])
    col_debitos = buscar_columna_flexible(df, ["debito", "débito"])
    col_creditos = buscar_columna_flexible(df, ["credito", "crédito"])
    col_saldo = buscar_columna_flexible(df, ["saldo"])

    faltantes = [
        nombre for nombre, col in {
            "Fecha": col_fecha,
            "Descripción": col_desc,
            "Débitos": col_debitos,
            "Créditos": col_creditos,
            "Saldo": col_saldo,
        }.items() if col is None
    ]

    if faltantes:
        raise ValueError(
            f"Supervielle: faltan columnas esperadas: {faltantes}\n"
            f"Columnas detectadas: {list(df.columns)}"
        )

    # Tu lógica original de inversión de filas
    df = df.dropna(how="all").copy()
    df = df.iloc[::-1].reset_index(drop=True)

    salida = pd.DataFrame({
        "Fecha": df[col_fecha].apply(fecha_a_serial_sheets),
        "Descripción": df[col_desc].astype(str).str.strip(),
        "Débitos": to_numero(df[col_debitos]),
        "Créditos": to_numero(df[col_creditos]),
        "Saldo": to_numero(df[col_saldo]),
    })

    salida = salida.dropna(subset=["Fecha"]).reset_index(drop=True)
    return salida[COLUMNAS_STD]


def limpiar_nave(ruta: Path) -> pd.DataFrame:
    """
    Limpieza para archivos de Nave.
    """
    df = extraer_dataframe(ruta, ["fecha", "acreditacion", "retencion", "iibb"])

    col_fecha = buscar_columna_flexible(df, ["fecha de acreditacion", "fecha acreditación"])
    col_ret = buscar_columna_flexible(df, ["retencion iibb caba", "retención iibb caba", "retencion caba"])

    faltantes = []
    if col_fecha is None:
        faltantes.append("Fecha de acreditación")
    if col_ret is None:
        faltantes.append("Retención IIBB CABA")

    if faltantes:
        raise ValueError(
            f"NAVE: faltan columnas: {faltantes}\n"
            f"Columnas detectadas: {list(df.columns)}"
        )

    salida = pd.DataFrame({
        "Fecha de acreditación": df[col_fecha].apply(fecha_a_serial_sheets),
        "Retención IIBB CABA": to_numero(df[col_ret]),
    })

    salida = salida.dropna(subset=["Fecha de acreditación"]).reset_index(drop=True)

    # Eliminar fila TOTAL
    mask_total = salida["Fecha de acreditación"].astype(str).str.contains("total", case=False, na=False)
    salida = salida[~mask_total].reset_index(drop=True)

    return salida


# ============================================================
# GOOGLE SHEETS HELPERS
# ============================================================

def preparar_spreadsheet_con_hojas(
    sheets_service,
    spreadsheet_id: str,
    nombres_hojas: list[str],
) -> dict[str, int]:
    """
    Deja el spreadsheet exactamente con las hojas indicadas.
    Renombra la primera hoja, borra las sobrantes y crea las faltantes.
    """
    meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties",
    ).execute()

    hojas = meta.get("sheets", [])
    if not hojas:
        raise ValueError("El spreadsheet no tiene hojas.")

    hoja_inicial_id = hojas[0]["properties"]["sheetId"]

    requests = [
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": hoja_inicial_id,
                    "title": nombres_hojas[0],
                },
                "fields": "title",
            }
        }
    ]

    # Eliminar hojas extra
    for hoja in hojas[1:]:
        requests.append({
            "deleteSheet": {
                "sheetId": hoja["properties"]["sheetId"]
            }
        })

    # Crear hojas faltantes
    for nombre in nombres_hojas[1:]:
        requests.append({
            "addSheet": {
                "properties": {
                    "title": nombre
                }
            }
        })

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": requests},
    ).execute()

    meta2 = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties",
    ).execute()

    mapa = {}
    for sh in meta2.get("sheets", []):
        props = sh["properties"]
        mapa[props["title"]] = props["sheetId"]

    return mapa


def escribir_df_en_hoja(sheets_service, spreadsheet_id: str, hoja: str, df: pd.DataFrame) -> None:
    """
    Escribe un DataFrame en una hoja de Google Sheets desde A1.
    """
    hoja_esc = hoja.replace("'", "''")
    rango = f"'{hoja_esc}'!A1"

    # Limpia antes de escribir para evitar residuos de ejecuciones anteriores
    sheets_service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"'{hoja_esc}'",
        body={},
    ).execute()

    valores = df_a_valores(df)

    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=rango,
        valueInputOption="RAW",
        body={
            "majorDimension": "ROWS",
            "values": valores,
        },
    ).execute()


def formatear_hoja_google(
    sheets_service,
    spreadsheet_id: str,
    sheet_id: int,
    n_cols: int,
    n_rows: int,
) -> None:
    """
    Aplica formato visual:
    - congela la primera fila
    - resalta el encabezado
    - autoajusta columnas
    - da formato de fecha a la primera columna
    - da formato numérico a columnas B en adelante
    """
    requests = [
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {
                        "frozenRowCount": 1,
                    },
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {
                            "red": 0.85,
                            "green": 0.91,
                            "blue": 0.97,
                        },
                        "textFormat": {
                            "bold": True,
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
            }
        },
    ]

    # Autoajuste de columnas
    if n_cols > 0:
        requests.append(
            {
                "autoResizeDimensions": {
                    "dimensions": {
                        "sheetId": sheet_id,
                        "dimension": "COLUMNS",
                        "startIndex": 0,
                        "endIndex": n_cols,
                    }
                }
            }
        )

    # Formato de fecha en la primera columna
    if n_rows > 1:
        requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": n_rows,
                        "startColumnIndex": 0,
                        "endColumnIndex": 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "numberFormat": {
                                "type": "DATE",
                                "pattern": "dd/MM/yyyy",
                            }
                        }
                    },
                    "fields": "userEnteredFormat.numberFormat",
                }
            }
        )

    # Formato numérico para columnas B en adelante
    if n_cols > 1 and n_rows > 1:
        requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": n_rows,
                        "startColumnIndex": 1,
                        "endColumnIndex": n_cols,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "numberFormat": {
                                "type": "NUMBER",
                                "pattern": "#,##0.00",
                            }
                        }
                    },
                    "fields": "userEnteredFormat.numberFormat",
                }
            }
        )

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": requests},
    ).execute()


# ============================================================
# INTERFAZ DE SELECCIÓN
# ============================================================

def elegir_carpeta_entrada() -> Path:
    """
    Abre una ventana para elegir la carpeta de entrada.
    """
    ruta = filedialog.askdirectory(title="Seleccioná la carpeta con los Excels")
    if not ruta:
        raise SystemExit("Se canceló la selección de carpeta.")
    return Path(ruta)


def archivos_excel_en_carpeta(carpeta: Path) -> list[Path]:
    """
    Lista archivos .xlsx válidos dentro de una carpeta y subcarpetas.
    """
    archivos = []
    for p in carpeta.rglob("*.xlsx"):
        if p.name.startswith("~$"):
            continue
        archivos.append(p)
    return sorted(archivos)


def detectar_regla_por_archivo(ruta: Path):
    """
    Devuelve la regla que coincide con el nombre del archivo.
    """
    coincidencias = []
    for regla in REGLAS:
        if coincide_nombre(ruta.name, regla["contiene"]):
            coincidencias.append(regla)

    if len(coincidencias) == 1:
        return coincidencias[0]

    if len(coincidencias) > 1:
        raise ValueError(
            f"El archivo '{ruta.name}' coincide con más de una regla:\n"
            + "\n".join(f"- {r['hoja']} ({r['contiene']})" for r in coincidencias)
        )

    return None


def obtener_sucursal(desde_hoja: str) -> str:
    """
    Extrae la sucursal desde el nombre de la hoja.
    Ej.: GV_SUPERVIELLE_3 -> GV
    """
    return desde_hoja.split("_", 1)[0].upper()


# ============================================================
# PROCESO PRINCIPAL
# ============================================================

def procesar() -> None:
    """
    Proceso principal:
    1. Elegir carpeta
    2. Detectar archivos
    3. Limpiar datos
    4. Crear Sheets en Drive
    5. Escribir y formatear cada hoja
    """
    root = Tk()
    root.withdraw()

    carpeta_entrada = elegir_carpeta_entrada()
    archivos = archivos_excel_en_carpeta(carpeta_entrada)

    if not archivos:
        raise SystemExit("No encontré archivos .xlsx en la carpeta elegida.")

    drive_service, sheets_service = crear_services()

    resultados: dict[str, dict[str, list[pd.DataFrame]]] = {}
    no_detectados: list[str] = []

    # Nombre de archivo seguro
    fecha_nombre = fecha_para_archivo()

    try:
        for ruta in archivos:
            regla = detectar_regla_por_archivo(ruta)

            if regla is None:
                no_detectados.append(ruta.name)
                continue

            hoja = regla["hoja"]
            banco = regla["banco"]
            sucursal = obtener_sucursal(hoja)

            if banco == "nave":
                # Nave se agrupa dentro de GV
                sucursal = "GV"

            print(f"Procesando {ruta.name} -> {sucursal} / {hoja}")

            if banco == "galicia":
                df_limpio = limpiar_galicia(ruta)
            elif banco == "supervielle":
                df_limpio = limpiar_supervielle(ruta)
            elif banco == "nave":
                df_limpio = limpiar_nave(ruta)
            else:
                raise ValueError(f"Banco no soportado: {banco}")

            if df_limpio.empty:
                print("  [AVISO] Quedó vacío después de limpiar.")
                continue

            resultados.setdefault(sucursal, {}).setdefault(hoja[:31], []).append(df_limpio)

        if not resultados:
            raise SystemExit("No se detectó ningún archivo que se pudiera procesar correctamente.")

        for sucursal, hojas in resultados.items():
            nombre_salida = f"extractos_{sucursal}_limpios - {fecha_nombre}"
            folder_id = FOLDER_ID_POR_SUCURSAL.get(sucursal)

            if not folder_id or folder_id.startswith("PEGAR_ID_"):
                print(f"  [AVISO] No hay carpeta de Drive configurada para {sucursal}")
                continue

            spreadsheet_id = crear_google_sheet_en_drive(
                drive_service=drive_service,
                titulo=nombre_salida,
                folder_id=folder_id,
            )

            nombres_hojas = list(hojas.keys())
            if not nombres_hojas:
                print(f"  [AVISO] No hubo hojas válidas para {sucursal}")
                continue

            sheet_ids = preparar_spreadsheet_con_hojas(
                sheets_service=sheets_service,
                spreadsheet_id=spreadsheet_id,
                nombres_hojas=nombres_hojas,
            )

            for hoja, dfs in hojas.items():
                df_final = pd.concat(dfs, ignore_index=True)

                # Ordenamiento final por fecha, manteniendo mergesort estable
                df_final = ordenar_si_hay_fecha(df_final)

                if df_final.empty:
                    print(f"  [AVISO] La hoja {hoja} quedó vacía y no se exportó.")
                    continue

                nombre_hoja_final = hoja[:31]

                escribir_df_en_hoja(
                    sheets_service=sheets_service,
                    spreadsheet_id=spreadsheet_id,
                    hoja=nombre_hoja_final,
                    df=df_final,
                )

                formatear_hoja_google(
                    sheets_service=sheets_service,
                    spreadsheet_id=spreadsheet_id,
                    sheet_id=sheet_ids[nombre_hoja_final],
                    n_cols=len(df_final.columns),
                    n_rows=len(df_final) + 1,
                )

            print(
                f"Archivo generado en Drive: "
                f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
            )

    except HttpError as e:
        print(f"[ERROR GOOGLE API] {e}")
        raise
    finally:
        root.destroy()

    print("\nListo.")

    if no_detectados:
        print("\nArchivos que no coincidieron con ninguna regla:")
        for nombre in no_detectados:
            print(f"- {nombre}")


if __name__ == "__main__":
    procesar()
    input("Presioná Enter para salir...")