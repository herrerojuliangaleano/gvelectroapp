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

@router.get("/options", response_model=SalesWebOptions)
def options(_user: Annotated[CurrentUser, Depends(require_permission("sales_web.view"))]):
    try:
        sucursales = list(runtime_sales_config().get("sucursales") or [])
    except Exception:
        sucursales = []
    return SalesWebOptions(estados=STATUSES, pagos=PAYMENT_TYPES, entregas=DELIVERY_TYPES, sucursales=sucursales)
