from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, delete, or_, select
from sqlalchemy.orm import Session, selectinload

from ...access import assigned_branches, user_has, user_matches_branch, users_with_permission
from ...audit import audit
from ...auth import require_permission
from ...config import get_settings
from ...db import db_session
from ...models.auth import User
from ...models.org import Branch
from ...models.sales_web import SalesWebItem, SalesWebRequest
from ...models.system import Notification
from ...operational_config import runtime_sales_config
from ...users import CurrentUser
from ..budgets import (
    BudgetProduct,
    condition_from_text,
    load_product_catalog,
    normalize_text,
    parse_decimal_ar,
    sheet_money,
)
from ..notifications import notify_many

router = APIRouter(prefix="/api/sales-web", tags=["sales-web"])

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
REQUEST_LOCK = threading.RLock()

STATUSES = ["Pendiente", "En proceso", "Completado", "Enviado a venta web", "Cancelado"]
ACTIVE_STATUSES = ["Pendiente", "En proceso", "Completado"]
PAYMENT_TYPES = ["Pago completo", "Seña"]
DELIVERY_TYPES = ["Retira en local", "Envío"]


def _status_order_expression():
    return case(
        (SalesWebRequest.estado == "Pendiente", 1),
        (SalesWebRequest.estado == "En proceso", 2),
        (SalesWebRequest.estado == "Completado", 3),
        (SalesWebRequest.estado == "Enviado a venta web", 4),
        (SalesWebRequest.estado == "Cancelado", 5),
        else_=9,
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def now_ar() -> datetime:
    return datetime.now(AR_TZ)


def format_datetime_ar(value: datetime | str | None) -> str:
    if not value:
        return ""
    try:
        if isinstance(value, datetime):
            dt = value
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(AR_TZ).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(value)


def iso_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def parse_optional_money(value: Any, field_label: str) -> Decimal | None:
    if value is None or not str(value).strip():
        return None
    dec = parse_decimal_ar(value)
    if dec is None:
        raise HTTPException(status_code=400, detail=f"{field_label} debe ser un importe numérico.")
    return dec


def money_out(value: Any) -> str:
    if value is None:
        return ""
    dec = parse_decimal_ar(value)
    return sheet_money(dec) if dec is not None else str(value or "")


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
    items: list[SalesWebItemOut] = Field(default_factory=list)


class SalesWebOptions(BaseModel):
    estados: list[str]
    pagos: list[str]
    entregas: list[str]
    sucursales: list[str]


def _user_id(session: Session, username: str | None) -> int | None:
    uname = str(username or "").strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(User.username == uname))


def _username_for_id(session: Session, user_id: int | None) -> str:
    if user_id is None:
        return ""
    user = session.get(User, user_id)
    return str(user.username) if user else ""


def _display_name_for_id(session: Session, user_id: int | None) -> str:
    if user_id is None:
        return ""
    user = session.get(User, user_id)
    return str(user.display_name or user.username) if user else ""


def _resolve_branch_id(session: Session, sucursal: str, user: CurrentUser) -> str | None:
    key = str(sucursal or "").strip()
    if not key:
        return None
    if user.branch_id and (key == user.sucursal or key == user.branch_name or key == user.branch_code):
        return user.branch_id
    normalized = normalize_text(key)
    for branch in session.scalars(select(Branch)).all():
        candidates = [branch.id, branch.name, branch.code]
        if any(normalize_text(candidate) == normalized for candidate in candidates):
            return str(branch.id)
    return None


def _request_query(request_id: int):
    return (
        select(SalesWebRequest)
        .options(selectinload(SalesWebRequest.items))
        .where(SalesWebRequest.id == request_id)
    )


def item_to_out(item: SalesWebItem) -> SalesWebItemOut:
    return SalesWebItemOut(
        id=int(item.id) if item.id is not None else None,
        sku=item.sku or "",
        producto=item.producto,
        marca=item.marca or "",
        tipo=item.tipo or "",
        condicion=item.condicion or "",
        cantidad=int(item.cantidad or 1),
        precio_unitario=money_out(item.precio_unitario),
        total_linea=money_out(item.total_linea),
    )


def request_to_dict(req: SalesWebRequest, session: Session) -> dict[str, Any]:
    vendedor_id = _username_for_id(session, req.vendedor_user_id)
    created_at = iso_datetime(req.created_at) or ""
    updated_at = iso_datetime(req.updated_at) or ""
    return {
        "id": int(req.id),
        "numero_solicitud": req.numero_solicitud,
        "numero_remito_prefactura": req.numero_remito_prefactura or "",
        "estado": req.estado,
        "vendedor_id": vendedor_id,
        "vendedor_nombre": req.vendedor_nombre or _display_name_for_id(session, req.vendedor_user_id),
        "branch_id": req.branch_id or "",
        "sucursal": req.sucursal or "",
        "canal": req.canal or "",
        "dni": req.dni,
        "apellido_nombre": req.apellido_nombre,
        "telefono": req.telefono,
        "correo_electronico": req.correo_electronico,
        "domicilio": req.domicilio,
        "codigo_postal": req.codigo_postal,
        "localidad": req.localidad,
        "barrio": req.barrio or "",
        "entre_calles": req.entre_calles or "",
        "observaciones": req.observaciones or "",
        "pago_tipo": req.pago_tipo,
        "entrega_tipo": req.entrega_tipo,
        "costo_envio": money_out(req.costo_envio),
        "senia_monto": money_out(req.senia_monto),
        "saldo_restante": money_out(req.saldo_restante),
        "observacion_admin": req.observacion_admin or "",
        "created_at": created_at,
        "updated_at": updated_at,
        "created_at_text": format_datetime_ar(req.created_at),
        "updated_at_text": format_datetime_ar(req.updated_at),
        "taken_at": iso_datetime(req.taken_at),
        "taken_by": _display_name_for_id(session, req.taken_by_user_id) or None,
        "completed_at": iso_datetime(req.completed_at),
        "completed_by": _display_name_for_id(session, req.completed_by_user_id) or None,
        "sent_to_sales_at": iso_datetime(req.sent_to_sales_at),
        "sent_to_sales_by": _display_name_for_id(session, req.sent_to_sales_by_user_id) or None,
        "cancelled_at": iso_datetime(req.cancelled_at),
        "cancelled_by": _display_name_for_id(session, req.cancelled_by_user_id) or None,
        "cancel_reason": req.cancel_reason or "",
        "items": [item_to_out(item) for item in sorted(req.items, key=lambda x: int(x.id or 0))],
    }


def user_can_manage_all_sales(user: CurrentUser) -> bool:
    return user_has(user, "sales_web.manage") or user_has(user, "sales_web.delete")


def user_can_manage_branch_sales(user: CurrentUser) -> bool:
    return user_has(user, "sales_web.branch_manage") or user_has(user, "sales_web.take") or user_has(user, "sales_web.complete") or user_has(user, "sales_web.send") or user_has(user, "sales_web.cancel")


def user_can_access_sales_request(user: CurrentUser, data: dict[str, Any]) -> bool:
    if user_can_manage_all_sales(user):
        return True
    if user_can_manage_branch_sales(user) and user_matches_branch(
        user,
        branch_id=str(data.get("branch_id") or "").strip() or None,
        branch_name=str(data.get("sucursal") or "").strip() or None,
    ):
        return True
    return data.get("vendedor_id") == user.username


def load_request_or_404(request_id: int, user: CurrentUser) -> SalesWebRequestOut:
    with db_session() as session:
        req = session.scalar(_request_query(request_id))
        if req is None:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        data = request_to_dict(req, session)
        if not user_can_access_sales_request(user, data):
            raise HTTPException(status_code=403, detail="No tenés permiso para ver esta solicitud")
        return SalesWebRequestOut(**data)


def next_request_number(session: Session, year: int) -> str:
    rows = session.execute(
        select(SalesWebRequest.numero_solicitud)
        .where(SalesWebRequest.numero_solicitud.like(f"WEB-{year}-%"))
    ).all()
    max_num = 0
    for (numero_solicitud,) in rows:
        text = str(numero_solicitud or "")
        match = re.fullmatch(rf"WEB-{year}-(\d+)", text)
        if match:
            try:
                max_num = max(max_num, int(match.group(1)))
            except ValueError:
                pass
    return f"WEB-{year}-{max_num + 1:04d}"


def admin_usernames(sucursal: str | None = None, branch_id: str | None = None) -> list[str]:
    result = users_with_permission("sales_web.manage")
    branch_managers = users_with_permission("sales_web.branch_manage", branch_id=branch_id, branch_name=sucursal)
    for username in branch_managers:
        if username not in result:
            result.append(username)
    return result


def notify_admins(title: str, message: str, request_id: int | None, sucursal: str | None = None, branch_id: str | None = None) -> None:
    notify_many(admin_usernames(sucursal, branch_id), title, message, "sales_web", request_id)


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


def calculate_senia_fields(data: SalesWebCreateRequest) -> tuple[Decimal | None, Decimal | None]:
    if data.pago_tipo != "Seña":
        return None, None

    senia = parse_decimal_ar(data.senia_monto) if data.senia_monto is not None else None
    if senia is None or senia <= 0:
        raise HTTPException(status_code=400, detail="Si seleccionás Seña, cargá el monto de la seña.")

    total, has_missing_price = calculate_request_total(data.items, data.costo_envio)
    if total is None or has_missing_price:
        raise HTTPException(status_code=400, detail="No se puede calcular el resto: hay productos sin precio. Revisá los productos agregados.")

    restante = total - senia
    if restante < 0:
        raise HTTPException(status_code=400, detail="La seña no puede ser mayor al total de la solicitud.")

    return senia, restante


def build_items(items: list[SalesWebItemIn]) -> list[SalesWebItem]:
    out: list[SalesWebItem] = []
    for item in items:
        unit = parse_decimal_ar(item.precio_unitario) if item.precio_unitario is not None else None
        total = unit * Decimal(str(item.cantidad)) if unit is not None else None
        condicion = condition_from_text(item.sku or "", item.producto, item.condicion or "")
        out.append(
            SalesWebItem(
                sku=(item.sku or "").strip(),
                producto=item.producto.strip(),
                marca=(item.marca or "").strip(),
                tipo=(item.tipo or "").strip(),
                condicion=condicion,
                cantidad=item.cantidad,
                precio_unitario=unit,
                total_linea=total,
            )
        )
    return out


def validate_system_open_for_user(user: CurrentUser) -> None:
    if user_has(user, "system.manage"):
        return
    if not get_settings().app_enabled:
        raise HTTPException(status_code=403, detail="La aplicación está deshabilitada por el administrador.")

# Sub-routers (Fase 3.B.3)
# ERP futuro debe entrar como submodulo propio sin mezclar catalogo/request/lifecycle.
from . import options as _options_module  # noqa: E402
from . import catalog as _catalog_module  # noqa: E402
from . import requests as _requests_module  # noqa: E402
from . import lifecycle as _lifecycle_module  # noqa: E402

router.include_router(_options_module.router)
router.include_router(_catalog_module.router)
router.include_router(_requests_module.router)
router.include_router(_lifecycle_module.router)
