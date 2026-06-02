"""Capa Postgres-backed para empleados (Fase 2.5b).

Reemplaza las consultas SQLite de `users.py` (employees, employee_status_history,
helpers de foto y vínculo usuario↔empleado). Expone funciones con la **misma
forma de payload** que la versión legacy para no romper los routers.

Solo cubre el dominio HR: employees + status_history + helpers de foto y vínculo.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from .db import db_session
from .models.auth import User
from .models.employees import Employee, EmployeeStatusHistory


# ── Constantes y helpers ─────────────────────────────────────────────────────

EMPLOYEE_STATUSES = {"alta", "licencia", "baja"}
EMPLOYEE_STATUS_ALIASES = {"activo": "alta", "inactivo": "baja", "": "alta"}


def _normalize_emp_status(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if raw in EMPLOYEE_STATUSES:
        return raw
    return EMPLOYEE_STATUS_ALIASES.get(raw, raw or "alta")


def _clean_dni(value: str | None) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _split_display_name(value: str) -> tuple[str, str]:
    parts = [p for p in str(value or "").strip().split() if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def _parse_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except Exception:
        return None


def _fmt_date(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _fmt_dt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


# Campos editables vía `update_employee_by_id` (no incluye dni — se valida aparte).
_EMP_EDITABLE_FIELDS = (
    "first_name", "last_name", "display_name", "phone", "personal_email", "position",
    "department", "address", "gender", "civil_status", "contract_type",
    "manager_employee_id", "company_id", "branch_id", "work_branch_id",
)
_EMP_DATE_FIELDS = ("birthdate", "hire_date")


def _user_summary(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "username": user.username,
        "display_name": user.display_name,
        "role": "",      # se resuelve en users_db.get_user_pg si hace falta
        "roles": [],
        "is_active": bool(user.is_active),
    }


def _employee_to_payload(emp: Employee) -> dict[str, Any]:
    """Forma del dict idéntica a la legacy SQLite para no romper consumers."""
    full_name = (emp.display_name or "").strip() or " ".join([
        (emp.first_name or "").strip(), (emp.last_name or "").strip(),
    ]).strip()
    user = emp.user
    company = emp.company
    branch = emp.branch
    work_branch = emp.work_branch

    payload = {
        "id": str(emp.id),
        "username": user.username if user else "",
        "dni": str(emp.dni or ""),
        "first_name": str(emp.first_name or ""),
        "last_name": str(emp.last_name or ""),
        "display_name": full_name,
        "phone": str(emp.phone or ""),
        "personal_email": str(emp.personal_email or ""),
        "position": str(emp.position or ""),
        "department": str(emp.department or ""),
        "address": str(emp.address or ""),
        "birthdate": _fmt_date(emp.birthdate),
        "gender": str(emp.gender or ""),
        "civil_status": str(emp.civil_status or ""),
        "contract_type": str(emp.contract_type or ""),
        "hire_date": _fmt_date(emp.hire_date),
        "manager_employee_id": str(emp.manager_id or "") if emp.manager_id else "",
        "company_id": str(emp.company_id or ""),
        "company_name": str(company.name) if company else "",
        "branch_id": str(emp.branch_id or ""),
        "branch_name": str(branch.name) if branch else "",
        "branch_type": str(branch.type) if branch else "",
        "work_branch_id": str(emp.work_branch_id or ""),
        "work_branch_name": str(work_branch.name) if work_branch else "",
        "photo_url": str(emp.photo_url or ""),
        "photo_status": str(emp.photo_status or "sin_foto"),
        "photo_uploaded_at": _fmt_dt(emp.photo_uploaded_at),
        "status": _normalize_emp_status(emp.status),
        "has_user": user is not None,
        "user": _user_summary(user),
        "created_at": _fmt_dt(emp.created_at),
        "updated_at": _fmt_dt(emp.updated_at),
    }
    return payload


# ── Lectura ──────────────────────────────────────────────────────────────────

def get_employee_by_id_pg(employee_id: str | int) -> dict[str, Any] | None:
    try:
        eid = int(str(employee_id).strip())
    except (TypeError, ValueError):
        return None
    with db_session() as session:
        emp = session.get(Employee, eid)
        return _employee_to_payload(emp) if emp else None


def get_employee_by_username_pg(username: str) -> dict[str, Any] | None:
    if not username:
        return None
    with db_session() as session:
        emp = session.scalar(
            select(Employee)
            .join(User, Employee.user_id == User.id)
            .where(User.username == str(username).strip().lower())
        )
        return _employee_to_payload(emp) if emp else None


def list_employees_pg(
    *,
    q: str = "",
    status: str = "",
    work_branch_id: str = "",
    has_user: str = "",
    limit: int = 500,
) -> list[dict[str, Any]]:
    q_key = re.sub(r"\s+", " ", str(q or "").strip().lower())
    status_key = _normalize_emp_status(status) if str(status or "").strip() else ""
    wb_key = str(work_branch_id or "").strip()
    hu_key = str(has_user or "").strip().lower()
    lim = max(1, int(limit or 500))

    with db_session() as session:
        stmt = select(Employee).order_by(Employee.last_name.asc(), Employee.first_name.asc())
        if status_key:
            stmt = stmt.where(Employee.status == status_key)
        if wb_key:
            stmt = stmt.where(Employee.work_branch_id == wb_key)
        if hu_key in {"true", "1", "yes", "si"}:
            stmt = stmt.where(Employee.user_id.is_not(None))
        elif hu_key in {"false", "0", "no"}:
            stmt = stmt.where(Employee.user_id.is_(None))

        rows = session.scalars(stmt).all()
        items = [_employee_to_payload(e) for e in rows]

    if q_key:
        toks = q_key.split(" ")

        def matches(emp: dict[str, Any]) -> bool:
            hay = " ".join([
                str(emp.get("display_name") or ""), str(emp.get("dni") or ""),
                str(emp.get("position") or ""), str(emp.get("username") or ""),
                str(emp.get("personal_email") or ""), str(emp.get("branch_name") or ""),
                str(emp.get("work_branch_name") or ""),
            ]).lower()
            return all(tok in hay for tok in toks)

        items = [e for e in items if matches(e)]

    return items[:lim]


def list_employee_status_history_pg(employee_id: str | int) -> list[dict[str, Any]]:
    try:
        eid = int(str(employee_id).strip())
    except (TypeError, ValueError):
        return []
    with db_session() as session:
        rows = session.scalars(
            select(EmployeeStatusHistory)
            .where(EmployeeStatusHistory.employee_id == eid)
            .order_by(EmployeeStatusHistory.created_at.desc(), EmployeeStatusHistory.id.desc())
        ).all()
        return [
            {
                "id": str(r.id),
                "status": str(r.status or ""),
                "previous_status": str(r.previous_status or ""),
                "motivo": str(r.motivo or ""),
                "categoria": str(r.categoria or ""),
                "fecha_desde": _fmt_date(r.fecha_desde),
                "fecha_hasta": _fmt_date(r.fecha_hasta),
                "observaciones": str(r.observaciones or ""),
                "actor_username": "",     # se resuelve en el router si hace falta
                "actor_name": "",
                "created_at": _fmt_dt(r.created_at),
            }
            for r in rows
        ]


# ── Escritura ────────────────────────────────────────────────────────────────

def _apply_payload_to_employee(emp: Employee, data: dict[str, Any]) -> None:
    """Aplica los campos editables del payload sobre un Employee existente."""
    for key in _EMP_EDITABLE_FIELDS:
        if key in data and data[key] is not None:
            setattr(emp, key, str(data[key]).strip())
    for key in _EMP_DATE_FIELDS:
        if key in data:
            setattr(emp, key, _parse_date(data[key]))


def create_standalone_employee_pg(payload: dict[str, Any], actor: Any = None) -> dict[str, Any]:
    data = dict(payload or {})
    dni = _clean_dni(data.get("dni"))
    first = str(data.get("first_name") or "").strip()
    last = str(data.get("last_name") or "").strip()
    display = str(data.get("display_name") or "").strip() or " ".join([first, last]).strip()
    if not display:
        raise ValueError("Indicá al menos el nombre del empleado")
    if not first and not last:
        first, last = _split_display_name(display)

    with db_session() as session:
        if dni and session.scalar(select(Employee).where(Employee.dni == dni)):
            raise ValueError(f"El DNI {dni} ya está asignado a otro empleado")
        emp = Employee(
            dni=dni or None,
            first_name=first,
            last_name=last,
            display_name=display,
            status=_normalize_emp_status(data.get("status")),
        )
        _apply_payload_to_employee(emp, data)
        session.add(emp)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValueError("No se pudo crear el empleado. Revisá que el DNI no esté repetido.") from exc
        session.refresh(emp)
        return _employee_to_payload(emp)


def update_employee_by_id_pg(employee_id: str | int, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        eid = int(str(employee_id).strip())
    except (TypeError, ValueError):
        raise ValueError("Empleado no encontrado")
    data = dict(payload or {})

    with db_session() as session:
        emp = session.get(Employee, eid)
        if not emp:
            raise ValueError("Empleado no encontrado")

        if "dni" in data:
            dni = _clean_dni(data.get("dni"))
            if dni:
                dup = session.scalar(select(Employee).where(Employee.dni == dni, Employee.id != eid))
                if dup:
                    raise ValueError(f"El DNI {dni} ya está asignado a otro empleado")
            emp.dni = dni or None

        if "status" in data:
            emp.status = _normalize_emp_status(data.get("status"))

        _apply_payload_to_employee(emp, data)

        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValueError("No se pudo guardar. Revisá que el DNI no esté repetido.") from exc
        session.refresh(emp)
        return _employee_to_payload(emp)


def link_employee_user_pg(employee_id: str | int, username: str) -> dict[str, Any]:
    """Vincula un usuario existente a un empleado (1:1 opcional)."""
    try:
        eid = int(str(employee_id).strip())
    except (TypeError, ValueError):
        raise ValueError("Empleado no encontrado")
    uname = str(username or "").strip().lower()
    if not uname:
        raise ValueError("Indicá el usuario a vincular")

    with db_session() as session:
        target_user = session.scalar(select(User).where(User.username == uname))
        if not target_user:
            raise ValueError("El usuario no existe")
        emp = session.get(Employee, eid)
        if not emp:
            raise ValueError("Empleado no encontrado")

        other = session.scalar(
            select(Employee).where(Employee.user_id == target_user.id, Employee.id != eid)
        )
        if other:
            raise ValueError(f"El usuario {uname} ya está vinculado a otro empleado")

        emp.user_id = target_user.id
        session.commit()
        session.refresh(emp)
        return _employee_to_payload(emp)


def unlink_employee_user_pg(employee_id: str | int) -> dict[str, Any]:
    try:
        eid = int(str(employee_id).strip())
    except (TypeError, ValueError):
        raise ValueError("Empleado no encontrado")
    with db_session() as session:
        emp = session.get(Employee, eid)
        if not emp:
            raise ValueError("Empleado no encontrado")
        emp.user_id = None
        session.commit()
        session.refresh(emp)
        return _employee_to_payload(emp)


def change_employee_status_pg(employee_id: str | int, payload: dict[str, Any], actor: Any = None) -> dict[str, Any]:
    try:
        eid = int(str(employee_id).strip())
    except (TypeError, ValueError):
        raise ValueError("Empleado no encontrado")

    data = dict(payload or {})
    new_status = _normalize_emp_status(data.get("status"))
    if new_status not in EMPLOYEE_STATUSES:
        raise ValueError("Estado laboral inválido. Usá: alta, licencia o baja.")

    actor_user_id: Optional[int] = None
    actor_username = getattr(actor, "username", "") if actor is not None else ""
    actor_username = str(actor_username or "").strip().lower()

    with db_session() as session:
        emp = session.get(Employee, eid)
        if not emp:
            raise ValueError("Empleado no encontrado")
        previous = _normalize_emp_status(emp.status)

        if actor_username:
            actor_row = session.scalar(select(User).where(User.username == actor_username))
            if actor_row:
                actor_user_id = actor_row.id

        emp.status = new_status

        hist = EmployeeStatusHistory(
            employee_id=eid,
            status=new_status,
            previous_status=previous,
            motivo=str(data.get("motivo") or "").strip(),
            categoria=str(data.get("categoria") or "").strip(),
            fecha_desde=_parse_date(data.get("fecha_desde")),
            fecha_hasta=_parse_date(data.get("fecha_hasta")),
            observaciones=str(data.get("observaciones") or "").strip(),
            actor_user_id=actor_user_id,
        )
        session.add(hist)
        session.commit()
        session.refresh(emp)
        return _employee_to_payload(emp)


def upsert_employee_for_user_pg(
    username: str,
    payload: dict[str, Any] | None = None,
    user_record: Any = None,
) -> dict[str, Any] | None:
    """Crea o actualiza el empleado vinculado a un usuario.

    Equivalente Postgres del legacy `upsert_employee_for_user`. Si el usuario
    no tiene un Employee asociado vía `user_id`, lo crea con los defaults.
    """
    uname = str(username or "").strip().lower()
    if not uname:
        return None

    data = dict(payload or {})
    # Defaults derivados del UserRecord legacy (si vino).
    if user_record is not None:
        display_name = getattr(user_record, "display_name", "") or ""
        if not data.get("display_name"):
            data["display_name"] = display_name
        if not data.get("first_name") or not data.get("last_name"):
            first, last = _split_display_name(display_name)
            data.setdefault("first_name", first)
            data.setdefault("last_name", last)
        if not data.get("company_id"):
            data["company_id"] = getattr(user_record, "company_id", "") or ""
        if not data.get("branch_id"):
            data["branch_id"] = getattr(user_record, "branch_id", "") or ""
        if not data.get("status"):
            data["status"] = "alta" if getattr(user_record, "is_active", True) else "baja"

    dni = _clean_dni(data.get("dni"))
    first = str(data.get("first_name") or "").strip()
    last = str(data.get("last_name") or "").strip()
    display = str(data.get("display_name") or "").strip() or " ".join([first, last]).strip() or uname
    if not first and not last:
        first, last = _split_display_name(display)

    with db_session() as session:
        user = session.scalar(select(User).where(User.username == uname))
        if not user:
            return None

        emp = session.scalar(select(Employee).where(Employee.user_id == user.id))

        if dni:
            dup = session.scalar(
                select(Employee).where(
                    Employee.dni == dni,
                    Employee.user_id != user.id,
                )
            )
            if dup:
                raise ValueError(f"El DNI {dni} ya está asignado a otro empleado")

        if emp is None:
            emp = Employee(
                user_id=user.id,
                dni=dni or None,
                first_name=first,
                last_name=last,
                display_name=display,
                status=_normalize_emp_status(data.get("status")),
                photo_url=str(data.get("photo_url") or "").strip(),
                photo_status=str(data.get("photo_status") or "sin_foto").strip(),
            )
            _apply_payload_to_employee(emp, data)
            session.add(emp)
        else:
            if dni:
                emp.dni = dni
            emp.first_name = first
            emp.last_name = last
            emp.display_name = display
            if "photo_url" in data:
                emp.photo_url = str(data.get("photo_url") or "").strip()
            if "photo_status" in data:
                emp.photo_status = str(data.get("photo_status") or "sin_foto").strip()
            if "status" in data and str(data.get("status") or "").strip():
                emp.status = _normalize_emp_status(data.get("status"))
            _apply_payload_to_employee(emp, data)

        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValueError("No se pudo guardar el empleado. Revisá que el DNI no esté repetido.") from exc

        session.refresh(emp)
        return _employee_to_payload(emp)


def set_employee_photo_pg(
    username: str,
    photo_url: str,
    photo_status: str = "pendiente_aprobacion",
) -> dict[str, Any]:
    uname = str(username or "").strip().lower()
    with db_session() as session:
        user = session.scalar(select(User).where(User.username == uname))
        if not user:
            raise ValueError("Usuario no encontrado")
        emp = session.scalar(select(Employee).where(Employee.user_id == user.id))
        if not emp:
            # Crear stub si no existe (igual que el flujo legacy)
            emp = Employee(
                user_id=user.id,
                first_name="",
                last_name="",
                display_name=user.display_name or uname,
                status="alta",
            )
            session.add(emp)
            session.flush()
        emp.photo_url = str(photo_url or "").strip()
        emp.photo_status = str(photo_status or "pendiente_aprobacion").strip()
        emp.photo_uploaded_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(emp)
        return _employee_to_payload(emp)


def set_employee_photo_status_pg(username: str, photo_status: str) -> dict[str, Any]:
    uname = str(username or "").strip().lower()
    with db_session() as session:
        user = session.scalar(select(User).where(User.username == uname))
        if not user:
            raise ValueError("Usuario no encontrado")
        emp = session.scalar(select(Employee).where(Employee.user_id == user.id))
        if not emp:
            # Stub vacío para sostener el flujo legacy.
            emp = Employee(
                user_id=user.id,
                first_name="",
                last_name="",
                display_name=user.display_name or uname,
                status="alta",
            )
            session.add(emp)
            session.flush()
        emp.photo_status = str(photo_status or "sin_foto").strip()
        session.commit()
        session.refresh(emp)
        return _employee_to_payload(emp)


# ── Búsqueda de usuarios candidatos para vincular ────────────────────────────

def search_users_for_link_pg(q: str = "", limit: int = 20) -> list[dict[str, Any]]:
    """Lista usuarios candidatos para vincular a un empleado.

    Filtra a los que ya no estén vinculados a un empleado con DNI cargado
    (mismo criterio que la versión legacy).
    """
    q_key = str(q or "").strip().lower()
    lim = max(1, int(limit or 20))

    with db_session() as session:
        linked_user_ids = {
            uid for (uid,) in session.execute(
                select(Employee.user_id).where(
                    Employee.user_id.is_not(None),
                    Employee.dni.is_not(None),
                    Employee.dni != "",
                )
            ).all()
            if uid is not None
        }

        stmt = select(User).order_by(User.username.asc())
        if q_key:
            like = f"%{q_key}%"
            stmt = stmt.where(or_(User.username.ilike(like), User.display_name.ilike(like)))

        users = session.scalars(stmt).all()
        out: list[dict[str, Any]] = []
        for u in users:
            if u.id in linked_user_ids:
                continue
            out.append({
                "username": u.username,
                "display_name": u.display_name,
                "role": "",  # se completa en el router si hace falta
                "is_active": bool(u.is_active),
            })
            if len(out) >= lim:
                break
        return out


def repair_user_employees_pg() -> dict[str, int]:
    """Asegura que cada usuario tenga un Employee asociado (stub).

    Es no-op cuando ya hay correspondencia. Devuelve contadores con la misma
    forma que la versión legacy.
    """
    created = 0
    total = 0
    with db_session() as session:
        users = session.scalars(select(User)).all()
        total = len(users)
        existing = {
            (emp.user_id): emp for emp in session.scalars(
                select(Employee).where(Employee.user_id.is_not(None))
            ).all()
        }
        for u in users:
            if existing.get(u.id) is not None:
                continue
            first, last = _split_display_name(u.display_name)
            emp = Employee(
                user_id=u.id,
                first_name=first,
                last_name=last,
                display_name=u.display_name or u.username,
                status="alta" if u.is_active else "baja",
            )
            session.add(emp)
            created += 1
        if created:
            session.commit()
    return {"ok": True, "created": created, "updated": 0, "total": total}
