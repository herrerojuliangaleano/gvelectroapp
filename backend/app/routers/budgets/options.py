from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from . import (
    BudgetCreateRequest,
    BudgetCreateResponse,
    BudgetCreatedLine,
    BudgetOptions,
    BudgetProduct,
    CurrentUser,
    HEADER_DETAIL,
    HEADER_MAIN,
    SEQUENCE_LOCK,
    append_values,
    audit,
    build_whatsapp_text,
    condition_from_text,
    decimal_to_float,
    ensure_headers,
    format_budget_id,
    get_settings,
    id_slug,
    load_product_catalog,
    next_budget_sequence,
    normalize_text,
    now_ar,
    parse_decimal_ar,
    require_permission,
    runtime_budget_config,
    runtime_warranty_config,
    search_local_products,
    set_by_alias,
    sheet_money,
    shipping_options,
    today_ar_string,
)

router = APIRouter()

@router.get("/options", response_model=BudgetOptions)
def budget_options(_user: Annotated[CurrentUser, Depends(require_permission("budgets.view"))]):
    warranty_cfg = runtime_warranty_config()
    budget_cfg = runtime_budget_config()
    return BudgetOptions(
        sucursales=list(warranty_cfg.get("sucursales") or []),
        shipping_options=shipping_options(),
        estado_default=str(budget_cfg.get("estado_default") or "PENDIENTE"),
    )
