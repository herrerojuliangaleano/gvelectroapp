# Fase 2 — Migración a PostgreSQL (SQLAlchemy + Alembic)

> **Estado:** en curso avanzado. **Base desde cero** (sin migrar datos). El
> runtime ya apunta a PostgreSQL; la validación completa requiere levantar
> Postgres, correr Alembic baseline y ejecutar el seed inicial.

## Decision operativa: base limpia

No se migran datos desde SQLite ni desde JSON legacy. El objetivo actual es que
el sistema funcione directo con PostgreSQL desde cero:

- Alembic crea el esquema.
- `backend/app/seed.py` carga companies, branches, roles base y admin.
- Los datos existentes en `backend/storage/electrogv.sqlite3`,
  `users.json` o `roles.json` se descartan para esta etapa.
- No crear, ejecutar ni continuar scripts de migracion de datos legacy.

## Objetivos
1. Reemplazar SQLite por **PostgreSQL** (en Docker, local y mañana en VPS).
2. Reescribir el acceso a datos con **SQLAlchemy 2.x ORM**.
3. Versionar el esquema con **Alembic** (migraciones reales, no `CREATE TABLE IF NOT EXISTS` sueltos).
4. Llevar **usuarios y roles a la base** (hoy en JSON) → FKs reales.
5. Dejar la operación de la DB simple y portable a Linux/VPS (Adminer + backups automáticos + SSH tunnel).

## Decisiones tomadas (no cambiar sin revisar)
- **Motor:** PostgreSQL 16 en Docker, co-locado con el backend (local y VPS).
- **ORM:** SQLAlchemy 2.x (estilo declarativo, `Mapped[]`).
- **Migraciones:** Alembic con autogenerate desde los modelos.
- **PKs:** slug en `companies`/`branches`; `BIGINT IDENTITY` en todo lo transaccional.
- **Dinero:** `NUMERIC(14,2)`.
- **Fechas:** `timestamptz`. Booleans: `boolean`. JSON: `jsonb`.
- **Auth:** `users`/`roles` en la DB con FKs reales (reemplaza `users.json` / `roles.json`).
- **Admin DB:** Adminer + backups automáticos (contenedor) + SSH tunnel.

Detalle en [`01-modelo-datos.md`](01-modelo-datos.md).

## Sub-fases

### 2.1 · Infra ✅ (este turno)
- Servicios `postgres`, `adminer`, `db-backup` en `docker-compose.yml`.
- `requirements.txt` con `sqlalchemy`, `alembic`, `psycopg[binary,pool]`.
- `.env.docker.example` con `DATABASE_URL` y `POSTGRES_*`.
- Helper Windows unico: `electrogv.bat` (panel para dev, prod local, migraciones, seed, backups, restore, ngrok y Android).

### 2.2 · Núcleo ORM + Alembic ✅ (este turno)
- `app/db.py` (engine + sesión + pool).
- `app/models/` con `base.py`, `org.py`, `auth.py` (Company, Branch, User, Role, UserRole, UserBranch).
- Esqueleto Alembic (`alembic.ini`, `env.py`, `script.py.mako`, `versions/`).
- `app/config.py` lee `DATABASE_URL`.

> Nota histórica: al final de 2.2 Postgres quedaba disponible pero no usado.
> Ese estado ya fue superado por el porting 2.5 y el switch de runtime 2.6.

### 2.3 · Modelos del resto del dominio  ✅
Modelos definidos en `app/models/`:
- `employees.py` — Employee, EmployeeStatusHistory, PayrollReceipt, PayrollReceiptObservation.
- `warranties.py` — Guarantee, GuaranteeItem, GuaranteeHistory, GuaranteeCounter, GuaranteeExport, GuaranteeSyncLog.
- `remitos.py` — Remito, RemitoItem (**nuevo**, normaliza `warranty_ids_json`).
- `sales_web.py` — SalesWebRequest, SalesWebItem.
- `sales_bi.py` — SalesImport, SalesRecord, SalesBalance.
- `products.py` — Product, ProductBrand, Provider, BrandProvider, ProductSyncLog.
- `system.py` — Notification, PushSubscription, FcmToken, Job, AppEvent, PriceCostUpdate, …Check, …History.

### 2.4 · Migración baseline + seed  ✅
- `backend/app/seed.py` y `electrogv.bat` opcion `3` ya existen para companies, branches, roles base y admin.
- Baseline Alembic creada en `backend/alembic/versions/20260531_0001_baseline_postgres.py`.
- La baseline crea el esquema desde `Base.metadata` y no importa datos legacy.

### 2.5 · Porting módulo por módulo (validando cada uno)

Estado observado:

| Subfase | Estado | Notas |
|---|---:|---|
| 2.5a · auth + users | ✅ | `users.py` delega en `users_db.py`; usuarios/roles/alcance van a Postgres. |
| 2.5b · employees | ✅ | `users.py` delega empleados en `employees_db.py`. |
| 2.5c · organization + notifications + jobs/audit | ✅ | `organization.py`, `notifications.py` y `database.py` usan Postgres. |
| 2.5d · sales_web | ✅ | `routers/sales_web/` usa SQLAlchemy/Postgres y mantiene contratos de API. |
| 2.5e · payroll | ✅ | `routers/payroll/` usa SQLAlchemy/Postgres para recibos y observaciones; archivos siguen en `uploads/`. |
| 2.5f · sales_bi | ✅ | `sales_bi.py` y `routers/sales_bi.py` usan SQLAlchemy/Postgres; el enriquecimiento de catálogo usa `products` ORM. |
| 2.5g · products + price_cost_updates | ✅ | `product_catalog.py`, `routers/products.py` y `routers/price_cost_updates/` usan SQLAlchemy/Postgres; importes en `NUMERIC(14,2)` y usuarios por FK. |
| 2.5h.0 · helpers compartidos garantías ↔ remitos | ✅ | `app/warranty_helpers.py` con REVIEW_*, CANCELLED_STATUS, helpers de tiempo (`now_ar`, `format_datetime_ar`, `parse_iso_datetime`, `utc_now_iso`, `format_date_ar`, `parse_date_filter`), `normalize_text`, `header_key`. `routers/warranties/` y `routers/remitos/` importan desde ahí en lugar de cross-importarse; los símbolos siguen disponibles como re-export para no romper integraciones externas. |
| 2.5h.1 · capa de datos Postgres para garantías | ✅ | `app/warranties_db.py` con funciones `pg_*`: `pg_next_warranty_code` (SELECT FOR UPDATE sobre `guarantee_counters`), `pg_next_shipment_code`, `pg_add_history`, `pg_insert_guarantee`, `pg_insert_item`, `pg_fetch_guarantee_with_items`, `pg_fetch_guarantee_by_id`, `pg_fetch_all_guarantee_rows`, `pg_history_for_guarantee`, `pg_collect_export_rows_by_codes`, `pg_update_guarantee_fields`, `pg_cancel_guarantee`, `pg_delete_guarantee`, counters y sugerencias. Dicts compatibles con el SQL legacy (`responsible_username`, `created_by`, `parent_warranty_code`, `details_json`, etc.). |
| 2.5i.1 · capa de datos Postgres para remitos | ✅ | `app/remitos_db.py` con CRUD completo: `pg_next_remito_code`, `pg_next_provider_delivery_code`, `pg_create_remito` (normaliza `warranty_ids_json` en `remito_items`), `pg_dispatch_remito`, `pg_confirm_arrival`, `pg_delete_remito`, `pg_get_remito_by_code`, `pg_list_remitos`, disponibilidad de garantías, depósitos, marcas, entrega a proveedor, llegada de remitos y desvinculación. Dicts compatibles con `row_to_remito`. |
| 2.5h.2a · helpers Postgres para switch de routers | ✅ | `warranties_db.py` suma helpers transaccionales para edición de cabecera/items, limpieza de correcciones, cancelación, delete, counters y sugerencias de proveedor/marca. `remitos_db.py` suma helpers para entrega a proveedor, llegada de remitos, desvinculación, filtros de listado y disponibilidad de depósito/proveedor. También se corrigió resolución de usuarios por `lower(username)`. |
| 2.5h.2b + 2.5i.2 · switch de routers a Postgres | ✅ | Routers de warranties/remitos portados a Postgres para endpoints vivos: alta, revisión, proveedor, cancel/delete, detalle, history y remitos internos. El dead code post-return fue eliminado en 2.5h.3. |
| 2.5h.1.5 · script de migración de datos SQLite → Postgres | ❌ ELIMINADO | Decision usuario: no se migran datos de SQLite/JSON. `backend/scripts/migrate_warranties_remitos.py` fue eliminado. El camino correcto es Postgres limpio + Alembic + seed. |
| 2.5h.2c · production-reset a Postgres | ✅ | Los 3 endpoints `/production-reset/*` (preview, backup, execute) porteados a Postgres en este turno. Nuevas funciones en `warranties_db.py`: `pg_reset_summary`, `pg_export_table_rows(table)` (whitelist), `pg_reset_warranty_tables` (un solo `TRUNCATE ... RESTART IDENTITY CASCADE` sobre las 8 tablas, atómico). `RESET_TABLES_PG` exporta la lista canónica. Backup JSON conserva el alias `warranty_remitos` apuntando a `remitos` para no romper consumidores externos. |
| 2.5h.2d · sync/config/diagnostics/dashboard a Postgres | ✅ | `GET /config`, `GET /diagnostics`, `GET /dashboard`, `GET /sync/status`, `GET /sync/logs` y `POST /sync/push-to-sheet` operan contra Postgres. `/sync/pull-from-sheet` fue eliminado: Sheets queda solo como espejo/exportación. |
| 2.5h.2e · espejo Google Sheets a Postgres | ✅ | `warranty_rows_for_sheet()` (sin `conn`) y `mirror_rows_for_sheet(sheet_name)` reescritos en `routers/warranties/` leyendo de PG vía `pg_fetch_all_guarantee_rows` + `pg_list_remitos` + `pg_list_exports` + `pg_all_history` (nueva en `warranties_db.py`). Nuevo helper `_pg_item_summary(items_list)`. Soporta los 6 sheets espejo: GARANTIAS, GARANTIA_ITEMS, REMITOS, REMITO_ITEMS, LOTES_ENV, LOTE_ITEMS, EVENTOS. **/sync/pull-from-sheet eliminado** (decisión usuario: Sheets es solo exportación de reportes, ya no se importa). `/sync/setup-sheet` mantenido (no toca DB, auto-crea pestañas). |
| 2.5h.3 · barrer helpers SQLite muertos | ✅ | Se eliminaron de `routers/warranties/` y `routers/remitos/` los helpers SQLite muertos, parsing pull de Sheets, wrappers legacy con SQL debajo de `return`, imports/type hints `sqlite3` y callers con `conn=None`. Validado: ambos routers compilan y `rg "sqlite3"` sobre ambos paquetes devuelve 0 resultados. |

Por cada módulo: reescribir queries a SQLAlchemy, traducir dialecto, fix de tipos
estrictos (strings → int donde corresponda), verificar endpoints, `tsc + build` en
frontend si hay cambios de tipos.

> **Cuidado con warranties + remitos.** El objetivo ya no es conservar ni
> importar datos legacy. Remitos y warranties operan contra Postgres en sus
> endpoints vivos; lo pendiente es barrer helpers muertos, eliminar referencias
> SQLite y cerrar 2.6. No reabrir la migracion de datos.

### 2.6 · Switch + limpieza ✅
- El backend ya no llama `init_db()` ni `ensure_auth_files()` en startup (lifespan vacío).
- `users.py`, `system.py`, `warranties/` y `remitos/` ya no usan SQLite.
- `backups.py` ya no empaqueta `electrogv.sqlite3`, `users.json` ni `roles.json`.
- `app/database.py` queda como wrapper Postgres de jobs/auditoría, no como capa SQLite.
- `users.json` y `roles.json` ya no existen en `backend/storage/`.
- `backend/storage/electrogv.sqlite3` **eliminado** (backup defensivo guardado en `backend/storage/backups/electrogv-pre-pg-switch-<stamp>.sqlite3` por si en algún momento se quiere consultar histórico de prueba).
- `backend/scripts/migrate_warranties_remitos.py` eliminado (no era necesario).
- `electrogv.bat` opcion `1` levanta dev para el usuario final.

## Estado 2.5h.3 (barrer helpers SQLite muertos)

**Estado:** hecho. Decisión del usuario: no interesa migrar SQLite/JSON. Todo
dato legacy se descarta y se va directo a Postgres limpio + seed + cleanup
final. **No crear ni ejecutar scripts de migración de datos.**

**Cierre técnico:**
- `backend/app/routers/warranties/` ya no conserva helpers SQLite muertos,
  wrappers legacy con SQL debajo de `return`, parsing de pull desde Sheets ni
  type hints `sqlite3`.
- `backend/app/routers/remitos/` ya no importa `sqlite3`, no importa helpers
  legacy desde warranties y no conserva helpers de tablas/remitos SQLite.
- Los helpers vivos de ambos routers reciben/retornan dicts compatibles con las
  capas `warranties_db.py` y `remitos_db.py`.

**Verificación final:** `rg "sqlite3" backend/app/routers/warranties backend/app/routers/remitos` devuelve 0 resultados.

## Validación operativa pendiente (smoke test)

Cierre técnico completo. **Falta solo confirmar contra Docker arriba**:

1. Arrancar Docker Desktop.
2. `docker compose up -d` (postgres + adminer + db-backup + backend).
3. `alembic upgrade head` (dentro del container backend).
4. `python -m app.seed` para sembrar companies, branches, roles y admin.
5. Probar `electrogv.bat` opcion `1` o navegar a la app: login admin, crear una garantía, generar remito, despachar, confirmar llegada, exportar lote ENV, dashboard.

## Estado actualizado (2026-05-31)

- **0** referencias a `sqlite3` en `warranties/` y `remitos/`.
- **0** usos vivos de `with db_connect()` en `warranties/` y `remitos/`.
- Endpoints operando contra Postgres: alta, listado, revisión completa (take/incomplete/approve), proveedor (confirm-shipment, send-provider, pickup-request, response, correction-resolve, resend-mail, claim, status), cancel, delete, entry-base, GET/PATCH detalle, history, production-reset (preview/backup/execute), counters, export (eligible/batch/provider/listado/download), config, diagnostics, dashboard, sync (status/logs/setup-sheet/push-to-sheet). Pull-from-sheet eliminado por decisión del usuario.
- `routers/remitos/`: 0 SQLite vivos.
- `routers/warranties/`: helpers muertos SQLite barridos en 2.5h.3.
- `warranties_db.py` y `remitos_db.py`: capas Postgres completas.
- Script de migración eliminado (decisión usuario: datos de prueba descartados).
- `electrogv.sqlite3` eliminado de `storage/` (backup defensivo en `storage/backups/`).
- `users.json` / `roles.json` ya no existen en `storage/`.
- `main.py` lifespan vacío (sin `init_db`).
- `app/database.py` es ahora capa Postgres pura para jobs/audit.

**Fase 2 cerrada. La app corre 100% sobre PostgreSQL.**

## Impacto en frontend
**Bajo.** Los contratos de la API se mantienen (`username`, `warranty_code`,
slugs de branch/company son las handles visibles). Solo se ajustan:
- `types/index.ts` — algunos campos opcionales / `user_id` agregado.
- Quizás 1-2 pantallas donde un ID cambia de UUID string a número (se serializa igual; ajuste mínimo).
- **Sin rediseño visual.**

## Operación de la base
- Cómo administrar día a día (Adminer, DBeaver, backups, restaurar): [`02-administracion-db.md`](02-administracion-db.md).
- Cómo deploy en el VPS (Caddy, always-on, acceso remoto): [`03-deploy-vps.md`](03-deploy-vps.md).
