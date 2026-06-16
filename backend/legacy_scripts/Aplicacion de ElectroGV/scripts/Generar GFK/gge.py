"""Generar EXAMENES de GFK (variantes con ventas infladas para evaluar practicantes).

Herramienta AVANZADA, solo-superadmin. NO genera reportes para enviar a GfK.

Que hace:
  - Toma un GFK YA generado (correcto) desde Drive.
  - Crea N variantes (una por practicante). En cada variante infla las marcas
    elegidas agregando filas realistas: toma productos REALES de esa marca que
    ya aparecen en el GFK (mismo EAN/modelo/descripcion/precio), y les pone una
    fecha al azar dentro del periodo del GFK y una sucursal al azar de las que
    aparecen. Asi el practicante no puede cazarlas de un vistazo y tiene que
    resolver con formulas (comparar contra el original, ventas vs costos,
    calcular el % de variacion).
  - Cada variante lleva una hoja MUY OCULTA "_PARAMETROS_EXAMEN" con el detalle
    de lo que se agrego. Es el registro que mantiene estos archivos
    distinguibles de un GFK real (no es un falsificador): al practicante
    resolviendo con formulas no le aparece, pero queda dentro del archivo.

Uso (via web): se pasa por CLI (sys.argv):
  --source-url   URL/ID del GFK original en Drive
  --dest-url     URL/ID de la carpeta destino en Drive
  --marcas       "WHIRLPOOL=10, DREAN=15"  (marca=PORCENTAJE de inflado sobre
                 las unidades reales de esa marca; ej 10 = +10%)
  --variantes    N (cantidad de examenes distintos a generar)
  --prefijo      nombre base de los archivos (ej "Examen GFK")
"""
from __future__ import annotations

import argparse
import io
import random
import re
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# Credenciales unificadas (apuntan a la raiz de la app), igual que gg.py.
_APP_ROOT = Path(__file__).resolve().parent.parent.parent
CREDENTIALS_FILE = _APP_ROOT / "credentials.json"
TOKEN_FILE = _APP_ROOT / "token.json"
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

PARAMS_SHEET = "_PARAMETROS_EXAMEN"
HEADER_ANCHOR = "fecha de venta"  # texto que marca la fila de encabezados


# ============================================================
# AUTENTICACION (espejo de gg.py)
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
                raise FileNotFoundError("Falta credentials.json para autenticar con Google.")
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    drive_service = build("drive", "v3", credentials=creds)
    sheets_service = build("sheets", "v4", credentials=creds)
    return drive_service, sheets_service


# ============================================================
# HELPERS
# ============================================================

def extraer_id_de_url(url: str) -> str:
    """Saca el ID de un link de Drive/Sheets, o devuelve tal cual si ya es un ID."""
    url = (url or "").strip()
    if not url:
        raise ValueError("Falta la URL/ID.")
    m = re.search(r"/d/([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    return url  # ya es un id


def parse_marcas(spec: str) -> dict[str, float]:
    """'WHIRLPOOL=10, DREAN=15%' -> {'WHIRLPOOL': 10.0, 'DREAN': 15.0}.

    El valor es el PORCENTAJE en que se infla esa marca sobre sus unidades
    reales (cantidad vendida). Acepta con o sin '%'.
    """
    out: dict[str, float] = {}
    for parte in re.split(r"[,;\n]+", spec or ""):
        parte = parte.strip()
        if not parte or "=" not in parte:
            continue
        marca, _, pct = parte.partition("=")
        marca = marca.strip()
        pct = str(pct).strip().replace("%", "").replace(",", ".")
        try:
            p = float(pct)
        except ValueError:
            continue
        if marca and p > 0:
            out[marca] = out.get(marca, 0.0) + p
    return out


def parse_cantidad(valor: Any) -> int:
    """Unidades vendidas de una fila. Vacío/ilegible = 1."""
    try:
        n = int(round(float(str(valor or "").strip().replace(",", "."))))
        return n if n > 0 else 1
    except (ValueError, TypeError):
        return 1


def norm(value: Any) -> str:
    return str(value or "").strip().lower()


def descargar_gfk_a_df(drive_service, file_id: str) -> pd.DataFrame:
    """Exporta el GFK (Google Sheet) a xlsx y lo lee crudo (sin header)."""
    request = drive_service.files().export_media(
        fileId=file_id,
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
    temp_path = Path(temp.name)
    temp.close()
    fh = io.FileIO(temp_path, "wb")
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    fh.close()
    return pd.read_excel(temp_path, header=None, dtype=str).fillna("")


def detectar_header(df: pd.DataFrame) -> int:
    for i in range(min(len(df), 15)):
        fila = [norm(c) for c in df.iloc[i].tolist()]
        if HEADER_ANCHOR in fila:
            return i
    raise ValueError(f"No encontre la fila de encabezados (buscaba '{HEADER_ANCHOR}').")


def col_idx(headers: list[str], *nombres: str) -> int:
    objetivo = {norm(n) for n in nombres}
    for i, h in enumerate(headers):
        if norm(h) in objetivo:
            return i
    return -1


def parse_fecha(valor: Any) -> date | None:
    s = str(valor or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19], fmt).date()
        except ValueError:
            continue
    try:
        return pd.to_datetime(s, dayfirst=True).date()
    except Exception:
        return None


def fecha_a_texto(d: date, muestra: str) -> str:
    """Formatea la fecha generada imitando el formato que ya usa el GFK."""
    if "/" in muestra:
        return d.strftime("%d/%m/%Y")
    return d.strftime("%Y-%m-%d")


# ============================================================
# GENERACION DE VARIANTES
# ============================================================

def construir_variante(
    headers: list[str],
    filas: list[list[str]],
    marcas_pct: dict[str, float],
    rng: random.Random,
) -> tuple[list[list[str]], list[dict[str, Any]]]:
    """Infla cada marca un % sobre sus UNIDADES reales (cantidad vendida).
    Devuelve (filas_infladas, detalle)."""
    i_fecha = col_idx(headers, "Fecha de venta", "fecha")
    i_suc = col_idx(headers, "N°/Nombre de la sucursal", "Nombre / identificacion del vendedor", "sucursal")
    i_marca = col_idx(headers, "Marca del item", "marca")
    i_cant = col_idx(headers, "Cantidad vendida", "cantidad")
    if i_fecha < 0 or i_marca < 0:
        raise ValueError("El GFK no tiene las columnas de Fecha y/o Marca esperadas.")

    # Periodo (min/max de fechas reales) y muestra de formato.
    fechas = [parse_fecha(f[i_fecha]) for f in filas if i_fecha < len(f)]
    fechas = [d for d in fechas if d]
    if not fechas:
        raise ValueError("No pude leer fechas validas del GFK.")
    fmin, fmax = min(fechas), max(fechas)
    muestra_fecha = next((f[i_fecha] for f in filas if i_fecha < len(f) and f[i_fecha].strip()), "")
    span = max(0, (fmax - fmin).days)

    # Sucursales presentes (para repartir al azar de forma plausible).
    sucursales = []
    if i_suc >= 0:
        vistas = set()
        for f in filas:
            if i_suc < len(f):
                v = f[i_suc].strip()
                if v and v.lower() not in vistas:
                    vistas.add(v.lower())
                    sucursales.append(v)

    def unidades(fila: list[str]) -> int:
        return parse_cantidad(fila[i_cant]) if (i_cant >= 0 and i_cant < len(fila)) else 1

    nuevas: list[list[str]] = []
    detalle: list[dict[str, Any]] = []
    for marca, pct in marcas_pct.items():
        candidatas = [f for f in filas if i_marca < len(f) and norm(f[i_marca]) == norm(marca)]
        if not candidatas:
            detalle.append({"marca": marca, "pct": pct, "unid_reales": 0, "objetivo": 0,
                            "unid_agregadas": 0, "filas_agregadas": 0,
                            "nota": "sin ventas reales de esa marca en el GFK"})
            continue
        unid_reales = sum(unidades(f) for f in candidatas)
        objetivo = int(round(unid_reales * pct / 100.0))
        if objetivo <= 0:
            detalle.append({"marca": marca, "pct": pct, "unid_reales": unid_reales, "objetivo": 0,
                            "unid_agregadas": 0, "filas_agregadas": 0,
                            "nota": "el % aplicado da menos de 1 unidad"})
            continue
        agregadas_unid = 0
        filas_agg = 0
        guard = 0
        while agregadas_unid < objetivo and guard < objetivo * 5 + 100:
            guard += 1
            base = list(rng.choice(candidatas))  # clona una venta real de la marca
            d = fmin + timedelta(days=rng.randint(0, span)) if span else fmin
            if i_fecha < len(base):
                base[i_fecha] = fecha_a_texto(d, muestra_fecha)
            if i_suc >= 0 and sucursales and i_suc < len(base):
                base[i_suc] = rng.choice(sucursales)
            # Ajustar la cantidad de la última fila para caer EXACTO en el objetivo.
            qty = unidades(base)
            restante = objetivo - agregadas_unid
            if i_cant >= 0 and i_cant < len(base) and qty > restante:
                base[i_cant] = str(restante)
                qty = restante
            nuevas.append(base)
            agregadas_unid += qty
            filas_agg += 1
        detalle.append({"marca": marca, "pct": pct, "unid_reales": unid_reales, "objetivo": objetivo,
                        "unid_agregadas": agregadas_unid, "filas_agregadas": filas_agg, "nota": ""})

    # Mezcla las nuevas entre las reales para que no queden todas al final.
    infladas = filas + nuevas
    rng.shuffle(infladas)
    return infladas, detalle


# ============================================================
# ESCRITURA EN DRIVE / SHEETS
# ============================================================

def crear_spreadsheet_en_carpeta(drive_service, sheets_service, nombre: str, dest_folder_id: str) -> str:
    created = sheets_service.spreadsheets().create(
        body={"properties": {"title": nombre}},
        fields="spreadsheetId",
    ).execute()
    sid = created["spreadsheetId"]
    # Mover a la carpeta destino.
    f = drive_service.files().get(fileId=sid, fields="parents", supportsAllDrives=True).execute()
    prev = ",".join(f.get("parents", []))
    drive_service.files().update(
        fileId=sid, addParents=dest_folder_id, removeParents=prev,
        supportsAllDrives=True, fields="id,parents",
    ).execute()
    return sid


def volcar_examen(sheets_service, sid: str, headers: list[str], filas: list[list[str]],
                  params_rows: list[list[str]]) -> None:
    # 1) Renombrar la hoja 0 a "GFK" y crear la hoja de parametros MUY OCULTA.
    meta = sheets_service.spreadsheets().get(spreadsheetId=sid, fields="sheets(properties(sheetId,title,index))").execute()
    first_id = meta["sheets"][0]["properties"]["sheetId"]
    requests = [
        {"updateSheetProperties": {"properties": {"sheetId": first_id, "title": "GFK"}, "fields": "title"}},
        {"addSheet": {"properties": {"title": PARAMS_SHEET, "hidden": True}}},
    ]
    resp = sheets_service.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": requests}).execute()
    params_sheet_id = resp["replies"][1]["addSheet"]["properties"]["sheetId"]
    # "very hidden": en Sheets no existe; dejamos hidden=True (no aparece sin
    # "Mostrar hojas ocultas"). Igual queda como registro dentro del archivo.

    # 2) Escribir el GFK.
    valores = [headers] + filas
    sheets_service.spreadsheets().values().update(
        spreadsheetId=sid, range="GFK!A1", valueInputOption="RAW", body={"values": valores},
    ).execute()

    # 3) Escribir los parametros del examen.
    sheets_service.spreadsheets().values().update(
        spreadsheetId=sid, range=f"{PARAMS_SHEET}!A1", valueInputOption="RAW", body={"values": params_rows},
    ).execute()
    _ = params_sheet_id  # referenciado por claridad


# ============================================================
# MAIN
# ============================================================

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--dest-url", required=True)
    parser.add_argument("--marcas", required=True)
    parser.add_argument("--variantes", type=int, default=1)
    parser.add_argument("--prefijo", default="Examen GFK")
    args = parser.parse_args()

    marcas_pct = parse_marcas(args.marcas)
    if not marcas_pct:
        print("[ERROR] No entendi el parametro de marcas. Formato: 'WHIRLPOOL=10, DREAN=15' (% sobre las unidades reales).")
        return 2
    n_variantes = max(1, int(args.variantes or 1))

    print("Autenticando con Google...")
    drive_service, sheets_service = autenticar_google()

    source_id = extraer_id_de_url(args.source_url)
    dest_id = extraer_id_de_url(args.dest_url)

    print(f"Leyendo GFK original ({source_id})...")
    df = descargar_gfk_a_df(drive_service, source_id)
    h = detectar_header(df)
    headers = [str(c).strip() for c in df.iloc[h].tolist()]
    # Filas de datos: desde h+1, recortando columnas vacias del final.
    filas_raw = df.iloc[h + 1:].values.tolist()
    ancho = len(headers)
    filas = []
    for row in filas_raw:
        cells = [str(c).strip() for c in row[:ancho]]
        if any(cells):
            filas.append(cells + [""] * (ancho - len(cells)))
    print(f"GFK leido: {len(filas)} filas reales, {ancho} columnas.")
    print(f"Marcas a inflar (%): {marcas_pct}")

    generadas: list[str] = []
    for i in range(1, n_variantes + 1):
        rng = random.Random()  # cada variante distinta (sin semilla fija)
        infladas, detalle = construir_variante(headers, filas, marcas_pct, rng)
        filas_total = sum(d["filas_agregadas"] for d in detalle)
        unid_total = sum(d["unid_agregadas"] for d in detalle)

        params_rows = [
            ["EXAMEN GFK - PARAMETROS (hoja interna, no es parte del reporte real)"],
            ["Generado", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
            ["GFK original (id)", source_id],
            ["Variante", f"{i} de {n_variantes}"],
            ["Filas reales", str(len(filas))],
            ["Filas agregadas", str(filas_total)],
            ["Unidades agregadas", str(unid_total)],
            [],
            ["Marca", "% pedido", "Unid. reales", "Unid. objetivo", "Unid. agregadas", "Filas agregadas", "Nota"],
        ]
        for d in detalle:
            params_rows.append([
                d["marca"], f"{d['pct']:g}%", str(d["unid_reales"]), str(d["objetivo"]),
                str(d["unid_agregadas"]), str(d["filas_agregadas"]), d["nota"],
            ])

        nombre = f"{args.prefijo} - Variante {i:02d}"
        print(f"  Creando '{nombre}' (+{unid_total} unid / {filas_total} filas)...")
        sid = crear_spreadsheet_en_carpeta(drive_service, sheets_service, nombre, dest_id)
        volcar_examen(sheets_service, sid, headers, infladas, params_rows)
        url = f"https://docs.google.com/spreadsheets/d/{sid}/edit"
        generadas.append(url)
        print(f"    OK -> {url}")

    print("\nListo. Examenes generados:")
    for u in generadas:
        print(f"  {u}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
