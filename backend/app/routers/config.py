from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..auth import require_permission
from ..config import get_settings
from ..google_auth import local_credentials_file, stable_token_file
from ..schemas import ConfigStatus
from ..users import CurrentUser

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/status", response_model=ConfigStatus)
def api_config_status(_user: Annotated[CurrentUser, Depends(require_permission("settings.view"))]):
    settings = get_settings()
    return ConfigStatus(
        app_enabled=settings.app_enabled,
        has_credentials_env=bool(settings.google_credentials_json),
        has_credentials_file=local_credentials_file().exists(),
        has_token_file=stable_token_file().exists(),
        legacy_scripts_found=settings.legacy_template_dir.exists(),
        storage_dir=str(settings.storage_dir),
    )
