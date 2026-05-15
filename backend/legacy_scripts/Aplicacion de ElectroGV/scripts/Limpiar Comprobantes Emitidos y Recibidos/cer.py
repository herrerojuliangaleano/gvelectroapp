from __future__ import annotations

from pathlib import Path
from datetime import date, datetime
import argparse
import re
import sys
import unicodedata
from typing import Any

import pandas as pd

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# =========================================================
# CREDENCIALES UNIFICADAS
# =========================================================
# En ejecución web el runner copia credentials.json/token.json en la raíz
# de "Aplicacion de ElectroGV". En ejecución manual funciona igual que antes.
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
BASE_DIR = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()

CUITS_SUCURSAL = {
    "GV": "30717199207",
    "ABC": "30717985598",
}

DRIVE_FOLDER_IDS = {
    "ABC": "1sGgBzuXjJz-FCIqUZnFWLS31IgokxG57",
    "GV": "1jMjsrwY_-eWBrfOwIHcdNQ3e_oz0E0c8",
}

PATRON_VENTAS = "emitidos"    # cualquier archivo que tenga "emitidos" en el nombre
PATRON_COMPRAS = "recibidos"  # cualquier archivo que tenga "recibidos" en el nombre
EXTENSIONES_VALIDAS = {".csv", ".xlsx", ".xls"}
GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet"

# =========================================================
# UTILIDADES DE TEXTO
# =========================================================
def quitar_tildes(texto: str) -> str:
    texto = str(texto)
    texto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in texto if not unicodedata.combining(c))


def texto_compacto(valor: object) -> str:
    if pd.isna(valor):
        return ""
    texto = quitar_tildes(str(valor)).lower().strip()
    return re.sub(r"[^a-z0-9]+", "", texto)


def normalizar_columnas(df: pd.DataFrame) -> pd.DataFrame:
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
    claves = [texto_compacto(p) for p in palabras_clave]
    limite = min(max_filas, len(df))

    for i in range(limite):
        fila = " ".join(texto_compacto(v) for v in df.iloc[i].tolist())
        if not fila:
            continue
        if all(clave in fila for clave in claves):
            return i

    return None


def to_numero(serie: pd.Series) -> pd.Series:
    s = serie.astype(str).str.strip()

    mask_eu = s.str.contains(",", regex=False, na=False)

    s.loc[mask_eu] = (
        s.loc[mask_eu]
        .str.replace(".", "", regex=False)
        .str.replace(",", ".", regex=False)
    )

    return pd.to_numeric(s, errors="coerce")


def df_a_valores(df: pd.DataFrame) -> list[list[Any]]:
    def convertir(v: Any) -> Any:
        if pd.isna(v):
            return ""
        if isinstance(v, (pd.Timestamp, date)):
            return v.isoformat()
        if hasattr(v, "item"):
            try:
                v = v.item()
            except Exception:
                pass
        return v

    salida = [list(df.columns)]
    for _, row in df.iterrows():
        salida.append([convertir(v) for v in row.tolist()])
    return salida


def escapo_nombre_hoja(nombre: str) -> str:
    return nombre.replace("'", "''")

# =========================================================
# GOOGLE AUTH / SERVICES
# =========================================================
def obtener_creds() -> Credentials:
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    f"No se encontró {CREDENTIALS_FILE}. "
                    "Asegurate de tener credentials.json en la raíz de Aplicacion de ElectroGV."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def crear_services():
    creds = obtener_creds()
    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return drive_service, sheets_service

# =========================================================
# BÚSQUEDA AUTOMÁTICA DE ARCHIVOS
# =========================================================
def buscar_archivos_por_patron(
    base_dir: Path,
    cuit: str,
    patron_nombre: str,
) -> list[Path]:
    """Busca archivos que contengan cuit y patron_nombre en el nombre, en cualquier extensión válida."""
    patron_compacto = texto_compacto(patron_nombre)
    cuit_compacto = texto_compacto(cuit)

    candidatos = []
    for p in base_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in EXTENSIONES_VALIDAS:
            continue
        if p.name.startswith("~$"):
            continue
        if p.name.lower().startswith("reporte"):
            continue

        nombre_compacto = texto_compacto(p.stem)
        if cuit_compacto in nombre_compacto and patron_compacto in nombre_compacto:
            candidatos.append(p)

    candidatos.sort(key=lambda x: (x.stat().st_mtime, x.name), reverse=True)
    return candidatos


def elegir_mas_reciente(candidatos: list[Path], etiqueta: str) -> Path | None:
    if not candidatos:
        return None
    if len(candidatos) > 1:
        print(f"[AVISO] Varios archivos candidatos para {etiqueta}. Se usará el más reciente:")
        for c in candidatos:
            print(f"        - {c.name}")
    return candidatos[0]


def detectar_archivos_por_sucursal(base_dir: Path) -> dict[str, dict[str, Path]]:
    resultado: dict[str, dict[str, Path]] = {}

    for sucursal, cuit in CUITS_SUCURSAL.items():
        ventas_candidatos = buscar_archivos_por_patron(base_dir, cuit, PATRON_VENTAS)
        compras_candidatos = buscar_archivos_por_patron(base_dir, cuit, PATRON_COMPRAS)

        print(f"[INFO] {sucursal} (emitidos/ventas):  {[p.name for p in ventas_candidatos] or '(ninguno)'}")
        print(f"[INFO] {sucursal} (recibidos/compras): {[p.name for p in compras_candidatos] or '(ninguno)'}")

        ventas_path = elegir_mas_reciente(ventas_candidatos, f"emitidos {sucursal}")
        compras_path = elegir_mas_reciente(compras_candidatos, f"recibidos {sucursal}")

        if ventas_path or compras_path:
            resultado[sucursal] = {}
            if ventas_path:
                resultado[sucursal]["ventas"] = ventas_path
            if compras_path:
                resultado[sucursal]["compras"] = compras_path

    return resultado

# =========================================================
# LECTURA DE ARCHIVOS
# =========================================================
def leer_csv_robusto(ruta: Path) -> pd.DataFrame:
    codificaciones = ["utf-8-sig", "utf-8", "cp1252", "latin1"]
    ultimo_error = None
    for enc in codificaciones:
        try:
            return pd.read_csv(ruta, sep=None, engine="python", dtype=str, encoding=enc)
        except Exception as e:
            ultimo_error = e
    raise ValueError(f"No se pudo leer el CSV {ruta.name}. Último error: {ultimo_error}")


def _normalizar_emitidos(df: pd.DataFrame, origen: str) -> pd.DataFrame:
    """Normaliza un DataFrame de emitidos detectando el encabezado si es necesario."""
    columnas_necesarias = {"tipo_de_comprobante", "imp_neto_gravado_total", "total_iva", "imp_total"}
    df = normalizar_columnas(df)
    if columnas_necesarias.issubset(df.columns):
        return df
    # Intentar detectar encabezado desplazado
    raw = df.copy()
    raw = raw.dropna(how="all")
    header_row = detectar_fila_encabezado(raw, ["tipo", "comprobante", "neto", "gravado", "iva", "total"], max_filas=25)
    if header_row is None:
        raise ValueError(f"No se detectó encabezado de emitidos en {origen}. Columnas: {list(df.columns)}")
    raw.columns = raw.iloc[header_row]
    df = raw.iloc[header_row + 1:].copy().reset_index(drop=True)
    df = normalizar_columnas(df)
    if not columnas_necesarias.issubset(df.columns):
        raise ValueError(f"Emitidos: columnas esperadas no encontradas en {origen}. Columnas: {list(df.columns)}")
    return df


def leer_emitidos(ruta: Path) -> pd.DataFrame:
    """Lee un archivo de emitidos (ventas) en CSV o Excel."""
    ext = ruta.suffix.lower()
    if ext == ".csv":
        raw = leer_csv_robusto(ruta)
    elif ext in {".xlsx", ".xls"}:
        raw = pd.read_excel(ruta, header=None, dtype=str)
    else:
        raise ValueError(f"Formato no soportado para emitidos: {ruta.name}")
    return _normalizar_emitidos(raw, ruta.name)


def leer_recibidos(ruta: Path) -> pd.DataFrame:
    """Lee un archivo de recibidos (compras) en CSV o Excel, unificando todas las hojas."""
    ext = ruta.suffix.lower()
    partes = []
    hojas_usadas = []

    if ext == ".csv":
        raw = leer_csv_robusto(ruta)
        raw = normalizar_columnas(raw)
        col_tipo = buscar_columna_flexible(raw, ["tipo"])
        col_iva = buscar_columna_flexible(raw, ["total_iva", "total iva", "iva"])
        if not col_tipo or not col_iva:
            raise ValueError(f"Recibidos CSV: no se encontraron columnas 'Tipo' y 'Total IVA' en {ruta.name}.")
        df = raw.rename(columns={col_tipo: "tipo", col_iva: "total_iva"})[["tipo", "total_iva"]].copy()
        partes.append(df)
        hojas_usadas.append("(csv)")
    elif ext in {".xlsx", ".xls"}:
        xls = pd.ExcelFile(ruta)
        for hoja in xls.sheet_names:
            try:
                bruto = pd.read_excel(ruta, sheet_name=hoja, header=None, dtype=str)
                bruto = bruto.dropna(how="all")
                header_row = detectar_fila_encabezado(bruto, ["tipo", "total", "iva"], max_filas=30)
                if header_row is None:
                    print(f"[INFO] Hoja ignorada: {hoja} (sin encabezado útil)")
                    continue
                bruto.columns = bruto.iloc[header_row]
                df = bruto.iloc[header_row + 1:].copy().reset_index(drop=True)
                df = normalizar_columnas(df)
                col_tipo = buscar_columna_flexible(df, ["tipo"])
                col_iva = buscar_columna_flexible(df, ["total_iva", "total iva", "iva"])
                if not col_tipo or not col_iva:
                    print(f"[INFO] Hoja ignorada: {hoja} (faltan columnas tipo/iva)")
                    continue
                df = df.rename(columns={col_tipo: "tipo", col_iva: "total_iva"})[["tipo", "total_iva"]].copy()
                partes.append(df)
                hojas_usadas.append(hoja)
            except Exception as e:
                print(f"[AVISO] No se pudo leer la hoja {hoja}: {e}")
    else:
        raise ValueError(f"Formato no soportado para recibidos: {ruta.name}")

    if not partes:
        raise ValueError(f"No se encontró ninguna hoja válida con columnas 'Tipo' y 'Total IVA' en {ruta.name}.")

    print(f"[INFO] Hojas de recibidos usadas en {ruta.name}: {hojas_usadas}")
    return pd.concat(partes, ignore_index=True)

    print(f"[INFO] Hojas de compras usadas: {hojas_usadas}")
    return pd.concat(partes, ignore_index=True)

# =========================================================
# CÁLCULOS - COPIA FIEL DEL ORIGINAL
# =========================================================
def calcular_ventas(df: pd.DataFrame) -> pd.DataFrame:
    columnas = {
        "tipo_de_comprobante",
        "imp_neto_gravado_total",
        "total_iva",
        "imp_total",
    }

    faltantes = columnas - set(df.columns)
    if faltantes:
        raise ValueError(
            f"Ventas: faltan columnas requeridas: {sorted(faltantes)}\n"
            f"Columnas encontradas: {list(df.columns)}"
        )

    ventas = df.copy()

    ventas["tipo_de_comprobante"] = pd.to_numeric(
        ventas["tipo_de_comprobante"].astype(str).str.strip(),
        errors="coerce"
    )
    ventas["imp_neto_gravado_total"] = to_numero(ventas["imp_neto_gravado_total"])
    ventas["total_iva"] = to_numero(ventas["total_iva"])
    ventas["imp_total"] = to_numero(ventas["imp_total"])

    mask_b = ventas["tipo_de_comprobante"].isin([3, 8])
    mask_a = ventas["tipo_de_comprobante"].notna() & ~mask_b

    suma_a = ventas.loc[mask_a, ["imp_neto_gravado_total", "total_iva", "imp_total"]].sum(numeric_only=True)
    suma_b = ventas.loc[mask_b, ["imp_neto_gravado_total", "total_iva", "imp_total"]].sum(numeric_only=True)

    resultado = pd.DataFrame({
        "Concepto": [
            "Resto de comprobantes",
            "Comprobantes 3 y 8",
            "Diferencia (resto - 3 y 8)",
        ],
        "Imp. Neto Gravado Total": [
            suma_a["imp_neto_gravado_total"],
            suma_b["imp_neto_gravado_total"],
            suma_a["imp_neto_gravado_total"] - suma_b["imp_neto_gravado_total"],
        ],
        "Total IVA": [
            suma_a["total_iva"],
            suma_b["total_iva"],
            suma_a["total_iva"] - suma_b["total_iva"],
        ],
        "Imp. Total": [
            suma_a["imp_total"],
            suma_b["imp_total"],
            suma_a["imp_total"] - suma_b["imp_total"],
        ],
    })

    print(f"[INFO] Ventas: filas resto = {mask_a.sum()}")
    print(f"[INFO] Ventas: filas 3 y 8 = {mask_b.sum()}")

    return resultado.round(2)


def calcular_compras(df: pd.DataFrame) -> pd.DataFrame:
    columnas = {"tipo", "total_iva"}

    faltantes = columnas - set(df.columns)
    if faltantes:
        raise ValueError(
            f"Compras: faltan columnas requeridas: {sorted(faltantes)}\n"
            f"Columnas encontradas: {list(df.columns)}"
        )

    compras = df.copy()

    compras["tipo"] = compras["tipo"].astype(str).str.strip()
    compras["total_iva"] = to_numero(compras["total_iva"])

    valor_especial = "3 - Nota de Crédito A"

    mask_b = compras["tipo"] == valor_especial
    mask_a = compras["tipo"].notna() & (compras["tipo"] != "") & ~mask_b

    iva_a = compras.loc[mask_a, "total_iva"].sum(skipna=True)
    iva_b = compras.loc[mask_b, "total_iva"].sum(skipna=True)

    resultado = pd.DataFrame({
        "Concepto": [
            "Resto de tipos",
            valor_especial,
            "Diferencia (resto - nota crédito)",
        ],
        "Total IVA": [
            iva_a,
            iva_b,
            iva_a - iva_b,
        ],
    })

    print(f"[INFO] Compras: filas resto = {mask_a.sum()}")
    print(f"[INFO] Compras: filas tipo especial = {mask_b.sum()}")

    return resultado.round(2)

# =========================================================
# GOOGLE SHEETS
# =========================================================
def crear_google_sheet_en_drive(drive_service, titulo: str, folder_id: str) -> str:
    metadata = {
        "name": titulo,
        "mimeType": GOOGLE_SHEETS_MIME,
        "parents": [folder_id],
    }

    file = drive_service.files().create(
        body=metadata,
        fields="id",
        supportsAllDrives=True,
    ).execute()

    return file["id"]


def escribir_hoja(sheets_service, spreadsheet_id: str, nombre_hoja: str, df: pd.DataFrame) -> None:
    valores = df_a_valores(df)
    rango = f"'{escapo_nombre_hoja(nombre_hoja)}'!A1"

    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=rango,
        valueInputOption="RAW",
        body={"majorDimension": "ROWS", "values": valores},
    ).execute()


def obtener_mapas_hojas(sheets_service, spreadsheet_id: str) -> dict[str, int]:
    meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties",
    ).execute()

    mapa = {}
    for sh in meta.get("sheets", []):
        props = sh.get("properties", {})
        titulo = props.get("title")
        sid = props.get("sheetId")
        if titulo is not None and sid is not None:
            mapa[titulo] = sid
    return mapa


def aplicar_formato_hoja(sheets_service, spreadsheet_id: str, sheet_id: int, n_cols: int, n_rows: int) -> None:
    requests = [
        {
            "updateSheetProperties": {
                "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }
        },
        {
            "repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {"red": 0.85, "green": 0.91, "blue": 0.97},
                        "textFormat": {"bold": True},
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
            }
        },
        {
            "autoResizeDimensions": {
                "dimensions": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": n_cols}
            }
        },
    ]

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
                    "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": "#,##0.00"}}},
                    "fields": "userEnteredFormat.numberFormat",
                }
            }
        )

    sheets_service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()


def preparar_spreadsheet(sheets_service, spreadsheet_id: str, nombre_hoja_ventas: str = "Ventas", nombre_hoja_compras: str = "Compras") -> tuple[int, int]:
    meta = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties.sheetId,sheets.properties.title",
    ).execute()

    sheets = meta.get("sheets", [])
    if not sheets:
        raise ValueError("El spreadsheet no tiene hojas.")

    sheet_inicial_id = sheets[0]["properties"]["sheetId"]

    requests = [
        {"updateSheetProperties": {"properties": {"sheetId": sheet_inicial_id, "title": nombre_hoja_ventas}, "fields": "title"}},
        {"addSheet": {"properties": {"title": nombre_hoja_compras}}},
    ]

    sheets_service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()

    mapa = obtener_mapas_hojas(sheets_service, spreadsheet_id)

    if nombre_hoja_ventas not in mapa or nombre_hoja_compras not in mapa:
        raise ValueError("No se pudieron preparar correctamente las hojas de Google Sheets.")

    return mapa[nombre_hoja_ventas], mapa[nombre_hoja_compras]

# =========================================================
# PERÍODOS WEB
# =========================================================
def parse_fecha(value: str | None) -> date:
    if not value:
        return date.today()
    value = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Fecha de referencia inválida: {value}. Usá YYYY-MM-DD o DD/MM/YYYY.")


def mes_anterior(fecha: date) -> date:
    if fecha.month == 1:
        return date(fecha.year - 1, 12, 1)
    return date(fecha.year, fecha.month - 1, 1)


def normalizar_modo_periodo(value: str | None) -> str:
    v = (value or "auto").strip().lower()
    mapa = {
        "automatico": "auto",
        "automático": "auto",
        "auto": "auto",
        "actual": "actual",
        "mes_actual": "actual",
        "solo_actual": "actual",
        "actual_y_anterior": "actual_y_anterior",
        "actual_anterior": "actual_y_anterior",
        "mes_actual_y_anterior": "actual_y_anterior",
        "anterior": "anterior",
        "mes_anterior": "anterior",
        "solo_anterior": "anterior",
        # Modos "otro rango"
        "anio_actual": "anio_actual",
        "año_actual": "anio_actual",
        "este_año": "anio_actual",
        "este_anio": "anio_actual",
        "anio_pasado": "anio_pasado",
        "año_pasado": "anio_pasado",
        "personalizado": "personalizado",
    }
    return mapa.get(v, v)


def resolver_periodos(
    modo: str,
    fecha_ref: date,
    cutoff_day: int,
    fecha_desde_otro: str = "",
    fecha_hasta_otro: str = "",
) -> list[dict[str, Any]]:
    modo = normalizar_modo_periodo(modo)
    actual = date(fecha_ref.year, fecha_ref.month, 1)
    anterior = mes_anterior(fecha_ref)

    def ctx(period_date: date, key: str, label: str, title_suffix: str) -> dict[str, Any]:
        return {"date": period_date, "key": key, "label": label, "title_suffix": title_suffix}

    current = ctx(actual, "actual", "MES ACTUAL", "")
    prev = ctx(anterior, "mes_pasado", "MES PASADO", "MES PASADO")

    if modo == "actual":
        return [current]
    if modo == "anterior":
        return [prev]
    if modo == "actual_y_anterior":
        return [prev, current]
    if modo == "auto":
        if fecha_ref.day < cutoff_day:
            return [prev, current]
        return [current]

    # ── Modos "otro rango" ────────────────────────────────────────────────────
    if modo == "anio_actual":
        period_date = date(fecha_ref.year, 1, 1)
        return [ctx(period_date, "otro_periodo", f"AÑO {fecha_ref.year}", f"{fecha_ref.year}")]
    if modo == "anio_pasado":
        anio = fecha_ref.year - 1
        period_date = date(anio, 1, 1)
        return [ctx(period_date, "otro_periodo", f"AÑO {anio}", f"{anio}")]
    if modo == "personalizado":
        desde = fecha_desde_otro or fecha_ref.strftime("%Y-%m-%d")
        hasta = fecha_hasta_otro or fecha_ref.strftime("%Y-%m-%d")
        label = f"{desde} a {hasta}"
        return [ctx(fecha_ref, "otro_periodo", label, label)]

    raise ValueError(f"Modo de períodos no reconocido: {modo}")


def buscar_dir_periodo(ctx: dict[str, Any], cantidad_periodos: int) -> Path:
    key = ctx["key"]
    if key == "otro_periodo":
        candidatos = [
            BASE_DIR / "Comprobantes" / "otro_periodo",
            BASE_DIR / "otro_periodo",
        ]
    else:
        candidatos = [
            BASE_DIR / "Comprobantes" / key,
            BASE_DIR / "Comprobantes" / ("actual" if key == "actual" else "mes_pasado"),
            BASE_DIR / key,
            BASE_DIR / ("actual" if key == "actual" else "mes_pasado"),
        ]
    for p in candidatos:
        if p.exists() and p.is_dir():
            return p

    # Compatibilidad manual / versión vieja: un solo grupo de archivos.
    fallback = BASE_DIR / "Comprobantes"
    if fallback.exists() and fallback.is_dir():
        if cantidad_periodos > 1:
            raise SystemExit(
                "Para procesar mes actual y mes pasado con lógica exacta, subí los archivos en campos separados:\n"
                "- Archivos MES ACTUAL\n"
                "- Archivos MES PASADO\n"
                "No se puede mezclar ambos períodos en la misma carpeta porque ARCA no pone el período en el nombre."
            )
        return fallback

    if cantidad_periodos == 1:
        return BASE_DIR

    raise FileNotFoundError(f"No se encontró carpeta de archivos para {ctx['label']}.")


def titulo_reporte(sucursal: str, ctx: dict[str, Any], fecha_ref: date) -> str:
    fecha_txt = fecha_ref.strftime("%d-%m-%Y")
    mes_txt = fecha_ref.strftime("%B %Y").upper()  # ej: "MAYO 2026"
    if ctx["key"] == "mes_pasado":
        ant = mes_anterior(fecha_ref)
        mes_ant_txt = ant.strftime("%B %Y").upper()
        return f"Comprobantes {sucursal} - {mes_ant_txt} (generado {fecha_txt})"
    if ctx["key"] == "otro_periodo":
        suffix = ctx.get("title_suffix") or ctx.get("label") or "OTRO PERIODO"
        return f"Comprobantes {sucursal} - {suffix} (generado {fecha_txt})"
    return f"Comprobantes {sucursal} - {mes_txt} (generado {fecha_txt})"

# =========================================================
# PROCESAMIENTO
# =========================================================
def procesar_sucursal(
    sucursal: str,
    ventas_path: Path | None,
    compras_path: Path | None,
    drive_service,
    sheets_service,
    titulo_drive: str,
) -> str:
    if sucursal not in DRIVE_FOLDER_IDS:
        raise ValueError(f"No hay carpeta de Drive configurada para la sucursal '{sucursal}'.")
    if not ventas_path and not compras_path:
        raise ValueError("Se requiere al menos un archivo (ventas o compras).")

    folder_id = DRIVE_FOLDER_IDS[sucursal]

    print(f"\n[INFO] Sucursal: {sucursal}")
    print(f"[INFO] Ventas:  {ventas_path.name if ventas_path else '(no encontrado)'}")
    print(f"[INFO] Compras: {compras_path.name if compras_path else '(no encontrado)'}")
    print(f"[INFO] Título Drive: {titulo_drive}")

    spreadsheet_id = crear_google_sheet_en_drive(drive_service=drive_service, titulo=titulo_drive, folder_id=folder_id)

    # El spreadsheet nuevo trae una hoja en blanco por defecto.
    # La renombramos a la primera hoja útil y agregamos las demás si corresponde.
    meta_inicial = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties.sheetId",
    ).execute()
    hoja_inicial_id = meta_inicial["sheets"][0]["properties"]["sheetId"]

    hojas_a_crear: list[str] = []
    if ventas_path:
        hojas_a_crear.append("Ventas")
    if compras_path:
        hojas_a_crear.append("Compras")

    # Renombrar la hoja inicial a la primera que necesitamos
    requests: list[dict] = [
        {"updateSheetProperties": {
            "properties": {"sheetId": hoja_inicial_id, "title": hojas_a_crear[0]},
            "fields": "title",
        }}
    ]
    # Agregar hojas adicionales
    for nombre in hojas_a_crear[1:]:
        requests.append({"addSheet": {"properties": {"title": nombre}}})

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()

    mapa = obtener_mapas_hojas(sheets_service, spreadsheet_id)
    hojas_generadas: list[str] = []

    if ventas_path:
        # IMPORTANTE: no se filtran filas por fecha. Se procesa el archivo completo.
        ventas_raw = leer_emitidos(ventas_path)
        resumen_ventas = calcular_ventas(ventas_raw)
        escribir_hoja(sheets_service, spreadsheet_id, "Ventas", resumen_ventas)
        aplicar_formato_hoja(sheets_service, spreadsheet_id, mapa["Ventas"], len(resumen_ventas.columns), len(resumen_ventas) + 1)
        hojas_generadas.append("Ventas")

    if compras_path:
        compras_raw = leer_recibidos(compras_path)
        resumen_compras = calcular_compras(compras_raw)
        escribir_hoja(sheets_service, spreadsheet_id, "Compras", resumen_compras)
        aplicar_formato_hoja(sheets_service, spreadsheet_id, mapa["Compras"], len(resumen_compras.columns), len(resumen_compras) + 1)
        hojas_generadas.append("Compras")

    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    print(f"[OK] Generado en Drive ({' + '.join(hojas_generadas)}): {url}")
    return url


def procesar_periodo(ctx: dict[str, Any], fecha_ref: date, cantidad_periodos: int, drive_service, sheets_service) -> None:
    base_periodo = buscar_dir_periodo(ctx, cantidad_periodos)
    print(f"\n[INFO] Procesando {ctx['label']} desde carpeta: {base_periodo}")
    print("[INFO] Regla: se procesa el archivo completo del período, sin filtrar filas por fecha interna.")

    deteccion = detectar_archivos_por_sucursal(base_periodo)
    if not deteccion:
        raise SystemExit(
            f"No se encontraron archivos válidos para {ctx['label']} en {base_periodo}.\n"
            f"Busco ventas (CSV) con: {PATRON_VENTAS} + CUIT\n"
            f"Busco compras (XLSX) con: {PATRON_COMPRAS} + CUIT"
        )

    for sucursal, archivos in deteccion.items():
        ventas_path = archivos.get("ventas")
        compras_path = archivos.get("compras")

        # Avisar lo que falta pero continuar con lo que hay
        if ventas_path is None:
            print(f"[AVISO] {sucursal}: no se encontró archivo de ventas — se procesará solo compras.")
        if compras_path is None:
            print(f"[AVISO] {sucursal}: no se encontró archivo de compras — se procesará solo ventas.")

        try:
            procesar_sucursal(
                sucursal=sucursal,
                ventas_path=ventas_path,
                compras_path=compras_path,
                drive_service=drive_service,
                sheets_service=sheets_service,
                titulo_drive=titulo_reporte(sucursal, ctx, fecha_ref),
            )
        except HttpError as e:
            print(f"[ERROR GOOGLE API] {sucursal} {ctx['label']}: {e}")
        except Exception as e:
            print(f"[ERROR] {sucursal} {ctx['label']}: {e}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Limpiar comprobantes ARCA con lógica original.")
    parser.add_argument("--period-mode", "--periodos", dest="period_mode", default="auto")
    parser.add_argument("--reference-date", "--fecha-referencia", dest="reference_date", default="")
    parser.add_argument("--cutoff-day", "--dia-corte-mes-anterior", dest="cutoff_day", type=int, default=11)
    parser.add_argument("--fecha-desde-otro", dest="fecha_desde_otro", default="")
    parser.add_argument("--fecha-hasta-otro", dest="fecha_hasta_otro", default="")
    return parser.parse_args()


def procesar_todo() -> None:
    args = parse_args()
    fecha_ref = parse_fecha(args.reference_date)
    cutoff_day = int(args.cutoff_day or 11)
    periodos = resolver_periodos(
        args.period_mode,
        fecha_ref,
        cutoff_day,
        fecha_desde_otro=args.fecha_desde_otro,
        fecha_hasta_otro=args.fecha_hasta_otro,
    )

    print(f"[INFO] Fecha de referencia: {fecha_ref.isoformat()}")
    print(f"[INFO] Día de corte mes anterior: {cutoff_day}")
    print("[INFO] Regla ARCA: del día 1 al día anterior al corte se procesa MES PASADO COMPLETO + MES ACTUAL.")
    print("[INFO] Desde el día de corte inclusive se procesa solo MES ACTUAL.")
    print(f"[INFO] Períodos resueltos: {[p['label'] for p in periodos]}")

    for sucursal, folder_id in DRIVE_FOLDER_IDS.items():
        if not folder_id or "PEGAR_ID" in folder_id:
            raise ValueError(f"Tenés que completar el ID de Drive para la sucursal '{sucursal}'.")

    drive_service, sheets_service = crear_services()

    for ctx in periodos:
        procesar_periodo(ctx, fecha_ref, len(periodos), drive_service, sheets_service)


if __name__ == "__main__":
    procesar_todo()
    try:
        if sys.stdin.isatty():
            input("\nPresioná Enter para salir...")
    except Exception:
        pass
