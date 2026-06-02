"""Sub-router · Sincronización con Google Sheets.

Endpoints:
  GET  /sync/status                — total/pending/last_log
  GET  /sync/logs                  — historial de syncs
  POST /sync/setup-sheet           — crea/verifica pestañas espejo
  POST /sync/push-to-sheet         — exporta a Sheets (reporting; no escribe en PG)
  POST /import/historical-upload   — importa .xlsx histórico una sola vez

Decisión Fase 2.5h.2e: /sync/pull-from-sheet eliminado. Postgres es la fuente
única; Sheets queda solo como exportación de reportes.

Fase 2.5h.2f: agregado /import/historical-upload para traer datos del sistema
viejo (1 sola vez, upload directo de Excel). No reactiva el pull-from-sheet:
es un import explícito con archivo concreto, no un sync recurrente.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ...audit import audit
from ...auth import require_permission
from ...google_sheets import sheets_service
from ...warranties_db import (
    pg_insert_sync_log,
    pg_list_sync_logs,
    pg_mark_all_synced,
    pg_sync_status,
)
from ...warranty_helpers import format_datetime_ar, now_ar, parse_iso_datetime, utc_now_iso
from ...warranty_import import import_from_xlsx

# Modelos Pydantic + helpers compartidos viven en __init__.py.
from . import (
    DEFAULT_RAW_HEADERS,
    MIRROR_SHEETS,
    WarrantySyncLogsResponse,
    WarrantySyncResult,
    WarrantySyncStatus,
    ensure_mirror_sheets,
    mirror_rows_for_sheet,
    require_spreadsheet_id,
    sheet_raw_name,
    sync_log_info,
    warranty_rows_for_sheet,
    write_sheet_values,
)


router = APIRouter(tags=["warranties"])


@router.get("/sync/status", response_model=WarrantySyncStatus)
def warranty_sync_status(_user: Annotated[Any, Depends(require_permission("warranties.sync_logs"))]):
    info = pg_sync_status()
    last = info.get("last") or {}
    last_finished = parse_iso_datetime(last.get("finished_at") or last.get("started_at")) if last else None
    return WarrantySyncStatus(
        last_sync_at=format_datetime_ar(last_finished) if last_finished else "",
        last_sync_type=str(last.get("sync_type") or "") if last else "",
        last_sync_status=str(last.get("status") or "") if last else "",
        last_sync_user=str(last.get("actor_name") or last.get("actor_username") or "") if last else "",
        pending_to_sheet=int(info.get("pending") or 0),
        total_guarantees=int(info.get("total") or 0),
        errors=list(info.get("errors") or [])[:10],
    )


@router.get("/sync/logs", response_model=WarrantySyncLogsResponse)
def warranty_sync_logs(_user: Annotated[Any, Depends(require_permission("warranties.sync_logs"))], limit: int = Query(default=30, ge=1, le=200)):
    rows = pg_list_sync_logs(limit=limit)
    return WarrantySyncLogsResponse(items=[sync_log_info(row) for row in rows])


@router.post("/sync/setup-sheet")
def setup_warranty_sheet(user: Annotated[Any, Depends(require_permission("warranties.sync_to_sheet"))]):
    """Crea/verifica las pestañas espejo en la planilla de Google.

    Mantiene 00_RAW_GARANTIAS por compat + pestañas normalizadas para
    garantías, remitos, lotes ENV y eventos.
    """
    spreadsheet_id = require_spreadsheet_id()
    created = ensure_mirror_sheets()
    created_names = [name for name, was_created in created.items() if was_created]
    audit("warranties.sheet.setup", user=user, resource_type="warranty", details={"spreadsheet_id": spreadsheet_id, "sheets": list(created.keys()), "created": created_names})
    return {
        "ok": True,
        "spreadsheet_id": spreadsheet_id,
        "sheet": sheet_raw_name(),
        "tab_created": bool(created_names),
        "headers_count": sum(len(DEFAULT_RAW_HEADERS) if name == sheet_raw_name() else len(MIRROR_SHEETS.get(name, [])) for name in created.keys()),
        "message": f"Planilla espejo verificada. Pestañas listas: {', '.join(created.keys())}." + (f" Creadas: {', '.join(created_names)}." if created_names else ""),
    }


@router.post("/sync/push-to-sheet", response_model=WarrantySyncResult)
def push_warranties_to_sheet(user: Annotated[Any, Depends(require_permission("warranties.sync_to_sheet"))]):
    """Exporta el estado actual de garantías/remitos/lotes a Google Sheets."""
    started = utc_now_iso()
    errors: list[str] = []
    rows_processed = rows_updated = rows_skipped = 0
    sheet_counts: dict[str, int] = {}
    rows_updated_count = 0
    try:
        service = sheets_service()
        spreadsheet_id = require_spreadsheet_id()
        ensure_mirror_sheets()
        raw_values, _row_ranges = warranty_rows_for_sheet()
        write_sheet_values(service, spreadsheet_id, sheet_raw_name(), DEFAULT_RAW_HEADERS, raw_values)
        rows_processed += len(raw_values)
        sheet_counts[sheet_raw_name()] = len(raw_values)
        for sheet_name, headers in MIRROR_SHEETS.items():
            values = mirror_rows_for_sheet(sheet_name)
            write_sheet_values(service, spreadsheet_id, sheet_name, headers, values)
            rows_processed += len(values)
            sheet_counts[sheet_name] = len(values)

        # Marca masiva de sincronización en Postgres (fuente real).
        rows_updated_count = pg_mark_all_synced()
        finished = utc_now_iso()
        status_value = "success" if not errors else "partial"
        pg_insert_sync_log(
            sync_type="push_to_sheet",
            status_value=status_value,
            started_at=started,
            finished_at=finished,
            user=user,
            rows_processed=rows_processed,
            rows_created=0,
            rows_updated=rows_updated_count,
            rows_skipped=rows_skipped,
            errors=errors,
        )
        audit("warranties.sync.push", user=user, resource_type="warranty", details={"rows_processed": rows_processed, "sheets": sheet_counts})
        info = [f"{name}: {count} filas" for name, count in sheet_counts.items()]
        return WarrantySyncResult(ok=not errors, sync_type="push_to_sheet", status=status_value, started_at=format_datetime_ar(parse_iso_datetime(started) or now_ar()), finished_at=format_datetime_ar(parse_iso_datetime(finished) or now_ar()), rows_processed=rows_processed, rows_created=0, rows_updated=rows_updated_count, rows_skipped=rows_skipped, errors=errors + info)
    except Exception as exc:
        errors.append(str(exc))
        finished = utc_now_iso()
        pg_insert_sync_log(
            sync_type="push_to_sheet",
            status_value="failed",
            started_at=started,
            finished_at=finished,
            user=user,
            rows_processed=rows_processed,
            rows_created=0,
            rows_updated=rows_updated,
            rows_skipped=rows_skipped,
            errors=errors,
        )
        audit("warranties.sync.push.failed", user=user, resource_type="warranty", details={"errors": errors})
        return WarrantySyncResult(ok=False, sync_type="push_to_sheet", status="failed", started_at=format_datetime_ar(parse_iso_datetime(started) or now_ar()), finished_at=format_datetime_ar(parse_iso_datetime(finished) or now_ar()), rows_processed=rows_processed, rows_created=0, rows_updated=rows_updated, rows_skipped=rows_skipped, errors=errors)


@router.post("/import/historical-upload")
def import_historical_upload(
    user: Annotated[Any, Depends(require_permission("warranties.sync_from_sheet"))],
    file: UploadFile = File(...),
):
    """Importa garantías históricas desde un .xlsx subido por el usuario.

    Pestañas leídas: GARANTIAS, GARANTIA_ITEMS, REMITOS, REMITO_ITEMS, EVENTOS,
    LOTES_ENV. Idempotente: si un warranty_code/remito_code ya existe, lo skipea
    en lugar de pisarlo.

    Pensado para una migración inicial desde el sistema viejo. No reemplaza al
    flujo normal de carga (UI o push_to_sheet).
    """
    name = (file.filename or "").lower()
    if not name.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .xlsx")
    contents = file.file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    stats = import_from_xlsx(contents, user)

    started = utc_now_iso()
    finished = utc_now_iso()
    status_value = "success" if stats.get("ok") and not stats.get("errors") else ("partial" if stats.get("ok") else "failed")
    pg_insert_sync_log(
        sync_type="import_historical_upload",
        status_value=status_value,
        started_at=started,
        finished_at=finished,
        user=user,
        rows_processed=stats.get("warranties_created", 0) + stats.get("warranties_skipped_existing", 0),
        rows_created=stats.get("warranties_created", 0),
        rows_updated=0,
        rows_skipped=stats.get("warranties_skipped_existing", 0),
        errors=list(stats.get("errors") or []),
    )
    audit(
        "warranties.import.historical",
        user=user,
        resource_type="warranty",
        details={"filename": file.filename, "stats": {k: v for k, v in stats.items() if k not in ("warnings", "errors")}},
    )
    return stats
