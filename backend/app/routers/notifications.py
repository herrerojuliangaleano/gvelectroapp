from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import require_permission
from ..config import get_settings
from ..users import CurrentUser

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

MODULES = {
    "sales_web": "Ventas",
    "price_cost": "Precios y costos",
    "warranties": "Garantías",
    "remitos": "Remitos",
    "provider": "Proveedor",
    "payroll": "Recibos",
    "system": "Sistema",
    "general": "General",
}

PRIORITIES = {"low", "normal", "high", "critical"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    ensure_notifications_schema(conn)
    return conn


def ensure_notifications_schema(conn: sqlite3.Connection) -> None:
    """Mantiene la tabla vieja compatible y agrega campos para centro unificado.

    Fase 48 no envía push real todavía. Solo deja una base sólida para que cualquier
    módulo cree una notificación interna con módulo, prioridad, destino y link.
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT NOT NULL,
            sales_request_id INTEGER,
            read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            read_at TEXT
        )
        """
    )
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(notifications)").fetchall()}
    columns: dict[str, str] = {
        "module": "TEXT NOT NULL DEFAULT 'general'",
        "event_type": "TEXT NOT NULL DEFAULT 'general'",
        "priority": "TEXT NOT NULL DEFAULT 'normal'",
        "entity_type": "TEXT",
        "entity_id": "TEXT",
        "link_url": "TEXT",
        "branch_id": "TEXT",
        "branch_name": "TEXT",
        "target_role": "TEXT",
        "metadata": "TEXT",
        "delivered_push_at": "TEXT",
        "push_status": "TEXT",
    }
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE notifications ADD COLUMN {name} {definition}")

    # Backfill conservador para registros anteriores a la fase 48.
    conn.execute(
        """
        UPDATE notifications
        SET module = CASE
            WHEN type IN ('sales_web', 'price_cost_update', 'price_cost') THEN CASE WHEN type='price_cost_update' THEN 'price_cost' ELSE type END
            WHEN type IN ('warranties', 'remitos', 'provider', 'payroll', 'system') THEN type
            WHEN sales_request_id IS NOT NULL THEN 'sales_web'
            ELSE COALESCE(NULLIF(module, ''), 'general')
        END
        WHERE module IS NULL OR module = '' OR module = 'general'
        """
    )
    conn.execute(
        """
        UPDATE notifications
        SET priority = CASE
            WHEN lower(type) IN ('error', 'critical') THEN 'critical'
            WHEN lower(type) IN ('warning', 'warn') THEN 'high'
            ELSE COALESCE(NULLIF(priority, ''), 'normal')
        END
        WHERE priority IS NULL OR priority = '' OR priority = 'normal'
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(username, read)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_module ON notifications(username, module, read)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_priority ON notifications(username, priority, read)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT,
            auth TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(username, endpoint)
        )
        """
    )


def _normalize_module(value: str | None, fallback_type: str = "info", sales_request_id: int | None = None) -> str:
    raw = str(value or "").strip().lower()
    aliases = {
        "sale": "sales_web",
        "sales": "sales_web",
        "ventas": "sales_web",
        "venta": "sales_web",
        "price_cost_update": "price_cost",
        "prices": "price_cost",
        "precios": "price_cost",
        "garantias": "warranties",
        "garantía": "warranties",
        "garantia": "warranties",
        "warranty": "warranties",
        "remito": "remitos",
        "provider_response": "provider",
    }
    raw = aliases.get(raw, raw)
    if raw in MODULES:
        return raw
    type_raw = str(fallback_type or "").strip().lower()
    type_raw = aliases.get(type_raw, type_raw)
    if type_raw in MODULES:
        return type_raw
    if sales_request_id is not None:
        return "sales_web"
    return "general"


def _normalize_priority(value: str | None, type_: str = "info") -> str:
    raw = str(value or "").strip().lower()
    if raw in PRIORITIES:
        return raw
    type_raw = str(type_ or "").strip().lower()
    if type_raw in {"error", "critical", "danger"}:
        return "critical"
    if type_raw in {"warning", "warn"}:
        return "high"
    if type_raw in {"success", "ok"}:
        return "low"
    return "normal"


def _json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return json.dumps({"raw": str(value)}, ensure_ascii=False)


class NotificationOut(BaseModel):
    id: int
    username: str
    title: str
    message: str
    type: str
    module: str = "general"
    module_label: str = "General"
    event_type: str = "general"
    priority: str = "normal"
    sales_request_id: int | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    link_url: str | None = None
    branch_id: str | None = None
    branch_name: str | None = None
    target_role: str | None = None
    metadata: dict[str, Any] | None = None
    read: bool
    created_at: str
    read_at: str | None = None


class NotificationSummaryOut(BaseModel):
    unread_total: int
    unread_high_priority: int
    unread_by_module: dict[str, int]
    modules: dict[str, str]


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: dict[str, str] | None = None


class InternalNotificationRequest(BaseModel):
    usernames: list[str]
    title: str
    message: str
    module: str = "general"
    event_type: str = "manual"
    priority: str = "normal"
    link_url: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    branch_id: str | None = None
    branch_name: str | None = None
    target_role: str | None = None
    metadata: dict[str, Any] | None = None


def create_notification(
    username: str,
    title: str,
    message: str,
    type_: str = "info",
    sales_request_id: int | None = None,
    *,
    module: str | None = None,
    event_type: str | None = None,
    priority: str | None = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    link_url: str | None = None,
    branch_id: str | None = None,
    branch_name: str | None = None,
    target_role: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    username = str(username or "").strip()
    if not username:
        return
    module_value = _normalize_module(module, type_, sales_request_id)
    priority_value = _normalize_priority(priority, type_)
    event_value = str(event_type or type_ or module_value or "general").strip() or "general"
    if not link_url and sales_request_id is not None:
        link_url = f"/venta/{sales_request_id}"
        entity_type = entity_type or "sales_web_request"
        entity_id = str(entity_id or sales_request_id)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO notifications (
                username, title, message, type, module, event_type, priority,
                sales_request_id, entity_type, entity_id, link_url, branch_id, branch_name,
                target_role, metadata, read, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                username,
                title,
                message,
                type_,
                module_value,
                event_value,
                priority_value,
                sales_request_id,
                entity_type,
                str(entity_id) if entity_id is not None else None,
                link_url,
                branch_id,
                branch_name,
                target_role,
                _json_dumps(metadata),
                utc_now(),
            ),
        )
        conn.commit()


def notify_many(
    usernames: list[str],
    title: str,
    message: str,
    type_: str = "info",
    sales_request_id: int | None = None,
    **kwargs: Any,
) -> None:
    unique: list[str] = []
    for username in usernames:
        if username and username not in unique:
            unique.append(username)
    for username in unique:
        create_notification(username, title, message, type_, sales_request_id, **kwargs)


def notify_event(
    usernames: list[str],
    *,
    title: str,
    message: str,
    module: str,
    event_type: str,
    priority: str = "normal",
    link_url: str | None = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    branch_id: str | None = None,
    branch_name: str | None = None,
    target_role: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    notify_many(
        usernames,
        title,
        message,
        type_=module,
        module=module,
        event_type=event_type,
        priority=priority,
        link_url=link_url,
        entity_type=entity_type,
        entity_id=entity_id,
        branch_id=branch_id,
        branch_name=branch_name,
        target_role=target_role,
        metadata=metadata,
    )


def row_to_notification(row: sqlite3.Row) -> NotificationOut:
    module_value = str(row["module"] or "general") if "module" in row.keys() else "general"
    metadata_raw = row["metadata"] if "metadata" in row.keys() else None
    metadata: dict[str, Any] | None = None
    if metadata_raw:
        try:
            loaded = json.loads(str(metadata_raw))
            metadata = loaded if isinstance(loaded, dict) else {"value": loaded}
        except Exception:
            metadata = {"raw": str(metadata_raw)}
    return NotificationOut(
        id=int(row["id"]),
        username=str(row["username"]),
        title=str(row["title"]),
        message=str(row["message"]),
        type=str(row["type"]),
        module=module_value,
        module_label=MODULES.get(module_value, module_value.title()),
        event_type=str(row["event_type"] or row["type"] or "general") if "event_type" in row.keys() else str(row["type"]),
        priority=str(row["priority"] or "normal") if "priority" in row.keys() else "normal",
        sales_request_id=row["sales_request_id"],
        entity_type=row["entity_type"] if "entity_type" in row.keys() else None,
        entity_id=row["entity_id"] if "entity_id" in row.keys() else None,
        link_url=row["link_url"] if "link_url" in row.keys() else None,
        branch_id=row["branch_id"] if "branch_id" in row.keys() else None,
        branch_name=row["branch_name"] if "branch_name" in row.keys() else None,
        target_role=row["target_role"] if "target_role" in row.keys() else None,
        metadata=metadata,
        read=bool(row["read"]),
        created_at=str(row["created_at"]),
        read_at=row["read_at"],
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    unread_only: bool = False,
    module: str | None = None,
    priority: str | None = None,
    read_status: str | None = Query(default=None, description="all | unread | read"),
    limit: int = Query(default=50, ge=1, le=200),
):
    query = "SELECT * FROM notifications WHERE username = ?"
    params: list[Any] = [user.username]
    if unread_only or read_status == "unread":
        query += " AND read = 0"
    elif read_status == "read":
        query += " AND read = 1"
    if module:
        query += " AND module = ?"
        params.append(_normalize_module(module))
    if priority:
        query += " AND priority = ?"
        params.append(_normalize_priority(priority))
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [row_to_notification(row) for row in rows]


@router.get("/summary", response_model=NotificationSummaryOut)
def notifications_summary(user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))]):
    with connect() as conn:
        unread_total = int(conn.execute("SELECT COUNT(*) AS c FROM notifications WHERE username = ? AND read = 0", (user.username,)).fetchone()["c"])
        high = int(
            conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM notifications
                WHERE username = ? AND read = 0 AND priority IN ('high', 'critical')
                """,
                (user.username,),
            ).fetchone()["c"]
        )
        rows = conn.execute(
            """
            SELECT module, COUNT(*) AS c
            FROM notifications
            WHERE username = ? AND read = 0
            GROUP BY module
            """,
            (user.username,),
        ).fetchall()
    return NotificationSummaryOut(
        unread_total=unread_total,
        unread_high_priority=high,
        unread_by_module={str(row["module"] or "general"): int(row["c"]) for row in rows},
        modules=MODULES,
    )


@router.get("/unread-count")
def unread_count(user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))]):
    with connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM notifications WHERE username = ? AND read = 0", (user.username,)).fetchone()["c"]
    return {"count": int(count)}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(notification_id: int, user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))]):
    with connect() as conn:
        row = conn.execute("SELECT * FROM notifications WHERE id = ? AND username = ?", (notification_id, user.username)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Notificación no encontrada")
        conn.execute("UPDATE notifications SET read = 1, read_at = ? WHERE id = ?", (utc_now(), notification_id))
        conn.commit()
        updated = conn.execute("SELECT * FROM notifications WHERE id = ?", (notification_id,)).fetchone()
    return row_to_notification(updated)


@router.post("/mark-all-read")
def mark_all_read(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    module: str | None = None,
):
    with connect() as conn:
        if module:
            conn.execute(
                "UPDATE notifications SET read = 1, read_at = ? WHERE username = ? AND read = 0 AND module = ?",
                (utc_now(), user.username, _normalize_module(module)),
            )
        else:
            conn.execute("UPDATE notifications SET read = 1, read_at = ? WHERE username = ? AND read = 0", (utc_now(), user.username))
        conn.commit()
    return {"ok": True}


@router.post("/internal", dependencies=[Depends(require_permission("notifications.manage"))])
def create_internal_notification(data: InternalNotificationRequest):
    notify_event(
        data.usernames,
        title=data.title,
        message=data.message,
        module=data.module,
        event_type=data.event_type,
        priority=data.priority,
        link_url=data.link_url,
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        branch_id=data.branch_id,
        branch_name=data.branch_name,
        target_role=data.target_role,
        metadata=data.metadata,
    )
    return {"ok": True, "created": len({u for u in data.usernames if u})}


@router.post("/push/subscribe")
def subscribe_push(data: PushSubscribeRequest, user: Annotated[CurrentUser, Depends(require_permission("push.subscribe"))]):
    keys = data.keys or {}
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO push_subscriptions (username, endpoint, p256dh, auth, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user.username, data.endpoint, keys.get("p256dh"), keys.get("auth"), utc_now()),
        )
        conn.commit()
    return {"ok": True, "message": "Suscripción guardada para futuras notificaciones push."}


@router.post("/push/unsubscribe")
def unsubscribe_push(data: PushSubscribeRequest, user: Annotated[CurrentUser, Depends(require_permission("push.subscribe"))]):
    with connect() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE username = ? AND endpoint = ?", (user.username, data.endpoint))
        conn.commit()
    return {"ok": True}
