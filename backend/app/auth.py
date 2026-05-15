from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings
from .users import CurrentUser, authenticate_user, get_current_user

bearer_scheme = HTTPBearer(auto_error=False)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def create_token(user: CurrentUser | str, hours: int = 12) -> str:
    settings = get_settings()
    username = user.username if isinstance(user, CurrentUser) else str(user)
    payload = {
        "sub": username,
        "exp": int((datetime.now(timezone.utc) + timedelta(hours=hours)).timestamp()),
        "nonce": secrets.token_hex(8),
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(settings.auth_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64(sig)}"


def verify_token(token: str) -> str:
    settings = get_settings()
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(settings.auth_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(sig), expected):
            raise ValueError("firma inválida")
        payload = json.loads(_unb64(body).decode("utf-8"))
        if int(payload["exp"]) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("token vencido")
        return str(payload["sub"])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión inválida o vencida") from exc


def authenticate(username: str, password: str) -> CurrentUser | None:
    return authenticate_user(username, password)


def require_current_user(creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> CurrentUser:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta iniciar sesión")
    username = verify_token(creds.credentials)
    user = get_current_user(username)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario desactivado o inexistente")
    return user


def require_user(creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> str:
    return require_current_user(creds).username


def require_permission(permission: str) -> Callable[[CurrentUser], CurrentUser]:
    def dependency(user: Annotated[CurrentUser, Depends(require_current_user)]) -> CurrentUser:
        if user.must_change_password:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenés que crear tu contraseña antes de continuar")
        if not user.has(permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenés permiso para realizar esta acción")
        return user
    return dependency
