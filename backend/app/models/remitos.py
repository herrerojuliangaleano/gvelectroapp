"""Remitos de garantías (interno y a proveedor).

Cambios vs. SQLite:
- Tabla renombrada de `warranty_remitos` a `remitos` (más limpio).
- `warranty_ids_json` (TEXT con array JSON) → tabla `remito_items` normalizada
  con FKs reales a `remitos` y `guarantees`.
- Origen/destino como FK a `branches.id`. Se mantienen también las columnas
  legacy con el texto para compatibilidad temporal hasta cerrar el porting.
- Actores (created/despachado/recibido) como FK a `users.id` (SET NULL).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class Remito(Base):
    __tablename__ = "remitos"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    remito_code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    shipment_code: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    # tipo_remito: sucursal_a_deposito | deposito_a_deposito | deposito_a_proveedor.
    tipo_remito: Mapped[str] = mapped_column(Text, default="sucursal_a_deposito", nullable=False, index=True)
    company_brand: Mapped[str] = mapped_column(Text, default="gv_electro", nullable=False)

    # Origen y destino: FK reales a branches.
    origen_branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    destino_branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Legacy de display.
    origen_sucursal: Mapped[str] = mapped_column(Text, default="", nullable=False)
    destino_deposito: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Proveedor destino (para remitos depósito → proveedor).
    proveedor: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # pendiente | en_transito | recibido | anulado (valida la app).
    status: Mapped[str] = mapped_column(Text, default="pendiente", nullable=False, index=True)
    nota: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pdf_path: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Actores del workflow.
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    despachado_por_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    recibido_por_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Fechas de workflow.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    fecha_despacho: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_llegada: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["RemitoItem"]] = relationship(
        back_populates="remito", cascade="all, delete-orphan"
    )


class RemitoItem(Base):
    """Línea de remito: una garantía dentro de un remito.

    Normaliza el `warranty_ids_json` denormalizado del esquema SQLite.
    """
    __tablename__ = "remito_items"
    __table_args__ = (UniqueConstraint("remito_id", "guarantee_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    remito_id: Mapped[int] = mapped_column(
        ForeignKey("remitos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    guarantee_id: Mapped[int] = mapped_column(
        ForeignKey("guarantees.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    remito: Mapped["Remito"] = relationship(back_populates="items")
