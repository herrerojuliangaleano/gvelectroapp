from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from .commercial.matching import build_product_indexes, normalize_descripcion, resolve_product
from .db import db_session
from .models.auth import User
from .models.org import Branch, Company
from .models.products import Product
from .models.sales_bi_commercial import (
    SalesBICommercialBatch,
    SalesBICommercialCorrection,
    SalesBICommercialRecord,
)
from .product_catalog import search_products, sku_key
from .sales_bi import (
    _decimal,
    _fmt_date,
    _fmt_dt,
    _norm,
    _num,
    _parse_date,
    _parse_date_value,
    _parse_num,
    find_branch,
    read_excel,
)


COMMERCIAL_SOURCE_KIND = "ventas_vs_costos"

SOURCE_SHEETS: dict[str, str] = {
    "VENTAS GV TOTAL": "Caseros",
    "VENTAS ABC CANNING": "Canning",
    "VENTAS ABC NORTE": "Norcenter",
    "VENTAS ABC SUR": "Lanus",
}
CONSOLIDATED_SHEET = "VENTA TOTAL GRUPO ECONOMICO"

HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "fecha": ("FECHA",),
    "tipo_venta": ("TIPO DE VENTA", "TIPO VENTA"),
    "marca": ("MARCA",),
    "tipo": ("TIPO", "LINEA"),
    "descripcion": ("DESCRIPCION", "DESCRIPCIÓN", "PRODUCTO"),
    "sku": ("SKU", "CODIGO", "CÓDIGO"),
    "cantidad": ("CANTIDAD", "CANT"),
    "pvp": ("PVP", "VALOR", "PRECIO"),
    "costo": ("COSTO",),
    "diferencia": ("DIFERENCIA", "MARGEN"),
}
REQUIRED_HEADERS = ("fecha", "tipo_venta", "marca", "tipo", "descripcion", "sku", "cantidad", "pvp", "costo")


def _normalize_sheet_name(name: str) -> str:
    return _norm(name).replace("-", " ")


def _normalize_sku(value: Any) -> str:
    return sku_key(value)


def _looks_missing_sku(value: Any) -> bool:
    text = _norm(value)
    compact = text.replace(" ", "")
    return compact in {"", "SKUNOENCONTRADO", "NOENCONTRADO", "SINSKU"}


def _tipo_venta(value: Any) -> str:
    text = _norm(value)
    if "ON LINE" in text or "ONLINE" in text or text == "WEB":
        return "online"
    if "LOCAL" in text:
        return "local"
    return str(value or "").strip().lower() or "local"


def _user_id_from_username(session, username: str) -> int | None:
    uname = str(username or "").strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(User.username == uname))


def _date_bounds(fecha_desde: str | None, fecha_hasta: str | None) -> tuple[date, date]:
    fd = _parse_date_value(fecha_desde) if fecha_desde else None
    fh = _parse_date_value(fecha_hasta) if fecha_hasta else None
    if fd is None or fh is None:
        with db_session() as session:
            min_max = session.execute(
                select(func.min(SalesBICommercialRecord.fecha), func.max(SalesBICommercialRecord.fecha))
                .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
                .where(SalesBICommercialBatch.status == "activo")
            ).one()
        today = date.today()
        fd = fd or min_max[0] or (today - timedelta(days=29))
        fh = fh or min_max[1] or today
    if fh < fd:
        fd, fh = fh, fd
    return fd, fh


def _find_header_row(rows: list[list]) -> tuple[int, dict[str, int]] | None:
    alias_lookup: dict[str, str] = {}
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            alias_lookup[_norm(alias)] = key

    for row_idx, row in enumerate(rows[:40]):
        col_map: dict[str, int] = {}
        for col_idx, cell in enumerate(row):
            key = alias_lookup.get(_norm(cell))
            if key and key not in col_map:
                col_map[key] = col_idx
        if all(key in col_map for key in REQUIRED_HEADERS):
            return row_idx, col_map
    return None


def _cell(row: list, col_map: dict[str, int], key: str) -> Any:
    idx = col_map.get(key)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _load_match_context(session) -> tuple[dict[str, dict], list[SalesBICommercialCorrection]]:
    products = session.scalars(select(Product).where(Product.is_active.is_(True))).all()
    indexes = build_product_indexes(products)
    indexes["by_id"] = {int(p.id): p for p in products}
    corrections = session.scalars(select(SalesBICommercialCorrection)).all()
    return indexes, list(corrections)


def _find_correction(
    corrections: list[SalesBICommercialCorrection],
    *,
    sku_norm: str,
    desc_norm: str,
    brand_norm: str,
    type_norm: str,
) -> SalesBICommercialCorrection | None:
    for correction in corrections:
        score = 0
        required = 0
        for attr, value in (
            ("match_sku_norm", sku_norm),
            ("match_desc_norm", desc_norm),
            ("match_brand_norm", brand_norm),
            ("match_type_norm", type_norm),
        ):
            expected = str(getattr(correction, attr) or "")
            if expected:
                required += 1
                if expected == value:
                    score += 1
        if required and score == required:
            return correction
    return None


def _apply_commercial_match(
    rec: dict[str, Any],
    indexes: dict[str, dict],
    corrections: list[SalesBICommercialCorrection],
) -> dict[str, Any]:
    sku_norm = _normalize_sku(rec.get("sku_raw"))
    desc_norm = normalize_descripcion(rec.get("descripcion_raw"))
    brand_norm = _norm(rec.get("marca_raw"))
    type_norm = _norm(rec.get("tipo_raw"))

    product = None
    correction = _find_correction(
        corrections,
        sku_norm=sku_norm,
        desc_norm=desc_norm,
        brand_norm=brand_norm,
        type_norm=type_norm,
    )
    if correction and correction.product_id:
        product = indexes.get("by_id", {}).get(int(correction.product_id))

    if product is None:
        product = resolve_product(sku_normalized=sku_norm, descripcion=rec.get("descripcion_raw"), indexes=indexes)

    corrected_sku = str(correction.corrected_sku or "") if correction else ""
    corrected_desc = str(correction.corrected_description or "") if correction else ""
    corrected_brand = str(correction.corrected_brand or "") if correction else ""
    corrected_type = str(correction.corrected_type or "") if correction else ""

    if correction and product:
        sku = corrected_sku or str(product.sku or "") or rec.get("sku_raw") or ""
        descripcion = corrected_desc or str(product.descripcion or "") or rec.get("descripcion_raw") or ""
        marca = corrected_brand or str(product.marca or "") or rec.get("marca_raw") or ""
        tipo_producto = corrected_type or str(product.tipo or "") or rec.get("tipo_raw") or ""
    else:
        sku = corrected_sku or rec.get("sku_raw") or (str(product.sku or "") if product else "")
        descripcion = corrected_desc or rec.get("descripcion_raw") or (str(product.descripcion or "") if product else "")
        marca = corrected_brand or rec.get("marca_raw") or (str(product.marca or "") if product else "")
        tipo_producto = corrected_type or rec.get("tipo_raw") or (str(product.tipo or "") if product else "")

    if product and _looks_missing_sku(sku):
        sku = str(product.sku or "") or sku
    # Categoria comercial (5 buckets) — reusa el clasificador del módulo
    # Vendedores así no divergen las taxonomías. tipo_producto sigue
    # disponible como dimensión de drill-down granular.
    from .sales_bi import _classify as _classify_categoria
    categoria, _ = _classify_categoria(str(tipo_producto or ""))

    rec.update({
        "sku": str(sku or "").strip(),
        "descripcion": str(descripcion or "").strip(),
        "marca": str(marca or "").strip() or "Sin marca",
        "tipo_producto": str(tipo_producto or "").strip() or "Sin linea",
        "categoria": categoria or "OTROS",
        "sku_normalized": _normalize_sku(sku),
        "descripcion_normalized": normalize_descripcion(descripcion),
        "product_id": int(product.id) if product else None,
        "correction_id": int(correction.id) if correction else None,
        "match_status": "corrected" if correction else ("matched" if product else "unmatched"),
    })
    return rec


def _record_totals(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "total_records": len(records),
        "total_units": sum(int(r.get("cantidad") or 0) for r in records),
        "total_pvp": round(sum(float(r.get("pvp") or 0) * int(r.get("cantidad") or 0) for r in records), 2),
        "total_costo": round(sum(float(r.get("costo") or 0) * int(r.get("cantidad") or 0) for r in records), 2),
        "total_diferencia": round(sum(float(r.get("diferencia") or 0) for r in records), 2),
        "matched_products": sum(1 for r in records if r.get("match_status") == "matched"),
        "corrected_products": sum(1 for r in records if r.get("match_status") == "corrected"),
        "unmatched_products": sum(1 for r in records if r.get("match_status") == "unmatched"),
    }


def _parse_commercial_sheet(
    name: str,
    rows: list[list],
    sucursal: str,
    indexes: dict[str, dict],
    corrections: list[SalesBICommercialCorrection],
) -> dict[str, Any]:
    warnings: list[str] = []
    header = _find_header_row(rows)
    if header is None:
        return {
            "sheet_name": name,
            "sucursal": sucursal,
            "period_start": "",
            "period_end": "",
            "records": [],
            "warnings": ["No se encontro encabezado valido de Ventas Vs. Costos."],
            "ok": False,
            **_record_totals([]),
        }
    header_idx, col_map = header
    records: list[dict[str, Any]] = []
    branch_cache: dict[str, str | None] = {}

    for row_idx, row in enumerate(rows[header_idx + 1 :], start=header_idx + 2):
        raw_fecha = _cell(row, col_map, "fecha")
        raw_desc = _cell(row, col_map, "descripcion")
        raw_sku = _cell(row, col_map, "sku")
        if not raw_fecha and not raw_desc and not raw_sku:
            continue
        fecha_text = _parse_date(raw_fecha)
        fecha = _parse_date_value(fecha_text)
        if fecha is None:
            continue

        cantidad = int(round(_parse_num(_cell(row, col_map, "cantidad")) or 1))
        if cantidad <= 0:
            cantidad = 1
        pvp = _parse_num(_cell(row, col_map, "pvp"))
        costo = _parse_num(_cell(row, col_map, "costo"))
        diff_unit = _parse_num(_cell(row, col_map, "diferencia"))
        if not diff_unit and (pvp or costo):
            diff_unit = pvp - costo
        diferencia = round(diff_unit * cantidad, 2)
        total_pvp = pvp * cantidad
        margen = round(diferencia / total_pvp * 100, 2) if total_pvp else 0.0
        tipo_venta = _tipo_venta(_cell(row, col_map, "tipo_venta"))
        branch_key = f"{sucursal}:{tipo_venta}"
        if branch_key not in branch_cache:
            branch = find_branch(sucursal, tipo_venta)
            branch_cache[branch_key] = branch["id"] if branch else None

        rec = {
            "source_sheet": name,
            "row_number": row_idx,
            "fecha": fecha.isoformat(),
            "sucursal": sucursal,
            "branch_id": branch_cache[branch_key],
            "tipo_venta": tipo_venta,
            "marca_raw": str(_cell(row, col_map, "marca") or "").strip(),
            "tipo_raw": str(_cell(row, col_map, "tipo") or "").strip(),
            "descripcion_raw": str(raw_desc or "").strip(),
            "sku_raw": str(raw_sku or "").strip(),
            "cantidad": cantidad,
            "pvp": round(pvp, 2),
            "costo": round(costo, 2),
            "diferencia": diferencia,
            "margen_porcentaje": margen,
        }
        records.append(_apply_commercial_match(rec, indexes, corrections))

    if not records:
        warnings.append("La hoja no tiene lineas comerciales importables.")

    dates = sorted(_parse_date_value(r["fecha"]) for r in records if _parse_date_value(r["fecha"]))
    totals = _record_totals(records)
    return {
        "sheet_name": name,
        "sucursal": sucursal,
        "period_start": dates[0].isoformat() if dates else "",
        "period_end": dates[-1].isoformat() if dates else "",
        "records": records,
        "warnings": warnings,
        "ok": bool(records),
        **totals,
    }


def analyze_ventas_vs_costos(sheets: dict[str, list[list]], source_name: str = "") -> dict[str, Any]:
    with db_session() as session:
        indexes, corrections = _load_match_context(session)
        products = session.scalars(select(Product).where(Product.is_active.is_(True))).all()
        indexes["by_id"] = {int(p.id): p for p in products}

    parsed: list[dict[str, Any]] = []
    warnings: list[str] = []
    ignored = []
    for name, rows in sheets.items():
        norm_name = _normalize_sheet_name(name)
        if norm_name.startswith("BASE"):
            ignored.append(name)
            continue
        if norm_name == CONSOLIDATED_SHEET:
            continue
        sucursal = SOURCE_SHEETS.get(norm_name)
        if not sucursal:
            ignored.append(name)
            continue
        parsed.append(_parse_commercial_sheet(name, rows, sucursal, indexes, corrections))

    if ignored:
        warnings.append("Hojas ignoradas: " + ", ".join(ignored[:12]) + ("..." if len(ignored) > 12 else ""))
    if not parsed:
        warnings.append("No se encontraron hojas validas: Ventas GV Total, Ventas ABC Canning, Ventas ABC-Norte, Ventas ABC-Sur.")

    all_records = [record for sheet in parsed for record in sheet.get("records", [])]
    totals = _record_totals(all_records)
    dates = sorted(_parse_date_value(r["fecha"]) for r in all_records if _parse_date_value(r["fecha"]))

    consolidated_rows = sheets.get(next((n for n in sheets if _normalize_sheet_name(n) == CONSOLIDATED_SHEET), ""), [])
    consolidated_total = 0.0
    if consolidated_rows:
        header = _find_header_row(consolidated_rows)
        if header:
            header_idx, col_map = header
            for row in consolidated_rows[header_idx + 1 :]:
                if not _cell(row, col_map, "fecha"):
                    continue
                qty = int(round(_parse_num(_cell(row, col_map, "cantidad")) or 1))
                consolidated_total += _parse_num(_cell(row, col_map, "pvp")) * max(1, qty)
            if abs(consolidated_total - totals["total_pvp"]) > 1:
                warnings.append(
                    f"El consolidado Venta Total Grupo Economico difiere del total de hojas fuente: "
                    f"{round(consolidated_total, 2)} vs {round(totals['total_pvp'], 2)}."
                )

    return {
        "source_kind": COMMERCIAL_SOURCE_KIND,
        "source_name": source_name,
        "period_start": dates[0].isoformat() if dates else "",
        "period_end": dates[-1].isoformat() if dates else "",
        "sheets": parsed,
        "warnings": warnings,
        **totals,
    }


def _batch_to_dict(batch: SalesBICommercialBatch) -> dict[str, Any]:
    return {
        "id": int(batch.id),
        "source_kind": str(batch.source_kind or COMMERCIAL_SOURCE_KIND),
        "fuente_nombre": str(batch.fuente_nombre or ""),
        "fuente_url": str(batch.fuente_url or ""),
        "status": str(batch.status or "activo"),
        "period_start": _fmt_date(batch.period_start),
        "period_end": _fmt_date(batch.period_end),
        "total_records": int(batch.total_records or 0),
        "total_units": int(batch.total_units or 0),
        "total_pvp": _num(batch.total_pvp),
        "total_costo": _num(batch.total_costo),
        "total_diferencia": _num(batch.total_diferencia),
        "created_at": _fmt_dt(batch.created_at),
        "voided_at": _fmt_dt(batch.voided_at),
        "void_reason": str(batch.void_reason or ""),
        "warnings": list(batch.warnings or []),
    }


def save_commercial_import(
    analysis: dict[str, Any],
    *,
    fuente_nombre: str,
    fuente_url: str = "",
    username: str = "",
) -> int:
    all_records = [record for sheet in analysis.get("sheets", []) for record in sheet.get("records", [])]
    totals = _record_totals(all_records)
    with db_session() as session:
        batch = SalesBICommercialBatch(
            source_kind=COMMERCIAL_SOURCE_KIND,
            fuente_nombre=fuente_nombre,
            fuente_url=fuente_url,
            status="activo",
            period_start=_parse_date_value(analysis.get("period_start")),
            period_end=_parse_date_value(analysis.get("period_end")),
            total_records=int(totals["total_records"]),
            total_units=int(totals["total_units"]),
            total_pvp=_decimal(totals["total_pvp"]),
            total_costo=_decimal(totals["total_costo"]),
            total_diferencia=_decimal(totals["total_diferencia"]),
            imported_by_user_id=_user_id_from_username(session, username),
            warnings=list(analysis.get("warnings", [])),
        )
        session.add(batch)
        session.flush()
        for rec in all_records:
            fecha = _parse_date_value(rec.get("fecha"))
            if fecha is None:
                continue
            session.add(
                SalesBICommercialRecord(
                    batch=batch,
                    source_sheet=str(rec.get("source_sheet") or ""),
                    row_number=int(rec.get("row_number") or 0),
                    fecha=fecha,
                    sucursal=str(rec.get("sucursal") or ""),
                    branch_id=rec.get("branch_id") or None,
                    tipo_venta=str(rec.get("tipo_venta") or ""),
                    marca_raw=str(rec.get("marca_raw") or ""),
                    tipo_raw=str(rec.get("tipo_raw") or ""),
                    descripcion_raw=str(rec.get("descripcion_raw") or ""),
                    sku_raw=str(rec.get("sku_raw") or ""),
                    marca=str(rec.get("marca") or ""),
                    tipo_producto=str(rec.get("tipo_producto") or ""),
                    categoria=str(rec.get("categoria") or "OTROS"),
                    descripcion=str(rec.get("descripcion") or ""),
                    sku=str(rec.get("sku") or ""),
                    sku_normalized=str(rec.get("sku_normalized") or ""),
                    descripcion_normalized=str(rec.get("descripcion_normalized") or ""),
                    product_id=rec.get("product_id") or None,
                    correction_id=rec.get("correction_id") or None,
                    match_status=str(rec.get("match_status") or "unmatched"),
                    cantidad=int(rec.get("cantidad") or 1),
                    pvp=_decimal(rec.get("pvp")),
                    costo=_decimal(rec.get("costo")),
                    diferencia=_decimal(rec.get("diferencia")),
                    margen_porcentaje=_decimal(rec.get("margen_porcentaje")),
                )
            )
        batch_id = int(batch.id)
        session.commit()
    return batch_id


def find_overlapping_batches(period_start: Any, period_end: Any) -> list[dict[str, Any]]:
    """Lotes ACTIVOS cuyo período se solapa con [period_start, period_end].

    Se usa antes de confirmar un import para avisar que ese rango ya tiene
    datos cargados (importarlo igual duplicaría ventas en los reportes).
    """
    ps = _parse_date_value(period_start)
    pe = _parse_date_value(period_end)
    if ps is None or pe is None:
        return []
    with db_session() as session:
        rows = session.scalars(
            select(SalesBICommercialBatch)
            .where(
                SalesBICommercialBatch.status == "activo",
                SalesBICommercialBatch.period_start <= pe,
                SalesBICommercialBatch.period_end >= ps,
            )
            .order_by(SalesBICommercialBatch.period_start)
        ).all()
        return [
            {
                "id": int(b.id),
                "fuente_nombre": b.fuente_nombre,
                "period_start": _fmt_date(b.period_start),
                "period_end": _fmt_date(b.period_end),
                "total_records": int(b.total_records or 0),
            }
            for b in rows
        ]


def list_commercial_batches(limit: int = 50, offset: int = 0, status: str | None = None) -> tuple[list[dict], int]:
    filters: list[Any] = [SalesBICommercialBatch.source_kind == COMMERCIAL_SOURCE_KIND]
    if status:
        filters.append(SalesBICommercialBatch.status == status)
    with db_session() as session:
        total = int(session.scalar(select(func.count()).select_from(SalesBICommercialBatch).where(*filters)) or 0)
        rows = session.scalars(
            select(SalesBICommercialBatch)
            .where(*filters)
            .order_by(SalesBICommercialBatch.created_at.desc(), SalesBICommercialBatch.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return [_batch_to_dict(row) for row in rows], total


def void_commercial_batch(batch_id: int, username: str, reason: str = "") -> bool:
    from .models.base import utcnow

    with db_session() as session:
        batch = session.get(SalesBICommercialBatch, int(batch_id))
        if not batch:
            return False
        batch.status = "anulado"
        batch.voided_at = utcnow()
        batch.voided_by_user_id = _user_id_from_username(session, username)
        batch.void_reason = str(reason or "")
        session.commit()
        return True


def _record_to_dict(record: SalesBICommercialRecord, *, include_costs: bool, include_margin: bool) -> dict[str, Any]:
    data = {
        "id": int(record.id),
        "batch_id": int(record.batch_id),
        "source_sheet": str(record.source_sheet or ""),
        "row_number": int(record.row_number or 0),
        "fecha": _fmt_date(record.fecha),
        "sucursal": str(record.sucursal or ""),
        "branch_id": str(record.branch_id) if record.branch_id else None,
        "tipo_venta": str(record.tipo_venta or ""),
        "marca": str(record.marca or ""),
        "tipo_producto": str(record.tipo_producto or ""),
        "descripcion": str(record.descripcion or ""),
        "sku": str(record.sku or ""),
        "sku_normalized": str(record.sku_normalized or ""),
        "product_id": int(record.product_id) if record.product_id else None,
        "correction_id": int(record.correction_id) if record.correction_id else None,
        "match_status": str(record.match_status or "unmatched"),
        "cantidad": int(record.cantidad or 0),
        "pvp": _num(record.pvp),
        "total_pvp": round(_num(record.pvp) * int(record.cantidad or 0), 2),
    }
    if include_costs:
        data["costo"] = _num(record.costo)
        data["total_costo"] = round(_num(record.costo) * int(record.cantidad or 0), 2)
        data["diferencia"] = _num(record.diferencia)
    if include_margin:
        data["margen_porcentaje"] = _num(record.margen_porcentaje)
    return data


def _commercial_rows(
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    *,
    empresa: str | None = None,
    sucursal: str | None = None,
    sucursales: list[str] | str | None = None,
    tipo_venta: str | None = None,
    marca: str | None = None,
    marcas: list[str] | str | None = None,
    tipo_producto: str | None = None,
    tipos: list[str] | str | None = None,
    categoria: str | None = None,
    categorias: list[str] | str | None = None,
) -> tuple[list[SalesBICommercialRecord], tuple[date, date]]:
    fd, fh = _date_bounds(fecha_desde, fecha_hasta)
    filters: list[Any] = [
        SalesBICommercialBatch.status == "activo",
        SalesBICommercialRecord.fecha >= fd,
        SalesBICommercialRecord.fecha <= fh,
    ]
    sucursales_list = _parse_csv_list(sucursales)
    marcas_list = _parse_csv_list(marcas)
    tipos_list = _parse_csv_list(tipos)
    if sucursal and not sucursales_list:
        filters.append(SalesBICommercialRecord.sucursal == sucursal)
    elif sucursales_list:
        filters.append(SalesBICommercialRecord.sucursal.in_(sucursales_list))
    if tipo_venta:
        filters.append(SalesBICommercialRecord.tipo_venta == tipo_venta)
    if marca and not marcas_list:
        filters.append(SalesBICommercialRecord.marca == marca)
    elif marcas_list:
        filters.append(SalesBICommercialRecord.marca.in_(marcas_list))
    # Filtro de "línea": el dashboard manda categoría (LINEA BLANCA, COCINA,
    # …) pero el contrato viejo usaba `tipo_producto` con el granular
    # (HELADERA, LAVARROPAS). Si el valor recibido matchea uno de los 5
    # buckets de categoría, lo redirigimos a la columna `categoria`. Eso
    # mantiene back-compat con clientes que ya mandaban tipo_producto
    # granular y agrega soporte transparente para el dropdown nuevo.
    _CATEGORIAS_VALIDAS = {"LINEA BLANCA", "COCINA", "CLIMATIZACION", "TV / AUDIO", "PEQUENOS", "OTROS"}
    categorias_list = _parse_csv_list(categorias)
    if categoria and not categorias_list:
        filters.append(SalesBICommercialRecord.categoria == categoria)
    elif categorias_list:
        filters.append(SalesBICommercialRecord.categoria.in_(categorias_list))

    if tipo_producto and not tipos_list:
        if tipo_producto in _CATEGORIAS_VALIDAS:
            filters.append(SalesBICommercialRecord.categoria == tipo_producto)
        else:
            filters.append(SalesBICommercialRecord.tipo_producto == tipo_producto)
    elif tipos_list:
        cats_in_list = [t for t in tipos_list if t in _CATEGORIAS_VALIDAS]
        tipos_only = [t for t in tipos_list if t not in _CATEGORIAS_VALIDAS]
        if cats_in_list and tipos_only:
            filters.append(or_(
                SalesBICommercialRecord.categoria.in_(cats_in_list),
                SalesBICommercialRecord.tipo_producto.in_(tipos_only),
            ))
        elif cats_in_list:
            filters.append(SalesBICommercialRecord.categoria.in_(cats_in_list))
        else:
            filters.append(SalesBICommercialRecord.tipo_producto.in_(tipos_only))
    if empresa:
        filters.append(
            SalesBICommercialRecord.branch_id.in_(
                select(Branch.id).where(Branch.company_id == empresa)
            )
        )

    with db_session() as session:
        records = session.scalars(
            select(SalesBICommercialRecord)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(*filters)
            .order_by(SalesBICommercialRecord.fecha.asc(), SalesBICommercialRecord.id.asc())
        ).all()
    return list(records), (fd, fh)


def _parse_csv_list(value: list[str] | str | None) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return [str(v).strip() for v in value if str(v or "").strip()]


def _metric_bucket() -> dict[str, Any]:
    return {
        "total_vendido": 0.0,
        "unidades": 0,
        "lineas": 0,
        "productos": set(),
        "diferencia": 0.0,
        "costo_total": 0.0,
    }


def _add_metric(bucket: dict[str, Any], record: SalesBICommercialRecord) -> None:
    cantidad = int(record.cantidad or 0)
    total = _num(record.pvp) * cantidad
    bucket["total_vendido"] += total
    bucket["unidades"] += cantidad
    bucket["lineas"] += 1
    bucket["productos"].add(str(record.sku_normalized or record.descripcion_normalized or record.id))
    bucket["diferencia"] += _num(record.diferencia)
    bucket["costo_total"] += _num(record.costo) * cantidad


def _finalize_metric(
    bucket: dict[str, Any],
    *,
    include_costs: bool,
    include_margin: bool,
    total_reference: float | None = None,
) -> dict[str, Any]:
    total = float(bucket.get("total_vendido") or 0.0)
    lineas = int(bucket.get("lineas") or 0)
    unidades = int(bucket.get("unidades") or 0)
    out = {
        "total_vendido": round(total, 2),
        "unidades": unidades,
        "lineas": lineas,
        "productos": len(bucket.get("productos") or set()),
        "pvp_promedio": round(total / unidades, 2) if unidades else 0.0,
        "participacion_pct": round(total / total_reference * 100, 2) if total_reference else 0.0,
    }
    if include_costs:
        out["costo_total"] = round(float(bucket.get("costo_total") or 0.0), 2)
        out["diferencia"] = round(float(bucket.get("diferencia") or 0.0), 2)
    if include_margin:
        diferencia = float(bucket.get("diferencia") or 0.0)
        out["margen_porcentaje"] = round(diferencia / total * 100, 2) if total else 0.0
    return out


def _ranked(source: dict[str, dict[str, Any]], *, include_costs: bool, include_margin: bool, total_reference: float, limit: int = 20) -> list[dict[str, Any]]:
    items = [
        {"name": key, **_finalize_metric(bucket, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference)}
        for key, bucket in source.items()
    ]
    items.sort(key=lambda row: (float(row["total_vendido"]), int(row["unidades"])), reverse=True)
    return items[:limit]


def _record_dimension(record: SalesBICommercialRecord, dimension: str) -> str:
    if dimension == "date":
        return _fmt_date(record.fecha)
    if dimension == "brand":
        return str(record.marca or "Sin marca")
    if dimension == "line":
        # `line` ahora apunta a la categoria comercial (5 buckets: LINEA BLANCA,
        # COCINA, CLIMATIZACION, TV / AUDIO, PEQUENOS, OTROS) y no al
        # tipo_producto granular. La taxonomía es la misma que el módulo
        # Vendedores (`sales_bi._classify`). El tipo granular sigue
        # disponible vía `dimension="tipo"` (drill-down).
        return str(record.categoria or "OTROS")
    if dimension == "tipo":
        return str(record.tipo_producto or "Sin tipo")
    if dimension == "branch":
        return str(record.sucursal or "Sin sucursal")
    if dimension == "sale_type":
        return str(record.tipo_venta or "Sin tipo")
    return "Sin dato"


def _cross_matrix(
    records: list[SalesBICommercialRecord],
    *,
    row_dimension: str,
    col_dimension: str,
    include_costs: bool,
    include_margin: bool,
    row_limit: int = 20,
    col_limit: int = 20,
) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    row_totals: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    for record in records:
        row = _record_dimension(record, row_dimension)
        col = _record_dimension(record, col_dimension)
        _add_metric(rows[row][col], record)
        _add_metric(row_totals[row], record)

    out: list[dict[str, Any]] = []
    for row_name, cols in rows.items():
        row_metric = _finalize_metric(
            row_totals[row_name],
            include_costs=include_costs,
            include_margin=include_margin,
        )
        total_reference = float(row_metric.get("total_vendido") or 0.0)
        out.append({
            "name": row_name,
            "total": row_metric,
            "items": _ranked(
                cols,
                include_costs=include_costs,
                include_margin=include_margin,
                total_reference=total_reference,
                limit=col_limit,
            ),
        })
    if row_dimension == "date":
        out.sort(key=lambda row: str(row["name"]))
    else:
        out.sort(key=lambda row: (float(row["total"].get("total_vendido") or 0), int(row["total"].get("unidades") or 0)), reverse=True)
    return out[:row_limit]


def _common_report(
    records: list[SalesBICommercialRecord],
    bounds: tuple[date, date],
    *,
    include_costs: bool,
    include_margin: bool,
    presentation: bool,
    filters: dict[str, Any],
) -> dict[str, Any]:
    overall = _metric_bucket()
    daily: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    brands: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    # `lines` = categoria comercial (5 buckets); `tipos` = tipo_producto granular
    # (HELADERA, LAVARROPAS, ...) que ahora vive en su propia dimensión para
    # quien quiera drill-down debajo de la línea.
    lines: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    tipos: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    branches: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    tipo_venta: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    products: dict[tuple[str, str], dict[str, Any]] = {}
    product_branch_metrics: dict[tuple[str, str], dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    unmatched = 0

    for record in records:
        _add_metric(overall, record)
        _add_metric(daily[_fmt_date(record.fecha)], record)
        _add_metric(brands[str(record.marca or "Sin marca")], record)
        _add_metric(lines[str(record.categoria or "OTROS")], record)
        _add_metric(tipos[str(record.tipo_producto or "Sin tipo")], record)
        _add_metric(branches[str(record.sucursal or "Sin sucursal")], record)
        _add_metric(tipo_venta[str(record.tipo_venta or "Sin tipo")], record)
        key = (str(record.sku or ""), str(record.descripcion or ""))
        if key not in products:
            products[key] = {
                "sku": key[0],
                "producto": key[1],
                "marca": str(record.marca or ""),
                "tipo_producto": str(record.tipo_producto or ""),
                "branches": set(),
                **_metric_bucket(),
            }
        _add_metric(products[key], record)
        products[key]["branches"].add(str(record.sucursal or "Sin sucursal"))
        _add_metric(product_branch_metrics[key][str(record.sucursal or "Sin sucursal")], record)
        if str(record.match_status or "unmatched") == "unmatched":
            unmatched += 1

    totals = _finalize_metric(overall, include_costs=include_costs, include_margin=include_margin)
    total_reference = float(totals["total_vendido"] or 0.0)
    top_products = [
        {
            "sku": value["sku"],
            "producto": value["producto"],
            "marca": value["marca"],
            "tipo_producto": value["tipo_producto"],
            **_finalize_metric(value, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference),
        }
        for value in products.values()
    ]
    top_products.sort(key=lambda row: (float(row["total_vendido"]), int(row["unidades"])), reverse=True)
    branch_names = sorted(str(name) for name in branches.keys())
    branch_count = len(branch_names)
    product_presence = []
    for key, value in products.items():
        present_branches = sorted(str(name) for name in (value.get("branches") or set()))
        branch_metrics = []
        for branch_name in present_branches:
            branch_metrics.append({
                "name": branch_name,
                **_finalize_metric(
                    product_branch_metrics[key][branch_name],
                    include_costs=include_costs,
                    include_margin=include_margin,
                    total_reference=float(value.get("total_vendido") or 0.0),
                ),
            })
        product_presence.append({
            "sku": value["sku"],
            "producto": value["producto"],
            "marca": value["marca"],
            "tipo_producto": value["tipo_producto"],
            "branches": present_branches,
            "branch_count": len(present_branches),
            "is_common": branch_count > 0 and len(present_branches) == branch_count,
            "is_exclusive": len(present_branches) == 1,
            "exclusive_branch": present_branches[0] if len(present_branches) == 1 else "",
            "branch_metrics": branch_metrics,
            **_finalize_metric(value, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference),
        })
    product_presence.sort(key=lambda row: (int(row.get("branch_count") or 0), float(row.get("total_vendido") or 0.0)), reverse=True)
    return {
        "filters": {
            "fecha_desde": bounds[0].isoformat(),
            "fecha_hasta": bounds[1].isoformat(),
            **filters,
        },
        "source": "Ventas Vs. Costos",
        "coverage_note": "No incluye medios de pago, senas, recibos, remitos ni vendedores.",
        "presentation": bool(presentation),
        "sensitive": {"include_costs": include_costs, "include_margin": include_margin},
        "totals": totals,
        "daily_series": [
            {"fecha": key, **_finalize_metric(bucket, include_costs=include_costs, include_margin=include_margin)}
            for key, bucket in sorted(daily.items())
        ],
        "brand_mix": _ranked(brands, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference),
        # `line_mix` = mix por las 5 categorías comerciales.
        "line_mix": _ranked(lines, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference),
        # `tipo_mix` = mix por tipo_producto granular (~54 tipos: HELADERA,
        # LAVARROPAS, ...). Tiene su propia pestaña "Tipos" en el frontend y
        # también se usa como drill-down debajo de la categoria. Límite alto
        # para que entren TODOS los tipos (no solo el top 20 por defecto).
        "tipo_mix": _ranked(tipos, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference, limit=200),
        "branch_mix": _ranked(branches, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference),
        "sale_type_mix": _ranked(tipo_venta, include_costs=include_costs, include_margin=include_margin, total_reference=total_reference),
        "branch_line_matrix": _cross_matrix(
            records,
            row_dimension="branch",
            col_dimension="line",
            include_costs=include_costs,
            include_margin=include_margin,
        ),
        # Drill-down: por cada sucursal, los TIPOS granulares (HELADERA,
        # LAVARROPAS, MICROONDAS, ...) ordenados por venta. Mas detallado
        # que el branch_line_matrix (que usa las 5 categorias) y necesario
        # para el bloque "Lineas mas vendidas" del tab Sucursales.
        "branch_tipo_matrix": _cross_matrix(
            records,
            row_dimension="branch",
            col_dimension="tipo",
            include_costs=include_costs,
            include_margin=include_margin,
            col_limit=30,
        ),
        "branch_brand_matrix": _cross_matrix(
            records,
            row_dimension="branch",
            col_dimension="brand",
            include_costs=include_costs,
            include_margin=include_margin,
        ),
        "brand_line_matrix": _cross_matrix(
            records,
            row_dimension="brand",
            col_dimension="line",
            include_costs=include_costs,
            include_margin=include_margin,
        ),
        "brand_branch_matrix": _cross_matrix(
            records,
            row_dimension="brand",
            col_dimension="branch",
            include_costs=include_costs,
            include_margin=include_margin,
        ),
        "date_line_matrix": _cross_matrix(
            records,
            row_dimension="date",
            col_dimension="line",
            include_costs=include_costs,
            include_margin=include_margin,
            row_limit=90,
            col_limit=20,
        ),
        "date_brand_matrix": _cross_matrix(
            records,
            row_dimension="date",
            col_dimension="brand",
            include_costs=include_costs,
            include_margin=include_margin,
            row_limit=90,
            col_limit=20,
        ),
        "date_branch_matrix": _cross_matrix(
            records,
            row_dimension="date",
            col_dimension="branch",
            include_costs=include_costs,
            include_margin=include_margin,
            row_limit=90,
            col_limit=20,
        ),
        "top_products": top_products[:250],
        "product_presence": product_presence[:300],
        "unmatched_count": unmatched,
    }


def _brand_series(records: list[SalesBICommercialRecord], bounds: tuple[date, date], top_n: int = 6) -> dict[str, Any]:
    """Serie temporal por marca (top N + OTRAS) para comparar evolución e
    impacto. Granularidad automática según el largo del rango."""
    span = (bounds[1] - bounds[0]).days + 1
    if span <= 45:
        granularity = "daily"
        keyf = lambda d: d.isoformat()  # noqa: E731
    elif span <= 200:
        granularity = "weekly"
        keyf = lambda d: (d - timedelta(days=d.weekday())).isoformat()  # noqa: E731
    else:
        granularity = "monthly"
        keyf = lambda d: f"{d.year:04d}-{d.month:02d}"  # noqa: E731

    totals: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    per_key: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    for r in records:
        name = str(r.marca or "Sin marca")
        k = keyf(r.fecha)
        _add_metric(totals[name], r)
        _add_metric(per_key[k][name], r)
        _add_metric(market[k], r)

    top = [
        n for n, _ in sorted(
            totals.items(), key=lambda t: float(t[1]["total_vendido"]), reverse=True
        )[:top_n]
    ]
    rows: list[dict[str, Any]] = []
    for k in sorted(market.keys()):
        mk = _finalize_metric(market[k], include_costs=False, include_margin=False)
        row: dict[str, Any] = {
            "key": k,
            "market_pvp": mk["total_vendido"],
            "market_unidades": mk["unidades"],
            "brands": {},
        }
        rest_pvp = float(mk["total_vendido"])
        rest_u = int(mk["unidades"])
        for n in top:
            b = _finalize_metric(per_key[k].get(n) or _metric_bucket(), include_costs=False, include_margin=False)
            row["brands"][n] = {"total_vendido": b["total_vendido"], "unidades": b["unidades"]}
            rest_pvp -= float(b["total_vendido"])
            rest_u -= int(b["unidades"])
        row["brands"]["OTRAS"] = {"total_vendido": round(max(0.0, rest_pvp), 2), "unidades": max(0, rest_u)}
        rows.append(row)
    return {"granularity": granularity, "top_brands": top, "rows": rows}


def build_brands_report(
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    *,
    empresa: str | None = None,
    sucursal: str | None = None,
    sucursales: list[str] | str | None = None,
    tipo_venta: str | None = None,
    marca: str | None = None,
    marcas: list[str] | str | None = None,
    tipo_producto: str | None = None,
    tipos: list[str] | str | None = None,
    include_costs: bool = False,
    include_margin: bool = False,
    presentation: bool = False,
) -> dict[str, Any]:
    records, bounds = _commercial_rows(
        fecha_desde, fecha_hasta,
        empresa=empresa, sucursal=sucursal, sucursales=sucursales,
        tipo_venta=tipo_venta, marca=marca, marcas=marcas,
        tipo_producto=tipo_producto, tipos=tipos,
    )
    report = _common_report(
        records,
        bounds,
        include_costs=include_costs,
        include_margin=include_margin,
        presentation=presentation,
        filters={
            "empresa": empresa or "",
            "sucursal": sucursal or "",
            "sucursales": _parse_csv_list(sucursales),
            "tipo_venta": tipo_venta or "",
            "marca": marca or "",
            "marcas": _parse_csv_list(marcas),
            "tipo_producto": tipo_producto or "",
            "tipos": _parse_csv_list(tipos),
        },
    )
    report["ranking"] = report["brand_mix"]
    report["compare_candidates"] = _brand_compare_candidates(report["brand_mix"])
    # Serie temporal por marca (top 6 + OTRAS): evolución comparada e impacto
    # (share en el tiempo). La consume la pestaña Marcas.
    report["brand_series"] = _brand_series(records, bounds)
    return report


def build_brands_compare(
    base_desde: str,
    base_hasta: str,
    compare_desde: str,
    compare_hasta: str,
    *,
    marcas: list[str] | str | None = None,
    include_costs: bool = False,
    include_margin: bool = False,
    presentation: bool = False,
) -> dict[str, Any]:
    base = build_brands_report(
        base_desde, base_hasta, marcas=marcas,
        include_costs=include_costs, include_margin=include_margin, presentation=presentation,
    )
    compare = build_brands_report(
        compare_desde, compare_hasta, marcas=marcas,
        include_costs=include_costs, include_margin=include_margin, presentation=presentation,
    )
    return {
        "base": base,
        "compare": compare,
        "delta": _delta_metric(base["totals"], compare["totals"]),
    }


def build_lines_report(
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    report = build_brands_report(fecha_desde, fecha_hasta, **kwargs)
    report["ranking"] = report["line_mix"]
    report["brands_by_line"] = _brands_by_line(fecha_desde, fecha_hasta, **kwargs)
    return report


def build_branches_report(
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    report = build_brands_report(fecha_desde, fecha_hasta, **kwargs)
    report["ranking"] = report["branch_mix"]
    if not kwargs.get("presentation"):
        report["opportunities"] = _branch_opportunities(fecha_desde, fecha_hasta, **kwargs)
        report["profiles"] = _branch_profiles(
            report["branch_mix"],
            report["line_mix"],
            report["branch_line_matrix"],
            report["branch_brand_matrix"],
        )
    else:
        report["opportunities"] = []
        report["profiles"] = []
    return report


def _delta_metric(base: dict[str, Any], compare: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("total_vendido", "unidades", "lineas", "productos", "pvp_promedio", "diferencia", "margen_porcentaje"):
        if key not in base and key not in compare:
            continue
        actual = float(base.get(key) or 0)
        prev = float(compare.get(key) or 0)
        delta = actual - prev
        out[key] = {
            "actual": round(actual, 2),
            "comparado": round(prev, 2),
            "delta": round(delta, 2),
            "delta_pct": round(delta / prev * 100, 2) if prev else None,
        }
    return out


def _brand_compare_candidates(brand_mix: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = sorted(brand_mix, key=lambda row: float(row.get("total_vendido") or 0), reverse=True)
    candidates = []
    for idx, item in enumerate(ranked[:12]):
        peer = ranked[idx + 1] if idx + 1 < len(ranked) else (ranked[idx - 1] if idx else None)
        if peer:
            candidates.append({
                "brand": item["name"],
                "suggested_compare": peer["name"],
                "reason": "Volumen cercano dentro del ranking del periodo.",
            })
    return candidates


def _brands_by_line(fecha_desde: str | None, fecha_hasta: str | None, **kwargs: Any) -> list[dict[str, Any]]:
    records, _bounds = _commercial_rows(
        fecha_desde, fecha_hasta,
        empresa=kwargs.get("empresa"),
        sucursal=kwargs.get("sucursal"),
        sucursales=kwargs.get("sucursales"),
        tipo_venta=kwargs.get("tipo_venta"),
        marca=kwargs.get("marca"),
        marcas=kwargs.get("marcas"),
        tipo_producto=kwargs.get("tipo_producto"),
        tipos=kwargs.get("tipos"),
    )
    include_costs = bool(kwargs.get("include_costs"))
    include_margin = bool(kwargs.get("include_margin"))
    line_brand: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    line_totals: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    for record in records:
        line = str(record.categoria or "OTROS")
        brand = str(record.marca or "Sin marca")
        _add_metric(line_brand[line][brand], record)
        _add_metric(line_totals[line], record)
    out = []
    for line, brands in line_brand.items():
        total = _finalize_metric(line_totals[line], include_costs=include_costs, include_margin=include_margin)["total_vendido"]
        out.append({
            "line": line,
            "leaders": _ranked(brands, include_costs=include_costs, include_margin=include_margin, total_reference=total, limit=5),
        })
    out.sort(key=lambda row: sum(float(i.get("total_vendido") or 0) for i in row["leaders"]), reverse=True)
    return out[:12]


def _branch_opportunities(fecha_desde: str | None, fecha_hasta: str | None, **kwargs: Any) -> list[dict[str, Any]]:
    records, _bounds = _commercial_rows(
        fecha_desde, fecha_hasta,
        empresa=kwargs.get("empresa"),
        tipo_venta=kwargs.get("tipo_venta"),
        marca=kwargs.get("marca"),
        marcas=kwargs.get("marcas"),
        tipo_producto=kwargs.get("tipo_producto"),
        tipos=kwargs.get("tipos"),
    )
    company_by_line: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    branch_by_line: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    branch_total: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    company_total = _metric_bucket()
    for record in records:
        line = str(record.categoria or "OTROS")
        branch = str(record.sucursal or "Sin sucursal")
        _add_metric(company_by_line[line], record)
        _add_metric(branch_by_line[branch][line], record)
        _add_metric(branch_total[branch], record)
        _add_metric(company_total, record)
    company_total_value = float(company_total["total_vendido"] or 0.0)
    out = []
    for branch, lines in branch_by_line.items():
        branch_value = float(branch_total[branch]["total_vendido"] or 0.0)
        if branch_value <= 0:
            continue
        for line, company_bucket in company_by_line.items():
            company_line_value = float(company_bucket["total_vendido"] or 0.0)
            branch_line_value = float(lines.get(line, {}).get("total_vendido") or 0.0)
            company_share = company_line_value / company_total_value * 100 if company_total_value else 0
            branch_share = branch_line_value / branch_value * 100 if branch_value else 0
            gap = company_share - branch_share
            if company_share >= 4 and gap >= 3:
                out.append({
                    "sucursal": branch,
                    "tipo_producto": line,
                    "participacion_sucursal": round(branch_share, 2),
                    "participacion_empresa": round(company_share, 2),
                    "gap_pct": round(gap, 2),
                    "reason": "La linea pesa menos en esta sucursal que en el consolidado.",
                })
    out.sort(key=lambda row: row["gap_pct"], reverse=True)
    return out[:12]


def _branch_profiles(
    branch_mix: list[dict[str, Any]],
    line_mix: list[dict[str, Any]],
    branch_line_matrix: list[dict[str, Any]],
    branch_brand_matrix: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    company_line_share = {str(row.get("name") or ""): float(row.get("participacion_pct") or 0.0) for row in line_mix}
    avg_pvp = sum(float(row.get("pvp_promedio") or 0.0) for row in branch_mix) / max(1, len(branch_mix))
    avg_products = sum(float(row.get("productos") or 0.0) for row in branch_mix) / max(1, len(branch_mix))
    lines_by_branch = {str(row.get("name") or ""): row for row in branch_line_matrix}
    brands_by_branch = {str(row.get("name") or ""): row for row in branch_brand_matrix}
    profiles = []
    for branch in branch_mix:
        branch_name = str(branch.get("name") or "")
        avg = float(branch.get("pvp_promedio") or 0)
        if avg >= avg_pvp * 1.15:
            pvp_profile = "ALTO"
            profile = "PVP promedio alto"
        elif avg <= avg_pvp * 0.85:
            pvp_profile = "BAJO"
            profile = "PVP promedio bajo / rotacion"
        else:
            pvp_profile = "MEDIO"
            profile = "PVP promedio medio"

        products = float(branch.get("productos") or 0.0)
        if products >= avg_products * 1.15:
            variety = "ALTA"
        elif products <= avg_products * 0.85:
            variety = "BAJA"
        else:
            variety = "MEDIA"

        line_items = list((lines_by_branch.get(branch_name) or {}).get("items") or [])
        brand_items = list((brands_by_branch.get(branch_name) or {}).get("items") or [])
        top_line = str(line_items[0].get("name") or "") if line_items else ""
        top_brand = str(brand_items[0].get("name") or "") if brand_items else ""
        fortalezas: list[str] = []
        debilidades: list[str] = []
        for item in line_items:
            line_name = str(item.get("name") or "")
            branch_share = float(item.get("participacion_pct") or 0.0)
            network_share = company_line_share.get(line_name, 0.0)
            if branch_share >= network_share + 5:
                fortalezas.append(line_name)
            elif network_share >= 4 and branch_share <= network_share - 4:
                debilidades.append(line_name)
        if not fortalezas and top_line:
            fortalezas.append(top_line)

        notes = []
        if pvp_profile == "ALTO":
            notes.append("Sucursal de PVP promedio alto")
        elif pvp_profile == "BAJO":
            notes.append("Sucursal de rotacion y PVP promedio mas bajo")
        else:
            notes.append("Sucursal de PVP promedio medio")
        if variety == "ALTA":
            notes.append("Mayor variedad relativa de SKUs")
        elif variety == "BAJA":
            notes.append("Surtido mas concentrado")
        if top_line:
            notes.append(f"Fuerte en {top_line}")
        if top_brand:
            notes.append(f"Marca principal: {top_brand}")

        profiles.append({
            "sucursal": branch_name,
            "profile": profile,
            "pvp_promedio": avg,
            "pvp_profile": pvp_profile,
            "variety": variety,
            "fortalezas": fortalezas[:3],
            "debilidades": debilidades[:3],
            "top_line": top_line,
            "top_brand": top_brand,
            "profile_notes": notes,
        })
    return profiles


def get_commercial_options() -> dict[str, Any]:
    with db_session() as session:
        rows = session.execute(
            select(
                func.min(SalesBICommercialRecord.fecha),
                func.max(SalesBICommercialRecord.fecha),
            )
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(SalesBICommercialBatch.status == "activo")
        ).one()
        marcas = session.scalars(
            select(SalesBICommercialRecord.marca)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(SalesBICommercialBatch.status == "activo", SalesBICommercialRecord.marca != "")
            .distinct()
            .order_by(SalesBICommercialRecord.marca)
        ).all()
        tipos = session.scalars(
            select(SalesBICommercialRecord.tipo_producto)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(SalesBICommercialBatch.status == "activo", SalesBICommercialRecord.tipo_producto != "")
            .distinct()
            .order_by(SalesBICommercialRecord.tipo_producto)
        ).all()
        # Categorias (5 buckets + OTROS) — orden fijo para que el dropdown
        # siempre las muestre igual. Solo incluimos las que tienen datos.
        present_categorias = set(session.scalars(
            select(SalesBICommercialRecord.categoria)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(SalesBICommercialBatch.status == "activo", SalesBICommercialRecord.categoria != "")
            .distinct()
        ).all())
        _CAT_ORDER = ["LINEA BLANCA", "COCINA", "CLIMATIZACION", "TV / AUDIO", "PEQUENOS", "OTROS"]
        categorias = [c for c in _CAT_ORDER if c in present_categorias]
        sucursales = session.scalars(
            select(SalesBICommercialRecord.sucursal)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(SalesBICommercialBatch.status == "activo", SalesBICommercialRecord.sucursal != "")
            .distinct()
            .order_by(SalesBICommercialRecord.sucursal)
        ).all()
        empresas = session.scalars(select(Company).order_by(Company.name)).all()
    return {
        "period_start": _fmt_date(rows[0]),
        "period_end": _fmt_date(rows[1]),
        "marcas": [str(v) for v in marcas],
        "tipos": [str(v) for v in tipos],
        # `categorias` = 5 buckets + OTROS, en el orden canonico. Es lo que
        # el dropdown "Linea" del dashboard usa por default.
        "categorias": categorias,
        "sucursales": [str(v) for v in sucursales],
        "empresas": [{"id": str(e.id), "name": str(e.name or e.id)} for e in empresas],
        "tipo_ventas": ["local", "online"],
    }


def _group_commercial_unmatched(records: list[SalesBICommercialRecord], *, limit: int) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        key = (str(record.sku_normalized or ""), str(record.descripcion_normalized or ""))
        item = grouped.setdefault(key, {
            "sku": str(record.sku or ""),
            "sku_normalized": str(record.sku_normalized or ""),
            "descripcion": str(record.descripcion or ""),
            "descripcion_normalized": str(record.descripcion_normalized or ""),
            "marca": str(record.marca or ""),
            "tipo_producto": str(record.tipo_producto or ""),
            "lineas": 0,
            "unidades": 0,
            "total_vendido": 0.0,
            "sucursales": set(),
        })
        item["lineas"] += 1
        item["unidades"] += int(record.cantidad or 0)
        item["total_vendido"] += _num(record.pvp) * int(record.cantidad or 0)
        item["sucursales"].add(str(record.sucursal or ""))
    out = []
    for item in grouped.values():
        item["sucursales"] = sorted(s for s in item["sucursales"] if s)
        item["total_vendido"] = round(item["total_vendido"], 2)
        out.append(item)
    out.sort(key=lambda row: float(row["total_vendido"] or 0), reverse=True)
    return out[:limit]


def list_commercial_unmatched(q: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    filters: list[Any] = [SalesBICommercialBatch.status == "activo", SalesBICommercialRecord.match_status == "unmatched"]
    if q:
        text = f"%{q}%"
        filters.append(or_(
            SalesBICommercialRecord.sku.ilike(text),
            SalesBICommercialRecord.descripcion.ilike(text),
            SalesBICommercialRecord.marca.ilike(text),
            SalesBICommercialRecord.tipo_producto.ilike(text),
        ))
    with db_session() as session:
        rows = session.scalars(
            select(SalesBICommercialRecord)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(*filters)
            .order_by(SalesBICommercialRecord.fecha.desc(), SalesBICommercialRecord.id.desc())
            .limit(max(1, min(limit * 10, 5000)))
        ).all()
    return _group_commercial_unmatched(list(rows), limit=limit)


def _list_all_commercial_unmatched(limit: int) -> list[dict[str, Any]]:
    """Devuelve grupos pendientes sin depender del limite visual de la pantalla."""
    with db_session() as session:
        rows = session.scalars(
            select(SalesBICommercialRecord)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(
                SalesBICommercialBatch.status == "activo",
                SalesBICommercialRecord.match_status == "unmatched",
            )
            .order_by(SalesBICommercialRecord.fecha.desc(), SalesBICommercialRecord.id.desc())
        ).all()
    return _group_commercial_unmatched(list(rows), limit=limit)


def create_commercial_correction(payload: dict[str, Any], username: str) -> dict[str, Any]:
    sku_raw = str(payload.get("match_sku") or payload.get("sku") or "").strip()
    desc_raw = str(payload.get("match_description") or payload.get("descripcion") or "").strip()
    brand_raw = str(payload.get("match_brand") or payload.get("marca") or "").strip()
    type_raw = str(payload.get("match_type") or payload.get("tipo_producto") or "").strip()
    if not any((sku_raw, desc_raw, brand_raw, type_raw)):
        raise ValueError("La correccion necesita al menos un criterio de match.")
    with db_session() as session:
        product = None
        product_id = payload.get("product_id") or None
        if product_id:
            product = session.get(Product, int(product_id))
            if product is None:
                raise ValueError("Producto de catalogo no encontrado.")

        corrected_sku = str(payload.get("corrected_sku") or "").strip()
        corrected_description = str(payload.get("corrected_description") or "").strip()
        corrected_brand = str(payload.get("corrected_brand") or "").strip()
        corrected_type = str(payload.get("corrected_type") or "").strip()
        if product is not None:
            corrected_sku = corrected_sku or str(product.sku or "").strip()
            corrected_description = corrected_description or str(product.descripcion or "").strip()
            corrected_brand = corrected_brand or str(product.marca or "").strip()
            corrected_type = corrected_type or str(product.tipo or "").strip()

        if not any((corrected_sku, corrected_description, corrected_brand, corrected_type, product_id)):
            raise ValueError("La correccion necesita un producto o al menos un dato corregido.")

        correction = SalesBICommercialCorrection(
            match_sku_norm=_normalize_sku(sku_raw),
            match_desc_norm=normalize_descripcion(desc_raw),
            match_brand_norm=_norm(brand_raw),
            match_type_norm=_norm(type_raw),
            corrected_sku=corrected_sku,
            corrected_description=corrected_description,
            corrected_brand=corrected_brand,
            corrected_type=corrected_type,
            product_id=product_id,
            note=str(payload.get("note") or "").strip(),
            created_by_user_id=_user_id_from_username(session, username),
        )
        session.add(correction)
        session.flush()
        out = {
            "id": int(correction.id),
            "match_sku_norm": correction.match_sku_norm,
            "match_desc_norm": correction.match_desc_norm,
            "match_brand_norm": correction.match_brand_norm,
            "match_type_norm": correction.match_type_norm,
            "corrected_sku": correction.corrected_sku,
            "corrected_description": correction.corrected_description,
            "corrected_brand": correction.corrected_brand,
            "corrected_type": correction.corrected_type,
            "product_id": int(correction.product_id) if correction.product_id else None,
            "created_at": _fmt_dt(correction.created_at),
        }
        session.commit()
    return out


def auto_resolve_commercial_suggestions(username: str, *, limit: int = 10000) -> dict[str, Any]:
    """Crea correcciones desde el primer sugerido del catalogo.

    Se usa para limpiar rapido pendientes de Ventas Vs. Costos cuando el
    buscador ya devuelve sugeridos confiables. Los pendientes sin sugerido
    quedan intactos para resolucion manual.
    """
    pending = _list_all_commercial_unmatched(limit=max(1, min(int(limit or 10000), 10000)))
    resolved = 0
    skipped = 0
    errors: list[dict[str, str]] = []
    examples: list[dict[str, Any]] = []

    for item in pending:
        query = " ".join(
            part for part in (
                str(item.get("descripcion") or "").strip(),
                "" if _looks_missing_sku(item.get("sku")) else str(item.get("sku") or "").strip(),
            )
            if part
        ).strip()
        if not query:
            skipped += 1
            continue

        suggestions = search_products(query, limit=1)
        if not suggestions:
            skipped += 1
            continue

        product = suggestions[0]
        try:
            create_commercial_correction(
                {
                    "match_sku": item.get("sku") or "",
                    "match_description": item.get("descripcion") or "",
                    "match_brand": item.get("marca") or "",
                    "match_type": item.get("tipo_producto") or "",
                    "product_id": product.get("id"),
                    "corrected_sku": product.get("sku") or "",
                    "corrected_description": product.get("descripcion") or product.get("producto") or "",
                    "corrected_brand": product.get("marca") or "",
                    "corrected_type": product.get("tipo") or "",
                    "note": "Auto-resuelto con primer sugerido de catalogo.",
                },
                username,
            )
            resolved += 1
            if len(examples) < 10:
                examples.append({
                    "from": item.get("descripcion") or item.get("sku") or "",
                    "to": product.get("descripcion") or product.get("producto") or product.get("sku") or "",
                    "sku": product.get("sku") or "",
                })
        except Exception as exc:  # noqa: BLE001 - devuelve el item conflictivo sin abortar todo el lote
            skipped += 1
            if len(errors) < 10:
                errors.append({
                    "item": str(item.get("descripcion") or item.get("sku") or ""),
                    "error": str(exc),
                })

    rematch = rematch_commercial_records() if resolved else {"ok": True, "matched": 0, "corrected": 0, "unmatched": len(pending), "total": 0}
    return {
        "ok": True,
        "processed": len(pending),
        "resolved": resolved,
        "skipped": skipped,
        "errors": errors,
        "examples": examples,
        "rematch": rematch,
    }


def rematch_commercial_records() -> dict[str, Any]:
    with db_session() as session:
        indexes, corrections = _load_match_context(session)
        products = session.scalars(select(Product).where(Product.is_active.is_(True))).all()
        indexes["by_id"] = {int(p.id): p for p in products}
        records = session.scalars(
            select(SalesBICommercialRecord)
            .join(SalesBICommercialBatch, SalesBICommercialBatch.id == SalesBICommercialRecord.batch_id)
            .where(SalesBICommercialBatch.status == "activo")
        ).all()
        counts = {"matched": 0, "corrected": 0, "unmatched": 0}
        for record in records:
            rec = {
                "sku_raw": record.sku_raw,
                "descripcion_raw": record.descripcion_raw,
                "marca_raw": record.marca_raw,
                "tipo_raw": record.tipo_raw,
            }
            rec = _apply_commercial_match(rec, indexes, corrections)
            record.sku = rec["sku"]
            record.descripcion = rec["descripcion"]
            record.marca = rec["marca"]
            record.tipo_producto = rec["tipo_producto"]
            record.categoria = rec.get("categoria") or "OTROS"
            record.sku_normalized = rec["sku_normalized"]
            record.descripcion_normalized = rec["descripcion_normalized"]
            record.product_id = rec["product_id"]
            record.correction_id = rec["correction_id"]
            record.match_status = rec["match_status"]
            counts[record.match_status] = counts.get(record.match_status, 0) + 1
        session.commit()
        return {"ok": True, **counts, "total": len(records)}


def backfill_categoria(*, dry_run: bool = False) -> dict[str, int]:
    """Aplica `_classify` sobre `tipo_producto` y rellena `categoria` en cada
    SalesBICommercialRecord. Pensada para correr una sola vez después de
    aplicar la migración 20260609_0001.

    Args:
        dry_run: si True solo cuenta cuántos cambiarían sin tocar la DB.

    Returns:
        {scanned, updated, <categoria>: N, ...}
    """
    from .sales_bi import _classify as _classify_categoria

    counts: dict[str, int] = {"scanned": 0, "updated": 0}
    with db_session() as session:
        for record in session.scalars(select(SalesBICommercialRecord)).all():
            counts["scanned"] += 1
            new_cat, _ = _classify_categoria(str(record.tipo_producto or ""))
            new_cat = new_cat or "OTROS"
            if str(record.categoria or "") == new_cat:
                continue
            counts["updated"] += 1
            counts[new_cat] = counts.get(new_cat, 0) + 1
            if not dry_run:
                record.categoria = new_cat
        if not dry_run:
            session.commit()
    return counts
