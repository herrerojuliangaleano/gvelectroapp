from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

FieldType = Literal["text", "number", "date", "textarea", "checkbox", "select", "file", "multi_file"]


class UserBranchAssignment(BaseModel):
    id: str
    name: str
    code: str = ""
    type: str = ""
    company_id: str = ""
    company_name: str = ""
    parent_branch_id: str | None = None
    parent_branch_name: str = ""
    is_primary: bool = False




class EmployeeLinkedUser(BaseModel):
    username: str = ""
    display_name: str = ""
    role: str = ""
    roles: list[str] = []
    is_active: bool = True


class EmployeeInfo(BaseModel):
    id: str = ""
    username: str = ""
    dni: str = ""
    first_name: str = ""
    last_name: str = ""
    display_name: str = ""
    phone: str = ""
    personal_email: str = ""
    position: str = ""
    department: str = ""
    address: str = ""
    birthdate: str = ""
    gender: str = ""
    civil_status: str = ""
    contract_type: str = ""
    hire_date: str = ""
    manager_employee_id: str = ""
    company_id: str = ""
    company_name: str = ""
    branch_id: str = ""
    branch_name: str = ""
    branch_type: str = ""
    work_branch_id: str = ""
    work_branch_name: str = ""
    photo_url: str = ""
    photo_status: str = "sin_foto"
    photo_uploaded_at: str = ""
    status: str = "activo"
    has_user: bool = False
    user: EmployeeLinkedUser | None = None
    created_at: str = ""
    updated_at: str = ""


class EmployeeListResponse(BaseModel):
    items: list[EmployeeInfo] = []
    total: int = 0


class EmployeeCreateRequest(BaseModel):
    dni: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    phone: str | None = None
    personal_email: str | None = None
    position: str | None = None
    department: str | None = None
    address: str | None = None
    birthdate: str | None = None
    gender: str | None = None
    civil_status: str | None = None
    contract_type: str | None = None
    hire_date: str | None = None
    manager_employee_id: str | None = None
    company_id: str | None = None
    branch_id: str | None = None
    work_branch_id: str | None = None
    status: str | None = None


class EmployeeUpdateRequest(EmployeeCreateRequest):
    pass


class EmployeeLinkUserRequest(BaseModel):
    username: str = Field(min_length=1)


class EmployeeStatusChangeRequest(BaseModel):
    status: str = Field(min_length=1)  # alta | licencia | baja
    motivo: str | None = None
    categoria: str | None = None
    fecha_desde: str | None = None
    fecha_hasta: str | None = None
    observaciones: str | None = None


class EmployeeStatusHistoryItem(BaseModel):
    id: str
    status: str = ""
    previous_status: str = ""
    motivo: str = ""
    categoria: str = ""
    fecha_desde: str = ""
    fecha_hasta: str = ""
    observaciones: str = ""
    actor_username: str = ""
    actor_name: str = ""
    created_at: str = ""


class EmployeeStatusHistoryResponse(BaseModel):
    items: list[EmployeeStatusHistoryItem] = []


class UserLinkCandidate(BaseModel):
    username: str
    display_name: str = ""
    role: str = ""
    is_active: bool = True


class UserLinkCandidatesResponse(BaseModel):
    items: list[UserLinkCandidate] = []


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    display_name: str
    role: str
    roles: list[str] = []
    permissions: list[str]
    sucursal: str = ""
    company_id: str = ""
    company_name: str = ""
    branch_id: str = ""
    branch_name: str = ""
    branch_code: str = ""
    branch_type: str = ""
    branches: list[UserBranchAssignment] = []
    branch_ids: list[str] = []
    employee: EmployeeInfo | None = None
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    new_password: str


class MeResponse(BaseModel):
    username: str
    display_name: str
    role: str
    roles: list[str] = []
    permissions: list[str]
    sucursal: str = ""
    company_id: str = ""
    company_name: str = ""
    branch_id: str = ""
    branch_name: str = ""
    branch_code: str = ""
    branch_type: str = ""
    branches: list[UserBranchAssignment] = []
    branch_ids: list[str] = []
    employee: EmployeeInfo | None = None
    is_active: bool = True
    must_change_password: bool = False


class ToolField(BaseModel):
    name: str
    label: str
    type: FieldType
    required: bool = False
    placeholder: str | None = None
    default: Any = None
    options: list[dict[str, str]] | None = None
    accept: str | None = None
    help: str | None = None


class ToolInfo(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    color: str
    dangerous: bool = False
    fields: list[ToolField]
    category: str | None = None
    tags: list[str] = []
    recommended_device: str | None = None
    weight: str | None = None


class JobInfo(BaseModel):
    id: str
    tool_id: str
    tool_name: str
    status: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: float | None = None
    user: str | None = None
    payload: dict[str, Any] | None = None
    error: str | None = None
    pid: int | None = None


class RunResponse(BaseModel):
    job_id: str
    status: str


class ConfigStatus(BaseModel):
    app_enabled: bool
    has_credentials_env: bool
    has_credentials_file: bool
    has_token_file: bool
    legacy_scripts_found: bool
    storage_dir: str


class RoleInfo(BaseModel):
    name: str
    label: str
    level: int = 0
    permissions: list[str]
    # Departamento al que pertenece el rol ('' = sin departamento). Fase 1.
    group: str = ""


class RoleGroupInfo(BaseModel):
    """Departamento de roles (Administracion / Gerencia / Posventa / ...)."""
    id: int
    name: str
    label: str
    sort_order: int = 0


class UserInfo(BaseModel):
    username: str
    display_name: str
    role: str
    roles: list[str] = []
    sucursal: str = ""
    company_id: str = ""
    company_name: str = ""
    branch_id: str = ""
    branch_name: str = ""
    branch_code: str = ""
    branch_type: str = ""
    branches: list[UserBranchAssignment] = []
    branch_ids: list[str] = []
    employee: EmployeeInfo | None = None
    is_active: bool
    must_change_password: bool = False
    last_login_at: str | None = None
    last_movement_at: str | None = None
    last_movement: str | None = None


class PermissionInfo(BaseModel):
    id: str
    label: str
    group: str | None = None


class AuditEvent(BaseModel):
    id: int
    created_at: str
    event_type: str
    actor_username: str | None = None
    actor_display_name: str | None = None
    actor_role: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    status: str | None = None
    message: str | None = None
    details: dict[str, Any] | None = None
