"""Garantías: el dominio más complejo. Cabecera + ítems + historial + contador
+ exportaciones + logs de sync.

Cambios vs. SQLite:
- `parent_id` (auto-ref FK, agrupadas) en vez de `parent_warranty_code` string.
- Branch/company/sucursal_responsable como FK reales (`branches.id`, slugs).
- Responsable + actores como FK a `users.id` (SET NULL).
- Importes (NC) como NUMERIC(14,2).
- `details` de historial en JSONB.
- `cancelled` como BOOLEAN.
- Estados como VARCHAR + validación en app (no ENUM rígido).

NO se modifican nombres de campos visibles para la API (status, review_status,
warranty_code, etc.) — eso mantiene el contrato del frontend estable.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, PrimaryKeyConstraint, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow


class Guarantee(Base):
    __tablename__ = "guarantees"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    warranty_code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    # Garantías agrupadas (madre/hijo) — auto-ref.
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("guarantees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    parent_item_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Organización
    # Fase A.5.2 · fundación: NOT NULL. Toda garantía pertenece a una empresa
    # (regla R1 del doc 05). pg_insert_guarantee lo deriva de la branch si el
    # usuario no lo trae explícito.
    company_id: Mapped[str] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    sucursal_responsable_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Textos legacy para display (se mantienen para no romper la API).
    sucursal: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sucursal_code: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    sucursal_responsable: Mapped[str] = mapped_column(Text, default="", nullable=False)
    deposito: Mapped[str] = mapped_column(Text, default="", nullable=False)
    lugar_llegada: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Estado / flujo (validados en app, no ENUM)
    status: Mapped[str] = mapped_column(Text, default="1 - INGRESO", nullable=False, index=True)
    review_status: Mapped[str] = mapped_column(Text, default="pendiente_revision", nullable=False, index=True)
    tipo_ingreso: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    origen_ingreso: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    ubicacion_actual: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    transit_status: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Revisión interna
    reviewed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    review_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_started_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    correction_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    correction_requested_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    correction_resubmitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    correction_resubmitted_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Responsable / actores
    responsible_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Fechas operativas
    ingreso_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False, index=True)

    # Cliente (datos opcionales)
    cliente_nombre: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cliente_telefono: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cliente_email: Mapped[str] = mapped_column(Text, default="", nullable=False)
    numero_factura: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_compra: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Proveedor / gestión
    provider_name: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    provider_case_id: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sent_to_provider_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_provider_response_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_claim_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_ultimo_mail_proveedor: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Tipo de respuesta del proveedor (Fase B): retiro | revision | correccion | "".
    provider_response_type: Mapped[str] = mapped_column(Text, default="", nullable=False)
    provider_correction_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    provider_correction_resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Logística de retiro
    estado_retiro_proveedor: Mapped[str] = mapped_column(Text, default="sin_solicitud", nullable=False)
    fecha_solicitud_retiro_proveedor: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_retiro_proveedor: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_retiro: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    nota_retiro_proveedor: Mapped[str] = mapped_column(Text, default="", nullable=False)
    remito_proveedor: Mapped[str] = mapped_column(Text, default="", nullable=False)
    remito_interno: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_salida_transito: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_llegada_transito: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    lugar_salida_transito: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Carga histórica: garantía migrada desde los Excel pre-sistema. Sus
    # fechas (ingreso, envío a proveedor, resolución) pueden editarse a mano
    # con el permiso `warranties.edit_dates` para que el cruce de datos /
    # SLA por proveedor no quede contaminado con timestamps de carga.
    carga_historica: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    # Resolución
    fecha_resolucion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resultado_resolucion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    resolution_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    resolution_reference: Mapped[str] = mapped_column(Text, default="", nullable=False)
    numero_nota_credito: Mapped[str] = mapped_column(Text, default="", nullable=False)
    importe_nota_credito: Mapped[Optional[Numeric]] = mapped_column(Numeric(14, 2), nullable=True)
    fecha_nota_credito: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    detalle_reparacion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_reparacion: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    producto_reemplazo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku_reemplazo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    serie_reemplazo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_recepcion_reemplazo: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    fecha_finalizacion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finalizacion: Mapped[str] = mapped_column(Text, default="", nullable=False)
    vuelve_a: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Lote ENV (export al proveedor)
    shipment_code: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    shipment_file_name: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Observaciones / fotos
    observations: Mapped[str] = mapped_column(Text, default="", nullable=False)
    photos_reference: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Cancelación
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    cancel_reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cancelled_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Google Sheets mirror
    synced_to_google_sheet: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_google_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    google_sheet_row_id: Mapped[str] = mapped_column(Text, default="", nullable=False)
    google_sheet_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_error: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Relaciones
    items: Mapped[list["GuaranteeItem"]] = relationship(
        back_populates="guarantee", cascade="all, delete-orphan", order_by="GuaranteeItem.item_index"
    )
    history: Mapped[list["GuaranteeHistory"]] = relationship(
        back_populates="guarantee", cascade="all, delete-orphan", order_by="GuaranteeHistory.id.desc()"
    )
    children: Mapped[list["Guarantee"]] = relationship(
        back_populates="parent", remote_side="Guarantee.parent_id"
    )
    parent: Mapped[Optional["Guarantee"]] = relationship(
        back_populates="children", remote_side="Guarantee.id"
    )


class GuaranteeItem(Base):
    """Ítem (producto + serie + falla) dentro de una garantía."""
    __tablename__ = "guarantee_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    guarantee_id: Mapped[int] = mapped_column(
        ForeignKey("guarantees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    producto: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sku: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    marca: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(Text, default="", nullable=False)
    serie: Mapped[str] = mapped_column(Text, default="", nullable=False)
    falla: Mapped[str] = mapped_column(Text, default="", nullable=False)
    observaciones: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Marca por proveedor de "este ítem necesita corrección" (Fase B).
    correction_note: Mapped[str] = mapped_column(Text, default="", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    guarantee: Mapped["Guarantee"] = relationship(back_populates="items")


class GuaranteeHistory(Base):
    """Eventos de auditoría / cambios de estado de una garantía."""
    __tablename__ = "guarantee_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    guarantee_id: Mapped[int] = mapped_column(
        ForeignKey("guarantees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    warranty_code: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)

    action: Mapped[str] = mapped_column(Text, nullable=False)
    old_status: Mapped[str] = mapped_column(Text, default="", nullable=False)
    new_status: Mapped[str] = mapped_column(Text, default="", nullable=False)
    field_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    old_value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    new_value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    actor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    guarantee: Mapped["Guarantee"] = relationship(back_populates="history")


class GuaranteeCounter(Base):
    """Contador de numeración de garantías por año + sucursal_code.

    PK compuesta (year, sucursal_code). En Postgres, el avance se hace dentro de
    transacción con SELECT ... FOR UPDATE (reemplaza al RLock actual).
    """
    __tablename__ = "guarantee_counters"
    __table_args__ = (PrimaryKeyConstraint("year", "sucursal_code"),)

    year: Mapped[int] = mapped_column(Integer, nullable=False)
    sucursal_code: Mapped[str] = mapped_column(Text, nullable=False)
    last_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class GuaranteeExport(Base):
    """Lote de exportación (ENV) al proveedor."""
    __tablename__ = "guarantee_exports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    provider_name: Mapped[str] = mapped_column(Text, default="", nullable=False, index=True)
    marca: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Lista denormalizada de warranty_codes incluidos en el lote.
    # Se mantiene como JSONB para no normalizar de más en esta etapa.
    warranty_ids: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    filters: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    file_format: Mapped[str] = mapped_column(Text, default="excel", nullable=False)
    logo_brand: Mapped[str] = mapped_column(Text, default="gv_electro", nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    shipment_code: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Confirmación de retiro del proveedor
    punto_retiro: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tipo_retiro: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fecha_retiro_acordada: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    respuesta_proveedor_pickup: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pickup_alert_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class GuaranteeSyncLog(Base):
    """Log de sync con Google Sheets."""
    __tablename__ = "guarantee_sync_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sync_type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
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
    errors: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
