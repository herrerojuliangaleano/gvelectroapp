"""Genera o renueva token.json para usar Google Drive/Sheets en ElectroGV Web Tools.

Modo laptop recomendado:
  1) Guardar credentials.local.json en backend/storage/private/credentials.local.json
     o definir GOOGLE_CREDENTIALS_FILE en backend/.env.
  2) Ejecutar desde backend:
       python scripts/google_oauth_bootstrap.py
  3) Autorizar en el navegador.

El token se guarda en backend/storage/private/token.json
salvo que definas GOOGLE_TOKEN_FILE en backend/.env.
"""
from __future__ import annotations

import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402
from app.google_auth import local_credentials_file, write_stable_token  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

settings = get_settings()
credentials = local_credentials_file()

if not credentials.exists():
    raise SystemExit(
        "No encontré credentials.local.json.\n"
        f"Ruta recomendada: {settings.google_credentials_file}\n"
        f"Ruta vieja compatible: {settings.legacy_credentials_file}\n"
        "También podés cargarlo desde el panel SUPERADMIN → Google."
    )

flow = InstalledAppFlow.from_client_secrets_file(str(credentials), SCOPES)
creds = flow.run_local_server(
    host="localhost",
    port=0,
    open_browser=True,
    prompt="consent",
    access_type="offline",
    authorization_prompt_message="Autorizá ElectroGV Web Tools en el navegador.",
    success_message="Autorización completada. Ya podés cerrar esta pestaña.",
)
write_stable_token(creds.to_json())
print(f"Credentials usado: {credentials}")
print(f"Token guardado en: {settings.google_token_file}")
