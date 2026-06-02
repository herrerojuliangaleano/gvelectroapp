"""Sub-router de contadores y exportaciones ENV.

Endpoints:
  GET  /counters
  POST /counters/resync
  GET  /export/provider-suggestions
  GET  /export/eligible
  POST /export/batch
  POST /export/provider
  GET  /exports
  GET  /exports/{export_id}/download
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from ...audit import audit
from ...auth import require_permission
from ...warranties_db import (
    pg_add_history,
    pg_collect_export_rows_by_codes,
    pg_create_export,
    pg_fetch_guarantee_rows_by_codes,
    pg_get_export,
    pg_list_counters,
    pg_list_exports,
    pg_next_shipment_code,
    pg_provider_suggestions,
    pg_resync_counters,
    pg_update_guarantee_fields,
)
from ...warranty_helpers import (
    REVIEW_APPROVED,
    REVIEW_PENDING,
    normalize_text,
    now_ar,
)
from . import (
    EXPORT_ELIGIBLE_STATUS,
    EXPORT_READY_STATUS,
    WarrantyBatchExportRequest,
    WarrantyCounterInfo,
    WarrantyCountersResponse,
    WarrantyExportInfo,
    WarrantyExportListResponse,
    WarrantyExportRequest,
    WarrantyListResponse,
    build_provider_excel,
    build_provider_pdf,
    collect_export_rows,
    deny_plain_deposit_operator,
    export_info_from_row,
    list_warranties,
    normalize_export_format,
    normalize_export_logo,
    review_status_matches,
    safe_filename_part,
    status_matches,
    warranty_exports_dir,
)


router = APIRouter(tags=["warranties"])


def _normalize_warranty_code_list(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for raw in values:
        code = str(raw or "").strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        output.append(code)
    return output


def _export_validation_error(row: dict[str, Any] | None, code: str) -> str:
    if row is None:
        return f"{code}: no existe."
    if int(row["cancelled"] or 0):
        return f"{code}: esta anulada/cancelada."
    if not status_matches(str(row["status"] or ""), EXPORT_ELIGIBLE_STATUS):
        return f"{code}: debe estar en {EXPORT_ELIGIBLE_STATUS}."
    if not review_status_matches(str(row["review_status"] or REVIEW_PENDING), REVIEW_APPROVED):
        return f"{code}: debe estar revisada por deposito."
    if str(row["shipment_code"] or "").strip():
        return f"{code}: ya pertenece al lote {row['shipment_code']}."
    return ""


def validate_export_selection(warranty_codes: list[str]) -> list[str]:
    codes = _normalize_warranty_code_list(warranty_codes)
    if not codes:
        raise HTTPException(status_code=400, detail="Selecciona al menos una garantia para crear el lote ENV.")
    by_code = pg_fetch_guarantee_rows_by_codes(codes)
    errors: list[str] = []
    for code in codes:
        msg = _export_validation_error(by_code.get(code), code)
        if msg:
            errors.append(msg)
    if errors:
        preview = " | ".join(errors[:8])
        extra = "" if len(errors) <= 8 else f" | +{len(errors) - 8} mas"
        raise HTTPException(status_code=400, detail=f"No se puede crear el ENV: {preview}{extra}")
    return codes


def export_ready_warranty_codes(warranty_codes: list[str]) -> set[str]:
    codes = _normalize_warranty_code_list(warranty_codes)
    if not codes:
        return set()
    rows = pg_fetch_guarantee_rows_by_codes(codes).values()
    ready: set[str] = set()
    for row in rows:
        code = str(row["warranty_code"] or "").strip().upper()
        if not _export_validation_error(row, code):
            ready.add(code)
    return ready


@router.get("/counters", response_model=WarrantyCountersResponse)
def get_warranty_counters(_user: Annotated[Any, Depends(require_permission("warranties.manage"))]):
    rows = pg_list_counters()
    return WarrantyCountersResponse(
        counters=[
            WarrantyCounterInfo(
                year=int(row["year"]),
                sucursal=str(row["sucursal_code"]),
                last_number=int(row["last_number"]),
            )
            for row in rows
        ]
    )


@router.post("/counters/resync", response_model=WarrantyCountersResponse)
def resync_warranty_counters(user: Annotated[Any, Depends(require_permission("warranties.manage"))]):
    rows = pg_resync_counters()
    counters = {
        (int(row["year"]), str(row["sucursal_code"])): int(row["last_number"])
        for row in rows
    }
    audit(
        "warranties.counters.resync",
        user=user,
        resource_type="warranty_counter",
        details={
            "counters": {
                f"{year}-{code}": last
                for (year, code), last in counters.items()
            },
            "source": "database",
        },
    )
    return get_warranty_counters(user)


@router.get("/export/provider-suggestions")
def export_provider_suggestions(
    _user: Annotated[Any, Depends(require_permission("warranties.export"))],
    q: str = "",
    limit: int = Query(default=25, ge=1, le=100),
):
    deny_plain_deposit_operator(_user, "ver proveedores para exportacion")
    needle = normalize_text(q)
    suggestions: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        text = str(value or "").strip()
        if not text:
            return
        key = normalize_text(text)
        if not key or key in seen:
            return
        if needle and needle not in key:
            return
        seen.add(key)
        suggestions.append(text)

    data = pg_provider_suggestions(limit=200)
    for value in [*data.get("providers", []), *data.get("brands", [])]:
        add(value)
    return {"items": suggestions[:limit]}


@router.get("/export/eligible", response_model=WarrantyListResponse)
def export_eligible_warranties(
    _user: Annotated[Any, Depends(require_permission("warranties.export"))],
    q: str = "",
    marca: str = "",
    proveedor: str = "",
    sucursal: str = "",
    deposito: str = "",
    limit: int = Query(default=500, ge=1, le=1000),
):
    result = list_warranties(
        _user,
        q=q,
        marca=marca,
        proveedor=proveedor,
        sucursal=sucursal,
        deposito=deposito,
        estado=EXPORT_ELIGIBLE_STATUS,
        review_status=REVIEW_APPROVED,
        demora_min=0,
        limit=limit,
    )
    ready_codes = export_ready_warranty_codes([i.id_garantia for i in result.items])
    elegibles = [i for i in result.items if i.id_garantia.strip().upper() in ready_codes]
    return WarrantyListResponse(items=elegibles, total=len(elegibles), limit=result.limit)


@router.post("/export/batch", response_model=WarrantyExportInfo)
def export_warranty_batch(
    data: WarrantyBatchExportRequest,
    user: Annotated[Any, Depends(require_permission("warranties.export"))],
):
    deny_plain_deposit_operator(user, "exportar ENV")
    proveedor = (data.proveedor or "").strip()
    nota = (data.nota or "").strip()
    formato = normalize_export_format(data.formato)
    logo_brand = normalize_export_logo(data.logo_brand)
    warranty_codes = validate_export_selection(list(data.warranty_ids))
    shipment_code = pg_next_shipment_code()
    rows = pg_collect_export_rows_by_codes(warranty_codes)
    if not rows:
        raise HTTPException(status_code=400, detail="No se encontraron garantias para los IDs indicados.")
    stamp = now_ar().strftime("%Y%m%d-%H%M%S")
    provider_part = safe_filename_part(proveedor or "lote")
    extension = "pdf" if formato == "pdf" else "xlsx"
    file_name = f"garantias-{provider_part}-{shipment_code}-{stamp}.{extension}"
    file_path = warranty_exports_dir() / file_name
    if formato == "pdf":
        build_provider_pdf(rows, file_path, provider_name=proveedor, shipment_code=shipment_code, logo_brand=logo_brand)
    else:
        build_provider_excel(rows, file_path, provider_name=proveedor, shipment_code=shipment_code, logo_brand=logo_brand)
    export_row = pg_create_export(
        user=user,
        provider_name=proveedor,
        marca="",
        filters={"warranty_ids": list(data.warranty_ids), "proveedor": proveedor},
        file_path=str(file_path),
        file_name=file_name,
        row_count=len(rows),
        shipment_code=shipment_code,
        warranty_ids=list(data.warranty_ids),
        file_format=formato,
        logo_brand=logo_brand,
    )
    export_id = int(export_row["id"])
    touched: set[int] = set()
    for row in rows:
        gid = int(row.get("guarantee_id") or 0)
        if not gid or gid in touched:
            continue
        touched.add(gid)
        current_status = str(row.get("status") or "")
        new_status = EXPORT_READY_STATUS
        updates: dict[str, Any] = {
            "status": new_status,
            "shipment_code": shipment_code,
            "shipment_file_name": file_name,
            "synced_to_google_sheet": False,
        }
        if proveedor:
            updates["provider_name"] = proveedor
        pg_update_guarantee_fields(
            guarantee_id=gid,
            user=user,
            updates=updates,
            action="batch_exported",
            old_status=current_status,
            new_status=new_status,
            note=nota or f"Excel generado para lote {shipment_code}. Pendiente de confirmacion de envio.",
            details={
                "export_id": export_id,
                "shipment_code": shipment_code,
                "file_name": file_name,
                "file_format": formato,
                "logo_brand": logo_brand,
            },
        )
    audit(
        "warranties.export.batch",
        user=user,
        resource_type="warranty_export",
        resource_id=str(export_id),
        details={
            "row_count": len(rows),
            "shipment_code": shipment_code,
            "file_name": file_name,
            "file_format": formato,
            "logo_brand": logo_brand,
            "warranty_ids": warranty_codes,
        },
    )
    return export_info_from_row(export_row)


@router.post("/export/provider", response_model=WarrantyExportInfo)
def export_warranties_for_provider(
    data: WarrantyExportRequest,
    user: Annotated[Any, Depends(require_permission("warranties.export"))],
):
    deny_plain_deposit_operator(user, "exportar garantias al proveedor")
    filters = data.model_dump()
    provider_part = safe_filename_part(data.proveedor or data.marca or "proveedor")
    stamp = now_ar().strftime("%Y%m%d-%H%M%S")
    file_name = f"garantias-{provider_part}-{stamp}-{uuid4().hex[:6]}.xlsx"
    file_path = warranty_exports_dir() / file_name
    rows = collect_export_rows(data)
    build_provider_excel(rows, file_path, provider_name=(data.proveedor or "").strip(), logo_brand="gv_electro")
    export_row = pg_create_export(
        user=user,
        provider_name=(data.proveedor or "").strip(),
        marca=(data.marca or "").strip(),
        filters=filters,
        file_path=str(file_path),
        file_name=file_name,
        row_count=len(rows),
        file_format="excel",
        logo_brand="gv_electro",
    )
    export_id = int(export_row["id"])
    touched: set[int] = set()
    for row in rows:
        gid = int(row.get("guarantee_id") or 0)
        if not gid or gid in touched:
            continue
        touched.add(gid)
        pg_add_history(
            guarantee_id=gid,
            warranty_code=str(row.get("warranty_code") or ""),
            user=user,
            action="excel_exported",
            note="Excel para proveedor generado",
            details={"export_id": export_id, "filters": filters, "file_name": file_name},
        )
    audit(
        "warranties.export",
        user=user,
        resource_type="warranty_export",
        resource_id=str(export_id),
        details={"row_count": len(rows), "filters": filters, "file_name": file_name},
    )
    return export_info_from_row(export_row)


@router.get("/exports", response_model=WarrantyExportListResponse)
def list_warranty_exports(
    _user: Annotated[Any, Depends(require_permission("warranties.export"))],
    limit: int = Query(default=50, ge=1, le=200),
):
    deny_plain_deposit_operator(_user, "ver exportaciones ENV")
    rows = pg_list_exports(limit)
    return WarrantyExportListResponse(items=[export_info_from_row(row) for row in rows])


@router.get("/exports/{export_id}/download")
def download_warranty_export(
    export_id: int,
    _user: Annotated[Any, Depends(require_permission("warranties.export"))],
):
    deny_plain_deposit_operator(_user, "descargar exportaciones ENV")
    row = pg_get_export(export_id)
    if not row:
        raise HTTPException(status_code=404, detail="Exportacion no encontrada")
    file_path = Path(str(row["file_path"] or ""))
    exports_dir = warranty_exports_dir().resolve()
    try:
        resolved = file_path.resolve()
    except Exception:
        raise HTTPException(status_code=404, detail="Archivo de exportacion no disponible")
    if not str(resolved).startswith(str(exports_dir)) or not resolved.exists():
        raise HTTPException(status_code=404, detail="Archivo de exportacion no disponible")
    suffix = resolved.suffix.lower()
    media_type = "application/pdf" if suffix == ".pdf" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(
        path=resolved,
        filename=str(row["file_name"] or resolved.name),
        media_type=media_type,
    )
