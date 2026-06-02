from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ...access import assigned_deposit_names, can_cross_branch, require_any_permission, resolve_deposit_name, user_has

from . import (
    BatchPickupRequest,
    ConfirmArrivalRequest,
    DepositTransferRequest,
    DispatchRemitoRequest,
    GenerateRemitosRequest,
    ProviderDeliveryRequest,
    _add_history_for_codes,
    _confirm_arrival_update,
    _notify_gestor_garantias,
    _remito_ids,
    audit,
    generate_provider_delivery_pdf,
    generate_remito_pdf,
    pg_available_warranties_for_deposit_transfer,
    pg_available_warranties_for_provider_delivery,
    pg_available_warranties_for_remito,
    pg_confirm_warranties_remito_arrival,
    pg_create_remito,
    pg_delete_remito,
    pg_deposit_branches,
    pg_dispatch_remito,
    pg_get_remito_by_code,
    pg_list_remitos,
    pg_load_warranties_for_codes,
    pg_mark_warranties_in_transit,
    pg_mark_warranties_provider_delivery,
    pg_next_provider_delivery_code,
    pg_next_remito_code,
    pg_resolve_remito_brand,
    pg_unlink_warranties_from_remito,
    pg_warranty_central_deposit_name,
    require_current_user,
    require_permission,
    row_to_remito,
)

router = APIRouter()

@router.get("/")
def list_remitos(
    user:            Annotated[Any, Depends(require_current_user)],
    shipment_code:   str = "",
    remito_code:     str = "",
    status:          str = "",
    brand:           str = "",
    origen_sucursal: str = "",
    limit:           int = Query(default=100, ge=1, le=500),
):
    """Lista remitos internos.

    Regla de scope:
      - warranties.remitos.view  → ve TODOS los remitos (gestores/posventa global)
      - cualquier otro permiso   → ve solo los remitos de su propia sucursal
                                   (origen_sucursal coincide con branch_name del usuario)
    Sin ninguno de estos permisos → 403.
    """
    require_any_permission(
        user,
        "warranties.remitos.view",
        "warranties.remitos.generate",
        "warranties.remitos.dispatch",
        "warranties.remitos.receive",
        "warranties.remitos.delete",
        "warranties.remitos.deposit_transfer",
        "warranties.remitos.provider_delivery",
    )

    # Scope: usuarios sin 'view' global solo ven sus propios remitos.
    user_is_global = user_has(user, "warranties.remitos.view")
    # Usar branch_name primero; si está vacío (usuario sin branch_id asignado)
    # caer a user.sucursal (campo legacy que también guarda el nombre de la sucursal).
    user_branch = (
        (getattr(user, "branch_name", None) or "") or
        (getattr(user, "sucursal",    None) or "")
    ).strip()
    # Los operadores de depósito ven remitos DESTINADOS a su depósito (destino_deposito).
    # Los operadores de sucursal ven remitos que su sucursal GENERÓ (origen_sucursal).
    user_is_deposit_receiver = not user_is_global and (
        user_has(user, "warranties.remitos.receive") or
        user_has(user, "warranties.remitos.deposit_transfer")
    )

    scope_origen = ""
    scope_destino = ""
    if not user_is_global and user_branch:
        if user_is_deposit_receiver:
            scope_destino = user_branch
        else:
            scope_origen = user_branch
    if origen_sucursal:
        scope_origen = origen_sucursal
    st = status.strip().lower().replace(" ", "_").replace("á", "a") if status else ""
    rows = pg_list_remitos(
        status=st or None,
        origen=scope_origen or None,
        destino=scope_destino or None,
        shipment_code=shipment_code or None,
        remito_code_like=remito_code or None,
        company_brand=brand or None,
        limit=limit,
    )
    all_items = []
    for r in rows:
        ids = _remito_ids(r)
        w_data = pg_load_warranties_for_codes(ids)
        all_items.append(row_to_remito(r, w_data))
    return {"items": all_items, "total": len(all_items)}
