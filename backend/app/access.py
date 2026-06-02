from __future__ import annotations

import unicodedata
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, status

from .permissions import has_permission, normalize_role

CROSS_BRANCH_PERMISSIONS = {
    "branches.cross_select",
    "warranties.manage",
    "warranties.manage_provider",
    "warranties.dashboard",
    "warranties.export",
    "warranties.review",
    "warranties.gestor.panel",
}


def ensure_active_user(user: Any) -> None:
    if getattr(user, "must_change_password", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenes que crear tu contrasena antes de continuar",
        )


def user_has(user: Any, permission: str) -> bool:
    permission = str(permission or "").strip()
    if not permission:
        return False
    checker = getattr(user, "has", None)
    if callable(checker):
        try:
            return bool(checker(permission))
        except Exception:
            pass
    raw_permissions = getattr(user, "permissions", None) or []
    permissions = [str(p) for p in raw_permissions if str(p or "").strip()]
    return has_permission(permissions, permission)


def _permission_list(permissions: Iterable[str] | str, *more: str) -> list[str]:
    if isinstance(permissions, str):
        values = [permissions]
    else:
        values = list(permissions or [])
    values.extend(more)
    return [str(p).strip() for p in values if str(p or "").strip()]


def user_has_any(user: Any, permissions: Iterable[str] | str, *more_permissions: str) -> bool:
    return any(user_has(user, permission) for permission in _permission_list(permissions, *more_permissions))


def require_any_permission(
    user: Any,
    permissions: Iterable[str] | str,
    *more_permissions: str,
    detail: str = "No tenes permiso para realizar esta accion",
) -> None:
    ensure_active_user(user)
    if not user_has_any(user, permissions, *more_permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def user_role_keys(user: Any) -> set[str]:
    values = [getattr(user, "role", ""), *(getattr(user, "roles", []) or [])]
    return {normalize_role(str(v)) for v in values if str(v or "").strip()}


def is_superadmin(user: Any) -> bool:
    return "SUPERADMIN" in user_role_keys(user) or user_has(user, "*")


def can_cross_branch(user: Any) -> bool:
    return is_superadmin(user) or user_has_any(user, CROSS_BRANCH_PERMISSIONS)


def _norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.lower().split())


def _branch_value(branch: Any, key: str) -> Any:
    if isinstance(branch, dict):
        return branch.get(key)
    return getattr(branch, key, None)


def _branch_dict(branch: Any) -> dict[str, Any]:
    return {
        "id": str(_branch_value(branch, "id") or "").strip(),
        "name": str(_branch_value(branch, "name") or "").strip(),
        "code": str(_branch_value(branch, "code") or "").strip(),
        "type": str(_branch_value(branch, "type") or "").strip(),
        "company_id": str(_branch_value(branch, "company_id") or "").strip(),
        "company_name": str(_branch_value(branch, "company_name") or "").strip(),
        "is_primary": bool(_branch_value(branch, "is_primary")),
    }


def _is_deposit_branch(branch: dict[str, Any]) -> bool:
    branch_type = _norm(branch.get("type"))
    name = _norm(branch.get("name"))
    return branch_type in {"deposit", "deposito"} or name.startswith("deposito ") or name == "deposito"


def assigned_branches(user: Any, type: str | None = None) -> list[dict[str, Any]]:
    expected_type = _norm(type) if type else ""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(branch: dict[str, Any]) -> None:
        if expected_type and _norm(branch.get("type")) != expected_type:
            return
        key = branch.get("id") or branch.get("name") or branch.get("code")
        if not key or key in seen:
            return
        seen.add(str(key))
        out.append(branch)

    branches = getattr(user, "branches", None) or []
    for branch in sorted(
        [_branch_dict(b) for b in branches if isinstance(b, dict) or b is not None],
        key=lambda item: 0 if item.get("is_primary") else 1,
    ):
        add(branch)

    primary = {
        "id": str(getattr(user, "branch_id", "") or "").strip(),
        "name": str(getattr(user, "branch_name", "") or getattr(user, "sucursal", "") or "").strip(),
        "code": str(getattr(user, "branch_code", "") or "").strip(),
        "type": str(getattr(user, "branch_type", "") or "").strip(),
        "company_id": str(getattr(user, "company_id", "") or "").strip(),
        "company_name": str(getattr(user, "company_name", "") or "").strip(),
        "is_primary": True,
    }
    add(primary)
    return out


def assigned_deposit_names(user: Any) -> list[str]:
    names: list[str] = []
    for branch in assigned_branches(user):
        if _is_deposit_branch(branch):
            name = str(branch.get("name") or "").strip()
            if name and name.lower() not in {n.lower() for n in names}:
                names.append(name)
    return names


def resolve_deposit_name(user: Any, requested: str | None = None) -> str:
    if requested is not None:
        req = requested.strip()
        if not req:
            raise HTTPException(status_code=400, detail="El deposito de origen no puede estar vacio.")
        assigned = assigned_deposit_names(user)
        if any(_norm(req) == _norm(name) for name in assigned):
            return req
        if can_cross_branch(user):
            return req
        raise HTTPException(status_code=403, detail="No tenes acceso al deposito de origen solicitado.")

    primary = next((b for b in assigned_branches(user) if b.get("is_primary") and _is_deposit_branch(b)), None)
    if primary and primary.get("name"):
        return str(primary["name"])

    assigned = assigned_deposit_names(user)
    if len(assigned) == 1:
        return assigned[0]
    if not assigned:
        raise HTTPException(status_code=403, detail="Tu usuario no esta asignado a un deposito.")
    raise HTTPException(
        status_code=400,
        detail="Tu usuario tiene varios depositos asignados. Indica `origen_deposito` en la operacion.",
    )


def user_matches_branch(user: Any, *, branch_id: str | None = None, branch_name: str | None = None) -> bool:
    wanted_id = str(branch_id or "").strip()
    wanted_name = _norm(branch_name)
    if not wanted_id and not wanted_name:
        return False
    for branch in assigned_branches(user):
        if wanted_id and str(branch.get("id") or "").strip() == wanted_id:
            return True
        if wanted_name and wanted_name in {
            _norm(branch.get("name")),
            _norm(branch.get("code")),
            _norm(branch.get("id")),
        }:
            return True
    return False


def _record_role_keys(record: Any) -> list[str]:
    values = [getattr(record, "role", ""), *(getattr(record, "roles", []) or [])]
    out: list[str] = []
    for value in values:
        key = normalize_role(str(value))
        if key and key not in out:
            out.append(key)
    return out


def _record_permissions(record: Any, roles_catalog: dict[str, dict[str, Any]]) -> list[str]:
    permissions: list[str] = []
    for role_key in _record_role_keys(record):
        role = roles_catalog.get(role_key, {})
        role_permissions = role.get("permissions", []) if isinstance(role, dict) else getattr(role, "permissions", [])
        for permission in role_permissions or []:
            value = str(permission)
            if value == "*":
                return ["*"]
            if value and value not in permissions:
                permissions.append(value)
    return permissions


def _record_branches(record: Any) -> list[dict[str, Any]]:
    branches = getattr(record, "_pg_branches", None) or []
    out = [_branch_dict(branch) for branch in branches if isinstance(branch, dict) or branch is not None]
    if not out:
        out.append(
            {
                "id": str(getattr(record, "branch_id", "") or "").strip(),
                "name": str(getattr(record, "sucursal", "") or "").strip(),
                "code": "",
                "type": "",
                "company_id": str(getattr(record, "company_id", "") or "").strip(),
                "company_name": "",
                "is_primary": True,
            }
        )
    return out


def users_with_permission(
    permission: str,
    *,
    branch_id: str | None = None,
    branch_name: str | None = None,
) -> list[str]:
    from .users import load_roles, load_users

    roles_catalog = load_roles()
    usernames: list[str] = []
    wanted_id = str(branch_id or "").strip()
    wanted_name = _norm(branch_name)

    for username, record in load_users().items():
        if not getattr(record, "is_active", True):
            continue
        permissions = _record_permissions(record, roles_catalog)
        if not has_permission(permissions, permission):
            continue
        if wanted_id or wanted_name:
            match = False
            for branch in _record_branches(record):
                if wanted_id and str(branch.get("id") or "").strip() == wanted_id:
                    match = True
                    break
                if wanted_name and wanted_name in {
                    _norm(branch.get("name")),
                    _norm(branch.get("code")),
                    _norm(branch.get("id")),
                }:
                    match = True
                    break
            if not match:
                continue
        usernames.append(str(username))
    return usernames
