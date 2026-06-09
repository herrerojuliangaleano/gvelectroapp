"""sales_bi_commercial: categoria (5 buckets) en records

Agrega la columna `categoria` a `sales_bi_commercial_records` para que el
módulo BI Comercial pueda agrupar por las 5 líneas comerciales
(LINEA BLANCA / COCINA / CLIMATIZACION / TV / AUDIO / PEQUENOS / OTROS)
en lugar de usar el `tipo_producto` granular (HELADERA, LAVARROPAS, ...).

Es la misma taxonomía que `sales_records.categoria` (módulo Vendedores).

Backfill: la migración inserta '' como default. Los records existentes
quedan vacíos hasta que se corra `backfill_categoria()` desde el módulo
`sales_bi_commercial`. La función está pensada para correr una sola vez
después de aplicar la migración.

Revision ID: 20260609_0001
Revises: 20260608_0001
Create Date: 2026-06-09
"""
from alembic import op
import sqlalchemy as sa


revision = '20260609_0001'
down_revision = '20260608_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'sales_bi_commercial_records',
        sa.Column('categoria', sa.Text(), nullable=False, server_default=''),
    )
    op.create_index(
        'ix_sales_bi_commercial_records_categoria',
        'sales_bi_commercial_records',
        ['categoria'],
    )
    # Limpio el server_default — el ORM ya pone '' como default Python-side.
    op.alter_column('sales_bi_commercial_records', 'categoria', server_default=None)


def downgrade() -> None:
    op.drop_index('ix_sales_bi_commercial_records_categoria', table_name='sales_bi_commercial_records')
    op.drop_column('sales_bi_commercial_records', 'categoria')
