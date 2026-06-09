"""Sales BI comercial basado en Ventas Vs. Costos.

Esta capa es independiente de `sales_imports` / `sales_records`.
Las planillas diarias guardan datos operativos; estas tablas guardan lectura
comercial comparable por producto, marca, linea/tipo y sucursal.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class SalesBICommercialBatch(Base):
    __tablename__ = "sales_bi_commercial_batches"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source_kind: Mapped[str] = mapped_column(Text, default="ventas_vs_costos", nullable=False, index=True)
    fuente_nombre: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fuente_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(Text, default="activo", nullable=False, index=True)

    period_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    period_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    total_records: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_pvp: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_costo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_diferencia: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)

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

    records: Mapped[list["SalesBICommercialRecord"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class SalesBICommercialCorrection(Base):
    __tablename__ = "sales_bi_commercial_corrections"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    match_sku_norm: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    match_desc_norm: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    match_brand_norm: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    match_type_norm: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    corrected_sku: Mapped[str] = mapped_column(Text, default="", nullable=False)
    corrected_description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    corrected_brand: Mapped[str] = mapped_column(Text, default="", nullable=False)
    corrected_type: Mapped[str] = mapped_column(Text, default="", nullable=False)
    product_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SalesBICommercialRecord(Base):
    __tablename__ = "sales_bi_commercial_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("sales_bi_commercial_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_sheet: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    row_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sucursal: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tipo_venta: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    marca_raw: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tipo_raw: Mapped[str] = mapped_column(Text, default="", nullable=False)
    descripcion_raw: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku_raw: Mapped[str] = mapped_column(Text, default="", nullable=False)

    marca: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    tipo_producto: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    # Categoria comercial (5 buckets): LINEA BLANCA / COCINA / CLIMATIZACION /
    # TV / AUDIO / PEQUENOS / OTROS. Derivada de `tipo_producto` con la misma
    # taxonomía de `sales_bi._classify`. Es la dimensión "línea" que ve el
    # gerente en el dashboard (más útil que el tipo granular tipo HELADERA).
    categoria: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    descripcion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    sku_normalized: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    descripcion_normalized: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    product_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    correction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sales_bi_commercial_corrections.id", ondelete="SET NULL"), nullable=True, index=True
    )
    match_status: Mapped[str] = mapped_column(Text, default="unmatched", nullable=False, index=True)

    cantidad: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    pvp: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    costo: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    diferencia: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    margen_porcentaje: Mapped[Numeric] = mapped_column(Numeric(14, 2), default=0, nullable=False)

    batch: Mapped["SalesBICommercialBatch"] = relationship(back_populates="records")
