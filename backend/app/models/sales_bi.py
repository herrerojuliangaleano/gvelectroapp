"""Inteligencia comercial (sales BI): imports, records y balances.

Dominio analítico. Cambios vs. SQLite:
- Importes (totales, pvp, costo, etc.) en NUMERIC(14,2) (eran REAL).
- `imported_by` (texto username) → `imported_by_user_id` (FK).
- `branch_id` (texto suelto) → FK opcional a `branches.id`.
- `warnings_json` (TEXT JSON) → JSONB.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class SalesImport(Base):
    __tablename__ = "sales_imports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sucursal: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    fuente: Mapped[str] = mapped_column(Text, nullable=False)
    fuente_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fuente_nombre: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # activo | anulado (valida la app).
    status: Mapped[str] = mapped_column(Text, default="activo", nullable=False, index=True)

    total_records: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_pvp: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_costo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_efectivo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_transferencia: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_tarjeta: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_usd: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_cuenta_corriente: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_otros: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    cotizacion_dolar: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)

    imported_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    voided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    void_reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    warnings: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    records: Mapped[list["SalesRecord"]] = relationship(
        back_populates="import_", cascade="all, delete-orphan"
    )
    balances: Mapped[list["SalesBalance"]] = relationship(
        back_populates="import_", cascade="all, delete-orphan"
    )


class SalesRecord(Base):
    __tablename__ = "sales_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    import_id: Mapped[int] = mapped_column(
        ForeignKey("sales_imports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nro_linea: Mapped[int] = mapped_column(Integer, nullable=False)

    remito: Mapped[str] = mapped_column(Text, default="", nullable=False)
    vendedor: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    producto: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    marca: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tipo_producto: Mapped[str] = mapped_column(Text, default="", nullable=False)
    condicion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    categoria: Mapped[str] = mapped_column(Text, default="", nullable=False)
    linea: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cantidad: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    pvp: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    costo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    diferencia: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    margen_porcentaje: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    efectivo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    transferencia: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    tarjeta: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    usd: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    cuenta_corriente: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    otros: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_cobrado: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    saldo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)

    import_: Mapped["SalesImport"] = relationship(back_populates="records")


class SalesBalance(Base):
    __tablename__ = "sales_balances"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    import_id: Mapped[int] = mapped_column(
        ForeignKey("sales_imports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    remito: Mapped[str] = mapped_column(Text, default="", nullable=False)

    efectivo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    transferencia: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    tarjeta: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    usd: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    otros: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)

    import_: Mapped["SalesImport"] = relationship(back_populates="balances")
