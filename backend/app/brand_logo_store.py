"""Brand logo storage for commercial BI dossiers.

This is intentionally filesystem-backed for the first implementation cut:
logos are operational assets, not business facts. Keeping them in storage avoids
an Alembic migration while still making them persistent in Docker/prod-local.
"""
from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any

from .config import get_settings

_MAX_LOGO_BYTES = 2 * 1024 * 1024


def brand_logo_slug(marca: str) -> str:
    raw = (marca or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    return raw.strip("-") or "marca"


def brand_logo_dir() -> Path:
    path = get_settings().storage_dir / "brand-logos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def brand_logo_file(marca: str) -> Path:
    return brand_logo_dir() / f"{brand_logo_slug(marca)}.png"


def brand_logo_info(marca: str, *, include_data: bool = True) -> dict[str, Any]:
    path = brand_logo_file(marca)
    exists = path.is_file() and path.stat().st_size > 0
    info: dict[str, Any] = {
        "marca": marca,
        "slug": brand_logo_slug(marca),
        "exists": exists,
        "content_type": "image/png" if exists else "",
        "size": path.stat().st_size if exists else 0,
        "updated_at": path.stat().st_mtime if exists else None,
        "data_url": "",
    }
    if include_data and exists:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        info["data_url"] = f"data:image/png;base64,{encoded}"
    return info


def save_brand_logo(marca: str, content: bytes) -> dict[str, Any]:
    if not content:
        raise ValueError("El archivo esta vacio.")
    if len(content) > _MAX_LOGO_BYTES:
        raise ValueError("El logo no puede superar 2 MB.")
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("El logo debe ser un PNG valido.")
    path = brand_logo_file(marca)
    path.write_bytes(content)
    return brand_logo_info(marca)


def delete_brand_logo(marca: str) -> dict[str, Any]:
    path = brand_logo_file(marca)
    if path.exists():
        path.unlink()
    return brand_logo_info(marca)
