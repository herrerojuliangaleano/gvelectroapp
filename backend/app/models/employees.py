"""RRHH: empleados, historial laboral, recibos de sueldo.

Cambios vs. SQLite:
- `employees.user_id` (FK a `users.id`, SET NULL) reemplaza al link por `username`.
- `employees.manager_id` (FK auto-ref a employees, SET NULL).
- Historial de estado laboral con `actor_user_id` real.
- Recibos con `uploaded_by_user_id` / `signed_by_user_id` reales.
- Importes (no aplica acá; los importes operan en otros dominios).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dni: Mapped[Optional[str]] = mapped_column(Text, unique=True, nullable=True)

    # Vínculo 1:1 opcional con un usuario del sistema.
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True, index=True
    )

    # Datos personales / identidad legal
    first_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    last_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    display_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    birthdate: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gender: Mapped[str] = mapped_column(Text, default="", nullable=False)
    civil_status: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Datos laborales
    company_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    work_branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    manager_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    position: Mapped[str] = mapped_column(Text, default="", nullable=False)
    department: Mapped[str] = mapped_column(Text, default="", nullable=False)
    contract_type: Mapped[str] = mapped_column(Text, default="", nullable=False)
    hire_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Contacto
    phone: Mapped[str] = mapped_column(Text, default="", nullable=False)
    personal_email: Mapped[str] = mapped_column(Text, default="", nullable=False)
    address: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Foto profesional
    photo_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    photo_status: Mapped[str] = mapped_column(Text, default="sin_foto", nullable=False)
    photo_uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Estado laboral (alta | licencia | baja); se valida en la app.
    status: Mapped[str] = mapped_column(Text, default="alta", nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relaciones
    user: Mapped[Optional["User"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "User", lazy="joined", foreign_keys="Employee.user_id"
    )
    company: Mapped[Optional["Company"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Company", lazy="joined", foreign_keys="Employee.company_id"
    )
    branch: Mapped[Optional["Branch"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch", lazy="joined", foreign_keys="Employee.branch_id"
    )
    work_branch: Mapped[Optional["Branch"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch", lazy="joined", foreign_keys="Employee.work_branch_id"
    )
    status_history: Mapped[list["EmployeeStatusHistory"]] = relationship(
        back_populates="employee", cascade="all, delete-orphan", order_by="EmployeeStatusHistory.created_at.desc()"
    )
    payroll_receipts: Mapped[list["PayrollReceipt"]] = relationship(back_populates="employee")
    direct_reports: Mapped[list["Employee"]] = relationship(
        back_populates="manager", remote_side="Employee.manager_id"
    )
    manager: Mapped[Optional["Employee"]] = relationship(
        back_populates="direct_reports", remote_side="Employee.id"
    )


class EmployeeStatusHistory(Base):
    """Historial de cambios alta/licencia/baja con motivo y fechas."""
    __tablename__ = "employee_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    previous_status: Mapped[str] = mapped_column(Text, default="", nullable=False)
    motivo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    categoria: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_desde: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    fecha_hasta: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    observaciones: Mapped[str] = mapped_column(Text, default="", nullable=False)
    actor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    employee: Mapped["Employee"] = relationship(back_populates="status_history")


class PayrollReceipt(Base):
    """Recibo de sueldo. Archivo concreto (PDF/imagen) más metadatos."""
    __tablename__ = "payroll_receipts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_month: Mapped[int] = mapped_column(Integer, nullable=False)
    receipt_type: Mapped[str] = mapped_column(Text, default="mensual", nullable=False)

    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    file_content_type: Mapped[str] = mapped_column(Text, default="", nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    file_hash: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Estado del recibo: pendiente | firmado | observado | anulado (valida la app).
    status: Mapped[str] = mapped_column(Text, default="pendiente", nullable=False, index=True)

    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    viewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    viewed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    signed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancel_reason: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Si fue reemplazado por otra versión del recibo.
    replaced_by_receipt_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("payroll_receipts.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    employee: Mapped["Employee"] = relationship(back_populates="payroll_receipts")
    observations: Mapped[list["PayrollReceiptObservation"]] = relationship(
        back_populates="receipt", cascade="all, delete-orphan"
    )


class PayrollReceiptObservation(Base):
    """Observación del empleado sobre el recibo, con respuesta de RRHH."""
    __tablename__ = "payroll_receipt_observations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_receipts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # abierta | respondida (valida la app).
    status: Mapped[str] = mapped_column(Text, default="abierta", nullable=False, index=True)

    answered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    answered_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    answer_message: Mapped[str] = mapped_column(Text, default="", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    receipt: Mapped["PayrollReceipt"] = relationship(back_populates="observations")
