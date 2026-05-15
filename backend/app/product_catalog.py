from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from .config import get_settings
from .google_sheets import quote_sheet_name, sheets_service
from .operational_config import extract_spreadsheet_id, load_operational_config

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

PRODUCT_MASTER_HEADERS = ["MARCA", "TIPO", "DESCRIPCION", "SKU", "PVP", "COSTO VIGENTE"]

# Checks predefinidos por tipo. Definidos acá para evitar import circular con price_cost_updates.
_CHECKS_BY_TYPE: dict[str, list[tuple[str, str]]] = {
    "price": [
        ("puma", "Puma actualizado"),
        ("web_gv", "Web ElectroGV actualizada"),
        ("web_abc", "Web ABC actualizada"),
        ("planilla_madre", "Planilla Madre actualizada"),
    ],
    "cost": [
        ("puma", "Puma actualizado"),
        ("planilla_madre", "Planilla Madre actualizada"),
    ],
}


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_ar_string() -> str:
    return datetime.now(AR_TZ).strftime("%d/%m/%Y %H:%M")


def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper().strip()
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalized_key(value: Any) -> str:
    return normalize_text(value).replace(" ", "")


def header_key(value: Any) -> str:
    return normalized_key(value)


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def sku_key(value: Any) -> str:
    text = str(value or "").strip().upper().replace("\u00a0", " ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", "", text)


def parse_decimal_ar(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    text = str(value).strip().replace("\u00a0", " ")
    if not text:
        return None
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None
    negative = text.startswith("-")
    text = text.lstrip("-")
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif "." in text:
        parts = text.split(".")
        if len(parts) > 1 and all(len(part) == 3 for part in parts[1:]) and len(parts[-1]) == 3:
            text = "".join(parts)
    if negative:
        text = "-" + text
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def format_number_ar(value: Decimal | float | int | None, decimals: int = 2) -> str:
    if value is None:
        return ""
    dec = value if isinstance(value, Decimal) else Decimal(str(value))
    quant = Decimal("1") if decimals == 0 else Decimal("1." + ("0" * decimals))
    dec = dec.quantize(quant, rounding=ROUND_HALF_UP)
    sign = "-" if dec < 0 else ""
    dec = abs(dec)
    int_part, _, frac_part = f"{dec:f}".partition(".")
    int_part = f"{int(int_part):,}".replace(",", ".")
    if decimals <= 0:
        return sign + int_part
    frac_part = (frac_part + "0" * decimals)[:decimals]
    return f"{sign}{int_part},{frac_part}"


def money_text(value: Decimal | float | int | None) -> str:
    if value is None:
        return ""
    return "$ " + format_number_ar(value, 2)


def sheet_money_text(value: Decimal | float | int | None) -> str:
    if value is None:
        return ""
    return format_number_ar(value, 2)


def has_outlet_marker(*values: Any) -> bool:
    joined_raw = " ".join("" if value is None else str(value) for value in values).upper()
    joined_norm = normalize_text(joined_raw)
    return bool(re.search(r"\(\s*O\s*\)", joined_raw) or " OUTLET " in f" {joined_norm} ")


def condition_from_text(sku: Any, descripcion: Any) -> str:
    return "OUTLET" if has_outlet_marker(sku, descripcion) else "PRIMERA"


def find_column(headers: list[str], aliases: list[str], fallback_index: int | None = None) -> int | None:
    normalized = {header_key(h): idx for idx, h in enumerate(headers)}
    for alias in aliases:
        key = header_key(alias)
        if key in normalized:
            return normalized[key]
    if fallback_index is not None and fallback_index < len(headers):
        return fallback_index
    return None


def runtime_product_catalog_config() -> dict[str, Any]:
    settings = get_settings()
    root = load_operational_config()
    products_cfg = root.get("products", {}) if isinstance(root, dict) else {}
    warranties_cfg = root.get("warranties", {}) if isinstance(root, dict) else {}
    budgets_cfg = root.get("budgets", {}) if isinstance(root, dict) else {}
    spreadsheet_id = (
        extract_spreadsheet_id(products_cfg.get("spreadsheet_id") or products_cfg.get("spreadsheet_url"))
        or extract_spreadsheet_id(budgets_cfg.get("spreadsheet_id") or budgets_cfg.get("spreadsheet_url"))
        or extract_spreadsheet_id(warranties_cfg.get("spreadsheet_id") or warranties_cfg.get("spreadsheet_url"))
        or settings.warranty_spreadsheet
    )
    sheet_name = products_cfg.get("sheet_name") or budgets_cfg.get("price_sheet") or warranties_cfg.get("product_sheet") or settings.product_catalog_sheet or "Productos PVP"
    columns = products_cfg.get("columns") if isinstance(products_cfg.get("columns"), dict) else {}
    return {
        "spreadsheet_id": spreadsheet_id,
        "spreadsheet_url": products_cfg.get("spreadsheet_url") or budgets_cfg.get("spreadsheet_url") or warranties_cfg.get("spreadsheet_url") or settings.warranty_spreadsheet_url or "",
        "sheet_name": sheet_name,
        "header_row": int(products_cfg.get("header_row") or 1),
        "range": products_cfg.get("range") or "A:Z",
        "cache_seconds": int(products_cfg.get("cache_seconds") or budgets_cfg.get("product_cache_seconds") or warranties_cfg.get("product_cache_seconds") or 300),
        "columns": {
            "marca": columns.get("marca") or "MARCA",
            "tipo": columns.get("tipo") or "TIPO",
            "descripcion": columns.get("descripcion") or "DESCRIPCION",
            "sku": columns.get("sku") or "SKU",
            "pvp": columns.get("pvp") or "PVP",
            "costo_vigente": columns.get("costo_vigente") or "COSTO VIGENTE",
        },
    }


def _add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except Exception:
        pass


def _try_create_price_cost_update(
    conn: sqlite3.Connection,
    change_type: str,
    sku: str,
    producto: str,
    marca: str,
    valor_anterior: str,
    valor_nuevo: str,
    product_id: int,
    sync_log_id: int,
    now: str,
) -> bool:
    """Crea una tarea en price_cost_updates desde una sync de catálogo.

    Devuelve True si se creó, False si ya existía una pendiente igual (dedup).
    """
    existing = conn.execute(
        """
        SELECT id FROM price_cost_updates
        WHERE sku = ? AND type = ? AND valor_nuevo = ? AND estado IN ('Pendiente', 'En proceso')
        """,
        (sku, change_type, valor_nuevo),
    ).fetchone()
    if existing:
        return False

    cursor = conn.execute(
        """
        INSERT INTO price_cost_updates (
            type, producto, sku, marca, valor_anterior, valor_nuevo, estado,
            created_by, created_by_name, created_at, updated_at,
            source, source_product_id, source_sync_log_id, auto_created
        ) VALUES (
            ?, ?, ?, ?, ?, ?, 'En proceso',
            'sistema', 'Sincronización de catálogo', ?, ?,
            'catalog_sync', ?, ?, 1
        )
        """,
        (change_type, producto, sku, marca, valor_anterior, valor_nuevo, now, now, product_id, sync_log_id),
    )
    update_id = int(cursor.lastrowid)

    checks = _CHECKS_BY_TYPE[change_type]
    for key, label in checks:
        is_planilla = key == "planilla_madre"
        conn.execute(
            """
            INSERT INTO price_cost_update_checks
                (update_id, check_key, label, checked, checked_by, checked_by_name, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                update_id, key, label,
                1 if is_planilla else 0,
                "sistema" if is_planilla else None,
                "Sincronización de catálogo" if is_planilla else None,
                now if is_planilla else None,
            ),
        )

    conn.execute(
        """
        INSERT INTO price_cost_update_history
            (update_id, created_at, username, display_name, action, detail_json)
        VALUES (?, ?, 'sistema', 'Sistema', 'auto_creado', ?)
        """,
        (update_id, now, json.dumps({"source": "catalog_sync", "sync_log_id": sync_log_id}, ensure_ascii=False)),
    )
    return True


def ensure_product_catalog_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL,
            sku_normalized TEXT NOT NULL UNIQUE,
            marca TEXT NOT NULL DEFAULT '',
            marca_normalized TEXT NOT NULL DEFAULT '',
            tipo TEXT NOT NULL DEFAULT '',
            descripcion TEXT NOT NULL DEFAULT '',
            pvp REAL,
            pvp_text TEXT NOT NULL DEFAULT '',
            costo_vigente REAL,
            costo_text TEXT NOT NULL DEFAULT '',
            condicion_producto TEXT NOT NULL DEFAULT '',
            search_text TEXT NOT NULL DEFAULT '',
            source_sheet TEXT NOT NULL DEFAULT '',
            source_row INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_synced_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_products_sku_norm ON products(sku_normalized)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_products_brand ON products(marca_normalized)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_products_type ON products(tipo)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS product_brands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_product_brands_active ON product_brands(is_active)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            contact_name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_providers_active ON providers(is_active)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS brand_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL,
            provider_id INTEGER NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(brand_id) REFERENCES product_brands(id) ON DELETE CASCADE,
            FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE,
            UNIQUE(brand_id, provider_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_brand_providers_brand ON brand_providers(brand_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_brand_providers_provider ON brand_providers(provider_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS product_sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL DEFAULT 'google_sheet',
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL DEFAULT '',
            actor_username TEXT NOT NULL DEFAULT '',
            actor_name TEXT NOT NULL DEFAULT '',
            rows_processed INTEGER NOT NULL DEFAULT 0,
            rows_created INTEGER NOT NULL DEFAULT 0,
            rows_updated INTEGER NOT NULL DEFAULT 0,
            rows_skipped INTEGER NOT NULL DEFAULT 0,
            brands_created INTEGER NOT NULL DEFAULT 0,
            errors_json TEXT NOT NULL DEFAULT '[]',
            spreadsheet_id TEXT NOT NULL DEFAULT '',
            sheet_name TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_product_sync_logs_started ON product_sync_logs(started_at)")
    # Migraciones de columnas (idempotentes)
    _add_column_if_missing(conn, "product_sync_logs", "price_changes_detected", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "product_sync_logs", "cost_changes_detected", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "product_sync_logs", "price_cost_updates_created", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "product_sync_logs", "price_cost_updates_skipped", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "price_cost_updates", "source", "TEXT NOT NULL DEFAULT ''")
    _add_column_if_missing(conn, "price_cost_updates", "source_product_id", "INTEGER")
    _add_column_if_missing(conn, "price_cost_updates", "source_sync_log_id", "INTEGER")
    _add_column_if_missing(conn, "price_cost_updates", "auto_created", "INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def get_sheet_values(spreadsheet_id: str, sheet_name: str, a1: str = "A:Z") -> list[list[Any]]:
    if not spreadsheet_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falta configurar la Planilla Madre de Ventas.")
    service = sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{quote_sheet_name(sheet_name)}!{a1}",
        valueRenderOption="FORMATTED_VALUE",
        dateTimeRenderOption="FORMATTED_STRING",
    ).execute()
    return result.get("values", [])


def ensure_brand(conn: sqlite3.Connection, marca: str, now: str) -> tuple[int | None, bool]:
    clean = clean_text(marca)
    norm = normalize_text(clean)
    if not norm:
        return None, False
    row = conn.execute("SELECT id FROM product_brands WHERE normalized_name = ?", (norm,)).fetchone()
    if row:
        conn.execute("UPDATE product_brands SET name = ?, is_active = 1, updated_at = ? WHERE id = ?", (clean, now, row["id"]))
        return int(row["id"]), False
    cur = conn.execute(
        "INSERT INTO product_brands (name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
        (clean, norm, now, now),
    )
    return int(cur.lastrowid), True


def row_to_product(row: sqlite3.Row) -> dict[str, Any]:
    pvp = row["pvp"]
    costo = row["costo_vigente"]
    label_parts = [row["descripcion"] or row["sku"]]
    if row["sku"] and row["sku"] != row["descripcion"]:
        label_parts.append(row["sku"])
    if row["marca"]:
        label_parts.append(row["marca"])
    if row["pvp_text"]:
        label_parts.append(row["pvp_text"])
    return {
        "id": row["id"],
        "sku": row["sku"],
        "marca": row["marca"],
        "tipo": row["tipo"],
        "descripcion": row["descripcion"],
        "producto": row["descripcion"],
        "pvp": pvp,
        "pvp_text": row["pvp_text"],
        "pvp_texto": row["pvp_text"],
        "precio": pvp,
        "precio_texto": row["pvp_text"],
        "costo_vigente": costo,
        "costo_text": row["costo_text"],
        "costo_texto": row["costo_text"],
        "condicion": row["condicion_producto"],
        "condicion_producto": row["condicion_producto"],
        "source_row": row["source_row"],
        "last_synced_at": row["last_synced_at"],
        "updated_at": row["updated_at"],
        "is_active": bool(row["is_active"]),
        "label": " — ".join([p for p in label_parts if p]),
        "search": row["search_text"],
    }


def search_products(query: str, limit: int = 20) -> list[dict[str, Any]]:
    q = normalize_text(query)
    if len(q) < 2:
        return []
    tokens = q.split()
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        like_terms = [f"%{token}%" for token in tokens[:5]]
        where = " AND ".join(["search_text LIKE ?" for _ in like_terms])
        sql = "SELECT * FROM products WHERE is_active = 1"
        params: list[Any] = []
        if where:
            sql += f" AND {where}"
            params.extend(like_terms)
        sql += " LIMIT ?"
        params.append(max(limit * 4, limit))
        rows = conn.execute(sql, params).fetchall()
    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        item = row_to_product(row)
        search = item["search"]
        sku_norm = normalize_text(item.get("sku", ""))
        desc_norm = normalize_text(item.get("descripcion", ""))
        marca_norm = normalize_text(item.get("marca", ""))
        score = 0
        if sku_norm == q:
            score += 100
        if sku_norm.startswith(q):
            score += 60
        if desc_norm.startswith(q):
            score += 35
        if marca_norm.startswith(q):
            score += 18
        if search.startswith(q):
            score += 12
        if item.get("pvp") is not None:
            score += 2
        scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:limit]]


def lookup_product_by_sku_or_text(value: str) -> dict[str, Any] | None:
    q = normalize_text(value)
    key = sku_key(value)
    if not q:
        return None
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        row = conn.execute("SELECT * FROM products WHERE sku_normalized = ? AND is_active = 1", (key,)).fetchone()
        if row:
            return row_to_product(row)
    results = search_products(value, limit=1)
    return results[0] if results else None


def sync_products_from_sheet(actor: Any) -> dict[str, Any]:
    started = utc_now_iso()
    actor_username = str(getattr(actor, "username", "") or "")
    actor_name = str(getattr(actor, "display_name", "") or actor_username)
    cfg = runtime_product_catalog_config()
    spreadsheet_id = str(cfg.get("spreadsheet_id") or "")
    sheet_name = str(cfg.get("sheet_name") or "Productos PVP")
    header_row = max(1, int(cfg.get("header_row") or 1))
    sheet_range = str(cfg.get("range") or "A:Z")
    columns_cfg = cfg.get("columns") if isinstance(cfg.get("columns"), dict) else {}
    errors: list[str] = []
    created = updated = skipped = processed = brands_created = 0
    price_changes_detected = cost_changes_detected = 0
    price_cost_updates_created = price_cost_updates_skipped = 0
    status_value = "success"
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        log_cur = conn.execute(
            """
            INSERT INTO product_sync_logs (source, status, started_at, actor_username, actor_name, spreadsheet_id, sheet_name)
            VALUES ('google_sheet', 'running', ?, ?, ?, ?, ?)
            """,
            (started, actor_username, actor_name, spreadsheet_id, sheet_name),
        )
        log_id = int(log_cur.lastrowid)
        conn.commit()
        try:
            values = get_sheet_values(spreadsheet_id, sheet_name, sheet_range)
            if not values:
                raise ValueError(f"La hoja '{sheet_name}' no tiene datos.")
            if len(values) < header_row:
                raise ValueError(f"La hoja '{sheet_name}' no tiene la fila de encabezados configurada ({header_row}).")
            headers = [str(x).strip() for x in values[header_row - 1]]
            def configured_alias(key: str, fallback: list[str]) -> list[str]:
                configured = clean_text(columns_cfg.get(key) or "")
                return ([configured] if configured else []) + fallback
            marca_col = find_column(headers, configured_alias("marca", ["MARCA"]), fallback_index=0)
            tipo_col = find_column(headers, configured_alias("tipo", ["TIPO", "RUBRO", "FAMILIA"]), fallback_index=1)
            desc_col = find_column(headers, configured_alias("descripcion", ["DESCRIPCION", "DESCRIPCIÓN", "PRODUCTO", "ARTICULO", "ARTÍCULO", "NOMBRE", "MODELO"]), fallback_index=2)
            sku_col = find_column(headers, configured_alias("sku", ["SKU", "CODIGO", "CÓDIGO", "COD", "CODE", "MODELO"]), fallback_index=3)
            pvp_col = find_column(headers, configured_alias("pvp", ["PVP", "PRECIO", "PRECIO VENTA", "PRECIO DE VENTA", "PVP FINAL", "PUBLICO", "PÚBLICO"]), fallback_index=4)
            costo_col = find_column(headers, configured_alias("costo_vigente", ["COSTO VIGENTE", "COSTO", "COSTO UNITARIO", "PRECIO COSTO", "COSTO ACTUAL", "COSTO FINAL", "VALOR COSTO", "COSTO NETO", "NETO"]), fallback_index=5)
            if sku_col is None or desc_col is None:
                raise ValueError("La Planilla Madre debe tener al menos DESCRIPCION y SKU.")
            now = utc_now_iso()
            for idx, raw in enumerate(values[header_row:], start=header_row + 1):
                def get(col: int | None) -> str:
                    if col is None or col >= len(raw):
                        return ""
                    return clean_text(raw[col])
                sku = get(sku_col)
                descripcion = get(desc_col)
                if not sku and not descripcion:
                    continue
                processed += 1
                if not sku:
                    skipped += 1
                    errors.append(f"Fila {idx}: producto sin SKU. Se omitió.")
                    continue
                sku_norm = sku_key(sku)
                marca = get(marca_col)
                tipo = get(tipo_col)
                pvp_dec = parse_decimal_ar(get(pvp_col))
                costo_dec = parse_decimal_ar(get(costo_col))
                pvp_float = decimal_to_float(pvp_dec)
                costo_float = decimal_to_float(costo_dec)
                pvp_text = money_text(pvp_dec)
                costo_text = money_text(costo_dec)
                condicion = condition_from_text(sku, descripcion)
                marca_norm = normalize_text(marca)
                search = normalize_text(" ".join([sku, descripcion, marca, tipo, condicion]))
                _, brand_created = ensure_brand(conn, marca, now)
                if brand_created:
                    brands_created += 1
                existing = conn.execute(
                    "SELECT id, pvp, costo_vigente FROM products WHERE sku_normalized = ?",
                    (sku_norm,),
                ).fetchone()
                if existing:
                    old_pvp: float | None = existing["pvp"]
                    old_costo: float | None = existing["costo_vigente"]
                    product_id = int(existing["id"])
                    conn.execute(
                        """
                        UPDATE products
                        SET sku = ?, marca = ?, marca_normalized = ?, tipo = ?, descripcion = ?, pvp = ?, pvp_text = ?,
                            costo_vigente = ?, costo_text = ?, condicion_producto = ?, search_text = ?, source_sheet = ?,
                            source_row = ?, is_active = 1, last_synced_at = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (sku, marca, marca_norm, tipo, descripcion, pvp_float, pvp_text, costo_float, costo_text, condicion, search, sheet_name, idx, now, now, product_id),
                    )
                    updated += 1
                    # Detectar cambio de PVP (solo si ambos valores son conocidos)
                    if pvp_float is not None and old_pvp is not None and abs(pvp_float - old_pvp) > 0.005:
                        price_changes_detected += 1
                        if _try_create_price_cost_update(
                            conn, "price", sku, descripcion, marca,
                            money_text(old_pvp), pvp_text, product_id, log_id, now,
                        ):
                            price_cost_updates_created += 1
                        else:
                            price_cost_updates_skipped += 1
                    # Detectar cambio de Costo Vigente (solo si ambos valores son conocidos)
                    if costo_float is not None and old_costo is not None and abs(costo_float - old_costo) > 0.005:
                        cost_changes_detected += 1
                        if _try_create_price_cost_update(
                            conn, "cost", sku, descripcion, marca,
                            money_text(old_costo), costo_text, product_id, log_id, now,
                        ):
                            price_cost_updates_created += 1
                        else:
                            price_cost_updates_skipped += 1
                else:
                    conn.execute(
                        """
                        INSERT INTO products (sku, sku_normalized, marca, marca_normalized, tipo, descripcion, pvp, pvp_text,
                            costo_vigente, costo_text, condicion_producto, search_text, source_sheet, source_row, is_active,
                            last_synced_at, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                        """,
                        (sku, sku_norm, marca, marca_norm, tipo, descripcion, pvp_float, pvp_text, costo_float, costo_text, condicion, search, sheet_name, idx, now, now, now),
                    )
                    created += 1
            status_value = "success" if not errors else "partial"
        except Exception as exc:
            status_value = "failed"
            errors.append(str(exc))
        finished = utc_now_iso()
        conn.execute(
            """
            UPDATE product_sync_logs
            SET status = ?, finished_at = ?, rows_processed = ?, rows_created = ?, rows_updated = ?, rows_skipped = ?,
                brands_created = ?, errors_json = ?,
                price_changes_detected = ?, cost_changes_detected = ?,
                price_cost_updates_created = ?, price_cost_updates_skipped = ?
            WHERE id = ?
            """,
            (
                status_value, finished, processed, created, updated, skipped, brands_created,
                json.dumps(errors, ensure_ascii=False),
                price_changes_detected, cost_changes_detected,
                price_cost_updates_created, price_cost_updates_skipped,
                log_id,
            ),
        )
        conn.commit()
    return {
        "ok": status_value in {"success", "partial"},
        "status": status_value,
        "started_at": started,
        "finished_at": finished,
        "rows_processed": processed,
        "rows_created": created,
        "rows_updated": updated,
        "rows_skipped": skipped,
        "brands_created": brands_created,
        "errors": errors,
        "spreadsheet_id": spreadsheet_id,
        "sheet_name": sheet_name,
        "price_changes_detected": price_changes_detected,
        "cost_changes_detected": cost_changes_detected,
        "price_cost_updates_created": price_cost_updates_created,
        "price_cost_updates_skipped": price_cost_updates_skipped,
    }


def get_provider_for_brand(marca: str) -> dict[str, Any] | None:
    norm = normalize_text(marca)
    if not norm:
        return None
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        row = conn.execute(
            """
            SELECT p.*
            FROM product_brands b
            JOIN brand_providers bp ON bp.brand_id = b.id
            JOIN providers p ON p.id = bp.provider_id
            WHERE b.normalized_name = ? AND b.is_active = 1 AND p.is_active = 1
            ORDER BY bp.is_default DESC, p.name ASC
            LIMIT 1
            """,
            (norm,),
        ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "name": row["name"], "contact_name": row["contact_name"], "email": row["email"], "phone": row["phone"]}
