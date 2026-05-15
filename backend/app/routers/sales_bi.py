from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..auth import require_current_user
from ..sales_bi import (
    analyze_sheets,
    delete_temp_file,
    find_branch,
    get_active_import,
    get_import_detail,
    get_stats,
    list_balances,
    list_imports,
    list_records,
    load_temp_file,
    read_excel,
    read_google_sheet,
    save_import,
    save_temp_file,
    void_import,
    db_connect,
)
from ..users import CurrentUser

router = APIRouter(prefix="/api/sales-bi", tags=["sales_bi"])

ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_BYTES = 20 * 1024 * 1024  # 20 MB


# ── response models ───────────────────────────────────────────────────────────


class SheetPreview(BaseModel):
    sheet_name: str
    fecha: str
    sucursal: str
    tipo: str
    cotizacion_dolar: float | None = None
    total_records: int
    total_pvp: float
    total_efectivo: float
    total_transferencia: float
    total_tarjeta: float
    total_usd: float = 0.0
    total_cuenta_corriente: float
    total_otros: float
    warnings: list[str]
    ok: bool
    conflict_import_id: int | None = None
    conflict_import_fecha: str | None = None
    branch_id: str | None = None
    branch_name: str | None = None
    branch_type: str | None = None
    records_preview: list[dict] = []
    balances: list[dict] = []


class AnalyzeResponse(BaseModel):
    sheets: list[SheetPreview]
    temp_file_key: str | None = None


class ConfirmRequest(BaseModel):
    temp_file_key: str | None = None
    sheet_url: str | None = None
    sheet_names: list[str] | None = None  # None = all sheets
    replace: bool = False
    sucursal: str | None = None


class ConfirmResponse(BaseModel):
    imported: list[dict]
    skipped: list[dict]


class VoidRequest(BaseModel):
    reason: str = ""


# ── helpers ───────────────────────────────────────────────────────────────────


def _require(user: CurrentUser, perm: str) -> None:
    if not user.has(perm):
        raise HTTPException(status_code=403, detail=f"Sin permiso: {perm}")


def _strip_cost_fields(record: dict, user: CurrentUser) -> dict:
    if not user.has("sales_bi.view_costs"):
        record.pop("costo", None)
        record.pop("diferencia", None)
    if not user.has("sales_bi.view_margin"):
        record.pop("margen_porcentaje", None)
    return record


def _build_preview(sheet: dict, include_records: int = 10) -> SheetPreview:
    with db_connect() as conn:
        conflict = get_active_import(conn, sheet["fecha"], sheet["sucursal"], sheet["tipo"])
        branch = find_branch(conn, sheet["sucursal"], sheet["tipo"])
    return SheetPreview(
        sheet_name=sheet["sheet_name"],
        fecha=sheet["fecha"],
        sucursal=sheet["sucursal"],
        tipo=sheet["tipo"],
        cotizacion_dolar=sheet.get("cotizacion_dolar"),
        total_records=sheet["total_records"],
        total_pvp=sheet["total_pvp"],
        total_efectivo=sheet["total_efectivo"],
        total_transferencia=sheet["total_transferencia"],
        total_tarjeta=sheet["total_tarjeta"],
        total_usd=sheet.get("total_usd", 0.0),
        total_cuenta_corriente=sheet["total_cuenta_corriente"],
        total_otros=sheet["total_otros"],
        warnings=sheet["warnings"] + (
            [f"No se encontró una sucursal registrada para '{sheet['sucursal']}' — se importará sin vincular a una sucursal del sistema."]
            if not branch and sheet["ok"] else []
        ),
        ok=sheet["ok"],
        conflict_import_id=conflict["id"] if conflict else None,
        conflict_import_fecha=conflict["created_at"] if conflict else None,
        branch_id=branch["id"] if branch else None,
        branch_name=branch["name"] if branch else None,
        branch_type=branch["type"] if branch else None,
        records_preview=sheet["records"][:include_records],
        balances=sheet.get("balances", []),
    )


# ── endpoints ─────────────────────────────────────────────────────────────────


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    file: UploadFile | None = File(default=None),
    sheet_url: str | None = Form(default=None),
    sucursal: str | None = Form(default=None),
):
    _require(user, "sales_bi.import")

    if not file and not sheet_url:
        raise HTTPException(status_code=400, detail="Se requiere un archivo Excel o una URL de Google Sheets.")

    temp_key: str | None = None

    if file:
        content = await file.read()
        if len(content) > MAX_BYTES:
            raise HTTPException(status_code=400, detail="El archivo supera el límite de 20 MB.")
        try:
            sheets_data = read_excel(content)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {exc}")
        temp_key = save_temp_file(content)
    else:
        try:
            sheets_data = read_google_sheet(sheet_url)  # type: ignore[arg-type]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"No se pudo leer la planilla: {exc}")

    parsed = analyze_sheets(sheets_data, sucursal_override=sucursal or "")
    previews = [_build_preview(s) for s in parsed]
    return AnalyzeResponse(sheets=previews, temp_file_key=temp_key)


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm(
    body: ConfirmRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.import")

    if not body.temp_file_key and not body.sheet_url:
        raise HTTPException(status_code=400, detail="Se requiere temp_file_key o sheet_url.")

    if body.temp_file_key:
        content = load_temp_file(body.temp_file_key)
        if not content:
            raise HTTPException(status_code=404, detail="El archivo temporal expiró o no existe. Volvé a subir el archivo.")
        try:
            sheets_data = read_excel(content)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {exc}")
        fuente = "excel"
        fuente_url = ""
        fuente_nombre = body.temp_file_key
    else:
        try:
            sheets_data = read_google_sheet(body.sheet_url)  # type: ignore[arg-type]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"No se pudo leer la planilla: {exc}")
        fuente = "google_sheets"
        fuente_url = body.sheet_url or ""
        fuente_nombre = fuente_url

    parsed = analyze_sheets(sheets_data, sucursal_override=body.sucursal or "")

    selected = parsed
    if body.sheet_names is not None:
        selected = [s for s in parsed if s["sheet_name"] in body.sheet_names]

    imported: list[dict] = []
    skipped: list[dict] = []

    for sheet in selected:
        if not sheet["ok"] or not sheet["records"]:
            skipped.append({"sheet_name": sheet["sheet_name"], "reason": "Sin registros o error de parseo."})
            continue
        if not sheet["fecha"]:
            skipped.append({"sheet_name": sheet["sheet_name"], "reason": "Sin fecha detectada."})
            continue

        with db_connect() as conn:
            conflict = get_active_import(conn, sheet["fecha"], sheet["sucursal"], sheet["tipo"])

        if conflict:
            if not body.replace:
                skipped.append({
                    "sheet_name": sheet["sheet_name"],
                    "reason": f"Ya existe una importación activa para {sheet['fecha']} / {sheet['sucursal']} (id={conflict['id']}). Usá replace=true para reemplazarla.",
                })
                continue
            void_import(conflict["id"], user.username, "Reemplazado por nueva importación.")

        import_id = save_import(
            sheet=sheet,
            fuente=fuente,
            fuente_url=fuente_url,
            fuente_nombre=fuente_nombre,
            username=user.username,
            display_name=user.display_name,
        )
        imported.append({
            "sheet_name": sheet["sheet_name"],
            "import_id": import_id,
            "fecha": sheet["fecha"],
            "sucursal": sheet["sucursal"],
            "tipo": sheet["tipo"],
            "total_records": sheet["total_records"],
        })

    if body.temp_file_key and imported:
        delete_temp_file(body.temp_file_key)

    return ConfirmResponse(imported=imported, skipped=skipped)


@router.get("/imports")
def get_imports(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    fecha_desde: str | None = Query(default=None),
    fecha_hasta: str | None = Query(default=None),
    sucursal: str | None = Query(default=None),
    tipo: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
):
    _require(user, "sales_bi.view")
    items, total = list_imports(fecha_desde, fecha_hasta, sucursal, tipo, status, limit, offset)
    return {"items": items, "total": total}


@router.get("/imports/{import_id}")
def get_import(
    import_id: int,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.view")
    detail = get_import_detail(import_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Importación no encontrada.")
    for rec in detail.get("records", []):
        if not user.has("sales_bi.view_costs"):
            rec.pop("costo", None)
            rec.pop("diferencia", None)
        if not user.has("sales_bi.view_margin"):
            rec.pop("margen_porcentaje", None)
    return detail


@router.post("/imports/{import_id}/void")
def do_void_import(
    import_id: int,
    body: VoidRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.void")
    detail = get_import_detail(import_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Importación no encontrada.")
    if detail["status"] != "activo":
        raise HTTPException(status_code=400, detail="La importación ya está anulada.")
    void_import(import_id, user.username, body.reason)
    return {"ok": True}


@router.get("/records")
def get_records(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    import_id: int | None = Query(default=None),
    fecha_desde: str | None = Query(default=None),
    fecha_hasta: str | None = Query(default=None),
    sucursal: str | None = Query(default=None),
    tipo: str | None = Query(default=None),
    vendedor: str | None = Query(default=None),
    categoria: str | None = Query(default=None),
    condicion: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0),
):
    _require(user, "sales_bi.view")
    items, total = list_records(
        import_id, fecha_desde, fecha_hasta, sucursal, tipo,
        vendedor, categoria, condicion, q, limit, offset,
    )
    for rec in items:
        if not user.has("sales_bi.view_costs"):
            rec.pop("costo", None)
            rec.pop("diferencia", None)
        if not user.has("sales_bi.view_margin"):
            rec.pop("margen_porcentaje", None)
    return {"items": items, "total": total}


@router.get("/balances")
def get_balances(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    import_id: int | None = Query(default=None),
    fecha_desde: str | None = Query(default=None),
    fecha_hasta: str | None = Query(default=None),
    sucursal: str | None = Query(default=None),
    limit: int = Query(default=200, le=500),
    offset: int = Query(default=0),
):
    _require(user, "sales_bi.view")
    items, total = list_balances(import_id, fecha_desde, fecha_hasta, sucursal, limit, offset)
    return {"items": items, "total": total}


@router.get("/stats")
def get_bi_stats(user: Annotated[CurrentUser, Depends(require_current_user)]):
    _require(user, "sales_bi.view")
    return get_stats()
