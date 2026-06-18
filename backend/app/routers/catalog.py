"""Router del catálogo maestro de productos (módulo Maestro/Normalización).

Endpoints bajo /api/catalog:
  GET  /options                 opciones para los formularios
  GET  /template                plantilla (campos+patrones) por familia+rubro
  POST /preview                 generación en vivo (no guarda)
  POST /products                alta de producto nuevo
  GET  /products                listado con filtros
  GET  /products/{id}           detalle (con aliases)
  PATCH /products/{id}          editar/normalizar campos
  GET  /legacy-pending          cola de productos legacy a normalizar
  POST /normalize               normaliza un legacy (crea + vincula + alias)
  GET  /transition-status       detector de transición
  POST /seed                    cargar abreviaturas + plantillas (idempotente)
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..audit import audit
from ..auth import require_permission
from ..users import CurrentUser
from .. import catalog_service

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


def _uid(user: CurrentUser) -> int | None:
    return None  # el service resuelve user_id por su cuenta si hiciera falta


@router.get("/options")
def options(_user: Annotated[CurrentUser, Depends(require_permission("catalog.view"))]):
    return catalog_service.build_options()


@router.get("/template")
def template(_user: Annotated[CurrentUser, Depends(require_permission("catalog.view"))],
             familia: str = Query(...), rubro: str = Query(...)):
    t = catalog_service.get_template(familia, rubro)
    if not t:
        raise HTTPException(status_code=404, detail=f"No hay plantilla para {familia} / {rubro}.")
    return t


@router.post("/template-fields")
def add_template_field(payload: dict[str, Any], user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))]):
    try:
        res = catalog_service.add_template_field(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("catalog.template_field.create", user=user, resource_type="catalog_template",
          resource_id=f"{payload.get('familia_app')}/{payload.get('rubro_app')}",
          details={"field": res.get("created_field")})
    return res


@router.post("/template-field-options")
def add_template_field_option(payload: dict[str, Any], user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))]):
    try:
        res = catalog_service.add_template_field_option(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("catalog.template_option.upsert", user=user, resource_type="catalog_template",
          resource_id=f"{payload.get('familia_app')}/{payload.get('rubro_app')}",
          details={"field_name": payload.get("field_name"), "option": res.get("saved_option")})
    return res


@router.post("/preview")
def preview(payload: dict[str, Any], _user: Annotated[CurrentUser, Depends(require_permission("catalog.view"))]):
    return catalog_service.preview(payload)


@router.post("/products")
def create_product(payload: dict[str, Any], user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))]):
    try:
        res = catalog_service.create_product(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("catalog.create", user=user, resource_type="catalog_product", resource_id=str(res.get("id")),
          details={"sku": res.get("sku_comercial"), "estado": res.get("estado")})
    return res


@router.get("/products")
def list_products(_user: Annotated[CurrentUser, Depends(require_permission("catalog.view"))],
                  q: str = "", familia: str = "", rubro: str = "", estado: str = "",
                  condicion: str = "", sin_puma: bool = False, limit: int = Query(default=100, ge=1, le=500)):
    return catalog_service.list_products(q=q, familia=familia, rubro=rubro, estado=estado,
                                         condicion=condicion, sin_puma=sin_puma, limit=limit)


@router.get("/products/{product_id}")
def get_product(product_id: int, _user: Annotated[CurrentUser, Depends(require_permission("catalog.view"))]):
    p = catalog_service.get_product(product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    return p


@router.patch("/products/{product_id}")
def update_product(product_id: int, payload: dict[str, Any],
                   user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))]):
    try:
        res = catalog_service.update_product(product_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    audit("catalog.update", user=user, resource_type="catalog_product", resource_id=str(product_id),
          details={"estado": res.get("estado")})
    return res


@router.get("/legacy-pending")
def legacy_pending(_user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))],
                   q: str = "", limit: int = Query(default=50, ge=1, le=200)):
    return catalog_service.legacy_pending(limit=limit, q=q)


@router.post("/normalize")
def normalize(payload: dict[str, Any], user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))]):
    try:
        res = catalog_service.normalize_product(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("catalog.normalize", user=user, resource_type="catalog_product", resource_id=str(res.get("id")),
          details={"legacy_id": payload.get("legacy_product_id"), "estado": res.get("estado")})
    return res


@router.get("/transition-status")
def transition_status(_user: Annotated[CurrentUser, Depends(require_permission("catalog.view"))]):
    from ..db import db_session
    from ..models.products import Product
    from ..models.catalog import CatalogProduct
    from sqlalchemy import func, select
    with db_session() as session:
        total = session.scalar(select(func.count()).select_from(Product).where(Product.is_active.is_(True))) or 0
        migrados = session.scalar(select(func.count()).select_from(Product).where(
            Product.is_active.is_(True), Product.catalog_product_id.is_not(None))) or 0
        cat_total = session.scalar(select(func.count()).select_from(CatalogProduct)) or 0
        cat_activos = session.scalar(select(func.count()).select_from(CatalogProduct).where(CatalogProduct.activo.is_(True))) or 0
    faltan = int(total) - int(migrados)
    return {
        "legacy_total": int(total), "legacy_migrados": int(migrados), "legacy_faltan": faltan,
        "porcentaje": round(migrados * 100.0 / total, 1) if total else 0.0,
        "transicion_completa": bool(total > 0 and faltan == 0),
        "catalogo_total": int(cat_total), "catalogo_activos": int(cat_activos),
    }


@router.post("/seed")
def seed(user: Annotated[CurrentUser, Depends(require_permission("catalog.manage"))]):
    from ..catalog_seed import seed_catalog
    res = seed_catalog()
    audit("catalog.seed", user=user, resource_type="catalog", resource_id="seed", details=res)
    return res
