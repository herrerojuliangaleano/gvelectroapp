"""baseline_postgres

Revision ID: 20260531_0001
Revises:
Create Date: 2026-05-31

Base limpia: no migra datos desde SQLite/JSON. El esquema sale de los modelos
SQLAlchemy vigentes y el contenido inicial lo carga app.seed.
"""
from __future__ import annotations

from alembic import op

from app import models  # noqa: F401  # registra todos los modelos en Base.metadata
from app.models.base import Base


revision = "20260531_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
