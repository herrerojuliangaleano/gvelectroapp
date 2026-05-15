from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from ..audit import audit
from ..auth import require_permission
from ..config import get_settings
from ..google_auth import local_credentials_file, stable_token_file, write_stable_token, write_local_credentials
from ..google_sheets import SCOPES
from ..users import CurrentUser

router = APIRouter(prefix="/api/admin/google", tags=["admin-google"])

_reconnect_lock = threading.RLock()
_reconnect_state: dict[str, Any] = {
    "running": False,
    "status": "idle",
    "message": "Sin reconexión en curso.",
    "started_at": None,
    "finished_at": None,
    "error": None,
}


class SaveJsonRequest(BaseModel):
    json_text: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _parse_json_text(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        if not isinstance(parsed, dict):
            raise ValueError("El JSON debe ser un objeto")
        return parsed
    except Exception as exc:
        raise HTTPException(status_code=400, detail="El texto ingresado no es JSON válido") from exc


def _credentials_target_file() -> Path:
    settings = get_settings()
    settings.google_credentials_file.parent.mkdir(parents=True, exist_ok=True)
    return settings.google_credentials_file


def _token_target_file() -> Path:
    settings = get_settings()
    settings.google_token_file.parent.mkdir(parents=True, exist_ok=True)
    return settings.google_token_file


def _token_info() -> dict[str, Any]:
    settings = get_settings()
    token_path = stable_token_file()
    token_raw = _read_json_file(token_path)

    if token_raw is None and settings.google_token_json:
        try:
            parsed = json.loads(settings.google_token_json)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            token_raw = parsed if isinstance(parsed, dict) else None
        except Exception:
            token_raw = None

    info: dict[str, Any] = {
        "path": str(token_path),
        "exists": bool(token_raw),
        "valid": False,
        "expired": None,
        "has_refresh_token": False,
        "scopes": [],
        "expiry": None,
        "source": "file" if token_path.exists() else ("env" if settings.google_token_json else "none"),
    }

    if not token_raw:
        return info

    try:
        creds = Credentials.from_authorized_user_info(token_raw, SCOPES)
        info.update({
            "valid": bool(creds.valid),
            "expired": bool(creds.expired),
            "has_refresh_token": bool(creds.refresh_token),
            "scopes": list(creds.scopes or token_raw.get("scopes") or []),
            "expiry": creds.expiry.isoformat() if creds.expiry else token_raw.get("expiry"),
        })
    except Exception as exc:
        info["error"] = f"Token con formato inválido: {exc}"
    return info


def _credentials_info() -> dict[str, Any]:
    settings = get_settings()
    path = local_credentials_file()
    file_data = _read_json_file(path)
    env_data = None
    if settings.google_credentials_json:
        try:
            parsed = json.loads(settings.google_credentials_json)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            env_data = parsed if isinstance(parsed, dict) else None
        except Exception:
            env_data = None

    data = file_data or env_data
    kind = "none"
    client_id = None
    project_id = None
    if isinstance(data, dict):
        if "installed" in data:
            kind = "installed"
            client_id = data.get("installed", {}).get("client_id")
            project_id = data.get("installed", {}).get("project_id")
        elif "web" in data:
            kind = "web"
            client_id = data.get("web", {}).get("client_id")
            project_id = data.get("web", {}).get("project_id")
        else:
            kind = "unknown"

    return {
        "path": str(path),
        "exists": bool(file_data or env_data),
        "exists_file": bool(file_data),
        "exists_env": bool(env_data),
        "kind": kind,
        "client_id": client_id,
        "project_id": project_id,
    }


@router.get("/status")
def google_status(_user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    settings = get_settings()
    return {
        "credentials": _credentials_info(),
        "token": _token_info(),
        "storage_private_dir": str(settings.private_dir),
        "scopes": SCOPES,
        "reconnect": _reconnect_state,
    }


@router.post("/credentials")
def save_credentials(req: SaveJsonRequest, user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    parsed = _parse_json_text(req.json_text)
    if "installed" not in parsed and "web" not in parsed:
        raise HTTPException(status_code=400, detail="El credentials debe tener clave 'installed' o 'web'.")
    target = write_local_credentials(json.dumps(parsed, ensure_ascii=False, indent=2))
    audit("google.credentials_save", user=user, resource_type="google", resource_id="credentials", message="Credenciales OAuth guardadas localmente", details={"path": str(target)})
    return {"ok": True, "path": str(target), "status": _credentials_info()}


@router.post("/token")
def save_token(req: SaveJsonRequest, user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    parsed = _parse_json_text(req.json_text)
    required = ["token", "client_id", "client_secret", "refresh_token", "token_uri"]
    missing = [key for key in required if not parsed.get(key)]
    if missing:
        raise HTTPException(status_code=400, detail=f"El token parece incompleto. Faltan: {', '.join(missing)}")
    target = _token_target_file()
    target.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    audit("google.token_save", user=user, resource_type="google", resource_id="token", message="Token OAuth guardado localmente", details={"path": str(target)})
    return {"ok": True, "path": str(target), "status": _token_info()}


@router.delete("/token")
def delete_token(user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    token = _token_target_file()
    existed = token.exists()
    if existed:
        token.unlink()
    audit("google.token_delete", user=user, resource_type="google", resource_id="token", message="Token OAuth eliminado", details={"existed": existed})
    return {"ok": True, "deleted": existed, "status": _token_info()}


@router.post("/refresh-token")
def refresh_token(user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    token_path = stable_token_file()
    token_raw = _read_json_file(token_path)
    if not token_raw:
        raise HTTPException(status_code=400, detail="No hay token local para refrescar.")
    try:
        creds = Credentials.from_authorized_user_info(token_raw, SCOPES)
        if not creds.refresh_token:
            raise HTTPException(status_code=400, detail="El token no tiene refresh_token. Hacé Reconectar Google.")
        creds.refresh(Request())
        write_stable_token(creds.to_json())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo refrescar el token: {exc}") from exc
    audit("google.token_refresh", user=user, resource_type="google", resource_id="token", message="Token OAuth refrescado")
    return {"ok": True, "status": _token_info()}


def _run_local_reconnect(actor: dict[str, str] | None = None) -> None:
    with _reconnect_lock:
        _reconnect_state.update({
            "running": True,
            "status": "running",
            "message": "Abriendo navegador en la laptop para autorizar Google...",
            "started_at": _now_iso(),
            "finished_at": None,
            "error": None,
        })
    try:
        try:
            from google_auth_oauthlib.flow import InstalledAppFlow
        except Exception as exc:
            raise RuntimeError("Falta instalar google-auth-oauthlib en el entorno virtual.") from exc

        credentials_file = local_credentials_file()
        if not credentials_file.exists():
            raise RuntimeError("No existe credentials.local.json. Cargalo desde el panel o ponelo en storage/private.")

        flow = InstalledAppFlow.from_client_secrets_file(str(credentials_file), SCOPES)
        creds = flow.run_local_server(
            host="localhost",
            port=0,
            open_browser=True,
            prompt="consent",
            access_type="offline",
            authorization_prompt_message="Autorizá ElectroGV Web Tools en el navegador que se abrió en la laptop.",
            success_message="Autorización completada. Ya podés volver a ElectroGV Web Tools.",
        )
        write_stable_token(creds.to_json())
        with _reconnect_lock:
            _reconnect_state.update({
                "running": False,
                "status": "success",
                "message": "Google reconectado correctamente. Token guardado en storage/private/token.json.",
                "finished_at": _now_iso(),
                "error": None,
            })
    except Exception as exc:
        with _reconnect_lock:
            _reconnect_state.update({
                "running": False,
                "status": "error",
                "message": "No se pudo reconectar Google.",
                "finished_at": _now_iso(),
                "error": str(exc),
            })


@router.post("/reconnect-local/start")
def start_local_reconnect(user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    with _reconnect_lock:
        if _reconnect_state.get("running"):
            return {"ok": True, "already_running": True, "reconnect": _reconnect_state}
        _reconnect_state.update({
            "running": True,
            "status": "starting",
            "message": "Preparando reconexión local...",
            "started_at": _now_iso(),
            "finished_at": None,
            "error": None,
        })

    thread = threading.Thread(target=_run_local_reconnect, kwargs={"actor": user.public()}, daemon=True)
    thread.start()
    audit("google.reconnect_start", user=user, resource_type="google", resource_id="oauth", message="Inicio de reconexión local de Google")
    return {"ok": True, "reconnect": _reconnect_state}


@router.get("/reconnect-local/status")
def reconnect_status(_user: Annotated[CurrentUser, Depends(require_permission("google.manage"))]):
    return {"ok": True, "reconnect": _reconnect_state, "status": _token_info()}
