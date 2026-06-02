"""Helpers de validación y resolución de Branches.

Centraliza chequeos que antes se replicaban en cada router (especialmente
``branch.type`` y ``branch.is_active``). Forma parte de la fundación
organizacional (ver `docs/05-fundacion-organizacional.md`, regla R1).

Política:
- ``assert_branch_*`` lanza HTTPException con mensaje legible si no cumple.
- ``get_branch_*`` devuelve None si no hay; el caller decide qué hacer.
- Las queries son rápidas (índice en PK), seguro hacerlas inline.
"""
from __future__ import annotations

from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import and_, func, select

from .db import db_session
from .models.org import Branch


VALID_BRANCH_TYPES = {"physical", "web", "deposit", "admin"}


def get_branch(branch_id: str) -> dict | None:
    """Devuelve dict con datos básicos de la branch o None si no existe / inactiva."""
    bid = (branch_id or "").strip()
    if not bid:
        return None
    with db_session() as session:
        b = session.get(Branch, bid)
        if not b or not b.is_active:
            return None
        return _branch_to_dict(b)


def get_branch_by_name_or_code(value: str) -> dict | None:
    """Busca branch activa por name o code (case-insensitive)."""
    v = (value or "").strip()
    if not v:
        return None
    lower = v.lower()
    with db_session() as session:
        b = session.scalar(
            select(Branch).where(
                and_(
                    Branch.is_active.is_(True),
                    func.lower(Branch.name) == lower,
                )
            )
        ) or session.scalar(
            select(Branch).where(
                and_(
                    Branch.is_active.is_(True),
                    func.lower(Branch.code) == lower,
                )
            )
        )
        return _branch_to_dict(b) if b else None


def assert_branch_type(
    branch_id: str,
    expected_types: Iterable[str],
    *,
    label: str = "sucursal",
) -> dict:
    """Verifica que la branch existe, está activa, y es del tipo esperado.

    Args:
        branch_id: slug PK de la branch (ej. "caseros", "deposito_chiclana").
        expected_types: iterable con uno o más de "physical", "web", "deposit", "admin".
        label: para el mensaje de error humano (ej. "origen", "destino").

    Returns:
        dict con los datos de la branch.

    Raises:
        HTTPException 400 si la branch no existe, está inactiva, o el tipo no coincide.
    """
    expected = set(expected_types) or VALID_BRANCH_TYPES
    bad = expected - VALID_BRANCH_TYPES
    if bad:
        raise ValueError(f"Tipos de branch inválidos: {bad}. Válidos: {VALID_BRANCH_TYPES}")

    b = get_branch(branch_id)
    if not b:
        raise HTTPException(400, f"{label.capitalize()} '{branch_id}' no encontrada o inactiva.")
    if b["type"] not in expected:
        nice = " o ".join(sorted(expected))
        raise HTTPException(
            400,
            f"{label.capitalize()} '{b['name']}' es de tipo '{b['type']}'; se esperaba {nice}.",
        )
    return b


def assert_different_branches(
    origin_id: str,
    destination_id: str,
    *,
    label_origin: str = "origen",
    label_destination: str = "destino",
) -> None:
    """Para remitos / movimientos: origen y destino no pueden ser la misma branch."""
    o = (origin_id or "").strip()
    d = (destination_id or "").strip()
    if o and d and o == d:
        raise HTTPException(
            400,
            f"{label_origin.capitalize()} y {label_destination} no pueden ser la misma sucursal.",
        )


def _branch_to_dict(b: Branch) -> dict:
    return {
        "id": b.id,
        "name": b.name or "",
        "code": b.code or "",
        "type": b.type or "",
        "company_id": b.company_id or "",
        "parent_branch_id": b.parent_branch_id or "",
        "is_active": bool(b.is_active),
    }
