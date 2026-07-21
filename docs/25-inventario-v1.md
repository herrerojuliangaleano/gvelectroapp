# 25 · Inventario completo de la v1 (ElectroGV `gvelectroapp`)

> **Tipo (Diátaxis):** Reference + Explanation.
> **Objetivo:** que un chat/agente o dev nuevo entienda **qué es la v1, con qué está hecha, qué hace cada parte, qué conocimiento hay que preservar y qué se descarta**, sin leer todo el código. Es la base para construir la **v2** ([24-arquitectura-v2.md](24-arquitectura-v2.md)).
> **Estado:** v1 **en congelamiento de features**. Solo se mantiene viva para operar (sobre todo Garantías) hasta que la v2 la reemplace módulo por módulo.

---

## 0. Ubicación del proyecto (para conectar desde un chat nuevo)

| Dato | Valor |
|---|---|
| **Directorio raíz** | `C:\Trabajo IT\Proyectos\ElectroGV\gvelectroapp` |
| **Directorio adicional** | `C:\Users\victo\Downloads` (assets, zips, mockups) |
| **Repo git** | sí. Rama principal: `main` |
| **Remotes (deploy)** | `origin` → `github.com/herrerojuliangaleano/gvelectroapp.git` · `repo2` → `github.com/herrerojuliangaleano/electrogv.git` |
| **Deploy** | `git push` a **AMBOS** remotes. De ahí "levanta la página y prod". |
| **Docs (fuente de verdad)** | `docs/` (índice en [docs/README.md](README.md)) |
| **Memoria persistente** | `C:\Users\victo\.claude\projects\C--Trabajo-IT-Proyectos-ElectroGV-gvelectroapp\memory\` (índice `MEMORY.md`) |

**Para un chat nuevo:** empezar por [00-guia-proyecto.md](00-guia-proyecto.md) y [02-guia-tecnica-agentes.md](02-guia-tecnica-agentes.md); para el rebuild, este doc + [24-arquitectura-v2.md](24-arquitectura-v2.md).

---

## 1. Qué es la v1

App **interna** (no pública, detrás de login) para una cadena de electrodomésticos (ElectroGV / Electro GV / ABC). Es una herramienta operativa usada por administración, comercial, depósito y vendedores. Cubre: **garantías**, **inteligencia comercial** (PSI, informe de marca, vendedores), **precios y costos**, **catálogo/maestro de productos**, **empleados/RRHH**, **ventas web**, e **integraciones con Google Workspace y el ERP Puma**.

**Uso real hoy:** lo más usado es **Garantías**. El resto lo opera principalmente el dueño/IT en el día a día. → bajo blast radius para el rebuild (ver [24](24-arquitectura-v2.md)).

---

## 2. Stack

### 2.1 Backend — Python / FastAPI
- **FastAPI** `0.115` + **Uvicorn** `0.34` — API y server ASGI.
- **Pydantic** `2.11` — validación y schemas de borde.
- **SQLAlchemy** `2.0` (estilo `Mapped[]`) + **Alembic** `1.14` + **psycopg** `3.2` — ORM, migraciones y driver PostgreSQL. **14 migraciones** en `backend/alembic/versions/`.
- **PostgreSQL 16** — base activa. (Quedan restos de **SQLite** en `backend/storage/electrogv.sqlite3*` — histórico, superado por PG.)
- **APScheduler** `3.10` + **tzdata** — tareas programadas (ej. sync nocturno de catálogo). Ver `scheduler.py` / `jobs.py`.

### 2.2 Backend — librerías de dominio (el "trabajo pesado", clave para v2)
| Librería | Para qué se usa | ¿Rescatar en v2? |
|---|---|---|
| **pandas** `2.2` | Crunch de datos: Ventas vs Costos, GFK, PSI, métricas BI | **Sí — irremplazable**. Python gana acá vs Node. |
| **openpyxl** `3.1` | Leer/escribir Excel (imports, exports BI, PSI) | Sí |
| **reportlab** `4.2` | Generar PDF vectorial (remitos, credencial PVC, export PSI) | **Sí** |
| **Pillow** `10.4` | Procesar imágenes (fotos de empleados, credencial) | Sí |
| **PyMuPDF** `1.24` | Rasterizar PDF → PNG (mockup PVC de la credencial) | Sí |
| **gspread** `6.2` + **google-api-python-client** `2.167` + **google-auth**(+oauthlib, httplib2) | Google Sheets / Drive (INFORME PSI, GFK, planillas madre) | **Sí — es el corazón de las integraciones** |
| **playwright** `1.49` | Browser headless (screenshots/capturas internas) | Evaluar (pesado; ver si se usa realmente) |
| **firebase-admin** `6.5` | Push notifications (FCM) al Android | Evaluar según si se sigue usando el push |
| **python-dotenv** | Config por entorno | Sí |

### 2.3 Frontend — React / Vite (SPA)
- **React** `18.3` + **react-dom** + **react-router-dom** `6.28` — SPA con routing client-side. **No** Next.js.
- **Vite** `5.4` + **@vitejs/plugin-react** + **TypeScript** `5.6` — build/tooling.
- **TailwindCSS** `3.4` + PostCSS + autoprefixer — estilos. (En v1 se combinan clases Tailwind + CSS vars tipo `--surface`, `--chart-blue`.)
- **lucide-react** — íconos. **recharts** `3` — gráficos del BI.
- **jspdf** + **pptxgenjs** + **html-to-image** — export **client-side** a PDF/PPTX/imagen (deck e informe de marca editable).
- **@capacitor/** `6` (android, app, browser, core, push-notifications) — empaquetado **Android** (la app corre también como APK). Ver [08-android-capacitor.md](08-android-capacitor.md).
- ⚠️ **Deps basura a NO arrastrar a v2:** `"and": "^0.0.3"` y `"run": "^1.5.0"` — instalaciones accidentales, no se usan.

### 2.4 Infra / deploy
- **Docker**: `docker-compose.yml` (dev) y `docker-compose.prod-local.yml` (mini-prod local en `:8010`). `backend/Dockerfile`, `frontend/Dockerfile`.
- Contenedores locales: `electrogv-backend` (dev `:8000`), `electrogv-backend-prod` (mini-prod `:8010`), `electrogv-postgres(-prod)`, `electrogv-pgadmin`, `electrogv-adminer-prod`, `electrogv-db-backup-prod`.
- **Vercel + ngrok** para exposición inicial ([07](07-produccion-local-vercel-ngrok.md)); `vercel.json` en la raíz.
- **Gotcha de deploy local:** `docker cp frontend/dist -> /frontend/dist` **anida** a `/frontend/dist/dist` si ya existe. Hay que `rm -rf /frontend/dist` **antes** de copiar.
- **PowerShell** es la shell primaria en Windows (hay `build-apk.ps1`, `vercel.json`).

---

## 3. Inventario de módulos (backend + frontend)

> Cada área lista sus archivos backend y sus pantallas frontend, con puntero al doc detallado.

### 3.1 Fundación organizacional (identidad / acceso) — 📄 [05](05-fundacion-organizacional.md)
Jerarquía **Empresa → Sucursal → Rol → Permiso → Usuario**.
- **Backend:** `routers/auth.py`, `routers/admin.py`, `routers/organization.py`, `routers/config.py`, `routers/operational_config.py`; `auth.py`, `access.py`, `permissions.py`, `security.py`, `users.py`, `users_db.py`, `branches_db.py`, `operational_config.py`; `models/auth.py`, `models/org.py`.
- **Frontend:** `LoginPage`, `SetPasswordPage`, `AdminUsuariosPage`, `AdminRolesPage`, `CompaniesBranchesPage`, `UserCreateWizardPage`, `MyUserPage`, `OperationalConfigPage`, `SettingsPage`, `UserDetailDrawer`.
- **Nota:** hay un **rediseño de roles/permisos** pensado (Fase 0 hecha sin gates por rol; Fases 1-2 —departamentos + permisos por usuario— diseñadas y pendientes). La v2 lo formaliza como **permisos por módulo**.

### 3.2 Empleados / RRHH
- **Backend:** `routers/employees.py`, `routers/payroll/*`; `employees_db.py`, `employee_credential_pdf.py`; `models/employees.py` (Employee, EmployeeStatusHistory, **PayrollReceipt**, PayrollReceiptObservation).
- **Frontend:** `AdminEmpleadosPage`, `EmployeeCreatePage`, `EmployeeLegajoPage`, `MyLegajoPage`, `PhotoApprovalPage`, `PayrollReceiptsPage`, `EmployeePhoto`.
- **Credencial PVC CR-80** (nuevo): `employee_credential_pdf.py` genera frente/dorso + capas de imprenta (corte, spot-UV, relieve) + mockup PVC (Pillow+PyMuPDF) + ZIP. Endpoints `/api/employees/{id}/credencial.pdf|/credencial/mockup.png|/credencial/pack.zip`. Fuentes Roboto en `backend/storage/fonts/`.
- 💀 **MUERTO (dropear en v2):** **recibos de sueldo** (`payroll/`, `PayrollReceipt*`, `PayrollReceiptsPage`). Confirmado por el usuario: no se usa.

### 3.3 Garantías ⭐ (lo más usado — se migra ÚLTIMO)
- **Backend:** `routers/warranties/*`, `routers/remitos/*`; `warranties_db.py`, `warranty_helpers.py`, `warranty_import.py`, `pdf_remito.py`, `remitos_db.py`; `models/warranties.py`, `models/remitos.py`. Import histórico desde Excel → 📄 [09](09-import-historico-excel.md).
- **Frontend (el módulo más grande):** `WarrantiesListPage`, `WarrantyCreatePage`, `WarrantyDetailPage`, `WarrantyDashboardPage`, `WarrantyManagementPage`, `WarrantyGestorPage`, `WarrantyReviewPage`, `WarrantyDepositReceivePage`, `WarrantyPosventaPage`, `WarrantySucursalPage`, `WarrantyRemitosPage`, `WarrantyRemitoTrackingPage`, `WarrantyExportPage`, `WarrantyConfigPage`, `WarrantySyncPage`, `WarrantyWorkspacePage`, `WarrantyDetailDrawer`, `WarrantyQuickCreateModal`.
- **Caso borde crítico:** "Sucursal de venta" = **sucursal responsable** (no la de carga). El re-sync del Google Sheet también corrige datos históricos.

### 3.4 Catálogo / Maestro de productos — 📄 [15](15-modulo-maestro-productos.md) · [16](16-patrones-descripcion-productos.md) · [17](17-modelo-datos-mer.md) · [18](18-diccionario-datos.md)
- **Backend:** `routers/catalog.py`, `routers/products.py`; `catalog_generator.py`, `catalog_normalizer.py`, `catalog_seed.py`, `catalog_service.py`, `product_catalog.py`; `models/catalog.py`, `models/products.py`.
- **Frontend:** `CatalogAltaPage`, `CatalogNormalizacionPage`, `ProductCatalogPage`, `ConsultaPreciosPage`, `CatalogProductForm`.
- **Estado:** modelo+motor+armador+pantallas (alta/normalización) hechos; exportaciones y "corte" pendientes. En v2 pasa a ser **"Artículos e Inventario"** (maestro + fotos + manuales + inventario), pieza central de la que dependen IC y la futura app de Venta.

### 3.5 Precios y costos
- **Backend:** `routers/price_cost_updates/*` (incl. `announcements.py`), `price_cost_rules.py`.
- **Frontend:** `PriceCostUpdatesPage`, `PriceAnnouncementsPage`.
- Genera imágenes de anuncios de precios (Pillow) con fuentes Inter/JetBrains (`backend/storage/fonts/`).

### 3.6 Inteligencia Comercial (BI) — 📄 [10](10-modulo-comercial-fase1.md) · [11](11-comercial-bi-vendedores.md) · [12](12-comercial-bi-marcas-lineas-sucursales.md) · [22](22-bi-comercial-powerpoint-marca-2.md) · [23](23-guia-visual-inteligencia-comercial.md)
- **Backend:** `routers/sales_bi.py`, `routers/psi/*`; `sales_bi.py`, `sales_bi_commercial.py`, `sales_bi_brand_dossier.py`, `sales_bi_brand_dossier_xlsx.py`; `models/sales_bi.py`, `models/sales_bi_commercial.py`, `models/sales_psi.py`.
- **Frontend:** `SalesBICommercialPage`, `SalesBICommercialImportPage`, `SalesBIDetailPage`, `SalesBIHistoryPage`, `SalesBIImportPage`, `SalesBISellersPage`, `PSIPage`, `BrandDossierView`, `BrandSeriesCharts`, `SalesBIWidgets`, `BrandLogo`; libs `exportBrandDossierEditable.ts`, `exportDeck.ts`.
- **El módulo más enredado** (motor de métricas mezclado con exportadores). En v2 se separa **cálculo puro** de **presentación**. Es el "premio gordo" pero se hace **después** de Administración y Artículos.

### 3.7 Ventas web
- **Backend:** `routers/sales_web/*`; `models/sales_web.py`.
- **Frontend:** `SalesWebListPage`, `SalesWebCreatePage`, `SalesWebDetailPage`.

### 3.8 Integraciones externas
- **Google Workspace:** `google_auth.py`, `google_sheets.py`, `routers/google_admin.py`, `GoogleAdminPage`. Service account para Sheets/Drive. (En v2: **recursos por config**, IDs en base, no hardcode.)
- **GFK / planillas legacy:** `backend/legacy_scripts/Aplicacion de ElectroGV/scripts/` — `Generar GFK` (gg.py/gge.py), `Ventas VS Costos`, `Normalizar…`, `Comprobar Facturas`, `Congelar carpeta`, etc. Scripts Python legacy que corren dentro del contenedor.
- **ERP Puma (mobile):** 📄 [13](13-integracion-mobile-puma.md) · [14](14-tabla-intermedia-puma.md) (outbox).
- **Firebase FCM:** `fcm.py` — push al Android.

### 3.9 Sistema / plataforma (transversal)
- **Backend:** `audit.py` (audit log), `routers/notifications.py`, `routers/jobs.py` + `scheduler.py`, `routers/backups.py`, `routers/system.py`, `routers/tools.py`, `routers/budgets/*`; `brand_assets.py`, `brand_logo_store.py`, `config.py`, `database.py`, `db.py`, `main.py`, `schemas.py`, `seed.py`; `models/system.py`.
- **Frontend:** `DashboardPage`, `NotificationsPage`, `JobsHistoryPage`, `JobDetailPage`, `BackupsPage`, `AuditLogPage`, `SystemDiagnosticsPage`, `ToolsPage`, `ToolRunPage`, `AboutSystemPage`; componentes `ProUI` (design system), `Topbar`, `Breadcrumbs`, `ErrorBoundary`, `LogsConsole`, `MobileFab`, `PwaInstallPrompt`, `UpdatePrompt`, `DesktopOnlyGuard`, `DynamicForm`, `StatusBadge`, `ToolCard`.
- **Storage** (`backend/storage/`): `backups/`, `brand-logos/`, `brand-styles/`, `fonts/`, `logos/`, `outputs/`, `private/`, `runs/`, `secrets/`, `uploads/`. Diseño de **object storage** (MinIO) para fotos/manuales/PDFs → 📄 [20](20-subsistema-archivos-object-storage.md) (diseñado, no implementado).

---

## 4. Conocimiento de dominio a preservar (casos borde ganados con sangre)

**Estos deben pasar a la v2 como TESTS de caracterización — no re-descubrirlos a los golpes:**

1. **GFK · outlet como primera:** GfK exige informar OUTLET como PRIMERA — sin "(O)" en modelo/descripción, y precio de primera **×1.10**. Corregido en `gg.py`/`gge.py`. (No es fraude: es requisito de GfK.) También corregido en el examen.
2. **PSI · fuente INFORME PSI:** el PSI lee del **INFORME PSI** (Google Sheet crudo, outlet distinguido, PVP sin +10%) con **fallback a GFK**. Los ajustes se escriben ahí con día/sucursal al azar + una **columna oculta `PSI-{id}`** para poder revertir (los lectores mapean por header, así que la columna sin header se ignora).
3. **Garantías · sucursal de venta = responsable** (no la de carga). El re-sync corrige históricos.
4. **BI · reglas de métricas:** agrupación **"Lavado"** (lavarropas + lavaseca/lavasecarropas + secarropas); **zona "Venta Web"** clasifica por canal **antes** que por sucursal; **nunca mezclar unidades con facturación** (ni share ni ranking promediado); zonas CABA/GBA/Venta Web.
5. **Credencial PVC:** separar **print plano** (reportlab) del **mockup visual** (Pillow+PyMuPDF). Print y mockup son dos cosas, no una.
6. **Deploy:** `git push` a **ambos** remotes (origin + repo2). Backend a contenedores por `docker cp` + `docker restart`.
7. **Examen Excel comparativo marcas:** datos "disfrazados" para examen (estimación por % de mercado + aumentos); Norte=Norcenter, Sur=Lanús.
8. **Stock valorizado:** el export ERP puede traer una fila resumen `TOTAL CANTIDAD` en el bloque de productos. Esa fila no es producto real y debe descartarse antes de subir a Drive o calcular unidades/valuación. Para carga masiva, el nombre del archivo debe incluir sucursal y fecha: `stock valorizado canning 11-07-2026.xlsx`. Aliases aceptados: `caseros`, `canning`, `lanus`, `norte`/`norcenter`; la fecha se toma como `DD-MM-YYYY` o `YYYY-MM-DD`.

---

## 5. Qué se rescata y qué se descarta en la v2

### Se rescata (llevar a v2)
- **Stack de datos Python** (pandas, reportlab, openpyxl, PyMuPDF, Pillow) — el trabajo pesado que Python hace mejor que cualquier alternativa.
- **Patrones de integración Google** (Sheets/Drive) — pero con **recursos por config**, no IDs hardcodeados.
- **Modelo de fundación organizacional** (Empresa→Sucursal→Rol→Permiso→Usuario) — evoluciona a **permisos por módulo**.
- **Los casos borde de dominio** (sección 4) como tests.
- **El design system GV Electro Dynamics** (ya existe en `docs/referencias/`).
- **La credencial PVC** (ya está bien separada print/mockup).

### Se descarta (no arrastrar)
- 💀 **Recibos de sueldo** (payroll).
- 💀 Deps npm basura: `and`, `run`.
- 💀 Restos de **SQLite** (`storage/electrogv.sqlite3*`).
- ⚠️ A evaluar según uso real: **playwright** (pesado) y **firebase/FCM** (si se mantiene el push).
- **Código muerto** en BI (motor de métricas mezclado con exportadores, ramas duplicadas) — se rehace limpio.

---

## 6. Documentación existente relacionada (no duplicar, referenciar)

Índice completo en [docs/README.md](README.md). Puntos de entrada clave:
- **Arquitectura y stack:** [00](00-guia-proyecto.md), [02](02-guia-tecnica-agentes.md).
- **API:** [03](03-api-endpoints.md). **Handoff agentes:** [04](04-protocolo-agentes.md).
- **Datos:** [17](17-modelo-datos-mer.md), [18](18-diccionario-datos.md), [19](19-analisis-bd-escalabilidad-seguridad.md).
- **Backlog priorizado (M1–M20, Tier 0 = tests+CI):** [21](21-relevamiento-mejoras.md).
- **Diseño v2 (visual):** [referencias/bi-visual-gv-electro-dynamics/](referencias/bi-visual-gv-electro-dynamics/README.md) + `GV-STYLE-GUIDE.md`.
- **Plan de reconstrucción v2:** [24-arquitectura-v2.md](24-arquitectura-v2.md).
