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

@router.post("", response_model=PriceCostUpdateOut)
def create_update(data: PriceCostUpdateCreate, user: Annotated[CurrentUser, Depends(require_current_user)]):
    change_type = normalize_type(data.type)
    require_type_permission(user, change_type, "create")
    lookup = lookup_from_sheets(data.sku, change_type)
    valor_anterior_source = lookup.valor_anterior or data.valor_anterior
    valor_anterior = money_decimal_or_none(valor_anterior_source)
    valor_nuevo = _money_decimal_required(data.valor_nuevo, "valor nuevo")
    producto = (data.producto or lookup.producto or data.sku).strip()
    marca = (data.marca or lookup.marca or "").strip()
    warning = lookup.warning or None
    now = utc_now_dt()

    with LOCK, db_session() as session:
        row = PriceCostUpdateModel(
            type=change_type,
            producto=producto,
            sku=(lookup.sku or data.sku).strip(),
            marca=marca,
            valor_anterior=valor_anterior,
            valor_nuevo=valor_nuevo,
            estado="Pendiente",
            lookup_warning=warning,
            created_by_user_id=_current_user_id(session, user),
            created_at=now,
            updated_at=now,
            source=lookup.source,
            auto_created=False,
        )
        session.add(row)
        session.flush()
        update_id = int(row.id)
        for key, label in default_checks(change_type):
            session.add(PriceCostUpdateCheckModel(update_id=update_id, check_key=key, label=label, checked=False))
        record_history(session, update_id, user, "creado", {
            "type": change_type,
            "sku": data.sku,
            "valor_anterior": sheet_money(valor_anterior) if valor_anterior is not None else "",
            "valor_nuevo": sheet_money(valor_nuevo),
        })
        session.flush()
        result = PriceCostUpdateOut(**row_to_update(session, row))
        session.commit()

    audit("price_cost_update.created", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Actualizacion urgente creada", details={"type": change_type, "sku": result.sku})
    label = "precio" if change_type == "price" else "costo"
    notify_users_with_permission(f"{change_type}_updates.view", f"Actualizacion urgente de {label}", f"{result.sku} - {result.producto}: nuevo {label} {result.valor_nuevo}")
    return result
