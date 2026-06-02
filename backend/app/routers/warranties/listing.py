"""Sub-router de listados de garantias.

Endpoints:
  GET /list       - listado operativo con filtros
  GET /management - bandeja de gestion proveedor
  GET /delayed    - bandeja de demoradas

`list_warranties()` se sigue exportando para que el bloque de exports que aun
vive en ``__init__.py`` pueda reutilizar exactamente la misma logica.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from ...auth import require_permission
from ...warranties_db import pg_fetch_all_guarantee_rows
from ...warranty_helpers import normalize_text, parse_date_filter
from . import (
    WARRANTY_PRIVILEGED_ROLES,
    WarrantyListResponse,
    WarrantySummary,
    _user_role_keys,
    deny_plain_deposit_operator,
    normalize_status,
    review_status_matches,
    row_to_summary,
    status_matches,
)


router = APIRouter(tags=["warranties"])


@router.get("/list", response_model=WarrantyListResponse)
def list_warranties(
    user: Annotated[Any, Depends(require_permission("warranties.view"))],
    q: str = "",
    sucursal: str = "",
    estado: str = "",
    review_status: str = "",
    deposito: str = "",
    marca: str = "",
    proveedor: str = "",
    tipo_ingreso: str = "",
    origen_ingreso: str = "",
    transit_status: str = "",
    ubicacion_actual: str = "",
    estado_retiro_proveedor: str = "",
    demora_min: int = Query(default=0, ge=0, le=3650),
    fecha_desde: str = "",
    fecha_hasta: str = "",
    limit: int = Query(default=200, ge=1, le=1000),
    sucursal_logistics: bool = Query(default=False),
):
    user_perms = set(getattr(user, "permissions", []) or [])
    roles = _user_role_keys(user)
    can_manage = (
        "*" in user_perms
        or "warranties.manage" in user_perms
        or "warranties.manage_provider" in user_perms
        or bool(roles & WARRANTY_PRIVILEGED_ROLES)
        or bool(getattr(user, "has", lambda _p: False)("warranties.manage"))
        or bool(getattr(user, "has", lambda _p: False)("warranties.manage_provider"))
    )
    user_sucursal = str(getattr(user, "sucursal", "") or "").strip()
    user_branch_id = str(getattr(user, "branch_id", "") or "").strip()
    user_branch_type = str(getattr(user, "branch_type", "") or "").strip().lower()
    is_branch_operator = not can_manage and user_branch_type not in {"deposit", "admin"}
    if is_branch_operator and user_sucursal and not sucursal.strip() and not user_branch_id:
        sucursal = user_sucursal

    rows, all_items = pg_fetch_all_guarantee_rows()
    by_gid: dict[int, list[dict[str, Any]]] = {}
    for item in all_items:
        by_gid.setdefault(int(item["guarantee_id"]), []).append(item)

    summaries = [row_to_summary(row, by_gid.get(int(row["id"]), [])) for row in rows]
    q_tokens = normalize_text(q).split()
    suc_key = normalize_text(sucursal)
    dep_key = normalize_text(deposito)
    est_key = normalize_text(estado)
    marca_key = normalize_text(marca)
    proveedor_key = normalize_text(proveedor)
    tipo_ingreso_key = normalize_text(tipo_ingreso)
    origen_ingreso_key = str(origen_ingreso or "").strip()
    review_key = str(review_status or "").strip()
    date_from = parse_date_filter(fecha_desde)
    date_to = parse_date_filter(fecha_hasta)

    def match(item: WarrantySummary) -> bool:
        if not can_manage:
            if user_branch_id:
                if item.branch_id != user_branch_id and item.sucursal_responsable_id != user_branch_id:
                    return False
            elif user_sucursal and normalize_text(item.sucursal) != normalize_text(user_sucursal):
                return False

            if is_branch_operator and not sucursal_logistics:
                ubicacion = str(item.ubicacion_actual or "").strip().lower()
                transit = str(item.transit_status or "").strip().lower()
                status_norm = normalize_status(item.estado)
                has_active_remito = bool(str(item.remito_interno or "").strip()) and transit != "cancelado"
                if status_norm in {"9 - ANULADA", "10 - FINALIZADO"}:
                    return False
                if ubicacion:
                    allowed_locations = {"sucursal"}
                    if item.sucursal:
                        allowed_locations.add(str(item.sucursal or "").strip().lower())
                    if user_sucursal:
                        allowed_locations.add(str(user_sucursal or "").strip().lower())
                    if ubicacion not in allowed_locations:
                        return False
                else:
                    if has_active_remito or transit in {"en_transito", "en_deposito", "llegado"}:
                        return False
                if has_active_remito or transit in {"en_transito", "en_deposito", "llegado"}:
                    return False
        if suc_key:
            sucursal_values = {
                normalize_text(item.sucursal),
                normalize_text(item.sucursal_responsable),
            }
            if suc_key not in sucursal_values:
                return False
        if dep_key and normalize_text(item.deposito) != dep_key and normalize_text(item.lugar_llegada) != dep_key:
            return False
        if est_key and not status_matches(item.estado, estado):
            return False
        if tipo_ingreso_key and normalize_text(item.tipo_ingreso) != tipo_ingreso_key:
            return False
        if origen_ingreso_key and item.origen_ingreso != origen_ingreso_key:
            return False
        if marca_key and marca_key not in normalize_text(" ".join(item.productos)) and marca_key not in normalize_text(item.producto_principal):
            item_rows = by_gid.get(
                next((int(r["id"]) for r in rows if str(r["warranty_code"] or "") == item.id_garantia), -1),
                [],
            )
            if not any(normalize_text(x["marca"]) == marca_key for x in item_rows):
                return False
        if proveedor_key and normalize_text(item.provider_name) != proveedor_key:
            return False
        if demora_min and (item.dias_sin_respuesta is None or item.dias_sin_respuesta < demora_min):
            return False
        if review_key and not review_status_matches(item.review_status, review_status):
            return False
        transit_key = str(transit_status or "").strip().lower()
        if transit_key and item.transit_status != transit_key:
            return False
        ubicacion_key = str(ubicacion_actual or "").strip().lower()
        if ubicacion_key and item.ubicacion_actual != ubicacion_key:
            return False
        retiro_key = str(estado_retiro_proveedor or "").strip().lower()
        if retiro_key and item.estado_retiro_proveedor != retiro_key:
            return False
        ingreso_date = parse_date_filter(item.ingreso)
        if date_from and ingreso_date and ingreso_date < date_from:
            return False
        if date_to and ingreso_date and ingreso_date > date_to:
            return False
        if q_tokens:
            haystack = normalize_text(" ".join([
                item.id_garantia,
                item.producto_principal,
                " ".join(item.productos),
                item.sku,
                item.serie,
                item.falla,
                item.responsable,
                item.sucursal,
                item.estado,
                item.deposito,
                item.provider_name,
                item.id_de_caso,
            ]))
            return all(token in haystack for token in q_tokens)
        return True

    filtered = [item for item in summaries if match(item)]
    total = len(filtered)
    return WarrantyListResponse(items=filtered[:limit], total=total, limit=limit)


@router.get("/management", response_model=WarrantyListResponse)
def management_warranties(
    _user: Annotated[Any, Depends(require_permission("warranties.manage_provider"))],
    q: str = "",
    marca: str = "",
    proveedor: str = "",
    sucursal: str = "",
    deposito: str = "",
    estado: str = "",
    review_status: str = "revisada",
    include_pending: bool = False,
    demora_min: int = Query(default=0, ge=0, le=3650),
    limit: int = Query(default=300, ge=1, le=1000),
):
    deny_plain_deposit_operator(_user, "gestionar proveedor")
    return list_warranties(
        _user,
        q=q,
        marca=marca,
        proveedor=proveedor,
        sucursal=sucursal,
        deposito=deposito,
        estado=estado,
        review_status=review_status,
        demora_min=demora_min,
        limit=limit,
    )


@router.get("/delayed", response_model=WarrantyListResponse)
def delayed_warranties(
    _user: Annotated[Any, Depends(require_permission("warranties.manage_provider"))],
    q: str = "",
    marca: str = "",
    proveedor: str = "",
    sucursal: str = "",
    deposito: str = "",
    limit: int = Query(default=300, ge=1, le=1000),
):
    deny_plain_deposit_operator(_user, "ver gestion proveedor")
    return list_warranties(
        _user,
        q=q,
        marca=marca,
        proveedor=proveedor,
        sucursal=sucursal,
        deposito=deposito,
        demora_min=7,
        limit=limit,
    )
