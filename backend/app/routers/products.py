from __future__ import annotations

import json
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..auth import require_permission
from ..product_catalog import (
    clean_text,
    db_connect,
    ensure_product_catalog_tables,
    get_provider_for_brand,
    normalize_text,
    row_to_product,
    runtime_product_catalog_config,
    search_products,
    sync_products_from_sheet,
    utc_now_iso,
)

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductInfo(BaseModel):
    id: int
    sku: str
    marca: str = ""
    tipo: str = ""
    descripcion: str = ""
    producto: str = ""
    pvp: float | None = None
    pvp_text: str = ""
    pvp_texto: str = ""
    precio: float | None = None
    precio_texto: str = ""
    costo_vigente: float | None = None
    costo_text: str = ""
    costo_texto: str = ""
    condicion: str = ""
    condicion_producto: str = ""
    source_row: int | None = None
    last_synced_at: str = ""
    updated_at: str = ""
    is_active: bool = True
    label: str = ""


class ProductListResponse(BaseModel):
    items: list[ProductInfo]
    total: int
    limit: int
    offset: int


class ProductBrandInfo(BaseModel):
    id: int
    name: str
    normalized_name: str
    is_active: bool
    provider_id: int | None = None
    provider_name: str | None = None
    updated_at: str = ""


class ProviderInfo(BaseModel):
    id: int
    name: str
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    notes: str = ""
    is_active: bool = True
    created_at: str = ""
    updated_at: str = ""


class ProviderPayload(BaseModel):
    name: str = Field(min_length=1)
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    is_active: bool = True


class BrandProviderInfo(BaseModel):
    id: int
    brand_id: int
    brand_name: str
    provider_id: int
    provider_name: str
    is_default: bool
    created_at: str
    updated_at: str


class BrandProviderPayload(BaseModel):
    brand_id: int
    provider_id: int
    is_default: bool = True


class ProductSyncResult(BaseModel):
    ok: bool
    status: str
    started_at: str
    finished_at: str
    rows_processed: int = 0
    rows_created: int = 0
    rows_updated: int = 0
    rows_skipped: int = 0
    brands_created: int = 0
    errors: list[str] = []
    spreadsheet_id: str = ""
    sheet_name: str = ""
    price_changes_detected: int = 0
    cost_changes_detected: int = 0
    price_cost_updates_created: int = 0
    price_cost_updates_skipped: int = 0


class ProductSyncLogInfo(BaseModel):
    id: int
    source: str
    status: str
    started_at: str
    finished_at: str
    actor_username: str = ""
    actor_name: str = ""
    rows_processed: int = 0
    rows_created: int = 0
    rows_updated: int = 0
    rows_skipped: int = 0
    brands_created: int = 0
    errors: list[str] = []
    spreadsheet_id: str = ""
    sheet_name: str = ""
    price_changes_detected: int = 0
    cost_changes_detected: int = 0
    price_cost_updates_created: int = 0
    price_cost_updates_skipped: int = 0


class ProductCatalogStatus(BaseModel):
    total_products: int = 0
    active_products: int = 0
    total_brands: int = 0
    total_providers: int = 0
    mapped_brands: int = 0
    last_sync: ProductSyncLogInfo | None = None
    config: dict[str, Any] = {}


def provider_row(row: sqlite3.Row) -> ProviderInfo:
    return ProviderInfo(
        id=int(row["id"]),
        name=str(row["name"] or ""),
        contact_name=str(row["contact_name"] or ""),
        email=str(row["email"] or ""),
        phone=str(row["phone"] or ""),
        notes=str(row["notes"] or ""),
        is_active=bool(row["is_active"]),
        created_at=str(row["created_at"] or ""),
        updated_at=str(row["updated_at"] or ""),
    )


def sync_log_row(row: sqlite3.Row) -> ProductSyncLogInfo:
    try:
        errors = json.loads(row["errors_json"] or "[]")
        if not isinstance(errors, list):
            errors = [str(errors)]
    except Exception:
        errors = []
    return ProductSyncLogInfo(
        id=int(row["id"]),
        source=str(row["source"] or ""),
        status=str(row["status"] or ""),
        started_at=str(row["started_at"] or ""),
        finished_at=str(row["finished_at"] or ""),
        actor_username=str(row["actor_username"] or ""),
        actor_name=str(row["actor_name"] or ""),
        rows_processed=int(row["rows_processed"] or 0),
        rows_created=int(row["rows_created"] or 0),
        rows_updated=int(row["rows_updated"] or 0),
        rows_skipped=int(row["rows_skipped"] or 0),
        brands_created=int(row["brands_created"] or 0),
        errors=[str(x) for x in errors],
        spreadsheet_id=str(row["spreadsheet_id"] or ""),
        sheet_name=str(row["sheet_name"] or ""),
        price_changes_detected=int(row["price_changes_detected"] if "price_changes_detected" in row.keys() else 0),
        cost_changes_detected=int(row["cost_changes_detected"] if "cost_changes_detected" in row.keys() else 0),
        price_cost_updates_created=int(row["price_cost_updates_created"] if "price_cost_updates_created" in row.keys() else 0),
        price_cost_updates_skipped=int(row["price_cost_updates_skipped"] if "price_cost_updates_skipped" in row.keys() else 0),
    )


@router.get("/status", response_model=ProductCatalogStatus)
def catalog_status(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        totals = conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM products) AS total_products,
              (SELECT COUNT(*) FROM products WHERE is_active = 1) AS active_products,
              (SELECT COUNT(*) FROM product_brands WHERE is_active = 1) AS total_brands,
              (SELECT COUNT(*) FROM providers WHERE is_active = 1) AS total_providers,
              (SELECT COUNT(DISTINCT brand_id) FROM brand_providers) AS mapped_brands
            """
        ).fetchone()
        last = conn.execute("SELECT * FROM product_sync_logs ORDER BY id DESC LIMIT 1").fetchone()
        return ProductCatalogStatus(
            total_products=int(totals["total_products"] or 0),
            active_products=int(totals["active_products"] or 0),
            total_brands=int(totals["total_brands"] or 0),
            total_providers=int(totals["total_providers"] or 0),
            mapped_brands=int(totals["mapped_brands"] or 0),
            last_sync=sync_log_row(last) if last else None,
            config=runtime_product_catalog_config(),
        )


@router.get("/catalog", response_model=ProductListResponse)
def list_catalog(
    _user: Annotated[Any, Depends(require_permission("products.view"))],
    q: str = Query(default=""),
    marca: str = Query(default=""),
    tipo: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    where = ["is_active = 1"]
    params: list[Any] = []
    if q.strip():
        tokens = normalize_text(q).split()
        for token in tokens[:5]:
            where.append("search_text LIKE ?")
            params.append(f"%{token}%")
    if marca.strip():
        where.append("marca_normalized = ?")
        params.append(normalize_text(marca))
    if tipo.strip():
        where.append("tipo = ?")
        params.append(tipo.strip())
    where_sql = " AND ".join(where)
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        total = conn.execute(f"SELECT COUNT(*) AS c FROM products WHERE {where_sql}", params).fetchone()["c"]
        rows = conn.execute(
            f"SELECT * FROM products WHERE {where_sql} ORDER BY marca, tipo, descripcion LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return ProductListResponse(items=[ProductInfo(**{k: v for k, v in row_to_product(row).items() if k != "search"}) for row in rows], total=int(total or 0), limit=limit, offset=offset)


@router.get("/search", response_model=list[ProductInfo])
def search_catalog(_user: Annotated[Any, Depends(require_permission("products.view"))], q: str = Query(default=""), limit: int = Query(default=20, ge=1, le=100)):
    return [ProductInfo(**{k: v for k, v in item.items() if k != "search"}) for item in search_products(q, limit)]


@router.post("/sync/from-sheet", response_model=ProductSyncResult)
def sync_from_sheet(user: Annotated[Any, Depends(require_permission("products.sync"))]):
    return ProductSyncResult(**sync_products_from_sheet(user))


@router.get("/sync/logs", response_model=list[ProductSyncLogInfo])
def sync_logs(_user: Annotated[Any, Depends(require_permission("products.view"))], limit: int = Query(default=20, ge=1, le=100)):
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        rows = conn.execute("SELECT * FROM product_sync_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [sync_log_row(row) for row in rows]


@router.get("/brands", response_model=list[ProductBrandInfo])
def list_brands(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        rows = conn.execute(
            """
            SELECT b.*, p.id AS provider_id, p.name AS provider_name
            FROM product_brands b
            LEFT JOIN brand_providers bp ON bp.brand_id = b.id AND bp.is_default = 1
            LEFT JOIN providers p ON p.id = bp.provider_id
            WHERE b.is_active = 1
            ORDER BY b.name
            """
        ).fetchall()
        return [ProductBrandInfo(id=int(r["id"]), name=r["name"], normalized_name=r["normalized_name"], is_active=bool(r["is_active"]), provider_id=r["provider_id"], provider_name=r["provider_name"], updated_at=r["updated_at"] or "") for r in rows]


@router.get("/providers", response_model=list[ProviderInfo])
def list_providers(_user: Annotated[Any, Depends(require_permission("products.view"))], include_inactive: bool = False):
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        query = "SELECT * FROM providers"
        params: list[Any] = []
        if not include_inactive:
            query += " WHERE is_active = 1"
        query += " ORDER BY name"
        return [provider_row(row) for row in conn.execute(query, params).fetchall()]


@router.post("/providers", response_model=ProviderInfo)
def create_provider(data: ProviderPayload, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    now = utc_now_iso()
    name = clean_text(data.name)
    norm = normalize_text(name)
    if not norm:
        raise HTTPException(status_code=400, detail="Ingresá un proveedor válido.")
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        existing = conn.execute("SELECT * FROM providers WHERE normalized_name = ?", (norm,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE providers SET name = ?, contact_name = ?, email = ?, phone = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?
                """,
                (name, clean_text(data.contact_name), clean_text(data.email), clean_text(data.phone), clean_text(data.notes), 1 if data.is_active else 0, now, existing["id"]),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM providers WHERE id = ?", (existing["id"],)).fetchone()
            return provider_row(row)
        cur = conn.execute(
            """
            INSERT INTO providers (name, normalized_name, contact_name, email, phone, notes, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, norm, clean_text(data.contact_name), clean_text(data.email), clean_text(data.phone), clean_text(data.notes), 1 if data.is_active else 0, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM providers WHERE id = ?", (cur.lastrowid,)).fetchone()
        return provider_row(row)


@router.patch("/providers/{provider_id}", response_model=ProviderInfo)
def update_provider(provider_id: int, data: ProviderPayload, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    now = utc_now_iso()
    name = clean_text(data.name)
    norm = normalize_text(name)
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        row = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado.")
        duplicate = conn.execute("SELECT id FROM providers WHERE normalized_name = ? AND id <> ?", (norm, provider_id)).fetchone()
        if duplicate:
            raise HTTPException(status_code=400, detail="Ya existe otro proveedor con ese nombre.")
        conn.execute(
            """
            UPDATE providers SET name = ?, normalized_name = ?, contact_name = ?, email = ?, phone = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?
            """,
            (name, norm, clean_text(data.contact_name), clean_text(data.email), clean_text(data.phone), clean_text(data.notes), 1 if data.is_active else 0, now, provider_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        return provider_row(updated)


@router.get("/brand-providers", response_model=list[BrandProviderInfo])
def list_brand_providers(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        rows = conn.execute(
            """
            SELECT bp.*, b.name AS brand_name, p.name AS provider_name
            FROM brand_providers bp
            JOIN product_brands b ON b.id = bp.brand_id
            JOIN providers p ON p.id = bp.provider_id
            ORDER BY b.name, bp.is_default DESC, p.name
            """
        ).fetchall()
        return [BrandProviderInfo(id=r["id"], brand_id=r["brand_id"], brand_name=r["brand_name"], provider_id=r["provider_id"], provider_name=r["provider_name"], is_default=bool(r["is_default"]), created_at=r["created_at"], updated_at=r["updated_at"]) for r in rows]


@router.post("/brand-providers", response_model=BrandProviderInfo)
def set_brand_provider(data: BrandProviderPayload, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    now = utc_now_iso()
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        brand = conn.execute("SELECT * FROM product_brands WHERE id = ?", (data.brand_id,)).fetchone()
        provider = conn.execute("SELECT * FROM providers WHERE id = ?", (data.provider_id,)).fetchone()
        if not brand:
            raise HTTPException(status_code=404, detail="Marca no encontrada.")
        if not provider:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado.")
        if data.is_default:
            conn.execute("UPDATE brand_providers SET is_default = 0, updated_at = ? WHERE brand_id = ?", (now, data.brand_id))
        existing = conn.execute("SELECT id FROM brand_providers WHERE brand_id = ? AND provider_id = ?", (data.brand_id, data.provider_id)).fetchone()
        if existing:
            conn.execute("UPDATE brand_providers SET is_default = ?, updated_at = ? WHERE id = ?", (1 if data.is_default else 0, now, existing["id"]))
            bp_id = existing["id"]
        else:
            cur = conn.execute(
                "INSERT INTO brand_providers (brand_id, provider_id, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (data.brand_id, data.provider_id, 1 if data.is_default else 0, now, now),
            )
            bp_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            """
            SELECT bp.*, b.name AS brand_name, p.name AS provider_name
            FROM brand_providers bp
            JOIN product_brands b ON b.id = bp.brand_id
            JOIN providers p ON p.id = bp.provider_id
            WHERE bp.id = ?
            """,
            (bp_id,),
        ).fetchone()
        return BrandProviderInfo(id=row["id"], brand_id=row["brand_id"], brand_name=row["brand_name"], provider_id=row["provider_id"], provider_name=row["provider_name"], is_default=bool(row["is_default"]), created_at=row["created_at"], updated_at=row["updated_at"])


@router.delete("/brand-providers/{relation_id}")
def delete_brand_provider(relation_id: int, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    with db_connect() as conn:
        ensure_product_catalog_tables(conn)
        conn.execute("DELETE FROM brand_providers WHERE id = ?", (relation_id,))
        conn.commit()
    return {"ok": True}


@router.get("/provider-by-brand")
def provider_by_brand(_user: Annotated[Any, Depends(require_permission("products.view"))], marca: str = Query(default="")):
    provider = get_provider_for_brand(marca)
    return {"found": bool(provider), "provider": provider}
