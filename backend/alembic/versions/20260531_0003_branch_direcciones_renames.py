"""Fundación A.5.5 · Branch.direccion + direccion_fiscal + renames.

Cambios:
- Agrega columnas ``direccion`` y ``direccion_fiscal`` (TEXT NOT NULL DEFAULT '').
- Renombra ``name`` y ``code`` de las sucursales Norte → Norcenter y Sur → Lanús.
- Los slugs (PK) **no cambian** porque las FKs históricas los referencian.

Revision ID: 20260531_0003
Revises: 20260531_0002
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260531_0003"
down_revision = "20260531_0002"
branch_labels = None
depends_on = None


# (slug, new_name, new_code)
RENAMES = [
    ("norte",      "Norcenter",       "NORCENTER"),
    ("norte_web",  "Norcenter - WEB", "NORCENTER_WEB"),
    ("sur",        "Lanús",           "LANUS"),
    ("sur_web",    "Lanús - WEB",     "LANUS_WEB"),
]


def upgrade() -> None:
    # 1) Nuevas columnas. IF NOT EXISTS porque el baseline (0001) usa
    #    Base.metadata.create_all desde el modelo actual, que ya las tiene
    #    declaradas. Sin IF NOT EXISTS, esta migración solo aplicaría en
    #    bases preexistentes anteriores al baseline.
    op.execute("ALTER TABLE branches ADD COLUMN IF NOT EXISTS direccion TEXT NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE branches ADD COLUMN IF NOT EXISTS direccion_fiscal TEXT NOT NULL DEFAULT ''")

    # 2) Renombres por slug. UPDATE idempotente: si la branch no existe,
    #    no pasa nada; si ya está renombrada, queda igual.
    for slug, new_name, new_code in RENAMES:
        op.execute(sa.text(
            "UPDATE branches SET name = :name, code = :code WHERE id = :slug"
        ).bindparams(slug=slug, name=new_name, code=new_code))


def downgrade() -> None:
    # Revertir renames a sus valores originales.
    rollback = [
        ("norte",     "Norte",       "NORTE"),
        ("norte_web", "Norte - WEB", "NORTE_WEB"),
        ("sur",       "Sur",         "SUR"),
        ("sur_web",   "Sur - WEB",   "SUR_WEB"),
    ]
    for slug, name, code in rollback:
        op.execute(sa.text(
            "UPDATE branches SET name = :name, code = :code WHERE id = :slug"
        ).bindparams(slug=slug, name=name, code=code))
    op.drop_column("branches", "direccion_fiscal")
    op.drop_column("branches", "direccion")
