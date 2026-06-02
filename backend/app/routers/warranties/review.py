"""Sub-router de revision interna de garantias.

Endpoints:
  GET  /review-queue
  POST /{warranty_id}/take-review
  POST /{warranty_id}/mark-incomplete
  POST /{warranty_id}/approve-review
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ...audit import audit
from ...auth import require_permission
from ...warranties_db import (
    pg_fetch_all_guarantee_rows,
    pg_fetch_guarantee_with_items,
    pg_update_guarantee_fields,
)
from ...warranty_helpers import (
    REVIEW_APPROVED,
    REVIEW_IN_PROGRESS,
    REVIEW_INCOMPLETE,
    REVIEW_PENDING,
    normalize_text,
    utc_now_iso,
)
from . import (
    DEFAULT_STATUSES,
    WarrantyDetailResponse,
    WarrantyListResponse,
    WarrantyReviewRequest,
    WarrantySummary,
    _fetch_branch_info,
    deny_plain_deposit_operator,
    review_status_matches,
    row_to_summary,
    status_matches,
)


router = APIRouter(tags=["warranties"])


def _detail_response(warranty_id: str, user: Any) -> WarrantyDetailResponse:
    # Import tardio: lifecycle sigue en __init__.py hasta la ultima extraccion.
    from . import get_warranty_detail

    return get_warranty_detail(warranty_id, user)


@router.get("/review-queue", response_model=WarrantyListResponse)
def review_queue(
    _user: Annotated[Any, Depends(require_permission("warranties.review"))],
    q: str = "",
    sucursal: str = "",
    deposito: str = "",
    limit: int = Query(default=300, ge=1, le=1000),
):
    deny_plain_deposit_operator(_user, "ver bandeja de revision")

    q_tokens = normalize_text(q).split()
    suc_key = normalize_text(sucursal)
    dep_key = normalize_text(deposito)
    if dep_key in {"TODOS", "ALL"}:
        dep_key = ""
    if suc_key in {"TODOS", "ALL"}:
        suc_key = ""

    rows, all_items = pg_fetch_all_guarantee_rows()
    by_gid: dict[int, list[dict[str, Any]]] = {}
    for item_row in all_items:
        by_gid.setdefault(int(item_row["guarantee_id"]), []).append(item_row)

    summaries = [row_to_summary(row, by_gid.get(int(row["id"]), [])) for row in rows]

    def _branch_label_from_id(branch_id: str) -> str:
        if not branch_id:
            return ""
        try:
            info = _fetch_branch_info(branch_id)
            return str((info or {}).get("name") or "")
        except Exception:
            return ""

    def _matches_sucursal(item: WarrantySummary) -> bool:
        if not suc_key:
            return True
        values = {
            normalize_text(item.sucursal),
            normalize_text(item.sucursal_responsable),
            normalize_text(item.ubicacion_actual),
            normalize_text(_branch_label_from_id(item.branch_id)),
            normalize_text(_branch_label_from_id(item.sucursal_responsable_id)),
        }
        values.discard("")
        return suc_key in values

    def _matches_lugar(item: WarrantySummary) -> bool:
        if not dep_key:
            return True
        values = {
            normalize_text(item.deposito),
            normalize_text(item.lugar_llegada),
            normalize_text(item.ubicacion_actual),
            normalize_text(item.ubicacion_actual_label),
        }
        values.discard("")
        return dep_key in values

    def _matches_search(item: WarrantySummary) -> bool:
        if not q_tokens:
            return True
        haystack = normalize_text(" ".join([
            item.id_garantia,
            item.parent_warranty_code,
            item.producto_principal,
            " ".join(item.productos),
            item.sku,
            item.serie,
            item.falla,
            item.responsable,
            item.sucursal,
            item.sucursal_responsable,
            item.deposito,
            item.ubicacion_actual,
            item.provider_name,
        ]))
        return all(token in haystack for token in q_tokens)

    def _is_in_review_queue(item: WarrantySummary) -> bool:
        if item.cancelled:
            return False
        if review_status_matches(item.review_status, REVIEW_APPROVED):
            return False
        return (
            status_matches(item.estado, DEFAULT_STATUSES[0])
            or review_status_matches(item.review_status, REVIEW_PENDING)
            or review_status_matches(item.review_status, REVIEW_IN_PROGRESS)
            or review_status_matches(item.review_status, REVIEW_INCOMPLETE)
        )

    filtered = [
        item for item in summaries
        if _is_in_review_queue(item)
        and _matches_sucursal(item)
        and _matches_lugar(item)
        and _matches_search(item)
    ]
    return WarrantyListResponse(items=filtered[:limit], total=len(filtered), limit=limit)


@router.post("/{warranty_id}/take-review", response_model=WarrantyDetailResponse)
def take_warranty_into_review(
    warranty_id: str,
    data: WarrantyReviewRequest,
    user: Annotated[Any, Depends(require_permission("warranties.review"))],
):
    deny_plain_deposit_operator(user, "tomar garantias en revision")
    note = (data.note or "").strip()
    if not (user.has("warranties.create") or user.has("warranties.manage") or user.has("warranties.manage_provider")):
        raise HTTPException(status_code=403, detail="No tenes permiso para editar la base de ingreso")

    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantia no encontrada")
    row, _items = result
    if str(row.get("cancelled") or 0) == "1":
        raise HTTPException(status_code=400, detail="La garantia esta anulada")
    current_rs = str(row.get("review_status") or REVIEW_PENDING)
    if review_status_matches(current_rs, REVIEW_APPROVED):
        raise HTTPException(status_code=400, detail="La garantia ya fue revisada y aprobada")
    if review_status_matches(current_rs, REVIEW_IN_PROGRESS):
        raise HTTPException(status_code=400, detail="La garantia ya esta en revision interna")
    current_status = str(row.get("status") or "")
    new_status = DEFAULT_STATUSES[0]
    now = utc_now_iso()
    actor_username = getattr(user, "username", "") or ""
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates={
            "review_status": REVIEW_IN_PROGRESS,
            "status": new_status,
            "review_started_at": now,
            "review_started_by": actor_username,
        },
        action="review_started",
        old_status=current_status,
        new_status=new_status,
        note=note or "Tomada en revision interna",
        details={"review_status": REVIEW_IN_PROGRESS, "review_started_at": now, "status_normalizado": new_status},
    )
    audit("warranties.review.take", user=user, resource_type="warranty", resource_id=warranty_id, details={"note": note})
    return _detail_response(warranty_id, user)


@router.post("/{warranty_id}/mark-incomplete", response_model=WarrantyDetailResponse)
def mark_warranty_incomplete(
    warranty_id: str,
    data: WarrantyReviewRequest,
    user: Annotated[Any, Depends(require_permission("warranties.mark_incomplete"))],
):
    deny_plain_deposit_operator(user, "pedir correccion de garantias")
    note = (data.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="Indica que debe corregir la sucursal antes de devolver la garantia")
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantia no encontrada")
    row, _items = result
    if str(row.get("cancelled") or 0) == "1":
        raise HTTPException(status_code=400, detail="La garantia esta anulada")
    if review_status_matches(str(row.get("review_status") or REVIEW_PENDING), REVIEW_APPROVED):
        raise HTTPException(status_code=400, detail="La garantia ya fue aprobada; corregila desde gestion/admin si corresponde")
    current_status = str(row.get("status") or "")
    new_status = DEFAULT_STATUSES[0]
    now = utc_now_iso()
    actor_username = getattr(user, "username", "") or ""
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates={
            "review_status": REVIEW_INCOMPLETE,
            "status": new_status,
            "review_note": note,
            "correction_requested_at": now,
            "correction_requested_by": actor_username,
        },
        action="review_correction_requested",
        old_status=current_status,
        new_status=new_status,
        note=note,
        details={"review_status": REVIEW_INCOMPLETE, "correction_requested_at": now, "status_normalizado": new_status},
    )
    audit("warranties.review.incomplete", user=user, resource_type="warranty", resource_id=warranty_id, details={"note": note})
    return _detail_response(warranty_id, user)


@router.post("/{warranty_id}/approve-review", response_model=WarrantyDetailResponse)
def approve_warranty_review(
    warranty_id: str,
    data: WarrantyReviewRequest,
    user: Annotated[Any, Depends(require_permission("warranties.approve_review"))],
):
    deny_plain_deposit_operator(user, "aprobar garantias")
    note = (data.note or "").strip()
    result = pg_fetch_guarantee_with_items(warranty_id)
    if not result:
        raise HTTPException(status_code=404, detail="Garantia no encontrada")
    row, _items = result
    if str(row.get("cancelled") or 0) == "1":
        raise HTTPException(status_code=400, detail="La garantia esta anulada")
    if review_status_matches(str(row.get("review_status") or REVIEW_PENDING), REVIEW_APPROVED):
        raise HTTPException(status_code=400, detail="La garantia ya fue revisada y aprobada")
    current_status = str(row.get("status") or "")
    new_status = DEFAULT_STATUSES[1]
    now = utc_now_iso()
    actor_username = getattr(user, "username", "") or ""
    pg_update_guarantee_fields(
        guarantee_id=int(row["id"]),
        user=user,
        updates={
            "review_status": REVIEW_APPROVED,
            "reviewed_by": actor_username,
            "reviewed_at": now,
            "review_note": note,
            "status": new_status,
            "correction_requested_at": "",
            "correction_requested_by": "",
        },
        action="review_approved",
        old_status=current_status,
        new_status=new_status,
        note=note or "Revision aprobada",
        details={"review_status": REVIEW_APPROVED},
    )
    audit("warranties.review.approve", user=user, resource_type="warranty", resource_id=warranty_id, details={"status": new_status})
    return _detail_response(warranty_id, user)
