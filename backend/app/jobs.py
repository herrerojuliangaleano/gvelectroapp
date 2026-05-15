from __future__ import annotations

import os
import signal
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .audit import audit
from .config import get_settings
from .database import create_job, get_job, list_jobs, update_job, utc_now_iso
from .tools.base import run_legacy_subprocess
from .tools.registry import get_tool
from .users import CurrentUser

_executor = ThreadPoolExecutor(max_workers=int(os.getenv("JOB_WORKERS", "2")))


def _safe_payload(payload: dict[str, Any]) -> dict[str, Any]:
    clean = {}
    for k, v in payload.items():
        if "password" in k.lower() or "secret" in k.lower() or "token" in k.lower():
            clean[k] = "***"
        else:
            clean[k] = v
    return clean


def submit_job(tool_id: str, payload: dict[str, Any], uploads: dict[str, list[Path]], user: CurrentUser | str) -> str:
    settings = get_settings()
    if not settings.app_enabled:
        raise RuntimeError("La aplicación está deshabilitada por el administrador.")
    tool = get_tool(tool_id)
    if not tool:
        raise ValueError(f"Herramienta desconocida: {tool_id}")

    username = user.username if isinstance(user, CurrentUser) else str(user)
    job_id = uuid.uuid4().hex[:16]
    log_path = settings.logs_dir / f"{job_id}.log"
    create_job({
        "id": job_id,
        "tool_id": tool_id,
        "tool_name": tool["name"],
        "status": "pending",
        "created_at": utc_now_iso(),
        "user": username,
        "payload": _safe_payload(payload),
        "log_path": str(log_path),
    })
    _executor.submit(_run_job, job_id, tool, payload, uploads, log_path, user if isinstance(user, CurrentUser) else None)
    return job_id


def _run_job(job_id: str, tool: dict[str, Any], payload: dict[str, Any], uploads: dict[str, list[Path]], log_path: Path, user: CurrentUser | None) -> None:
    started = datetime.now(timezone.utc)
    update_job(job_id, status="running", started_at=started.isoformat())
    audit("jobs.start", user=user, resource_type="job", resource_id=job_id, details={"tool_id": tool.get("id"), "tool_name": tool.get("name")})
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as log_file:
            exit_code, _pid = run_legacy_subprocess(job_id, tool, payload, uploads, log_file)
        finished = datetime.now(timezone.utc)
        duration = (finished - started).total_seconds()
        if exit_code == 0:
            update_job(job_id, status="success", finished_at=finished.isoformat(), duration_seconds=duration, pid=None)
            audit("jobs.success", user=user, resource_type="job", resource_id=job_id, details={"duration_seconds": duration})
        else:
            message = f"El proceso terminó con código {exit_code}"
            update_job(job_id, status="error", finished_at=finished.isoformat(), duration_seconds=duration, error=message, pid=None)
            audit("jobs.error", user=user, resource_type="job", resource_id=job_id, status="error", message=message, details={"duration_seconds": duration})
    except Exception as exc:
        finished = datetime.now(timezone.utc)
        duration = (finished - started).total_seconds()
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write("\n[ERROR WEB]\n")
            log_file.write(traceback.format_exc())
        update_job(job_id, status="error", finished_at=finished.isoformat(), duration_seconds=duration, error=str(exc), pid=None)
        audit("jobs.exception", user=user, resource_type="job", resource_id=job_id, status="error", message=str(exc), details={"duration_seconds": duration})


def cancel_job(job_id: str, user: CurrentUser | None = None) -> bool:
    job = get_job(job_id)
    if not job:
        return False
    if job["status"] not in {"pending", "running"}:
        return False
    pid = job.get("pid")
    if pid:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception as exc:
            update_job(job_id, error=f"No pude cancelar el proceso: {exc}")
            return False
    update_job(job_id, status="cancelled", finished_at=utc_now_iso(), pid=None)
    audit("jobs.cancel", user=user, resource_type="job", resource_id=job_id)
    return True


def read_logs(job_id: str, tail: int | None = None) -> str:
    job = get_job(job_id)
    if not job or not job.get("log_path"):
        return ""
    path = Path(job["log_path"])
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if tail and tail > 0:
        lines = text.splitlines()
        return "\n".join(lines[-tail:])
    return text


__all__ = ["submit_job", "cancel_job", "read_logs", "get_job", "list_jobs"]
