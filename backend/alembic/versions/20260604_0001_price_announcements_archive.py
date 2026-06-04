"""Price announcements archive and price-cost operational archive.

Revision ID: 20260604_0001
Revises: 20260603_0003
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260604_0001"
down_revision = "20260603_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("price_cost_updates", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "price_cost_updates",
        sa.Column(
            "archived_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_price_cost_updates_archived_by_user_id_users"),
            nullable=True,
        ),
    )
    op.add_column("price_cost_updates", sa.Column("archive_reason", sa.Text(), nullable=True))
    op.add_column("price_cost_updates", sa.Column("announcement_archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "price_cost_updates",
        sa.Column(
            "announcement_archived_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_price_cost_updates_announcement_archived_by_user_id_users"),
            nullable=True,
        ),
    )
    op.create_index("ix_price_cost_updates_archived_at", "price_cost_updates", ["archived_at"])
    op.create_index("ix_price_cost_updates_announcement_archived_at", "price_cost_updates", ["announcement_archived_at"])

    op.create_table(
        "price_announcement_batches",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("logo_brand", sa.Text(), nullable=False, server_default="gv_electro"),
        sa.Column("vigencia", sa.Text(), nullable=False, server_default=""),
        sa.Column("brand_names", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("product_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "generated_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_price_announcement_batches_generated_by_user_id_users"),
            nullable=True,
        ),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_price_announcement_batches_generated_at", "price_announcement_batches", ["generated_at"])

    op.create_table(
        "price_announcement_batch_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "batch_id",
            sa.BigInteger(),
            sa.ForeignKey("price_announcement_batches.id", ondelete="CASCADE", name="fk_price_announcement_batch_items_batch_id_batches"),
            nullable=False,
        ),
        sa.Column(
            "update_id",
            sa.BigInteger(),
            sa.ForeignKey("price_cost_updates.id", ondelete="SET NULL", name="fk_price_announcement_batch_items_update_id_updates"),
            nullable=True,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("type", sa.Text(), nullable=False, server_default="price"),
        sa.Column("producto", sa.Text(), nullable=False),
        sa.Column("sku", sa.Text(), nullable=False),
        sa.Column("marca", sa.Text(), nullable=True),
        sa.Column("valor_anterior", sa.Numeric(14, 2), nullable=True),
        sa.Column("valor_nuevo", sa.Numeric(14, 2), nullable=False),
        sa.Column("change_kind", sa.Text(), nullable=False, server_default="NUEVO"),
        sa.Column("auto_created", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_price_announcement_batch_items_batch_id", "price_announcement_batch_items", ["batch_id"])
    op.create_index("ix_price_announcement_batch_items_update_id", "price_announcement_batch_items", ["update_id"])


def downgrade() -> None:
    op.drop_index("ix_price_announcement_batch_items_update_id", table_name="price_announcement_batch_items")
    op.drop_index("ix_price_announcement_batch_items_batch_id", table_name="price_announcement_batch_items")
    op.drop_table("price_announcement_batch_items")

    op.drop_index("ix_price_announcement_batches_generated_at", table_name="price_announcement_batches")
    op.drop_table("price_announcement_batches")

    op.drop_index("ix_price_cost_updates_announcement_archived_at", table_name="price_cost_updates")
    op.drop_index("ix_price_cost_updates_archived_at", table_name="price_cost_updates")
    op.drop_column("price_cost_updates", "announcement_archived_by_user_id")
    op.drop_column("price_cost_updates", "announcement_archived_at")
    op.drop_column("price_cost_updates", "archive_reason")
    op.drop_column("price_cost_updates", "archived_by_user_id")
    op.drop_column("price_cost_updates", "archived_at")
