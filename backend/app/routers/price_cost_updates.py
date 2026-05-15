from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from ..audit import audit
from ..auth import require_current_user
from ..config import get_settings
from ..permissions import has_permission
from ..users import CurrentUser, load_roles, load_users
from ..product_catalog import lookup_product_by_sku_or_text
from .budgets import (
    find_column,
    format_money,
    get_values,
    header_key,
    load_product_catalog,
    normalize_text,
    parse_decimal_ar,
    runtime_budget_config,
    sheet_money,
)
from .notifications import notify_many

router = APIRouter(prefix="/api/price-cost-updates", tags=["price-cost-updates"])

LOCK = threading.RLock()
STATUSES = ["Pendiente", "En proceso", "Completado", "Cancelado"]
CHECKS_BY_TYPE: dict[str, list[tuple[str, str]]] = {
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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def require_active_user(user: CurrentUser) -> None:
    if user.must_change_password:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenés que crear tu contraseña antes de continuar")


def can_user(user: CurrentUser, permission: str) -> bool:
    return user.has(permission)


def require_type_permission(user: CurrentUser, change_type: str, action: str) -> None:
    require_active_user(user)
    if change_type not in CHECKS_BY_TYPE:
        raise HTTPException(status_code=400, detail="Tipo inválido. Usá price o cost.")
    prefix = 'price' if change_type == 'price' else 'cost'
    view_permission = f"{prefix}_updates.view"
    action_permission = f"{prefix}_updates.{action}"
    # Regla fuerte: nadie puede recibir, crear ni marcar costos si no tiene permiso de ver costos.
    if not can_user(user, view_permission) or not can_user(user, action_permission):
        raise HTTPException(status_code=403, detail="No tenés permiso para realizar esta acción")


def visible_types(user: CurrentUser) -> list[str]:
    require_active_user(user)
    out: list[str] = []
    if can_user(user, "price_updates.view"):
        out.append("price")
    if can_user(user, "cost_updates.view"):
        out.append("cost")
    return out


def normalize_type(value: str) -> str:
    text = str(value or "").strip().lower()
    if text in {"precio", "price", "pvp"}:
        return "price"
    if text in {"costo", "cost"}:
        return "cost"
    return text


def normalize_money_text(value: Any) -> str:
    dec = parse_decimal_ar(value)
    if dec is None:
        return str(value or "").strip()
    return sheet_money(dec)


def money_decimal_or_none(value: Any) -> Decimal | None:
    return parse_decimal_ar(value)


def row_to_check(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "key": str(row["check_key"]),
        "label": str(row["label"]),
        "checked": bool(row["checked"]),
        "checked_by": row["checked_by"],
        "checked_by_name": row["checked_by_name"],
        "checked_at": row["checked_at"],
    }


def load_checks(conn: sqlite3.Connection, update_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM price_cost_update_checks WHERE update_id = ? ORDER BY id ASC",
        (update_id,),
    ).fetchall()
    return [row_to_check(row) for row in rows]


def calculate_status(checks: list[dict[str, Any]], current: str = "") -> str:
    if current == "Cancelado":
        return "Cancelado"
    if not checks or not any(ch["checked"] for ch in checks):
        return "Pendiente"
    if all(ch["checked"] for ch in checks):
        return "Completado"
    return "En proceso"


def apply_status(conn: sqlite3.Connection, update_id: int) -> str:
    row = conn.execute("SELECT estado FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Actualización no encontrada")
    checks = load_checks(conn, update_id)
    estado = calculate_status(checks, str(row["estado"] or ""))
    conn.execute("UPDATE price_cost_updates SET estado = ?, updated_at = ? WHERE id = ?", (estado, utc_now(), update_id))
    return estado


def row_to_update(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    checks = load_checks(conn, int(row["id"]))
    checked_count = sum(1 for item in checks if item["checked"])
    total_checks = len(checks)
    valor_anterior = row["valor_anterior"]
    valor_nuevo = row["valor_nuevo"]
    diff_text = ""
    old_dec = money_decimal_or_none(valor_anterior)
    new_dec = money_decimal_or_none(valor_nuevo)
    if old_dec is not None and new_dec is not None:
        diff_text = sheet_money(new_dec - old_dec)
    return {
        "id": int(row["id"]),
        "type": str(row["type"]),
        "producto": str(row["producto"]),
        "sku": str(row["sku"]),
        "marca": row["marca"],
        "valor_anterior": valor_anterior,
        "valor_nuevo": valor_nuevo,
        "diferencia": diff_text,
        "estado": str(row["estado"]),
        "lookup_warning": row["lookup_warning"],
        "created_by": str(row["created_by"]),
        "created_by_name": str(row["created_by_name"]),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
        "cancelled_at": row["cancelled_at"],
        "cancelled_by": row["cancelled_by"],
        "cancel_reason": row["cancel_reason"],
        "checks": checks,
        "checked_count": checked_count,
        "total_checks": total_checks,
        "progress_percent": int(round((checked_count / total_checks) * 100)) if total_checks else 0,
        "source": str(row["source"] if "source" in row.keys() else ""),
        "auto_created": bool(row["auto_created"] if "auto_created" in row.keys() else 0),
    }


def record_history(conn: sqlite3.Connection, update_id: int, user: CurrentUser, action: str, detail: dict[str, Any] | None = None) -> None:
    conn.execute(
        """
        INSERT INTO price_cost_update_history (update_id, created_at, username, display_name, action, detail_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (update_id, utc_now(), user.username, user.display_name, action, json.dumps(detail or {}, ensure_ascii=False)),
    )


def notify_users_with_permission(permission: str, title: str, message: str) -> None:
    try:
        roles = load_roles()
        users = load_users()
        usernames: list[str] = []
        for username, record in users.items():
            if not record.is_active:
                continue
            perms = roles.get(record.role, {}).get("permissions", [])
            perms = [str(p) for p in perms] if isinstance(perms, list) else []
            if has_permission(perms, permission):
                usernames.append(username)
        notify_many(usernames, title, message, "price_cost_update", None)
    except Exception:
        # La notificación no debe romper una actualización urgente.
        return


def default_checks(change_type: str) -> list[tuple[str, str]]:
    return CHECKS_BY_TYPE[change_type]


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
        return LookupProductOut(found=False, type=change_type, sku="", warning="Ingresá un SKU/modelo para buscar.")

    # Fase 7: primero consultar el catálogo local sincronizado desde Planilla Madre.
    local = lookup_product_by_sku_or_text(clean_sku)
    if local:
        raw_value = local.get("pvp_text") if change_type == "price" else local.get("costo_text")
        numeric_value = local.get("pvp") if change_type == "price" else local.get("costo_vigente")
        value_text = str(raw_value or "")
        return LookupProductOut(
            found=True,
            type=change_type,
            sku=str(local.get("sku") or clean_sku),
            producto=str(local.get("producto") or local.get("descripcion") or ""),
            marca=str(local.get("marca") or ""),
            valor_anterior=value_text.replace("$", "").strip(),
            valor_anterior_texto=value_text,
            warning="" if value_text else "Se encontró el producto, pero el valor anterior está vacío.",
            source="Catálogo local",
        )

    query = normalize_text(clean_sku)
    try:
        cfg = runtime_budget_config()
        sheet_name = str(cfg.get("price_sheet") or "Productos PVP")
        values = get_values(sheet_name, "A:Z")
        if not values:
            raise ValueError(f"La hoja '{sheet_name}' no tiene datos.")
        headers = [str(x).strip() for x in values[0]]
        producto_col = find_column(headers, ["PRODUCTO", "DESCRIPCION", "DESCRIPCIÓN", "ARTICULO", "ARTÍCULO", "NOMBRE", "MODELO"], fallback_index=2)
        sku_col = find_column(headers, ["SKU", "CODIGO", "CÓDIGO", "COD", "CODE", "MODELO"], fallback_index=3)
        marca_col = find_column(headers, ["MARCA"], fallback_index=0)
        precio_col = find_column(headers, ["PVP", "PRECIO", "PRECIO VENTA", "PRECIO DE VENTA", "PVP FINAL", "VALOR", "PUBLICO", "PÚBLICO", "CONTADO", "PRECIO CONTADO"], fallback_index=4)
        costo_col = find_column(headers, ["COSTO", "COSTO UNITARIO", "PRECIO COSTO", "COSTO ACTUAL", "COSTO FINAL", "VALOR COSTO", "COSTO NETO", "NETO"])
        value_col = precio_col if change_type == "price" else costo_col
        if value_col is None:
            label = "precio" if change_type == "price" else "costo"
            return LookupProductOut(found=False, type=change_type, sku=clean_sku, warning=f"No encontré columna de {label} en la hoja '{sheet_name}'.")

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
            return LookupProductOut(found=False, type=change_type, sku=clean_sku, warning="No se encontró valor anterior para este SKU.")

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
            warning="" if value_text else "Se encontró el producto, pero el valor anterior está vacío.",
            source=f"Google Sheets · {sheet_name}",
        )
    except Exception as exc:
        # Fallback rápido para precios, usando el catálogo cacheado de presupuestos.
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
                            source="Catálogo cacheado",
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
            raise ValueError("Tipo inválido")
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


@router.get("/lookup-product", response_model=LookupProductOut)
def lookup_product(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    sku: str = Query(default=""),
    type: str = Query(default="price"),
):
    change_type = normalize_type(type)
    require_type_permission(user, change_type, "create")
    return lookup_from_sheets(sku, change_type)


@router.get("", response_model=list[PriceCostUpdateOut])
def list_updates(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    type: str = Query(default=""),
    estado: str = Query(default=""),
    q: str = Query(default=""),
    limit: int = Query(default=200, ge=1, le=500),
):
    types = visible_types(user)
    if not types:
        raise HTTPException(status_code=403, detail="No tenés permiso para ver actualizaciones de precios o costos")

    requested_type = normalize_type(type) if type else ""
    if requested_type:
        if requested_type not in CHECKS_BY_TYPE:
            raise HTTPException(status_code=400, detail="Tipo inválido")
        if requested_type not in types:
            raise HTTPException(status_code=403, detail="No tenés permiso para ver este tipo de actualización")
        types = [requested_type]

    placeholders = ",".join("?" for _ in types)
    query = f"SELECT * FROM price_cost_updates WHERE type IN ({placeholders})"
    params: list[Any] = list(types)
    if estado:
        query += " AND estado = ?"
        params.append(estado)
    if q:
        like = f"%{q.strip()}%"
        query += " AND (producto LIKE ? OR sku LIKE ? OR marca LIKE ?)"
        params.extend([like, like, like])
    query += " ORDER BY CASE estado WHEN 'Pendiente' THEN 1 WHEN 'En proceso' THEN 2 WHEN 'Completado' THEN 3 WHEN 'Cancelado' THEN 4 ELSE 9 END, id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
        return [PriceCostUpdateOut(**row_to_update(conn, row)) for row in rows]


@router.post("", response_model=PriceCostUpdateOut)
def create_update(data: PriceCostUpdateCreate, user: Annotated[CurrentUser, Depends(require_current_user)]):
    change_type = normalize_type(data.type)
    require_type_permission(user, change_type, "create")
    lookup = lookup_from_sheets(data.sku, change_type)
    valor_anterior = lookup.valor_anterior or normalize_money_text(data.valor_anterior)
    producto = (data.producto or lookup.producto or data.sku).strip()
    marca = (data.marca or lookup.marca or "").strip()
    valor_nuevo = normalize_money_text(data.valor_nuevo)
    warning = lookup.warning or None
    now = utc_now()

    with LOCK, connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO price_cost_updates (
                type, producto, sku, marca, valor_anterior, valor_nuevo, estado, lookup_warning,
                created_by, created_by_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?)
            """,
            (change_type, producto, (lookup.sku or data.sku).strip(), marca, valor_anterior, valor_nuevo, warning, user.username, user.display_name, now, now),
        )
        update_id = int(cursor.lastrowid)
        for key, label in default_checks(change_type):
            conn.execute(
                "INSERT INTO price_cost_update_checks (update_id, check_key, label, checked) VALUES (?, ?, ?, 0)",
                (update_id, key, label),
            )
        record_history(conn, update_id, user, "creado", {"type": change_type, "sku": data.sku, "valor_anterior": valor_anterior, "valor_nuevo": valor_nuevo})
        conn.commit()
        row = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        result = PriceCostUpdateOut(**row_to_update(conn, row))

    audit("price_cost_update.created", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Actualización urgente creada", details={"type": change_type, "sku": result.sku})
    label = "precio" if change_type == "price" else "costo"
    notify_users_with_permission(f"{change_type}_updates.view", f"Actualización urgente de {label}", f"{result.sku} · {result.producto}: nuevo {label} {result.valor_nuevo}")
    return result


@router.get("/{update_id}", response_model=PriceCostUpdateOut)
def get_update(update_id: int, user: Annotated[CurrentUser, Depends(require_current_user)]):
    types = visible_types(user)
    if not types:
        raise HTTPException(status_code=403, detail="No tenés permiso para ver actualizaciones")
    with connect() as conn:
        row = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Actualización no encontrada")
        if str(row["type"]) not in types:
            raise HTTPException(status_code=403, detail="No tenés permiso para ver esta actualización")
        return PriceCostUpdateOut(**row_to_update(conn, row))


@router.patch("/{update_id}", response_model=PriceCostUpdateOut)
def patch_update(update_id: int, data: PriceCostUpdatePatch, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with LOCK, connect() as conn:
        row = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Actualización no encontrada")
        change_type = str(row["type"])
        require_type_permission(user, change_type, "edit")
        if str(row["estado"]) == "Cancelado":
            raise HTTPException(status_code=400, detail="No se puede editar una actualización cancelada")
        fields: list[str] = []
        params: list[Any] = []
        detail: dict[str, Any] = {}
        for key in ["producto", "sku", "marca", "valor_anterior", "valor_nuevo"]:
            value = getattr(data, key)
            if value is None:
                continue
            clean = normalize_money_text(value) if key.startswith("valor_") else str(value).strip()
            fields.append(f"{key} = ?")
            params.append(clean)
            detail[key] = clean
        if fields:
            fields.append("updated_at = ?")
            params.append(utc_now())
            params.append(update_id)
            conn.execute(f"UPDATE price_cost_updates SET {', '.join(fields)} WHERE id = ?", params)
            record_history(conn, update_id, user, "editado", detail)
            conn.commit()
        updated = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        result = PriceCostUpdateOut(**row_to_update(conn, updated))
    audit("price_cost_update.updated", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Actualización editada", details=detail)
    return result


@router.post("/{update_id}/check", response_model=PriceCostUpdateOut)
def set_check(update_id: int, data: CheckPayload, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with LOCK, connect() as conn:
        row = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Actualización no encontrada")
        change_type = str(row["type"])
        require_type_permission(user, change_type, "check")
        if str(row["estado"]) == "Cancelado":
            raise HTTPException(status_code=400, detail="No se puede marcar una actualización cancelada")
        allowed = {key for key, _label in default_checks(change_type)}
        if data.check_key not in allowed:
            raise HTTPException(status_code=400, detail="Check inválido para este tipo de actualización")
        now = utc_now()
        if data.checked:
            conn.execute(
                "UPDATE price_cost_update_checks SET checked = 1, checked_by = ?, checked_by_name = ?, checked_at = ? WHERE update_id = ? AND check_key = ?",
                (user.username, user.display_name, now, update_id, data.check_key),
            )
        else:
            conn.execute(
                "UPDATE price_cost_update_checks SET checked = 0, checked_by = NULL, checked_by_name = NULL, checked_at = NULL WHERE update_id = ? AND check_key = ?",
                (update_id, data.check_key),
            )
        estado = apply_status(conn, update_id)
        record_history(conn, update_id, user, "check_marcado" if data.checked else "check_desmarcado", {"check_key": data.check_key, "estado": estado})
        conn.commit()
        updated = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        result = PriceCostUpdateOut(**row_to_update(conn, updated))
    audit("price_cost_update.check", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Checklist actualizado", details={"check_key": data.check_key, "checked": data.checked, "estado": result.estado})
    return result


@router.post("/{update_id}/cancel", response_model=PriceCostUpdateOut)
def cancel_update(update_id: int, data: CancelPayload, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with LOCK, connect() as conn:
        row = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Actualización no encontrada")
        change_type = str(row["type"])
        require_type_permission(user, change_type, "delete")
        now = utc_now()
        conn.execute(
            "UPDATE price_cost_updates SET estado = 'Cancelado', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
            (now, user.username, data.cancel_reason or "", now, update_id),
        )
        record_history(conn, update_id, user, "cancelado", {"cancel_reason": data.cancel_reason or ""})
        conn.commit()
        updated = conn.execute("SELECT * FROM price_cost_updates WHERE id = ?", (update_id,)).fetchone()
        result = PriceCostUpdateOut(**row_to_update(conn, updated))
    audit("price_cost_update.cancelled", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Actualización cancelada", details={"reason": data.cancel_reason or ""})
    return result


@router.get("/{update_id}/history", response_model=list[PriceCostUpdateHistoryOut])
def get_history(update_id: int, user: Annotated[CurrentUser, Depends(require_current_user)]):
    # Reutiliza la validación fuerte de visibilidad: costos no se exponen sin permiso.
    _ = get_update(update_id, user)
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM price_cost_update_history WHERE update_id = ? ORDER BY id DESC",
            (update_id,),
        ).fetchall()
    out = []
    for row in rows:
        try:
            detail = json.loads(row["detail_json"] or "{}")
        except Exception:
            detail = {}
        out.append(PriceCostUpdateHistoryOut(
            id=int(row["id"]),
            update_id=int(row["update_id"]),
            created_at=str(row["created_at"]),
            username=str(row["username"]),
            display_name=str(row["display_name"]),
            action=str(row["action"]),
            detail=detail,
        ))
    return out
