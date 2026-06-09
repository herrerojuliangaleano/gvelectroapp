# Comercial BI - Marcas, Lineas y Sucursales

## Estado

[FASE] Comercial BI - capa comercial separada  
[BASE ACTIVA] PostgreSQL  
[FUENTE] `Ventas Vs. Costos`  
[RUTAS UI] `/ventas-bi/marcas`, `/ventas-bi/lineas`, `/ventas-bi/sucursales`, `/ventas-bi/comercial/importar`

## Decision central

`Ventas Vs. Costos` esta separado de las planillas diarias.

- `sales_imports` / `sales_records`: capa operativa diaria.
- `sales_bi_commercial_batches` / `sales_bi_commercial_records`: capa comercial comparable.
- `sales_bi_commercial_corrections`: correcciones propias de esta capa.

Nombre descartado: `sales_bi_import_batches`. Ese nombre aparecio en una
idea previa, pero no debe usarse porque sugiere que el lote pertenece al
importador operativo. La trazabilidad de `Ventas Vs. Costos` vive en
`sales_bi_commercial_batches`.

No mezclar estos dominios. Las planillas diarias sirven para operativa:
vendedores, remitos, senas, recibos, medios de pago y control diario.  
`Ventas Vs. Costos` sirve para analisis de productos: marca, linea/tipo,
sucursal, PVP, costo y diferencia.

## Fuente valida

El importador comercial lee solo estas hojas:

| Hoja Excel | Sucursal |
|---|---|
| `Ventas GV Total` | Caseros |
| `Ventas ABC Canning` | Canning |
| `Ventas ABC-Norte` | Norcenter |
| `Ventas ABC-Sur` | Lanus |

Reglas:

- Ignorar `BASE_*`.
- Ignorar hojas de pivots/resumen.
- `Venta Total Grupo Economico` se usa solo como validacion opcional de total consolidado.
- No cargar vendedores, remitos, senas ni medios de pago desde esta fuente.

## Adaptacion UI desde prototipo

Se revisaron los prototipos `Retail Ops Hub` y `electrogv-ic-modulo` para tomar
la experiencia de uso, no su modelo de datos.

Ideas adoptadas:

- Selector global de metrica: unidades, PVP o ambos.
- Graficos interactivos con click para filtrar o comparar.
- Heatmap `Sucursal x Linea`.
- Perfil de sucursal con fortalezas, debilidades y notas automaticas.
- Comparadores sugeridos de marcas cercanas por volumen.
- Vista de presentacion segura para reuniones externas.
- Tabs internas del modulo:
  - Resumen.
  - Marcas.
  - Lineas.
  - Sucursales.
  - Productos.
  - Comparador.
  - Periodos.
  - Oportunidades.
  - Presentacion.

Decision importante:

- Esta capa no habla de tickets porque `Ventas Vs. Costos` no trae tickets,
  remitos ni recibos.
- La metrica operativa equivalente aca es `registros` o `SKUs`, segun el caso.
- La informacion de tickets, senas, recibos y vendedores queda para la capa
  operativa futura basada en planillas diarias.

Implementacion real:

- La UI consulta en paralelo los reportes de marcas, lineas y sucursales porque
  cada endpoint aporta una seccion distinta del dashboard.
- `brands/report` alimenta resumen, marcas, productos, comparador, periodos y
  presentacion.
- `lines/report` alimenta la vista de lineas y lideres por linea.
- `branches/report` alimenta perfiles de sucursal y oportunidades internas.
- Los reportes devuelven matrices cruzadas para graficos avanzados:
  - `branch_line_matrix`.
  - `branch_brand_matrix`.
  - `brand_line_matrix`.
  - `brand_branch_matrix`.
  - `date_line_matrix`.
  - `date_brand_matrix`.
  - `date_branch_matrix`.
- Los reportes tambien devuelven `product_presence` para detectar:
  - productos vendidos en todas las sucursales;
  - productos exclusivos de una sola sucursal;
  - mix de cada producto por sucursal.
- El comparador permite comparar hasta tres marcas en simultaneo.
- La pestana de oportunidades combina:
  - sucursal debil por linea;
  - marca en caida o crecimiento contra periodo anterior;
  - linea desbalanceada por volumen alto y PVP relativo bajo.

## Modelo de datos

### `sales_bi_commercial_batches`

Representa un lote mensual o archivo completo importado.

Campos clave:

- `source_kind`: hoy `ventas_vs_costos`.
- `fuente_nombre`: nombre del archivo.
- `status`: `activo` / `anulado`.
- `period_start`, `period_end`.
- `total_records`, `total_units`, `total_pvp`, `total_costo`, `total_diferencia`.
- `warnings`.

### `sales_bi_commercial_records`

Una linea comercial de producto.

Campos clave:

- `batch_id`.
- `source_sheet`.
- `fecha`.
- `sucursal`, `branch_id`.
- `tipo_venta`: `local` / `online`.
- `marca_raw`, `tipo_raw`, `descripcion_raw`, `sku_raw`.
- `marca`, `tipo_producto`, `categoria`, `descripcion`, `sku`.
- `product_id`, `correction_id`, `match_status`.
- `cantidad`, `pvp`, `costo`, `diferencia`, `margen_porcentaje`.

`pvp` y `costo` son valores unitarios. Los reportes multiplican por
`cantidad`. `diferencia` se guarda como total de linea.

#### Categoria (5 buckets) — que entiende el dashboard por "linea"

`categoria` reemplaza al `tipo_producto` granular como la dimension
**"linea comercial"** que muestra el dashboard. Vale uno de estos 6:

| categoria       | tipos que entran (ejemplos)                                     |
|-----------------|-----------------------------------------------------------------|
| `LINEA BLANCA`  | HELADERA, FREEZER, LAVARROPAS, LAVASECARROPAS, SECARROPAS, LAVAVAJILLAS, TORRE DE LAVADO |
| `COCINA`        | COCINA, ANAFE, HORNO, CAMPANA, MICROONDAS                       |
| `CLIMATIZACION` | AIRE ACONDICIONADO, VENTILADOR, CALOVENTOR, CONVECTOR, PANEL, CALEFON, TERMOTANQUE, PURIFICADOR |
| `TV / AUDIO`    | TV, MONITOR, PARLANTE, MINICOMPONENTE                           |
| `PEQUENOS`      | CAFETERA, LICUADORA, BATIDORA, PAVA, TOSTADORA, PLANCHA, ... (lista larga) |
| `OTROS`         | cualquier tipo no listado en los 5 anteriores                   |

La clasificacion se hace con la **misma funcion** que usa el modulo
Vendedores (`sales_bi._classify`), asi que cualquier cambio de
taxonomia se propaga automaticamente a los dos modulos. Para evitar
divergencia, NO duplicar la lista en `sales_bi_commercial.py` — siempre
hacer `from .sales_bi import _classify`.

`tipo_producto` (granular: HELADERA, LAVARROPAS, MICROONDAS, ...)
**sigue guardado** para drill-down. El frontend lo expone como
secundario debajo de la categoria cuando el usuario hace click.

Backfill de registros ya importados (despues de la migracion
`20260609_0001`):

```bash
docker exec electrogv-backend-prod python -c \
  "from app.sales_bi_commercial import backfill_categoria; print(backfill_categoria())"
```

`backfill_categoria(dry_run=True)` muestra el impacto sin tocar la DB.

#### Salida del endpoint `*/report`

| Campo           | Que devuelve                                              |
|-----------------|-----------------------------------------------------------|
| `line_mix`      | Mix por las 5 categorias (dimension "linea" del dashboard) |
| `tipo_mix`      | Mix por `tipo_producto` granular (drill-down)             |
| `*_line_matrix` | Matrices cruzadas con categoria como una de las dimensiones |

`brand_line_matrix`, `branch_line_matrix`, `date_line_matrix` quedaron
todas **keyed por categoria**, no por tipo granular. Con esto se
alimentan: heatmap sucursal x linea, mix por linea en cada marca, mix
por linea en cada sucursal, etc.

### `sales_bi_commercial_corrections`

Reglas reutilizables para corregir informacion historica o lineas sin match.

Permite corregir:

- SKU.
- descripcion.
- marca.
- tipo/linea.
- vinculo opcional a `products.id`.

Estas correcciones son independientes de los aliases de las planillas diarias.

## Dashboards

### Marcas

Ruta: `/ventas-bi/marcas`

Objetivo:

- Ranking de marcas.
- Evolucion por fecha.
- Mix por sucursal, linea y tipo de venta.
- Top productos.
- Comparaciones sugeridas entre marcas cercanas por volumen.
- Evolucion diaria de la marca seleccionada.
- Mix por sucursal y por linea.
- Comparador triple entre marcas.

Uso esperado:

- Reuniones con marcas.
- Informes tipo Samsung vs otras marcas.
- Vista comercial limpia, sin rentabilidad en modo presentacion.

### Lineas

Ruta: `/ventas-bi/lineas`

Objetivo:

- Lineas/tipos mas vendidos.
- Marcas lideres por linea.
- Sucursales fuertes o debiles por linea.
- Oportunidades internas futuras.
- Heatmap `Sucursal x Linea`.
- Evolucion diaria de lineas principales.
- Composicion stacked por sucursal.

### Sucursales

Ruta: `/ventas-bi/sucursales`

Objetivo:

- Perfil comercial de cada sucursal.
- PVP promedio por linea o producto.
- Mix de marcas y tipos.
- Productos movidos.
- Oportunidades internas: lineas con baja participacion contra el consolidado.
- Evolucion diaria de la sucursal.
- Radar contra promedio de red.
- Perfil de PVP, variedad de surtido, fortalezas y debilidades.

Ejemplo: Norcenter puede aparecer como sucursal de PVP promedio alto y baja
participacion en ciertas lineas.

### Productos

Ruta interna: pestana `Productos`.

Objetivo:

- Buscar por SKU, descripcion, marca o linea.
- Ordenar por PVP, unidades o PVP promedio.
- Ver costo y margen solo si el usuario tiene permiso interno.
- Detectar surtido comun: productos vendidos en todas las sucursales.
- Detectar productos exclusivos: productos vendidos en una sola sucursal.

### Periodos

Ruta interna: pestana `Periodos`.

Objetivo:

- Comparar periodo actual contra periodo anterior equivalente.
- Mostrar evolucion diaria superpuesta.
- Comparar marca por marca.
- Comparar sucursal por sucursal usando vendido, registros y PVP promedio.

Nota: se usa `registros`, no `tickets`, porque `Ventas Vs. Costos` no trae
remitos ni recibos.

### Oportunidades

Ruta interna: pestana `Oportunidades`.

Objetivo:

- Mostrar alertas internas priorizadas por severidad.
- Explicar regla, metrica, observado, umbral, formula y accion sugerida.
- Filtrar por `critica`, `alta`, `media` e `info`.
- Mantener recomendaciones internas fuera de la vista de presentacion.

## Modo interno vs modo presentacion

Modo interno:

- Puede mostrar costo, diferencia y margen solo si el usuario tiene:
  - `sales_bi.view_costs`
  - `sales_bi.view_margin`
- Puede mostrar oportunidades internas.

Modo presentacion:

- Oculta costo, diferencia y margen aunque el usuario tenga permisos.
- Oculta oportunidades internas.
- Pensado para reuniones externas con marcas.

## Endpoints

Importacion comercial:

- `POST /api/sales-bi/commercial/analyze`
- `POST /api/sales-bi/commercial/confirm`
- `GET /api/sales-bi/commercial/batches`
- `POST /api/sales-bi/commercial/batches/{batch_id}/void`

Correcciones:

- `GET /api/sales-bi/commercial/unmatched-products`
- `POST /api/sales-bi/commercial/corrections`
- `POST /api/sales-bi/commercial/rematch-products`

Reportes:

- `GET /api/sales-bi/brands/report`
- `GET /api/sales-bi/brands/compare`
- `GET /api/sales-bi/lines/report`
- `GET /api/sales-bi/branches/report`
- `POST /api/sales-bi/commercial/export-pdf`
- `POST /api/sales-bi/commercial/export-xlsx`

## Permisos

- `sales_bi.view`: ver dashboards comerciales.
- `sales_bi.import`: importar `Ventas Vs. Costos` y rematchear.
- `sales_bi.void`: anular lotes comerciales.
- `sales_bi.aliases.manage`: crear correcciones comerciales.
- `sales_bi.export`: exportar PDF/Excel.
- `sales_bi.view_costs`: ver costos en modo interno.
- `sales_bi.view_margin`: ver margen en modo interno.

## Cobertura y limites

Esta fase NO incluye:

- medios de pago;
- senas;
- recibos;
- remitos;
- vendedores;
- control de caja;
- comparacion operativa diaria.

Eso queda para una fase futura si se recuperan o consolidan las planillas
diarias de ABC y el historico operativo.

## Handoff para agentes

Si trabajas en esta fase:

1. Leer este documento completo.
2. No insertar `Ventas Vs. Costos` en `sales_imports` ni `sales_records`.
3. No usar aliases operativos de `sales_bi_product_aliases` para esta fuente.
4. Mantener export externo sin costo/diferencia/margen.
5. Documentar cualquier nuevo filtro, metrica o endpoint en este archivo y en
   `docs/03-api-endpoints.md`.

## Validacion realizada

- Parser probado con `Ventas Vs. Costos -05-2026.xlsx`.
- Hojas detectadas:
  - Caseros: `Ventas GV Total`.
  - Canning: `Ventas ABC Canning`.
  - Norcenter: `Ventas ABC-Norte`.
  - Lanus: `Ventas ABC-Sur`.
- Total detectado: 5.657 lineas, 5.917 unidades, PVP total 3.461.833.000.
- `BASE_*` y hojas auxiliares quedaron fuera del importador.

## Defensa frontend: matrices opcionales + ErrorBoundary

Bug clasico detectado en junio/2026: si el backend desplegado en prod
es una version vieja que no devuelve las matrices cruzadas
(`branch_line_matrix`, `branch_brand_matrix`, etc.), el frontend hacia
`report.branch_line_matrix.map(...)` directo y el TypeError causaba que
React desmontara el arbol entero. La app no tenia ErrorBoundary asi
que el usuario veia **pantalla en blanco completa** y la unica forma de
recuperar era refrescar.

Las pestanas que crasheaban:

- `Resumen` (`OverviewDashboard`): `report.brand_branch_matrix` undefined.
- `Lineas` (`LinesDetail`): `report.branch_line_matrix` undefined.
- `Heatmap sucursal x linea` (dentro de Lineas): mismo.
- "Ver detalle" en oportunidades que apuntaran a `Lineas`: cascada
  del mismo crash.

Las pestanas que no crasheaban (porque usaban los helpers
`matrixByName` / `matrixSeriesRows` que ya tenian `|| []` adentro):

- `Marcas` (`BrandDetail`).
- `Sucursales` (`BranchDetail`).
- `Comparador`.
- `Periodos`.
- `Presentacion`.

Soluciones:

1. **Frontend defensivo**: cada acceso directo a `report.<matrix>.map/.slice/.flatMap`
   ahora va envuelto en `(report.<matrix> || [])`. Las funciones
   afectadas: `LinesDetail`, `Heatmap`, `BrandBranchMatrix`.
2. **ErrorBoundary** en `frontend/src/components/ErrorBoundary.tsx`:
   wrapper de clase que captura crashes y muestra mensaje + boton de
   reintentar en vez de desmontar todo. Envuelve las 3 rutas del
   dashboard comercial y la ruta del dashboard de vendedores en
   `App.tsx`. En cualquier futuro `TypeError` similar el usuario va a
   ver un mensaje claro, no pantalla negra.
3. **Backend**: `sales_bi_commercial.py` ya devuelve todas las
   matrices (`branch_line_matrix`, `branch_brand_matrix`,
   `brand_line_matrix`, `brand_branch_matrix`, `date_line_matrix`,
   `date_brand_matrix`, `date_branch_matrix`) — pero el deploy de prod
   puede estar atrasado. Mientras no se redespliegue, el frontend
   defensivo evita el crash mostrando las secciones afectadas vacias
   en lugar de tirar todo abajo.

Regla a futuro: cualquier acceso a un campo de tipo
`SalesBICommercialMatrixRow[]` debe ser via `matrixByName()` o
`matrixSeriesRows()`, o envuelto en `|| []`. Nunca llamar `.map` /
`.slice` / `.flatMap` directo sobre `report.<matrix>`.
