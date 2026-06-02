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

@router.get("/provider-delivery/available-warranties")
def available_warranties_for_provider_delivery(
    user: Annotated[Any, Depends(require_current_user)],
):
    """Garantías listas para entregar al proveedor (estado_retiro_proveedor = listo_para_retiro)."""
    require_any_permission(user, "warranties.remitos.provider_delivery")
    items = pg_available_warranties_for_provider_delivery()
    return {"items": items, "total": len(items)}

@router.post("/provider-delivery/generate")
def generate_provider_delivery_remito(
    data: ProviderDeliveryRequest,
    user: Annotated[Any, Depends(require_current_user)],
):
    """Genera un remito de entrega al proveedor (depósito → proveedor)."""
    require_any_permission(user, "warranties.remitos.provider_delivery")

    codes = [str(c).strip() for c in (data.warranty_codes or []) if str(c).strip()]
    if not codes:
        raise HTTPException(400, "Seleccioná al menos una garantía para incluir.")
    proveedor = data.proveedor.strip()
    if not proveedor:
        raise HTTPException(400, "Indicá el nombre del proveedor.")

    actor    = getattr(user, "username", "") or ""
    available_items = pg_available_warranties_for_provider_delivery()
    available_by_code = {str(item["warranty_code"]): item for item in available_items}
    invalid = [code for code in codes if code not in available_by_code]
    if invalid:
        raise HTTPException(400, "Estas garantías no están listas para retiro del proveedor: " + ", ".join(invalid))

    company_id = next((str(available_by_code[code].get("company_id") or "") for code in codes if available_by_code[code].get("company_id")), "")
    origen_deposito = next((str(available_by_code[code].get("deposito") or "") for code in codes if available_by_code[code].get("deposito")), "Depósito Central")
    brand = pg_resolve_remito_brand(origen_deposito, company_id)
    rem_code = pg_next_provider_delivery_code()
    try:
        row_new = pg_create_remito(
            remito_code=rem_code,
            tipo_remito="deposito_a_proveedor",
            company_brand=brand,
            origen_sucursal=origen_deposito,
            destino_deposito=proveedor,
            warranty_codes=codes,
            proveedor=proveedor,
            nota=(data.nota or "").strip(),
            created_by_username=actor,
            status="llegado",  # El remito a proveedor representa la entrega física; queda cerrado al crearse.
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    # Marca garantías como "en el proveedor" (retiradas) con fecha = ahora.
    pg_mark_warranties_provider_delivery(warranty_codes=codes, remito_code=rem_code, updated_by_username=actor)
    _add_history_for_codes(
        codes,
        user,
        "provider_pickup_completed",
        note=f"Entregada al proveedor {proveedor} (remito {rem_code})",
        details={"remito": rem_code, "proveedor": proveedor, "origen": origen_deposito},
    )
    w_data = pg_load_warranties_for_codes(codes)
    # Releer para devolver el dict actualizado (status, codes, etc.).
    row_fresh = pg_get_remito_by_code(rem_code) or row_new

    audit("warranties.remitos.provider_delivery", user=user, resource_type="warranty_remito", resource_id=rem_code,
          details={"proveedor": proveedor, "origen": origen_deposito, "cantidad": len(codes)})
    remito_payload = row_to_remito(row_fresh, w_data)
    return {
        "ok": True,
        "created": [remito_payload],
        "remito_code": rem_code,
        "pdf_url": f"/api/warranties/remitos/{rem_code}/pdf",
    }
