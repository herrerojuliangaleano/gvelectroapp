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
