"""Jobs, app_events y auditor?a sobre PostgreSQL.

El esquema lo gestiona Alembic (`alembic upgrade head`) + el seed inicial. Esta
capa expone helpers de compatibilidad para jobs y auditor?a mientras los
routers siguen importando desde `app.database`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from .db import db_session
from .models.auth import User
from .models.system import AppEvent, Job


def utc_now_iso() -> str:
    """Mantenido por compat. con código que aún use el string ISO."""
    return datetime.now(timezone.utc).isoformat()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── Jobs ─────────────────────────────────────────────────────────────────────

def _resolve_user_id(session, username: str | None) -> int | None:
    if not username:
        return None
    uname = str(username).strip().lower()
    if not uname:
        return None
    return session.scalar(select(User.id).where(User.username == uname))


def _job_to_dict(j: Job, session) -> dict[str, Any]:
    username = ""
    if j.user_id is not None:
        u = session.get(User, j.user_id)
        username = u.username if u else ""
    return {
        "id": j.id,
        "tool_id": j.tool_id,
        "tool_name": j.tool_name,
        "status": j.status,
        "created_at": j.created_at.isoformat() if j.created_at else "",
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        "duration_seconds": j.duration_seconds,
        "user": username,
        "payload": dict(j.payload or {}),
        "log_path": j.log_path,
        "error": j.error,
        "pid": j.pid,
    }


def _parse_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def create_job(job: dict[str, Any]) -> None:
    with db_session() as session:
        new_job = Job(
            id=str(job["id"]),
            tool_id=str(job["tool_id"]),
            tool_name=str(job["tool_name"]),
            status=str(job["status"]),
            created_at=_parse_dt(job.get("created_at")) or _utc_now(),
            user_id=_resolve_user_id(session, job.get("user")),
            payload=dict(job.get("payload") or {}),
            log_path=job.get("log_path"),
        )
        session.add(new_job)
        session.commit()


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    with db_session() as session:
        j = session.get(Job, job_id)
        if not j:
            return
        for key, value in fields.items():
            # Mapeo: el wrapper viejo aceptaba campos varios + payload como dict.
            if key in ("started_at", "finished_at"):
                setattr(j, key, _parse_dt(value))
            elif key == "payload":
                j.payload = dict(value or {})
            elif key == "user":
                j.user_id = _resolve_user_id(session, value)
            elif hasattr(j, key):
                setattr(j, key, value)
        session.commit()


def get_job(job_id: str) -> dict[str, Any] | None:
    with db_session() as session:
        j = session.get(Job, str(job_id))
        return _job_to_dict(j, session) if j else None


def list_jobs(limit: int = 100) -> list[dict[str, Any]]:
    with db_session() as session:
        rows = session.scalars(
            select(Job).order_by(Job.created_at.desc()).limit(max(1, int(limit or 100)))
        ).all()
        return [_job_to_dict(j, session) for j in rows]


# ── Auditoría / app_events ───────────────────────────────────────────────────

def append_event(event_type: str, detail: dict[str, Any]) -> None:
    with db_session() as session:
        actor_username = ""
        if isinstance(detail, dict):
            actor = detail.get("actor")
            if isinstance(actor, dict):
                actor_username = str(actor.get("username") or "")
        actor_user_id = _resolve_user_id(session, actor_username) if actor_username else None
        ev = AppEvent(
            event_type=str(event_type or ""),
            actor_user_id=actor_user_id,
            detail=dict(detail or {}),
        )
        session.add(ev)
        session.commit()


def list_audit_events(limit: int = 200) -> list[dict[str, Any]]:
    with db_session() as session:
        rows = session.scalars(
            select(AppEvent).order_by(AppEvent.id.desc()).limit(max(1, int(limit or 200)))
        ).all()
        events: list[dict[str, Any]] = []
        for r in rows:
            detail = dict(r.detail or {})
            actor = detail.get("actor") if isinstance(detail.get("actor"), dict) else {}
            events.append({
                "id": int(r.id),
                "created_at": r.created_at.isoformat() if r.created_at else "",
                "event_type": r.event_type,
                "actor_username": actor.get("username"),
                "actor_display_name": actor.get("display_name"),
                "actor_role": actor.get("role"),
                "resource_type": detail.get("resource_type"),
                "resource_id": detail.get("resource_id"),
                "status": detail.get("status", "ok"),
                "message": detail.get("message"),
                "details": detail.get("details", {}),
            })
        return events
