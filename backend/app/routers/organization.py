"""Organización: companies y branches (Fase 2.5c · Postgres puro)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import audit
from ..auth import require_permission
from ..db import get_session
from ..models.org import Branch, Company
from ..users import CurrentUser

router = APIRouter(prefix="/api", tags=["organization"])

BranchType = Literal["physical", "web", "deposit", "admin"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _company_to_dict(c: Company) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "legal_name": c.legal_name or "",
        "cuit": c.cuit or "",
        "is_active": bool(c.is_active),
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def _branch_to_dict(b: Branch, session: Session) -> dict:
    company_name = ""
    if b.company_id:
        c = session.get(Company, b.company_id)
        company_name = c.name if c else ""
    parent_branch_name = ""
    if b.parent_branch_id:
        parent = session.get(Branch, b.parent_branch_id)
        parent_branch_name = parent.name if parent else ""
    return {
        "id": b.id,
        "company_id": b.company_id or "",
        "company_name": company_name,
        "name": b.name,
        "code": b.code,
        "type": b.type,
        "parent_branch_id": b.parent_branch_id,
        "parent_branch_name": parent_branch_name,
        "direccion": b.direccion or "",
        "direccion_fiscal": b.direccion_fiscal or "",
        "is_active": bool(b.is_active),
        "created_at": b.created_at.isoformat() if b.created_at else "",
        "updated_at": b.updated_at.isoformat() if b.updated_at else "",
    }


class CompanyPayload(BaseModel):
    name: str = Field(min_length=1)
    legal_name: str | None = ""
    cuit: str | None = ""
    is_active: bool = True


class CompanyPatchPayload(BaseModel):
    name: str | None = None
    legal_name: str | None = None
    cuit: str | None = None
    is_active: bool | None = None


class CompanyOut(BaseModel):
    id: str
    name: str
    legal_name: str = ""
    cuit: str = ""
    is_active: bool
    created_at: str
    updated_at: str


class BranchPayload(BaseModel):
    company_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    code: str | None = ""
    type: BranchType = "physical"
    parent_branch_id: str | None = None
    direccion: str = ""
    direccion_fiscal: str = ""
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str | None) -> str:
        return str(value or "").strip().upper().replace(" ", "_")


class BranchPatchPayload(BaseModel):
    company_id: str | None = None
    name: str | None = None
    code: str | None = None
    type: BranchType | None = None
    parent_branch_id: str | None = None
    direccion: str | None = None
    direccion_fiscal: str | None = None
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return str(value or "").strip().upper().replace(" ", "_")


class BranchOut(BaseModel):
    id: str
    company_id: str
    company_name: str = ""
    name: str
    code: str
    type: BranchType
    parent_branch_id: str | None = None
    parent_branch_name: str = ""
    direccion: str = ""
    direccion_fiscal: str = ""
    is_active: bool
    created_at: str
    updated_at: str


class OperationalStructureOut(BaseModel):
    companies: list[CompanyOut]
    branches: list[BranchOut]


def _ensure_company_exists(session: Session, company_id: str) -> None:
    if not session.get(Company, company_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empresa inexistente")


def _ensure_parent_branch_valid(session: Session, branch_id: str | None, current_branch_id: str | None = None) -> None:
    if not branch_id:
        return
    if current_branch_id and branch_id == current_branch_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Una sucursal no puede depender de sí misma")
    if not session.get(Branch, branch_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sucursal base inexistente")


def _branch_code_from_name(name: str) -> str:
    raw = "".join(ch if ch.isalnum() else "_" for ch in name.strip().upper())
    while "__" in raw:
        raw = raw.replace("__", "_")
    return raw.strip("_") or f"BRANCH_{uuid.uuid4().hex[:8].upper()}"


def _unique_branch_code(session: Session, desired_code: str, current_branch_id: str | None = None) -> str:
    code = desired_code.strip().upper().replace(" ", "_") or "BRANCH"
    base = code
    n = 2
    while True:
        existing = session.scalar(select(Branch).where(Branch.code == code))
        if not existing or (current_branch_id and existing.id == current_branch_id):
            return code
        code = f"{base}_{n}"
        n += 1


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/companies", response_model=list[CompanyOut])
def list_companies(
    _user: Annotated[CurrentUser, Depends(require_permission("companies.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    rows = session.scalars(
        select(Company).order_by(Company.is_active.desc(), Company.name.asc())
    ).all()
    return [CompanyOut(**_company_to_dict(c)) for c in rows]


@router.post("/companies", response_model=CompanyOut)
def create_company(
    payload: CompanyPayload,
    user: Annotated[CurrentUser, Depends(require_permission("companies.manage"))],
    session: Annotated[Session, Depends(get_session)],
):
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    company = Company(
        id=company_id,
        name=payload.name.strip(),
        legal_name=str(payload.legal_name or "").strip(),
        cuit=str(payload.cuit or "").strip(),
        is_active=payload.is_active,
    )
    session.add(company)
    session.commit()
    session.refresh(company)
    audit("companies.create", user=user, resource_type="company", resource_id=company_id, details={"name": payload.name})
    return CompanyOut(**_company_to_dict(company))


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def update_company(
    company_id: str,
    payload: CompanyPatchPayload,
    user: Annotated[CurrentUser, Depends(require_permission("companies.manage"))],
    session: Annotated[Session, Depends(get_session)],
):
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empresa no encontrada")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El nombre es obligatorio")
        company.name = name
    if payload.legal_name is not None:
        company.legal_name = payload.legal_name.strip()
    if payload.cuit is not None:
        company.cuit = payload.cuit.strip()
    if payload.is_active is not None:
        company.is_active = payload.is_active
    session.commit()
    session.refresh(company)
    audit("companies.update", user=user, resource_type="company", resource_id=company_id, details=payload.model_dump(exclude_unset=True))
    return CompanyOut(**_company_to_dict(company))


@router.get("/branches", response_model=list[BranchOut])
def list_branches(
    _user: Annotated[CurrentUser, Depends(require_permission("branches.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    rows = session.scalars(
        select(Branch).order_by(Branch.name.asc())
    ).all()
    return [BranchOut(**_branch_to_dict(b, session)) for b in rows]


@router.post("/branches", response_model=BranchOut)
def create_branch(
    payload: BranchPayload,
    user: Annotated[CurrentUser, Depends(require_permission("branches.manage"))],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_company_exists(session, payload.company_id)
    _ensure_parent_branch_valid(session, payload.parent_branch_id)
    branch_id = f"branch_{uuid.uuid4().hex[:12]}"
    code = _unique_branch_code(session, payload.code or _branch_code_from_name(payload.name))
    branch = Branch(
        id=branch_id,
        company_id=payload.company_id,
        name=payload.name.strip(),
        code=code,
        type=payload.type,
        parent_branch_id=payload.parent_branch_id or None,
        direccion=(payload.direccion or "").strip(),
        direccion_fiscal=(payload.direccion_fiscal or "").strip(),
        is_active=payload.is_active,
    )
    session.add(branch)
    session.commit()
    session.refresh(branch)
    audit("branches.create", user=user, resource_type="branch", resource_id=branch_id, details={"name": payload.name, "type": payload.type})
    return BranchOut(**_branch_to_dict(branch, session))


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_branch(
    branch_id: str,
    payload: BranchPatchPayload,
    user: Annotated[CurrentUser, Depends(require_permission("branches.manage"))],
    session: Annotated[Session, Depends(get_session)],
):
    branch = session.get(Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sucursal no encontrada")
    new_company_id = payload.company_id if payload.company_id is not None else branch.company_id
    new_parent_id = payload.parent_branch_id if payload.parent_branch_id is not None else branch.parent_branch_id
    _ensure_company_exists(session, new_company_id)
    _ensure_parent_branch_valid(session, new_parent_id, branch_id)

    if payload.company_id is not None:
        branch.company_id = payload.company_id
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El nombre es obligatorio")
        branch.name = name
    if payload.code is not None:
        new_code = _unique_branch_code(session, payload.code or _branch_code_from_name(payload.name or branch.name), branch_id)
        branch.code = new_code
    if payload.type is not None:
        branch.type = payload.type
    if payload.parent_branch_id is not None:
        branch.parent_branch_id = payload.parent_branch_id or None
    if payload.direccion is not None:
        branch.direccion = payload.direccion.strip()
    if payload.direccion_fiscal is not None:
        branch.direccion_fiscal = payload.direccion_fiscal.strip()
    if payload.is_active is not None:
        branch.is_active = payload.is_active
    session.commit()
    session.refresh(branch)
    audit("branches.update", user=user, resource_type="branch", resource_id=branch_id, details=payload.model_dump(exclude_unset=True))
    return BranchOut(**_branch_to_dict(branch, session))


@router.get("/operational-structure", response_model=OperationalStructureOut)
def operational_structure(
    _user: Annotated[CurrentUser, Depends(require_permission("branches.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    company_rows = session.scalars(
        select(Company).order_by(Company.is_active.desc(), Company.name.asc())
    ).all()
    branch_rows = session.scalars(
        select(Branch).order_by(Branch.name.asc())
    ).all()
    return OperationalStructureOut(
        companies=[CompanyOut(**_company_to_dict(c)) for c in company_rows],
        branches=[BranchOut(**_branch_to_dict(b, session)) for b in branch_rows],
    )
