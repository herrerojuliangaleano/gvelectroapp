"""Lógica de negocio del módulo Comercial.

Sub-módulos:
- ``stock_reader``        : lee la hoja "Stock" del libro de Stock en Drive.
- ``ventas_reader``       : lee las hojas Ventas X Total del libro mensual.
- ``psi_engine``          : (próximo) algoritmo del endpoint /api/psi/report.
- ``adjustments_writer``  : (próximo) escribe ajustes al libro mensual.
- ``pdf_renderer``        : (próximo) export PDF con reportlab.

El cache es en memoria del proceso (dict global con TTL 15min). Si en el futuro
se usa Gunicorn con múltiples workers, mover a Redis. Para Fase 1 alcanza.

Ver `docs/10-modulo-comercial-fase1.md` para spec completa.
"""
from __future__ import annotations

import time
from threading import RLock
from typing import Any


# ──────────────────────────────────────────────────────────────────────────
# Cache compartido entre readers
# ──────────────────────────────────────────────────────────────────────────

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = RLock()
DEFAULT_TTL_SECONDS = 900  # 15 minutos


def cache_get(key: str, ttl: int = DEFAULT_TTL_SECONDS) -> Any | None:
    """Devuelve el valor cacheado si está fresco, sino None."""
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        ts, data = entry
        if time.time() - ts > ttl:
            return None
        return data


def cache_set(key: str, data: Any) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), data)


def cache_invalidate(key: str | None = None) -> int:
    """Invalida un key específico o todos. Retorna cantidad invalidada."""
    with _CACHE_LOCK:
        if key is None:
            n = len(_CACHE)
            _CACHE.clear()
            return n
        if key in _CACHE:
            del _CACHE[key]
            return 1
        return 0


def cache_stats() -> dict[str, Any]:
    """Estado del cache para debug."""
    with _CACHE_LOCK:
        now = time.time()
        return {
            "total_entries": len(_CACHE),
            "entries": [
                {
                    "key": key,
                    "age_seconds": int(now - ts),
                    "fresh": (now - ts) <= DEFAULT_TTL_SECONDS,
                }
                for key, (ts, _) in _CACHE.items()
            ],
        }
