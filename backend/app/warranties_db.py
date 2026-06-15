"""Capa de datos Postgres para Garantías.

Estado: ``routers/warranties.py`` delega en estas funciones para los endpoints
vivos de garantías, dashboard, exportación y sincronización espejo.

Contrato de salida:
- Las funciones que devuelven "filas" devuelven ``dict`` con las MISMAS claves
  que el SQL legacy de SQLite (``responsible_username``, ``responsible_name``,
  ``created_by``, ``created_by_name``, ``updated_by``, ``updated_by_name``,
  ``reviewed_by``, ``reviewed_by_name``, ``cancelled_by``, ``parent_warranty_code``,
  ``actor_username``, ``actor_name``, etc.). Esto permite que los mappers del
  router (``row_to_summary``, ``item_to_row``, ``history_for_guarantee``) sigan
  funcionando sin tocarse.
- Los joins a ``users`` resuelven los IDs FK a su username y display_name.

Concurrencia del contador:
- ``pg_next_warranty_code`` reemplaza el ``RLock`` del módulo legacy por un
  ``SELECT ... FOR UPDATE`` sobre la fila ``guarantee_counters(year, sucursal_code)``.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from .db import db_session
from .models.auth import User
from .models.warranties import (
    Guarantee,
    GuaranteeCounter,
    GuaranteeExport,
    GuaranteeHistory,
    GuaranteeItem,
)
from .warranty_helpers import REVIEW_PENDING, now_ar


# ── helpers internos ────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        text_val = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text_val)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _parse_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text_val = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text_val[:10], fmt).date()
        except Exception:
            continue
    return None


def _iso_or_empty(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def _date_iso_or_empty(d: date | None) -> str:
    return d.isoformat() if d else ""


def _resolve_user_id(session: Session, username: Any) -> int | None:
    """username → users.id (case-insensitive). Devuelve None si no existe o vacío."""
    if not username:
        return None
    uname = str(username).strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(func.lower(User.username) == uname))


def _user_username_and_name(session: Session, user_id: int | None) -> tuple[str, str]:
    """user_id → (username, display_name). ("", "") si user_id es None."""
    if not user_id:
        return "", ""
    u = session.get(User, user_id)
    if not u:
        return "", ""
    return u.username or "", u.display_name or u.username or ""


def _sucursal_code(sucursal: str) -> str:
    """Misma lógica que ``warranties.sucursal_code`` (replicada acá para no cross-importar)."""
    import unicodedata
    text_val = "" if sucursal is None else str(sucursal)
    text_val = unicodedata.normalize("NFKD", text_val)
    text_val = "".join(ch for ch in text_val if not unicodedata.combining(ch))
    text_val = text_val.upper().strip()
    text_val = re.sub(r"^\s*\d+\s*[-.)]\s*", "", text_val).strip()
    text_val = re.sub(r"[^A-Z0-9]+", "", text_val)
    mapping = {
        "CASEROS": "CAS",
        "LANUS": "LAN",
        "LANUSOESTE": "LAN",
        "CANNING": "CAN",
        "NORCENTER": "NOR",
        "NORTE": "NOR",
        "CHICLANA": "CHI",
        "DEPOSITOCHICLANA": "CHI",
        "CORRALES": "COR",
        "DEPOSITOCORRALES": "COR",
        "CACHI": "CAC",
        "DEPOSITOCACHI": "CAC",
    }
    return mapping.get(text_val, text_val[:3] or "GEN")


# ── Counter (SELECT FOR UPDATE) ──────────────────────────────────────────────

def pg_next_warranty_code(sucursal: str) -> str:
    """Reserva el siguiente warranty_code de la sucursal.

    Reemplaza al ``COUNTER_LOCK`` (RLock) del módulo legacy. La concurrencia se
    resuelve a nivel DB con SELECT ... FOR UPDATE sobre la fila del contador.
    """
    code = _sucursal_code(sucursal)
    year = now_ar().year
    with db_session() as session:
        row = session.execute(
            select(GuaranteeCounter)
            .where(and_(GuaranteeCounter.year == year, GuaranteeCounter.sucursal_code == code))
            .with_for_update()
        ).scalar_one_or_none()
        if row is None:
            row = GuaranteeCounter(year=year, sucursal_code=code, last_number=0)
            session.add(row)
            session.flush()
        # Salvaguarda: tomar también el máximo observable en guarantees por si se
        # migraron warranty_codes sin actualizar el contador.
        like_pattern = f"GAR-{year}-{code}-%"
        existing_codes = session.scalars(
            select(Guarantee.warranty_code).where(Guarantee.warranty_code.like(like_pattern))
        ).all()
        last = row.last_number
        rx = re.compile(rf"GAR-{year}-{re.escape(code)}-(\d+)(?:-\d+)?")
        for c in existing_codes:
            m = rx.fullmatch(str(c or ""))
            if m:
                last = max(last, int(m.group(1)))
        next_number = last + 1
        row.last_number = next_number
        session.commit()
        return f"GAR-{year}-{code}-{next_number:04d}"


def pg_next_shipment_code() -> str:
    year = now_ar().year
    prefix = f"ENV-{year}-"
    with db_session() as session:
        existing = session.scalars(
            select(GuaranteeExport.shipment_code).where(GuaranteeExport.shipment_code.like(f"{prefix}%"))
        ).all()
    last = 0
    rx = re.compile(rf"ENV-{year}-(\d+)")
    for s in existing:
        m = rx.fullmatch(str(s or ""))
        if m:
            last = max(last, int(m.group(1)))
    return f"{prefix}{(last + 1):04d}"


# ── Mappers ORM → dict legacy ───────────────────────────────────────────────

def _guarantee_to_dict(g: Guarantee, session: Session, *, with_parent_code: bool = True) -> dict[str, Any]:
    """ORM Guarantee → dict con las MISMAS claves del SQL legacy.

    Hace los joins necesarios a users para devolver username/display_name en vez
    de IDs, manteniendo compatibilidad con ``row_to_summary``.
    """
    resp_user, resp_name = _user_username_and_name(session, g.responsible_user_id)
    created_by, created_by_name = _user_username_and_name(session, g.created_by_user_id)
    updated_by, updated_by_name = _user_username_and_name(session, g.updated_by_user_id)
    reviewed_by, reviewed_by_name = _user_username_and_name(session, g.reviewed_by_user_id)
    cancelled_by, _cancelled_by_name = _user_username_and_name(session, g.cancelled_by_user_id)

    parent_code = ""
    if with_parent_code and g.parent_id:
        parent_code = session.scalar(select(Guarantee.warranty_code).where(Guarantee.id == g.parent_id)) or ""

    return {
        "id": g.id,
        "warranty_code": g.warranty_code,
        "parent_warranty_code": parent_code,
        "parent_item_index": g.parent_item_index or 0,
        "status": g.status,
        "review_status": g.review_status,
        "tipo_ingreso": g.tipo_ingreso,
        "origen_ingreso": g.origen_ingreso,
        "ubicacion_actual": g.ubicacion_actual,
        "transit_status": g.transit_status,
        "responsible_username": resp_user,
        "responsible_name": resp_name,
        "created_by": created_by,
        "created_by_name": created_by_name,
        "updated_by": updated_by,
        "updated_by_name": updated_by_name,
        "reviewed_by": reviewed_by,
        "reviewed_by_name": reviewed_by_name,
        "review_note": g.review_note,
        "reviewed_at": _iso_or_empty(g.reviewed_at),
        "review_started_at": _iso_or_empty(g.review_started_at),
        "correction_requested_at": _iso_or_empty(g.correction_requested_at),
        "correction_resubmitted_at": _iso_or_empty(g.correction_resubmitted_at),
        "sucursal": g.sucursal,
        "sucursal_code": g.sucursal_code,
        "branch_id": g.branch_id or "",
        "company_id": g.company_id or "",
        "sucursal_responsable": g.sucursal_responsable,
        "sucursal_responsable_id": g.sucursal_responsable_id or "",
        "deposito": g.deposito,
        "lugar_llegada": g.lugar_llegada,
        "ingreso_at": _iso_or_empty(g.ingreso_at),
        "carga_historica": bool(getattr(g, "carga_historica", False)),
        "created_at": _iso_or_empty(g.created_at),
        "updated_at": _iso_or_empty(g.updated_at),
        "cliente_nombre": g.cliente_nombre,
        "cliente_telefono": g.cliente_telefono,
        "cliente_email": g.cliente_email,
        "numero_factura": g.numero_factura,
        "fecha_compra": _date_iso_or_empty(g.fecha_compra),
        "provider_name": g.provider_name,
        "provider_case_id": g.provider_case_id,
        "sent_to_provider_at": _iso_or_empty(g.sent_to_provider_at),
        "last_provider_response_at": _iso_or_empty(g.last_provider_response_at),
        "last_claim_at": _iso_or_empty(g.last_claim_at),
        "fecha_ultimo_mail_proveedor": _iso_or_empty(g.fecha_ultimo_mail_proveedor),
        "provider_response_type": g.provider_response_type,
        "provider_correction_note": g.provider_correction_note,
        "provider_correction_resolved_at": _iso_or_empty(g.provider_correction_resolved_at),
        "estado_retiro_proveedor": g.estado_retiro_proveedor,
        "fecha_solicitud_retiro_proveedor": _iso_or_empty(g.fecha_solicitud_retiro_proveedor),
        "fecha_retiro_proveedor": _iso_or_empty(g.fecha_retiro_proveedor),
        "fecha_retiro": _iso_or_empty(g.fecha_retiro),
        "nota_retiro_proveedor": g.nota_retiro_proveedor,
        "remito_proveedor": g.remito_proveedor,
        "remito_interno": g.remito_interno,
        "fecha_salida_transito": _iso_or_empty(g.fecha_salida_transito),
        "fecha_llegada_transito": _iso_or_empty(g.fecha_llegada_transito),
        "lugar_salida_transito": g.lugar_salida_transito,
        "fecha_resolucion": _iso_or_empty(g.fecha_resolucion),
        "resultado_resolucion": g.resultado_resolucion,
        "resolution_note": g.resolution_note,
        "resolution_reference": g.resolution_reference,
        "numero_nota_credito": g.numero_nota_credito,
        "importe_nota_credito": str(g.importe_nota_credito) if g.importe_nota_credito is not None else "",
        "fecha_nota_credito": _date_iso_or_empty(g.fecha_nota_credito),
        "detalle_reparacion": g.detalle_reparacion,
        "fecha_reparacion": _date_iso_or_empty(g.fecha_reparacion),
        "producto_reemplazo": g.producto_reemplazo,
        "sku_reemplazo": g.sku_reemplazo,
        "serie_reemplazo": g.serie_reemplazo,
        "fecha_recepcion_reemplazo": _date_iso_or_empty(g.fecha_recepcion_reemplazo),
        "fecha_finalizacion": _iso_or_empty(g.fecha_finalizacion),
        "finalizacion": g.finalizacion,
        "vuelve_a": g.vuelve_a,
        "shipment_code": g.shipment_code,
        "shipment_file_name": g.shipment_file_name,
        "observations": g.observations,
        "photos_reference": g.photos_reference,
        "cancelled": 1 if g.cancelled else 0,
        "cancel_reason": g.cancel_reason,
        "cancelled_by": cancelled_by,
        "cancelled_at": _iso_or_empty(g.cancelled_at),
        "synced_to_google_sheet": 1 if g.synced_to_google_sheet else 0,
        "last_google_sync_at": _iso_or_empty(g.last_google_sync_at),
        "google_sheet_row_id": g.google_sheet_row_id,
        "google_sheet_updated_at": _iso_or_empty(g.google_sheet_updated_at),
        "sync_error": g.sync_error,
    }


def _item_to_dict(i: GuaranteeItem) -> dict[str, Any]:
    return {
        "id": i.id,
        "guarantee_id": i.guarantee_id,
        "item_index": i.item_index or 1,
        "producto": i.producto,
        "sku": i.sku,
        "marca": i.marca,
        "tipo": i.tipo,
        "serie": i.serie,
        "falla": i.falla,
        "observaciones": i.observaciones,
        "correction_note": i.correction_note,
        "created_at": _iso_or_empty(i.created_at),
        "updated_at": _iso_or_empty(i.updated_at),
    }


def _history_to_dict(h: GuaranteeHistory, session: Session) -> dict[str, Any]:
    actor_username, actor_name = _user_username_and_name(session, h.actor_user_id)
    return {
        "id": h.id,
        "guarantee_id": h.guarantee_id,
        "warranty_code": h.warranty_code,
        # Claves canónicas (legacy SQLite + ORM)
        "action": h.action,
        "old_status": h.old_status,
        "new_status": h.new_status,
        "field_name": h.field_name,
        "old_value": h.old_value,
        "new_value": h.new_value,
        "note": h.note,
        "details_json": json.dumps(h.details or {}, ensure_ascii=False),
        "details": {
            **(h.details or {}),
            "old_status": h.old_status,
            "new_status": h.new_status,
            "field_name": h.field_name,
            "old_value": h.old_value,
            "new_value": h.new_value,
        },
        "actor_username": actor_username,
        "actor_name": actor_name,
        "created_at": _format_history_created_at(h.created_at),
        # Aliases que espera el frontend del Drawer (compat con history_for_guarantee legacy)
        "event_type": h.action,
        "actor_display_name": actor_name,
        "actor_role": None,
        "resource_type": "warranty",
        "resource_id": h.warranty_code,
        "status": "ok",
        "message": h.note or "",
    }


def _format_history_created_at(dt: datetime | None) -> str:
    """Formato display AR (DD/MM/YYYY HH:MM) para el campo created_at de history.

    El frontend del Drawer espera el string ya formateado (igual que el legacy
    history_for_guarantee del SQLite). Para el espejo Google Sheets, _fmt_sheet_dt
    detecta si el value ya está formateado y lo pasa tal cual.
    """
    if not dt:
        return ""
    from .warranty_helpers import format_datetime_ar
    return format_datetime_ar(dt)


# ── Lecturas ────────────────────────────────────────────────────────────────

def pg_fetch_guarantee_with_items(warranty_code: str) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """Equivalente a ``fetch_guarantee_with_items``. None si no existe."""
    code = str(warranty_code or "").strip()
    if not code:
        return None
    with db_session() as session:
        g = session.scalar(select(Guarantee).where(Guarantee.warranty_code == code))
        if not g:
            return None
        items = list(session.scalars(
            select(GuaranteeItem).where(GuaranteeItem.guarantee_id == g.id).order_by(GuaranteeItem.id)
        ).all())
        return _guarantee_to_dict(g, session), [_item_to_dict(it) for it in items]


def pg_fetch_guarantee_by_id(guarantee_id: int) -> dict[str, Any] | None:
    with db_session() as session:
        g = session.get(Guarantee, int(guarantee_id))
        return _guarantee_to_dict(g, session) if g else None


def pg_fetch_all_guarantee_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Devuelve (guarantees, items) ordenados igual que el legacy.

    El router agrupa items por ``guarantee_id`` con un dict by_gid; mantenemos
    ese contrato.
    """
    with db_session() as session:
        g_rows = session.scalars(
            select(Guarantee).order_by(Guarantee.ingreso_at.desc(), Guarantee.id.desc())
        ).all()
        item_rows = session.scalars(
            select(GuaranteeItem).order_by(GuaranteeItem.id)
        ).all()
        guarantees = [_guarantee_to_dict(g, session) for g in g_rows]
        items = [_item_to_dict(it) for it in item_rows]
        return guarantees, items


def pg_history_for_guarantee(guarantee_id: int, limit: int = 200) -> list[dict[str, Any]]:
    with db_session() as session:
        rows = session.scalars(
            select(GuaranteeHistory)
            .where(GuaranteeHistory.guarantee_id == int(guarantee_id))
            .order_by(GuaranteeHistory.id.desc())
            .limit(max(1, int(limit or 200)))
        ).all()
        return [_history_to_dict(h, session) for h in rows]


def pg_collect_export_rows_by_codes(warranty_codes: Iterable[str]) -> list[dict[str, Any]]:
    """Equivalente a ``collect_export_rows_by_ids``: rows planos (cabecera+item).

    Devuelve las mismas claves que el SQL legacy.
    """
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return []
    out: list[dict[str, Any]] = []
    with db_session() as session:
        stmt = (
            select(Guarantee, GuaranteeItem)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id)
            .where(Guarantee.warranty_code.in_(codes))
            .order_by(Guarantee.ingreso_at.asc(), Guarantee.warranty_code.asc(), GuaranteeItem.id.asc())
        )
        for g, i in session.execute(stmt).all():
            out.append({
                "guarantee_id": g.id,
                "warranty_code": g.warranty_code,
                "status": g.status,
                "ingreso_at": _iso_or_empty(g.ingreso_at),
        "carga_historica": bool(getattr(g, "carga_historica", False)),
                "created_at": _iso_or_empty(g.created_at),
                "fecha_resolucion": _iso_or_empty(g.fecha_resolucion),
                "cancelled_at": _iso_or_empty(g.cancelled_at),
                "sucursal": g.sucursal,
                "deposito": g.deposito,
                "lugar_llegada": g.lugar_llegada,
                "provider_name": g.provider_name,
                "provider_case_id": g.provider_case_id,
                "sent_to_provider_at": _iso_or_empty(g.sent_to_provider_at),
                "last_provider_response_at": _iso_or_empty(g.last_provider_response_at),
                "observations": g.observations,
                "producto": i.producto,
                "sku": i.sku,
                "marca": i.marca,
                "serie": i.serie,
                "falla": i.falla,
                "item_observaciones": i.observaciones,
            })
    return out


def pg_collect_export_rows() -> list[dict[str, Any]]:
    """Rows planos para exportacion por filtros, excluyendo garantias canceladas."""
    out: list[dict[str, Any]] = []
    with db_session() as session:
        stmt = (
            select(Guarantee, GuaranteeItem)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id)
            .where(Guarantee.cancelled.is_(False))
            .order_by(Guarantee.ingreso_at.asc(), Guarantee.warranty_code.asc(), GuaranteeItem.id.asc())
        )
        for g, i in session.execute(stmt).all():
            out.append({
                "guarantee_id": g.id,
                "warranty_code": g.warranty_code,
                "status": g.status,
                "ingreso_at": _iso_or_empty(g.ingreso_at),
        "carga_historica": bool(getattr(g, "carga_historica", False)),
                "created_at": _iso_or_empty(g.created_at),
                "fecha_resolucion": _iso_or_empty(g.fecha_resolucion),
                "cancelled_at": _iso_or_empty(g.cancelled_at),
                "sucursal": g.sucursal,
                "deposito": g.deposito,
                "lugar_llegada": g.lugar_llegada,
                "provider_name": g.provider_name,
                "provider_case_id": g.provider_case_id,
                "sent_to_provider_at": _iso_or_empty(g.sent_to_provider_at),
                "last_provider_response_at": _iso_or_empty(g.last_provider_response_at),
                "observations": g.observations,
                "producto": i.producto,
                "sku": i.sku,
                "marca": i.marca,
                "serie": i.serie,
                "falla": i.falla,
                "item_observaciones": i.observaciones,
            })
    return out


def pg_fetch_guarantee_rows_by_codes(warranty_codes: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Devuelve guarantees por warranty_code normalizado en uppercase."""
    codes = [str(c).strip().upper() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return {}
    with db_session() as session:
        rows = session.scalars(select(Guarantee).where(func.upper(Guarantee.warranty_code).in_(codes))).all()
        return {
            str(g.warranty_code or "").strip().upper(): _guarantee_to_dict(g, session)
            for g in rows
        }


def _export_to_dict(row: GuaranteeExport, session: Session) -> dict[str, Any]:
    created_by, created_by_name = _user_username_and_name(session, row.created_by_user_id)
    filters = row.filters or {}
    warranty_ids = row.warranty_ids or []
    return {
        "id": row.id,
        "created_at": _iso_or_empty(row.created_at),
        "created_by": created_by,
        "created_by_name": created_by_name,
        "provider_name": row.provider_name or "",
        "marca": row.marca or "",
        "filters": filters,
        "filters_json": json.dumps(filters, ensure_ascii=False),
        "file_path": row.file_path or "",
        "file_name": row.file_name or "",
        "row_count": row.row_count or 0,
        "shipment_code": row.shipment_code or "",
        "warranty_ids": warranty_ids,
        "warranty_ids_json": json.dumps(warranty_ids, ensure_ascii=False),
        "file_format": row.file_format or "excel",
        "logo_brand": row.logo_brand or "gv_electro",
        "punto_retiro": row.punto_retiro or "",
        "tipo_retiro": row.tipo_retiro or "",
        "fecha_retiro_acordada": _iso_or_empty(row.fecha_retiro_acordada),
        "respuesta_proveedor_pickup": row.respuesta_proveedor_pickup or "",
        "pickup_alert_sent": bool(row.pickup_alert_sent),
    }


def pg_create_export(
    *,
    user: Any,
    provider_name: str = "",
    marca: str = "",
    filters: dict[str, Any] | None = None,
    file_path: str,
    file_name: str,
    row_count: int,
    shipment_code: str = "",
    warranty_ids: Iterable[str] | None = None,
    file_format: str = "excel",
    logo_brand: str = "gv_electro",
) -> dict[str, Any]:
    """Inserta guarantee_exports y devuelve dict compatible con el router."""
    username = getattr(user, "username", "") if user is not None else ""
    with db_session() as session:
        row = GuaranteeExport(
            created_by_user_id=_resolve_user_id(session, username),
            provider_name=str(provider_name or ""),
            marca=str(marca or ""),
            filters=dict(filters or {}),
            file_path=str(file_path or ""),
            file_name=str(file_name or ""),
            row_count=int(row_count or 0),
            shipment_code=str(shipment_code or ""),
            warranty_ids=[str(c).strip() for c in (warranty_ids or []) if str(c).strip()],
            file_format=str(file_format or "excel"),
            logo_brand=str(logo_brand or "gv_electro"),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return _export_to_dict(row, session)


def pg_list_exports(limit: int = 50) -> list[dict[str, Any]]:
    with db_session() as session:
        rows = session.scalars(
            select(GuaranteeExport)
            .order_by(GuaranteeExport.id.desc())
            .limit(max(1, int(limit or 50)))
        ).all()
        return [_export_to_dict(row, session) for row in rows]


def pg_get_export(export_id: int) -> dict[str, Any] | None:
    with db_session() as session:
        row = session.get(GuaranteeExport, int(export_id))
        return _export_to_dict(row, session) if row else None


# ── Escrituras ──────────────────────────────────────────────────────────────

def pg_add_history(
    *,
    guarantee_id: int,
    warranty_code: str,
    user: Any,
    action: str,
    old_status: str = "",
    new_status: str = "",
    field_name: str = "",
    old_value: str = "",
    new_value: str = "",
    note: str = "",
    details: dict[str, Any] | None = None,
) -> int:
    """Inserta un evento en guarantee_history (Postgres). Devuelve el id."""
    username = getattr(user, "username", "") if user is not None else ""
    with db_session() as session:
        actor_id = _resolve_user_id(session, username)
        h = GuaranteeHistory(
            guarantee_id=int(guarantee_id),
            warranty_code=str(warranty_code or ""),
            action=str(action or ""),
            old_status=str(old_status or ""),
            new_status=str(new_status or ""),
            field_name=str(field_name or ""),
            old_value=str(old_value or ""),
            new_value=str(new_value or ""),
            note=str(note or ""),
            details=dict(details or {}),
            actor_user_id=actor_id,
        )
        session.add(h)
        session.commit()
        return int(h.id)


# Mapeo de claves UPDATE legacy → columnas ORM. Las que llevan FK se resuelven
# por separado (ver pg_update_guarantee_fields).
_UPDATE_DT_FIELDS = {
    "ingreso_at", "created_at", "updated_at", "reviewed_at",
    "review_started_at", "correction_requested_at", "correction_resubmitted_at",
    "sent_to_provider_at", "last_provider_response_at", "last_claim_at",
    "fecha_ultimo_mail_proveedor", "provider_correction_resolved_at",
    "fecha_solicitud_retiro_proveedor", "fecha_retiro_proveedor", "fecha_retiro",
    "fecha_salida_transito", "fecha_llegada_transito", "fecha_resolucion",
    "fecha_finalizacion", "cancelled_at", "last_google_sync_at",
    "google_sheet_updated_at",
}
_UPDATE_DATE_FIELDS = {
    "fecha_compra", "fecha_nota_credito", "fecha_reparacion",
    "fecha_recepcion_reemplazo",
}
_UPDATE_BOOL_FIELDS = {"cancelled", "synced_to_google_sheet", "pickup_alert_sent", "carga_historica"}
# Campos legacy con username/display que mapean a FK en Postgres.
_UPDATE_USER_FK = {
    "responsible_username": "responsible_user_id",
    "created_by": "created_by_user_id",
    "updated_by": "updated_by_user_id",
    "reviewed_by": "reviewed_by_user_id",
    "review_started_by": "review_started_by_user_id",
    "correction_requested_by": "correction_requested_by_user_id",
    "correction_resubmitted_by": "correction_resubmitted_by_user_id",
    "cancelled_by": "cancelled_by_user_id",
}
# Campos display-only que el legacy escribía pero en Postgres se derivan del JOIN.
# Si llegan en updates, los descartamos silenciosamente.
_UPDATE_IGNORED = {
    "responsible_name", "created_by_name", "updated_by_name", "reviewed_by_name",
    "review_started_by_name", "correction_requested_by_name",
    "correction_resubmitted_by_name", "cancelled_by_name",
}


def _coerce_update_value(field: str, value: Any) -> Any:
    if field in _UPDATE_DT_FIELDS:
        return _parse_dt(value)
    if field in _UPDATE_DATE_FIELDS:
        return _parse_date(value)
    if field in _UPDATE_BOOL_FIELDS:
        if isinstance(value, bool):
            return value
        return str(value or "").strip() in {"1", "true", "True", "t", "yes"}
    return value


def pg_update_guarantee_fields(
    *,
    guarantee_id: int,
    user: Any,
    updates: dict[str, Any],
    action: str,
    note: str = "",
    old_status: str = "",
    new_status: str = "",
    details: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Equivalente a ``update_guarantee_provider_fields``.

    Hace el UPDATE + agrega un evento en guarantee_history. Devuelve el dict
    del registro actualizado, o None si no existe.
    """
    username = getattr(user, "username", "") if user is not None else ""
    display = getattr(user, "display_name", "") if user is not None else ""

    with db_session() as session:
        g = session.get(Guarantee, int(guarantee_id))
        if not g:
            return None
        actor_id = _resolve_user_id(session, username)

        # Auditoría implícita.
        g.updated_at = _utc_now()
        g.updated_by_user_id = actor_id
        g.synced_to_google_sheet = False

        for raw_key, raw_value in (updates or {}).items():
            key = str(raw_key)
            if key in _UPDATE_IGNORED:
                continue
            if key in _UPDATE_USER_FK:
                target_attr = _UPDATE_USER_FK[key]
                setattr(g, target_attr, _resolve_user_id(session, raw_value))
                continue
            if key in {"updated_at", "updated_by", "updated_by_name", "synced_to_google_sheet"}:
                # Ya los seteamos arriba; ignorar lo que venga.
                continue
            if not hasattr(g, key):
                # Clave desconocida; no romper para mantener compatibilidad.
                continue
            setattr(g, key, _coerce_update_value(key, raw_value))

        # History dentro de la misma transacción.
        h = GuaranteeHistory(
            guarantee_id=g.id,
            warranty_code=g.warranty_code,
            action=str(action or ""),
            old_status=str(old_status or ""),
            new_status=str(new_status or ""),
            note=str(note or ""),
            details=dict(details or {}),
            actor_user_id=actor_id,
        )
        session.add(h)
        session.commit()
        session.refresh(g)
        return _guarantee_to_dict(g, session)


def pg_insert_guarantee(
    *,
    warranty_code: str,
    user: Any,
    item: Any,  # WarrantyItemIn (duck-typed; usa .producto, .sku, .marca, etc.)
    sucursal_carga: str | None = None,
    sucursal_carga_branch_id: str | None = None,
    sucursal_responsable_override: str | None = None,
    sucursal_responsable_id_override: str | None = None,
    company_id_override: str | None = None,
    parent_warranty_code: str | None = None,
    parent_item_index: int | None = None,
    default_status: str = "1 - INGRESO",
    origen_ingreso: str = "",
    ubicacion_actual: str = "",
    transit_status: str = "",
    ingreso_at_iso: str = "",
) -> int:
    """Inserta una garantía y devuelve su id (PK).

    ``ingreso_at_iso``, ``origen_ingreso``, ``ubicacion_actual`` y
    ``transit_status`` los calcula el router con sus helpers (no se replica esa
    lógica acá para no acoplar este módulo a ``warranties.py``).
    """
    username = getattr(user, "username", "") if user is not None else ""

    parent_id: int | None = None
    with db_session() as session:
        user_id = _resolve_user_id(session, username)

        if parent_warranty_code:
            parent_id = session.scalar(
                select(Guarantee.id).where(Guarantee.warranty_code == parent_warranty_code.strip())
            )

        suc = sucursal_carga if sucursal_carga is not None else getattr(item, "sucursal", "")
        suc_bid = sucursal_carga_branch_id if sucursal_carga_branch_id is not None else (getattr(user, "branch_id", "") or "")
        suc_resp = sucursal_responsable_override if sucursal_responsable_override is not None else (getattr(item, "sucursal_responsable", "") or "")
        suc_resp_id = sucursal_responsable_id_override if sucursal_responsable_id_override is not None else (getattr(item, "sucursal_responsable_id", "") or "")
        company_id = company_id_override if company_id_override is not None else (getattr(user, "company_id", "") or "")

        # Fase A.5.2 · fundación: derivar company_id desde la branch si no vino
        # explícito. company_id es OBLIGATORIO en negocio (R1 del doc 05) — sin
        # él la garantía queda huérfana del scope multi-empresa.
        if not company_id and suc_bid:
            from .models.org import Branch as _Branch
            company_id = session.scalar(select(_Branch.company_id).where(_Branch.id == suc_bid)) or ""
        if not company_id and suc_resp_id:
            from .models.org import Branch as _Branch
            company_id = session.scalar(select(_Branch.company_id).where(_Branch.id == suc_resp_id)) or ""
        if not company_id:
            raise ValueError(
                "No se pudo determinar company_id para la garantía. "
                "Asegurate de que el usuario, la sucursal de carga o la sucursal "
                "responsable tengan empresa asignada."
            )

        lugar = (getattr(item, "lugar_llegada", "") or getattr(item, "deposito", "") or "").strip()
        deposito = (getattr(item, "deposito", "") or "").strip()

        g = Guarantee(
            warranty_code=warranty_code,
            parent_id=parent_id,
            parent_item_index=int(parent_item_index or 0),
            status=default_status,
            review_status=REVIEW_PENDING,
            tipo_ingreso=(getattr(item, "tipo_ingreso", "") or "").strip(),
            origen_ingreso=origen_ingreso or "",
            ubicacion_actual=ubicacion_actual or "",
            transit_status=transit_status or "",
            responsible_user_id=user_id,
            created_by_user_id=user_id,
            updated_by_user_id=user_id,
            ingreso_at=_parse_dt(ingreso_at_iso) or _utc_now(),
            sucursal=(suc or "").strip(),
            sucursal_code=_sucursal_code(suc or deposito),
            branch_id=suc_bid or None,
            company_id=company_id,  # garantizado no-vacío por el guard de arriba
            sucursal_responsable=(suc_resp or "").strip(),
            sucursal_responsable_id=suc_resp_id or None,
            deposito=deposito,
            lugar_llegada=lugar,
            observations=(getattr(item, "observaciones", "") or "").strip(),
            provider_name=(getattr(item, "proveedor", "") or "").strip(),
            cliente_nombre=(getattr(item, "cliente_nombre", "") or "").strip(),
            cliente_telefono=(getattr(item, "cliente_telefono", "") or "").strip(),
            cliente_email=(getattr(item, "cliente_email", "") or "").strip(),
            numero_factura=(getattr(item, "numero_factura", "") or "").strip(),
            fecha_compra=_parse_date(getattr(item, "fecha_compra", "")),
        )
        session.add(g)
        session.commit()
        return int(g.id)


def pg_insert_item(*, guarantee_id: int, item: Any, item_index: int = 1) -> int:
    """Inserta un GuaranteeItem y devuelve su id."""
    with db_session() as session:
        it = GuaranteeItem(
            guarantee_id=int(guarantee_id),
            item_index=int(item_index or 1),
            producto=(getattr(item, "producto", "") or "").strip(),
            sku=(getattr(item, "sku", "") or "").strip(),
            marca=(getattr(item, "marca", "") or "").strip(),
            tipo=(getattr(item, "tipo", "") or "").strip(),
            serie=(getattr(item, "serie", "") or "").strip(),
            falla=(getattr(item, "falla", "") or "").strip(),
            observaciones=(getattr(item, "observaciones", "") or "").strip(),
        )
        session.add(it)
        session.commit()
        return int(it.id)


# ── Helpers para el switch del router (2.5h.2a) ─────────────────────────────

_ITEM_UPDATE_FIELDS = {
    "item_index",
    "producto",
    "sku",
    "marca",
    "tipo",
    "serie",
    "falla",
    "observaciones",
    "correction_note",
}


def pg_update_item_fields(*, guarantee_id: int, item_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
    """Actualiza un item de garantia por PK, manteniendo el scope por guarantee_id."""
    clean = {str(k): v for k, v in (updates or {}).items() if str(k) in _ITEM_UPDATE_FIELDS}
    if not clean:
        return None
    with db_session() as session:
        item = session.scalar(
            select(GuaranteeItem).where(
                GuaranteeItem.id == int(item_id),
                GuaranteeItem.guarantee_id == int(guarantee_id),
            )
        )
        if item is None:
            return None
        for key, value in clean.items():
            if key == "item_index":
                setattr(item, key, int(value or 1))
            else:
                setattr(item, key, str(value or "").strip())
        item.updated_at = _utc_now()
        session.commit()
        session.refresh(item)
        return _item_to_dict(item)


def pg_clear_item_correction_notes(*, guarantee_id: int) -> int:
    """Limpia correction_note de todos los items de una garantia."""
    count = 0
    with db_session() as session:
        items = session.scalars(
            select(GuaranteeItem).where(GuaranteeItem.guarantee_id == int(guarantee_id))
        ).all()
        now = _utc_now()
        for item in items:
            if item.correction_note:
                item.correction_note = ""
                item.updated_at = now
                count += 1
        session.commit()
    return count


def pg_update_guarantee_and_items(
    *,
    guarantee_id: int,
    user: Any,
    guarantee_updates: dict[str, Any] | None = None,
    item_updates: Iterable[dict[str, Any]] | None = None,
    action: str,
    note: str = "",
    old_status: str = "",
    new_status: str = "",
    details: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """UPDATE transaccional de cabecera + items + history.

    Esta funcion cubre los endpoints grandes de edicion del router legacy
    (`/{warranty_id}`, `/{warranty_id}/entry-base`, correcciones de proveedor)
    sin depender de `conn.execute` ni de columnas texto de actores.
    """
    username = getattr(user, "username", "") if user is not None else ""
    with db_session() as session:
        g = session.get(Guarantee, int(guarantee_id))
        if not g:
            return None
        actor_id = _resolve_user_id(session, username)
        now = _utc_now()

        g.updated_at = now
        g.updated_by_user_id = actor_id
        g.synced_to_google_sheet = False

        for raw_key, raw_value in (guarantee_updates or {}).items():
            key = str(raw_key)
            if key in _UPDATE_IGNORED:
                continue
            if key in _UPDATE_USER_FK:
                setattr(g, _UPDATE_USER_FK[key], _resolve_user_id(session, raw_value))
                continue
            if key in {"updated_at", "updated_by", "updated_by_name", "synced_to_google_sheet"}:
                continue
            if not hasattr(g, key):
                continue
            setattr(g, key, _coerce_update_value(key, raw_value))

        for item_update in item_updates or []:
            item_id = int(item_update.get("id") or item_update.get("row_number") or 0)
            if not item_id:
                continue
            item = session.scalar(
                select(GuaranteeItem).where(
                    GuaranteeItem.id == item_id,
                    GuaranteeItem.guarantee_id == int(guarantee_id),
                )
            )
            if not item:
                continue
            for raw_key, raw_value in item_update.items():
                key = str(raw_key)
                if key not in _ITEM_UPDATE_FIELDS:
                    continue
                if key == "item_index":
                    setattr(item, key, int(raw_value or 1))
                else:
                    setattr(item, key, str(raw_value or "").strip())
            item.updated_at = now

        session.add(
            GuaranteeHistory(
                guarantee_id=g.id,
                warranty_code=g.warranty_code,
                action=str(action or ""),
                old_status=str(old_status or ""),
                new_status=str(new_status or ""),
                note=str(note or ""),
                details=dict(details or {}),
                actor_user_id=actor_id,
            )
        )
        session.commit()
        session.refresh(g)
        items = session.scalars(
            select(GuaranteeItem).where(GuaranteeItem.guarantee_id == g.id).order_by(GuaranteeItem.id)
        ).all()
        return _guarantee_to_dict(g, session), [_item_to_dict(item) for item in items]


def pg_cancel_guarantee(*, warranty_code: str, user: Any, reason: str = "") -> dict[str, Any] | None:
    """Anula una garantia y registra history en la misma transaccion."""
    code = str(warranty_code or "").strip()
    username = getattr(user, "username", "") if user is not None else ""
    with db_session() as session:
        g = session.scalar(select(Guarantee).where(Guarantee.warranty_code == code))
        if not g:
            return None
        actor_id = _resolve_user_id(session, username)
        old_status = g.status or ""
        now = _utc_now()
        g.cancelled = True
        g.cancel_reason = str(reason or "").strip()
        g.cancelled_by_user_id = actor_id
        g.cancelled_at = now
        g.status = "ANULADA"
        g.updated_at = now
        g.updated_by_user_id = actor_id
        g.synced_to_google_sheet = False
        session.add(
            GuaranteeHistory(
                guarantee_id=g.id,
                warranty_code=g.warranty_code,
                action="cancelled",
                old_status=old_status,
                new_status="ANULADA",
                note=g.cancel_reason,
                details={"cancel_reason": g.cancel_reason},
                actor_user_id=actor_id,
            )
        )
        session.commit()
        session.refresh(g)
        return _guarantee_to_dict(g, session)


def pg_delete_guarantee(warranty_code: str) -> bool:
    """Borra una garantia. Items e historial caen por cascade."""
    code = str(warranty_code or "").strip()
    if not code:
        return False
    with db_session() as session:
        g = session.scalar(select(Guarantee).where(Guarantee.warranty_code == code))
        if not g:
            return False
        session.delete(g)
        session.commit()
        return True


def pg_list_counters() -> list[dict[str, Any]]:
    with db_session() as session:
        rows = session.scalars(
            select(GuaranteeCounter).order_by(GuaranteeCounter.year.asc(), GuaranteeCounter.sucursal_code.asc())
        ).all()
        return [
            {"year": int(row.year), "sucursal_code": str(row.sucursal_code), "last_number": int(row.last_number)}
            for row in rows
        ]


def pg_resync_counters() -> list[dict[str, Any]]:
    """Reconstruye guarantee_counters desde warranty_code existente."""
    counters: dict[tuple[int, str], int] = {}
    rx = re.compile(r"GAR-(\d{4})-([A-Z0-9]+)-(\d+)(?:-\d+)?")
    with db_session() as session:
        codes = session.scalars(select(Guarantee.warranty_code)).all()
        for raw_code in codes:
            m = rx.fullmatch(str(raw_code or "").upper())
            if not m:
                continue
            key = (int(m.group(1)), m.group(2))
            counters[key] = max(counters.get(key, 0), int(m.group(3)))
        session.query(GuaranteeCounter).delete()
        for (year, code), last in counters.items():
            session.add(GuaranteeCounter(year=year, sucursal_code=code, last_number=last))
        session.commit()
    return pg_list_counters()


def pg_provider_suggestions(limit: int = 200) -> dict[str, list[str]]:
    """Sugerencias para filtros/export: proveedores y marcas reales."""
    max_rows = max(1, int(limit or 200))
    with db_session() as session:
        providers = [
            str(row[0] or "").strip()
            for row in session.execute(
                select(Guarantee.provider_name)
                .where(func.trim(func.coalesce(Guarantee.provider_name, "")) != "")
                .distinct()
                .order_by(Guarantee.provider_name.asc())
                .limit(max_rows)
            ).all()
        ]
        export_providers = [
            str(row[0] or "").strip()
            for row in session.execute(
                select(GuaranteeExport.provider_name)
                .where(func.trim(func.coalesce(GuaranteeExport.provider_name, "")) != "")
                .distinct()
                .order_by(GuaranteeExport.provider_name.asc())
                .limit(max_rows)
            ).all()
        ]
        brands = [
            str(row[0] or "").strip()
            for row in session.execute(
                select(GuaranteeItem.marca)
                .where(func.trim(func.coalesce(GuaranteeItem.marca, "")) != "")
                .distinct()
                .order_by(GuaranteeItem.marca.asc())
                .limit(max_rows)
            ).all()
        ]
    return {
        "providers": sorted({p for p in [*providers, *export_providers] if p}, key=str.lower),
        "brands": sorted({b for b in brands if b}, key=str.lower),
    }


# ── Production reset (Fase 2.5h.2c) ──────────────────────────────────────────
# Tablas Postgres que limpia el reset de producción. El orden no importa para
# TRUNCATE ... CASCADE, pero lo mantengo coherente con el orden de FK por si
# en el futuro se prefiere hacer DELETEs explícitos.

from .models.remitos import Remito  # noqa: E402

RESET_TABLES_PG = [
    "guarantee_history",
    "guarantee_items",
    "guarantee_exports",
    "guarantee_sync_logs",
    "guarantee_counters",
    "remito_items",
    "remitos",
    "guarantees",
]


def pg_reset_summary() -> dict[str, int]:
    """Conteos de las tablas que toca el reset (los mismos campos que
    ``WarrantyResetSummary`` salvo ``generated_export_files``, que es de FS).
    """
    from sqlalchemy import func as _func, select as _select
    with db_session() as session:
        return {
            "guarantees": int(session.scalar(_select(_func.count()).select_from(Guarantee)) or 0),
            "guarantee_items": int(session.scalar(_select(_func.count()).select_from(GuaranteeItem)) or 0),
            "guarantee_history": int(session.scalar(_select(_func.count()).select_from(GuaranteeHistory)) or 0),
            "remitos": int(session.scalar(_select(_func.count()).select_from(Remito)) or 0),
            "exports": int(session.scalar(_select(_func.count()).select_from(GuaranteeExport)) or 0),
            "sync_logs": 0,  # GuaranteeSyncLog no se usa en operación; queda 0 hasta sumarlo al backup.
            "counters": int(session.scalar(_select(_func.count()).select_from(GuaranteeCounter)) or 0),
        }


def pg_export_table_rows(table_name: str) -> list[dict[str, Any]]:
    """Lee todas las filas de una tabla del reset como dicts JSON-serializables.

    Solo permite las tablas en ``RESET_TABLES_PG`` (whitelist). Usa text() porque
    no necesitamos atributos ORM y queremos cubrir cualquier columna nueva.
    """
    from sqlalchemy import text as _text
    t = (table_name or "").strip()
    if t not in RESET_TABLES_PG:
        return []
    with db_session() as session:
        result = session.execute(_text(f"SELECT * FROM {t}"))
        return [dict(row) for row in result.mappings().all()]


# ── History bulk (Fase 2.5h.2e — push a Google Sheets) ──────────────────────

def pg_all_history(limit: int | None = None) -> list[dict[str, Any]]:
    """Lista plana de todos los eventos de guarantee_history (orden cronológico
    ascendente), para volcar a la pestaña EVENTOS del espejo Google Sheets.

    Devuelve dicts con las mismas keys que el SQL legacy + ``actor_username`` /
    ``actor_name`` resueltos por JOIN con users.
    """
    with db_session() as session:
        stmt = select(GuaranteeHistory).order_by(GuaranteeHistory.created_at.asc(), GuaranteeHistory.id.asc())
        if limit and int(limit) > 0:
            stmt = stmt.limit(int(limit))
        rows = session.scalars(stmt).all()
        return [_history_to_dict(h, session) for h in rows]


# ── Sync logs (Fase 2.5h.2d) ────────────────────────────────────────────────

from .models.warranties import GuaranteeSyncLog as _GuaranteeSyncLog  # noqa: E402


def pg_sync_status() -> dict[str, Any]:
    """Devuelve total/pending/last_log/errors recientes para /sync/status."""
    from sqlalchemy import func as _func, select as _select
    with db_session() as session:
        total = int(session.scalar(_select(_func.count()).select_from(Guarantee)) or 0)
        pending = int(session.scalar(
            _select(_func.count()).select_from(Guarantee).where(Guarantee.synced_to_google_sheet.is_(False))
        ) or 0)
        last = session.scalars(_select(_GuaranteeSyncLog).order_by(_GuaranteeSyncLog.id.desc()).limit(1)).first()
        last_dict: dict[str, Any] | None = None
        if last:
            actor_username, actor_name = _user_username_and_name(session, last.actor_user_id)
            last_dict = {
                "sync_type": last.sync_type or "",
                "status": last.status or "",
                "started_at": _iso_or_empty(last.started_at),
                "finished_at": _iso_or_empty(last.finished_at),
                "actor_username": actor_username,
                "actor_name": actor_name,
            }
        recent_errors_rows = session.scalars(
            _select(_GuaranteeSyncLog)
            .where(_GuaranteeSyncLog.status.in_(["failed", "partial"]))
            .order_by(_GuaranteeSyncLog.id.desc())
            .limit(3)
        ).all()
        errors: list[str] = []
        for r in recent_errors_rows:
            for e in (r.errors or [])[:5]:
                errors.append(str(e))
        return {
            "total": total,
            "pending": pending,
            "last": last_dict,
            "errors": errors[:10],
        }


def pg_list_sync_logs(limit: int = 30) -> list[dict[str, Any]]:
    """Lista de sync logs ordenados por id desc, devuelve dicts compatibles con
    ``sync_log_info`` del router legacy (mismas keys que el SQL crudo).
    """
    from sqlalchemy import select as _select
    with db_session() as session:
        rows = session.scalars(
            _select(_GuaranteeSyncLog).order_by(_GuaranteeSyncLog.id.desc()).limit(max(1, int(limit or 30)))
        ).all()
        out: list[dict[str, Any]] = []
        for r in rows:
            actor_username, actor_name = _user_username_and_name(session, r.actor_user_id)
            errors_list = list(r.errors or [])
            import json as _json
            out.append({
                "id": int(r.id),
                "sync_type": r.sync_type or "",
                "status": r.status or "",
                "started_at": _iso_or_empty(r.started_at),
                "finished_at": _iso_or_empty(r.finished_at),
                "actor_username": actor_username,
                "actor_name": actor_name,
                "rows_processed": int(r.rows_processed or 0),
                "rows_created": int(r.rows_created or 0),
                "rows_updated": int(r.rows_updated or 0),
                "rows_skipped": int(r.rows_skipped or 0),
                "errors_json": _json.dumps(errors_list, ensure_ascii=False),
                "errors": errors_list,
            })
        return out


def pg_insert_sync_log(
    *,
    sync_type: str,
    status_value: str,
    started_at: Any,
    finished_at: Any,
    user: Any,
    rows_processed: int = 0,
    rows_created: int = 0,
    rows_updated: int = 0,
    rows_skipped: int = 0,
    errors: list[str] | None = None,
) -> int:
    username = getattr(user, "username", "") if user is not None else ""
    with db_session() as session:
        actor_user_id = _resolve_user_id(session, username)
        log = _GuaranteeSyncLog(
            sync_type=str(sync_type or ""),
            status=str(status_value or ""),
            started_at=_parse_dt(started_at) or _utc_now(),
            finished_at=_parse_dt(finished_at),
            actor_user_id=actor_user_id,
            rows_processed=int(rows_processed or 0),
            rows_created=int(rows_created or 0),
            rows_updated=int(rows_updated or 0),
            rows_skipped=int(rows_skipped or 0),
            errors=list(errors or []),
        )
        session.add(log)
        session.commit()
        return int(log.id)


def pg_mark_all_synced() -> int:
    """Marca todas las garantías como sincronizadas (synced_to_google_sheet=True
    + last_google_sync_at=ahora + sync_error vacío). Devuelve cantidad afectada.
    """
    from sqlalchemy import update as _update
    now = _utc_now()
    with db_session() as session:
        result = session.execute(
            _update(Guarantee).values(
                synced_to_google_sheet=True,
                last_google_sync_at=now,
                sync_error="",
            )
        )
        session.commit()
        return int(result.rowcount or 0)


def pg_reset_warranty_tables() -> None:
    """TRUNCATE en bloque + restart identity + cascade. Atómico.

    Equivalente al DELETE + reset de sqlite_sequence del legacy. CASCADE cubre
    FKs entre tablas listadas; RESTART IDENTITY resetea las sequences BIGINT.
    """
    from sqlalchemy import text as _text
    tables_csv = ", ".join(RESET_TABLES_PG)
    with db_session() as session:
        session.execute(_text(f"TRUNCATE TABLE {tables_csv} RESTART IDENTITY CASCADE"))
        session.commit()


# ── Backfill de proveedores en garantías (cruce de datos posventa) ───────────
#
# El proveedor se asigna solo al CREAR la garantía. Las garantías cargadas
# cuando su marca todavía no estaba vinculada a un proveedor quedan con
# provider_name vacío para siempre. Esta función las completa retroactivamente
# usando el proveedor default de la marca de su primer item — así el trabajo
# de matching marca→proveedor también arregla el histórico (y alimenta el
# cruce de SLA por proveedor).

def pg_backfill_provider_names(marca_filter: str | None = None) -> dict[str, Any]:
    """Completa provider_name vacío en garantías usando el proveedor default
    de su marca. Si `marca_filter` viene, solo toca garantías de esa marca
    (caso: se acaba de vincular ESA marca a un proveedor).

    Devuelve {"updated": int, "by_provider": {nombre: count}}.
    """
    from .warranty_helpers import normalize_text
    from .models.products import BrandProvider, ProductBrand, Provider

    norm_filter = normalize_text(marca_filter) if marca_filter else ""
    updated = 0
    by_provider: dict[str, int] = {}

    with db_session() as session:
        # Mapa marca_normalizada -> provider_name (el default por marca).
        brand_to_provider: dict[str, str] = {}
        prov_rows = session.execute(
            select(ProductBrand.normalized_name, Provider.name, BrandProvider.is_default)
            .join(BrandProvider, BrandProvider.brand_id == ProductBrand.id)
            .join(Provider, Provider.id == BrandProvider.provider_id)
            .where(ProductBrand.is_active.is_(True), Provider.is_active.is_(True))
            .order_by(BrandProvider.is_default.desc())
        ).all()
        for norm_name, prov_name, _is_default in prov_rows:
            key = str(norm_name or "")
            if key and key not in brand_to_provider:  # primer match = default (orden desc)
                brand_to_provider[key] = str(prov_name or "")

        # Garantías sin proveedor + la marca de su primer item.
        rows = session.execute(
            select(Guarantee.id, GuaranteeItem.marca)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id)
            .where(func.trim(func.coalesce(Guarantee.provider_name, "")) == "")
            .order_by(Guarantee.id, GuaranteeItem.item_index)
        ).all()
        first_marca: dict[int, str] = {}
        for gid, marca in rows:
            m = str(marca or "").strip()
            if m and gid not in first_marca:
                first_marca[gid] = m

        for gid, marca in first_marca.items():
            mnorm = normalize_text(marca)
            if norm_filter and mnorm != norm_filter:
                continue
            pname = brand_to_provider.get(mnorm, "")
            if not pname:
                continue
            g = session.get(Guarantee, gid)
            if g and not str(g.provider_name or "").strip():
                g.provider_name = pname
                g.updated_at = _utc_now()
                g.synced_to_google_sheet = False
                updated += 1
                by_provider[pname] = by_provider.get(pname, 0) + 1
        session.commit()

    return {"updated": updated, "by_provider": by_provider}
