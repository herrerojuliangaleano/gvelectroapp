"""Módulo Comercial — PSI (Planificación de Ventas e Inventario).

Tabla `sales_psi_adjustments`: ajustes manuales que hace el gerente comercial
desde la pantalla PSI sobre el sell out de un producto. Cada ajuste:

1. Se crea con `status='pending'`.
2. Se aplica inmediatamente al libro mensual de ventas en Drive (escribe
   una fila en la hoja BASE_<sucursal>). Pasa a `status='applied_to_sheet'`.
3. Cuando el operador corre `gg.py`, el GFK lo incluye automáticamente
   porque ya está en el libro mensual.
4. Si hay que revertir, se borra la fila del sheet (identificada por
   `Remito="PSI-{id}"`) y pasa a `status='reverted'`.

Ver `docs/10-modulo-comercial-fase1.md` §9 para schema y §11 para algoritmo
de escritura.
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
