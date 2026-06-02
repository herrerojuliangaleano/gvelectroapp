# 05 — Fundación organizacional

> **Léeme primero antes de tocar cualquier módulo de operación.**
>
> Todo lo que la app hace (cargar una garantía, generar un remito, registrar
> una venta, autorizar un cambio de estado, ver un dashboard) se levanta de
> esta jerarquía. Si un módulo nuevo o un refactor rompe alguna de estas
> conexiones, está mal pensado — corregir el módulo, no la fundación.

## La jerarquía

```
Company (empresa)
  └─ Branch (sucursal | depósito | web | admin)
       └─ User (a través de UserBranch)
            └─ Role (a través de UserRole)
                 └─ Permission (catálogo de claves en código)
```

Más una entidad transversal:

```
Employee  ────►  User  (opcional, puede haber empleado sin user)
   │              │
   ├──► Company   ├──► UserRole ─► Role ─► Permission[]
   └──► Branch    └──► UserBranch ─► Branch
```

## Las 5 entidades base

### 1. Company (empresa)

- **Tabla:** `companies`
- **PK:** slug TEXT (`"electro_gv"`, `"electro_abc_srl"`)
- **Modelo:** [`app/models/org.py:Company`](../backend/app/models/org.py)
- **Por qué slug:** la PK aparece en URLs, exportaciones, FKs de toda la app. Un slug estable es legible y no rompe historial cuando renombrás la empresa.
- **Multi-empresa real:** la app es multi-tenant. Hoy hay 2 empresas (GV y ABC). El logo, prefijos de remito (`GV-R-` vs `ABC-R-`) y reportes se separan por `company_id`.

### 2. Branch (sucursal / depósito / web / admin)

- **Tabla:** `branches`
- **PK:** slug TEXT (`"caseros"`, `"deposito_chiclana"`, `"caseros_web"`)
- **FK:** `company_id` → `companies.id` (ON DELETE RESTRICT)
- **Modelo:** [`app/models/org.py:Branch`](../backend/app/models/org.py)
- **Tipos:**
  | type | Para qué | Ejemplo |
  |---|---|---|
  | `physical` | Sucursal con local + cliente | Caseros, Lanús, Canning |
  | `web` | Canal online de una sucursal física (hereda por `parent_branch_id`) | Caseros - WEB |
  | `deposit` | Depósito sin atención al público | Chiclana, Corrales, Cachi |
  | `admin` | Equipo administrativo (no opera ventas) | — |
- **`parent_branch_id`:** auto-referencial. Una sucursal WEB depende de la física. Ventas online de "Caseros - WEB" cuentan en KPIs de "Caseros".

### 3. Role (rol)

- **Tabla:** `roles`
- **PK:** id BIGINT autoincrement
- **Modelo:** [`app/models/auth.py:Role`](../backend/app/models/auth.py)
- **Campos clave:**
  - `name` (slug, ej. `"SUPERADMIN"`, `"VENDEDOR"`, `"DEPOSITO"`).
  - `label` (legible, ej. `"Vendedor"`).
  - `level` (entero — más alto = más privilegio; para jerarquía visual).
  - `permissions: list[str]` (JSONB) — array de claves del catálogo.
- **Catálogo de roles en código:** [`app/permissions.py:DEFAULT_ROLES`](../backend/app/permissions.py). El seed los inserta. Crear/editar roles desde la UI escribe en esta tabla, no en archivos.

### 4. Permission (permiso)

- **NO es una tabla.** Es un **catálogo en código** ([`app/permissions.py:ALL_PERMISSIONS`](../backend/app/permissions.py)) — dict `clave → descripción humana`.
- **Por qué no en DB:** los permisos los define el equipo de desarrollo (cuando agrega una feature). La UI solo elige cuáles asignar a cada rol.
- **Convención de claves:** `dominio.accion` o `dominio.subdominio.accion`. Ejemplos:
  - `warranties.view`, `warranties.create`, `warranties.cancel`
  - `warranties.remitos.generate`, `warranties.remitos.dispatch`
  - `sales_bi.import`, `users.manage`, `ops_config.manage`
- **Wildcard `*`:** el rol SUPERADMIN tiene `["*"]` → bypass de cualquier chequeo `has_permission`.

### 5. User (usuario)

- **Tabla:** `users`
- **PK:** id BIGINT autoincrement
- **Campos:** `username` (UNIQUE), `display_name`, `password_hash`, `is_active`, `must_change_password`.
- **Modelo:** [`app/models/auth.py:User`](../backend/app/models/auth.py)

**El usuario se conecta a la organización por 2 relaciones N–N:**

| Tabla | Lo que define |
|---|---|
| `user_roles` (User × Role) | **Qué puede hacer.** Un user puede tener varios roles; uno marcado como `is_primary`. Los permisos efectivos son la unión de los permisos de todos sus roles. |
| `user_branches` (User × Branch) | **Dónde puede operarlo.** Un user puede tener acceso a varias sucursales (típico de un admin); una marcada `is_primary` (default visual al loguearse). |

### Entidad transversal · Employee (empleado)

- **Tabla:** `employees`
- **Modelo:** [`app/models/employees.py`](../backend/app/models/employees.py)
- **No es lo mismo que User.** Diferencia:
  - **User** = identidad de login para usar la app.
  - **Employee** = persona física que trabaja en la empresa (con o sin acceso al sistema).
- **Conexión opcional:** `employees.user_id → users.id` (SET NULL). Puede haber empleados sin usuario (ej. operarios sin cuenta) y users sin employee (ej. usuario técnico).
- **Conexión organizacional:** `company_id`, `branch_id` (pertenencia administrativa), `work_branch_id` (dónde efectivamente trabaja, puede diferir).

## Las reglas no negociables

### R1 · Ninguna entidad transaccional vive fuera de la jerarquía

Toda fila de garantía, remito, venta, presupuesto, recibo, etc. debe tener:

- `company_id` (obligatorio en negocio, técnicamente nullable en algunos casos legacy → a corregir)
- `branch_id` (la sucursal/depósito donde se generó la operación)
- `created_by_user_id` (FK a `users.id`, SET NULL — preserva historial si el user se elimina)

Si un módulo nuevo no respeta esto, está mal diseñado: los filtros de scope, KPIs por sucursal, reportes multi-empresa y auditoría dependen de estos 3 campos.

### R2 · Los permisos se chequean en backend Y en frontend

- **Backend** (autoridad): cada endpoint hace `require_permission("clave")` o `require_any("...", "...")`.
- **Frontend** (UX): los menús, botones y secciones se ocultan con `can("clave")`. **No se asume seguridad en el frontend** — solo se evita mostrar acciones imposibles.

Si querés que algo sea visible para un rol, **agregás el permiso a `DEFAULT_ROLES[rol].permissions`**, no metés un `if user.role === 'X'` en el frontend.

### R3 · El scope de datos lo aplica el backend, no el frontend

Cuando una query devuelve garantías/ventas/etc., **el backend filtra por las branches del usuario** (a menos que tenga un permiso cross como `branches.cross_select` o sea SUPERADMIN). El frontend recibe solo lo que puede ver.

Esto evita "fugas" por descuido: un vendedor de Caseros no puede ver las garantías de Lanús aunque manipule la URL.

### R4 · Las claves de relación son las PK reales, no texto libre

| Mal | Bien |
|---|---|
| `guarantee.sucursal = "Caseros"` (string) | `guarantee.branch_id = "caseros"` (FK) |
| `user.role = "VENDEDOR"` (string en JSON) | `user_roles` (tabla con FK a `roles.id`) |
| `remito.created_by = "vlevitas"` (username) | `remito.created_by_user_id = 1` (FK) |

Los textos legibles (`sucursal`, `responsable_name`) se conservan **solo para display** y se rehidratan vía JOIN cuando hace falta. La verdad operativa son las FKs.

### R5 · Si una entidad cambia de nombre, no se pierde nada

Como las PKs son slugs/IDs (no nombres), renombrar "Caseros" a "Caseros Centro" se hace en `branches.name` y todas las garantías históricas siguen apuntando al mismo `branch_id = "caseros"`. Sin migraciones de datos, sin link roto.

## Cómo arranca todo desde cero (seed)

Script: [`backend/app/seed.py`](../backend/app/seed.py)
Comando: `docker compose exec backend python -m app.seed`

Orden de creación (importante, las dependencias se respetan):

1. **Companies** (2 empresas: GV, ABC).
2. **Branches** (11 sucursales: físicas → web → depósitos, en ese orden por `parent_branch_id`).
3. **Roles** (los `DEFAULT_ROLES` de `permissions.py`).
4. **Admin user** con rol SUPERADMIN y acceso a todas las 11 branches.

El seed es **idempotente** (puede correrse varias veces sin duplicar). Si agregás una empresa o branch nueva al seed, la próxima corrida la crea sin tocar lo existente.

## Mapa: módulo → conexión con la fundación

| Módulo | company_id | branch_id | user_id | Notas |
|---|---:|---:|---:|---|
| Garantías | ✅ | ✅ (`branch_id` + `sucursal_responsable_id`) | ✅ (5 FKs distintas: responsible, created_by, updated_by, reviewed_by, cancelled_by) | El más conectado. |
| Remitos | ✅ (vía company_brand) | ✅ (`origen_branch_id` + `destino_branch_id`) | ✅ (3 actores: created, despachado_por, recibido_por) | Movimientos físicos entre branches. |
| Ventas web | ✅ (vía branch) | ✅ | ✅ (`vendedor_user_id`, `taken_by`, `completed_by`, etc.) | — |
| Sales BI | ✅ | ✅ | — | Importes históricos, no necesita actores. |
| Recibos de sueldo | ❌ (vía employee) | ❌ (vía employee) | ✅ (`uploaded_by_user_id`, `signed_by_user_id`) | El alcance lo da el `employee`. |
| Notificaciones | — | — | ✅ (FK user) | Targeted al usuario. |
| Jobs / Auditoría | — | — | ✅ (`actor_user_id`) | Auditoría global, no por scope. |

## Pendientes detectados (gaps actuales)

Estos puntos rompen la fundación parcialmente. Se documentan acá para Fase C (auditoría) y posibles refactors:

1. **Garantías sin `company_id`.** El modelo `Guarantee` declara `company_id` nullable. Si un alta histórica no setea esa columna, queda huérfana del scope multi-empresa. Pendiente: validar que `pg_insert_guarantee` siempre lo setea y backfill de filas legacy.
2. **Display strings duplicando FKs.** Garantías mantiene `sucursal` (texto legible) además de `branch_id` (FK). Útil para display rápido sin JOIN, pero hay que asegurarse de que se actualicen en sincronía si se renombra la branch.
3. **Catálogo de permisos sin auditoría.** Si alguien agrega/quita una clave de `ALL_PERMISSIONS` y no actualiza los roles, queda "permiso huérfano" o "permiso faltante". Pendiente: agregar test/validador que compare claves de roles contra catálogo.
4. **`branch_type` no chequeado en operaciones.** Algunos endpoints aceptan cualquier branch como `origen_sucursal` sin validar `type`. Ejemplo: un remito sucursal→depósito no debería poder originarse de una branch tipo `deposit`. Validación está distribuida y a veces redundante. Pendiente: centralizar en un helper.

## Referencias rápidas

- Modelos ORM: [`app/models/org.py`](../backend/app/models/org.py), [`app/models/auth.py`](../backend/app/models/auth.py), [`app/models/employees.py`](../backend/app/models/employees.py)
- Catálogo de permisos y roles: [`app/permissions.py`](../backend/app/permissions.py)
- Seed inicial: [`app/seed.py`](../backend/app/seed.py)
- Endpoints de admin (users, roles, audit): [`app/routers/admin.py`](../backend/app/routers/admin.py)
- Endpoints de organización (companies, branches): [`app/routers/organization.py`](../backend/app/routers/organization.py)
- Frontend del scope: [`frontend/src/branchAccess.ts`](../frontend/src/branchAccess.ts), [`frontend/src/warrantyAccess.ts`](../frontend/src/warrantyAccess.ts)
- Modelo de datos completo: [`docs/fase-2-postgres/01-modelo-datos.md`](fase-2-postgres/01-modelo-datos.md)
