"""catalog_products.datos — armado de descripción por producto (orden + extras)

Persiste, por producto, cómo se armó la descripción: el orden de los atributos
elegido por el operador y los detalles libres agregados (ej "(PN)",
"LÍNEA 2022"). Permite reconstruir el armador al editar. Aditivo (JSONB default
{}), no afecta nada existente.

Revision ID: 20260614_0001
Revises: 20260613_0001
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260614_0001"
down_revision = "20260613_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("catalog_products", sa.Column("datos", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")))


def downgrade():
    op.drop_column("catalog_products", "datos")
