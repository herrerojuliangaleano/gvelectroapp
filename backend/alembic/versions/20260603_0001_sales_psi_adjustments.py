"""Comercial Fase 1 · sales_psi_adjustments.

Tabla para ajustes manuales del PSI. Ver docs/10-modulo-comercial-fase1.md §9.

Cada ajuste se crea desde la pantalla PSI y se escribe inmediatamente al libro
mensual de ventas en Drive (status='applied_to_sheet'). El cruce con el GFK
queda automático porque `gg.py` lee del mismo libro mensual.

Revision ID: 20260603_0001
Revises: 20260531_0003
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0001"
down_revision = "20260531_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_psi_adjustments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),

        # Producto
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("products.id", ondelete="RESTRICT", name="fk_sales_psi_adjustments_product_id_products"),
            nullable=False,
        ),
        sa.Column("sku_snapshot",         sa.Text(), nullable=False),
        sa.Column("marca_snapshot",       sa.Text(), nullable=False),
        sa.Column("tipo_snapshot",        sa.Text(), nullable=False),
        sa.Column("condicion_snapshot",   sa.Text(), nullable=False),
        sa.Column("descripcion_snapshot", sa.Text(), nullable=False, server_default=""),

        # Temporal / geográfico
        sa.Column("periodo_semana", sa.Date(), nullable=False),
        sa.Column("inserted_date",  sa.Date(), nullable=False),
        sa.Column("sucursal",       sa.Text(), nullable=False),

        # Ajuste
        sa.Column("cantidad_delta", sa.Integer(),       nullable=False),
        sa.Column("valor_estimado", sa.Numeric(14, 2),  nullable=True),
        sa.Column("reason",         sa.Text(),          nullable=False, server_default=""),

        # Fecha mode
        sa.Column("fecha_mode", sa.Text(), nullable=False),

        # Lifecycle
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),

        sa.Column("applied_at",             sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_to_book",        sa.Text(),                  nullable=True),
        sa.Column("applied_to_sheet_range", sa.Text(),                  nullable=True),
        sa.Column(
            "applied_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sales_psi_adjustments_applied_by_user_id_users"),
            nullable=True,
        ),

        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reverted_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sales_psi_adjustments_reverted_by_user_id_users"),
            nullable=True,
        ),

        # Audit
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sales_psi_adjustments_created_by_user_id_users"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_index("ix_sales_psi_adjustments_product_id",     "sales_psi_adjustments", ["product_id"])
    op.create_index("ix_sales_psi_adjustments_periodo_semana", "sales_psi_adjustments", ["periodo_semana"])
    op.create_index("ix_sales_psi_adjustments_status",         "sales_psi_adjustments", ["status"])
    op.create_index("ix_sales_psi_adjustments_sucursal",       "sales_psi_adjustments", ["sucursal"])
    op.create_index("ix_sales_psi_adjustments_created_at",     "sales_psi_adjustments", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_sales_psi_adjustments_created_at",     table_name="sales_psi_adjustments")
    op.drop_index("ix_sales_psi_adjustments_sucursal",       table_name="sales_psi_adjustments")
    op.drop_index("ix_sales_psi_adjustments_status",         table_name="sales_psi_adjustments")
    op.drop_index("ix_sales_psi_adjustments_periodo_semana", table_name="sales_psi_adjustments")
    op.drop_index("ix_sales_psi_adjustments_product_id",     table_name="sales_psi_adjustments")
    op.drop_table("sales_psi_adjustments")
