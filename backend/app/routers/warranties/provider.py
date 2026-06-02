"""Sub-router del flujo proveedor de garantias.

Endpoints:
  POST /{warranty_id}/confirm-shipment
  POST /{warranty_id}/send-provider
  POST /{warranty_id}/provider-pickup-request
  POST /{warranty_id}/provider-response
  POST /{warranty_id}/provider-correction-resolve
  POST /{warranty_id}/resend-provider-mail
  POST /{warranty_id}/claim
  POST /{warranty_id}/status
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from ...audit import audit
from ...auth import require_permission
from ...warranties_db import (
    pg_clear_item_correction_notes,
    pg_fetch_guarantee_with_items,
    pg_update_guarantee_fields,
    pg_update_item_fields,
)
from ...warranty_helpers import utc_now_iso
from . import (
    PROVIDER_RESPONSE_TYPES,
    RESOLUTION_OPTIONS,
    ConfirmShipmentRequest,
    ProviderPickupRequest,
    WarrantyClaimRequest,
    WarrantyDetailResponse,
    WarrantyProviderCorrectionResolveRequest,
    WarrantyProviderResponseRequest,
    WarrantyProviderSendRequest,
    WarrantyResendMailRequest,
    WarrantyStatusChangeRequest,
    _notify_gestor_garantias_pickup,
    assert_internal_logistics_ready_for_provider,
    assert_provider_has_physical_product,
    canonical_status_key,
    deny_plain_deposit_operator,
    internal_logistics_ready_for_provider,
    is_resolved_status,
    normalize_provider_response_type,
    normalize_resolution_result,
    provider_flow_started,
    validate_status_or_400,
)


router = APIRouter(tags=["warranties"])


def get_warranty_detail(warranty_id: str, user: Any) -> WarrantyDetailResponse:
    # Import tardio: lifecycle sigue en __init__.py hasta la ultima extraccion.
    from . import get_warranty_detail as _get_warranty_detail

    return _get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/confirm-shipment", response_model=WarrantyDetailResponse)
def confirm_warranty_shipment(warranty_id: str, data: ConfirmShipmentRequest, user: Annotated[Any, Depends(require_permission("warranties.manage_provider"))]):
    deny_plain_deposit_operator(user, "confirmar ENV/mail al proveedor")
    """Confirma que el lote fue enviado al proveedor. Valida el código ENV y pasa a ENVIADO AL PROVEEDOR."""
    code_input = data.shipment_code.strip().upper()
    provider = (data.provider_name or "").strip()
    nota = (data.nota or "").strip()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    # ENV/mail es un aviso administrativo al proveedor: puede confirmarse
    # aunque el producto todavía esté viajando a Chiclana. La entrega física
    # se controla más adelante con solicitud/retiro proveedor.
    stored_code = str(row.get("shipment_code") or "").strip().upper()
    if not stored_code:
        raise HTTPException(status_code=400, detail="Esta garantía no tiene un lote de exportación asignado.")
    if code_input != stored_code:
        raise HTTPException(status_code=400, detail=f"El código ingresado no coincide con el lote asignado ({stored_code}).")
    old_status = str(row.get("status") or "")
    new_status = "4 - ENVIADO AL PROVEEDOR"
    now = utc_now_iso()
    updates: dict[str, Any] = {
        "status": new_status,
        "sent_to_provider_at": str(row.get("sent_to_provider_at") or "") or now,
        "fecha_ultimo_mail_proveedor": now,
        "synced_to_google_sheet": 0,
    }
    if provider:
        updates["provider_name"] = provider
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="shipment_confirmed",
        old_status=old_status,
        new_status=new_status,
        note=nota or f"Envío al proveedor confirmado. Lote: {stored_code}",
        details={"shipment_code": stored_code, "provider_name": provider},
    )
    audit("warranties.shipment.confirmed", user=user, resource_type="warranty", resource_id=warranty_id, details={"shipment_code": stored_code})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/send-provider", response_model=WarrantyDetailResponse)
def send_warranty_to_provider(warranty_id: str, data: WarrantyProviderSendRequest, user: Annotated[Any, Depends(require_permission("warranties.manage_provider"))]):
    deny_plain_deposit_operator(user, "enviar garantías al proveedor")
    provider = data.provider_name.strip()
    case_id = (data.provider_case_id or "").strip()
    note = (data.note or "").strip()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    assert_internal_logistics_ready_for_provider(row)
    old_status = str(row.get("status") or "")
    new_status = "4 - ENVIADO AL PROVEEDOR"
    now = utc_now_iso()
    updates = {
        "provider_name": provider,
        "provider_case_id": case_id,
        "sent_to_provider_at": str(row.get("sent_to_provider_at") or "") or now,
        "status": new_status,
    }
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="provider_sent",
        old_status=old_status,
        new_status=new_status,
        note=note or f"Enviada al proveedor {provider}",
        details={"provider_name": provider, "provider_case_id": case_id},
    )
    audit("warranties.provider.sent", user=user, resource_type="warranty", resource_id=warranty_id, details={"provider_name": provider, "provider_case_id": case_id})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/provider-pickup-request", response_model=WarrantyDetailResponse)
def register_provider_pickup_request(warranty_id: str, data: ProviderPickupRequest, user: Annotated[Any, Depends(require_permission("warranties.register_provider_response"))]):
    deny_plain_deposit_operator(user, "registrar retiro solicitado por proveedor")
    """Registra que el proveedor aceptó/solicitó retiro.

    No mueve físicamente la garantía ni cambia a EN EL PROVEEDOR.
    Si todavía no está en Chiclana, queda como retiro_solicitado para disparar urgencia logística.
    Si ya está en depósito, queda listo_para_retiro.
    """
    note = (data.note or "").strip()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    if not provider_flow_started(row):
        raise HTTPException(status_code=400, detail="Primero confirmá el envío del ENV/mail al proveedor.")
    status_key = canonical_status_key(str(row.get("status") or ""))
    if status_key in {"RESUELTO", "RECHAZADO", "ANULADA", "FINALIZADO"}:
        raise HTTPException(status_code=400, detail="La garantía ya está cerrada o resuelta; no corresponde solicitar retiro.")
    old_status = str(row.get("status") or "")
    now = utc_now_iso()
    pickup_status = "listo_para_retiro" if internal_logistics_ready_for_provider(row) else "retiro_solicitado"
    updates: dict[str, Any] = {
        "estado_retiro_proveedor": pickup_status,
        "fecha_solicitud_retiro_proveedor": now,
        "last_provider_response_at": now,
        "nota_retiro_proveedor": note,
    }
    if data.provider_case_id is not None and data.provider_case_id.strip():
        updates["provider_case_id"] = data.provider_case_id.strip()
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="provider_pickup_requested",
        old_status=old_status,
        new_status=old_status,
        note=note or ("Proveedor solicitó retiro. Producto listo en Chiclana." if pickup_status == "listo_para_retiro" else "Proveedor solicitó retiro. Traer urgente a Depósito Chiclana."),
        details={"pickup_status": pickup_status, "fecha_retiro_acordada": data.fecha_retiro_acordada or ""},
    )

    # Alerta al Gestor de Garantías cuando el producto aún NO está en el depósito
    if pickup_status == "retiro_solicitado":
        _notify_gestor_garantias_pickup(
            "⚠️ Retiro urgente pendiente",
            f"El proveedor solicitó retiro de la garantía {warranty_id} pero el producto no está en depósito. Coordinar traslado urgente.",
        )

    audit("warranties.provider.pickup_requested", user=user, resource_type="warranty", resource_id=warranty_id, details={"pickup_status": pickup_status})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/provider-response", response_model=WarrantyDetailResponse)
def register_provider_response(warranty_id: str, data: WarrantyProviderResponseRequest, user: Annotated[Any, Depends(require_permission("warranties.register_provider_response"))]):
    deny_plain_deposit_operator(user, "registrar respuestas del proveedor")
    note = (data.note or "").strip()
    case_id = (data.provider_case_id or "").strip()
    requested_status = (data.estado or "").strip()
    response_type = normalize_provider_response_type(data.response_type)
    correction_note = (data.correction_note or "").strip()
    # Correcciones por ítem/serie: {id_item: nota} (solo notas no vacías).
    item_corrections = {
        int(c.row_number): c.note.strip()
        for c in (data.item_corrections or [])
        if c.note and c.note.strip()
    }
    if data.response_type and not response_type:
        raise HTTPException(status_code=400, detail="Tipo de respuesta inválido. Usá: retiro, revisión o corrección.")
    if response_type == "correccion" and not correction_note and not item_corrections:
        raise HTTPException(status_code=400, detail="Indicá qué pidió corregir el proveedor (en general o por ítem).")
    now = utc_now_iso()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    if not provider_flow_started(row):
        raise HTTPException(status_code=400, detail="Todavía no se confirmó el envío al proveedor. Primero confirmá el lote ENV/mail enviado.")
    old_status = str(row.get("status") or "")
    new_status = validate_status_or_400(requested_status) if requested_status else "6 - RESPONDIDO POR PROVEEDOR"
    target_key = canonical_status_key(new_status)
    if target_key in {"EN EL PROVEEDOR", "RESUELTO"}:
        assert_provider_has_physical_product(row)
    updates = {
        "last_provider_response_at": now,
        "status": new_status,
    }
    if case_id:
        updates["provider_case_id"] = case_id
    if is_resolved_status(new_status) and not row.get("fecha_resolucion"):
        updates["fecha_resolucion"] = now

    # Tipo de respuesta del proveedor (dimensión paralela al estado).
    pickup_status = ""
    correction_summary = ""
    if response_type:
        updates["provider_response_type"] = response_type
        if response_type == "correccion":
            # El proveedor pide corregir datos. Queda marcado para posventa;
            # se limpia cuando se aplica la corrección y se reenvía.
            # Persistimos la corrección por ítem y armamos un resumen a nivel garantía.
            items_by_id = {int(it["id"]): it for it in _items}
            summary_parts: list[str] = []
            for item_id, item_note in item_corrections.items():
                it = items_by_id.get(item_id)
                if it is None:
                    continue
                pg_update_item_fields(guarantee_id=int(row["id"]), item_id=item_id, updates={"correction_note": item_note})
                producto = str(it.get("producto") or "").strip()
                serie = str(it.get("serie") or "").strip()
                label = producto + (f" ({serie})" if serie else "")
                summary_parts.append(f"{label}: {item_note}" if label else item_note)
            correction_summary = correction_note or "; ".join(summary_parts)
            updates["provider_correction_note"] = correction_summary
            updates["provider_correction_resolved_at"] = ""
        else:
            # retiro / revision dejan sin efecto cualquier corrección anterior.
            updates["provider_correction_note"] = ""
            if response_type == "retiro":
                # Reusa la lógica de retiro: si el equipo ya está en depósito queda
                # listo para retiro; si no, dispara la urgencia logística.
                pickup_status = "listo_para_retiro" if internal_logistics_ready_for_provider(row) else "retiro_solicitado"
                updates["estado_retiro_proveedor"] = pickup_status
                updates["fecha_solicitud_retiro_proveedor"] = now
                # Fecha acordada con el proveedor (si el operador la informó).
                fecha_acordada = (data.fecha_retiro_acordada or "").strip()
                if fecha_acordada:
                    updates["fecha_retiro_proveedor"] = fecha_acordada
                if note:
                    updates["nota_retiro_proveedor"] = note

    history_note = note or "Respuesta del proveedor registrada"
    if response_type:
        history_note = f"{history_note} | {PROVIDER_RESPONSE_TYPES[response_type]}"
        if response_type == "correccion" and correction_summary:
            history_note = f"{history_note}: {correction_summary}"

    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="provider_response",
        old_status=old_status,
        new_status=new_status,
        note=history_note,
        details={
            "provider_case_id": case_id,
            "last_provider_response_at": now,
            "response_type": response_type,
            "pickup_status": pickup_status,
        },
    )

    # Si el proveedor pidió retiro y el equipo NO está en depósito, avisar a logística.
    if pickup_status == "retiro_solicitado":
        _notify_gestor_garantias_pickup(
            "⚠️ Retiro urgente pendiente",
            f"El proveedor solicitó retiro de la garantía {warranty_id} pero el producto no está en depósito. Coordinar traslado urgente.",
        )

    audit("warranties.provider.response", user=user, resource_type="warranty", resource_id=warranty_id, details={"status": new_status, "response_type": response_type})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/provider-correction-resolve", response_model=WarrantyDetailResponse)
def resolve_provider_correction(warranty_id: str, data: WarrantyProviderCorrectionResolveRequest, user: Annotated[Any, Depends(require_permission("warranties.register_provider_response"))]):
    deny_plain_deposit_operator(user, "resolver correcciones del proveedor")
    """Cierra una corrección pedida por el proveedor.

    Posventa ya corrigió los datos (vía edición de la garantía) y reenvía la
    información al proveedor. Limpia la marca de corrección, reinicia el contador
    de días sin respuesta y vuelve el estado a "Enviado · esperando respuesta".
    """
    note = (data.note or "").strip()
    now = utc_now_iso()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    current_type = normalize_provider_response_type(row.get("provider_response_type") or "")
    if current_type != "correccion":
        raise HTTPException(status_code=400, detail="Esta garantía no tiene una corrección pendiente del proveedor.")
    old_status = str(row.get("status") or "")
    new_status = "4 - ENVIADO AL PROVEEDOR"
    # Limpiar las marcas de corrección por ítem.
    pg_clear_item_correction_notes(guarantee_id=int(row["id"]))
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates={
            "provider_response_type": "",
            "provider_correction_note": "",
            "provider_correction_resolved_at": now,
            "fecha_ultimo_mail_proveedor": now,
            "last_claim_at": now,
            "status": new_status,
        },
        action="provider_correction_resolved",
        old_status=old_status,
        new_status=new_status,
        note=note or "Corrección aplicada y reenviada al proveedor",
        details={"provider_correction_resolved_at": now},
    )
    audit("warranties.provider.correction_resolved", user=user, resource_type="warranty", resource_id=warranty_id, details={"note": note})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/resend-provider-mail", response_model=WarrantyDetailResponse)
def resend_provider_mail(warranty_id: str, data: WarrantyResendMailRequest, user: Annotated[Any, Depends(require_permission("warranties.register_claim"))]):
    deny_plain_deposit_operator(user, "reenviar mails/reclamos al proveedor")
    """Registra mail/reclamo reenviado al proveedor y reinicia el contador de días sin respuesta."""
    note = (data.note or "").strip() or "Mail vuelto a enviar al proveedor"
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    if not provider_flow_started(row):
        raise HTTPException(status_code=400, detail="Todavía no se confirmó el envío al proveedor. No corresponde reenviar mail.")
    status_key = canonical_status_key(str(row.get("status") or ""))
    if status_key in {"RESUELTO", "RECHAZADO", "ANULADA", "FINALIZADO"}:
        raise HTTPException(status_code=400, detail="La garantía ya está cerrada o resuelta; no corresponde reenviar mail.")
    now = utc_now_iso()
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates={
            "fecha_ultimo_mail_proveedor": now,
            "last_claim_at": now,
        },
        action="provider_mail_resent",
        old_status=str(row.get("status") or ""),
        new_status=str(row.get("status") or ""),
        note=note,
        details={"fecha_ultimo_mail_proveedor": now},
    )
    audit("warranties.provider.mail_resent", user=user, resource_type="warranty", resource_id=warranty_id, details={"note": note})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/claim", response_model=WarrantyDetailResponse)
def register_warranty_claim(warranty_id: str, data: WarrantyClaimRequest, user: Annotated[Any, Depends(require_permission("warranties.register_claim"))]):
    deny_plain_deposit_operator(user, "registrar reclamos al proveedor")
    note = data.note.strip()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    if not provider_flow_started(row):
        raise HTTPException(status_code=400, detail="Todavía no se confirmó el envío al proveedor. No corresponde registrar reclamos.")
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates={"last_claim_at": utc_now_iso()},
        action="provider_claim",
        old_status=str(row.get("status") or ""),
        new_status=str(row.get("status") or ""),
        note=note,
        details={"last_claim_at": utc_now_iso()},
    )
    audit("warranties.provider.claim", user=user, resource_type="warranty", resource_id=warranty_id, details={"note": note})
    return get_warranty_detail(warranty_id, user)


@router.post("/{warranty_id}/status", response_model=WarrantyDetailResponse)
def change_warranty_status(warranty_id: str, data: WarrantyStatusChangeRequest, user: Annotated[Any, Depends(require_permission("warranties.change_status"))]):
    deny_plain_deposit_operator(user, "cambiar estados operativos")
    new_status = validate_status_or_400(data.estado)
    note = (data.note or "").strip()
    resultado = normalize_resolution_result(data.resultado_resolucion)

    is_resuelto = "RESUELTO" in canonical_status_key(new_status)
    is_finalizado = "FINALIZADO" in canonical_status_key(new_status)

    if is_resuelto:
        if not resultado:
            raise HTTPException(status_code=400, detail="Indicá cómo se resolvió la garantía: nota de crédito, reparación o cambio de equipo.")
        if resultado not in RESOLUTION_OPTIONS:
            raise HTTPException(status_code=400, detail=f"Resultado de resolución inválido: {resultado}")

    def clean(value: str | None) -> str:
        return (value or "").strip()

    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    target_key = canonical_status_key(new_status)
    # Solo el retiro físico/EN EL PROVEEDOR exige que la garantía esté en Chiclana/depósito.
    # Las respuestas administrativas del proveedor pueden registrarse antes para disparar urgencias.
    if target_key == "EN EL PROVEEDOR":
        assert_internal_logistics_ready_for_provider(row)
    if target_key == "RESUELTO":
        assert_provider_has_physical_product(row)
    if target_key in {"EN EL PROVEEDOR", "RESPONDIDO POR PROVEEDOR", "RESUELTO", "RECHAZADO", "ANULADA"} and not provider_flow_started(row):
        raise HTTPException(status_code=400, detail="No se puede avanzar proveedor sin confirmar antes el ENV/mail enviado.")
    old_status = str(row.get("status") or "")
    updates: dict[str, Any] = {"status": new_status}
    # Al avanzar/cerrar, una corrección pedida por el proveedor queda sin efecto.
    if target_key in {"EN EL PROVEEDOR", "RESUELTO", "RECHAZADO", "ANULADA", "FINALIZADO"}:
        current_resp_type = normalize_provider_response_type(row.get("provider_response_type") or "")
        if current_resp_type == "correccion":
            updates["provider_response_type"] = ""
            updates["provider_correction_note"] = ""
            pg_clear_item_correction_notes(guarantee_id=int(row["id"]))
    if target_key == "EN EL PROVEEDOR":
        now_pickup = utc_now_iso()
        updates["estado_retiro_proveedor"] = "retirado"
        updates["fecha_retiro_proveedor"] = str(row.get("fecha_retiro_proveedor") or "") or now_pickup
        updates["fecha_retiro"] = str(row.get("fecha_retiro") or "") or now_pickup
        updates["ubicacion_actual"] = "proveedor"

    if is_resolved_status(new_status) and not row.get("fecha_resolucion"):
        updates["fecha_resolucion"] = utc_now_iso()
    if is_finalizado:
        if not row.get("fecha_finalizacion"):
            updates["fecha_finalizacion"] = utc_now_iso()
        if data.finalizacion is not None:
            updates["finalizacion"] = clean(data.finalizacion)
        elif note:
            updates["finalizacion"] = note

    # Fase 12: resolución normalizada. Mantiene resolution_reference/resolution_note
    # por compatibilidad visual, pero guarda campos específicos para reportes.
    if resultado:
        updates["resultado_resolucion"] = resultado
        if resultado == "nota_credito":
            nc_number = clean(data.numero_nota_credito) or clean(data.resolution_reference)
            nc_amount = clean(data.importe_nota_credito)
            nc_date = clean(data.fecha_nota_credito)
            if nc_number:
                updates["numero_nota_credito"] = nc_number
                updates["resolution_reference"] = nc_number
            if nc_amount:
                updates["importe_nota_credito"] = nc_amount
            if nc_date:
                updates["fecha_nota_credito"] = nc_date
            if data.resolution_note is not None:
                updates["resolution_note"] = clean(data.resolution_note)
        elif resultado == "reparacion":
            detail = clean(data.detalle_reparacion) or clean(data.resolution_note)
            repair_date = clean(data.fecha_reparacion)
            if detail:
                updates["detalle_reparacion"] = detail
                updates["resolution_note"] = detail
            if repair_date:
                updates["fecha_reparacion"] = repair_date
            if data.resolution_reference is not None:
                updates["resolution_reference"] = clean(data.resolution_reference)
        elif resultado == "cambio_equipo":
            replacement_product = clean(data.producto_reemplazo) or clean(data.resolution_note)
            replacement_sku = clean(data.sku_reemplazo)
            replacement_serial = clean(data.serie_reemplazo)
            replacement_received = clean(data.fecha_recepcion_reemplazo)
            if replacement_product:
                updates["producto_reemplazo"] = replacement_product
                updates["resolution_note"] = replacement_product
            if replacement_sku:
                updates["sku_reemplazo"] = replacement_sku
            if replacement_serial:
                updates["serie_reemplazo"] = replacement_serial
                updates["resolution_reference"] = replacement_serial
            elif data.resolution_reference is not None:
                updates["resolution_reference"] = clean(data.resolution_reference)
            if replacement_received:
                updates["fecha_recepcion_reemplazo"] = replacement_received

    if data.resolution_note is not None and not resultado:
        updates["resolution_note"] = clean(data.resolution_note)
    if data.resolution_reference is not None and not resultado:
        updates["resolution_reference"] = clean(data.resolution_reference)

    history_note = note or f"Estado actualizado a {new_status}"
    if resultado:
        history_note = f"{history_note} | Resolución: {RESOLUTION_OPTIONS[resultado]}"
    if updates.get("numero_nota_credito"):
        history_note = f"{history_note} | NC: {updates['numero_nota_credito']}"
    if updates.get("importe_nota_credito"):
        history_note = f"{history_note} | Importe: {updates['importe_nota_credito']}"
    if updates.get("detalle_reparacion"):
        history_note = f"{history_note} | Reparación: {updates['detalle_reparacion']}"
    if updates.get("producto_reemplazo"):
        history_note = f"{history_note} | Cambio: {updates['producto_reemplazo']}"

    action = "status_changed"
    if is_resuelto:
        action = "resolution_registered"
    elif is_finalizado:
        action = "warranty_finalized"

    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action=action,
        old_status=old_status,
        new_status=new_status,
        note=history_note,
        details={
            "resultado_resolucion": resultado,
            "updates": {k: v for k, v in updates.items() if k not in {"updated_at", "updated_by", "updated_by_name", "synced_to_google_sheet"}},
        },
    )
    audit("warranties.status.change", user=user, resource_type="warranty", resource_id=warranty_id, details={"old_status": old_status, "new_status": new_status, "resultado_resolucion": resultado})
    return get_warranty_detail(warranty_id, user)

