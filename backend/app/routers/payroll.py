from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..audit import audit
from ..auth import require_current_user
from ..config import get_settings
from ..routers.notifications import create_notification
from ..users import CurrentUser

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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            dni TEXT UNIQUE,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            personal_email TEXT NOT NULL DEFAULT '',
            position TEXT NOT NULL DEFAULT '',
            company_id TEXT NOT NULL DEFAULT '',
            branch_id TEXT NOT NULL DEFAULT '',
            photo_url TEXT NOT NULL DEFAULT '',
            photo_status TEXT NOT NULL DEFAULT 'sin_foto',
            status TEXT NOT NULL DEFAULT 'activo',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS payroll_receipts (
            id TEXT PRIMARY KEY,
            employee_id TEXT NOT NULL,
            employee_username TEXT NOT NULL DEFAULT '',
            employee_dni TEXT NOT NULL DEFAULT '',
            employee_name TEXT NOT NULL DEFAULT '',
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            receipt_type TEXT NOT NULL DEFAULT 'mensual',
            file_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_content_type TEXT NOT NULL DEFAULT '',
            file_size INTEGER NOT NULL DEFAULT 0,
            file_hash TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pendiente',
            uploaded_by TEXT NOT NULL DEFAULT '',
            uploaded_by_name TEXT NOT NULL DEFAULT '',
            uploaded_at TEXT NOT NULL,
            viewed_at TEXT NOT NULL DEFAULT '',
            viewed_by TEXT NOT NULL DEFAULT '',
            signed_at TEXT NOT NULL DEFAULT '',
            signed_by TEXT NOT NULL DEFAULT '',
            observed_at TEXT NOT NULL DEFAULT '',
            cancelled_at TEXT NOT NULL DEFAULT '',
            cancelled_by TEXT NOT NULL DEFAULT '',
            cancel_reason TEXT NOT NULL DEFAULT '',
            replaced_by_receipt_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll_receipts(employee_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_username ON payroll_receipts(employee_username)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_receipts(period_year, period_month)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_receipts(status)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS payroll_receipt_observations (
            id TEXT PRIMARY KEY,
            receipt_id TEXT NOT NULL,
            employee_id TEXT NOT NULL DEFAULT '',
            employee_username TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'abierta',
            created_at TEXT NOT NULL,
            answered_by TEXT NOT NULL DEFAULT '',
            answered_by_name TEXT NOT NULL DEFAULT '',
            answered_at TEXT NOT NULL DEFAULT '',
            answer_message TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(receipt_id) REFERENCES payroll_receipts(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_obs_receipt ON payroll_receipt_observations(receipt_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_obs_status ON payroll_receipt_observations(status)")


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
        # Priorizar el primer grupo con formato de DNI argentino razonable.
        return _safe_dni(candidates[0])
    compact = _safe_dni(base)
    if 7 <= len(compact) <= 9:
        return compact
    return ""


def _file_status_from_upload(file: UploadFile, size: int) -> tuple[bool, str]:
    original_name = _safe_filename(file.filename or "recibo.pdf")
    content_type = (file.content_type or "").lower().strip()
    ext = ALLOWED_CONTENT_TYPES.get(content_type) or (Path(original_name).suffix.lower() if Path(original_name).suffix.lower() in ALLOWED_EXTENSIONS else "")
    if not ext:
        return False, "Formato no permitido. Usá PDF, JPG, PNG o WEBP."
    if size <= 0:
        return False, "El archivo está vacío."
    if size > MAX_RECEIPT_BYTES:
        return False, "Archivo demasiado pesado. Máximo permitido: 15 MB."
    return True, ""


def _active_duplicate_receipt(conn: sqlite3.Connection, employee_id: str, period_year: int, period_month: int, receipt_type: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM payroll_receipts
        WHERE employee_id = ? AND period_year = ? AND period_month = ? AND receipt_type = ?
          AND status NOT IN ('anulado', 'reemplazado')
        ORDER BY uploaded_at DESC
        LIMIT 1
        """,
        (employee_id, int(period_year), int(period_month), str(receipt_type or "mensual")),
    ).fetchone()


def _active_duplicate_receipt_ids(conn: sqlite3.Connection, employee_id: str, period_year: int, period_month: int, receipt_type: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT id FROM payroll_receipts
        WHERE employee_id = ? AND period_year = ? AND period_month = ? AND receipt_type = ?
          AND status NOT IN ('anulado', 'reemplazado')
        ORDER BY uploaded_at DESC
        """,
        (employee_id, int(period_year), int(period_month), str(receipt_type or "mensual")),
    ).fetchall()
    return [str(row["id"]) for row in rows]


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


def _employee_name(row: sqlite3.Row) -> str:
    return str(row["display_name"] or "").strip() or " ".join([str(row["first_name"] or "").strip(), str(row["last_name"] or "").strip()]).strip() or str(row["username"] or row["dni"] or "Empleado")


def find_employee(conn: sqlite3.Connection, *, employee_id: str = "", username: str = "", dni: str = "") -> sqlite3.Row | None:
    ensure_tables(conn)
    if employee_id:
        row = conn.execute("SELECT * FROM employees WHERE id = ?", (employee_id,)).fetchone()
        if row:
            return row
    if username:
        row = conn.execute("SELECT * FROM employees WHERE username = ?", (username,)).fetchone()
        if row:
            return row
    clean_dni = _safe_dni(dni)
    if clean_dni:
        row = conn.execute("SELECT * FROM employees WHERE dni = ?", (clean_dni,)).fetchone()
        if row:
            return row
    return None


def _observation_from_row(row: sqlite3.Row) -> PayrollObservationOut:
    return PayrollObservationOut(
        id=str(row["id"]),
        receipt_id=str(row["receipt_id"]),
        employee_id=str(row["employee_id"] or ""),
        employee_username=str(row["employee_username"] or ""),
        message=str(row["message"] or ""),
        status=str(row["status"] or "abierta"),
        created_at=str(row["created_at"] or ""),
        answered_by=str(row["answered_by"] or ""),
        answered_by_name=str(row["answered_by_name"] or ""),
        answered_at=str(row["answered_at"] or ""),
        answer_message=str(row["answer_message"] or ""),
    )


def _observations_for_receipt(conn: sqlite3.Connection, receipt_id: str) -> list[PayrollObservationOut]:
    rows = conn.execute(
        "SELECT * FROM payroll_receipt_observations WHERE receipt_id = ? ORDER BY created_at DESC",
        (receipt_id,),
    ).fetchall()
    return [_observation_from_row(row) for row in rows]


def _receipt_from_row(row: sqlite3.Row, observations: list[PayrollObservationOut] | None = None) -> PayrollReceiptOut:
    return PayrollReceiptOut(
        id=str(row["id"]),
        employee_id=str(row["employee_id"] or ""),
        employee_username=str(row["employee_username"] or ""),
        employee_dni=str(row["employee_dni"] or ""),
        employee_name=str(row["employee_name"] or ""),
        period_year=int(row["period_year"]),
        period_month=int(row["period_month"]),
        receipt_type=str(row["receipt_type"] or "mensual"),
        file_name=str(row["file_name"] or "recibo"),
        file_content_type=str(row["file_content_type"] or ""),
        file_size=int(row["file_size"] or 0),
        file_hash=str(row["file_hash"] or ""),
        status=str(row["status"] or "pendiente"),
        uploaded_by=str(row["uploaded_by"] or ""),
        uploaded_by_name=str(row["uploaded_by_name"] or ""),
        uploaded_at=str(row["uploaded_at"] or ""),
        viewed_at=str(row["viewed_at"] or ""),
        viewed_by=str(row["viewed_by"] or ""),
        signed_at=str(row["signed_at"] or ""),
        signed_by=str(row["signed_by"] or ""),
        observed_at=str(row["observed_at"] or ""),
        cancelled_at=str(row["cancelled_at"] or ""),
        cancelled_by=str(row["cancelled_by"] or ""),
        cancel_reason=str(row["cancel_reason"] or ""),
        replaced_by_receipt_id=str(row["replaced_by_receipt_id"] or ""),
        created_at=str(row["created_at"] or ""),
        updated_at=str(row["updated_at"] or ""),
        observations=observations or [],
    )


def _can_view_row(row: sqlite3.Row, user: CurrentUser) -> bool:
    if user.has("payroll_receipts.view_all"):
        return True
    return user.has("payroll_receipts.view_own") and str(row["employee_username"] or "") == user.username


def _require_any(user: CurrentUser, permissions: list[str]) -> None:
    if not any(user.has(permission) for permission in permissions):
        raise HTTPException(status_code=403, detail="No tenés permiso para esta sección")


def _get_receipt_row(conn: sqlite3.Connection, receipt_id: str, user: CurrentUser) -> sqlite3.Row:
    ensure_tables(conn)
    row = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (receipt_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Recibo no encontrado")
    if not _can_view_row(row, user):
        raise HTTPException(status_code=403, detail="No tenés permiso para ver este recibo")
    return row


def _mark_viewed_if_needed(conn: sqlite3.Connection, row: sqlite3.Row, user: CurrentUser) -> sqlite3.Row:
    if str(row["employee_username"] or "") != user.username:
        return row
    if str(row["status"] or "") != "pendiente" or str(row["viewed_at"] or ""):
        return row
    now = utc_now()
    conn.execute(
        "UPDATE payroll_receipts SET status = 'visto', viewed_at = ?, viewed_by = ?, updated_at = ? WHERE id = ? AND status = 'pendiente'",
        (now, user.username, now, row["id"]),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (row["id"],)).fetchone()
    return updated or row


@router.get("/receipts", response_model=PayrollReceiptListResponse)
def list_receipts(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    scope: str = Query(default="auto"),
    status: str = Query(default=""),
    q: str = Query(default=""),
    period_year: int | None = None,
    period_month: int | None = None,
    limit: int = Query(default=100, ge=1, le=300),
):
    _require_any(user, ["payroll_receipts.view_own", "payroll_receipts.view_all"])
    with connect() as conn:
        ensure_tables(conn)
        params: list[Any] = []
        where: list[str] = []
        show_all = user.has("payroll_receipts.view_all") and scope in {"auto", "all"}
        if not show_all:
            where.append("employee_username = ?")
            params.append(user.username)
        if status:
            where.append("status = ?")
            params.append(status)
        if period_year:
            where.append("period_year = ?")
            params.append(int(period_year))
        if period_month:
            where.append("period_month = ?")
            params.append(int(period_month))
        if q.strip():
            text = f"%{q.strip()}%"
            where.append("(employee_name LIKE ? OR employee_dni LIKE ? OR file_name LIKE ? OR employee_username LIKE ?)")
            params.extend([text, text, text, text])
        query = "SELECT * FROM payroll_receipts"
        if where:
            query += " WHERE " + " AND ".join(where)
        query += " ORDER BY period_year DESC, period_month DESC, uploaded_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        items = [_receipt_from_row(row) for row in rows]
    return PayrollReceiptListResponse(
        items=items,
        total=len(items),
        pending=sum(1 for item in items if item.status in {"pendiente", "visto"}),
        signed=sum(1 for item in items if item.status == "firmado_conforme"),
        observed=sum(1 for item in items if item.status == "observado"),
    )


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
        raise HTTPException(status_code=403, detail="No tenés permiso para subir recibos")
    if period_year < 2000 or period_year > 2100 or period_month < 1 or period_month > 12:
        raise HTTPException(status_code=400, detail="Período inválido")
    with connect() as conn:
        ensure_tables(conn)
        employee = find_employee(conn, employee_id=employee_id, username=employee_username, dni=employee_dni)
        if not employee:
            raise HTTPException(status_code=404, detail="Empleado no encontrado. Revisá DNI, usuario o empleado seleccionado.")
        content_type = (file.content_type or "").lower().strip()
        original_name = _safe_filename(file.filename or "recibo.pdf")
        ext = ALLOWED_CONTENT_TYPES.get(content_type) or (Path(original_name).suffix.lower() if Path(original_name).suffix.lower() in ALLOWED_EXTENSIONS else "")
        if not ext:
            raise HTTPException(status_code=400, detail="Formato no permitido. Usá PDF, JPG, PNG o WEBP.")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="El archivo está vacío")
        if len(data) > MAX_RECEIPT_BYTES:
            raise HTTPException(status_code=400, detail="Archivo demasiado pesado. Máximo permitido: 15 MB.")
        file_hash = hashlib.sha256(data).hexdigest()
        receipt_id = uuid.uuid4().hex
        stored_name = f"{period_year:04d}-{period_month:02d}_{_safe_dni(str(employee['dni'] or '')) or employee['id']}_{receipt_id[:10]}{ext}"
        target = _period_dir(period_year, period_month) / stored_name
        target.write_bytes(data)
        now = utc_now()
        payload = {
            "id": receipt_id,
            "employee_id": str(employee["id"]),
            "employee_username": str(employee["username"] or ""),
            "employee_dni": str(employee["dni"] or ""),
            "employee_name": _employee_name(employee),
            "period_year": period_year,
            "period_month": period_month,
            "receipt_type": str(receipt_type or "mensual").strip() or "mensual",
            "file_path": _relative_upload_path(target),
            "file_name": original_name,
            "file_content_type": content_type,
            "file_size": len(data),
            "file_hash": file_hash,
            "status": "pendiente",
            "uploaded_by": user.username,
            "uploaded_by_name": user.display_name,
            "uploaded_at": now,
            "created_at": now,
            "updated_at": now,
        }
        conn.execute(
            """
            INSERT INTO payroll_receipts (id, employee_id, employee_username, employee_dni, employee_name, period_year, period_month, receipt_type, file_path, file_name, file_content_type, file_size, file_hash, status, uploaded_by, uploaded_by_name, uploaded_at, created_at, updated_at)
            VALUES (:id, :employee_id, :employee_username, :employee_dni, :employee_name, :period_year, :period_month, :receipt_type, :file_path, :file_name, :file_content_type, :file_size, :file_hash, :status, :uploaded_by, :uploaded_by_name, :uploaded_at, :created_at, :updated_at)
            """,
            payload,
        )
        conn.commit()
        row = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (receipt_id,)).fetchone()
    if payload["employee_username"]:
        create_notification(
            payload["employee_username"],
            "Nuevo recibo de sueldo",
            f"Tenés disponible el recibo {period_month:02d}/{period_year}. Revisalo y firmá conformidad u observá si corresponde.",
            "payroll",
        )
    audit("payroll.receipt_upload", user=user, resource_type="payroll_receipt", resource_id=receipt_id, message="Recibo de sueldo cargado", details={"employee_username": payload["employee_username"], "period": f"{period_year:04d}-{period_month:02d}", "file_hash": file_hash})
    return _receipt_from_row(row)


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
        raise HTTPException(status_code=403, detail="No tenés permiso para carga masiva de recibos")
    if period_year < 2000 or period_year > 2100 or period_month < 1 or period_month > 12:
        raise HTTPException(status_code=400, detail="Período inválido")
    if not files:
        raise HTTPException(status_code=400, detail="Subí al menos un archivo")
    if len(files) > 250:
        raise HTTPException(status_code=400, detail="Demasiados archivos. Máximo recomendado: 250 por tanda.")
    mappings = _parse_bulk_mappings(mappings_json)
    items: list[PayrollBulkPreviewItem] = []
    with connect() as conn:
        ensure_tables(conn)
        for file in files:
            original_name = _safe_filename(file.filename or "recibo.pdf")
            data = await file.read()
            size = len(data)
            await file.seek(0)
            valid, invalid_message = _file_status_from_upload(file, size)
            mapping = _mapping_for_file(mappings, file.filename or original_name)
            dni = _safe_dni(mapping.get("dni") or "") or _detect_dni_from_filename(original_name)
            employee = find_employee(conn, employee_id=mapping.get("employee_id", ""), username=mapping.get("username", ""), dni=dni) if dni or mapping.get("employee_id") or mapping.get("username") else None
            duplicate = _active_duplicate_receipt(conn, str(employee["id"]), period_year, period_month, receipt_type) if employee else None
            if not valid:
                status_value, message, can_upload = "invalido", invalid_message, False
            elif not dni and not employee:
                status_value, message, can_upload = "sin_dni", "No se detectó DNI en el nombre. Escribilo manualmente antes de confirmar.", False
            elif not employee:
                status_value, message, can_upload = "empleado_no_encontrado", f"No existe empleado con DNI {dni}.", False
            elif duplicate:
                status_value, message, can_upload = "duplicado", "Ya existe un recibo activo para ese empleado, período y tipo. Elegí saltar, reemplazar o mantener ambos al confirmar.", True
            else:
                status_value, message, can_upload = "listo", "Listo para cargar.", True
            items.append(PayrollBulkPreviewItem(
                file_name=original_name,
                file_size=size,
                content_type=str(file.content_type or ""),
                detected_dni=dni,
                employee_id=str(employee["id"] or "") if employee else "",
                employee_username=str(employee["username"] or "") if employee else "",
                employee_name=_employee_name(employee) if employee else "",
                employee_dni=str(employee["dni"] or "") if employee else dni,
                duplicate_receipt_id=str(duplicate["id"] or "") if duplicate else "",
                duplicate_status=str(duplicate["status"] or "") if duplicate else "",
                status=status_value,
                message=message,
                can_upload=can_upload,
            ))
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
        raise HTTPException(status_code=403, detail="No tenés permiso para carga masiva de recibos")
    if period_year < 2000 or period_year > 2100 or period_month < 1 or period_month > 12:
        raise HTTPException(status_code=400, detail="Período inválido")
    strategy = str(duplicate_strategy or "skip").strip()
    if strategy not in {"skip", "replace", "keep_both"}:
        raise HTTPException(status_code=400, detail="Estrategia de duplicados inválida")
    if not files:
        raise HTTPException(status_code=400, detail="Subí al menos un archivo")
    if len(files) > 250:
        raise HTTPException(status_code=400, detail="Demasiados archivos. Máximo recomendado: 250 por tanda.")
    mappings = _parse_bulk_mappings(mappings_json)
    items: list[PayrollBulkUploadItem] = []
    notifications: list[tuple[str, str]] = []
    with connect() as conn:
        ensure_tables(conn)
        for file in files:
            original_name = _safe_filename(file.filename or "recibo.pdf")
            mapping = _mapping_for_file(mappings, file.filename or original_name)
            dni = _safe_dni(mapping.get("dni") or "") or _detect_dni_from_filename(original_name)
            employee = find_employee(conn, employee_id=mapping.get("employee_id", ""), username=mapping.get("username", ""), dni=dni) if dni or mapping.get("employee_id") or mapping.get("username") else None
            if not dni and not employee:
                items.append(PayrollBulkUploadItem(file_name=original_name, status="error", message="No se detectó DNI en el nombre y no se cargó DNI manual.", detected_dni=""))
                continue
            if not employee:
                items.append(PayrollBulkUploadItem(file_name=original_name, status="error", message=f"Empleado no encontrado para DNI {dni}.", detected_dni=dni, employee_dni=dni))
                continue
            data = await file.read()
            valid, invalid_message = _file_status_from_upload(file, len(data))
            if not valid:
                items.append(PayrollBulkUploadItem(file_name=original_name, status="error", message=invalid_message, detected_dni=dni, employee_id=str(employee["id"]), employee_name=_employee_name(employee), employee_dni=str(employee["dni"] or dni)))
                continue
            duplicates = _active_duplicate_receipt_ids(conn, str(employee["id"]), period_year, period_month, receipt_type)
            if duplicates and strategy == "skip":
                items.append(PayrollBulkUploadItem(file_name=original_name, status="skipped_duplicate", message="Saltado: ya existía un recibo activo para ese período.", detected_dni=dni, employee_id=str(employee["id"]), employee_username=str(employee["username"] or ""), employee_name=_employee_name(employee), employee_dni=str(employee["dni"] or dni), duplicate_receipt_id=duplicates[0]))
                continue
            content_type = (file.content_type or "").lower().strip()
            ext = ALLOWED_CONTENT_TYPES.get(content_type) or Path(original_name).suffix.lower() or ".pdf"
            file_hash = hashlib.sha256(data).hexdigest()
            receipt_id = uuid.uuid4().hex
            stored_name = f"{period_year:04d}-{period_month:02d}_{_safe_dni(str(employee['dni'] or '')) or employee['id']}_{receipt_id[:10]}{ext}"
            target = _period_dir(period_year, period_month) / stored_name
            target.write_bytes(data)
            now = utc_now()
            payload = {
                "id": receipt_id,
                "employee_id": str(employee["id"]),
                "employee_username": str(employee["username"] or ""),
                "employee_dni": str(employee["dni"] or dni),
                "employee_name": _employee_name(employee),
                "period_year": period_year,
                "period_month": period_month,
                "receipt_type": str(receipt_type or "mensual").strip() or "mensual",
                "file_path": _relative_upload_path(target),
                "file_name": original_name,
                "file_content_type": content_type,
                "file_size": len(data),
                "file_hash": file_hash,
                "status": "pendiente",
                "uploaded_by": user.username,
                "uploaded_by_name": user.display_name,
                "uploaded_at": now,
                "created_at": now,
                "updated_at": now,
            }
            conn.execute(
                """
                INSERT INTO payroll_receipts (id, employee_id, employee_username, employee_dni, employee_name, period_year, period_month, receipt_type, file_path, file_name, file_content_type, file_size, file_hash, status, uploaded_by, uploaded_by_name, uploaded_at, created_at, updated_at)
                VALUES (:id, :employee_id, :employee_username, :employee_dni, :employee_name, :period_year, :period_month, :receipt_type, :file_path, :file_name, :file_content_type, :file_size, :file_hash, :status, :uploaded_by, :uploaded_by_name, :uploaded_at, :created_at, :updated_at)
                """,
                payload,
            )
            replaced_count = 0
            if duplicates and strategy == "replace":
                conn.execute(
                    f"UPDATE payroll_receipts SET status = 'reemplazado', replaced_by_receipt_id = ?, updated_at = ? WHERE id IN ({','.join(['?'] * len(duplicates))})",
                    [receipt_id, now, *duplicates],
                )
                replaced_count = len(duplicates)
            conn.commit()
            notifications.append((payload["employee_username"], f"Tenés disponible el recibo {period_month:02d}/{period_year}. Revisalo y firmá conformidad u observá si corresponde."))
            items.append(PayrollBulkUploadItem(
                file_name=original_name,
                detected_dni=dni,
                employee_id=str(employee["id"]),
                employee_username=str(employee["username"] or ""),
                employee_name=_employee_name(employee),
                employee_dni=str(employee["dni"] or dni),
                receipt_id=receipt_id,
                duplicate_receipt_id=duplicates[0] if duplicates else "",
                status="uploaded_replaced" if replaced_count else "uploaded",
                message="Cargado y reemplazó recibo anterior." if replaced_count else "Recibo cargado correctamente.",
            ))
            audit("payroll.receipt_bulk_item_upload", user=user, resource_type="payroll_receipt", resource_id=receipt_id, message="Recibo cargado en tanda masiva", details={"employee_username": payload["employee_username"], "period": f"{period_year:04d}-{period_month:02d}", "file_hash": file_hash, "duplicate_strategy": strategy, "replaced": replaced_count})
    for username, text in notifications:
        if username:
            create_notification(username, "Nuevo recibo de sueldo", text, "payroll")
    audit("payroll.receipt_bulk_upload", user=user, resource_type="payroll_receipt", resource_id="bulk", message="Carga masiva de recibos procesada", details={"period": f"{period_year:04d}-{period_month:02d}", "total": len(items), "uploaded": sum(1 for item in items if item.status.startswith("uploaded")), "strategy": strategy})
    return PayrollBulkUploadResponse(
        items=items,
        total=len(items),
        uploaded=sum(1 for item in items if item.status.startswith("uploaded")),
        skipped=sum(1 for item in items if item.status.startswith("skipped")),
        errors=sum(1 for item in items if item.status == "error"),
        replaced=sum(1 for item in items if item.status == "uploaded_replaced"),
    )


@router.get("/receipts/{receipt_id}", response_model=PayrollReceiptOut)
def receipt_detail(receipt_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    _require_any(user, ["payroll_receipts.view_own", "payroll_receipts.view_all"])
    with connect() as conn:
        row = _get_receipt_row(conn, receipt_id, user)
        row = _mark_viewed_if_needed(conn, row, user)
        observations = _observations_for_receipt(conn, receipt_id)
        return _receipt_from_row(row, observations)


@router.get("/receipts/{receipt_id}/file")
def receipt_file(receipt_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    _require_any(user, ["payroll_receipts.view_own", "payroll_receipts.view_all"])
    with connect() as conn:
        row = _get_receipt_row(conn, receipt_id, user)
        row = _mark_viewed_if_needed(conn, row, user)
        path = _path_from_upload_value(str(row["file_path"] or ""))
        if not path or not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="No se encontró el archivo del recibo")
        return FileResponse(path, filename=str(row["file_name"] or path.name), media_type=str(row["file_content_type"] or "application/octet-stream"))


@router.post("/receipts/{receipt_id}/sign", response_model=PayrollReceiptOut)
def sign_receipt(receipt_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    if not user.has("payroll_receipts.sign_own"):
        raise HTTPException(status_code=403, detail="No tenés permiso para firmar recibos")
    with connect() as conn:
        row = _get_receipt_row(conn, receipt_id, user)
        if str(row["employee_username"] or "") != user.username:
            raise HTTPException(status_code=403, detail="Solo podés firmar tus propios recibos")
        if str(row["status"] or "") in {"anulado", "reemplazado"}:
            raise HTTPException(status_code=400, detail="Este recibo no se puede firmar porque está anulado o reemplazado")
        now = utc_now()
        conn.execute(
            "UPDATE payroll_receipts SET status = 'firmado_conforme', signed_at = ?, signed_by = ?, viewed_at = COALESCE(NULLIF(viewed_at, ''), ?), viewed_by = COALESCE(NULLIF(viewed_by, ''), ?), updated_at = ? WHERE id = ?",
            (now, user.username, now, user.username, now, receipt_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (receipt_id,)).fetchone()
        observations = _observations_for_receipt(conn, receipt_id)
    audit("payroll.receipt_sign", user=user, resource_type="payroll_receipt", resource_id=receipt_id, message="Recibo firmado en conformidad", details={"file_hash": str(updated["file_hash"] or "") if updated else ""})
    return _receipt_from_row(updated, observations)


@router.post("/receipts/{receipt_id}/observe", response_model=PayrollReceiptOut)
def observe_receipt(receipt_id: str, req: PayrollObservationCreate, user: Annotated[CurrentUser, Depends(require_current_user)]):
    if not user.has("payroll_receipts.observe_own"):
        raise HTTPException(status_code=403, detail="No tenés permiso para observar recibos")
    message = str(req.message or "").strip()
    if len(message) < 5:
        raise HTTPException(status_code=400, detail="Escribí una observación más clara")
    with connect() as conn:
        row = _get_receipt_row(conn, receipt_id, user)
        if str(row["employee_username"] or "") != user.username:
            raise HTTPException(status_code=403, detail="Solo podés observar tus propios recibos")
        if str(row["status"] or "") in {"anulado", "reemplazado"}:
            raise HTTPException(status_code=400, detail="Este recibo no se puede observar porque está anulado o reemplazado")
        now = utc_now()
        obs_id = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO payroll_receipt_observations (id, receipt_id, employee_id, employee_username, message, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'abierta', ?)
            """,
            (obs_id, receipt_id, str(row["employee_id"] or ""), user.username, message, now),
        )
        conn.execute(
            "UPDATE payroll_receipts SET status = 'observado', observed_at = ?, viewed_at = COALESCE(NULLIF(viewed_at, ''), ?), viewed_by = COALESCE(NULLIF(viewed_by, ''), ?), updated_at = ? WHERE id = ?",
            (now, now, user.username, now, receipt_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (receipt_id,)).fetchone()
        observations = _observations_for_receipt(conn, receipt_id)
    if row["uploaded_by"]:
        create_notification(str(row["uploaded_by"]), "Recibo observado", f"{row['employee_name']} observó el recibo {int(row['period_month']):02d}/{int(row['period_year'])}.", "payroll")
    audit("payroll.receipt_observe", user=user, resource_type="payroll_receipt", resource_id=receipt_id, message="Recibo observado por empleado", details={"observation_id": obs_id})
    return _receipt_from_row(updated, observations)


@router.post("/receipts/{receipt_id}/observations/respond", response_model=PayrollReceiptOut)
def respond_observation(receipt_id: str, req: PayrollObservationAnswer, user: Annotated[CurrentUser, Depends(require_current_user)]):
    if not user.has("payroll_receipts.respond_observation"):
        raise HTTPException(status_code=403, detail="No tenés permiso para responder observaciones")
    answer = str(req.answer_message or "").strip()
    if len(answer) < 3:
        raise HTTPException(status_code=400, detail="Escribí una respuesta")
    status = str(req.status or "respondida").strip() or "respondida"
    with connect() as conn:
        row = _get_receipt_row(conn, receipt_id, user)
        obs = conn.execute("SELECT * FROM payroll_receipt_observations WHERE id = ? AND receipt_id = ?", (req.observation_id, receipt_id)).fetchone()
        if not obs:
            raise HTTPException(status_code=404, detail="Observación no encontrada")
        now = utc_now()
        conn.execute(
            "UPDATE payroll_receipt_observations SET status = ?, answered_by = ?, answered_by_name = ?, answered_at = ?, answer_message = ? WHERE id = ?",
            (status, user.username, user.display_name, now, answer, req.observation_id),
        )
        conn.execute("UPDATE payroll_receipts SET updated_at = ? WHERE id = ?", (now, receipt_id))
        conn.commit()
        updated = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (receipt_id,)).fetchone()
        observations = _observations_for_receipt(conn, receipt_id)
    if row["employee_username"]:
        create_notification(str(row["employee_username"]), "Respuesta sobre tu recibo", f"Administración respondió una observación del recibo {int(row['period_month']):02d}/{int(row['period_year'])}.", "payroll")
    audit("payroll.observation_respond", user=user, resource_type="payroll_receipt", resource_id=receipt_id, message="Observación de recibo respondida", details={"observation_id": req.observation_id, "status": status})
    return _receipt_from_row(updated, observations)


@router.post("/receipts/{receipt_id}/cancel", response_model=PayrollReceiptOut)
def cancel_receipt(receipt_id: str, req: PayrollCancelRequest, user: Annotated[CurrentUser, Depends(require_current_user)]):
    if not user.has("payroll_receipts.cancel"):
        raise HTTPException(status_code=403, detail="No tenés permiso para anular recibos")
    with connect() as conn:
        row = _get_receipt_row(conn, receipt_id, user)
        now = utc_now()
        conn.execute(
            "UPDATE payroll_receipts SET status = 'anulado', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
            (now, user.username, str(req.reason or "").strip(), now, receipt_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM payroll_receipts WHERE id = ?", (receipt_id,)).fetchone()
        observations = _observations_for_receipt(conn, receipt_id)
    if row["employee_username"]:
        create_notification(str(row["employee_username"]), "Recibo anulado", f"Se anuló el recibo {int(row['period_month']):02d}/{int(row['period_year'])}.", "payroll")
    audit("payroll.receipt_cancel", user=user, resource_type="payroll_receipt", resource_id=receipt_id, message="Recibo anulado", details={"reason": req.reason})
    return _receipt_from_row(updated, observations)
