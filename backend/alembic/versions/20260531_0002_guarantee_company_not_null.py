"""Fundación A.5.2 · guarantees.company_id NOT NULL.

Toda garantía debe pertenecer a una empresa (regla R1 del doc 05-fundacion).
Backfill defensivo: si quedaron filas con company_id NULL, se rellenan desde
la branch asociada antes de aplicar el NOT NULL.

Revision ID: 20260531_0002
Revises: 20260531_0001
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260531_0002"
down_revision = "20260531_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Backfill: rellenar company_id NULL desde la branch correspondiente.
    op.execute("""
        UPDATE guarantees g
        SET company_id = b.company_id
        FROM branches b
        WHERE g.company_id IS NULL
          AND g.branch_id IS NOT NULL
          AND b.id = g.branch_id
    """)
    # 2) Fallback: si aún quedan NULL, derivar desde sucursal_responsable.
    op.execute("""
        UPDATE guarantees g
        SET company_id = b.company_id
        FROM branches b
        WHERE g.company_id IS NULL
          AND g.sucursal_responsable_id IS NOT NULL
          AND b.id = g.sucursal_responsable_id
    """)
    # 3) Si después de lo anterior aún hay NULL, abortar con error explícito.
    #    Es preferible fallar la migración a dejar pasar datos huérfanos.
    nulls = op.get_bind().execute(
        sa.text("SELECT COUNT(*) FROM guarantees WHERE company_id IS NULL")
    ).scalar() or 0
    if nulls:
        raise RuntimeError(
            f"No se puede aplicar NOT NULL: quedan {nulls} garantías sin company_id "
            "derivable. Asignar manualmente antes de re-ejecutar la migración."
        )
    # 4) Aplicar NOT NULL.
    op.alter_column("guarantees", "company_id", existing_type=sa.Text(), nullable=False)


def downgrade() -> None:
    op.alter_column("guarantees", "company_id", existing_type=sa.Text(), nullable=True)
