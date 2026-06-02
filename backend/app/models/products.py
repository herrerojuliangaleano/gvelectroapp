"""Catálogo de productos: products, marcas, proveedores, vínculo marca↔proveedor,
logs de sync con Google Sheets.

Cambios vs. SQLite:
- `pvp`, `costo_vigente` en NUMERIC(14,2).
- `is_active` en BOOLEAN.
- `errors_json` (TEXT) → JSONB.
- `actor_username` en sync logs → `actor_user_id` (FK).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(Text, nullable=False)
    sku_normalized: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    marca: Mapped[str] = mapped_column(Text, default="", nullable=False)
    marca_normalized: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    descripcion: Mapped[str] = mapped_column(Text, default="", nullable=False)

    pvp: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    pvp_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    costo_vigente: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    costo_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    condicion_producto: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Texto agregado para búsqueda full-text simple.
    search_text: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Origen del dato (Google Sheet, hoja, fila).
    source_sheet: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_row: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ProductBrand(Base):
    __tablename__ = "product_brands"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    brand_providers: Mapped[list["BrandProvider"]] = relationship(
        back_populates="brand", cascade="all, delete-orphan"
    )


class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    contact_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    email: Mapped[str] = mapped_column(Text, default="", nullable=False)
    phone: Mapped[str] = mapped_column(Text, default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    brand_providers: Mapped[list["BrandProvider"]] = relationship(
        back_populates="provider", cascade="all, delete-orphan"
    )


class BrandProvider(Base):
    """N–N marca ↔ proveedor, con flag de proveedor por defecto."""
    __tablename__ = "brand_providers"
    __table_args__ = (UniqueConstraint("brand_id", "provider_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    brand_id: Mapped[int] = mapped_column(
        ForeignKey("product_brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_id: Mapped[int] = mapped_column(
        ForeignKey("providers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    brand: Mapped["ProductBrand"] = relationship(back_populates="brand_providers")
    provider: Mapped["Provider"] = relationship(back_populates="brand_providers")


class ProductSyncLog(Base):
    """Log de sincronización del catálogo con Google Sheets."""
    __tablename__ = "product_sync_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(Text, default="google_sheet", nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)

    actor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    rows_processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    brands_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    price_changes_detected: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_changes_detected: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_cost_updates_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_cost_updates_skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    errors: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    spreadsheet_id: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sheet_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
