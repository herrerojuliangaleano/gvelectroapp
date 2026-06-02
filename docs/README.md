# Documentacion - ElectroGV

Este directorio es la fuente de verdad del proyecto. Reune la documentacion
funcional, tecnica y operativa necesaria para que una persona, Codex o Claude
Code puedan entender la aplicacion sin depender de memoria oral.

## Lectura recomendada

1. [00 - Guia del proyecto](00-guia-proyecto.md)
2. [01 - Manual funcional](01-manual-funcional.md)
3. [02 - Guia tecnica para desarrollo y agentes](02-guia-tecnica-agentes.md)
4. [03 - Referencia de API](03-api-endpoints.md)
5. [04 - Protocolo de continuidad para agentes](04-protocolo-agentes.md)
6. **[05 - Fundación organizacional](05-fundacion-organizacional.md)** · Jerarquía Empresa → Sucursal → Rol → Permiso → Usuario. **Léelo antes de tocar cualquier módulo de operación.**

7. [06 - Integracion ERP - Ventas](06-integracion-erp-ventas.md)
8. [07 - Produccion local con Vercel + ngrok](07-produccion-local-vercel-ngrok.md)
9. [08 - Android con Capacitor](08-android-capacitor.md)
10. [09 - Import histórico de garantías desde Excel](09-import-historico-excel.md)
11. [10 - Módulo Comercial · Fase 1 (PSI con cruce al GFK)](10-modulo-comercial-fase1.md)

## Documentacion por fases

| Fase | Estado | Documento |
|---|---:|---|
| Fase 1 - Docker | Hecho | [fase-1-docker/README.md](fase-1-docker/README.md) |
| Fase 2 - PostgreSQL + SQLAlchemy + Alembic | Hecho | [fase-2-postgres/README.md](fase-2-postgres/README.md) |
| Fase 3 - Refactor estructural + limpieza | En curso | [fase-3-refactor/README.md](fase-3-refactor/README.md) |
| Fase futura - Deploy VPS | Planificado | [fase-2-postgres/03-deploy-vps.md](fase-2-postgres/03-deploy-vps.md) |

## Mapa rapido

| Area | Donde mirar |
|---|---|
| Arquitectura general | [00-guia-proyecto.md](00-guia-proyecto.md) |
| Como usar la aplicacion | [01-manual-funcional.md](01-manual-funcional.md) |
| Stack, carpetas, comandos | [02-guia-tecnica-agentes.md](02-guia-tecnica-agentes.md) |
| Rutas del backend | [03-api-endpoints.md](03-api-endpoints.md) |
| Handoff Codex / Claude Code | [04-protocolo-agentes.md](04-protocolo-agentes.md) |
| **Empresa / Sucursal / Rol / Permiso / Usuario** | **[05-fundacion-organizacional.md](05-fundacion-organizacional.md)** |
| Integracion ERP para ventas | [06-integracion-erp-ventas.md](06-integracion-erp-ventas.md) |
| Produccion inicial Vercel + ngrok | [07-produccion-local-vercel-ngrok.md](07-produccion-local-vercel-ngrok.md) |
| Android / Capacitor | [08-android-capacitor.md](08-android-capacitor.md) |
| Import histórico de garantías (Excel → Postgres) | [09-import-historico-excel.md](09-import-historico-excel.md) |
| Módulo Comercial · PSI + cruce al GFK (Fase 1) | [10-modulo-comercial-fase1.md](10-modulo-comercial-fase1.md) |
| Docker local | [fase-1-docker/README.md](fase-1-docker/README.md) |
| Modelo de datos futuro en Postgres | [fase-2-postgres/01-modelo-datos.md](fase-2-postgres/01-modelo-datos.md) |
| Administracion de base de datos | [fase-2-postgres/02-administracion-db.md](fase-2-postgres/02-administracion-db.md) |
| Refactor estructural (Fase 3) | [fase-3-refactor/README.md](fase-3-refactor/README.md) |

## Convenciones

- Documentar cambios grandes en la carpeta de fase correspondiente.
- Actualizar el manual funcional cuando se agregue, quite o cambie un flujo de usuario.
- Actualizar la referencia de API cuando se agregue, quite o cambie un endpoint.
- No guardar secretos reales en la documentacion.
- Para agentes de codigo, empezar siempre por `00-guia-proyecto.md` y
  `02-guia-tecnica-agentes.md`.
- Para cierres de turnos importantes y handoffs entre Codex/Claude Code, usar
  `04-protocolo-agentes.md`.
