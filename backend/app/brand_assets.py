"""Shared brand asset resolution for PDFs and Excel exports."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

from .config import get_settings


_LOGO_FILES = {
    "gv_electro": "gv_electro.png",
    "abc_electro": "abc_electro.png",
}

_LEGACY_LOGO_FILES = {
    "gv_electro": ("gv-electro.png",),
    "abc_electro": ("abc-electro.png",),
}


def normalize_logo_brand(value: object, *, allow_none: bool = False) -> str:
    """Normalize UI/API logo values into a stable brand key."""
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if allow_none and raw in {"", "none", "sin_logo", "sinlogo", "no_logo"}:
        return "none"
    if raw in {"abc", "abc_electro", "electro_abc", "electroabc"}:
        return "abc_electro"
    return "gv_electro"


def _resolve_configured_path(path_value: str) -> Iterable[Path]:
    settings = get_settings()
    path = Path(path_value.strip().strip('"').strip("'"))
    if path.is_absolute():
        yield path
        return
    yield settings.backend_dir / path
    yield settings.project_dir / path
    yield settings.storage_dir / path
    yield Path.cwd() / path


def brand_logo_path(value: object, *, configured_path: str | None = None, allow_none: bool = False) -> Path | None:
    """Return the first existing logo path for a brand.

    The app runs both from the repo and from Docker where STORAGE_DIR is
    `/app/storage`, so every export must resolve logos from the runtime storage
    first and only then fall back to repo-local paths.
    """
    brand = normalize_logo_brand(value, allow_none=allow_none)
    if brand == "none":
        return None

    settings = get_settings()
    logo_file = _LOGO_FILES[brand]

    candidates: list[Path] = []
    if configured_path:
        candidates.extend(_resolve_configured_path(configured_path))

    for file_name in (logo_file, *_LEGACY_LOGO_FILES.get(brand, ())):
        candidates.extend(
            [
                settings.storage_dir / "logos" / file_name,
                settings.backend_dir / "storage" / "logos" / file_name,
                settings.backend_dir / "storage" / "brand" / file_name,
                settings.project_dir / "backend" / "storage" / "logos" / file_name,
                settings.project_dir / "backend" / "storage" / "brand" / file_name,
                settings.project_dir / "storage" / "logos" / file_name,
                Path.cwd() / "backend" / "storage" / "logos" / file_name,
                Path.cwd() / "storage" / "logos" / file_name,
            ]
        )

    seen: set[Path] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            resolved = candidate
        if resolved in seen:
            continue
        seen.add(resolved)
        try:
            if resolved.is_file() and resolved.stat().st_size > 0:
                return resolved
        except Exception:
            continue
    return None
