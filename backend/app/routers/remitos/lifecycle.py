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

@router.get("/{remito_code}")
def get_remito(
    remito_code: str,
    _user:       Annotated[Any, Depends(require_permission("warranties.remitos.view"))],
):
    row = pg_get_remito_by_code(remito_code)
    if not row:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")
    ids = _remito_ids(row)
    w_data = pg_load_warranties_for_codes(ids)
    return row_to_remito(row, w_data)

@router.get("/{remito_code}/pdf")
def download_remito_pdf(
    remito_code: str,
    _user:       Annotated[Any, Depends(require_current_user)],
):
    """Genera y descarga el PDF del remito.

    Seguimiento global requiere warranties.remitos.view, pero el operador de
    depósito con permiso deposit_transfer también puede descargar el PDF de sus
    movimientos internos.
    """
    require_any_permission(_user, "warranties.remitos.view", "warranties.remitos.deposit_transfer", "warranties.remitos.generate", "warranties.remitos.receive")
    row = pg_get_remito_by_code(remito_code)
    if not row:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")
    ids = _remito_ids(row)
    warranties_data = pg_load_warranties_for_codes(ids)
    remito_dict = row_to_remito(row, warranties_data)
    # Revalidar marca para el PDF usando la sucursal/branch de origen.
    # Esto corrige remitos viejos que hayan quedado con company_brand legacy.
    remito_dict["company_brand"] = pg_resolve_remito_brand(remito_dict.get("origen_sucursal", ""), "")

    if remito_dict.get("tipo_remito") == "deposito_a_proveedor":
        pdf_bytes = generate_provider_delivery_pdf(remito_dict, warranties_data)
    else:
        pdf_bytes = generate_remito_pdf(remito_dict, warranties_data)
    filename  = f"{remito_code}.pdf"
    audit("warranties.remito.pdf", user=_user, resource_type="warranty_remito", resource_id=remito_code)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.post("/{remito_code}/dispatch")
def dispatch_remito(
    remito_code: str,
    data:        DispatchRemitoRequest,
    user:        Annotated[Any, Depends(require_permission("warranties.remitos.dispatch"))],
):
    """Marca el remito como despachado (productos en tránsito)."""
    actor    = getattr(user, "username", "") or ""

    row = pg_get_remito_by_code(remito_code)
    if not row:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")
    if str(row["status"]) not in ("pendiente",):
        raise HTTPException(400, f"El remito ya fue despachado (estado: {row['status']}).")

    ids = _remito_ids(row)
    suc_origen = (data.lugar_salida or "").strip() or str(row["origen_sucursal"] or "")
    tipo_rem = str(row["tipo_remito"] or "sucursal_a_deposito") if "tipo_remito" in row.keys() else "sucursal_a_deposito"
    updated = pg_dispatch_remito(remito_code=remito_code, despachado_por_username=actor, nota=(data.nota or "").strip())
    if not updated:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")
    if tipo_rem == "deposito_a_proveedor":
        pg_mark_warranties_provider_delivery(warranty_codes=ids, remito_code=remito_code, updated_by_username=actor, lugar_salida=suc_origen)
    else:
        pg_mark_warranties_in_transit(warranty_codes=ids, remito_code=remito_code, updated_by_username=actor, lugar_salida=suc_origen)
    _add_history_for_codes(
        ids,
        user,
        "remito_dispatch",
        note=f"Remito {remito_code} despachado desde {suc_origen}",
        details={"remito": remito_code},
    )

    # Notificar al Gestor de Garantías sobre movimientos en tránsito
    destino_disp = str(row["destino_deposito"] or "")
    if tipo_rem in ("sucursal_a_deposito", "deposito_a_deposito"):
        _notify_gestor_garantias(
            "🚚 Remito en tránsito",
            f"Remito {remito_code} ({len(ids)} garantía(s)) salió desde {suc_origen} hacia {destino_disp}.",
        )
    elif tipo_rem == "deposito_a_proveedor":
        _notify_gestor_garantias(
            "🏭 Entrega al proveedor en camino",
            f"Remito {remito_code} ({len(ids)} garantía(s)) despachado hacia {destino_disp}.",
        )

    audit("warranties.remito.dispatch", user=user, resource_type="warranty_remito", resource_id=remito_code)
    return {"ok": True, "remito_code": remito_code, "status": "en_transito"}

@router.post("/{remito_code}/confirm-arrival")
def confirm_arrival(
    remito_code: str,
    data:        ConfirmArrivalRequest,
    user:        Annotated[Any, Depends(require_permission("warranties.remitos.receive"))],
):
    """Confirma que los productos del remito llegaron al depósito.

    Se mantiene la ruta histórica por compatibilidad, pero la lógica real vive
    en _confirm_arrival_update.
    """
    row = pg_get_remito_by_code(remito_code)
    if not row:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")
    result = _confirm_arrival_update(row, data, user)

    audit("warranties.remito.arrival", user=user, resource_type="warranty_remito", resource_id=remito_code,
          details={"destino": result["destino"]})
    return result

@router.post("/batch-pickup")
def confirm_batch_pickup(
    data: BatchPickupRequest,
    user: Annotated[Any, Depends(require_permission("warranties.remitos.generate"))],
):
    """Endpoint legado deshabilitado en Fase 4.

    El retiro/respuesta del proveedor pertenece al flujo ENV/proveedor, no al
    flujo de remitos internos. Se mantiene la ruta para evitar 404 en clientes
    viejos, pero no genera REM ni modifica logística interna.
    """
    raise HTTPException(
        400,
        "El retiro del proveedor se gestionará en el flujo ENV/proveedor. Remitos internos solo mueve sucursal → depósito.",
    )

@router.delete("/{remito_code}")
def delete_remito(
    remito_code: str,
    user:        Annotated[Any, Depends(require_permission("warranties.remitos.delete"))],
):
    """
    Elimina un remito interno.
    Si el remito estaba PENDIENTE, limpia también el campo remito_interno en las garantías.
    Si ya fue despachado o llegó, igual se elimina pero queda el historial en las garantías.
    """
    actor    = getattr(user, "username", "") or ""
    row = pg_get_remito_by_code(remito_code)
    if not row:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")

    status = str(row["status"] or "pendiente")
    ids = _remito_ids(row)
    unlinked = 0
    if status in ("pendiente", "en_transito") and ids:
        unlinked = pg_unlink_warranties_from_remito(warranty_codes=ids, remito_code=remito_code, updated_by_username=actor)
    pg_delete_remito(remito_code)

    audit("warranties.remito.delete", user=user, resource_type="warranty_remito",
          resource_id=remito_code,
          details={"status_at_delete": status, "warranties_unlinked": unlinked})
    return {"ok": True, "deleted": remito_code, "warranties_unlinked": unlinked}
