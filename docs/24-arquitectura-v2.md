# 24 · Arquitectura de la v2 (reconstrucción modular de ElectroGV)

> **Tipo (Diátaxis):** Explanation (entender el porqué) + Reference (decisiones y convenciones).
> **Objetivo:** que un chat/agente o dev nuevo pueda **construir la v2 desde cero** siguiendo un plan claro, con el patrón de diseño, las capas, el orden de módulos y las decisiones ya tomadas. Se lee junto al **inventario de la v1** ([25-inventario-v1.md](25-inventario-v1.md)).
> **Estado:** diseño acordado. Pendiente: escribir el plan de implementación (writing-plans) del **Corte 0**.

---

## 0. Ubicación del proyecto (para conectar desde un chat nuevo)

| Dato | Valor |
|---|---|
| **Directorio raíz (v1)** | `C:\Trabajo IT\Proyectos\ElectroGV\gvelectroapp` |
| **Directorio adicional** | `C:\Users\victo\Downloads` |
| **Repo v2** | **nuevo, aún no creado** (proyecto separado). Estos docs viven en el repo v1 y migran al nuevo cuando se cree. |
| **Deploy v1** | `git push` a `origin` **y** `repo2` (ver [25 §0](25-inventario-v1.md)) |
| **Memoria persistente** | `C:\Users\victo\.claude\projects\C--Trabajo-IT-Proyectos-ElectroGV-gvelectroapp\memory\` |

**Diseño visual de referencia (obligatorio para la UI):** `docs/referencias/bi-visual-gv-electro-dynamics/GV-STYLE-GUIDE.md` (design system "GV Electro Dynamics").

---

## 1. Concepto y objetivo

Reconstruir ElectroGV como una **v2 profesional, escalable y sin código muerto**, hecha **en paralelo por módulos** (hay equipo), apuntando a un ERP interno que a futuro alimente una **app de venta** conectada.

- La v2 es un **proyecto completamente aparte**: repo nuevo, base de datos propia, auth propia, deploy propio. **No se alimenta de nada de la v1.**
- La **v1 queda congelada** (sin features nuevas) y sigue operando —sobre todo Garantías— hasta ser reemplazada.
- **Todo lo nuevo va a la v2.** El único cruce será una **migración única de datos de Garantías** cuando ese módulo se construya (al final).

**Norte:** Administración (fundación) → Artículos e Inventario → Inteligencia Comercial → Venta → módulos operativos → Garantías (último).

---

## 2. Stack (decidido)

- **Frontend:** React + **Vite (SPA)** + **TanStack Router** (ruteo tipado) + **TanStack Query** (estado del servidor) + **Tailwind v4** + design system **GV Electro Dynamics** + **Framer Motion**. Mobile-first (390×844) → desktop.
- **Backend:** **FastAPI + PostgreSQL** (SQLAlchemy 2.0 + Alembic). Se conserva Python por el trabajo pesado de datos (pandas, reportlab, openpyxl, PyMuPDF) — ver [25 §2.2](25-inventario-v1.md).
- **Contratos:** OpenAPI → **tipos TypeScript generados**. Una sola fuente de la verdad front↔back.

**Por qué NO cambiar de stack:** el equipo es fuerte en el actual; la app es interna (sin SEO/SSR); Python es superior para el crunch de datos/PDF/Excel. El problema de la v1 no es el stack, es la **arquitectura y la disciplina**. Por eso **NO** se usa Next.js ni TanStack **Start** (SSR/edge que no se necesitan y competirían con FastAPI). Ver ADR-002.

---

## 3. Patrón de diseño (estándar, obligatorio)

**Clean / Hexagonal Architecture (Ports & Adapters) + DDD-lite.** El dominio en el centro; FastAPI, SQLAlchemy y Google son **adaptadores** en el borde.

### 3.1 Capas (de adentro hacia afuera)
1. **Dominio** — entidades, value objects, reglas de negocio. **Puro**: sin FastAPI ni SQL adentro. Testeable en aislamiento. **POO** acá (clases de entidad y servicios de dominio).
2. **Aplicación** — casos de uso / services ("crear usuario", "aprobar cuenta Google"). Orquesta dominio + puertos.
3. **Infraestructura** — implementaciones concretas: Postgres (SQLAlchemy), Google APIs, object storage. Detrás de **puertos** (interfaces) que define la capa de aplicación.
4. **Presentación** — routers FastAPI **finos** (traducen HTTP ↔ casos de uso) + frontend React.

### 3.2 Patrones concretos
- **Repository** — acceso a datos detrás de una interfaz; el dominio no sabe de SQL.
- **Service / Use-case** — un objeto/función por caso de uso de aplicación.
- **DTO / Schema** — Pydantic solo en los bordes (request/response), no como modelo de dominio.
- **Dependency Injection** — vía `Depends` de FastAPI (inyectar repos/servicios).
- **Unit of Work** — transacciones explícitas por caso de uso.
- **Frontend** — módulos por feature; hooks + TanStack Query para datos; presentational/container; nada de estado de servidor en `useState`.

### 3.3 POO pragmático (regla anti-over-engineering)
Clases para **entidades de dominio, servicios y repositorios**. Funciones puras donde alcanza. **Esto es Python, no Java empresarial:** nada de jerarquías de clases "porque sí", ni `AbstractFactoryFactory`. La complejidad se justifica o no va.

---

## 4. Estructura de un módulo (molde)

Cada módulo de negocio es un **slice vertical** aislado que atraviesa todas las capas y expone un **contrato**. Molde sugerido (backend):

```
modules/<modulo>/
├── domain/          # entidades, VOs, reglas (puro)
├── application/     # casos de uso, puertos (interfaces)
├── infrastructure/  # repos SQLAlchemy, adapters (Google, storage)
├── api/             # routers FastAPI (finos) + schemas Pydantic
├── tests/           # unit (dominio/app) + integración (infra/api)
└── README.md        # doc del módulo (obligatorio)
```

Frontend equivalente: `features/<modulo>/` con `api/` (hooks TanStack Query), `components/`, `routes/`, `types` generados del contrato.

**Definition of Done por módulo:** tests (dominio + casos de uso) · docs (`README.md`) · **cero código muerto** · detrás de feature-flag · (para módulos que reemplazan v1) verificación de **paridad** con lo viejo. Si no cumple los 5, no toma tráfico.

---

## 5. Spine de gobernanza (transversal)

Un núcleo reutilizable del que **cuelgan todos los módulos**, diseñado una sola vez:

- **Audit log** — quién / qué / módulo / recurso / cuándo / resultado. Toda acción sensible queda registrada.
- **Notificaciones** — in-app (+ email / Google Chat a futuro).
- **Solicitudes + Aprobaciones** — motor de pedidos y aprobaciones (accesos, cambios de precio, cuentas Google, etc.). *(Se construye después del Corte 0, pero la fundación le deja el lugar.)*
- **Permisos por módulo** — granular (no "admin/usuario"). Ej: `ventas: ver/crear/editar/exportar/aprobar`.
- **Recursos externos por config** — IDs de carpetas/planillas/plantillas/calendarios de Workspace y buckets de storage **guardados en base**, nunca hardcodeados.

---

## 6. Ecosistema Google Workspace (visión de Administración)

Basado en el doc de trabajo interno (Workspace como capa oficial de documentos; la app como capa de control). **Es un programa, no una feature** — se descompone así:

| Pieza | Dónde vive | Cuándo |
|---|---|---|
| Unidades compartidas, "LEER PRIMERO", grupos de Google, convención de nombres | **Google Admin — NO es código** | **Ahora, en paralelo** (equipo/admin) |
| Usuarios, roles, permisos por módulo, org, **audit log**, **notificaciones**, **config de recursos Workspace**, Google-linking liviano | **Administración v2 (primitivos)** | **Corte 0** |
| Vinculación de cuenta Google por usuario + aprobación (empresa/personal) | Administración (identidad) | Liviano ahora, completo después |
| Solicitudes/Aprobaciones, Tareas/Checklists, Novedades, Formularios, Centro de ayuda, generación de Docs/PDF desde plantillas, panel de estado | Módulos operativos propios | Después |
| Obsidian (base de conocimiento técnico) | Futuro | Parkeado |

**Principio:** *La app decide qué se hace · Workspace guarda y ejecuta · el usuario interno es el responsable (no la cuenta Google) · el admin controla accesos/aprobaciones.*

---

## 7. Convivencia con la v1 y migración de Garantías

- v1 y v2 corren **independientes, lado a lado**. Sin base compartida, sin vistas, sin sync en vivo.
- v1 sigue con Garantías hasta que la v2 tenga su módulo de Garantías (último).
- **Migración única:** cuando el módulo Garantías v2 esté listo → **script de import puntual** de los datos de garantías v1 → cutover → se jubila la v1.
- Riesgo mínimo: es un greenfield con **una sola** migración planificada, al final.

---

## 8. Orden de módulos (fases)

1. **Corte 0 — Fundación + Administración** (primitivos): usuarios, roles, **permisos por módulo**, empresas/sucursales, **audit log**, **notificaciones**, **config de recursos Workspace**, Google-linking liviano. Empleados/RRHH entra acá (**sin** recibos de sueldo). Este corte también levanta el **walking skeleton**: repo, CI, auth, deploy, capas, un slice vertical end-to-end.
2. **Artículos e Inventario** — maestro de productos + precios + fotos + manuales + inventario. Columna vertebral de IC y Venta.
3. **Inteligencia Comercial** — sobre artículos/precios (motor de métricas puro + exportadores separados).
4. **Venta** — app de venta sobre catálogo/inventario.
5. **Adm operativa** — solicitudes/aprobaciones, tareas/checklists, novedades, centro de ayuda, generación de docs.
6. **Garantías** — último; incluye la migración de datos desde v1.

En paralelo, sin código: **organización de Google Workspace** (unidades/grupos/nombres).

---

## 9. Convenciones (obligatorias)

- **Tests + CI desde el commit 1.** Nada entra sin test. Los casos borde de la v1 ([25 §4](25-inventario-v1.md)) se portan como tests de caracterización.
- **Documentar todo:** cada módulo con su `README.md`; decisiones grandes como **ADR** (sección 10); mantener el índice de docs.
- **Cero hardcode** de recursos externos (Workspace, storage) — todo por config.
- **Contratos tipados** front↔back; nada de tipos duplicados a mano.
- **Feature flags** para estrangular; borrar lo viejo apenas hay paridad.
- **v1 en congelamiento de features** mientras se reescribe (solo bugs urgentes).

---

## 10. Registro de decisiones (ADRs)

| # | Decisión | Motivo |
|---|---|---|
| ADR-001 | **Rebuild modular en paralelo (strangler)**, no reescritura big-bang ni refactor in-place | Etapa temprana, hay equipo, bajo blast radius (solo Garantías se usa fuerte); permite base limpia sin frenar el negocio. |
| ADR-002 | **Mantener stack** (FastAPI + PG + React/Vite SPA); **NO** Next.js/TanStack Start | Equipo fuerte en él; app interna (sin SEO/SSR); Python superior para datos/PDF/Excel; el problema es arquitectura, no stack. |
| ADR-003 | **v2 proyecto separado, base propia, no se alimenta de la v1** | Máxima limpieza; evita complejidad de dos bases/vistas; poco que migrar en etapa temprana. |
| ADR-004 | **Garantías se migra último**, con una migración de datos puntual | Es lo único con uso/datos reales; el resto arranca de cero ("corte 0"). |
| ADR-005 | **Primer módulo = Administración** (= la fundación) | La parte administrativa (identidad/auth/org/permisos) es el piso donde enchufan todos los módulos. |
| ADR-006 | **Patrón Clean/Hexagonal + DDD-lite + Repository/Service/DI/UoW**, POO pragmático | Estándar de industria, separa cálculo de presentación, testeable, sin over-engineering. |
| ADR-007 | **Adoptar GV Electro Dynamics** como design system; **portarlo a Vite** (no adoptar TanStack Start) | Se lleva el 100% del diseño sin la complejidad de SSR/edge. |
| ADR-008 | **Dropear recibos de sueldo** y deps basura (`and`, `run`, SQLite) | Código muerto confirmado; no se arrastra a la v2. |
| ADR-009 | **Spine de gobernanza** (audit + notificaciones + solicitudes/aprobaciones + permisos por módulo + recursos por config) diseñado desde el cimiento | Muchos módulos lo reusan; el doc de Workspace lo vuelve obligatorio. |
| ADR-010 | **Estrategia de datos:** ingesta a Postgres + agregación en **SQL** + vistas materializadas/rollups; pandas solo para el resultado chico | Las planillas fuente son de **cientos de miles de filas**; agregar en memoria no escala. |
| ADR-011 | **Jobs pesados en worker con concurrencia acotada** (cola) | Aísla el pico de los ~15 usuarios pesados de los ~85 livianos; mantiene la web ágil y el hardware modesto. |
| ADR-012 | **IA como capacidad de plataforma: API-first, grounded + guardrails + auditoría** (NO agente autónomo con shell) | Respuestas a clientes exactas y seguras; el modelo queda enchufable (swap a local después). |
| ADR-013 | **Empezar en VPS chico (4GB) para dev/demo**, con arquitectura escalable; migrar a 16GB/4c/80GB + bucket para producción | Lean para arrancar; la escalabilidad la da el diseño, no el box. |

---

## 11. Estrategia de datos y BI

Las planillas fuente (Ventas vs Costos / GFK) son de **cientos de miles de filas**. Regla: **que agregue PostgreSQL, no pandas.**

1. **Ingesta a Postgres** (`COPY` / chunked, no Excel→pandas→Excel). Los datos crudos viven en la base, indexados.
2. **Agregación en SQL** (`GROUP BY` sobre columnas indexadas). Postgres maneja millones de filas con RAM modesta; cargar todo a pandas es el anti-patrón que obliga a comprar un monstruo.
3. **Vistas materializadas / tablas de rollup** (pre-agregado diario/mensual/marca/sucursal) → los dashboards leen un resultado chico, no re-crunchean el crudo.
4. **pandas solo para el resultado final chico** (formateo, PDF/PPTX), nunca sobre el dataset crudo.
5. **Jobs pesados en worker con cola y concurrencia acotada** (1–2 a la vez) → aísla el pico de los usuarios pesados de los livianos.

## 12. IA como capacidad de plataforma (futuro, post-CRM)

La IA es una **capacidad controlada DENTRO de la v2**, no un agente autónomo con acceso a shell. Se diseña como **servicio aparte, model-agnostic, API-first**.

- **Modelo:** empezar con **API** (Claude / Gemini) — mejor calidad y tool-calling, sin GPU ni ops. El modelo queda **enchufable**: swap a local (Gemma en host con GPU) solo si aparece razón fuerte (privacidad dura, volumen que haga pesar el costo).
- **"Responde bien" = grounding, no el modelo:** function-calling a APIs propias (`precio/stock/garantía/pedido`) + **RAG** (FAQ/políticas) + system prompt/reglas + **guardrails** + **human-in-the-loop** para lo transaccional + memoria de conversación + **logs/auditoría** (spine de gobernanza).
- **Optimización de costo:** modelo chico/barato para clasificar-rutear + modelo fuerte solo para redactar.
- **Usos:** automatizaciones internas (workflows que llaman al LLM, con permisos y logs) y, con el CRM, respuesta asistida a mensajes de clientes.
- **OpenClaw:** NO va en producción junto al ERP (agente autónomo con shell = riesgo). Sirve solo como **asistente personal del dueño**, en una máquina/VM aparte.

## 13. Deployment y escalado

- **Todo dockerizado** · **config por env** · **media en bucket externo** (no en disco) · DB con dump/restore. Así **mudarse = redeploy**, no un proyecto.
- **Empezar chico:** VPS 4GB para **dev/demo** mientras se construye. Migrar a **16GB / 4 vCore / 80GB NVMe + bucket** para producción con ~100 usuarios (≈85 livianos: garantías/ventas/consulta de precios + ≈15 pesados: BI sobre planillas de cientos de miles de filas).
- Verificar que el proveedor permita **escalar** (resize o migración simple).
- ⚠️ 4GB-demo con data de prueba **≠** producción a escala. El test de escala se hace después con data real / load test.

## 14. Demo mínima del Corte 0

Objetivo: algo **demoable rápido** en el box chico, **sin features todavía** — el walking skeleton.

- **Login** (auth) → **1 pantalla de Administración** (ej. listado + alta de Usuarios) → **1 endpoint FastAPI** (pasando por las capas dominio→app→infra) → **1 test** → **CI verde** → **deploy** en el VPS de 4GB.
- Qué demuestra: el stack anda **end-to-end**, el **patrón** (capas) está en pie, el **diseño** (GV Electro Dynamics) se ve, y el **deploy** funciona.
- Recién **después** se agregan las features de Administración (roles, permisos por módulo, org, audit, etc.).

## 15. Próximo paso

Escribir el **plan de implementación del Corte 0** (writing-plans): walking skeleton (repo + CI + auth + deploy + 1 slice vertical, §14) → módulo Administración por dentro (dominio→app→infra→api→ui) → primeros tests. **No** arrancar por features hasta tener el esqueleto y los contratos.
