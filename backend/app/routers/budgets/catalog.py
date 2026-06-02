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

@router.get("/products", response_model=list[BudgetProduct])
def budget_products(
    _user: Annotated[CurrentUser, Depends(require_permission("budgets.view"))],
    q: str = Query(default="", min_length=0),
    limit: int = Query(default=20, ge=1, le=50),
):
    query = normalize_text(q)
    if len(query) < 2:
        return []

    # Fase 7: primero se usa el catálogo local sincronizado desde Planilla Madre.
    local = search_local_products(q, limit=limit)
    if local:
        return [BudgetProduct(
            producto=str(item.get("producto") or item.get("descripcion") or item.get("sku") or ""),
            sku=item.get("sku"),
            marca=item.get("marca"),
            tipo=item.get("tipo"),
            condicion=item.get("condicion") or item.get("condicion_producto"),
            precio=item.get("precio") or item.get("pvp"),
            precio_texto=item.get("precio_texto") or item.get("pvp_text"),
            stock=None,
            label=item.get("label") or "",
        ) for item in local]

    # Fallback de compatibilidad: si todavía no sincronizaron productos, usa la lectura anterior desde Sheets.
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
            if haystack.startswith(query):
                score += 10
            if item.get("precio") is not None:
                score += 2
            matches.append((score, item))
    matches.sort(key=lambda pair: pair[0], reverse=True)
    return [BudgetProduct(**{k: v for k, v in item.items() if k != "search"}) for _, item in matches[:limit]]
