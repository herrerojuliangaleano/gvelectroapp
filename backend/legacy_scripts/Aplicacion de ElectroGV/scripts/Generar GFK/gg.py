from __future__ import annotations

import io
import re
import tempfile
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from collections import Counter

import pandas as pd
from tkinter import Tk, simpledialog, messagebox

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload


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


SECUENCIA_FILE = BASE_DIR / "gfk_secuencia.txt"
SECUENCIA_INICIAL = 12


# ID de la carpeta del año, por ejemplo la carpeta "2026"
# Dentro de esa carpeta existen:
# - 01-Enero, 02-Febrero, 03-Marzo, etc. -> archivos de ventas
# - GFK/01, GFK/02, GFK/03, etc.         -> salida final
YEAR_FOLDER_ID = "1FU6G8gqqI73DjsrpbseG-0sbzX7_a2YK"

# ID directo del archivo plantilla virgen de GFK
TEMPLATE_FILE_ID = "1H05FfGTE7vU65cjPDZNdXZbF8SYnhlVm4PxnLlEmlus"

# ID directo de la Google Sheet que contiene el catálogo de precios
PRICE_SHEET_ID = "13PUriou-rXu8VnvKN5oe-yTdfTD9WPksVQftgVE5_Js"

PRICE_SHEET_NAME = None

HOJAS_VALIDAS = {
    "Ventas GV Total": "CASEROS",
    "Ventas ABC Canning": "CANNING",
    "Ventas ABC-Norte": "NORTE",
    "Ventas ABC-Sur": "SUR",
}

COLUMNAS_NECESARIAS = [
    "fecha",
    "tipo de venta",
    "marca",
    "tipo",
    "descripcion",
    "sku",
    "cantidad",
]

SALIDA_HEADERS = [
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

COLUMN_SYNONYMS_VENTAS = {
    "fecha": ["fecha", "fecha de venta", "fecha venta"],
    "tipo de venta": ["tipo de venta", "tipo venta", "canal", "modalidad"],
    "marca": ["marca"],
    "tipo": ["tipo"],
    "descripcion": ["descripcion", "descripción", "detalle", "producto"],
    "sku": ["sku", "codigo sku", "código sku", "cod sku", "codigo", "código"],
    "cantidad": ["cantidad", "cant", "cant vendida", "unidades"],
}

COLUMN_SYNONYMS_PRECIOS = {
    "modelo": ["modelo", "sku", "codigo", "código", "referencia", "item"],
    "pvp": ["pvp", "precio", "precio lista", "precio unitario", "valor"],
}

COLUMN_SYNONYMS_PLANTILLA = {
    "Fecha de venta": ["fecha de venta", "fecha"],
    "N°/Nombre de la sucursal": [
        "n°/nombre de la sucursal",
        "nombre / identificacion",
        "nombre / identificación",
        "cus_nickname",
        "sucursal",
        "nickname",
    ],
    "ID del item": ["id del item", "id item"],
    "EAN del item": ["ean del item", "ean"],
    "Descripcion del item": ["descripcion del item", "descripcion", "descripción del item", "description"],
    "Marca del item": ["marca del item", "marca"],
    "Modelo del item": ["modelo del item", "modelo", "sku"],
    "Familia de productos (por ejemplo MDA, Telecom, etc)": ["familia de productos"],
    "Tipo de vendedor (tienda oficial o categoria similar)": ["tipo de vendedor"],
    "Nombre / identificacion del vendedor": ["nombre / identificacion", "nombre / identificación", "identificacion", "identificación"],
    "Moneda de la venta (por ejemplo ARS)": ["moneda de la venta", "moneda"],
    "Precio unitario GMV": ["precio unitario gmv", "gmv"],
    "Cantidad vendida": ["cantidad vendida", "sales units", "cantidad"],
}

MARGEN_PRECIO = 1.10


# ============================================================
# TEXTO, COLUMNAS Y FECHAS
# ============================================================

def normalizar_texto(valor) -> str:
    texto = str(valor).strip().lower()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r"\s+", " ", texto)
    return texto


def escape_drive_query_value(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def quote_sheet_name(sheet_name: str) -> str:
    return "'" + sheet_name.replace("'", "''") + "'"


def col_num_to_letter(col_num: int) -> str:
    letters = ""
    while col_num:
        col_num, rem = divmod(col_num - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def parse_fecha(valor):
    if pd.isna(valor):
        return pd.NaT

    if isinstance(valor, datetime):
        return valor.date()

    if isinstance(valor, date):
        return valor

    if isinstance(valor, (int, float)) and not pd.isna(valor):
        try:
            return pd.to_datetime(valor, unit="D", origin="1899-12-30").date()
        except Exception:
            pass

    texto = str(valor).strip()

    m = re.match(r"^\s*(\d{1,2})\D+(\d{1,2})\D+(\d{4})\s*$", texto)
    if m:
        dia, mes, anio = map(int, m.groups())
        try:
            return date(anio, mes, dia)
        except ValueError:
            return pd.NaT

    dt = pd.to_datetime(texto, errors="coerce", dayfirst=True)
    if pd.isna(dt):
        return pd.NaT
    return dt.date()


def limpiar_columnas(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [normalizar_texto(col) for col in df.columns]
    return df


def obtener_nombre_carpeta_ventas(fecha_ref: date) -> str:
    meses = {
        1: "01-Enero",
        2: "02-Febrero",
        3: "03-Marzo",
        4: "04-Abril",
        5: "05-Mayo",
        6: "06-Junio",
        7: "07-Julio",
        8: "08-Agosto",
        9: "09-Septiembre",
        10: "10-Octubre",
        11: "11-Noviembre",
        12: "12-Diciembre",
    }
    return meses[fecha_ref.month]


def obtener_nombre_carpeta_gfk_mes(fecha_ref: date) -> str:
    return f"{fecha_ref.month:02d}"


def inicio_de_mes(fecha_ref: date) -> date:
    return date(fecha_ref.year, fecha_ref.month, 1)


def fin_de_mes(fecha_ref: date) -> date:
    if fecha_ref.month == 12:
        siguiente_mes = date(fecha_ref.year + 1, 1, 1)
    else:
        siguiente_mes = date(fecha_ref.year, fecha_ref.month + 1, 1)
    return siguiente_mes - timedelta(days=1)


def meses_entre_fechas(fecha_inicio: date, fecha_fin: date):
    actual = inicio_de_mes(fecha_inicio)
    fin = inicio_de_mes(fecha_fin)

    while actual <= fin:
        yield actual
        if actual.month == 12:
            actual = date(actual.year + 1, 1, 1)
        else:
            actual = date(actual.year, actual.month + 1, 1)


def obtener_mes_dominante(fecha_inicio: date, fecha_fin: date) -> date:
    conteo = Counter()
    actual = fecha_inicio

    while actual <= fecha_fin:
        conteo[(actual.year, actual.month)] += 1
        actual += timedelta(days=1)

    (anio, mes), _ = max(conteo.items(), key=lambda x: (x[1], x[0][0], x[0][1]))
    return date(anio, mes, 1)


def transformar_tipo_venta(valor, sucursal: str) -> str:
    texto = str(valor).strip().lower()
    if "local" in texto:
        return f"{sucursal}-LOCAL"
    if "online" in texto or "on line" in texto:
        return f"{sucursal}-ONLINE"
    return f"{sucursal}-OTRO"


def limpiar_modelo(valor) -> str:
    if pd.isna(valor):
        return ""
    texto = str(valor).replace(" (O)", "").strip()
    texto = re.sub(r"\s+", " ", texto)
    return texto


def clave_modelo(valor) -> str:
    return normalizar_texto(limpiar_modelo(valor))


def parse_numero_precio(valor):
    if pd.isna(valor):
        return None

    if isinstance(valor, (int, float)) and not pd.isna(valor):
        return float(valor)

    texto = str(valor).strip()
    if not texto:
        return None

    texto = re.sub(r"[^\d,.\-]", "", texto)

    if "," in texto and "." in texto:
        if texto.rfind(",") > texto.rfind("."):
            texto = texto.replace(".", "").replace(",", ".")
        else:
            texto = texto.replace(",", "")

    elif "," in texto:
        texto = texto.replace(".", "").replace(",", ".")

    elif "." in texto:
        partes = texto.split(".")
        if len(partes) > 2:
            texto = "".join(partes)
        elif len(partes) == 2 and len(partes[1]) == 3:
            texto = "".join(partes)

    try:
        return float(texto)
    except Exception:
        return None


# ============================================================
# AUTENTICACIÓN GOOGLE
# ============================================================

def autenticar_google():
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError("No encontré credentials.json junto al script.")
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    drive_service = build("drive", "v3", credentials=creds)
    sheets_service = build("sheets", "v4", credentials=creds)
    return drive_service, sheets_service


# ============================================================
# DRIVE
# ============================================================

def buscar_carpeta_por_nombre(drive_service, parent_id: str, folder_name: str):
    folder_name = escape_drive_query_value(folder_name)

    query = (
        f"name = '{folder_name}' "
        f"and '{parent_id}' in parents "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )

    resp = drive_service.files().list(
        q=query,
        fields="files(id,name)",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
        pageSize=10,
    ).execute()

    files = resp.get("files", [])
    if not files:
        raise FileNotFoundError(f"No encontré la carpeta '{folder_name}'")

    return files[0]


def obtener_o_crear_carpeta(drive_service, parent_id: str, folder_name: str):
    try:
        return buscar_carpeta_por_nombre(drive_service, parent_id, folder_name)
    except FileNotFoundError:
        return drive_service.files().create(
            body={
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [parent_id],
            },
            fields="id,name",
            supportsAllDrives=True,
        ).execute()


def buscar_archivo_por_nombre_parcial(drive_service, folder_id: str, texto: str):
    texto = escape_drive_query_value(texto)

    query = (
        f"name contains '{texto}' "
        f"and '{folder_id}' in parents "
        f"and trashed = false"
    )

    resp = drive_service.files().list(
        q=query,
        fields="files(id,name,mimeType,modifiedTime)",
        orderBy="modifiedTime desc",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
        pageSize=10,
    ).execute()

    files = resp.get("files", [])
    if not files:
        raise FileNotFoundError(f"No encontré un archivo que contenga '{texto}' dentro de esa carpeta.")

    return files[0]


def descargar_o_exportar_a_temporal(drive_service, file_meta) -> Path:
    file_id = file_meta["id"]
    mime_type = file_meta.get("mimeType", "")
    name = file_meta.get("name", "archivo")

    if mime_type == "application/vnd.google-apps.spreadsheet":
        request = drive_service.files().export_media(
            fileId=file_id,
            mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        suffix = ".xlsx"
    else:
        request = drive_service.files().get_media(fileId=file_id)
        suffix = Path(name).suffix if Path(name).suffix else ".xlsx"

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = Path(temp.name)
    temp.close()

    fh = io.FileIO(temp_path, "wb")
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    fh.close()

    return temp_path


def copiar_plantilla_a_destino(drive_service, template_file_id: str, output_name: str, dest_folder_id: str):
    created = drive_service.files().copy(
        fileId=template_file_id,
        body={
            "name": output_name,
            "parents": [dest_folder_id],
        },
        supportsAllDrives=True,
    ).execute()
    return created["id"]


# ============================================================
# SHEETS: PRECIOS
# ============================================================

def obtener_primera_hoja(sheets_service, spreadsheet_id: str) -> str:
    meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(title,index))",
    ).execute()

    sheets = meta.get("sheets", [])
    if not sheets:
        raise ValueError("La planilla no tiene hojas.")

    sheets_sorted = sorted(sheets, key=lambda x: x["properties"].get("index", 0))
    return sheets_sorted[0]["properties"]["title"]


def detectar_fila_header_por_sinonimos(
    df_raw: pd.DataFrame,
    synonyms_map: dict[str, list[str]],
    score_min: int,
    max_filas: int = 20,
) -> int:
    mejor_idx = None
    mejor_score = -1

    limite = min(max_filas, len(df_raw))
    for i in range(limite):
        fila = []
        for celda in df_raw.iloc[i].tolist():
            if pd.isna(celda):
                fila.append("")
            else:
                fila.append(normalizar_texto(celda))

        score = 0
        for _, syns in synonyms_map.items():
            if any(any(syn in celda for syn in syns) for celda in fila):
                score += 1

        if score > mejor_score:
            mejor_score = score
            mejor_idx = i

        if score >= score_min:
            return i

    if mejor_idx is None or mejor_score < score_min:
        raise ValueError("No se pudo detectar la fila de encabezados.")

    return mejor_idx


def renombrar_columnas_por_sinonimos(df: pd.DataFrame, synonyms_map: dict[str, list[str]]) -> pd.DataFrame:
    renombres = {}

    for col in df.columns:
        col_norm = normalizar_texto(col)
        for canonical, syns in synonyms_map.items():
            if any(syn in col_norm for syn in syns):
                renombres[col] = canonical
                break

    return df.rename(columns=renombres)


def reconstruir_dataframe_desde_header(
    df_raw: pd.DataFrame,
    synonyms_map: dict[str, list[str]],
    score_min: int,
) -> pd.DataFrame:
    header_idx = detectar_fila_header_por_sinonimos(
        df_raw=df_raw,
        synonyms_map=synonyms_map,
        score_min=score_min,
    )

    df = df_raw.iloc[header_idx:].copy()
    df.columns = df.iloc[0]
    df = df.iloc[1:].reset_index(drop=True)

    df.columns = [normalizar_texto(col) for col in df.columns]
    df = renombrar_columnas_por_sinonimos(df, synonyms_map)
    return df


def cargar_mapa_precios(sheets_service) -> dict[str, float]:
    price_sheet_name = PRICE_SHEET_NAME or obtener_primera_hoja(sheets_service, PRICE_SHEET_ID)

    resp = sheets_service.spreadsheets().values().get(
        spreadsheetId=PRICE_SHEET_ID,
        range=f"{quote_sheet_name(price_sheet_name)}!A:Z",
    ).execute()

    values = resp.get("values", [])
    if not values:
        raise ValueError("La planilla de precios está vacía.")

    df_raw = pd.DataFrame(values)

    df = reconstruir_dataframe_desde_header(
        df_raw=df_raw,
        synonyms_map=COLUMN_SYNONYMS_PRECIOS,
        score_min=2,
    )

    faltantes = [col for col in ("modelo", "pvp") if col not in df.columns]
    if faltantes:
        raise ValueError("La planilla de precios no tiene las columnas necesarias: " + ", ".join(faltantes))

    df["modelo_limpio"] = df["modelo"].apply(limpiar_modelo)
    df["pvp_num"] = df["pvp"].apply(parse_numero_precio)

    df = df.dropna(subset=["modelo_limpio"])
    df = df[df["modelo_limpio"] != ""]
    df = df.dropna(subset=["pvp_num"])

    df = df.drop_duplicates(subset=["modelo_limpio"], keep="last")

    mapa = {}
    for _, row in df.iterrows():
        mapa[clave_modelo(row["modelo_limpio"])] = float(row["pvp_num"])

    return mapa


def calcular_precio_gmv(modelo_limpio: str, price_map: dict[str, float]):
    pvp = price_map.get(clave_modelo(modelo_limpio))
    if pvp is None:
        return "NA"
    return round(pvp * MARGEN_PRECIO, 2)


# ============================================================
# LECTURA Y TRANSFORMACIÓN DEL ARCHIVO DE VENTAS
# ============================================================

def leer_ventas_desde_archivo(
    local_path: Path,
    fecha_inicio: date,
    fecha_fin: date,
    price_map: dict[str, float],
) -> pd.DataFrame:
    excel = pd.ExcelFile(local_path)
    resultados = []

    for hoja, sucursal in HOJAS_VALIDAS.items():
        if hoja not in excel.sheet_names:
            print(f"⚠ Hoja no encontrada: {hoja}")
            continue

        print(f"Procesando hoja: {hoja}")

        df_raw = excel.parse(hoja, header=None)

        try:
            df = reconstruir_dataframe_desde_header(
                df_raw=df_raw,
                synonyms_map=COLUMN_SYNONYMS_VENTAS,
                score_min=4,
            )
        except Exception as e:
            print(f"⚠ No se pudo detectar encabezado en {hoja}: {e}")
            continue

        faltantes = [col for col in COLUMNAS_NECESARIAS if col not in df.columns]
        if faltantes:
            print(f"⚠ Columnas faltantes en {hoja}: {faltantes}")
            print("Columnas detectadas:", df.columns.tolist())
            continue

        df = df.dropna(how="all")

        df["fecha_limpia"] = df["fecha"].apply(parse_fecha)
        df = df.dropna(subset=["fecha_limpia"])

        df = df[
            (df["fecha_limpia"] >= fecha_inicio) &
            (df["fecha_limpia"] <= fecha_fin)
        ]

        if df.empty:
            print(f"ℹ Sin datos en {hoja} para ese rango")
            continue

        modelo_limpio = df["sku"].apply(limpiar_modelo)
        precio_gmv = modelo_limpio.apply(lambda x: calcular_precio_gmv(x, price_map))

        salida = pd.DataFrame({
            "Fecha de venta": df["fecha_limpia"],
            "N°/Nombre de la sucursal": df["tipo de venta"].apply(lambda x: transformar_tipo_venta(x, sucursal)),
            "ID del item": "",
            "EAN del item": "",
            "Descripcion del item": df["descripcion"],
            "Marca del item": df["marca"],
            "Modelo del item": modelo_limpio,
            "Familia de productos (por ejemplo MDA, Telecom, etc)": "",
            "Tipo de vendedor (tienda oficial o categoria similar)": "",
            "Nombre / identificacion del vendedor": "",
            "Moneda de la venta (por ejemplo ARS)": "ARS",
            "Precio unitario GMV": precio_gmv,
            "Cantidad vendida": df["cantidad"],
        })

        resultados.append(salida)

    if resultados:
        df_final = pd.concat(resultados, ignore_index=True)
    else:
        df_final = pd.DataFrame(columns=SALIDA_HEADERS)

    return df_final[SALIDA_HEADERS]


# ============================================================
# ESCRITURA EN GFK
# ============================================================

def obtener_hoja_destino(sheets_service, spreadsheet_id: str) -> str:
    meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(title,index))",
    ).execute()

    sheets = meta.get("sheets", [])
    if not sheets:
        raise ValueError("La plantilla no tiene hojas.")

    sheets_sorted = sorted(sheets, key=lambda x: x["properties"].get("index", 0))
    return sheets_sorted[0]["properties"]["title"]


def renombrar_hoja_con_rango(
    sheets_service,
    spreadsheet_id: str,
    current_sheet_name: str,
    fecha_inicio: date,
    fecha_fin: date,
) -> str:
    """
    Renombra la hoja con el formato:
    23-03 AL 29-03
    """
    nuevo_nombre = f"{fecha_inicio.day:02d}-{fecha_inicio.month:02d} AL {fecha_fin.day:02d}-{fecha_fin.month:02d}"

    meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id
    ).execute()

    sheet_id = None
    for s in meta.get("sheets", []):
        props = s.get("properties", {})
        if props.get("title") == current_sheet_name:
            sheet_id = props.get("sheetId")
            break

    if sheet_id is None:
        raise ValueError("No se encontró la hoja para renombrar.")

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sheet_id,
                            "title": nuevo_nombre,
                        },
                        "fields": "title",
                    }
                }
            ]
        },
    ).execute()

    print(f"✅ Hoja renombrada a: {nuevo_nombre}")
    return nuevo_nombre


def obtener_mapeo_columnas_plantilla(sheets_service, spreadsheet_id: str, sheet_name: str) -> dict[str, str]:
    """
    Lee la fila 3 de la plantilla y detecta en qué columna real está cada
    encabezado lógico de salida.
    Devuelve un mapping: {encabezado_canonico: letra_columna}
    """
    sheet_q = quote_sheet_name(sheet_name)

    resp = sheets_service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_q}!A3:ZZ3",
    ).execute()

    headers = resp.get("values", [[]])[0] if resp.get("values") else []
    headers_norm = [normalizar_texto(h) for h in headers]

    mapping = {}

    for canonical, synonyms in COLUMN_SYNONYMS_PLANTILLA.items():
        found_idx = None
        for idx, header_norm in enumerate(headers_norm):
            if not header_norm:
                continue
            if any(syn in header_norm for syn in synonyms):
                found_idx = idx
                break

        if found_idx is not None:
            mapping[canonical] = col_num_to_letter(found_idx + 1)

    faltantes = [col for col in SALIDA_HEADERS if col not in mapping]
    if faltantes:
        raise ValueError(
            "No se pudieron ubicar estas columnas en la fila 3 de la plantilla:\n- "
            + "\n- ".join(faltantes)
        )

    return mapping


def limpiar_hoja_datos(sheets_service, spreadsheet_id: str, sheet_name: str, mapping: dict[str, str]):
    """
    Limpia solo desde la fila 4 hacia abajo en las columnas que vamos a escribir.
    Mantiene filas 1, 2 y 3 intactas.
    """
    sheet_q = quote_sheet_name(sheet_name)

    ranges = [f"{sheet_q}!{col_letter}4:{col_letter}1048576" for col_letter in mapping.values()]
    if not ranges:
        return

    sheets_service.spreadsheets().values().batchClear(
        spreadsheetId=spreadsheet_id,
        body={"ranges": ranges},
    ).execute()


def escribir_dataframe_en_sheet(
    sheets_service,
    spreadsheet_id: str,
    sheet_name: str,
    df: pd.DataFrame,
    mapping: dict[str, str],
):
    """
    Escribe los datos alineados con la plantilla real:
    - filas 1 y 2 intactas
    - fila 3 con headers intactos
    - datos desde fila 4

    Si algo falla, aplica fallback y escribe todo desde fila 3.
    """
    if df.empty:
        print("ℹ No hay datos para escribir")
        return

    df = df.copy()

    if "Fecha de venta" in df.columns:
        df["Fecha de venta"] = df["Fecha de venta"].apply(
            lambda x: x.strftime("%d/%m/%Y") if isinstance(x, (date, datetime)) else x
        )

    row_count = len(df)

    try:
        data = []
        for canonical_col in SALIDA_HEADERS:
            col_letter = mapping[canonical_col]

            serie = df[canonical_col] if canonical_col in df.columns else pd.Series([""] * row_count)
            col_values = []

            for val in serie.tolist():
                if pd.isna(val):
                    val = ""
                if isinstance(val, (date, datetime)):
                    val = val.strftime("%d/%m/%Y")
                col_values.append([val])

            data.append(
                {
                    "range": f"{quote_sheet_name(sheet_name)}!{col_letter}4:{col_letter}{3 + row_count}",
                    "values": col_values,
                }
            )

        sheets_service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "valueInputOption": "RAW",
                "data": data,
            },
        ).execute()

        print("✅ Datos escritos correctamente, alineados con la plantilla")

    except Exception as e:
        print("⚠ Error en estructura, aplicando fallback...")
        print("Detalle:", str(e))

        values = [SALIDA_HEADERS]

        for _, row in df.iterrows():
            fila = []
            for col in SALIDA_HEADERS:
                val = row[col] if col in row else ""
                if pd.isna(val):
                    val = ""
                if isinstance(val, (date, datetime)):
                    val = val.strftime("%d/%m/%Y")
                fila.append(val)
            values.append(fila)

        end_row = 3 + len(values) - 1

        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{quote_sheet_name(sheet_name)}!A3:M{end_row}",
            valueInputOption="RAW",
            body={"values": values},
        ).execute()

        print("⚠ Datos escritos en fallback desde fila 3")


# ============================================================
# CORRELATIVO
# ============================================================

def obtener_secuencia_actual() -> int:
    if SECUENCIA_FILE.exists():
        try:
            contenido = SECUENCIA_FILE.read_text(encoding="utf-8").strip()
            match = re.search(r"\d+", contenido)
            if match:
                return int(match.group())
        except Exception:
            pass
    return SECUENCIA_INICIAL


def guardar_siguiente_secuencia(siguiente_numero: int) -> None:
    SECUENCIA_FILE.write_text(str(siguiente_numero), encoding="utf-8")


# ============================================================
# INPUTS
# ============================================================

def pedir_fecha(titulo: str, texto: str):
    while True:
        valor = simpledialog.askstring(titulo, texto)
        if valor is None:
            return None

        fecha = parse_fecha(valor)
        if pd.isna(fecha):
            messagebox.showerror("Fecha inválida", f"No pude leer la fecha: {valor}")
            continue

        return fecha


# ============================================================
# MAIN
# ============================================================

def main():
    root = Tk()
    root.withdraw()

    try:
        drive_service, sheets_service = autenticar_google()

        price_map = cargar_mapa_precios(sheets_service)
        print(f"Mapa de precios cargado: {len(price_map)} productos")

        fecha_inicio = pedir_fecha(
            "Fecha inicio",
            "Ingresá fecha inicio (ej: 23/03/2026 o 23-3-2026):"
        )
        if fecha_inicio is None:
            return

        fecha_fin = pedir_fecha(
            "Fecha fin",
            "Ingresá fecha fin (ej: 29/03/2026 o 29-3-2026):"
        )
        if fecha_fin is None:
            return

        if fecha_fin < fecha_inicio:
            messagebox.showerror("Error", "La fecha fin no puede ser menor que la fecha inicio.")
            return

        dfs = []

        for mes_ref in meses_entre_fechas(fecha_inicio, fecha_fin):
            nombre_carpeta_ventas = obtener_nombre_carpeta_ventas(mes_ref)
            print(f"Buscando carpeta de ventas: {nombre_carpeta_ventas}")

            carpeta_ventas_mes = buscar_carpeta_por_nombre(
                drive_service,
                YEAR_FOLDER_ID,
                nombre_carpeta_ventas,
            )
            print(f"Carpeta de ventas encontrada: {carpeta_ventas_mes['name']}")

            archivo_ventas = buscar_archivo_por_nombre_parcial(
                drive_service,
                carpeta_ventas_mes["id"],
                "Ventas Vs. Costos",
            )
            print(f"Archivo de ventas encontrado: {archivo_ventas['name']}")

            temp_ventas = descargar_o_exportar_a_temporal(drive_service, archivo_ventas)

            try:
                rango_inicio = max(fecha_inicio, inicio_de_mes(mes_ref))
                rango_fin = min(fecha_fin, fin_de_mes(mes_ref))

                df_mes = leer_ventas_desde_archivo(
                    temp_ventas,
                    rango_inicio,
                    rango_fin,
                    price_map,
                )

                if not df_mes.empty:
                    dfs.append(df_mes)

            finally:
                try:
                    temp_ventas.unlink(missing_ok=True)
                except Exception:
                    pass

        if dfs:
            df_final = pd.concat(dfs, ignore_index=True)
        else:
            df_final = pd.DataFrame(columns=SALIDA_HEADERS)

        secuencia_actual = obtener_secuencia_actual()

        nombre_salida = (
            f"{secuencia_actual}-Electro GV-ABC - GFK del "
            f"{fecha_inicio.day:02d}#{fecha_inicio.month:02d} al "
            f"{fecha_fin.day:02d}#{fecha_fin.month:02d}"
        )

        carpeta_gfk = obtener_o_crear_carpeta(drive_service, YEAR_FOLDER_ID, "GFK")

        fecha_carpeta = obtener_mes_dominante(fecha_inicio, fecha_fin)
        nombre_carpeta_gfk_mes = obtener_nombre_carpeta_gfk_mes(fecha_carpeta)

        carpeta_gfk_mes = obtener_o_crear_carpeta(
            drive_service,
            carpeta_gfk["id"],
            nombre_carpeta_gfk_mes,
        )
        print(f"Destino final: GFK/{carpeta_gfk_mes['name']}")

        spreadsheet_id = copiar_plantilla_a_destino(
            drive_service,
            TEMPLATE_FILE_ID,
            nombre_salida,
            carpeta_gfk_mes["id"],
        )

        sheet_name = obtener_hoja_destino(sheets_service, spreadsheet_id)
        sheet_name = renombrar_hoja_con_rango(
            sheets_service,
            spreadsheet_id,
            sheet_name,
            fecha_inicio,
            fecha_fin,
        )

        mapping_plantilla = obtener_mapeo_columnas_plantilla(
            sheets_service,
            spreadsheet_id,
            sheet_name,
        )

        print("Mapeo de columnas detectado:")
        for k, v in mapping_plantilla.items():
            print(f"  {k} -> {v}")

        limpiar_hoja_datos(
            sheets_service,
            spreadsheet_id,
            sheet_name,
            mapping_plantilla,
        )

        escribir_dataframe_en_sheet(
            sheets_service,
            spreadsheet_id,
            sheet_name,
            df_final,
            mapping_plantilla,
        )

        guardar_siguiente_secuencia(secuencia_actual + 1)

        sin_precio = df_final[
            (df_final["Precio unitario GMV"] == "NA") &
            (df_final["Modelo del item"].astype(str).str.strip() != "")
        ]

        if not sin_precio.empty:
            modelos_sin_precio = sorted(set(sin_precio["Modelo del item"].astype(str).tolist()))
            print(f"⚠ Modelos sin precio encontrado: {len(modelos_sin_precio)}")
            for m in modelos_sin_precio[:20]:
                print(f"   - {m}")

        messagebox.showinfo(
            "Listo",
            f"Archivo generado correctamente en Drive:\n{nombre_salida}"
        )

        print(f"✅ Archivo generado: {nombre_salida}")
        print(f"✅ Spreadsheet ID: {spreadsheet_id}")

    except Exception as e:
        messagebox.showerror("Error", str(e))
        raise


if __name__ == "__main__":
    main()