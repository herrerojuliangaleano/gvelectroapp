"""
Router de remitos internos para tránsito físico de garantías.

Regla de negocio:
  REM = traslado físico interno sucursal → depósito.
  ENV = lote administrativo/proveedor.

Este router NO debe crear remitos a partir de lotes ENV ni usar shipment_code
como criterio de logística interna. El remito solo mueve físicamente garantías
que nacieron en sucursal y todavía están en sucursal.

Flujo:
  1. Sucursal/gestor selecciona garantías disponibles y genera REM.
  2. El destino de remitos de sucursal siempre es Depósito Chiclana.
  3. Sucursal despacha productos → status=en_transito.
  4. Depósito confirma llegada → status=llegado y ubicación física=deposito.
"""
from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ...access import users_with_permission
from ...audit import audit
from ...auth import require_current_user, require_permission
from ...pdf_remito import BRANDS, generate_provider_delivery_pdf, generate_remito_pdf
from ...remitos_db import (
    pg_available_warranties_for_deposit_transfer,
    pg_available_warranties_for_provider_delivery,
    pg_available_warranties_for_remito,
    pg_confirm_arrival,
    pg_confirm_warranties_remito_arrival,
    pg_create_remito,
    pg_delete_remito,
    pg_deposit_branches,
    pg_dispatch_remito,
    pg_get_remito_by_code,
    pg_list_remitos,
    pg_load_warranties_for_codes,
    pg_mark_warranties_in_transit,
    pg_mark_warranties_provider_delivery,
    pg_next_provider_delivery_code,
    pg_next_remito_code,
    pg_resolve_remito_brand,
    pg_unlink_warranties_from_remito,
    pg_warranty_central_deposit_name,
)
from ...warranty_helpers import (
    REVIEW_APPROVED,
    format_datetime_ar,
    now_ar,
    parse_iso_datetime,
    utc_now_iso,
)
from ...warranties_db import pg_add_history, pg_fetch_guarantee_with_items
from ..notifications import notify_many

router = APIRouter(prefix="/api/warranties/remitos", tags=["remitos"])

# ── Mappers ─────────────────────────────────────────────────────────────────

def row_to_remito(row: dict[str, Any], warranties: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    try:
        ids = json.loads(str(row["warranty_ids_json"] or "[]"))
    except Exception:
        ids = []
    brand_info = BRANDS.get(str(row["company_brand"] or "gv_electro"), BRANDS["gv_electro"])
    created_display  = format_datetime_ar(parse_iso_datetime(row["created_at"]))  if row["created_at"]    else ""
    despacho_display = format_datetime_ar(parse_iso_datetime(row["fecha_despacho"])) if row["fecha_despacho"] else ""
    llegada_display  = format_datetime_ar(parse_iso_datetime(row["fecha_llegada"]))  if row["fecha_llegada"]  else ""
    return {
        "id":                       int(row["id"]),
        "remito_code":              str(row["remito_code"]),
        "shipment_code":            str(row["shipment_code"] or ""),
        "tipo_remito":              str(row["tipo_remito"] or "sucursal_a_deposito") if "tipo_remito" in row.keys() else "sucursal_a_deposito",
        "company_brand":            str(row["company_brand"] or "gv_electro"),
        "company_name":             brand_info["name"],
        "origen_sucursal":          str(row["origen_sucursal"] or ""),
        "destino_deposito":         str(row["destino_deposito"] or ""),
        "warranty_ids":             ids,
        "warranties_count":         len(ids),
        "proveedor":                str(row["proveedor"] or ""),
        "status":                   str(row["status"] or "pendiente"),
        "created_at":               str(row["created_at"] or ""),
        "created_at_display":       created_display,
        "created_by":               str(row["created_by"] or ""),
        "created_by_name":          str(row["created_by_name"] or ""),
        "fecha_despacho":           str(row["fecha_despacho"] or ""),
        "fecha_despacho_display":   despacho_display,
        "despachado_por_name":      str(row["despachado_por_name"] or ""),
        "fecha_llegada":            str(row["fecha_llegada"] or ""),
        "fecha_llegada_display":    llegada_display,
        "recibido_por_name":        str(row["recibido_por_name"] or ""),
        "nota":                     str(row["nota"] or ""),
        "warranties":               warranties if warranties is not None else [],
    }


def _notify_warranty_managers(title: str, message: str) -> None:
    """Envia notificacion a todos los usuarios con permiso warranties.manage_provider."""
    try:
        manager_usernames = users_with_permission("warranties.manage_provider")
        if manager_usernames:
            notify_many(manager_usernames, title, message, type_="warning")
    except Exception:
        pass  # notificaciones no son criticas


# ── Modelos ──────────────────────────────────────────────────────────────────

class GenerateRemitosRequest(BaseModel):
    destino_deposito: str = Field(min_length=1)
    # Fase 4: shipment_code queda solo por compatibilidad de payload viejo.
    # No se usa para generar remitos porque ENV/proveedor es otro flujo.
    shipment_code:    str | None = None
    warranty_codes:   list[str] | None = None
    sucursal:         str | None = None
    nota:             str | None = None


class DispatchRemitoRequest(BaseModel):
    lugar_salida: str | None = None
    nota:         str | None = None


class ConfirmArrivalRequest(BaseModel):
    remito_code:   str = Field(min_length=1)          # confirmación doble: ingresar el código
    lugar_llegada: str | None = None                   # si difiere del destino_deposito del lote
    nota:          str | None = None


class DepositTransferRequest(BaseModel):
    destino_deposito: str = Field(min_length=1)
    warranty_codes: list[str] = Field(min_length=1)
    nota: str | None = None
    # Origen explícito (opcional). Si el usuario tiene acceso a más de un depósito
    # —ya sea por sus branches asignadas con type='deposit' o por el permiso
    # branches.cross_select—, puede elegir desde cuál mover. Si no se manda, el
    # backend usa la sucursal principal del usuario (comportamiento anterior).
    origen_deposito: str | None = None


class ProviderDeliveryRequest(BaseModel):
    warranty_codes: list[str] = Field(min_length=1)
    proveedor:      str = Field(min_length=1)
    nota:           str | None = None


class BatchPickupRequest(BaseModel):
    shipment_code:         str = Field(min_length=1)
    punto_retiro:          str = Field(min_length=1)
    tipo_retiro:           str = Field(min_length=1)  # retira_proveedor | llevamos | flete
    destino_deposito:      str = Field(min_length=1)  # dónde consolidar antes del retiro
    fecha_retiro_acordada: str | None = None
    respuesta_proveedor:   str | None = None


# ── Helper: notificar usuarios de una sucursal ────────────────────────────────

def _notify_remitos_view_users(title: str, message: str) -> None:
    """Notifica a usuarios con seguimiento de remitos."""
    try:
        targets = users_with_permission("warranties.remitos.view")
        if targets:
            notify_many(targets, title, message, type_="warning")
    except Exception:
        pass


def _notify_gestor_garantias(title: str, message: str) -> None:
    """Notifica a usuarios con permiso warranties.remitos.provider_delivery."""
    try:
        targets = users_with_permission("warranties.remitos.provider_delivery")
        if targets:
            notify_many(targets, title, message, type_="warning")
    except Exception:
        pass


def _remito_ids(row: dict[str, Any]) -> list[str]:
    try:
        ids = row.get("warranty_ids") if isinstance(row, dict) else None
        if isinstance(ids, list):
            return [str(code).strip() for code in ids if str(code).strip()]
    except Exception:
        pass
    try:
        raw = row["warranty_ids_json"]
    except Exception:
        raw = "[]"
    try:
        return [str(code).strip() for code in json.loads(str(raw or "[]")) if str(code).strip()]
    except Exception:
        return []


def _add_history_for_codes(
    codes: list[str],
    user: Any,
    action: str,
    *,
    note: str,
    details: dict[str, Any] | None = None,
) -> None:
    for wcode in codes:
        result = pg_fetch_guarantee_with_items(wcode)
        if not result:
            continue
        row, _items = result
        pg_add_history(
            guarantee_id=int(row["id"]),
            warranty_code=wcode,
            user=user,
            action=action,
            note=note,
            details=details or {},
        )


# ── Endpoints ────────────────────────────────────────────────────────────────

def _confirm_arrival_update(row: dict[str, Any], data: ConfirmArrivalRequest, user: Any) -> dict[str, Any]:
    """Aplica la llegada de un remito ya encontrado.

    Se usa tanto desde /{remito_code}/confirm-arrival como desde el endpoint
    estático /confirm-arrival-by-code. Mantenerlo centralizado evita que la UI
    dependa de una búsqueda previa y reduce errores de ruteo/seguimiento.
    """
    remito_code = str(row["remito_code"] or "")
    code_input = data.remito_code.strip().upper()
    if code_input != remito_code.strip().upper():
        raise HTTPException(400, "El código ingresado no coincide con el remito.")

    if str(row["status"]) == "llegado":
        raise HTTPException(400, "Este remito ya fue confirmado como llegado.")

    actor    = getattr(user, "username", "") or ""
    ids = _remito_ids(row)

    destino  = data.lugar_llegada.strip() if data.lugar_llegada else str(row["destino_deposito"] or "")
    tipo_rem = str(row["tipo_remito"] or "sucursal_a_deposito") if "tipo_remito" in row.keys() else "sucursal_a_deposito"

    updated = pg_confirm_arrival(
        remito_code=remito_code,
        recibido_por_username=actor,
        nota=(data.nota or "").strip(),
    )
    if not updated:
        raise HTTPException(404, f"Remito {remito_code} no encontrado.")
    pg_confirm_warranties_remito_arrival(
        warranty_codes=ids,
        remito_code=remito_code,
        destino=destino,
        tipo_remito=tipo_rem,
        updated_by_username=actor,
    )
    if tipo_rem == "deposito_a_proveedor":
        _add_history_for_codes(
            ids,
            user,
            "provider_delivery_confirmed",
            note=f"Remito {remito_code} confirmado: producto entregado a {destino}",
            details={"remito": remito_code, "proveedor": destino},
        )
    else:
        _add_history_for_codes(
            ids,
            user,
            "remito_arrival",
            note=f"Remito {remito_code} confirmado en {destino}",
            details={"remito": remito_code, "destino": destino},
        )

    return {"ok": True, "remito_code": remito_code, "status": "llegado", "destino": destino, "lote_consolidado": False}

# Sub-routers (Fase 3.B.2)
# Lifecycle va ultimo porque concentra rutas /{remito_code}/...
from . import availability as _availability_module  # noqa: E402
from . import deposit_transfer as _deposit_transfer_module  # noqa: E402
from . import provider as _provider_module  # noqa: E402
from . import generation as _generation_module  # noqa: E402
from . import listing as _listing_module  # noqa: E402
from . import receive as _receive_module  # noqa: E402
from . import lookup as _lookup_module  # noqa: E402
from . import lifecycle as _lifecycle_module  # noqa: E402

router.include_router(_availability_module.router)
router.include_router(_deposit_transfer_module.router)
router.include_router(_provider_module.router)
router.include_router(_generation_module.router)
router.include_router(_listing_module.router)
router.include_router(_receive_module.router)
router.include_router(_lookup_module.router)
router.include_router(_lifecycle_module.router)
