from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import require_current_user, require_permission
from ..config import get_settings
from ..jobs import cancel_job, get_job, list_jobs, read_logs
from ..users import CurrentUser

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
def api_jobs(_user: Annotated[CurrentUser, Depends(require_permission("jobs.view"))]):
    return list_jobs(get_settings().max_recent_jobs)


@router.get("/{job_id}")
def api_job(job_id: str, _user: Annotated[CurrentUser, Depends(require_permission("jobs.view"))]):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job no encontrado")
    return job


@router.get("/{job_id}/logs")
def api_job_logs(job_id: str, _user: Annotated[CurrentUser, Depends(require_permission("jobs.view"))], tail: int | None = Query(default=None)):
    if not get_job(job_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job no encontrado")
    return {"job_id": job_id, "logs": read_logs(job_id, tail=tail)}


@router.post("/{job_id}/cancel")
def api_cancel_job(job_id: str, user: Annotated[CurrentUser, Depends(require_permission("jobs.cancel"))]):
    ok = cancel_job(job_id, user)
    if not ok:
        raise HTTPException(status_code=400, detail="No se pudo cancelar o ya terminó")
    return {"ok": True}
