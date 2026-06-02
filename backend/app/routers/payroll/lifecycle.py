"""Sub-router de detalle, archivo, firma, observaciones y anulacion."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select

from ...access import require_any_permission, user_has
from ...audit import audit
from ...auth import require_current_user
from ...db import db_session
from ...models.employees import PayrollReceiptObservation
from ...users import CurrentUser
from ..notifications import create_notification
from . import (
    INACTIVE_RECEIPT_STATUSES,
    PayrollCancelRequest,
    PayrollObservationAnswer,
    PayrollObservationCreate,
    PayrollReceiptOut,
    _UserLookup,
    _current_user_id,
    _employee_name,
    _employee_username,
    _get_receipt,
    _mark_viewed_if_needed,
    _observation_id_or_404,
    _path_from_upload_value,
    _receipt_to_out,
    utc_now_dt,
)


router = APIRouter(tags=["payroll"])


@router.get("/receipts/{receipt_id}", response_model=PayrollReceiptOut)
def receipt_detail(receipt_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    require_any_permission(
        user,
        ["payroll_receipts.view_own", "payroll_receipts.view_all"],
        detail="No tenes permiso para esta seccion",
    )
    with db_session() as session:
        receipt = _get_receipt(session, receipt_id, user)
        receipt = _mark_viewed_if_needed(session, receipt, user)
        lookup = _UserLookup(session)
        return _receipt_to_out(receipt, lookup, include_observations=True)


@router.get("/receipts/{receipt_id}/file")
def receipt_file(receipt_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    require_any_permission(
        user,
        ["payroll_receipts.view_own", "payroll_receipts.view_all"],
        detail="No tenes permiso para esta seccion",
    )
    with db_session() as session:
        receipt = _get_receipt(session, receipt_id, user)
        receipt = _mark_viewed_if_needed(session, receipt, user)
        path = _path_from_upload_value(str(receipt.file_path or ""))
        if not path or not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="No se encontro el archivo del recibo")
        return FileResponse(
            path,
            filename=str(receipt.file_name or path.name),
            media_type=str(receipt.file_content_type or "application/octet-stream"),
        )


@router.post("/receipts/{receipt_id}/sign", response_model=PayrollReceiptOut)
def sign_receipt(receipt_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    if not user_has(user, "payroll_receipts.sign_own"):
        raise HTTPException(status_code=403, detail="No tenes permiso para firmar recibos")
    with db_session() as session:
        receipt = _get_receipt(session, receipt_id, user)
        if _employee_username(receipt.employee) != user.username:
            raise HTTPException(status_code=403, detail="Solo podes firmar tus propios recibos")
        if str(receipt.status or "") in INACTIVE_RECEIPT_STATUSES:
            raise HTTPException(status_code=400, detail="Este recibo no se puede firmar porque esta anulado o reemplazado")
        now = utc_now_dt()
        current_user_id = _current_user_id(session, user)
        receipt.status = "firmado_conforme"
        receipt.signed_at = now
        receipt.signed_by_user_id = current_user_id
        if not receipt.viewed_at:
            receipt.viewed_at = now
            receipt.viewed_by_user_id = current_user_id
        receipt.updated_at = now
        session.commit()
        lookup = _UserLookup(session)
        out = _receipt_to_out(receipt, lookup, include_observations=True)

    audit(
        "payroll.receipt_sign",
        user=user,
        resource_type="payroll_receipt",
        resource_id=out.id,
        message="Recibo firmado en conformidad",
        details={"file_hash": out.file_hash},
    )
    return out


@router.post("/receipts/{receipt_id}/observe", response_model=PayrollReceiptOut)
def observe_receipt(
    receipt_id: str,
    req: PayrollObservationCreate,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    if not user_has(user, "payroll_receipts.observe_own"):
        raise HTTPException(status_code=403, detail="No tenes permiso para observar recibos")
    message = str(req.message or "").strip()
    if len(message) < 5:
        raise HTTPException(status_code=400, detail="Escribi una observacion mas clara")

    with db_session() as session:
        receipt = _get_receipt(session, receipt_id, user)
        if _employee_username(receipt.employee) != user.username:
            raise HTTPException(status_code=403, detail="Solo podes observar tus propios recibos")
        if str(receipt.status or "") in INACTIVE_RECEIPT_STATUSES:
            raise HTTPException(status_code=400, detail="Este recibo no se puede observar porque esta anulado o reemplazado")
        now = utc_now_dt()
        current_user_id = _current_user_id(session, user)
        observation = PayrollReceiptObservation(
            receipt=receipt,
            employee_id=receipt.employee_id,
            message=message,
            status="abierta",
            created_at=now,
        )
        session.add(observation)
        receipt.status = "observado"
        receipt.observed_at = now
        if not receipt.viewed_at:
            receipt.viewed_at = now
            receipt.viewed_by_user_id = current_user_id
        receipt.updated_at = now
        session.flush()
        obs_id = str(observation.id)
        uploaded_by, _uploaded_by_name = _UserLookup(session).get(receipt.uploaded_by_user_id)
        employee_name = _employee_name(receipt.employee)
        period_text = f"{int(receipt.period_month):02d}/{int(receipt.period_year)}"
        session.commit()
        lookup = _UserLookup(session)
        out = _receipt_to_out(receipt, lookup, include_observations=True)

    if uploaded_by:
        create_notification(
            uploaded_by,
            "Recibo observado",
            f"{employee_name} observo el recibo {period_text}.",
            "payroll",
            entity_type="payroll_receipt",
            entity_id=out.id,
            link_url="/recibos",
        )
    audit(
        "payroll.receipt_observe",
        user=user,
        resource_type="payroll_receipt",
        resource_id=out.id,
        message="Recibo observado por empleado",
        details={"observation_id": obs_id},
    )
    return out


@router.post("/receipts/{receipt_id}/observations/respond", response_model=PayrollReceiptOut)
def respond_observation(
    receipt_id: str,
    req: PayrollObservationAnswer,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    if not user_has(user, "payroll_receipts.respond_observation"):
        raise HTTPException(status_code=403, detail="No tenes permiso para responder observaciones")
    answer = str(req.answer_message or "").strip()
    if len(answer) < 3:
        raise HTTPException(status_code=400, detail="Escribi una respuesta")
    status = str(req.status or "respondida").strip() or "respondida"

    with db_session() as session:
        receipt = _get_receipt(session, receipt_id, user)
        observation_id = _observation_id_or_404(req.observation_id)
        observation = session.scalar(
            select(PayrollReceiptObservation).where(
                PayrollReceiptObservation.id == observation_id,
                PayrollReceiptObservation.receipt_id == receipt.id,
            )
        )
        if not observation:
            raise HTTPException(status_code=404, detail="Observacion no encontrada")
        now = utc_now_dt()
        observation.status = status
        observation.answered_by_user_id = _current_user_id(session, user)
        observation.answered_at = now
        observation.answer_message = answer
        receipt.updated_at = now
        employee_username = _employee_username(receipt.employee)
        period_text = f"{int(receipt.period_month):02d}/{int(receipt.period_year)}"
        session.commit()
        lookup = _UserLookup(session)
        out = _receipt_to_out(receipt, lookup, include_observations=True)

    if employee_username:
        create_notification(
            employee_username,
            "Respuesta sobre tu recibo",
            f"Administracion respondio una observacion del recibo {period_text}.",
            "payroll",
            entity_type="payroll_receipt",
            entity_id=out.id,
            link_url="/recibos",
        )
    audit(
        "payroll.observation_respond",
        user=user,
        resource_type="payroll_receipt",
        resource_id=out.id,
        message="Observacion de recibo respondida",
        details={"observation_id": req.observation_id, "status": status},
    )
    return out


@router.post("/receipts/{receipt_id}/cancel", response_model=PayrollReceiptOut)
def cancel_receipt(
    receipt_id: str,
    req: PayrollCancelRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    if not user_has(user, "payroll_receipts.cancel"):
        raise HTTPException(status_code=403, detail="No tenes permiso para anular recibos")
    with db_session() as session:
        receipt = _get_receipt(session, receipt_id, user)
        now = utc_now_dt()
        receipt.status = "anulado"
        receipt.cancelled_at = now
        receipt.cancelled_by_user_id = _current_user_id(session, user)
        receipt.cancel_reason = str(req.reason or "").strip()
        receipt.updated_at = now
        employee_username = _employee_username(receipt.employee)
        period_text = f"{int(receipt.period_month):02d}/{int(receipt.period_year)}"
        session.commit()
        lookup = _UserLookup(session)
        out = _receipt_to_out(receipt, lookup, include_observations=True)

    if employee_username:
        create_notification(
            employee_username,
            "Recibo anulado",
            f"Se anulo el recibo {period_text}.",
            "payroll",
            entity_type="payroll_receipt",
            entity_id=out.id,
            link_url="/recibos",
        )
    audit(
        "payroll.receipt_cancel",
        user=user,
        resource_type="payroll_receipt",
        resource_id=out.id,
        message="Recibo anulado",
        details={"reason": req.reason},
    )
    return out

