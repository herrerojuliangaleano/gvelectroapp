from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

from .permissions import DEFAULT_ROLES, has_permission, normalize_role
from .security import verify_password
# Fase 2.5 — usuarios + roles + alcance pasan a Postgres.
from . import users_db
# Fase 2.5b — empleados portados a Postgres.
from . import employees_db

_store_lock = threading.RLock()


def _branch_assignments_for_record(record: "UserRecord") -> list[dict[str, Any]]:
    """Devuelve la lista de sucursales asignadas (alcance) para el UserRecord.

    Si `_record_from_payload` ya cargó `_pg_branches` desde Postgres, lo usa.
    En caso contrario consulta Postgres por username (caso raro: records
    construidos manualmente).
    """
    cached = getattr(record, "_pg_branches", None)
    if cached is not None:
        return list(cached)
    payload = users_db.get_user_pg(record.username)
    return list(payload.get("branches") or []) if payload else []


def _clean_role_keys(role_keys: list[str], roles_catalog: dict[str, dict[str, Any]] | None = None) -> list[str]:
    catalog = roles_catalog or load_roles()
    clean: list[str] = []
    for raw in role_keys:
        role = normalize_role(str(raw or ""))
        if role and role in catalog and role not in clean:
            clean.append(role)
    return clean


def _roles_for_record(record: "UserRecord") -> list[str]:
    roles_catalog = load_roles()
    source = _clean_role_keys(list(record.roles or []), roles_catalog)
    primary = normalize_role(record.role)
    if primary and primary in roles_catalog and primary not in source:
        source.insert(0, primary)
    if not source and primary and primary in roles_catalog:
        source = [primary]
    if not source:
        source = ["VENDEDOR"] if "VENDEDOR" in roles_catalog else list(roles_catalog.keys())[:1]
    # El rol principal legacy queda primero para compatibilidad visual y de permisos antiguos.
    if primary in source:
        source = [primary] + [role for role in source if role != primary]
    return source


def _permissions_for_roles(role_keys: list[str], roles_catalog: dict[str, dict[str, Any]] | None = None) -> list[str]:
    catalog = roles_catalog or load_roles()
    permissions: list[str] = []
    for role in role_keys:
        info = catalog.get(normalize_role(role), {})
        for permission in info.get("permissions", []) or []:
            value = str(permission)
            if value == "*":
                return ["*"]
            if value and value not in permissions:
                permissions.append(value)
    return sorted(permissions)


def _fetch_employee_by_username(username: str) -> dict[str, Any] | None:
    """[Fase 2.5b] Lee el empleado vinculado a un usuario desde Postgres."""
    return employees_db.get_employee_by_username_pg(username)


def upsert_employee_for_user(
    username: str,
    payload: dict[str, Any] | None = None,
    user_record: "UserRecord" | None = None,
) -> dict[str, Any] | None:
    """[Fase 2.5b] Crea/actualiza el empleado del usuario en Postgres."""
    return employees_db.upsert_employee_for_user_pg(username, payload, user_record)


def repair_user_employees() -> dict[str, int]:
    """[Fase 2.5b] Asegura que cada usuario tenga un Employee en Postgres."""
    return employees_db.repair_user_employees_pg()


@dataclass
class UserRecord:
    username: str
    display_name: str
    role: str
    sucursal: str = ""
    company_id: str = ""
    branch_id: str = ""
    branch_ids: list[str] = field(default_factory=list)
    roles: list[str] = field(default_factory=list)
    password_hash: str = ""
    is_active: bool = True
    must_change_password: bool = False

    def public(self) -> dict[str, Any]:
        branches = _branch_assignments_for_record(self)
        primary = next((b for b in branches if b.get("is_primary")), branches[0] if branches else None)
        sucursal = primary["name"] if primary else self.sucursal
        roles = _roles_for_record(self)
        employee = _fetch_employee_by_username(self.username)
        return {
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "roles": roles,
            "sucursal": sucursal,
            "company_id": primary["company_id"] if primary else self.company_id,
            "company_name": primary["company_name"] if primary else "",
            "branch_id": primary["id"] if primary else self.branch_id,
            "branch_name": primary["name"] if primary else "",
            "branch_code": primary["code"] if primary else "",
            "branch_type": primary["type"] if primary else "",
            "branches": branches,
            "branch_ids": [b["id"] for b in branches] if branches else list(self.branch_ids),
            "employee": employee,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password or not bool(self.password_hash),
        }


@dataclass
class CurrentUser:
    username: str
    display_name: str
    role: str
    roles: list[str]
    permissions: list[str]
    sucursal: str = ""
    company_id: str = ""
    company_name: str = ""
    branch_id: str = ""
    branch_name: str = ""
    branch_code: str = ""
    branch_type: str = ""
    branches: list[dict[str, Any]] = field(default_factory=list)
    branch_ids: list[str] = field(default_factory=list)
    employee: dict[str, Any] | None = None
    is_active: bool = True
    must_change_password: bool = False

    def has(self, permission: str) -> bool:
        return has_permission(self.permissions, permission)

    def public(self) -> dict[str, Any]:
        return {
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "roles": self.roles,
            "sucursal": self.sucursal,
            "company_id": self.company_id,
            "company_name": self.company_name,
            "branch_id": self.branch_id,
            "branch_name": self.branch_name,
            "branch_code": self.branch_code,
            "branch_type": self.branch_type,
            "branches": self.branches,
            "branch_ids": self.branch_ids,
            "employee": self.employee,
            "permissions": self.permissions,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password,
        }


def load_roles() -> dict[str, dict[str, Any]]:
    """Lee los roles desde Postgres. Si la tabla está vacía cae al catálogo legacy
    `DEFAULT_ROLES` (caso bootstrap antes del seed)."""
    roles = users_db.load_roles_pg()
    if roles:
        # Normalizar nombre por seguridad.
        return {normalize_role(name): info for name, info in roles.items()}
    return {name: dict(info) for name, info in DEFAULT_ROLES.items()}


def save_roles(roles: dict[str, dict[str, Any]]) -> None:
    """Guarda los roles en Postgres, filtrando permisos contra el catálogo del código."""
    from .permissions import ALL_PERMISSIONS

    clean: dict[str, dict[str, Any]] = {}
    for role, info in roles.items():
        key = normalize_role(role)
        permissions = info.get("permissions", []) if isinstance(info, dict) else []
        clean[key] = {
            "label": str(info.get("label") or key) if isinstance(info, dict) else key,
            "level": int(info.get("level") or 0) if isinstance(info, dict) else 0,
            "permissions": [str(p) for p in permissions if str(p) in ALL_PERMISSIONS or str(p) == "*"],
        }
        # Departamento (Fase 1): solo se propaga si vino en el dict. Si no
        # viene, save_roles_pg deja el grupo actual del rol sin tocar.
        if isinstance(info, dict) and "group" in info:
            clean[key]["group"] = str(info.get("group") or "")
    users_db.save_roles_pg(clean)


def ensure_missing_default_roles() -> dict[str, Any]:
    """Crea roles nuevos del catalogo sin pisar roles existentes en Postgres."""
    current = load_roles()
    missing: list[str] = []
    merged = dict(current)
    for name, info in DEFAULT_ROLES.items():
        if name in merged:
            continue
        merged[name] = dict(info)
        missing.append(name)
    if missing:
        save_roles(merged)
    return {"created": missing, "created_count": len(missing)}


def _record_from_payload(payload: dict[str, Any]) -> UserRecord:
    """Convierte el dict que devuelve users_db en un UserRecord, cacheando las
    branches resueltas como atributo `_pg_branches` para que `public()` no
    re-consulte."""
    primary_role = normalize_role(str(payload.get("role") or "VENDEDOR"))
    role_keys = _clean_role_keys([primary_role, *[str(r) for r in payload.get("roles", [])]])
    rec = UserRecord(
        username=str(payload.get("username") or ""),
        display_name=str(payload.get("display_name") or payload.get("username") or ""),
        role=primary_role,
        roles=role_keys,
        sucursal=str(payload.get("sucursal") or ""),
        company_id=str(payload.get("company_id") or ""),
        branch_id=str(payload.get("branch_id") or ""),
        branch_ids=[str(b) for b in payload.get("branch_ids", []) if b],
        password_hash=str(payload.get("password_hash") or ""),
        is_active=bool(payload.get("is_active", True)),
        must_change_password=bool(payload.get("must_change_password", False)) or not bool(payload.get("password_hash")),
    )
    # Cache de branches resueltas (con name/code/company): evita re-query en public().
    object.__setattr__(rec, "_pg_branches", list(payload.get("branches") or []))
    return rec


def load_users() -> dict[str, UserRecord]:
    """Lee usuarios desde Postgres (users + user_roles + user_branches + branches)."""
    payloads = users_db.load_users_pg()
    return {username: _record_from_payload(p) for username, p in payloads.items()}


def save_users(users: dict[str, UserRecord]) -> None:
    """Sincroniza el dict completo de usuarios contra Postgres.

    Pensado para los flujos legacy que reciben el dict de `load_users`,
    modifican algún campo y lo guardan. No pisa el password si el record no lo
    trae cargado distinto del actual; esa lógica vive en `upsert_user`.
    """
    for username, rec in users.items():
        users_db.upsert_user_pg(
            username=username,
            display_name=rec.display_name,
            role=rec.role,
            is_active=rec.is_active,
            password=None,  # no tocar password en save_users (eso se hace explícito)
            company_id=rec.company_id,
            branch_id=rec.branch_id,
            branch_ids=list(rec.branch_ids),
            roles=list(rec.roles),
        )


def repair_user_branch_links() -> dict[str, int]:
    """No-op desde Fase 2.5. Postgres es fuente única para `user_branches`,
    así que no hay JSON ni tablas paralelas que sincronizar."""
    total = len(load_users())
    return {"changed": 0, "synced": total, "total": total}


def repair_user_legacy_roles() -> dict[str, int]:
    """No-op desde Fase 2.5. Postgres es fuente única para `user_roles` y
    `roles`. Se mantiene la firma para no romper a `routers/admin.py`."""
    total = len(load_users())
    return {"created_roles": 0, "changed_users": 0, "synced": total, "total": total}


def get_user(username: str) -> UserRecord | None:
    return load_users().get(username)


def get_employee_by_username(username: str) -> dict[str, Any] | None:
    """[Fase 2.5b] Empleado vinculado al usuario (Postgres)."""
    return employees_db.get_employee_by_username_pg(username)


def set_employee_photo(username: str, photo_url: str, photo_status: str = "pendiente_aprobacion") -> dict[str, Any]:
    """[Fase 2.5b] Sube/actualiza foto del empleado en Postgres."""
    return employees_db.set_employee_photo_pg(username, photo_url, photo_status)


def set_employee_photo_status(username: str, photo_status: str) -> dict[str, Any]:
    """[Fase 2.5b] Cambia el estado de la foto del empleado (Postgres)."""
    return employees_db.set_employee_photo_status_pg(username, photo_status)


# ──────────────────────────────────────────────────────────────────────────────
# Fase 2.5b — Empleados portados a Postgres. Las funciones públicas delegan al
# módulo `employees_db`. Se mantienen los nombres y firmas para no romper a los
# routers (employees.py, warranties.py, etc.).
# ──────────────────────────────────────────────────────────────────────────────

# Alias de compatibilidad con consumidores que importen estos símbolos.
EMPLOYEE_STATUSES = employees_db.EMPLOYEE_STATUSES
EMPLOYEE_STATUS_ALIASES = employees_db.EMPLOYEE_STATUS_ALIASES
_normalize_emp_status = employees_db._normalize_emp_status


def get_employee_by_id(employee_id: str) -> dict[str, Any] | None:
    return employees_db.get_employee_by_id_pg(employee_id)


def list_employees(
    *,
    q: str = "",
    status: str = "",
    work_branch_id: str = "",
    has_user: str = "",
    limit: int = 500,
) -> list[dict[str, Any]]:
    return employees_db.list_employees_pg(
        q=q, status=status, work_branch_id=work_branch_id, has_user=has_user, limit=limit,
    )


def create_standalone_employee(payload: dict[str, Any], actor: Any = None) -> dict[str, Any]:
    return employees_db.create_standalone_employee_pg(payload, actor=actor)


def update_employee_by_id(employee_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return employees_db.update_employee_by_id_pg(employee_id, payload)


def link_employee_user(employee_id: str, username: str) -> dict[str, Any]:
    return employees_db.link_employee_user_pg(employee_id, username)


def unlink_employee_user(employee_id: str) -> dict[str, Any]:
    return employees_db.unlink_employee_user_pg(employee_id)


def change_employee_status(employee_id: str, payload: dict[str, Any], actor: Any = None) -> dict[str, Any]:
    return employees_db.change_employee_status_pg(employee_id, payload, actor=actor)


def list_employee_status_history(employee_id: str) -> list[dict[str, Any]]:
    return employees_db.list_employee_status_history_pg(employee_id)


def search_users_for_link(q: str = "", limit: int = 20) -> list[dict[str, Any]]:
    return employees_db.search_users_for_link_pg(q=q, limit=limit)


def get_current_user(username: str) -> CurrentUser | None:
    user = get_user(username)
    if not user or not user.is_active:
        return None
    roles_catalog = load_roles()
    role_keys = _roles_for_record(user)
    permissions = _permissions_for_roles(role_keys, roles_catalog)
    public = user.public()
    return CurrentUser(
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        roles=role_keys,
        permissions=[str(p) for p in permissions],
        sucursal=str(public.get("sucursal") or ""),
        company_id=str(public.get("company_id") or ""),
        company_name=str(public.get("company_name") or ""),
        branch_id=str(public.get("branch_id") or ""),
        branch_name=str(public.get("branch_name") or ""),
        branch_code=str(public.get("branch_code") or ""),
        branch_type=str(public.get("branch_type") or ""),
        branches=list(public.get("branches") or []),
        branch_ids=list(public.get("branch_ids") or []),
        employee=public.get("employee") if isinstance(public.get("employee"), dict) else None,
        is_active=user.is_active,
        must_change_password=user.must_change_password or not bool(user.password_hash),
    )


def authenticate_user(username: str, password: str) -> CurrentUser | None:
    user = get_user(username)
    if not user or not user.is_active:
        return None
    if not user.password_hash:
        if password != "":
            return None
        return get_current_user(user.username)
    if not verify_password(password, user.password_hash):
        return None
    return get_current_user(user.username)


def upsert_user(
    username: str,
    display_name: str,
    role: str,
    is_active: bool = True,
    password: str | None = None,
    sucursal: str | None = None,
    company_id: str | None = None,
    branch_id: str | None = None,
    branch_ids: list[str] | None = None,
    role_keys: list[str] | None = None,
    employee: dict[str, Any] | None = None,
) -> UserRecord:
    """Crea o actualiza un usuario en Postgres (auth) y cascada a la tabla
    `employees` en Postgres si vienen datos de empleado."""
    role = normalize_role(role)
    roles_catalog = load_roles()
    if role not in roles_catalog:
        raise ValueError(f"Rol inexistente: {role}")

    # Cleanear lista de roles (asegurar que el principal esté).
    desired_role_keys = _clean_role_keys([role, *[str(r) for r in (role_keys or [])]], roles_catalog)
    if not desired_role_keys:
        desired_role_keys = [role]

    with _store_lock:
        payload = users_db.upsert_user_pg(
            username=username,
            display_name=display_name,
            role=role,
            is_active=is_active,
            password=password,
            company_id=company_id,
            branch_id=branch_id,
            branch_ids=list(branch_ids) if branch_ids is not None else [],
            roles=desired_role_keys,
        )
        record = _record_from_payload(payload)

        # Cascada a empleados en Postgres: mantiene un stub por cada usuario.
        employee_payload = dict(employee or {})
        if employee is not None or True:  # siempre intentamos crear/actualizar el stub
            employee_payload.setdefault("company_id", record.company_id)
            employee_payload.setdefault("branch_id", record.branch_id)
            employee_payload.setdefault("display_name", record.display_name)
            try:
                upsert_employee_for_user(record.username, employee_payload, record)
            except Exception:
                # Si falla la cascada de empleado, no rompemos la creación del usuario.
                pass

        return record


def set_user_active(username: str, is_active: bool) -> UserRecord:
    payload = users_db.set_user_active_pg(username, is_active)
    if payload is None:
        raise ValueError("Usuario no encontrado")
    record = _record_from_payload(payload)
    # Cascada a employees en Postgres: mantener status alta/baja.
    try:
        current_employee = _fetch_employee_by_username(record.username)
        if current_employee:
            current_employee["status"] = "activo" if is_active else "inactivo"
            upsert_employee_for_user(record.username, current_employee, record)
    except Exception:
        pass
    return record


def reset_user_password(username: str) -> UserRecord:
    payload = users_db.reset_user_password_pg(username)
    if payload is None:
        raise ValueError("Usuario no encontrado")
    return _record_from_payload(payload)


def delete_user(username: str) -> None:
    ok = users_db.delete_user_pg(username)
    if not ok:
        raise ValueError("Usuario no encontrado")
    # Cascada a employees en Postgres: desvincular y marcar baja.
    try:
        current_employee = _fetch_employee_by_username(username)
        if current_employee:
            employee_id = current_employee.get("id")
            employees_db.unlink_employee_user_pg(employee_id)
            employees_db.update_employee_by_id_pg(employee_id, {"status": "baja"})
    except Exception:
        pass


def set_own_password(username: str, new_password: str) -> UserRecord:
    password = (new_password or "").strip()
    if len(password) < 6:
        raise ValueError("La contraseña debe tener al menos 6 caracteres")
    payload = users_db.set_user_password_pg(username, password)
    if payload is None:
        raise ValueError("Usuario no encontrado")
    return _record_from_payload(payload)
