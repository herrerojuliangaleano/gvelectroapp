# 15 — Módulo Maestro / Alta / Normalización de Productos

> Registro de integración y decisiones. La spec funcional completa la
> escribió Victor (junio 2026); este doc mapea esa spec contra el código
> real y registra las decisiones de arquitectura + el estado por etapas.

## Decisiones de arquitectura (acordadas 2026-06)

1. **Catálogo nuevo = tabla separada**, no se extiende `products` legacy en
   su lugar. El maestro nuevo vive en `catalog_products`; la tabla
   `products` legacy queda intacta salvo **una** columna nueva:
   `catalog_product_id` (FK nullable → `catalog_products.id`).

2. **Transición producto por producto con detector.** Cada `products` legacy
   se vincula a un `catalog_products` cuando se normaliza. El endpoint
   `GET /api/products/catalog/transition-status` cuenta cuántos legacy
   activos ya tienen link. Cuando `legacy_faltan == 0` → `transicion_completa
   = true` y recién ahí se decide el corte. Hasta entonces, los **16
   consumidores** de `products` siguen leyendo legacy sin enterarse.

3. **Código Puma manual.** No hay importación automática de fuentes (Planilla
   con Puma / Existencias ERP). Se carga y matchea a mano para evitar errores
   de auto-matching. (Se descartó la Etapa 2 "importación de fuentes" de la
   spec original.)

4. **Reusar la taxonomía existente, no crear una paralela.**
   - `familia_app` = los 6 buckets de `_classify` (LÍNEA BLANCA / COCINA /
     CLIMATIZACIÓN / TV-AUDIO / PEQUEÑOS / OTROS) que ya usa el BI comercial.
   - `rubro_app` = el `tipo` granular (HELADERA, LAVARROPAS, ...) que en el
     dashboard llamamos "Línea".
   - La clasificación ERP (`familia_erp`/`rubro_erp`/`subrubro_erp`) se guarda
     solo como referencia; la comercial manda para reportes.

5. **Solapamientos con lo existente (no duplicar):**
   - Aliases: ya existe `psi_product_aliases`. El catálogo nuevo usa
     `catalog_aliases`. A futuro evaluar unificar; por ahora coexisten.
   - Precio/costo: ya existe `price_cost_updates` (avisos con checks por
     canal). El catálogo usa `catalog_price_history` / `catalog_cost_history`
     (línea de tiempo from-to). Propósitos distintos, conviven.
   - Marcas: ya existe `product_brands` + `marca_normalized` + brand↔proveedor.

## Modelo de datos (Etapa 1 — HECHA)

Migración `20260613_0001`. Todo aditivo (riesgo cero para los consumidores).

| Tabla | Rol |
|---|---|
| `catalog_products` | maestro nuevo (sku_base/comercial, 4 descripciones, familia/rubro/subrubro app+erp, condicion, estado, activo) |
| `catalog_aliases` | equivalencias históricas (SKU/desc/puma viejos → producto) |
| `catalog_price_history` | historial PVP from-to |
| `catalog_cost_history` | historial costo from-to |
| `catalog_templates` | plantillas de descripción + campos obligatorios por familia+rubro |
| `catalog_abbreviations` | diccionario de abreviaturas ERP |
| `catalog_change_log` | auditoría campo a campo |
| `products.catalog_product_id` | (legacy) único link al maestro nuevo |

Permisos: `catalog.view`, `catalog.manage` (GERENTE, GERENTE_COMERCIAL,
ADMINISTRADOR + superadmin por `*`).

## Reglas de negocio clave (de la spec)

- El usuario NO escribe la descripción final: carga datos estructurados y la
  app genera SKU comercial, descripción comercial, descripción ERP y subrubro.
- **Descripción ERP**: máx 50 chars, MAYÚSCULAS, sin tildes, abreviaturas de
  `catalog_abbreviations`, **sin "OUTLET"**.
- **OUTLET**: `condicion=OUTLET` → `sku_comercial = sku_base + " (O)"`,
  `descripcion_comercial = base + " (OUTLET)"`, `descripcion_erp` sin OUTLET.
  La app agrega "(O)" y "(OUTLET)" automáticamente, el usuario no los tipea.
- Validaciones de activación: no activar sin familia/rubro/sku/marca/condición/
  descripciones; ERP ≤ 50; SKU comercial y código Puma únicos entre activos.

## Estado por etapas

- **Etapa 1 — Modelo + migración**: ✅ HECHA (commit de esta tanda).
  7 tablas + columna link + detector de transición + permisos.
- **Etapa 2 — Importación de fuentes**: ❌ DESCARTADA (código Puma manual).
- **Etapa 3 — Normalización diaria** (pantalla de tandas 20-50/día): pendiente.
- **Etapa 4 — Alta guiada** (form + generación descripción comercial/ERP desde
  templates + abreviaturas): pendiente.
- **Etapa 5 — Exportaciones** (nueva Planilla Madre + salida ERP): pendiente.
- **Etapa 6 — Corte** (planillas diarias consumen la salida de la app): cuando
  `transicion_completa = true`.

## Exportación a Google Sheets (spec de Victor + realineación)

Victor escribió una spec detallada de la estructura del Sheet generado
(`Productos PVP` + hojas por marca + hojas técnicas CONFIG_SYNC /
CAMBIOS_SHEET / ERRORES_SYNC). Esa spec describe el **estado final
(post-corte)**, no la transición. Realineación con la arquitectura actual:

**Conflicto a evitar:** hoy el flujo es `Planilla Madre (Sheet) → sync
nocturno 3:30 → products legacy → 16 consumidores`. Si la app publica
`Productos PVP` desde `catalog_products` con la transición incompleta
(hoy 0/1219), deja ciegas a las planillas diarias. El publisher NO se
activa a mitad de transición.

**Regla de oro:** una sola dirección canónica por vez. Nunca tener vivos
a la vez Sheet→products (sync), app→Sheet (publish) y Sheet→app (read).

**Secuencia segura (la marca el detector `transition-status`):**

| Fase | Estado | Flujo Productos PVP | Construir |
|---|---|---|---|
| A — Normalización (ahora) | catálogo 0→100% | legacy Sheet→products | nada de publisher; solo normalizar |
| B — Validación (cerca 100%) | casi completo | app → COPIA/staging | publisher a sheet de prueba + comparar vs Planilla Madre real |
| C — Corte (`transicion_completa`) | completo | app→Sheet canónico; se retira el sync Sheet→products | apuntar planillas diarias a la hoja de la app |

**Notas:**
- El read-back (Sheet→app, sección 14 de la spec) es puente TEMPORAL de
  Fase B, no función permanente (si no, vuelve el loop). Durante la
  transición los cambios de precio van por `price_cost_updates`.
- `ID_PRODUCTO` (= `catalog_products.id`) como clave de fórmula es lo
  correcto, pero migrar las planillas diarias de SKU→ID_PRODUCTO es
  trabajo de Fase C (reescribir BUSCARX/IMPORTRANGE), no gratis.
- Lo impecable de la spec y que se mantiene: esquema de columnas
  (compat legacy + nuevas), OUTLET visible "(O)"/"(OUTLET)", hojas por
  marca como vistas filtradas (no fuente de fórmulas), Productos PVP
  como única fuente para las planillas diarias.

## Generador de descripciones — diseño derivado del análisis de patrones

Fuente: `docs/16-patrones-descripcion-productos.md` (análisis de Victor sobre
54 rubros, 1212 productos Madre + 1192 Existencias). Es el seed de
`catalog_templates` + `catalog_abbreviations` y especifica el algoritmo.

**Ajuste de modelo necesario (vs Etapa 1):** el `campos_obligatorios` JSONB de
`catalog_templates` NO puede ser una lista plana de nombres. Cada campo
necesita: `name`, `label`, `type` (text/number/select) y, para selects, las
`opciones` con `{valor, comercial, abrev_erp}`. Es lo que permite que el mismo
campo genere a la vez el texto comercial ("frío/calor") y la abreviatura ERP
("F/C"). Sin esto el generador no puede armar las dos descripciones. (No
requiere migración: la columna ya es JSONB; solo definimos la estructura del
contenido.)

**Algoritmo de descripción ERP (cascada de 50 chars, doc §5 regla 6 + por rubro):**
1. Armar ERP completo con el patrón del rubro.
2. Normalizar: MAYÚSCULAS, sin tildes, sin dobles espacios.
3. Si >50: aplicar diccionario de abreviaturas.
4. Si sigue >50: quitar campos opcionales.
5. Si sigue >50: mantener rubro+marca+modelo+dato clave.
6. Si sigue >50: estado `REQUIERE_REVISION_ERP`.

**Normalización de acentos antes de abreviar:** el diccionario trae variantes
con/sin tilde (FRÍO/CALOR y FRIO/CALOR, ELÉCTRICO/ELECTRICO). El generador
normaliza (strip acentos + upper) antes de buscar en el diccionario, así no
hace falta duplicar entradas.

**Lo que alimenta el flujo de NORMALIZACIÓN (no el alta nueva):** doc §11
cataloga los typos reales a auto-corregir (FREZEER→FREEZER, ORNALLAS→
HORNALLAS, 2O LTS→20 LTS, ELCETRICO→ELÉCTRICO, CONDESACIÓN→CONDENSACIÓN) y la
detección de OUTLET (985 productos por "(O)"). La pantalla de normalización
usa esto para auto-sugerir correcciones.

**Decisiones pendientes (de §11):**
- Rubros fuera del mapa: ESTUFA (3), FRIGOBAR (1), SARTEN (1). ¿Se agregan
  como rubros nuevos o van a OTROS?
- MULTIROCESADORA → MULTIPROCESADORA (typo de rubro; el doc ya lo corrige).

**Seed:** al construir la Etapa 4, cargar `catalog_templates` (1 fila por
familia+rubro con campos+patrones) y `catalog_abbreviations` (~55 entradas)
desde el doc 16, vía un script de seed idempotente.

## Próximo paso sugerido

La lógica de **generación de descripciones** (comercial + ERP desde
`catalog_templates` + `catalog_abbreviations`, con OUTLET y la cascada de 50)
es el corazón del módulo y va antes que las pantallas, porque Alta guiada y
Normalización diaria la consumen. El publisher a Sheets es Fase B/C — no se
construye hasta que la normalización esté cerca del 100%.
