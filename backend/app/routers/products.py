from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..auth import require_permission
from ..db import db_session
from ..models.auth import User
from ..models.products import BrandProvider, Product, ProductBrand, ProductSyncLog, Provider
from ..product_catalog import (
    clean_text,
    normalize_text,
    row_to_product,
    runtime_product_catalog_config,
    search_products,
    sync_products_from_sheet,
    utc_now_dt,
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
    # Cuántas garantías históricas sin proveedor se completaron al vincular
    # esta marca (solo se rellena en la respuesta de POST /brand-providers).
    warranties_backfilled: int = 0


class BackfillResult(BaseModel):
    updated: int
    by_provider: dict[str, int] = {}


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


def _dt(value: Any) -> str:
    return value.isoformat() if value else ""


def _provider_info(provider: Provider) -> ProviderInfo:
    return ProviderInfo(
        id=int(provider.id),
        name=str(provider.name or ""),
        contact_name=str(provider.contact_name or ""),
        email=str(provider.email or ""),
        phone=str(provider.phone or ""),
        notes=str(provider.notes or ""),
        is_active=bool(provider.is_active),
        created_at=_dt(provider.created_at),
        updated_at=_dt(provider.updated_at),
    )


def _sync_log_info(log: ProductSyncLog, session) -> ProductSyncLogInfo:
    username = ""
    display_name = ""
    if log.actor_user_id:
        user = session.get(User, log.actor_user_id)
        if user:
            username = str(user.username or "")
            display_name = str(user.display_name or "")
    return ProductSyncLogInfo(
        id=int(log.id),
        source=str(log.source or ""),
        status=str(log.status or ""),
        started_at=_dt(log.started_at),
        finished_at=_dt(log.finished_at),
        actor_username=username,
        actor_name=display_name,
        rows_processed=int(log.rows_processed or 0),
        rows_created=int(log.rows_created or 0),
        rows_updated=int(log.rows_updated or 0),
        rows_skipped=int(log.rows_skipped or 0),
        brands_created=int(log.brands_created or 0),
        errors=[str(x) for x in (log.errors or [])],
        spreadsheet_id=str(log.spreadsheet_id or ""),
        sheet_name=str(log.sheet_name or ""),
        price_changes_detected=int(log.price_changes_detected or 0),
        cost_changes_detected=int(log.cost_changes_detected or 0),
        price_cost_updates_created=int(log.price_cost_updates_created or 0),
        price_cost_updates_skipped=int(log.price_cost_updates_skipped or 0),
    )


def _product_info(product: Product) -> ProductInfo:
    return ProductInfo(**{k: v for k, v in row_to_product(product).items() if k != "search"})


def _brand_provider_info(link: BrandProvider) -> BrandProviderInfo:
    return BrandProviderInfo(
        id=int(link.id),
        brand_id=int(link.brand_id),
        brand_name=str(link.brand.name or "") if link.brand else "",
        provider_id=int(link.provider_id),
        provider_name=str(link.provider.name or "") if link.provider else "",
        is_default=bool(link.is_default),
        created_at=_dt(link.created_at),
        updated_at=_dt(link.updated_at),
    )


@router.get("/status", response_model=ProductCatalogStatus)
def catalog_status(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    with db_session() as session:
        last = session.scalar(select(ProductSyncLog).order_by(ProductSyncLog.id.desc()).limit(1))
        return ProductCatalogStatus(
            total_products=int(session.scalar(select(func.count()).select_from(Product)) or 0),
            active_products=int(session.scalar(select(func.count()).select_from(Product).where(Product.is_active.is_(True))) or 0),
            total_brands=int(session.scalar(select(func.count()).select_from(ProductBrand).where(ProductBrand.is_active.is_(True))) or 0),
            total_providers=int(session.scalar(select(func.count()).select_from(Provider).where(Provider.is_active.is_(True))) or 0),
            mapped_brands=int(session.scalar(select(func.count(func.distinct(BrandProvider.brand_id)))) or 0),
            last_sync=_sync_log_info(last, session) if last else None,
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
    with db_session() as session:
        stmt = select(Product).where(Product.is_active.is_(True))
        count_stmt = select(func.count()).select_from(Product).where(Product.is_active.is_(True))
        for token in normalize_text(q).split()[:5]:
            stmt = stmt.where(Product.search_text.ilike(f"%{token}%"))
            count_stmt = count_stmt.where(Product.search_text.ilike(f"%{token}%"))
        if marca.strip():
            norm = normalize_text(marca)
            stmt = stmt.where(Product.marca_normalized == norm)
            count_stmt = count_stmt.where(Product.marca_normalized == norm)
        if tipo.strip():
            stmt = stmt.where(Product.tipo == tipo.strip())
            count_stmt = count_stmt.where(Product.tipo == tipo.strip())
        total = int(session.scalar(count_stmt) or 0)
        rows = session.scalars(
            stmt.order_by(Product.marca.asc(), Product.tipo.asc(), Product.descripcion.asc())
            .limit(limit)
            .offset(offset)
        ).all()
        return ProductListResponse(items=[_product_info(row) for row in rows], total=total, limit=limit, offset=offset)


@router.get("/search", response_model=list[ProductInfo])
def search_catalog(_user: Annotated[Any, Depends(require_permission("products.view"))], q: str = Query(default=""), limit: int = Query(default=20, ge=1, le=100)):
    return [ProductInfo(**{k: v for k, v in item.items() if k != "search"}) for item in search_products(q, limit)]


@router.post("/sync/from-sheet", response_model=ProductSyncResult)
def sync_from_sheet(user: Annotated[Any, Depends(require_permission("products.sync"))]):
    return ProductSyncResult(**sync_products_from_sheet(user))


@router.get("/sync/logs", response_model=list[ProductSyncLogInfo])
def sync_logs(_user: Annotated[Any, Depends(require_permission("products.view"))], limit: int = Query(default=20, ge=1, le=100)):
    with db_session() as session:
        rows = session.scalars(select(ProductSyncLog).order_by(ProductSyncLog.id.desc()).limit(limit)).all()
        return [_sync_log_info(row, session) for row in rows]


class BrandWithoutProviderInfo(BaseModel):
    """Marca activa sin ningun proveedor vinculado, con cantidad de garantias
    para priorizar el trabajo de matching (cruce de datos posventa)."""
    brand_id: int
    name: str
    warranty_count: int


@router.get("/brands/without-provider", response_model=list[BrandWithoutProviderInfo])
def brands_without_provider(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    """Bandeja de matching marca→proveedor.

    Devuelve las marcas activas que NO tienen ningun proveedor vinculado en
    brand_providers, ordenadas por cantidad de garantias historicas con esa
    marca (descendente) — asi el matching se hace primero donde mas duele
    el cruce de datos (SLA por proveedor)."""
    from ..models.warranties import GuaranteeItem
    from ..warranty_helpers import normalize_text as _norm

    with db_session() as session:
        linked_ids = {bp.brand_id for bp in session.scalars(select(BrandProvider)).all()}
        brands = session.scalars(
            select(ProductBrand).where(ProductBrand.is_active.is_(True))
        ).all()
        unlinked = [b for b in brands if b.id not in linked_ids]
        if not unlinked:
            return []
        # Conteo de garantias por marca normalizada (items de garantia).
        counts: dict[str, int] = {}
        for (marca,) in session.execute(select(GuaranteeItem.marca)).all():
            key = _norm(str(marca or ""))
            if key:
                counts[key] = counts.get(key, 0) + 1
        out = [
            BrandWithoutProviderInfo(
                brand_id=int(b.id),
                name=str(b.name),
                warranty_count=counts.get(str(b.normalized_name or ""), 0),
            )
            for b in unlinked
        ]
        out.sort(key=lambda x: (-x.warranty_count, x.name))
        return out


@router.get("/brands", response_model=list[ProductBrandInfo])
def list_brands(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    with db_session() as session:
        brands = session.scalars(
            select(ProductBrand).where(ProductBrand.is_active.is_(True)).order_by(ProductBrand.name.asc())
        ).all()
        out: list[ProductBrandInfo] = []
        for brand in brands:
            link = session.scalar(
                select(BrandProvider)
                .where(BrandProvider.brand_id == brand.id, BrandProvider.is_default.is_(True))
                .limit(1)
            )
            provider = session.get(Provider, link.provider_id) if link else None
            out.append(ProductBrandInfo(
                id=int(brand.id),
                name=str(brand.name or ""),
                normalized_name=str(brand.normalized_name or ""),
                is_active=bool(brand.is_active),
                provider_id=int(provider.id) if provider else None,
                provider_name=str(provider.name or "") if provider else None,
                updated_at=_dt(brand.updated_at),
            ))
        return out


@router.get("/providers", response_model=list[ProviderInfo])
def list_providers(_user: Annotated[Any, Depends(require_permission("products.view"))], include_inactive: bool = False):
    with db_session() as session:
        stmt = select(Provider)
        if not include_inactive:
            stmt = stmt.where(Provider.is_active.is_(True))
        rows = session.scalars(stmt.order_by(Provider.name.asc())).all()
        return [_provider_info(row) for row in rows]


@router.post("/providers", response_model=ProviderInfo)
def create_provider(data: ProviderPayload, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    now = utc_now_dt()
    name = clean_text(data.name)
    norm = normalize_text(name)
    if not norm:
        raise HTTPException(status_code=400, detail="Ingresa un proveedor valido.")
    with db_session() as session:
        provider = session.scalar(select(Provider).where(Provider.normalized_name == norm))
        if provider:
            provider.name = name
            provider.contact_name = clean_text(data.contact_name)
            provider.email = clean_text(data.email)
            provider.phone = clean_text(data.phone)
            provider.notes = clean_text(data.notes)
            provider.is_active = bool(data.is_active)
            provider.updated_at = now
        else:
            provider = Provider(
                name=name,
                normalized_name=norm,
                contact_name=clean_text(data.contact_name),
                email=clean_text(data.email),
                phone=clean_text(data.phone),
                notes=clean_text(data.notes),
                is_active=bool(data.is_active),
                created_at=now,
                updated_at=now,
            )
            session.add(provider)
            session.flush()
        session.commit()
        return _provider_info(provider)


@router.patch("/providers/{provider_id}", response_model=ProviderInfo)
def update_provider(provider_id: int, data: ProviderPayload, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    now = utc_now_dt()
    name = clean_text(data.name)
    norm = normalize_text(name)
    with db_session() as session:
        provider = session.get(Provider, provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado.")
        duplicate = session.scalar(select(Provider.id).where(Provider.normalized_name == norm, Provider.id != provider_id))
        if duplicate:
            raise HTTPException(status_code=400, detail="Ya existe otro proveedor con ese nombre.")
        provider.name = name
        provider.normalized_name = norm
        provider.contact_name = clean_text(data.contact_name)
        provider.email = clean_text(data.email)
        provider.phone = clean_text(data.phone)
        provider.notes = clean_text(data.notes)
        provider.is_active = bool(data.is_active)
        provider.updated_at = now
        session.commit()
        return _provider_info(provider)


@router.get("/brand-providers", response_model=list[BrandProviderInfo])
def list_brand_providers(_user: Annotated[Any, Depends(require_permission("products.view"))]):
    with db_session() as session:
        rows = session.scalars(
            select(BrandProvider)
            .join(ProductBrand, ProductBrand.id == BrandProvider.brand_id)
            .join(Provider, Provider.id == BrandProvider.provider_id)
            .order_by(ProductBrand.name.asc(), BrandProvider.is_default.desc(), Provider.name.asc())
        ).all()
        return [_brand_provider_info(row) for row in rows]


@router.post("/brand-providers", response_model=BrandProviderInfo)
def set_brand_provider(data: BrandProviderPayload, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    now = utc_now_dt()
    with db_session() as session:
        brand = session.get(ProductBrand, data.brand_id)
        provider = session.get(Provider, data.provider_id)
        if not brand:
            raise HTTPException(status_code=404, detail="Marca no encontrada.")
        if not provider:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado.")
        if data.is_default:
            links = session.scalars(select(BrandProvider).where(BrandProvider.brand_id == data.brand_id)).all()
            for link in links:
                link.is_default = False
                link.updated_at = now
        relation = session.scalar(
            select(BrandProvider).where(
                BrandProvider.brand_id == data.brand_id,
                BrandProvider.provider_id == data.provider_id,
            )
        )
        if relation:
            relation.is_default = bool(data.is_default)
            relation.updated_at = now
        else:
            relation = BrandProvider(
                brand_id=data.brand_id,
                provider_id=data.provider_id,
                is_default=bool(data.is_default),
                created_at=now,
                updated_at=now,
            )
            session.add(relation)
            session.flush()
        session.commit()
        info = _brand_provider_info(relation)
        brand_name = str(brand.name or "")
    # Fuera de la sesión: completar garantías históricas de esta marca que
    # estaban sin proveedor (el matching retroactivo que pidió el negocio).
    if data.is_default and brand_name:
        try:
            from ..warranties_db import pg_backfill_provider_names
            result = pg_backfill_provider_names(brand_name)
            info.warranties_backfilled = int(result.get("updated") or 0)
        except Exception:
            pass  # no romper el vínculo si el backfill falla
    return info


@router.post("/brand-providers/backfill", response_model=BackfillResult)
def backfill_provider_names(_user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    """Completa el proveedor en TODAS las garantías históricas que están sin
    proveedor, usando el default de su marca. Para el botón "completar
    proveedores faltantes" de la bandeja de matching."""
    from ..warranties_db import pg_backfill_provider_names
    return BackfillResult(**pg_backfill_provider_names())


@router.delete("/brand-providers/{relation_id}")
def delete_brand_provider(relation_id: int, _user: Annotated[Any, Depends(require_permission("products.providers.manage"))]):
    with db_session() as session:
        relation = session.get(BrandProvider, relation_id)
        if relation:
            session.delete(relation)
            session.commit()
    return {"ok": True}


@router.get("/provider-by-brand")
def provider_by_brand(_user: Annotated[Any, Depends(require_permission("products.view"))], marca: str = Query(default="")):
    from ..product_catalog import get_provider_for_brand

    provider = get_provider_for_brand(marca)
    return {"found": bool(provider), "provider": provider}


# NOTA: el detector de transición y el seed se movieron al router dedicado
# /api/catalog (routers/catalog.py) — namespace único del módulo Maestro.
