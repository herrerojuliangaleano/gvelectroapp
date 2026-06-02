from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, or_, select

from . import (
    CHECKS_BY_TYPE,
    LOCK,
    CancelPayload,
    CheckPayload,
    CurrentUser,
    LookupProductOut,
    PriceCostUpdateCheckModel,
    PriceCostUpdateCreate,
    PriceCostUpdateHistoryModel,
    PriceCostUpdateHistoryOut,
    PriceCostUpdateModel,
    PriceCostUpdateOut,
    PriceCostUpdatePatch,
    _current_user_id,
    _dt,
    _get_update_or_404,
    _get_visible_update,
    _money_decimal_required,
    _user_public,
    apply_status,
    audit,
    db_session,
    default_checks,
    lookup_from_sheets,
    money_decimal_or_none,
    normalize_type,
    notify_users_with_permission,
    record_history,
    require_current_user,
    require_type_permission,
    row_to_update,
    sheet_money,
    utc_now_dt,
    visible_types,
)

router = APIRouter(prefix="/api/price-cost-updates", tags=["price-cost-updates"])

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
        raise HTTPException(status_code=403, detail="No tenes permiso para ver actualizaciones de precios o costos")

    requested_type = normalize_type(type) if type else ""
    if requested_type:
        if requested_type not in CHECKS_BY_TYPE:
            raise HTTPException(status_code=400, detail="Tipo invalido")
        if requested_type not in types:
            raise HTTPException(status_code=403, detail="No tenes permiso para ver este tipo de actualizacion")
        types = [requested_type]

    with db_session() as session:
        stmt = select(PriceCostUpdateModel).where(PriceCostUpdateModel.type.in_(types))
        if estado:
            stmt = stmt.where(PriceCostUpdateModel.estado == estado)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(
                PriceCostUpdateModel.producto.ilike(like),
                PriceCostUpdateModel.sku.ilike(like),
                PriceCostUpdateModel.marca.ilike(like),
            ))
        status_order = case(
            (PriceCostUpdateModel.estado == "Pendiente", 1),
            (PriceCostUpdateModel.estado == "En proceso", 2),
            (PriceCostUpdateModel.estado == "Completado", 3),
            (PriceCostUpdateModel.estado == "Cancelado", 4),
            else_=9,
        )
        rows = session.scalars(stmt.order_by(status_order, PriceCostUpdateModel.id.desc()).limit(limit)).all()
        return [PriceCostUpdateOut(**row_to_update(session, row)) for row in rows]
