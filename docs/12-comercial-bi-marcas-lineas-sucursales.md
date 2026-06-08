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
- `marca`, `tipo_producto`, `descripcion`, `sku`.
- `product_id`, `correction_id`, `match_status`.
- `cantidad`, `pvp`, `costo`, `diferencia`, `margen_porcentaje`.

`pvp` y `costo` son valores unitarios. Los reportes multiplican por
`cantidad`. `diferencia` se guarda como total de linea.

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

### Sucursales

Ruta: `/ventas-bi/sucursales`

Objetivo:

- Perfil comercial de cada sucursal.
- Ticket/PVP promedio por linea.
- Mix de marcas y tipos.
- Productos movidos.
- Oportunidades internas: lineas con baja participacion contra el consolidado.

Ejemplo: Norcenter puede aparecer como sucursal de PVP promedio alto y baja
participacion en ciertas lineas.

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
