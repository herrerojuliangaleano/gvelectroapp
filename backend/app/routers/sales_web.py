from __future__ import annotations

import re
import sqlite3
import threading
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from ..audit import audit
from ..auth import require_permission
from ..config import get_settings
from ..permissions import has_permission
from ..users import CurrentUser, load_roles, load_users
from ..operational_config import runtime_sales_config
from .notifications import notify_many
from .budgets import BudgetProduct, load_product_catalog, normalize_text, parse_decimal_ar, format_money, sheet_money, condition_from_text

router = APIRouter(prefix="/api/sales-web", tags=["sales-web"])

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
REQUEST_LOCK = threading.RLock()
_SCHEMA_LOCK = threading.RLock()
_SCHEMA_CHECKED = False


def ensure_sales_web_schema(conn: sqlite3.Connection) -> None:
    """Migración liviana para campos nuevos sin depender de recrear la DB local."""
    global _SCHEMA_CHECKED
    if _SCHEMA_CHECKED:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_CHECKED:
            return
        try:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(sales_web_requests)").fetchall()}
            if cols:
                if "senia_monto" not in cols:
                    conn.execute("ALTER TABLE sales_web_requests ADD COLUMN senia_monto TEXT")
                if "saldo_restante" not in cols:
                    conn.execute("ALTER TABLE sales_web_requests ADD COLUMN saldo_restante TEXT")
                conn.commit()
        finally:
            _SCHEMA_CHECKED = True

STATUSES = ["Pendiente", "En proceso", "Completado", "Enviado a venta web", "Cancelado"]
ACTIVE_STATUSES = ["Pendiente", "En proceso", "Completado"]
STATUS_ORDER_SQL = "CASE estado WHEN 'Pendiente' THEN 1 WHEN 'En proceso' THEN 2 WHEN 'Completado' THEN 3 WHEN 'Enviado a venta web' THEN 4 WHEN 'Cancelado' THEN 5 ELSE 9 END"
PAYMENT_TYPES = ["Pago completo", "Seña"]
DELIVERY_TYPES = ["Retira en local", "Envío"]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    ensure_sales_web_schema(conn)
    return conn


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_ar() -> datetime:
    return datetime.now(AR_TZ)


def format_datetime_ar(iso_text: str | None) -> str:
    if not iso_text:
        return ""
    try:
        dt = datetime.fromisoformat(iso_text.replace("Z", "+00:00"))
        return dt.astimezone(AR_TZ).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(iso_text)


def parse_money_ar_text(value: Any) -> str:
    dec = parse_decimal_ar(value)
    if dec is None:
        text = str(value or "").strip()
        return text
    return sheet_money(dec)


class SalesWebItemIn(BaseModel):
    producto: str = Field(min_length=1)
    sku: str | None = None
    marca: str | None = None
    tipo: str | None = None
    condicion: str | None = None
    cantidad: int = Field(default=1, ge=1, le=999)
    precio_unitario: str | float | int | None = None


class SalesWebCreateRequest(BaseModel):
    dni: str = Field(min_length=1)
    apellido_nombre: str = Field(min_length=1)
    domicilio: str = Field(min_length=1)
    codigo_postal: str = Field(min_length=1)
    localidad: str = Field(min_length=1)
    telefono: str = Field(min_length=1)
    correo_electronico: str = Field(min_length=3)
    pago_tipo: str = Field(min_length=1)
    entrega_tipo: str = Field(min_length=1)
    barrio: str | None = None
    entre_calles: str | None = None
    observaciones: str | None = None
    costo_envio: str | float | int | None = None
    senia_monto: str | float | int | None = None
    sucursal: str | None = None
    canal: str | None = "Venta"
    items: list[SalesWebItemIn] = Field(default_factory=list, max_length=80)

    @field_validator("correo_electronico")
    @classmethod
    def validate_email(cls, value: str) -> str:
        text = str(value or "").strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", text):
            raise ValueError("Correo electrónico inválido")
        return text

    @field_validator("pago_tipo")
    @classmethod
    def validate_pago(cls, value: str) -> str:
        if value not in PAYMENT_TYPES:
            raise ValueError("Tipo de pago inválido")
        return value

    @field_validator("entrega_tipo")
    @classmethod
    def validate_entrega(cls, value: str) -> str:
        if value not in DELIVERY_TYPES:
            raise ValueError("Tipo de entrega inválido")
        return value


class SalesWebUpdateRequest(BaseModel):
    numero_remito_prefactura: str | None = None
    observacion_admin: str | None = None


class SalesWebCancelRequest(BaseModel):
    cancel_reason: str = Field(min_length=1)


class SalesWebItemOut(BaseModel):
    id: int | None = None
    sku: str | None = None
    producto: str
    marca: str | None = None
    tipo: str | None = None
    condicion: str | None = None
    cantidad: int
    precio_unitario: str | None = None
    total_linea: str | None = None


class SalesWebRequestOut(BaseModel):
    id: int
    numero_solicitud: str
    numero_remito_prefactura: str | None = None
    estado: str
    vendedor_id: str
    vendedor_nombre: str
    sucursal: str | None = None
    canal: str | None = None
    dni: str
    apellido_nombre: str
    telefono: str
    correo_electronico: str
    domicilio: str
    codigo_postal: str
    localidad: str
    barrio: str | None = None
    entre_calles: str | None = None
    observaciones: str | None = None
    pago_tipo: str
    entrega_tipo: str
    costo_envio: str | None = None
    senia_monto: str | None = None
    saldo_restante: str | None = None
    observacion_admin: str | None = None
    created_at: str
    updated_at: str
    created_at_text: str
    updated_at_text: str
    taken_at: str | None = None
    taken_by: str | None = None
    completed_at: str | None = None
    completed_by: str | None = None
    sent_to_sales_at: str | None = None
    sent_to_sales_by: str | None = None
    cancelled_at: str | None = None
    cancelled_by: str | None = None
    cancel_reason: str | None = None
    items: list[SalesWebItemOut] = []


class SalesWebOptions(BaseModel):
    estados: list[str]
    pagos: list[str]
    entregas: list[str]
    sucursales: list[str]


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["created_at_text"] = format_datetime_ar(data.get("created_at"))
    data["updated_at_text"] = format_datetime_ar(data.get("updated_at"))
    return data


def load_items(conn: sqlite3.Connection, request_id: int) -> list[SalesWebItemOut]:
    rows = conn.execute("SELECT * FROM sales_web_items WHERE request_id = ? ORDER BY id ASC", (request_id,)).fetchall()
    return [SalesWebItemOut(**dict(row)) for row in rows]


def user_can_manage_all_sales(user: CurrentUser) -> bool:
    return user.has("sales_web.manage") or user.has("sales_web.delete")


def user_can_manage_branch_sales(user: CurrentUser) -> bool:
    return user.has("sales_web.branch_manage") or user.has("sales_web.take") or user.has("sales_web.complete") or user.has("sales_web.send") or user.has("sales_web.cancel")


def user_can_access_sales_request(user: CurrentUser, data: dict[str, Any]) -> bool:
    if user_can_manage_all_sales(user):
        return True
    if user_can_manage_branch_sales(user) and user.sucursal and str(data.get("sucursal") or "").strip() == user.sucursal:
        return True
    return data.get("vendedor_id") == user.username


def load_request_or_404(request_id: int, user: CurrentUser) -> SalesWebRequestOut:
    with connect() as conn:
        row = conn.execute("SELECT * FROM sales_web_requests WHERE id = ?", (request_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        data = row_to_dict(row)
        if not user_can_access_sales_request(user, data):
            raise HTTPException(status_code=403, detail="No tenés permiso para ver esta solicitud")
        data["items"] = load_items(conn, request_id)
    return SalesWebRequestOut(**data)


def next_request_number(conn: sqlite3.Connection, year: int) -> str:
    rows = conn.execute("SELECT numero_solicitud FROM sales_web_requests WHERE numero_solicitud LIKE ?", (f"WEB-{year}-%",)).fetchall()
    max_num = 0
    for row in rows:
        text = str(row["numero_solicitud"] or "")
        match = re.fullmatch(rf"WEB-{year}-(\d+)", text)
        if match:
            try:
                max_num = max(max_num, int(match.group(1)))
            except ValueError:
                pass
    return f"WEB-{year}-{max_num + 1:04d}"


def admin_usernames(sucursal: str | None = None) -> list[str]:
    roles = load_roles()
    branch = str(sucursal or "").strip()
    result: list[str] = []
    for username, record in load_users().items():
        if not record.is_active:
            continue
        perms = roles.get(record.role, {}).get("permissions", [])
        perms = [str(p) for p in perms] if isinstance(perms, list) else []
        if has_permission(perms, "sales_web.manage"):
            result.append(username)
            continue
        if branch and has_permission(perms, "sales_web.branch_manage") and record.sucursal == branch:
            result.append(username)
    return result


def notify_admins(title: str, message: str, request_id: int | None, sucursal: str | None = None) -> None:
    notify_many(admin_usernames(sucursal), title, message, "sales_web", request_id)


def notify_seller(username: str, title: str, message: str, request_id: int | None) -> None:
    notify_many([username], title, message, "sales_web", request_id)


def calculate_request_total(items: list[SalesWebItemIn], costo_envio: Any) -> tuple[Decimal | None, bool]:
    total = Decimal("0")
    has_missing_price = False
    for item in items:
        unit = parse_decimal_ar(item.precio_unitario) if item.precio_unitario is not None else None
        if unit is None:
            has_missing_price = True
            continue
        total += unit * Decimal(str(item.cantidad))
    envio = parse_decimal_ar(costo_envio) if costo_envio is not None and str(costo_envio).strip() else Decimal("0")
    if envio is not None:
        total += envio
    if not items:
        return None, has_missing_price
    return total, has_missing_price


def calculate_senia_fields(data: SalesWebCreateRequest) -> tuple[str, str]:
    if data.pago_tipo != "Seña":
        return "", ""

    senia = parse_decimal_ar(data.senia_monto) if data.senia_monto is not None else None
    if senia is None or senia <= 0:
        raise HTTPException(status_code=400, detail="Si seleccionás Seña, cargá el monto de la seña.")

    total, has_missing_price = calculate_request_total(data.items, data.costo_envio)
    if total is None or has_missing_price:
        raise HTTPException(status_code=400, detail="No se puede calcular el resto: hay productos sin precio. Revisá los productos agregados.")

    restante = total - senia
    if restante < 0:
        raise HTTPException(status_code=400, detail="La seña no puede ser mayor al total de la solicitud.")

    return sheet_money(senia), sheet_money(restante)


def insert_items(conn: sqlite3.Connection, request_id: int, items: list[SalesWebItemIn]) -> None:
    for item in items:
        unit = parse_decimal_ar(item.precio_unitario) if item.precio_unitario is not None else None
        total = None
        if unit is not None:
            total = unit * Decimal(str(item.cantidad))
        condicion = condition_from_text(item.sku or "", item.producto, item.condicion or "")
        conn.execute(
            """
            INSERT INTO sales_web_items (request_id, sku, producto, marca, tipo, condicion, cantidad, precio_unitario, total_linea)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request_id,
                (item.sku or "").strip(),
                item.producto.strip(),
                (item.marca or "").strip(),
                (item.tipo or "").strip(),
                condicion,
                item.cantidad,
                sheet_money(unit) if unit is not None else "",
                sheet_money(total) if total is not None else "",
            ),
        )


def validate_system_open_for_user(user: CurrentUser) -> None:
    if user.has("system.manage"):
        return
    if not get_settings().app_enabled:
        raise HTTPException(status_code=403, detail="La aplicación está deshabilitada por el administrador.")


@router.get("/options", response_model=SalesWebOptions)
def options(_user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))]):
    try:
        sucursales = list(runtime_sales_config().get("sucursales") or [])
    except Exception:
        sucursales = []
    return SalesWebOptions(estados=STATUSES, pagos=PAYMENT_TYPES, entregas=DELIVERY_TYPES, sucursales=sucursales)


@router.get("/products", response_model=list[BudgetProduct])
def products(
    _user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))],
    q: str = Query(default="", min_length=0),
    limit: int = Query(default=20, ge=1, le=50),
):
    query = normalize_text(q)
    if len(query) < 2:
        return []
    tokens = query.split()
    matches: list[tuple[int, dict[str, Any]]] = []
    for item in load_product_catalog():
        haystack = item.get("search", "")
        if all(token in haystack for token in tokens):
            score = 0
            sku = normalize_text(item.get("sku", ""))
            producto = normalize_text(item.get("producto", ""))
            marca = normalize_text(item.get("marca", ""))
            if sku.startswith(query):
                score += 30
            if producto.startswith(query):
                score += 20
            if marca.startswith(query):
                score += 12
            if item.get("precio") is not None:
                score += 2
            matches.append((score, item))
    matches.sort(key=lambda pair: pair[0], reverse=True)
    return [BudgetProduct(**{k: v for k, v in item.items() if k != "search"}) for _, item in matches[:limit]]


@router.post("/requests", response_model=SalesWebRequestOut)
def create_request(data: SalesWebCreateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.create"))]):
    validate_system_open_for_user(user)
    if data.entrega_tipo == "Envío" and not str(data.costo_envio or "").strip():
        raise HTTPException(status_code=400, detail="Si seleccionás Envío, cargá el costo de envío o aclaralo en observaciones.")
    if not data.items:
        raise HTTPException(status_code=400, detail="Agregá al menos un producto para saber qué se lleva el cliente.")

    senia_monto, saldo_restante = calculate_senia_fields(data)

    now = utc_now()
    with REQUEST_LOCK, connect() as conn:
        numero = next_request_number(conn, now_ar().year)
        sucursal = (data.sucursal or user.sucursal or "").strip()
        canal = (data.canal or runtime_sales_config().get("default_channel") or "Venta").strip()
        cursor = conn.execute(
            """
            INSERT INTO sales_web_requests (
                numero_solicitud, estado, vendedor_id, vendedor_nombre, sucursal, canal,
                dni, apellido_nombre, telefono, correo_electronico, domicilio, codigo_postal,
                localidad, barrio, entre_calles, observaciones, pago_tipo, entrega_tipo,
                costo_envio, senia_monto, saldo_restante, created_at, updated_at
            ) VALUES (?, 'Pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                numero, user.username, user.display_name, sucursal, canal,
                data.dni.strip(), data.apellido_nombre.strip(), data.telefono.strip(), str(data.correo_electronico).strip(),
                data.domicilio.strip(), data.codigo_postal.strip(), data.localidad.strip(),
                (data.barrio or "").strip(), (data.entre_calles or "").strip(), (data.observaciones or "").strip(),
                data.pago_tipo, data.entrega_tipo, parse_money_ar_text(data.costo_envio), senia_monto, saldo_restante, now, now,
            ),
        )
        request_id = int(cursor.lastrowid)
        insert_items(conn, request_id, data.items)
        conn.commit()
        row = conn.execute("SELECT * FROM sales_web_requests WHERE id = ?", (request_id,)).fetchone()
        out_data = row_to_dict(row)
        out_data["items"] = load_items(conn, request_id)

    audit("sales_web.create", user=user, resource_type="sales_web_request", resource_id=numero, message="Nueva solicitud de venta", details={"cliente": data.apellido_nombre, "sucursal": sucursal, "items": len(data.items), "pago_tipo": data.pago_tipo, "senia_monto": senia_monto, "saldo_restante": saldo_restante})
    notify_admins("Nueva solicitud de venta pendiente", f"{numero} - {data.apellido_nombre}{f' · {sucursal}' if sucursal else ''}", request_id, sucursal)
    return SalesWebRequestOut(**out_data)


@router.get("/requests", response_model=list[SalesWebRequestOut])
def list_requests(
    user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))],
    estado: str | None = None,
    q: str | None = None,
    mine: bool = False,
    active_only: bool = False,
    sucursal: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    clauses = []
    params: list[Any] = []
    if estado:
        clauses.append("estado = ?")
        params.append(estado)
    elif active_only:
        clauses.append("estado <> ?")
        params.append("Cancelado")
    if q:
        clauses.append("(numero_solicitud LIKE ? OR dni LIKE ? OR apellido_nombre LIKE ? OR telefono LIKE ? OR vendedor_nombre LIKE ?)")
        needle = f"%{q.strip()}%"
        params.extend([needle, needle, needle, needle, needle])
    if sucursal:
        clauses.append("sucursal = ?")
        params.append(sucursal.strip())
    if mine:
        clauses.append("vendedor_id = ?")
        params.append(user.username)
    elif user_can_manage_all_sales(user):
        pass
    elif user_can_manage_branch_sales(user) and user.sucursal:
        clauses.append("sucursal = ?")
        params.append(user.sucursal)
    else:
        clauses.append("vendedor_id = ?")
        params.append(user.username)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM sales_web_requests{where} ORDER BY {STATUS_ORDER_SQL}, id DESC LIMIT ?", params).fetchall()
        result = []
        for row in rows:
            data = row_to_dict(row)
            data["items"] = load_items(conn, int(row["id"]))
            result.append(SalesWebRequestOut(**data))
    return result


@router.get("/requests/{request_id}", response_model=SalesWebRequestOut)
def get_request(request_id: int, user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))]):
    return load_request_or_404(request_id, user)


def update_request_status(request_id: int, user: CurrentUser, estado: str, fields: dict[str, Any], audit_action: str, notify: bool = True) -> SalesWebRequestOut:
    current = load_request_or_404(request_id, user)
    now = utc_now()
    sets = ["estado = ?", "updated_at = ?"]
    params: list[Any] = [estado, now]
    for key, value in fields.items():
        sets.append(f"{key} = ?")
        params.append(value)
    params.append(request_id)
    with connect() as conn:
        conn.execute(f"UPDATE sales_web_requests SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
    updated = load_request_or_404(request_id, user)
    audit(audit_action, user=user, resource_type="sales_web_request", resource_id=updated.numero_solicitud, message=f"Estado cambiado a {estado}", details={"estado_anterior": current.estado, "estado_nuevo": estado})
    if notify:
        if estado == "En proceso":
            notify_seller(updated.vendedor_id, "Solicitud tomada por administración", f"Tu solicitud {updated.numero_solicitud} está en proceso.", request_id)
        elif estado == "Completado":
            notify_seller(updated.vendedor_id, "Solicitud completada", f"Tu solicitud {updated.numero_solicitud} ya fue completada.", request_id)
        elif estado == "Enviado a venta web":
            notify_seller(updated.vendedor_id, "Solicitud enviada a venta", f"Ya tenés disponible la información de {updated.numero_solicitud}.", request_id)
        elif estado == "Cancelado":
            notify_seller(updated.vendedor_id, "Solicitud cancelada", f"La solicitud {updated.numero_solicitud} fue cancelada.", request_id)
    return updated


@router.post("/requests/{request_id}/take", response_model=SalesWebRequestOut)
def take_request(request_id: int, user: Annotated[CurrentUser, Depends(require_permission("sales_web.take"))]):
    return update_request_status(request_id, user, "En proceso", {"taken_at": utc_now(), "taken_by": user.display_name}, "sales_web.take", notify=True)


@router.post("/requests/{request_id}/complete", response_model=SalesWebRequestOut)
def complete_request(request_id: int, data: SalesWebUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.complete"))]):
    if not str(data.numero_remito_prefactura or "").strip():
        raise HTTPException(status_code=400, detail="Cargá el número real de remito/prefactura antes de completar.")
    return update_request_status(
        request_id,
        user,
        "Completado",
        {
            "numero_remito_prefactura": str(data.numero_remito_prefactura or "").strip(),
            "observacion_admin": str(data.observacion_admin or "").strip(),
            "completed_at": utc_now(),
            "completed_by": user.display_name,
        },
        "sales_web.complete",
    )


@router.post("/requests/{request_id}/send-to-sales", response_model=SalesWebRequestOut)
def send_to_sales(request_id: int, data: SalesWebUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.send"))]):
    fields = {"sent_to_sales_at": utc_now(), "sent_to_sales_by": user.display_name}
    if data.observacion_admin is not None:
        fields["observacion_admin"] = str(data.observacion_admin or "").strip()
    return update_request_status(request_id, user, "Enviado a venta web", fields, "sales_web.send")


@router.post("/requests/{request_id}/cancel", response_model=SalesWebRequestOut)
def cancel_request(request_id: int, data: SalesWebCancelRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))]):
    current = load_request_or_404(request_id, user)
    is_owner = current.vendedor_id == user.username
    can_cancel_any = user.has("sales_web.cancel")
    can_cancel_own = is_owner and user.has("sales_web.cancel_own")

    if not can_cancel_any and not can_cancel_own:
        raise HTTPException(status_code=403, detail="No tenés permiso para cancelar esta solicitud")

    if can_cancel_own and not can_cancel_any and current.estado not in {"Pendiente", "En proceso"}:
        raise HTTPException(status_code=400, detail="Solo podés cancelar tus solicitudes mientras estén pendientes o en proceso")

    reason = data.cancel_reason.strip() or ("Cancelada por el vendedor" if is_owner else "Cancelada")
    return update_request_status(
        request_id,
        user,
        "Cancelado",
        {"cancelled_at": utc_now(), "cancelled_by": user.display_name, "cancel_reason": reason},
        "sales_web.cancel_own" if can_cancel_own and not can_cancel_any else "sales_web.cancel",
    )


@router.delete("/requests/{request_id}")
def delete_request(request_id: int, user: Annotated[CurrentUser, Depends(require_permission("sales_web.delete"))]):
    current = load_request_or_404(request_id, user)
    with connect() as conn:
        conn.execute("DELETE FROM notifications WHERE sales_request_id = ?", (request_id,))
        conn.execute("DELETE FROM sales_web_items WHERE request_id = ?", (request_id,))
        conn.execute("DELETE FROM sales_web_requests WHERE id = ?", (request_id,))
        conn.commit()
    audit("sales_web.delete", user=user, resource_type="sales_web_request", resource_id=current.numero_solicitud, message="Solicitud de Venta eliminada definitivamente", details={"cliente": current.apellido_nombre, "estado": current.estado})
    return {"ok": True, "deleted": True, "numero_solicitud": current.numero_solicitud}


@router.patch("/requests/{request_id}", response_model=SalesWebRequestOut)
def update_request(request_id: int, data: SalesWebUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.manage"))]):
    fields: dict[str, Any] = {"updated_at": utc_now()}
    if data.numero_remito_prefactura is not None:
        fields["numero_remito_prefactura"] = data.numero_remito_prefactura.strip()
    if data.observacion_admin is not None:
        fields["observacion_admin"] = data.observacion_admin.strip()
    sets = [f"{key} = ?" for key in fields]
    params = list(fields.values()) + [request_id]
    with connect() as conn:
        exists = conn.execute("SELECT id FROM sales_web_requests WHERE id = ?", (request_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        conn.execute(f"UPDATE sales_web_requests SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
    updated = load_request_or_404(request_id, user)
    audit("sales_web.update", user=user, resource_type="sales_web_request", resource_id=updated.numero_solicitud, message="Solicitud actualizada")
    return updated
