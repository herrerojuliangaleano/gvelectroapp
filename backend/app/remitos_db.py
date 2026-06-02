"""Capa de datos Postgres para Remitos.

Estado: ``routers/remitos.py`` delega en estas funciones para los endpoints
vivos de remitos internos, movimientos de depósito y entrega a proveedor.

Contrato de salida:
- Las funciones que devuelven "remitos" devuelven ``dict`` con las MISMAS claves
  que el SQL legacy de SQLite (``created_by``, ``created_by_name``,
  ``despachado_por``, ``despachado_por_name``, ``recibido_por``, ``recibido_por_name``,
  ``warranty_ids`` como lista de warranty_codes, ``warranty_ids_json`` como JSON
  serializado). Esto permite que ``row_to_remito`` siga funcionando sin tocarse.
- El modelo Postgres normaliza ``warranty_ids_json`` en ``remito_items`` (FK a
  ``guarantees``). Las funciones de este módulo se encargan del join/serialización.

Generador de códigos:
- ``pg_next_remito_code(brand)`` reemplaza al ``next_remito_code`` legacy.
  Concurrencia: el ``UNIQUE`` en ``remitos.remito_code`` actúa como guardia
  natural ante carreras (el ``IntegrityError`` se reintenta una vez).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import db_session
from .models.auth import User
from .models.org import Branch
from .models.remitos import Remito, RemitoItem
from .models.warranties import Guarantee, GuaranteeItem
from .warranty_helpers import now_ar


# ── helpers internos ────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_or_empty(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def _resolve_user_id(session: Session, username: Any) -> int | None:
    if not username:
        return None
    uname = str(username).strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(func.lower(User.username) == uname))


def _user_username_and_name(session: Session, user_id: int | None) -> tuple[str, str]:
    if not user_id:
        return "", ""
    u = session.get(User, user_id)
    if not u:
        return "", ""
    return u.username or "", u.display_name or u.username or ""


def _resolve_branch_id_by_name(session: Session, name: str) -> str | None:
    """Busca branch.id por name o code (case-insensitive)."""
    n = (name or "").strip()
    if not n:
        return None
    lower = n.lower()
    return session.scalar(
        select(Branch.id).where(
            and_(
                Branch.is_active.is_(True),
                func.lower(Branch.name) == lower,
            )
        )
    ) or session.scalar(
        select(Branch.id).where(
            and_(
                Branch.is_active.is_(True),
                func.lower(Branch.code) == lower,
            )
        )
    )


# ── Generadores de código ───────────────────────────────────────────────────

_BRAND_PREFIX = {"abc_electro": "ABC", "gv_electro": "GV"}


def pg_next_remito_code(brand: str) -> str:
    """GV-R-YYYY-NNNN o ABC-R-YYYY-NNNN.

    Estrategia: leer max y +1. El UNIQUE en ``remitos.remito_code`` cubre la
    carrera (el caller debe retry si captura IntegrityError; ver pg_create_remito).
    """
    code_prefix = _BRAND_PREFIX.get(str(brand or "").strip(), "GV")
    year = now_ar().year
    prefix = f"{code_prefix}-R-{year}-"
    with db_session() as session:
        codes = session.scalars(
            select(Remito.remito_code).where(Remito.remito_code.like(f"{prefix}%"))
        ).all()
    last = 0
    rx = re.compile(rf"{code_prefix}-R-{year}-(\d+)")
    for c in codes:
        m = rx.fullmatch(str(c or ""))
        if m:
            last = max(last, int(m.group(1)))
    return f"{prefix}{(last + 1):04d}"


def pg_next_provider_delivery_code() -> str:
    """RP-YYYY-NNNN — remitos depósito → proveedor."""
    year = now_ar().year
    prefix = f"RP-{year}-"
    with db_session() as session:
        codes = session.scalars(
            select(Remito.remito_code).where(Remito.remito_code.like(f"{prefix}%"))
        ).all()
    last = 0
    rx = re.compile(rf"RP-{year}-(\d+)")
    for c in codes:
        m = rx.fullmatch(str(c or ""))
        if m:
            last = max(last, int(m.group(1)))
    return f"{prefix}{(last + 1):04d}"


# ── Lecturas ────────────────────────────────────────────────────────────────

def pg_load_warranties_for_codes(warranty_codes: Iterable[str]) -> list[dict[str, Any]]:
    """Datos básicos de garantías (uno por warranty_code) para mostrar en el remito.

    Mantiene el contrato de ``load_warranties_for_ids``: lista de dicts con
    warranty_code, producto, sku, marca, serie, falla del primer item.
    """
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return []
    with db_session() as session:
        rows = session.execute(
            select(Guarantee, GuaranteeItem)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id, isouter=True)
            .where(Guarantee.warranty_code.in_(codes))
            .order_by(Guarantee.warranty_code, GuaranteeItem.id)
        ).all()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for g, i in rows:
        wc = g.warranty_code
        if wc in seen:
            continue
        seen.add(wc)
        out.append({
            "warranty_code": wc,
            "producto": (i.producto if i else "") or "",
            "sku": (i.sku if i else "") or "",
            "marca": (i.marca if i else "") or "",
            "serie": (i.serie if i else "") or "",
            "falla": (i.falla if i else "") or "",
        })
    return out


def _warranty_codes_for_remito(session: Session, remito_id: int) -> list[str]:
    """Lista de warranty_codes de un remito (orden estable por id de item)."""
    rows = session.execute(
        select(Guarantee.warranty_code)
        .join(RemitoItem, RemitoItem.guarantee_id == Guarantee.id)
        .where(RemitoItem.remito_id == int(remito_id))
        .order_by(RemitoItem.id)
    ).all()
    return [r[0] for r in rows]


def _remito_to_legacy_dict(r: Remito, session: Session) -> dict[str, Any]:
    """ORM Remito → dict con MISMAS claves que el SQL legacy.

    Permite que ``row_to_remito`` (router) siga funcionando sin cambios.
    """
    created_by, created_by_name = _user_username_and_name(session, r.created_by_user_id)
    despachado_por, despachado_por_name = _user_username_and_name(session, r.despachado_por_user_id)
    recibido_por, recibido_por_name = _user_username_and_name(session, r.recibido_por_user_id)
    codes = _warranty_codes_for_remito(session, r.id)
    return {
        "id": r.id,
        "remito_code": r.remito_code,
        "shipment_code": r.shipment_code or "",
        "tipo_remito": r.tipo_remito or "sucursal_a_deposito",
        "company_brand": r.company_brand or "gv_electro",
        "origen_sucursal": r.origen_sucursal or "",
        "destino_deposito": r.destino_deposito or "",
        "warranty_ids_json": json.dumps(codes),
        "warranty_ids": codes,
        "proveedor": r.proveedor or "",
        "status": r.status or "pendiente",
        "created_at": _iso_or_empty(r.created_at),
        "created_by": created_by,
        "created_by_name": created_by_name,
        "fecha_despacho": _iso_or_empty(r.fecha_despacho),
        "despachado_por": despachado_por,
        "despachado_por_name": despachado_por_name,
        "fecha_llegada": _iso_or_empty(r.fecha_llegada),
        "recibido_por": recibido_por,
        "recibido_por_name": recibido_por_name,
        "nota": r.nota or "",
        "pdf_path": r.pdf_path or "",
    }


def pg_get_remito_by_code(remito_code: str) -> dict[str, Any] | None:
    code = (remito_code or "").strip()
    if not code:
        return None
    with db_session() as session:
        r = session.scalar(select(Remito).where(Remito.remito_code == code))
        return _remito_to_legacy_dict(r, session) if r else None


def pg_list_remitos(
    *,
    status: str | None = None,
    tipo_remito: str | None = None,
    origen: str | None = None,
    destino: str | None = None,
    shipment_code: str | None = None,
    remito_code_like: str | None = None,
    company_brand: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Lista de remitos con filtros opcionales. Más recientes primero."""
    with db_session() as session:
        stmt = select(Remito)
        if status:
            stmt = stmt.where(Remito.status == status)
        if tipo_remito:
            stmt = stmt.where(Remito.tipo_remito == tipo_remito)
        if origen:
            stmt = stmt.where(func.lower(Remito.origen_sucursal) == origen.strip().lower())
        if destino:
            stmt = stmt.where(func.lower(Remito.destino_deposito) == destino.strip().lower())
        if shipment_code:
            stmt = stmt.where(Remito.shipment_code == shipment_code.strip())
        if remito_code_like:
            stmt = stmt.where(func.upper(Remito.remito_code).like(f"%{remito_code_like.strip().upper()}%"))
        if company_brand:
            stmt = stmt.where(Remito.company_brand == company_brand.strip())
        stmt = stmt.order_by(Remito.created_at.desc()).limit(max(1, int(limit or 500)))
        rows = session.scalars(stmt).all()
        return [_remito_to_legacy_dict(r, session) for r in rows]


def pg_active_remito_codes() -> set[str]:
    """warranty_codes que están en un remito pendiente o en_transito."""
    with db_session() as session:
        rows = session.execute(
            select(Guarantee.warranty_code)
            .join(RemitoItem, RemitoItem.guarantee_id == Guarantee.id)
            .join(Remito, Remito.id == RemitoItem.remito_id)
            .where(Remito.status.in_(["pendiente", "en_transito"]))
        ).all()
        return {r[0] for r in rows}


def pg_active_provider_delivery_codes() -> set[str]:
    """warranty_codes en remito ``deposito_a_proveedor`` activo."""
    with db_session() as session:
        rows = session.execute(
            select(Guarantee.warranty_code)
            .join(RemitoItem, RemitoItem.guarantee_id == Guarantee.id)
            .join(Remito, Remito.id == RemitoItem.remito_id)
            .where(
                and_(
                    Remito.tipo_remito == "deposito_a_proveedor",
                    Remito.status.in_(["pendiente", "en_transito"]),
                )
            )
        ).all()
        return {r[0] for r in rows}


def pg_deposit_branches() -> list[dict[str, str]]:
    """Sucursales activas tipo deposit (orden alfabético)."""
    with db_session() as session:
        rows = session.scalars(
            select(Branch).where(and_(Branch.is_active.is_(True), Branch.type == "deposit")).order_by(Branch.name)
        ).all()
        return [
            {"id": b.id or "", "name": b.name or "", "code": b.code or "", "company_id": b.company_id or ""}
            for b in rows
        ]


def pg_warranty_central_deposit_name() -> str:
    """Depósito Chiclana como destino central obligatorio para REM de sucursal."""
    with db_session() as session:
        row = session.scalar(
            select(Branch).where(
                and_(
                    Branch.is_active.is_(True),
                    Branch.type == "deposit",
                    func.lower(Branch.code).like("%chiclana%") | func.lower(Branch.name).like("%chiclana%"),
                )
            ).order_by(Branch.name).limit(1)
        )
        return (row.name if row and row.name else "Depósito Chiclana")


def pg_resolve_remito_brand(origen_sucursal: str, fallback_company_id: str = "") -> str:
    """Resuelve la marca (gv_electro / abc_electro) desde la branch real."""
    suc = (origen_sucursal or "").strip()
    if suc:
        with db_session() as session:
            cid = session.scalar(
                select(Branch.company_id).where(
                    and_(
                        Branch.is_active.is_(True),
                        func.lower(Branch.name) == suc.lower(),
                    )
                )
            ) or session.scalar(
                select(Branch.company_id).where(
                    and_(
                        Branch.is_active.is_(True),
                        func.lower(Branch.code) == suc.lower(),
                    )
                )
            )
            if cid:
                return "abc_electro" if "abc" in cid.lower() else "gv_electro"
    cid = (fallback_company_id or "").lower()
    return "abc_electro" if "abc" in cid else "gv_electro"


# ── Escrituras ──────────────────────────────────────────────────────────────

def _resolve_guarantee_ids(session: Session, warranty_codes: Iterable[str]) -> dict[str, int]:
    """Mapea warranty_code → guarantee.id. Códigos sin match se omiten."""
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return {}
    rows = session.execute(
        select(Guarantee.warranty_code, Guarantee.id).where(Guarantee.warranty_code.in_(codes))
    ).all()
    return {wc: gid for wc, gid in rows}


def pg_create_remito(
    *,
    remito_code: str,
    tipo_remito: str,
    company_brand: str,
    origen_sucursal: str,
    destino_deposito: str,
    warranty_codes: Iterable[str],
    proveedor: str = "",
    shipment_code: str = "",
    nota: str = "",
    created_by_username: str = "",
    status: str = "pendiente",
) -> dict[str, Any]:
    """Crea un remito + RemitoItems para cada warranty_code.

    Devuelve el dict legacy del remito creado. Lanza ValueError si algún
    warranty_code no existe en ``guarantees``.
    """
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    with db_session() as session:
        gid_map = _resolve_guarantee_ids(session, codes)
        missing = [c for c in codes if c not in gid_map]
        if missing:
            raise ValueError(f"warranty_codes inexistentes en guarantees: {', '.join(missing)}")

        origen_branch_id = _resolve_branch_id_by_name(session, origen_sucursal)
        destino_branch_id = _resolve_branch_id_by_name(session, destino_deposito)
        created_by_user_id = _resolve_user_id(session, created_by_username)

        r = Remito(
            remito_code=remito_code,
            shipment_code=str(shipment_code or ""),
            tipo_remito=str(tipo_remito or "sucursal_a_deposito"),
            company_brand=str(company_brand or "gv_electro"),
            origen_branch_id=origen_branch_id,
            destino_branch_id=destino_branch_id,
            origen_sucursal=str(origen_sucursal or "").strip(),
            destino_deposito=str(destino_deposito or "").strip(),
            proveedor=str(proveedor or "").strip(),
            status=str(status or "pendiente"),
            nota=str(nota or "").strip(),
            created_by_user_id=created_by_user_id,
        )
        session.add(r)
        try:
            session.flush()
        except IntegrityError as exc:
            session.rollback()
            raise ValueError(f"remito_code duplicado: {remito_code}") from exc

        for code in codes:
            session.add(RemitoItem(remito_id=r.id, guarantee_id=gid_map[code]))
        session.commit()
        session.refresh(r)
        return _remito_to_legacy_dict(r, session)


def pg_set_remito_pdf_path(remito_code: str, pdf_path: str) -> bool:
    with db_session() as session:
        r = session.scalar(select(Remito).where(Remito.remito_code == remito_code.strip()))
        if not r:
            return False
        r.pdf_path = str(pdf_path or "")
        session.commit()
        return True


def pg_dispatch_remito(*, remito_code: str, despachado_por_username: str, nota: str = "") -> dict[str, Any] | None:
    """Marca el remito como en_transito y agrega fecha_despacho + actor."""
    code = (remito_code or "").strip()
    with db_session() as session:
        r = session.scalar(select(Remito).where(Remito.remito_code == code))
        if not r:
            return None
        r.status = "en_transito"
        r.fecha_despacho = _utc_now()
        r.despachado_por_user_id = _resolve_user_id(session, despachado_por_username)
        if nota:
            r.nota = str(nota or "").strip()
        session.commit()
        session.refresh(r)
        return _remito_to_legacy_dict(r, session)


def pg_confirm_arrival(*, remito_code: str, recibido_por_username: str, nota: str = "") -> dict[str, Any] | None:
    """Marca el remito como llegado y agrega fecha_llegada + actor."""
    code = (remito_code or "").strip()
    with db_session() as session:
        r = session.scalar(select(Remito).where(Remito.remito_code == code))
        if not r:
            return None
        r.status = "llegado"
        r.fecha_llegada = _utc_now()
        r.recibido_por_user_id = _resolve_user_id(session, recibido_por_username)
        if nota:
            r.nota = (r.nota or "") + ("\n" if r.nota else "") + nota
        session.commit()
        session.refresh(r)
        return _remito_to_legacy_dict(r, session)


def pg_delete_remito(remito_code: str) -> bool:
    """Borra un remito. ``remito_items`` se borra por CASCADE."""
    code = (remito_code or "").strip()
    with db_session() as session:
        r = session.scalar(select(Remito).where(Remito.remito_code == code))
        if not r:
            return False
        session.delete(r)
        session.commit()
        return True


def pg_available_warranties_for_remito(*, sucursal: str = "") -> list[dict[str, Any]]:
    """Garantías disponibles para REM interno (sucursal → depósito).

    Replica el ``_available_remito_where`` del legacy en SQLAlchemy. Una garantía
    está disponible si:
      - nació en sucursal (origen_ingreso vacío o 'sucursal');
      - está físicamente en sucursal (ubicacion_actual vacío, 'sucursal' o == sucursal);
      - sin transit_status;
      - sin remito interno activo (remito_interno vacío);
      - no cancelada ni en estados finales.
    """
    with db_session() as session:
        stmt = (
            select(Guarantee, GuaranteeItem)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id, isouter=True)
            .where(
                and_(
                    (Guarantee.remito_interno == "") | (Guarantee.remito_interno.is_(None)),
                    Guarantee.cancelled.is_(False),
                    ~func.upper(func.coalesce(Guarantee.status, "")).in_(
                        ["ANULADO", "FINALIZADO", "CANCELADO", "9 - ANULADA", "10 - FINALIZADO"]
                    ),
                    (Guarantee.origen_ingreso == "sucursal") | (Guarantee.origen_ingreso == "") | (Guarantee.origen_ingreso.is_(None)),
                    (Guarantee.ubicacion_actual == "sucursal") | (Guarantee.ubicacion_actual == "") | (Guarantee.ubicacion_actual.is_(None))
                    | (func.lower(Guarantee.ubicacion_actual) == func.lower(Guarantee.sucursal)),
                    (Guarantee.transit_status == "") | (Guarantee.transit_status.is_(None)),
                )
            )
            .order_by(Guarantee.sucursal, Guarantee.warranty_code, GuaranteeItem.id)
        )
        if sucursal:
            stmt = stmt.where(func.lower(Guarantee.sucursal) == sucursal.strip().lower())
        rows = session.execute(stmt).all()

    by_code: dict[str, dict[str, Any]] = {}
    for g, i in rows:
        wc = g.warranty_code
        if wc not in by_code:
            by_code[wc] = {
                "warranty_code": wc,
                "sucursal": g.sucursal or "",
                "branch_id": g.branch_id or "",
                "company_id": g.company_id or "",
                "estado": g.status or "",
                "review_status": g.review_status or "",
                "origen_ingreso": g.origen_ingreso or "",
                "tipo_ingreso": g.tipo_ingreso or "",
                "ubicacion_actual": g.ubicacion_actual or "",
                "producto": (i.producto if i else "") or "",
                "sku": (i.sku if i else "") or "",
                "serie": (i.serie if i else "") or "",
                "falla": (i.falla if i else "") or "",
                "marca": (i.marca if i else "") or "",
            }
    return list(by_code.values())


def pg_mark_warranties_remito_interno(*, warranty_codes: Iterable[str], remito_code: str, updated_by_username: str = "") -> int:
    """Equivalente a ``UPDATE guarantees SET remito_interno = ?...``. Devuelve cuántas filas tocó."""
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return 0
    count = 0
    with db_session() as session:
        user_id = _resolve_user_id(session, updated_by_username)
        rows = session.scalars(select(Guarantee).where(Guarantee.warranty_code.in_(codes))).all()
        for g in rows:
            g.remito_interno = remito_code
            g.updated_at = _utc_now()
            if user_id is not None:
                g.updated_by_user_id = user_id
            g.synced_to_google_sheet = False
            count += 1
        session.commit()
    return count


def pg_mark_warranties_in_transit(
    *,
    warranty_codes: Iterable[str],
    remito_code: str,
    updated_by_username: str = "",
    lugar_salida: str = "",
) -> int:
    """Marca garantías como en tránsito (despacho de remito interno)."""
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return 0
    count = 0
    with db_session() as session:
        user_id = _resolve_user_id(session, updated_by_username)
        rows = session.scalars(select(Guarantee).where(Guarantee.warranty_code.in_(codes))).all()
        now = _utc_now()
        for g in rows:
            g.remito_interno = remito_code
            g.transit_status = "en_transito"
            g.ubicacion_actual = "en_transito"
            if lugar_salida:
                g.fecha_salida_transito = now
                g.lugar_salida_transito = lugar_salida
            g.updated_at = now
            if user_id is not None:
                g.updated_by_user_id = user_id
            g.synced_to_google_sheet = False
            count += 1
        session.commit()
    return count


def pg_mark_warranties_provider_delivery(
    *,
    warranty_codes: Iterable[str],
    remito_code: str,
    updated_by_username: str = "",
    lugar_salida: str = "",
) -> int:
    """Marca garantias como ENTREGADAS al proveedor (ya las retiró).

    Semántica: el remito a proveedor representa que el proveedor pasó por el
    depósito y se llevó las garantías. No hay tránsito previo: el momento de
    creación del remito es el momento de entrega. Por eso quedan en estado
    "5 - EN EL PROVEEDOR" con estado_retiro_proveedor="retirado" y fecha_retiro
    igual al momento del remito. La app después solo espera respuesta del
    proveedor (resolución o rechazo).
    """
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return 0
    count = 0
    with db_session() as session:
        user_id = _resolve_user_id(session, updated_by_username)
        rows = session.scalars(select(Guarantee).where(Guarantee.warranty_code.in_(codes))).all()
        now = _utc_now()
        for g in rows:
            g.remito_proveedor = remito_code
            g.status = "5 - EN EL PROVEEDOR"
            g.estado_retiro_proveedor = "retirado"
            g.fecha_retiro = now
            g.fecha_retiro_proveedor = now
            g.ubicacion_actual = "proveedor"
            g.transit_status = ""
            if lugar_salida:
                g.lugar_salida_transito = lugar_salida
                g.fecha_salida_transito = now
            g.updated_at = now
            if user_id is not None:
                g.updated_by_user_id = user_id
            g.synced_to_google_sheet = False
            count += 1
        session.commit()
    return count


def pg_confirm_warranties_remito_arrival(
    *,
    warranty_codes: Iterable[str],
    remito_code: str,
    destino: str,
    tipo_remito: str,
    updated_by_username: str = "",
) -> int:
    """Aplica la llegada del remito sobre las garantias incluidas."""
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return 0
    count = 0
    with db_session() as session:
        user_id = _resolve_user_id(session, updated_by_username)
        rows = session.scalars(select(Guarantee).where(Guarantee.warranty_code.in_(codes))).all()
        now = _utc_now()
        for g in rows:
            if tipo_remito == "deposito_a_proveedor":
                g.transit_status = "entregado_proveedor"
                g.ubicacion_actual = "proveedor"
                g.estado_retiro_proveedor = "retirado"
                g.fecha_retiro_proveedor = now
                g.fecha_retiro = now
                g.remito_proveedor = remito_code
            else:
                g.transit_status = "en_deposito"
                g.lugar_llegada = destino
                g.deposito = destino
                g.ubicacion_actual = destino or "deposito"
                g.fecha_llegada_transito = now
                g.remito_interno = remito_code
            g.updated_at = now
            if user_id is not None:
                g.updated_by_user_id = user_id
            g.synced_to_google_sheet = False
            count += 1
        session.commit()
    return count


def pg_unlink_warranties_from_remito(*, warranty_codes: Iterable[str], remito_code: str, updated_by_username: str = "") -> int:
    """Desvincula garantias de un remito pendiente/en transito eliminado."""
    codes = [str(c).strip() for c in warranty_codes or [] if str(c).strip()]
    if not codes:
        return 0
    count = 0
    with db_session() as session:
        user_id = _resolve_user_id(session, updated_by_username)
        rows = session.scalars(select(Guarantee).where(Guarantee.warranty_code.in_(codes))).all()
        now = _utc_now()
        for g in rows:
            if g.remito_interno == remito_code:
                g.remito_interno = ""
                g.transit_status = ""
                g.ubicacion_actual = "sucursal" if (g.origen_ingreso or "") == "sucursal" else g.ubicacion_actual
            if g.remito_proveedor == remito_code:
                g.remito_proveedor = ""
                g.transit_status = ""
                g.ubicacion_actual = g.deposito or g.lugar_llegada or "deposito"
            g.updated_at = now
            if user_id is not None:
                g.updated_by_user_id = user_id
            g.synced_to_google_sheet = False
            count += 1
        session.commit()
    return count


def pg_available_warranties_for_deposit_transfer(*, origen: str) -> list[dict[str, Any]]:
    """Garantias fisicamente en un deposito y libres para mover a otro deposito."""
    origin = str(origen or "").strip()
    if not origin:
        return []
    active_codes = pg_active_remito_codes()
    with db_session() as session:
        rows = session.execute(
            select(Guarantee, GuaranteeItem)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id, isouter=True)
            .where(
                and_(
                    Guarantee.cancelled.is_(False),
                    ~func.upper(func.coalesce(Guarantee.status, "")).in_(
                        ["ANULADO", "FINALIZADO", "CANCELADO", "9 - ANULADA", "10 - FINALIZADO"]
                    ),
                    (func.lower(func.coalesce(Guarantee.ubicacion_actual, "")) == origin.lower())
                    | (Guarantee.ubicacion_actual == "deposito")
                    | (Guarantee.transit_status == "en_deposito"),
                    func.upper(func.coalesce(Guarantee.transit_status, "")) != "EN_TRANSITO",
                    (func.lower(func.coalesce(Guarantee.deposito, "")) == origin.lower())
                    | (func.lower(func.coalesce(Guarantee.lugar_llegada, "")) == origin.lower()),
                )
            )
            .order_by(Guarantee.warranty_code, GuaranteeItem.id)
        ).all()
    out: dict[str, dict[str, Any]] = {}
    for g, i in rows:
        if g.warranty_code in active_codes:
            continue
        out.setdefault(g.warranty_code, {
            "warranty_code": g.warranty_code,
            "sucursal": g.sucursal or "",
            "company_id": g.company_id or "",
            "estado": g.status or "",
            "review_status": g.review_status or "",
            "origen_ingreso": g.origen_ingreso or "",
            "tipo_ingreso": g.tipo_ingreso or "",
            "ubicacion_actual": g.ubicacion_actual or "",
            "deposito": g.deposito or "",
            "lugar_llegada": g.lugar_llegada or "",
            "producto": (i.producto if i else "") or "",
            "sku": (i.sku if i else "") or "",
            "serie": (i.serie if i else "") or "",
            "falla": (i.falla if i else "") or "",
            "marca": (i.marca if i else "") or "",
        })
    return list(out.values())


def pg_available_warranties_for_provider_delivery() -> list[dict[str, Any]]:
    """Garantias listas para remito deposito -> proveedor."""
    active_codes = pg_active_provider_delivery_codes()
    with db_session() as session:
        rows = session.execute(
            select(Guarantee, GuaranteeItem)
            .join(GuaranteeItem, GuaranteeItem.guarantee_id == Guarantee.id, isouter=True)
            .where(
                and_(
                    Guarantee.cancelled.is_(False),
                    ~func.upper(func.coalesce(Guarantee.status, "")).in_(
                        ["ANULADO", "FINALIZADO", "CANCELADO", "9 - ANULADA", "10 - FINALIZADO"]
                    ),
                    Guarantee.estado_retiro_proveedor == "listo_para_retiro",
                )
            )
            .order_by(Guarantee.provider_name, Guarantee.warranty_code, GuaranteeItem.id)
        ).all()
    out: dict[str, dict[str, Any]] = {}
    for g, i in rows:
        if g.warranty_code in active_codes:
            continue
        out.setdefault(g.warranty_code, {
            "warranty_code": g.warranty_code,
            "sucursal": g.sucursal or "",
            "company_id": g.company_id or "",
            "estado": g.status or "",
            "provider_name": g.provider_name or "",
            "deposito": g.deposito or g.lugar_llegada or "",
            "estado_retiro_proveedor": g.estado_retiro_proveedor or "",
            "fecha_solicitud_retiro_proveedor": _iso_or_empty(g.fecha_solicitud_retiro_proveedor),
            "producto": (i.producto if i else "") or "",
            "sku": (i.sku if i else "") or "",
            "serie": (i.serie if i else "") or "",
            "falla": (i.falla if i else "") or "",
            "marca": (i.marca if i else "") or "",
        })
    return list(out.values())
