"""Brand logo storage for commercial BI dossiers.

This is intentionally filesystem-backed for the first implementation cut:
logos are operational assets, not business facts. Keeping them in storage avoids
an Alembic migration while still making them persistent in Docker/prod-local.
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

from .config import get_settings

_MAX_LOGO_BYTES = 2 * 1024 * 1024
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_DEFAULT_BRAND_COLORS = {
    "samsung": "#1428A0",
    "midea": "#0098D1",
    "drean": "#2A6FBA",
    "whirlpool": "#EEB111",
    "enova": "#7B3FB3",
}
_GENERATED_BRAND_COLORS = [
    "#1E3A8A",
    "#155E75",
    "#166534",
    "#6D28D9",
    "#92400E",
    "#9F1239",
    "#334155",
    "#0F766E",
]


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


def brand_style_dir() -> Path:
    path = get_settings().storage_dir / "brand-styles"
    path.mkdir(parents=True, exist_ok=True)
    return path


def brand_style_file(marca: str) -> Path:
    return brand_style_dir() / f"{brand_logo_slug(marca)}.json"


def normalize_brand_color(value: str) -> str:
    raw = (value or "").strip()
    if not raw.startswith("#"):
        raw = f"#{raw}"
    if not _COLOR_RE.match(raw):
        raise ValueError("El color debe tener formato HEX, por ejemplo #1428A0.")
    return raw.upper()


def default_brand_color(marca: str) -> str:
    slug = brand_logo_slug(marca)
    if slug in _DEFAULT_BRAND_COLORS:
        return _DEFAULT_BRAND_COLORS[slug]
    index = sum(ord(ch) for ch in slug) % len(_GENERATED_BRAND_COLORS)
    return _GENERATED_BRAND_COLORS[index]


def brand_style_info(marca: str) -> dict[str, Any]:
    path = brand_style_file(marca)
    color = default_brand_color(marca)
    custom = False
    updated_at = None
    if path.is_file() and path.stat().st_size > 0:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            color = normalize_brand_color(str(payload.get("primary_color") or color))
            custom = True
            updated_at = path.stat().st_mtime
        except (OSError, ValueError, json.JSONDecodeError):
            color = default_brand_color(marca)
            custom = False
            updated_at = None
    return {
        "marca": marca,
        "slug": brand_logo_slug(marca),
        "primary_color": color,
        "custom": custom,
        "updated_at": updated_at,
    }


def save_brand_style(marca: str, primary_color: str) -> dict[str, Any]:
    color = normalize_brand_color(primary_color)
    path = brand_style_file(marca)
    path.write_text(json.dumps({"primary_color": color}, ensure_ascii=True, indent=2), encoding="utf-8")
    return brand_style_info(marca)


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
