from __future__ import annotations

import platform
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from ..auth import require_current_user, require_permission
from ..config import get_settings
from ..database import list_audit_events, list_jobs
from ..google_auth import local_credentials_file, stable_token_file
from ..operational_config import load_operational_config
from ..tools.registry import list_tools
from ..users import CurrentUser, load_users, repair_user_branch_links, repair_user_employees, repair_user_legacy_roles

router = APIRouter(prefix="/api/system", tags=["system"])
APP_VERSION = "1.5.0-pro-base"


def _system_cfg() -> dict[str, Any]:
    cfg = load_operational_config().get("system", {})
    return {
        "mode": cfg.get("mode", "open"),
        "open_time": cfg.get("open_time", "09:00"),
        "close_time": cfg.get("close_time", "16:00"),
        "timezone": cfg.get("timezone", "America/Argentina/Buenos_Aires"),
        "closed_message": cfg.get("closed_message", "El sistema se encuentra cerrado o fuera del horario de carga."),
        "maintenance_message": cfg.get("maintenance_message", "El sistema está en mantenimiento."),
    }


def _now_for_timezone(tz_name: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(tz_name))
    except Exception:
        return datetime.now(ZoneInfo("America/Argentina/Buenos_Aires"))


def _is_inside_window(now: datetime, open_time: str, close_time: str) -> bool:
    try:
        start_h, start_m = [int(x) for x in open_time.split(":")[:2]]
        end_h, end_m = [int(x) for x in close_time.split(":")[:2]]
        start = now.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
        end = now.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
        if start <= end:
            return start <= now <= end
        return now >= start or now <= end
    except Exception:
        return True


def _diagnostic_db_counts() -> dict[str, Any]:
    settings = get_settings()
    db_path = Path(settings.database_path)
    if not db_path.exists():
        return {"database_exists": False, "counts": {}, "issues": [{"severity": "critical", "title": "Base de datos no encontrada", "detail": str(db_path), "action": "Iniciar el backend para crear la base."}]}

    issues: list[dict[str, Any]] = []
    counts: dict[str, Any] = {"database_exists": True}
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row

        def scalar(sql: str, params: tuple[Any, ...] = ()) -> int:
            try:
                row = conn.execute(sql, params).fetchone()
                return int(row[0] if row else 0)
            except Exception:
                return 0

        counts["companies"] = scalar("SELECT COUNT(*) FROM companies")
        counts["branches"] = scalar("SELECT COUNT(*) FROM branches")
        counts["user_branches"] = scalar("SELECT COUNT(*) FROM user_branches")
        counts["user_roles"] = scalar("SELECT COUNT(*) FROM user_roles")
        counts["employees"] = scalar("SELECT COUNT(*) FROM employees")
        counts["employees_without_dni"] = scalar("SELECT COUNT(*) FROM employees WHERE TRIM(COALESCE(dni, '')) = ''")
        counts["employees_without_photo"] = scalar("SELECT COUNT(*) FROM employees WHERE TRIM(COALESCE(photo_url, '')) = '' OR COALESCE(photo_status, '') NOT IN ('aprobada')")
        counts["payroll_total"] = scalar("SELECT COUNT(*) FROM payroll_receipts")
        counts["payroll_pending"] = scalar("SELECT COUNT(*) FROM payroll_receipts WHERE status IN ('pendiente','visto')")
        counts["payroll_signed"] = scalar("SELECT COUNT(*) FROM payroll_receipts WHERE status = 'firmado_conforme'")
        counts["payroll_observed"] = scalar("SELECT COUNT(*) FROM payroll_receipts WHERE status = 'observado'")
        counts["payroll_cancelled"] = scalar("SELECT COUNT(*) FROM payroll_receipts WHERE status = 'anulado'")

        if counts["companies"] < 2:
            issues.append({"severity": "warning", "title": "Empresas incompletas", "detail": "Revisar Electro GV y Electro ABC SRL.", "action": "Abrir Empresas y sucursales."})
        if counts["branches"] < 8:
            issues.append({"severity": "warning", "title": "Sucursales operativas incompletas", "detail": "Faltan sucursales físicas o WEB.", "action": "Revisar Empresas y sucursales."})
        if counts["employees_without_dni"]:
            issues.append({"severity": "warning", "title": "Empleados sin DNI", "detail": f"{counts['employees_without_dni']} empleado/s requieren DNI para recibos.", "action": "Completar legajos desde Usuarios."})
        if counts["employees_without_photo"]:
            issues.append({"severity": "info", "title": "Fotos profesionales pendientes", "detail": f"{counts['employees_without_photo']} empleado/s no tienen foto aprobada.", "action": "Solicitar o aprobar fotos desde Usuarios."})
        if counts["payroll_observed"]:
            issues.append({"severity": "warning", "title": "Recibos observados", "detail": f"{counts['payroll_observed']} recibo/s tienen observaciones.", "action": "Revisar Recibos de sueldo."})

        duplicate_rows = conn.execute(
            """
            SELECT employee_id, period_year, period_month, receipt_type, COUNT(*) AS total
            FROM payroll_receipts
            WHERE status NOT IN ('anulado','reemplazado')
            GROUP BY employee_id, period_year, period_month, receipt_type
            HAVING COUNT(*) > 1
            LIMIT 20
            """
        ).fetchall()
        counts["payroll_duplicate_groups"] = len(duplicate_rows)
        if duplicate_rows:
            issues.append({"severity": "warning", "title": "Recibos duplicados", "detail": f"{len(duplicate_rows)} grupo/s duplicados detectados.", "action": "Revisar duplicados antes de nuevas cargas."})

        missing_files = 0
        storage = Path(settings.storage_dir)
        try:
            rows = conn.execute("SELECT file_path FROM payroll_receipts WHERE status NOT IN ('anulado','reemplazado')").fetchall()
            for row in rows:
                file_path = str(row["file_path"] or "")
                if not file_path:
                    missing_files += 1
                    continue
                path = Path(file_path)
                if not path.is_absolute():
                    path = storage / file_path
                if not path.exists():
                    missing_files += 1
        except Exception:
            missing_files = 0
        counts["payroll_missing_files"] = missing_files
        if missing_files:
            issues.append({"severity": "critical", "title": "Archivos de recibos no encontrados", "detail": f"{missing_files} archivo/s no están disponibles en storage.", "action": "Revisar backups o ruta de almacenamiento."})

    return {"database_exists": True, "counts": counts, "issues": issues}


def _user_diagnostic_items() -> tuple[dict[str, int], list[dict[str, Any]]]:
    users = load_users()
    issues: list[dict[str, Any]] = []
    counts = {
        "users_total": len(users),
        "users_active": len([u for u in users.values() if u.is_active]),
        "users_without_roles": 0,
        "users_without_branch": 0,
        "users_without_employee": 0,
        "users_must_change_password": 0,
    }
    for record in users.values():
        public = record.public()
        roles = public.get("roles") or ([] if not public.get("role") else [public.get("role")])
        branches = public.get("branches") or []
        if not roles:
            counts["users_without_roles"] += 1
        if not branches and not public.get("branch_id") and not public.get("sucursal"):
            counts["users_without_branch"] += 1
        if not public.get("employee"):
            counts["users_without_employee"] += 1
        if public.get("must_change_password"):
            counts["users_must_change_password"] += 1
    if counts["users_without_roles"]:
        issues.append({"severity": "critical", "title": "Usuarios sin rol", "detail": f"{counts['users_without_roles']} usuario/s no tienen roles asignados.", "action": "Ejecutar reparación de roles o revisar Usuarios."})
    if counts["users_without_branch"]:
        issues.append({"severity": "warning", "title": "Usuarios sin sucursal", "detail": f"{counts['users_without_branch']} usuario/s no tienen alcance operativo.", "action": "Ejecutar reparación de sucursales o revisar Usuarios."})
    if counts["users_without_employee"]:
        issues.append({"severity": "warning", "title": "Usuarios sin empleado vinculado", "detail": f"{counts['users_without_employee']} usuario/s no tienen legajo asociado.", "action": "Preparar empleados desde Usuarios."})
    return counts, issues


@router.get("/status")
def public_status():
    """Estado liviano y público para que el frontend muestre mensajes amigables."""
    settings = get_settings()
    cfg = _system_cfg()
    now = _now_for_timezone(cfg["timezone"])
    inside = _is_inside_window(now, cfg["open_time"], cfg["close_time"])
    mode = str(cfg["mode"] or "open")
    available = bool(settings.app_enabled) and mode == "open" and inside
    message = "Sistema abierto"
    if not settings.app_enabled:
        message = "La aplicación está deshabilitada por administración."
    elif mode == "maintenance":
        message = cfg["maintenance_message"]
    elif mode == "closed" or not inside:
        message = cfg["closed_message"]
    return {
        "ok": True,
        "app": settings.app_name,
        "version": APP_VERSION,
        "backend_online": True,
        "app_enabled": settings.app_enabled,
        "mode": mode,
        "available": available,
        "inside_schedule": inside,
        "open_time": cfg["open_time"],
        "close_time": cfg["close_time"],
        "timezone": cfg["timezone"],
        "now": now.isoformat(timespec="seconds"),
        "message": message,
    }


@router.get("/summary")
def summary(_user: Annotated[CurrentUser, Depends(require_permission("dashboard.view"))]):
    settings = get_settings()
    users = load_users()
    jobs = list_jobs(10)
    events = list_audit_events(10)
    tools = list_tools()
    status = public_status()
    running = [j for j in jobs if j.get("status") == "running"]
    errors = [j for j in jobs if j.get("status") == "error"]
    return {
        "status": status,
        "counts": {
            "users_total": len(users),
            "users_active": len([u for u in users.values() if u.is_active]),
            "tools_visible": len(tools),
            "jobs_recent": len(jobs),
            "jobs_running": len(running),
            "jobs_errors_recent": len(errors),
        },
        "google": {
            "credentials_file": local_credentials_file().exists(),
            "token_file": stable_token_file().exists(),
        },
        "paths": {
            "storage_dir": str(settings.storage_dir),
            "database_path": str(settings.database_path),
        },
        "recent_jobs": jobs,
        "recent_events": events,
    }


@router.get("/about")
def about(_user: Annotated[CurrentUser, Depends(require_permission("about.view"))]):
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "version": APP_VERSION,
        "environment": "Laptop local + frontend fijo",
        "backend": "FastAPI / Uvicorn",
        "frontend": "React / Vite / Render Static Site",
        "python": platform.python_version(),
        "system": platform.platform(),
        "storage_dir": str(settings.storage_dir),
        "database_path": str(settings.database_path),
        "frontend_dist_dir": str(settings.frontend_dist_dir),
        "notes": [
            "El frontend queda online en Render.",
            "El backend funciona mientras la laptop esté prendida y ngrok esté activo.",
            "La configuración operativa se maneja desde SUPERADMIN.",
        ],
        "changelog": [
            {"version": "1.5", "title": "Base profesional", "items": ["Centro de control", "Backups", "Mi usuario", "Acerca del sistema", "Herramientas por categoría"]},
            {"version": "1.4", "title": "Configuración operativa", "items": ["Planillas configurables", "bloqueo de configuración", "validación de hojas"]},
            {"version": "1.3", "title": "Presupuestos", "items": ["presupuesto rápido", "productos", "fletes", "copiar WhatsApp opcional"]},
            {"version": "1.2", "title": "Garantías", "items": ["carga web", "responsable automático", "ID para WhatsApp"]},
        ],
    }


@router.get("/diagnostics")
def diagnostics(_user: Annotated[CurrentUser, Depends(require_permission("system.diagnostics.view"))]):
    db = _diagnostic_db_counts()
    user_counts, user_issues = _user_diagnostic_items()
    jobs = list_jobs(20)
    recent_errors = [j for j in jobs if j.get("status") == "error"]
    issues = [*user_issues, *(db.get("issues") or [])]
    if recent_errors:
        issues.append({"severity": "warning", "title": "Procesos recientes con error", "detail": f"{len(recent_errors)} proceso/s recientes terminaron con error.", "action": "Revisar Historial de procesos."})
    critical = len([i for i in issues if i.get("severity") == "critical"])
    warning = len([i for i in issues if i.get("severity") == "warning"])
    status = "critical" if critical else "warning" if warning else "ok"
    return {
        "status": status,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "summary": {
            **user_counts,
            **(db.get("counts") or {}),
            "jobs_recent_errors": len(recent_errors),
            "issues_total": len(issues),
            "issues_critical": critical,
            "issues_warning": warning,
        },
        "issues": issues,
        "recent_errors": recent_errors[:5],
        "recommended_actions": [
            {"label": "Reparar roles legacy", "action": "repair_legacy_roles"},
            {"label": "Reparar sucursales legacy", "action": "repair_branch_links"},
            {"label": "Preparar empleados", "action": "repair_employees"},
        ],
    }


@router.post("/diagnostics/repair")
def repair_diagnostics(user: Annotated[CurrentUser, Depends(require_permission("system.diagnostics.repair"))]):
    roles = repair_user_legacy_roles()
    branches = repair_user_branch_links()
    employees = repair_user_employees()
    return {"ok": True, "roles": roles, "branches": branches, "employees": employees}


@router.get("/profile/activity")
def profile_activity(user: Annotated[CurrentUser, Depends(require_current_user)], limit: int = 20):
    events = [e for e in list_audit_events(1000) if e.get("actor_username") == user.username]
    return events[: max(1, min(limit, 100))]
