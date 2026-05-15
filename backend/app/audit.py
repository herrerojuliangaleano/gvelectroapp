from __future__ import annotations

import json
from typing import Any

from .database import append_event as append_audit_event, list_audit_events
from .users import CurrentUser


def actor_dict(user: CurrentUser | None) -> dict[str, Any]:
    if not user:
        return {"username": None, "display_name": None, "role": None}
    return {"username": user.username, "display_name": user.display_name, "role": user.role}


def _sync_audit_to_sheet(event_type: str, detail: dict[str, Any]) -> None:
    """Copia opcional de auditoría a Google Sheets.

    La fuente principal sigue siendo SQLite local. Esta sincronización es best-effort:
    si Google falla, no rompe la operación del usuario.
    """
    try:
        from .google_sheets import quote_sheet_name, sheets_service
        from .operational_config import AUDIT_HEADERS, runtime_audit_config
        from .database import utc_now_iso

        cfg = runtime_audit_config()
        if not cfg.get("sync_to_google_sheets") or not cfg.get("spreadsheet_id"):
            return
        sheet = str(cfg.get("sheet") or "AUDITORIA")
        service = sheets_service()
        spreadsheet_id = str(cfg["spreadsheet_id"])

        # Asegurar headers si la hoja está vacía.
        try:
            values = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f"{quote_sheet_name(sheet)}!1:1",
            ).execute().get("values", [])
            if not values:
                service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range=f"{quote_sheet_name(sheet)}!1:1",
                    valueInputOption="USER_ENTERED",
                    body={"values": [AUDIT_HEADERS]},
                ).execute()
        except Exception:
            # Si la hoja no existe o Google falla, no cortamos la acción real.
            pass

        actor = detail.get("actor") if isinstance(detail.get("actor"), dict) else {}
        row = [[
            utc_now_iso(),
            actor.get("username") or "",
            actor.get("display_name") or "",
            actor.get("role") or "",
            event_type,
            detail.get("resource_type") or "",
            detail.get("resource_id") or "",
            detail.get("status") or "ok",
            detail.get("message") or "",
            json.dumps(detail.get("details") or {}, ensure_ascii=False),
        ]]
        service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{quote_sheet_name(sheet)}!A1",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": row},
        ).execute()
    except Exception:
        return


def audit(action: str, *, user: CurrentUser | None = None, resource_type: str | None = None, resource_id: str | None = None, status: str = "ok", message: str | None = None, details: dict[str, Any] | None = None) -> None:
    detail = {
        "actor": actor_dict(user),
        "resource_type": resource_type,
        "resource_id": resource_id,
        "status": status,
        "message": message,
        "details": details or {},
    }
    append_audit_event(event_type=action, detail=detail)
    _sync_audit_to_sheet(action, detail)


def get_audit_events(limit: int = 200) -> list[dict[str, Any]]:
    return list_audit_events(limit)
