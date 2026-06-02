"""Capa de acceso a datos (PostgreSQL · Fase 2).

Una sola fuente de verdad para crear conexiones a la base. Reemplaza a los
helpers de conexión anteriores que quedaban repartidos por el código.

Convención FastAPI:
    @router.get(...)
    def handler(session: Annotated[Session, Depends(get_session)]):
        result = session.execute(select(User)).scalars().all()
        ...

Helper para scripts (seed, jobs):
    with db_session() as session:
        ...
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_settings = get_settings()

# Engine único compartido por la app. pool_pre_ping descarta conexiones muertas
# (útil con Postgres que cierra conexiones inactivas tras un tiempo).
engine: Engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)


def get_session() -> Iterator[Session]:
    """Dependencia de FastAPI: una sesión por request, cerrada al final.

    Usage:
        @router.get("/algo")
        def handler(session: Annotated[Session, Depends(get_session)]): ...
    """
    with SessionLocal() as session:
        yield session


@contextmanager
def db_session() -> Iterator[Session]:
    """Context manager para scripts (seed, jobs, migraciones).

    Usage:
        with db_session() as session:
            session.add(obj); session.commit()
    """
    with SessionLocal() as session:
        yield session
