# Guia tecnica para desarrollo y agentes

Esta guia esta pensada para personas desarrolladoras, Codex y Claude Code. El
objetivo es entrar al proyecto rapido, entender los limites actuales y evitar
cambios que rompan flujos operativos.

## Reglas de oro

- Leer esta guia, el manual funcional y la documentacion de fase antes de
  modificar arquitectura.
- No tocar ni commitear secretos reales.
- No borrar datos de `backend/storage/`.
- PostgreSQL es la base activa del runtime. No reintroducir SQLite como
  persistencia operativa.
- No migrar ni importar datos desde SQLite/JSON legacy: la base objetivo es
  PostgreSQL limpia, creada con Alembic y seed.
- Mantener contratos de API estables para el frontend.
- Si se agrega o modifica un modulo, actualizar docs y permisos.
- Antes de refactors grandes, revisar routers, cliente API y tipos.
- Todo turno grande debe cerrar con el protocolo de continuidad documentado en
  [04-protocolo-agentes.md](04-protocolo-agentes.md).

## Estado actual de persistencia

La base activa del runtime es PostgreSQL:

- `backend/app/db.py`
- `backend/app/models/`
- `backend/alembic/versions/20260531_0001_baseline_postgres.py`
- Postgres en `docker-compose.yml`

El camino correcto es levantar Postgres limpio, correr Alembic y ejecutar
`backend/app/seed.py`. Los archivos SQLite/JSON que existan en `backend/storage/`
son legado local y no deben importarse.

Routers/capas ya portados a PostgreSQL en Fase 2.5:

- `backend/app/users.py` via `users_db.py` y `employees_db.py`.
- `backend/app/routers/organization.py`.
- `backend/app/routers/notifications.py`.
- `backend/app/database.py` para jobs/audit/app events.
- `backend/app/routers/sales_web/`.
- `backend/app/routers/payroll/`.
- `backend/app/sales_bi.py` y `backend/app/routers/sales_bi.py`.
- `backend/app/product_catalog.py`, `backend/app/routers/products.py` y
  `backend/app/routers/price_cost_updates/`.
- `backend/app/routers/remitos/`, via `backend/app/remitos_db.py` y
  `backend/app/warranties_db.py`, sin referencias `sqlite3` restantes.
- `backend/app/routers/warranties/`, via `backend/app/warranties_db.py` y
  `backend/app/remitos_db.py`, sin referencias `sqlite3` restantes.

Pendiente de validacion operativa:

- Levantar Docker/Postgres.
- Ejecutar `alembic upgrade head`.
- Ejecutar `python -m app.seed`.
- Smoke test de login, dashboard, warranties/remitos y admin.

## Backend

### Entrada

`backend/app/main.py`

Responsabilidades:

- Cargar settings.
- Registrar routers.
- Exponer `/api/health`.
- Servir `frontend/dist` si existe.

### Settings

`backend/app/config.py`

Lee `backend/.env` en modo local y variables del entorno en Docker/VPS.
Expone rutas para storage, logs, uploads, outputs, private, credenciales Google
y `DATABASE_URL` de Postgres.

### Routers

Cada modulo vive como archivo `backend/app/routers/<modulo>.py` o como paquete
`backend/app/routers/<modulo>/` cuando el router fue dividido en sub-modulos.
Las rutas estan listadas en [03-api-endpoints.md](03-api-endpoints.md).

### Usuarios y permisos

- Catalogo de permisos: `backend/app/permissions.py`.
- Autenticacion: `backend/app/auth.py` y `backend/app/routers/auth.py`.
- Fundacion de acceso/scope: `backend/app/access.py`.
- Usuarios y roles: `backend/app/users.py` delega en `backend/app/users_db.py`.
- Persistencia auth: tablas `users`, `roles`, `user_roles`, `user_branches`.

Si se agrega una pantalla protegida:

1. Crear permiso en `ALL_PERMISSIONS`.
2. Agregarlo a `PERMISSION_GROUPS`.
3. Asignarlo a roles por defecto si corresponde.
4. Usarlo en frontend con `ProtectedLayout`, `can()` o helpers especificos.
5. Proteger endpoints con `require_permission()` o, si aceptan varios permisos,
   con `require_any_permission()` desde `backend/app/access.py`.

Para reglas de empresa/sucursal/deposito, no duplicar logica en routers: usar
`assigned_branches()`, `assigned_deposit_names()`, `resolve_deposit_name()` y
`users_with_permission()` desde `backend/app/access.py`.

### Auditoria

`backend/app/audit.py` registra eventos de auditoria en PostgreSQL y puede
sincronizarlos a Google Sheets como espejo best-effort.

### Jobs y herramientas

- Registro: `backend/app/tools/registry.py`
- Runner: `backend/app/jobs.py`
- Bootstrap legacy: `backend/app/tools/legacy_bootstrap.py`
- Scripts originales: `backend/legacy_scripts/Aplicacion de ElectroGV/`

Las herramientas se exponen como formularios dinamicos. Cada tool define campos,
script, runner y metadatos. Evitar editar scripts legacy salvo necesidad clara;
preferir adaptar el wrapper si el problema es de ejecucion web.

### Google

- OAuth: `backend/app/google_auth.py`
- Sheets: `backend/app/google_sheets.py`
- Admin UI/API: `backend/app/routers/google_admin.py`

Las credenciales reales deben quedar fuera del repo.

## Frontend

### Entrada

- `frontend/src/main.tsx`
- `frontend/src/App.tsx`

`App.tsx` define rutas, redirects legacy y proteccion por permisos.

### Cliente API

`frontend/src/api/client.ts`

Responsabilidades:

- Construir base URL con `VITE_API_BASE_URL`.
- Adjuntar token Bearer.
- Evitar warning de ngrok con `ngrok-skip-browser-warning`.
- Manejar errores de conexion.
- Exponer funciones por modulo.

Si se agrega endpoint, agregar wrapper aca y tipo en `frontend/src/types/index.ts`.

### Tipos

`frontend/src/types/index.ts`

Mantener los tipos alineados con respuestas FastAPI. Si una respuesta cambia,
ajustar tipo y pantallas consumidoras.

### Layout y componentes

- Layout principal: `frontend/src/layouts/AppLayout.tsx`
- Componentes UI compartidos: `frontend/src/components/`
- Estilos globales: `frontend/src/styles.css`

### Reglas de acceso de garantias

`frontend/src/warrantyAccess.ts`

Contiene logica de visibilidad mas fina para roles de garantia, deposito,
sucursal, gestor y posventa. Revisar antes de cambiar rutas de garantias.

## Rutas frontend relevantes

| Ruta | Pantalla |
|---|---|
| `/` | Dashboard o redirect segun permisos |
| `/login` | Login |
| `/set-password` | Cambio obligatorio de password |
| `/me` | Mi usuario |
| `/mi-legajo` | Mi legajo |
| `/warranties/*` | Garantias y remitos |
| `/budgets/new` | Presupuestos |
| `/venta/*` | Ventas web |
| `/ventas-bi/*` | Sales BI |
| `/productos` | Catalogo |
| `/precios-costos` | Precios y costos |
| `/recibos` | Recibos |
| `/tools/*` | Herramientas internas |
| `/jobs/*` | Jobs |
| `/notificaciones` | Notificaciones |
| `/administracion/*` | Usuarios y empleados |
| `/admin/*` | Roles, Google, backups, diagnostico, config |
| `/audit` | Auditoria |

## Comandos utiles

### Panel Windows

```bat
electrogv.bat
```

Es la unica entrada `.bat` de la raiz. Desde ahi se levanta/dev/prod local,
ngrok, migraciones, seed, backups, restores, promocion de datos, Android y
token OAuth Google.

### Backend local historico

```bat
scripts_laptop\01_start_backend.bat
scripts_laptop\03_start_complete.bat
```

### Docker

```bash
docker compose up -d --build
docker compose logs -f
docker compose ps
docker compose down
```

Convencion de bases locales:

| Entorno | DB | Puertos |
|---|---|---|
| Desarrollo | `electrogv_dev` | backend `8000`, Postgres `5432`, Adminer `8080` |
| Produccion local | `electrogv` | backend `8010`, Postgres `5433`, Adminer `8081` |

### Frontend

```bash
cd frontend
npm install
npm run dev
npm run build
```

### Android / Capacitor

```powershell
cd frontend
npm run android:apk
```

La guia operativa esta en [08-android-capacitor.md](08-android-capacitor.md).
El APK carga el dominio online configurado en `frontend/capacitor.config.ts`;
no recompilar Android salvo cambios nativos, version del APK o cambio de
dominio.

### Remotes Git

```powershell
git push repo2 HEAD:main   # prueba / staging
git push origin HEAD:main  # produccion
```

No invertir estos remotes: `repo2` es prueba y `origin` es produccion. El flujo
Vercel + ngrok esta documentado en
[07-produccion-local-vercel-ngrok.md](07-produccion-local-vercel-ngrok.md).

### Crear usuario admin

```bash
cd backend
.venv\Scripts\python.exe scripts/create_user.py
```

### Google OAuth local

```bash
cd backend
.venv\Scripts\python.exe scripts/google_oauth_bootstrap.py
```

### Alembic / Postgres Fase 2

```bash
docker compose exec backend alembic revision --autogenerate -m "descripcion"
docker compose exec backend alembic upgrade head
```

## Variables de entorno importantes

| Variable | Uso |
|---|---|
| `APP_ENABLED` | Habilita/deshabilita app. |
| `AUTH_SECRET` | Firma JWT. Cambiar en produccion. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Usuario inicial/legacy. |
| `CORS_ORIGINS` | Origenes permitidos del frontend. |
| `STORAGE_DIR` | Carpeta persistente del backend. |
| `DATABASE_URL` | Conexion Postgres de Fase 2. |
| `WARRANTY_SPREADSHEET_ID` / `WARRANTY_SPREADSHEET_URL` | Planilla de garantias. |
| `WARRANTY_RAW_SHEET` | Hoja raw de garantias. |
| `PRODUCT_CATALOG_SHEET` | Hoja de catalogo de productos. |
| `WARRANTY_SUCURSALES` | Sucursales disponibles para garantias. |
| `WARRANTY_DEPOSITOS` | Depositos/ubicaciones logisticas. |
| `GOOGLE_CREDENTIALS_FILE` | Archivo OAuth client secret. |
| `GOOGLE_TOKEN_FILE` | Token OAuth persistente. |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | Service account Firebase Admin para push. |
| `BUDGET_*` | Configuracion de presupuestos. |
| `MAX_RECENT_JOBS` | Limite de jobs recientes. |

## Flujo recomendado para cambios

1. Identificar modulo y permisos afectados.
2. Leer router backend, cliente API y pantalla frontend correspondiente.
3. Revisar tablas legacy en `database.py` si el cambio toca persistencia.
4. Cambiar backend.
5. Cambiar tipos y cliente frontend.
6. Cambiar pantalla.
7. Ejecutar build/tests disponibles.
8. Actualizar documentacion.
9. Cerrar el turno con el protocolo de continuidad si otro agente/persona puede
   retomar el trabajo despues.

## Checklist para nuevo modulo

- Router FastAPI con prefijo `/api/<modulo>`.
- Modelos/persistencia legacy o SQLAlchemy, segun fase.
- Schemas Pydantic o tipos de respuesta claros.
- Permisos en `permissions.py`.
- Wrappers en `frontend/src/api/client.ts`.
- Tipos en `frontend/src/types/index.ts`.
- Ruta protegida en `frontend/src/App.tsx`.
- Pantalla en `frontend/src/pages/`.
- Entrada en Dashboard/Topbar si aplica.
- Documentacion funcional y API.

## Riesgos conocidos

- Encoding: algunos archivos muestran caracteres rotos en PowerShell. Preferir
  UTF-8 y evitar reescrituras innecesarias de archivos existentes.
- Base PostgreSQL activa: no agregar persistencia nueva en SQLite/JSON.
- Inconsistencia detectada: `frontend/src/api/client.ts` expone
  `setSystemMode()` contra `POST /api/system/mode`, pero
  `backend/app/routers/system.py` no registra ese endpoint actualmente.
- Garantias tiene un router muy grande; tocarlo con cambios pequenos y
  verificados.
- Remitos debe registrarse antes que warranties en `main.py` porque warranties
  tiene ruta catch-all `/{warranty_id}`.
- Frontend tiene redirects legacy para rutas viejas de ventas y garantias; no
  eliminarlos sin confirmar uso real.
- Los scripts legacy pueden depender de rutas, stdin, dialogos y Google Drive.
  El bootstrap simula esos entornos.

## Definicion de terminado

Un cambio esta listo cuando:

- La funcionalidad opera desde UI y API.
- Los permisos bloquean y habilitan correctamente.
- El build del frontend pasa si se tocaron tipos o pantallas.
- El backend importa/arranca sin depender de bootstrap SQLite.
- La documentacion afectada queda actualizada.
- No se tocaron secretos ni datos persistentes reales.
