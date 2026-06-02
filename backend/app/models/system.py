"""Sistema y notificaciones: notifications, push_subscriptions, fcm_tokens, jobs,
app_events (auditoría), price_cost_updates + checks + history.

Cambios vs. SQLite:
- `username` (texto) → `user_id` (FK a users.id).
- `read` 0/1 → BOOLEAN.
- `*_json` → JSONB.
- Importes en NUMERIC(14,2).
- Job mantiene PK TEXT (los IDs son slugs/UUIDs del registry de tools).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


# ── Notificaciones ───────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    module: Mapped[str] = mapped_column(Text, default="general", nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(Text, default="general", nullable=False)
    priority: Mapped[str] = mapped_column(Text, default="normal", nullable=False, index=True)

    # Entidad referenciada por la notificación (genérico — no FK porque varía).
    entity_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    entity_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sales_request_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sales_web_requests.id", ondelete="SET NULL"), nullable=True
    )

    link_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )
    branch_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_role: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)

    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_push_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    push_status: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class PushSubscription(Base):
    """Subscripción web-push del navegador del usuario."""
    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("user_id", "endpoint"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    auth: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class FcmToken(Base):
    """Token Firebase Cloud Messaging para push móvil."""
    __tablename__ = "fcm_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


# ── Jobs y auditoría ─────────────────────────────────────────────────────────

class Job(Base):
    """Ejecución de una herramienta (script legacy o tool del registry).

    `id` se mantiene TEXT porque el registry asigna slugs/UUIDs propios.
    """
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tool_id: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    log_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pid: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class AppEvent(Base):
    """Auditoría: eventos relevantes del sistema (login, cambios, etc.)."""
    __tablename__ = "app_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


# ── Cambios de precios y costos ──────────────────────────────────────────────

class PriceCostUpdate(Base):
    __tablename__ = "price_cost_updates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # precio | costo (valida la app).
    type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    producto: Mapped[str] = mapped_column(Text, nullable=False)
    sku: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    marca: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    valor_anterior: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    valor_nuevo: Mapped[Numeric] = mapped_column(Numeric(14, 2), nullable=False)

    estado: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    lookup_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancel_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Origen automático (cuando viene de sync de catálogo).
    source: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_product_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    source_sync_log_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("product_sync_logs.id", ondelete="SET NULL"), nullable=True
    )
    auto_created: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    checks: Mapped[list["PriceCostUpdateCheck"]] = relationship(
        back_populates="update", cascade="all, delete-orphan"
    )
    history: Mapped[list["PriceCostUpdateHistory"]] = relationship(
        back_populates="update", cascade="all, delete-orphan", order_by="PriceCostUpdateHistory.id.desc()"
    )


class PriceCostUpdateCheck(Base):
    """Checklist de validación sobre el cambio (uno por ítem chequeado)."""
    __tablename__ = "price_cost_update_checks"
    __table_args__ = (UniqueConstraint("update_id", "check_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    update_id: Mapped[int] = mapped_column(
        ForeignKey("price_cost_updates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_key: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    checked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    checked_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    update: Mapped["PriceCostUpdate"] = relationship(back_populates="checks")


class PriceCostUpdateHistory(Base):
    """Eventos sobre el cambio (aprobación, anulación, etc.)."""
    __tablename__ = "price_cost_update_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    update_id: Mapped[int] = mapped_column(
        ForeignKey("price_cost_updates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    update: Mapped["PriceCostUpdate"] = relationship(back_populates="history")
