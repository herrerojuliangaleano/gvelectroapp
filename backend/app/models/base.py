"""Base declarativa para todos los modelos ORM.

Convención de naming para constraints (mejora los nombres en Alembic):
- ix_<columna>            índices
- uq_<tabla>_<columna>    UNIQUE
- ck_<tabla>_<nombre>     CHECK
- fk_<tabla>_<col>_<ref>  FK
- pk_<tabla>              PK
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

_naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=_naming_convention)


def utcnow() -> datetime:
    """Default para `created_at`/`updated_at` (UTC aware)."""
    return datetime.now(timezone.utc)
