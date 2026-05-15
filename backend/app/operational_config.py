from __future__ import annotations

import json
import re
import threading
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .config import get_settings

CONFIG_LOCK = threading.Lock()

WARRANTY_RAW_HEADERS = [
    "ID GARANTIA", "RESPONSABLE", "INGRESO", "PRODUCTO", "SKU", "MARCA", "TIPO", "SERIE",
    "FALLA", "SUCURSAL", "DEPOSITO", "ESTADO", "OBSERVACIONES", "USUARIO",
    "FECHA ULTIMA ACTUALIZACION", "ACTUALIZADO POR",
]
WARRANTY_REQUIRED_HEADERS = [
    "ID GARANTIA", "RESPONSABLE", "INGRESO", "PRODUCTO", "SKU", "SERIE",
    "FALLA", "SUCURSAL", "DEPOSITO", "ESTADO",
]

# Estructura recomendada para la hoja de precios/presupuestos.
# El sistema lee por nombre de columna, no por posición.
# CONDICION es opcional: si el SKU o PRODUCTO contiene (O), se marca OUTLET automáticamente; si no, PRIMERA.
BUDGET_PRICE_HEADERS = [
    "MARCA", "TIPO", "PRODUCTO", "SKU", "PRECIO", "COSTO", "MARKUP",
    "STOCKII", "STOCK", "SUCURSAL", "CONDICION", "ACTIVO", "OBSERVACION",
]
BUDGET_PRICE_REQUIRED_HEADERS = ["PRODUCTO", "SKU", "PRECIO"]
BUDGET_SHIPPING_HEADERS = ["ZONA", "LOCALIDAD", "PRECIO", "ACTIVO", "OBSERVACION"]
BUDGET_SHIPPING_REQUIRED_HEADERS = ["ZONA", "PRECIO"]
BUDGET_RAW_HEADERS = [
    "ID PRESUPUESTO", "FECHA", "RESPONSABLE", "USUARIO", "SUCURSAL", "CLIENTE", "TELEFONO",
    "SUBTOTAL_PRODUCTOS", "ENVIO_ZONA", "ENVIO", "TOTAL_FINAL", "ESTADO", "OBSERVACIONES",
]
BUDGET_DETAIL_HEADERS = [
    "ID PRESUPUESTO", "SKU", "PRODUCTO", "MARCA", "TIPO", "CONDICION", "CANTIDAD",
    "PRECIO_UNITARIO", "TOTAL_LINEA",
]
PRODUCT_MASTER_HEADERS = ["MARCA", "TIPO", "DESCRIPCION", "SKU", "PVP", "COSTO VIGENTE"]

AUDIT_HEADERS = [
    "FECHA", "USUARIO", "NOMBRE", "ROL", "ACCION", "MODULO", "RECURSO", "ESTADO", "MENSAJE", "DETALLES",
]


def _now_iso() -> str:
    return datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).isoformat(timespec="seconds")


def _default_config() -> dict[str, Any]:
    settings = get_settings()
    return {
        "version": 1,
        "locked": False,
        "updated_at": None,
        "updated_by": None,
        "system": {
            "mode": "open",  # open | closed | maintenance
            "open_time": "09:00",
            "close_time": "16:00",
            "timezone": "America/Argentina/Buenos_Aires",
            "closed_message": "El sistema se encuentra cerrado o fuera del horario de carga. Intentá nuevamente cuando administración habilite el sistema.",
            "maintenance_message": "El sistema está en mantenimiento. Intentá nuevamente más tarde.",
        },
        "products": {
            "spreadsheet_url": settings.warranty_spreadsheet_url or "",
            "spreadsheet_id": settings.warranty_spreadsheet_id or "",
            "sheet_name": settings.product_catalog_sheet or "Productos PVP",
            "header_row": 1,
            "range": "A:Z",
            "cache_seconds": settings.budget_product_cache_seconds,
            "columns": {
                "marca": "MARCA",
                "tipo": "TIPO",
                "descripcion": "DESCRIPCION",
                "sku": "SKU",
                "pvp": "PVP",
                "costo_vigente": "COSTO VIGENTE",
            },
            "required_headers": PRODUCT_MASTER_HEADERS,
            "recommended_headers": PRODUCT_MASTER_HEADERS,
        },
        "warranties": {
            "spreadsheet_url": settings.warranty_spreadsheet_url or "",
            "spreadsheet_id": settings.warranty_spreadsheet_id or "",
            "raw_sheet": settings.warranty_raw_sheet,
            # Los productos se leen desde el catálogo local. product_sheet queda solo como compatibilidad histórica.
            "product_sheet": settings.product_catalog_sheet,
            "counter_sheet": "CONTADORES_GARANTIAS",
            "estado_default": settings.warranty_estado_default,
            "statuses": ["1 - INGRESO", "2 - PENDIENTE", "3 - LISTO PARA ENVIAR", "4 - ENVIADO AL PROVEEDOR", "5 - EN EL PROVEEDOR", "6 - RESPONDIDO POR PROVEEDOR", "7 - RESUELTO", "8 - RECHAZADO", "9 - ANULADA", "10 - FINALIZADO"],
            "final_statuses": ["10 - FINALIZADO"],
            "delay_ranges": [3, 7, 14, 30],
            "required_review_fields": ["producto", "sku", "marca", "serie", "falla", "sucursal", "deposito"],
            "sucursales": settings.warranty_sucursales,
            "depositos": settings.warranty_depositos,
            "product_cache_seconds": settings.warranty_product_cache_seconds,
            "required_headers": WARRANTY_REQUIRED_HEADERS,
            "recommended_headers": WARRANTY_RAW_HEADERS,
        },
        "sales": {
            "label": "Venta",
            "default_channel": "Venta",
            "sucursales": settings.warranty_sucursales,
        },
        "budgets": {
            "spreadsheet_url": "",
            "spreadsheet_id": "",
            "price_sheet": "precios",
            "shipping_sheet": "fletes",
            "raw_sheet": settings.budget_raw_sheet,
            "detail_sheet": settings.budget_detail_sheet,
            "estado_default": settings.budget_estado_default,
            "product_cache_seconds": settings.budget_product_cache_seconds,
            "price_required_headers": BUDGET_PRICE_REQUIRED_HEADERS,
            "price_recommended_headers": BUDGET_PRICE_HEADERS,
            "shipping_required_headers": BUDGET_SHIPPING_REQUIRED_HEADERS,
            "shipping_recommended_headers": BUDGET_SHIPPING_HEADERS,
            "raw_recommended_headers": BUDGET_RAW_HEADERS,
            "detail_recommended_headers": BUDGET_DETAIL_HEADERS,
        },
        "audit": {
            "sync_to_google_sheets": False,
            "spreadsheet_url": "",
            "spreadsheet_id": "",
            "sheet": "AUDITORIA",
            "recommended_headers": AUDIT_HEADERS,
        },
        "payroll": {
            "storage": "local",
            "allowed_file_types": ["pdf", "jpg", "jpeg", "png", "webp"],
            "max_file_mb": 10,
            "bulk_upload_enabled": True,
            "filename_hint": "DNI_AAAA-MM.pdf",
        },
        "tools": {
            "enabled": True,
            "workspace_description": "Herramientas internas y procesos de soporte.",
        },
        "price_cost_updates": {
            "source": "catalogo_local",
            "price_targets": ["Puma", "Web ElectroGV", "Web ABC", "Planilla Madre"],
            "cost_targets": ["Puma", "Planilla Madre"],
        },
        "arca": {
            "cutoff_day": 11,
            "cutoff_description": "Del día 1 al 10 se revisa mes actual + mes anterior completo. Desde el día 11 solo mes actual.",
        },
    }


def operational_config_file() -> Path:
    return get_settings().private_dir / "operational_config.json"


def extract_spreadsheet_id(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", text)
    if match:
        return match.group(1)
    if text and "/" not in text and len(text) > 20:
        return text
    return None


def _deep_merge(default: dict[str, Any], saved: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(default)
    for key, value in saved.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_operational_config() -> dict[str, Any]:
    path = operational_config_file()
    default = _default_config()
    if not path.exists():
        save_operational_config(default, updated_by="system", preserve_lock=True)
        return default
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(saved, dict):
            return default
        return _deep_merge(default, saved)
    except Exception:
        return default


def save_operational_config(config: dict[str, Any], updated_by: str = "system", preserve_lock: bool = False) -> dict[str, Any]:
    settings = get_settings()
    settings.ensure_dirs()
    current = load_operational_config() if operational_config_file().exists() else _default_config()
    merged = _deep_merge(_default_config(), config)
    if preserve_lock:
        merged["locked"] = bool(current.get("locked", merged.get("locked", False)))
    merged["updated_at"] = _now_iso()
    merged["updated_by"] = updated_by
    with CONFIG_LOCK:
        operational_config_file().write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def is_superadmin(user: Any) -> bool:
    role = str(getattr(user, "role", "")).upper()
    permissions = getattr(user, "permissions", []) or []
    return role == "SUPERADMIN" or "*" in permissions



def runtime_product_catalog_config() -> dict[str, Any]:
    settings = get_settings()
    root = load_operational_config()
    cfg = root.get("products", {}) if isinstance(root, dict) else {}
    budgets = root.get("budgets", {}) if isinstance(root, dict) else {}
    warranties = root.get("warranties", {}) if isinstance(root, dict) else {}
    # Productos tiene configuración propia. Los fallbacks a presupuestos/garantías se mantienen solo para no romper instalaciones viejas.
    spreadsheet_id = (
        extract_spreadsheet_id(cfg.get("spreadsheet_id") or cfg.get("spreadsheet_url"))
        or extract_spreadsheet_id(budgets.get("spreadsheet_id") or budgets.get("spreadsheet_url"))
        or extract_spreadsheet_id(warranties.get("spreadsheet_id") or warranties.get("spreadsheet_url"))
        or settings.warranty_spreadsheet
    )
    columns = cfg.get("columns") if isinstance(cfg.get("columns"), dict) else {}
    return {
        "spreadsheet_id": spreadsheet_id,
        "spreadsheet_url": cfg.get("spreadsheet_url") or budgets.get("spreadsheet_url") or warranties.get("spreadsheet_url") or settings.warranty_spreadsheet_url or "",
        "sheet_name": cfg.get("sheet_name") or budgets.get("price_sheet") or warranties.get("product_sheet") or settings.product_catalog_sheet or "Productos PVP",
        "header_row": int(cfg.get("header_row") or 1),
        "range": cfg.get("range") or "A:Z",
        "cache_seconds": int(cfg.get("cache_seconds") or budgets.get("product_cache_seconds") or warranties.get("product_cache_seconds") or settings.budget_product_cache_seconds),
        "columns": {
            "marca": columns.get("marca") or "MARCA",
            "tipo": columns.get("tipo") or "TIPO",
            "descripcion": columns.get("descripcion") or "DESCRIPCION",
            "sku": columns.get("sku") or "SKU",
            "pvp": columns.get("pvp") or "PVP",
            "costo_vigente": columns.get("costo_vigente") or "COSTO VIGENTE",
        },
    }


def runtime_warranty_config() -> dict[str, Any]:
    settings = get_settings()
    cfg = load_operational_config().get("warranties", {})
    spreadsheet_id = extract_spreadsheet_id(cfg.get("spreadsheet_id") or cfg.get("spreadsheet_url")) or settings.warranty_spreadsheet
    return {
        "spreadsheet_id": spreadsheet_id,
        "raw_sheet": cfg.get("raw_sheet") or settings.warranty_raw_sheet,
        "product_sheet": cfg.get("product_sheet") or settings.product_catalog_sheet,
        "counter_sheet": cfg.get("counter_sheet") or "CONTADORES_GARANTIAS",
        "estado_default": cfg.get("estado_default") or settings.warranty_estado_default,
        "sucursales": cfg.get("sucursales") or settings.warranty_sucursales,
        "depositos": cfg.get("depositos") or settings.warranty_depositos,
        "product_cache_seconds": int(cfg.get("product_cache_seconds") or settings.warranty_product_cache_seconds),
    }


def runtime_sales_config() -> dict[str, Any]:
    settings = get_settings()
    root = load_operational_config()
    cfg = root.get("sales", {}) if isinstance(root, dict) else {}
    # Para no duplicar mantenimiento, si Ventas no tiene sucursales propias usa las de Garantías como fallback.
    sucursales = cfg.get("sucursales") or root.get("warranties", {}).get("sucursales") or settings.warranty_sucursales
    return {
        "label": cfg.get("label") or "Venta",
        "default_channel": cfg.get("default_channel") or "Venta",
        "sucursales": [str(x).strip() for x in (sucursales or []) if str(x).strip()],
    }


def runtime_budget_config() -> dict[str, Any]:
    settings = get_settings()
    cfg = load_operational_config().get("budgets", {})
    # Si no se configura planilla propia de presupuestos, se usa la de garantías como fallback para no romper lo actual.
    spreadsheet_id = extract_spreadsheet_id(cfg.get("spreadsheet_id") or cfg.get("spreadsheet_url")) or settings.warranty_spreadsheet
    return {
        "spreadsheet_id": spreadsheet_id,
        "price_sheet": cfg.get("price_sheet") or settings.product_catalog_sheet,
        "shipping_sheet": cfg.get("shipping_sheet") or "fletes",
        "raw_sheet": cfg.get("raw_sheet") or settings.budget_raw_sheet,
        "detail_sheet": cfg.get("detail_sheet") or settings.budget_detail_sheet,
        "estado_default": cfg.get("estado_default") or settings.budget_estado_default,
        "product_cache_seconds": int(cfg.get("product_cache_seconds") or settings.budget_product_cache_seconds),
    }


def runtime_audit_config() -> dict[str, Any]:
    cfg = load_operational_config().get("audit", {})
    spreadsheet_id = extract_spreadsheet_id(cfg.get("spreadsheet_id") or cfg.get("spreadsheet_url"))
    return {
        "sync_to_google_sheets": bool(cfg.get("sync_to_google_sheets", False)),
        "spreadsheet_id": spreadsheet_id,
        "sheet": cfg.get("sheet") or "AUDITORIA",
    }
