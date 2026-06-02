"""Alembic environment.

Lee la URL desde el `Settings` del proyecto (que toma DATABASE_URL del entorno)
e importa todos los modelos para que `autogenerate` los conozca.
"""
from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Hacer importables los paquetes del proyecto (app.*) cuando se corre alembic.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.config import get_settings  # noqa: E402
from app.models.base import Base  # noqa: E402
# El __init__.py del paquete models importa todos los dominios y los registra
# en Base.metadata, así que Alembic autogenerate los ve a todos.
from app import models  # noqa: E402, F401

config = context.config

# Logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# URL desde settings (DATABASE_URL del entorno).
config.set_main_option("sqlalchemy.url", get_settings().database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Genera SQL sin conectarse (útil para imprimir el script)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Aplica migraciones conectándose a la DB."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
