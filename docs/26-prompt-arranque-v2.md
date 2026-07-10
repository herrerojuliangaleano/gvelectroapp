# 26 · Prompt de arranque para el chat nuevo (build v2)

> **Uso:** copiá el bloque de abajo y pegalo como primer mensaje en el chat/agente nuevo que va a construir la v2.
> **Antes de arrancar:** dale acceso al directorio de la v1 (`C:\Trabajo IT\Proyectos\ElectroGV\gvelectroapp`) como **directorio adicional de trabajo**, así puede leer los docs y el código de referencia.
> **Nota:** la memoria persistente es por-proyecto (por carpeta); si el repo v2 está en otra ruta, el chat nuevo **no la hereda** — por eso este prompt + los docs 24/25 llevan todo el contexto.

---

```markdown
# Misión
Vas a construir **ElectroGV v2**: la reconstrucción profesional, modular y sin código muerto de un ERP interno para una cadena de electrodomésticos. Se hace en paralelo a la v1 (congelada), por módulos, estilo strangler.

# Proyecto de referencia (v1) — CONSULTAR SIEMPRE, NO MODIFICAR
La v1 vive en: `C:\Trabajo IT\Proyectos\ElectroGV\gvelectroapp`
Es tu fuente de conocimiento de dominio. Entrá a este proyecto **constantemente** para ver cómo funciona algo, qué librerías usa y los casos borde. **NO la modifiques** (está congelada) salvo pedido explícito.

Antes de escribir una línea, leé en este orden:
1. `docs/25-inventario-v1.md` — qué es la v1, stack, librerías, módulos, casos borde, qué se rescata/descarta.
2. `docs/24-arquitectura-v2.md` — el plan del rebuild (stack, patrón, capas, orden de módulos, ADRs, datos, IA, deployment). **Es tu biblia.**
3. `docs/referencias/bi-visual-gv-electro-dynamics/GV-STYLE-GUIDE.md` — design system (obligatorio para la UI).
4. `docs/README.md` — índice de toda la documentación (00–26) para consultar cualquier módulo en detalle.

# Stack (decidido — no reabrir sin razón fuerte, ver ADR-002)
- **Frontend:** React + Vite (SPA) + TanStack Router + TanStack Query + Tailwind v4 + design system GV Electro Dynamics + Framer Motion. **Mobile-first**.
- **Backend:** FastAPI + PostgreSQL (SQLAlchemy 2.0 + Alembic).
- **Contratos:** OpenAPI → tipos TS generados.
- **NO** Next.js, **NO** TanStack Start, **NO** cambiar de stack.

# Patrón y método
- **Clean/Hexagonal + DDD-lite.** Capas: dominio puro → aplicación → infraestructura → presentación. Patrones: Repository, Service/Use-case, DTO/Schema, Dependency Injection, Unit of Work. **POO pragmático** (Python, sin over-engineering).
- **Tests + CI desde el commit 1.** Los casos borde de la v1 (`docs/25 §4`) se portan como tests.
- **Documentar todo** (cada módulo con README; decisiones como ADR).
- **Datos/BI:** agregar en **SQL** (no pandas en memoria); rollups/vistas materializadas; jobs pesados en **worker con cola acotada** (planillas de cientos de miles de filas). Ver `docs/24 §11`.
- **IA (futuro, post-CRM):** capacidad de plataforma **API-first, grounded (tools+RAG) + guardrails + auditoría**; NO agente autónomo con shell. Ver `docs/24 §12`.
- v2 = repo/base/deploy **propios**; NO se alimenta de la v1. Único cruce futuro: migración de **Garantías** (último módulo).

# Primera tarea (NO empieces por features)
Con la skill **writing-plans**, escribí el plan de implementación del **Corte 0**:
1. **Walking skeleton (demo mínima, `docs/24 §14`):** repo nuevo + CI + auth + **1 pantalla de Administración (Usuarios)** + 1 endpoint en capas + 1 test + deploy en el VPS de 4GB. Cero features.
2. **Módulo Administración** por dentro (dominio→app→infra→api→ui): usuarios, roles, **permisos por módulo**, empresas/sucursales, audit log, notificaciones, config de recursos Workspace, Google-linking liviano. Empleados/RRHH **SIN recibos de sueldo**.
Confirmá el plan antes de codear.

# Skills (las mismas que la v1)
Copiá al repo v2 la carpeta `.agents/skills/` y el archivo `skills-lock.json` desde `C:\Trabajo IT\Proyectos\ElectroGV\gvelectroapp`. Son 15: brainstorming, brand-guidelines, business-intelligence, changelog-generator, color-palette, documentation-writer, error-handling-patterns, excel-analysis, frontend-design, postgresql-table-design, powerpoint, systematic-debugging, vercel-react-best-practices, writing-plans.

**Cómo usarlas:**
- **Invocalas de forma OBLIGATORIA** cuando la tarea cae en su dominio (no solo "tenerlas en mente"). **brainstorming es MUY IMPORTANTE**: usala antes de cualquier feature/diseño/decisión de arquitectura.
- Invocar la skill ≠ ceremonia. Después aplicás proporcional a la tarea, sin Q&A ni plan-files de más.
- `vercel-react-best-practices` asume Next.js: acá es Vite SPA, tomá solo lo client-side framework-agnostic.
- Deferí al design system GV Electro Dynamics. **Las convenciones del proyecto y lo que pida el dueño SIEMPRE ganan** sobre lo que diga una skill.

# Reglas duras
- Mobile-first (390px). Colores solo por tokens (**cero `#hex`**). `--price` naranja **solo** en montos. Permisos por módulo. Recursos externos por config (no IDs hardcodeados). Estados loading/empty/error en cada vista.
- No arrastrar código muerto: recibos de sueldo, deps npm `and`/`run`, restos de SQLite.
- Deploy escalable: todo dockerizado, config por env, media en bucket externo, DB con dump/restore (mudarse = redeploy).
```
