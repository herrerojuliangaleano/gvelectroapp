"""Notificaciones, push web y FCM tokens (Fase 2.5c · Postgres puro).

Cambios vs. SQLite:
- `username` (TEXT) → `user_id` (FK a `users.id`).
- `read` INTEGER 0/1 → `boolean`.
- `metadata` TEXT JSON → `JSONB` dict.
- `INSERT OR REPLACE` / `ON CONFLICT` → `on_conflict_do_update` de SQLAlchemy.
- Las funciones públicas (`create_notification`, `notify_many`, `notify_event`)
  mantienen su firma para no romper a los otros routers.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..auth import require_permission
from ..db import db_session, get_session
from ..models.auth import User
from ..models.system import FcmToken, Notification, PushSubscription
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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_module(value: str | None, fallback_type: str = "info", sales_request_id: int | None = None) -> str:
    raw = str(value or "").strip().lower()
    aliases = {
        "sale": "sales_web", "sales": "sales_web", "ventas": "sales_web", "venta": "sales_web",
        "price_cost_update": "price_cost", "prices": "price_cost", "precios": "price_cost",
        "garantias": "warranties", "garantía": "warranties", "garantia": "warranties", "warranty": "warranties",
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


def _user_id_from_username(session: Session, username: str) -> int | None:
    uname = str(username or "").strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(User.username == uname))


def _fmt_dt(value: datetime | None) -> str:
    return value.isoformat() if value else ""


# ── Schemas ──────────────────────────────────────────────────────────────────

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


class FcmTokenRequest(BaseModel):
    token: str


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


# ── Conversión Notification → NotificationOut ────────────────────────────────

def _notif_to_out(n: Notification, username: str) -> NotificationOut:
    module_value = str(n.module or "general")
    return NotificationOut(
        id=int(n.id),
        username=username,
        title=str(n.title),
        message=str(n.message),
        type=str(n.type),
        module=module_value,
        module_label=MODULES.get(module_value, module_value.title()),
        event_type=str(n.event_type or n.type or "general"),
        priority=str(n.priority or "normal"),
        sales_request_id=n.sales_request_id,
        entity_type=n.entity_type,
        entity_id=n.entity_id,
        link_url=n.link_url,
        branch_id=n.branch_id,
        branch_name=n.branch_name,
        target_role=n.target_role,
        metadata=n.metadata_ if isinstance(n.metadata_, dict) else None,
        read=bool(n.read),
        created_at=_fmt_dt(n.created_at),
        read_at=_fmt_dt(n.read_at) if n.read_at else None,
    )


# ── API pública (la usan otros routers) ──────────────────────────────────────

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
    uname = str(username or "").strip()
    if not uname:
        return
    module_value = _normalize_module(module, type_, sales_request_id)
    priority_value = _normalize_priority(priority, type_)
    event_value = str(event_type or type_ or module_value or "general").strip() or "general"
    if not link_url and sales_request_id is not None:
        link_url = f"/venta/{sales_request_id}"
        entity_type = entity_type or "sales_web_request"
        entity_id = str(entity_id or sales_request_id)

    tokens: list[str] = []
    with db_session() as session:
        user_id = _user_id_from_username(session, uname)
        if user_id is None:
            return
        n = Notification(
            user_id=user_id,
            title=title,
            message=message,
            type=type_,
            module=module_value,
            event_type=event_value,
            priority=priority_value,
            sales_request_id=sales_request_id,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            link_url=link_url,
            branch_id=branch_id,
            branch_name=branch_name,
            target_role=target_role,
            metadata_=metadata,
            read=False,
        )
        session.add(n)
        session.commit()
        # FCM tokens del usuario para enviar push (si hay).
        tokens = [t for t, in session.execute(
            select(FcmToken.token).where(FcmToken.user_id == user_id)
        ).all()]

    if tokens:
        try:
            from ..fcm import send_to_many
            fcm_data: dict[str, str] = {"module": module_value, "priority": priority_value}
            if link_url:
                fcm_data["link_url"] = link_url
            if entity_type:
                fcm_data["entity_type"] = entity_type
            if entity_id is not None:
                fcm_data["entity_id"] = str(entity_id)
            send_to_many(tokens, title, message, fcm_data)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("FCM push falló para %s: %s", uname, exc)


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


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
    unread_only: bool = False,
    module: str | None = None,
    priority: str | None = None,
    read_status: str | None = Query(default=None, description="all | unread | read"),
    limit: int = Query(default=50, ge=1, le=200),
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        return []
    stmt = select(Notification).where(Notification.user_id == user_id)
    if unread_only or read_status == "unread":
        stmt = stmt.where(Notification.read.is_(False))
    elif read_status == "read":
        stmt = stmt.where(Notification.read.is_(True))
    if module:
        stmt = stmt.where(Notification.module == _normalize_module(module))
    if priority:
        stmt = stmt.where(Notification.priority == _normalize_priority(priority))
    stmt = stmt.order_by(Notification.id.desc()).limit(limit)
    rows = session.scalars(stmt).all()
    return [_notif_to_out(n, user.username) for n in rows]


@router.get("/summary", response_model=NotificationSummaryOut)
def notifications_summary(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        return NotificationSummaryOut(unread_total=0, unread_high_priority=0, unread_by_module={}, modules=MODULES)

    unread_total = session.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.read.is_(False)
        )
    ) or 0

    high = session.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.read.is_(False),
            Notification.priority.in_(["high", "critical"]),
        )
    ) or 0

    by_module_rows = session.execute(
        select(Notification.module, func.count(Notification.id))
        .where(Notification.user_id == user_id, Notification.read.is_(False))
        .group_by(Notification.module)
    ).all()

    return NotificationSummaryOut(
        unread_total=int(unread_total),
        unread_high_priority=int(high),
        unread_by_module={str(mod or "general"): int(cnt) for mod, cnt in by_module_rows},
        modules=MODULES,
    )


@router.get("/unread-count")
def unread_count(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        return {"count": 0}
    count = session.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.read.is_(False)
        )
    ) or 0
    return {"count": int(count)}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(
    notification_id: int,
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    n = session.get(Notification, notification_id)
    if n is None or n.user_id != user_id:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    n.read = True
    n.read_at = _utc_now()
    session.commit()
    session.refresh(n)
    return _notif_to_out(n, user.username)


@router.post("/mark-all-read")
def mark_all_read(
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
    module: str | None = None,
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        return {"ok": True}
    stmt = select(Notification).where(
        Notification.user_id == user_id, Notification.read.is_(False)
    )
    if module:
        stmt = stmt.where(Notification.module == _normalize_module(module))
    now = _utc_now()
    for n in session.scalars(stmt).all():
        n.read = True
        n.read_at = now
    session.commit()
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


@router.post("/push/fcm-token")
def register_fcm_token(
    data: FcmTokenRequest,
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    now = _utc_now()
    stmt = pg_insert(FcmToken).values(user_id=user_id, token=data.token, created_at=now, updated_at=now)
    stmt = stmt.on_conflict_do_update(
        index_elements=[FcmToken.token],
        set_={"user_id": user_id, "updated_at": now},
    )
    session.execute(stmt)
    session.commit()
    return {"ok": True}


@router.delete("/push/fcm-token")
def unregister_fcm_token(
    data: FcmTokenRequest,
    user: Annotated[CurrentUser, Depends(require_permission("notifications.view"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        return {"ok": True}
    token = session.scalar(
        select(FcmToken).where(FcmToken.user_id == user_id, FcmToken.token == data.token)
    )
    if token:
        session.delete(token)
        session.commit()
    return {"ok": True}


@router.post("/push/subscribe")
def subscribe_push(
    data: PushSubscribeRequest,
    user: Annotated[CurrentUser, Depends(require_permission("push.subscribe"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    keys = data.keys or {}
    stmt = pg_insert(PushSubscription).values(
        user_id=user_id,
        endpoint=data.endpoint,
        p256dh=keys.get("p256dh"),
        auth=keys.get("auth"),
        created_at=_utc_now(),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "endpoint"],
        set_={"p256dh": keys.get("p256dh"), "auth": keys.get("auth")},
    )
    session.execute(stmt)
    session.commit()
    return {"ok": True, "message": "Suscripción guardada para futuras notificaciones push."}


@router.post("/push/unsubscribe")
def unsubscribe_push(
    data: PushSubscribeRequest,
    user: Annotated[CurrentUser, Depends(require_permission("push.subscribe"))],
    session: Annotated[Session, Depends(get_session)],
):
    user_id = _user_id_from_username(session, user.username)
    if user_id is None:
        return {"ok": True}
    sub = session.scalar(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == data.endpoint,
        )
    )
    if sub:
        session.delete(sub)
        session.commit()
    return {"ok": True}
