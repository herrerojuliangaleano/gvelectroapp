from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from googleapiclient.errors import HttpError

from ..audit import audit
from ..auth import require_permission
from ..google_sheets import quote_sheet_name, sheets_service
from ..operational_config import (
    BUDGET_DETAIL_HEADERS,
    BUDGET_PRICE_HEADERS,
    BUDGET_PRICE_REQUIRED_HEADERS,
    BUDGET_RAW_HEADERS,
    BUDGET_SHIPPING_HEADERS,
    BUDGET_SHIPPING_REQUIRED_HEADERS,
    WARRANTY_RAW_HEADERS,
    WARRANTY_REQUIRED_HEADERS,
    PRODUCT_MASTER_HEADERS,
    AUDIT_HEADERS,
    extract_spreadsheet_id,
    is_superadmin,
    load_operational_config,
    save_operational_config,
)
from ..users import CurrentUser

router = APIRouter(prefix="/api/admin/operational-config", tags=["operational-config"])


class OperationalConfigSaveRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    lock_after_save: bool = False


class ValidateSourceRequest(BaseModel):
    section: str


def _sheet_url(spreadsheet_id: str | None) -> str | None:
    if not spreadsheet_id:
        return None
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"


def _first_configured_spreadsheet_id(cfg: dict[str, Any]) -> str | None:
    for section in ("products", "warranties", "budgets", "audit"):
        current = cfg.get(section, {}) if isinstance(cfg.get(section), dict) else {}
        sid = extract_spreadsheet_id(current.get("spreadsheet_id") or current.get("spreadsheet_url"))
        if sid:
            return sid
    return None


def _friendly_error(exc: Exception) -> str:
    text = str(exc)
    lower = text.lower()
    if "refresh" in lower and "token" in lower:
        return "No se pudo refrescar el token OAuth de Google. Reautorizá la cuenta desde Administración > Google."
    if "invalid_grant" in lower or "unauthorized" in lower:
        return "Google OAuth requiere reautorización. Revisá Administración > Google."
    return text


def _headers_for_sheet(spreadsheet_id: str, sheet_name: str, header_row: int = 1) -> list[str]:
    row = max(1, int(header_row or 1))
    result = sheets_service().spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{quote_sheet_name(sheet_name)}!{row}:{row}",
    ).execute()
    values = result.get("values", [])
    return [str(x).strip() for x in values[0]] if values else []


def _normalize_header(value: str) -> str:
    return "".join(ch for ch in str(value).upper().strip() if ch.isalnum())


def _missing(headers: list[str], required: list[str]) -> list[str]:
    existing = {_normalize_header(x) for x in headers}
    return [h for h in required if _normalize_header(h) not in existing]


def _validate_sheet(spreadsheet_id: str | None, sheet_name: str, required_headers: list[str], header_row: int = 1) -> dict[str, Any]:
    if not spreadsheet_id:
        return {"ok": False, "sheet": sheet_name, "error": "Falta configurar link o ID de Google Sheet."}
    try:
        headers = _headers_for_sheet(spreadsheet_id, sheet_name, header_row=header_row)
        missing = _missing(headers, required_headers)
        return {
            "ok": not missing,
            "sheet": sheet_name,
            "headers_found": headers,
            "required_headers": required_headers,
            "missing_headers": missing,
            "message": "OK" if not missing else "Faltan columnas obligatorias.",
        }
    except HttpError as exc:
        return {"ok": False, "sheet": sheet_name, "error": f"Google API: {_friendly_error(exc)}"}
    except Exception as exc:
        return {"ok": False, "sheet": sheet_name, "error": _friendly_error(exc)}


@router.get("")
def get_operational_config(_user: Annotated[CurrentUser, Depends(require_permission("ops_config.view"))]):
    cfg = load_operational_config()
    return {
        "config": cfg,
        "schemas": {
            "products": {
                "required_headers": PRODUCT_MASTER_HEADERS,
                "recommended_headers": PRODUCT_MASTER_HEADERS,
            },
            "warranties": {
                "raw_required_headers": WARRANTY_REQUIRED_HEADERS,
                "raw_recommended_headers": WARRANTY_RAW_HEADERS,
            },
            "budgets": {
                "price_required_headers": BUDGET_PRICE_REQUIRED_HEADERS,
                "price_recommended_headers": BUDGET_PRICE_HEADERS,
                "shipping_required_headers": BUDGET_SHIPPING_REQUIRED_HEADERS,
                "shipping_recommended_headers": BUDGET_SHIPPING_HEADERS,
                "raw_recommended_headers": BUDGET_RAW_HEADERS,
                "detail_recommended_headers": BUDGET_DETAIL_HEADERS,
            },
            "audit": {
                "recommended_headers": AUDIT_HEADERS,
            },
        },
        "sheet_urls": {
            "products": _sheet_url(extract_spreadsheet_id(cfg.get("products", {}).get("spreadsheet_id") or cfg.get("products", {}).get("spreadsheet_url"))) or _sheet_url(extract_spreadsheet_id(cfg.get("budgets", {}).get("spreadsheet_id") or cfg.get("budgets", {}).get("spreadsheet_url"))) or _sheet_url(extract_spreadsheet_id(cfg.get("warranties", {}).get("spreadsheet_id") or cfg.get("warranties", {}).get("spreadsheet_url"))),
            "warranties": _sheet_url(extract_spreadsheet_id(cfg.get("warranties", {}).get("spreadsheet_id") or cfg.get("warranties", {}).get("spreadsheet_url"))),
            "budgets": _sheet_url(extract_spreadsheet_id(cfg.get("budgets", {}).get("spreadsheet_id") or cfg.get("budgets", {}).get("spreadsheet_url"))),
            "audit": _sheet_url(extract_spreadsheet_id(cfg.get("audit", {}).get("spreadsheet_id") or cfg.get("audit", {}).get("spreadsheet_url"))),
        },
    }


@router.put("")
def save_config(data: OperationalConfigSaveRequest, user: Annotated[CurrentUser, Depends(require_permission("ops_config.manage"))]):
    current = load_operational_config()
    if current.get("locked") and not is_superadmin(user):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="La configuración está bloqueada. Solo SUPERADMIN puede modificarla.")
    new_config = data.config
    if data.lock_after_save:
        new_config["locked"] = True
    saved = save_operational_config(new_config, updated_by=user.username)
    audit("ops_config.save", user=user, resource_type="operational_config", resource_id="system", details={"locked": saved.get("locked")})
    return {"ok": True, "config": saved}


@router.post("/lock")
def lock_config(user: Annotated[CurrentUser, Depends(require_permission("ops_config.manage"))]):
    cfg = load_operational_config()
    cfg["locked"] = True
    saved = save_operational_config(cfg, updated_by=user.username)
    audit("ops_config.lock", user=user, resource_type="operational_config", resource_id="system")
    return {"ok": True, "config": saved}


@router.post("/unlock")
def unlock_config(user: Annotated[CurrentUser, Depends(require_permission("ops_config.manage"))]):
    if not is_superadmin(user):
        raise HTTPException(status_code=403, detail="Solo SUPERADMIN puede desbloquear la configuración.")
    cfg = load_operational_config()
    cfg["locked"] = False
    saved = save_operational_config(cfg, updated_by=user.username)
    audit("ops_config.unlock", user=user, resource_type="operational_config", resource_id="system")
    return {"ok": True, "config": saved}


@router.post("/validate")
def validate_source(data: ValidateSourceRequest, _user: Annotated[CurrentUser, Depends(require_permission("ops_config.view"))]):
    cfg = load_operational_config()
    section = data.section.lower().strip()
    results: list[dict[str, Any]] = []

    if section == "google":
        spreadsheet_id = _first_configured_spreadsheet_id(cfg)
        if not spreadsheet_id:
            results.append({"ok": False, "sheet": "Google", "error": "No hay ninguna planilla configurada para probar OAuth."})
        else:
            try:
                meta = sheets_service().spreadsheets().get(spreadsheetId=spreadsheet_id, fields="spreadsheetId,properties/title").execute()
                title = (meta.get("properties") or {}).get("title") or spreadsheet_id
                results.append({"ok": True, "sheet": title, "message": "Conexión Google activa."})
            except Exception as exc:
                results.append({"ok": False, "sheet": "Google", "error": _friendly_error(exc)})
    elif section == "products":
        pc = cfg.get("products", {})
        spreadsheet_id = extract_spreadsheet_id(pc.get("spreadsheet_id") or pc.get("spreadsheet_url"))
        # Fallback histórico para instalaciones que todavía no separaron Productos.
        if not spreadsheet_id:
            bc = cfg.get("budgets", {})
            wc = cfg.get("warranties", {})
            spreadsheet_id = extract_spreadsheet_id(bc.get("spreadsheet_id") or bc.get("spreadsheet_url")) or extract_spreadsheet_id(wc.get("spreadsheet_id") or wc.get("spreadsheet_url"))
        results.append(_validate_sheet(spreadsheet_id, pc.get("sheet_name") or "Productos PVP", PRODUCT_MASTER_HEADERS, int(pc.get("header_row") or 1)))
    elif section == "warranties":
        wc = cfg.get("warranties", {})
        spreadsheet_id = extract_spreadsheet_id(wc.get("spreadsheet_id") or wc.get("spreadsheet_url"))
        results.append(_validate_sheet(spreadsheet_id, wc.get("raw_sheet") or "00_RAW_GARANTIAS", WARRANTY_REQUIRED_HEADERS))
    elif section == "budgets":
        bc = cfg.get("budgets", {})
        spreadsheet_id = extract_spreadsheet_id(bc.get("spreadsheet_id") or bc.get("spreadsheet_url"))
        results.append(_validate_sheet(spreadsheet_id, bc.get("price_sheet") or "precios", BUDGET_PRICE_REQUIRED_HEADERS))
        results.append(_validate_sheet(spreadsheet_id, bc.get("shipping_sheet") or "fletes", BUDGET_SHIPPING_REQUIRED_HEADERS))
        results.append(_validate_sheet(spreadsheet_id, bc.get("raw_sheet") or "00_RAW_PRESUPUESTOS", ["ID PRESUPUESTO"]))
        results.append(_validate_sheet(spreadsheet_id, bc.get("detail_sheet") or "00_RAW_PRESUPUESTOS_DETALLE", ["ID PRESUPUESTO"]))
    elif section == "audit":
        ac = cfg.get("audit", {})
        spreadsheet_id = extract_spreadsheet_id(ac.get("spreadsheet_id") or ac.get("spreadsheet_url"))
        results.append(_validate_sheet(spreadsheet_id, ac.get("sheet") or "AUDITORIA", ["FECHA", "USUARIO", "ACCION"]))
    elif section in {"sales", "payroll", "tools", "price_cost_updates"}:
        results.append({"ok": True, "sheet": section, "message": "Configuración local disponible."})
    else:
        raise HTTPException(status_code=400, detail="Sección inválida. Usá google, products, warranties, budgets, audit, sales, payroll, tools o price_cost_updates.")

    return {"ok": all(r.get("ok") for r in results), "section": section, "results": results}
