"""guarantees.carga_historica — garantias migradas desde Excel pre-sistema

Las sucursales empezaron a cargar garantias viejas que tenian en Excel.
Sus timestamps automaticos (ingreso_at = momento de carga) contaminan el
cruce de datos (SLA por proveedor, tasa de falla por marca). Este flag
las marca como historicas y habilita, junto con el permiso
`warranties.edit_dates`, editar las fechas reales sin romper el flujo
normal del sistema.

Revision ID: 20260612_0001
Revises: 20260610_0001
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0001"
down_revision = "20260610_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "guarantees",
        sa.Column("carga_historica", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_guarantees_carga_historica", "guarantees", ["carga_historica"])


def downgrade():
    op.drop_index("ix_guarantees_carga_historica", table_name="guarantees")
    op.drop_column("guarantees", "carga_historica")
