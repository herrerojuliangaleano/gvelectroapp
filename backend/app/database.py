from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from .config import get_settings
from .product_catalog import ensure_product_catalog_tables
from .sales_bi import ensure_sales_bi_tables

_lock = threading.RLock()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock, _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                tool_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                duration_seconds REAL,
                user TEXT,
                payload_json TEXT,
                log_path TEXT,
                error TEXT,
                pid INTEGER
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                event_type TEXT NOT NULL,
                detail_json TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON app_events(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_web_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero_solicitud TEXT UNIQUE NOT NULL,
                numero_remito_prefactura TEXT,
                estado TEXT NOT NULL,
                vendedor_id TEXT NOT NULL,
                vendedor_nombre TEXT NOT NULL,
                sucursal TEXT,
                canal TEXT,
                dni TEXT NOT NULL,
                apellido_nombre TEXT NOT NULL,
                telefono TEXT NOT NULL,
                correo_electronico TEXT NOT NULL,
                domicilio TEXT NOT NULL,
                codigo_postal TEXT NOT NULL,
                localidad TEXT NOT NULL,
                barrio TEXT,
                entre_calles TEXT,
                observaciones TEXT,
                pago_tipo TEXT NOT NULL,
                entrega_tipo TEXT NOT NULL,
                costo_envio TEXT,
                observacion_admin TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                taken_at TEXT,
                taken_by TEXT,
                completed_at TEXT,
                completed_by TEXT,
                sent_to_sales_at TEXT,
                sent_to_sales_by TEXT,
                cancelled_at TEXT,
                cancelled_by TEXT,
                cancel_reason TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_web_estado ON sales_web_requests(estado)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_web_vendedor ON sales_web_requests(vendedor_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_web_created ON sales_web_requests(created_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_web_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER NOT NULL,
                sku TEXT,
                producto TEXT NOT NULL,
                marca TEXT,
                tipo TEXT,
                condicion TEXT,
                cantidad INTEGER NOT NULL DEFAULT 1,
                precio_unitario TEXT,
                total_linea TEXT,
                FOREIGN KEY(request_id) REFERENCES sales_web_requests(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_web_items_request ON sales_web_items(request_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT NOT NULL,
                sales_request_id INTEGER,
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                read_at TEXT
            )
            """
        )
        existing_notification_cols = {row["name"] for row in conn.execute("PRAGMA table_info(notifications)").fetchall()}
        notification_extra_cols = {
            "module": "TEXT NOT NULL DEFAULT 'general'",
            "event_type": "TEXT NOT NULL DEFAULT 'general'",
            "priority": "TEXT NOT NULL DEFAULT 'normal'",
            "entity_type": "TEXT",
            "entity_id": "TEXT",
            "link_url": "TEXT",
            "branch_id": "TEXT",
            "branch_name": "TEXT",
            "target_role": "TEXT",
            "metadata": "TEXT",
            "delivered_push_at": "TEXT",
            "push_status": "TEXT",
        }
        for col_name, col_def in notification_extra_cols.items():
            if col_name not in existing_notification_cols:
                conn.execute(f"ALTER TABLE notifications ADD COLUMN {col_name} {col_def}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(username, read)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_module ON notifications(username, module, read)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_priority ON notifications(username, priority, read)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT,
                auth TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(username, endpoint)
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS price_cost_updates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                producto TEXT NOT NULL,
                sku TEXT NOT NULL,
                marca TEXT,
                valor_anterior TEXT,
                valor_nuevo TEXT NOT NULL,
                estado TEXT NOT NULL,
                lookup_warning TEXT,
                created_by TEXT NOT NULL,
                created_by_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                cancelled_at TEXT,
                cancelled_by TEXT,
                cancel_reason TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_price_cost_updates_type ON price_cost_updates(type)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_price_cost_updates_estado ON price_cost_updates(estado)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_price_cost_updates_created ON price_cost_updates(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_price_cost_updates_sku ON price_cost_updates(sku)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS price_cost_update_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                update_id INTEGER NOT NULL,
                check_key TEXT NOT NULL,
                label TEXT NOT NULL,
                checked INTEGER NOT NULL DEFAULT 0,
                checked_by TEXT,
                checked_by_name TEXT,
                checked_at TEXT,
                FOREIGN KEY(update_id) REFERENCES price_cost_updates(id) ON DELETE CASCADE,
                UNIQUE(update_id, check_key)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_price_cost_update_checks_update ON price_cost_update_checks(update_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS price_cost_update_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                update_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                action TEXT NOT NULL,
                detail_json TEXT,
                FOREIGN KEY(update_id) REFERENCES price_cost_updates(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_price_cost_update_history_update ON price_cost_update_history(update_id)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS companies (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                legal_name TEXT,
                cuit TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS branches (
                id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                name TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL DEFAULT 'physical',
                parent_branch_id TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(company_id) REFERENCES companies(id),
                FOREIGN KEY(parent_branch_id) REFERENCES branches(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_branches_parent ON branches(parent_branch_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_branches_type ON branches(type)")

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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_branches_username ON user_branches(username)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_branches_branch ON user_branches(branch_id)")

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
                updated_at TEXT NOT NULL,
                FOREIGN KEY(company_id) REFERENCES companies(id),
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_username ON employees(username)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS payroll_receipts (
                id TEXT PRIMARY KEY,
                employee_id TEXT NOT NULL,
                employee_username TEXT NOT NULL DEFAULT '',
                employee_dni TEXT NOT NULL DEFAULT '',
                employee_name TEXT NOT NULL DEFAULT '',
                period_year INTEGER NOT NULL,
                period_month INTEGER NOT NULL,
                receipt_type TEXT NOT NULL DEFAULT 'mensual',
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_content_type TEXT NOT NULL DEFAULT '',
                file_size INTEGER NOT NULL DEFAULT 0,
                file_hash TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pendiente',
                uploaded_by TEXT NOT NULL DEFAULT '',
                uploaded_by_name TEXT NOT NULL DEFAULT '',
                uploaded_at TEXT NOT NULL,
                viewed_at TEXT NOT NULL DEFAULT '',
                viewed_by TEXT NOT NULL DEFAULT '',
                signed_at TEXT NOT NULL DEFAULT '',
                signed_by TEXT NOT NULL DEFAULT '',
                observed_at TEXT NOT NULL DEFAULT '',
                cancelled_at TEXT NOT NULL DEFAULT '',
                cancelled_by TEXT NOT NULL DEFAULT '',
                cancel_reason TEXT NOT NULL DEFAULT '',
                replaced_by_receipt_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(employee_id) REFERENCES employees(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll_receipts(employee_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_username ON payroll_receipts(employee_username)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_receipts(period_year, period_month)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_receipts(status)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS payroll_receipt_observations (
                id TEXT PRIMARY KEY,
                receipt_id TEXT NOT NULL,
                employee_id TEXT NOT NULL DEFAULT '',
                employee_username TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'abierta',
                created_at TEXT NOT NULL,
                answered_by TEXT NOT NULL DEFAULT '',
                answered_by_name TEXT NOT NULL DEFAULT '',
                answered_at TEXT NOT NULL DEFAULT '',
                answer_message TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(receipt_id) REFERENCES payroll_receipts(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_obs_receipt ON payroll_receipt_observations(receipt_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_obs_status ON payroll_receipt_observations(status)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS guarantees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                warranty_code TEXT UNIQUE NOT NULL,
                status TEXT NOT NULL DEFAULT '1 - INGRESO',
                review_status TEXT NOT NULL DEFAULT 'pendiente_revision',
                reviewed_by TEXT NOT NULL DEFAULT '',
                reviewed_by_name TEXT NOT NULL DEFAULT '',
                reviewed_at TEXT NOT NULL DEFAULT '',
                review_note TEXT NOT NULL DEFAULT '',
                responsible_username TEXT NOT NULL DEFAULT '',
                responsible_name TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL DEFAULT '',
                created_by_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                ingreso_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL DEFAULT '',
                updated_by_name TEXT NOT NULL DEFAULT '',
                sucursal TEXT NOT NULL DEFAULT '',
                sucursal_code TEXT NOT NULL DEFAULT '',
                branch_id TEXT NOT NULL DEFAULT '',
                deposito TEXT NOT NULL DEFAULT '',
                lugar_llegada TEXT NOT NULL DEFAULT '',
                provider_name TEXT NOT NULL DEFAULT '',
                provider_case_id TEXT NOT NULL DEFAULT '',
                sent_to_provider_at TEXT NOT NULL DEFAULT '',
                last_provider_response_at TEXT NOT NULL DEFAULT '',
                fecha_retiro TEXT NOT NULL DEFAULT '',
                fecha_resolucion TEXT NOT NULL DEFAULT '',
                finalizacion TEXT NOT NULL DEFAULT '',
                vuelve_a TEXT NOT NULL DEFAULT '',
                observations TEXT NOT NULL DEFAULT '',
                photos_reference TEXT NOT NULL DEFAULT '',
                cancelled INTEGER NOT NULL DEFAULT 0,
                cancel_reason TEXT NOT NULL DEFAULT '',
                cancelled_by TEXT NOT NULL DEFAULT '',
                cancelled_at TEXT NOT NULL DEFAULT '',
                synced_to_google_sheet INTEGER NOT NULL DEFAULT 0,
                last_google_sync_at TEXT NOT NULL DEFAULT '',
                google_sheet_row_id TEXT NOT NULL DEFAULT '',
                google_sheet_updated_at TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantees_code ON guarantees(warranty_code)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantees_status ON guarantees(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantees_sucursal ON guarantees(sucursal)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantees_ingreso ON guarantees(ingreso_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantees_updated ON guarantees(updated_at)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS guarantee_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guarantee_id INTEGER NOT NULL,
                producto TEXT NOT NULL DEFAULT '',
                sku TEXT NOT NULL DEFAULT '',
                marca TEXT NOT NULL DEFAULT '',
                tipo TEXT NOT NULL DEFAULT '',
                serie TEXT NOT NULL DEFAULT '',
                falla TEXT NOT NULL DEFAULT '',
                observaciones TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(guarantee_id) REFERENCES guarantees(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantee_items_gid ON guarantee_items(guarantee_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantee_items_sku ON guarantee_items(sku)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantee_items_marca ON guarantee_items(marca)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS guarantee_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guarantee_id INTEGER NOT NULL,
                warranty_code TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                actor_username TEXT NOT NULL DEFAULT '',
                actor_name TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL,
                old_status TEXT NOT NULL DEFAULT '',
                new_status TEXT NOT NULL DEFAULT '',
                field_name TEXT NOT NULL DEFAULT '',
                old_value TEXT NOT NULL DEFAULT '',
                new_value TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                details_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(guarantee_id) REFERENCES guarantees(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantee_history_gid ON guarantee_history(guarantee_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_guarantee_history_code ON guarantee_history(warranty_code)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS guarantee_counters (
                year INTEGER NOT NULL,
                sucursal_code TEXT NOT NULL,
                last_number INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(year, sucursal_code)
            )
            """
        )

        ensure_product_catalog_tables(conn)
        ensure_sales_bi_tables(conn)

        now = utc_now_iso()
        seed_companies = [
            ("electro_gv", "Electro GV", "Electro GV", ""),
            ("electro_abc_srl", "Electro ABC SRL", "Electro ABC SRL", ""),
        ]
        for company_id, name, legal_name, cuit in seed_companies:
            conn.execute(
                """
                INSERT OR IGNORE INTO companies (id, name, legal_name, cuit, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                """,
                (company_id, name, legal_name, cuit, now, now),
            )

        seed_branches = [
            ("caseros", "electro_gv", "Caseros", "CASEROS", "physical", None),
            ("caseros_web", "electro_gv", "Caseros - WEB", "CASEROS_WEB", "web", "caseros"),
            ("canning", "electro_abc_srl", "Canning", "CANNING", "physical", None),
            ("canning_web", "electro_abc_srl", "Canning - WEB", "CANNING_WEB", "web", "canning"),
            ("norte", "electro_abc_srl", "Norte", "NORTE", "physical", None),
            ("norte_web", "electro_abc_srl", "Norte - WEB", "NORTE_WEB", "web", "norte"),
            ("sur", "electro_abc_srl", "Sur", "SUR", "physical", None),
            ("sur_web", "electro_abc_srl", "Sur - WEB", "SUR_WEB", "web", "sur"),
            # Depósitos reales. Se modelan como branches type=deposit para que
            # usuarios, permisos, filtros y Garantías usen la misma lógica
            # organizativa existente: usuario -> empresa -> branch asignada.
            # Chiclana es el depósito operativo principal de garantías;
            # Corrales y Cachi quedan disponibles como depósitos de guarda.
            # La diferenciación fina se mantiene en configuración/fases futuras;
            # por ahora evitamos crear una lógica paralela fuera de branches.
            ("deposito_chiclana", "electro_gv", "Depósito Chiclana", "CHICLANA", "deposit", None),
            ("deposito_corrales", "electro_gv", "Depósito Corrales", "CORRALES", "deposit", None),
            ("deposito_cachi", "electro_gv", "Depósito Cachi", "CACHI", "deposit", None),
        ]
        for branch_id, company_id, name, code, branch_type, parent_branch_id in seed_branches:
            conn.execute(
                """
                INSERT OR IGNORE INTO branches (id, company_id, name, code, type, parent_branch_id, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (branch_id, company_id, name, code, branch_type, parent_branch_id, now, now),
            )

        conn.commit()


def create_job(job: dict[str, Any]) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO jobs (id, tool_id, tool_name, status, created_at, user, payload_json, log_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job["id"], job["tool_id"], job["tool_name"], job["status"], job["created_at"],
                job.get("user"), json.dumps(job.get("payload", {}), ensure_ascii=False), job.get("log_path"),
            ),
        )
        conn.commit()


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    with _lock, _connect() as conn:
        cols = []
        vals = []
        for key, value in fields.items():
            cols.append(f"{key} = ?")
            vals.append(value)
        vals.append(job_id)
        conn.execute(f"UPDATE jobs SET {', '.join(cols)} WHERE id = ?", vals)
        conn.commit()


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        return _row_to_job(row)


def list_jobs(limit: int = 100) -> list[dict[str, Any]]:
    with _lock, _connect() as conn:
        rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [_row_to_job(row) for row in rows]


def _row_to_job(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    try:
        data["payload"] = json.loads(data.pop("payload_json") or "{}")
    except Exception:
        data["payload"] = {}
    return data


def append_event(event_type: str, detail: dict[str, Any]) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO app_events (created_at, event_type, detail_json) VALUES (?, ?, ?)",
            (utc_now_iso(), event_type, json.dumps(detail, ensure_ascii=False)),
        )
        conn.commit()


def list_audit_events(limit: int = 200) -> list[dict[str, Any]]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id, created_at, event_type, detail_json FROM app_events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    events: list[dict[str, Any]] = []
    for row in rows:
        detail: dict[str, Any] = {}
        try:
            detail = json.loads(row["detail_json"] or "{}")
        except Exception:
            detail = {}
        actor = detail.get("actor") if isinstance(detail.get("actor"), dict) else {}
        events.append({
            "id": row["id"],
            "created_at": row["created_at"],
            "event_type": row["event_type"],
            "actor_username": actor.get("username"),
            "actor_display_name": actor.get("display_name"),
            "actor_role": actor.get("role"),
            "resource_type": detail.get("resource_type"),
            "resource_id": detail.get("resource_id"),
            "status": detail.get("status", "ok"),
            "message": detail.get("message"),
            "details": detail.get("details", {}),
        })
    return events
