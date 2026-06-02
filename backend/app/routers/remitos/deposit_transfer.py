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

@router.post("/deposit-transfer/generate")
def generate_deposit_transfer_remito(
    data: DepositTransferRequest,
    user: Annotated[Any, Depends(require_current_user)],
):
    """Genera un remito interno depósito→depósito.

    Permite mover físicamente garantías desde un depósito asignado al usuario
    (o cualquier depósito si tiene `branches.cross_select` / permisos privilegiados)
    hacia otro depósito. Si el usuario tiene varios depósitos, debe pasar
    `origen_deposito` en el payload.
    """
    require_any_permission(user, "warranties.remitos.deposit_transfer")
    origen = resolve_deposit_name(user, requested=data.origen_deposito)
    destino = data.destino_deposito.strip()
    if not destino:
        raise HTTPException(400, "Seleccioná depósito destino.")
    if destino.lower() == origen.lower():
        raise HTTPException(400, "El depósito destino debe ser distinto del origen.")

    codes = [str(c).strip() for c in (data.warranty_codes or []) if str(c).strip()]
    if not codes:
        raise HTTPException(400, "Seleccioná al menos una garantía para mover.")

    actor = getattr(user, "username", "") or ""

    deposits = pg_deposit_branches()
    if not any(d["name"].strip().lower() == destino.lower() for d in deposits):
        raise HTTPException(400, "El depósito destino no existe o no está activo.")
    available_items = pg_available_warranties_for_deposit_transfer(origen=origen)
    available_by_code = {str(item["warranty_code"]): item for item in available_items}
    invalid = [code for code in codes if code not in available_by_code]
    if invalid:
        raise HTTPException(400, "Estas garantías no están disponibles en tu depósito: " + ", ".join(invalid))

    company_id = next((str(available_by_code[code].get("company_id") or "") for code in codes if available_by_code[code].get("company_id")), "")
    brand = pg_resolve_remito_brand(origen, company_id)
    code = pg_next_remito_code(brand)
    try:
        row_new = pg_create_remito(
            remito_code=code,
            tipo_remito="deposito_a_deposito",
            company_brand=brand,
            origen_sucursal=origen,
            destino_deposito=destino,
            warranty_codes=codes,
            nota=(data.nota or "").strip(),
            created_by_username=actor,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    pg_mark_warranties_in_transit(warranty_codes=codes, remito_code=code, updated_by_username=actor)
    _add_history_for_codes(
        codes,
        user,
        "deposit_transfer_generated",
        note=f"Movimiento interno {code}: {origen} -> {destino}",
        details={"remito": code, "origen": origen, "destino": destino},
    )
    w_data = pg_load_warranties_for_codes(codes)

    audit("warranties.remitos.deposit_transfer", user=user, resource_type="warranty_remito", resource_id=code,
          details={"origen": origen, "destino": destino, "cantidad": len(codes)})
    return {"ok": True, "created": [row_to_remito(row_new, w_data)]}


# ── Entrega al proveedor (deposito_a_proveedor) ───────────────────────────────
