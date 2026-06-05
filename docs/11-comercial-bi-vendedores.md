# Comercial BI - Vendedores, metricas y matching

## Objetivo

Convertir `Inteligencia comercial / Sales BI` en una base formal para analizar
ventas importadas desde planillas, con foco inicial en vendedores.

El modulo trabaja sobre PostgreSQL y toma como fuente las tablas:

- `sales_imports`: cabecera de cada importacion.
- `sales_records`: lineas de venta.
- `sales_balances`: saldos por remito.
- `sales_bi_product_aliases`: aliases propios de Sales BI para vincular
  productos que no matchean contra el catalogo.

## Importacion inteligente

La importacion sigue aceptando archivo Excel o Google Sheets. Al analizar cada
hoja:

- Detecta fecha, sucursal, tipo de hoja (`local` u `online`) y cotizacion.
- Lee lineas de venta, medios de pago y saldos.
- Normaliza vendedor en `vendedor_normalized`.
- Normaliza SKU en `sku_normalized`.
- Intenta vincular cada linea contra `products`.
- Marca cada linea con:
  - `matched`: producto resuelto automaticamente.
  - `matched_by_alias`: producto resuelto por alias de Sales BI.
  - `unmatched`: producto pendiente de vincular.

El matching usa la logica comun de `backend/app/commercial/matching.py`, pero
los aliases son exclusivos del modulo Sales BI.

### Regla contable por remito

Para evitar diferencias por la forma en que se cargan las planillas, el
importador toma el `remito` como clave operativa de una venta:

- Suma el valor de todos los productos del mismo remito.
- Suma todos los medios de pago cargados en las filas de ese remito.
- Si el pago aparece solo en una fila y los productos en varias, reparte el
  cobro proporcionalmente entre las lineas del remito.
- Calcula `saldo` como valor de productos menos cobro real.

En ventas online, la columna `MONTO INGRESADO` se interpreta como transferencia.
Si el monto ingresado es menor que la suma de productos del remito, el sistema
lo deja como sena/saldo pendiente. No se asume que una venta esta cobrada al
100% si no hay medio de pago cargado.

En planillas locales, las columnas bajo el grupo `SENA` se suman como cobro
parcial del remito, junto con los medios de pago principales.

## Productos sin vincular

La pantalla de vendedores incluye una bandeja de productos sin vincular. Desde
ahi se puede:

1. Buscar el producto correcto del catalogo.
2. Crear un alias propio de Sales BI.
3. Rematchear las importaciones afectadas.

Esto permite resolver cambios de SKU o descripcion sin modificar datos
historicos de la planilla.

## Informe de vendedores

Ruta frontend:

- `/ventas-bi/vendedores`

El informe permite:

- Rango libre `desde/hasta`.
- Presets: hoy, ayer, semana actual, semana anterior, mes actual, mes anterior
  y ultimos 30 dias.
- Filtro por sucursal.
- Filtro por tipo (`local`, `online` o ambos).
- Seleccion multiple de vendedores.
- Comparacion contra otro periodo.

## Metricas

KPIs principales:

- Total vendido.
- Total cobrado.
- Saldo.
- Unidades.
- Tickets/remitos.
- Ticket promedio.
- Participacion sobre total.
- Margen y diferencia solo si el usuario tiene permisos.

Graficos:

- Evolucion diaria.
- Ranking de vendedores.
- Mix de formas de pago.
- Ventas por marca.
- Ventas por categoria.
- Top productos.

## Exportaciones

Endpoints:

- `POST /api/sales-bi/sellers/export-pdf`
- `POST /api/sales-bi/sellers/export-xlsx`

El PDF esta pensado como informe visual para gerencia. El Excel es operativo:
incluye resumen, vendedores, evolucion, top productos, detalle y comparacion si
aplica.

## Permisos

- `sales_bi.view`: ver informes y bandejas.
- `sales_bi.import`: importar y rematchear importaciones.
- `sales_bi.aliases.manage`: crear/eliminar aliases de producto.
- `sales_bi.export`: exportar PDF/Excel.
- `sales_bi.view_costs`: ver costos.
- `sales_bi.view_margin`: ver margenes.

## Proximos pasos posibles

- Vincular vendedores de planilla con usuarios reales mediante aliases de
  vendedor.
- Agregar imagenes compartibles para reportes comerciales.
- Agregar objetivos/cuotas por vendedor y cumplimiento.
- Agregar analisis de comisiones si se definen reglas.
