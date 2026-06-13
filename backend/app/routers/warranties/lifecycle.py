"""Sub-router de ciclo de vida y detalle de garantias.

Endpoints:
  POST   /{warranty_id}/cancel
  DELETE /{warranty_id}
  PATCH  /{warranty_id}/entry-base
  GET    /{warranty_id}
  GET    /{warranty_id}/history
  PATCH  /{warranty_id}

Este modulo debe registrarse ultimo: contiene el catch-all GET /{warranty_id}.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...audit import audit
from ...auth import require_current_user, require_permission
from ...warranties_db import (
    pg_cancel_guarantee,
    pg_delete_guarantee,
    pg_fetch_guarantee_with_items,
    pg_history_for_guarantee,
    pg_update_guarantee_fields,
    pg_update_item_fields,
)
from ...warranty_helpers import (
    REVIEW_INCOMPLETE,
    REVIEW_PENDING,
    format_datetime_ar,
    normalize_text,
    utc_now_iso,
)
from . import (
    DEFAULT_STATUSES,
    WarrantyCancelRequest,
    WarrantyDetailResponse,
    WarrantyEntryBaseUpdateRequest,
    WarrantyUpdateRequest,
    date_input_from_iso,
    ingreso_at_from_input,
    is_resolved_status,
    item_to_row,
    review_status_matches,
    row_to_summary,
    status_matches,
    sucursal_code,
)


router = APIRouter(tags=["warranties"])


@router.post("/{warranty_id}/cancel", response_model=WarrantyDetailResponse)
def cancel_warranty(warranty_id: str, data: WarrantyCancelRequest, user: Annotated[Any, Depends(require_permission("warranties.cancel"))]):
    reason = data.reason.strip()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    if int(row.get("cancelled") or 0):
        raise HTTPException(status_code=400, detail="La garantía ya se encuentra anulada.")
    pg_cancel_guarantee(warranty_code=warranty_id, user=user, reason=reason)
    audit("warranties.cancel", user=user, resource_type="warranty", resource_id=warranty_id, details={"reason": reason})
    return get_warranty_detail(warranty_id, user)


@router.delete("/{warranty_id}")
def delete_warranty(warranty_id: str, user: Annotated[Any, Depends(require_permission("warranties.delete"))]):
    """Eliminación definitiva para correcciones de carga/pruebas.

    La anulación sigue siendo la acción recomendada para casos reales.
    Esta acción queda registrada en auditoría global antes de borrar los datos del módulo.
    """
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, items = result
    snapshot = {
        "warranty_code": str(row.get("warranty_code") or warranty_id),
        "status": str(row.get("status") or ""),
        "review_status": str(row.get("review_status") or ""),
        "items": len(items),
        "responsible": str(row.get("responsible_name") or row.get("responsible_username") or ""),
    }
    pg_delete_guarantee(warranty_id)
    audit("warranties.delete", user=user, resource_type="warranty", resource_id=warranty_id, details=snapshot)
    return {"ok": True, "deleted": warranty_id}


def _entry_base_edit_allowed(row: dict[str, Any], user: Any) -> bool:
    """Permite corrección de base solo antes de que el caso avance."""
    if user.has("warranties.manage") or user.has("warranties.manage_provider"):
        return True
    if int(row["cancelled"] or 0):
        return False
    status_ok = status_matches(str(row["status"] or ""), DEFAULT_STATUSES[0])
    review_ok = review_status_matches(str(row["review_status"] or REVIEW_PENDING), REVIEW_PENDING) or review_status_matches(str(row["review_status"] or REVIEW_PENDING), REVIEW_INCOMPLETE)
    if not (status_ok and review_ok):
        return False
    username = str(getattr(user, "username", "") or "")
    user_branch_id = str(getattr(user, "branch_id", "") or "")
    user_sucursal = normalize_text(getattr(user, "sucursal", "") or getattr(user, "branch_name", "") or "")
    if username and username == str(row["created_by"] or ""):
        return True
    if user_branch_id and user_branch_id in {str(row["branch_id"] or ""), str(row["sucursal_responsable_id"] or "")}:
        return True
    if user_sucursal and user_sucursal == normalize_text(row["sucursal"] or ""):
        return True
    return False


@router.patch("/{warranty_id}/entry-base", response_model=WarrantyDetailResponse)
def update_warranty_entry_base(warranty_id: str, data: WarrantyEntryBaseUpdateRequest, user: Annotated[Any, Depends(require_current_user)]):
    """Edita la base de una garantía recién ingresada.

    Alcance Fase 3: fecha de ingreso, datos de cliente, observaciones/fotos, proveedor sugerido
    y productos asociados. No modifica estado, revisión, remitos ni ENV.
    """
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, items_list = result
    if not _entry_base_edit_allowed(row, user):
        raise HTTPException(status_code=403, detail="Esta garantía ya no puede editarse desde ingreso. Pedile a un gestor/admin que la corrija.")

    updates: dict[str, Any] = {}
    notes: list[str] = []

    if data.fecha_ingreso is not None:
        new_ingreso = ingreso_at_from_input(data.fecha_ingreso, fallback_now=False)
        old_date = date_input_from_iso(row.get("ingreso_at"))
        new_date = date_input_from_iso(new_ingreso)
        if new_date and new_date != old_date:
            updates["ingreso_at"] = new_ingreso
            notes.append(f"Fecha de ingreso: {old_date or '-'} → {new_date}")

    simple_fields = {
        "observaciones": "observations",
        "photos_reference": "photos_reference",
        "proveedor": "provider_name",
        "cliente_nombre": "cliente_nombre",
        "cliente_telefono": "cliente_telefono",
        "cliente_email": "cliente_email",
        "numero_factura": "numero_factura",
        "fecha_compra": "fecha_compra",
    }
    for input_name, column_name in simple_fields.items():
        value = getattr(data, input_name)
        if value is None:
            continue
        clean_value = str(value or "").strip()
        if clean_value != str(row.get(column_name) or ""):
            updates[column_name] = clean_value
            notes.append(f"{input_name}: actualizado")

    item_changes: list[dict[str, Any]] = []
    if data.items:
        existing_items = {int(item["id"]): item for item in items_list}
        allowed_item_fields = ["producto", "sku", "marca", "tipo", "serie", "falla", "observaciones"]
        for incoming in data.items:
            item_row = existing_items.get(int(incoming.row_number))
            if not item_row:
                continue
            item_updates: dict[str, str] = {}
            for field in allowed_item_fields:
                value = getattr(incoming, field)
                if value is None:
                    continue
                clean_value = str(value or "").strip()
                if clean_value != str(item_row.get(field) or ""):
                    item_updates[field] = clean_value
                    item_changes.append({"item_id": incoming.row_number, "field": field, "old": str(item_row.get(field) or ""), "new": clean_value})
            if item_updates:
                pg_update_item_fields(guarantee_id=int(row["id"]), item_id=int(incoming.row_number), updates=item_updates)

    if not updates and not item_changes:
        return get_warranty_detail(warranty_id, user)

    # pg_update_guarantee_fields hace UPDATE + history en la misma transacción.
    # Si solo hubo cambios en items y no en cabecera, igual queremos un evento.
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="entry_base_updated",
        old_status=str(row.get("status") or ""),
        new_status=updates.get("status", str(row.get("status") or "")),
        note="; ".join(notes) or ("Productos actualizados" if item_changes else "Ingreso actualizado"),
        details={"updated_fields": list(updates.keys()), "item_changes": item_changes},
    )
    audit("warranties.entry_base_update", user=user, resource_type="warranty", resource_id=warranty_id, details={"fields": list(updates.keys()), "item_changes": len(item_changes)})
    return get_warranty_detail(warranty_id, user)


@router.get("/{warranty_id}", response_model=WarrantyDetailResponse)
def get_warranty_detail(warranty_id: str, _user: Annotated[Any, Depends(require_permission("warranties.view"))]):
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, items = result
    summary = row_to_summary(row, items)
    rows = [item_to_row(row, item, index) for index, item in enumerate(items, start=1)]
    history = pg_history_for_guarantee(int(row["id"]))
    return WarrantyDetailResponse(summary=summary, rows=rows, history=history)


@router.get("/{warranty_id}/history")
def get_warranty_history(warranty_id: str, _user: Annotated[Any, Depends(require_permission("warranties.view"))]):
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result
    return pg_history_for_guarantee(int(row["id"]))


class WarrantyDatesUpdateRequest(BaseModel):
    """Edicion de fechas reales para garantias de carga historica.

    Cada campo: None = no tocar; "" = limpiar; ISO date/datetime = setear.
    Solo accesible con `warranties.edit_dates` (adm/gerencia) para que las
    estadisticas (SLA por proveedor, tasa de falla) usen fechas reales y no
    el timestamp de cuando se cargo el Excel viejo.
    """
    carga_historica: bool | None = None
    ingreso_at: str | None = None
    sent_to_provider_at: str | None = None
    fecha_resolucion: str | None = None
    fecha_finalizacion: str | None = None


_EDITABLE_DATE_FIELDS = ("ingreso_at", "sent_to_provider_at", "fecha_resolucion", "fecha_finalizacion")


def _parse_iso_or_400(field: str, value: str) -> str:
    try:
        # Acepta YYYY-MM-DD o ISO completo; validamos y devolvemos ISO.
        return datetime.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Fecha invalida en {field}: {value!r} (usar YYYY-MM-DD o ISO)") from exc


@router.patch("/{warranty_id}/dates", response_model=WarrantyDetailResponse)
def update_warranty_dates(warranty_id: str, data: WarrantyDatesUpdateRequest, user: Annotated[Any, Depends(require_permission("warranties.edit_dates"))]):
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, _items = result

    updates: dict[str, Any] = {}
    changes: list[str] = []
    if data.carga_historica is not None and bool(row.get("carga_historica")) != data.carga_historica:
        updates["carga_historica"] = data.carga_historica
        changes.append(f"carga_historica → {data.carga_historica}")
    for field in _EDITABLE_DATE_FIELDS:
        value = getattr(data, field)
        if value is None:
            continue
        value = value.strip()
        if value == "":
            if row.get(field):
                updates[field] = None
                changes.append(f"{field}: {row.get(field)} → (vacio)")
            continue
        iso = _parse_iso_or_400(field, value)
        if str(row.get(field) or "") != iso:
            updates[field] = iso
            changes.append(f"{field}: {row.get(field) or '-'} → {iso}")

    if not updates:
        return get_warranty_detail(warranty_id, user)

    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="dates_edited",
        note="Fechas reales editadas (carga histórica): " + "; ".join(changes),
        details={"changes": changes},
    )
    audit("warranties.edit_dates", user=user, resource_type="warranty", resource_id=warranty_id, details={"changes": changes})
    return get_warranty_detail(warranty_id, user)


@router.patch("/{warranty_id}", response_model=WarrantyDetailResponse)
def update_warranty(warranty_id: str, data: WarrantyUpdateRequest, user: Annotated[Any, Depends(require_permission("warranties.manage"))]):
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantía no encontrada")
    row, items_list = result
    current_status = str(row.get("status") or "")
    current_review_status = str(row.get("review_status") or REVIEW_PENDING)
    updates: dict[str, Any] = {}
    notes: list[str] = []
    if data.estado is not None and data.estado.strip() and data.estado.strip() != current_status:
        updates["status"] = data.estado.strip()
        notes.append(f"Estado: {current_status or '-'} → {data.estado.strip()}")
    if data.sucursal is not None and data.sucursal.strip() != str(row.get("sucursal") or ""):
        updates["sucursal"] = data.sucursal.strip()
        updates["sucursal_code"] = sucursal_code(data.sucursal.strip())
        notes.append(f"Sucursal: {row.get('sucursal') or '-'} → {data.sucursal.strip() or '-'}")
    if data.deposito is not None and data.deposito.strip() != str(row.get("deposito") or ""):
        updates["deposito"] = data.deposito.strip()
        notes.append(f"Depósito: {row.get('deposito') or '-'} → {data.deposito.strip() or '-'}")
    if data.lugar_llegada is not None and data.lugar_llegada.strip() != str(row.get("lugar_llegada") or ""):
        updates["lugar_llegada"] = data.lugar_llegada.strip()
    if data.ubicacion_actual is not None and data.ubicacion_actual.strip() != str(row.get("ubicacion_actual") or ""):
        old_ub = str(row.get("ubicacion_actual") or "-")
        new_ub = data.ubicacion_actual.strip()
        updates["ubicacion_actual"] = new_ub
        notes.append(f"Ubicación: {old_ub} → {new_ub or '-'}")
    if data.sucursal_responsable is not None and data.sucursal_responsable.strip() != str(row.get("sucursal_responsable") or ""):
        old_sr = str(row.get("sucursal_responsable") or "-")
        new_sr = data.sucursal_responsable.strip()
        updates["sucursal_responsable"] = new_sr
        notes.append(f"Suc. responsable: {old_sr} → {new_sr or '-'}")
    if data.observaciones is not None:
        updates["observations"] = data.observaciones.strip()
    if data.photos_reference is not None:
        updates["photos_reference"] = data.photos_reference.strip()
    if data.append_observation and data.append_observation.strip():
        stamp = format_datetime_ar()
        note = f"[{stamp} - {getattr(user, 'display_name', '')}] {data.append_observation.strip()}"
        current = str(row.get("observations") or "").strip()
        updates["observations"] = f"{current}\n{note}".strip() if current else note
        notes.append("Se agregó una observación")
    item_changes: list[dict[str, Any]] = []
    if data.items:
        existing_items = {int(item["id"]): item for item in items_list}
        allowed_item_fields = ["producto", "sku", "marca", "tipo", "serie", "falla", "observaciones"]
        for incoming in data.items:
            item_row = existing_items.get(int(incoming.row_number))
            if not item_row:
                continue
            item_updates: dict[str, str] = {}
            for field in allowed_item_fields:
                value = getattr(incoming, field)
                if value is None:
                    continue
                clean_value = str(value or "").strip()
                if clean_value != str(item_row.get(field) or ""):
                    item_updates[field] = clean_value
                    item_changes.append({"item_id": incoming.row_number, "field": field, "old": str(item_row.get(field) or ""), "new": clean_value})
            if item_updates:
                pg_update_item_fields(guarantee_id=int(row["id"]), item_id=int(incoming.row_number), updates=item_updates)
    if is_resolved_status(updates.get("status", current_status)) and not row.get("fecha_resolucion"):
        updates["fecha_resolucion"] = utc_now_iso()
    # Si la garantía fue marcada como requiere_correccion y el usuario la corrige,
    # vuelve a INGRESO + pendiente_revision para entrar nuevamente a la cola.
    was_correction = review_status_matches(current_review_status, REVIEW_INCOMPLETE)
    if was_correction and (updates or item_changes):
        updates["status"] = DEFAULT_STATUSES[0]
        updates["review_status"] = REVIEW_PENDING
        updates["review_note"] = ""
        updates["correction_resubmitted_at"] = utc_now_iso()
        updates["correction_resubmitted_by"] = getattr(user, "username", "") or ""
        notes.append("Corregida y enviada nuevamente a revisión")
    if not updates and not item_changes:
        return get_warranty_detail(warranty_id, user)
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates=updates,
        action="updated",
        old_status=current_status,
        new_status=updates.get("status", current_status),
        note="; ".join(notes) or ("Productos actualizados" if item_changes else "Garantía actualizada"),
        details={"updated_fields": list(updates.keys()), "item_changes": item_changes},
    )
    audit("warranties.update", user=user, resource_type="warranty", resource_id=warranty_id, details={"source": "database", "fields": list(updates.keys())})
    return get_warranty_detail(warranty_id, user)

