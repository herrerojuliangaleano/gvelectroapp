"""Sub-router de configuracion, diagnosticos y dashboard de garantias.

Endpoints:
  GET   /config
  PATCH /config
  GET   /diagnostics
  GET   /dashboard
"""
from __future__ import annotations

from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from ...audit import audit
from ...auth import require_permission
from ...operational_config import load_operational_config, save_operational_config, runtime_warranty_config
from ...product_catalog import runtime_product_catalog_config
from ...warranties_db import pg_fetch_all_guarantee_rows
from ...warranty_helpers import (
    REVIEW_APPROVED,
    REVIEW_IN_PROGRESS,
    REVIEW_INCOMPLETE,
    REVIEW_PENDING,
    format_datetime_ar,
    normalize_text,
    parse_date_filter,
    parse_iso_datetime,
)
from . import (
    DEFAULT_DELAY_RANGES,
    DEFAULT_DEPOSITOS,
    DEFAULT_FINAL_STATUSES,
    DEFAULT_REQUIRED_REVIEW_FIELDS,
    DEFAULT_STATUSES,
    DEFAULT_SUCURSALES,
    WarrantyConfigCatalog,
    WarrantyConfigResponse,
    WarrantyConfigSaveRequest,
    WarrantyDashboardMetrics,
    WarrantyDashboardPoint,
    WarrantyDashboardResponse,
    WarrantyDiagnosticItem,
    WarrantyDiagnosticsResponse,
    WarrantySummary,
    canonical_status_key,
    compute_no_response_days,
    compute_pending_days,
    internal_logistics_ready_for_provider,
    normalize_status,
    review_status_matches,
    row_to_summary,
    status_matches,
    unique_keep_order,
    warranty_config_values,
)


router = APIRouter(tags=["warranties"])


FINAL_STATUS_LABELS = [
    "10 - FINALIZADO",
]


def status_equals(value: Any, expected: str) -> bool:
    return status_matches(value, expected)


def is_rejected_status(value: Any) -> bool:
    return "RECHAZADO" in normalize_text(value)


def is_final_status(value: Any) -> bool:
    return any(status_matches(value, status_value) for status_value in FINAL_STATUS_LABELS)


def dashboard_date_key(iso_value: str) -> str:
    dt = parse_iso_datetime(iso_value)
    if not dt:
        return "Sin fecha"
    local = dt.astimezone(ZoneInfo("America/Argentina/Buenos_Aires"))
    return local.strftime("%Y-%m")


def avg(values: list[int | float]) -> float:
    clean = [float(v) for v in values if v is not None]
    if not clean:
        return 0
    return round(sum(clean) / len(clean), 1)


def ordered_points(counter: dict[str, int | float], *, limit: int | None = None, preferred_order: list[str] | None = None) -> list[WarrantyDashboardPoint]:
    if preferred_order:
        ordered: list[tuple[str, int | float]] = [(label, counter.get(label, 0)) for label in preferred_order if counter.get(label, 0)]
        rest = [(label, value) for label, value in counter.items() if label not in preferred_order and value]
        rest.sort(key=lambda pair: float(pair[1]), reverse=True)
        data = ordered + rest
    else:
        data = sorted(counter.items(), key=lambda pair: float(pair[1]), reverse=True)
    if limit is not None:
        data = data[:limit]
    return [WarrantyDashboardPoint(label=str(label), value=float(value)) for label, value in data]


def delay_range_label(days: int) -> str:
    if days <= 3:
        return "0 a 3 días"
    if days <= 7:
        return "4 a 7 días"
    if days <= 14:
        return "8 a 14 días"
    if days <= 30:
        return "15 a 30 días"
    return "Más de 30 días"


def dashboard_matches(row: dict[str, Any], items: list[dict[str, Any]], filters: dict[str, Any]) -> bool:
    date_from = parse_date_filter(filters.get("fecha_desde"))
    date_to = parse_date_filter(filters.get("fecha_hasta"))
    ingreso_dt = parse_iso_datetime(row["ingreso_at"] or row["created_at"])
    ingreso_date = ingreso_dt.date() if ingreso_dt else None
    if date_from and ingreso_date and ingreso_date < date_from:
        return False
    if date_to and ingreso_date and ingreso_date > date_to:
        return False
    if filters.get("estado") and not status_matches(row["status"], filters.get("estado")):
        return False
    if filters.get("sucursal") and normalize_text(row["sucursal"]) != normalize_text(filters.get("sucursal")):
        return False
    if filters.get("deposito"):
        wanted = normalize_text(filters.get("deposito"))
        if wanted not in {normalize_text(row["deposito"]), normalize_text(row["lugar_llegada"])}:
            return False
    if filters.get("proveedor") and normalize_text(row["provider_name"]) != normalize_text(filters.get("proveedor")):
        return False
    if filters.get("marca"):
        wanted = normalize_text(filters.get("marca"))
        if not any(normalize_text(item["marca"]) == wanted for item in items):
            return False
    return True


@router.get("/config", response_model=WarrantyConfigResponse)
def get_warranty_config(_user: Annotated[Any, Depends(require_permission("warranties.config"))]):
    values = warranty_config_values()
    from sqlalchemy import func as _func, select as _select, distinct as _distinct
    from ...db import db_session as _db_session
    from ...models.products import Product as _Product, ProductBrand as _Brand, Provider as _Provider, BrandProvider as _BP
    from ...models.warranties import Guarantee as _Guarantee
    with _db_session() as _s:
        providers_count = int(_s.scalar(_select(_func.count()).select_from(_Provider).where(_Provider.is_active.is_(True))) or 0)
        brands_count = int(_s.scalar(_select(_func.count()).select_from(_Brand).where(_Brand.is_active.is_(True))) or 0)
        mapped_brands_count = int(_s.scalar(_select(_func.count(_distinct(_BP.brand_id))).select_from(_BP)) or 0)
        pending_review_count = int(_s.scalar(_select(_func.count()).select_from(_Guarantee).where(_Guarantee.review_status != REVIEW_APPROVED, _Guarantee.cancelled.is_(False))) or 0)
        active_count = int(_s.scalar(_select(_func.count()).select_from(_Guarantee).where(_Guarantee.cancelled.is_(False))) or 0)
    return WarrantyConfigResponse(
        config=WarrantyConfigCatalog(
            statuses=values["statuses"],
            final_statuses=values["final_statuses"],
            sucursales=values["sucursales"],
            depositos=values["depositos"],
            delay_ranges=values["delay_ranges"],
            required_review_fields=values["required_review_fields"],
            sheet_raw=values["raw_sheet"],
            spreadsheet_url=values["spreadsheet_url"],
        ),
        providers_count=providers_count,
        brands_count=brands_count,
        mapped_brands_count=mapped_brands_count,
        unmapped_brands_count=max(0, brands_count - mapped_brands_count),
        pending_review_count=pending_review_count,
        active_count=active_count,
    )


@router.patch("/config", response_model=WarrantyConfigResponse)
def save_warranty_config(data: WarrantyConfigSaveRequest, user: Annotated[Any, Depends(require_permission("warranties.config"))]):
    root = load_operational_config()
    warranties_cfg = root.get("warranties", {}) if isinstance(root.get("warranties"), dict) else {}
    if data.statuses is not None:
        clean = [x.strip() for x in data.statuses if str(x).strip()]
        warranties_cfg["statuses"] = unique_keep_order(clean or DEFAULT_STATUSES)
        warranties_cfg["estados"] = warranties_cfg["statuses"]
    if data.final_statuses is not None:
        warranties_cfg["final_statuses"] = unique_keep_order([x.strip() for x in data.final_statuses if str(x).strip()] or DEFAULT_FINAL_STATUSES)
    if data.sucursales is not None:
        warranties_cfg["sucursales"] = unique_keep_order([x.strip() for x in data.sucursales if str(x).strip()] or DEFAULT_SUCURSALES)
    if data.depositos is not None:
        warranties_cfg["depositos"] = unique_keep_order([x.strip() for x in data.depositos if str(x).strip()] or DEFAULT_DEPOSITOS)
    if data.delay_ranges is not None:
        values = sorted({int(x) for x in data.delay_ranges if int(x) > 0})
        warranties_cfg["delay_ranges"] = values or DEFAULT_DELAY_RANGES
    if data.required_review_fields is not None:
        warranties_cfg["required_review_fields"] = unique_keep_order([x.strip() for x in data.required_review_fields if str(x).strip()] or DEFAULT_REQUIRED_REVIEW_FIELDS)
    if data.raw_sheet is not None:
        warranties_cfg["raw_sheet"] = data.raw_sheet.strip() or "00_RAW_GARANTIAS"
    if data.spreadsheet_url is not None:
        warranties_cfg["spreadsheet_url"] = data.spreadsheet_url.strip()
    root["warranties"] = warranties_cfg
    save_operational_config(root, updated_by=getattr(user, "username", "system") or "system")
    audit("warranties.config.save", user=user, resource_type="warranty_config", resource_id="system", details={"section": "warranties"})
    return get_warranty_config(user)


def _diagnostic_item(key: str, label: str, status_value: str, detail: str, count: int = 0) -> WarrantyDiagnosticItem:
    return WarrantyDiagnosticItem(key=key, label=label, status=status_value, detail=detail, count=count)


@router.get("/diagnostics", response_model=WarrantyDiagnosticsResponse)
def warranty_diagnostics(actor: Annotated[Any, Depends(require_permission("warranties.dashboard"))]) -> WarrantyDiagnosticsResponse:
    """Resumen de cierre operativo del módulo Garantías.

    No modifica datos. Sirve para detectar puntos pendientes antes de usar el flujo completo
    en producción: catálogo, proveedores, revisión, sincronización y configuración.
    """
    from sqlalchemy import and_ as _and, func as _func, not_ as _not, or_ as _or, select as _select
    from sqlalchemy.orm import aliased as _aliased
    from ...db import db_session as _db_session
    from ...models.org import Branch as _Branch
    from ...models.products import Product as _Product, ProductBrand as _Brand, Provider as _Provider, BrandProvider as _BP
    from ...models.remitos import Remito as _Remito
    from ...models.warranties import Guarantee as _Guarantee

    cfg = runtime_warranty_config()
    product_cfg = runtime_product_catalog_config()
    items: list[WarrantyDiagnosticItem] = []
    next_actions: list[str] = []

    all_rows, _all_items = pg_fetch_all_guarantee_rows()
    guarantee_rows = [r for r in all_rows if not (r.get("cancelled") or 0)]
    active_guarantees = len(guarantee_rows)
    pending_review = sum(1 for row in guarantee_rows if status_matches(row["status"], DEFAULT_STATUSES[0]) or review_status_matches(row["review_status"], REVIEW_PENDING))
    needs_correction = sum(1 for row in guarantee_rows if review_status_matches(row["review_status"], REVIEW_INCOMPLETE))
    pending_provider = sum(1 for row in guarantee_rows if status_matches(row["status"], "2 - PENDIENTE"))
    sent_without_case = sum(
        1
        for row in guarantee_rows
        if (status_matches(row["status"], "4 - ENVIADO AL PROVEEDOR") or status_matches(row["status"], "5 - EN EL PROVEEDOR"))
        and not str(row.get("provider_case_id") or "").strip()
    )
    pending_sync = sum(1 for row in guarantee_rows if int(row.get("synced_to_google_sheet") or 0) == 0)
    missing_org_fields = sum(
        1 for row in guarantee_rows
        if not str(row.get("branch_id") or "").strip()
        or not str(row.get("company_id") or "").strip()
        or not str(row.get("tipo_ingreso") or "").strip()
        or not str(row.get("origen_ingreso") or "").strip()
        or not str(row.get("ubicacion_actual") or "").strip()
    )
    deposit_without_responsible = sum(
        1 for row in guarantee_rows
        if row.get("tipo_ingreso") == "cliente_deposito"
        and not str(row.get("sucursal_responsable_id") or "").strip()
        and not str(row.get("sucursal_responsable") or "").strip()
    )
    env_with_remito = sum(
        1 for row in guarantee_rows
        if str(row.get("shipment_code") or "").strip() and str(row.get("remito_interno") or "").strip()
    )
    deposito_disponible_remito_risk = sum(
        1 for row in guarantee_rows
        if row.get("origen_ingreso") == "deposito" and str(row.get("remito_interno") or "").strip()
    )

    with _db_session() as _s:
        products_count = int(_s.scalar(_select(_func.count()).select_from(_Product).where(_Product.is_active.is_(True))) or 0)
        providers_count = int(_s.scalar(_select(_func.count()).select_from(_Provider).where(_Provider.is_active.is_(True))) or 0)
        brands_count = int(_s.scalar(_select(_func.count()).select_from(_Brand).where(_Brand.is_active.is_(True))) or 0)
        # Marcas activas sin proveedor activo asignado.
        mapped_brand_ids = _select(_BP.brand_id).join(_Provider, _Provider.id == _BP.provider_id).where(_Provider.is_active.is_(True)).distinct().scalar_subquery()
        unmapped_brands = int(_s.scalar(_select(_func.count()).select_from(_Brand).where(_and(_Brand.is_active.is_(True), _not(_Brand.id.in_(mapped_brand_ids))))) or 0)
        deposit_branch_rows = _s.execute(
            _select(_Branch.id, _Branch.name, _Branch.code).where(_and(_Branch.is_active.is_(True), _Branch.type == "deposit")).order_by(_Branch.name)
        ).all()
        deposit_branches = [{"id": r[0], "name": r[1], "code": r[2]} for r in deposit_branch_rows]
        physical_branches_count = int(_s.scalar(_select(_func.count()).select_from(_Branch).where(_and(_Branch.is_active.is_(True), _Branch.type == "physical"))) or 0)
    products_ok = products_count > 0
    providers_ok = providers_count > 0
    sheet_ok = bool(cfg.get("spreadsheet_id") or cfg.get("spreadsheet_url"))
    product_sheet_ok = bool(product_cfg.get("spreadsheet_id") or product_cfg.get("spreadsheet_url"))
    items.append(_diagnostic_item(
        "product_catalog",
        "Catálogo de productos",
        "ok" if products_ok else "warning",
        f"{products_count} productos activos disponibles para búsquedas y autocompletado.",
        products_count,
    ))
    if not products_ok:
        next_actions.append("Actualizar el catálogo desde la Planilla Madre de Ventas.")
    items.append(_diagnostic_item(
        "product_source",
        "Fuente de productos",
        "ok" if product_sheet_ok else "warning",
        f"Hoja configurada: {product_cfg.get('sheet_name') or 'sin configurar'}.",
        products_count,
    ))
    if not product_sheet_ok:
        next_actions.append("Configurar la Planilla Madre de Ventas en Configuración operativa > Productos.")
    items.append(_diagnostic_item(
        "providers",
        "Proveedores",
        "ok" if providers_ok else "warning",
        f"{providers_count} proveedores activos cargados.",
        providers_count,
    ))
    if not providers_ok:
        next_actions.append("Cargar proveedores y vincularlos con marcas principales.")
    items.append(_diagnostic_item(
        "brand_mapping",
        "Marcas vinculadas a proveedor",
        "ok" if unmapped_brands == 0 and brands_count > 0 else "warning",
        f"{unmapped_brands} marcas activas sin proveedor asignado sobre {brands_count} marcas detectadas.",
        unmapped_brands,
    ))
    if unmapped_brands:
        next_actions.append("Completar la relación Marca → Proveedor en Productos y proveedores.")
    items.append(_diagnostic_item(
        "review_queue",
        "Revisión interna",
        "ok" if pending_review == 0 and needs_correction == 0 else "warning",
        f"{pending_review} en ingreso y {needs_correction} requieren corrección.",
        pending_review + needs_correction,
    ))
    if pending_review or needs_correction:
        next_actions.append("Revisar la bandeja de garantías antes de enviarlas a proveedor.")
    items.append(_diagnostic_item(
        "provider_management",
        "Gestión con proveedor",
        "ok" if sent_without_case == 0 else "warning",
        f"{pending_provider} listas para proveedor. {sent_without_case} enviadas/en revisión sin ID de caso.",
        pending_provider + sent_without_case,
    ))
    if sent_without_case:
        next_actions.append("Completar ID de caso en garantías ya enviadas o en revisión.")
    items.append(_diagnostic_item(
        "sheet_sync",
        "Sincronización Google Sheet",
        "ok" if pending_sync == 0 else "warning",
        f"{pending_sync} garantías activas pendientes de sincronizar.",
        pending_sync,
    ))
    if pending_sync:
        next_actions.append("Actualizar Google Sheet desde el panel de sincronización cuando corresponda.")
    items.append(_diagnostic_item(
        "sheet_config",
        "Google Sheet de garantías",
        "ok" if sheet_ok else "warning",
        f"Hoja raw: {cfg.get('raw_sheet') or 'sin hoja configurada'}.",
        active_guarantees,
    ))
    if not sheet_ok:
        next_actions.append("Configurar la Google Sheet de garantías en Configuración operativa > Garantías.")

    deposit_names = ", ".join(str(r["name"] or r["code"] or "") for r in deposit_branches) or "sin depósitos activos"
    deposits_ok = len(deposit_branches) >= 3
    items.append(_diagnostic_item(
        "org_deposits",
        "Depósitos como branches",
        "ok" if deposits_ok else "warning",
        f"{len(deposit_branches)} depósitos activos detectados: {deposit_names}.",
        len(deposit_branches),
    ))
    if not deposits_ok:
        next_actions.append("Crear/asignar Chiclana, Corrales y Cachi como branches type=deposit.")

    items.append(_diagnostic_item(
        "org_physical_branches",
        "Sucursales físicas activas",
        "ok" if physical_branches_count > 0 else "warning",
        f"{physical_branches_count} sucursales físicas activas disponibles para sucursal_responsable.",
        physical_branches_count,
    ))
    if not physical_branches_count:
        next_actions.append("Revisar la configuración de sucursales físicas en Organización.")

    items.append(_diagnostic_item(
        "org_truth_fields",
        "Fuente de verdad organizativa",
        "ok" if missing_org_fields == 0 else "warning",
        f"{missing_org_fields} garantías activas tienen incompletos branch_id/company_id/tipo/origen/ubicación.",
        missing_org_fields,
    ))
    if missing_org_fields:
        next_actions.append("Revisar/backfillear garantías heredadas con campos organizativos nuevos.")

    items.append(_diagnostic_item(
        "org_deposit_responsible",
        "Cliente en depósito con sucursal responsable",
        "ok" if deposit_without_responsible == 0 else "warning",
        f"{deposit_without_responsible} garantías cliente_deposito no tienen sucursal responsable.",
        deposit_without_responsible,
    ))
    if deposit_without_responsible:
        next_actions.append("Completar sucursal responsable en garantías cargadas desde depósito por cliente.")

    items.append(_diagnostic_item(
        "flow_env_remito_overlap",
        "ENV y remito interno superpuestos",
        "ok" if env_with_remito == 0 else "warning",
        f"{env_with_remito} garantías tienen a la vez shipment_code y remito_interno. Puede ser válido, pero revisar que no se estén confundiendo flujos.",
        env_with_remito,
    ))
    if env_with_remito:
        next_actions.append("Auditar que REM sea traslado interno y ENV sea lote proveedor, sin usar uno como sustituto del otro.")

    items.append(_diagnostic_item(
        "flow_deposit_remito_risk",
        "Remitos en ingresos de depósito",
        "ok" if deposito_disponible_remito_risk == 0 else "warning",
        f"{deposito_disponible_remito_risk} garantías con origen depósito tienen remito interno asignado.",
        deposito_disponible_remito_risk,
    ))
    if deposito_disponible_remito_risk:
        next_actions.append("Revisar remitos asociados a garantías que ya ingresaron en depósito.")

    # Fase 29 — auditoría pre-producción del flujo real de garantías.
    # No modifica datos: detecta registros que podrían romper el flujo antes de salir a producción.
    canonical_statuses = {canonical_status_key(label) for label in DEFAULT_STATUSES}
    canonical_review_statuses = {
        canonical_status_key(REVIEW_PENDING),
        canonical_status_key(REVIEW_IN_PROGRESS),
        canonical_status_key(REVIEW_INCOMPLETE),
        canonical_status_key(REVIEW_APPROVED),
    }
    invalid_status = sum(
        1 for row in guarantee_rows
        if canonical_status_key(normalize_status(row["status"])) not in canonical_statuses
    )
    invalid_review_status = sum(
        1 for row in guarantee_rows
        if canonical_status_key(row["review_status"] or REVIEW_PENDING) not in canonical_review_statuses
    )
    pendiente_sin_revision = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "2 - PENDIENTE")
        and not review_status_matches(row["review_status"], REVIEW_APPROVED)
    )
    revisada_en_ingreso = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "1 - INGRESO")
        and review_status_matches(row["review_status"], REVIEW_APPROVED)
    )
    listo_sin_env = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "3 - LISTO PARA ENVIAR")
        and not str(row["shipment_code"] or "").strip()
    )
    enviado_sin_mail = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "4 - ENVIADO AL PROVEEDOR")
        and not (str(row["fecha_ultimo_mail_proveedor"] or "").strip() or str(row["sent_to_provider_at"] or "").strip())
    )
    retiro_solicitado_urgente = sum(
        1 for row in guarantee_rows
        if normalize_text(row["estado_retiro_proveedor"] or "") in {"RETIRO_SOLICITADO", "SOLICITADO"}
        and not internal_logistics_ready_for_provider(row)
    )
    retiro_solicitado_listo = sum(
        1 for row in guarantee_rows
        if normalize_text(row["estado_retiro_proveedor"] or "") in {"RETIRO_SOLICITADO", "SOLICITADO", "LISTO_PARA_RETIRO"}
        and internal_logistics_ready_for_provider(row)
        and not status_matches(row["status"], "5 - EN EL PROVEEDOR")
    )
    en_proveedor_sin_fecha = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "5 - EN EL PROVEEDOR")
        and not (str(row["fecha_retiro_proveedor"] or "").strip() or str(row["fecha_retiro"] or "").strip())
    )
    resuelta_sin_resultado = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "7 - RESUELTO")
        and not str(row["resultado_resolucion"] or "").strip()
    )
    finalizada_sin_cierre = sum(
        1 for row in guarantee_rows
        if status_matches(row["status"], "10 - FINALIZADO")
        and not (str(row["fecha_finalizacion"] or "").strip() or str(row["finalizacion"] or "").strip())
    )
    # Postgres: remitos (renamed from warranty_remitos).
    with _db_session() as _s:
        remitos_en_transito = int(_s.scalar(_select(_func.count()).select_from(_Remito).where(_Remito.status.in_(["en_transito", "despachado"]))) or 0)
        remitos_con_env = int(_s.scalar(_select(_func.count()).select_from(_Remito).where(_func.coalesce(_Remito.shipment_code, "") != "")) or 0)

    items.append(_diagnostic_item(
        "flow_canonical_statuses",
        "Estados canónicos",
        "ok" if invalid_status == 0 and invalid_review_status == 0 else "error",
        f"{invalid_status} garantías con estado no canónico y {invalid_review_status} con review_status no canónico.",
        invalid_status + invalid_review_status,
    ))
    if invalid_status or invalid_review_status:
        next_actions.append("Normalizar estados/review_status heredados antes de cargar datos reales.")

    state_logic_issues = pendiente_sin_revision + revisada_en_ingreso + listo_sin_env + enviado_sin_mail
    items.append(_diagnostic_item(
        "flow_state_coherence",
        "Coherencia estado → acción",
        "ok" if state_logic_issues == 0 else "warning",
        f"{pendiente_sin_revision} pendientes sin revisión aprobada, {revisada_en_ingreso} revisadas en ingreso, {listo_sin_env} listas sin ENV y {enviado_sin_mail} enviadas sin fecha de mail.",
        state_logic_issues,
    ))
    if state_logic_issues:
        next_actions.append("Revisar garantías que no respetan la secuencia INGRESO → PENDIENTE → ENV → MAIL.")

    provider_flow_issues = retiro_solicitado_urgente + en_proveedor_sin_fecha + resuelta_sin_resultado + finalizada_sin_cierre
    items.append(_diagnostic_item(
        "flow_provider_followup",
        "Seguimiento proveedor",
        "ok" if provider_flow_issues == 0 else "warning",
        f"{retiro_solicitado_urgente} retiros solicitados sin producto listo, {retiro_solicitado_listo} listos para retiro, {en_proveedor_sin_fecha} en proveedor sin fecha, {resuelta_sin_resultado} resueltas sin resolución y {finalizada_sin_cierre} finalizadas sin cierre.",
        provider_flow_issues + retiro_solicitado_listo,
    ))
    if retiro_solicitado_urgente:
        next_actions.append("Priorizar remitos urgentes hacia Chiclana para retiros solicitados por proveedor.")
    if retiro_solicitado_listo:
        next_actions.append("Coordinar retiro proveedor para garantías listas físicamente en Chiclana.")
    if resuelta_sin_resultado:
        next_actions.append("Completar si la resolución fue Nota de crédito, Reparación o Cambio de equipo.")

    items.append(_diagnostic_item(
        "flow_internal_remitos",
        "Remitos internos",
        "ok" if remitos_con_env == 0 else "error",
        f"{remitos_en_transito} remitos en tránsito y {remitos_con_env} remitos con shipment_code/ENV asociado.",
        remitos_en_transito + remitos_con_env,
    ))
    if remitos_con_env:
        next_actions.append("Corregir remitos con shipment_code: REM y ENV deben seguir separados.")

    status_value = "ok"
    if any(item.status == "error" for item in items):
        status_value = "error"
    elif any(item.status == "warning" for item in items):
        status_value = "warning"
    return WarrantyDiagnosticsResponse(status=status_value, generated_at=format_datetime_ar(), items=items, next_actions=next_actions[:8])


@router.get("/dashboard", response_model=WarrantyDashboardResponse)
def warranty_dashboard(
    _user: Annotated[Any, Depends(require_permission("warranties.dashboard"))],
    fecha_desde: str = "",
    fecha_hasta: str = "",
    marca: str = "",
    proveedor: str = "",
    sucursal: str = "",
    deposito: str = "",
    estado: str = "",
):
    filters = {
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta,
        "marca": marca,
        "proveedor": proveedor,
        "sucursal": sucursal,
        "deposito": deposito,
        "estado": estado,
    }
    all_rows, all_items = pg_fetch_all_guarantee_rows()
    rows = [r for r in all_rows if not (r.get("cancelled") or 0)]
    by_gid: dict[int, list[dict[str, Any]]] = {}
    for item in all_items:
        by_gid.setdefault(int(item["guarantee_id"]), []).append(item)
    selected: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for row in rows:
        items = by_gid.get(int(row["id"]), [])
        if dashboard_matches(row, items, filters):
            selected.append((row, items))

    by_status: dict[str, int] = {}
    by_brand: dict[str, int] = {}
    by_provider: dict[str, int] = {}
    by_branch: dict[str, int] = {}
    by_deposit: dict[str, int] = {}
    by_delay_range: dict[str, int] = {"0 a 3 días": 0, "4 a 7 días": 0, "8 a 14 días": 0, "15 a 30 días": 0, "Más de 30 días": 0}
    monthly: dict[str, int] = {}
    final_resolutions: dict[str, int] = {}
    resolution_by_provider_values: dict[str, list[int]] = {}

    pending_days_values: list[int] = []
    resolution_days_values: list[int] = []
    no_response_values: list[int] = []
    critical_candidates: list[tuple[int, WarrantySummary]] = []

    ingreso_count = review_pending = pending_provider = sent_provider = in_review = resolved = rejected = delayed_7 = delayed_15 = 0

    for row, items in selected:
        status_value = str(row["status"] or "")
        by_status[status_value or "Sin estado"] = by_status.get(status_value or "Sin estado", 0) + 1
        by_branch[str(row["sucursal"] or "Sin sucursal")] = by_branch.get(str(row["sucursal"] or "Sin sucursal"), 0) + 1
        by_deposit[str(row["deposito"] or "Sin depósito")] = by_deposit.get(str(row["deposito"] or "Sin depósito"), 0) + 1
        provider_label = str(row["provider_name"] or "Sin proveedor")
        by_provider[provider_label] = by_provider.get(provider_label, 0) + 1
        monthly_key = dashboard_date_key(str(row["ingreso_at"] or row["created_at"] or ""))
        monthly[monthly_key] = monthly.get(monthly_key, 0) + 1
        for item in items:
            brand = str(item["marca"] or "Sin marca")
            by_brand[brand] = by_brand.get(brand, 0) + 1

        pending_days = compute_pending_days(row)
        pending_days_values.append(pending_days)
        if not is_final_status(status_value):
            by_delay_range[delay_range_label(pending_days)] = by_delay_range.get(delay_range_label(pending_days), 0) + 1
        no_response = compute_no_response_days(row)
        if no_response is not None:
            no_response_values.append(no_response)
        if status_equals(status_value, "1 - INGRESO"):
            ingreso_count += 1
        if str(row["review_status"] or REVIEW_PENDING) != REVIEW_APPROVED:
            review_pending += 1
        if status_equals(status_value, "2 - PENDIENTE"):
            pending_provider += 1
        if status_equals(status_value, "4 - ENVIADO AL PROVEEDOR"):
            sent_provider += 1
        if status_equals(status_value, "5 - EN EL PROVEEDOR"):
            in_review += 1
        if is_final_status(status_value):
            final_resolutions[status_value] = final_resolutions.get(status_value, 0) + 1
            if is_rejected_status(status_value):
                rejected += 1
            else:
                resolved += 1
            resolution_days = compute_pending_days(row)
            resolution_days_values.append(resolution_days)
            resolution_by_provider_values.setdefault(provider_label, []).append(resolution_days)
        if not is_final_status(status_value) and pending_days >= 7:
            delayed_7 += 1
        if not is_final_status(status_value) and pending_days >= 15:
            delayed_15 += 1
        urgency_score = max(pending_days, int(no_response or 0))
        if urgency_score >= 7 and not is_final_status(status_value):
            critical_candidates.append((urgency_score, row_to_summary(row, items)))

    resolution_provider_avg = {label: avg(values) for label, values in resolution_by_provider_values.items() if values}
    critical_candidates.sort(key=lambda pair: pair[0], reverse=True)
    monthly_points = [WarrantyDashboardPoint(label=label, value=float(monthly[label])) for label in sorted(monthly.keys())]
    return WarrantyDashboardResponse(
        metrics=WarrantyDashboardMetrics(
            total=len(selected),
            ingreso=ingreso_count,
            pendientes_revision=review_pending,
            pendientes_proveedor=pending_provider,
            enviadas_proveedor=sent_provider,
            en_revision=in_review,
            resueltas=resolved,
            rechazadas=rejected,
            demoradas_7=delayed_7,
            demoradas_15=delayed_15,
            promedio_dias_pendiente=avg(pending_days_values),
            promedio_resolucion=avg(resolution_days_values),
            promedio_dias_sin_respuesta=avg(no_response_values),
        ),
        by_status=ordered_points(by_status, preferred_order=DEFAULT_STATUSES),
        by_brand=ordered_points(by_brand, limit=10),
        by_provider=ordered_points(by_provider, limit=10),
        by_branch=ordered_points(by_branch),
        by_deposit=ordered_points(by_deposit),
        by_delay_range=ordered_points(by_delay_range, preferred_order=["0 a 3 días", "4 a 7 días", "8 a 14 días", "15 a 30 días", "Más de 30 días"]),
        monthly_entries=monthly_points[-12:],
        avg_resolution_by_provider=ordered_points(resolution_provider_avg, limit=10),
        final_resolutions=ordered_points(final_resolutions, preferred_order=FINAL_STATUS_LABELS),
        critical=[summary for _score, summary in critical_candidates[:15]],
        filters={key: value for key, value in filters.items() if value},
    )

