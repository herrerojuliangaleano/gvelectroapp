"""Módulo Comercial — PSI (Planificación de Ventas e Inventario).

Tablas:
- ``sales_psi_adjustments``: ajustes manuales del gerente (ventas y/o stock).
- ``psi_product_aliases``: matching manual cuando SKU/descripción no resuelven.

Ver `docs/10-modulo-comercial-fase1.md` para spec completa.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class SalesPsiAdjustment(Base):
    __tablename__ = "sales_psi_adjustments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # ── Producto referenciado ──────────────────────────────────────────
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Snapshots para que el ajuste sobreviva a cambios de catálogo / desactivación.
    sku_snapshot:       Mapped[str] = mapped_column(Text, nullable=False)
    marca_snapshot:     Mapped[str] = mapped_column(Text, nullable=False)
    tipo_snapshot:      Mapped[str] = mapped_column(Text, nullable=False)
    condicion_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion_snapshot: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # ── Ubicación temporal y geográfica ────────────────────────────────
    periodo_semana: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # Lunes de la semana de inserted_date. Útil para agrupar.
    inserted_date:  Mapped[date] = mapped_column(Date, nullable=False)
    # Fecha que se escribe al libro mensual (puede ser manual o random).
    sucursal:       Mapped[str] = mapped_column(Text, nullable=False, index=True)
    # CASEROS | SUR | NORTE | CANNING (dicta a qué hoja BASE_* se escribe).

    # ── El ajuste ──────────────────────────────────────────────────────
    cantidad_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # Positivo o negativo. 0 no es válido (validación de API).
    valor_estimado: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    # Opcional: PVP * cantidad_delta para la columna Valor del sheet.
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # ── Target ─────────────────────────────────────────────────────────
    # Qué dimensión ajusta este registro:
    #  'sell_out': solo ventas (escribe al GFK con +delta).
    #  'stock':    solo stock (solo Postgres; PSI muestra stock efectivo).
    #  'both':     ambos (escribe al GFK +delta, y descuenta del stock efectivo).
    target: Mapped[str] = mapped_column(Text, default="sell_out", nullable=False)

    # ── Modo de fecha (auditoría) ──────────────────────────────────────
    fecha_mode: Mapped[str] = mapped_column(Text, nullable=False)
    # 'manual' | 'random'

    # ── Lifecycle ──────────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(Text, default="pending", nullable=False, index=True)
    # 'pending' | 'applied_to_sheet' | 'reverted' | 'failed'

    applied_at:             Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_to_book:        Mapped[Optional[str]]      = mapped_column(Text, nullable=True)
    applied_to_sheet_range: Mapped[Optional[str]]      = mapped_column(Text, nullable=True)
    applied_by_user_id:     Mapped[Optional[int]]      = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    reverted_at:         Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reverted_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # ── Audit ──────────────────────────────────────────────────────────
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class PSIProductAlias(Base):
    """Alias manual entre un SKU/descripción del GFK y un producto del catálogo.

    Cuando el matcher SKU+Descripción no encuentra match automático, el gerente
    asocia manualmente desde la bandeja "no catalogados". El alias queda
    persistido — próxima vez el matcher lo resuelve sin intervención.

    Al menos uno de ``alias_sku_norm`` o ``alias_desc_norm`` debe estar definido
    (constraint a nivel DB en la migración).
    """

    __tablename__ = "psi_product_aliases"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Alias (uno o ambos)
    alias_sku_norm:  Mapped[Optional[str]] = mapped_column(Text, nullable=True, index=True)
    alias_desc_norm: Mapped[Optional[str]] = mapped_column(Text, nullable=True, index=True)
    # Snapshots originales (UI / auditoría)
    alias_sku_raw:   Mapped[str] = mapped_column(Text, default="", nullable=False)
    alias_desc_raw:  Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Audit
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
