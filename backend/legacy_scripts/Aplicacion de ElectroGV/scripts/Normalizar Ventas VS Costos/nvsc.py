import os
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from difflib import SequenceMatcher
from typing import Dict, List, Tuple, Optional
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
# CONFIGURACIÓN GENERAL
# =========================================================

# Alcances OAuth necesarios:
# - Sheets: leer archivos fuente y crear el resultado
# - Drive: mover el archivo generado a la carpeta destino

# Hoja del maestro de productos
MASTER_SHEET_NAME = "Productos PVP"

# Mapeo de alcance -> hoja exacta de ventas
SALES_SHEET_OPTIONS = {
    "caseros": "Ventas GV Total",
    "canning": "Ventas ABC Canning",
    "norte": "Ventas ABC-Norte",
    "sur": "Ventas ABC-Sur",
    "todo": "Venta Total Grupo Economico",
}
DEFAULT_SCOPE = "todo"

# Columnas esperadas en las planillas de ventas
EXPECTED_SALES_COLUMNS = [
    "Fecha",
    "Tipo de Venta",
    "Marca",
    "Tipo",
    "Descripcion",
    "SKU",
    "Cantidad",
    "PVP",
    "Costo",
    "Diferencia",
]

# Columnas esperadas en la planilla madre
EXPECTED_MASTER_COLUMNS = [
    "MARCA",
    "TIPO",
    "DESCRIPCION",
    "SKU",
]

# Alias tolerantes para encabezados de ventas
SALES_HEADER_MAP = {
    "FECHA": "Fecha",
    "TIPO DE VENTA": "Tipo de Venta",
    "TIPO VENTA": "Tipo de Venta",
    "MARCA": "Marca",
    "TIPO": "Tipo",
    "DESCRIPCION": "Descripcion",
    "DESCRIPCIÓN": "Descripcion",
    "SKU": "SKU",
    "CANTIDAD": "Cantidad",
    "PVP": "PVP",
    "COSTO": "Costo",
    "DIFERENCIA": "Diferencia",
}

# Alias tolerantes para encabezados del maestro
MASTER_HEADER_MAP = {
    "MARCA": "MARCA",
    "TIPO": "TIPO",
    "DESCRIPCION": "DESCRIPCION",
    "DESCRIPCIÓN": "DESCRIPCION",
    "SKU": "SKU",
}

# Valores que deben tratarse como "vacíos" o no informativos
GENERIC_MISSING_TEXT_VALUES = {
    "", "#N/A", "#¡N/A!", "N/A", "NA", "NONE", "NULL", "-", "--",
    "NO ENCONTRADO", "SKU NO ENCONTRADO", "SIN SKU", "SIN MARCA", "SIN TIPO",
    "NO CARGADO", "SIN CARGAR",
}

# Umbrales del motor de matching
DESC_ONLY_MIN_RATIO = 0.83
DESC_WITH_SKU_MIN_RATIO = 0.70
GLOBAL_ACCEPT_SCORE_WITHOUT_SKU = 0.33
GLOBAL_ACCEPT_SCORE_WITH_SKU = 0.28
BEST_MARGIN_MIN = 0.015

# =========================================================
# UTILIDADES GENERALES
# =========================================================

def extract_spreadsheet_id(url_or_id: str) -> str:
    """Extrae el spreadsheetId desde una URL de Google Sheets o acepta directamente un ID limpio."""
    text = (url_or_id or "").strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", text)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", text):
        return text
    raise ValueError(f"No pude extraer el spreadsheetId desde: {url_or_id}")

def extract_folder_id(url_or_id: str) -> str:
    """Extrae el folderId desde una URL de carpeta de Google Drive o acepta directamente un ID limpio."""
    text = (url_or_id or "").strip()
    match = re.search(r"/folders/([a-zA-Z0-9-_]+)", text)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", text):
        return text
    raise ValueError(f"No pude extraer el folderId desde: {url_or_id}")

def parse_positive_int_or_zero(text: str) -> int:
    """Convierte un texto a entero positivo. Si viene vacío, inválido, cero o negativo, devuelve 0."""
    text = str(text or "").strip()
    if text == "":
        return 0
    try:
        value = int(text)
        return value if value > 0 else 0
    except ValueError:
        return 0

def choose_sales_scope() -> Tuple[str, str]:
    """Le pide al usuario qué quiere normalizar: todo el grupo económico o una sucursal específica.
    Devuelve: scope_key, sheet_name exacto."""
    print("\n¿Qué querés normalizar?")
    print(" 1. Todo el grupo económico")
    print(" 2. Caseros")
    print(" 3. Canning")
    print(" 4. Norte")
    print(" 5. Sur")
    raw = input("Elegí una opción (1-5) o escribí: todo / caseros / canning / norte / sur: ").strip().lower()
    mapping = {
        "1": "todo", "2": "caseros", "3": "canning", "4": "norte", "5": "sur",
        "todo": "todo", "caseros": "caseros", "canning": "canning", "norte": "norte", "sur": "sur",
    }
    scope_key = mapping.get(raw, DEFAULT_SCOPE)
    sheet_name = SALES_SHEET_OPTIONS[scope_key]
    return scope_key, sheet_name

def strip_accents(text: str) -> str:
    """Elimina acentos para hacer comparaciones más robustas."""
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch))

def normalize_spaces(text: str) -> str:
    """Limpia espacios dobles, invisibles y bordes."""
    text = str(text or "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()

def is_generic_missing_value(text: str) -> bool:
    """Detecta placeholders no informativos."""
    value = normalize_spaces(text).upper()
    return value in GENERIC_MISSING_TEXT_VALUES

def clean_text(text: str) -> str:
    """Limpieza liviana de texto de celdas. Si es placeholder no informativo, devuelve vacío."""
    text = normalize_spaces(text)
    if is_generic_missing_value(text):
        return ""
    return text

def canonical_header(text: str) -> str:
    """Normaliza encabezados: elimina acentos, pasa a mayúsculas, unifica espacios."""
    text = normalize_spaces(text)
    text = strip_accents(text).upper()
    return text

def normalize_basic(text: str) -> str:
    """Normalización básica: limpia espacios, elimina acentos, pasa a mayúsculas.
    Si el valor es placeholder no informativo, devuelve vacío."""
    text = clean_text(text)
    if text == "":
        return ""
    text = strip_accents(text).upper()
    return text

def is_missing_sku_value(text: str) -> bool:
    """Detecta valores que en la práctica significan 'SKU no cargado'."""
    return is_generic_missing_value(text)

def normalize_sku(text: str) -> str:
    """Normaliza SKU para comparación: mayúsculas, sin acentos, elimina espacios y separadores comunes,
    conserva paréntesis para no perder (O). Si representa 'sin SKU', devuelve cadena vacía."""
    if is_missing_sku_value(text):
        return ""
    text = normalize_basic(text)
    text = text.replace(" ", "")
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"[^A-Z0-9()]", "", text)
    return text

def normalize_description(text: str) -> str:
    """Normaliza descripción: mayúsculas, espacios uniformes, unifica decimales y algunas unidades comunes."""
    text = clean_text(text)
    if text == "":
        return ""
    text = normalize_basic(text)
    text = text.replace("–", " ").replace("—", " ")
    text = re.sub(r"(\d)\s*[,\.]\s*(\d)", r"\1.\2", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*KG\b", r"\1KG", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*KGS\b", r"\1KG", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*LTS?\b", r"\1L", text)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*L\b", r"\1L", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def extract_outlet_flag(description: str, sku: str) -> bool:
    """Detecta si una fila parece OUTLET."""
    d = normalize_description(description)
    s = normalize_sku(sku)
    return "(O)" in d or "(O)" in s

def has_outlet_marker(description: str, sku: str) -> bool:
    """Alias conservado por compatibilidad."""
    return extract_outlet_flag(description, sku)

def remove_outlet_marker_from_sku(sku: str) -> str:
    """Devuelve el SKU base sin el marcador (O)."""
    sku_norm = normalize_sku(sku)
    return sku_norm.replace("(O)", "")

def add_outlet_marker_to_sku_if_missing(sku: str) -> str:
    """Si el SKU no trae (O), lo agrega al final."""
    sku = str(sku or "").strip()
    if sku == "":
        return sku
    if "(O)" in normalize_sku(sku):
        return sku
    return f"{sku}(O)"

def similarity_ratio(a: str, b: str) -> float:
    """Similaridad global carácter por carácter."""
    return SequenceMatcher(None, a, b).ratio()

def normalize_num_token(token: str) -> str:
    """Normaliza un número detectado dentro de un texto."""
    token = token.replace(",", ".")
    try:
        num = float(token)
        if num.is_integer():
            return str(int(num))
        return f"{num:.4f}".rstrip("0").rstrip(".")
    except ValueError:
        return token

def extract_numeric_signature(text: str) -> Tuple[str, ...]:
    """Extrae una firma numérica desde la descripción. Ejemplo: '10,5KG' -> ('10.5',)"""
    nums = re.findall(r"\d+(?:[.,]\d+)?", text or "")
    normalized = sorted(normalize_num_token(n) for n in nums)
    return tuple(normalized)

def extract_model_tokens(text: str) -> set:
    """Extrae tokens alfanuméricos que probablemente sean modelos."""
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
    """Extrae palabras/tokens útiles para comparación."""
    tokens = re.findall(r"[A-Z0-9\.]+", normalize_description(text))
    return {t for t in tokens if len(t) >= 2}

def jaccard_similarity(a: set, b: set) -> float:
    """Similaridad tipo Jaccard entre dos conjuntos."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0

def col_to_a1(col_idx_1_based: int) -> str:
    """Convierte índice de columna 1-based a notación A1. Ejemplo: 1 -> A, 27 -> AA"""
    result = ""
    n = col_idx_1_based
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result

# =========================================================
# AUTENTICACIÓN GOOGLE
# =========================================================

def get_google_services():
    """Devuelve servicios de Google Sheets y Drive. Usa OAuth con credentials.json."""
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError("No encontré credentials.json en la carpeta actual.")
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return sheets_service, drive_service

# =========================================================
# LECTURA DE GOOGLE SHEETS
# =========================================================

def read_sheet_values(service, spreadsheet_id: str, sheet_name: str) -> List[List[str]]:
    """Lee todos los valores de una hoja."""
    try:
        result = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'", majorDimension="ROWS")
            .execute()
        )
        values = result.get("values", [])
        if not values:
            raise ValueError(f"La hoja '{sheet_name}' del archivo {spreadsheet_id} está vacía.")
        return values
    except HttpError as e:
        raise RuntimeError(f"Error leyendo la hoja '{sheet_name}' del archivo {spreadsheet_id}: {e}") from e

def build_header_index(header_row: List[str]) -> Dict[str, int]:
    """Arma índice de encabezados normalizados -> posición."""
    return {canonical_header(h): idx for idx, h in enumerate(header_row)}

def repair_master_header_row(header_row: List[str]) -> List[str]:
    """Repara encabezados del maestro cuando faltan nombres esperados."""
    repaired = list(header_row)
    canonical_headers = [canonical_header(h) for h in repaired]
    if "TIPO" not in canonical_headers:
        if len(repaired) > 1 and canonical_header(repaired[1]) == "":
            repaired[1] = "TIPO"
    return repaired

def values_to_dataframe(
    values: List[List[str]],
    header_alias_map: Dict[str, str],
    expected_columns: List[str],
) -> pd.DataFrame:
    """Convierte tabla cruda a DataFrame usando alias tolerantes para encabezados."""
    if not values:
        raise ValueError("No hay datos.")
    header_row = values[0]
    data_rows = values[1:]
    header_index = build_header_index(header_row)
    present_map = {}
    for alias_canonical, final_name in header_alias_map.items():
        if alias_canonical in header_index:
            present_map[final_name] = header_index[alias_canonical]
    missing = [col for col in expected_columns if col not in present_map]
    if missing:
        raise ValueError(f"Faltan columnas requeridas: {missing}. Encabezados detectados: {header_row}")
    records = []
    for row in data_rows:
        record = {}
        for col in expected_columns:
            idx = present_map[col]
            record[col] = row[idx] if idx < len(row) else ""
        records.append(record)
    df = pd.DataFrame(records, columns=expected_columns)
    mask_non_empty = df.apply(lambda row: any(clean_text(v) != "" for v in row.tolist()), axis=1)
    df = df[mask_non_empty].reset_index(drop=True)
    return df

def load_sales_dataframe(service, spreadsheet_id: str, sales_sheet_name: str) -> pd.DataFrame:
    """Carga la hoja de ventas indicada según la sucursal o alcance elegido."""
    values = read_sheet_values(service, spreadsheet_id, sales_sheet_name)
    return values_to_dataframe(values, SALES_HEADER_MAP, EXPECTED_SALES_COLUMNS)

def load_master_dataframe(service, spreadsheet_id: str) -> pd.DataFrame:
    """Carga la hoja Productos PVP y repara encabezados si es necesario."""
    values = read_sheet_values(service, spreadsheet_id, MASTER_SHEET_NAME)
    if not values:
        raise ValueError(f"La hoja '{MASTER_SHEET_NAME}' del archivo {spreadsheet_id} está vacía.")
    repaired_values = [repair_master_header_row(values[0])] + values[1:]
    df = values_to_dataframe(repaired_values, MASTER_HEADER_MAP, EXPECTED_MASTER_COLUMNS)
    mask_valid = df.apply(
        lambda row: (clean_text(row["DESCRIPCION"]) != "") or (clean_text(row["SKU"]) != ""), axis=1
    )
    return df[mask_valid].reset_index(drop=True)

# =========================================================
# MATCHING INTERNO
# =========================================================

def enrich_master_records(master_df: pd.DataFrame) -> List[dict]:
    """Genera versión enriquecida del maestro con campos normalizados."""
    records = []
    for _, row in master_df.iterrows():
        record = {
            "MARCA": clean_text(row["MARCA"]),
            "TIPO": clean_text(row["TIPO"]),
            "DESCRIPCION": clean_text(row["DESCRIPCION"]),
            "SKU": clean_text(row["SKU"]),
        }
        record["marca_norm"] = normalize_basic(record["MARCA"])
        record["tipo_norm"] = normalize_basic(record["TIPO"])
        record["desc_norm"] = normalize_description(record["DESCRIPCION"])
        record["sku_norm"] = normalize_sku(record["SKU"])
        record["sku_base_norm"] = remove_outlet_marker_from_sku(record["SKU"])
        record["outlet_flag"] = extract_outlet_flag(record["DESCRIPCION"], record["SKU"])
        record["numbers"] = extract_numeric_signature(record["DESCRIPCION"])
        record["models"] = extract_model_tokens(record["DESCRIPCION"])
        record["desc_tokens"] = extract_word_tokens(record["DESCRIPCION"])
        records.append(record)
    return records

def build_master_indexes(master_records: List[dict]):
    """Construye índices rápidos para acelerar coincidencias claras."""
    sku_index: Dict[str, List[int]] = {}
    sku_base_index: Dict[str, List[int]] = {}
    for i, rec in enumerate(master_records):
        if rec["sku_norm"]:
            sku_index.setdefault(rec["sku_norm"], []).append(i)
        if rec["sku_base_norm"]:
            sku_base_index.setdefault(rec["sku_base_norm"], []).append(i)
    return sku_index, sku_base_index

def build_sale_meta(sale_row: pd.Series) -> dict:
    """Normaliza una fila de ventas para comparar contra el maestro."""
    marca = clean_text(sale_row["Marca"])
    tipo = clean_text(sale_row["Tipo"])
    descripcion = clean_text(sale_row["Descripcion"])
    sku_raw = clean_text(sale_row["SKU"])
    sku_missing = is_missing_sku_value(sku_raw)
    sku_norm = normalize_sku(sku_raw)
    return {
        "marca_raw": marca,
        "tipo_raw": tipo,
        "desc_raw": descripcion,
        "sku_raw": sku_raw,
        "sku_missing": sku_missing,
        "marca_norm": normalize_basic(marca),
        "tipo_norm": normalize_basic(tipo),
        "desc_norm": normalize_description(descripcion),
        "sku_norm": sku_norm,
        "sku_base_norm": remove_outlet_marker_from_sku(sku_raw) if not sku_missing else "",
        "outlet_flag": extract_outlet_flag(descripcion, sku_raw),
        "numbers": extract_numeric_signature(descripcion),
        "models": extract_model_tokens(descripcion),
        "desc_tokens": extract_word_tokens(descripcion),
    }

def score_master_candidate(sale_meta: dict, master_rec: dict) -> dict:
    """Puntaje exhaustivo contra una fila del maestro."""
    desc_ratio = similarity_ratio(sale_meta["desc_norm"], master_rec["desc_norm"])
    token_ratio = jaccard_similarity(sale_meta["desc_tokens"], master_rec["desc_tokens"])
    brand_score = 1.0 if sale_meta["marca_norm"] and sale_meta["marca_norm"] == master_rec["marca_norm"] else 0.0
    type_score = 1.0 if sale_meta["tipo_norm"] and sale_meta["tipo_norm"] == master_rec["tipo_norm"] else 0.0
    numbers_score = 0.0
    numbers_conflict = False
    if sale_meta["numbers"] and master_rec["numbers"]:
        if sale_meta["numbers"] == master_rec["numbers"]:
            numbers_score = 1.0
        else:
            numbers_score = -1.0
            numbers_conflict = True
    model_score = 0.0
    model_conflict = False
    if sale_meta["models"] and master_rec["models"]:
        if sale_meta["models"] & master_rec["models"]:
            model_score = 1.0
        else:
            model_score = -1.0
            model_conflict = True
    outlet_score = 1.0 if sale_meta["outlet_flag"] == master_rec["outlet_flag"] else 0.0
    sku_exact_score = 0.0
    sku_base_score = 0.0
    if not sale_meta["sku_missing"]:
        if sale_meta["sku_norm"] and sale_meta["sku_norm"] == master_rec["sku_norm"]:
            sku_exact_score = 1.0
        elif sale_meta["sku_base_norm"] and sale_meta["sku_base_norm"] == master_rec["sku_base_norm"]:
            sku_base_score = 1.0
    score = (
        0.38 * sku_exact_score
        + 0.18 * sku_base_score
        + 0.22 * desc_ratio
        + 0.08 * token_ratio
        + 0.05 * brand_score
        + 0.04 * type_score
        + 0.03 * outlet_score
        + 0.04 * max(model_score, 0.0)
        + 0.04 * max(numbers_score, 0.0)
    )
    if numbers_conflict:
        score -= 0.12
    if model_conflict:
        score -= 0.10
    return {
        "score": score,
        "desc_ratio": desc_ratio,
        "token_ratio": token_ratio,
        "sku_exact_score": sku_exact_score,
        "sku_base_score": sku_base_score,
        "brand_score": brand_score,
        "type_score": type_score,
        "outlet_score": outlet_score,
        "numbers_conflict": numbers_conflict,
        "model_conflict": model_conflict,
    }

def choose_best_master_match(
    sale_meta: dict,
    master_records: List[dict],
) -> Tuple[Optional[dict], float]:
    """Recorre TODO el maestro y devuelve el mejor candidato."""
    scored = []
    for rec in master_records:
        details = score_master_candidate(sale_meta, rec)
        scored.append((details["score"], details, rec))
    if not scored:
        return None, 0.0
    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_details, best_rec = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    margin = best_score - second_score if len(scored) > 1 else 1.0
    if sale_meta["sku_missing"]:
        accepted = (
            best_details["desc_ratio"] >= DESC_ONLY_MIN_RATIO
            and best_score >= GLOBAL_ACCEPT_SCORE_WITHOUT_SKU
            and margin >= BEST_MARGIN_MIN
        )
    else:
        accepted = (
            best_details["desc_ratio"] >= DESC_WITH_SKU_MIN_RATIO
            and best_score >= GLOBAL_ACCEPT_SCORE_WITH_SKU
            and margin >= 0.01
        )
    if accepted:
        return best_rec, best_score
    return None, best_score

def choose_best_from_indexes(
    sale_meta: dict,
    candidate_ids: List[int],
    master_records: List[dict],
) -> Optional[dict]:
    """Elige el mejor candidato dentro de un subconjunto identificado por índices rápidos."""
    if not candidate_ids:
        return None
    best_rec = None
    best_score = -999.0
    best_desc_ratio = -999.0
    for idx in candidate_ids:
        rec = master_records[idx]
        details = score_master_candidate(sale_meta, rec)
        if details["score"] > best_score:
            best_score = details["score"]
            best_desc_ratio = details["desc_ratio"]
            best_rec = rec
    if best_rec is not None and best_desc_ratio >= DESC_WITH_SKU_MIN_RATIO:
        return best_rec
    return None

def find_outlet_variant_for_base(
    best_rec: dict,
    sale_meta: dict,
    master_records: List[dict],
) -> Optional[dict]:
    """Busca variante outlet con el mismo SKU base."""
    if not sale_meta["outlet_flag"]:
        return None
    if best_rec["outlet_flag"]:
        return best_rec
    base = best_rec["sku_base_norm"]
    if not base:
        return None
    outlet_variants = [
        rec for rec in master_records
        if rec["sku_base_norm"] == base and rec["outlet_flag"]
    ]
    if not outlet_variants:
        return None
    best_variant = None
    best_score = -999.0
    for rec in outlet_variants:
        details = score_master_candidate(sale_meta, rec)
        if details["score"] > best_score:
            best_score = details["score"]
            best_variant = rec
    return best_variant

def match_sale_row(
    sale_row: pd.Series,
    master_records: List[dict],
    sku_index: Dict[str, List[int]],
    sku_base_index: Dict[str, List[int]],
) -> Tuple[Optional[dict], str]:
    """Match inteligente real: SKU exacto, SKU base, o barrido completo + manejo outlet."""
    sale_meta = build_sale_meta(sale_row)

    # 1) SKU exacto
    if not sale_meta["sku_missing"] and sale_meta["sku_norm"]:
        exact_candidates = sku_index.get(sale_meta["sku_norm"], [])
        if exact_candidates:
            best = choose_best_from_indexes(sale_meta, exact_candidates, master_records)
            if best:
                return best, "MATCH_EXACTO_SKU"

    # 2) SKU base sin (O)
    if not sale_meta["sku_missing"] and sale_meta["sku_base_norm"]:
        base_candidates = sku_base_index.get(sale_meta["sku_base_norm"], [])
        if base_candidates:
            best = choose_best_from_indexes(sale_meta, base_candidates, master_records)
            if best:
                if sale_meta["outlet_flag"] and not best["outlet_flag"]:
                    outlet_variant = find_outlet_variant_for_base(best, sale_meta, master_records)
                    if outlet_variant:
                        return outlet_variant, "MATCH_SKU_BASE"
                    synthetic = best.copy()
                    synthetic["SKU"] = add_outlet_marker_to_sku_if_missing(best["SKU"])
                    return synthetic, "MATCH_SKU_BASE_OUTLET_SINTETICO"
                return best, "MATCH_SKU_BASE"

    # 3) Exhaustivo: comparar contra TODO el maestro
    best_rec, _ = choose_best_master_match(sale_meta, master_records)
    if not best_rec:
        return None, "SIN_MATCH"

    # 4) Ajuste outlet
    if sale_meta["outlet_flag"] and not best_rec["outlet_flag"]:
        outlet_variant = find_outlet_variant_for_base(best_rec, sale_meta, master_records)
        if outlet_variant:
            return outlet_variant, "MATCH_ALTA_CONFIANZA"
        synthetic = best_rec.copy()
        synthetic["SKU"] = add_outlet_marker_to_sku_if_missing(best_rec["SKU"])
        return synthetic, "MATCH_DESC_OUTLET_SINTETICO"

    return best_rec, "MATCH_ALTA_CONFIANZA"

# =========================================================
# NORMALIZACIÓN PRINCIPAL
# =========================================================

def normalize_sales_against_master(
    sales_df: pd.DataFrame,
    master_df: pd.DataFrame,
) -> Tuple[pd.DataFrame, dict]:
    """Normaliza las filas de ventas contra el maestro de productos."""
    master_records = enrich_master_records(master_df)
    sku_index, sku_base_index = build_master_indexes(master_records)
    output_rows = []
    stats = {
        "MATCH_EXACTO_SKU": 0,
        "MATCH_SKU_BASE": 0,
        "MATCH_SKU_BASE_OUTLET_SINTETICO": 0,
        "MATCH_ALTA_CONFIANZA": 0,
        "MATCH_DESC_OUTLET_SINTETICO": 0,
        "SIN_MATCH": 0,
    }
    for _, sale_row in sales_df.iterrows():
        sale_copy = sale_row.copy()
        match_record, match_type = match_sale_row(
            sale_row, master_records, sku_index, sku_base_index
        )
        if match_record:
            sale_copy["Marca"] = match_record["MARCA"]
            sale_copy["Tipo"] = match_record["TIPO"]
            sale_copy["Descripcion"] = match_record["DESCRIPCION"]
            sale_copy["SKU"] = match_record["SKU"]
        stats.setdefault(match_type, 0)
        stats[match_type] += 1
        output_rows.append(sale_copy)
    output_df = pd.DataFrame(output_rows, columns=EXPECTED_SALES_COLUMNS)
    return output_df, stats

# =========================================================
# ESCRITURA EN GOOGLE SHEETS
# =========================================================

def create_output_spreadsheet(service, title: str, sheet_title: str) -> Tuple[str, str, int]:
    """Crea una nueva planilla de salida."""
    body = {
        "properties": {"title": title, "locale": "es_AR"},
        "sheets": [{"properties": {"title": sheet_title}}],
    }
    result = (
        service.spreadsheets()
        .create(body=body, fields="spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))")
        .execute()
    )
    spreadsheet_id = result["spreadsheetId"]
    spreadsheet_url = result["spreadsheetUrl"]
    sheet_id = result["sheets"][0]["properties"]["sheetId"]
    return spreadsheet_id, spreadsheet_url, sheet_id

def ensure_sheet_size(
    service,
    spreadsheet_id: str,
    sheet_id: int,
    required_rows: int,
    required_cols: int,
):
    """Asegura que la hoja tenga tamaño suficiente antes de escribir."""
    required_rows = max(required_rows, 1000)
    required_cols = max(required_cols, 26)
    requests = [
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"rowCount": required_rows, "columnCount": required_cols},
                },
                "fields": "gridProperties.rowCount,gridProperties.columnCount",
            }
        }
    ]
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()

def write_dataframe_to_sheet(
    service,
    spreadsheet_id: str,
    sheet_id: int,
    sheet_name: str,
    df: pd.DataFrame,
):
    """Escribe un DataFrame completo a la hoja, en bloques."""
    values = [list(df.columns)] + df.fillna("").astype(str).values.tolist()
    if not values:
        return
    required_rows = len(values) + 100
    required_cols = len(df.columns) + 2
    ensure_sheet_size(
        service=service,
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
        end_col = col_to_a1(len(df.columns))
        end_row = start_row + len(chunk) - 1
        range_name = f"'{sheet_name}'!A{start_row}:{end_col}{end_row}"
        body = {"values": chunk}
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="RAW",
            body=body,
        ).execute()

def format_output_sheet(service, spreadsheet_id: str, sheet_id: int, column_count: int):
    """Aplica formato básico: congela encabezado, colorea fila 1, autoajusta columnas, agrega filtro."""
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
                        "backgroundColor": {"red": 0.25, "green": 0.43, "blue": 0.63},
                        "textFormat": {"bold": True, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}},
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            }
        },
        {
            "autoResizeDimensions": {
                "dimensions": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": column_count}
            }
        },
        {
            "setBasicFilter": {
                "filter": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "startColumnIndex": 0, "endColumnIndex": column_count}}
            }
        },
    ]
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()

# =========================================================
# DRIVE
# =========================================================

def move_file_to_folder(drive_service, file_id: str, folder_id: str):
    """Mueve el archivo generado a la carpeta destino indicada."""
    current = drive_service.files().get(
        fileId=file_id, fields="id, parents", supportsAllDrives=True
    ).execute()
    previous_parents = ",".join(current.get("parents", []))
    kwargs = {
        "fileId": file_id,
        "addParents": folder_id,
        "fields": "id, parents",
        "supportsAllDrives": True,
    }
    if previous_parents:
        kwargs["removeParents"] = previous_parents
    drive_service.files().update(**kwargs).execute()

# =========================================================
# MAIN
# =========================================================

def main():
    """Flujo principal: selección de alcance, lectura, normalización, escritura y movimiento."""
    print("=" * 70)
    print("NORMALIZADOR DE VENTAS VS COSTOS CONTRA PLANILLA MADRE")
    print("=" * 70)

    scope_key, selected_sales_sheet_name = choose_sales_scope()

    files_count_input = input("Cantidad de archivos de ventas a normalizar (Enter o 0 = 4 por defecto): ").strip()
    files_count = parse_positive_int_or_zero(files_count_input)
    if files_count == 0:
        files_count = 4

    sales_urls = []
    for i in range(1, files_count + 1):
        url = input(f"Pegá el link del archivo de ventas #{i}: ").strip()
        sales_urls.append(url)

    master_url = input("Pegá el link de la planilla madre (Productos PVP): ").strip()
    output_folder_url = input("Pegá el link de la carpeta DESTINO donde guardar el resultado: ").strip()
    custom_title = input("Nombre del Google Sheet de salida (Enter para automático): ").strip()
    if not custom_title:
        custom_title = (
            f"Ventas normalizadas - {scope_key} - "
            f"{datetime.now().strftime('%Y-%m-%d %H-%M-%S')}"
        )

    print("\n[1/7] Autenticando con Google...")
    sheets_service, drive_service = get_google_services()

    print("[2/7] Resolviendo carpeta destino...")
    output_folder_id = extract_folder_id(output_folder_url)

    print(f"[INFO] Alcance seleccionado: {scope_key.upper()} -> hoja '{selected_sales_sheet_name}'")

    print("[3/7] Leyendo archivos de ventas...")
    sales_frames = []
    for idx, url in enumerate(sales_urls, start=1):
        spreadsheet_id = extract_spreadsheet_id(url)
        df = load_sales_dataframe(sheets_service, spreadsheet_id, selected_sales_sheet_name)
        sales_frames.append(df)
        print(f" - Ventas #{idx}: {len(df):,} filas")

    print("[4/7] Leyendo la planilla madre...")
    master_id = extract_spreadsheet_id(master_url)
    master_df = load_master_dataframe(sheets_service, master_id)
    print(f" - Maestro: {len(master_df):,} filas")

    print("[5/7] Unificando ventas...")
    sales_df = pd.concat(sales_frames, ignore_index=True)
    print(f" - Total ventas unificadas: {len(sales_df):,} filas")

    print("[6/7] Normalizando contra Productos PVP...")
    normalized_df, stats = normalize_sales_against_master(sales_df, master_df)

    print("[7/7] Creando Google Sheet de salida...")
    out_id, out_url, out_sheet_id = create_output_spreadsheet(
        sheets_service, custom_title, selected_sales_sheet_name
    )
    write_dataframe_to_sheet(
        sheets_service, out_id, out_sheet_id, selected_sales_sheet_name, normalized_df
    )
    format_output_sheet(sheets_service, out_id, out_sheet_id, len(normalized_df.columns))
    move_file_to_folder(drive_service=drive_service, file_id=out_id, folder_id=output_folder_id)

    print("\n" + "=" * 70)
    print("PROCESO TERMINADO")
    print("=" * 70)
    print(f"Google Sheet generado: {out_url}")
    print(f"Archivos procesados: {files_count:,}")
    print(f"Hoja normalizada: {selected_sales_sheet_name}")
    print("\nResumen de cruces:")
    for k, v in stats.items():
        print(f" - {k}: {v:,}")
    print("\nImportante:")
    print(" - La hoja final conserva solo las columnas de ventas vs costos.")
    print(" - Primero intenta por SKU.")
    print(" - Si el SKU viene vacío o como #N/A, cae automáticamente a Descripcion.")
    print(" - Si detecta outlet y solo encuentra primera, puede sintetizar SKU con (O).")
    print(" - Cuando hace falta, compara contra TODO el maestro, no solo un subconjunto.")
    print(" - Solo corrige Marca, Tipo, Descripcion y SKU cuando el match es confiable.")

if __name__ == "__main__":
    main()