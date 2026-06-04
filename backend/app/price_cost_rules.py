from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from fastapi import HTTPException, status

from .access import ensure_active_user, is_superadmin, user_has, user_has_any, user_role_keys, users_with_permission


CHECKS_BY_TYPE: dict[str, list[tuple[str, str]]] = {
    "price": [
        ("puma", "Puma actualizado"),
        ("web_gv", "Web ElectroGV actualizada"),
        ("web_abc", "Web ABC actualizada"),
        ("planilla_madre", "Planilla Madre actualizada"),
    ],
    "cost": [
        ("puma", "Puma actualizado"),
        ("planilla_madre", "Planilla Madre actualizada"),
    ],
}

CHECK_GRANULAR_PERMISSIONS: dict[str, dict[str, str]] = {
    "price": {
        "puma": "price_updates.check.puma",
        "web_gv": "price_updates.check.web",
        "web_abc": "price_updates.check.web",
        "planilla_madre": "price_updates.check.master",
    },
    "cost": {
        "puma": "cost_updates.check.puma",
        "planilla_madre": "cost_updates.check.master",
    },
}

ANNOUNCEMENT_ROLES = {"SUPERADMIN", "GERENTE", "GERENTE_COMERCIAL", "ADMINISTRADOR", "ADMIN"}
PUMA_ALLOWED_ROLES = {"SUPERADMIN", "GERENTE", "ADMINISTRADOR", "ADMIN"}


def normalize_change_type(value: str) -> str:
    text = str(value or "").strip().lower()
    if text in {"precio", "price", "pvp"}:
        return "price"
    if text in {"costo", "cost"}:
        return "cost"
    return text


def default_checks(change_type: str) -> list[tuple[str, str]]:
    change_type = normalize_change_type(change_type)
    return CHECKS_BY_TYPE[change_type]


def check_label(change_type: str, check_key: str) -> str:
    for key, label in default_checks(change_type):
        if key == check_key:
            return label
    return str(check_key or "")


def check_permissions(change_type: str, check_key: str) -> list[str]:
    change_type = normalize_change_type(change_type)
    granular = CHECK_GRANULAR_PERMISSIONS.get(change_type, {}).get(check_key)
    legacy = f"{change_type}_updates.check"
    out = [p for p in [granular, legacy] if p]
    return list(dict.fromkeys(out))


def user_can_mark_check(user: Any, change_type: str, check_key: str) -> bool:
    if not user or getattr(user, "must_change_password", False):
        return False
    if is_superadmin(user):
        return True
    if check_key == "puma" and not (user_role_keys(user) & PUMA_ALLOWED_ROLES):
        return False
    return user_has_any(user, check_permissions(change_type, check_key))


def require_check_permission(user: Any, change_type: str, check_key: str) -> None:
    ensure_active_user(user)
    if not user_can_mark_check(user, change_type, check_key):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenes permiso para marcar este check")


def user_can_generate_price_announcement(user: Any) -> bool:
    if not user or getattr(user, "must_change_password", False):
        return False
    if is_superadmin(user):
        return True
    if user_has(user, "price_announcements.generate"):
        return True
    return bool(user_role_keys(user) & ANNOUNCEMENT_ROLES)


def require_price_announcement_permission(user: Any) -> None:
    ensure_active_user(user)
    if not user_can_generate_price_announcement(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenes permiso para generar anuncios de precios")


def users_with_any_permissions(permissions: Iterable[str]) -> list[str]:
    out: list[str] = []
    for permission in permissions:
        for username in users_with_permission(permission):
            if username and username not in out:
                out.append(username)
    return out


def users_for_pending_checks(change_type: str, check_keys: Iterable[str]) -> list[str]:
    permissions: list[str] = []
    for check_key in check_keys:
        permissions.extend(check_permissions(change_type, str(check_key)))
    return users_with_any_permissions(dict.fromkeys(permissions))


def notify_grouped_price_cost_updates(change_type: str, updates: Iterable[dict[str, Any]]) -> None:
    rows = [row for row in updates if row]
    if not rows:
        return

    if normalize_change_type(change_type) == "price":
        check_keys = ["puma", "web_gv", "web_abc"]
        noun = "precios"
    else:
        check_keys = ["puma"]
        noun = "costos"
    recipients = users_for_pending_checks(change_type, check_keys)
    if not recipients:
        return

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        brand = str(row.get("marca") or "Sin marca").strip() or "Sin marca"
        grouped[brand].append(row)

    try:
        from .routers.notifications import notify_many

        for brand, brand_rows in sorted(grouped.items(), key=lambda item: item[0].lower()):
            count = len(brand_rows)
            title = f"Cambios de {noun} en {brand}"
            message = f"{count} producto{'s' if count != 1 else ''} con nuevos {noun} para revisar."
            notify_many(
                recipients,
                title,
                message,
                "price_cost_update",
                None,
                module="price_cost",
                event_type=f"{change_type}_changes_by_brand",
                priority="high",
                link_url="/precios-costos",
                entity_type="price_cost_update",
                metadata={
                    "change_type": normalize_change_type(change_type),
                    "brand": brand,
                    "count": count,
                    "update_ids": [int(row["id"]) for row in brand_rows if row.get("id")],
                },
            )
    except Exception:
        return
