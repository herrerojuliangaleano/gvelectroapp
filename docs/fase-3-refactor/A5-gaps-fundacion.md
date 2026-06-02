# Fase 3.A.5 — Gaps de fundación (cerrado parcial)

**Estado:** ✅ 4 de 5 sub-tareas cerradas. La sub-tarea de display strings (C)
se posterga para después de Fase B (partir warranties.py).

## Contexto

Después de cerrar Fase A (consolidación de páginas de configuración), antes
de avanzar a Fase B (partir warranties.py), el usuario decidió arreglar primero
los **gaps detectados en el doc de fundación** (ver
[`docs/05-fundacion-organizacional.md`](../05-fundacion-organizacional.md),
sección "Pendientes detectados").

Los 4 gaps originales + 1 nuevo (renombres + direcciones), todos cerrados acá
salvo el último (C) que se posterga.

## Sub-tareas

### A.5.1 — Validador catálogo de permisos vs roles ✅

**Problema:** si alguien agregaba/quitaba una clave de `ALL_PERMISSIONS` y
olvidaba actualizar los roles, quedaban "permisos huérfanos" en DB o claves
mal escritas en `DEFAULT_ROLES`. No había forma de detectarlo automático.

**Solución:**
- Función `validate_permissions_catalog()` en [`app/permissions.py`](../../backend/app/permissions.py).
- Devuelve 5 categorías: `orphan_in_defaults` (typos en código), `orphan_in_db` (huérfanos en DB), `unused_explicit` (declarados sin uso), `unused_wildcard_only` (cubiertos solo por `*`, informativo), `has_wildcard_role`.
- Helper `has_real_issues()` distingue errores reales (orphan_*, unused_explicit) de info (cubierto por wildcard).
- Conectado al lifespan de [`app/main.py`](../../backend/app/main.py): si hay errores reales, deja un warning legible en el log al arrancar.
- **Política:** no falla el arranque. Solo notifica.

**Resultado actual:** 0 errores. 17 claves marcadas `unused_wildcard_only`
(cubiertas por SUPERADMIN con `*`) — son informativas, no son bug.

### A.5.2 — `Guarantee.company_id` NOT NULL ✅

**Problema:** la columna era `nullable=True`. Si un user no tenía company asignada, la garantía quedaba huérfana del scope multi-empresa.

**Solución:**
- Mejora en [`pg_insert_guarantee`](../../backend/app/warranties_db.py): si `company_id` no viene explícito, se deriva de:
  1. La branch de carga (`sucursal_carga_branch_id`)
  2. La branch responsable (`sucursal_responsable_id`)
  3. Si ninguna funciona → `ValueError` con mensaje claro.
- Modelo cambia a `nullable=False`.
- Migración Alembic [`20260531_0002_guarantee_company_not_null.py`](../../backend/alembic/versions/20260531_0002_guarantee_company_not_null.py): backfill defensivo (intenta derivar de branch/responsable) + abort con error si quedan NULL.

### A.5.3 — Validación centralizada de `branch_type` ✅

**Problema:** las verificaciones de tipo de branch (`physical` vs `deposit`) estaban distribuidas en muchos endpoints con patterns distintos (string compare, dict lookup, etc.).

**Solución:**
- Módulo nuevo [`app/branches_db.py`](../../backend/app/branches_db.py) sigue el patrón `*_db.py`.
- Helpers: `get_branch()`, `get_branch_by_name_or_code()`, `assert_branch_type(branch_id, expected_types, label)`, `assert_different_branches(o, d)`.
- Constante `VALID_BRANCH_TYPES = {"physical", "web", "deposit", "admin"}`.
- **No se aplica masivamente todavía:** el reemplazo en los ~10-15 endpoints se hace en Fase B (cuando los routers se partan, será más fácil).

### A.5.4 — Display strings duplicados → **postergado a post-Fase B**

**Problema:** `Guarantee.sucursal`, `sucursal_responsable`, `deposito`, `lugar_llegada` y `Remito.origen_sucursal`, `destino_deposito` son cache de strings duplicando FKs. Si renombrás una branch, los datos viejos no se sincronizan.

**Decisión del usuario:** opción **C — eliminar columnas cache** (schema limpio, JOIN siempre). Posibilitado por no tener datos a preservar.

**Posterga:** se hace después de Fase B porque requiere refactorear ~10-15 endpoints de `warranties.py`, y con el archivo monolítico de 5286 líneas el riesgo es alto. Una vez partido en sub-routers, será trivial.

**Alcance final** (para referencia):
- 6 columnas a eliminar (4 en `Guarantee`, 2 en `Remito`).
- `sucursal_code` se queda (es identificador estable para generar `warranty_code`).
- Mappers `_guarantee_to_dict` y `_remito_to_legacy_dict` se modifican para devolver los strings vía JOIN con `branches`.
- Frontend **no cambia** (dicts siguen con las mismas keys).

### A.5.5 — Renombres + direcciones (nuevo) ✅

**Pedido del usuario:**
- Renombrar `Norte` → `Norcenter` y `Sur` → `Lanús` (con sus respectivas variantes WEB).
- Agregar campos `direccion` (física) y `direccion_fiscal` (puede diferir de la física, típico en WEB para facturación).

**Solución:**
- **Modelo [`app/models/org.py`](../../backend/app/models/org.py):** + 2 columnas `direccion` y `direccion_fiscal` (TEXT NOT NULL DEFAULT '').
- **Migración Alembic [`20260531_0003_branch_direcciones_renames.py`](../../backend/alembic/versions/20260531_0003_branch_direcciones_renames.py):**
  - `ADD COLUMN direccion` + `direccion_fiscal`.
  - `UPDATE branches SET name=..., code=...` por slug para los 4 renames (incluyendo variantes WEB).
- **Seed [`app/seed.py`](../../backend/app/seed.py):** actualizado con los nuevos `name` y `code`.
- **API [`app/routers/organization.py`](../../backend/app/routers/organization.py):** `BranchPayload`, `BranchPatchPayload`, `BranchOut` y `_branch_to_dict` soportan los 2 campos nuevos. Create y patch endpoints los aplican.
- **Frontend [`CompaniesBranchesPage.tsx`](../../frontend/src/pages/CompaniesBranchesPage.tsx) + `types/index.ts`:** form de sucursal tiene los 2 inputs nuevos (dirección física + dirección fiscal).

**Importante:** los **slugs (PK)** NO cambian. `norte` sigue siendo `norte` (FK estable). Solo cambian `name` (display) y `code` (sigla en reportes).

| slug (PK estable) | name anterior | name nuevo | code nuevo |
|---|---|---|---|
| `norte` | Norte | **Norcenter** | NORCENTER |
| `norte_web` | Norte - WEB | **Norcenter - WEB** | NORCENTER_WEB |
| `sur` | Sur | **Lanús** | LANUS |
| `sur_web` | Sur - WEB | **Lanús - WEB** | LANUS_WEB |

## Validación

- `tsc --noEmit` sobre el frontend → OK.
- `py_compile` sobre `permissions.py`, `main.py`, `branches_db.py`, `warranties_db.py`, `models/org.py`, `models/warranties.py`, `seed.py`, `routers/organization.py` y las 2 migraciones nuevas → OK.
- Validador de permisos correrá en el siguiente startup del backend.
- Migraciones se aplican con `docker compose exec backend alembic upgrade head`.

## Próximos pasos

1. **Aplicar las migraciones**: el usuario debe correr `alembic upgrade head` y `python -m app.seed` para que los renames + direcciones tomen efecto.
2. **Smoke test**: confirmar en la UI que las nuevas tabs/campos funcionan y que los validadores no rompen.
3. **Fase B**: partir `warranties.py` en sub-routers.
4. **Después de Fase B**: hacer A.5.4 (eliminar columnas cache duplicadas).
