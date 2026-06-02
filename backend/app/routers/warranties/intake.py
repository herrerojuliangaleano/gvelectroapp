"""Sub-router de ingreso de garantias.

Endpoints:
  GET  /options
  GET  /products
  POST /entries
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ...access import assigned_branches, user_has
from ...audit import audit
from ...auth import require_current_user
from ...config import get_settings
from ...product_catalog import get_provider_for_brand, search_products as search_local_products
from ...warranties_db import (
    pg_add_history,
    pg_insert_guarantee,
    pg_insert_item,
    pg_next_warranty_code,
)
from ...warranty_helpers import normalize_text
from . import (
    DEFAULT_STATUSES,
    TIPOS_INGRESO_VENDEDOR,
    WarrantyCreateRequest,
    WarrantyCreateResponse,
    WarrantyCreatedItem,
    WarrantyItemIn,
    _branch_by_name,
    _code_source_for_tipo,
    _fetch_branch_info,
    _initial_ubicacion_actual,
    _origen_from_tipo,
    _warranty_central_deposit_name,
    date_input_from_iso,
    ensure_warranty_intake_access,
    ingreso_at_from_input,
    is_deposit_operator_user,
    load_product_catalog,
    runtime_warranty_options,
    unique_keep_order,
)


router = APIRouter(tags=["warranties"])


@router.get("/options")
def warranty_options(user: Annotated[Any, Depends(require_current_user)]):
    # Depósito operativo necesita opciones para cargar Cliente en depósito,
    # aunque no tenga permiso de listado/gestión global.
    ensure_warranty_intake_access(user)
    return runtime_warranty_options()


@router.get("/products")
def warranty_products(
    user: Annotated[Any, Depends(require_current_user)],
    q: str = Query(default="", min_length=0),
    limit: int = Query(default=20, ge=1, le=50),
):
    ensure_warranty_intake_access(user)
    query = normalize_text(q)
    if len(query) < 2:
        return []

    # Fase 7: Garantías busca primero en el catálogo local sincronizado desde Planilla Madre.
    local = search_local_products(q, limit=limit)
    if local:
        out = []
        for item in local:
            provider = get_provider_for_brand(str(item.get("marca") or ""))
            out.append({
                "producto": item.get("producto") or item.get("descripcion") or item.get("sku") or "",
                "sku": item.get("sku") or "",
                "marca": item.get("marca") or "",
                "tipo": item.get("tipo") or "",
                "pvp_texto": item.get("pvp_text") or item.get("precio_texto") or "",
                "costo_texto": item.get("costo_text") or "",
                "provider_name": provider.get("name") if provider else "",
                "label": item.get("label") or "",
            })
        return out

    # Fallback de compatibilidad: lectura anterior desde Google Sheets si todavía no hay catálogo local.
    tokens = query.split()
    matches = []
    for item in load_product_catalog():
        haystack = item.get("search", "")
        if all(token in haystack for token in tokens):
            score = 0
            if haystack.startswith(query):
                score += 10
            if item.get("sku") and normalize_text(item["sku"]).startswith(query):
                score += 20
            matches.append((score, item))
    matches.sort(key=lambda pair: pair[0], reverse=True)
    return [{k: v for k, v in item.items() if k != "search"} for _, item in matches[:limit]]


@router.post("/entries", response_model=WarrantyCreateResponse)
def create_warranty_entries(data: WarrantyCreateRequest, user: Annotated[Any, Depends(require_current_user)]):
    settings = get_settings()
    if not settings.app_enabled:
        raise HTTPException(status_code=403, detail="La aplicación está deshabilitada por el administrador.")
    if getattr(user, "must_change_password", False):
        raise HTTPException(status_code=403, detail="Tenés que crear tu contraseña antes de continuar")

    # El rol DEPOSITO operativo debe poder cargar garantías de cliente en depósito
    # aunque el catálogo de roles local todavía no se haya resincronizado.
    # Para vendedores/gestores/admin seguimos usando warranties.create como permiso normal.
    #
    # Hotfix Fase 19:
    # En instalaciones existentes puede venir como branch_type="deposit", "deposito",
    # rol="DEPOSITO", o directamente por la branch asignada con nombre "Depósito ...".
    # Normalizamos sin acentos para no bloquear la carga operativa por un detalle de catálogo.
    def _assigned_deposit_branch(u: Any) -> dict[str, Any] | None:
        """Devuelve la branch depósito asignada aunque el token legacy no traiga branch_name.

        En instalaciones existentes el usuario DEPOSITO puede venir con role=DEPOSITO
        y la unidad real dentro de user.branches, pero branch_name/branch_type vacíos.
        La carga operativa no debe fallar por ese desfasaje.
        """
        for branch in assigned_branches(u):
            b_type = normalize_text(branch.get("type", ""))
            b_name = normalize_text(branch.get("name", ""))
            if b_type in {"DEPOSIT", "DEPOSITO"} or b_name.startswith("DEPOSITO ") or b_name == "DEPOSITO":
                return branch
        return None

    is_deposit_operator_for_permission = is_deposit_operator_user(user)
    if not user_has(user, "warranties.create") and not is_deposit_operator_for_permission:
        raise HTTPException(status_code=403, detail="No tenes permiso para realizar esta accion")

    # ── Perfil del usuario ─────────────────────────────────────────────────────
    # Fuente de verdad organizativa: usuario -> empresa -> branch asignada.
    assigned_deposit_branch = _assigned_deposit_branch(user)
    branch_type = str(getattr(user, "branch_type", "") or (assigned_deposit_branch or {}).get("type", "") or "").lower().strip()
    branch_type_key = normalize_text(branch_type)
    user_branch_id = str(getattr(user, "branch_id", "") or (assigned_deposit_branch or {}).get("id", "") or "").strip()
    user_branch_name = str(getattr(user, "branch_name", "") or getattr(user, "sucursal", "") or (assigned_deposit_branch or {}).get("name", "") or "").strip()
    user_branch_name_key = normalize_text(user_branch_name)
    user_company_id = str(getattr(user, "company_id", "") or (assigned_deposit_branch or {}).get("company_id", "") or "").strip()
    can_manage = user_has(user, "warranties.manage") or user_has(user, "warranties.manage_provider")

    if branch_type_key == "WEB":
        raise HTTPException(
            status_code=403,
            detail=(
                "Los usuarios de sucursal web no pueden registrar garantías directamente. "
                "Las garantías deben ingresarse desde la sucursal física o el depósito correspondiente."
            ),
        )

    is_sucursal_fisica = branch_type_key in {"PHYSICAL", "FISICA", "SUCURSAL", "SUCURSAL FISICA"} and not can_manage
    # Importante: tener una branch/rol de depósito NO debe encerrar a gestores/admin.
    # Para usuarios con permisos de gestión, la unidad asignada es un default visual;
    # la carga puede ser desde sucursal o depósito según el tipo elegido.
    is_deposito = is_deposit_operator_for_permission and not can_manage
    if not branch_type_key and not can_manage and user_branch_name:
        # Compatibilidad con usuarios legacy: sin branch_type pero con sucursal asignada.
        # Si el nombre asignado es Depósito..., tratarlo como depósito; si no, como sucursal.
        if user_branch_name_key.startswith("DEPOSITO ") or user_branch_name_key == "DEPOSITO":
            is_deposito = True
        else:
            is_sucursal_fisica = True

    options = runtime_warranty_options()
    branches_operativas: list[dict[str, str]] = options.get("branches_operativas") or []
    branches_map: dict[str, dict[str, str]] = {b["id"]: b for b in branches_operativas if b.get("id")}
    physical_branches = [b for b in branches_operativas if b.get("type") == "physical"]
    deposit_branches = [b for b in branches_operativas if b.get("type") == "deposit"]
    central_deposit_name = _warranty_central_deposit_name(branches_operativas)

    allowed_sucursales = {normalize_text(x) for x in ([b["name"] for b in physical_branches] or options.get("sucursales", []))}
    allowed_depositos = {normalize_text(x) for x in ([b["name"] for b in deposit_branches] or options.get("depositos", []))}

    if (is_sucursal_fisica or is_deposito) and not user_branch_name:
        raise HTTPException(
            status_code=403,
            detail="Tu usuario no tiene sucursal/depósito asignado. Pedile a un administrador que revise tu configuración.",
        )

    user_branch_info = branches_map.get(user_branch_id) if user_branch_id else None
    if user_branch_id and not user_branch_info:
        user_branch_info = _fetch_branch_info(user_branch_id)
        if user_branch_info:
            branches_map[user_branch_id] = user_branch_info
    if is_deposito and user_branch_info and normalize_text(user_branch_info.get("type", "")) not in {"DEPOSIT", "DEPOSITO"}:
        # Permitir compatibilidad si el nombre de la unidad es claramente un depósito.
        if not normalize_text(user_branch_info.get("name", "")).startswith("DEPOSITO "):
            raise HTTPException(status_code=403, detail="Tu usuario no está asignado a un depósito válido.")
    if is_sucursal_fisica and user_branch_info and normalize_text(user_branch_info.get("type", "")) not in {"PHYSICAL", "FISICA", "SUCURSAL", "SUCURSAL FISICA"}:
        raise HTTPException(status_code=403, detail="Tu usuario no está asignado a una sucursal física válida.")

    def _resolve_branch_by_id(branch_id: str, *, expected_type: str | None = None, label: str = "branch") -> dict[str, str]:
        clean_id = (branch_id or "").strip()
        if not clean_id:
            raise HTTPException(status_code=400, detail=f"Falta indicar {label}.")
        branch = branches_map.get(clean_id) or _fetch_branch_info(clean_id)
        if not branch:
            raise HTTPException(status_code=400, detail=f"{label} inexistente en el sistema (ID: {clean_id}).")
        branches_map[clean_id] = branch
        if expected_type and branch.get("type") != expected_type:
            raise HTTPException(status_code=400, detail=f"{label} debe ser de tipo {expected_type}.")
        return branch

    def _resolve_physical_by_name(name: str) -> dict[str, str] | None:
        return _branch_by_name(branches_operativas, name, "physical")

    def _resolve_deposit_by_name(name: str) -> dict[str, str] | None:
        return _branch_by_name(branches_operativas, name, "deposit")

    for item in data.items:
        tipo = (item.tipo_ingreso or "").strip()

        # Todo ingreso hecho desde sucursal tiene como destino operativo de garantías
        # el depósito Chiclana. Corrales/Cachi quedan para movimientos internos
        # posteriores hechos por usuarios de depósito.
        if tipo == "cliente_sucursal":
            object.__setattr__(item, "deposito", central_deposit_name)
            object.__setattr__(item, "lugar_llegada", central_deposit_name)

        # ── Seguridad por perfil ───────────────────────────────────────────────
        if is_sucursal_fisica:
            if tipo not in TIPOS_INGRESO_VENDEDOR:
                raise HTTPException(
                    status_code=403,
                    detail="Los usuarios de sucursal solo pueden cargar garantías como cliente_sucursal.",
                )
            # El frontend puede mostrar un dato, pero el backend fuerza lo real.
            object.__setattr__(item, "sucursal", user_branch_name)
            object.__setattr__(item, "deposito", (item.deposito or "").strip())
        elif is_deposito:
            # Personal operativo de depósito: carga acotada al cliente que llega al depósito.
            # Gestores/Admin con branch de depósito NO entran acá; caen en el bloque amplio de abajo.
            if tipo == "cliente_sucursal":
                raise HTTPException(status_code=403, detail="Los usuarios de depósito no pueden cargar como cliente_sucursal.")
            if tipo != "cliente_deposito":
                raise HTTPException(
                    status_code=403,
                    detail="Los usuarios de depósito solo pueden cargar garantías como cliente en depósito. Otras opciones quedan para gestión/admin.",
                )
            # El depósito de carga también es fuente de verdad backend.
            object.__setattr__(item, "deposito", user_branch_name)
        else:
            # Gestor/admin/encargado puede operar más amplio, pero siempre validado.
            # Si carga desde sucursal, debe poder elegir la sucursal responsable/carga.
            # Si carga desde depósito y no eligió uno, sugerimos la unidad asignada si es depósito.
            if tipo != "cliente_sucursal" and not (item.deposito or "").strip() and user_branch_name:
                object.__setattr__(item, "deposito", user_branch_name)

        if tipo == "cliente_sucursal":
            if allowed_sucursales and normalize_text(item.sucursal) not in allowed_sucursales:
                raise HTTPException(status_code=400, detail=f"Sucursal inválida: {item.sucursal}")
        if allowed_depositos and (item.deposito or "").strip() and normalize_text(item.deposito) not in allowed_depositos:
            raise HTTPException(status_code=400, detail=f"Depósito inválido: {item.deposito}")

        # cliente_deposito requiere sucursal responsable real o fallback textual.
        suc_resp_id = (item.sucursal_responsable_id or "").strip()
        if suc_resp_id:
            branch = _resolve_branch_by_id(suc_resp_id, expected_type="physical", label="Sucursal responsable")
            object.__setattr__(item, "sucursal_responsable", branch.get("name", ""))
        elif (item.sucursal_responsable or "").strip():
            branch = _resolve_physical_by_name(item.sucursal_responsable)
            if branch:
                object.__setattr__(item, "sucursal_responsable_id", branch.get("id", ""))
                object.__setattr__(item, "sucursal_responsable", branch.get("name", ""))

        if tipo == "cliente_deposito":
            if not (item.sucursal_responsable_id or item.sucursal_responsable or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="Cuando el cliente deja el producto en depósito, indicá la sucursal donde compró.",
                )

        if tipo in {"cliente_sucursal", "cliente_deposito"}:
            if not (item.cliente_nombre or "").strip():
                raise HTTPException(status_code=400, detail="Indicá el nombre del cliente.")
            if not (item.cliente_telefono or "").strip():
                raise HTTPException(status_code=400, detail="Indicá el teléfono del cliente.")
            if not (item.numero_factura or "").strip():
                raise HTTPException(status_code=400, detail="Indicá el número de factura o ticket.")
            if not (item.fecha_compra or "").strip():
                raise HTTPException(status_code=400, detail="Indicá la fecha de compra.")

    def _derive_org_fields(item: WarrantyItemIn) -> dict[str, str]:
        """Campos organizativos definitivos para guardar la garantía.

        Fuente de verdad:
        - branch_id guarda la unidad de carga: sucursal física o depósito asignado/usado.
        - sucursal_responsable_id guarda la sucursal comercial responsable.
        - company_id se deriva de la sucursal responsable cuando corresponde.
        """
        tipo = (item.tipo_ingreso or "").strip()
        s_resp_id = (item.sucursal_responsable_id or "").strip()
        s_resp_name = (item.sucursal_responsable or "").strip()
        s_resp_branch = branches_map.get(s_resp_id) if s_resp_id else None

        if is_sucursal_fisica:
            branch = user_branch_info or {"id": user_branch_id, "name": user_branch_name, "company_id": user_company_id}
            return {
                "sucursal_carga": branch.get("name") or user_branch_name,
                "sucursal_carga_bid": branch.get("id") or user_branch_id,
                "sucursal_responsable": branch.get("name") or user_branch_name,
                "sucursal_responsable_id": branch.get("id") or user_branch_id,
                "company_id": branch.get("company_id") or user_company_id,
            }

        if is_deposito:
            deposit_branch = user_branch_info or {"id": user_branch_id, "name": user_branch_name, "company_id": user_company_id}
            if tipo == "cliente_deposito":
                # La garantía se imputa a la empresa de la sucursal donde compró el cliente.
                company_id = (s_resp_branch or {}).get("company_id") or user_company_id
                return {
                    "sucursal_carga": deposit_branch.get("name") or user_branch_name,
                    "sucursal_carga_bid": deposit_branch.get("id") or user_branch_id,
                    "sucursal_responsable": s_resp_name,
                    "sucursal_responsable_id": s_resp_id,
                    "company_id": company_id,
                }
            # Falla recepción / stock interno: nace y se imputa operativamente al depósito.
            return {
                "sucursal_carga": deposit_branch.get("name") or user_branch_name,
                "sucursal_carga_bid": deposit_branch.get("id") or user_branch_id,
                "sucursal_responsable": s_resp_name or (deposit_branch.get("name") or user_branch_name),
                "sucursal_responsable_id": s_resp_id,
                "company_id": (deposit_branch.get("company_id") or user_company_id),
            }

        # Gestor/admin con libertad, pero derivando IDs/empresa cuando hay branches reales.
        if tipo == "cliente_sucursal":
            branch = _resolve_physical_by_name(item.sucursal) or {}
            company_id = branch.get("company_id") or (s_resp_branch or {}).get("company_id") or user_company_id
            return {
                "sucursal_carga": branch.get("name") or (item.sucursal or "").strip(),
                "sucursal_carga_bid": branch.get("id", ""),
                "sucursal_responsable": s_resp_name or branch.get("name") or (item.sucursal or "").strip(),
                "sucursal_responsable_id": s_resp_id or branch.get("id", ""),
                "company_id": company_id,
            }

        deposit_branch = _resolve_deposit_by_name(item.deposito) or user_branch_info or {}
        company_id = (s_resp_branch or {}).get("company_id") or deposit_branch.get("company_id") or user_company_id
        return {
            "sucursal_carga": deposit_branch.get("name") or user_branch_name or (item.deposito or "").strip(),
            "sucursal_carga_bid": deposit_branch.get("id") or user_branch_id,
            "sucursal_responsable": s_resp_name or (deposit_branch.get("name") or user_branch_name or ""),
            "sucursal_responsable_id": s_resp_id,
            "company_id": company_id,
        }

    derived = [_derive_org_fields(item) for item in data.items]

    if data.group_under_one_id:
        first_d = derived[0]
        first_item = data.items[0]
        first_cs = normalize_text(_code_source_for_tipo(first_d["sucursal_carga"], first_item.deposito, first_item.tipo_ingreso))
        for d, it in zip(derived[1:], data.items[1:]):
            cs = normalize_text(_code_source_for_tipo(d["sucursal_carga"], it.deposito, it.tipo_ingreso))
            if cs != first_cs:
                raise HTTPException(
                    status_code=400,
                    detail="Para usar un mismo ID, todas las filas deben tener la misma sucursal/depósito de origen.",
                )

    created: list[WarrantyCreatedItem] = []
    ids: list[str] = []
    # Fase 2.5h.2b: alta de garantías sobre Postgres mediante helpers pg_*.
    if data.group_under_one_id:
        # Fase 34: “todo pertenece a una sola garantía” significa mismo caso madre,
        # pero cada producto nace como garantía operativa independiente.
        # Ej: GAR-2026-CAS-0005-01, GAR-2026-CAS-0005-02.
        # Así revisión, remitos, ENV/proveedor y resolución pueden trabajar ítem por ítem.
        first_item = data.items[0]
        d0 = derived[0]
        code_source = _code_source_for_tipo(d0["sucursal_carga"], first_item.deposito, first_item.tipo_ingreso)
        parent_code = pg_next_warranty_code(code_source)
        total_items = len(data.items)
        for idx, (item, d) in enumerate(zip(data.items, derived), start=1):
            warranty_code = f"{parent_code}-{idx:02d}"
            tipo = (item.tipo_ingreso or "").strip()
            ingreso_iso = ingreso_at_from_input(item.fecha_ingreso)
            origen = _origen_from_tipo(tipo)
            ubicacion = _initial_ubicacion_actual(tipo, d["sucursal_carga"], (item.deposito or "").strip())
            transit = "en_deposito" if origen == "deposito" else ""
            guarantee_id = pg_insert_guarantee(
                warranty_code=warranty_code,
                user=user,
                item=item,
                sucursal_carga=d["sucursal_carga"],
                sucursal_carga_branch_id=d["sucursal_carga_bid"],
                sucursal_responsable_override=d["sucursal_responsable"],
                sucursal_responsable_id_override=d["sucursal_responsable_id"],
                company_id_override=d["company_id"],
                parent_warranty_code=parent_code,
                parent_item_index=idx,
                default_status=DEFAULT_STATUSES[0],
                origen_ingreso=origen,
                ubicacion_actual=ubicacion,
                transit_status=transit,
                ingreso_at_iso=ingreso_iso,
            )
            pg_insert_item(guarantee_id=guarantee_id, item=item, item_index=idx)
            pg_add_history(
                guarantee_id=guarantee_id,
                warranty_code=warranty_code,
                user=user,
                action="created",
                new_status=DEFAULT_STATUSES[0],
                note="Ítem de garantía agrupada creado",
                details={
                    "items": 1,
                    "grouped": True,
                    "parent_warranty_code": parent_code,
                    "parent_item_index": idx,
                    "parent_items_total": total_items,
                    "fecha_ingreso": date_input_from_iso(ingreso_iso),
                    "tipo_ingreso": item.tipo_ingreso,
                },
            )
            created.append(WarrantyCreatedItem(id_garantia=warranty_code, producto=item.producto, sku=item.sku, parent_warranty_code=parent_code, parent_item_index=idx))
            ids.append(warranty_code)
    else:
        for item, d in zip(data.items, derived):
            code_source = _code_source_for_tipo(d["sucursal_carga"], item.deposito, item.tipo_ingreso)
            warranty_code = pg_next_warranty_code(code_source)
            tipo = (item.tipo_ingreso or "").strip()
            ingreso_iso = ingreso_at_from_input(item.fecha_ingreso)
            origen = _origen_from_tipo(tipo)
            ubicacion = _initial_ubicacion_actual(tipo, d["sucursal_carga"], (item.deposito or "").strip())
            transit = "en_deposito" if origen == "deposito" else ""
            guarantee_id = pg_insert_guarantee(
                warranty_code=warranty_code,
                user=user,
                item=item,
                sucursal_carga=d["sucursal_carga"],
                sucursal_carga_branch_id=d["sucursal_carga_bid"],
                sucursal_responsable_override=d["sucursal_responsable"],
                sucursal_responsable_id_override=d["sucursal_responsable_id"],
                company_id_override=d["company_id"],
                default_status=DEFAULT_STATUSES[0],
                origen_ingreso=origen,
                ubicacion_actual=ubicacion,
                transit_status=transit,
                ingreso_at_iso=ingreso_iso,
            )
            pg_insert_item(guarantee_id=guarantee_id, item=item, item_index=1)
            pg_add_history(
                guarantee_id=guarantee_id,
                warranty_code=warranty_code,
                user=user,
                action="created",
                new_status=DEFAULT_STATUSES[0],
                note="Garantía creada",
                details={"items": 1, "grouped": False, "fecha_ingreso": date_input_from_iso(ingreso_iso), "tipo_ingreso": item.tipo_ingreso},
            )
            created.append(WarrantyCreatedItem(id_garantia=warranty_code, producto=item.producto, sku=item.sku))
            ids.append(warranty_code)
    audit("warranties.create", user=user, resource_type="warranty", resource_id=",".join(unique_keep_order(ids)), details={"count": len(created), "ids": unique_keep_order(ids), "source": "database"})
    return WarrantyCreateResponse(ok=True, count=len(created), ids=ids, items=created)

