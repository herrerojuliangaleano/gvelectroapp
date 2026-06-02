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

@router.get("/available-warranties")
def available_warranties_for_remito(
    _user:    Annotated[Any, Depends(require_permission("warranties.remitos.generate"))],
    sucursal: str = "",
):
    """Devuelve garantías disponibles para REM interno sucursal → depósito.

    La regla de disponibilidad está centralizada en la capa Postgres.
    No depende de review_status ni de shipment_code/ENV: el remito es físico.
    """
    items = pg_available_warranties_for_remito(sucursal=sucursal)
    return {"items": items, "total": len(items)}

@router.get("/deposit-transfer/options")
def deposit_transfer_options(
    user: Annotated[Any, Depends(require_current_user)],
):
    """Opciones para operadores de depósito.

    Devuelve:
      - origen_deposito: el depósito sugerido por default (sucursal principal si es
        depósito, o el único asignado si tiene uno solo; vacío si tiene varios).
      - origenes_posibles: lista de depósitos a los que el usuario puede acceder
        (sus branches asignadas con type='deposit', o todos si tiene
        branches.cross_select / permisos privilegiados).
      - destinos: depósitos donde puede mover, excluyendo el origen actual si hay
        uno único.
    """
    require_any_permission(user, "warranties.remitos.deposit_transfer")
    all_deposits = pg_deposit_branches()
    assigned_names = [n.lower() for n in assigned_deposit_names(user)]
    can_cross = can_cross_branch(user)
    if can_cross:
        origenes_posibles = list(all_deposits)
    else:
        origenes_posibles = [d for d in all_deposits if d["name"].strip().lower() in assigned_names]
    try:
        origen_default = resolve_deposit_name(user)
    except HTTPException:
        origen_default = origenes_posibles[0]["name"] if len(origenes_posibles) == 1 else ""
    destinos = [d for d in all_deposits if d["name"].strip().lower() != origen_default.strip().lower()]
    return {
        "origen_deposito": origen_default,
        "origenes_posibles": origenes_posibles,
        "destinos": destinos,
    }

@router.get("/deposit-transfer/available-warranties")
def available_warranties_for_deposit_transfer(
    user: Annotated[Any, Depends(require_current_user)],
    origen: str = "",
):
    """Garantías físicamente en el depósito del usuario y libres para mover.

    No requiere permiso de seguimiento: está pensado para empleados de depósito
    que solo hacen recepción y movimientos internos. Si el usuario tiene acceso a
    múltiples depósitos, puede pasar `?origen=...` para filtrar; el helper valida
    que tenga acceso.
    """
    require_any_permission(user, "warranties.remitos.deposit_transfer")
    origen = resolve_deposit_name(user, requested=origen or None)
    items = pg_available_warranties_for_deposit_transfer(origen=origen)
    return {"items": items, "total": len(items), "origen_deposito": origen}
