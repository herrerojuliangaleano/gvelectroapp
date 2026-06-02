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

def _apply_status_fields(req: SalesWebRequest, session: Session, user: CurrentUser, fields: dict[str, Any]) -> None:
    actor_user_id = _user_id(session, user.username)
    for key, value in fields.items():
        if key == "taken_by":
            req.taken_by_user_id = actor_user_id
        elif key == "completed_by":
            req.completed_by_user_id = actor_user_id
        elif key == "sent_to_sales_by":
            req.sent_to_sales_by_user_id = actor_user_id
        elif key == "cancelled_by":
            req.cancelled_by_user_id = actor_user_id
        elif key in {"taken_at", "completed_at", "sent_to_sales_at", "cancelled_at"}:
            setattr(req, key, value if isinstance(value, datetime) else utc_now_dt())
        elif hasattr(req, key):
            setattr(req, key, value)

def update_request_status(request_id: int, user: CurrentUser, estado: str, fields: dict[str, Any], audit_action: str, notify: bool = True) -> SalesWebRequestOut:
    current = load_request_or_404(request_id, user)
    with db_session() as session:
        req = session.scalar(_request_query(request_id))
        if req is None:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        data = request_to_dict(req, session)
        if not user_can_access_sales_request(user, data):
            raise HTTPException(status_code=403, detail="No tenés permiso para ver esta solicitud")
        req.estado = estado
        req.updated_at = utc_now_dt()
        _apply_status_fields(req, session, user, fields)
        session.commit()
        updated_data = request_to_dict(req, session)
    updated = SalesWebRequestOut(**updated_data)
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
    return update_request_status(request_id, user, "En proceso", {"taken_at": utc_now_dt(), "taken_by": user.display_name}, "sales_web.take", notify=True)

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
            "completed_at": utc_now_dt(),
            "completed_by": user.display_name,
        },
        "sales_web.complete",
    )

@router.post("/requests/{request_id}/send-to-sales", response_model=SalesWebRequestOut)
def send_to_sales(request_id: int, data: SalesWebUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.send"))]):
    fields = {"sent_to_sales_at": utc_now_dt(), "sent_to_sales_by": user.display_name}
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
        {"cancelled_at": utc_now_dt(), "cancelled_by": user.display_name, "cancel_reason": reason},
        "sales_web.cancel_own" if can_cancel_own and not can_cancel_any else "sales_web.cancel",
    )

@router.delete("/requests/{request_id}")
def delete_request(request_id: int, user: Annotated[CurrentUser, Depends(require_permission("sales_web.delete"))]):
    current = load_request_or_404(request_id, user)
    with db_session() as session:
        req = session.scalar(_request_query(request_id))
        if req is None:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        session.execute(delete(Notification).where(Notification.sales_request_id == request_id))
        session.delete(req)
        session.commit()
    audit("sales_web.delete", user=user, resource_type="sales_web_request", resource_id=current.numero_solicitud, message="Solicitud de Venta eliminada definitivamente", details={"cliente": current.apellido_nombre, "estado": current.estado})
    return {"ok": True, "deleted": True, "numero_solicitud": current.numero_solicitud}

@router.patch("/requests/{request_id}", response_model=SalesWebRequestOut)
def update_request(request_id: int, data: SalesWebUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("sales_web.manage"))]):
    with db_session() as session:
        req = session.scalar(_request_query(request_id))
        if req is None:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        if data.numero_remito_prefactura is not None:
            req.numero_remito_prefactura = data.numero_remito_prefactura.strip()
        if data.observacion_admin is not None:
            req.observacion_admin = data.observacion_admin.strip()
        req.updated_at = utc_now_dt()
        session.commit()
        updated_data = request_to_dict(req, session)
    updated = SalesWebRequestOut(**updated_data)
    audit("sales_web.update", user=user, resource_type="sales_web_request", resource_id=updated.numero_solicitud, message="Solicitud actualizada")
    return updated
