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
  - marca en caida o crecimiento contra el rango comparado, si el comparador
    esta activo;
  - linea desbalanceada por volumen alto y PVP relativo bajo.

Exportaciones del informe de marca:

- `PowerPoint editable`: genera un `.pptx` con graficos nativos de PowerPoint
  y tablas editables. Es la opcion recomendada para reuniones rapidas porque
  permite ajustar datos, colores, leyendas y textos desde PowerPoint. Incluye
  resumen ejecutivo, evolucion, ranking competitivo, comparacion con
  competidores, categorias, bandas de precio, tipos comerciales, zonas y
  conclusiones. La version 2.0 usa logo PNG de la marca principal, selector de
  tipos, color HEX persistente por marca, `Lavado` como agrupacion ejecutiva,
  zonas `CABA/GBA/Venta Web` y evita que la narrativa principal dependa de
  productos/SKUs puntuales.
  Como PowerPoint no conserva el hover de la app, los graficos editables se
  acompañan con tablas compactas y lecturas breves por slide.
- `PowerPoint visual`: captura las secciones del dashboard como imagen y las
  inserta en slides. Sirve cuando se quiere conservar el aspecto exacto de la
  pantalla, pero los graficos no quedan editables.

Limitacion: PowerPoint no conserva interacciones web como hover, tooltips,
drill-down o filtros por click. Para eso la fuente de verdad sigue siendo el
dashboard de la app.

### PowerPoint de marca 2.0

La especificacion viva del PowerPoint editable esta en
[22 - BI Comercial - PowerPoint de marca 2.0](22-bi-comercial-powerpoint-marca-2.md).

Corte actual:

- Logo PNG por marca principal guardado en storage.
- Color HEX por marca principal guardado en storage.
- Paleta secundaria cromatica para tipos, zonas, competidores y mercado:
  visible y profesional, sin copiar el color exacto de la marca principal.
- Selector de tipos comerciales para el dossier.
- Selector de tipos muestra todos los tipos disponibles.
- `Lavado` agrupa lavarropas, lavasecarropas/lavaseca y secarropas.
- Share por zonas: `CABA`, `GBA` y `Venta Web`.
- Presencia por zona reemplaza presencia por sucursal.
- Gamas de precio genera graficos por cada tipo seleccionado.
- Ranking competitivo apilado por tipos y ranking separado por tipo.
- Slides principales por tipos, no por productos puntuales.
- Vista externa sin costos, diferencias ni margen.

### Exportacion Excel del informe de marca

El endpoint `GET /api/sales-bi/commercial/brand-dossier/export-xlsx` genera un
Excel auditable del informe de marca. No incluye costos, diferencia ni margen:
esta pensado para reuniones comerciales y para que gerencia pueda armar tablas
dinamicas/graficos propios a partir de los datos crudos.

Parametros relevantes:

- `marca`: marca principal del informe.
- `competidores`: lista separada por coma. Los competidores elegidos se fuerzan
  dentro del ranking base aunque no esten en el top 12.
- `metric`: `units`, `pvp` o `both`.
- `fecha_desde`, `fecha_hasta`, `empresa`, `sucursal`, `sucursales`,
  `tipo_venta`: mismos filtros del dashboard.

Hojas principales:

- `Resumen`: KPIs, lecturas, fortalezas, oportunidades y acciones.
- `Evolucion mensual`: marca vs mercado por mes, en unidades/pesos y share.
- `Evolucion diaria`: marca vs mercado por dia.
- `Ranking`: ranking de marcas del periodo.
- `Categorias`, `Tipos`, `Gamas de precio`, `Productos`, `Producto x Sucursal`
  y `Sucursales`: detalle comercial por dimension.
- `Comparativo marcas`: marca base vs competidores elegidos, con diferencia
  absoluta y porcentual contra la marca base.
- `Competidores por mes`: evolucion mensual de la marca base y cada competidor,
  con unidades, pesos, share y diferencia contra la marca base.
- `Share semanal`: serie semanal de participacion de marca base, competidores
  y `OTRAS`, equivalente al grafico apilado de la app.
- `Cara a cara`: metricas comparadas, lider de cada metrica y ventaja porcentual
  del mejor contra la marca base.
- `Competidores x Sucursal`: comparacion por sucursal con share local y
  diferencias contra la marca base.
- `Categorias por mes`, `Tipos por mes`, `Categorias x Suc x Mes` y
  `Tipos x Suc x Mes`: evolucion mensual por dimension, pensada para analisis
  fino y pivots.

Convencion de porcentajes: los valores se guardan como puntos porcentuales
`0..100` con formato Excel de porcentaje literal (`0.0"%"`). No se guardan
como texto, por lo que se pueden ordenar, filtrar y usar en tablas dinamicas.

## Fase 1 - estabilizacion de metricas y lectura visual

Fecha de implementacion: 2026-06-09.

Objetivo:

- Corregir metricas base antes de seguir agregando graficos.
- Evitar que el dashboard muestre graficos vacios como si fueran resultados.
- Normalizar el lenguaje comercial visible para usuarios y agentes.

Cambios aplicados:

- `pvp_promedio` se calcula como `PVP vendido / unidades`.
- La metrica `lineas` representa lineas importadas desde `Ventas Vs. Costos`.
- `Margen %` muestra porcentaje de margen; no debe llamarse margen bruto si no
  muestra pesos.
- El modo `Ambos` se entiende como lectura conjunta de PVP y unidades. En
  graficos de ranking la escala principal sigue siendo PVP, pero la UI muestra
  tambien unidades cuando corresponde.
- Los graficos principales usan estado vacio cuando no hay datos suficientes:
  evolucion diaria, rankings, mixes, heatmap, composicion, tendencias y top
  productos.

Reglas para proximos agentes:

- No volver a calcular `pvp_promedio` por cantidad de filas o registros.
- No llamar `ticket` a ninguna metrica de esta capa: `Ventas Vs. Costos` no trae
  tickets, remitos ni recibos.
- Si se agrega un grafico nuevo, debe tener estado vacio profesional.
- Si se muestra rentabilidad, respetar permisos `sales_bi.view_costs` y
  `sales_bi.view_margin`.
- Mantener esta capa separada de las planillas diarias operativas.

## Fase 2 - graficos ejecutivos y comparativas accionables

Fecha de implementacion: 2026-06-09.

Objetivo:

- Reemplazar graficos decorativos por lecturas accionables.
- Priorizar barras, matrices, rankings y tablas comparativas.
- Hacer mas clara la interpretacion de marcas, lineas y sucursales sin cambiar
  la API.

Cambios aplicados:

- Se reemplazo el donut de participacion por barras de share con valor visible.
- Se reemplazo el radar de sucursal contra red por una comparativa de brechas
  por linea comercial en puntos porcentuales.
- Se reemplazo el radar del comparador de marcas por barras normalizadas por
  metrica.
- La vista de presentacion tambien usa barras de participacion por sucursal.
- Productos usa copy comercial consistente: surtido comun y PVP promedio por
  unidad.
- El comparador de periodo queda explicito en filtros: apagado por defecto y
  con rango editable cuando se activa. Cuando esta apagado, no se dibujan
  deltas ni lineas "anteriores" artificiales.

Reglas para proximos agentes:

- Evitar donuts y radares en esta capa salvo decision explicita del usuario.
- Para comparaciones ejecutivas, preferir:
  - barras horizontales;
  - matrices/heatmaps;
  - tablas con lider y brecha;
  - rankings clickeables.
- Si se agrega una oportunidad, debe poder leerse como accion: que pasa, donde
  pasa, cuanto se desvia y que deberia revisar el gerente.
- La vista presentacion debe seguir ocultando costo, diferencia, margen y
  recomendaciones internas.

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

#### Categoria (6 buckets) — que entiende el dashboard por "linea"

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
"Lineas mas vendidas" dentro del perfil de cada sucursal (tab
Sucursales) usando la matriz `branch_tipo_matrix`.

#### Nomenclatura UI (importante para no confundirse)

A partir de junio/2026 el dashboard usa estos terminos:

| Termino UI    | Que es en el codigo                                          |
|---------------|--------------------------------------------------------------|
| **Categoria** | Las 6 buckets (LINEA BLANCA, COCINA, ...) — columna `categoria`. Es lo que antes llamabamos "linea". |
| **Linea**     | El `tipo_producto` granular (HELADERA, LAVARROPAS, MICROONDAS, ...). Es lo que en el rubro se llama "linea de producto". |
| **SKU**       | El modelo puntual. Columna `sku`.                             |

Razon del cambio: en jerga retail "linea blanca" es una categoria, y
"linea de heladeras" es una familia de tipos. El nombre "linea" para
los 5 buckets era ambiguo — ahora "categoria" deja claro que es el
nivel mas alto.

Ruta UI: `/ventas-bi/categorias` (con alias `/ventas-bi/lineas` para
back-compat de bookmarks viejos). Internamente la `CommercialKind`
se sigue llamando `'lines'` por compat con codigo previo — no
renombrar para no romper la API y el resto del modulo.

Backfill de registros ya importados (despues de la migracion
`20260609_0001`):

```bash
docker exec electrogv-backend-prod python -c \
  "from app.sales_bi_commercial import backfill_categoria; print(backfill_categoria())"
```

`backfill_categoria(dry_run=True)` muestra el impacto sin tocar la DB.

#### Salida del endpoint `*/report`

| Campo                 | Que devuelve                                                  |
|-----------------------|---------------------------------------------------------------|
| `line_mix`            | Mix por las 6 categorias (dimension "categoria" del dashboard) |
| `tipo_mix`            | Mix global por `tipo_producto` granular                       |
| `*_line_matrix`       | Matrices cruzadas keyed por categoria                         |
| `branch_tipo_matrix`  | Sucursal × tipo granular (heladera, lavarropas, ...) — drill-down |

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

### Resolucion de `SKU NO ENCONTRADO`

Cuando `Ventas Vs. Costos` trae productos con SKU faltante o textos como
`SKU NO ENCONTRADO`, se resuelven desde la pestana `Productos` del BI
comercial.

La regla de resolucion es propia de esta capa:

- Si existe producto en el catalogo, se vincula con `product_id`.
- Al vincular con producto, el BI toma del catalogo el SKU, marca y tipo/linea
  para evitar que queden placeholders del Excel como `#N/A` o
  `SKU NO ENCONTRADO`. La descripcion importada se mantiene salvo que el
  usuario escriba una correccion manual.
- Si todavia no existe producto maestro, se puede guardar una correccion manual
  de marca, tipo/linea, SKU y descripcion.
- Luego se ejecuta rematch sobre los registros comerciales activos.

Importante: esto NO crea aliases en `sales_product_aliases` ni modifica la capa
operativa de planillas diarias. Se guarda en `sales_bi_commercial_corrections`
y solo aplica a `sales_bi_commercial_records`.

### Resolucion por lote visible

La pestana `Productos` permite abrir `Resolver lote visible` sobre los primeros
8 pendientes mostrados. El flujo es el mismo que la resolucion individual, pero
en una sola pantalla:

- cada fila mantiene el producto importado desde `Ventas Vs. Costos`;
- cada fila permite buscar y elegir su producto de catalogo;
- si no existe producto maestro, la fila permite corregir SKU, marca, tipo/linea
  y descripcion;
- solo se guardan las filas donde el usuario eligio producto o modifico campos;
- al confirmar, se crean las correcciones reutilizables y se ejecuta un unico
  rematch comercial.

Este lote no es una correccion masiva con el mismo destino para todos. Cada
pendiente puede quedar vinculado a un producto distinto.

### Auto-resolucion por sugeridos

La pestana `Productos` tambien tiene `Usar sugeridos en todos`. Esta accion
no depende del lote visible: recorre los pendientes comerciales activos,
busca el primer sugerido del catalogo para cada producto y, cuando existe,
crea una correccion reutilizable vinculada a ese producto.

Comportamiento:

- procesa hasta 10000 grupos pendientes por ejecucion;
- usa la descripcion y el SKU valido como texto de busqueda;
- ignora SKU vacios o textos como `SKU NO ENCONTRADO` para no contaminar la
  busqueda;
- crea correcciones propias de `Ventas Vs. Costos` en
  `sales_bi_commercial_corrections`;
- ejecuta un unico rematch comercial al final;
- los productos sin sugerido o con error quedan pendientes para resolucion
  manual individual o por lote visible.

Permisos requeridos: `sales_bi.aliases.manage` y `sales_bi.import`.

### Performance de carga

El BI comercial trabaja sobre `sales_bi_commercial_records` y puede acumular
decenas de miles de lineas historicas. Para evitar esperas largas, el frontend
no debe pedir todos los reportes al abrir la pantalla.

Convencion actual:

- la carga inicial usa el reporte base `brands`, que ya contiene totales,
  mix de marcas, categorias, tipos, sucursales, matrices principales, top
  productos y presencia de productos;
- las pestanas `Categorias`, `Tipos`, `Productos`, `Comparador`, `Periodos` y
  `Presentacion` reutilizan ese reporte base;
- el reporte `branches` se pide bajo demanda solo al entrar en `Sucursales` u
  `Oportunidades`, porque agrega perfiles y oportunidades internas;
- el reporte `lines` queda disponible como endpoint, pero no se pide en la
  carga inicial para evitar recalcular el mismo universo de datos.

Si en el futuro vuelve a ponerse lenta la pantalla, revisar primero la cantidad
de requests simultaneas desde `SalesBICommercialPage` antes de tocar consultas
SQL.

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
- Brechas por linea contra el promedio de red.
- Perfil de PVP, variedad de surtido, fortalezas y debilidades.

Ejemplo: Norcenter puede aparecer como sucursal de PVP promedio alto y baja
participacion en ciertas lineas.

### Productos

Ruta interna: pestana `Productos`.

Objetivo:

- Buscar por SKU, descripcion, marca o linea.
- Ordenar por PVP, unidades o PVP promedio por unidad.
- Ver costo y margen solo si el usuario tiene permiso interno.
- Detectar surtido comun: productos vendidos en todas las sucursales.
- Detectar productos exclusivos: productos vendidos en una sola sucursal.

### Periodos

Ruta interna: pestana `Periodos`.

Objetivo:

- Comparar periodo actual contra otro rango elegido por el usuario.
- Mostrar evolucion diaria superpuesta.
- Comparar marca por marca.
- Comparar sucursal por sucursal usando vendido, lineas y PVP promedio por
  unidad.
- Si el comparador esta apagado, la pestana muestra estado vacio y pide
  activarlo desde filtros.

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
