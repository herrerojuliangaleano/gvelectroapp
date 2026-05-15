from __future__ import annotations

import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..audit import audit
from ..auth import require_permission
from ..config import get_settings
from ..users import CurrentUser

router = APIRouter(prefix="/api/admin/backups", tags=["backups"])


def _backup_dir() -> Path:
    path = get_settings().storage_dir / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _backup_name() -> str:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"electrogv_backup_{stamp}.zip"


def _write_file_if_exists(zf: zipfile.ZipFile, file_path: Path, arcname: str) -> None:
    if file_path.exists() and file_path.is_file():
        zf.write(file_path, arcname=arcname)


@router.get("")
def list_backups(_user: Annotated[CurrentUser, Depends(require_permission("backups.view"))]):
    backups = []
    for path in sorted(_backup_dir().glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = path.stat()
        backups.append({
            "filename": path.name,
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        })
    return backups


@router.post("")
def create_backup(user: Annotated[CurrentUser, Depends(require_permission("backups.manage"))]):
    settings = get_settings()
    settings.ensure_dirs()
    target = _backup_dir() / _backup_name()
    with zipfile.ZipFile(target, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Archivos críticos de operación local.
        private = settings.private_dir
        for name in ["users.json", "roles.json", "operational_config.json", "counters.json"]:
            _write_file_if_exists(zf, private / name, f"private/{name}")
        _write_file_if_exists(zf, settings.database_path, "electrogv.sqlite3")
        _write_file_if_exists(zf, settings.audit_log_file, "logs/audit.jsonl")
        # Logs recientes de jobs.
        if settings.logs_dir.exists():
            for log in settings.logs_dir.glob("*.log"):
                zf.write(log, arcname=f"logs/{log.name}")
        # .env sin duplicar secretos en caso de que el usuario quiera respaldo local.
        env_path = settings.backend_dir / ".env"
        _write_file_if_exists(zf, env_path, ".env")
    audit("backups.create", user=user, resource_type="backup", resource_id=target.name, message="Backup creado", details={"size_bytes": target.stat().st_size})
    return {"ok": True, "filename": target.name, "size_bytes": target.stat().st_size}


@router.get("/{filename}")
def download_backup(filename: str, _user: Annotated[CurrentUser, Depends(require_permission("backups.manage"))]):
    safe = Path(filename).name
    path = _backup_dir() / safe
    if not path.exists() or path.suffix.lower() != ".zip":
        raise HTTPException(status_code=404, detail="Backup no encontrado")
    return FileResponse(path, filename=path.name, media_type="application/zip")
