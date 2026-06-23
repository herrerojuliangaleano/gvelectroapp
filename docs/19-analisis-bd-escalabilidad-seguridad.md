# 19 — Análisis de la base de datos: ciberseguridad, escalabilidad, saneamiento y normalización

> Auditoría del esquema (52 tablas) y del código que lo rodea, hecha **sobre el
> código real** (modelos en `backend/app/models/`, `db.py`, `security.py`,
> `auth.py`, `access.py`, migraciones Alembic). Complementa a
> [`17-modelo-datos-mer.md`](17-modelo-datos-mer.md) y
> [`18-diccionario-datos.md`](18-diccionario-datos.md).

## Veredicto general

**La base es sólida y escalable para el tamaño actual y el mediano plazo.** No
hay fallas graves. Lo bien hecho: hashing de contraseñas fuerte, ORM
parametrizado (sin inyección SQL), FKs reales con políticas de borrado claras,
modelo de permisos + alcance por sucursal, normalización en 3FN con
desnormalizaciones **intencionales y documentadas**, y backups automáticos.

Lo que conviene atender, por prioridad, está abajo. La mayoría es **hardening y
preparación para crecer**, no arreglos de urgencia.

## Hallazgos priorizados

| # | Sev. | Dimensión | Hallazgo | Acción |
|---|---|---|---|---|
| 1 | 🟠 Media | Seguridad | `AUTH_SECRET` tiene default `"dev-secret-change-me"` en el código. En prod está bien seteado (verificado), pero nada impide deployar con el default → tokens forjables. | Que la app **aborte al iniciar** si el secreto es el default fuera de dev. |
| 2 | 🟠 Media | Seguridad | Token JWT propio dura **30 días** (`auth_token_hours=720`), HMAC stateless, **sin revocación**. Un token filtrado vale 30 días; el logout no lo invalida del lado servidor. | TTL más corto + refresh, o `token_version`/jti revocable. Mínimo: invalidar al cambiar contraseña. |
| 3 | 🟠 Media | Seguridad | El **alcance por sucursal/empresa se aplica en la app** (permisos + `user_branches` + `can_cross_branch`), no en la DB. Un filtro olvidado en una query = fuga entre sucursales. | Tests de scope sistemáticos; evaluar **RLS de Postgres** en tablas sensibles (garantías, recibos, ventas). |
| 4 | 🟠 Media | Saneamiento | **Casi no hay `CHECK` en la DB** (2 en total). Estados/enums se validan solo en la app (decisión consciente para evolucionar sin migración). Una escritura directa o un bug puede dejar estados inválidos. | `CHECK` para los enums **estables** (ej. `condicion ∈ {PRIMERA,OUTLET}`); el resto, dejarlo documentado como tradeoff. |
| 5 | 🟠 Media | Saneamiento | **Validación de input despareja**: varios routers usan pydantic; otros (catálogo, tools) reciben `dict[str, Any]` crudo. | Schemas pydantic en los endpoints que hoy toman dict suelto. |
| 6 | 🟠 Media | Escalabilidad | Las **agregaciones del BI se hacen en Python** (`build_sellers_report` carga todas las filas y suma en memoria). Anda hoy; no escala a cientos de miles de filas. | Mover agregaciones a **SQL (`GROUP BY`)** cuando el volumen crezca. |
| 7 | 🟡 Media‑baja | Escalabilidad | Índices: muchos de **una sola columna**, pocos **compuestos**. Las consultas calientes filtran por fecha + sucursal + vendedor. | Índices compuestos: `sales_imports(branch_id, fecha)`, `sales_records(import_id, vendedor_normalized)`, etc. |
| 8 | 🟡 Media‑baja | Seguridad | **PII sin cifrar en reposo**: DNI, email, teléfono, domicilio, recibos de sueldo (PDF), datos de clientes → texto plano (solo la contraseña está hasheada). | Cifrado de disco del volumen DB + acceso restringido + backups cifrados; cifrado por columna solo si una normativa lo exige. |
| 9 | 🟢 Baja | Escalabilidad | Tablas de **crecimiento ilimitado**: `sales_records`, `sales_bi_commercial_records`, `app_events`, `guarantee_history`, `notifications`, `catalog_change_log`. | A futuro: archivado o particionado por fecha. No urge. |
| 10 | 🟢 Baja | Saneamiento | **Texto legacy junto a la FK** (`sucursal` + `branch_id`, `vendedor` + `seller_user_id`, etc.) puede divergir. Es deliberado (compat) pero es deuda. | Plan para retirar los textos de display cuando el porting cierre. |
| 11 | 🟢 Baja | Escalabilidad | Una sola instancia para OLTP + analítica; pool sin `pool_recycle`. | Read replica para BI cuando la carga lo justifique; agregar `pool_recycle` (~1800s). |

## Detalle por dimensión

### 1) Ciberseguridad
- **Contraseñas — ✅ bien.** `security.py`: `pbkdf2_sha256`, 260.000 iteraciones, salt aleatorio de 16 bytes, comparación en tiempo constante (`hmac.compare_digest`). Equivalente al esquema por defecto de Django. Mejora opcional a futuro: `argon2id`.
- **Inyección SQL — ✅ bajo riesgo.** Todo el acceso es vía SQLAlchemy ORM (consultas parametrizadas). No se encontró SQL armado con f-strings ni `text()` con interpolación. Mantener la regla: nunca interpolar input en SQL.
- **Tokens / sesión — 🟠.** JWT propio firmado con HMAC-SHA256 + `exp` + `nonce`. TTL 30 días y sin mecanismo de revocación (es stateless). Ver hallazgos #1 y #2.
- **Autorización — 🟠.** Hay catálogo de permisos (`permissions.py`, `roles.permissions`) y alcance por sucursal (`access.py`: `user_has`, `require_any_permission`, `can_cross_branch`, `user_branches`). Es robusto pero **vive en la app**: no hay defensa en profundidad a nivel DB (RLS). Ver #3.
- **Secretos — ✅ con reparo.** Prod no usa el `AUTH_SECRET` por defecto (verificado). Falta el fail-fast (#1). Credenciales de Google/Firebase en `secrets/` fuera del repo.
- **Backups — ✅ verificar.** Hay container automático (`prodrigestivill/postgres-backup-local`). Pendiente confirmar **retención, prueba de restore y cifrado** del backup.

### 2) Escalabilidad
- **Lo bueno:** `sales_imports` guarda **totales pre-agregados** por medio de pago (evita recalcular); FKs indexadas; `pool_pre_ping`.
- **Cuellos a futuro:** agregación en Python (#6), falta de índices compuestos (#7), tablas que crecen sin tope (#9) y una sola instancia para todo (#11). Nada de esto molesta al volumen actual; son lo que hay que tocar **cuando el dataset se multiplique**.

### 3) Saneamiento de datos
- **Lo bueno:** columnas `*_normalized` / `*_norm` (SKU, marca, descripción, vendedor) que normalizan (mayúsculas, sin tildes, sin dobles espacios) para matching y dedup; `numeric(14,2)` para dinero (no float); `jsonb` real; `bool` real.
- **A reforzar:** pocos `CHECK` (#4) y validación de input despareja (#5). La integridad hoy depende de la disciplina de la app.

### 4) Normalización
- **Esquema en 3FN.** Las claves N–N están bien normalizadas (`user_roles`, `user_branches`, `brand_providers`, `remito_items`). Las **desnormalizaciones son intencionales y están documentadas** en el doc 17: `jsonb` (`roles.permissions`, `catalog_templates.campos_obligatorios`, `guarantee_exports.warranty_ids`, `notifications.metadata`), columnas derivadas/snapshot (las 4 descripciones del catálogo, snapshots de precio en anuncios, totales en `sales_imports`) y snapshots de auditoría (`guarantee_history.warranty_code`). Son decisiones correctas (rendimiento / estabilidad histórica), no deuda. La única deuda real de normalización es el **texto legacy junto a la FK** (#10).

## Roadmap sugerido

1. **Hardening rápido (poco esfuerzo, alto valor):** fail-fast del `AUTH_SECRET` (#1); revisar TTL/revocación de token (#2); verificar backups (retención + restore + cifrado) (#8).
2. **Integridad:** `CHECK` para enums estables (#4) + pydantic en los endpoints con `dict` crudo (#5).
3. **Performance/escala (cuando el volumen lo pida):** índices compuestos (#7) → agregación BI en SQL (#6) → archivado/particionado (#9) → read replica (#11).
4. **Limpieza:** retirar textos legacy duplicados de las FKs (#10).
