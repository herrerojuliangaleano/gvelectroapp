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

@router.get("/by-code/{remito_code}")
def get_remito_by_code(
    remito_code: str,
    _user:       Annotated[Any, Depends(require_permission("warranties.remitos.view"))],
):
    """Lookup estático para seguimiento por código REM."""
    code = remito_code.strip().upper()
    row = pg_get_remito_by_code(code)
    if not row:
        raise HTTPException(404, f"Remito {code} no encontrado.")
    ids = _remito_ids(row)
    w_data = pg_load_warranties_for_codes(ids)
    return row_to_remito(row, w_data)
