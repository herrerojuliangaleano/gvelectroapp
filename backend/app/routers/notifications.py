from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import require_current_user, require_permission
from ..config import get_settings
from ..users import CurrentUser

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


class NotificationOut(BaseModel):
    id: int
    username: str
    title: str
    message: str
    type: str
    sales_request_id: int | None = None
    read: bool
    created_at: str
    read_at: str | None = None


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: dict[str, str] | None = None


def create_notification(username: str, title: str, message: str, type_: str = "info", sales_request_id: int | None = None) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO notifications (username, title, message, type, sales_request_id, read, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            """,
            (username, title, message, type_, sales_request_id, utc_now()),
        )
        conn.commit()


def notify_many(usernames: list[str], title: str, message: str, type_: str = "info", sales_request_id: int | None = None) -> None:
    unique = []
    for username in usernames:
        if username and username not in unique:
            unique.append(username)
    for username in unique:
        create_notification(username, title, message, type_, sales_request_id)


def row_to_notification(row: sqlite3.Row) -> NotificationOut:
    return NotificationOut(
        id=int(row["id"]),
        username=str(row["username"]),
        title=str(row["title"]),
        message=str(row["message"]),
        type=str(row["type"]),
        sales_request_id=row["sales_request_id"],
        read=bool(row["read"]),
        created_at=str(row["created_at"]),
        read_at=row["read_at"],
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    unread_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
):
    query = "SELECT * FROM notifications WHERE username = ?"
    params: list[Any] = [user.username]
    if unread_only:
        query += " AND read = 0"
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [row_to_notification(row) for row in rows]


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
def mark_all_read(user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))]):
    with connect() as conn:
        conn.execute("UPDATE notifications SET read = 1, read_at = ? WHERE username = ? AND read = 0", (utc_now(), user.username))
        conn.commit()
    return {"ok": True}


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
