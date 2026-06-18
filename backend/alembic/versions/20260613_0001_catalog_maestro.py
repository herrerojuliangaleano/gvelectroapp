"""catálogo maestro de productos (módulo Maestro/Alta/Normalización) — Etapa 1

Crea el catálogo NUEVO al lado del `products` legacy. Todo aditivo: las 7
tablas son nuevas y la única tocada de legacy es `products`, que recibe una
columna nullable `catalog_product_id` (link al maestro). Los 16 consumidores
de `products` siguen funcionando igual (la columna es nullable y nadie la lee
todavía).

Tablas nuevas:
  catalog_products, catalog_aliases, catalog_price_history,
  catalog_cost_history, catalog_templates, catalog_abbreviations,
  catalog_change_log

Revision ID: 20260613_0001
Revises: 20260612_0001
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260613_0001"
down_revision = "20260612_0001"
branch_labels = None
depends_on = None


def upgrade():
    # ── catalog_products ────────────────────────────────────────────────
    op.create_table(
        "catalog_products",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("codigo_puma", sa.Text, nullable=False, server_default=""),
        sa.Column("sku_base", sa.Text, nullable=False, server_default=""),
        sa.Column("sku_comercial", sa.Text, nullable=False, server_default=""),
        sa.Column("sku_comercial_normalized", sa.Text, nullable=False, server_default=""),
        sa.Column("descripcion_base", sa.Text, nullable=False, server_default=""),
        sa.Column("descripcion_comercial", sa.Text, nullable=False, server_default=""),
        sa.Column("descripcion_erp", sa.Text, nullable=False, server_default=""),
        sa.Column("descripcion_original", sa.Text, nullable=False, server_default=""),
        sa.Column("marca", sa.Text, nullable=False, server_default=""),
        sa.Column("marca_normalized", sa.Text, nullable=False, server_default=""),
        sa.Column("familia_app", sa.Text, nullable=False, server_default=""),
        sa.Column("rubro_app", sa.Text, nullable=False, server_default=""),
        sa.Column("subrubro_app", sa.Text, nullable=False, server_default=""),
        sa.Column("familia_erp", sa.Text, nullable=False, server_default=""),
        sa.Column("rubro_erp", sa.Text, nullable=False, server_default=""),
        sa.Column("subrubro_erp", sa.Text, nullable=False, server_default=""),
        sa.Column("condicion", sa.Text, nullable=False, server_default="PRIMERA"),
        sa.Column("estado", sa.Text, nullable=False, server_default="BORRADOR"),
        sa.Column("activo", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("producto_base_id", sa.BigInteger, sa.ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_catalog_products_codigo_puma", "catalog_products", ["codigo_puma"])
    op.create_index("ix_catalog_products_sku_norm", "catalog_products", ["sku_comercial_normalized"])
    op.create_index("ix_catalog_products_marca_norm", "catalog_products", ["marca_normalized"])
    op.create_index("ix_catalog_products_familia", "catalog_products", ["familia_app"])
    op.create_index("ix_catalog_products_rubro", "catalog_products", ["rubro_app"])
    op.create_index("ix_catalog_products_condicion", "catalog_products", ["condicion"])
    op.create_index("ix_catalog_products_estado", "catalog_products", ["estado"])
    op.create_index("ix_catalog_products_activo", "catalog_products", ["activo"])

    # ── catalog_aliases ─────────────────────────────────────────────────
    op.create_table(
        "catalog_aliases",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("catalog_product_id", sa.BigInteger, sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku_anterior", sa.Text, nullable=False, server_default=""),
        sa.Column("descripcion_anterior", sa.Text, nullable=False, server_default=""),
        sa.Column("codigo_puma_anterior", sa.Text, nullable=False, server_default=""),
        sa.Column("origen", sa.Text, nullable=False, server_default=""),
        sa.Column("tipo_equivalencia", sa.Text, nullable=False, server_default=""),
        sa.Column("confianza", sa.Integer, nullable=False, server_default="100"),
        sa.Column("revisado", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("observacion", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_catalog_aliases_product", "catalog_aliases", ["catalog_product_id"])
    op.create_index("ix_catalog_aliases_sku_ant", "catalog_aliases", ["sku_anterior"])

    # ── catalog_price_history ───────────────────────────────────────────
    op.create_table(
        "catalog_price_history",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("catalog_product_id", sa.BigInteger, sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pvp", sa.Numeric(14, 2), nullable=False),
        sa.Column("fecha_desde", sa.Date, nullable=False),
        sa.Column("fecha_hasta", sa.Date, nullable=True),
        sa.Column("motivo", sa.Text, nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_price_hist_product", "catalog_price_history", ["catalog_product_id"])

    # ── catalog_cost_history ────────────────────────────────────────────
    op.create_table(
        "catalog_cost_history",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("catalog_product_id", sa.BigInteger, sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("costo", sa.Numeric(14, 2), nullable=False),
        sa.Column("moneda", sa.Text, nullable=False, server_default="ARS"),
        sa.Column("proveedor", sa.Text, nullable=False, server_default=""),
        sa.Column("fecha_desde", sa.Date, nullable=False),
        sa.Column("fecha_hasta", sa.Date, nullable=True),
        sa.Column("motivo", sa.Text, nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_cost_hist_product", "catalog_cost_history", ["catalog_product_id"])

    # ── catalog_templates ───────────────────────────────────────────────
    op.create_table(
        "catalog_templates",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("familia_app", sa.Text, nullable=False, server_default=""),
        sa.Column("rubro_app", sa.Text, nullable=False, server_default=""),
        sa.Column("campos_obligatorios", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("formato_descripcion_base", sa.Text, nullable=False, server_default=""),
        sa.Column("formato_descripcion_comercial", sa.Text, nullable=False, server_default=""),
        sa.Column("formato_descripcion_erp", sa.Text, nullable=False, server_default=""),
        sa.Column("formato_subrubro", sa.Text, nullable=False, server_default=""),
        sa.Column("activo", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("familia_app", "rubro_app", name="ux_catalog_template_fam_rubro"),
    )

    # ── catalog_abbreviations ───────────────────────────────────────────
    op.create_table(
        "catalog_abbreviations",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("texto_original", sa.Text, nullable=False),
        sa.Column("abreviatura_erp", sa.Text, nullable=False),
        sa.Column("activo", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("texto_original", name="ux_catalog_abbr_texto"),
    )

    # ── catalog_change_log ──────────────────────────────────────────────
    op.create_table(
        "catalog_change_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("catalog_product_id", sa.BigInteger, sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("campo", sa.Text, nullable=False),
        sa.Column("valor_anterior", sa.Text, nullable=False, server_default=""),
        sa.Column("valor_nuevo", sa.Text, nullable=False, server_default=""),
        sa.Column("motivo", sa.Text, nullable=False, server_default=""),
        sa.Column("changed_by_user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_changelog_product", "catalog_change_log", ["catalog_product_id"])
    op.create_index("ix_catalog_changelog_at", "catalog_change_log", ["changed_at"])

    # ── link en legacy products (único cambio en legacy) ────────────────
    op.add_column("products", sa.Column("catalog_product_id", sa.BigInteger, nullable=True))
    op.create_foreign_key(
        "fk_products_catalog_product", "products", "catalog_products",
        ["catalog_product_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_products_catalog_product_id", "products", ["catalog_product_id"])


def downgrade():
    op.drop_index("ix_products_catalog_product_id", table_name="products")
    op.drop_constraint("fk_products_catalog_product", "products", type_="foreignkey")
    op.drop_column("products", "catalog_product_id")
    op.drop_table("catalog_change_log")
    op.drop_table("catalog_abbreviations")
    op.drop_table("catalog_templates")
    op.drop_table("catalog_cost_history")
    op.drop_table("catalog_price_history")
    op.drop_table("catalog_aliases")
    op.drop_table("catalog_products")
