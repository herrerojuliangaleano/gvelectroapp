from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ...access import user_has
from ...audit import audit
from ...auth import require_current_user
from ...config import get_settings
from ...db import db_session
from ...models.auth import User
from ...models.employees import Employee, PayrollReceipt, PayrollReceiptObservation
from ...users import CurrentUser
from ..notifications import create_notification

router = APIRouter(prefix="/api/payroll", tags=["payroll"])

ALLOWED_CONTENT_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
MAX_RECEIPT_BYTES = 15 * 1024 * 1024
INACTIVE_RECEIPT_STATUSES = {"anulado", "reemplazado"}


class PayrollObservationOut(BaseModel):
    id: str
    receipt_id: str
    employee_id: str = ""
    employee_username: str = ""
    message: str
    status: str
    created_at: str
    answered_by: str = ""
    answered_by_name: str = ""
    answered_at: str = ""
    answer_message: str = ""


class PayrollReceiptOut(BaseModel):
    id: str
    employee_id: str
    employee_username: str = ""
    employee_dni: str = ""
    employee_name: str = ""
    period_year: int
    period_month: int
    receipt_type: str = "mensual"
    file_name: str
    file_content_type: str = ""
    file_size: int = 0
    file_hash: str = ""
    status: str
    uploaded_by: str = ""
    uploaded_by_name: str = ""
    uploaded_at: str = ""
    viewed_at: str = ""
    viewed_by: str = ""
    signed_at: str = ""
    signed_by: str = ""
    observed_at: str = ""
    cancelled_at: str = ""
    cancelled_by: str = ""
    cancel_reason: str = ""
    replaced_by_receipt_id: str = ""
    created_at: str = ""
    updated_at: str = ""
    observations: list[PayrollObservationOut] = []


class PayrollReceiptListResponse(BaseModel):
    items: list[PayrollReceiptOut]
    total: int
    pending: int
    signed: int
    observed: int


class PayrollObservationCreate(BaseModel):
    message: str


class PayrollObservationAnswer(BaseModel):
    observation_id: str
    answer_message: str
    status: str = "respondida"


class PayrollCancelRequest(BaseModel):
    reason: str = ""


class PayrollBulkPreviewItem(BaseModel):
    file_name: str
    file_size: int = 0
    content_type: str = ""
    detected_dni: str = ""
    employee_id: str = ""
    employee_username: str = ""
    employee_name: str = ""
    employee_dni: str = ""
    duplicate_receipt_id: str = ""
    duplicate_status: str = ""
    status: str
    message: str
    can_upload: bool = False


class PayrollBulkPreviewResponse(BaseModel):
    items: list[PayrollBulkPreviewItem]
    total: int
    ready: int
    missing_dni: int
    not_found: int
    duplicates: int
    invalid: int


class PayrollBulkUploadItem(BaseModel):
    file_name: str
    detected_dni: str = ""
    employee_id: str = ""
    employee_username: str = ""
    employee_name: str = ""
    employee_dni: str = ""
    receipt_id: str = ""
    duplicate_receipt_id: str = ""
    status: str
    message: str


class PayrollBulkUploadResponse(BaseModel):
    items: list[PayrollBulkUploadItem]
    total: int
    uploaded: int
    skipped: int
    errors: int
    replaced: int


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _fmt_dt(value: datetime | None) -> str:
    return value.isoformat() if value else ""


def _safe_filename(value: str) -> str:
    name = Path(value or "recibo.pdf").name
    base = re.sub(r"[^a-zA-Z0-9_. -]+", "_", name).strip(" .")
    return base or "recibo.pdf"


def _safe_dni(value: str) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _detect_dni_from_filename(filename: str) -> str:
    base = Path(filename or "").stem
    candidates = re.findall(r"(?<!\d)(\d{7,9})(?!\d)", base)
    if candidates:
        return _safe_dni(candidates[0])
    compact = _safe_dni(base)
    if 7 <= len(compact) <= 9:
        return compact
    return ""


def _extension_for_upload(file: UploadFile, original_name: str) -> str:
    content_type = (file.content_type or "").lower().strip()
    suffix = Path(original_name).suffix.lower()
    return ALLOWED_CONTENT_TYPES.get(content_type) or (suffix if suffix in ALLOWED_EXTENSIONS else "")


def _file_status_from_upload(file: UploadFile, size: int) -> tuple[bool, str]:
    original_name = _safe_filename(file.filename or "recibo.pdf")
    if not _extension_for_upload(file, original_name):
        return False, "Formato no permitido. Usa PDF, JPG, PNG o WEBP."
    if size <= 0:
        return False, "El archivo esta vacio."
    if size > MAX_RECEIPT_BYTES:
        return False, "Archivo demasiado pesado. Maximo permitido: 15 MB."
    return True, ""


def _parse_int(value: str | int | None) -> int | None:
    try:
        text = str(value or "").strip()
        return int(text) if text else None
    except (TypeError, ValueError):
        return None


def _receipt_id_or_404(value: str) -> int:
    receipt_id = _parse_int(value)
    if receipt_id is None:
        raise HTTPException(status_code=404, detail="Recibo no encontrado")
    return receipt_id


def _observation_id_or_404(value: str) -> int:
    observation_id = _parse_int(value)
    if observation_id is None:
        raise HTTPException(status_code=404, detail="Observacion no encontrada")
    return observation_id


def _parse_bulk_mappings(raw: str) -> dict[str, dict[str, str]]:
    try:
        data = json.loads(raw or "{}")
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    mappings: dict[str, dict[str, str]] = {}
    for key, value in data.items():
        clean_key = str(key or "").strip()
        if not clean_key:
            continue
        if isinstance(value, dict):
            mappings[clean_key] = {
                "dni": _safe_dni(str(value.get("dni") or "")),
                "employee_id": str(value.get("employee_id") or "").strip(),
                "username": str(value.get("username") or "").strip(),
            }
        else:
            mappings[clean_key] = {"dni": _safe_dni(str(value or "")), "employee_id": "", "username": ""}
    return mappings


def _mapping_for_file(mappings: dict[str, dict[str, str]], original_name: str) -> dict[str, str]:
    safe_name = _safe_filename(original_name)
    return mappings.get(original_name) or mappings.get(safe_name) or {}


def _period_dir(year: int, month: int) -> Path:
    path = get_settings().uploads_dir / "payroll" / "receipts" / f"{year:04d}-{month:02d}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _relative_upload_path(path: Path) -> str:
    base = get_settings().uploads_dir.resolve()
    return str(path.resolve().relative_to(base)).replace("\\", "/")


def _path_from_upload_value(value: str) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    relative = Path(raw)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    base = get_settings().uploads_dir.resolve()
    target = (base / relative).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target


def _employee_username(employee: Employee | None) -> str:
    if not employee or not employee.user:
        return ""
    return str(employee.user.username or "")


def _employee_name(employee: Employee | None) -> str:
    if not employee:
        return "Empleado"
    full_name = str(employee.display_name or "").strip()
    if not full_name:
        full_name = " ".join(
            [str(employee.first_name or "").strip(), str(employee.last_name or "").strip()]
        ).strip()
    return full_name or _employee_username(employee) or str(employee.dni or "") or "Empleado"


def _find_employee(
    session: Session,
    *,
    employee_id: str = "",
    username: str = "",
    dni: str = "",
) -> Employee | None:
    eid = _parse_int(employee_id)
    if eid is not None:
        employee = session.get(Employee, eid)
        if employee:
            return employee

    uname = str(username or "").strip().lower()
    if uname:
        employee = session.scalar(
            select(Employee)
            .join(User, Employee.user_id == User.id)
            .where(User.username == uname)
        )
        if employee:
            return employee

    clean_dni = _safe_dni(dni)
    if clean_dni:
        employee = session.scalar(select(Employee).where(Employee.dni == clean_dni))
        if employee:
            return employee

    return None


def _active_duplicate_receipt(
    session: Session,
    employee_id: int,
    period_year: int,
    period_month: int,
    receipt_type: str,
) -> PayrollReceipt | None:
    return session.scalars(
        select(PayrollReceipt)
        .options(selectinload(PayrollReceipt.employee).selectinload(Employee.user))
        .where(
            PayrollReceipt.employee_id == employee_id,
            PayrollReceipt.period_year == int(period_year),
            PayrollReceipt.period_month == int(period_month),
            PayrollReceipt.receipt_type == str(receipt_type or "mensual"),
            ~PayrollReceipt.status.in_(INACTIVE_RECEIPT_STATUSES),
        )
        .order_by(PayrollReceipt.created_at.desc(), PayrollReceipt.id.desc())
        .limit(1)
    ).first()


def _active_duplicate_receipt_ids(
    session: Session,
    employee_id: int,
    period_year: int,
    period_month: int,
    receipt_type: str,
) -> list[int]:
    return [
        int(receipt_id)
        for receipt_id in session.scalars(
            select(PayrollReceipt.id)
            .where(
                PayrollReceipt.employee_id == employee_id,
                PayrollReceipt.period_year == int(period_year),
                PayrollReceipt.period_month == int(period_month),
                PayrollReceipt.receipt_type == str(receipt_type or "mensual"),
                ~PayrollReceipt.status.in_(INACTIVE_RECEIPT_STATUSES),
            )
            .order_by(PayrollReceipt.created_at.desc(), PayrollReceipt.id.desc())
        ).all()
    ]


class _UserLookup:
    def __init__(self, session: Session):
        self.session = session
        self._cache: dict[int, tuple[str, str]] = {}

    def get(self, user_id: int | None) -> tuple[str, str]:
        if user_id is None:
            return "", ""
        if user_id not in self._cache:
            user = self.session.get(User, user_id)
            self._cache[user_id] = (
                str(user.username or "") if user else "",
                str(user.display_name or "") if user else "",
            )
        return self._cache[user_id]


def _current_user_id(session: Session, user: CurrentUser) -> int | None:
    uname = str(user.username or "").strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(User.username == uname))


def _observation_to_out(
    observation: PayrollReceiptObservation,
    lookup: _UserLookup,
    receipt: PayrollReceipt | None = None,
) -> PayrollObservationOut:
    answered_by, answered_by_name = lookup.get(observation.answered_by_user_id)
    employee = receipt.employee if receipt else None
    return PayrollObservationOut(
        id=str(observation.id),
        receipt_id=str(observation.receipt_id),
        employee_id=str(observation.employee_id or (receipt.employee_id if receipt else "") or ""),
        employee_username=_employee_username(employee),
        message=str(observation.message or ""),
        status=str(observation.status or "abierta"),
        created_at=_fmt_dt(observation.created_at),
        answered_by=answered_by,
        answered_by_name=answered_by_name,
        answered_at=_fmt_dt(observation.answered_at),
        answer_message=str(observation.answer_message or ""),
    )


def _receipt_observations_out(receipt: PayrollReceipt, lookup: _UserLookup) -> list[PayrollObservationOut]:
    observations = sorted(
        list(receipt.observations or []),
        key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return [_observation_to_out(obs, lookup, receipt) for obs in observations]


def _receipt_to_out(
    receipt: PayrollReceipt,
    lookup: _UserLookup,
    *,
    include_observations: bool = False,
) -> PayrollReceiptOut:
    uploaded_by, uploaded_by_name = lookup.get(receipt.uploaded_by_user_id)
    viewed_by, _viewed_by_name = lookup.get(receipt.viewed_by_user_id)
    signed_by, _signed_by_name = lookup.get(receipt.signed_by_user_id)
    cancelled_by, _cancelled_by_name = lookup.get(receipt.cancelled_by_user_id)
    employee = receipt.employee
    return PayrollReceiptOut(
        id=str(receipt.id),
        employee_id=str(receipt.employee_id or ""),
        employee_username=_employee_username(employee),
        employee_dni=str(employee.dni or "") if employee else "",
        employee_name=_employee_name(employee),
        period_year=int(receipt.period_year),
        period_month=int(receipt.period_month),
        receipt_type=str(receipt.receipt_type or "mensual"),
        file_name=str(receipt.file_name or "recibo"),
        file_content_type=str(receipt.file_content_type or ""),
        file_size=int(receipt.file_size or 0),
        file_hash=str(receipt.file_hash or ""),
        status=str(receipt.status or "pendiente"),
        uploaded_by=uploaded_by,
        uploaded_by_name=uploaded_by_name,
        uploaded_at=_fmt_dt(receipt.created_at),
        viewed_at=_fmt_dt(receipt.viewed_at),
        viewed_by=viewed_by,
        signed_at=_fmt_dt(receipt.signed_at),
        signed_by=signed_by,
        observed_at=_fmt_dt(receipt.observed_at),
        cancelled_at=_fmt_dt(receipt.cancelled_at),
        cancelled_by=cancelled_by,
        cancel_reason=str(receipt.cancel_reason or ""),
        replaced_by_receipt_id=str(receipt.replaced_by_receipt_id or ""),
        created_at=_fmt_dt(receipt.created_at),
        updated_at=_fmt_dt(receipt.updated_at),
        observations=_receipt_observations_out(receipt, lookup) if include_observations else [],
    )


def _can_view_receipt(receipt: PayrollReceipt, user: CurrentUser) -> bool:
    if user_has(user, "payroll_receipts.view_all"):
        return True
    return user_has(user, "payroll_receipts.view_own") and _employee_username(receipt.employee) == user.username


def _receipt_load_options() -> tuple[Any, ...]:
    return (
        selectinload(PayrollReceipt.employee).selectinload(Employee.user),
        selectinload(PayrollReceipt.observations),
    )


def _get_receipt(session: Session, receipt_id: str, user: CurrentUser) -> PayrollReceipt:
    rid = _receipt_id_or_404(receipt_id)
    receipt = session.scalar(
        select(PayrollReceipt)
        .options(*_receipt_load_options())
        .where(PayrollReceipt.id == rid)
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Recibo no encontrado")
    if not _can_view_receipt(receipt, user):
        raise HTTPException(status_code=403, detail="No tenes permiso para ver este recibo")
    return receipt


def _mark_viewed_if_needed(session: Session, receipt: PayrollReceipt, user: CurrentUser) -> PayrollReceipt:
    if _employee_username(receipt.employee) != user.username:
        return receipt
    if str(receipt.status or "") != "pendiente" or receipt.viewed_at:
        return receipt
    now = utc_now_dt()
    receipt.status = "visto"
    receipt.viewed_at = now
    receipt.viewed_by_user_id = _current_user_id(session, user)
    receipt.updated_at = now
    session.commit()
    session.refresh(receipt)
    return receipt


def _validate_period(period_year: int, period_month: int) -> None:
    if period_year < 2000 or period_year > 2100 or period_month < 1 or period_month > 12:
        raise HTTPException(status_code=400, detail="Periodo invalido")


def _normalize_receipt_type(value: str) -> str:
    return str(value or "mensual").strip() or "mensual"


def _store_receipt_file(
    *,
    data: bytes,
    file: UploadFile,
    employee: Employee,
    period_year: int,
    period_month: int,
    token: str,
) -> tuple[str, str, str]:
    original_name = _safe_filename(file.filename or "recibo.pdf")
    content_type = (file.content_type or "").lower().strip()
    ext = _extension_for_upload(file, original_name) or ".pdf"
    stored_name = (
        f"{period_year:04d}-{period_month:02d}_"
        f"{_safe_dni(str(employee.dni or '')) or employee.id}_{token[:10]}{ext}"
    )
    target = _period_dir(period_year, period_month) / stored_name
    target.write_bytes(data)
    return original_name, content_type, _relative_upload_path(target)


def _create_receipt(
    session: Session,
    *,
    employee: Employee,
    user: CurrentUser,
    file: UploadFile,
    data: bytes,
    period_year: int,
    period_month: int,
    receipt_type: str,
) -> tuple[PayrollReceipt, str]:
    valid, invalid_message = _file_status_from_upload(file, len(data))
    if not valid:
        raise HTTPException(status_code=400, detail=invalid_message)

    token = uuid.uuid4().hex
    original_name, content_type, relative_path = _store_receipt_file(
        data=data,
        file=file,
        employee=employee,
        period_year=period_year,
        period_month=period_month,
        token=token,
    )
    file_hash = hashlib.sha256(data).hexdigest()
    now = utc_now_dt()
    receipt = PayrollReceipt(
        employee=employee,
        period_year=int(period_year),
        period_month=int(period_month),
        receipt_type=_normalize_receipt_type(receipt_type),
        file_path=relative_path,
        file_name=original_name,
        file_content_type=content_type,
        file_size=len(data),
        file_hash=file_hash,
        status="pendiente",
        uploaded_by_user_id=_current_user_id(session, user),
        created_at=now,
        updated_at=now,
    )
    session.add(receipt)
    session.flush()
    return receipt, file_hash

# Sub-routers (Fase 3.B.2)
# Lifecycle va ultimo porque concentra rutas /receipts/{receipt_id}/...
from . import listing as _listing_module  # noqa: E402
from . import uploads as _uploads_module  # noqa: E402
from . import lifecycle as _lifecycle_module  # noqa: E402

router.include_router(_listing_module.router)
router.include_router(_uploads_module.router)
router.include_router(_lifecycle_module.router)
