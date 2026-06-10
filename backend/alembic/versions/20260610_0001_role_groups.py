"""role_groups (departamentos) + fusion de roles legacy

Fase 1 de la reorganizacion de roles y permisos (acordada con Victor
2026-06-10, ver memoria roles-permisos-redesign):

1. Crea la tabla `role_groups` (departamentos): Administracion / Gerencia /
   Posventa / Encargados / Deposito / Ventas.
2. Agrega `roles.group_id` (FK nullable) y asigna cada rol existente a su
   departamento. LECTURA queda sin departamento (NULL) a proposito.
3. Fusiona roles legacy duplicados:
     - ADMIN          -> ADMINISTRADOR
     - VENTA_WEB      -> VENDEDOR
     - VENDEDOR_WEB   -> VENDEDOR
   Reasigna user_roles (preservando is_primary; si el usuario ya tiene el
   rol destino se borra la fila legacy y se hereda el flag primary) y
   despues BORRA los roles legacy. Decision acordada: el VENDEDOR
   unificado mantiene su set restrictivo (NO hereda sales_web.send/
   complete/cancel del viejo VENDEDOR_WEB; si un vendedor los necesita se
   le daran como override por usuario en Fase 2).

Al momento de escribir esto, en prod ningun usuario activo tiene roles
ADMIN / VENTA_WEB / VENDEDOR_WEB, asi que la fusion es de impacto cero;
la logica de reasignacion existe igual por robustez (dev, restores).

Revision ID: 20260610_0001
Revises: 20260609_0001
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = "20260610_0001"
down_revision = "20260609_0001"
branch_labels = None
depends_on = None


# Departamentos seed: (name, label, sort_order)
GROUPS = [
    ("ADMINISTRACION", "Administración", 10),
    ("GERENCIA", "Gerencia", 20),
    ("POSVENTA", "Posventa", 30),
    ("ENCARGADOS", "Encargados", 40),
    ("DEPOSITO", "Depósito", 50),
    ("VENTAS", "Ventas", 60),
]

# Rol -> departamento. Los que no figuran quedan group_id NULL (ej. LECTURA).
ROLE_GROUP_MAP = {
    "SUPERADMIN": "ADMINISTRACION",
    "ADMINISTRADOR": "ADMINISTRACION",
    "GERENTE": "GERENCIA",
    "GERENTE_COMERCIAL": "GERENCIA",
    "JEFE_POSVENTA": "POSVENTA",
    "GESTOR_GARANTIAS": "POSVENTA",
    "ENCARGADO_SUCURSAL": "ENCARGADOS",
    "ENCARGADO_WEB": "ENCARGADOS",
    "DEPOSITO": "DEPOSITO",
    "CADETE_DEPOSITO": "DEPOSITO",
    "VENDEDOR": "VENTAS",
}

# legacy -> destino
LEGACY_MERGES = {
    "ADMIN": "ADMINISTRADOR",
    "VENTA_WEB": "VENDEDOR",
    "VENDEDOR_WEB": "VENDEDOR",
}


def upgrade():
    op.create_table(
        "role_groups",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text, nullable=False, unique=True),
        sa.Column("label", sa.Text, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("roles", sa.Column("group_id", sa.BigInteger, nullable=True))
    op.create_foreign_key(
        "fk_roles_group_id", "roles", "role_groups", ["group_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_roles_group_id", "roles", ["group_id"])

    conn = op.get_bind()

    # ── Seed de departamentos ────────────────────────────────────────────
    for name, label, sort_order in GROUPS:
        conn.execute(
            sa.text("INSERT INTO role_groups (name, label, sort_order) VALUES (:n, :l, :s)"),
            {"n": name, "l": label, "s": sort_order},
        )

    # ── Asignar roles existentes a su departamento ───────────────────────
    for role_name, group_name in ROLE_GROUP_MAP.items():
        conn.execute(
            sa.text(
                "UPDATE roles SET group_id = (SELECT id FROM role_groups WHERE name = :g) "
                "WHERE name = :r"
            ),
            {"g": group_name, "r": role_name},
        )

    # ── Fusion de roles legacy ───────────────────────────────────────────
    for legacy, target in LEGACY_MERGES.items():
        legacy_id = conn.execute(
            sa.text("SELECT id FROM roles WHERE name = :n"), {"n": legacy}
        ).scalar()
        target_id = conn.execute(
            sa.text("SELECT id FROM roles WHERE name = :n"), {"n": target}
        ).scalar()
        if legacy_id is None:
            continue
        if target_id is not None:
            # Si el usuario tenia el legacy como primary y tambien tiene el
            # destino, el destino hereda el flag primary.
            conn.execute(
                sa.text(
                    "UPDATE user_roles tgt SET is_primary = TRUE "
                    "FROM user_roles leg "
                    "WHERE tgt.role_id = :tid AND leg.role_id = :lid "
                    "AND tgt.user_id = leg.user_id AND leg.is_primary"
                ),
                {"tid": target_id, "lid": legacy_id},
            )
            # Borrar filas legacy de usuarios que YA tienen el destino
            # (evita violar el UNIQUE (user_id, role_id) al reasignar).
            conn.execute(
                sa.text(
                    "DELETE FROM user_roles leg USING user_roles tgt "
                    "WHERE leg.role_id = :lid AND tgt.role_id = :tid "
                    "AND leg.user_id = tgt.user_id"
                ),
                {"lid": legacy_id, "tid": target_id},
            )
            # Reasignar el resto al rol destino.
            conn.execute(
                sa.text("UPDATE user_roles SET role_id = :tid WHERE role_id = :lid"),
                {"tid": target_id, "lid": legacy_id},
            )
        else:
            # Sin destino (catalogo raro): no podemos borrar el rol si tiene
            # usuarios (FK RESTRICT) — lo dejamos y solo seguira sin grupo.
            in_use = conn.execute(
                sa.text("SELECT COUNT(*) FROM user_roles WHERE role_id = :lid"),
                {"lid": legacy_id},
            ).scalar()
            if in_use:
                continue
        conn.execute(sa.text("DELETE FROM roles WHERE id = :lid"), {"lid": legacy_id})


def downgrade():
    # La fusion de roles legacy NO es reversible (no recreamos ADMIN ni
    # VENTA_WEB/VENDEDOR_WEB — eran duplicados). Solo se revierte el schema.
    op.drop_index("ix_roles_group_id", table_name="roles")
    op.drop_constraint("fk_roles_group_id", "roles", type_="foreignkey")
    op.drop_column("roles", "group_id")
    op.drop_table("role_groups")
