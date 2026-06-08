"""Sales BI commercial layer for Ventas Vs. Costos.

Revision ID: 20260608_0001
Revises: 20260605_0001
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260608_0001"
down_revision = "20260605_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_bi_commercial_batches",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("source_kind", sa.Text(), nullable=False, server_default="ventas_vs_costos"),
        sa.Column("fuente_nombre", sa.Text(), nullable=False, server_default=""),
        sa.Column("fuente_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="activo"),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("total_records", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_units", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_pvp", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_costo", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_diferencia", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column(
            "imported_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sbc_batches_imported_user"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "voided_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sbc_batches_voided_user"),
            nullable=True,
        ),
        sa.Column("void_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.create_index("ix_sales_bi_commercial_batches_source_kind", "sales_bi_commercial_batches", ["source_kind"])
    op.create_index("ix_sales_bi_commercial_batches_status", "sales_bi_commercial_batches", ["status"])
    op.create_index("ix_sales_bi_commercial_batches_period_start", "sales_bi_commercial_batches", ["period_start"])
    op.create_index("ix_sales_bi_commercial_batches_period_end", "sales_bi_commercial_batches", ["period_end"])

    op.create_table(
        "sales_bi_commercial_corrections",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("match_sku_norm", sa.Text(), nullable=False, server_default=""),
        sa.Column("match_desc_norm", sa.Text(), nullable=False, server_default=""),
        sa.Column("match_brand_norm", sa.Text(), nullable=False, server_default=""),
        sa.Column("match_type_norm", sa.Text(), nullable=False, server_default=""),
        sa.Column("corrected_sku", sa.Text(), nullable=False, server_default=""),
        sa.Column("corrected_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("corrected_brand", sa.Text(), nullable=False, server_default=""),
        sa.Column("corrected_type", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("products.id", ondelete="SET NULL", name="fk_sbc_corrections_product"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sbc_corrections_created_user"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_sales_bi_commercial_corrections_match_sku_norm", "sales_bi_commercial_corrections", ["match_sku_norm"])
    op.create_index("ix_sales_bi_commercial_corrections_match_desc_norm", "sales_bi_commercial_corrections", ["match_desc_norm"])
    op.create_index("ix_sales_bi_commercial_corrections_match_brand_norm", "sales_bi_commercial_corrections", ["match_brand_norm"])
    op.create_index("ix_sales_bi_commercial_corrections_match_type_norm", "sales_bi_commercial_corrections", ["match_type_norm"])
    op.create_index("ix_sales_bi_commercial_corrections_product_id", "sales_bi_commercial_corrections", ["product_id"])

    op.create_table(
        "sales_bi_commercial_records",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "batch_id",
            sa.BigInteger(),
            sa.ForeignKey("sales_bi_commercial_batches.id", ondelete="CASCADE", name="fk_sbc_records_batch"),
            nullable=False,
        ),
        sa.Column("source_sheet", sa.Text(), nullable=False, server_default=""),
        sa.Column("row_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("sucursal", sa.Text(), nullable=False),
        sa.Column(
            "branch_id",
            sa.Text(),
            sa.ForeignKey("branches.id", ondelete="SET NULL", name="fk_sbc_records_branch"),
            nullable=True,
        ),
        sa.Column("tipo_venta", sa.Text(), nullable=False, server_default=""),
        sa.Column("marca_raw", sa.Text(), nullable=False, server_default=""),
        sa.Column("tipo_raw", sa.Text(), nullable=False, server_default=""),
        sa.Column("descripcion_raw", sa.Text(), nullable=False, server_default=""),
        sa.Column("sku_raw", sa.Text(), nullable=False, server_default=""),
        sa.Column("marca", sa.Text(), nullable=False, server_default=""),
        sa.Column("tipo_producto", sa.Text(), nullable=False, server_default=""),
        sa.Column("descripcion", sa.Text(), nullable=False, server_default=""),
        sa.Column("sku", sa.Text(), nullable=False, server_default=""),
        sa.Column("sku_normalized", sa.Text(), nullable=False, server_default=""),
        sa.Column("descripcion_normalized", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("products.id", ondelete="SET NULL", name="fk_sbc_records_product"),
            nullable=True,
        ),
        sa.Column(
            "correction_id",
            sa.BigInteger(),
            sa.ForeignKey("sales_bi_commercial_corrections.id", ondelete="SET NULL", name="fk_sbc_records_correction"),
            nullable=True,
        ),
        sa.Column("match_status", sa.Text(), nullable=False, server_default="unmatched"),
        sa.Column("cantidad", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("pvp", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("costo", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("diferencia", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("margen_porcentaje", sa.Numeric(14, 2), nullable=False, server_default="0"),
    )
    for column in (
        "batch_id", "source_sheet", "fecha", "sucursal", "branch_id", "tipo_venta",
        "marca", "tipo_producto", "sku", "sku_normalized", "descripcion_normalized",
        "product_id", "correction_id", "match_status",
    ):
        op.create_index(f"ix_sales_bi_commercial_records_{column}", "sales_bi_commercial_records", [column])


def downgrade() -> None:
    for column in (
        "match_status", "correction_id", "product_id", "descripcion_normalized",
        "sku_normalized", "sku", "tipo_producto", "marca", "tipo_venta",
        "branch_id", "sucursal", "fecha", "source_sheet", "batch_id",
    ):
        op.drop_index(f"ix_sales_bi_commercial_records_{column}", table_name="sales_bi_commercial_records")
    op.drop_table("sales_bi_commercial_records")

    op.drop_index("ix_sales_bi_commercial_corrections_product_id", table_name="sales_bi_commercial_corrections")
    op.drop_index("ix_sales_bi_commercial_corrections_match_type_norm", table_name="sales_bi_commercial_corrections")
    op.drop_index("ix_sales_bi_commercial_corrections_match_brand_norm", table_name="sales_bi_commercial_corrections")
    op.drop_index("ix_sales_bi_commercial_corrections_match_desc_norm", table_name="sales_bi_commercial_corrections")
    op.drop_index("ix_sales_bi_commercial_corrections_match_sku_norm", table_name="sales_bi_commercial_corrections")
    op.drop_table("sales_bi_commercial_corrections")

    op.drop_index("ix_sales_bi_commercial_batches_period_end", table_name="sales_bi_commercial_batches")
    op.drop_index("ix_sales_bi_commercial_batches_period_start", table_name="sales_bi_commercial_batches")
    op.drop_index("ix_sales_bi_commercial_batches_status", table_name="sales_bi_commercial_batches")
    op.drop_index("ix_sales_bi_commercial_batches_source_kind", table_name="sales_bi_commercial_batches")
    op.drop_table("sales_bi_commercial_batches")
