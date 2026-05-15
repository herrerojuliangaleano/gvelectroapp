from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel


def _load_local_env() -> None:
    """Carga backend/.env en modo laptop/local.

    En Render o en un VPS las variables pueden venir del sistema. En laptop conviene
    guardar la config en backend/.env. Si python-dotenv no está instalado, no rompe.
    """
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=env_path, override=False)
    except Exception:
        # Fallback mínimo: KEY=VALUE, ignorando comentarios.
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_local_env()


def _split_env_list(value: str) -> list[str]:
    return [item.strip() for item in value.split(',') if item.strip()]


def _path_from_env(value: str | None, base: Path) -> Path | None:
    if not value:
        return None
    path = Path(value.strip().strip('"').strip("'"))
    if not path.is_absolute():
        path = base / path
    return path


class Settings(BaseModel):
    app_name: str = "ElectroGV Web Tools"
    app_enabled: bool = os.getenv("APP_ENABLED", "true").lower() in {"1", "true", "yes", "si", "sí"}
    admin_user: str = os.getenv("ADMIN_USER", "admin")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "admin")
    auth_secret: str = os.getenv("AUTH_SECRET", "dev-secret-change-me")
    cors_origins: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000").split(",") if o.strip()]

    backend_dir: Path = Path(__file__).resolve().parents[1]
    project_dir: Path = Path(__file__).resolve().parents[2]
    storage_dir: Path = Path(os.getenv("STORAGE_DIR", str(Path(__file__).resolve().parents[1] / "storage")))
    legacy_template_dir: Path = Path(__file__).resolve().parents[1] / "legacy_scripts" / "Aplicacion de ElectroGV"
    python_executable: str = os.getenv("PYTHON_EXECUTABLE", "python")
    max_recent_jobs: int = int(os.getenv("MAX_RECENT_JOBS", "100"))
    frontend_dist_dir: Path = Path(os.getenv("FRONTEND_DIST_DIR", str(Path(__file__).resolve().parents[2] / "frontend" / "dist")))

    # Garantías
    warranty_spreadsheet_id: str | None = os.getenv("WARRANTY_SPREADSHEET_ID") or None
    warranty_spreadsheet_url: str | None = os.getenv("WARRANTY_SPREADSHEET_URL") or None
    warranty_raw_sheet: str = os.getenv("WARRANTY_RAW_SHEET", "00_RAW_GARANTIAS")
    product_catalog_sheet: str = os.getenv("PRODUCT_CATALOG_SHEET", "Productos PVP")
    warranty_product_cache_seconds: int = int(os.getenv("WARRANTY_PRODUCT_CACHE_SECONDS", "300"))
    warranty_sucursales: list[str] = _split_env_list(os.getenv("WARRANTY_SUCURSALES", "CASEROS,LANUS,CANNING,NORCENTER"))
    warranty_depositos: list[str] = _split_env_list(os.getenv("WARRANTY_DEPOSITOS", "DEPÓSITO GARANTÍAS,CHICLANA,CORRALES,CACHI,PROVEEDOR,CASEROS,LANUS,CANNING,NORCENTER"))
    warranty_estado_default: str = os.getenv("WARRANTY_ESTADO_DEFAULT", "INGRESADO")

    # Presupuestos
    budget_raw_sheet: str = os.getenv("BUDGET_RAW_SHEET", "00_RAW_PRESUPUESTOS")
    budget_detail_sheet: str = os.getenv("BUDGET_DETAIL_SHEET", "00_RAW_PRESUPUESTOS_DETALLE")
    budget_estado_default: str = os.getenv("BUDGET_ESTADO_DEFAULT", "PENDIENTE")
    budget_product_cache_seconds: int = int(os.getenv("BUDGET_PRODUCT_CACHE_SECONDS", "300"))
    # Formato simple: "Retiro en local=0,CABA=20000,Envío a confirmar="
    budget_shipping_options: str = os.getenv("BUDGET_SHIPPING_OPTIONS", "Retiro en local=0,Envío a confirmar=")
    # Formato profesional opcional: [{"id":"CABA","label":"CABA","price":25000}]
    budget_shipping_options_json: str | None = os.getenv("BUDGET_SHIPPING_OPTIONS_JSON") or None

    @property
    def database_path(self) -> Path:
        return self.storage_dir / "electrogv.sqlite3"

    @property
    def logs_dir(self) -> Path:
        return self.storage_dir / "logs"

    @property
    def uploads_dir(self) -> Path:
        return self.storage_dir / "uploads"

    @property
    def runs_dir(self) -> Path:
        return self.storage_dir / "runs"

    @property
    def outputs_dir(self) -> Path:
        return self.storage_dir / "outputs"

    @property
    def secrets_dir(self) -> Path:
        # Ruta vieja, mantenida solo por compatibilidad.
        return self.storage_dir / "secrets"

    @property
    def private_dir(self) -> Path:
        # Ruta definitiva para modo laptop: credenciales, token, usuarios, roles.
        return self.storage_dir / "private"

    @property
    def users_file(self) -> Path:
        return self.private_dir / "users.json"

    @property
    def roles_file(self) -> Path:
        return self.private_dir / "roles.json"

    @property
    def audit_log_file(self) -> Path:
        return self.logs_dir / "audit.jsonl"

    @property
    def google_credentials_file(self) -> Path:
        return _path_from_env(os.getenv("GOOGLE_CREDENTIALS_FILE"), self.backend_dir) or (self.private_dir / "credentials.local.json")

    @property
    def google_token_file(self) -> Path:
        return _path_from_env(os.getenv("GOOGLE_TOKEN_FILE"), self.backend_dir) or (self.private_dir / "token.json")

    @property
    def legacy_credentials_file(self) -> Path:
        return self.backend_dir / "secrets" / "credentials.local.json"

    @property
    def legacy_token_file(self) -> Path:
        return self.secrets_dir / "token.json"

    def _env_json_value(self, env_name: str) -> str | None:
        value = os.getenv(env_name)
        if not value:
            return None
        value = value.strip()
        try:
            parsed = json.loads(value)
            if isinstance(parsed, str):
                return parsed
            return json.dumps(parsed)
        except Exception:
            return value

    @property
    def google_credentials_json(self) -> str | None:
        return self._env_json_value("GOOGLE_CREDENTIALS_JSON")

    @property
    def google_token_json(self) -> str | None:
        return self._env_json_value("GOOGLE_TOKEN_JSON")

    @property
    def warranty_spreadsheet(self) -> str | None:
        if self.warranty_spreadsheet_id:
            return self.warranty_spreadsheet_id.strip()
        if self.warranty_spreadsheet_url:
            match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", self.warranty_spreadsheet_url)
            if match:
                return match.group(1)
            value = self.warranty_spreadsheet_url.strip()
            if value and "/" not in value:
                return value
        return None

    def ensure_dirs(self) -> None:
        for path in [
            self.storage_dir,
            self.logs_dir,
            self.uploads_dir,
            self.runs_dir,
            self.outputs_dir,
            self.secrets_dir,
            self.private_dir,
            self.google_credentials_file.parent,
            self.google_token_file.parent,
        ]:
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
