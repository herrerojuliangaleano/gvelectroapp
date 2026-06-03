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
from ...commercial.gfk_reader import (
    get_most_recent_gfk_for_range, load_gfk_sales_for_range,
)
from ...commercial.stock_reader import load_stock_map
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
    # Stock
    stock:                    int   # stock efectivo = base + ajustes de stock
    stock_base:               int   # lo que dice la hoja Stock
    stock_adjustment_delta:   int   # sum de ajustes target IN (stock, both)
    # Sell out
    sell_out:                 int   # GFK + ajustes pendientes
    sell_out_base:            int   # lo que dice el GFK (sin ajustes)
    ajuste_delta:             int   # sum de ajustes target IN (sell_out, both) PENDING
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


class PSIGFKFileInfo(BaseModel):
    file_id:       str
    file_name:     str
    correlativo:   int
    fecha_inicio:  str
    fecha_fin:     str


class PSIReportFreshness(BaseModel):
    stock_fetched_at:  Optional[str] = None
    ventas_fetched_at: Optional[str] = None
    months_used:       list[str] = []
    gfk_files_used:    list[PSIGFKFileInfo] = []
    no_gfk_available:  bool = False


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

        # 4. Ventas (desde GFK output, no del libro mensual)
        gfk_data = load_gfk_sales_for_range(pi, pf, force_refresh=force_refresh)
        ventas_agg: dict[str, int] = gfk_data["agg_by_sku"]
        by_sku_meta: dict[str, dict[str, Any]] = gfk_data["by_sku_meta"]
        gfk_files_used: list[dict[str, Any]] = gfk_data["files_used"]
        no_gfk_available: bool = gfk_data["no_gfk_available"]
        ventas_fetched_at = datetime.utcnow().isoformat() + "Z"

        # 5. Ajustes del rango — separados por target
        # Los applied_to_sheet de target=sell_out ya están reflejados en el GFK,
        # así que solo sumamos los 'pending' para sell_out. Para stock, sumamos
        # tanto pending como applied_to_sheet porque NUNCA se escriben al sheet
        # (viven solo en Postgres).
        all_in_range: list[SalesPsiAdjustment] = session.scalars(
            select(SalesPsiAdjustment).where(
                and_(
                    SalesPsiAdjustment.periodo_semana >= pi,
                    SalesPsiAdjustment.periodo_semana <= pf,
                    SalesPsiAdjustment.status.in_(["pending", "applied_to_sheet"]),
                )
            )
        ).all()
        pending_by_product: dict[int, list[SalesPsiAdjustment]] = {}
        stock_delta_by_product: dict[int, int] = {}
        for adj in all_in_range:
            pid = int(adj.product_id)
            # sell_out: solo los pending de target sell_out/both
            if adj.status == "pending" and adj.target in ("sell_out", "both"):
                pending_by_product.setdefault(pid, []).append(adj)
            # stock: pending+applied de target stock/both. Si target='both',
            # el stock se decrementa por la venta (delta sell_out negativo en stock).
            if adj.target == "stock":
                stock_delta_by_product[pid] = stock_delta_by_product.get(pid, 0) + int(adj.cantidad_delta)
            elif adj.target == "both":
                stock_delta_by_product[pid] = stock_delta_by_product.get(pid, 0) - int(adj.cantidad_delta)

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
        pid = int(p.id)
        # Stock: efectivo = sheet + delta de ajustes stock/both
        stock_base = int(stock_map.get(sku_norm, 0))
        stock_delta = int(stock_delta_by_product.get(pid, 0))
        stock_efectivo = stock_base + stock_delta
        # Sell out: GFK + ajustes pending sell_out/both
        sell_out_base = int(ventas_agg.get(sku_norm, 0))
        pending_for_p = pending_by_product.get(pid, [])
        ajuste_delta = sum(int(a.cantidad_delta) for a in pending_for_p)
        sell_out_final = sell_out_base + ajuste_delta

        # Regla de inclusión (default): stock>0 OR sell_out>0 OR ajuste
        if mode == "default":
            if stock_efectivo <= 0 and sell_out_final <= 0 and ajuste_delta == 0 and stock_delta == 0:
                continue

        historial_p = [_adjustment_to_info(a) for a in historial_by_product.get(pid, [])]
        rows.append(PSIReportRow(
            product_id=pid,
            sku=str(p.sku or ""),
            descripcion=str(p.descripcion or ""),
            marca=str(p.marca or ""),
            tipo=str(p.tipo or ""),
            condicion=str(p.condicion_producto or ""),
            stock=stock_efectivo,
            stock_base=stock_base,
            stock_adjustment_delta=stock_delta,
            sell_out=sell_out_final,
            sell_out_base=sell_out_base,
            ajuste_delta=ajuste_delta,
            has_pending_adjustment=(ajuste_delta != 0) or (stock_delta != 0),
            historial_ajustes=historial_p,
        ))
        total_stock += stock_efectivo
        total_sell_out += sell_out_final
        if ajuste_delta != 0 or stock_delta != 0:
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
            months_used=[],  # ya no aplica: ahora leemos de GFKs específicos
            gfk_files_used=[PSIGFKFileInfo(**f) for f in gfk_files_used],
            no_gfk_available=no_gfk_available,
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
    target:         Literal["sell_out", "stock", "both"] = "sell_out"


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
    """Crea un ajuste manual y lo aplica.

    Comportamiento según target:
      - sell_out / both: escribe una fila al GFK más reciente del rango.
      - stock         : solo persiste en Postgres (no toca Sheets).

    En 'both' el sell_out se escribe al GFK; el stock se descuenta lógicamente
    al mostrar el reporte (stock_efectivo = base - delta).
    """
    from ...models.products import Product
    from ...commercial import cache_invalidate
    from ...commercial.adjustments_writer import write_adjustment_to_gfk

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
            target=payload.target,
            created_by_user_id=actor_id,
        )
        session.add(adj)
        session.flush()
        adjustment_id = int(adj.id)

        # Si el target involucra sell_out → escribir al GFK.
        # Si es solo stock → no se escribe a ningún Sheet, queda solo en Postgres.
        wrote_to_gfk = payload.target in ("sell_out", "both")
        book_id: str | None = None
        sheet_range: str | None = None
        if wrote_to_gfk:
            try:
                book_id, sheet_range = write_adjustment_to_gfk(
                    adjustment_id=adjustment_id,
                    inserted_date=inserted,
                    sucursal=payload.sucursal,
                    descripcion=adj.descripcion_snapshot,
                    marca=adj.marca_snapshot,
                    sku=adj.sku_snapshot,
                    cantidad_delta=adj.cantidad_delta,
                    valor_estimado=adj.valor_estimado,
                    periodo_inicio=pi,
                    periodo_fin=pf,
                )
            except HTTPException:
                adj.status = "failed"
                session.commit()
                raise
            adj.applied_to_book = book_id
            adj.applied_to_sheet_range = sheet_range

        adj.status = "applied_to_sheet"
        adj.applied_at = datetime.utcnow()
        adj.applied_by_user_id = actor_id
        session.commit()

        # Invalidar caches relevantes
        if wrote_to_gfk and book_id:
            cache_invalidate(f"gfk:{book_id}")

        if wrote_to_gfk:
            msg = f"Ajuste aplicado al GFK ({sheet_range})"
            if payload.target == "both":
                msg += " · stock descontado lógicamente"
        else:
            msg = "Ajuste de stock registrado (solo Postgres, no se escribe al Sheet)"

        return PSIAdjustResponse(
            id=adjustment_id,
            status="applied_to_sheet",
            inserted_date=inserted.strftime("%Y-%m-%d"),
            sucursal=payload.sucursal,
            cantidad_delta=adj.cantidad_delta,
            applied_to_book=book_id,
            applied_to_sheet_range=sheet_range,
            message=msg,
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
    """Revierte un ajuste: si tenía fila en el GFK, la borra; marca reverted."""
    from ...commercial import cache_invalidate
    from ...commercial.adjustments_writer import revert_adjustment_in_gfk

    with db_session() as session:
        adj = session.get(SalesPsiAdjustment, adjustment_id)
        if not adj:
            raise HTTPException(404, "Ajuste no encontrado")
        if adj.status == "reverted":
            return PSIRevertResponse(id=adjustment_id, status="reverted", message="Ya estaba revertido")
        if adj.status != "applied_to_sheet":
            raise HTTPException(
                400,
                f"Solo se pueden revertir ajustes en estado 'applied_to_sheet'. Status actual: {adj.status}",
            )

        actor_id = _resolve_user_id(session, user)

        # Solo intentar borrar del GFK si el ajuste se había escrito ahí
        # (target = sell_out o both). Ajustes de stock puro no tocan el sheet.
        sheet_message = "Ajuste revertido."
        if adj.target in ("sell_out", "both") and adj.applied_to_book:
            found = revert_adjustment_in_gfk(
                adjustment_id=adjustment_id,
                book_id=adj.applied_to_book,
            )
            if found:
                sheet_message = "Fila eliminada del GFK. Ajuste revertido."
                cache_invalidate(f"gfk:{adj.applied_to_book}")
            else:
                sheet_message = (
                    "No encontré la fila en el GFK (puede haberse regenerado o "
                    "borrado). Marcado como reverted igual."
                )

        adj.status = "reverted"
        adj.reverted_at = datetime.utcnow()
        adj.reverted_by_user_id = actor_id
        session.commit()

        return PSIRevertResponse(
            id=adjustment_id,
            status="reverted",
            message=sheet_message,
        )
