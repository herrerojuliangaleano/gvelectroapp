from __future__ import annotations

import getpass
import sys
from pathlib import Path

# Permite ejecutar: python backend/scripts/create_user.py desde raíz o python scripts/create_user.py desde backend
CURRENT = Path(__file__).resolve()
BACKEND_DIR = CURRENT.parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.users import load_roles, upsert_user  # noqa: E402


def main() -> int:
    print("Crear / actualizar usuario ElectroGV")
    roles = load_roles()
    print("Roles disponibles:", ", ".join(roles.keys()))
    username = input("Usuario corto (ej: cchaparro): ").strip()
    display_name = input("Nombre visible (ej: Claudio Chaparro): ").strip()
    role = input("Rol: ").strip().upper()
    password = getpass.getpass("Contraseña nueva (vacío si ya existe y no querés cambiarla): ") or None
    try:
        user = upsert_user(username, display_name, role, True, password)
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1
    print("OK usuario guardado:", user.public())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
