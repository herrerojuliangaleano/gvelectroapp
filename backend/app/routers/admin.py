from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..audit import audit, get_audit_events
from ..auth import require_permission
from ..permissions import ALL_PERMISSIONS, PERMISSION_GROUPS, normalize_role
from ..schemas import AuditEvent, PermissionInfo, RoleGroupInfo, RoleInfo, UserInfo
from ..users import CurrentUser, delete_user, load_roles, load_users, repair_user_branch_links, repair_user_employees, repair_user_legacy_roles, reset_user_password, save_roles, set_user_active, upsert_user
from .. import users_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class EmployeeUpsertRequest(BaseModel):
    dni: str | None = ""
    first_name: str | None = ""
    last_name: str | None = ""
    display_name: str | None = ""
    phone: str | None = ""
    personal_email: str | None = ""
    position: str | None = ""
    company_id: str | None = ""
    branch_id: str | None = ""
    photo_url: str | None = ""
    photo_status: str | None = "sin_foto"
    status: str | None = "activo"


class UserUpsertRequest(BaseModel):
    username: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    role: str = Field(min_length=1)
    roles: list[str] | None = None
    sucursal: str | None = ""
    company_id: str | None = ""
    branch_id: str | None = ""
    branch_ids: list[str] | None = None
    employee: EmployeeUpsertRequest | None = None
    password: str | None = None
    is_active: bool = True


class RoleUpdateRequest(BaseModel):
    label: str = Field(min_length=1)
    level: int = 0
    permissions: list[str] = []
    # Departamento ("" = sin departamento, None = no tocar el actual). Fase 1.
    group: str | None = None


class RoleGroupCreateRequest(BaseModel):
    label: str = Field(min_length=1)
    name: str | None = None  # clave; si no viene se deriva del label
    sort_order: int = 0


class RoleGroupUpdateRequest(BaseModel):
    label: str | None = None
    sort_order: int | None = None


def _permission_group(permission_id: str) -> str | None:
    for group, permissions in PERMISSION_GROUPS.items():
        if permission_id in permissions:
            return group
    return None


def _user_audit_summary(username: str) -> dict[str, str | None]:
    events = [e for e in get_audit_events(1000) if e.get("actor_username") == username]
    last_login_at = None
    last_movement_at = None
    last_movement = None
    for e in events:
        if not last_movement_at:
            last_movement_at = e.get("created_at")
            last_movement = e.get("event_type")
        if e.get("event_type") == "auth.login" and not last_login_at:
            last_login_at = e.get("created_at")
        if last_login_at and last_movement_at:
            break
    return {"last_login_at": last_login_at, "last_movement_at": last_movement_at, "last_movement": last_movement}


@router.get("/permissions", response_model=list[PermissionInfo])
def permissions(_user: Annotated[CurrentUser, Depends(require_permission("roles.view"))]):
    return [PermissionInfo(id=k, label=v, group=_permission_group(k)) for k, v in ALL_PERMISSIONS.items()]


@router.get("/roles", response_model=list[RoleInfo])
def roles(_user: Annotated[CurrentUser, Depends(require_permission("roles.view"))]):
    data = load_roles()
    return [
        RoleInfo(
            name=name,
            label=info["label"],
            level=int(info.get("level") or 0),
            permissions=list(info.get("permissions", [])),
            group=str(info.get("group") or ""),
        )
        for name, info in sorted(data.items(), key=lambda p: int(p[1].get("level") or 0), reverse=True)
    ]


@router.put("/roles/{role_name}", response_model=RoleInfo)
def update_role(role_name: str, req: RoleUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("roles.manage"))]):
    role = normalize_role(role_name)
    roles = load_roles()
    clean_permissions = [p for p in req.permissions if p in ALL_PERMISSIONS or p == "*"]
    current = roles.get(role, {}) if isinstance(roles.get(role), dict) else {}
    updated: dict = {"label": req.label, "level": req.level, "permissions": clean_permissions}
    # group=None → conservar el departamento actual; ""/valor → setear.
    if req.group is not None:
        updated["group"] = req.group
    elif "group" in current:
        updated["group"] = current["group"]
    roles[role] = updated
    save_roles(roles)
    audit("roles.update", user=user, resource_type="role", resource_id=role, details={"permissions": clean_permissions, "group": updated.get("group", "")})
    return RoleInfo(name=role, label=req.label, level=req.level, permissions=clean_permissions, group=str(updated.get("group") or ""))


# ── Departamentos (role_groups) — Fase 1 roles/permisos ─────────────────────

@router.get("/role-groups", response_model=list[RoleGroupInfo])
def role_groups(_user: Annotated[CurrentUser, Depends(require_permission("roles.view"))]):
    return [RoleGroupInfo(**g) for g in users_db.list_role_groups_pg()]


@router.post("/role-groups", response_model=RoleGroupInfo)
def create_role_group(req: RoleGroupCreateRequest, user: Annotated[CurrentUser, Depends(require_permission("roles.manage"))]):
    name = normalize_role(req.name or req.label)
    if not name:
        raise HTTPException(status_code=400, detail="El departamento necesita un nombre")
    try:
        created = users_db.create_role_group_pg(name=name, label=req.label.strip(), sort_order=req.sort_order)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("role_groups.create", user=user, resource_type="role_group", resource_id=name, details={"label": req.label})
    return RoleGroupInfo(**created)


@router.patch("/role-groups/{group_id}", response_model=RoleGroupInfo)
def update_role_group(group_id: int, req: RoleGroupUpdateRequest, user: Annotated[CurrentUser, Depends(require_permission("roles.manage"))]):
    try:
        updated = users_db.update_role_group_pg(group_id, label=req.label, sort_order=req.sort_order)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("role_groups.update", user=user, resource_type="role_group", resource_id=str(group_id), details={"label": req.label, "sort_order": req.sort_order})
    return RoleGroupInfo(**updated)


@router.delete("/role-groups/{group_id}")
def delete_role_group(group_id: int, user: Annotated[CurrentUser, Depends(require_permission("roles.manage"))]):
    try:
        users_db.delete_role_group_pg(group_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("role_groups.delete", user=user, resource_type="role_group", resource_id=str(group_id))
    return {"ok": True}


@router.get("/users", response_model=list[UserInfo])
def users(_user: Annotated[CurrentUser, Depends(require_permission("users.view"))]):
    # Hotfixes: antes de listar, sincronizamos usuarios legacy con la estructura nueva.
    repair_user_branch_links()
    repair_user_legacy_roles()
    repair_user_employees()
    result: list[UserInfo] = []
    for record in load_users().values():
        data = record.public()
        data.update(_user_audit_summary(record.username))
        result.append(UserInfo(**data))
    return result


@router.post("/users", response_model=UserInfo)
def create_or_update_user(req: UserUpsertRequest, user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    try:
        # Si password viene vacío o null al crear usuario, queda con clave en blanco y obligado a crearla en el primer ingreso.
        password = req.password if req.password else None
        record = upsert_user(
            req.username,
            req.display_name,
            req.role,
            req.is_active,
            password,
            req.sucursal,
            req.company_id,
            req.branch_id,
            req.branch_ids,
            req.roles,
            req.employee.model_dump() if req.employee else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("users.upsert", user=user, resource_type="user", resource_id=record.username, details=record.public())
    data = record.public()
    data.update(_user_audit_summary(record.username))
    return UserInfo(**data)


@router.post("/users/repair-branch-links")
def repair_branch_links(user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    result = repair_user_branch_links()
    audit("users.repair_branch_links", user=user, resource_type="user", resource_id="branch-links", details=result)
    return {"ok": True, **result}


@router.post("/users/repair-legacy-roles")
def repair_legacy_roles(user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    result = repair_user_legacy_roles()
    audit("users.repair_legacy_roles", user=user, resource_type="user", resource_id="roles", details=result)
    return {"ok": True, **result}




@router.post("/users/repair-employees")
def repair_employees(user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    result = repair_user_employees()
    audit("users.repair_employees", user=user, resource_type="employee", resource_id="user-employees", details=result)
    return {"ok": True, **result}


@router.post("/users/{username}/reset-password", response_model=UserInfo)
def reset_password(username: str, user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    if username == user.username:
        raise HTTPException(status_code=400, detail="No podés blanquear tu propia contraseña desde este panel")
    try:
        record = reset_user_password(username)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("users.password_reset", user=user, resource_type="user", resource_id=username, message="Contraseña blanqueada")
    data = record.public()
    data.update(_user_audit_summary(record.username))
    return UserInfo(**data)


@router.delete("/users/{username}")
def delete_user_endpoint(username: str, user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    if username == user.username:
        raise HTTPException(status_code=400, detail="No podés eliminar tu propio usuario")
    try:
        delete_user(username)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("users.delete", user=user, resource_type="user", resource_id=username, message="Usuario eliminado")
    return {"ok": True}


@router.post("/users/{username}/deactivate", response_model=UserInfo)
def deactivate_user(username: str, user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    if username == user.username:
        raise HTTPException(status_code=400, detail="No podés bloquear tu propio usuario")
    try:
        record = set_user_active(username, False)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("users.deactivate", user=user, resource_type="user", resource_id=username)
    data = record.public()
    data.update(_user_audit_summary(record.username))
    return UserInfo(**data)


@router.post("/users/{username}/activate", response_model=UserInfo)
def activate_user(username: str, user: Annotated[CurrentUser, Depends(require_permission("users.manage"))]):
    try:
        record = set_user_active(username, True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("users.activate", user=user, resource_type="user", resource_id=username)
    data = record.public()
    data.update(_user_audit_summary(record.username))
    return UserInfo(**data)


@router.get("/audit", response_model=list[AuditEvent])
def audit_events(
    _user: Annotated[CurrentUser, Depends(require_permission("audit.view"))],
    limit: int = Query(default=200, ge=1, le=1000),
    actor: str | None = None,
    event_type: str | None = None,
    status: str | None = None,
):
    events = get_audit_events(limit)
    if actor:
        needle = actor.lower().strip()
        events = [e for e in events if needle in str(e.get("actor_username") or "").lower() or needle in str(e.get("actor_display_name") or "").lower()]
    if event_type:
        needle = event_type.lower().strip()
        events = [e for e in events if needle in str(e.get("event_type") or "").lower()]
    if status:
        needle = status.lower().strip()
        events = [e for e in events if needle == str(e.get("status") or "").lower()]
    return [AuditEvent(**event) for event in events]
