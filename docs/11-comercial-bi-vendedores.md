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

### Taxonomia de categorias (5 buckets)

Cada linea de venta queda etiquetada con una `categoria` segun el `tipo` del
producto. Antes existian dos esquemas paralelos (Gran/Medio/Pequeno electro y
una serie de "lineas comerciales") - en 2026 unificamos a un solo esquema de
**5 categorias + OTROS** que es el que el negocio usa de verdad:

| Categoria       | Tipos que la conforman                                            |
|-----------------|-------------------------------------------------------------------|
| `LINEA BLANCA`  | HELADERA, FREEZER, LAVARROPAS, LAVASECARROPAS, SECARROPAS, LAVAVAJILLAS, TORRE DE LAVADO |
| `COCINA`        | COCINA, ANAFE, HORNO, CAMPANA, MICROONDAS                         |
| `CLIMATIZACION` | AIRE ACONDICIONADO, VENTILADOR, CALOVENTOR, CONVECTOR, PANEL, CALEFON, TERMOTANQUE, PURIFICADOR |
| `TV / AUDIO`    | TV, MONITOR, PARLANTE, MINICOMPONENTE                             |
| `PEQUENOS`      | ARROCERA, ASPIRADORA, BATIDORA, CAFETERA, CERVECERA, CHOPPER, ESPUMADOR, EXPRIMIDOR, EXTRACTOR, FREIDORA, JARRA, LICUADORA, LIMPIADOR ZAP, MIXER, MOLINO, MOLINILLO, MULTIOLLA, MULTIPROCESADORA, PAVA, PICADORA, PLANCHA, PROCESADORA, QUITAPELUSAS, SANDWICHERA, SOPERA, TOSTADORA, VAPORIZADOR, YOGURTERA |
| `OTROS`         | Cualquier tipo no listado arriba                                  |

Reglas:
- Match exacto contra el frozenset correspondiente sobre el tipo normalizado
  (uppercase, sin acentos, ver `_norm()` en `backend/app/sales_bi.py`).
- Si no hay match exacto, fallback por substring sobre el tipo (ej.
  `HELADERA NO FROST` -> `LINEA BLANCA` via keyword `HELADERA`). El keyword
  ` TV ` esta padded para evitar matches falsos contra cadenas como `TVS`.
- Si nada matchea -> `OTROS` (NO se asume "pequeno electro por descarte"
  como hacia el codigo viejo).

Para agregar un tipo nuevo:
1. Sumarlo al frozenset `_CAT_*` correspondiente en `sales_bi.py`.
2. Si la planilla puede traer descripciones libres no canonicas, agregar el
   keyword en `_CATEGORIA_KEYWORDS` para el fallback.

Tras cambiar la taxonomia, re-clasificar registros ya guardados en lugar de
pedir re-importacion completa:

```bash
docker exec electrogv-backend python -c \
  "from app.sales_bi import reclassify_existing_records; print(reclassify_existing_records())"
```

`reclassify_existing_records(dry_run=True)` muestra el impacto sin tocar la
DB. Sin `dry_run` aplica el UPDATE en la tabla `sales_records` (campos
`categoria` y `linea`, ambos quedan con el mismo valor).

Nota: el campo `linea` quedo como alias del `categoria` por compatibilidad
con codigo viejo que lo leia aparte. Hoy ambos contienen el mismo valor de
la nueva taxonomia - se podria dropear `linea` en un refactor futuro.

### Empresas + sucursales (modelo de datos)

Cada planilla importada vive en `sales_imports` y queda linkeada a un
`branch_id` (tabla `branches`), que a su vez tiene `company_id` (tabla
`companies`). Asi:

```
sales_imports (sucursal: "Caseros", tipo: "local")
  └─→ branches.id = "caseros"  (type=physical)
        └─→ companies.id = "electro_gv"
```

Hoy hay **dos empresas activas**:

| Slug              | Nombre          |
|-------------------|-----------------|
| `electro_gv`      | Electro GV      |
| `electro_abc_srl` | Electro ABC SRL |

Y las sucursales que tienen ventas se reparten asi:

| Sucursal (texto en sheet) | Empresa          | Branch physical | Branch web         |
|---------------------------|------------------|-----------------|--------------------|
| `Caseros`                 | electro_gv       | `caseros`       | `caseros_web`      |
| `Canning`                 | electro_abc_srl  | `canning`       | `canning_web`      |
| `Lanus`                   | electro_abc_srl  | `sur` *         | `sur_web` *        |
| `Norcenter`               | electro_abc_srl  | `norte` *       | `norte_web` *      |

> **Mapping codename → display:** las planillas de ABC en Excel traen
> internamente "Sur" y "Norte" como codenames de Lanús y Norcenter
> respectivamente. La importacion los preserva (la sucursal del
> import queda como "Lanus"/"Norcenter" porque es el nombre que el
> usuario elige en la UI) pero el branch resuelto es `sur` / `norte`
> con su sufijo `_web` cuando aplica. Esta dualidad se documenta
> tambien en `_normalize_sucursal()` (sales_bi.py).

Como cada nombre de sucursal es **unico entre empresas** (no hay un
"Caseros" en ABC), el resolver `_find_branch_in_session()` puede
mapear sin ambiguedad. Si en el futuro entra una empresa con un
nombre repetido, habria que extender el matcher para pedir
empresa+nombre.

### Filtros del dashboard de vendedores

Los endpoints `/api/sales-bi/sellers/report` y
`/api/sales-bi/sellers/compare` aceptan los siguientes query params:

| Param         | Tipo  | Descripcion                                         |
|---------------|-------|-----------------------------------------------------|
| `fecha_desde` | str   | YYYY-MM-DD inicio del rango                         |
| `fecha_hasta` | str   | YYYY-MM-DD fin del rango (inclusive)                |
| `empresa`     | str   | Slug de `companies.id`. Vacio = todas.              |
| `sucursales`  | csv   | Nombres de sucursal separados por coma (multi).     |
| `sucursal`    | str   | Single legacy (Caseros, Canning, ...). Si vienen    |
|               |       | `sucursal` y `sucursales`, gana `sucursales`.       |
| `tipo`        | str   | `local` / `online` / vacio (ambos)                  |
| `vendedores`  | csv   | `vendedor_normalized` de cada vendedor a incluir    |

Adicional, hay un endpoint `/api/sales-bi/sellers/options` que devuelve:

```json
{
  "empresas": [
    {"id": "electro_gv", "name": "Electro GV"},
    {"id": "electro_abc_srl", "name": "Electro ABC SRL"}
  ],
  "sucursales": [
    {"name": "Caseros", "empresa_id": "electro_gv",
     "branch_ids": ["caseros", "caseros_web"]},
    {"name": "Lanus", "empresa_id": "electro_abc_srl",
     "branch_ids": ["sur", "sur_web"]},
    ...
  ]
}
```

El frontend usa esto para poblar los selectores sin hardcodear nada.

### Comparar vs período anterior (toggle)

A partir de junio/2026 el dashboard tiene un **toggle "Comparar contra
otro período"** que arranca **apagado** por default. Cuando esta
apagado:

- El frontend NO llama a `/sellers/compare` (ahorra una request).
- Los KpiCards no muestran chip de delta %.
- Los charts muestran solo la serie "actual" (sin la linea/barra
  punteada de "anterior").
- El tab "Comparar periodos" sigue accesible pero muestra solo la
  data actual con "anterior" en cero.

Cuando esta encendido, aparecen los dos date pickers de "Comparar
desde/hasta" y se restaura el comportamiento original.

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
