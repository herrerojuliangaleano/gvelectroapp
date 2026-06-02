# Fase 3.A — Consolidación de páginas de configuración

**Estado:** ✅ cerrada (2026-05-31, sin migración de datos requerida).

## Problema

Antes existían **3 páginas de configuración separadas** con campos solapados:

- `/settings` · `SettingsPage` (113 líneas) — flags backend + push notifications.
- `/admin/operational-config` · `OperationalConfigPage` (371 líneas, 10 tabs) — config global de todos los módulos.
- `/warranties/config` · `WarrantyConfigPage` (197 líneas) — config específica del módulo Garantías.
- `/admin/google` · `GoogleAdminPage` (191 líneas) — credenciales OAuth Google (SUPERADMIN).

**Solapamientos detectados:**

- `OperationalConfig > tab Garantías` y `WarrantyConfigPage` editaban ambos `sucursales`, `depositos`, `raw_sheet`, `spreadsheet_url`. Riesgo de desincronización.
- `OperationalConfig > tab Google` (URLs Sheets) convivía con `GoogleAdminPage` (OAuth) sin enlace claro entre ambas.
- `SettingsPage` mostraba flags ya visibles en el "Resumen" de OperationalConfig + un único panel de push notifications.

## Decisión

**Una sola página de configuración**: `OperationalConfigPage` consolidada con tabs nuevas. Las páginas anteriores quedan exportadas como componentes embebibles (no se borran, política deprecated-first).

## Cambios aplicados

### Frontend

| Archivo | Cambio |
|---|---|
| `frontend/src/pages/SettingsPage.tsx` | + prop `embedded?: boolean`. Header grande oculto cuando `embedded`. Marcada `@deprecated`. |
| `frontend/src/pages/WarrantyConfigPage.tsx` | + prop `embedded`. Header `<h1>` y badge "Configuración avanzada" ocultos cuando `embedded`. Marcada `@deprecated`. |
| `frontend/src/pages/GoogleAdminPage.tsx` | + prop `embedded`. Header `<h1>` oculto + `max-w-6xl` removido cuando `embedded`. Marcada `@deprecated`. |
| `frontend/src/pages/OperationalConfigPage.tsx` | Nuevas tabs `'sistema'`, `'oauth'`. Tab `'garantias'` ahora renderiza `<WarrantyConfigPage embedded />`. Tab existente `'google'` renombrada visualmente a "Sheets". Soporte de `?tab=X` en URL con `useSearchParams` para deep-link. |
| `frontend/src/App.tsx` | `/settings`, `/warranties/config`, `/warranties/configuracion`, `/admin/google` ahora son `<Navigate>` a la tab correspondiente. Bookmarks viejos siguen funcionando. |
| `frontend/src/layouts/AppLayout.tsx` | Sidebar: entrada "Configuración" del módulo Garantías ahora apunta a `/admin/operational-config?tab=garantias`. Entradas "Google" y "Config. técnica" del bloque Administración eliminadas. "Config. operativa" renombrada a "Configuración". |

### Backend

**Sin cambios.** Los endpoints permanecen idénticos:

- `/api/config/status` (lo usa SettingsPage embebida)
- `/api/admin/operational-config/*` (lo usa OperationalConfigPage)
- `/api/admin/google/*` (lo usa GoogleAdminPage embebida)
- `/api/warranties/config` (lo usa WarrantyConfigPage embebida)

El backend no necesitó tocarse porque las páginas embebidas siguen pegando a los mismos endpoints; lo único que cambió es la presentación en el frontend.

## Estructura final de tabs en `/admin/operational-config`

| Tab | Origen | Contenido |
|---|---|---|
| Resumen | OpConfig original | Cards de estado por módulo |
| **Sistema** *(nueva)* | embebe `SettingsPage` | Flags backend + push notifications |
| Sheets | OpConfig original (renombrada de "Google") | URLs de Google Sheets por módulo |
| **OAuth Google** *(nueva)* | embebe `GoogleAdminPage` | Credenciales + token + reconectar (SUPERADMIN) |
| Productos | OpConfig original | Catálogo + sync Sheet |
| **Garantías** *(reemplazada)* | embebe `WarrantyConfigPage` | Statuses, sucursales, depósitos, delay_ranges, required_review_fields + métricas |
| Ventas / Presupuestos / Precios y costos / Recibos / Herramientas / Auditoría | OpConfig original | Sin cambios |

## Redirects (backwards compat)

| URL vieja | URL nueva |
|---|---|
| `/settings` | `/admin/operational-config?tab=sistema` |
| `/admin/google` | `/admin/operational-config?tab=oauth` |
| `/warranties/config` | `/admin/operational-config?tab=garantias` |
| `/warranties/configuracion` | `/admin/operational-config?tab=garantias` |

## Validación

- `tsc --noEmit` sobre el frontend completo → OK, sin errores.
- Visual: confirmar en el navegador que las 3 nuevas tabs renderizan bien embebidas (sin doble header, sin layout roto).
- Bookmarks viejos: navegar a `/settings`, `/admin/google`, `/warranties/config` y verificar que redirigen a la tab correcta.

## Lo que queda para Fase C (auditoría final)

Los 3 archivos marcados `@deprecated`:

- `frontend/src/pages/SettingsPage.tsx`
- `frontend/src/pages/WarrantyConfigPage.tsx`
- `frontend/src/pages/GoogleAdminPage.tsx`

**No borrar directo** porque siguen siendo el origen del código que se renderiza dentro de las tabs. Cuando Fase C audite, decidir:

1. Mover el contenido inline a `OperationalConfigPage.tsx` y borrar los archivos.
2. O moverlos a `frontend/src/pages/operational-config/` como sub-componentes explícitamente "embed-only".

Decisión postergada hasta que Fase B (partir `warranties.py`) termine y se vea el patrón general.

## Próximas sub-fases (Fase 3)

- **B · Partir `routers/warranties.py` (5286 líneas).** Dividir por dominios: intake / review / provider / lifecycle / exports / sync / config / reset. Cada uno en su archivo dentro de `app/routers/warranties/`. Reexportar router unificado en `__init__.py`. Smoke test por bloque.
- **C · Auditoría intensa de código muerto y redundancias.** Listar funciones/componentes huérfanos cross-archivo, marcar como deprecated, identificar duplicaciones, y hacer una pasada única de borrado final con backup en git.
