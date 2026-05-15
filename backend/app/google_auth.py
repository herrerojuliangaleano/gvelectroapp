from __future__ import annotations

import shutil
from pathlib import Path

from .config import get_settings


def local_credentials_file() -> Path:
    """Ruta activa de credentials.local.json.

    Prioridad:
    1. GOOGLE_CREDENTIALS_FILE en backend/.env
    2. backend/storage/private/credentials.local.json
    3. backend/secrets/credentials.local.json, compatibilidad vieja
    """
    settings = get_settings()
    preferred = settings.google_credentials_file
    if preferred.exists():
        return preferred
    legacy = settings.legacy_credentials_file
    if legacy.exists():
        return legacy
    return preferred


def stable_token_file() -> Path:
    """Ruta activa de token.json.

    Prioridad:
    1. GOOGLE_TOKEN_FILE en backend/.env
    2. backend/storage/private/token.json
    3. backend/storage/secrets/token.json, compatibilidad vieja
    """
    settings = get_settings()
    preferred = settings.google_token_file
    if preferred.exists():
        return preferred
    legacy = settings.legacy_token_file
    if legacy.exists():
        return legacy
    return preferred


def write_stable_token(text: str) -> None:
    target = get_settings().google_token_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def write_local_credentials(text: str) -> Path:
    target = get_settings().google_credentials_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def materialize_google_secrets(run_root: Path) -> None:
    settings = get_settings()
    run_root.mkdir(parents=True, exist_ok=True)

    if settings.google_credentials_json:
        (run_root / "credentials.json").write_text(settings.google_credentials_json, encoding="utf-8")
    elif local_credentials_file().exists():
        shutil.copy2(local_credentials_file(), run_root / "credentials.json")

    if settings.google_token_json:
        (run_root / "token.json").write_text(settings.google_token_json, encoding="utf-8")
        return

    token = stable_token_file()
    if token.exists():
        shutil.copy2(token, run_root / "token.json")


def persist_google_token_from_run(run_root: Path) -> None:
    token = run_root / "token.json"
    if token.exists():
        stable = get_settings().google_token_file
        stable.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(token, stable)
