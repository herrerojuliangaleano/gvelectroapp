from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .config import get_settings
from .permissions import DEFAULT_ROLES, has_permission, normalize_role
from .security import hash_password, verify_password

_store_lock = threading.RLock()


def _db_connect() -> sqlite3.Connection:
    settings = get_settings()
    settings.ensure_dirs()
    conn = sqlite3.connect(settings.database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _db_ready(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("SELECT 1 FROM branches LIMIT 1")
        return True
    except Exception:
        return False


def _normalize_branch_token(value: str) -> str:
    raw = str(value or "").upper()
    # Soporta textos viejos tipo "1 - CANNING", "Canning WEB" o "CANNING_WEB".
    raw = re.sub(r"^\s*\d+\s*[-.]\s*", "", raw)
    raw = raw.replace("Á", "A").replace("É", "E").replace("Í", "I").replace("Ó", "O").replace("Ú", "U").replace("Ñ", "N")
    return re.sub(r"[^A-Z0-9]+", "", raw)


def _row_to_branch_assignment(row: sqlite3.Row, is_primary: bool = False) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"],
        "type": row["type"],
        "company_id": row["company_id"],
        "company_name": row["company_name"] or "",
        "parent_branch_id": row["parent_branch_id"],
        "parent_branch_name": row["parent_branch_name"] or "",
        "is_primary": bool(is_primary),
    }


def _fetch_branch_rows(branch_ids: list[str]) -> dict[str, sqlite3.Row]:
    clean = [str(b).strip() for b in branch_ids if str(b or "").strip()]
    if not clean:
        return {}
    try:
        with _db_connect() as conn:
            if not _db_ready(conn):
                return {}
            placeholders = ",".join("?" for _ in clean)
            rows = conn.execute(
                f"""
                SELECT b.*, c.name AS company_name, parent.name AS parent_branch_name
                FROM branches b
                LEFT JOIN companies c ON c.id = b.company_id
                LEFT JOIN branches parent ON parent.id = b.parent_branch_id
                WHERE b.id IN ({placeholders})
                """,
                clean,
            ).fetchall()
            return {row["id"]: row for row in rows}
    except Exception:
        return {}


def _branch_is_web_candidate(row: sqlite3.Row) -> bool:
    name_token = _normalize_branch_token(str(row["name"] or ""))
    code_token = _normalize_branch_token(str(row["code"] or ""))
    return str(row["type"] or "").lower() == "web" or name_token.endswith("WEB") or code_token.endswith("WEB")


def _guess_branch_id_from_legacy(sucursal: str, role: str = "") -> str:
    token = _normalize_branch_token(sucursal)
    if not token:
        return ""

    prefer_web = "WEB" in token or "WEB" in _normalize_branch_token(role)

    try:
        with _db_connect() as conn:
            if not _db_ready(conn):
                return ""
            rows = conn.execute("SELECT id, name, code, type, parent_branch_id FROM branches WHERE is_active = 1").fetchall()
    except Exception:
        return ""

    exact_matches: list[sqlite3.Row] = []
    soft_matches: list[sqlite3.Row] = []
    for row in rows:
        row_tokens = {
            _normalize_branch_token(str(row["id"] or "")),
            _normalize_branch_token(str(row["name"] or "")),
            _normalize_branch_token(str(row["code"] or "")),
        }
        if token in row_tokens:
            exact_matches.append(row)
            continue

        # Si el texto viejo era "CANNING" y el rol es vendedor web, buscamos también "Canning - WEB".
        if prefer_web:
            base_tokens = {value.removesuffix("WEB") for value in row_tokens}
            if token in base_tokens:
                soft_matches.append(row)
        else:
            # Para textos viejos con espacios/guiones raros, permitimos coincidencia parcial conservadora.
            if any(value and (token == value or token in value or value in token) for value in row_tokens):
                soft_matches.append(row)

    candidates = (exact_matches + soft_matches) if prefer_web else (exact_matches or soft_matches)
    if not candidates:
        return ""
    if prefer_web:
        web = [row for row in candidates if _branch_is_web_candidate(row)]
        if web:
            return str(web[0]["id"])
    physical = [row for row in candidates if str(row["type"] or "").lower() == "physical"]
    return str((physical[0] if physical else candidates[0])["id"])

def _user_branch_rows_from_db(username: str) -> list[tuple[sqlite3.Row, bool]]:
    try:
        with _db_connect() as conn:
            if not _db_ready(conn):
                return []
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_branches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    is_primary INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    UNIQUE(username, branch_id),
                    FOREIGN KEY(branch_id) REFERENCES branches(id)
                )
                """
            )
            rows = conn.execute(
                """
                SELECT b.*, c.name AS company_name, parent.name AS parent_branch_name, ub.is_primary AS ub_is_primary
                FROM user_branches ub
                JOIN branches b ON b.id = ub.branch_id
                LEFT JOIN companies c ON c.id = b.company_id
                LEFT JOIN branches parent ON parent.id = b.parent_branch_id
                WHERE ub.username = ?
                ORDER BY ub.is_primary DESC, c.name COLLATE NOCASE, b.name COLLATE NOCASE
                """,
                (username,),
            ).fetchall()
            return [(row, bool(row["ub_is_primary"])) for row in rows]
    except Exception:
        return []


def _sync_user_branches(username: str, branch_ids: list[str], primary_branch_id: str = "") -> None:
    clean: list[str] = []
    seen: set[str] = set()
    for branch_id in branch_ids:
        branch_id = str(branch_id or "").strip()
        if branch_id and branch_id not in seen:
            clean.append(branch_id)
            seen.add(branch_id)
    primary = primary_branch_id if primary_branch_id in seen else (clean[0] if clean else "")
    try:
        with _db_connect() as conn:
            if not _db_ready(conn):
                return
            rows = _fetch_branch_rows(clean)
            valid = [branch_id for branch_id in clean if branch_id in rows]
            primary = primary if primary in valid else (valid[0] if valid else "")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_branches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    is_primary INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    UNIQUE(username, branch_id),
                    FOREIGN KEY(branch_id) REFERENCES branches(id)
                )
                """
            )
            conn.execute("DELETE FROM user_branches WHERE username = ?", (username,))
            now = datetime.now(timezone.utc).isoformat()
            for branch_id in valid:
                conn.execute(
                    "INSERT OR REPLACE INTO user_branches (username, branch_id, is_primary, created_at) VALUES (?, ?, ?, ?)",
                    (username, branch_id, 1 if branch_id == primary else 0, now),
                )
            conn.commit()
    except Exception:
        # No bloqueamos la creación de usuarios si la DB todavía no está inicializada.
        return


def _branch_assignments_for_record(record: "UserRecord") -> list[dict[str, Any]]:
    db_rows = _user_branch_rows_from_db(record.username)
    if db_rows:
        assignments = [_row_to_branch_assignment(row, is_primary) for row, is_primary in db_rows]
        if assignments and not any(item.get("is_primary") for item in assignments):
            assignments[0]["is_primary"] = True
        return assignments

    branch_ids: list[str] = []
    for branch_id in [record.branch_id, *record.branch_ids]:
        branch_id = str(branch_id or "").strip()
        if branch_id and branch_id not in branch_ids:
            branch_ids.append(branch_id)
    if not branch_ids and record.sucursal:
        guessed = _guess_branch_id_from_legacy(record.sucursal, record.role)
        if guessed:
            branch_ids.append(guessed)

    rows = _fetch_branch_rows(branch_ids)
    result: list[dict[str, Any]] = []
    for index, branch_id in enumerate(branch_ids):
        row = rows.get(branch_id)
        if row:
            result.append(_row_to_branch_assignment(row, is_primary=(branch_id == record.branch_id or (not record.branch_id and index == 0))))
    if result and not any(item["is_primary"] for item in result):
        result[0]["is_primary"] = True
    return result


def _ensure_user_roles_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            UNIQUE(username, role)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_roles_username ON user_roles(username)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role)")


def _clean_role_keys(role_keys: list[str], roles_catalog: dict[str, dict[str, Any]] | None = None) -> list[str]:
    catalog = roles_catalog or load_roles()
    clean: list[str] = []
    for raw in role_keys:
        role = normalize_role(str(raw or ""))
        if role and role in catalog and role not in clean:
            clean.append(role)
    return clean


def _user_roles_from_db(username: str) -> list[str]:
    try:
        with _db_connect() as conn:
            _ensure_user_roles_table(conn)
            rows = conn.execute(
                """
                SELECT role, is_primary
                FROM user_roles
                WHERE username = ?
                ORDER BY is_primary DESC, role COLLATE NOCASE
                """,
                (username,),
            ).fetchall()
            return [normalize_role(str(row["role"] or "")) for row in rows if str(row["role"] or "").strip()]
    except Exception:
        return []


def _sync_user_roles(username: str, role_keys: list[str], primary_role: str = "") -> list[str]:
    roles_catalog = load_roles()
    clean = _clean_role_keys(role_keys, roles_catalog)
    primary = normalize_role(primary_role)
    if primary and primary in roles_catalog and primary not in clean:
        clean.insert(0, primary)
    if not clean and primary and primary in roles_catalog:
        clean = [primary]
    if not clean:
        clean = ["VENDEDOR"] if "VENDEDOR" in roles_catalog else list(roles_catalog.keys())[:1]
    primary = primary if primary in clean else clean[0]
    try:
        with _db_connect() as conn:
            _ensure_user_roles_table(conn)
            conn.execute("DELETE FROM user_roles WHERE username = ?", (username,))
            now = datetime.now(timezone.utc).isoformat()
            for role in clean:
                conn.execute(
                    "INSERT OR REPLACE INTO user_roles (username, role, is_primary, created_at) VALUES (?, ?, ?, ?)",
                    (username, role, 1 if role == primary else 0, now),
                )
            conn.commit()
    except Exception:
        pass
    return clean


def _roles_for_record(record: "UserRecord") -> list[str]:
    roles_catalog = load_roles()
    db_roles = _clean_role_keys(_user_roles_from_db(record.username), roles_catalog)
    source = db_roles or _clean_role_keys(list(record.roles or []), roles_catalog)
    primary = normalize_role(record.role)
    if primary and primary in roles_catalog and primary not in source:
        source.insert(0, primary)
    if not source and primary and primary in roles_catalog:
        source = [primary]
    if not source:
        source = ["VENDEDOR"] if "VENDEDOR" in roles_catalog else list(roles_catalog.keys())[:1]
    # El rol principal legacy queda primero para compatibilidad visual y de permisos antiguos.
    if primary in source:
        source = [primary] + [role for role in source if role != primary]
    return source


def _permissions_for_roles(role_keys: list[str], roles_catalog: dict[str, dict[str, Any]] | None = None) -> list[str]:
    catalog = roles_catalog or load_roles()
    permissions: list[str] = []
    for role in role_keys:
        info = catalog.get(normalize_role(role), {})
        for permission in info.get("permissions", []) or []:
            value = str(permission)
            if value == "*":
                return ["*"]
            if value and value not in permissions:
                permissions.append(value)
    return sorted(permissions)


def _ensure_employees_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            dni TEXT UNIQUE,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            personal_email TEXT NOT NULL DEFAULT '',
            position TEXT NOT NULL DEFAULT '',
            company_id TEXT NOT NULL DEFAULT '',
            branch_id TEXT NOT NULL DEFAULT '',
            photo_url TEXT NOT NULL DEFAULT '',
            photo_status TEXT NOT NULL DEFAULT 'sin_foto',
            status TEXT NOT NULL DEFAULT 'activo',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_username ON employees(username)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)")


def _clean_dni(value: str | None) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _split_display_name(value: str) -> tuple[str, str]:
    parts = [p for p in str(value or "").strip().split() if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def _employee_public_from_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    full_name = str(row["display_name"] or "").strip() or " ".join([str(row["first_name"] or "").strip(), str(row["last_name"] or "").strip()]).strip()
    return {
        "id": str(row["id"] or ""),
        "username": str(row["username"] or ""),
        "dni": str(row["dni"] or ""),
        "first_name": str(row["first_name"] or ""),
        "last_name": str(row["last_name"] or ""),
        "display_name": full_name,
        "phone": str(row["phone"] or ""),
        "personal_email": str(row["personal_email"] or ""),
        "position": str(row["position"] or ""),
        "company_id": str(row["company_id"] or ""),
        "company_name": str(row["company_name"] or ""),
        "branch_id": str(row["branch_id"] or ""),
        "branch_name": str(row["branch_name"] or ""),
        "branch_type": str(row["branch_type"] or ""),
        "photo_url": str(row["photo_url"] or ""),
        "photo_status": str(row["photo_status"] or "sin_foto"),
        "status": str(row["status"] or "activo"),
        "created_at": str(row["created_at"] or ""),
        "updated_at": str(row["updated_at"] or ""),
    }


def _fetch_employee_by_username(username: str) -> dict[str, Any] | None:
    try:
        with _db_connect() as conn:
            _ensure_employees_table(conn)
            row = conn.execute(
                """
                SELECT e.*, c.name AS company_name, b.name AS branch_name, b.type AS branch_type
                FROM employees e
                LEFT JOIN companies c ON c.id = e.company_id
                LEFT JOIN branches b ON b.id = e.branch_id
                WHERE e.username = ?
                """,
                (username,),
            ).fetchone()
            return _employee_public_from_row(row)
    except Exception:
        return None


def _employee_defaults_from_user(record: "UserRecord") -> dict[str, Any]:
    first, last = _split_display_name(record.display_name)
    return {
        "first_name": first,
        "last_name": last,
        "display_name": record.display_name,
        "company_id": record.company_id,
        "branch_id": record.branch_id,
        "status": "activo" if record.is_active else "inactivo",
    }


def upsert_employee_for_user(username: str, payload: dict[str, Any] | None = None, user_record: "UserRecord" | None = None) -> dict[str, Any] | None:
    data = dict(payload or {})
    if user_record is not None:
        defaults = _employee_defaults_from_user(user_record)
        for key, value in defaults.items():
            if not str(data.get(key) or "").strip():
                data[key] = value

    dni = _clean_dni(data.get("dni"))
    first_name = str(data.get("first_name") or "").strip()
    last_name = str(data.get("last_name") or "").strip()
    display_name = str(data.get("display_name") or "").strip() or " ".join([first_name, last_name]).strip() or (user_record.display_name if user_record else username)
    if not first_name and not last_name:
        first_name, last_name = _split_display_name(display_name)

    try:
        with _db_connect() as conn:
            _ensure_employees_table(conn)
            now = datetime.now(timezone.utc).isoformat()
            existing = conn.execute("SELECT * FROM employees WHERE username = ?", (username,)).fetchone()
            employee_id = str(existing["id"] if existing else data.get("id") or uuid.uuid4())
            dni_value: str | None = dni or None
            if dni_value:
                duplicate = conn.execute("SELECT username FROM employees WHERE dni = ? AND username IS NOT ?", (dni_value, username)).fetchone()
                if duplicate:
                    raise ValueError(f"El DNI {dni_value} ya está asignado a otro empleado")
            fields = {
                "id": employee_id,
                "username": username,
                "dni": dni_value,
                "first_name": first_name,
                "last_name": last_name,
                "display_name": display_name,
                "phone": str(data.get("phone") or "").strip(),
                "personal_email": str(data.get("personal_email") or "").strip(),
                "position": str(data.get("position") or "").strip(),
                "company_id": str(data.get("company_id") or "").strip(),
                "branch_id": str(data.get("branch_id") or "").strip(),
                "photo_url": str(data.get("photo_url") or (existing["photo_url"] if existing else "") or "").strip(),
                "photo_status": str(data.get("photo_status") or (existing["photo_status"] if existing else "sin_foto") or "sin_foto").strip(),
                "status": str(data.get("status") or ("activo" if (user_record.is_active if user_record else True) else "inactivo")).strip(),
                "created_at": str(existing["created_at"] if existing else now),
                "updated_at": now,
            }
            conn.execute(
                """
                INSERT INTO employees (id, username, dni, first_name, last_name, display_name, phone, personal_email, position, company_id, branch_id, photo_url, photo_status, status, created_at, updated_at)
                VALUES (:id, :username, :dni, :first_name, :last_name, :display_name, :phone, :personal_email, :position, :company_id, :branch_id, :photo_url, :photo_status, :status, :created_at, :updated_at)
                ON CONFLICT(username) DO UPDATE SET
                    dni=excluded.dni, first_name=excluded.first_name, last_name=excluded.last_name, display_name=excluded.display_name,
                    phone=excluded.phone, personal_email=excluded.personal_email, position=excluded.position, company_id=excluded.company_id, branch_id=excluded.branch_id,
                    photo_url=excluded.photo_url, photo_status=excluded.photo_status, status=excluded.status, updated_at=excluded.updated_at
                """,
                fields,
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT e.*, c.name AS company_name, b.name AS branch_name, b.type AS branch_type
                FROM employees e
                LEFT JOIN companies c ON c.id = e.company_id
                LEFT JOIN branches b ON b.id = e.branch_id
                WHERE e.username = ?
                """,
                (username,),
            ).fetchone()
            return _employee_public_from_row(row)
    except sqlite3.IntegrityError as exc:
        raise ValueError("No se pudo guardar el empleado. Revisá que el DNI no esté repetido.") from exc


def repair_user_employees() -> dict[str, int]:
    with _store_lock:
        users = load_users()
        created = 0
        updated = 0
        total = 0
        for record in users.values():
            total += 1
            before = _fetch_employee_by_username(record.username)
            payload = _employee_defaults_from_user(record)
            if before:
                # Conservamos datos sensibles/manuales como DNI, teléfono y puesto; solo completamos organización si falta.
                payload.update({
                    "dni": before.get("dni") or "",
                    "first_name": before.get("first_name") or payload.get("first_name") or "",
                    "last_name": before.get("last_name") or payload.get("last_name") or "",
                    "display_name": before.get("display_name") or payload.get("display_name") or "",
                    "phone": before.get("phone") or "",
                    "personal_email": before.get("personal_email") or "",
                    "position": before.get("position") or "",
                    "company_id": before.get("company_id") or payload.get("company_id") or "",
                    "branch_id": before.get("branch_id") or payload.get("branch_id") or "",
                    "photo_url": before.get("photo_url") or "",
                    "photo_status": before.get("photo_status") or "sin_foto",
                    "status": "activo" if record.is_active else "inactivo",
                })
                updated += 1
            else:
                created += 1
            upsert_employee_for_user(record.username, payload, record)
        return {"created": created, "updated": updated, "total": total}


@dataclass
class UserRecord:
    username: str
    display_name: str
    role: str
    sucursal: str = ""
    company_id: str = ""
    branch_id: str = ""
    branch_ids: list[str] = field(default_factory=list)
    roles: list[str] = field(default_factory=list)
    password_hash: str = ""
    is_active: bool = True
    must_change_password: bool = False

    def public(self) -> dict[str, Any]:
        branches = _branch_assignments_for_record(self)
        primary = next((b for b in branches if b.get("is_primary")), branches[0] if branches else None)
        sucursal = primary["name"] if primary else self.sucursal
        roles = _roles_for_record(self)
        employee = _fetch_employee_by_username(self.username)
        return {
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "roles": roles,
            "sucursal": sucursal,
            "company_id": primary["company_id"] if primary else self.company_id,
            "company_name": primary["company_name"] if primary else "",
            "branch_id": primary["id"] if primary else self.branch_id,
            "branch_name": primary["name"] if primary else "",
            "branch_code": primary["code"] if primary else "",
            "branch_type": primary["type"] if primary else "",
            "branches": branches,
            "branch_ids": [b["id"] for b in branches] if branches else list(self.branch_ids),
            "employee": employee,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password or not bool(self.password_hash),
        }


@dataclass
class CurrentUser:
    username: str
    display_name: str
    role: str
    roles: list[str]
    permissions: list[str]
    sucursal: str = ""
    company_id: str = ""
    company_name: str = ""
    branch_id: str = ""
    branch_name: str = ""
    branch_code: str = ""
    branch_type: str = ""
    branches: list[dict[str, Any]] = field(default_factory=list)
    branch_ids: list[str] = field(default_factory=list)
    employee: dict[str, Any] | None = None
    is_active: bool = True
    must_change_password: bool = False

    def has(self, permission: str) -> bool:
        return has_permission(self.permissions, permission)

    def public(self) -> dict[str, Any]:
        return {
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "roles": self.roles,
            "sucursal": self.sucursal,
            "company_id": self.company_id,
            "company_name": self.company_name,
            "branch_id": self.branch_id,
            "branch_name": self.branch_name,
            "branch_code": self.branch_code,
            "branch_type": self.branch_type,
            "branches": self.branches,
            "branch_ids": self.branch_ids,
            "employee": self.employee,
            "permissions": self.permissions,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password,
        }


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def ensure_auth_files() -> None:
    settings = get_settings()
    settings.ensure_dirs()
    with _store_lock:
        if not settings.roles_file.exists():
            _write_json(settings.roles_file, {"roles": DEFAULT_ROLES})
        else:
            data = _read_json(settings.roles_file, {"roles": {}})
            roles = data.setdefault("roles", {})
            changed = False
            for role, info in DEFAULT_ROLES.items():
                if role not in roles:
                    roles[role] = info
                    changed = True
                    continue
                current = roles.get(role) if isinstance(roles.get(role), dict) else {}
                current_permissions = current.setdefault("permissions", [])
                if role in ("DEPOSITO", "CADETE_DEPOSITO") and isinstance(current_permissions, list) and "*" not in current_permissions:
                    # Roles de depósito: mantener permisos Y label sincronizados exactamente con DEFAULT_ROLES.
                    target_permissions = list(info.get("permissions", []))
                    if current_permissions != target_permissions:
                        current["permissions"] = target_permissions
                        changed = True
                    # Forzar label actualizado (ej: "Depósito" → "Encargado de Depósito")
                    target_label = info.get("label", role) if isinstance(info, dict) else role
                    if current.get("label") != target_label:
                        current["label"] = target_label
                        changed = True
                elif isinstance(current_permissions, list) and "*" not in current_permissions:
                    for permission in info.get("permissions", []):
                        if permission not in current_permissions:
                            current_permissions.append(permission)
                            changed = True
                if not current.get("label") and isinstance(info, dict):
                    current["label"] = info.get("label", role)
                    changed = True
                if not current.get("level") and isinstance(info, dict):
                    current["level"] = info.get("level", 0)
                    changed = True
                roles[role] = current
            if changed:
                _write_json(settings.roles_file, data)

        if not settings.users_file.exists():
            password = settings.admin_password if settings.admin_password != "cambiar-esta-clave" else "admin"
            _write_json(
                settings.users_file,
                {
                    "users": [
                        {
                            "username": settings.admin_user,
                            "display_name": "Administrador",
                            "role": "SUPERADMIN",
                            "roles": ["SUPERADMIN"],
                            "sucursal": "",
                            "company_id": "",
                            "branch_id": "",
                            "branch_ids": [],
                            "password_hash": hash_password(password),
                            "is_active": True,
                            "must_change_password": False,
                        }
                    ]
                },
            )


def load_roles() -> dict[str, dict[str, Any]]:
    ensure_auth_files()
    data = _read_json(get_settings().roles_file, {"roles": DEFAULT_ROLES})
    roles = data.get("roles", {}) if isinstance(data, dict) else {}
    normalized: dict[str, dict[str, Any]] = {}
    for key, info in roles.items():
        role = normalize_role(key)
        if not isinstance(info, dict):
            continue
        perms = info.get("permissions", [])
        if not isinstance(perms, list):
            perms = []
        normalized[role] = {
            "label": str(info.get("label") or role),
            "level": int(info.get("level") or 0),
            "permissions": [str(p) for p in perms],
        }
    return normalized


def save_roles(roles: dict[str, dict[str, Any]]) -> None:
    from .permissions import ALL_PERMISSIONS

    clean: dict[str, dict[str, Any]] = {}
    for role, info in roles.items():
        key = normalize_role(role)
        permissions = info.get("permissions", []) if isinstance(info, dict) else []
        clean[key] = {
            "label": str(info.get("label") or key) if isinstance(info, dict) else key,
            "level": int(info.get("level") or 0) if isinstance(info, dict) else 0,
            "permissions": [str(p) for p in permissions if str(p) in ALL_PERMISSIONS or str(p) == "*"],
        }
    _write_json(get_settings().roles_file, {"roles": clean})


def load_users() -> dict[str, UserRecord]:
    ensure_auth_files()
    data = _read_json(get_settings().users_file, {"users": []})
    raw_users = data.get("users", []) if isinstance(data, dict) else []
    users: dict[str, UserRecord] = {}
    for item in raw_users:
        if not isinstance(item, dict):
            continue
        username = str(item.get("username") or "").strip()
        if not username:
            continue
        password_hash = str(item.get("password_hash") or "")
        must_change_password = bool(item.get("must_change_password", False)) or not bool(password_hash)
        raw_branch_ids = item.get("branch_ids", [])
        if not isinstance(raw_branch_ids, list):
            raw_branch_ids = []
        raw_roles = item.get("roles", [])
        if not isinstance(raw_roles, list):
            raw_roles = []
        primary_role = normalize_role(str(item.get("role") or "VENDEDOR"))
        role_keys = _clean_role_keys([primary_role, *[str(r) for r in raw_roles]])
        users[username] = UserRecord(
            username=username,
            display_name=str(item.get("display_name") or username),
            role=primary_role,
            roles=role_keys,
            sucursal=str(item.get("sucursal") or "").strip(),
            company_id=str(item.get("company_id") or "").strip(),
            branch_id=str(item.get("branch_id") or "").strip(),
            branch_ids=[str(b).strip() for b in raw_branch_ids if str(b or "").strip()],
            password_hash=password_hash,
            is_active=bool(item.get("is_active", True)),
            must_change_password=must_change_password,
        )
    return users


def save_users(users: dict[str, UserRecord]) -> None:
    ordered = sorted(users.values(), key=lambda user: user.username.lower())
    _write_json(get_settings().users_file, {"users": [asdict(user) for user in ordered]})


def repair_user_branch_links() -> dict[str, int]:
    """Repara vínculos viejos de usuarios contra la nueva estructura de sucursales.

    Es intencionalmente conservador: solo completa branch_id/branch_ids cuando puede
    resolver una sucursal real. También sincroniza la tabla user_branches, que es la
    fuente nueva para alcance operativo multi-sucursal.
    """
    with _store_lock:
        users = load_users()
        changed = 0
        synced = 0
        for username, record in users.items():
            branch_ids: list[str] = []
            for branch_id in [record.branch_id, *record.branch_ids]:
                branch_id = str(branch_id or "").strip()
                if branch_id and branch_id not in branch_ids:
                    branch_ids.append(branch_id)

            valid = _valid_branch_ids(branch_ids)
            primary = record.branch_id if record.branch_id in valid else (valid[0] if valid else "")

            if not valid and record.sucursal:
                guessed = _guess_branch_id_from_legacy(record.sucursal, record.role)
                if guessed:
                    valid = [guessed]
                    primary = guessed

            if valid:
                rows = _fetch_branch_rows([primary]) if primary else {}
                primary_row = rows.get(primary) if primary else None
                new_sucursal = str(primary_row["name"] if primary_row else record.sucursal or "").strip()
                new_company_id = str(primary_row["company_id"] if primary_row else record.company_id or "").strip()

                if record.branch_id != primary or record.branch_ids != valid or record.sucursal != new_sucursal or record.company_id != new_company_id:
                    record.branch_id = primary
                    record.branch_ids = valid
                    record.sucursal = new_sucursal
                    record.company_id = new_company_id
                    changed += 1
                _sync_user_branches(username, valid, primary)
                synced += 1

        if changed:
            save_users(users)
        return {"changed": changed, "synced": synced, "total": len(users)}


def repair_user_legacy_roles() -> dict[str, int]:
    """Sincroniza roles viejos contra el sistema nuevo de múltiples roles.

    Mantiene users.role como rol principal/legacy, crea registros en user_roles y,
    si aparece un rol heredado desconocido, lo conserva en el catálogo con permisos
    mínimos para que no desaparezca visualmente del panel.
    """
    with _store_lock:
        users = load_users()
        roles_catalog = load_roles()
        created_roles = 0
        changed_users = 0
        synced = 0

        # Alias seguros para nombres viejos frecuentes. No renombramos el rol del usuario:
        # solo evitamos que quede fuera del catálogo y sin permisos efectivos.
        fallback_permissions = ["profile.view", "about.view", "system.status.view"]
        for record in users.values():
            primary = normalize_role(record.role or "VENDEDOR")
            if primary and primary not in roles_catalog:
                roles_catalog[primary] = {
                    "label": f"Rol heredado: {primary}",
                    "level": 0,
                    "permissions": fallback_permissions[:],
                }
                created_roles += 1
                save_roles(roles_catalog)

            cleaned = _clean_role_keys([primary, *list(record.roles or []), *_user_roles_from_db(record.username)], roles_catalog)
            if primary and primary in roles_catalog and primary not in cleaned:
                cleaned.insert(0, primary)
            if not cleaned:
                cleaned = ["VENDEDOR"] if "VENDEDOR" in roles_catalog else list(roles_catalog.keys())[:1]
                primary = cleaned[0]

            if primary and cleaned[0] != primary and primary in cleaned:
                cleaned = [primary] + [role for role in cleaned if role != primary]

            if record.role != primary or record.roles != cleaned:
                record.role = primary
                record.roles = cleaned
                changed_users += 1

            _sync_user_roles(record.username, cleaned, primary)
            synced += 1

        if created_roles:
            save_roles(roles_catalog)
        if changed_users:
            save_users(users)
        return {"created_roles": created_roles, "changed_users": changed_users, "synced": synced, "total": len(users)}


def get_user(username: str) -> UserRecord | None:
    return load_users().get(username)


def get_employee_by_username(username: str) -> dict[str, Any] | None:
    return _fetch_employee_by_username(username)


def set_employee_photo(username: str, photo_url: str, photo_status: str = "pendiente_aprobacion") -> dict[str, Any]:
    record = get_user(username)
    if not record:
        raise ValueError("Usuario no encontrado")
    current = _fetch_employee_by_username(username) or {}
    payload = dict(current)
    payload["photo_url"] = str(photo_url or "").strip()
    payload["photo_status"] = str(photo_status or "pendiente_aprobacion").strip()
    payload.setdefault("display_name", record.display_name)
    payload.setdefault("company_id", record.company_id)
    payload.setdefault("branch_id", record.branch_id)
    employee = upsert_employee_for_user(username, payload, record)
    if not employee:
        raise ValueError("No se pudo actualizar la foto del empleado")
    return employee


def set_employee_photo_status(username: str, photo_status: str) -> dict[str, Any]:
    record = get_user(username)
    if not record:
        raise ValueError("Usuario no encontrado")
    current = _fetch_employee_by_username(username)
    if not current:
        current = upsert_employee_for_user(username, {}, record)
    payload = dict(current or {})
    payload["photo_status"] = str(photo_status or "sin_foto").strip()
    employee = upsert_employee_for_user(username, payload, record)
    if not employee:
        raise ValueError("No se pudo actualizar el estado de foto")
    return employee


def get_current_user(username: str) -> CurrentUser | None:
    user = get_user(username)
    if not user or not user.is_active:
        return None
    roles_catalog = load_roles()
    role_keys = _roles_for_record(user)
    permissions = _permissions_for_roles(role_keys, roles_catalog)
    public = user.public()
    return CurrentUser(
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        roles=role_keys,
        permissions=[str(p) for p in permissions],
        sucursal=str(public.get("sucursal") or ""),
        company_id=str(public.get("company_id") or ""),
        company_name=str(public.get("company_name") or ""),
        branch_id=str(public.get("branch_id") or ""),
        branch_name=str(public.get("branch_name") or ""),
        branch_code=str(public.get("branch_code") or ""),
        branch_type=str(public.get("branch_type") or ""),
        branches=list(public.get("branches") or []),
        branch_ids=list(public.get("branch_ids") or []),
        employee=public.get("employee") if isinstance(public.get("employee"), dict) else None,
        is_active=user.is_active,
        must_change_password=user.must_change_password or not bool(user.password_hash),
    )


def authenticate_user(username: str, password: str) -> CurrentUser | None:
    user = get_user(username)
    if not user or not user.is_active:
        return None
    if not user.password_hash:
        if password != "":
            return None
        return get_current_user(user.username)
    if not verify_password(password, user.password_hash):
        return None
    return get_current_user(user.username)


def _valid_branch_ids(branch_ids: list[str]) -> list[str]:
    rows = _fetch_branch_rows(branch_ids)
    return [branch_id for branch_id in branch_ids if branch_id in rows]


def upsert_user(
    username: str,
    display_name: str,
    role: str,
    is_active: bool = True,
    password: str | None = None,
    sucursal: str | None = None,
    company_id: str | None = None,
    branch_id: str | None = None,
    branch_ids: list[str] | None = None,
    role_keys: list[str] | None = None,
    employee: dict[str, Any] | None = None,
) -> UserRecord:
    username = username.strip()
    if not username:
        raise ValueError("El usuario es obligatorio")
    role = normalize_role(role)
    roles_catalog = load_roles()
    if role not in roles_catalog:
        raise ValueError(f"Rol inexistente: {role}")
    selected_roles = _clean_role_keys([role, *[str(r) for r in (role_keys or [])]], roles_catalog)
    if not selected_roles:
        selected_roles = [role]
    if role not in selected_roles:
        selected_roles.insert(0, role)

    with _store_lock:
        users = load_users()
        existing = users.get(username)
        if existing is None:
            password_hash = hash_password(password) if password else ""
            must_change_password = not bool(password)
            old_branch_ids: list[str] = []
            old_branch_id = ""
            old_company_id = ""
            old_sucursal = ""
            old_roles = selected_roles[:]
        else:
            password_hash = hash_password(password) if password else existing.password_hash
            must_change_password = existing.must_change_password if not password else False
            old_branch_ids = list(existing.branch_ids)
            old_branch_id = existing.branch_id
            old_company_id = existing.company_id
            old_sucursal = existing.sucursal
            old_roles = _roles_for_record(existing)

        if role_keys is None and existing is not None:
            selected_roles = [role] + [old_role for old_role in old_roles if old_role != role]
        role = selected_roles[0]

        selected_branch_ids: list[str]
        if branch_ids is not None:
            selected_branch_ids = [str(b).strip() for b in branch_ids if str(b or "").strip()]
        else:
            selected_branch_ids = old_branch_ids[:]
        selected_primary = str(branch_id or old_branch_id or "").strip()
        if selected_primary and selected_primary not in selected_branch_ids:
            selected_branch_ids.insert(0, selected_primary)
        if not selected_branch_ids and sucursal:
            guessed = _guess_branch_id_from_legacy(sucursal, role)
            if guessed:
                selected_branch_ids = [guessed]
                selected_primary = guessed
        valid = _valid_branch_ids(selected_branch_ids)
        if selected_branch_ids and not valid:
            raise ValueError("Las sucursales seleccionadas no existen o están mal configuradas")
        if selected_primary and selected_primary not in valid:
            selected_primary = valid[0] if valid else ""

        rows = _fetch_branch_rows([selected_primary]) if selected_primary else {}
        primary_row = rows.get(selected_primary) if selected_primary else None
        final_sucursal = primary_row["name"] if primary_row else str(sucursal if sucursal is not None else old_sucursal).strip()
        final_company_id = primary_row["company_id"] if primary_row else str(company_id if company_id is not None else old_company_id).strip()

        users[username] = UserRecord(
            username=username,
            display_name=display_name.strip() or username,
            role=role,
            roles=selected_roles,
            sucursal=final_sucursal,
            company_id=final_company_id,
            branch_id=selected_primary,
            branch_ids=valid,
            password_hash=password_hash,
            is_active=is_active,
            must_change_password=must_change_password,
        )
        save_users(users)
        _sync_user_branches(username, valid, selected_primary)
        _sync_user_roles(username, selected_roles, role)
        employee_payload = dict(employee or {})
        if employee is not None or get_settings().database_path:
            employee_payload.setdefault("company_id", final_company_id)
            employee_payload.setdefault("branch_id", selected_primary)
            employee_payload.setdefault("display_name", display_name.strip() or username)
            upsert_employee_for_user(username, employee_payload, users[username])
        return users[username]


def set_user_active(username: str, is_active: bool) -> UserRecord:
    with _store_lock:
        users = load_users()
        if username not in users:
            raise ValueError("Usuario no encontrado")
        users[username].is_active = is_active
        save_users(users)
        try:
            current_employee = _fetch_employee_by_username(username)
            if current_employee:
                current_employee["status"] = "activo" if is_active else "inactivo"
                upsert_employee_for_user(username, current_employee, users[username])
        except Exception:
            pass
        return users[username]


def reset_user_password(username: str) -> UserRecord:
    with _store_lock:
        users = load_users()
        if username not in users:
            raise ValueError("Usuario no encontrado")
        users[username].password_hash = ""
        users[username].must_change_password = True
        save_users(users)
        return users[username]


def delete_user(username: str) -> None:
    with _store_lock:
        users = load_users()
        if username not in users:
            raise ValueError("Usuario no encontrado")
        del users[username]
        save_users(users)
        try:
            with _db_connect() as conn:
                _ensure_employees_table(conn)
                conn.execute("UPDATE employees SET username = NULL, status = 'inactivo', updated_at = ? WHERE username = ?", (datetime.now(timezone.utc).isoformat(), username))
                conn.execute("DELETE FROM user_branches WHERE username = ?", (username,))
                try:
                    _ensure_user_roles_table(conn)
                    conn.execute("DELETE FROM user_roles WHERE username = ?", (username,))
                except Exception:
                    pass
                conn.commit()
        except Exception:
            pass


def set_own_password(username: str, new_password: str) -> UserRecord:
    password = (new_password or "").strip()
    if len(password) < 6:
        raise ValueError("La contraseña debe tener al menos 6 caracteres")
    with _store_lock:
        users = load_users()
        if username not in users:
            raise ValueError("Usuario no encontrado")
        users[username].password_hash = hash_password(password)
        users[username].must_change_password = False
        save_users(users)
        return users[username]
