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
FECHA_CANDIDATOS = [
    "fecha_de_comprobante",
    "fecha comprobante",
    "fecha_comprobante",
    "fecha_cbte",
    "fecha_de_emision",
    "fecha emision",
    "fecha_emision",
    "fecha",
]

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


def buscar_columna_fecha(df: pd.DataFrame) -> str | None:
    return buscar_columna_flexible(df, FECHA_CANDIDATOS)


def serie_a_fechas(serie: pd.Series) -> pd.Series:
    raw = serie.astype(str).str.strip()
    raw = raw.replace({"": pd.NA, "nan": pd.NA, "NaN": pd.NA, "None": pd.NA, "none": pd.NA})

    fechas = pd.to_datetime(raw, errors="coerce", dayfirst=True)

    mask_iso = fechas.isna() & raw.str.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", na=False)
    if mask_iso.any():
        fechas.loc[mask_iso] = pd.to_datetime(raw.loc[mask_iso], format="%Y-%m-%d", errors="coerce")

    mask_dmy_slash = fechas.isna() & raw.str.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", na=False)
    if mask_dmy_slash.any():
        fechas.loc[mask_dmy_slash] = pd.to_datetime(raw.loc[mask_dmy_slash], format="%d/%m/%Y", errors="coerce")

    mask_dmy_dash = fechas.isna() & raw.str.fullmatch(r"\d{1,2}-\d{1,2}-\d{4}", na=False)
    if mask_dmy_dash.any():
        fechas.loc[mask_dmy_dash] = pd.to_datetime(raw.loc[mask_dmy_dash], format="%d-%m-%Y", errors="coerce")

    mask_yyyymmdd = fechas.isna() & raw.str.fullmatch(r"\d{8}", na=False)
    if mask_yyyymmdd.any():
        fechas.loc[mask_yyyymmdd] = pd.to_datetime(raw.loc[mask_yyyymmdd], format="%Y%m%d", errors="coerce")

    numericas = pd.to_numeric(raw.str.replace(",", ".", regex=False), errors="coerce")
    mask_serial = fechas.isna() & numericas.between(25000, 70000)
    if mask_serial.any():
        fechas.loc[mask_serial] = pd.to_datetime(numericas.loc[mask_serial], unit="D", origin="1899-12-30", errors="coerce")

    return fechas


def filtrar_por_rango_fecha(df: pd.DataFrame, desde: date, hasta: date, etiqueta: str) -> pd.DataFrame:
    col_fecha = buscar_columna_fecha(df)
    if not col_fecha:
        raise ValueError(
            f"{etiqueta}: no se encontro una columna de fecha para mensualizar. "
            f"Columnas encontradas: {list(df.columns)}"
        )

    fechas = serie_a_fechas(df[col_fecha])
    if fechas.notna().sum() == 0:
        raise ValueError(
            f"{etiqueta}: se encontro la columna de fecha '{col_fecha}', "
            "pero no se pudo interpretar ningun valor."
        )

    desde_ts = pd.Timestamp(desde)
    hasta_ts = pd.Timestamp(hasta)
    mask = (fechas >= desde_ts) & (fechas <= hasta_ts)
    return df.loc[mask].copy().reset_index(drop=True)


def primer_dia_mes(fecha: date) -> date:
    return date(fecha.year, fecha.month, 1)


def ultimo_dia_mes(fecha: date) -> date:
    if fecha.month == 12:
        return date(fecha.year, 12, 31)
    siguiente = date(fecha.year, fecha.month + 1, 1)
    return date.fromordinal(siguiente.toordinal() - 1)


def iterar_meses(desde: date, hasta: date) -> list[date]:
    meses: list[date] = []
    cursor = primer_dia_mes(desde)
    limite = primer_dia_mes(hasta)
    while cursor <= limite:
        meses.append(cursor)
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return meses


def rango_mes_en_periodo(mes: date, desde: date, hasta: date) -> tuple[date, date]:
    return max(mes, desde), min(ultimo_dia_mes(mes), hasta)


def etiqueta_mes(fecha: date) -> str:
    meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]
    return f"{meses[fecha.month - 1]}-{str(fecha.year)[-2:]}"


def formato_importe_ar(value: Any) -> str:
    try:
        numero = float(value or 0)
    except Exception:
        numero = 0.0
    signo = "-" if numero < 0 else ""
    base = f"{abs(numero):,.2f}"
    base = base.replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{signo}{base}"


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


def extraer_tipo_num(valor: object) -> int | None:
    """Saca el número del tipo de comprobante, sirva venir como '3',
    '3 - Nota de Crédito A' o '8 - Nota de Crédito B'. Las notas de crédito
    son los tipos 3 y 8 (y restan a los demás)."""
    if pd.isna(valor):
        return None
    m = re.search(r"\d+", str(valor))
    return int(m.group()) if m else None


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


def valores_a_hoja(sheets_service, spreadsheet_id: str, nombre_hoja: str, valores: list[list[Any]]) -> None:
    rango = f"'{escapo_nombre_hoja(nombre_hoja)}'!A1"
    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=rango,
        valueInputOption="RAW",
        body={"majorDimension": "ROWS", "values": valores},
    ).execute()


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
    df = _normalizar_emitidos(raw, ruta.name)
    col_fecha = buscar_columna_fecha(df)
    if col_fecha and col_fecha != "fecha":
        df["fecha"] = df[col_fecha]
    return df


def _seleccionar_recibidos(df: pd.DataFrame) -> pd.DataFrame | None:
    """De un DataFrame ya normalizado, extrae tipo + total IVA + neto gravado +
    proveedor (Denominación Emisor). Devuelve None si faltan tipo/IVA."""
    col_tipo = buscar_columna_flexible(df, ["tipo_de_comprobante", "tipo"])
    col_iva = buscar_columna_flexible(df, ["total_iva", "total iva", "iva"])
    if not col_tipo or not col_iva:
        return None
    # Imp. Neto Gravado Total (candidatos específicos primero para no agarrar
    # "Imp. Neto No Gravado").
    col_neto = buscar_columna_flexible(df, ["imp_neto_gravado_total", "imp_neto_gravado", "neto_gravado_total", "neto_gravado"])
    # Proveedor = quien emite el comprobante recibido. Candidatos específicos
    # primero para no agarrar "Denominación Receptor" ni "Tipo Doc. Emisor".
    col_prov = buscar_columna_flexible(df, ["denominacion_emisor", "denominacionemisor", "razon_social_emisor", "denominacion"])
    col_fecha = buscar_columna_fecha(df)
    return pd.DataFrame({
        "fecha": df[col_fecha] if col_fecha else "",
        "tipo": df[col_tipo],
        "total_iva": df[col_iva],
        "imp_neto_gravado": df[col_neto] if col_neto else "",
        "proveedor": df[col_prov] if col_prov else "",
    })


def leer_recibidos(ruta: Path) -> pd.DataFrame:
    """Lee un archivo de recibidos (compras) en CSV o Excel, unificando todas las hojas."""
    ext = ruta.suffix.lower()
    partes = []
    hojas_usadas = []

    if ext == ".csv":
        raw = leer_csv_robusto(ruta)
        raw = normalizar_columnas(raw)
        df = _seleccionar_recibidos(raw)
        if df is None:
            raise ValueError(f"Recibidos CSV: no se encontraron columnas 'Tipo' y 'Total IVA' en {ruta.name}.")
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
                df = _seleccionar_recibidos(df)
                if df is None:
                    print(f"[INFO] Hoja ignorada: {hoja} (faltan columnas tipo/iva)")
                    continue
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

    # El tipo puede venir como número ('3') o como texto ('3 - Nota de Crédito A').
    # Las notas de crédito son los tipos 3 y 8 y restan al resto (igual que ventas).
    compras["tipo_num"] = compras["tipo"].apply(extraer_tipo_num)
    compras["total_iva"] = to_numero(compras["total_iva"])
    if "imp_neto_gravado" not in compras.columns:
        compras["imp_neto_gravado"] = 0
    compras["imp_neto_gravado"] = to_numero(compras["imp_neto_gravado"])

    mask_b = compras["tipo_num"].isin([3, 8])
    mask_a = compras["tipo_num"].notna() & ~mask_b

    iva_a = compras.loc[mask_a, "total_iva"].sum(skipna=True)
    iva_b = compras.loc[mask_b, "total_iva"].sum(skipna=True)
    neto_a = compras.loc[mask_a, "imp_neto_gravado"].sum(skipna=True)
    neto_b = compras.loc[mask_b, "imp_neto_gravado"].sum(skipna=True)

    resultado = pd.DataFrame({
        "Concepto": [
            "Resto de comprobantes",
            "Notas de crédito (3 y 8)",
            "Diferencia (resto - notas crédito)",
        ],
        "Imp. Neto Gravado Total": [
            neto_a,
            neto_b,
            neto_a - neto_b,
        ],
        "Total IVA": [
            iva_a,
            iva_b,
            iva_a - iva_b,
        ],
    })

    print(f"[INFO] Compras: filas resto = {mask_a.sum()}")
    print(f"[INFO] Compras: filas notas de crédito (3 y 8) = {mask_b.sum()}")

    return resultado.round(2)


def calcular_compras_por_proveedor(df: pd.DataFrame) -> pd.DataFrame:
    """Desglosa las compras por proveedor (Denominación Emisor), con las notas
    de crédito (tipos 3 y 8) ya restadas en la columna 'Total IVA neto'."""
    columnas = {"tipo", "total_iva"}
    faltantes = columnas - set(df.columns)
    if faltantes:
        raise ValueError(
            f"Compras por proveedor: faltan columnas requeridas: {sorted(faltantes)}\n"
            f"Columnas encontradas: {list(df.columns)}"
        )

    compras = df.copy()
    if "proveedor" not in compras.columns:
        compras["proveedor"] = ""
    if "imp_neto_gravado" not in compras.columns:
        compras["imp_neto_gravado"] = 0

    compras["tipo_num"] = compras["tipo"].apply(extraer_tipo_num)
    compras["total_iva"] = to_numero(compras["total_iva"])
    compras["imp_neto_gravado"] = to_numero(compras["imp_neto_gravado"])
    compras["proveedor"] = compras["proveedor"].astype(str).str.strip()
    compras.loc[compras["proveedor"].isin(["", "nan", "none", "None"]), "proveedor"] = "(sin proveedor)"

    filas = []
    for proveedor, sub in compras.groupby("proveedor", sort=False):
        es_nc = sub["tipo_num"].isin([3, 8])
        neto_normal = sub.loc[~es_nc, "imp_neto_gravado"].sum(skipna=True)
        neto_nc = sub.loc[es_nc, "imp_neto_gravado"].sum(skipna=True)
        iva_normal = sub.loc[~es_nc, "total_iva"].sum(skipna=True)
        iva_nc = sub.loc[es_nc, "total_iva"].sum(skipna=True)
        filas.append({
            "Proveedor": proveedor,
            "Neto gravado comprobantes": neto_normal,
            "Neto gravado notas crédito (3 y 8)": neto_nc,
            "Imp. Neto Gravado Total (neto)": neto_normal - neto_nc,
            "Total IVA comprobantes": iva_normal,
            "Total IVA notas crédito (3 y 8)": iva_nc,
            "Total IVA neto": iva_normal - iva_nc,
        })

    cols = [
        "Proveedor",
        "Neto gravado comprobantes", "Neto gravado notas crédito (3 y 8)", "Imp. Neto Gravado Total (neto)",
        "Total IVA comprobantes", "Total IVA notas crédito (3 y 8)", "Total IVA neto",
    ]
    resultado = pd.DataFrame(filas, columns=cols)
    if not resultado.empty:
        resultado = resultado.sort_values("Imp. Neto Gravado Total (neto)", ascending=False, kind="stable").reset_index(drop=True)
        for c in cols[1:]:
            resultado[c] = resultado[c].round(2)

    print(f"[INFO] Compras por proveedor: {len(resultado)} proveedores")
    return resultado

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


def aplicar_formato_hoja(sheets_service, spreadsheet_id: str, sheet_id: int, n_cols: int, n_rows: int, numeric_start_col: int = 1) -> None:
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

    if n_cols > numeric_start_col and n_rows > 1:
        requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": n_rows,
                        "startColumnIndex": numeric_start_col,
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

    def ctx(period_date: date, key: str, label: str, title_suffix: str, **extra: Any) -> dict[str, Any]:
        data = {"date": period_date, "key": key, "label": label, "title_suffix": title_suffix}
        data.update(extra)
        return data

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


def resolver_periodos_mensualizado(
    modo: str,
    fecha_ref: date,
    cutoff_day: int,
    fecha_desde_otro: str = "",
    fecha_hasta_otro: str = "",
) -> list[dict[str, Any]]:
    modo = normalizar_modo_periodo(modo)
    actual = date(fecha_ref.year, fecha_ref.month, 1)
    anterior = mes_anterior(fecha_ref)

    def ctx(period_date: date, key: str, label: str, title_suffix: str, **extra: Any) -> dict[str, Any]:
        data = {"date": period_date, "key": key, "label": label, "title_suffix": title_suffix}
        data.update(extra)
        return data

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
    if modo == "anio_actual":
        desde = date(fecha_ref.year, 1, 1)
        hasta = date(fecha_ref.year, 12, 31)
        return [ctx(desde, "otro_periodo", f"ANIO {fecha_ref.year}", f"{fecha_ref.year}", range_start=desde, range_end=hasta, monthly_breakdown=True)]
    if modo == "anio_pasado":
        anio = fecha_ref.year - 1
        desde = date(anio, 1, 1)
        hasta = date(anio, 12, 31)
        return [ctx(desde, "otro_periodo", f"ANIO {anio}", f"{anio}", range_start=desde, range_end=hasta, monthly_breakdown=True)]
    if modo == "personalizado":
        desde = parse_fecha(fecha_desde_otro or fecha_ref.strftime("%Y-%m-%d"))
        hasta = parse_fecha(fecha_hasta_otro or fecha_ref.strftime("%Y-%m-%d"))
        if hasta < desde:
            raise ValueError("En rango personalizado, la fecha hasta no puede ser anterior a la fecha desde.")
        label = f"{desde.isoformat()} a {hasta.isoformat()}"
        return [ctx(desde, "otro_periodo", label, label, range_start=desde, range_end=hasta, monthly_breakdown=True)]

    raise ValueError(f"Modo de periodos no reconocido: {modo}")


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


def preparar_hojas_dinamicas(sheets_service, spreadsheet_id: str, nombres_hojas: list[str]) -> dict[str, int]:
    if not nombres_hojas:
        raise ValueError("No hay hojas para crear en el spreadsheet.")

    meta_inicial = sheets_service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties.sheetId",
    ).execute()
    hoja_inicial_id = meta_inicial["sheets"][0]["properties"]["sheetId"]

    requests: list[dict] = [
        {"updateSheetProperties": {
            "properties": {"sheetId": hoja_inicial_id, "title": nombres_hojas[0]},
            "fields": "title",
        }}
    ]
    for nombre in nombres_hojas[1:]:
        requests.append({"addSheet": {"properties": {"title": nombre}}})

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()

    mapa = obtener_mapas_hojas(sheets_service, spreadsheet_id)
    faltantes = [nombre for nombre in nombres_hojas if nombre not in mapa]
    if faltantes:
        raise ValueError(f"No se pudieron preparar hojas: {faltantes}")
    return mapa


def aplicar_formato_resumen_visual(
    sheets_service,
    spreadsheet_id: str,
    sheet_id: int,
    bloques: int,
    entradas: int,
) -> None:
    requests: list[dict[str, Any]] = []
    total_cols = bloques * 3 - 1
    total_rows = 1 + entradas * 2

    for bloque in range(bloques):
        col = bloque * 3
        end_col = col + 2

        requests.extend([
            {
                "mergeCells": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": col, "endColumnIndex": end_col},
                    "mergeType": "MERGE_ALL",
                }
            },
            {
                "repeatCell": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": col, "endColumnIndex": end_col},
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 1.0, "green": 0.92, "blue": 0.98},
                            "horizontalAlignment": "CENTER",
                            "verticalAlignment": "MIDDLE",
                            "textFormat": {"bold": True, "italic": True, "fontSize": 12},
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                }
            },
            {
                "updateBorders": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": total_rows, "startColumnIndex": col, "endColumnIndex": end_col},
                    "top": {"style": "SOLID", "width": 1, "color": {"red": 0, "green": 0, "blue": 0}},
                    "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0, "green": 0, "blue": 0}},
                    "left": {"style": "SOLID", "width": 1, "color": {"red": 0, "green": 0, "blue": 0}},
                    "right": {"style": "SOLID", "width": 1, "color": {"red": 0, "green": 0, "blue": 0}},
                    "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                    "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                }
            },
            {
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": col, "endIndex": col + 1},
                    "properties": {"pixelSize": 34},
                    "fields": "pixelSize",
                }
            },
            {
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": col + 1, "endIndex": col + 2},
                    "properties": {"pixelSize": 132},
                    "fields": "pixelSize",
                }
            },
        ])

        if bloque < bloques - 1:
            requests.append({
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": col + 2, "endIndex": col + 3},
                    "properties": {"pixelSize": 24},
                    "fields": "pixelSize",
                }
            })

        for idx in range(entradas):
            row_label = 1 + idx * 2
            row_value = row_label + 1
            es_total = idx == entradas - 1

            requests.extend([
                {
                    "mergeCells": {
                        "range": {"sheetId": sheet_id, "startRowIndex": row_label, "endRowIndex": row_label + 1, "startColumnIndex": col, "endColumnIndex": end_col},
                        "mergeType": "MERGE_ALL",
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": row_label, "endRowIndex": row_label + 1, "startColumnIndex": col, "endColumnIndex": end_col},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.12, "green": 0.24, "blue": 0.46} if es_total else {"red": 0.86, "green": 0.86, "blue": 0.86},
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE",
                                "textFormat": {"bold": True, "italic": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1} if es_total else {"red": 0, "green": 0, "blue": 0}},
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": row_value, "endRowIndex": row_value + 1, "startColumnIndex": col, "endColumnIndex": end_col},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.95, "green": 0.98, "blue": 1.0} if es_total else {"red": 1, "green": 1, "blue": 1},
                                "textFormat": {"bold": es_total, "italic": True},
                                "verticalAlignment": "MIDDLE",
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": row_value, "endRowIndex": row_value + 1, "startColumnIndex": col, "endColumnIndex": col + 1},
                        "cell": {"userEnteredFormat": {"horizontalAlignment": "CENTER"}},
                        "fields": "userEnteredFormat.horizontalAlignment",
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": row_value, "endRowIndex": row_value + 1, "startColumnIndex": col + 1, "endColumnIndex": col + 2},
                        "cell": {"userEnteredFormat": {"horizontalAlignment": "RIGHT"}},
                        "fields": "userEnteredFormat.horizontalAlignment",
                    }
                },
            ])

    if total_cols > 0:
        requests.append({
            "updateSheetProperties": {
                "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }
        })

    sheets_service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()


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
        hojas_a_crear.append("Compras por proveedor")

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

        # Desglose por proveedor (Denominación Emisor), con NC ya restadas.
        por_proveedor = calcular_compras_por_proveedor(compras_raw)
        escribir_hoja(sheets_service, spreadsheet_id, "Compras por proveedor", por_proveedor)
        aplicar_formato_hoja(sheets_service, spreadsheet_id, mapa["Compras por proveedor"], len(por_proveedor.columns), len(por_proveedor) + 1)
        hojas_generadas.append("Compras por proveedor")

    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    print(f"[OK] Generado en Drive ({' + '.join(hojas_generadas)}): {url}")
    return url


def procesar_sucursal_rango_mensual(
    sucursal: str,
    ventas_path: Path | None,
    compras_path: Path | None,
    drive_service,
    sheets_service,
    titulo_drive: str,
    range_start: date,
    range_end: date,
) -> str:
    if sucursal not in DRIVE_FOLDER_IDS:
        raise ValueError(f"No hay carpeta de Drive configurada para la sucursal '{sucursal}'.")
    if not ventas_path and not compras_path:
        raise ValueError("Se requiere al menos un archivo (ventas o compras).")

    folder_id = DRIVE_FOLDER_IDS[sucursal]
    meses = iterar_meses(range_start, range_end)

    print(f"\n[INFO] Sucursal: {sucursal}")
    print(f"[INFO] Ventas:  {ventas_path.name if ventas_path else '(no encontrado)'}")
    print(f"[INFO] Compras: {compras_path.name if compras_path else '(no encontrado)'}")
    print(f"[INFO] Rango interno: {range_start.isoformat()} a {range_end.isoformat()} ({len(meses)} meses)")
    print(f"[INFO] Titulo Drive: {titulo_drive}")

    ventas_raw = leer_emitidos(ventas_path) if ventas_path else None
    compras_raw = leer_recibidos(compras_path) if compras_path else None

    hojas_a_crear: list[str] = []
    if ventas_raw is not None:
        hojas_a_crear.append("Ventas")
    if compras_raw is not None:
        hojas_a_crear.append("Compras")
        hojas_a_crear.append("Compras por proveedor")

    spreadsheet_id = crear_google_sheet_en_drive(drive_service=drive_service, titulo=titulo_drive, folder_id=folder_id)
    mapa = preparar_hojas_dinamicas(sheets_service, spreadsheet_id, hojas_a_crear)
    hojas_generadas: list[str] = []

    def escribir_resultado(nombre_hoja: str, df: pd.DataFrame) -> None:
        escribir_hoja(sheets_service, spreadsheet_id, nombre_hoja, df)
        aplicar_formato_hoja(sheets_service, spreadsheet_id, mapa[nombre_hoja], len(df.columns), len(df) + 1, numeric_start_col=4)
        hojas_generadas.append(nombre_hoja)

    def escribir_resumen_visual(nombre_hoja: str, metricas: list[dict[str, Any]]) -> None:
        if not metricas:
            return

        entradas = len(metricas[0]["filas"])
        columnas = len(metricas) * 3 - 1
        valores = [["" for _ in range(columnas)] for _ in range(1 + entradas * 2)]

        for idx, metrica in enumerate(metricas):
            col = idx * 3
            valores[0][col] = metrica["titulo"]
            for row_idx, fila in enumerate(metrica["filas"]):
                row_label = 1 + row_idx * 2
                row_value = row_label + 1
                valores[row_label][col] = fila["periodo"]
                valores[row_value][col] = "$"
                valores[row_value][col + 1] = formato_importe_ar(fila["valor"])

        valores_a_hoja(sheets_service, spreadsheet_id, nombre_hoja, valores)
        aplicar_formato_resumen_visual(sheets_service, spreadsheet_id, mapa[nombre_hoja], len(metricas), entradas)
        hojas_generadas.append(nombre_hoja)

    def agregar_periodo(df: pd.DataFrame, periodo: str, desde: date, hasta: date) -> pd.DataFrame:
        salida = df.copy()
        salida.insert(0, "Hasta", hasta.isoformat())
        salida.insert(0, "Desde", desde.isoformat())
        salida.insert(0, "Periodo", periodo)
        return salida

    def tabla_periodos(raw: pd.DataFrame, etiqueta: str, calcular) -> pd.DataFrame:
        bloques: list[pd.DataFrame] = []

        total_raw = filtrar_por_rango_fecha(raw, range_start, range_end, etiqueta)
        bloques.append(agregar_periodo(calcular(total_raw), "TOTAL", range_start, range_end))

        for mes in meses:
            mes_desde, mes_hasta = rango_mes_en_periodo(mes, range_start, range_end)
            mes_key = f"{mes.year}-{mes.month:02d}"
            mes_raw = filtrar_por_rango_fecha(raw, mes_desde, mes_hasta, f"{etiqueta} {mes_key}")
            bloques.append(agregar_periodo(calcular(mes_raw), mes_key, mes_desde, mes_hasta))

        return pd.concat(bloques, ignore_index=True)

    def metricas_visuales(raw: pd.DataFrame, etiqueta: str, calcular, specs: list[tuple[str, str]]) -> list[dict[str, Any]]:
        resultados: list[tuple[str, pd.DataFrame]] = []
        for mes in meses:
            mes_desde, mes_hasta = rango_mes_en_periodo(mes, range_start, range_end)
            mes_key = f"{mes.year}-{mes.month:02d}"
            mes_raw = filtrar_por_rango_fecha(raw, mes_desde, mes_hasta, f"{etiqueta} {mes_key}")
            resultados.append((etiqueta_mes(mes), calcular(mes_raw)))

        total_raw = filtrar_por_rango_fecha(raw, range_start, range_end, etiqueta)
        resultados.append(("TOTAL", calcular(total_raw)))

        metricas: list[dict[str, Any]] = []
        for titulo, columna in specs:
            filas = []
            for periodo, resumen in resultados:
                valor = 0
                if not resumen.empty and columna in resumen.columns:
                    valor = resumen.iloc[-1][columna]
                filas.append({"periodo": periodo, "valor": valor})
            metricas.append({"titulo": titulo, "filas": filas})
        return metricas

    if ventas_raw is not None:
        escribir_resumen_visual(
            "Ventas",
            metricas_visuales(
                ventas_raw,
                f"Ventas {sucursal}",
                calcular_ventas,
                [
                    ("IVA Ventas", "Total IVA"),
                    ("Neto Ventas", "Imp. Neto Gravado Total"),
                    ("Total Ventas", "Imp. Total"),
                ],
            ),
        )

    if compras_raw is not None:
        escribir_resumen_visual(
            "Compras",
            metricas_visuales(
                compras_raw,
                f"Compras {sucursal}",
                calcular_compras,
                [
                    ("IVA Compras", "Total IVA"),
                    ("Neto Compras", "Imp. Neto Gravado Total"),
                ],
            ),
        )
        escribir_resultado("Compras por proveedor", tabla_periodos(compras_raw, f"Compras por proveedor {sucursal}", calcular_compras_por_proveedor))

    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    print(f"[OK] Generado en Drive ({' + '.join(hojas_generadas)} con tabla mensual + total): {url}")
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


def procesar_periodo_mensualizado(ctx: dict[str, Any], fecha_ref: date, cantidad_periodos: int, drive_service, sheets_service) -> None:
    base_periodo = buscar_dir_periodo(ctx, cantidad_periodos)
    print(f"\n[INFO] Procesando {ctx['label']} desde carpeta: {base_periodo}")
    if ctx.get("monthly_breakdown"):
        print("[INFO] Regla: se filtra por fecha interna del comprobante y se generan hojas por mes + total.")
    else:
        print("[INFO] Regla: se procesa el archivo completo del periodo, sin filtrar filas por fecha interna.")

    deteccion = detectar_archivos_por_sucursal(base_periodo)
    if not deteccion:
        raise SystemExit(
            f"No se encontraron archivos validos para {ctx['label']} en {base_periodo}.\n"
            f"Busco ventas (CSV) con: {PATRON_VENTAS} + CUIT\n"
            f"Busco compras (XLSX) con: {PATRON_COMPRAS} + CUIT"
        )

    for sucursal, archivos in deteccion.items():
        ventas_path = archivos.get("ventas")
        compras_path = archivos.get("compras")

        if ventas_path is None:
            print(f"[AVISO] {sucursal}: no se encontro archivo de ventas; se procesara solo compras.")
        if compras_path is None:
            print(f"[AVISO] {sucursal}: no se encontro archivo de compras; se procesara solo ventas.")

        try:
            if ctx.get("monthly_breakdown"):
                procesar_sucursal_rango_mensual(
                    sucursal=sucursal,
                    ventas_path=ventas_path,
                    compras_path=compras_path,
                    drive_service=drive_service,
                    sheets_service=sheets_service,
                    titulo_drive=titulo_reporte(sucursal, ctx, fecha_ref),
                    range_start=ctx["range_start"],
                    range_end=ctx["range_end"],
                )
            else:
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
    periodos = resolver_periodos_mensualizado(
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
        procesar_periodo_mensualizado(ctx, fecha_ref, len(periodos), drive_service, sheets_service)


if __name__ == "__main__":
    procesar_todo()
    try:
        if sys.stdin.isatty():
            input("\nPresioná Enter para salir...")
    except Exception:
        pass
