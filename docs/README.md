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
12. [11 - Comercial BI · Vendedores, métricas y matching](11-comercial-bi-vendedores.md)
13. [12 - Comercial BI - Marcas, lineas y sucursales](12-comercial-bi-marcas-lineas-sucursales.md)
14. [13 - Integración Mobile con Puma Software](13-integracion-mobile-puma.md)
15. [14 - Tabla intermedia (outbox) Puma](14-tabla-intermedia-puma.md)
16. [15 - Módulo Maestro / Alta / Normalización de Productos](15-modulo-maestro-productos.md)
17. [16 - Patrones de descripción de productos](16-patrones-descripcion-productos.md)
18. [17 - Modelo de datos: MER + Normalización](17-modelo-datos-mer.md)
19. [18 - Diccionario de datos detallado](18-diccionario-datos.md)
20. [19 - Análisis de la base de datos (seguridad, escalabilidad, saneamiento)](19-analisis-bd-escalabilidad-seguridad.md)
21. [20 - Subsistema de archivos (object storage)](20-subsistema-archivos-object-storage.md)
22. [21 - Relevamiento de mejoras (backlog priorizado)](21-relevamiento-mejoras.md)
23. [22 - BI Comercial - PowerPoint de marca 2.0](22-bi-comercial-powerpoint-marca-2.md)

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
| Comercial BI · vendedores, métricas y matching | [11-comercial-bi-vendedores.md](11-comercial-bi-vendedores.md) |
| Comercial BI - marcas, lineas y sucursales | [12-comercial-bi-marcas-lineas-sucursales.md](12-comercial-bi-marcas-lineas-sucursales.md) |
| Integracion Mobile / Puma | [13-integracion-mobile-puma.md](13-integracion-mobile-puma.md) |
| Tabla intermedia (outbox) Puma | [14-tabla-intermedia-puma.md](14-tabla-intermedia-puma.md) |
| Maestro / Alta / Normalizacion de productos | [15-modulo-maestro-productos.md](15-modulo-maestro-productos.md) |
| Patrones de descripcion de productos | [16-patrones-descripcion-productos.md](16-patrones-descripcion-productos.md) |
| Modelo de datos (MER + normalizacion) | [17-modelo-datos-mer.md](17-modelo-datos-mer.md) · [18-diccionario-datos.md](18-diccionario-datos.md) |
| Analisis BD (seguridad / escalabilidad / saneamiento) | [19-analisis-bd-escalabilidad-seguridad.md](19-analisis-bd-escalabilidad-seguridad.md) |
| Subsistema de archivos (object storage) | [20-subsistema-archivos-object-storage.md](20-subsistema-archivos-object-storage.md) |
| Relevamiento de mejoras (backlog priorizado) | [21-relevamiento-mejoras.md](21-relevamiento-mejoras.md) |
| BI Comercial - PowerPoint de marca 2.0 | [22-bi-comercial-powerpoint-marca-2.md](22-bi-comercial-powerpoint-marca-2.md) |
| Docker local | [fase-1-docker/README.md](fase-1-docker/README.md) |
| Modelo de datos historico (Fase 2 · superado por 17/18) | [fase-2-postgres/01-modelo-datos.md](fase-2-postgres/01-modelo-datos.md) |
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
