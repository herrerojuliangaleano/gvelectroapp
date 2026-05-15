import os
import re
import time
import unicodedata
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

import pandas as pd
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
# CONFIG
# =========================================================


MASTER_SHEET_NAME = "Productos PVP"

PLANILLA_SHEET_NAME = "Planilla"
ONLINE_SHEET_NAME = "On Line"

OUTPUT_SHEET_CONSOLIDADO = "Consolidado"
OUTPUT_SHEET_REVISAR = "Revisar"

# --- Planilla (LOCAL)
PLANILLA_DATE_CELL = "B1"
PLANILLA_START_ROW = 5
PLANILLA_VENDOR_COL = 2        # B
PLANILLA_EFECTIVO_COL = 3      # C
PLANILLA_TRANSFER_COL = 4      # D
PLANILLA_POSNET_COL = 5        # E
PLANILLA_USD_COL = 6           # F
PLANILLA_PRODUCT_COL = 7       # G
PLANILLA_SKU_COL = 8           # H
PLANILLA_QTY_COL = 9           # I

# Cotización USD en Planilla
# Si algún día cambia a otra celda, tocás esto y listo.
PLANILLA_EXCHANGE_RATE_ROW = 1
PLANILLA_EXCHANGE_RATE_COL = 5  # E1

# --- On Line
ONLINE_DATE_CELL = "B1"
ONLINE_START_ROW = 5
ONLINE_VENDOR_COL = 2           # B
ONLINE_PRODUCT_COL = 3          # C
ONLINE_SKU_COL = 4              # D
ONLINE_QTY_COL = 5  # E
ONLINE_MONTO_INGRESADO_COL = 7  # G

EXPECTED_MASTER_COLUMNS = [
    "MARCA",
    "TIPO",
    "DESCRIPCION",
    "SKU",
]

MASTER_HEADER_MAP = {
    "MARCA": "MARCA",
    "TIPO": "TIPO",
    "DESCRIPCION": "DESCRIPCION",
    "SKU": "SKU",
}

# Matcher por descripción
FUZZY_SCORE_THRESHOLD = 0.92
FUZZY_MARGIN_THRESHOLD = 0.03

# Si querés poner pausa entre archivos
DELAY_BETWEEN_FILES_SECONDS = 0.0

# Si después de empezar a leer ventas encuentra esta cantidad de filas vacías seguidas, corta
MAX_CONSECUTIVE_EMPTY_ROWS_AFTER_DATA = 5

SUMMARY_TERMS = {
    "VENTA TOTAL",
    "TOTAL",
    "TOTALES",
    "TOTAL GENERAL",
    "VENTAS TOTALES",
    "TOTAL VENTAS",
    "SUBTOTAL",
    "MONTO TOTAL",
    "TIPO DE CAMBIO",
    "T/C",
}

# =========================================================
# UTILS GENERALES
# =========================================================

def clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.upper() in {"#N/A", "N/A", "NA", "NONE", "NULL"}:
        return ""
    return text


def normalize_spaces(text: str) -> str:
    text = str(text or "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def canonical_header(text: str) -> str:
    text = normalize_spaces(text)
    text = strip_accents(text).upper()
    return text


def normalize_basic(text: str) -> str:
    text = clean_text(text)
    text = normalize_spaces(text)
    text = strip_accents(text).upper()
    return text


def normalize_sku(text: str) -> str:
    text = normalize_basic(text)
    text = text.replace(" ", "")
    text = text.replace("–", "-").replace("—", "-")
    return text


def normalize_description(text: str) -> str:
    text = normalize_basic(text)
    text = text.replace("–", " ").replace("—", " ")

    # 10,5 -> 10.5 para comparar mejor
    text = re.sub(r"(\d)\s*[,\.]\s*(\d)", r"\1.\2", text)

    # Unidades
    text = re.sub(r"(\d+(?:\.\d+)?)\s*KG\b", r"\1KG", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*KGS\b", r"\1KG", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*LTS?\b", r"\1L", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*L\b", r"\1L", text)

    text = re.sub(r"\s+", " ", text).strip()
    return text


def has_outlet_marker(description: str, sku: str) -> bool:
    d = normalize_description(description)
    s = normalize_sku(sku)
    return "(O)" in d or "(O)" in s


def normalize_num_token(token: str) -> str:
    token = token.replace(",", ".")
    try:
        num = float(token)
        if num.is_integer():
            return str(int(num))
        return f"{num:.4f}".rstrip("0").rstrip(".")
    except ValueError:
        return token


def extract_numeric_signature(text: str) -> Tuple[str, ...]:
    nums = re.findall(r"\d+(?:[.,]\d+)?", text or "")
    normalized = sorted(normalize_num_token(n) for n in nums)
    return tuple(normalized)


def extract_model_tokens(text: str) -> set:
    raw_tokens = re.findall(r"[A-Z0-9/._-]+", normalize_description(text))
    result = set()

    for tok in raw_tokens:
        clean = tok.strip("/._-")
        if len(clean) < 4:
            continue
        has_letters = bool(re.search(r"[A-Z]", clean))
        has_digits = bool(re.search(r"\d", clean))
        if has_letters and has_digits:
            canonical = re.sub(r"[/._-]+", "", clean)
            result.add(canonical)

    return result


def extract_word_tokens(text: str) -> set:
    tokens = re.findall(r"[A-Z0-9\.]+", normalize_description(text))
    return {t for t in tokens if len(t) >= 2}


def jaccard_similarity(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def parse_date_from_string(text: str) -> Optional[datetime]:
    text = clean_text(text)
    if not text:
        return None

    m = re.search(r"(\d{1,2})[\/\-_\.](\d{1,2})[\/\-_\.](\d{2,4})", text)
    if m:
        dd, mm, yy = m.groups()
        day = int(dd)
        month = int(mm)
        year = int(yy)
        if year < 100:
            year += 2000
        try:
            return datetime(year, month, day)
        except ValueError:
            pass

    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    try:
        dt = pd.to_datetime(text, errors="coerce", dayfirst=True)
        if pd.isna(dt):
            return None
        return dt.to_pydatetime()
    except Exception:
        return None


def format_date(dt: Optional[datetime]) -> str:
    if not dt:
        return ""
    return dt.strftime("%d/%m/%Y")


def extract_spreadsheet_id(url_or_id: str) -> str:
    text = (url_or_id or "").strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", text)
    if match:
        return match.group(1)

    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", text):
        return text

    raise ValueError(f"No pude extraer el spreadsheetId desde: {url_or_id}")


def extract_folder_id(url_or_id: str) -> str:
    text = (url_or_id or "").strip()
    match = re.search(r"/folders/([a-zA-Z0-9-_]+)", text)
    if match:
        return match.group(1)

    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", text):
        return text

    raise ValueError(f"No pude extraer el folderId desde: {url_or_id}")


def col_to_a1(col_idx_1_based: int) -> str:
    result = ""
    n = col_idx_1_based
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


def safe_cell(row: List, idx_1_based: int):
    idx = idx_1_based - 1
    if idx < len(row):
        return row[idx]
    return ""


def values_to_dataframe(
    values: List[List[str]],
    header_alias_map: Dict[str, str],
    expected_columns: List[str],
) -> pd.DataFrame:
    header_row = values[0]
    data_rows = values[1:]

    header_index = {canonical_header(h): idx for idx, h in enumerate(header_row)}

    present_map = {}
    for alias, final_name in header_alias_map.items():
        if alias in header_index:
            present_map[final_name] = header_index[alias]

    missing = [col for col in expected_columns if col not in present_map]
    if missing:
        raise ValueError(
            f"Faltan columnas requeridas: {missing}. Encabezados detectados: {header_row}"
        )

    records = []
    for row in data_rows:
        record = {}
        for col in expected_columns:
            idx = present_map[col]
            record[col] = row[idx] if idx < len(row) else ""
        records.append(record)

    return pd.DataFrame(records, columns=expected_columns)


def convert_df_to_sheet_values(df: pd.DataFrame) -> List[List]:
    values = [list(df.columns)]
    for _, row in df.iterrows():
        out_row = []
        for value in row.tolist():
            if pd.isna(value):
                out_row.append("")
            else:
                out_row.append(value)
        values.append(out_row)
    return values


# =========================================================
# PARSER SOLO PARA CÁLCULOS INTERNOS
# =========================================================

def parse_ar_number_for_calc(value) -> float:
    """
    Parser SOLO para cálculo interno.
    No toca ni cambia cómo se exportan los importes originales.
    """
    text = clean_text(value)
    if text == "":
        return 0.0

    text = text.replace("\xa0", "").replace(" ", "")
    text = text.replace("$", "").replace("U$S", "").replace("USD", "")

    if "," in text and "." in text:
        # 1.370,00 -> 1370.00
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        # 25,50 -> 25.50
        text = text.replace(",", ".")
    else:
        # solo puntos
        if text.count(".") > 1:
            text = text.replace(".", "")
        elif re.fullmatch(r"\d+\.\d{3}", text):
            # 700.000 -> 700000
            text = text.replace(".", "")

    try:
        return float(text)
    except ValueError:
        return 0.0


def maybe_int(value: float):
    if float(value).is_integer():
        return int(value)
    return round(value, 2)


def extract_planilla_exchange_rate(values: List[List[str]]) -> float:
    row_idx = PLANILLA_EXCHANGE_RATE_ROW - 1
    col_idx = PLANILLA_EXCHANGE_RATE_COL - 1

    if row_idx < len(values) and col_idx < len(values[row_idx]):
        raw_value = values[row_idx][col_idx]
        return parse_ar_number_for_calc(raw_value)

    return 0.0


# =========================================================
# DETECCIÓN DE FILAS VÁLIDAS / BASURA
# =========================================================

def is_summary_text(text: str) -> bool:
    t = normalize_basic(text)
    if not t:
        return False

    if t in SUMMARY_TERMS:
        return True

    summary_prefixes = [
        "VENTA TOTAL",
        "TOTAL",
        "TOTALES",
        "TOTAL GENERAL",
        "TOTAL VENTAS",
        "VENTAS TOTALES",
        "SUBTOTAL",
    ]

    return any(t.startswith(prefix) for prefix in summary_prefixes)


def is_noise_or_total_row(product: str, sku: str, vendor: str) -> bool:
    p = normalize_basic(product)
    s = normalize_basic(sku)
    v = normalize_basic(vendor)

    for candidate in (p, s, v):
        if is_summary_text(candidate):
            return True

    return False


def row_is_completely_empty(values: List[str]) -> bool:
    return all(clean_text(v) == "" for v in values)


def has_valid_quantity(value: str) -> bool:
    """
    Define si una fila debe considerarse venta válida en función de la cantidad.

    Reglas:
    - vacío, guiones, #N/A o similares => inválido
    - 0 => inválido
    - cualquier número distinto de 0 => válido
    - cualquier texto no vacío distinto de placeholders => válido
    """
    text = clean_text(value)
    if text == "":
        return False

    normalized = normalize_basic(text)
    if normalized in {"-", "--"}:
        return False

    candidate = text.replace(".", "").replace(",", ".")
    try:
        qty = float(candidate)
        return qty != 0
    except ValueError:
        return True


# =========================================================
# AUTH
# =========================================================

def get_google_services():
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError("No encontré credentials.json en la misma carpeta del script.")

            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return sheets_service, drive_service


# =========================================================
# DRIVE
# =========================================================

def list_spreadsheets_in_folder(drive_service, folder_id: str) -> List[dict]:
    query = (
        f"'{folder_id}' in parents and "
        f"mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    )

    files = []
    page_token = None

    while True:
        response = (
            drive_service.files()
            .list(
                q=query,
                fields="nextPageToken, files(id,name,createdTime,modifiedTime)",
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


def move_file_to_folder(drive_service, file_id: str, folder_id: str):
    current = (
        drive_service.files()
        .get(
            fileId=file_id,
            fields="id, parents",
            supportsAllDrives=True,
        )
        .execute()
    )

    previous_parents = ",".join(current.get("parents", []))

    drive_service.files().update(
        fileId=file_id,
        addParents=folder_id,
        removeParents=previous_parents if previous_parents else None,
        fields="id, parents",
        supportsAllDrives=True,
    ).execute()


# =========================================================
# SHEETS READ
# =========================================================

def read_sheet_values(sheets_service, spreadsheet_id: str, sheet_name: str) -> Optional[List[List[str]]]:
    try:
        result = (
            sheets_service.spreadsheets()
            .values()
            .get(
                spreadsheetId=spreadsheet_id,
                range=f"'{sheet_name}'",
                majorDimension="ROWS",
            )
            .execute()
        )
        return result.get("values", [])
    except HttpError:
        return None


def load_master_dataframe(sheets_service, spreadsheet_id: str) -> pd.DataFrame:
    values = read_sheet_values(sheets_service, spreadsheet_id, MASTER_SHEET_NAME)
    if not values:
        raise ValueError(f"No pude leer la hoja '{MASTER_SHEET_NAME}' del archivo maestro.")

    return values_to_dataframe(values, MASTER_HEADER_MAP, EXPECTED_MASTER_COLUMNS)


# =========================================================
# MASTER / MATCHER
# =========================================================

def enrich_master_records(master_df: pd.DataFrame) -> List[dict]:
    records = []

    for _, row in master_df.iterrows():
        rec = {
            "MARCA": clean_text(row["MARCA"]),
            "TIPO": clean_text(row["TIPO"]),
            "DESCRIPCION": clean_text(row["DESCRIPCION"]),
            "SKU": clean_text(row["SKU"]),
        }

        rec["desc_norm"] = normalize_description(rec["DESCRIPCION"])
        rec["sku_norm"] = normalize_sku(rec["SKU"])
        rec["outlet_flag"] = has_outlet_marker(rec["DESCRIPCION"], rec["SKU"])
        rec["numbers"] = extract_numeric_signature(rec["DESCRIPCION"])
        rec["models"] = extract_model_tokens(rec["DESCRIPCION"])
        rec["tokens"] = extract_word_tokens(rec["DESCRIPCION"])

        records.append(rec)

    return records


def build_master_indexes(master_records: List[dict]):
    sku_index = defaultdict(list)
    desc_exact_index = defaultdict(list)
    token_index = defaultdict(set)

    for i, rec in enumerate(master_records):
        if rec["sku_norm"]:
            sku_index[rec["sku_norm"]].append(i)

        desc_exact_index[(rec["desc_norm"], rec["outlet_flag"])].append(i)

        for tok in rec["tokens"] | rec["models"]:
            if len(tok) >= 3:
                token_index[tok].add(i)

    return sku_index, desc_exact_index, token_index


def canonical_from_master(rec: dict) -> Tuple[str, str]:
    return rec["DESCRIPCION"], rec["SKU"]


def unique_or_none(candidate_ids: List[int], master_records: List[dict]) -> Optional[dict]:
    if not candidate_ids:
        return None

    canonicals = {(master_records[i]["DESCRIPCION"], master_records[i]["SKU"]) for i in candidate_ids}
    if len(canonicals) == 1:
        return master_records[candidate_ids[0]]

    if len(candidate_ids) == 1:
        return master_records[candidate_ids[0]]

    return None


def numbers_compatible(source_desc: str, master_rec: dict) -> bool:
    src_nums = extract_numeric_signature(source_desc)
    dst_nums = master_rec["numbers"]

    if src_nums and dst_nums and src_nums != dst_nums:
        return False
    return True


def models_compatible(source_desc: str, master_rec: dict) -> bool:
    src_models = extract_model_tokens(source_desc)
    dst_models = master_rec["models"]

    if src_models and dst_models and not (src_models & dst_models):
        return False
    return True


def outlet_compatible(source_desc: str, source_sku: str, master_rec: dict) -> bool:
    src_outlet = has_outlet_marker(source_desc, source_sku)
    return src_outlet == master_rec["outlet_flag"]


def fuzzy_description_match(
    product: str,
    sku: str,
    master_records: List[dict],
    desc_exact_index: dict,
    token_index: dict,
) -> Tuple[Optional[dict], str]:
    product_norm = normalize_description(product)
    if not product_norm:
        return None, "PRODUCTO_VACIO"

    outlet_flag = has_outlet_marker(product, sku)

    exact_candidates = desc_exact_index.get((product_norm, outlet_flag), [])
    exact_pick = unique_or_none(exact_candidates, master_records)
    if exact_pick:
        return exact_pick, "MATCH_DESC_EXACTA"

    source_tokens = extract_word_tokens(product) | extract_model_tokens(product)
    candidate_ids = set()

    for tok in source_tokens:
        if len(tok) >= 3:
            candidate_ids |= token_index.get(tok, set())

    if not candidate_ids:
        candidate_ids = set(range(len(master_records)))

    scored = []
    source_tokens_only = extract_word_tokens(product)

    for i in candidate_ids:
        rec = master_records[i]

        if not outlet_compatible(product, sku, rec):
            continue
        if not numbers_compatible(product, rec):
            continue
        if not models_compatible(product, rec):
            continue

        desc_ratio = SequenceMatcher(None, product_norm, rec["desc_norm"]).ratio()
        token_ratio = jaccard_similarity(source_tokens_only, rec["tokens"])
        score = (0.82 * desc_ratio) + (0.18 * token_ratio)

        scored.append((score, desc_ratio, token_ratio, rec))

    if not scored:
        return None, "SIN_MATCH_POR_PRODUCTO"

    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    best = scored[0]
    second = scored[1] if len(scored) > 1 else None
    margin = best[0] - second[0] if second else 1.0

    if best[0] >= FUZZY_SCORE_THRESHOLD and margin >= FUZZY_MARGIN_THRESHOLD:
        return best[3], "MATCH_DESC_FUZZY"

    return None, "PRODUCTO_AMBIGUO_O_BAJA_CONFIANZA"


def normalize_product_and_sku(
    product: str,
    sku: str,
    master_records: List[dict],
    sku_index: dict,
    desc_exact_index: dict,
    token_index: dict,
) -> Tuple[str, str, bool, str]:
    original_product = clean_text(product)
    original_sku = clean_text(sku)

    sku_norm = normalize_sku(original_sku)

    if sku_norm:
        sku_candidates = sku_index.get(sku_norm, [])
        sku_pick = unique_or_none(sku_candidates, master_records)
        if sku_pick:
            canon_product, canon_sku = canonical_from_master(sku_pick)
            return canon_product, canon_sku, True, "MATCH_SKU_EXACTO"

    desc_pick, reason = fuzzy_description_match(
        product=original_product,
        sku=original_sku,
        master_records=master_records,
        desc_exact_index=desc_exact_index,
        token_index=token_index,
    )

    if desc_pick:
        canon_product, canon_sku = canonical_from_master(desc_pick)
        return canon_product, canon_sku, True, reason

    return original_product, original_sku, False, reason


# =========================================================
# FECHA
# =========================================================

def extract_date_from_sheet_or_name(values: Optional[List[List[str]]], file_name: str) -> Tuple[str, Optional[datetime], str]:
    if values and len(values) >= 1 and len(values[0]) >= 2:
        b1 = clean_text(values[0][1])
        dt = parse_date_from_string(b1)
        if dt:
            return format_date(dt), dt, "B1"

    dt = parse_date_from_string(file_name)
    if dt:
        return format_date(dt), dt, "NOMBRE_ARCHIVO"

    return "", None, "SIN_FECHA"


# =========================================================
# PARSEO DE DIARIAS
# =========================================================

def parse_planilla_rows(
    values: List[List[str]],
    file_name: str,
    master_records: List[dict],
    sku_index: dict,
    desc_exact_index: dict,
    token_index: dict,
) -> Tuple[List[dict], List[dict]]:
    consolidated = []
    revisar = []

    fecha_text, fecha_dt, _ = extract_date_from_sheet_or_name(values, file_name)
    exchange_rate = extract_planilla_exchange_rate(values)

    orden = 0
    data_started = False
    consecutive_empty_rows = 0

    for row_num, row in enumerate(values[PLANILLA_START_ROW - 1:], start=PLANILLA_START_ROW):
        vendedor = clean_text(safe_cell(row, PLANILLA_VENDOR_COL))
        efectivo_raw = clean_text(safe_cell(row, PLANILLA_EFECTIVO_COL))
        transferencia_raw = clean_text(safe_cell(row, PLANILLA_TRANSFER_COL))
        posnet_raw = clean_text(safe_cell(row, PLANILLA_POSNET_COL))
        dolares_raw = clean_text(safe_cell(row, PLANILLA_USD_COL))
        producto_original = clean_text(safe_cell(row, PLANILLA_PRODUCT_COL))
        sku_original = clean_text(safe_cell(row, PLANILLA_SKU_COL))
        cantidad_raw = clean_text(safe_cell(row, PLANILLA_QTY_COL))

        core_values = [
            vendedor,
            efectivo_raw,
            transferencia_raw,
            posnet_raw,
            dolares_raw,
            producto_original,
            sku_original,
            cantidad_raw,
        ]

        if row_is_completely_empty(core_values):
            if data_started:
                consecutive_empty_rows += 1
                if consecutive_empty_rows >= MAX_CONSECUTIVE_EMPTY_ROWS_AFTER_DATA:
                    break
            continue

        consecutive_empty_rows = 0

        if is_noise_or_total_row(producto_original, sku_original, vendedor):
            if data_started:
                break
            continue

        if producto_original == "" and sku_original == "":
            continue

        if not has_valid_quantity(cantidad_raw):
            continue

        data_started = True
        orden += 1

        producto_final, sku_final, ok, motivo = normalize_product_and_sku(
            product=producto_original,
            sku=sku_original,
            master_records=master_records,
            sku_index=sku_index,
            desc_exact_index=desc_exact_index,
            token_index=token_index,
        )

        dolares_num = parse_ar_number_for_calc(dolares_raw)
        dolares_a_pesos = maybe_int(dolares_num * exchange_rate) if dolares_num > 0 and exchange_rate > 0 else ""

        out = {
            "Fecha": fecha_text,
            "Vendedor": vendedor,
            "Efectivo": efectivo_raw,
            "Transferencia": transferencia_raw,
            "Posnet": posnet_raw,
            "Dolares": dolares_raw,
            "Dolares a Pesos": dolares_a_pesos,
            "Cantidad": cantidad_raw,
            "Producto": producto_final,
            "SKU": sku_final,
            "Tipo de venta": "LOCAL",
            "Archivo origen": file_name,
            "Orden": orden,
            "_fecha_dt": fecha_dt,
        }
        consolidated.append(out)

        review_reason = []
        if not fecha_text:
            review_reason.append("FECHA_NO_DETECTADA")
        if not ok:
            review_reason.append(motivo)

        if review_reason:
            revisar.append({
                "Fecha": fecha_text,
                "Vendedor": vendedor,
                "Efectivo": efectivo_raw,
                "Transferencia": transferencia_raw,
                "Posnet": posnet_raw,
                "Dolares": dolares_raw,
                "Dolares a Pesos": dolares_a_pesos,
                "Cantidad": cantidad_raw,
                "Producto": producto_final,
                "SKU": sku_final,
                "Tipo de venta": "LOCAL",
                "Archivo origen": file_name,
                "Orden": orden,
                "Producto original": producto_original,
                "SKU original": sku_original,
                "Motivo revisar": " | ".join(review_reason),
                "_fecha_dt": fecha_dt,
            })

    return consolidated, revisar


def parse_online_rows(
    values: List[List[str]],
    file_name: str,
    master_records: List[dict],
    sku_index: dict,
    desc_exact_index: dict,
    token_index: dict,
) -> Tuple[List[dict], List[dict]]:
    consolidated = []
    revisar = []

    fecha_text, fecha_dt, _ = extract_date_from_sheet_or_name(values, file_name)

    orden = 0
    data_started = False
    consecutive_empty_rows = 0

    for row_num, row in enumerate(values[ONLINE_START_ROW - 1:], start=ONLINE_START_ROW):
        vendedor = clean_text(safe_cell(row, ONLINE_VENDOR_COL))
        producto_original = clean_text(safe_cell(row, ONLINE_PRODUCT_COL))
        sku_original = clean_text(safe_cell(row, ONLINE_SKU_COL))
        cantidad_raw = clean_text(safe_cell(row, ONLINE_QTY_COL))
        monto_ingresado_raw = clean_text(safe_cell(row, ONLINE_MONTO_INGRESADO_COL))

        core_values = [
            vendedor,
            producto_original,
            sku_original,
            cantidad_raw,
            monto_ingresado_raw,
        ]

        if row_is_completely_empty(core_values):
            if data_started:
                consecutive_empty_rows += 1
                if consecutive_empty_rows >= MAX_CONSECUTIVE_EMPTY_ROWS_AFTER_DATA:
                    break
            continue

        consecutive_empty_rows = 0

        if is_noise_or_total_row(producto_original, sku_original, vendedor):
            if data_started:
                break
            continue

        if producto_original == "" and sku_original == "":
            continue

        if not has_valid_quantity(cantidad_raw):
            continue

        data_started = True
        orden += 1

        producto_final, sku_final, ok, motivo = normalize_product_and_sku(
            product=producto_original,
            sku=sku_original,
            master_records=master_records,
            sku_index=sku_index,
            desc_exact_index=desc_exact_index,
            token_index=token_index,
        )

        out = {
            "Fecha": fecha_text,
            "Vendedor": vendedor,
            "Efectivo": "",
            "Transferencia": monto_ingresado_raw,
            "Posnet": "",
            "Dolares": "",
            "Dolares a Pesos": "",
            "Cantidad": cantidad_raw,
            "Producto": producto_final,
            "SKU": sku_final,
            "Tipo de venta": "ON LINE",
            "Archivo origen": file_name,
            "Orden": orden,
            "_fecha_dt": fecha_dt,
        }
        consolidated.append(out)

        review_reason = []
        if not fecha_text:
            review_reason.append("FECHA_NO_DETECTADA")
        if not ok:
            review_reason.append(motivo)

        if review_reason:
            revisar.append({
                "Fecha": fecha_text,
                "Vendedor": vendedor,
                "Efectivo": "",
                "Transferencia": monto_ingresado_raw,
                "Posnet": "",
                "Dolares": "",
                "Dolares a Pesos": "",
                "Cantidad": cantidad_raw,
                "Producto": producto_final,
                "SKU": sku_final,
                "Tipo de venta": "ON LINE",
                "Archivo origen": file_name,
                "Orden": orden,
                "Producto original": producto_original,
                "SKU original": sku_original,
                "Motivo revisar": " | ".join(review_reason),
                "_fecha_dt": fecha_dt,
            })

    return consolidated, revisar


# =========================================================
# CONSOLIDACIÓN
# =========================================================

def process_folder_files(
    sheets_service,
    drive_service,
    source_folder_id: str,
    master_records: List[dict],
    sku_index: dict,
    desc_exact_index: dict,
    token_index: dict,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    files = list_spreadsheets_in_folder(drive_service, source_folder_id)
    if not files:
        raise ValueError("No encontré Google Sheets dentro de la carpeta origen.")

    all_consolidated = []
    all_revisar = []

    print(f"\nSe encontraron {len(files)} archivos en la carpeta.\n")

    for i, file in enumerate(files, start=1):
        file_id = file["id"]
        file_name = file["name"]

        print(f"[{i}/{len(files)}] Procesando: {file_name}")

        planilla_values = read_sheet_values(sheets_service, file_id, PLANILLA_SHEET_NAME)
        online_values = read_sheet_values(sheets_service, file_id, ONLINE_SHEET_NAME)

        file_rows = 0
        file_reviews = 0

        if planilla_values:
            cons, rev = parse_planilla_rows(
                values=planilla_values,
                file_name=file_name,
                master_records=master_records,
                sku_index=sku_index,
                desc_exact_index=desc_exact_index,
                token_index=token_index,
            )
            all_consolidated.extend(cons)
            all_revisar.extend(rev)
            file_rows += len(cons)
            file_reviews += len(rev)

        if online_values:
            cons, rev = parse_online_rows(
                values=online_values,
                file_name=file_name,
                master_records=master_records,
                sku_index=sku_index,
                desc_exact_index=desc_exact_index,
                token_index=token_index,
            )
            all_consolidated.extend(cons)
            all_revisar.extend(rev)
            file_rows += len(cons)
            file_reviews += len(rev)

        if not planilla_values and not online_values:
            print("   - No encontré ni 'Planilla' ni 'On Line'.")

        print(f"   - Filas consolidadas: {file_rows}")
        print(f"   - Filas a revisar:   {file_reviews}")

        if DELAY_BETWEEN_FILES_SECONDS > 0:
            time.sleep(DELAY_BETWEEN_FILES_SECONDS)

    consolidated_df = pd.DataFrame(all_consolidated)
    revisar_df = pd.DataFrame(all_revisar)

    if not consolidated_df.empty:
        consolidated_df["Tipo_venta_orden"] = consolidated_df["Tipo de venta"].map({"LOCAL": 0, "ON LINE": 1}).fillna(9)
        consolidated_df = consolidated_df.sort_values(
            by=["_fecha_dt", "Archivo origen", "Tipo_venta_orden", "Orden"],
            ascending=[True, True, True, True],
            na_position="last",
        ).reset_index(drop=True)
        consolidated_df = consolidated_df.drop(columns=["_fecha_dt", "Tipo_venta_orden"], errors="ignore")

    if not revisar_df.empty:
        revisar_df["Tipo_venta_orden"] = revisar_df["Tipo de venta"].map({"LOCAL": 0, "ON LINE": 1}).fillna(9)
        revisar_df = revisar_df.sort_values(
            by=["_fecha_dt", "Archivo origen", "Tipo_venta_orden", "Orden"],
            ascending=[True, True, True, True],
            na_position="last",
        ).reset_index(drop=True)
        revisar_df = revisar_df.drop(columns=["_fecha_dt", "Tipo_venta_orden"], errors="ignore")

    consolidated_columns = [
        "Fecha",
        "Vendedor",
        "Efectivo",
        "Transferencia",
        "Posnet",
        "Dolares",
        "Dolares a Pesos",
        "Cantidad",
        "Producto",
        "SKU",
        "Tipo de venta",
        "Archivo origen",
        "Orden",
    ]

    revisar_columns = [
        "Fecha",
        "Vendedor",
        "Efectivo",
        "Transferencia",
        "Posnet",
        "Dolares",
        "Dolares a Pesos",
        "Cantidad",
        "Producto",
        "SKU",
        "Tipo de venta",
        "Archivo origen",
        "Orden",
        "Producto original",
        "SKU original",
        "Motivo revisar",
    ]

    if consolidated_df.empty:
        consolidated_df = pd.DataFrame(columns=consolidated_columns)
    else:
        consolidated_df = consolidated_df[consolidated_columns]

    if revisar_df.empty:
        revisar_df = pd.DataFrame(columns=revisar_columns)
    else:
        revisar_df = revisar_df[revisar_columns]

    return consolidated_df, revisar_df


# =========================================================
# CREATE / WRITE OUTPUT SPREADSHEET
# =========================================================

def create_output_spreadsheet(sheets_service, title: str) -> Tuple[str, str, int]:
    body = {
        "properties": {
            "title": title,
            "locale": "es_AR",
        },
        "sheets": [
            {
                "properties": {
                    "title": OUTPUT_SHEET_CONSOLIDADO,
                }
            }
        ],
    }

    result = (
        sheets_service.spreadsheets()
        .create(
            body=body,
            fields="spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))",
        )
        .execute()
    )

    spreadsheet_id = result["spreadsheetId"]
    spreadsheet_url = result["spreadsheetUrl"]
    first_sheet_id = result["sheets"][0]["properties"]["sheetId"]
    return spreadsheet_id, spreadsheet_url, first_sheet_id


def add_sheet(sheets_service, spreadsheet_id: str, sheet_title: str) -> int:
    result = (
        sheets_service.spreadsheets()
        .batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "requests": [
                    {
                        "addSheet": {
                            "properties": {
                                "title": sheet_title
                            }
                        }
                    }
                ]
            },
        )
        .execute()
    )

    return result["replies"][0]["addSheet"]["properties"]["sheetId"]


def ensure_sheet_size(sheets_service, spreadsheet_id: str, sheet_id: int, required_rows: int, required_cols: int):
    required_rows = max(required_rows, 1000)
    required_cols = max(required_cols, 26)

    body = {
        "requests": [
            {
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "gridProperties": {
                            "rowCount": required_rows,
                            "columnCount": required_cols,
                        },
                    },
                    "fields": "gridProperties.rowCount,gridProperties.columnCount",
                }
            }
        ]
    }

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body=body,
    ).execute()


def write_dataframe_to_sheet(sheets_service, spreadsheet_id: str, sheet_id: int, sheet_name: str, df: pd.DataFrame):
    values = convert_df_to_sheet_values(df)

    required_rows = len(values) + 100
    required_cols = len(df.columns) + 2

    ensure_sheet_size(
        sheets_service=sheets_service,
        spreadsheet_id=spreadsheet_id,
        sheet_id=sheet_id,
        required_rows=required_rows,
        required_cols=required_cols,
    )

    chunk_size = 5000
    total_rows = len(values)

    for start in range(0, total_rows, chunk_size):
        chunk = values[start:start + chunk_size]
        start_row = start + 1
        end_row = start_row + len(chunk) - 1
        end_col = col_to_a1(len(df.columns))

        range_name = f"'{sheet_name}'!A{start_row}:{end_col}{end_row}"

        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="RAW",
            body={"values": chunk},
        ).execute()


def format_sheet(sheets_service, spreadsheet_id: str, sheet_id: int, column_count: int):
    body = {
        "requests": [
            {
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "gridProperties": {
                            "frozenRowCount": 1
                        }
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
                                "red": 0.25,
                                "green": 0.43,
                                "blue": 0.63,
                            },
                            "textFormat": {
                                "bold": True,
                                "foregroundColor": {
                                    "red": 1.0,
                                    "green": 1.0,
                                    "blue": 1.0,
                                },
                            },
                            "horizontalAlignment": "CENTER",
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
                }
            },
            {
                "autoResizeDimensions": {
                    "dimensions": {
                        "sheetId": sheet_id,
                        "dimension": "COLUMNS",
                        "startIndex": 0,
                        "endIndex": max(column_count, 1),
                    }
                }
            },
            {
                "setBasicFilter": {
                    "filter": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "startColumnIndex": 0,
                            "endColumnIndex": max(column_count, 1),
                        }
                    }
                }
            },
        ]
    }

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body=body,
    ).execute()


# =========================================================
# MAIN
# =========================================================

def main():
    print("=" * 80)
    print("NORMALIZADOR DE CARPETA DE DIARIAS CONTRA PRODUCTOS PVP")
    print("=" * 80)

    source_folder_url = input("Pegá el link de la carpeta ORIGEN con las diarias: ").strip()
    master_spreadsheet_url = input("Pegá el link del archivo que tiene 'Productos PVP': ").strip()
    output_folder_url = input("Pegá el link de la carpeta DESTINO donde guardar el resultado: ").strip()
    output_title = input("Nombre del Google Sheet de salida (Enter para automático): ").strip()

    if not output_title:
        output_title = f"Diarias normalizadas {datetime.now().strftime('%Y-%m-%d %H-%M-%S')}"

    print("\n[1/7] Autenticando con Google...")
    sheets_service, drive_service = get_google_services()

    print("[2/7] Resolviendo IDs...")
    source_folder_id = extract_folder_id(source_folder_url)
    master_spreadsheet_id = extract_spreadsheet_id(master_spreadsheet_url)
    output_folder_id = extract_folder_id(output_folder_url)

    print("[3/7] Leyendo Productos PVP...")
    master_df = load_master_dataframe(sheets_service, master_spreadsheet_id)
    print(f"   - Filas en maestro: {len(master_df):,}")

    print("[4/7] Preparando índices del normalizador...")
    master_records = enrich_master_records(master_df)
    sku_index, desc_exact_index, token_index = build_master_indexes(master_records)
    print(f"   - Registros indexados: {len(master_records):,}")

    print("[5/7] Procesando carpeta de diarias...")
    consolidated_df, revisar_df = process_folder_files(
        sheets_service=sheets_service,
        drive_service=drive_service,
        source_folder_id=source_folder_id,
        master_records=master_records,
        sku_index=sku_index,
        desc_exact_index=desc_exact_index,
        token_index=token_index,
    )

    print("\n[6/7] Creando Google Sheet de salida...")
    out_spreadsheet_id, out_spreadsheet_url, consolidado_sheet_id = create_output_spreadsheet(
        sheets_service=sheets_service,
        title=output_title,
    )

    revisar_sheet_id = add_sheet(
        sheets_service=sheets_service,
        spreadsheet_id=out_spreadsheet_id,
        sheet_title=OUTPUT_SHEET_REVISAR,
    )

    print("[7/7] Escribiendo hojas y moviendo archivo...")
    write_dataframe_to_sheet(
        sheets_service=sheets_service,
        spreadsheet_id=out_spreadsheet_id,
        sheet_id=consolidado_sheet_id,
        sheet_name=OUTPUT_SHEET_CONSOLIDADO,
        df=consolidated_df,
    )
    format_sheet(
        sheets_service=sheets_service,
        spreadsheet_id=out_spreadsheet_id,
        sheet_id=consolidado_sheet_id,
        column_count=len(consolidated_df.columns),
    )

    write_dataframe_to_sheet(
        sheets_service=sheets_service,
        spreadsheet_id=out_spreadsheet_id,
        sheet_id=revisar_sheet_id,
        sheet_name=OUTPUT_SHEET_REVISAR,
        df=revisar_df,
    )
    format_sheet(
        sheets_service=sheets_service,
        spreadsheet_id=out_spreadsheet_id,
        sheet_id=revisar_sheet_id,
        column_count=len(revisar_df.columns),
    )

    move_file_to_folder(
        drive_service=drive_service,
        file_id=out_spreadsheet_id,
        folder_id=output_folder_id,
    )

    print("\n" + "=" * 80)
    print("PROCESO TERMINADO")
    print("=" * 80)
    print(f"Google Sheet generado: {out_spreadsheet_url}")
    print("\nResumen:")
    print(f" - Filas en Consolidado: {len(consolidated_df):,}")
    print(f" - Filas en Revisar:     {len(revisar_df):,}")
    print("\nAhora el consolidado trae:")
    print(" Fecha | Vendedor | Efectivo | Transferencia | Posnet | Dolares | Dolares a Pesos | Cantidad | Producto | SKU | Tipo de venta | Archivo origen | Orden ")


if __name__ == "__main__":
    main()