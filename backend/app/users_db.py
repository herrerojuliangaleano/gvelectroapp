"""Capa Postgres-backed para usuarios y roles (Fase 2.5).

Reemplaza la lectura/escritura desde `users.json` / `roles.json` y desde las
tablas SQLite legacy `user_roles` / `user_branches`.

API pública pensada para que `users.py` la consuma sin cambiar contratos hacia
los routers. Devuelve dicts/listas con la misma forma que la lógica legacy
esperaba (claves: `id`, `name`, `code`, `type`, `company_id`, `company_name`,
`is_primary`).

Solo cubre usuarios + roles + alcance (user_branches). Empleados se portan en
una sub-fase aparte.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .db import db_session
from .models.auth import Role, RoleGroup, User, UserBranch, UserRole
from .models.org import Branch, Company
from .security import hash_password


# ── Helpers de mapeo ─────────────────────────────────────────────────────────

def _branch_assignment_dict(b: Branch, is_primary: bool, company_name: str = "") -> dict[str, Any]:
    """Forma que ya consumían los routers legacy (lista en `UserRecord.branches`)."""
    return {
        "id": str(b.id),
        "name": str(b.name or ""),
        "code": str(b.code or ""),
        "type": str(b.type or ""),
        "company_id": str(b.company_id or ""),
        "company_name": str(company_name or ""),
        "parent_branch_id": str(b.parent_branch_id or "") if b.parent_branch_id else None,
        "parent_branch_name": "",
        "is_primary": bool(is_primary),
    }


def _user_to_payload(u: User, session) -> dict[str, Any]:
    """Aplana un User + relaciones en un dict listo para construir UserRecord."""
    # Roles del usuario
    role_rows = session.execute(
        select(Role.name, UserRole.is_primary)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == u.id)
    ).all()
    role_list = [r[0] for r in role_rows]
    primary_role = next((r[0] for r in role_rows if r[1]), role_list[0] if role_list else "")

    # Sucursales asignadas (alcance)
    company_names = dict(session.execute(select(Company.id, Company.name)).all())
    branches_rows = session.execute(
        select(Branch, UserBranch.is_primary)
        .join(UserBranch, UserBranch.branch_id == Branch.id)
        .where(UserBranch.user_id == u.id)
    ).all()
    branches = [
        _branch_assignment_dict(b, bool(is_primary), company_names.get(b.company_id, ""))
        for b, is_primary in branches_rows
    ]
    primary_branch = next((b for b in branches if b["is_primary"]), branches[0] if branches else None)

    return {
        "username": u.username,
        "display_name": u.display_name,
        "role": primary_role,
        "roles": role_list,
        "sucursal": primary_branch["name"] if primary_branch else "",
        "company_id": primary_branch["company_id"] if primary_branch else "",
        "branch_id": primary_branch["id"] if primary_branch else "",
        "branch_ids": [b["id"] for b in branches],
        "branches": branches,
        "password_hash": u.password_hash or "",
        "is_active": bool(u.is_active),
        "must_change_password": bool(u.must_change_password),
    }


# ── Roles ────────────────────────────────────────────────────────────────────

def load_roles_pg() -> dict[str, dict[str, Any]]:
    with db_session() as session:
        groups = {g.id: g.name for g in session.scalars(select(RoleGroup)).all()}
        rows = session.scalars(select(Role)).all()
        return {
            r.name: {
                "label": str(r.label or r.name),
                "level": int(r.level or 0),
                "permissions": list(r.permissions or []),
                "group": groups.get(r.group_id, "") if r.group_id else "",
            }
            for r in rows
        }


def save_roles_pg(roles: dict[str, dict[str, Any]]) -> None:
    with db_session() as session:
        group_ids = {g.name: g.id for g in session.scalars(select(RoleGroup)).all()}
        for name, info in roles.items():
            r = session.scalar(select(Role).where(Role.name == name))
            label = str(info.get("label") or name)
            level = int(info.get("level") or 0)
            permissions = list(info.get("permissions") or [])
            # "group" puede no venir (flujos viejos): en ese caso NO tocamos
            # el departamento actual del rol. String vacio = sacar del grupo.
            group_value = info.get("group", None)
            if r:
                r.label = label
                r.level = level
                r.permissions = permissions
                if group_value is not None:
                    r.group_id = group_ids.get(str(group_value)) if group_value else None
            else:
                new_role = Role(name=name, label=label, level=level, permissions=permissions)
                if group_value:
                    new_role.group_id = group_ids.get(str(group_value))
                session.add(new_role)
        session.commit()


# ── Departamentos (role_groups) ──────────────────────────────────────────────

def list_role_groups_pg() -> list[dict[str, Any]]:
    with db_session() as session:
        rows = session.scalars(select(RoleGroup).order_by(RoleGroup.sort_order, RoleGroup.name)).all()
        return [
            {"id": g.id, "name": g.name, "label": g.label, "sort_order": int(g.sort_order or 0)}
            for g in rows
        ]


def create_role_group_pg(name: str, label: str, sort_order: int = 0) -> dict[str, Any]:
    with db_session() as session:
        existing = session.scalar(select(RoleGroup).where(RoleGroup.name == name))
        if existing:
            raise ValueError(f"Ya existe un departamento con clave {name}")
        g = RoleGroup(name=name, label=label, sort_order=sort_order)
        session.add(g)
        session.commit()
        return {"id": g.id, "name": g.name, "label": g.label, "sort_order": int(g.sort_order or 0)}


def update_role_group_pg(group_id: int, label: str | None = None, sort_order: int | None = None) -> dict[str, Any]:
    with db_session() as session:
        g = session.get(RoleGroup, group_id)
        if not g:
            raise ValueError("Departamento no encontrado")
        if label is not None and label.strip():
            g.label = label.strip()
        if sort_order is not None:
            g.sort_order = int(sort_order)
        session.commit()
        return {"id": g.id, "name": g.name, "label": g.label, "sort_order": int(g.sort_order or 0)}


def delete_role_group_pg(group_id: int) -> None:
    """Borra el departamento. Los roles que apuntaban a el quedan sin
    departamento (FK ON DELETE SET NULL)."""
    with db_session() as session:
        g = session.get(RoleGroup, group_id)
        if not g:
            raise ValueError("Departamento no encontrado")
        session.delete(g)
        session.commit()


# ── Usuarios ─────────────────────────────────────────────────────────────────

def load_users_pg() -> dict[str, dict[str, Any]]:
    """Devuelve dict username → payload (forma equivalente a UserRecord)."""
    out: dict[str, dict[str, Any]] = {}
    with db_session() as session:
        users = session.scalars(select(User)).all()
        for u in users:
            payload = _user_to_payload(u, session)
            out[u.username] = payload
    return out


def get_user_pg(username: str) -> dict[str, Any] | None:
    if not username:
        return None
    with db_session() as session:
        u = session.scalar(select(User).where(User.username == username.strip().lower()))
        if not u:
            return None
        return _user_to_payload(u, session)


def upsert_user_pg(
    username: str,
    display_name: str,
    role: str,
    is_active: bool,
    password: str | None,
    company_id: str | None,
    branch_id: str | None,
    branch_ids: list[str] | None,
    roles: list[str] | None,
) -> dict[str, Any]:
    """Crea o actualiza un usuario completo (con roles y alcance)."""
    uname = username.strip().lower()
    if not uname:
        raise ValueError("El username es obligatorio")
    if not display_name.strip():
        raise ValueError("El nombre visible es obligatorio")

    primary_role = (role or "").strip().upper()
    desired_roles = [r.strip().upper() for r in (roles or [primary_role]) if r and r.strip()]
    if primary_role and primary_role not in desired_roles:
        desired_roles.insert(0, primary_role)
    desired_roles = list(dict.fromkeys(desired_roles))  # dedup conservando orden
    if not desired_roles:
        raise ValueError("Indicá al menos un rol")
    if not primary_role:
        primary_role = desired_roles[0]

    desired_branches = [b for b in (branch_ids or []) if b]
    if branch_id and branch_id not in desired_branches:
        desired_branches.insert(0, branch_id)
    desired_branches = list(dict.fromkeys(desired_branches))
    primary_branch = (branch_id or (desired_branches[0] if desired_branches else "")) or None

    with db_session() as session:
        u = session.scalar(select(User).where(User.username == uname))
        if u:
            u.display_name = display_name.strip()
            u.is_active = bool(is_active)
            if password is not None and password.strip():
                u.password_hash = hash_password(password)
                u.must_change_password = False
        else:
            pwd_hash = hash_password(password) if password and password.strip() else ""
            u = User(
                username=uname,
                display_name=display_name.strip(),
                password_hash=pwd_hash,
                is_active=bool(is_active),
                must_change_password=(not pwd_hash),
            )
            session.add(u)
            session.flush()

        # Sincronizar roles
        all_roles = {r.name: r for r in session.scalars(select(Role)).all()}
        for name in desired_roles:
            if name not in all_roles:
                # Si el rol no existe, lo creamos vacío (caso raro, mejor que ignorar)
                new_role = Role(name=name, label=name, level=0, permissions=[])
                session.add(new_role)
                session.flush()
                all_roles[name] = new_role

        existing_links = session.scalars(select(UserRole).where(UserRole.user_id == u.id)).all()
        existing_role_ids = {link.role_id: link for link in existing_links}
        desired_role_ids = {all_roles[name].id for name in desired_roles}
        # Borrar los que sobran
        for rid, link in list(existing_role_ids.items()):
            if rid not in desired_role_ids:
                session.delete(link)
        # Agregar/actualizar
        primary_role_id = all_roles[primary_role].id
        for name in desired_roles:
            rid = all_roles[name].id
            link = existing_role_ids.get(rid)
            if link is None:
                session.add(UserRole(user_id=u.id, role_id=rid, is_primary=(rid == primary_role_id)))
            else:
                link.is_primary = (rid == primary_role_id)

        # Sincronizar branches (alcance)
        valid_branch_ids = {
            bid for (bid,) in session.execute(
                select(Branch.id).where(Branch.id.in_(desired_branches))
            ).all()
        } if desired_branches else set()
        existing_branch_links = session.scalars(
            select(UserBranch).where(UserBranch.user_id == u.id)
        ).all()
        existing_branch_ids = {link.branch_id: link for link in existing_branch_links}
        for bid, link in list(existing_branch_ids.items()):
            if bid not in valid_branch_ids:
                session.delete(link)
        for bid in desired_branches:
            if bid not in valid_branch_ids:
                continue
            link = existing_branch_ids.get(bid)
            is_primary = (bid == primary_branch)
            if link is None:
                session.add(UserBranch(user_id=u.id, branch_id=bid, is_primary=is_primary))
            else:
                link.is_primary = is_primary

        session.commit()
        return _user_to_payload(u, session)


def set_user_active_pg(username: str, is_active: bool) -> dict[str, Any] | None:
    with db_session() as session:
        u = session.scalar(select(User).where(User.username == username.strip().lower()))
        if not u:
            return None
        u.is_active = bool(is_active)
        session.commit()
        return _user_to_payload(u, session)


def delete_user_pg(username: str) -> bool:
    with db_session() as session:
        u = session.scalar(select(User).where(User.username == username.strip().lower()))
        if not u:
            return False
        session.delete(u)
        session.commit()
        return True


def reset_user_password_pg(username: str) -> dict[str, Any] | None:
    """Limpia el password_hash → must_change_password=True (el usuario lo crea en el próximo login)."""
    with db_session() as session:
        u = session.scalar(select(User).where(User.username == username.strip().lower()))
        if not u:
            return None
        u.password_hash = ""
        u.must_change_password = True
        session.commit()
        return _user_to_payload(u, session)


def set_user_password_pg(username: str, new_password: str) -> dict[str, Any] | None:
    if not new_password or not new_password.strip():
        raise ValueError("La contraseña no puede estar vacía")
    with db_session() as session:
        u = session.scalar(select(User).where(User.username == username.strip().lower()))
        if not u:
            return None
        u.password_hash = hash_password(new_password)
        u.must_change_password = False
        session.commit()
        return _user_to_payload(u, session)
