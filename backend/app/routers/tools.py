from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..audit import audit
from ..auth import require_current_user, require_permission
from ..config import get_settings
from ..jobs import submit_job
from ..schemas import RunResponse
from ..tools.registry import get_tool, list_tools, public_tool
from ..users import CurrentUser

router = APIRouter(prefix="/api/tools", tags=["tools"])


def _can_view_tool(user: CurrentUser, tool_id: str) -> bool:
    return user.has("tools.view") or user.has(f"tools.run.{tool_id}")


@router.get("")
def api_list_tools(user: Annotated[CurrentUser, Depends(require_current_user)]):
    tools = []
    for tool in list_tools():
        if _can_view_tool(user, tool["id"]):
            tools.append(tool)
    return tools


@router.get("/{tool_id}")
def api_get_tool(tool_id: str, user: Annotated[CurrentUser, Depends(require_current_user)]):
    tool = get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Herramienta no encontrada")
    if not _can_view_tool(user, tool_id):
        raise HTTPException(status_code=403, detail="No tenés permiso para ver esta herramienta")
    return public_tool(tool)


@router.post("/{tool_id}/run", response_model=RunResponse)
async def api_run_tool(
    tool_id: str,
    user: Annotated[CurrentUser, Depends(require_current_user)],
    payload: str = Form("{}"),
    files: list[UploadFile] = File(default=[]),
):
    tool = get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Herramienta no encontrada")
    if not user.has(f"tools.run.{tool_id}"):
        raise HTTPException(status_code=403, detail="No tenés permiso para ejecutar esta herramienta")
    try:
        data = json.loads(payload or "{}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Payload JSON inválido") from exc

    settings = get_settings()
    upload_root = settings.uploads_dir / tool_id
    upload_root.mkdir(parents=True, exist_ok=True)
    uploads_by_field: dict[str, list[Path]] = {}

    for upload in files:
        raw_filename = upload.filename or "archivo"
        if "__FIELD__" in raw_filename:
            field_name, actual_name = raw_filename.split("__FIELD__", 1)
        else:
            field_name, actual_name = "files", raw_filename
        safe_name = Path(actual_name).name
        target_dir = upload_root / field_name
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / safe_name
        content = await upload.read()
        target.write_bytes(content)
        uploads_by_field.setdefault(field_name, []).append(target)

    try:
        job_id = submit_job(tool_id, data, uploads_by_field, user)
    except Exception as exc:
        audit("tools.run_failed", user=user, resource_type="tool", resource_id=tool_id, status="error", message=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit("tools.run", user=user, resource_type="job", resource_id=job_id, details={"tool_id": tool_id, "tool_name": tool["name"]})
    return RunResponse(job_id=job_id, status="pending")
