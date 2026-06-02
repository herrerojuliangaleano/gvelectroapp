from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from . import (
    BudgetProduct,
    CurrentUser,
    DELIVERY_TYPES,
    Notification,
    PAYMENT_TYPES,
    REQUEST_LOCK,
    STATUSES,
    SalesWebCancelRequest,
    SalesWebCreateRequest,
    SalesWebOptions,
    SalesWebRequest,
    SalesWebRequestOut,
    SalesWebUpdateRequest,
    assigned_branches,
    _request_query,
    _resolve_branch_id,
    _status_order_expression,
    _user_id,
    audit,
    build_items,
    calculate_senia_fields,
    db_session,
    load_product_catalog,
    load_request_or_404,
    money_out,
    next_request_number,
    normalize_text,
    notify_admins,
    notify_seller,
    now_ar,
    parse_optional_money,
    request_to_dict,
    require_permission,
    runtime_sales_config,
    user_can_access_sales_request,
    user_can_manage_all_sales,
    user_can_manage_branch_sales,
    utc_now_dt,
    validate_system_open_for_user,
)

router = APIRouter()

@router.post("/requests", response_model=SalesWebRequestOut)
def create_request(data: SalesWebCreateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.create"))]):
    validate_system_open_for_user(user)
    if data.entrega_tipo == "Envío" and not str(data.costo_envio or "").strip():
        raise HTTPException(status_code=400, detail="Si seleccionás Envío, cargá el costo de envío o aclaralo en observaciones.")
    if not data.items:
        raise HTTPException(status_code=400, detail="Agregá al menos un producto para saber qué se lleva el cliente.")

    costo_envio = parse_optional_money(data.costo_envio, "El costo de envío") if str(data.costo_envio or "").strip() else None
    senia_monto, saldo_restante = calculate_senia_fields(data)

    now = utc_now_dt()
    with REQUEST_LOCK, db_session() as session:
        numero = next_request_number(session, now_ar().year)
        sucursal = (data.sucursal or user.sucursal or "").strip()
        canal = (data.canal or runtime_sales_config().get("default_channel") or "Venta").strip()
        request = SalesWebRequest(
            numero_solicitud=numero,
            estado="Pendiente",
            vendedor_user_id=_user_id(session, user.username),
            vendedor_nombre=user.display_name,
            branch_id=_resolve_branch_id(session, sucursal, user),
            sucursal=sucursal,
            canal=canal,
            dni=data.dni.strip(),
            apellido_nombre=data.apellido_nombre.strip(),
            telefono=data.telefono.strip(),
            correo_electronico=str(data.correo_electronico).strip(),
            domicilio=data.domicilio.strip(),
            codigo_postal=data.codigo_postal.strip(),
            localidad=data.localidad.strip(),
            barrio=(data.barrio or "").strip(),
            entre_calles=(data.entre_calles or "").strip(),
            observaciones=(data.observaciones or "").strip(),
            pago_tipo=data.pago_tipo,
            entrega_tipo=data.entrega_tipo,
            costo_envio=costo_envio,
            senia_monto=senia_monto,
            saldo_restante=saldo_restante,
            created_at=now,
            updated_at=now,
            items=build_items(data.items),
        )
        session.add(request)
        session.commit()
        out_data = request_to_dict(request, session)

    audit(
        "sales_web.create",
        user=user,
        resource_type="sales_web_request",
        resource_id=numero,
        message="Nueva solicitud de venta",
        details={
            "cliente": data.apellido_nombre,
            "sucursal": sucursal,
            "items": len(data.items),
            "pago_tipo": data.pago_tipo,
            "senia_monto": money_out(senia_monto),
            "saldo_restante": money_out(saldo_restante),
        },
    )
    notify_admins(
        "Nueva solicitud de venta pendiente",
        f"{numero} - {data.apellido_nombre}{f' · {sucursal}' if sucursal else ''}",
        int(out_data["id"]),
        sucursal,
        str(out_data.get("branch_id") or "") or None,
    )
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
    with db_session() as session:
        stmt = select(SalesWebRequest).options(selectinload(SalesWebRequest.items))
        if estado:
            stmt = stmt.where(SalesWebRequest.estado == estado)
        elif active_only:
            stmt = stmt.where(SalesWebRequest.estado != "Cancelado")
        if q:
            needle = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    SalesWebRequest.numero_solicitud.ilike(needle),
                    SalesWebRequest.dni.ilike(needle),
                    SalesWebRequest.apellido_nombre.ilike(needle),
                    SalesWebRequest.telefono.ilike(needle),
                    SalesWebRequest.vendedor_nombre.ilike(needle),
                )
            )
        if sucursal:
            stmt = stmt.where(SalesWebRequest.sucursal == sucursal.strip())
        if mine:
            user_id = _user_id(session, user.username)
            stmt = stmt.where(SalesWebRequest.vendedor_user_id == user_id)
        elif user_can_manage_all_sales(user):
            pass
        elif user_can_manage_branch_sales(user):
            branches = assigned_branches(user)
            branch_ids = [str(b.get("id") or "") for b in branches if str(b.get("id") or "").strip()]
            branch_names = [str(b.get("name") or "") for b in branches if str(b.get("name") or "").strip()]
            if user.sucursal and user.sucursal not in branch_names:
                branch_names.append(user.sucursal)
            filters = []
            if branch_ids:
                filters.append(SalesWebRequest.branch_id.in_(branch_ids))
            if branch_names:
                filters.append(SalesWebRequest.sucursal.in_(branch_names))
            if filters:
                stmt = stmt.where(or_(*filters))
            else:
                user_id = _user_id(session, user.username)
                stmt = stmt.where(SalesWebRequest.vendedor_user_id == user_id)
        else:
            user_id = _user_id(session, user.username)
            stmt = stmt.where(SalesWebRequest.vendedor_user_id == user_id)
        stmt = stmt.order_by(_status_order_expression(), SalesWebRequest.id.desc()).limit(limit)
        rows = session.scalars(stmt).all()
        return [SalesWebRequestOut(**request_to_dict(row, session)) for row in rows]

@router.get("/requests/{request_id}", response_model=SalesWebRequestOut)
def get_request(request_id: int, user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))]):
    return load_request_or_404(request_id, user)
