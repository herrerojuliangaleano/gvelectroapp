from __future__ import annotations

import json
import logging

from .config import get_settings

logger = logging.getLogger(__name__)

_app = None


def _init():
    global _app
    if _app is not None:
        return _app
    try:
        import firebase_admin
        from firebase_admin import credentials

        settings = get_settings()
        service_account_json = settings.firebase_service_account_json
        service_account = settings.firebase_service_account_file
        if not service_account_json and not service_account.exists():
            legacy = settings.legacy_firebase_service_account_file
            if legacy.exists():
                service_account = legacy

        if service_account_json:
            cert = credentials.Certificate(json.loads(service_account_json))
        elif service_account.exists():
            cert = credentials.Certificate(str(service_account))
        else:
            logger.info("firebase-service-account.json no encontrado - push FCM desactivado")
            return None
        _app = firebase_admin.initialize_app(cert)
    except Exception as exc:
        logger.warning("Firebase Admin no disponible: %s", exc)
        _app = None
    return _app


_MODULE_CHANNEL: dict[str, str] = {
    "warranties": "electrogv_garantias",
    "remitos": "electrogv_remitos",
    "provider": "electrogv_garantias",
    "sales_web": "electrogv_ventas",
    "price_cost": "electrogv_ventas",
    "payroll": "electrogv_default",
    "system": "electrogv_critico",
    "general": "electrogv_default",
}

_PRIORITY_CHANNEL: dict[str, str] = {
    "critical": "electrogv_critico",
    "high": "electrogv_garantias",
    "normal": "electrogv_default",
    "low": "electrogv_info",
}


def _channel_for(module: str | None, priority: str | None) -> str:
    if priority == "critical":
        return "electrogv_critico"
    if module:
        return _MODULE_CHANNEL.get(module, "electrogv_default")
    return _PRIORITY_CHANNEL.get(priority or "normal", "electrogv_default")


def send_to_token(token: str, title: str, body: str, data: dict[str, str] | None = None) -> bool:
    if not _init():
        return False
    try:
        from firebase_admin import messaging

        d = {k: str(v) for k, v in (data or {}).items()}
        channel_id = _channel_for(d.get("module"), d.get("priority"))
        android_priority = "high" if d.get("priority") in ("critical", "high") else "normal"

        msg = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=d,
            android=messaging.AndroidConfig(
                priority=android_priority,
                notification=messaging.AndroidNotification(
                    channel_id=channel_id,
                    color="#1e40af",
                    sound="default",
                    icon="ic_notification",
                ),
            ),
            token=token,
        )
        messaging.send(msg)
        return True
    except Exception as exc:
        logger.warning("FCM send error (token …%s): %s", token[-6:], exc)
        return False


def send_to_many(tokens: list[str], title: str, body: str, data: dict[str, str] | None = None) -> int:
    if not tokens:
        return 0
    return sum(1 for t in tokens if send_to_token(t, title, body, data))
