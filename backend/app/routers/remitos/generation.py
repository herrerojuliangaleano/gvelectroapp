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

@router.post("/generate")
def generate_remitos(
    data: GenerateRemitosRequest,
    user: Annotated[Any, Depends(require_permission("warranties.remitos.generate"))],
):
    """Genera remitos internos de transporte físico sucursal → depósito.

    Fase 4: se elimina la generación desde shipment_code/ENV. El lote de proveedor
    es administrativo y se maneja en el flujo de exportación/proveedor, no acá.
    """
    if (data.shipment_code or "").strip():
        raise HTTPException(
            400,
            "Los remitos internos no se generan desde ENV. Seleccioná garantías físicas disponibles por sucursal.",
        )

    actor    = getattr(user, "username", "") or ""
    created: list[dict[str, Any]] = []
    skipped: list[str] = []
    central_destination = pg_warranty_central_deposit_name()

    selected_codes = [str(c).strip() for c in (data.warranty_codes or []) if str(c).strip()]
    available_items = pg_available_warranties_for_remito(sucursal=(data.sucursal or "").strip())
    if selected_codes:
        selected = set(selected_codes)
        available_items = [item for item in available_items if str(item["warranty_code"]) in selected]
        available_codes = {str(item["warranty_code"]) for item in available_items}
        missing = [code for code in selected_codes if code not in available_codes]
        if missing:
            raise HTTPException(
                400,
                "Algunas garantías no están disponibles para remito interno: " + ", ".join(missing),
            )
    if not available_items:
        raise HTTPException(400, "No hay garantías disponibles para remito interno con esos filtros.")

    explicit_suc = (data.sucursal or "").strip()
    groups: dict[str, dict[str, Any]] = {}
    for item in available_items:
        suc = explicit_suc or str(item.get("sucursal") or "Sin sucursal")
        group = groups.setdefault(suc, {"codes": [], "company_id": str(item.get("company_id") or "")})
        group["codes"].append(str(item["warranty_code"]))
        if not group.get("company_id") and item.get("company_id"):
            group["company_id"] = str(item.get("company_id") or "")

    nota_val = (data.nota or "").strip()
    for sucursal, group in groups.items():
        codes = list(group["codes"])
        brand = pg_resolve_remito_brand(sucursal, str(group.get("company_id") or ""))
        code = pg_next_remito_code(brand)
        try:
            row_new = pg_create_remito(
                remito_code=code,
                tipo_remito="sucursal_a_deposito",
                company_brand=brand,
                origen_sucursal=sucursal,
                destino_deposito=central_destination,
                warranty_codes=codes,
                nota=nota_val,
                created_by_username=actor,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        pg_mark_warranties_in_transit(warranty_codes=codes, remito_code=code, updated_by_username=actor)
        _add_history_for_codes(
            codes,
            user,
            "remito_generated",
            note=f"Remito {code} generado hacia {central_destination}",
            details={"remito": code, "destino": central_destination},
        )
        w_data = pg_load_warranties_for_codes(codes)
        created.append(row_to_remito(row_new, w_data))

    audit("warranties.remitos.generate", user=user, resource_type="warranty_remito",
          details={
              "modo":          "traslado_interno",
              "shipment_code": "",
              "sucursal":      data.sucursal or "(selección manual/todas)",
              "destino":       central_destination,
              "created":       len(created),
              "skipped":       len(skipped),
          })
    return {"ok": True, "created": created, "skipped_existing": skipped}
