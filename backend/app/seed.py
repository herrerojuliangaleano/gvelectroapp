"""Seed inicial de la base PostgreSQL (Fase 2.4).

Inserta los datos de referencia mínimos para que la app sea usable:
- companies (Electro GV, Electro ABC SRL)
- branches (sucursales físicas + variantes WEB + depósitos Chiclana/Corrales/Cachi)
- roles (los DEFAULT_ROLES de permissions.py)
- usuario admin (ADMIN_USER/ADMIN_PASSWORD) con rol SUPERADMIN

Es **idempotente**: correr varias veces no duplica datos ni rompe nada. Solo
crea lo que falta.

Uso:
    docker compose exec backend python -m app.seed
"""
from __future__ import annotations

from sqlalchemy import select

from .config import get_settings
from .db import db_session
from .models.auth import Role, User, UserBranch, UserRole
from .models.org import Branch, Company
from .permissions import DEFAULT_ROLES
from .security import hash_password


# (slug, name, legal_name, cuit)
SEED_COMPANIES = [
    ("electro_gv", "Electro GV", "Electro GV", ""),
    ("electro_abc_srl", "Electro ABC SRL", "Electro ABC SRL", ""),
]

# (slug, company_id, name, code, type, parent_branch_id)
# Los padres físicos van primero; las WEB después (se ordena por prioridad).
# IMPORTANTE: los slugs (PK) son estables. Si querés renombrar una sucursal,
# cambiá `name` y `code` pero NO el slug — las FKs históricas lo referencian.
SEED_BRANCHES = [
    ("caseros",           "electro_gv",      "Caseros",            "CASEROS",       "physical", None),
    ("caseros_web",       "electro_gv",      "Caseros - WEB",      "CASEROS_WEB",   "web",      "caseros"),
    ("canning",           "electro_abc_srl", "Canning",            "CANNING",       "physical", None),
    ("canning_web",       "electro_abc_srl", "Canning - WEB",      "CANNING_WEB",   "web",      "canning"),
    # Slug "norte" → name "Norcenter" (rename A.5.5).
    ("norte",             "electro_abc_srl", "Norcenter",          "NORCENTER",     "physical", None),
    ("norte_web",         "electro_abc_srl", "Norcenter - WEB",    "NORCENTER_WEB", "web",      "norte"),
    # Slug "sur" → name "Lanús" (rename A.5.5).
    ("sur",               "electro_abc_srl", "Lanús",              "LANUS",         "physical", None),
    ("sur_web",           "electro_abc_srl", "Lanús - WEB",        "LANUS_WEB",     "web",      "sur"),
    ("deposito_chiclana", "electro_gv",      "Depósito Chiclana",  "CHICLANA",      "deposit",  None),
    ("deposito_corrales", "electro_gv",      "Depósito Corrales",  "CORRALES",      "deposit",  None),
    ("deposito_cachi",    "electro_gv",      "Depósito Cachi",     "CACHI",         "deposit",  None),
]


def seed_companies(session) -> int:
    created = 0
    for slug, name, legal, cuit in SEED_COMPANIES:
        if session.get(Company, slug):
            continue
        session.add(Company(id=slug, name=name, legal_name=legal, cuit=cuit))
        created += 1
    if created:
        session.flush()
    return created


def seed_branches(session) -> int:
    """Crea sucursales en orden: primero las que no tienen padre, después las WEB."""
    created = 0
    by_priority = sorted(SEED_BRANCHES, key=lambda b: 0 if b[5] is None else 1)
    for slug, company_id, name, code, type_, parent in by_priority:
        if session.get(Branch, slug):
            continue
        session.add(Branch(
            id=slug, company_id=company_id, name=name, code=code,
            type=type_, parent_branch_id=parent,
        ))
        created += 1
    if created:
        session.flush()
    return created


def seed_roles(session) -> int:
    """Inserta los roles definidos en permissions.DEFAULT_ROLES."""
    created = 0
    for name, info in DEFAULT_ROLES.items():
        if session.scalar(select(Role).where(Role.name == name)):
            continue
        session.add(Role(
            name=name,
            label=str(info.get("label") or name),
            level=int(info.get("level") or 0),
            permissions=list(info.get("permissions") or []),
        ))
        created += 1
    if created:
        session.flush()
    return created


def seed_admin_user(session) -> bool:
    """Asegura que exista el usuario admin con rol SUPERADMIN y acceso a todas las sucursales."""
    settings = get_settings()
    admin_username = (settings.admin_user or "admin").strip().lower()
    admin_password = settings.admin_password or "admin"

    user = session.scalar(select(User).where(User.username == admin_username))
    created = False
    if not user:
        user = User(
            username=admin_username,
            display_name="Administrador",
            password_hash=hash_password(admin_password),
            is_active=True,
            must_change_password=False,
        )
        session.add(user)
        session.flush()
        created = True

    # Rol principal: SUPERADMIN.
    superadmin = session.scalar(select(Role).where(Role.name == "SUPERADMIN"))
    if superadmin:
        link = session.scalar(
            select(UserRole).where(
                UserRole.user_id == user.id,
                UserRole.role_id == superadmin.id,
            )
        )
        if not link:
            session.add(UserRole(user_id=user.id, role_id=superadmin.id, is_primary=True))

    # Alcance: admin tiene acceso a todas las sucursales; Depósito Chiclana como principal.
    primary_slug = "deposito_chiclana"
    all_branches = session.scalars(select(Branch)).all()
    for b in all_branches:
        existing_link = session.scalar(
            select(UserBranch).where(UserBranch.user_id == user.id, UserBranch.branch_id == b.id)
        )
        if not existing_link:
            session.add(UserBranch(user_id=user.id, branch_id=b.id, is_primary=(b.id == primary_slug)))

    return created


def run() -> dict[str, int | bool]:
    """Corre todos los seeds dentro de una sola transacción."""
    with db_session() as session:
        result = {
            "companies_created": seed_companies(session),
            "branches_created": seed_branches(session),
            "roles_created": seed_roles(session),
            "admin_user_created": seed_admin_user(session),
        }
        session.commit()
        return result


if __name__ == "__main__":
    out = run()
    print("Seed completo:")
    for k, v in out.items():
        print(f"  - {k}: {v}")
