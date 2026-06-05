from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from ..auth import require_current_user
from ..sales_bi import (
    analyze_sheets,
    compare_sellers_report,
    create_product_alias,
    delete_temp_file,
    delete_product_alias,
    find_branch,
    build_sellers_report,
    get_active_import,
    get_import_detail,
    get_stats,
    list_balances,
    list_imports,
    list_records,
    list_unmatched_products,
    load_temp_file,
    read_excel,
    read_google_sheet,
    rematch_import_products,
    save_import,
    save_temp_file,
    void_import,
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
    matched_products: int = 0
    matched_by_alias: int = 0
    unmatched_products: int = 0
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


class ProductAliasRequest(BaseModel):
    product_id: int
    alias_sku: str = ""
    alias_desc: str = ""


class SellersExportRequest(BaseModel):
    fecha_desde: str | None = None
    fecha_hasta: str | None = None
    sucursal: str | None = None
    tipo: str | None = None
    vendedores: list[str] | None = None
    compare_desde: str | None = None
    compare_hasta: str | None = None
    logo: str = "GV"
    titulo: str = "Informe de vendedores"


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
    conflict = get_active_import(sheet["fecha"], sheet["sucursal"], sheet["tipo"])
    branch = find_branch(sheet["sucursal"], sheet["tipo"])
    return SheetPreview(
        sheet_name=sheet["sheet_name"],
        fecha=sheet["fecha"],
        sucursal=sheet["sucursal"],
        tipo=sheet["tipo"],
        cotizacion_dolar=sheet.get("cotizacion_dolar"),
        total_records=sheet["total_records"],
        matched_products=sheet.get("matched_products", 0),
        matched_by_alias=sheet.get("matched_by_alias", 0),
        unmatched_products=sheet.get("unmatched_products", 0),
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

        conflict = get_active_import(sheet["fecha"], sheet["sucursal"], sheet["tipo"])

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


@router.get("/unmatched-products")
def get_unmatched_products(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    fecha_desde: str | None = Query(default=None),
    fecha_hasta: str | None = Query(default=None),
    sucursal: str | None = Query(default=None),
    tipo: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
):
    _require(user, "sales_bi.view")
    return {
        "items": list_unmatched_products(fecha_desde, fecha_hasta, sucursal, tipo, q, limit)
    }


@router.post("/product-aliases")
def create_sales_bi_product_alias(
    body: ProductAliasRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.aliases.manage")
    try:
        return create_product_alias(body.product_id, body.alias_sku, body.alias_desc, user.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/product-aliases/{alias_id}")
def delete_sales_bi_product_alias(
    alias_id: int,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.aliases.manage")
    ok = delete_product_alias(alias_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alias no encontrado.")
    return {"ok": True, "id": alias_id}


@router.post("/imports/{import_id}/rematch-products")
def rematch_sales_bi_import(
    import_id: int,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.import")
    result = rematch_import_products(import_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("message") or "Importacion no encontrada.")
    return result


@router.get("/sellers/report")
def get_sellers_report(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    fecha_desde: str | None = Query(default=None),
    fecha_hasta: str | None = Query(default=None),
    sucursal: str | None = Query(default=None),
    tipo: str | None = Query(default=None),
    vendedores: str | None = Query(default=None),
):
    _require(user, "sales_bi.view")
    return build_sellers_report(
        fecha_desde,
        fecha_hasta,
        sucursal,
        tipo,
        vendedores,
        include_costs=user.has("sales_bi.view_costs"),
        include_margin=user.has("sales_bi.view_margin"),
    )


@router.get("/sellers/compare")
def get_sellers_compare(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    base_desde: str = Query(...),
    base_hasta: str = Query(...),
    compare_desde: str = Query(...),
    compare_hasta: str = Query(...),
    sucursal: str | None = Query(default=None),
    tipo: str | None = Query(default=None),
    vendedores: str | None = Query(default=None),
):
    _require(user, "sales_bi.view")
    return compare_sellers_report(
        base_desde,
        base_hasta,
        compare_desde,
        compare_hasta,
        sucursal,
        tipo,
        vendedores,
        include_costs=user.has("sales_bi.view_costs"),
        include_margin=user.has("sales_bi.view_margin"),
    )


@router.post("/sellers/export-pdf")
def export_sellers_pdf(
    body: SellersExportRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.export")
    from ..commercial.sales_bi_renderer import render_sellers_pdf

    report = build_sellers_report(
        body.fecha_desde,
        body.fecha_hasta,
        body.sucursal,
        body.tipo,
        body.vendedores,
        include_costs=user.has("sales_bi.view_costs"),
        include_margin=user.has("sales_bi.view_margin"),
    )
    compare = None
    if body.compare_desde and body.compare_hasta and body.fecha_desde and body.fecha_hasta:
        compare = compare_sellers_report(
            body.fecha_desde,
            body.fecha_hasta,
            body.compare_desde,
            body.compare_hasta,
            body.sucursal,
            body.tipo,
            body.vendedores,
            include_costs=user.has("sales_bi.view_costs"),
            include_margin=user.has("sales_bi.view_margin"),
        )
    pdf = render_sellers_pdf(report, compare=compare, logo=body.logo, title=body.titulo)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="informe-vendedores.pdf"'},
    )


@router.post("/sellers/export-xlsx")
def export_sellers_xlsx(
    body: SellersExportRequest,
    user: Annotated[CurrentUser, Depends(require_current_user)],
):
    _require(user, "sales_bi.export")
    from ..commercial.sales_bi_renderer import render_sellers_xlsx

    report = build_sellers_report(
        body.fecha_desde,
        body.fecha_hasta,
        body.sucursal,
        body.tipo,
        body.vendedores,
        include_costs=user.has("sales_bi.view_costs"),
        include_margin=user.has("sales_bi.view_margin"),
    )
    compare = None
    if body.compare_desde and body.compare_hasta and body.fecha_desde and body.fecha_hasta:
        compare = compare_sellers_report(
            body.fecha_desde,
            body.fecha_hasta,
            body.compare_desde,
            body.compare_hasta,
            body.sucursal,
            body.tipo,
            body.vendedores,
            include_costs=user.has("sales_bi.view_costs"),
            include_margin=user.has("sales_bi.view_margin"),
        )
    xlsx = render_sellers_xlsx(report, compare=compare, logo=body.logo, title=body.titulo)
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="informe-vendedores.xlsx"'},
    )


@router.get("/stats")
def get_bi_stats(user: Annotated[CurrentUser, Depends(require_current_user)]):
    _require(user, "sales_bi.view")
    return get_stats()
