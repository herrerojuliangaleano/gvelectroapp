"""Comercial Fase 1 v2 · agregar target a sales_psi_adjustments.

Permite ajustes que apunten a:
- 'sell_out': solo ventas (escribe al GFK). Default.
- 'stock':    solo stock (solo Postgres, el PSI muestra stock efectivo).
- 'both':     ambos (suma a sell_out, resta de stock — caso típico "vendí 1 más").

Revision ID: 20260603_0002
Revises: 20260603_0001
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0002"
down_revision = "20260603_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_psi_adjustments",
        sa.Column("target", sa.Text(), nullable=False, server_default="sell_out"),
    )
    op.create_index(
        "ix_sales_psi_adjustments_target",
        "sales_psi_adjustments",
        ["target"],
    )


def downgrade() -> None:
    op.drop_index("ix_sales_psi_adjustments_target", table_name="sales_psi_adjustments")
    op.drop_column("sales_psi_adjustments", "target")
