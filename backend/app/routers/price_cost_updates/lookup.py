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

@router.get("/lookup-product", response_model=LookupProductOut)
def lookup_product(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    sku: str = Query(default=""),
    type: str = Query(default="price"),
):
    change_type = normalize_type(type)
    require_type_permission(user, change_type, "create")
    return lookup_from_sheets(sku, change_type)
