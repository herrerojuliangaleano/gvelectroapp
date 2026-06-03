"""Sub-router del módulo Comercial · PSI.

Endpoints (Fase 1):
  GET  /api/psi/options    — marcas, tipos y sucursales para los filtros
  GET  /api/psi/report     — tabla del PSI con filtros aplicados
  POST /api/psi/adjust     — crear ajuste + escribir al libro mensual (próximo)
  POST /api/psi/adjust/{id}/revert — revertir ajuste                 (próximo)
  POST /api/psi/export-pdf — generar PDF del reporte                 (próximo)

Spec completa en docs/10-modulo-comercial-fase1.md §10.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, distinct, func, select

from ...auth import require_permission
from ...commercial.stock_reader import load_stock_map
from ...commercial.ventas_reader import load_ventas
from ...db import db_session
from ...models.products import Product
from ...models.sales_psi import SalesPsiAdjustment


router = APIRouter(prefix="/api/psi", tags=["psi"])


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────

class PSIOptionsResponse(BaseModel):
    marcas:     list[str]
    tipos:      list[str]
    sucursales: list[str]


class PSIAdjustmentInfo(BaseModel):
    id:          int
    fecha:       str   # YYYY-MM-DD (inserted_date)
    sucursal:    str
    delta:       int
    status:      str
    reason:      str
    fecha_mode:  str
    created_by:  Optional[str] = None
    created_at:  str


class PSIReportRow(BaseModel):
    product_id:               int
    sku:                      str
    descripcion:              str
    marca:                    str
    tipo:                     str
    condicion:                str
    stock:                    int
    sell_out:                 int
    sell_out_base:            int
    ajuste_delta:             int
    has_pending_adjustment:   bool
    historial_ajustes:        list[PSIAdjustmentInfo]


class PSINoCatalogadoRow(BaseModel):
    sku_raw:         str
    descripcion_raw: str
    cantidad_total:  int
    sucursales:      list[str]


class PSIReportTotals(BaseModel):
    stock:               int
    sell_out:            int
    ajustes_pendientes:  int
    productos_visibles:  int
    productos_no_catalogados: int


class PSIReportFiltersApplied(BaseModel):
    marcas:         list[str]
    tipos:          list[str]
    condicion:      str
    periodo_inicio: str
    periodo_fin:    str
    mode:           str


class PSIReportFreshness(BaseModel):
    stock_fetched_at:  Optional[str] = None
    ventas_fetched_at: Optional[str] = None
    months_used:       list[str] = []


class PSIReportResponse(BaseModel):
    filters_applied: PSIReportFiltersApplied
    items:           list[PSIReportRow]
    no_catalogados:  list[PSINoCatalogadoRow]
    totals:          PSIReportTotals
    data_freshness:  PSIReportFreshness


# ──────────────────────────────────────────────────────────────────────────
# Constantes
# ──────────────────────────────────────────────────────────────────────────

PSI_SUCURSALES = ["CASEROS", "SUR", "NORTE", "CANNING"]


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _parse_csv(text: str) -> list[str]:
    """Convierte 'a,b,c' → ['a','b','c'] (limpia vacíos y trim)."""
    if not text:
        return []
    return [x.strip() for x in text.split(",") if x.strip()]


def _parse_date(text: str, field: str) -> date:
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise HTTPException(400, f"Parámetro '{field}' debe tener formato YYYY-MM-DD")


def _monday_of(d: date) -> date:
    """Lunes de la semana de d (0=lunes)."""
    return d - timedelta(days=d.weekday())


def _default_periodo() -> tuple[date, date]:
    """Default: últimas 2 semanas completas (lunes hace 14 días → domingo hace 7)."""
    today = date.today()
    inicio = _monday_of(today) - timedelta(days=14)
    fin = inicio + timedelta(days=13)  # incluye domingo siguiente
    return inicio, fin


# ──────────────────────────────────────────────────────────────────────────
# GET /api/psi/options
# ──────────────────────────────────────────────────────────────────────────

@router.get("/options", response_model=PSIOptionsResponse)
def psi_options(_user: Annotated[Any, Depends(require_permission("psi.view"))]):
    """Marcas, tipos y sucursales disponibles para los multi-select de filtros."""
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


# ──────────────────────────────────────────────────────────────────────────
# GET /api/psi/report
# ──────────────────────────────────────────────────────────────────────────

def _adjustment_to_info(adj: SalesPsiAdjustment) -> PSIAdjustmentInfo:
    return PSIAdjustmentInfo(
        id=int(adj.id),
        fecha=adj.inserted_date.strftime("%Y-%m-%d"),
        sucursal=adj.sucursal,
        delta=int(adj.cantidad_delta),
        status=adj.status,
        reason=adj.reason or "",
        fecha_mode=adj.fecha_mode,
        created_by=None,  # se completa abajo con nombres resueltos
        created_at=(adj.created_at.isoformat() if adj.created_at else ""),
    )


@router.get("/report", response_model=PSIReportResponse)
def psi_report(
    _user: Annotated[Any, Depends(require_permission("psi.view"))],
    marcas: str = Query(default="", description="CSV de marcas a filtrar (vacío = todas)"),
    tipos: str = Query(default="", description="CSV de tipos a filtrar"),
    condicion: Literal["TODO", "PRIMERA", "OUTLET"] = Query(default="TODO"),
    periodo_inicio: str = Query(default="", description="YYYY-MM-DD"),
    periodo_fin: str = Query(default="", description="YYYY-MM-DD"),
    mode: Literal["default", "advanced"] = Query(default="default"),
    force_refresh: bool = Query(default=False),
):
    """Reporte PSI consolidado: catálogo × stock × ventas × ajustes.

    Ver docs/10-modulo-comercial-fase1.md §7 para el algoritmo completo.
    """
    # 1. Parsear filtros
    marcas_list = _parse_csv(marcas)
    tipos_list  = _parse_csv(tipos)
    if periodo_inicio:
        pi = _parse_date(periodo_inicio, "periodo_inicio")
    else:
        pi, _ = _default_periodo()
    if periodo_fin:
        pf = _parse_date(periodo_fin, "periodo_fin")
    else:
        _, pf = _default_periodo()
    if pf < pi:
        raise HTTPException(400, "periodo_fin no puede ser menor que periodo_inicio")

    # 2. Catálogo filtrado
    with db_session() as session:
        stmt = select(Product).where(Product.is_active.is_(True))
        if marcas_list:
            stmt = stmt.where(Product.marca.in_(marcas_list))
        if tipos_list:
            stmt = stmt.where(Product.tipo.in_(tipos_list))
        if condicion != "TODO":
            stmt = stmt.where(Product.condicion_producto == condicion)
        catalogo: list[Product] = session.scalars(stmt).all()

        # 3. Stock (lectura con cache)
        stock_map = load_stock_map(force_refresh=force_refresh)
        stock_fetched_at = datetime.utcnow().isoformat() + "Z"

        # 4. Ventas (lectura con cache)
        ventas = load_ventas(pi, pf, force_refresh=force_refresh)
        ventas_agg: dict[str, int] = ventas["ventas_agg"]
        by_sku_meta: dict[str, dict[str, Any]] = ventas["by_sku_meta"]
        months_used: list[tuple[int, int]] = ventas["months_used"]
        ventas_fetched_at = datetime.utcnow().isoformat() + "Z"

        # 5. Ajustes pendientes (los applied ya están en ventas)
        pending_rows: list[SalesPsiAdjustment] = session.scalars(
            select(SalesPsiAdjustment).where(
                and_(
                    SalesPsiAdjustment.status == "pending",
                    SalesPsiAdjustment.periodo_semana >= pi,
                    SalesPsiAdjustment.periodo_semana <= pf,
                )
            )
        ).all()
        pending_by_product: dict[int, list[SalesPsiAdjustment]] = {}
        for adj in pending_rows:
            pending_by_product.setdefault(int(adj.product_id), []).append(adj)

        # 6. Historial completo (todos los status) — para badges/drawer
        historial_rows: list[SalesPsiAdjustment] = session.scalars(
            select(SalesPsiAdjustment).where(
                and_(
                    SalesPsiAdjustment.periodo_semana >= pi,
                    SalesPsiAdjustment.periodo_semana <= pf,
                )
            ).order_by(SalesPsiAdjustment.created_at.desc())
        ).all()
        historial_by_product: dict[int, list[SalesPsiAdjustment]] = {}
        for adj in historial_rows:
            historial_by_product.setdefault(int(adj.product_id), []).append(adj)

    # 7. Construcción de filas
    rows: list[PSIReportRow] = []
    total_stock = 0
    total_sell_out = 0
    ajustes_count = 0
    for p in catalogo:
        sku_norm = str(p.sku_normalized or "")
        stock_actual = int(stock_map.get(sku_norm, 0))
        sell_out_base = int(ventas_agg.get(sku_norm, 0))
        pending_for_p = pending_by_product.get(int(p.id), [])
        ajuste_delta = sum(int(a.cantidad_delta) for a in pending_for_p)
        sell_out_final = sell_out_base + ajuste_delta

        # Regla de inclusión (default): stock>0 OR sell_out>0 OR ajuste
        if mode == "default":
            if stock_actual <= 0 and sell_out_final <= 0 and ajuste_delta == 0:
                continue
        # mode == 'advanced' incluye todos los productos del filtro

        historial_p = [_adjustment_to_info(a) for a in historial_by_product.get(int(p.id), [])]
        rows.append(PSIReportRow(
            product_id=int(p.id),
            sku=str(p.sku or ""),
            descripcion=str(p.descripcion or ""),
            marca=str(p.marca or ""),
            tipo=str(p.tipo or ""),
            condicion=str(p.condicion_producto or ""),
            stock=stock_actual,
            sell_out=sell_out_final,
            sell_out_base=sell_out_base,
            ajuste_delta=ajuste_delta,
            has_pending_adjustment=ajuste_delta != 0,
            historial_ajustes=historial_p,
        ))
        total_stock += stock_actual
        total_sell_out += sell_out_final
        if ajuste_delta != 0:
            ajustes_count += 1

    # 8. SKUs en ventas que no están en catálogo
    skus_en_ventas = set(ventas_agg.keys())
    skus_del_catalogo = {str(p.sku_normalized or "") for p in catalogo}
    # Si el usuario filtró por marca/tipo/condición, el catálogo es un subset.
    # Para no catalogados, comparamos contra TODO el catálogo activo (no contra el subset).
    if marcas_list or tipos_list or condicion != "TODO":
        with db_session() as session:
            all_skus = session.execute(
                select(Product.sku_normalized).where(Product.is_active.is_(True))
            ).scalars().all()
            skus_del_catalogo = {str(s or "") for s in all_skus}

    no_catalogados: list[PSINoCatalogadoRow] = []
    for sku_huerfano in sorted(skus_en_ventas - skus_del_catalogo):
        if not sku_huerfano:
            continue
        meta = by_sku_meta.get(sku_huerfano, {})
        no_catalogados.append(PSINoCatalogadoRow(
            sku_raw=str(meta.get("first_sku_raw") or ""),
            descripcion_raw=str(meta.get("first_descripcion") or ""),
            cantidad_total=int(ventas_agg.get(sku_huerfano, 0)),
            sucursales=list(meta.get("sucursales", []) or []),
        ))

    # 9. Ordenar y devolver
    rows.sort(key=lambda r: (r.marca, r.tipo, r.descripcion))

    return PSIReportResponse(
        filters_applied=PSIReportFiltersApplied(
            marcas=marcas_list,
            tipos=tipos_list,
            condicion=condicion,
            periodo_inicio=pi.strftime("%Y-%m-%d"),
            periodo_fin=pf.strftime("%Y-%m-%d"),
            mode=mode,
        ),
        items=rows,
        no_catalogados=no_catalogados,
        totals=PSIReportTotals(
            stock=total_stock,
            sell_out=total_sell_out,
            ajustes_pendientes=ajustes_count,
            productos_visibles=len(rows),
            productos_no_catalogados=len(no_catalogados),
        ),
        data_freshness=PSIReportFreshness(
            stock_fetched_at=stock_fetched_at,
            ventas_fetched_at=ventas_fetched_at,
            months_used=[f"{y:04d}-{m:02d}" for (y, m) in months_used],
        ),
    )


# ──────────────────────────────────────────────────────────────────────────
# POST /api/psi/adjust — crear ajuste + escribir al libro mensual
# ──────────────────────────────────────────────────────────────────────────

class PSIAdjustPayload(BaseModel):
    product_id:     int = Field(gt=0)
    sucursal:       str = Field(min_length=1)
    cantidad_delta: int
    periodo_inicio: str
    periodo_fin:    str
    fecha_mode:     Literal["manual", "random"] = "random"
    fecha_manual:   Optional[str] = None
    reason:         str = ""


class PSIAdjustResponse(BaseModel):
    id:                     int
    status:                 str
    inserted_date:          str
    sucursal:               str
    cantidad_delta:         int
    applied_to_book:        Optional[str] = None
    applied_to_sheet_range: Optional[str] = None
    message:                str


def _pick_random_date(periodo_inicio: date, periodo_fin: date) -> date:
    """Random date dentro del rango, excluyendo domingos."""
    import random
    days = (periodo_fin - periodo_inicio).days
    candidates: list[date] = []
    for i in range(days + 1):
        d = periodo_inicio + timedelta(days=i)
        if d.weekday() != 6:
            candidates.append(d)
    if not candidates:
        return periodo_inicio
    return random.choice(candidates)


def _resolve_user_id(session: Any, user: Any) -> Optional[int]:
    from ...models.auth import User
    from sqlalchemy import func as _func, select as _select
    uname = str(getattr(user, "username", "") or "").strip().lower()
    if not uname:
        return None
    return session.scalar(_select(User.id).where(_func.lower(User.username) == uname))


@router.post("/adjust", response_model=PSIAdjustResponse)
def psi_adjust(
    payload: PSIAdjustPayload,
    user: Annotated[Any, Depends(require_permission("psi.adjust"))],
):
    """Crea un ajuste manual y lo escribe al libro mensual en una sola op."""
    from ...models.products import Product
    from ...commercial import cache_invalidate
    from ...commercial.adjustments_writer import write_adjustment_to_monthly_book

    if payload.cantidad_delta == 0:
        raise HTTPException(400, "cantidad_delta no puede ser 0")
    if payload.sucursal not in PSI_SUCURSALES:
        raise HTTPException(400, f"sucursal inválida. Esperaba una de {PSI_SUCURSALES}")
    pi = _parse_date(payload.periodo_inicio, "periodo_inicio")
    pf = _parse_date(payload.periodo_fin, "periodo_fin")
    if pf < pi:
        raise HTTPException(400, "periodo_fin no puede ser menor que periodo_inicio")

    if payload.fecha_mode == "manual":
        if not payload.fecha_manual:
            raise HTTPException(400, "fecha_manual requerida cuando fecha_mode=manual")
        inserted = _parse_date(payload.fecha_manual, "fecha_manual")
        if not (pi <= inserted <= pf):
            raise HTTPException(400, f"fecha_manual debe estar entre {pi} y {pf}")
    else:
        inserted = _pick_random_date(pi, pf)

    with db_session() as session:
        product = session.get(Product, payload.product_id)
        if not product or not product.is_active:
            raise HTTPException(404, "Producto no encontrado o inactivo")

        actor_id = _resolve_user_id(session, user)

        valor_estimado: float | None = None
        try:
            if product.pvp is not None:
                valor_estimado = float(product.pvp) * payload.cantidad_delta
        except Exception:
            valor_estimado = None

        adj = SalesPsiAdjustment(
            product_id=int(product.id),
            sku_snapshot=str(product.sku or ""),
            marca_snapshot=str(product.marca or ""),
            tipo_snapshot=str(product.tipo or ""),
            condicion_snapshot=str(product.condicion_producto or ""),
            descripcion_snapshot=str(product.descripcion or ""),
            periodo_semana=_monday_of(inserted),
            inserted_date=inserted,
            sucursal=payload.sucursal,
            cantidad_delta=int(payload.cantidad_delta),
            valor_estimado=valor_estimado,
            reason=str(payload.reason or "").strip(),
            fecha_mode=payload.fecha_mode,
            status="pending",
            created_by_user_id=actor_id,
        )
        session.add(adj)
        session.flush()
        adjustment_id = int(adj.id)

        try:
            book_id, sheet_range = write_adjustment_to_monthly_book(
                adjustment_id=adjustment_id,
                inserted_date=inserted,
                sucursal=payload.sucursal,
                descripcion=adj.descripcion_snapshot,
                sku=adj.sku_snapshot,
                cantidad_delta=adj.cantidad_delta,
                valor_estimado=adj.valor_estimado,
            )
        except HTTPException:
            adj.status = "failed"
            session.commit()
            raise

        adj.status = "applied_to_sheet"
        adj.applied_at = datetime.utcnow()
        adj.applied_to_book = book_id
        adj.applied_to_sheet_range = sheet_range
        adj.applied_by_user_id = actor_id
        session.commit()

        cache_invalidate(f"ventas:{inserted.year}:{inserted.month:02d}")

        return PSIAdjustResponse(
            id=adjustment_id,
            status="applied_to_sheet",
            inserted_date=inserted.strftime("%Y-%m-%d"),
            sucursal=payload.sucursal,
            cantidad_delta=adj.cantidad_delta,
            applied_to_book=book_id,
            applied_to_sheet_range=sheet_range,
            message=f"Ajuste aplicado al libro mensual ({sheet_range})",
        )


# ──────────────────────────────────────────────────────────────────────────
# POST /api/psi/adjust/{id}/revert — revertir ajuste
# ──────────────────────────────────────────────────────────────────────────

class PSIRevertResponse(BaseModel):
    id:     int
    status: str
    message: str


@router.post("/adjust/{adjustment_id}/revert", response_model=PSIRevertResponse)
def psi_adjust_revert(
    adjustment_id: int,
    user: Annotated[Any, Depends(require_permission("psi.adjust"))],
):
    """Borra la fila del ajuste del libro mensual y marca el ajuste como reverted."""
    from ...commercial import cache_invalidate
    from ...commercial.adjustments_writer import revert_adjustment_in_monthly_book

    with db_session() as session:
        adj = session.get(SalesPsiAdjustment, adjustment_id)
        if not adj:
            raise HTTPException(404, "Ajuste no encontrado")
        if adj.status == "reverted":
            return PSIRevertResponse(id=adjustment_id, status="reverted", message="Ya estaba revertido")
        if adj.status != "applied_to_sheet" or not adj.applied_to_book:
            raise HTTPException(
                400,
                f"Solo se pueden revertir ajustes en estado 'applied_to_sheet'. Status actual: {adj.status}",
            )

        actor_id = _resolve_user_id(session, user)
        found = revert_adjustment_in_monthly_book(
            adjustment_id=adjustment_id,
            book_id=adj.applied_to_book,
            sucursal=adj.sucursal,
        )

        adj.status = "reverted"
        adj.reverted_at = datetime.utcnow()
        adj.reverted_by_user_id = actor_id
        session.commit()

        cache_invalidate(f"ventas:{adj.inserted_date.year}:{adj.inserted_date.month:02d}")

        if not found:
            return PSIRevertResponse(
                id=adjustment_id,
                status="reverted",
                message="No encontré la fila en el sheet (puede haberse borrado a mano). Marcado como reverted igual.",
            )
        return PSIRevertResponse(
            id=adjustment_id,
            status="reverted",
            message="Fila eliminada del libro mensual. Ajuste revertido.",
        )
