# Fase 3.C.0 - Fundacion de acceso, permisos y scope

**Estado:** [HECHO] implementado, documentado y validado en Docker.

## Objetivo

Antes de borrar codigo muerto de Fase C, se centraliza la logica sensible de
acceso: usuario activo, permisos, roles, sucursales asignadas y depositos. Esto
evita que cada modulo ERP tenga su propia forma de decidir quien puede ver,
editar, mover o recibir informacion.

## Modulo nuevo

`backend/app/access.py` es la fuente comun para:

- `ensure_active_user(user)`: bloquea acciones protegidas si el usuario debe
  cambiar password.
- `user_has(user, permission)` y `user_has_any(...)`: chequeo de permisos con
  soporte uniforme para wildcard `*`.
- `require_any_permission(...)`: validacion FastAPI para endpoints que aceptan
  mas de un permiso.
- `user_role_keys(user)` e `is_superadmin(user)`: roles normalizados.
- `can_cross_branch(user)`: alcance multi-sucursal/deposito.
- `assigned_branches(user, type=None)`, `assigned_deposit_names(user)` y
  `resolve_deposit_name(user, requested=None)`: scope operativo por branch.
- `users_with_permission(...)`: seleccion de destinatarios para notificaciones.

## Modulos actualizados

- `auth.py`: `require_permission()` usa `ensure_active_user()` y `user_has()`.
- `remitos/`: se removieron helpers locales de permisos/depositos y se usa
  `access.py` para permisos, deposito asignado y cross-branch.
- `payroll/`: se reemplazo `_require_any` por `require_any_permission()`.
- `price_cost_updates/`: se reemplazo `can_user` y busqueda local de usuarios
  por `user_has()` y `users_with_permission()`.
- `sales_web/`: los administradores/notificaciones y el scope por sucursal usan
  `branch_id` como preferido y `sucursal` como fallback legacy.
- `warranties/`: roles, operador de deposito y notificaciones de gestores pasan
  por la fundacion compartida cuando coinciden con la regla general.

## Decisiones

- **No cambia API publica.** Rutas, payloads y responses del frontend se
  mantienen.
- **No cambia schema.** No hay migraciones ni tablas nuevas.
- **Scope preferido:** `branch_id`; si no existe, fallback por nombre/codigo de
  sucursal para datos legacy.
- **Wildcard:** `*` vale igual en todos los modulos que pasan por `access.py`.
- **Cross-branch:** se permite por `branches.cross_select`, superadmin o permisos
  operativos privilegiados ya existentes.

## Validacion realizada

- `python -m compileall -q backend/app` en host.
- `python -m compileall -q app` dentro de Docker.
- `python -c "import app.main"` dentro de Docker.
- Conteo de rutas sin cambios:
  - warranties: 43
  - payroll: 10
  - remitos: 16
  - sales_web: 11
  - budgets: 3
  - price_cost_updates: 8
- Script corto de `access.py` con usuario fake: `user_has`, `user_has_any`,
  `can_cross_branch`, `assigned_deposit_names` y `resolve_deposit_name`.
- Smoke con admin:
  - `GET /api/sales-web/requests?limit=5` -> 200
  - `GET /api/price-cost-updates?limit=5` -> 200
  - `GET /api/warranties/remitos/?limit=5` -> 200
  - `GET /api/payroll/receipts?limit=5` -> 200
  - `GET /api/warranties/list` -> 200

## Proximo paso

Con C.0 cerrado, el siguiente bloque recomendado es **C.1 / A.5.4**: eliminar
columnas cache duplicadas de garantias/remitos y resolver display strings via
JOIN contra `branches`.
