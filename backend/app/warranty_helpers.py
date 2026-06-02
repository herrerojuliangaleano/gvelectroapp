"""Helpers puros compartidos entre Garantías y Remitos.

Acá viven SOLO helpers puros (sin DB) que ambos módulos necesitan:
- Constantes de estados de revisión (REVIEW_*).
- Helpers de fecha/hora en AR (zona Buenos Aires).
- Normalización de texto / claves.

`warranties.py` y `remitos.py` importan estos helpers desde acá; el acceso a DB
vive en `warranties_db.py` y `remitos_db.py`.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo


# ── Constantes de revisión interna ──────────────────────────────────────────
# Estados del flujo de revisión (review_status). NO mezclar con el `status`
# operativo de la garantía: la revisión interna decide si una garantía
# pendiente pasa al flujo de proveedor o vuelve para corrección.

REVIEW_PENDING = "pendiente_revision"
REVIEW_IN_PROGRESS = "en_revision"
REVIEW_INCOMPLETE = "requiere_correccion"
REVIEW_APPROVED = "revisada"

REVIEW_LABELS: dict[str, str] = {
    REVIEW_PENDING: "Pendiente de revisión",
    REVIEW_IN_PROGRESS: "En revisión interna",
    REVIEW_INCOMPLETE: "Requiere corrección",
    REVIEW_APPROVED: "Revisada",
}

CANCELLED_STATUS = "ANULADA"


# ── Zonas horarias / formato ─────────────────────────────────────────────────

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_ar() -> datetime:
    return datetime.now(AR_TZ)


def format_date_ar(dt: datetime | date | None = None) -> str:
    if dt is None:
        dt = now_ar()
    if isinstance(dt, datetime):
        return dt.astimezone(AR_TZ).strftime("%d/%m/%Y")
    return dt.strftime("%d/%m/%Y")


def format_datetime_ar(dt: datetime | None = None) -> str:
    if dt is None:
        dt = now_ar()
    return dt.astimezone(AR_TZ).strftime("%d/%m/%Y %H:%M")


def parse_iso_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def parse_date_filter(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except Exception:
            pass
    return None


# ── Normalización de texto (claves / comparación) ───────────────────────────

def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper().strip()
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def header_key(value: Any) -> str:
    return normalize_text(value).replace(" ", "")
