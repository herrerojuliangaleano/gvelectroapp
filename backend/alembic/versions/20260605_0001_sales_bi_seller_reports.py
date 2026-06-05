"""Sales BI seller reports and product aliases.

Revision ID: 20260605_0001
Revises: 20260604_0001
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260605_0001"
down_revision = "20260604_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_bi_product_aliases",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("products.id", ondelete="CASCADE", name="fk_sales_bi_product_aliases_product_id_products"),
            nullable=False,
        ),
        sa.Column("alias_sku_norm", sa.Text(), nullable=True),
        sa.Column("alias_desc_norm", sa.Text(), nullable=True),
        sa.Column("alias_sku_raw", sa.Text(), nullable=False, server_default=""),
        sa.Column("alias_desc_raw", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sales_bi_product_aliases_created_by_user_id_users"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "(alias_sku_norm IS NOT NULL AND alias_sku_norm <> '') OR "
            "(alias_desc_norm IS NOT NULL AND alias_desc_norm <> '')",
            name="ck_sales_bi_product_aliases_at_least_one_alias",
        ),
    )
    op.create_index("ix_sales_bi_product_aliases_product_id", "sales_bi_product_aliases", ["product_id"])
    op.create_index("ix_sales_bi_product_aliases_alias_sku_norm", "sales_bi_product_aliases", ["alias_sku_norm"])
    op.create_index("ix_sales_bi_product_aliases_alias_desc_norm", "sales_bi_product_aliases", ["alias_desc_norm"])

    op.add_column("sales_records", sa.Column("vendedor_normalized", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "sales_records",
        sa.Column(
            "seller_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_sales_records_seller_user_id_users"),
            nullable=True,
        ),
    )
    op.add_column("sales_records", sa.Column("sku_normalized", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "sales_records",
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("products.id", ondelete="SET NULL", name="fk_sales_records_product_id_products"),
            nullable=True,
        ),
    )
    op.add_column(
        "sales_records",
        sa.Column(
            "product_alias_id",
            sa.BigInteger(),
            sa.ForeignKey("sales_bi_product_aliases.id", ondelete="SET NULL", name="fk_sales_records_product_alias_id_sales_bi_product_aliases"),
            nullable=True,
        ),
    )
    op.add_column("sales_records", sa.Column("product_match_status", sa.Text(), nullable=False, server_default="unmatched"))

    op.create_index("ix_sales_records_vendedor_normalized", "sales_records", ["vendedor_normalized"])
    op.create_index("ix_sales_records_seller_user_id", "sales_records", ["seller_user_id"])
    op.create_index("ix_sales_records_sku_normalized", "sales_records", ["sku_normalized"])
    op.create_index("ix_sales_records_product_id", "sales_records", ["product_id"])
    op.create_index("ix_sales_records_product_alias_id", "sales_records", ["product_alias_id"])
    op.create_index("ix_sales_records_product_match_status", "sales_records", ["product_match_status"])


def downgrade() -> None:
    op.drop_index("ix_sales_records_product_match_status", table_name="sales_records")
    op.drop_index("ix_sales_records_product_alias_id", table_name="sales_records")
    op.drop_index("ix_sales_records_product_id", table_name="sales_records")
    op.drop_index("ix_sales_records_sku_normalized", table_name="sales_records")
    op.drop_index("ix_sales_records_seller_user_id", table_name="sales_records")
    op.drop_index("ix_sales_records_vendedor_normalized", table_name="sales_records")
    op.drop_column("sales_records", "product_match_status")
    op.drop_column("sales_records", "product_alias_id")
    op.drop_column("sales_records", "product_id")
    op.drop_column("sales_records", "sku_normalized")
    op.drop_column("sales_records", "seller_user_id")
    op.drop_column("sales_records", "vendedor_normalized")

    op.drop_index("ix_sales_bi_product_aliases_alias_desc_norm", table_name="sales_bi_product_aliases")
    op.drop_index("ix_sales_bi_product_aliases_alias_sku_norm", table_name="sales_bi_product_aliases")
    op.drop_index("ix_sales_bi_product_aliases_product_id", table_name="sales_bi_product_aliases")
    op.drop_table("sales_bi_product_aliases")
