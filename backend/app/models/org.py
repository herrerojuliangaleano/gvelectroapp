"""Organización: companies & branches (datos de referencia).

PK = slug TEXT (legible, estable, referenciada en todos lados). Ver DATA_MODEL.md.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, ej. "electro_gv"
    name: Mapped[str] = mapped_column(Text, nullable=False)
    legal_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cuit: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    branches: Mapped[list["Branch"]] = relationship(back_populates="company")


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, ej. "caseros"
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    type: Mapped[str] = mapped_column(Text, default="physical", nullable=False, index=True)
    parent_branch_id: Mapped[Optional[str]] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True)
    # Fase A.5.5 · dirección física (donde está la sucursal) + dirección fiscal
    # (para facturación, puede diferir — típico en sucursales WEB).
    direccion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    direccion_fiscal: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    company: Mapped["Company"] = relationship(back_populates="branches")
    parent: Mapped[Optional["Branch"]] = relationship(remote_side="Branch.id", back_populates="children")
    children: Mapped[list["Branch"]] = relationship(back_populates="parent")
