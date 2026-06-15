"""Scheduler de tareas automáticas (APScheduler).

Infraestructura reutilizable para jobs en background del backend. Hoy corre
el sync nocturno del catálogo; pensado para sumar después import de planillas
(con horario), alertas operativas y resumen ejecutivo.

Diseño:
  - Un único AsyncIOScheduler montado en el lifespan de FastAPI.
  - Se activa solo si `SCHEDULER_ENABLED=true` (default false → dev no corre
    jobs automáticos). En prod-local se pone true en el .env.
  - Cada job se registra con un id estable y `replace_existing=True`, así un
    restart no duplica.
  - Los jobs corren en un thread (no async) porque el trabajo real (Google
    Sheets, Postgres) es síncrono. APScheduler lo maneja con su threadpool.

Para agregar un job nuevo: escribí la función `_job_*` y registrala en
`_register_jobs`.
"""
from __future__ import annotations

import logging

from .config import get_settings

log = logging.getLogger("electrogv.scheduler")

_scheduler = None  # AsyncIOScheduler | None


def _job_catalog_sync() -> None:
    """Sync nocturno del catálogo desde la Planilla Madre. actor=None → el
    log de sync queda sin usuario (es automático)."""
    try:
        from .product_catalog import sync_products_from_sheet
        result = sync_products_from_sheet(actor=None)
        log.info(
            "Sync automático de catálogo OK: %s creados, %s actualizados, %s errores",
            result.get("rows_created"), result.get("rows_updated"), len(result.get("errors") or []),
        )
    except Exception as exc:
        log.exception("Sync automático de catálogo FALLÓ: %s", exc)


def _register_jobs(scheduler) -> None:
    from apscheduler.triggers.cron import CronTrigger

    settings = get_settings()

    if settings.catalog_sync_enabled:
        scheduler.add_job(
            _job_catalog_sync,
            trigger=CronTrigger(
                hour=settings.catalog_sync_hour,
                minute=settings.catalog_sync_minute,
                timezone=settings.scheduler_timezone,
            ),
            id="catalog_sync",
            replace_existing=True,
            misfire_grace_time=3600,  # si el server estuvo caído, tolera 1h de atraso
            coalesce=True,
        )
        log.info(
            "Job 'catalog_sync' registrado: %02d:%02d %s",
            settings.catalog_sync_hour, settings.catalog_sync_minute, settings.scheduler_timezone,
        )


def start_scheduler() -> None:
    """Arranca el scheduler si está habilitado. Idempotente."""
    global _scheduler
    settings = get_settings()
    if not settings.scheduler_enabled:
        log.info("Scheduler deshabilitado (SCHEDULER_ENABLED=false). No se programan jobs.")
        return
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
    except Exception as exc:  # APScheduler no instalado: degradar sin romper
        log.warning("APScheduler no disponible (%s). El scheduler queda inactivo.", exc)
        return
    _scheduler = AsyncIOScheduler(timezone=settings.scheduler_timezone)
    _register_jobs(_scheduler)
    _scheduler.start()
    log.info("Scheduler iniciado con %s job(s).", len(_scheduler.get_jobs()))


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None


def scheduler_status() -> dict:
    """Estado del scheduler para el panel de diagnóstico: si está activo y
    cuándo corre cada job. Permite verificar desde la app que el sync
    nocturno está programado sin mirar logs del server."""
    settings = get_settings()
    jobs = []
    if _scheduler is not None:
        for j in _scheduler.get_jobs():
            jobs.append({
                "id": j.id,
                "next_run_time": j.next_run_time.isoformat() if j.next_run_time else None,
            })
    return {
        "enabled": settings.scheduler_enabled,
        "running": _scheduler is not None,
        "timezone": settings.scheduler_timezone,
        "jobs": jobs,
    }
