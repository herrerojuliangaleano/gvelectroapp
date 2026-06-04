from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func, or_, select

from ...access import ensure_active_user, user_has, users_with_permission
from ...audit import audit
from ...auth import require_current_user
from ...db import db_session
from ...models.auth import User
from ...models.system import (
    PriceCostUpdate as PriceCostUpdateModel,
    PriceCostUpdateCheck as PriceCostUpdateCheckModel,
    PriceCostUpdateHistory as PriceCostUpdateHistoryModel,
)
from ...price_cost_rules import (
    CHECKS_BY_TYPE,
    check_permissions,
    default_checks as rules_default_checks,
    normalize_change_type,
    notify_grouped_price_cost_updates,
    require_check_permission,
    user_can_mark_check,
)
from ...product_catalog import lookup_product_by_sku_or_text, utc_now_dt
from ...users import CurrentUser
from ..budgets import (
    find_column,
    format_money,
    get_values,
    load_product_catalog,
    normalize_text,
    parse_decimal_ar,
    runtime_budget_config,
    sheet_money,
)
from ..notifications import notify_many

router = APIRouter()

LOCK = threading.RLock()
STATUSES = ["Pendiente", "En proceso", "Completado", "Cancelado"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dt(value: Any) -> str:
    return value.isoformat() if value else ""


def require_type_permission(user: CurrentUser, change_type: str, action: str) -> None:
    ensure_active_user(user)
    if change_type not in CHECKS_BY_TYPE:
        raise HTTPException(status_code=400, detail="Tipo invalido. Usa price o cost.")
    prefix = "price" if change_type == "price" else "cost"
    view_permission = f"{prefix}_updates.view"
    action_permission = f"{prefix}_updates.{action}"
    if not user_has(user, view_permission) or not user_has(user, action_permission):
        raise HTTPException(status_code=403, detail="No tenes permiso para realizar esta accion")


def visible_types(user: CurrentUser) -> list[str]:
    ensure_active_user(user)
    out: list[str] = []
    if user_has(user, "price_updates.view"):
        out.append("price")
    if user_has(user, "cost_updates.view"):
        out.append("cost")
    return out


def normalize_type(value: str) -> str:
    return normalize_change_type(value)


def normalize_money_text(value: Any) -> str:
    dec = parse_decimal_ar(value)
    if dec is None:
        return str(value or "").strip()
    return sheet_money(dec)


def money_decimal_or_none(value: Any) -> Decimal | None:
    return parse_decimal_ar(value)


def _money_decimal_required(value: Any, label: str) -> Decimal:
    dec = money_decimal_or_none(value)
    if dec is None:
        raise HTTPException(status_code=400, detail=f"Ingresa un {label} valido.")
    return dec


def _current_user_id(session, user: CurrentUser) -> int | None:
    username = str(user.username or "").strip().lower()
    if not username:
        return None
    return session.scalar(select(User.id).where(func.lower(User.username) == username))


def _user_public(session, user_id: int | None, *, fallback_system: bool = False) -> tuple[str | None, str | None]:
    if not user_id:
        if fallback_system:
            return "sistema", "Sistema"
        return None, None
    user = session.get(User, user_id)
    if not user:
        return None, None
    return str(user.username or ""), str(user.display_name or user.username or "")


def row_to_check(session, row: PriceCostUpdateCheckModel, *, user: CurrentUser | None = None, change_type: str = "") -> dict[str, Any]:
    checked_by, checked_by_name = _user_public(session, row.checked_by_user_id)
    required_permissions = check_permissions(change_type, str(row.check_key)) if change_type else []
    return {
        "key": str(row.check_key),
        "label": str(row.label),
        "checked": bool(row.checked),
        "checked_by": checked_by,
        "checked_by_name": checked_by_name,
        "checked_at": _dt(row.checked_at),
        "can_check": user_can_mark_check(user, change_type, str(row.check_key)) if user and change_type else False,
        "required_permission": required_permissions[0] if required_permissions else "",
        "required_permissions": required_permissions,
    }


def load_checks(session, update_id: int, *, user: CurrentUser | None = None, change_type: str = "") -> list[dict[str, Any]]:
    rows = session.scalars(
        select(PriceCostUpdateCheckModel)
        .where(PriceCostUpdateCheckModel.update_id == update_id)
        .order_by(PriceCostUpdateCheckModel.id.asc())
    ).all()
    return [row_to_check(session, row, user=user, change_type=change_type) for row in rows]


def calculate_status(checks: list[dict[str, Any]], current: str = "") -> str:
    if current == "Cancelado":
        return "Cancelado"
    if not checks or not any(ch["checked"] for ch in checks):
        return "Pendiente"
    if all(ch["checked"] for ch in checks):
        return "Completado"
    return "En proceso"


def apply_status(session, update: PriceCostUpdateModel) -> str:
    checks = load_checks(session, int(update.id))
    estado = calculate_status(checks, str(update.estado or ""))
    update.estado = estado
    update.updated_at = utc_now_dt()
    return estado


def _money_out(value: Any) -> str:
    dec = money_decimal_or_none(value)
    return sheet_money(dec) if dec is not None else ""


def row_to_update(session, row: PriceCostUpdateModel, *, user: CurrentUser | None = None) -> dict[str, Any]:
    checks = load_checks(session, int(row.id), user=user, change_type=str(row.type or ""))
    checked_count = sum(1 for item in checks if item["checked"])
    total_checks = len(checks)
    old_dec = money_decimal_or_none(row.valor_anterior)
    new_dec = money_decimal_or_none(row.valor_nuevo)
    diff_text = ""
    if old_dec is not None and new_dec is not None:
        diff_text = sheet_money(new_dec - old_dec)
    created_by, created_by_name = _user_public(session, row.created_by_user_id, fallback_system=bool(row.auto_created))
    cancelled_by, _cancelled_by_name = _user_public(session, row.cancelled_by_user_id)
    return {
        "id": int(row.id),
        "type": str(row.type),
        "producto": str(row.producto or ""),
        "sku": str(row.sku or ""),
        "marca": row.marca,
        "valor_anterior": _money_out(row.valor_anterior),
        "valor_nuevo": _money_out(row.valor_nuevo),
        "diferencia": diff_text,
        "estado": str(row.estado),
        "lookup_warning": row.lookup_warning,
        "created_by": created_by or "",
        "created_by_name": created_by_name or "",
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
        "cancelled_at": _dt(row.cancelled_at) if row.cancelled_at else None,
        "cancelled_by": cancelled_by,
        "cancel_reason": row.cancel_reason,
        "checks": checks,
        "checked_count": checked_count,
        "total_checks": total_checks,
        "progress_percent": int(round((checked_count / total_checks) * 100)) if total_checks else 0,
        "source": str(row.source or ""),
        "auto_created": bool(row.auto_created),
    }


def record_history(session, update_id: int, user: CurrentUser, action: str, detail: dict[str, Any] | None = None) -> None:
    session.add(
        PriceCostUpdateHistoryModel(
            update_id=update_id,
            created_at=utc_now_dt(),
            user_id=_current_user_id(session, user),
            action=action,
            detail=detail or {},
        )
    )


def notify_users_with_permission(permission: str, title: str, message: str) -> None:
    try:
        notify_many(users_with_permission(permission), title, message, "price_cost_update", None)
    except Exception:
        return


def default_checks(change_type: str) -> list[tuple[str, str]]:
    return rules_default_checks(change_type)


def find_column_value(row: list[Any], col: int | None) -> str:
    if col is None or col >= len(row):
        return ""
    return str(row[col]).strip()


class LookupProductOut(BaseModel):
    found: bool
    type: Literal["price", "cost"]
    sku: str
    producto: str = ""
    marca: str = ""
    valor_anterior: str = ""
    valor_anterior_texto: str = ""
    warning: str = ""
    source: str = "Google Sheets"


def lookup_from_sheets(sku: str, change_type: str) -> LookupProductOut:
    clean_sku = str(sku or "").strip()
    if not clean_sku:
        return LookupProductOut(found=False, type=change_type, sku="", warning="Ingresa un SKU/modelo para buscar.")

    local = lookup_product_by_sku_or_text(clean_sku)
    if local:
        raw_value = local.get("pvp_text") if change_type == "price" else local.get("costo_text")
        value_text = str(raw_value or "")
        return LookupProductOut(
            found=True,
            type=change_type,
            sku=str(local.get("sku") or clean_sku),
            producto=str(local.get("producto") or local.get("descripcion") or ""),
            marca=str(local.get("marca") or ""),
            valor_anterior=value_text.replace("$", "").strip(),
            valor_anterior_texto=value_text,
            warning="" if value_text else "Se encontro el producto, pero el valor anterior esta vacio.",
            source="Catalogo local",
        )

    query = normalize_text(clean_sku)
    try:
        cfg = runtime_budget_config()
        sheet_name = str(cfg.get("price_sheet") or "Productos PVP")
        values = get_values(sheet_name, "A:Z")
        if not values:
            raise ValueError(f"La hoja '{sheet_name}' no tiene datos.")
        headers = [str(x).strip() for x in values[0]]
        producto_col = find_column(headers, ["PRODUCTO", "DESCRIPCION", "DESCRIPCION", "ARTICULO", "ARTICULO", "NOMBRE", "MODELO"], fallback_index=2)
        sku_col = find_column(headers, ["SKU", "CODIGO", "CODIGO", "COD", "CODE", "MODELO"], fallback_index=3)
        marca_col = find_column(headers, ["MARCA"], fallback_index=0)
        precio_col = find_column(headers, ["PVP", "PRECIO", "PRECIO VENTA", "PRECIO DE VENTA", "PVP FINAL", "VALOR", "PUBLICO", "PUBLICO", "CONTADO", "PRECIO CONTADO"], fallback_index=4)
        costo_col = find_column(headers, ["COSTO", "COSTO UNITARIO", "PRECIO COSTO", "COSTO ACTUAL", "COSTO FINAL", "VALOR COSTO", "COSTO NETO", "NETO"])
        value_col = precio_col if change_type == "price" else costo_col
        if value_col is None:
            label = "precio" if change_type == "price" else "costo"
            return LookupProductOut(found=False, type=change_type, sku=clean_sku, warning=f"No encontre columna de {label} en la hoja '{sheet_name}'.")

        best: tuple[int, list[Any]] | None = None
        for row in values[1:]:
            row_sku = find_column_value(row, sku_col)
            row_product = find_column_value(row, producto_col)
            row_brand = find_column_value(row, marca_col)
            sku_norm = normalize_text(row_sku)
            haystack = normalize_text(" ".join([row_sku, row_product, row_brand]))
            if not haystack:
                continue
            score = 0
            if sku_norm == query:
                score += 100
            elif sku_norm.startswith(query) or query.startswith(sku_norm):
                score += 50
            elif query in haystack:
                score += 20
            if score and (best is None or score > best[0]):
                best = (score, row)

        if not best:
            return LookupProductOut(found=False, type=change_type, sku=clean_sku, warning="No se encontro valor anterior para este SKU.")

        row = best[1]
        value_raw = find_column_value(row, value_col)
        dec = parse_decimal_ar(value_raw)
        value_text = sheet_money(dec) if dec is not None else value_raw
        return LookupProductOut(
            found=True,
            type=change_type,
            sku=find_column_value(row, sku_col) or clean_sku,
            producto=find_column_value(row, producto_col),
            marca=find_column_value(row, marca_col),
            valor_anterior=value_text,
            valor_anterior_texto=format_money(dec) if dec is not None else value_raw,
            warning="" if value_text else "Se encontro el producto, pero el valor anterior esta vacio.",
            source=f"Google Sheets - {sheet_name}",
        )
    except Exception as exc:
        if change_type == "price":
            try:
                for item in load_product_catalog():
                    haystack = item.get("search", "")
                    sku_norm = normalize_text(item.get("sku", ""))
                    if sku_norm == query or query in haystack:
                        precio = item.get("precio")
                        dec = parse_decimal_ar(precio)
                        value_text = sheet_money(dec) if dec is not None else str(item.get("precio_texto") or "")
                        return LookupProductOut(
                            found=True,
                            type="price",
                            sku=str(item.get("sku") or clean_sku),
                            producto=str(item.get("producto") or ""),
                            marca=str(item.get("marca") or ""),
                            valor_anterior=value_text,
                            valor_anterior_texto=str(item.get("precio_texto") or format_money(dec)),
                            warning="",
                            source="Catalogo cacheado",
                        )
            except Exception:
                pass
        return LookupProductOut(found=False, type=change_type, sku=clean_sku, warning=f"No se pudo consultar Google Sheets: {exc}")


class PriceCostUpdateCheck(BaseModel):
    key: str
    label: str
    checked: bool
    checked_by: str | None = None
    checked_by_name: str | None = None
    checked_at: str | None = None
    can_check: bool = False
    required_permission: str = ""
    required_permissions: list[str] = Field(default_factory=list)


class PriceCostUpdateOut(BaseModel):
    id: int
    type: Literal["price", "cost"]
    producto: str
    sku: str
    marca: str | None = None
    valor_anterior: str | None = None
    valor_nuevo: str
    diferencia: str = ""
    estado: str
    lookup_warning: str | None = None
    created_by: str
    created_by_name: str
    created_at: str
    updated_at: str
    cancelled_at: str | None = None
    cancelled_by: str | None = None
    cancel_reason: str | None = None
    checks: list[PriceCostUpdateCheck]
    checked_count: int
    total_checks: int
    progress_percent: int
    source: str = ""
    auto_created: bool = False


class PriceCostUpdateCreate(BaseModel):
    type: Literal["price", "cost"]
    sku: str = Field(min_length=1)
    producto: str | None = None
    marca: str | None = None
    valor_nuevo: str = Field(min_length=1)
    valor_anterior: str | None = None

    @field_validator("type", mode="before")
    @classmethod
    def valid_type(cls, value: Any) -> str:
        value = normalize_type(str(value))
        if value not in CHECKS_BY_TYPE:
            raise ValueError("Tipo invalido")
        return value


class PriceCostUpdatePatch(BaseModel):
    producto: str | None = None
    sku: str | None = None
    marca: str | None = None
    valor_nuevo: str | None = None
    valor_anterior: str | None = None


class CheckPayload(BaseModel):
    check_key: str
    checked: bool = True


class CancelPayload(BaseModel):
    cancel_reason: str | None = None


class PriceCostUpdateHistoryOut(BaseModel):
    id: int
    update_id: int
    created_at: str
    username: str
    display_name: str
    action: str
    detail: dict[str, Any]


def _get_update_or_404(session, update_id: int) -> PriceCostUpdateModel:
    row = session.get(PriceCostUpdateModel, update_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Actualizacion no encontrada")
    return row


def _get_visible_update(session, update_id: int, user: CurrentUser) -> PriceCostUpdateModel:
    types = visible_types(user)
    if not types:
        raise HTTPException(status_code=403, detail="No tenes permiso para ver actualizaciones")
    row = _get_update_or_404(session, update_id)
    if str(row.type) not in types:
        raise HTTPException(status_code=403, detail="No tenes permiso para ver esta actualizacion")
    return row

# Sub-routers (Fase 3.B.3)
# Futuras vistas/archivado/PDFs por marca deben entrar como submodulos nuevos.
from . import lookup as _lookup_module  # noqa: E402
from . import listing as _listing_module  # noqa: E402
from . import creation as _creation_module  # noqa: E402
from . import announcements as _announcements_module  # noqa: E402
from . import lifecycle as _lifecycle_module  # noqa: E402
from . import history as _history_module  # noqa: E402

router.include_router(_lookup_module.router)
router.include_router(_listing_module.router)
router.include_router(_creation_module.router)
router.include_router(_announcements_module.router)
router.include_router(_lifecycle_module.router)
router.include_router(_history_module.router)
