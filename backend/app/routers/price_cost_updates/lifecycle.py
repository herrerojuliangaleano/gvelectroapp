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
    require_check_permission,
    require_current_user,
    require_type_permission,
    row_to_update,
    sheet_money,
    utc_now_dt,
    visible_types,
)

router = APIRouter(prefix="/api/price-cost-updates", tags=["price-cost-updates"])

@router.get("/{update_id}", response_model=PriceCostUpdateOut)
def get_update(update_id: int, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with db_session() as session:
        row = _get_visible_update(session, update_id, user)
        return PriceCostUpdateOut(**row_to_update(session, row, user=user))

@router.patch("/{update_id}", response_model=PriceCostUpdateOut)
def patch_update(update_id: int, data: PriceCostUpdatePatch, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with LOCK, db_session() as session:
        row = _get_update_or_404(session, update_id)
        change_type = str(row.type)
        require_type_permission(user, change_type, "edit")
        if str(row.estado) == "Cancelado":
            raise HTTPException(status_code=400, detail="No se puede editar una actualizacion cancelada")

        detail: dict[str, Any] = {}
        for key in ["producto", "sku", "marca", "valor_anterior", "valor_nuevo"]:
            value = getattr(data, key)
            if value is None:
                continue
            if key == "valor_anterior":
                clean = money_decimal_or_none(value) if str(value).strip() else None
                if clean is None and str(value).strip():
                    raise HTTPException(status_code=400, detail="Ingresa un valor anterior valido.")
                setattr(row, key, clean)
                detail[key] = sheet_money(clean) if clean is not None else ""
            elif key == "valor_nuevo":
                clean = _money_decimal_required(value, "valor nuevo")
                setattr(row, key, clean)
                detail[key] = sheet_money(clean)
            else:
                clean_text = str(value).strip()
                setattr(row, key, clean_text)
                detail[key] = clean_text
        if detail:
            row.updated_at = utc_now_dt()
            record_history(session, update_id, user, "editado", detail)
            session.flush()
        result = PriceCostUpdateOut(**row_to_update(session, row, user=user))
        session.commit()
    audit("price_cost_update.updated", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Actualizacion editada", details=detail)
    return result

@router.post("/{update_id}/check", response_model=PriceCostUpdateOut)
def set_check(update_id: int, data: CheckPayload, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with LOCK, db_session() as session:
        row = _get_update_or_404(session, update_id)
        change_type = str(row.type)
        if str(row.estado) == "Cancelado":
            raise HTTPException(status_code=400, detail="No se puede marcar una actualizacion cancelada")
        allowed = {key for key, _label in default_checks(change_type)}
        if data.check_key not in allowed:
            raise HTTPException(status_code=400, detail="Check invalido para este tipo de actualizacion")
        require_check_permission(user, change_type, data.check_key)
        check = session.scalar(
            select(PriceCostUpdateCheckModel).where(
                PriceCostUpdateCheckModel.update_id == update_id,
                PriceCostUpdateCheckModel.check_key == data.check_key,
            )
        )
        if check is None:
            raise HTTPException(status_code=404, detail="Check no encontrado")
        now = utc_now_dt()
        if data.checked:
            check.checked = True
            check.checked_by_user_id = _current_user_id(session, user)
            check.checked_at = now
        else:
            check.checked = False
            check.checked_by_user_id = None
            check.checked_at = None
        estado = apply_status(session, row)
        record_history(session, update_id, user, "check_marcado" if data.checked else "check_desmarcado", {"check_key": data.check_key, "estado": estado})
        session.flush()
        result = PriceCostUpdateOut(**row_to_update(session, row, user=user))
        session.commit()
    audit("price_cost_update.check", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Checklist actualizado", details={"check_key": data.check_key, "checked": data.checked, "estado": result.estado})
    return result

@router.post("/{update_id}/cancel", response_model=PriceCostUpdateOut)
def cancel_update(update_id: int, data: CancelPayload, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with LOCK, db_session() as session:
        row = _get_update_or_404(session, update_id)
        change_type = str(row.type)
        require_type_permission(user, change_type, "delete")
        now = utc_now_dt()
        row.estado = "Cancelado"
        row.cancelled_at = now
        row.cancelled_by_user_id = _current_user_id(session, user)
        row.cancel_reason = data.cancel_reason or ""
        row.updated_at = now
        record_history(session, update_id, user, "cancelado", {"cancel_reason": data.cancel_reason or ""})
        session.flush()
        result = PriceCostUpdateOut(**row_to_update(session, row, user=user))
        session.commit()
    audit("price_cost_update.cancelled", user=user, resource_type="price_cost_update", resource_id=str(update_id), message="Actualizacion cancelada", details={"reason": data.cancel_reason or ""})
    return result
