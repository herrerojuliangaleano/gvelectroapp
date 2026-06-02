"""Sub-router del módulo Comercial · PSI.

Endpoints (Fase 1):
  GET  /api/psi/options    — marcas, tipos y sucursales para los filtros
  GET  /api/psi/report     — tabla del PSI con filtros aplicados   (próximo)
  POST /api/psi/adjust     — crear ajuste + escribir al libro mensual (próximo)
  POST /api/psi/adjust/{id}/revert — revertir ajuste                 (próximo)
  POST /api/psi/export-pdf — generar PDF del reporte                 (próximo)

Spec completa en docs/10-modulo-comercial-fase1.md §10.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import distinct, func, select

from ...auth import require_permission
from ...db import db_session
from ...models.products import Product


router = APIRouter(prefix="/api/psi", tags=["psi"])


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────

class PSIOptionsResponse(BaseModel):
    marcas:     list[str]
    tipos:      list[str]
    sucursales: list[str]


# ──────────────────────────────────────────────────────────────────────────
# GET /api/psi/options
# ──────────────────────────────────────────────────────────────────────────

# Lista canónica de sucursales del PSI (corresponden a las hojas Ventas X Total
# del libro mensual y a las hojas BASE_* donde se escriben los ajustes).
PSI_SUCURSALES = ["CASEROS", "SUR", "NORTE", "CANNING"]


@router.get("/options", response_model=PSIOptionsResponse)
def psi_options(_user: Annotated[Any, Depends(require_permission("psi.view"))]):
    """Marcas, tipos y sucursales disponibles para los multi-select de filtros.

    Marca/tipo salen del catálogo de productos activos (mismo origen que el
    listado del PSI). Sucursales son las 4 canónicas del libro mensual.
    """
    with db_session() as session:
        marcas = session.execute(
            select(distinct(Product.marca))
            .where(Product.is_active.is_(True), func.trim(Product.marca) != "")
            .order_by(Product.marca.asc())
        ).scalars().all()
        tipos = session.execute(
            select(distinct(Product.tipo))
            .where(Product.is_active.is_(True), func.trim(Product.tipo) != "")
            .order_by(Product.tipo.asc())
        ).scalars().all()

    return PSIOptionsResponse(
        marcas=[m for m in marcas if m],
        tipos=[t for t in tipos if t],
        sucursales=PSI_SUCURSALES,
    )
