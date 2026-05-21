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
import re
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..audit import audit
from ..auth import require_current_user, require_permission
from ..pdf_remito import BRANDS, generate_provider_delivery_pdf, generate_remito_pdf, get_company_brand
from ..permissions import has_permission
from ..users import load_roles, load_users
from .notifications import notify_many
from .warranties import (
    REVIEW_APPROVED,
    add_history,
    db_connect,
    ensure_warranty_tables,
    format_datetime_ar,
    now_ar,
    parse_iso_datetime,
    utc_now_iso,
)

router = APIRouter(prefix="/api/warranties/remitos", tags=["remitos"])

# ── DB helpers ───────────────────────────────────────────────────────────────

def ensure_remito_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS warranty_remitos (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            remito_code         TEXT UNIQUE NOT NULL,
            shipment_code       TEXT NOT NULL DEFAULT '',
            company_brand       TEXT NOT NULL DEFAULT 'gv_electro',
            origen_sucursal     TEXT NOT NULL DEFAULT '',
            destino_deposito    TEXT NOT NULL DEFAULT '',
            warranty_ids_json   TEXT NOT NULL DEFAULT '[]',
            proveedor           TEXT NOT NULL DEFAULT '',
            status              TEXT NOT NULL DEFAULT 'pendiente',
            created_at          TEXT NOT NULL,
            created_by          TEXT NOT NULL DEFAULT '',
            created_by_name     TEXT NOT NULL DEFAULT '',
            fecha_despacho      TEXT NOT NULL DEFAULT '',
            despachado_por      TEXT NOT NULL DEFAULT '',
            despachado_por_name TEXT NOT NULL DEFAULT '',
            fecha_llegada       TEXT NOT NULL DEFAULT '',
            recibido_por        TEXT NOT NULL DEFAULT '',
            recibido_por_name   TEXT NOT NULL DEFAULT '',
            nota                TEXT NOT NULL DEFAULT ''
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_warranty_remitos_code     ON warranty_remitos(remito_code)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_warranty_remitos_shipment ON warranty_remitos(shipment_code)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_warranty_remitos_status   ON warranty_remitos(status)")
    _ensure_column(conn, "warranty_remitos", "tipo_remito", "TEXT NOT NULL DEFAULT 'sucursal_a_deposito'")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_warranty_remitos_tipo ON warranty_remitos(tipo_remito)")



def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    existing = {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")



def _brand_from_company_id(company_id: str) -> str:
    cid = (company_id or "").strip().lower()
    return "abc_electro" if "abc" in cid else "gv_electro"


def _resolve_remito_brand(conn: sqlite3.Connection, origen_sucursal: str, fallback_company_id: str = "") -> str:
    """Resuelve la marca del PDF/remito desde branches/empresa, no desde texto suelto.

    Fallback: si no encuentra branch real, usa la heurística legacy de sucursal.
    """
    suc = (origen_sucursal or "").strip()
    if suc:
        row = conn.execute(
            """SELECT company_id FROM branches
               WHERE LOWER(name) = LOWER(?) OR LOWER(code) = LOWER(?)
               LIMIT 1""",
            (suc, suc),
        ).fetchone()
        if row and str(row["company_id"] or ""):
            return _brand_from_company_id(str(row["company_id"]))
    if fallback_company_id:
        return _brand_from_company_id(fallback_company_id)
    return get_company_brand(suc)



def _warranty_central_deposit_name(conn: sqlite3.Connection) -> str:
    """Depósito destino obligatorio para remitos de sucursal en Garantías.

    Regla actual: las sucursales siempre envían garantías a Depósito Chiclana.
    Corrales y Cachi son depósitos de guarda y solo se moverán desde depósito
    en una fase posterior.
    """
    row = conn.execute(
        """SELECT name FROM branches
           WHERE is_active = 1 AND type = 'deposit'
             AND (LOWER(code) LIKE '%chiclana%' OR LOWER(name) LIKE '%chiclana%')
           ORDER BY name COLLATE NOCASE LIMIT 1"""
    ).fetchone()
    if row and str(row["name"] or "").strip():
        return str(row["name"] or "").strip()
    # No caer al primer depósito disponible: Corrales/Cachi son depósitos de
    # guarda y no pueden ser destino automático de remitos de sucursal.
    return "Depósito Chiclana"

def next_remito_code(conn: sqlite3.Connection, brand: str) -> str:
    prefix_map = {"abc_electro": "ABC", "gv_electro": "GV"}
    code   = prefix_map.get(brand, "GV")
    year   = now_ar().year
    prefix = f"{code}-R-{year}-"
    rows   = conn.execute(
        "SELECT remito_code FROM warranty_remitos WHERE remito_code LIKE ? ORDER BY id DESC",
        (f"{prefix}%",),
    ).fetchall()
    last = 0
    for row in rows:
        m = re.fullmatch(rf"{code}-R-{year}-(\d+)", str(row["remito_code"] or ""))
        if m:
            last = max(last, int(m.group(1)))
    return f"{code}-R-{year}-{(last + 1):04d}"


def next_provider_delivery_code(conn: sqlite3.Connection) -> str:
    """Genera códigos RP-YYYY-XXXX para remitos de entrega al proveedor (distintos de GV-R-/ABC-R-)."""
    year   = now_ar().year
    prefix = f"RP-{year}-"
    rows   = conn.execute(
        "SELECT remito_code FROM warranty_remitos WHERE remito_code LIKE ? ORDER BY id DESC",
        (f"{prefix}%",),
    ).fetchall()
    last = 0
    for row in rows:
        m = re.fullmatch(rf"RP-{year}-(\d+)", str(row["remito_code"] or ""))
        if m:
            last = max(last, int(m.group(1)))
    return f"RP-{year}-{(last + 1):04d}"


def load_warranties_for_ids(conn: sqlite3.Connection, ids: list[str]) -> list[dict[str, Any]]:
    """Carga datos básicos de garantías para mostrar en el detalle del remito."""
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    g_rows = conn.execute(
        f"""
        SELECT g.warranty_code, gi.producto, gi.sku, gi.marca, gi.serie, gi.falla
        FROM guarantees g
        LEFT JOIN guarantee_items gi ON gi.guarantee_id = g.id
        WHERE g.warranty_code IN ({placeholders})
        ORDER BY g.warranty_code, gi.id
        """,
        ids,
    ).fetchall()
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for gr in g_rows:
        wc = str(gr["warranty_code"])
        if wc not in seen:
            seen.add(wc)
            result.append({
                "warranty_code": wc,
                "producto":      str(gr["producto"] or ""),
                "sku":           str(gr["sku"] or ""),
                "marca":         str(gr["marca"] or ""),
                "serie":         str(gr["serie"] or ""),
                "falla":         str(gr["falla"] or ""),
            })
    return result


def row_to_remito(row: sqlite3.Row, warranties: list[dict[str, Any]] | None = None) -> dict[str, Any]:
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
    """Envía notificación a todos los usuarios con permiso warranties.manage_provider."""
    try:
        roles = load_roles()
        users = load_users()
        manager_usernames: list[str] = []
        for user in users.values():
            if not getattr(user, "is_active", True):
                continue
            perms: list[str] = []
            for role_name in (getattr(user, "roles", None) or [getattr(user, "role", "")] or []):
                role = roles.get(role_name)
                if role:
                    perms.extend(getattr(role, "permissions", []))
            if has_permission(perms, "warranties.manage_provider"):
                manager_usernames.append(user.username)
        if manager_usernames:
            notify_many(manager_usernames, title, message, type_="warning")
    except Exception:
        pass  # notificaciones no son críticas


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


# ── Helper: generación interna ────────────────────────────────────────────────

def _generate_remitos_for_shipment(
    conn: sqlite3.Connection,
    shipment_code: str,
    destino_deposito: str,
    actor: str,
    actor_nm: str,
) -> list[dict[str, Any]]:
    """
    Agrupa las garantías del lote por sucursal de origen y crea un remito por cada una.
    Si ya existe un remito para esa combinación lote+sucursal, lo omite.
    Devuelve lista de remitos creados (dicts row_to_remito).
    """
    ensure_remito_tables(conn)
    ensure_warranty_tables(conn)

    export_row = conn.execute(
        "SELECT * FROM guarantee_exports WHERE shipment_code = ?",
        (shipment_code,),
    ).fetchone()
    if not export_row:
        return []

    try:
        warranty_ids: list[str] = json.loads(str(export_row["warranty_ids_json"] or "[]"))
    except Exception:
        warranty_ids = []
    if not warranty_ids:
        return []

    proveedor = str(export_row["provider_name"] or "")
    placeholders = ",".join("?" * len(warranty_ids))
    guarantee_rows = conn.execute(
        f"SELECT warranty_code, sucursal FROM guarantees WHERE warranty_code IN ({placeholders})",
        warranty_ids,
    ).fetchall()

    # Agrupar por sucursal de origen
    groups: dict[str, list[str]] = {}
    for row in guarantee_rows:
        suc = str(row["sucursal"] or "Sin sucursal")
        groups.setdefault(suc, []).append(str(row["warranty_code"]))

    now = utc_now_iso()
    created: list[dict[str, Any]] = []

    for sucursal, codes in groups.items():
        existing = conn.execute(
            "SELECT remito_code FROM warranty_remitos WHERE shipment_code = ? AND origen_sucursal = ?",
            (shipment_code, sucursal),
        ).fetchone()
        if existing:
            continue

        brand = get_company_brand(sucursal)
        code  = next_remito_code(conn, brand)

        conn.execute(
            """
            INSERT INTO warranty_remitos
                (remito_code, shipment_code, company_brand, origen_sucursal,
                 destino_deposito, warranty_ids_json, proveedor, status,
                 created_at, created_by, created_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)
            """,
            (code, shipment_code, brand, sucursal,
             destino_deposito, json.dumps(codes), proveedor,
             now, actor, actor_nm),
        )
        for wcode in codes:
            conn.execute(
                "UPDATE guarantees SET remito_interno = ?, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE warranty_code = ?",
                (code, now, actor, actor_nm, wcode),
            )
        row_new = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (code,)).fetchone()
        w_data  = load_warranties_for_ids(conn, codes)
        created.append(row_to_remito(row_new, w_data))

    return created


# ── Helper: notificar usuarios de una sucursal ────────────────────────────────

def _notify_remitos_view_users(title: str, message: str) -> None:
    """Notifica a usuarios con seguimiento de remitos."""
    try:
        roles = load_roles()
        users = load_users()
        targets: list[str] = []
        for user in users.values():
            if not getattr(user, "is_active", True):
                continue
            perms: list[str] = []
            for role_name in (getattr(user, "roles", None) or [getattr(user, "role", "")]):
                role = roles.get(role_name)
                if role:
                    perms.extend(getattr(role, "permissions", []))
            if has_permission(perms, "warranties.remitos.view"):
                targets.append(user.username)
        if targets:
            notify_many(targets, title, message, type_="warning")
    except Exception:
        pass


def _notify_gestor_garantias(title: str, message: str) -> None:
    """Notifica a usuarios con permiso warranties.remitos.provider_delivery (Gestores de Garantías)."""
    try:
        roles = load_roles()
        users = load_users()
        targets: list[str] = []
        for user in users.values():
            if not getattr(user, "is_active", True):
                continue
            perms: list[str] = []
            for role_name in (getattr(user, "roles", None) or [getattr(user, "role", "")]):
                role = roles.get(role_name)
                if role:
                    perms.extend(getattr(role, "permissions", []))
            if has_permission(perms, "warranties.remitos.provider_delivery"):
                targets.append(user.username)
        if targets:
            notify_many(targets, title, message, type_="warning")
    except Exception:
        pass


def _require_any(user: Any, *permissions: str) -> None:
    if getattr(user, "must_change_password", False):
        raise HTTPException(403, "Tenés que crear tu contraseña antes de continuar")
    if not any(getattr(user, "has", lambda _p: False)(permission) for permission in permissions):
        raise HTTPException(403, "No tenés permiso para realizar esta acción")


def _user_deposit_name(user: Any) -> str:
    if str(getattr(user, "branch_type", "") or "").lower() != "deposit":
        raise HTTPException(403, "Tu usuario no está asignado a un depósito.")
    name = str(getattr(user, "branch_name", "") or getattr(user, "sucursal", "") or "").strip()
    if not name:
        raise HTTPException(400, "Tu usuario no tiene depósito asignado.")
    return name


def _active_remito_codes(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT warranty_ids_json FROM warranty_remitos WHERE status IN ('pendiente','en_transito')").fetchall()
    active: set[str] = set()
    for row in rows:
        try:
            for code in json.loads(str(row["warranty_ids_json"] or "[]")):
                if str(code).strip():
                    active.add(str(code).strip())
        except Exception:
            continue
    return active


def _active_provider_delivery_codes(conn: sqlite3.Connection) -> set[str]:
    """Garantías que ya tienen un remito deposito_a_proveedor activo (pendiente o en tránsito)."""
    rows = conn.execute(
        "SELECT warranty_ids_json FROM warranty_remitos WHERE tipo_remito = 'deposito_a_proveedor' AND status IN ('pendiente','en_transito')"
    ).fetchall()
    active: set[str] = set()
    for row in rows:
        try:
            for code in json.loads(str(row["warranty_ids_json"] or "[]")):
                if str(code).strip():
                    active.add(str(code).strip())
        except Exception:
            continue
    return active


def _deposit_branches(conn: sqlite3.Connection) -> list[dict[str, str]]:
    rows = conn.execute(
        """SELECT id, name, code, company_id FROM branches
           WHERE is_active = 1 AND type = 'deposit'
           ORDER BY name COLLATE NOCASE"""
    ).fetchall()
    return [{"id": str(r["id"] or ""), "name": str(r["name"] or ""), "code": str(r["code"] or ""), "company_id": str(r["company_id"] or "")} for r in rows]


# ── Reglas de disponibilidad de remitos ───────────────────────────────────────

REM_FINAL_STATUSES = {"llegado"}


def _available_remito_where(alias: str = "g") -> str:
    """Condición única para saber si una garantía puede entrar a un REM.

    Una garantía está disponible para remito interno solo si:
    - nació en sucursal;
    - está físicamente en sucursal;
    - no tiene remito activo;
    - no está anulada/finalizada;
    - no está ya en tránsito ni en depósito.

    Se dejan algunos fallbacks legacy para datos previos a las fases 1-3,
    pero la fuente de verdad nueva es origen_ingreso + ubicacion_actual.
    """
    a = alias
    return f"""
      AND ({a}.remito_interno IS NULL OR {a}.remito_interno = '')
      AND ({a}.cancelled IS NULL OR {a}.cancelled = 0)
      AND UPPER(COALESCE({a}.status, '')) NOT IN ('ANULADO', 'FINALIZADO', 'CANCELADO')
      AND (
            {a}.origen_ingreso = 'sucursal'
            OR ({a}.origen_ingreso IS NULL OR {a}.origen_ingreso = '')
          )
      AND (
            {a}.ubicacion_actual = 'sucursal'
            OR LOWER(COALESCE({a}.ubicacion_actual, '')) = LOWER(COALESCE({a}.sucursal, ''))
            OR ({a}.ubicacion_actual IS NULL OR {a}.ubicacion_actual = '')
          )
      AND ({a}.transit_status IS NULL OR {a}.transit_status = '')
    """


def _fetch_available_remito_rows(
    conn: sqlite3.Connection,
    *,
    sucursal: str = "",
    warranty_codes: list[str] | None = None,
) -> list[sqlite3.Row]:
    params: list[Any] = []
    sql = """
        SELECT g.warranty_code, g.sucursal, g.branch_id, g.company_id,
               g.sucursal_responsable, g.sucursal_responsable_id,
               g.status, g.review_status, g.origen_ingreso, g.tipo_ingreso,
               g.ubicacion_actual, g.transit_status, g.remito_interno,
               gi.producto, gi.sku, gi.serie, gi.falla, gi.marca
        FROM guarantees g
        LEFT JOIN guarantee_items gi ON gi.guarantee_id = g.id
        WHERE 1=1
    """ + _available_remito_where("g")
    if sucursal:
        sql += " AND g.sucursal = ?"
        params.append(sucursal)
    if warranty_codes:
        placeholders = ",".join("?" * len(warranty_codes))
        sql += f" AND g.warranty_code IN ({placeholders})"
        params.extend(warranty_codes)
    sql += " ORDER BY g.sucursal, g.warranty_code, gi.id"
    return conn.execute(sql, params).fetchall()


def _collapse_remito_rows(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    for row in rows:
        wc = str(row["warranty_code"])
        if wc not in by_code:
            by_code[wc] = {
                "warranty_code": wc,
                "sucursal":      str(row["sucursal"] or ""),
                "branch_id":      str(row["branch_id"] or "") if "branch_id" in row.keys() else "",
                "company_id":     str(row["company_id"] or "") if "company_id" in row.keys() else "",
                "estado":        str(row["status"] or ""),
                "review_status": str(row["review_status"] or ""),
                "origen_ingreso": str(row["origen_ingreso"] or ""),
                "tipo_ingreso": str(row["tipo_ingreso"] or ""),
                "ubicacion_actual": str(row["ubicacion_actual"] or ""),
                "producto":      str(row["producto"] or ""),
                "sku":           str(row["sku"] or ""),
                "serie":         str(row["serie"] or ""),
                "falla":         str(row["falla"] or ""),
                "marca":         str(row["marca"] or ""),
            }
    return list(by_code.values())

# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/available-warranties")
def available_warranties_for_remito(
    _user:    Annotated[Any, Depends(require_permission("warranties.remitos.generate"))],
    sucursal: str = "",
):
    """Devuelve garantías disponibles para REM interno sucursal → depósito.

    La regla de disponibilidad está centralizada en _available_remito_where.
    No depende de review_status ni de shipment_code/ENV: el remito es físico.
    """
    with db_connect() as conn:
        ensure_warranty_tables(conn)
        rows = _fetch_available_remito_rows(conn, sucursal=sucursal)
    items = _collapse_remito_rows(rows)
    return {"items": items, "total": len(items)}


@router.get("/deposit-transfer/options")
def deposit_transfer_options(
    user: Annotated[Any, Depends(require_current_user)],
):
    """Opciones para operadores de depósito.

    Este endpoint no devuelve seguimiento completo. Solo informa origen asignado
    y destinos posibles para movimientos internos depósito→depósito.
    """
    _require_any(user, "warranties.remitos.deposit_transfer")
    origen = _user_deposit_name(user)
    with db_connect() as conn:
        ensure_remito_tables(conn)
        deposits = _deposit_branches(conn)
    destinos = [d for d in deposits if d["name"].strip().lower() != origen.strip().lower()]
    return {"origen_deposito": origen, "destinos": destinos}


@router.get("/deposit-transfer/available-warranties")
def available_warranties_for_deposit_transfer(
    user: Annotated[Any, Depends(require_current_user)],
):
    """Garantías físicamente en el depósito del usuario y libres para mover.

    No requiere permiso de seguimiento: está pensado para empleados de depósito
    que solo hacen recepción y movimientos internos.
    """
    _require_any(user, "warranties.remitos.deposit_transfer")
    origen = _user_deposit_name(user)
    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)
        active_codes = _active_remito_codes(conn)
        rows = conn.execute(
            """
            SELECT g.warranty_code, g.sucursal, g.company_id, g.status, g.review_status,
                   g.origen_ingreso, g.tipo_ingreso, g.ubicacion_actual, g.transit_status,
                   g.deposito, g.lugar_llegada, g.remito_interno,
                   gi.producto, gi.sku, gi.serie, gi.falla, gi.marca
            FROM guarantees g
            LEFT JOIN guarantee_items gi ON gi.guarantee_id = g.id
            WHERE (g.cancelled IS NULL OR g.cancelled = 0)
              AND UPPER(COALESCE(g.status, '')) NOT IN ('9 - ANULADA', 'ANULADA', '10 - FINALIZADO', 'FINALIZADO')
              AND (LOWER(COALESCE(g.ubicacion_actual, '')) = LOWER(?) OR g.ubicacion_actual = 'deposito' OR g.transit_status = 'en_deposito')
              AND UPPER(COALESCE(g.transit_status, '')) != 'EN_TRANSITO'
              AND (
                    LOWER(COALESCE(g.deposito, '')) = LOWER(?)
                    OR LOWER(COALESCE(g.lugar_llegada, '')) = LOWER(?)
                  )
            ORDER BY g.warranty_code, gi.id
            """,
            (origen, origen, origen),
        ).fetchall()
    items = [item for item in _collapse_remito_rows(rows) if str(item["warranty_code"]) not in active_codes]
    return {"items": items, "total": len(items), "origen_deposito": origen}


@router.post("/deposit-transfer/generate")
def generate_deposit_transfer_remito(
    data: DepositTransferRequest,
    user: Annotated[Any, Depends(require_current_user)],
):
    """Genera un remito interno depósito→depósito.

    Alcance del rol DEPOSITO: mover físicamente garantías desde su depósito
    asignado hacia otro depósito. No permite seguimiento global ni gestión proveedor.
    """
    _require_any(user, "warranties.remitos.deposit_transfer")
    origen = _user_deposit_name(user)
    destino = data.destino_deposito.strip()
    if not destino:
        raise HTTPException(400, "Seleccioná depósito destino.")
    if destino.lower() == origen.lower():
        raise HTTPException(400, "El depósito destino debe ser distinto del origen.")

    codes = [str(c).strip() for c in (data.warranty_codes or []) if str(c).strip()]
    if not codes:
        raise HTTPException(400, "Seleccioná al menos una garantía para mover.")

    now = utc_now_iso()
    actor = getattr(user, "username", "") or ""
    actor_nm = getattr(user, "display_name", "") or actor

    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)
        deposits = _deposit_branches(conn)
        if not any(d["name"].strip().lower() == destino.lower() for d in deposits):
            raise HTTPException(400, "El depósito destino no existe o no está activo.")
        active_codes = _active_remito_codes(conn)
        blocked = [c for c in codes if c in active_codes]
        if blocked:
            raise HTTPException(400, "Hay garantías con remito activo: " + ", ".join(blocked))

        placeholders = ",".join("?" for _ in codes)
        rows = conn.execute(
            f"""
            SELECT g.warranty_code, g.company_id, g.deposito, g.lugar_llegada,
                   g.ubicacion_actual, g.transit_status, g.status
            FROM guarantees g
            WHERE g.warranty_code IN ({placeholders})
            """,
            codes,
        ).fetchall()
        found = {str(r["warranty_code"]): r for r in rows}
        missing = [c for c in codes if c not in found]
        if missing:
            raise HTTPException(400, "Garantías no encontradas: " + ", ".join(missing))
        invalid: list[str] = []
        company_id = ""
        for code in codes:
            row = found[code]
            loc_value = str(row["ubicacion_actual"] or "").strip().lower()
            loc_ok = loc_value == origen.lower() or loc_value == "deposito" or str(row["transit_status"] or "") == "en_deposito"
            place_ok = str(row["deposito"] or "").strip().lower() == origen.lower() or str(row["lugar_llegada"] or "").strip().lower() == origen.lower()
            status = str(row["status"] or "").upper()
            if not loc_ok or not place_ok or status in {"9 - ANULADA", "ANULADA", "10 - FINALIZADO", "FINALIZADO"}:
                invalid.append(code)
            if not company_id and row["company_id"]:
                company_id = str(row["company_id"] or "")
        if invalid:
            raise HTTPException(400, "Estas garantías no están disponibles en tu depósito: " + ", ".join(invalid))

        brand = _resolve_remito_brand(conn, origen, company_id)
        code = next_remito_code(conn, brand)
        conn.execute(
            """INSERT INTO warranty_remitos
                (remito_code, shipment_code, tipo_remito, company_brand, origen_sucursal,
                 destino_deposito, warranty_ids_json, proveedor, status,
                 nota, created_at, created_by, created_by_name)
               VALUES (?, '', 'deposito_a_deposito', ?, ?, ?, ?, '', 'pendiente', ?, ?, ?, ?)""",
            (code, brand, origen, destino, json.dumps(codes), (data.nota or "").strip(), now, actor, actor_nm),
        )
        for wcode in codes:
            g = conn.execute("SELECT id FROM guarantees WHERE warranty_code = ?", (wcode,)).fetchone()
            conn.execute(
                """UPDATE guarantees
                   SET remito_interno    = ?,
                       transit_status   = 'en_transito',
                       ubicacion_actual = 'en_transito',
                       updated_at = ?, updated_by = ?, updated_by_name = ?
                   WHERE warranty_code = ?""",
                (code, now, actor, actor_nm, wcode),
            )
            if g:
                add_history(conn, int(g["id"]), wcode, user, "deposit_transfer_generated",
                            note=f"Movimiento interno {code}: {origen} → {destino}",
                            details={"remito": code, "origen": origen, "destino": destino})
        row_new = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (code,)).fetchone()
        w_data = load_warranties_for_ids(conn, codes)
        conn.commit()

    audit("warranties.remitos.deposit_transfer", user=user, resource_type="warranty_remito", resource_id=code,
          details={"origen": origen, "destino": destino, "cantidad": len(codes)})
    return {"ok": True, "created": [row_to_remito(row_new, w_data)]}


# ── Entrega al proveedor (deposito_a_proveedor) ───────────────────────────────

@router.get("/provider-delivery/available-warranties")
def available_warranties_for_provider_delivery(
    user: Annotated[Any, Depends(require_current_user)],
):
    """Garantías listas para entregar al proveedor (estado_retiro_proveedor = listo_para_retiro)."""
    _require_any(user, "warranties.remitos.provider_delivery")
    with db_connect() as conn:
        ensure_warranty_tables(conn)
        ensure_remito_tables(conn)
        active_codes = _active_provider_delivery_codes(conn)
        rows = conn.execute(
            """
            SELECT g.warranty_code, g.sucursal, g.company_id, g.status, g.provider_name,
                   g.deposito, g.lugar_llegada, g.ubicacion_actual,
                   g.estado_retiro_proveedor, g.fecha_solicitud_retiro_proveedor,
                   gi.producto, gi.sku, gi.serie, gi.falla, gi.marca
            FROM guarantees g
            LEFT JOIN guarantee_items gi ON gi.guarantee_id = g.id
            WHERE (g.cancelled IS NULL OR g.cancelled = 0)
              AND UPPER(COALESCE(g.status, '')) NOT IN ('9 - ANULADA', 'ANULADA', '10 - FINALIZADO', 'FINALIZADO')
              AND g.estado_retiro_proveedor = 'listo_para_retiro'
            ORDER BY g.provider_name, g.warranty_code, gi.id
            """
        ).fetchall()
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for row in rows:
        wc = str(row["warranty_code"])
        if wc in seen or wc in active_codes:
            continue
        seen.add(wc)
        deposito_actual = str(row["deposito"] or row["lugar_llegada"] or "")
        items.append({
            "warranty_code":                   wc,
            "sucursal":                        str(row["sucursal"] or ""),
            "estado":                          str(row["status"] or ""),
            "provider_name":                   str(row["provider_name"] or ""),
            "deposito":                        deposito_actual,
            "estado_retiro_proveedor":         str(row["estado_retiro_proveedor"] or ""),
            "fecha_solicitud_retiro_proveedor": str(row["fecha_solicitud_retiro_proveedor"] or ""),
            "producto":                        str(row["producto"] or ""),
            "sku":                             str(row["sku"] or ""),
            "serie":                           str(row["serie"] or ""),
            "falla":                           str(row["falla"] or ""),
            "marca":                           str(row["marca"] or ""),
        })
    return {"items": items, "total": len(items)}


@router.post("/provider-delivery/generate")
def generate_provider_delivery_remito(
    data: ProviderDeliveryRequest,
    user: Annotated[Any, Depends(require_current_user)],
):
    """Genera un remito de entrega al proveedor (depósito → proveedor)."""
    _require_any(user, "warranties.remitos.provider_delivery")

    codes = [str(c).strip() for c in (data.warranty_codes or []) if str(c).strip()]
    if not codes:
        raise HTTPException(400, "Seleccioná al menos una garantía para incluir.")
    proveedor = data.proveedor.strip()
    if not proveedor:
        raise HTTPException(400, "Indicá el nombre del proveedor.")

    now      = utc_now_iso()
    actor    = getattr(user, "username", "") or ""
    actor_nm = getattr(user, "display_name", "") or actor

    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)

        active_codes = _active_provider_delivery_codes(conn)
        blocked = [c for c in codes if c in active_codes]
        if blocked:
            raise HTTPException(400, "Hay garantías con remito de proveedor activo: " + ", ".join(blocked))

        placeholders = ",".join("?" for _ in codes)
        rows = conn.execute(
            f"""
            SELECT g.warranty_code, g.company_id, g.deposito, g.lugar_llegada,
                   g.ubicacion_actual, g.estado_retiro_proveedor, g.status
            FROM guarantees g
            WHERE g.warranty_code IN ({placeholders})
            """,
            codes,
        ).fetchall()
        found = {str(r["warranty_code"]): r for r in rows}
        missing = [c for c in codes if c not in found]
        if missing:
            raise HTTPException(400, "Garantías no encontradas: " + ", ".join(missing))

        invalid: list[str] = []
        company_id = ""
        origen_deposito = ""
        for code in codes:
            row = found[code]
            pickup = str(row["estado_retiro_proveedor"] or "")
            st = str(row["status"] or "").upper()
            if pickup != "listo_para_retiro" or st in {"9 - ANULADA", "ANULADA", "10 - FINALIZADO", "FINALIZADO"}:
                invalid.append(code)
            if not company_id and row["company_id"]:
                company_id = str(row["company_id"] or "")
            if not origen_deposito:
                origen_deposito = str(row["deposito"] or row["lugar_llegada"] or "Depósito Central")
        if invalid:
            raise HTTPException(400, "Estas garantías no están listas para retiro del proveedor: " + ", ".join(invalid))

        brand    = _resolve_remito_brand(conn, origen_deposito, company_id)
        rem_code = next_provider_delivery_code(conn)
        conn.execute(
            """INSERT INTO warranty_remitos
                (remito_code, shipment_code, tipo_remito, company_brand, origen_sucursal,
                 destino_deposito, warranty_ids_json, proveedor, status,
                 nota, created_at, created_by, created_by_name)
               VALUES (?, '', 'deposito_a_proveedor', ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?)""",
            (rem_code, brand, origen_deposito, proveedor, json.dumps(codes), proveedor,
             (data.nota or "").strip(), now, actor, actor_nm),
        )
        for wcode in codes:
            g = conn.execute("SELECT id FROM guarantees WHERE warranty_code = ?", (wcode,)).fetchone()
            conn.execute(
                """UPDATE guarantees
                   SET remito_proveedor  = ?,
                       transit_status   = 'en_transito',
                       ubicacion_actual = 'en_transito_proveedor',
                       updated_at = ?, updated_by = ?, updated_by_name = ?
                   WHERE warranty_code = ?""",
                (rem_code, now, actor, actor_nm, wcode),
            )
            if g:
                add_history(
                    conn, int(g["id"]), wcode, user, "provider_delivery_generated",
                    note=f"Remito de entrega al proveedor {rem_code}: {origen_deposito} → {proveedor}",
                    details={"remito": rem_code, "proveedor": proveedor},
                )
        row_new = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (rem_code,)).fetchone()
        w_data  = load_warranties_for_ids(conn, codes)
        conn.commit()

    audit("warranties.remitos.provider_delivery", user=user, resource_type="warranty_remito", resource_id=rem_code,
          details={"proveedor": proveedor, "origen": origen_deposito, "cantidad": len(codes)})
    return {"ok": True, "created": [row_to_remito(row_new, w_data)]}


@router.post("/generate")
def generate_remitos(
    data: GenerateRemitosRequest,
    user: Annotated[Any, Depends(require_permission("warranties.remitos.generate"))],
):
    """Genera remitos internos de transporte físico sucursal → depósito.

    Fase 4: se elimina la generación desde shipment_code/ENV. El lote de proveedor
    es administrativo y se maneja en el flujo de exportación/proveedor, no acá.
    """
    if (data.shipment_code or "").strip():
        raise HTTPException(
            400,
            "Los remitos internos no se generan desde ENV. Seleccioná garantías físicas disponibles por sucursal.",
        )

    now      = utc_now_iso()
    actor    = getattr(user, "username", "") or ""
    actor_nm = getattr(user, "display_name", "") or actor

    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)

        created: list[dict[str, Any]] = []
        skipped: list[str] = []
        central_destination = _warranty_central_deposit_name(conn)

        selected_codes = [str(c).strip() for c in (data.warranty_codes or []) if str(c).strip()]
        rows = _fetch_available_remito_rows(
            conn,
            sucursal=(data.sucursal or "").strip(),
            warranty_codes=selected_codes or None,
        )
        available_items = _collapse_remito_rows(rows)
        available_codes = {str(item["warranty_code"]) for item in available_items}

        if selected_codes:
            missing = [code for code in selected_codes if code not in available_codes]
            if missing:
                raise HTTPException(
                    400,
                    "Algunas garantías no están disponibles para remito interno: " + ", ".join(missing),
                )
        if not available_items:
            raise HTTPException(400, "No hay garantías disponibles para remito interno con esos filtros.")

        groups: dict[str, dict[str, Any]] = {}
        for item in available_items:
            suc = str(item.get("sucursal") or "Sin sucursal")
            group = groups.setdefault(suc, {"codes": [], "company_id": str(item.get("company_id") or "")})
            group["codes"].append(str(item["warranty_code"]))
            if not group.get("company_id") and item.get("company_id"):
                group["company_id"] = str(item.get("company_id") or "")

        nota_val = (data.nota or "").strip()
        for sucursal, group in groups.items():
            codes = list(group["codes"])
            brand = _resolve_remito_brand(conn, sucursal, str(group.get("company_id") or ""))
            code  = next_remito_code(conn, brand)
            conn.execute(
                """INSERT INTO warranty_remitos
                    (remito_code, shipment_code, company_brand, origen_sucursal,
                     destino_deposito, warranty_ids_json, proveedor, status,
                     nota, created_at, created_by, created_by_name)
                   VALUES (?, '', ?, ?, ?, ?, '', 'pendiente', ?, ?, ?, ?)""",
                (code, brand, sucursal,
                 central_destination, json.dumps(codes),
                 nota_val, now, actor, actor_nm),
            )
            for wcode in codes:
                g = conn.execute("SELECT id FROM guarantees WHERE warranty_code = ?", (wcode,)).fetchone()
                conn.execute(
                    """UPDATE guarantees
                       SET remito_interno    = ?,
                           transit_status   = 'en_transito',
                           ubicacion_actual = 'en_transito',
                           updated_at = ?, updated_by = ?, updated_by_name = ?
                       WHERE warranty_code = ?""",
                    (code, now, actor, actor_nm, wcode),
                )
                if g:
                    add_history(conn, int(g["id"]), wcode, user, "remito_generated",
                                note=f"Remito {code} generado hacia {central_destination}",
                                details={"remito": code, "destino": central_destination})
            row_new = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (code,)).fetchone()
            w_data  = load_warranties_for_ids(conn, codes)
            created.append(row_to_remito(row_new, w_data))

        conn.commit()

    audit("warranties.remitos.generate", user=user, resource_type="warranty_remito",
          details={
              "modo":          "traslado_interno",
              "shipment_code": "",
              "sucursal":      data.sucursal or "(selección manual/todas)",
              "destino":       central_destination,
              "created":       len(created),
              "skipped":       len(skipped),
          })
    return {"ok": True, "created": created, "skipped_existing": skipped}


@router.get("/")
def list_remitos(
    user:            Annotated[Any, Depends(require_current_user)],
    shipment_code:   str = "",
    remito_code:     str = "",
    status:          str = "",
    brand:           str = "",
    origen_sucursal: str = "",
    limit:           int = Query(default=100, ge=1, le=500),
):
    """Lista remitos internos.

    Regla de scope:
      - warranties.remitos.view  → ve TODOS los remitos (gestores/posventa global)
      - cualquier otro permiso   → ve solo los remitos de su propia sucursal
                                   (origen_sucursal coincide con branch_name del usuario)
    Sin ninguno de estos permisos → 403.
    """
    _require_any(
        user,
        "warranties.remitos.view",
        "warranties.remitos.generate",
        "warranties.remitos.dispatch",
        "warranties.remitos.receive",
        "warranties.remitos.delete",
        "warranties.remitos.deposit_transfer",
        "warranties.remitos.provider_delivery",
    )

    # Scope: usuarios sin 'view' global solo ven su propia sucursal.
    user_is_global = getattr(user, "has", lambda _p: False)("warranties.remitos.view")
    user_branch    = (getattr(user, "branch_name", None) or "").strip()

    with db_connect() as conn:
        ensure_remito_tables(conn)
        sql    = "SELECT * FROM warranty_remitos WHERE 1=1"
        params: list[Any] = []

        # Aplicar filtro de sucursal para usuarios no-globales
        if not user_is_global and user_branch:
            sql += " AND LOWER(origen_sucursal) = LOWER(?)"
            params.append(user_branch)

        if shipment_code:
            sql += " AND shipment_code = ?"
            params.append(shipment_code)
        if remito_code:
            # Búsqueda de seguimiento por código REM. Case-insensitive y parcial.
            sql += " AND UPPER(remito_code) LIKE ?"
            params.append(f"%{remito_code.strip().upper()}%")
        if status:
            # Tolerar valores provenientes de UI legacy (Pendiente/En tránsito/etc.).
            st = status.strip().lower().replace(" ", "_").replace("á", "a")
            sql += " AND status = ?"
            params.append(st)
        if brand:
            sql += " AND company_brand = ?"
            params.append(brand)
        if origen_sucursal:
            sql += " AND LOWER(origen_sucursal) = LOWER(?)"
            params.append(origen_sucursal)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        # Cargar datos de garantías para todos los remitos
        ensure_warranty_tables(conn)
        all_items = []
        for r in rows:
            try:
                ids = json.loads(str(r["warranty_ids_json"] or "[]"))
            except Exception:
                ids = []
            w_data = load_warranties_for_ids(conn, ids)
            all_items.append(row_to_remito(r, w_data))
    return {"items": all_items, "total": len(all_items)}


def _confirm_arrival_update(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    data: ConfirmArrivalRequest,
    user: Any,
) -> dict[str, Any]:
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

    now      = utc_now_iso()
    actor    = getattr(user, "username", "") or ""
    actor_nm = getattr(user, "display_name", "") or actor

    try:
        ids: list[str] = json.loads(str(row["warranty_ids_json"] or "[]"))
    except Exception:
        ids = []

    destino  = data.lugar_llegada.strip() if data.lugar_llegada else str(row["destino_deposito"] or "")
    tipo_rem = str(row["tipo_remito"] or "sucursal_a_deposito") if "tipo_remito" in row.keys() else "sucursal_a_deposito"

    conn.execute(
        """UPDATE warranty_remitos
           SET status = 'llegado', fecha_llegada = ?, recibido_por = ?,
               recibido_por_name = ?, nota = CASE WHEN ? != '' THEN ? ELSE nota END
           WHERE remito_code = ?""",
        (now, actor, actor_nm, data.nota or "", data.nota or "", remito_code),
    )

    for wcode in ids:
        g = conn.execute("SELECT id FROM guarantees WHERE warranty_code = ?", (wcode,)).fetchone()
        if g:
            if tipo_rem == "deposito_a_proveedor":
                # El producto llegó al proveedor: marcar como retirado y ubicación = proveedor
                conn.execute(
                    """UPDATE guarantees
                       SET transit_status = '', estado_retiro_proveedor = 'retirado',
                           ubicacion_actual = 'proveedor',
                           fecha_llegada_transito = ?,
                           updated_at = ?, updated_by = ?, updated_by_name = ?
                       WHERE warranty_code = ?""",
                    (now, now, actor, actor_nm, wcode),
                )
                add_history(conn, int(g["id"]), wcode, user, "provider_delivery_confirmed",
                            note=f"Remito {remito_code} confirmado: producto entregado a {destino}",
                            details={"remito": remito_code, "proveedor": destino})
            else:
                conn.execute(
                    """UPDATE guarantees
                       SET transit_status = 'en_deposito', lugar_llegada = ?,
                           deposito = ?, ubicacion_actual = ?,
                           fecha_llegada_transito = ?,
                           updated_at = ?, updated_by = ?, updated_by_name = ?
                       WHERE warranty_code = ?""",
                    (destino, destino, destino or "deposito", now, now, actor, actor_nm, wcode),
                )
                add_history(conn, int(g["id"]), wcode, user, "remito_arrival",
                            note=f"Remito {remito_code} confirmado en {destino}",
                            details={"remito": remito_code, "destino": destino})

    return {"ok": True, "remito_code": remito_code, "status": "llegado", "destino": destino, "lote_consolidado": False}


@router.post("/confirm-arrival-by-code")
def confirm_arrival_by_code(
    data: ConfirmArrivalRequest,
    user: Annotated[Any, Depends(require_permission("warranties.remitos.receive"))],
):
    """Confirma llegada usando solo el código ingresado.

    Este endpoint estático evita que la UI tenga que buscar primero el remito en
    listados filtrados/paginados. También evita confusiones con el flujo legacy
    de garantías cuando se usa el buscador rápido de recepción.
    """
    code = data.remito_code.strip().upper()
    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)
        row = conn.execute("SELECT * FROM warranty_remitos WHERE UPPER(remito_code) = ?", (code,)).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {code} no encontrado.")
        result = _confirm_arrival_update(conn, row, data, user)
        conn.commit()

    audit("warranties.remito.arrival", user=user, resource_type="warranty_remito", resource_id=result["remito_code"],
          details={"destino": result["destino"], "mode": "by_code"})
    return result


@router.get("/by-code/{remito_code}")
def get_remito_by_code(
    remito_code: str,
    _user:       Annotated[Any, Depends(require_permission("warranties.remitos.view"))],
):
    """Lookup estático para seguimiento por código REM."""
    code = remito_code.strip().upper()
    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)
        row = conn.execute("SELECT * FROM warranty_remitos WHERE UPPER(remito_code) = ?", (code,)).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {code} no encontrado.")
        try:
            ids = json.loads(str(row["warranty_ids_json"] or "[]"))
        except Exception:
            ids = []
        w_data = load_warranties_for_ids(conn, ids)
    return row_to_remito(row, w_data)


@router.get("/{remito_code}")
def get_remito(
    remito_code: str,
    _user:       Annotated[Any, Depends(require_permission("warranties.remitos.view"))],
):
    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)
        row = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (remito_code,)).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {remito_code} no encontrado.")
        try:
            ids = json.loads(str(row["warranty_ids_json"] or "[]"))
        except Exception:
            ids = []
        w_data = load_warranties_for_ids(conn, ids)
    return row_to_remito(row, w_data)


@router.get("/{remito_code}/pdf")
def download_remito_pdf(
    remito_code: str,
    _user:       Annotated[Any, Depends(require_current_user)],
):
    """Genera y descarga el PDF del remito.

    Seguimiento global requiere warranties.remitos.view, pero el operador de
    depósito con permiso deposit_transfer también puede descargar el PDF de sus
    movimientos internos.
    """
    _require_any(_user, "warranties.remitos.view", "warranties.remitos.deposit_transfer", "warranties.remitos.generate")
    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)

        row = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (remito_code,)).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {remito_code} no encontrado.")

        try:
            ids = json.loads(str(row["warranty_ids_json"] or "[]"))
        except Exception:
            ids = []
        warranties_data = load_warranties_for_ids(conn, ids)
        remito_dict = row_to_remito(row, warranties_data)
        # Revalidar marca para el PDF usando la sucursal/branch de origen.
        # Esto corrige remitos viejos que hayan quedado con company_brand legacy.
        remito_dict["company_brand"] = _resolve_remito_brand(conn, remito_dict.get("origen_sucursal", ""), "")

    if remito_dict.get("tipo_remito") == "deposito_a_proveedor":
        pdf_bytes = generate_provider_delivery_pdf(remito_dict, warranties_data)
    else:
        pdf_bytes = generate_remito_pdf(remito_dict, warranties_data)
    filename  = f"{remito_code}.pdf"
    audit("warranties.remito.pdf", user=_user, resource_type="warranty_remito", resource_id=remito_code)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{remito_code}/dispatch")
def dispatch_remito(
    remito_code: str,
    data:        DispatchRemitoRequest,
    user:        Annotated[Any, Depends(require_permission("warranties.remitos.dispatch"))],
):
    """Marca el remito como despachado (productos en tránsito)."""
    now      = utc_now_iso()
    actor    = getattr(user, "username", "") or ""
    actor_nm = getattr(user, "display_name", "") or actor

    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)

        row = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (remito_code,)).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {remito_code} no encontrado.")
        if str(row["status"]) not in ("pendiente",):
            raise HTTPException(400, f"El remito ya fue despachado (estado: {row['status']}).")

        try:
            ids: list[str] = json.loads(str(row["warranty_ids_json"] or "[]"))
        except Exception:
            ids = []

        conn.execute(
            """UPDATE warranty_remitos
               SET status = 'en_transito', fecha_despacho = ?, despachado_por = ?,
                   despachado_por_name = ?, nota = CASE WHEN ? != '' THEN ? ELSE nota END
               WHERE remito_code = ?""",
            (now, actor, actor_nm, data.nota or "", data.nota or "", remito_code),
        )

        # Actualizar transit_status en las garantías
        suc_origen = (data.lugar_salida or "").strip() or str(row["origen_sucursal"] or "")
        tipo_rem   = str(row["tipo_remito"] or "sucursal_a_deposito") if "tipo_remito" in row.keys() else "sucursal_a_deposito"
        ubicacion_transito = "en_transito_proveedor" if tipo_rem == "deposito_a_proveedor" else "en_transito"
        for wcode in ids:
            g = conn.execute("SELECT id, warranty_code FROM guarantees WHERE warranty_code = ?", (wcode,)).fetchone()
            if g:
                conn.execute(
                    """UPDATE guarantees SET transit_status = 'en_transito',
                       ubicacion_actual = ?,
                       fecha_salida_transito = ?, lugar_salida_transito = ?,
                       updated_at = ?, updated_by = ?, updated_by_name = ?
                       WHERE warranty_code = ?""",
                    (ubicacion_transito, now, suc_origen, now, actor, actor_nm, wcode),
                )
                add_history(conn, int(g["id"]), wcode, user, "remito_dispatch",
                            note=f"Remito {remito_code} despachado desde {suc_origen}",
                            details={"remito": remito_code})
        conn.commit()

    # Notificar al Gestor de Garantías sobre movimientos en tránsito
    destino_disp = str(row["destino_deposito"] or "")
    if tipo_rem in ("sucursal_a_deposito", "deposito_a_deposito"):
        _notify_gestor_garantias(
            "🚚 Remito en tránsito",
            f"Remito {remito_code} ({len(ids)} garantía(s)) salió desde {suc_origen} hacia {destino_disp}.",
        )
    elif tipo_rem == "deposito_a_proveedor":
        _notify_gestor_garantias(
            "🏭 Entrega al proveedor en camino",
            f"Remito {remito_code} ({len(ids)} garantía(s)) despachado hacia {destino_disp}.",
        )

    audit("warranties.remito.dispatch", user=user, resource_type="warranty_remito", resource_id=remito_code)
    return {"ok": True, "remito_code": remito_code, "status": "en_transito"}


@router.post("/{remito_code}/confirm-arrival")
def confirm_arrival(
    remito_code: str,
    data:        ConfirmArrivalRequest,
    user:        Annotated[Any, Depends(require_permission("warranties.remitos.receive"))],
):
    """Confirma que los productos del remito llegaron al depósito.

    Se mantiene la ruta histórica por compatibilidad, pero la lógica real vive
    en _confirm_arrival_update.
    """
    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)

        row = conn.execute("SELECT * FROM warranty_remitos WHERE remito_code = ?", (remito_code,)).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {remito_code} no encontrado.")

        result = _confirm_arrival_update(conn, row, data, user)
        conn.commit()

    audit("warranties.remito.arrival", user=user, resource_type="warranty_remito", resource_id=remito_code,
          details={"destino": result["destino"]})
    return result


@router.post("/batch-pickup")
def confirm_batch_pickup(
    data: BatchPickupRequest,
    user: Annotated[Any, Depends(require_permission("warranties.remitos.generate"))],
):
    """Endpoint legado deshabilitado en Fase 4.

    El retiro/respuesta del proveedor pertenece al flujo ENV/proveedor, no al
    flujo de remitos internos. Se mantiene la ruta para evitar 404 en clientes
    viejos, pero no genera REM ni modifica logística interna.
    """
    raise HTTPException(
        400,
        "El retiro del proveedor se gestionará en el flujo ENV/proveedor. Remitos internos solo mueve sucursal → depósito.",
    )


@router.delete("/{remito_code}")
def delete_remito(
    remito_code: str,
    user:        Annotated[Any, Depends(require_permission("warranties.remitos.delete"))],
):
    """
    Elimina un remito interno.
    Si el remito estaba PENDIENTE, limpia también el campo remito_interno en las garantías.
    Si ya fue despachado o llegó, igual se elimina pero queda el historial en las garantías.
    """
    now      = utc_now_iso()
    actor    = getattr(user, "username", "") or ""
    actor_nm = getattr(user, "display_name", "") or actor

    with db_connect() as conn:
        ensure_remito_tables(conn)
        ensure_warranty_tables(conn)

        row = conn.execute(
            "SELECT * FROM warranty_remitos WHERE remito_code = ?", (remito_code,)
        ).fetchone()
        if not row:
            raise HTTPException(404, f"Remito {remito_code} no encontrado.")

        status = str(row["status"] or "pendiente")
        try:
            ids: list[str] = json.loads(str(row["warranty_ids_json"] or "[]"))
        except Exception:
            ids = []

        # Si era pendiente o en tránsito, desvincular el remito y limpiar transit_status
        # para que las garantías puedan ser reasignadas a otro remito.
        # Si ya llegó (llegado), se preserva la trazabilidad y NO se desvincula.
        unlinked = 0
        if status in ("pendiente", "en_transito") and ids:
            for wcode in ids:
                cur = conn.execute(
                    """UPDATE guarantees
                       SET remito_interno = '',
                           transit_status = '',
                           ubicacion_actual = COALESCE(NULLIF(sucursal, ''), 'sucursal'),
                           fecha_salida_transito = '',
                           lugar_salida_transito = '',
                           updated_at = ?, updated_by = ?, updated_by_name = ?
                       WHERE warranty_code = ? AND remito_interno = ?""",
                    (now, actor, actor_nm, wcode, remito_code),
                )
                unlinked += cur.rowcount or 0

        conn.execute("DELETE FROM warranty_remitos WHERE remito_code = ?", (remito_code,))
        conn.commit()

    audit("warranties.remito.delete", user=user, resource_type="warranty_remito",
          resource_id=remito_code,
          details={"status_at_delete": status, "warranties_unlinked": unlinked})
    return {"ok": True, "deleted": remito_code, "warranties_unlinked": unlinked}
