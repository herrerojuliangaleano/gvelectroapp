from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..audit import audit
from ..auth import require_current_user, require_permission
from ..config import get_settings
from ..schemas import (
    EmployeeCreateRequest,
    EmployeeInfo,
    EmployeeLinkUserRequest,
    EmployeeListResponse,
    EmployeeStatusChangeRequest,
    EmployeeStatusHistoryResponse,
    EmployeeUpdateRequest,
    MeResponse,
    UserInfo,
    UserLinkCandidatesResponse,
)
from ..users import (
    CurrentUser,
    change_employee_status,
    create_standalone_employee,
    get_current_user,
    get_employee_by_id,
    get_employee_by_username,
    get_user,
    link_employee_user,
    list_employee_status_history,
    list_employees,
    load_users,
    search_users_for_link,
    set_employee_photo,
    set_employee_photo_status,
    unlink_employee_user,
    update_employee_by_id,
)

router = APIRouter(prefix="/api/employees", tags=["employees"])

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024


def _safe_username(username: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", username.strip().lower()) or "employee"


def _photo_dir() -> Path:
    path = get_settings().uploads_dir / "employees" / "photos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _photo_path_from_value(value: str) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    # Guardamos ruta relativa dentro de uploads. No aceptamos rutas absolutas externas.
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


def _can_view_employee_photo(current: CurrentUser, username: str) -> bool:
    return current.username == username or current.has("employees.view") or current.has("users.view")


async def _save_uploaded_photo(username: str, file: UploadFile) -> str:
    content_type = (file.content_type or "").lower().strip()
    original_ext = Path(file.filename or "").suffix.lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type) or (original_ext if original_ext in ALLOWED_EXTENSIONS else "")
    if not ext:
        raise HTTPException(status_code=400, detail="Formato no permitido. Usá JPG, PNG o WEBP.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="La imagen está vacía.")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="La imagen pesa demasiado. Máximo permitido: 5 MB.")

    filename = f"{_safe_username(username)}_{uuid.uuid4().hex[:12]}{ext}"
    target = _photo_dir() / filename
    target.write_bytes(data)
    return str(Path("employees") / "photos" / filename)


@router.post("/me/photo", response_model=MeResponse)
async def upload_my_photo(file: Annotated[UploadFile, File(...)], user: Annotated[CurrentUser, Depends(require_current_user)]):
    if user.must_change_password:
        raise HTTPException(status_code=403, detail="Tenés que crear tu contraseña antes de subir la foto profesional")
    if not get_user(user.username):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    photo_value = await _save_uploaded_photo(user.username, file)
    updated_employee = set_employee_photo(user.username, photo_value, "pendiente_aprobacion")
    updated = get_current_user(user.username)
    if not updated:
        raise HTTPException(status_code=400, detail="No se pudo actualizar el usuario")
    audit(
        "employees.photo_upload",
        user=updated,
        resource_type="employee",
        resource_id=updated_employee.get("id") or user.username,
        message="Foto profesional subida y pendiente de aprobación",
        details={"username": user.username, "photo_status": updated_employee.get("photo_status")},
    )
    return MeResponse(**updated.public())


@router.get("/{username}/photo")
def get_employee_photo(username: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    if not _can_view_employee_photo(user, username):
        raise HTTPException(status_code=403, detail="No tenés permiso para ver esta foto")
    employee = get_employee_by_username(username)
    if not employee or not employee.get("photo_url"):
        raise HTTPException(status_code=404, detail="El empleado no tiene foto cargada")
    path = _photo_path_from_value(str(employee.get("photo_url") or ""))
    if not path or not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="No se encontró el archivo de foto")
    return FileResponse(path)


def _admin_user_response(username: str) -> UserInfo:
    record = load_users().get(username)
    if not record:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return UserInfo(**record.public())


@router.post("/{username}/photo/request", response_model=UserInfo)
def request_employee_photo(username: str, user: Annotated[CurrentUser, Depends(require_permission("employees.photo.request"))]):
    employee = set_employee_photo_status(username, "solicitada_nuevamente")
    audit(
        "employees.photo_request",
        user=user,
        resource_type="employee",
        resource_id=employee.get("id") or username,
        message="Se solicitó foto profesional",
        details={"username": username},
    )
    return _admin_user_response(username)


@router.post("/{username}/photo/approve", response_model=UserInfo)
def approve_employee_photo(username: str, user: Annotated[CurrentUser, Depends(require_permission("employees.photo.approve"))]):
    employee = get_employee_by_username(username)
    if not employee or not employee.get("photo_url"):
        raise HTTPException(status_code=400, detail="El empleado todavía no subió una foto")
    employee = set_employee_photo_status(username, "aprobada")
    audit(
        "employees.photo_approve",
        user=user,
        resource_type="employee",
        resource_id=employee.get("id") or username,
        message="Foto profesional aprobada",
        details={"username": username},
    )
    return _admin_user_response(username)


@router.post("/{username}/photo/reject", response_model=UserInfo)
def reject_employee_photo(username: str, user: Annotated[CurrentUser, Depends(require_permission("employees.photo.reject"))]):
    employee = get_employee_by_username(username)
    if not employee:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    employee = set_employee_photo_status(username, "rechazada")
    audit(
        "employees.photo_reject",
        user=user,
        resource_type="employee",
        resource_id=employee.get("id") or username,
        message="Foto profesional rechazada",
        details={"username": username},
    )
    return _admin_user_response(username)


# ──────────────────────────────────────────────────────────────────────────────
# Fase 0 — Empleados como entidad propia (independiente del usuario)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=EmployeeListResponse)
@router.get("/", response_model=EmployeeListResponse)
def list_all_employees(
    _user: Annotated[CurrentUser, Depends(require_permission("employees.view"))],
    q: str = "",
    status: str = "",
    work_branch_id: str = "",
    has_user: str = "",
    limit: int = 500,
):
    items = list_employees(q=q, status=status, work_branch_id=work_branch_id, has_user=has_user, limit=limit)
    return EmployeeListResponse(items=[EmployeeInfo(**it) for it in items], total=len(items))


@router.get("/users/link-candidates", response_model=UserLinkCandidatesResponse)
def employee_link_candidates(
    _user: Annotated[CurrentUser, Depends(require_permission("employees.manage"))],
    q: str = "",
    limit: int = 20,
):
    return UserLinkCandidatesResponse(items=search_users_for_link(q=q, limit=limit))


@router.post("", response_model=EmployeeInfo)
@router.post("/", response_model=EmployeeInfo)
def create_employee(req: EmployeeCreateRequest, user: Annotated[CurrentUser, Depends(require_permission("employees.manage"))]):
    try:
        employee = create_standalone_employee(req.model_dump(exclude_none=True), actor=user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("employees.create", user=user, resource_type="employee", resource_id=employee.get("id") or "", details={"dni": employee.get("dni")})
    return EmployeeInfo(**employee)


@router.get("/{employee_id}", response_model=EmployeeInfo)
def get_employee(employee_id: str, _user: Annotated[CurrentUser, Depends(require_permission("employees.view"))]):
    employee = get_employee_by_id(employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    return EmployeeInfo(**employee)


@router.patch("/{employee_id}", response_model=EmployeeInfo)
def patch_employee(employee_id: str, req: EmployeeUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("employees.manage"))]):
    try:
        employee = update_employee_by_id(employee_id, req.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("employees.update", user=user, resource_type="employee", resource_id=employee_id, details={})
    return EmployeeInfo(**employee)


@router.post("/{employee_id}/link-user", response_model=EmployeeInfo)
def link_user(employee_id: str, req: EmployeeLinkUserRequest, user: Annotated[CurrentUser, Depends(require_permission("employees.manage"))]):
    try:
        employee = link_employee_user(employee_id, req.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("employees.link_user", user=user, resource_type="employee", resource_id=employee_id, details={"username": req.username})
    return EmployeeInfo(**employee)


@router.post("/{employee_id}/unlink-user", response_model=EmployeeInfo)
def unlink_user(employee_id: str, user: Annotated[CurrentUser, Depends(require_permission("employees.manage"))]):
    try:
        employee = unlink_employee_user(employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("employees.unlink_user", user=user, resource_type="employee", resource_id=employee_id, details={})
    return EmployeeInfo(**employee)


@router.post("/{employee_id}/status", response_model=EmployeeInfo)
def change_status(employee_id: str, req: EmployeeStatusChangeRequest, user: Annotated[CurrentUser, Depends(require_permission("employees.manage"))]):
    try:
        employee = change_employee_status(employee_id, req.model_dump(exclude_none=True), actor=user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("employees.status_change", user=user, resource_type="employee", resource_id=employee_id, details={"status": req.status})
    return EmployeeInfo(**employee)


@router.get("/{employee_id}/status-history", response_model=EmployeeStatusHistoryResponse)
def status_history(employee_id: str, _user: Annotated[CurrentUser, Depends(require_permission("employees.view"))]):
    return EmployeeStatusHistoryResponse(items=list_employee_status_history(employee_id))
