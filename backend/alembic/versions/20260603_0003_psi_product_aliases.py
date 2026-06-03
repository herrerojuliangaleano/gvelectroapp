"""Comercial Fase 1 v3 · psi_product_aliases (matching manual).

Cuando el matcher SKU/Descripción no encuentra un producto, el gerente puede
asociar manualmente un SKU o descripción del GFK con un producto del catálogo.
Esta tabla persiste esa asociación para que la próxima vez sea automática.

Revision ID: 20260603_0003
Revises: 20260603_0002
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0003"
down_revision = "20260603_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "psi_product_aliases",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),

        # Producto del catálogo al que se asocia el alias
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("products.id", ondelete="CASCADE", name="fk_psi_product_aliases_product_id_products"),
            nullable=False,
        ),

        # Alias por SKU o por descripción (al menos uno requerido)
        sa.Column("alias_sku_norm",  sa.Text(), nullable=True),
        sa.Column("alias_desc_norm", sa.Text(), nullable=True),
        # Snapshot del valor original (para auditoría / mostrar en UI)
        sa.Column("alias_sku_raw",   sa.Text(), nullable=False, server_default=""),
        sa.Column("alias_desc_raw",  sa.Text(), nullable=False, server_default=""),

        # Audit
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_psi_product_aliases_created_by_user_id_users"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),

        # Al menos uno de los dos alias debe estar definido
        sa.CheckConstraint(
            "(alias_sku_norm IS NOT NULL AND alias_sku_norm <> '') OR "
            "(alias_desc_norm IS NOT NULL AND alias_desc_norm <> '')",
            name="ck_psi_product_aliases_at_least_one_alias",
        ),
    )

    op.create_index("ix_psi_product_aliases_product_id",      "psi_product_aliases", ["product_id"])
    op.create_index("ix_psi_product_aliases_alias_sku_norm",  "psi_product_aliases", ["alias_sku_norm"])
    op.create_index("ix_psi_product_aliases_alias_desc_norm", "psi_product_aliases", ["alias_desc_norm"])


def downgrade() -> None:
    op.drop_index("ix_psi_product_aliases_alias_desc_norm", table_name="psi_product_aliases")
    op.drop_index("ix_psi_product_aliases_alias_sku_norm",  table_name="psi_product_aliases")
    op.drop_index("ix_psi_product_aliases_product_id",      table_name="psi_product_aliases")
    op.drop_table("psi_product_aliases")
