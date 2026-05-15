from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from ..audit import audit
from ..auth import require_permission
from ..config import get_settings
from ..users import CurrentUser

router = APIRouter(prefix="/api", tags=["organization"])

BranchType = Literal["physical", "web", "deposit", "admin"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_company(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "legal_name": row["legal_name"] or "",
        "cuit": row["cuit"] or "",
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def row_to_branch(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "company_id": row["company_id"],
        "company_name": row["company_name"] or "",
        "name": row["name"],
        "code": row["code"],
        "type": row["type"],
        "parent_branch_id": row["parent_branch_id"],
        "parent_branch_name": row["parent_branch_name"] or "",
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
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
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str | None) -> str:
        code = str(value or "").strip().upper().replace(" ", "_")
        return code


class BranchPatchPayload(BaseModel):
    company_id: str | None = None
    name: str | None = None
    code: str | None = None
    type: BranchType | None = None
    parent_branch_id: str | None = None
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
    is_active: bool
    created_at: str
    updated_at: str


class OperationalStructureOut(BaseModel):
    companies: list[CompanyOut]
    branches: list[BranchOut]


def ensure_company_exists(conn: sqlite3.Connection, company_id: str) -> None:
    found = conn.execute("SELECT 1 FROM companies WHERE id = ?", (company_id,)).fetchone()
    if not found:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empresa inexistente")


def ensure_parent_branch_valid(conn: sqlite3.Connection, branch_id: str | None, current_branch_id: str | None = None) -> None:
    if not branch_id:
        return
    if current_branch_id and branch_id == current_branch_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Una sucursal no puede depender de sí misma")
    found = conn.execute("SELECT 1 FROM branches WHERE id = ?", (branch_id,)).fetchone()
    if not found:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sucursal base inexistente")


def branch_code_from_name(name: str) -> str:
    raw = "".join(ch if ch.isalnum() else "_" for ch in name.strip().upper())
    while "__" in raw:
        raw = raw.replace("__", "_")
    return raw.strip("_") or f"BRANCH_{uuid.uuid4().hex[:8].upper()}"


def unique_branch_code(conn: sqlite3.Connection, desired_code: str, current_branch_id: str | None = None) -> str:
    code = desired_code.strip().upper().replace(" ", "_") or "BRANCH"
    base = code
    n = 2
    while True:
        params: tuple[str, ...]
        sql = "SELECT id FROM branches WHERE code = ?"
        params = (code,)
        row = conn.execute(sql, params).fetchone()
        if not row or (current_branch_id and row["id"] == current_branch_id):
            return code
        code = f"{base}_{n}"
        n += 1


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(_user: Annotated[CurrentUser, Depends(require_permission("companies.view"))]):
    with connect() as conn:
        rows = conn.execute("SELECT * FROM companies ORDER BY is_active DESC, name COLLATE NOCASE").fetchall()
        return [CompanyOut(**row_to_company(row)) for row in rows]


@router.post("/companies", response_model=CompanyOut)
def create_company(payload: CompanyPayload, user: Annotated[CurrentUser, Depends(require_permission("companies.manage"))]):
    now = utc_now()
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO companies (id, name, legal_name, cuit, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (company_id, payload.name.strip(), str(payload.legal_name or "").strip(), str(payload.cuit or "").strip(), 1 if payload.is_active else 0, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    audit("companies.create", user=user, resource_type="company", resource_id=company_id, details={"name": payload.name})
    return CompanyOut(**row_to_company(row))


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def update_company(company_id: str, payload: CompanyPatchPayload, user: Annotated[CurrentUser, Depends(require_permission("companies.manage"))]):
    with connect() as conn:
        row = conn.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empresa no encontrada")
        updates: list[str] = []
        values: list[object] = []
        if payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El nombre es obligatorio")
            updates.append("name = ?")
            values.append(name)
        if payload.legal_name is not None:
            updates.append("legal_name = ?")
            values.append(payload.legal_name.strip())
        if payload.cuit is not None:
            updates.append("cuit = ?")
            values.append(payload.cuit.strip())
        if payload.is_active is not None:
            updates.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if updates:
            updates.append("updated_at = ?")
            values.append(utc_now())
            values.append(company_id)
            conn.execute(f"UPDATE companies SET {', '.join(updates)} WHERE id = ?", values)
            conn.commit()
        row = conn.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    audit("companies.update", user=user, resource_type="company", resource_id=company_id, details=payload.model_dump(exclude_unset=True))
    return CompanyOut(**row_to_company(row))


@router.get("/branches", response_model=list[BranchOut])
def list_branches(_user: Annotated[CurrentUser, Depends(require_permission("branches.view"))]):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT b.*, c.name AS company_name, parent.name AS parent_branch_name
            FROM branches b
            LEFT JOIN companies c ON c.id = b.company_id
            LEFT JOIN branches parent ON parent.id = b.parent_branch_id
            ORDER BY c.name COLLATE NOCASE, COALESCE(parent.name, b.name) COLLATE NOCASE, b.type = 'web', b.name COLLATE NOCASE
            """
        ).fetchall()
        return [BranchOut(**row_to_branch(row)) for row in rows]


@router.post("/branches", response_model=BranchOut)
def create_branch(payload: BranchPayload, user: Annotated[CurrentUser, Depends(require_permission("branches.manage"))]):
    now = utc_now()
    branch_id = f"branch_{uuid.uuid4().hex[:12]}"
    with connect() as conn:
        ensure_company_exists(conn, payload.company_id)
        ensure_parent_branch_valid(conn, payload.parent_branch_id)
        code = unique_branch_code(conn, payload.code or branch_code_from_name(payload.name))
        conn.execute(
            """
            INSERT INTO branches (id, company_id, name, code, type, parent_branch_id, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (branch_id, payload.company_id, payload.name.strip(), code, payload.type, payload.parent_branch_id or None, 1 if payload.is_active else 0, now, now),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT b.*, c.name AS company_name, parent.name AS parent_branch_name
            FROM branches b
            LEFT JOIN companies c ON c.id = b.company_id
            LEFT JOIN branches parent ON parent.id = b.parent_branch_id
            WHERE b.id = ?
            """,
            (branch_id,),
        ).fetchone()
    audit("branches.create", user=user, resource_type="branch", resource_id=branch_id, details={"name": payload.name, "type": payload.type})
    return BranchOut(**row_to_branch(row))


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_branch(branch_id: str, payload: BranchPatchPayload, user: Annotated[CurrentUser, Depends(require_permission("branches.manage"))]):
    with connect() as conn:
        existing = conn.execute("SELECT * FROM branches WHERE id = ?", (branch_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sucursal no encontrada")
        company_id = payload.company_id if payload.company_id is not None else existing["company_id"]
        parent_branch_id = payload.parent_branch_id if payload.parent_branch_id is not None else existing["parent_branch_id"]
        ensure_company_exists(conn, company_id)
        ensure_parent_branch_valid(conn, parent_branch_id, branch_id)
        updates: list[str] = []
        values: list[object] = []
        if payload.company_id is not None:
            updates.append("company_id = ?")
            values.append(payload.company_id)
        if payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El nombre es obligatorio")
            updates.append("name = ?")
            values.append(name)
        if payload.code is not None:
            updates.append("code = ?")
            values.append(unique_branch_code(conn, payload.code or branch_code_from_name(payload.name or existing["name"]), branch_id))
        if payload.type is not None:
            updates.append("type = ?")
            values.append(payload.type)
        if payload.parent_branch_id is not None:
            updates.append("parent_branch_id = ?")
            values.append(payload.parent_branch_id or None)
        if payload.is_active is not None:
            updates.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if updates:
            updates.append("updated_at = ?")
            values.append(utc_now())
            values.append(branch_id)
            conn.execute(f"UPDATE branches SET {', '.join(updates)} WHERE id = ?", values)
            conn.commit()
        row = conn.execute(
            """
            SELECT b.*, c.name AS company_name, parent.name AS parent_branch_name
            FROM branches b
            LEFT JOIN companies c ON c.id = b.company_id
            LEFT JOIN branches parent ON parent.id = b.parent_branch_id
            WHERE b.id = ?
            """,
            (branch_id,),
        ).fetchone()
    audit("branches.update", user=user, resource_type="branch", resource_id=branch_id, details=payload.model_dump(exclude_unset=True))
    return BranchOut(**row_to_branch(row))


@router.get("/operational-structure", response_model=OperationalStructureOut)
def operational_structure(_user: Annotated[CurrentUser, Depends(require_permission("branches.view"))]):
    with connect() as conn:
        company_rows = conn.execute("SELECT * FROM companies ORDER BY is_active DESC, name COLLATE NOCASE").fetchall()
        branch_rows = conn.execute(
            """
            SELECT b.*, c.name AS company_name, parent.name AS parent_branch_name
            FROM branches b
            LEFT JOIN companies c ON c.id = b.company_id
            LEFT JOIN branches parent ON parent.id = b.parent_branch_id
            ORDER BY c.name COLLATE NOCASE, COALESCE(parent.name, b.name) COLLATE NOCASE, b.type = 'web', b.name COLLATE NOCASE
            """
        ).fetchall()
    return OperationalStructureOut(
        companies=[CompanyOut(**row_to_company(row)) for row in company_rows],
        branches=[BranchOut(**row_to_branch(row)) for row in branch_rows],
    )
