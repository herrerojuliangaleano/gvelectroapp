"""Modelos ORM (SQLAlchemy 2.x declarativo) por dominio.

Importar acá los módulos de modelos hace que Base.metadata los conozca
(necesario para que Alembic autogenerate los vea).

Orden de import por dependencia de FKs:
1. org (companies, branches)        — referenciado por todo
2. auth (users, roles, ...)         — referenciado por todo
3. employees                        — depende de org/auth
4. warranties                       — depende de org/auth
5. remitos                          — depende de warranties/branches/auth
6. sales_web                        — depende de branches/auth
7. sales_bi                         — depende de branches/auth
8. products                         — independiente / referenciado por system
9. system                           — depende de auth/branches/sales_web/products
"""
from . import org           # noqa: F401
from . import auth          # noqa: F401
from . import employees     # noqa: F401
from . import warranties    # noqa: F401
from . import remitos       # noqa: F401
from . import sales_web     # noqa: F401
from . import sales_bi      # noqa: F401
from . import products      # noqa: F401
from . import system        # noqa: F401
from . import sales_psi     # noqa: F401  (módulo Comercial · PSI)

__all__ = [
    "org", "auth", "employees", "warranties", "remitos",
    "sales_web", "sales_bi", "products", "system", "sales_psi",
]
