"""Catálogo maestro de productos (módulo Maestro/Alta/Normalización).

Catálogo NUEVO que vive al lado del `products` legacy. La migración es
producto por producto: cada `products` legacy se vincula a un
`catalog_products` via `products.catalog_product_id`. Cuando todos los legacy
están vinculados, el sistema detecta "transición completa" y recién ahí se
decide el corte (los 16 consumidores siguen leyendo `products` legacy hasta
entonces).

Ver docs del módulo (Maestro, Alta y Normalización de Productos).

Tablas:
- catalog_products        : el maestro nuevo (1 fila = 1 producto normalizado)
- catalog_aliases         : equivalencias históricas (SKU/desc viejos → producto)
- catalog_price_history   : historial de PVP (from-to)
- catalog_cost_history    : historial de costo (from-to)
- catalog_templates       : plantillas de descripción + campos obligatorios por rubro
- catalog_abbreviations   : diccionario de abreviaturas ERP
- catalog_change_log      : auditoría campo a campo
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class CatalogProduct(Base):
    """Producto del maestro nuevo. Estados: BORRADOR, PENDIENTE_REVISION,
    PENDIENTE_ALTA_ERP, ALTA_ERP_GENERADA, PENDIENTE_CODIGO_PUMA, ACTIVO,
    INACTIVO, RECHAZADO, DISCONTINUADO."""
    __tablename__ = "catalog_products"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # ── Identificadores ────────────────────────────────────────────────
    codigo_puma: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)  # manual
    sku_base: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku_comercial: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku_comercial_normalized: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    # ── Descripciones ──────────────────────────────────────────────────
    descripcion_base: Mapped[str] = mapped_column(Text, default="", nullable=False)
    descripcion_comercial: Mapped[str] = mapped_column(Text, default="", nullable=False)
    descripcion_erp: Mapped[str] = mapped_column(Text, default="", nullable=False)   # máx 50, sin OUTLET
    descripcion_original: Mapped[str] = mapped_column(Text, default="", nullable=False)  # trazabilidad

    # ── Marca ──────────────────────────────────────────────────────────
    marca: Mapped[str] = mapped_column(Text, default="", nullable=False)
    marca_normalized: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    # ── Clasificación comercial propia (manda para reportes) ───────────
    familia_app: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    rubro_app: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    subrubro_app: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # ── Clasificación ERP (solo referencia) ────────────────────────────
    familia_erp: Mapped[str] = mapped_column(Text, default="", nullable=False)
    rubro_erp: Mapped[str] = mapped_column(Text, default="", nullable=False)
    subrubro_erp: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # ── Condición / estado ─────────────────────────────────────────────
    condicion: Mapped[str] = mapped_column(Text, default="PRIMERA", nullable=False, index=True)  # PRIMERA|OUTLET
    estado: Mapped[str] = mapped_column(Text, default="BORRADOR", nullable=False, index=True)
    activo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    # Para outlet: producto base del que deriva (mismo sku_base, condicion PRIMERA).
    producto_base_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True
    )

    # ── Auditoría ──────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    aliases: Mapped[list["CatalogAlias"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class CatalogAlias(Base):
    """Equivalencia histórica: cómo se llamaba antes un producto. Permite
    reutilizar ventas/costos/garantías/presupuestos viejos."""
    __tablename__ = "catalog_aliases"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    catalog_product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sku_anterior: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    descripcion_anterior: Mapped[str] = mapped_column(Text, default="", nullable=False)
    codigo_puma_anterior: Mapped[str] = mapped_column(Text, default="", nullable=False)
    origen: Mapped[str] = mapped_column(Text, default="", nullable=False)  # planilla_madre / puma / existencias / manual
    # SKU_IGUAL, CODIGO_PUMA_IGUAL, DESCRIPCION_PARECIDA, CORRECCION_MANUAL,
    # OUTLET, DUPLICADO_FUSIONADO, MIGRACION_INICIAL
    tipo_equivalencia: Mapped[str] = mapped_column(Text, default="", nullable=False)
    confianza: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    revisado: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    observacion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    product: Mapped["CatalogProduct"] = relationship(back_populates="aliases")


class CatalogPriceHistory(Base):
    __tablename__ = "catalog_price_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    catalog_product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pvp: Mapped[Numeric] = mapped_column(Numeric(14, 2), nullable=False)
    fecha_desde: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_hasta: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # NULL = vigente
    motivo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CatalogCostHistory(Base):
    __tablename__ = "catalog_cost_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    catalog_product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    costo: Mapped[Numeric] = mapped_column(Numeric(14, 2), nullable=False)
    moneda: Mapped[str] = mapped_column(Text, default="ARS", nullable=False)
    proveedor: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_desde: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_hasta: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # NULL = vigente
    motivo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CatalogTemplate(Base):
    """Plantilla por familia+rubro: campos obligatorios y formatos de
    descripción (base/comercial/erp/subrubro)."""
    __tablename__ = "catalog_templates"
    __table_args__ = (UniqueConstraint("familia_app", "rubro_app", name="ux_catalog_template_fam_rubro"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    familia_app: Mapped[str] = mapped_column(Text, default="", nullable=False)
    rubro_app: Mapped[str] = mapped_column(Text, default="", nullable=False)
    campos_obligatorios: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    formato_descripcion_base: Mapped[str] = mapped_column(Text, default="", nullable=False)
    formato_descripcion_comercial: Mapped[str] = mapped_column(Text, default="", nullable=False)
    formato_descripcion_erp: Mapped[str] = mapped_column(Text, default="", nullable=False)
    formato_subrubro: Mapped[str] = mapped_column(Text, default="", nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class CatalogAbbreviation(Base):
    """Diccionario de abreviaturas ERP (AIRE ACONDICIONADO → A/A, etc.)."""
    __tablename__ = "catalog_abbreviations"
    __table_args__ = (UniqueConstraint("texto_original", name="ux_catalog_abbr_texto"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    texto_original: Mapped[str] = mapped_column(Text, nullable=False)
    abreviatura_erp: Mapped[str] = mapped_column(Text, nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CatalogChangeLog(Base):
    """Auditoría campo a campo de los cambios importantes del catálogo."""
    __tablename__ = "catalog_change_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    catalog_product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campo: Mapped[str] = mapped_column(Text, nullable=False)
    valor_anterior: Mapped[str] = mapped_column(Text, default="", nullable=False)
    valor_nuevo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    motivo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    changed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
