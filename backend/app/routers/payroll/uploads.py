"""Sub-router de carga individual y masiva de recibos."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from ...audit import audit
from ...auth import require_current_user
from ...db import db_session
from ...models.employees import PayrollReceipt
from ...users import CurrentUser
from ..notifications import create_notification
from . import (
    PayrollBulkPreviewItem,
    PayrollBulkPreviewResponse,
    PayrollBulkUploadItem,
    PayrollBulkUploadResponse,
    PayrollReceiptOut,
    _UserLookup,
    _active_duplicate_receipt,
    _active_duplicate_receipt_ids,
    _create_receipt,
    _detect_dni_from_filename,
    _employee_name,
    _employee_username,
    _file_status_from_upload,
    _find_employee,
    _mapping_for_file,
    _normalize_receipt_type,
    _parse_bulk_mappings,
    _receipt_to_out,
    _safe_dni,
    _safe_filename,
    _validate_period,
    utc_now_dt,
)


router = APIRouter(tags=["payroll"])


@router.post("/receipts", response_model=PayrollReceiptOut)
async def upload_receipt(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    file: Annotated[UploadFile, File(...)],
    period_year: Annotated[int, Form(...)],
    period_month: Annotated[int, Form(...)],
    employee_id: Annotated[str, Form()] = "",
    employee_username: Annotated[str, Form()] = "",
    employee_dni: Annotated[str, Form()] = "",
    receipt_type: Annotated[str, Form()] = "mensual",
):
    if not user.has("payroll_receipts.upload"):
        raise HTTPException(status_code=403, detail="No tenes permiso para subir recibos")
    _validate_period(period_year, period_month)

    with db_session() as session:
        employee = _find_employee(
            session,
            employee_id=employee_id,
            username=employee_username,
            dni=employee_dni,
        )
        if not employee:
            raise HTTPException(
                status_code=404,
                detail="Empleado no encontrado. Revisa DNI, usuario o empleado seleccionado.",
            )
        data = await file.read()
        receipt, file_hash = _create_receipt(
            session,
            employee=employee,
            user=user,
            file=file,
            data=data,
            period_year=period_year,
            period_month=period_month,
            receipt_type=receipt_type,
        )
        session.commit()
        lookup = _UserLookup(session)
        out = _receipt_to_out(receipt, lookup)

    if out.employee_username:
        create_notification(
            out.employee_username,
            "Nuevo recibo de sueldo",
            f"Tenes disponible el recibo {period_month:02d}/{period_year}. Revisalo y firma conformidad u observa si corresponde.",
            "payroll",
            entity_type="payroll_receipt",
            entity_id=out.id,
            link_url="/recibos",
        )
    audit(
        "payroll.receipt_upload",
        user=user,
        resource_type="payroll_receipt",
        resource_id=out.id,
        message="Recibo de sueldo cargado",
        details={
            "employee_username": out.employee_username,
            "period": f"{period_year:04d}-{period_month:02d}",
            "file_hash": file_hash,
        },
    )
    return out


@router.post("/receipts/bulk/preview", response_model=PayrollBulkPreviewResponse)
async def preview_bulk_receipts(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    files: Annotated[list[UploadFile], File(...)],
    period_year: Annotated[int, Form(...)],
    period_month: Annotated[int, Form(...)],
    receipt_type: Annotated[str, Form()] = "mensual",
    mappings_json: Annotated[str, Form()] = "{}",
):
    if not (user.has("payroll_receipts.bulk_upload") or user.has("payroll_receipts.upload")):
        raise HTTPException(status_code=403, detail="No tenes permiso para carga masiva de recibos")
    _validate_period(period_year, period_month)
    if not files:
        raise HTTPException(status_code=400, detail="Subi al menos un archivo")
    if len(files) > 250:
        raise HTTPException(status_code=400, detail="Demasiados archivos. Maximo recomendado: 250 por tanda.")

    mappings = _parse_bulk_mappings(mappings_json)
    items: list[PayrollBulkPreviewItem] = []
    with db_session() as session:
        for file in files:
            original_name = _safe_filename(file.filename or "recibo.pdf")
            data = await file.read()
            size = len(data)
            await file.seek(0)
            valid, invalid_message = _file_status_from_upload(file, size)
            mapping = _mapping_for_file(mappings, file.filename or original_name)
            dni = _safe_dni(mapping.get("dni") or "") or _detect_dni_from_filename(original_name)
            employee = (
                _find_employee(
                    session,
                    employee_id=mapping.get("employee_id", ""),
                    username=mapping.get("username", ""),
                    dni=dni,
                )
                if dni or mapping.get("employee_id") or mapping.get("username")
                else None
            )
            duplicate = (
                _active_duplicate_receipt(session, int(employee.id), period_year, period_month, receipt_type)
                if employee
                else None
            )

            if not valid:
                status_value, message, can_upload = "invalido", invalid_message, False
            elif not dni and not employee:
                status_value, message, can_upload = (
                    "sin_dni",
                    "No se detecto DNI en el nombre. Escribilo manualmente antes de confirmar.",
                    False,
                )
            elif not employee:
                status_value, message, can_upload = "empleado_no_encontrado", f"No existe empleado con DNI {dni}.", False
            elif duplicate:
                status_value, message, can_upload = (
                    "duplicado",
                    "Ya existe un recibo activo para ese empleado, periodo y tipo. Elegi saltar, reemplazar o mantener ambos al confirmar.",
                    True,
                )
            else:
                status_value, message, can_upload = "listo", "Listo para cargar.", True

            items.append(
                PayrollBulkPreviewItem(
                    file_name=original_name,
                    file_size=size,
                    content_type=str(file.content_type or ""),
                    detected_dni=dni,
                    employee_id=str(employee.id or "") if employee else "",
                    employee_username=_employee_username(employee) if employee else "",
                    employee_name=_employee_name(employee) if employee else "",
                    employee_dni=str(employee.dni or "") if employee else dni,
                    duplicate_receipt_id=str(duplicate.id or "") if duplicate else "",
                    duplicate_status=str(duplicate.status or "") if duplicate else "",
                    status=status_value,
                    message=message,
                    can_upload=can_upload,
                )
            )

    return PayrollBulkPreviewResponse(
        items=items,
        total=len(items),
        ready=sum(1 for item in items if item.can_upload),
        missing_dni=sum(1 for item in items if item.status == "sin_dni"),
        not_found=sum(1 for item in items if item.status == "empleado_no_encontrado"),
        duplicates=sum(1 for item in items if item.status == "duplicado"),
        invalid=sum(1 for item in items if item.status == "invalido"),
    )


@router.post("/receipts/bulk/upload", response_model=PayrollBulkUploadResponse)
async def upload_bulk_receipts(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    files: Annotated[list[UploadFile], File(...)],
    period_year: Annotated[int, Form(...)],
    period_month: Annotated[int, Form(...)],
    receipt_type: Annotated[str, Form()] = "mensual",
    duplicate_strategy: Annotated[str, Form()] = "skip",
    mappings_json: Annotated[str, Form()] = "{}",
):
    if not (user.has("payroll_receipts.bulk_upload") or user.has("payroll_receipts.upload")):
        raise HTTPException(status_code=403, detail="No tenes permiso para carga masiva de recibos")
    _validate_period(period_year, period_month)
    strategy = str(duplicate_strategy or "skip").strip()
    if strategy not in {"skip", "replace", "keep_both"}:
        raise HTTPException(status_code=400, detail="Estrategia de duplicados invalida")
    if not files:
        raise HTTPException(status_code=400, detail="Subi al menos un archivo")
    if len(files) > 250:
        raise HTTPException(status_code=400, detail="Demasiados archivos. Maximo recomendado: 250 por tanda.")

    mappings = _parse_bulk_mappings(mappings_json)
    items: list[PayrollBulkUploadItem] = []
    notifications: list[tuple[str, str, str]] = []
    normalized_type = _normalize_receipt_type(receipt_type)

    with db_session() as session:
        for file in files:
            original_name = _safe_filename(file.filename or "recibo.pdf")
            mapping = _mapping_for_file(mappings, file.filename or original_name)
            dni = _safe_dni(mapping.get("dni") or "") or _detect_dni_from_filename(original_name)
            employee = (
                _find_employee(
                    session,
                    employee_id=mapping.get("employee_id", ""),
                    username=mapping.get("username", ""),
                    dni=dni,
                )
                if dni or mapping.get("employee_id") or mapping.get("username")
                else None
            )
            if not dni and not employee:
                items.append(
                    PayrollBulkUploadItem(
                        file_name=original_name,
                        status="error",
                        message="No se detecto DNI en el nombre y no se cargo DNI manual.",
                        detected_dni="",
                    )
                )
                continue
            if not employee:
                items.append(
                    PayrollBulkUploadItem(
                        file_name=original_name,
                        status="error",
                        message=f"Empleado no encontrado para DNI {dni}.",
                        detected_dni=dni,
                        employee_dni=dni,
                    )
                )
                continue

            data = await file.read()
            valid, invalid_message = _file_status_from_upload(file, len(data))
            if not valid:
                items.append(
                    PayrollBulkUploadItem(
                        file_name=original_name,
                        status="error",
                        message=invalid_message,
                        detected_dni=dni,
                        employee_id=str(employee.id),
                        employee_name=_employee_name(employee),
                        employee_dni=str(employee.dni or dni),
                    )
                )
                continue

            duplicate_ids = _active_duplicate_receipt_ids(
                session,
                int(employee.id),
                period_year,
                period_month,
                normalized_type,
            )
            if duplicate_ids and strategy == "skip":
                items.append(
                    PayrollBulkUploadItem(
                        file_name=original_name,
                        status="skipped_duplicate",
                        message="Saltado: ya existia un recibo activo para ese periodo.",
                        detected_dni=dni,
                        employee_id=str(employee.id),
                        employee_username=_employee_username(employee),
                        employee_name=_employee_name(employee),
                        employee_dni=str(employee.dni or dni),
                        duplicate_receipt_id=str(duplicate_ids[0]),
                    )
                )
                continue

            receipt, file_hash = _create_receipt(
                session,
                employee=employee,
                user=user,
                file=file,
                data=data,
                period_year=period_year,
                period_month=period_month,
                receipt_type=normalized_type,
            )
            replaced_count = 0
            if duplicate_ids and strategy == "replace":
                now = utc_now_dt()
                duplicates = session.scalars(
                    select(PayrollReceipt).where(PayrollReceipt.id.in_(duplicate_ids))
                ).all()
                for duplicate in duplicates:
                    duplicate.status = "reemplazado"
                    duplicate.replaced_by_receipt_id = receipt.id
                    duplicate.updated_at = now
                replaced_count = len(duplicates)

            session.commit()
            employee_username = _employee_username(employee)
            notifications.append(
                (
                    employee_username,
                    str(receipt.id),
                    f"Tenes disponible el recibo {period_month:02d}/{period_year}. Revisalo y firma conformidad u observa si corresponde.",
                )
            )
            items.append(
                PayrollBulkUploadItem(
                    file_name=original_name,
                    detected_dni=dni,
                    employee_id=str(employee.id),
                    employee_username=employee_username,
                    employee_name=_employee_name(employee),
                    employee_dni=str(employee.dni or dni),
                    receipt_id=str(receipt.id),
                    duplicate_receipt_id=str(duplicate_ids[0]) if duplicate_ids else "",
                    status="uploaded_replaced" if replaced_count else "uploaded",
                    message="Cargado y reemplazo recibo anterior." if replaced_count else "Recibo cargado correctamente.",
                )
            )
            audit(
                "payroll.receipt_bulk_item_upload",
                user=user,
                resource_type="payroll_receipt",
                resource_id=str(receipt.id),
                message="Recibo cargado en tanda masiva",
                details={
                    "employee_username": employee_username,
                    "period": f"{period_year:04d}-{period_month:02d}",
                    "file_hash": file_hash,
                    "duplicate_strategy": strategy,
                    "replaced": replaced_count,
                },
            )

    for username, receipt_id, text in notifications:
        if username:
            create_notification(
                username,
                "Nuevo recibo de sueldo",
                text,
                "payroll",
                entity_type="payroll_receipt",
                entity_id=receipt_id,
                link_url="/recibos",
            )
    audit(
        "payroll.receipt_bulk_upload",
        user=user,
        resource_type="payroll_receipt",
        resource_id="bulk",
        message="Carga masiva de recibos procesada",
        details={
            "period": f"{period_year:04d}-{period_month:02d}",
            "total": len(items),
            "uploaded": sum(1 for item in items if item.status.startswith("uploaded")),
            "strategy": strategy,
        },
    )
    return PayrollBulkUploadResponse(
        items=items,
        total=len(items),
        uploaded=sum(1 for item in items if item.status.startswith("uploaded")),
        skipped=sum(1 for item in items if item.status.startswith("skipped")),
        errors=sum(1 for item in items if item.status == "error"),
        replaced=sum(1 for item in items if item.status == "uploaded_replaced"),
    )

