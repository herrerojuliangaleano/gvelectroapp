from __future__ import annotations

import io
import json
import re
import sqlite3
import unicodedata
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import openpyxl

from .config import get_settings
from .google_sheets import sheets_service
from .operational_config import extract_spreadsheet_id


# ── helpers ──────────────────────────────────────────────────────────────────


def _norm(v: Any) -> str:
    if v is None:
        return ""
    s = unicodedata.normalize("NFKD", str(v))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.upper().strip()
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_num(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[$\s]", "", str(v).strip())
    if not s or s == "-":
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _is_date_like(v: Any) -> bool:
    if isinstance(v, (datetime, date)):
        return True
    # Google Sheets serial date (days since 1899-12-30)
    if isinstance(v, (int, float)) and 40_000 < v < 60_000:
        return True
    if isinstance(v, str) and re.search(r"\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}", v):
        return True
    return False


def _parse_date(v: Any) -> str:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, float)) and 40_000 < v < 60_000:
        return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── column aliases ────────────────────────────────────────────────────────────

_DATE_LABELS = frozenset(["DIA", "FECHA", "DATE", "DIA DE VENTA", "FECHA DE VENTA"])
_RATE_LABELS = frozenset(["TIPO DE CAMBIO", "COTIZACION", "COTIZACION DOLAR", "TC", "T C", "DOLAR"])
_SKIP_LABELS = frozenset(["$", "USD", "PESOS"])

# Aliases written in the spreadsheets that map to canonical branch names used in the DB
_SUCURSAL_ALIASES: dict[str, str] = {
    "NORTE": "Norcenter",
    "SUR": "Lanus",
}


def _normalize_sucursal(name: str) -> str:
    """Map spreadsheet aliases (NORTE → Norcenter, SUR → Lanus) to canonical names."""
    return _SUCURSAL_ALIASES.get(name.upper().strip(), name.strip())

_COLUMN_ALIASES: dict[str, list[str]] = {
    "remito": ["REMITO", "NRO REMITO", "N REMITO", "NUMERO REMITO", "N REMITO", "REM"],
    "pedido": ["PEDIDO", "NUMERO PEDIDO", "N PEDIDO", "NRO PEDIDO", "N ORDEN", "ORDEN"],
    "vendedor": ["VENDEDOR", "VEND"],
    "producto": ["PRODUCTO", "DESCRIPCION", "ARTICULO", "DESCRIPCION ARTICULO"],
    "sku": ["SKU", "CODIGO", "COD", "COD ARTICULO", "CODIGO ARTICULO"],
    "marca": ["MARCA"],
    "tipo": ["TIPO", "TIPO PRODUCTO", "RUBRO"],
    "condicion": ["CONDICION", "COND"],
    "cantidad": ["CANTIDAD", "CANT", "QTY", "CTD"],
    "pvp": ["PVP", "PRECIO", "PRECIO VENTA", "P VENTA", "PRECIO UNITARIO", "P UNITARIO", "IMPORTE", "VALOR", "MONTO"],
    "costo": ["COSTO", "COSTO VIGENTE", "COSTO VIG", "P COSTO"],
    "efectivo": ["EFECTIVO", "EFECT", "EFECT.", "EFT"],
    "transferencia": ["TRANSFERENCIA", "TRANSFER", "TRANSFER.", "TRANSF", "TRANSF.", "TRF"],
    "tarjeta": ["TARJETA", "TAR", "TAR.", "TC", "CREDITO", "DEBITO", "POSNET", "POS"],
    "usd": ["USD", "DOLARES", "U$S", "U S D"],
    "cuenta_corriente": ["CUENTA CORRIENTE", "CTA CTE", "CTA. CTE.", "CC", "CTA CORRIENTE"],
    "otros": ["OTROS", "OTRO", "OTROS MEDIOS"],
    "total": ["TOTAL", "IMPORTE TOTAL", "TOTAL VENTA", "TOTAL COBRADO", "MONTO"],
}

_ALIAS_TO_FIELD: dict[str, str] = {}
for _f, _al in _COLUMN_ALIASES.items():
    for _a in _al:
        _k = _norm(_a)
        if _k not in _ALIAS_TO_FIELD:
            _ALIAS_TO_FIELD[_k] = _f

# ── classifiers ───────────────────────────────────────────────────────────────

_GRAN_ELECTRO = frozenset([
    "AIRE ACONDICIONADO", "ANAFE", "COCINA", "EXHIBIDORA", "FREEZER",
    "HELADERA", "HORNO", "LAVARROPAS", "LAVASECARROPAS", "LAVAVAJILLAS",
    "SECARROPAS", "TERMOTANQUE", "TORRE DE LAVADO", "TV",
])
_MEDIO_ELECTRO = frozenset([
    "ASPIRADORA", "CALEFON", "CALOVENTOR", "CAMPANA", "CERVECERA",
    "CONVECTOR", "MICROONDAS", "MINICOMPONENTE", "MONITOR", "PANEL",
    "PARLANTE", "PURIFICADOR", "VENTILADOR",
])
_PEQUENO_ELECTRO = frozenset([
    "ARROCERA", "BATIDORA", "CAFETERA", "CHOPPER", "ESPUMADOR", "EXPRIMIDOR",
    "EXTRACTOR", "FREIDORA", "JARRA", "LICUADORA", "LIMPIADOR ZAP", "MIXER",
    "MOLINO", "MOLINILLO", "MULTIOLLA", "MULTIPROCESADORA", "PAVA", "PICADORA",
    "PLANCHA", "PROCESADORA", "QUITAPELUSAS", "SANDWICHERA", "SOPERA",
    "TOSTADORA", "VAPORIZADOR", "YOGURTERA",
])

_LINEA_BLANCA = frozenset([
    "FREEZER", "HELADERA", "LAVARROPAS", "LAVASECARROPAS", "LAVAVAJILLAS",
    "SECARROPAS", "TORRE DE LAVADO",
])
_LINEA_COCINA = frozenset(["ANAFE", "CAMPANA", "COCINA", "HORNO", "MICROONDAS"])
_LINEA_CLIMA = frozenset([
    "AIRE ACONDICIONADO", "CALEFON", "CALOVENTOR", "CONVECTOR", "PANEL",
    "PURIFICADOR", "TERMOTANQUE", "VENTILADOR",
])
_LINEA_TV_AUDIO = frozenset(["MINICOMPONENTE", "MONITOR", "PARLANTE", "TV"])
_LINEA_PEQUENOS = _PEQUENO_ELECTRO | frozenset(["ASPIRADORA", "CERVECERA"])


def _classify(tipo: str) -> tuple[str, str]:
    t = _norm(tipo)
    if t in _GRAN_ELECTRO:
        categoria = "GRAN ELECTRO"
    elif t in _MEDIO_ELECTRO:
        categoria = "MEDIO ELECTRO"
    elif t in _PEQUENO_ELECTRO:
        categoria = "PEQUEÑO ELECTRO"
    else:
        # keyword fallback for free-text tipos
        if any(kw in t for kw in ("HELADERA", "LAVARROPAS", "FREEZER", "AIRE ACONDICIONADO", "TV", "COCINA", "HORNO")):
            categoria = "GRAN ELECTRO"
        elif any(kw in t for kw in ("MICROONDAS", "ASPIRADORA", "CONVECTOR", "PARLANTE", "MONITOR")):
            categoria = "MEDIO ELECTRO"
        elif t:
            categoria = "PEQUEÑO ELECTRO"
        else:
            categoria = ""

    if t in _LINEA_BLANCA:
        linea = "LÍNEA BLANCA"
    elif t in _LINEA_COCINA:
        linea = "COCINA"
    elif t in _LINEA_CLIMA:
        linea = "CLIMATIZACIÓN"
    elif t in _LINEA_TV_AUDIO:
        linea = "TV / AUDIO"
    elif t in _LINEA_PEQUENOS:
        linea = "PEQUEÑOS ELECTROS"
    else:
        linea = "PEQUEÑOS ELECTROS" if categoria == "PEQUEÑO ELECTRO" else ""

    return categoria, linea


def _detect_condicion(sku: str, producto: str) -> str:
    if re.search(r"\(o\)", sku, re.IGNORECASE) or re.search(r"\(o\)", producto, re.IGNORECASE):
        return "OUTLET"
    return "PRIMERA"


def _normalize_sku(sku: str) -> str:
    """Normalize SKU for catalog lookup: uppercase, strip spaces/dots/dashes."""
    s = unicodedata.normalize("NFKD", str(sku))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[\s.\-/]", "", s).upper()


def enrich_from_catalog(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """
    Look up each record's SKU in the products catalog.
    Fills in marca, tipo_producto, costo (if missing or zero), then
    recomputes categoria, linea, diferencia, margen_porcentaje.
    Does NOT overwrite existing non-zero values — same policy as the AppScript.
    """
    # Collect unique normalized SKUs
    sku_map: dict[str, str] = {}  # normalized -> original field value
    for rec in records:
        raw = rec.get("sku", "").strip()
        if raw:
            sku_map[_normalize_sku(raw)] = raw

    if not sku_map:
        return records

    placeholders = ",".join("?" * len(sku_map))
    rows = conn.execute(
        f"SELECT sku_normalized, marca, tipo, costo_vigente FROM products WHERE sku_normalized IN ({placeholders})",
        list(sku_map.keys()),
    ).fetchall()

    catalog: dict[str, dict] = {r["sku_normalized"]: dict(r) for r in rows}

    for rec in records:
        raw_sku = rec.get("sku", "").strip()
        if not raw_sku:
            continue
        norm = _normalize_sku(raw_sku)
        prod = catalog.get(norm)
        if not prod:
            continue

        # Fill marca if missing
        if not rec.get("marca") and prod.get("marca"):
            rec["marca"] = prod["marca"]

        # Fill tipo_producto if missing
        if not rec.get("tipo_producto") and prod.get("tipo"):
            rec["tipo_producto"] = prod["tipo"]

        # Fill costo if missing or zero
        if not rec.get("costo") and prod.get("costo_vigente"):
            rec["costo"] = float(prod["costo_vigente"])

        # Always recompute categoria/linea from the (now enriched) tipo
        rec["categoria"], rec["linea"] = _classify(rec.get("tipo_producto", ""))

        # Recompute diferencia and margen with updated costo
        costo = rec.get("costo", 0.0)
        total_cobrado = rec.get("total_cobrado", 0.0)
        cantidad = rec.get("cantidad", 1)
        if costo:
            rec["diferencia"] = total_cobrado - costo * cantidad
            rec["margen_porcentaje"] = round(rec["diferencia"] / total_cobrado * 100, 2) if total_cobrado else 0.0

    return records


# ── DB ───────────────────────────────────────────────────────────────────────


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_sales_bi_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sales_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            sucursal TEXT NOT NULL,
            tipo TEXT NOT NULL,
            fuente TEXT NOT NULL,
            fuente_url TEXT NOT NULL DEFAULT '',
            fuente_nombre TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'activo',
            total_records INTEGER NOT NULL DEFAULT 0,
            total_pvp REAL NOT NULL DEFAULT 0,
            total_costo REAL NOT NULL DEFAULT 0,
            total_efectivo REAL NOT NULL DEFAULT 0,
            total_transferencia REAL NOT NULL DEFAULT 0,
            total_tarjeta REAL NOT NULL DEFAULT 0,
            total_usd REAL NOT NULL DEFAULT 0,
            total_cuenta_corriente REAL NOT NULL DEFAULT 0,
            total_otros REAL NOT NULL DEFAULT 0,
            cotizacion_dolar REAL,
            imported_by TEXT NOT NULL DEFAULT '',
            imported_by_name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            voided_at TEXT NOT NULL DEFAULT '',
            voided_by TEXT NOT NULL DEFAULT '',
            void_reason TEXT NOT NULL DEFAULT '',
            warnings_json TEXT NOT NULL DEFAULT '[]',
            branch_id TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_imports_fecha ON sales_imports(fecha)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_imports_sucursal ON sales_imports(sucursal)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_imports_status ON sales_imports(status)")

    # Migrations for existing installs
    for _col, _def in [
        ("total_usd", "REAL NOT NULL DEFAULT 0"),
        ("branch_id", "TEXT"),
    ]:
        try:
            conn.execute(f"ALTER TABLE sales_imports ADD COLUMN {_col} {_def}")
        except Exception:
            pass

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sales_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER NOT NULL,
            nro_linea INTEGER NOT NULL,
            remito TEXT NOT NULL DEFAULT '',
            vendedor TEXT NOT NULL DEFAULT '',
            producto TEXT NOT NULL DEFAULT '',
            sku TEXT NOT NULL DEFAULT '',
            marca TEXT NOT NULL DEFAULT '',
            tipo_producto TEXT NOT NULL DEFAULT '',
            condicion TEXT NOT NULL DEFAULT '',
            categoria TEXT NOT NULL DEFAULT '',
            linea TEXT NOT NULL DEFAULT '',
            cantidad INTEGER NOT NULL DEFAULT 1,
            pvp REAL NOT NULL DEFAULT 0,
            costo REAL NOT NULL DEFAULT 0,
            diferencia REAL NOT NULL DEFAULT 0,
            margen_porcentaje REAL NOT NULL DEFAULT 0,
            efectivo REAL NOT NULL DEFAULT 0,
            transferencia REAL NOT NULL DEFAULT 0,
            tarjeta REAL NOT NULL DEFAULT 0,
            usd REAL NOT NULL DEFAULT 0,
            cuenta_corriente REAL NOT NULL DEFAULT 0,
            otros REAL NOT NULL DEFAULT 0,
            total_cobrado REAL NOT NULL DEFAULT 0,
            saldo REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(import_id) REFERENCES sales_imports(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_records_import ON sales_records(import_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_records_sku ON sales_records(sku)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_records_vendedor ON sales_records(vendedor)")

    # Migrate: add columns if missing on existing installs
    for _col, _def in [
        ("usd", "REAL NOT NULL DEFAULT 0"),
        ("saldo", "REAL NOT NULL DEFAULT 0"),
    ]:
        try:
            conn.execute(f"ALTER TABLE sales_records ADD COLUMN {_col} {_def}")
        except Exception:
            pass

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sales_balances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER NOT NULL,
            remito TEXT NOT NULL DEFAULT '',
            efectivo REAL NOT NULL DEFAULT 0,
            transferencia REAL NOT NULL DEFAULT 0,
            tarjeta REAL NOT NULL DEFAULT 0,
            usd REAL NOT NULL DEFAULT 0,
            otros REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(import_id) REFERENCES sales_imports(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_balances_import ON sales_balances(import_id)")

    # Migrate: add columns if missing (existing installs had concepto/monto schema)
    for col, definition in [
        ("remito", "TEXT NOT NULL DEFAULT ''"),
        ("efectivo", "REAL NOT NULL DEFAULT 0"),
        ("transferencia", "REAL NOT NULL DEFAULT 0"),
        ("tarjeta", "REAL NOT NULL DEFAULT 0"),
        ("usd", "REAL NOT NULL DEFAULT 0"),
        ("otros", "REAL NOT NULL DEFAULT 0"),
        ("total", "REAL NOT NULL DEFAULT 0"),
    ]:
        try:
            conn.execute(f"ALTER TABLE sales_balances ADD COLUMN {col} {definition}")
        except Exception:
            pass


# ── temp file storage ─────────────────────────────────────────────────────────

_TEMP: dict[str, Path] = {}
_TEMP_DIR = Path(__file__).parent.parent / "storage" / "tmp"


def save_temp_file(content: bytes) -> str:
    _TEMP_DIR.mkdir(parents=True, exist_ok=True)
    key = uuid.uuid4().hex
    p = _TEMP_DIR / f"sbi_{key}.xlsx"
    p.write_bytes(content)
    _TEMP[key] = p
    return key


def load_temp_file(key: str) -> bytes | None:
    p = _TEMP.get(key) or _TEMP_DIR / f"sbi_{key}.xlsx"
    if p.exists():
        _TEMP[key] = p
        return p.read_bytes()
    return None


def delete_temp_file(key: str) -> None:
    p = _TEMP.pop(key, None) or _TEMP_DIR / f"sbi_{key}.xlsx"
    try:
        if p and p.exists():
            p.unlink()
    except Exception:
        pass


# ── spreadsheet reading ───────────────────────────────────────────────────────


def read_excel(content: bytes) -> dict[str, list[list]]:
    wb = openpyxl.load_workbook(filename=io.BytesIO(content), data_only=True)
    result: dict[str, list[list]] = {}
    for name in wb.sheetnames:
        ws = wb[name]
        rows = [list(row) for row in ws.iter_rows(values_only=True)]
        result[name] = rows
    return result


def read_google_sheet(url: str) -> dict[str, list[list]]:
    spreadsheet_id = extract_spreadsheet_id(url)
    if not spreadsheet_id:
        raise ValueError(f"URL de Google Sheets inválida: {url}")
    svc = sheets_service()
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    result: dict[str, list[list]] = {}
    for sh in meta.get("sheets", []):
        title = sh["properties"]["title"]
        resp = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=title, valueRenderOption="UNFORMATTED_VALUE")
            .execute()
        )
        result[title] = resp.get("values", [])
    return result


# ── metadata detection ────────────────────────────────────────────────────────


def _detect_metadata(rows: list[list]) -> dict:
    """
    Detect date, branch, and exchange rate from the top rows.

    Handles the common format:
        Row 1:  Dia | 11/05/2026 | SUR | Tipo de cambio | $ | 1.375,00
    """
    meta: dict[str, Any] = {"fecha": "", "sucursal": "", "cotizacion_dolar": None}

    for row in rows[:15]:
        non_empty = [(i, c) for i, c in enumerate(row) if c is not None and str(c).strip()]

        for idx, (col_i, cell) in enumerate(non_empty):
            cn = _norm(cell)
            rest = non_empty[idx + 1 :]

            # ── Date by label ────────────────────────────────────────────────
            if not meta["fecha"] and cn in _DATE_LABELS:
                for _, nxt in rest[:4]:
                    if _is_date_like(nxt):
                        try:
                            meta["fecha"] = _parse_date(nxt)
                        except Exception:
                            pass
                        break

                # Sucursal: next non-numeric, non-label text after the date value
                if meta["fecha"]:
                    skip_one = True  # skip the date value itself
                    for _, nxt in rest:
                        if skip_one and _is_date_like(nxt):
                            skip_one = False
                            continue
                        skip_one = False
                        nxt_n = _norm(nxt)
                        if (
                            not meta["sucursal"]
                            and nxt_n
                            and nxt_n not in _DATE_LABELS
                            and not any(lbl in nxt_n for lbl in _RATE_LABELS | _SKIP_LABELS)
                        ):
                            try:
                                float(str(nxt).replace(",", ".").replace(".", "", 1))
                            except ValueError:
                                meta["sucursal"] = str(nxt).strip()
                                break

            # ── Sucursal by label ─────────────────────────────────────────────
            if not meta["sucursal"] and "SUCURSAL" in cn:
                for _, nxt in rest[:2]:
                    s = str(nxt).strip()
                    if s:
                        meta["sucursal"] = s
                        break

            # ── Exchange rate ─────────────────────────────────────────────────
            if meta["cotizacion_dolar"] is None and any(lbl in cn for lbl in _RATE_LABELS):
                for _, nxt in rest[:5]:
                    v = _parse_num(nxt)
                    if v > 0:
                        meta["cotizacion_dolar"] = v
                        break

    return meta


# ── SALDOS table detection (anywhere in the grid) ────────────────────────────


def _find_saldos_table(rows: list[list]) -> list[dict]:
    """
    Find the SALDOS section anywhere in the 2D grid (it can be to the right of
    the main table, not necessarily below it).
    Returns a list of balance dicts keyed by payment method.
    """
    # Step 1: find "SALDOS" cell
    saldos_ri = -1
    saldos_ci = -1
    for ri, row in enumerate(rows):
        for ci, cell in enumerate(row):
            if _norm(cell) == "SALDOS":
                saldos_ri = ri
                saldos_ci = ci
                break
        if saldos_ri >= 0:
            break

    if saldos_ri < 0:
        return []

    # Step 2: find sub-header row (REMITO, EFECT., TRANSFER., etc.)
    # Search within ±3 rows of the SALDOS header
    header_col_map: dict[str, int] = {}
    data_start_row = -1

    for ri in range(max(0, saldos_ri - 1), min(len(rows), saldos_ri + 4)):
        row = rows[ri]
        tmp: dict[str, int] = {}
        for ci in range(saldos_ci, min(saldos_ci + 20, len(row))):
            if ci >= len(row):
                break
            n = _norm(row[ci])
            field = _ALIAS_TO_FIELD.get(n)
            if field in ("remito", "efectivo", "transferencia", "tarjeta", "usd", "otros", "total", "cuenta_corriente"):
                tmp[field] = ci
        if tmp:
            header_col_map = tmp
            data_start_row = ri + 1
            break

    if not header_col_map or data_start_row < 0:
        return []

    # Step 3: read data rows within the SALDOS column range
    saldos: list[dict] = []
    remito_col = header_col_map.get("remito")

    for ri in range(data_start_row, len(rows)):
        row = rows[ri]
        # Check if there's any non-empty value in the SALDOS column range
        has_data = any(
            col < len(row) and row[col] is not None and str(row[col]).strip()
            for col in header_col_map.values()
        )
        if not has_data:
            continue

        remito_val = (row[remito_col] if remito_col is not None and remito_col < len(row) else None)
        if not remito_val or not str(remito_val).strip():
            continue

        entry: dict[str, Any] = {
            "remito": str(remito_val).strip(),
            "efectivo": 0.0,
            "transferencia": 0.0,
            "tarjeta": 0.0,
            "usd": 0.0,
            "otros": 0.0,
        }
        for field, col in header_col_map.items():
            if field != "remito" and col < len(row):
                entry[field] = _parse_num(row[col])
        entry["total"] = (
            entry["efectivo"] + entry["transferencia"] + entry["tarjeta"]
            + entry["usd"] + entry["otros"]
        )
        saldos.append(entry)

    return saldos


# ── header and data parsing ───────────────────────────────────────────────────


def _find_header_row(rows: list[list]) -> tuple[int, dict[str, int]] | None:
    """
    Find the main sales table header. Handles:
    - Single-row headers (REMITO | VENDEDOR | EFECT. | ...)
    - Two-row headers with group label on row N and sub-columns on row N+1
      (REMITO | VENDEDOR | MEDIOS DE PAGO) + (blank | blank | EFECT. | TRANSFER. | ...)
    """
    for i, row in enumerate(rows):
        if i > 80:
            break
        normed = [_norm(c) for c in row]

        has_remito = any(_ALIAS_TO_FIELD.get(n) == "remito" for n in normed)
        has_vendedor = any(_ALIAS_TO_FIELD.get(n) == "vendedor" for n in normed)
        has_product = any(_ALIAS_TO_FIELD.get(n) == "producto" for n in normed)
        has_payment = any(
            _ALIAS_TO_FIELD.get(n) in ("efectivo", "transferencia", "tarjeta", "usd")
            for n in normed
        )

        is_header = (
            (has_product and (has_remito or has_vendedor or has_payment))
            or (has_remito and (has_vendedor or has_payment))
            or (has_remito and has_vendedor)
        )
        if not is_header:
            continue

        col_map: dict[str, int] = {}
        for j, n in enumerate(normed):
            field = _ALIAS_TO_FIELD.get(n)
            if field and field not in col_map:
                col_map[field] = j

        # Check next 1-2 rows for sub-headers (payment sub-columns)
        sub_header_rows = 0
        for offset in range(1, 3):
            if i + offset >= len(rows):
                break
            sub_normed = [_norm(c) for c in rows[i + offset]]
            added = False
            for j, n in enumerate(sub_normed):
                field = _ALIAS_TO_FIELD.get(n)
                if field and field not in col_map:
                    col_map[field] = j
                    added = True
            if added:
                sub_header_rows += 1
            else:
                break

        if col_map:
            return i, col_map, sub_header_rows  # type: ignore[return-value]

    return None


_STOP_KEYWORDS = frozenset([
    "TOTAL", "TOTALES", "SUBTOTAL",
    "VENTA TOTAL", "TOTAL VENTA", "TOTAL VENTAS",
    "VENTA DIARIAS", "VENTAS DIARIAS",
    "ADMINISTRACION", "ADMINISTRACIÓN",
])


def _is_stop_row(row: list, remito_col: int | None) -> bool:
    # If remito column is defined and has a non-numeric text value, stop
    if remito_col is not None and remito_col < len(row):
        val = row[remito_col]
        if val is not None and str(val).strip():
            n = _norm(val)
            if n in _STOP_KEYWORDS:
                return True
    # Also stop on any cell that matches stop keywords
    for cell in row:
        if _norm(cell) in _STOP_KEYWORDS:
            return True
    return False


def _parse_data_rows(
    rows: list[list],
    header_idx: int,
    sub_header_rows: int,
    col_map: dict[str, int],
    is_online: bool,
    saldos_col_start: int,
) -> tuple[list[dict], int]:
    data_start = header_idx + 1 + sub_header_rows
    records: list[dict] = []
    last_data_row = data_start
    remito_col = col_map.get("remito")

    for i, row in enumerate(rows[data_start:], start=data_start):
        def get(field: str, default: Any = None) -> Any:
            idx = col_map.get(field)
            if idx is None or idx >= min(len(row), saldos_col_start):
                return default
            v = row[idx]
            return v if v is not None else default

        remito = str(get("remito", "")).strip()
        producto = str(get("producto", "")).strip()

        # Need at least a remito or a producto to consider this a data row
        if not remito and not producto:
            continue

        if _is_stop_row(row, remito_col):
            break

        # Skip rows where remito is a dash/empty and producto is purely numeric
        # (these are usually totals rows like "927500")
        remito_clean = remito.lstrip("-").strip()
        if not remito_clean and re.fullmatch(r"[\d\s.,]+", producto):
            continue

        vendedor = str(get("vendedor", "")).strip()
        marca = str(get("marca", "")).strip()
        tipo_produto = str(get("tipo", "")).strip()
        sku = str(get("sku", "")).strip()

        raw_cond = str(get("condicion", "")).strip()
        condicion = _detect_condicion(sku, producto)
        if raw_cond and "OUTLET" in _norm(raw_cond):
            condicion = "OUTLET"

        cantidad = max(1, int(_parse_num(get("cantidad", 1)) or 1))
        pvp = _parse_num(get("pvp", 0))
        costo = _parse_num(get("costo", 0))
        efectivo = _parse_num(get("efectivo", 0))
        transferencia = _parse_num(get("transferencia", 0))
        tarjeta = _parse_num(get("tarjeta", 0))
        usd = _parse_num(get("usd", 0))
        cuenta_corriente = _parse_num(get("cuenta_corriente", 0))
        otros = _parse_num(get("otros", 0))

        if is_online:
            total_cobrado = _parse_num(get("total", 0)) or pvp
            transferencia = total_cobrado
            efectivo = tarjeta = usd = cuenta_corriente = otros = 0.0
        else:
            total_cobrado = efectivo + transferencia + tarjeta + usd + cuenta_corriente + otros
            if total_cobrado == 0:
                total_cobrado = _parse_num(get("total", 0)) or pvp

        diferencia = total_cobrado - costo * cantidad if costo else 0.0
        margen = (diferencia / total_cobrado * 100) if total_cobrado else 0.0

        categoria, linea = _classify(tipo_produto)

        records.append({
            "remito": remito,
            "vendedor": vendedor,
            "producto": producto,
            "sku": sku,
            "marca": marca,
            "tipo_producto": tipo_produto,
            "condicion": condicion,
            "categoria": categoria,
            "linea": linea,
            "cantidad": cantidad,
            "pvp": pvp,
            "costo": costo,
            "diferencia": diferencia,
            "margen_porcentaje": round(margen, 2),
            "efectivo": efectivo,
            "transferencia": transferencia,
            "tarjeta": tarjeta,
            "usd": usd,
            "cuenta_corriente": cuenta_corriente,
            "otros": otros,
            "total_cobrado": total_cobrado,
            "saldo": 0.0,  # computed after payment distribution
        })
        last_data_row = i

    return records, last_data_row


_PAYMENT_FIELDS = ("efectivo", "transferencia", "tarjeta", "usd", "cuenta_corriente", "otros")


def _raw_cobrado(rec: dict) -> float:
    return sum(rec.get(f, 0.0) for f in _PAYMENT_FIELDS)


def _distribute_remito_payments(records: list[dict]) -> list[dict]:
    """
    When the same remito appears on multiple rows (one customer, multiple products),
    the seller typically enters the payment amount only on one row.
    This redistributes the actual payment (sum of payment-method fields, not the
    pvp-fallback total_cobrado) proportionally by PVP across all lines in the group.
    """
    from collections import defaultdict

    groups: dict[str, list[int]] = defaultdict(list)
    for i, rec in enumerate(records):
        remito = rec.get("remito", "").strip().lstrip("-").strip()
        if remito:
            groups[remito].append(i)

    for remito, indices in groups.items():
        if len(indices) < 2:
            continue
        group_recs = [records[i] for i in indices]
        # Use the sum of actual payment fields (not total_cobrado which has pvp fallback)
        actual_cobrado = sum(_raw_cobrado(r) for r in group_recs)
        total_pvp = sum(r["pvp"] * r["cantidad"] for r in group_recs)
        if actual_cobrado == 0 or total_pvp == 0:
            continue

        # Distribute proportionally; last record absorbs rounding delta
        remaining = actual_cobrado
        for idx in indices[:-1]:
            pvp_i = records[idx]["pvp"] * records[idx]["cantidad"]
            share = round(pvp_i / total_pvp * actual_cobrado, 2)
            records[idx]["total_cobrado"] = share
            remaining = round(remaining - share, 2)
        records[indices[-1]]["total_cobrado"] = remaining

    # Compute saldo per record: max(0, pvp - total_cobrado)
    for rec in records:
        pvp_total = rec["pvp"] * rec["cantidad"]
        rec["saldo"] = round(max(0.0, pvp_total - rec["total_cobrado"]), 2)

    return records


_SHEET_NAME_LOCAL = frozenset(["PLANILLA"])
_SHEET_NAME_ONLINE = frozenset(["ONLINE", "ON LINE"])


def _classify_sheet_name(name: str) -> str | None:
    """
    Returns 'local', 'online', or None (skip).
    Only the exact sheet names 'Planilla' (local) and 'On Line'/'Online' (online) are imported.
    """
    nn = _norm(name)
    if nn in _SHEET_NAME_ONLINE:
        return "online"
    if nn in _SHEET_NAME_LOCAL:
        return "local"
    return None


def _is_online_sheet(name: str, col_map: dict[str, int]) -> bool:
    tipo = _classify_sheet_name(name)
    if tipo is not None:
        return tipo == "online"
    # fallback: infer from columns
    return "pedido" in col_map and "remito" not in col_map


def _find_saldos_col_start(rows: list[list]) -> int:
    """Return the column index where a separate SALDOS *section* starts.
    Only the plural 'SALDOS' triggers this — the singular 'SALDO' is a regular
    column within the main table and must not cut off the data read.
    """
    for row in rows:
        for ci, cell in enumerate(row):
            if _norm(cell) == "SALDOS":
                return ci
    return 9999


def _parse_sheet(name: str, rows: list[list], sucursal_override: str = "") -> dict:
    warnings: list[str] = []
    meta = _detect_metadata(rows)

    if not meta["fecha"]:
        warnings.append("No se detectó la fecha en la planilla.")
    if sucursal_override:
        meta["sucursal"] = _normalize_sucursal(sucursal_override)
    elif meta["sucursal"]:
        meta["sucursal"] = _normalize_sucursal(meta["sucursal"])
    else:
        meta["sucursal"] = name

    result = _find_header_row(rows)
    if result is None:
        return {
            "sheet_name": name,
            "fecha": meta["fecha"],
            "sucursal": meta["sucursal"],
            "tipo": "local",
            "cotizacion_dolar": meta["cotizacion_dolar"],
            "records": [],
            "balances": [],
            "warnings": warnings + ["No se encontró la tabla de ventas en esta hoja."],
            "ok": False,
        }

    header_idx, col_map, sub_header_rows = result  # type: ignore[misc]

    is_online = _is_online_sheet(name, col_map)
    saldos_col = _find_saldos_col_start(rows)

    records, _ = _parse_data_rows(rows, header_idx, sub_header_rows, col_map, is_online, saldos_col)

    if not is_online:
        records = _distribute_remito_payments(records)
    else:
        for rec in records:
            pvp_total = rec["pvp"] * rec["cantidad"]
            rec["saldo"] = round(max(0.0, pvp_total - rec["total_cobrado"]), 2)

    # Enrich with product catalog data (marca, tipo, costo, categoria, linea)
    try:
        with db_connect() as conn:
            records = enrich_from_catalog(conn, records)
    except Exception:
        pass  # catalog enrichment is best-effort

    if not records:
        warnings.append("La tabla de ventas está vacía o no se pudieron leer los datos.")

    balances: list[dict] = []
    if not is_online:
        balances = _find_saldos_table(rows)

    return {
        "sheet_name": name,
        "fecha": meta["fecha"],
        "sucursal": meta["sucursal"],
        "tipo": "online" if is_online else "local",
        "cotizacion_dolar": meta["cotizacion_dolar"],
        "records": records,
        "balances": balances,
        "warnings": warnings,
        "ok": True,
    }


def _sheet_totals(records: list[dict]) -> dict:
    return {
        "total_records": len(records),
        "total_pvp": sum(r["pvp"] * r["cantidad"] for r in records),
        "total_costo": sum(r["costo"] * r["cantidad"] for r in records),
        "total_efectivo": sum(r["efectivo"] for r in records),
        "total_transferencia": sum(r["transferencia"] for r in records),
        "total_tarjeta": sum(r["tarjeta"] for r in records),
        "total_usd": sum(r["usd"] for r in records),
        "total_cuenta_corriente": sum(r["cuenta_corriente"] for r in records),
        "total_otros": sum(r["otros"] for r in records),
    }


# ── public API ────────────────────────────────────────────────────────────────


def analyze_sheets(sheets: dict[str, list[list]], sucursal_override: str = "") -> list[dict]:
    results = []
    for name, rows in sheets.items():
        tipo_hoja = _classify_sheet_name(name)
        if tipo_hoja is None:
            # Skip sheets that are not 'Planilla' or 'On Line'
            continue
        parsed = _parse_sheet(name, rows, sucursal_override=sucursal_override)
        totals = _sheet_totals(parsed["records"])
        parsed.update(totals)
        results.append(parsed)
    return results


# ── DB operations ─────────────────────────────────────────────────────────────


def find_branch(conn: sqlite3.Connection, sucursal: str, tipo: str) -> dict | None:
    """
    Match a sucursal name/code to an existing branch.
    For 'online' tipo prefers web branches; for 'local' prefers physical.
    Matches by code (uppercase, spaces→underscores) or by name (case-insensitive).
    """
    code_guess = sucursal.upper().strip().replace(" ", "_")

    if tipo == "online":
        # Try _WEB suffix first, then exact match as fallback
        candidates = [code_guess + "_WEB", code_guess]
        preferred_type = "web"
    else:
        # For physical, prefer exact match; _WEB would be wrong
        candidates = [code_guess]
        preferred_type = "physical"

    for code in candidates:
        row = conn.execute(
            "SELECT id, name, code, type FROM branches WHERE code=? AND is_active=1",
            (code,),
        ).fetchone()
        if row:
            return dict(row)

    # Fallback: name contains the sucursal string
    row = conn.execute(
        "SELECT id, name, code, type FROM branches WHERE UPPER(name) LIKE ? AND is_active=1 ORDER BY (type=?) DESC LIMIT 1",
        (f"%{sucursal.upper()}%", preferred_type),
    ).fetchone()
    return dict(row) if row else None


def get_active_import(conn: sqlite3.Connection, fecha: str, sucursal: str, tipo: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM sales_imports WHERE fecha=? AND sucursal=? AND tipo=? AND status='activo'",
        (fecha, sucursal, tipo),
    ).fetchone()
    return dict(row) if row else None


def save_import(
    sheet: dict,
    fuente: str,
    fuente_url: str,
    fuente_nombre: str,
    username: str,
    display_name: str,
    branch_id: str | None = None,
) -> int:
    now = utc_now()
    totals = _sheet_totals(sheet["records"])

    with db_connect() as conn:
        # Auto-match branch if not provided
        if not branch_id:
            matched = find_branch(conn, sheet["sucursal"], sheet["tipo"])
            branch_id = matched["id"] if matched else None

        cur = conn.execute(
            """
            INSERT INTO sales_imports
                (fecha, sucursal, tipo, fuente, fuente_url, fuente_nombre, status,
                 total_records, total_pvp, total_costo,
                 total_efectivo, total_transferencia, total_tarjeta, total_usd,
                 total_cuenta_corriente, total_otros, cotizacion_dolar,
                 imported_by, imported_by_name, created_at, warnings_json, branch_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                sheet["fecha"], sheet["sucursal"], sheet["tipo"],
                fuente, fuente_url, fuente_nombre, "activo",
                totals["total_records"], totals["total_pvp"], totals["total_costo"],
                totals["total_efectivo"], totals["total_transferencia"], totals["total_tarjeta"],
                totals["total_usd"], totals["total_cuenta_corriente"], totals["total_otros"],
                sheet.get("cotizacion_dolar"),
                username, display_name, now,
                json.dumps(sheet.get("warnings", []), ensure_ascii=False),
                branch_id,
            ),
        )
        import_id = cur.lastrowid

        for i, rec in enumerate(sheet["records"], start=1):
            conn.execute(
                """
                INSERT INTO sales_records
                    (import_id, nro_linea, remito, vendedor, producto, sku, marca,
                     tipo_producto, condicion, categoria, linea, cantidad,
                     pvp, costo, diferencia, margen_porcentaje,
                     efectivo, transferencia, tarjeta, usd, cuenta_corriente, otros, total_cobrado, saldo)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    import_id, i, rec["remito"], rec["vendedor"], rec["producto"],
                    rec["sku"], rec["marca"], rec["tipo_producto"], rec["condicion"],
                    rec["categoria"], rec["linea"], rec["cantidad"],
                    rec["pvp"], rec["costo"], rec["diferencia"], rec["margen_porcentaje"],
                    rec["efectivo"], rec["transferencia"], rec["tarjeta"], rec["usd"],
                    rec["cuenta_corriente"], rec["otros"], rec["total_cobrado"],
                    rec.get("saldo", 0.0),
                ),
            )

        for bal in sheet.get("balances", []):
            conn.execute(
                """
                INSERT INTO sales_balances
                    (import_id, remito, efectivo, transferencia, tarjeta, usd, otros, total)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    import_id, bal["remito"], bal["efectivo"], bal["transferencia"],
                    bal["tarjeta"], bal["usd"], bal["otros"], bal["total"],
                ),
            )

        conn.commit()
    return import_id


def void_import(import_id: int, username: str, reason: str) -> None:
    now = utc_now()
    with db_connect() as conn:
        conn.execute(
            "UPDATE sales_imports SET status='anulado', voided_at=?, voided_by=?, void_reason=? WHERE id=?",
            (now, username, reason, import_id),
        )
        conn.commit()


def get_import_detail(import_id: int) -> dict | None:
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM sales_imports WHERE id=?", (import_id,)).fetchone()
        if not row:
            return None
        imp = dict(row)
        try:
            imp["warnings"] = json.loads(imp.pop("warnings_json", "[]") or "[]")
        except Exception:
            imp["warnings"] = []
        imp["records"] = [
            dict(r) for r in conn.execute(
                "SELECT * FROM sales_records WHERE import_id=? ORDER BY nro_linea", (import_id,)
            ).fetchall()
        ]
        imp["balances"] = [
            dict(b) for b in conn.execute(
                "SELECT * FROM sales_balances WHERE import_id=?", (import_id,)
            ).fetchall()
        ]
    return imp


def list_imports(
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    sucursal: str | None = None,
    tipo: str | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    where: list[str] = []
    params: list[Any] = []
    if fecha_desde:
        where.append("fecha >= ?"); params.append(fecha_desde)
    if fecha_hasta:
        where.append("fecha <= ?"); params.append(fecha_hasta)
    if sucursal:
        where.append("sucursal = ?"); params.append(sucursal)
    if tipo:
        where.append("tipo = ?"); params.append(tipo)
    if status:
        where.append("status = ?"); params.append(status)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with db_connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM sales_imports {clause}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM sales_imports {clause} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        try:
            d["warnings"] = json.loads(d.pop("warnings_json", "[]") or "[]")
        except Exception:
            d["warnings"] = []
        result.append(d)
    return result, total


def list_records(
    import_id: int | None = None,
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    sucursal: str | None = None,
    tipo: str | None = None,
    vendedor: str | None = None,
    categoria: str | None = None,
    condicion: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict], int]:
    join = "JOIN sales_imports i ON i.id = r.import_id"
    where: list[str] = ["i.status = 'activo'"]
    params: list[Any] = []
    if import_id is not None:
        where.append("r.import_id = ?"); params.append(import_id)
    if fecha_desde:
        where.append("i.fecha >= ?"); params.append(fecha_desde)
    if fecha_hasta:
        where.append("i.fecha <= ?"); params.append(fecha_hasta)
    if sucursal:
        where.append("i.sucursal = ?"); params.append(sucursal)
    if tipo:
        where.append("i.tipo = ?"); params.append(tipo)
    if vendedor:
        where.append("r.vendedor LIKE ?"); params.append(f"%{vendedor}%")
    if categoria:
        where.append("r.categoria = ?"); params.append(categoria)
    if condicion:
        where.append("r.condicion = ?"); params.append(condicion)
    if q:
        where.append("(r.producto LIKE ? OR r.sku LIKE ? OR r.marca LIKE ? OR r.remito LIKE ?)")
        params += [f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"]
    clause = "WHERE " + " AND ".join(where)
    base = f"FROM sales_records r {join} {clause}"
    with db_connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT r.*, i.fecha, i.sucursal, i.tipo {base} ORDER BY i.fecha DESC, r.id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
    return [dict(r) for r in rows], total


def list_balances(
    import_id: int | None = None,
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    sucursal: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict], int]:
    join = "JOIN sales_imports i ON i.id = b.import_id"
    where: list[str] = ["i.status = 'activo'"]
    params: list[Any] = []
    if import_id is not None:
        where.append("b.import_id = ?"); params.append(import_id)
    if fecha_desde:
        where.append("i.fecha >= ?"); params.append(fecha_desde)
    if fecha_hasta:
        where.append("i.fecha <= ?"); params.append(fecha_hasta)
    if sucursal:
        where.append("i.sucursal = ?"); params.append(sucursal)
    clause = "WHERE " + " AND ".join(where)
    base = f"FROM sales_balances b {join} {clause}"
    with db_connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT b.*, i.fecha, i.sucursal {base} ORDER BY i.fecha DESC, b.id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
    return [dict(r) for r in rows], total


def get_stats() -> dict:
    with db_connect() as conn:
        total_imports = conn.execute("SELECT COUNT(*) FROM sales_imports WHERE status='activo'").fetchone()[0]
        total_records = conn.execute(
            "SELECT COUNT(*) FROM sales_records r JOIN sales_imports i ON i.id=r.import_id WHERE i.status='activo'"
        ).fetchone()[0]
        sum_pvp = conn.execute(
            "SELECT COALESCE(SUM(r.pvp*r.cantidad),0) FROM sales_records r JOIN sales_imports i ON i.id=r.import_id WHERE i.status='activo'"
        ).fetchone()[0]
        last_import = conn.execute(
            "SELECT fecha, sucursal, created_at FROM sales_imports WHERE status='activo' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return {
        "total_imports": total_imports,
        "total_records": total_records,
        "total_pvp": sum_pvp,
        "last_import": dict(last_import) if last_import else None,
    }
