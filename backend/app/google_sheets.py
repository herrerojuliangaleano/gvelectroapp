from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from .config import get_settings
from .google_auth import local_credentials_file, stable_token_file, write_stable_token

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _parse_json_text(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def get_google_credentials() -> Credentials:
    """Devuelve credenciales OAuth válidas para Google Sheets/Drive.

    Prioridad:
    1. token refrescado en storage/secrets/token.json
    2. GOOGLE_TOKEN_JSON desde variables de entorno

    Si el token expira y tiene refresh_token, se refresca y se persiste en storage.
    """
    settings = get_settings()
    token_info = _read_json(stable_token_file()) or _parse_json_text(settings.google_token_json)
    if not token_info:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No hay token OAuth configurado. Revisá GOOGLE_TOKEN_JSON o storage/secrets/token.json.",
        )

    try:
        creds = Credentials.from_authorized_user_info(token_info, SCOPES)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="El token OAuth no tiene formato válido") from exc

    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            write_stable_token(creds.to_json())
        except Exception as exc:
            has_creds = bool(settings.google_credentials_json) or local_credentials_file().exists()
            detail = "No se pudo refrescar el token OAuth."
            if not has_creds:
                detail += " Además faltan las credenciales OAuth base."
            raise HTTPException(status_code=500, detail=detail) from exc

    if not creds.valid:
        raise HTTPException(status_code=500, detail="Las credenciales OAuth no son válidas")

    return creds


def sheets_service():
    return build("sheets", "v4", credentials=get_google_credentials(), cache_discovery=False)


def quote_sheet_name(sheet_name: str) -> str:
    return "'" + sheet_name.replace("'", "''") + "'"
