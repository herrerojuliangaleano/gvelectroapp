from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func, select

from .config import get_settings
from .db import db_session
from .google_sheets import quote_sheet_name, sheets_service
from .models.auth import User
from .models.products import BrandProvider, Product, ProductBrand, ProductSyncLog, Provider
from .models.system import PriceCostUpdate, PriceCostUpdateCheck, PriceCostUpdateHistory
from .operational_config import extract_spreadsheet_id, load_operational_config
from .price_cost_rules import CHECKS_BY_TYPE, notify_grouped_price_cost_updates

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

PRODUCT_MASTER_HEADERS = ["MARCA", "TIPO", "DESCRIPCION", "SKU", "PVP", "COSTO VIGENTE"]

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


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


def ensure_product_catalog_tables(_conn: Any = None) -> None:
    # Compatibilidad para routers legacy que todavia llaman este helper.
    return


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


def _user_id_from_actor(session, actor: Any) -> int | None:
    username = str(getattr(actor, "username", "") or "").strip().lower()
    if not username:
        return None
    return session.scalar(select(User.id).where(func.lower(User.username) == username))


def _ensure_brand(session, marca: str, now: datetime) -> tuple[int | None, bool]:
    clean = clean_text(marca)
    norm = normalize_text(clean)
    if not norm:
        return None, False
    brand = session.scalar(select(ProductBrand).where(ProductBrand.normalized_name == norm))
    if brand:
        brand.name = clean
        brand.is_active = True
        brand.updated_at = now
        return int(brand.id), False
    brand = ProductBrand(name=clean, normalized_name=norm, is_active=True, created_at=now, updated_at=now)
    session.add(brand)
    session.flush()
    return int(brand.id), True


def row_to_product(product: Product) -> dict[str, Any]:
    pvp = decimal_to_float(product.pvp)
    costo = decimal_to_float(product.costo_vigente)
    label_parts = [product.descripcion or product.sku]
    if product.sku and product.sku != product.descripcion:
        label_parts.append(product.sku)
    if product.marca:
        label_parts.append(product.marca)
    if product.pvp_text:
        label_parts.append(product.pvp_text)
    return {
        "id": int(product.id),
        "sku": str(product.sku or ""),
        "marca": str(product.marca or ""),
        "tipo": str(product.tipo or ""),
        "descripcion": str(product.descripcion or ""),
        "producto": str(product.descripcion or ""),
        "pvp": pvp,
        "pvp_text": str(product.pvp_text or ""),
        "pvp_texto": str(product.pvp_text or ""),
        "precio": pvp,
        "precio_texto": str(product.pvp_text or ""),
        "costo_vigente": costo,
        "costo_text": str(product.costo_text or ""),
        "costo_texto": str(product.costo_text or ""),
        "condicion": str(product.condicion_producto or ""),
        "condicion_producto": str(product.condicion_producto or ""),
        "source_row": product.source_row,
        "last_synced_at": product.last_synced_at.isoformat() if product.last_synced_at else "",
        "updated_at": product.updated_at.isoformat() if product.updated_at else "",
        "is_active": bool(product.is_active),
        "label": " - ".join([p for p in label_parts if p]),
        "search": str(product.search_text or ""),
    }


def search_products(query: str, limit: int = 20) -> list[dict[str, Any]]:
    q = normalize_text(query)
    if len(q) < 2:
        return []
    tokens = q.split()[:5]
    with db_session() as session:
        stmt = select(Product).where(Product.is_active.is_(True))
        for token in tokens:
            stmt = stmt.where(Product.search_text.ilike(f"%{token}%"))
        rows = session.scalars(stmt.limit(max(limit * 4, limit))).all()
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
    with db_session() as session:
        product = session.scalar(
            select(Product).where(Product.sku_normalized == key, Product.is_active.is_(True))
        )
        if product:
            return row_to_product(product)
    results = search_products(value, limit=1)
    return results[0] if results else None


def _try_create_price_cost_update(
    session,
    change_type: str,
    sku: str,
    producto: str,
    marca: str,
    valor_anterior: Decimal | None,
    valor_nuevo: Decimal | None,
    product_id: int,
    sync_log_id: int,
    now: datetime,
) -> dict[str, Any] | None:
    if valor_nuevo is None:
        return None
    existing = session.scalar(
        select(PriceCostUpdate.id).where(
            PriceCostUpdate.sku == sku,
            PriceCostUpdate.type == change_type,
            PriceCostUpdate.valor_nuevo == valor_nuevo,
            PriceCostUpdate.estado.in_(["Pendiente", "En proceso"]),
        )
    )
    if existing:
        return None
    update = PriceCostUpdate(
        type=change_type,
        producto=producto,
        sku=sku,
        marca=marca,
        valor_anterior=valor_anterior,
        valor_nuevo=valor_nuevo,
        estado="En proceso",
        created_by_user_id=None,
        created_at=now,
        updated_at=now,
        source="catalog_sync",
        source_product_id=product_id,
        source_sync_log_id=sync_log_id,
        auto_created=True,
    )
    session.add(update)
    session.flush()
    for key, label in CHECKS_BY_TYPE[change_type]:
        is_planilla = key == "planilla_madre"
        session.add(
            PriceCostUpdateCheck(
                update_id=update.id,
                check_key=key,
                label=label,
                checked=is_planilla,
                checked_by_user_id=None,
                checked_at=now if is_planilla else None,
            )
        )
    session.add(
        PriceCostUpdateHistory(
            update_id=update.id,
            created_at=now,
            user_id=None,
            action="auto_creado",
            detail={"source": "catalog_sync", "sync_log_id": sync_log_id},
        )
    )
    return {
        "id": int(update.id),
        "type": change_type,
        "marca": marca,
        "sku": sku,
        "producto": producto,
        "valor_nuevo": money_text(valor_nuevo),
    }


def sync_products_from_sheet(actor: Any) -> dict[str, Any]:
    started_dt = utc_now_dt()
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
    created_price_updates: list[dict[str, Any]] = []
    created_cost_updates: list[dict[str, Any]] = []
    status_value = "success"

    with db_session() as session:
        log = ProductSyncLog(
            source="google_sheet",
            status="running",
            actor_user_id=_user_id_from_actor(session, actor),
            started_at=started_dt,
            spreadsheet_id=spreadsheet_id,
            sheet_name=sheet_name,
            errors=[],
        )
        session.add(log)
        session.commit()
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
            desc_col = find_column(headers, configured_alias("descripcion", ["DESCRIPCION", "DESCRIPCION", "PRODUCTO", "ARTICULO", "NOMBRE", "MODELO"]), fallback_index=2)
            sku_col = find_column(headers, configured_alias("sku", ["SKU", "CODIGO", "COD", "CODE", "MODELO"]), fallback_index=3)
            pvp_col = find_column(headers, configured_alias("pvp", ["PVP", "PRECIO", "PRECIO VENTA", "PRECIO DE VENTA", "PVP FINAL", "PUBLICO"]), fallback_index=4)
            costo_col = find_column(headers, configured_alias("costo_vigente", ["COSTO VIGENTE", "COSTO", "COSTO UNITARIO", "PRECIO COSTO", "COSTO ACTUAL", "COSTO FINAL", "VALOR COSTO", "COSTO NETO", "NETO"]), fallback_index=5)
            if sku_col is None or desc_col is None:
                raise ValueError("La Planilla Madre debe tener al menos DESCRIPCION y SKU.")

            now = utc_now_dt()
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
                    errors.append(f"Fila {idx}: producto sin SKU. Se omitio.")
                    continue

                sku_norm = sku_key(sku)
                marca = get(marca_col)
                tipo = get(tipo_col)
                pvp_dec = parse_decimal_ar(get(pvp_col))
                costo_dec = parse_decimal_ar(get(costo_col))
                pvp_text = money_text(pvp_dec)
                costo_text = money_text(costo_dec)
                condicion = condition_from_text(sku, descripcion)
                marca_norm = normalize_text(marca)
                search = normalize_text(" ".join([sku, descripcion, marca, tipo, condicion]))
                _, brand_created = _ensure_brand(session, marca, now)
                if brand_created:
                    brands_created += 1

                product = session.scalar(select(Product).where(Product.sku_normalized == sku_norm))
                if product:
                    old_pvp = product.pvp
                    old_costo = product.costo_vigente
                    product.sku = sku
                    product.marca = marca
                    product.marca_normalized = marca_norm
                    product.tipo = tipo
                    product.descripcion = descripcion
                    product.pvp = pvp_dec
                    product.pvp_text = pvp_text
                    product.costo_vigente = costo_dec
                    product.costo_text = costo_text
                    product.condicion_producto = condicion
                    product.search_text = search
                    product.source_sheet = sheet_name
                    product.source_row = idx
                    product.is_active = True
                    product.last_synced_at = now
                    product.updated_at = now
                    updated += 1

                    if pvp_dec is not None and (old_pvp is None or abs(pvp_dec - old_pvp) > Decimal("0.005")):
                        price_changes_detected += 1
                        created_update = _try_create_price_cost_update(session, "price", sku, descripcion, marca, old_pvp, pvp_dec, int(product.id), int(log.id), now)
                        if created_update:
                            price_cost_updates_created += 1
                            created_price_updates.append(created_update)
                        else:
                            price_cost_updates_skipped += 1
                    if costo_dec is not None and (old_costo is None or abs(costo_dec - old_costo) > Decimal("0.005")):
                        cost_changes_detected += 1
                        created_update = _try_create_price_cost_update(session, "cost", sku, descripcion, marca, old_costo, costo_dec, int(product.id), int(log.id), now)
                        if created_update:
                            price_cost_updates_created += 1
                            created_cost_updates.append(created_update)
                        else:
                            price_cost_updates_skipped += 1
                else:
                    product = Product(
                        sku=sku,
                        sku_normalized=sku_norm,
                        marca=marca,
                        marca_normalized=marca_norm,
                        tipo=tipo,
                        descripcion=descripcion,
                        pvp=pvp_dec,
                        pvp_text=pvp_text,
                        costo_vigente=costo_dec,
                        costo_text=costo_text,
                        condicion_producto=condicion,
                        search_text=search,
                        source_sheet=sheet_name,
                        source_row=idx,
                        is_active=True,
                        last_synced_at=now,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(product)
                    session.flush()
                    created += 1

                    if pvp_dec is not None:
                        price_changes_detected += 1
                        created_update = _try_create_price_cost_update(session, "price", sku, descripcion, marca, None, pvp_dec, int(product.id), int(log.id), now)
                        if created_update:
                            price_cost_updates_created += 1
                            created_price_updates.append(created_update)
                        else:
                            price_cost_updates_skipped += 1
                    if costo_dec is not None:
                        cost_changes_detected += 1
                        created_update = _try_create_price_cost_update(session, "cost", sku, descripcion, marca, None, costo_dec, int(product.id), int(log.id), now)
                        if created_update:
                            price_cost_updates_created += 1
                            created_cost_updates.append(created_update)
                        else:
                            price_cost_updates_skipped += 1
            status_value = "success" if not errors else "partial"
        except Exception as exc:
            status_value = "failed"
            errors.append(str(exc))

        finished_dt = utc_now_dt()
        log.status = status_value
        log.finished_at = finished_dt
        log.rows_processed = processed
        log.rows_created = created
        log.rows_updated = updated
        log.rows_skipped = skipped
        log.brands_created = brands_created
        log.errors = errors
        log.price_changes_detected = price_changes_detected
        log.cost_changes_detected = cost_changes_detected
        log.price_cost_updates_created = price_cost_updates_created
        log.price_cost_updates_skipped = price_cost_updates_skipped
        session.commit()

    if status_value in {"success", "partial"}:
        notify_grouped_price_cost_updates("price", created_price_updates)
        notify_grouped_price_cost_updates("cost", created_cost_updates)

    return {
        "ok": status_value in {"success", "partial"},
        "status": status_value,
        "started_at": started_dt.isoformat(),
        "finished_at": finished_dt.isoformat(),
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
    with db_session() as session:
        row = session.execute(
            select(Provider)
            .join(BrandProvider, BrandProvider.provider_id == Provider.id)
            .join(ProductBrand, ProductBrand.id == BrandProvider.brand_id)
            .where(
                ProductBrand.normalized_name == norm,
                ProductBrand.is_active.is_(True),
                Provider.is_active.is_(True),
            )
            .order_by(BrandProvider.is_default.desc(), Provider.name.asc())
            .limit(1)
        ).scalar_one_or_none()
        if not row:
            return None
        return {
            "id": int(row.id),
            "name": str(row.name or ""),
            "contact_name": str(row.contact_name or ""),
            "email": str(row.email or ""),
            "phone": str(row.phone or ""),
        }
