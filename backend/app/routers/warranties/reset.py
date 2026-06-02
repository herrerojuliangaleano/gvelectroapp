"""Sub-router · Production reset de garantías.

Endpoints:
  GET  /production-reset/preview   — snapshot pre-reset
  POST /production-reset/backup    — descarga backup JSON
  POST /production-reset/execute   — borra datos operativos + reset counters

Importa constantes / helpers compartidos desde el paquete padre (``__init__.py``).
Por eso este módulo se importa al FINAL del ``__init__.py``, cuando todos los
símbolos compartidos ya están definidos.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ...audit import audit
from ...auth import require_current_user
from ...config import get_settings
from ...warranties_db import (
    RESET_TABLES_PG,
    pg_export_table_rows,
    pg_reset_summary,
    pg_reset_warranty_tables,
)
from ...warranty_helpers import now_ar, utc_now_iso

# Constantes y modelos Pydantic se importan del paquete padre. El import es
# `from . import xxx` que apunta a ``__init__.py``; cuando este módulo se importa
# al final de ``__init__.py``, todos esos símbolos ya están definidos.
from . import (
    RESET_CONFIRMATION_PHRASE,
    RESET_PRESERVED_ITEMS,
    WarrantyResetPreviewResponse,
    WarrantyResetRequest,
    WarrantyResetResponse,
    WarrantyResetSummary,
    _user_role_keys,
    warranty_exports_dir,
)


router = APIRouter(tags=["warranties"])


# ── Helpers privados del módulo ─────────────────────────────────────────────

def _is_reset_admin(user: Any) -> bool:
    roles = _user_role_keys(user)
    perms = set(getattr(user, "permissions", []) or [])
    return "*" in perms or "warranties.reset_data" in perms or bool(roles & {"SUPERADMIN", "ADMIN", "ADMINISTRADOR", "GERENTE"})


def _require_reset_admin(user: Any) -> None:
    if not _is_reset_admin(user):
        raise HTTPException(status_code=403, detail="Solo un administrador puede resetear datos de prueba de garantías.")


def _generated_export_files_count() -> int:
    path = warranty_exports_dir()
    if not path.exists():
        return 0
    return sum(1 for p in path.glob("*.xlsx") if p.is_file())


def _reset_summary_pg() -> WarrantyResetSummary:
    """Snapshot del reset desde Postgres."""
    counts = pg_reset_summary()
    return WarrantyResetSummary(
        guarantees=int(counts.get("guarantees") or 0),
        guarantee_items=int(counts.get("guarantee_items") or 0),
        guarantee_history=int(counts.get("guarantee_history") or 0),
        remitos=int(counts.get("remitos") or 0),
        exports=int(counts.get("exports") or 0),
        sync_logs=int(counts.get("sync_logs") or 0),
        counters=int(counts.get("counters") or 0),
        generated_export_files=_generated_export_files_count(),
    )


def _create_warranty_reset_backup_pg(user: Any) -> Path:
    """Backup JSON pre-reset desde Postgres. Mismas claves que el legacy.

    Para no romper consumidores externos del JSON, el dict ``tables`` mantiene
    también la clave ``warranty_remitos`` apuntando a las filas de ``remitos``.
    """
    settings = get_settings()
    backup_dir = settings.outputs_dir / "warranties" / "reset_backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_ar().strftime("%Y%m%d-%H%M%S")
    filename = f"backup-garantias-pre-reset-{stamp}.json"
    path = backup_dir / filename
    tables = {table: pg_export_table_rows(table) for table in RESET_TABLES_PG}
    # Alias legacy: el JSON viejo usaba "warranty_remitos".
    tables["warranty_remitos"] = tables.get("remitos", [])
    payload = {
        "created_at": utc_now_iso(),
        "created_by": getattr(user, "username", "") or "",
        "created_by_name": getattr(user, "display_name", "") or "",
        "summary": _reset_summary_pg().model_dump(),
        "preserved": RESET_PRESERVED_ITEMS,
        "tables": tables,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def _delete_generated_warranty_export_files() -> int:
    path = warranty_exports_dir()
    if not path.exists():
        return 0
    deleted = 0
    for file_path in path.glob("*.xlsx"):
        try:
            if file_path.is_file():
                file_path.unlink()
                deleted += 1
        except Exception:
            # No bloquear por archivo abierto; queda registrado en el backup.
            continue
    return deleted


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/production-reset/preview", response_model=WarrantyResetPreviewResponse)
def preview_warranty_production_reset(user: Annotated[Any, Depends(require_current_user)]):
    _require_reset_admin(user)
    summary = _reset_summary_pg()
    return WarrantyResetPreviewResponse(
        generated_at=utc_now_iso(),
        summary=summary,
        preserved=RESET_PRESERVED_ITEMS,
        warning="Esta acción limpia datos operativos de garantías de prueba y reinicia correlativos. No borra usuarios, empresas, sucursales, depósitos ni configuración.",
        confirmation_phrase=RESET_CONFIRMATION_PHRASE,
    )


@router.post("/production-reset/backup")
def create_warranty_production_reset_backup(user: Annotated[Any, Depends(require_current_user)]):
    _require_reset_admin(user)
    backup_path = _create_warranty_reset_backup_pg(user)
    audit("warranties.production_reset.backup", user=user, resource_type="warranty_reset", resource_id=backup_path.name)
    return FileResponse(path=backup_path, media_type="application/json", filename=backup_path.name)


@router.post("/production-reset/execute", response_model=WarrantyResetResponse)
def execute_warranty_production_reset(data: WarrantyResetRequest, user: Annotated[Any, Depends(require_current_user)]):
    _require_reset_admin(user)
    if data.confirmation.strip().upper() != RESET_CONFIRMATION_PHRASE:
        raise HTTPException(status_code=400, detail=f"Confirmación inválida. Escribí exactamente: {RESET_CONFIRMATION_PHRASE}")

    reset_at = utc_now_iso()
    summary_before = _reset_summary_pg()
    backup_path = _create_warranty_reset_backup_pg(user)
    # TRUNCATE atómico: borra las 8 tablas + restart identity + cascade FKs.
    pg_reset_warranty_tables()

    deleted_files = _delete_generated_warranty_export_files() if data.reset_generated_files else 0
    audit(
        "warranties.production_reset.executed",
        user=user,
        resource_type="warranty_reset",
        resource_id=backup_path.name,
        details={"summary_before": summary_before.model_dump(), "deleted_generated_files": deleted_files},
    )
    return WarrantyResetResponse(
        ok=True,
        reset_at=reset_at,
        summary_before=summary_before,
        backup_file=backup_path.name,
        deleted_generated_files=deleted_files,
        message="Datos operativos de garantías limpiados. Usuarios, empresas, sucursales, depósitos, roles, permisos y configuración se conservaron.",
    )
