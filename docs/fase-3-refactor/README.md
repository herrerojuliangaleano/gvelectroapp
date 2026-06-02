# Fase 3 — Refactor estructural + limpieza

> **Estado:** en curso. Empieza después del cierre de Fase 2 (PostgreSQL),
> cuando el código quedó funcional pero con deuda técnica acumulada de la
> migración: archivos gigantes, páginas de configuración duplicadas y wrappers
> legacy sin uso.

## Objetivo

Hacer el código mantenible y escalable sin tocar funcionalidad. Tres sub-fases
encadenadas, deprecated-first (no se borra de un día para otro):

| Sub-fase | Estado | Documento |
|---|---:|---|
| A · Consolidación de páginas de configuración | ✅ | [A-consolidacion-config.md](A-consolidacion-config.md) |
| A.5 · Cerrar gaps de la fundación (permisos, company_id, branch_type, direcciones, renames) | ✅ parcial | [A5-gaps-fundacion.md](A5-gaps-fundacion.md) |
| B · Partir routers grandes en sub-módulos | ✅ completo (warranties, payroll, remitos, sales_web, budgets y price_cost_updates) | [B-division-routers.md](B-division-routers.md) |
| C.0 · Fundación de acceso, permisos y scope | ✅ completo | [C0-fundacion-acceso-scope.md](C0-fundacion-acceso-scope.md) |
| C · Auditoría intensa de código muerto y redundancias | ⏳ pendiente | — |
| **C.1 · Eliminar columnas cache duplicadas** (postergada de A.5.4) | ⏳ post-B | ver A5-gaps-fundacion.md sección A.5.4 |

## Política

- **Deprecated-first.** Nada se borra directo. Lo redundante o sin uso se
  marca con `@deprecated` + comentario explicando por qué y a dónde se movió.
- **Una sola pasada de borrado final** al cierre de Fase C, después de
  validar que nada externo lo consume.
- **Backwards compat de URLs.** Las rutas viejas redirigen a las nuevas con
  `<Navigate>` para no romper bookmarks ni links externos.
- **No tocar funcionalidad.** Si un refactor obliga a cambiar comportamiento,
  se documenta como decisión aparte (no se mezcla con el refactor).

## Por qué Fase 3 después de Fase 2

La migración a PostgreSQL (Fase 2) dejó:

- `routers/warranties.py` con 5286 líneas porque se portó endpoint por
  endpoint sin reestructurar.
- Páginas de configuración fragmentadas (3 pantallas separadas con campos
  solapados que podían desincronizarse).
- Helpers wrappers que ya no usaba nadie.
- Comentarios `# DEPRECATED — Fase X` esperando ser barridos.

Fase 3 limpia todo eso sin tocar el comportamiento que el usuario ya validó.

## Cuándo arrancar Fase B

Cuando se confirme operativamente que Fase A no rompió nada (UI de
configuración funciona, redirects andan, embedding se ve bien). El usuario
valida en su entorno y avisa.
