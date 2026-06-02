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

@router.get("/{update_id}/history", response_model=list[PriceCostUpdateHistoryOut])
def get_history(update_id: int, user: Annotated[CurrentUser, Depends(require_current_user)]):
    with db_session() as session:
        _get_visible_update(session, update_id, user)
        rows = session.scalars(
            select(PriceCostUpdateHistoryModel)
            .where(PriceCostUpdateHistoryModel.update_id == update_id)
            .order_by(PriceCostUpdateHistoryModel.id.desc())
        ).all()
        out: list[PriceCostUpdateHistoryOut] = []
        for row in rows:
            detail = row.detail or {}
            if isinstance(detail, str):
                try:
                    detail = json.loads(detail)
                except Exception:
                    detail = {}
            username, display_name = _user_public(session, row.user_id, fallback_system=(row.action == "auto_creado"))
            out.append(PriceCostUpdateHistoryOut(
                id=int(row.id),
                update_id=int(row.update_id),
                created_at=_dt(row.created_at),
                username=username or "",
                display_name=display_name or "",
                action=str(row.action),
                detail=detail if isinstance(detail, dict) else {},
            ))
        return out
