"""Ventas web (solicitudes de venta online).

Cambios vs. SQLite:
- `vendedor_id` (texto username) → `vendedor_user_id` (FK a users).
- Importes (`costo_envio`, `precio_unitario`, `total_linea`) en NUMERIC(14,2).
- Sucursal asociada (`sucursal` texto) → FK opcional a `branches.id`.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class SalesWebRequest(Base):
    __tablename__ = "sales_web_requests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    numero_solicitud: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    numero_remito_prefactura: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # pendiente | tomado | completado | enviado | cancelado (valida la app).
    estado: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    # Vendedor: FK real al usuario que crea/atiende la solicitud.
    vendedor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    vendedor_nombre: Mapped[str] = mapped_column(Text, default="", nullable=False)

    branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sucursal: Mapped[str] = mapped_column(Text, default="", nullable=False)
    canal: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Cliente
    dni: Mapped[str] = mapped_column(Text, nullable=False)
    apellido_nombre: Mapped[str] = mapped_column(Text, nullable=False)
    telefono: Mapped[str] = mapped_column(Text, nullable=False)
    correo_electronico: Mapped[str] = mapped_column(Text, nullable=False)
    domicilio: Mapped[str] = mapped_column(Text, nullable=False)
    codigo_postal: Mapped[str] = mapped_column(Text, nullable=False)
    localidad: Mapped[str] = mapped_column(Text, nullable=False)
    barrio: Mapped[str] = mapped_column(Text, default="", nullable=False)
    entre_calles: Mapped[str] = mapped_column(Text, default="", nullable=False)
    observaciones: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Pago / entrega
    pago_tipo: Mapped[str] = mapped_column(Text, nullable=False)
    entrega_tipo: Mapped[str] = mapped_column(Text, nullable=False)
    costo_envio: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    senia_monto: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    saldo_restante: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    observacion_admin: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Workflow (fechas y actores)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    taken_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    taken_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sent_to_sales_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_to_sales_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancel_reason: Mapped[str] = mapped_column(Text, default="", nullable=False)

    items: Mapped[list["SalesWebItem"]] = relationship(
        back_populates="request", cascade="all, delete-orphan"
    )


class SalesWebItem(Base):
    __tablename__ = "sales_web_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("sales_web_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )

    sku: Mapped[str] = mapped_column(Text, default="", nullable=False)
    producto: Mapped[str] = mapped_column(Text, nullable=False)
    marca: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tipo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    condicion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cantidad: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    precio_unitario: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    total_linea: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)

    request: Mapped["SalesWebRequest"] = relationship(back_populates="items")
