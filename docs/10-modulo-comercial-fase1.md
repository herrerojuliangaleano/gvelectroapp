# Módulo Comercial — Fase 1 (PSI con cruce al GFK)

> **Para qué sirve este doc**: planificar y guiar la implementación del PSI
> (Planificación de Ventas e Inventario) como nuevo módulo de la sección
> Comercial. Este doc es la fuente de verdad de la especificación. Cualquier
> agente (Codex / Claude Code) que arranque a implementar debería poder hacerlo
> sólo con este archivo y la base de código actual.
>
> **Estado**: planificado, no implementado. Cada sección incluye qué hay que
> hacer en backend y/o frontend.

---

## 1. Resumen ejecutivo

El **PSI** es una pantalla para que el gerente comercial revise semanalmente
el desempeño de cada marca: cuánto vendió, cuánto stock le queda, y poder
**ajustar manualmente** las ventas cuando el sistema operativo no las registró
correctamente. Los ajustes se aplican automáticamente al libro mensual de
ventas en Google Drive, de modo que el reporte GFK (que se genera con la
herramienta `gg`) los incluye sin intervención adicional.

**Destinatario**: rol nuevo `GERENTE_COMERCIAL`, más los actuales `GERENTE` y
`SUPERADMIN`.

**Una sola fase ahora**: el PSI reporte + ajustes manuales con cruce al GFK.
Las fases 2 (forecast simple, reposición sugerida) y 3 (modelos avanzados) se
planifican aparte cuando esta esté operativa.

---

## 2. Contexto: cómo funciona hoy el flujo comercial

### 2.1 Pipeline existente: VSC → libro mensual → GFK

```text
┌────────────────────────┐
│  Libro DIARIO (Drive)  │  Sheet en Drive. Operadores cargan ventas a
│  hojas VSC_*_TOTAL     │  mano todos los días.
└──────────┬─────────────┘
           │ vsc.py (Herramienta "Ventas VS Costos")
           ▼
┌────────────────────────┐
│  Libro MENSUAL (Drive) │  Un Sheet por mes. Cada mes vive en
│  hojas BASE_*  ocultas │  Drive/{año}/{MM-Mes}/Ventas Vs. Costos…
│  + hojas Ventas X Total│
└──────────┬─────────────┘
           │ gg.py (Herramienta "Generar GFK")
           ▼
┌────────────────────────┐
│  Reporte GFK (Drive)   │  Sheet copiado de plantilla, queda en
│  formato GFK oficial   │  Drive/{año}/GFK/{MM-Mes}/{N}-Electro GV-ABC…
└────────────────────────┘
```

Detalles puntuales:

- **`vsc.py`** hace **append** a las hojas ocultas `BASE_SUR`, `BASE_NORTE`,
  `BASE_CANNING`, `BASE_CASEROS` del libro mensual. Esquema:
  `Fecha | Sucursal | TipoVenta | Remito | Descripcion | SKU | Cantidad | Valor`.
- Las hojas **`Ventas GV Total`, `Ventas ABC Canning`, `Ventas ABC-Norte`,
  `Ventas ABC-Sur`** del libro mensual **leen de las BASE\_\*** con fórmulas. Son
  las que `gg.py` consume.
- **`gg.py`** toma rango de fechas, lee el libro mensual del/los meses que
  cubre el rango, cruza con un **catálogo de precios** (Sheet con ID
  `13PUriou-rXu8VnvKN5oe-yTdfTD9WPksVQftgVE5_Js`, alias "Productos PVP"), copia
  una plantilla a `Drive/{año}/GFK/{MM-Mes}/`, escribe el reporte y avanza un
  correlativo guardado en `gfk_secuencia.txt`.

### 2.2 Libro de Stock separado

El stock vive en un **Sheet aparte** llamado "Stock":

- Es **un único libro compartido** para ambas empresas (GV y ABC).
- La hoja maestra `Stock` se trae con `=IMPORTRANGE` desde la planilla
  "Productos PVP" (la misma del catálogo de precios). Trae:
  `MARCA | TIPO | DESCRIPCION | SKU | PVP | COSTO VIGENTE | STOCK INICIO`.
- Tiene tabs adicionales por sucursal/canal (`Planilla Caseros`, `On line
  Caseros`, `Planilla Norte`, etc.). **Fase 1 NO los usa**: el PSI consolida
  todo desde la hoja `Stock` maestra.

### 2.3 Bug existente del GFK con productos outlet

Encontrado al revisar [`gg.py:268`](../backend/legacy_scripts/Aplicacion%20de%20ElectroGV/scripts/Generar%20GFK/gg.py):

```python
def limpiar_modelo(valor) -> str:
    if pd.isna(valor):
        return ""
    texto = str(valor).replace(" (O)", "").strip()
    texto = re.sub(r"\s+", " ", texto)
    return texto
```

Dos problemas:

1. Solo matchea `" (O)"` exactamente (espacio antes, paréntesis cerrado,
   mayúscula). Variantes reales en los Sheets: `(O)` sin espacio, `( O )`,
   `(0)` con cero, `(o)` minúscula → no se limpian → no matchean el catálogo
   de precios → el producto outlet **se descarta o queda sin precio**.
2. La función "limpia" el `(O)` pero **no preserva la condición**. El reporte
   GFK termina mostrando outlet y primera como si fueran lo mismo.

**Fix** (sección 13). Es independiente del PSI: el PSI no lee del GFK output
sino del libro mensual + catálogo Postgres, donde la condición ya está bien
detectada por `has_outlet_marker` en `backend/app/product_catalog.py`.

---

## 3. Arquitectura del PSI Fase 1

### 3.1 Diagrama de fuentes y dependencias

```text
   ┌──────────────────────────┐
   │  products (Postgres)     │  Catálogo. 1193 items. Tiene marca, tipo,
   │  table: products         │  condicion_producto (OUTLET/PRIMERA detectado
   │                          │  por has_outlet_marker), sku_normalized, etc.
   └──────────┬───────────────┘
              │ resolver SKU
              ▼
   ┌──────────────────────────┐    ┌──────────────────────────┐
   │  Libro Stock (Drive)     │    │  Libro Mensual (Drive)   │
   │  hoja "Stock"            │    │  hojas Ventas X Total    │
   │  → stock por SKU         │    │  → ventas crudas en rango│
   └──────────┬───────────────┘    └──────────┬───────────────┘
              │                                │
              └───────┬────────────────────────┘
                      │
              ┌───────▼────────────────┐
              │  Endpoint              │      ┌──────────────────────┐
              │  GET /api/psi/report   │ ────►│ sales_psi_adjustments │
              │  - filtros aplicados   │      │ (Postgres, nueva)     │
              │  - merge en memoria    │      │ ajustes manuales      │
              │  - cache TTL 15min     │ ◄────┘                      │
              └───────┬────────────────┘
                      │
              ┌───────▼────────────────┐
              │  Pantalla PSI          │
              │  - filtros multi-dim   │
              │  - tabla normal        │
              │  - modo "ajustes       │
              │     avanzados"         │
              │  - export PDF          │
              │  - acción ajustar      │
              └────────────────────────┘
                       │
                       │ Al ajustar +N:
                       ▼
              ┌────────────────────────┐
              │ Backend escribe fila   │
              │ al sheet BASE_X del    │
              │ libro mensual.         │
              │ Ajuste pasa de         │
              │ pending → applied_to_  │
              │ sheet                  │
              └────────┬───────────────┘
                       │
                       │ Próxima ejecución de gg.py:
                       ▼
              ┌────────────────────────┐
              │ GFK lee el libro       │
              │ mensual (que ya tiene  │
              │ la fila nueva) y la    │
              │ incluye en el reporte. │
              │ Cero sincronización    │
              │ adicional.             │
              └────────────────────────┘
```

### 3.2 Decisiones de diseño clave

- **No se mantiene un cache persistente de hechos (`sales_psi_facts`) en
  Fase 1.** El endpoint lee de Sheets en cada request, con cache de proceso
  TTL 15 min. Si la performance se vuelve un problema con datos reales, se
  agrega tabla cache en una iteración posterior.
- **El catálogo `products` es la fuente única para marca / tipo /
  condición.** El sell out del libro mensual y el stock vienen con SKU como
  llave; el lookup contra `products` resuelve los atributos. Si un SKU no
  está en el catálogo → bandeja "productos no catalogados" (sección 7.4).
- **Los ajustes se escriben al sheet en el mismo request** que los crea (no
  hay paso manual "aplicar ajustes"). Esto evita estados intermedios y deja
  el libro mensual siempre como single source of truth.
- **El PSI consolida ambas empresas** (GV + ABC). El logo del PDF
  exportado es configurable, no determina el alcance de los datos.
- **No hay filtro de sucursal** en Fase 1. El stock consolidado y la suma
  de las 4 hojas Ventas X Total ya dan el total del grupo.

---

## 4. Fuentes de datos en detalle

### 4.1 Catálogo (`products` table)

| Campo | Uso en PSI |
|---|---|
| `sku` | mostrar en tabla |
| `sku_normalized` | join contra ventas y stock (normalizado: sin (O), sin espacios) |
| `marca` | filtro y display |
| `tipo` | filtro y display |
| `descripcion` | display |
| `condicion_producto` | filtro: `OUTLET` / `PRIMERA` |
| `is_active` | siempre filtrar por `is_active=true` |

Helpers existentes a reusar: `sku_key()`, `normalize_text()`,
`has_outlet_marker()` (todos en `backend/app/product_catalog.py`).

### 4.2 Hoja "Stock" del Libro de Stock

- **Ubicación**: Sheet en Drive. El `file_id` se configura en
  `operational_config.json` bajo nueva clave `commercial.stock_book_id`.
- **Hoja a leer**: `Stock`.
- **Header en fila 1**: `MARCA | TIPO | DESCRIPCION | SKU | PVP | COSTO VIGENTE | STOCK INICIO`.
- **Parsing**: por cada fila, tomar SKU (columna D) y STOCK INICIO (columna G).
  Normalizar SKU con `sku_key()` y armar dict `{sku_norm: stock_int}`.
- **SKUs outlet**: la hoja Stock tiene SKUs con `(O)` o `(o)` inconsistentes.
  Al normalizar con `sku_key()` se limpia y el match con `products.sku_normalized`
  funciona. La condición (OUTLET/PRIMERA) se determina por
  `products.condicion_producto`, no por el SKU del Sheet de Stock.

### 4.3 Libro Mensual de Ventas

- **Ubicación**: el script `gg.py` ya tiene la lógica para encontrarlo. La
  reusamos:
  ```text
  Drive/{año}/{MM-NombreMes}/Ventas Vs. Costos…
  ```
- **`YEAR_FOLDER_ID`** está hardcodeado en `gg.py:50` como
  `"1FU6G8gqqI73DjsrpbseG-0sbzX7_a2YK"`. Se mueve a
  `operational_config.commercial.year_folder_id` para no hardcodear.
- **Hojas a leer**:
  - `Ventas GV Total` → sucursal CASEROS
  - `Ventas ABC Canning` → sucursal CANNING
  - `Ventas ABC-Norte` → sucursal NORTE
  - `Ventas ABC-Sur` → sucursal SUR
- **Header** (sinónimos como `gg.py`):
  `fecha | tipo de venta | marca | tipo | descripcion | sku | cantidad`.
- **Filtros que aplica el PSI al leer**:
  - Fecha entre `periodo_inicio` y `periodo_fin`.
  - SKU normalizado matchea con catálogo `products` (si no, sigue: producto
    no catalogado, sección 7.4).

### 4.4 Ajustes en Postgres (`sales_psi_adjustments`)

Tabla nueva, ver schema completo en sección 9.

---

## 5. Filtros del PSI

| Filtro | Tipo | Valores | Default |
|---|---|---|---|
| `marcas` | multi-select | distinct(`products.marca` WHERE is_active) | vacío (todas) |
| `tipos` | multi-select | distinct(`products.tipo` WHERE is_active) | vacío (todos) |
| `condicion` | single-select | `TODO` / `PRIMERA` / `OUTLET` | `TODO` |
| `periodo_inicio` | date | ISO YYYY-MM-DD | lunes hace 14 días |
| `periodo_fin` | date | ISO YYYY-MM-DD | domingo de hace 7 días |

> Ejemplo del gerente: marcas=`["Samsung"]`, tipos=`["heladera","lavarropas"]`,
> condicion=`PRIMERA`, periodo=`2026-05-08 a 2026-05-18`.

---

## 6. Regla de inclusión de productos en la tabla

Un producto del catálogo aparece en la tabla del PSI si cumple los filtros Y
al menos UNA de estas condiciones:

1. `stock > 0` en la hoja Stock.
2. `sell_out_base > 0` (sumando las 4 hojas Ventas X Total en el rango).
3. Tiene al menos un ajuste con `status IN ('pending', 'applied_to_sheet')`
   y `periodo_semana` dentro del rango.

Productos con stock=0, sell_out=0 y sin ajustes **no aparecen** (sería ruido).

**Excepción**: en el modo **Ajustes avanzados** (sección 8.3) se muestran
todos los productos del catálogo que cumplan los filtros, sin descartar nada,
para que el gerente pueda agregar ajustes incluso sobre productos sin actividad.

---

## 7. Algoritmo del endpoint `GET /api/psi/report`

### 7.1 Pseudocódigo

```python
def psi_report(filtros) -> PSIReport:
    # 1. Catálogo de productos filtrados
    catalogo = session.query(Product).filter(
        Product.is_active.is_(True),
        Product.marca.in_(filtros.marcas) if filtros.marcas else true(),
        Product.tipo.in_(filtros.tipos) if filtros.tipos else true(),
        Product.condicion_producto == filtros.condicion if filtros.condicion != 'TODO' else true(),
    ).all()

    # 2. Stock (Drive, cache TTL 15 min)
    stock = cache_or_load_stock()  # dict {sku_normalized: int}

    # 3. Ventas crudas del libro mensual del rango (Drive, cache TTL 15 min)
    ventas_raw = cache_or_load_ventas(filtros.periodo_inicio, filtros.periodo_fin)
    # Estructura: dict {sku_normalized: {fecha: cantidad, sucursal: ...}}
    # Agregado: dict {sku_normalized: total_cantidad_en_rango}
    ventas_agg = aggregate_by_sku(ventas_raw)

    # 4. Ajustes pendientes (NO los applied — esos ya están en ventas_raw)
    ajustes_pending = session.query(SalesPsiAdjustment).filter(
        SalesPsiAdjustment.status == 'pending',
        SalesPsiAdjustment.periodo_semana >= filtros.periodo_inicio,
        SalesPsiAdjustment.periodo_semana <= filtros.periodo_fin,
    ).all()
    ajustes_delta_por_sku = aggregate_deltas_by_product_id(ajustes_pending)

    # 5. Historial completo de ajustes (incluso applied) para el detalle por producto
    ajustes_historial = session.query(SalesPsiAdjustment).filter(
        SalesPsiAdjustment.periodo_semana >= filtros.periodo_inicio,
        SalesPsiAdjustment.periodo_semana <= filtros.periodo_fin,
    ).all()
    historial_por_producto = group_by_product_id(ajustes_historial)

    # 6. Construcción de la tabla
    rows = []
    productos_no_catalogados = []
    for p in catalogo:
        stock_actual = stock.get(p.sku_normalized, 0)
        sell_out_base = ventas_agg.get(p.sku_normalized, 0)
        ajuste_delta = ajustes_delta_por_sku.get(p.id, 0)
        sell_out_final = sell_out_base + ajuste_delta

        if stock_actual > 0 or sell_out_final > 0 or ajuste_delta != 0:
            rows.append(PSIRow(
                product_id=p.id,
                sku=p.sku,
                descripcion=p.descripcion,
                marca=p.marca,
                tipo=p.tipo,
                condicion=p.condicion_producto,
                stock=stock_actual,
                sell_out=sell_out_final,
                sell_out_base=sell_out_base,
                ajuste_delta=ajuste_delta,
                has_pending_adjustment=ajuste_delta != 0,
                historial_ajustes=historial_por_producto.get(p.id, []),
            ))

    # 7. Detectar SKUs en ventas que NO están en catálogo
    skus_en_ventas = set(ventas_agg.keys())
    skus_del_catalogo = {p.sku_normalized for p in catalogo}
    for sku_huerfano in (skus_en_ventas - skus_del_catalogo):
        productos_no_catalogados.append(NoCatalogadoRow(
            sku_raw=ventas_raw[sku_huerfano].first_seen_sku,
            descripcion_raw=ventas_raw[sku_huerfano].first_seen_descripcion,
            cantidad_total=ventas_agg[sku_huerfano],
            sucursales=ventas_raw[sku_huerfano].sucursales,
        ))

    # 8. Ordenar y totalizar
    rows.sort(key=lambda r: (r.marca, r.tipo, r.descripcion))
    return PSIReport(
        items=rows,
        no_catalogados=productos_no_catalogados,
        totals=compute_totals(rows),
        filters_applied=filtros,
    )
```

### 7.2 Lógica de cache

- Cache de stock: `{tipo: 'stock', book_id: ..., last_fetch: ts, data: ...}`.
  TTL 15 min. Invalidable manualmente desde un botón `Refrescar` en la UI.
- Cache de ventas: por `(year, month)` → `{file_id, last_fetch, data}`. TTL 15
  min. Invalidable manualmente.
- Implementación sugerida: dict en memoria del proceso. Si en el futuro se
  usa Gunicorn con múltiples workers, mover a Redis o a una tabla cache.

### 7.3 Lógica de doble-conteo (importante)

**Solo los ajustes `status='pending'` se suman al sell_out**. Los
`applied_to_sheet` ya están escritos en el libro mensual, por lo tanto ya
vienen en `ventas_raw`. Sumarlos otra vez sería doble-conteo.

**Pero todos los ajustes (pending + applied + reverted)** del rango aparecen
en el `historial_ajustes` que se devuelve al frontend para que la celda
muestre un badge si hubo ajuste. El badge no afecta el número, solo lo señala.

### 7.4 SKUs no catalogados

Cuando una fila del libro mensual tiene un SKU que **no matchea** ningún
`products.sku_normalized`, se acumula en `no_catalogados`. El frontend lo
muestra en una bandeja aparte con:
- SKU como vino en el sheet (con sus inconsistencias de outlet).
- Descripción raw.
- Cantidad total vendida.
- Botón "Crear en catálogo" → abre `/admin/products` con el SKU prellenado.

Esto evita perder ventas por SKU mal escrito y permite mantener el catálogo
limpio.

---

## 8. UI del PSI

### 8.1 Ruta y ubicación

- Ruta: `/comercial/psi` (nuevo).
- Sidebar: nueva sección **"Comercial"** que agrupa:
  - PSI (`/comercial/psi`)
  - Inteligencia comercial (link a `/admin/sales-bi`)
  - Herramientas de Ventas/Costos (link a `/herramientas` con filtro por categoría)

### 8.2 Pantalla principal

```text
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Comercial ▸ PSI                                  [↻ Refrescar]│
│                                                                  │
│ Filtros                                                          │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ Marca:    [+ Samsung] [+ LG] [+]                              ││
│ │ Tipo:     [+ heladera] [+ lavarropas] [+]                     ││
│ │ Condición: ( Todo │ Primera │ Outlet )                        ││
│ │ Período:  [📅 08/05/2026] — [📅 18/05/2026]                   ││
│ └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│ [Aplicar]  [Limpiar filtros]    [⚙ Ajustes avanzados]  [📄 PDF] │
│                                                                  │
│ Resultados (12 productos · 4 con ajustes · 3 sin catalogar)     │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ SKU          │ Descripción          │ Stock │ Sell out │ ⚙   ││
│ ├──────────────┼──────────────────────┼───────┼──────────┼─────┤│
│ │ SBS690S2P    │ Heladera Smart Life… │   0   │   19  ●  │ +/- ││
│ │ RFN370SDINV  │ Heladera Smart Life… │  40   │   55     │ +/- ││
│ │ WMI061000W   │ Lavarropas Smart…    │  20   │   35     │ +/- ││
│ │ …                                                              ││
│ └──────────────────────────────────────────────────────────────┘│
│ Totales: stock=61, sell out=109                                  │
│                                                                  │
│ ▼ Productos sin catalogar (3)                                   │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ SBS999X (sheet)   │ HELADERA …       │ 4 vendidas │ [Crear] ││
│ │ …                                                              ││
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

- ● = badge si la celda tiene ajustes pendientes/aplicados (tooltip muestra
  historial).
- `+/-` = botón para abrir el modal de ajuste sobre esa fila.

### 8.3 Modo "Ajustes avanzados"

Botón `⚙ Ajustes avanzados` cambia el modo de la tabla:
- Muestra **todos los productos del catálogo** que cumplan los filtros, no
  solo los que tienen stock/ventas/ajustes.
- Las celdas de sell_out son **editables in-line** (input numérico). Al
  cambiar el valor, se calcula el delta y se abre el modal de ajuste con
  ese delta precargado.

### 8.4 Modal de ajuste

```text
┌──────────────────────────────────────────────────┐
│ Ajustar: Heladera Smart Life SBS690S2P           │
│                                                   │
│ Sell out actual: 19  →  nuevo: 20                │
│ Delta: +1                                        │
│ Sucursal: [Caseros ▾]                            │
│                                                   │
│ Fecha que va al GFK:                             │
│   ◉ Aleatoria dentro del rango (08/05 → 18/05)  │
│   ○ Elegir manualmente: [📅 — — — —          ]  │
│                                                   │
│ Motivo (opcional):                               │
│ [____________________________________________]   │
│                                                   │
│ ⚠ Esta acción escribe una fila al libro mensual  │
│   del rango. Es reversible.                      │
│                                                   │
│         [ Cancelar ]   [ Guardar y aplicar ]     │
└──────────────────────────────────────────────────┘
```

Reglas UI:
- Si delta = 0, deshabilitar `Guardar`.
- Si modo = manual y fecha está fuera del rango, mostrar error inline.
- Si la sucursal no se eligió y hay más de una posible (ver sección 10.4),
  no permitir continuar.

### 8.5 Historial de ajustes por producto

Click en el badge de una celda → drawer lateral con:

| Fecha del ajuste | Sucursal | Delta | Estado | Motivo | Usuario | Acción |
|---|---|---|---|---|---|---|
| 13/05 (manual) | Caseros | +1 | applied | venta web | admin | [Revertir] |
| 15/05 (random) | Sur | -1 | applied | doble carga | admin | [Revertir] |

`Revertir` borra la fila del sheet correspondiente y marca el ajuste como
`reverted` con timestamp y usuario.

### 8.6 Export PDF

Botón `📄 PDF` abre modal:

```text
┌────────────────────────────────────────┐
│ Exportar PSI a PDF                     │
│                                         │
│ Logo:    ( GV │ ABC │ Sin logo )       │
│ Título:  [PSI SMART LIFE 8/05 AL 18/05]│
│                                         │
│ [Cancelar]              [Generar PDF]  │
└────────────────────────────────────────┘
```

El backend renderiza con `reportlab` (mismo enfoque que `pdf_remito.py`).
Formato similar al screenshot del Sheet "PSI SMART LIFE 8/05 AL 18/05":
logo arriba, título centrado, tabla con SKU/Descripción/Stock/Sell out.

---

## 9. Schema SQL

Migración Alembic nueva:
`backend/alembic/versions/20260603_0001_sales_psi_adjustments.py`.

```sql
CREATE TABLE sales_psi_adjustments (
  id                 BIGSERIAL PRIMARY KEY,

  -- Producto referenciado
  product_id         BIGINT NOT NULL
                     REFERENCES products(id) ON DELETE RESTRICT,
  sku_snapshot       TEXT NOT NULL,
  marca_snapshot     TEXT NOT NULL,
  tipo_snapshot      TEXT NOT NULL,
  condicion_snapshot TEXT NOT NULL,

  -- Ubicación temporal y geográfica
  periodo_semana     DATE NOT NULL,
  inserted_date      DATE NOT NULL,
  sucursal           TEXT NOT NULL,
                     -- CASEROS | SUR | NORTE | CANNING (lo que dictará a
                     -- qué hoja BASE_* se escribe)

  -- El ajuste
  cantidad_delta     INTEGER NOT NULL,
  valor_estimado     NUMERIC(14,2),
                     -- opcional: PVP * cantidad para columna Valor del sheet
  reason             TEXT NOT NULL DEFAULT '',

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'pending',
                     -- pending | applied_to_sheet | reverted | failed
  fecha_mode         TEXT NOT NULL,
                     -- manual | random (para auditoría)
  applied_at         TIMESTAMPTZ,
  applied_to_book    TEXT,           -- file_id del libro mensual
  applied_to_sheet_range TEXT,       -- ej "BASE_CASEROS!A123:H123"
  applied_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

  reverted_at        TIMESTAMPTZ,
  reverted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

  -- Audit
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_sales_psi_adjustments_product_id
  ON sales_psi_adjustments(product_id);
CREATE INDEX ix_sales_psi_adjustments_periodo
  ON sales_psi_adjustments(periodo_semana);
CREATE INDEX ix_sales_psi_adjustments_status
  ON sales_psi_adjustments(status);
CREATE INDEX ix_sales_psi_adjustments_sucursal
  ON sales_psi_adjustments(sucursal);
```

Modelo ORM correspondiente en `backend/app/models/sales_psi.py` (archivo
nuevo).

---

## 10. Endpoints REST

Todos bajo prefix `/api/psi`. Sub-router en
`backend/app/routers/psi/__init__.py` (módulo nuevo).

### 10.1 `GET /api/psi/options`

Devuelve las opciones disponibles para los multi-select de filtros.

**Permission**: `psi.view`

**Response 200**:
```json
{
  "marcas": ["Samsung", "LG", "Whirlpool", "Smart Life", "..."],
  "tipos": ["heladera", "lavarropas", "freezer", "..."],
  "sucursales": ["CASEROS", "SUR", "NORTE", "CANNING"]
}
```

Origen: queries `SELECT DISTINCT` sobre `products` con
`is_active = true`.

### 10.2 `GET /api/psi/report`

Devuelve la tabla del PSI con filtros aplicados.

**Permission**: `psi.view`

**Query params**:
| Param | Tipo | Default | Notas |
|---|---|---|---|
| `marcas` | CSV string | "" (todas) | URL-encoded |
| `tipos` | CSV string | "" (todos) | |
| `condicion` | `TODO`\|`PRIMERA`\|`OUTLET` | `TODO` | |
| `periodo_inicio` | YYYY-MM-DD | lunes de hace 14 días | |
| `periodo_fin` | YYYY-MM-DD | domingo de hace 7 días | |
| `mode` | `default`\|`advanced` | `default` | advanced trae todo el catálogo filtrado |
| `force_refresh` | bool | false | invalida cache si true |

**Response 200**:
```json
{
  "filters_applied": {
    "marcas": ["Samsung"], "tipos": ["heladera"], "condicion": "PRIMERA",
    "periodo_inicio": "2026-05-08", "periodo_fin": "2026-05-18", "mode": "default"
  },
  "items": [
    {
      "product_id": 123,
      "sku": "SBS690S2P",
      "descripcion": "Heladera Smart Life…",
      "marca": "Smart Life",
      "tipo": "heladera",
      "condicion": "PRIMERA",
      "stock": 0,
      "sell_out": 19,
      "sell_out_base": 18,
      "ajuste_delta": 1,
      "has_pending_adjustment": true,
      "historial_ajustes": [
        { "id": 42, "fecha": "2026-05-13", "sucursal": "CASEROS",
          "delta": 1, "status": "pending", "reason": "venta web",
          "created_by": "admin", "created_at": "2026-05-19T10:00:00Z" }
      ]
    }
  ],
  "no_catalogados": [
    { "sku_raw": "XYZ123 (O)", "descripcion_raw": "HELADERA …",
      "cantidad_total": 4, "sucursales": ["CASEROS", "SUR"] }
  ],
  "totals": { "stock": 61, "sell_out": 109, "ajustes_pendientes": 2 },
  "data_freshness": {
    "stock_fetched_at": "2026-06-02T14:00:00Z",
    "ventas_fetched_at": "2026-06-02T14:00:00Z",
    "cache_hit_stock": true,
    "cache_hit_ventas": false
  }
}
```

### 10.3 `POST /api/psi/adjust`

Crea un ajuste y lo escribe al libro mensual en una sola operación.

**Permission**: `psi.adjust`

**Request body**:
```json
{
  "product_id": 123,
  "sucursal": "CASEROS",
  "cantidad_delta": 1,
  "periodo_inicio": "2026-05-08",
  "periodo_fin": "2026-05-18",
  "fecha_mode": "random",
  "fecha_manual": null,
  "reason": "venta web no registrada"
}
```

**Validaciones**:
- `product_id` existe y está activo.
- `sucursal` ∈ {CASEROS, SUR, NORTE, CANNING}.
- `cantidad_delta` ≠ 0.
- Si `fecha_mode='manual'`, `fecha_manual` está en `[periodo_inicio,
  periodo_fin]`.
- El libro mensual del mes correspondiente existe y es accesible.

**Procedimiento**:
1. Calcular `inserted_date` (manual o random).
2. Calcular `periodo_semana` = lunes de la semana de `inserted_date`.
3. INSERT en `sales_psi_adjustments` con `status='pending'`.
4. Identificar el libro mensual del mes de `inserted_date`.
5. Identificar la hoja `BASE_{sucursal}` y la próxima fila vacía.
6. APPEND fila: `inserted_date | sucursal | tipo_venta | "" | descripcion |
   sku | cantidad_delta | valor_estimado`.
7. UPDATE `sales_psi_adjustments` set `status='applied_to_sheet',
   applied_at=NOW(), applied_to_book=..., applied_to_sheet_range=...`.
8. Invalidar cache de ventas para ese mes.

Si el paso 6 falla: `status='failed'`, devolver 502.

**Response 200**:
```json
{
  "id": 42,
  "status": "applied_to_sheet",
  "inserted_date": "2026-05-13",
  "applied_to_book": "1abc…file_id…",
  "applied_to_sheet_range": "BASE_CASEROS!A123:H123",
  "message": "Ajuste aplicado al libro mensual"
}
```

### 10.4 `POST /api/psi/adjust/{id}/revert`

Borra la fila escrita en el sheet y marca el ajuste como reverted.

**Permission**: `psi.adjust`

**Procedimiento**:
1. SELECT ajuste, validar `status='applied_to_sheet'`.
2. Borrar el rango `applied_to_sheet_range` del libro `applied_to_book`.
3. UPDATE `sales_psi_adjustments` set `status='reverted', reverted_at=NOW(),
   reverted_by_user_id=...`.
4. Invalidar cache de ventas.

**Response 200**:
```json
{ "id": 42, "status": "reverted" }
```

### 10.5 `POST /api/psi/export-pdf`

Genera un PDF con la vista actual del PSI.

**Permission**: `psi.export`

**Request body**:
```json
{
  "filters": { /* mismo shape que /report */ },
  "logo": "GV" | "ABC" | "NONE",
  "titulo": "PSI SMART LIFE 8/05 AL 18/05"
}
```

**Response 200**: `application/pdf` con `Content-Disposition: attachment;
filename="psi-{titulo-slug}.pdf"`.

**Implementación**:
1. Llamar internamente al endpoint `/report` con los filtros recibidos.
2. Renderizar con `reportlab` (ver `backend/app/pdf_remito.py` para el
   patrón de estilos, márgenes, tablas).
3. Logos: dos archivos PNG en `backend/storage/brand/`:
   - `gv-electro.png`
   - `abc-electro.png`

### 10.6 `GET /api/psi/adjustments`

Histórico paginado de ajustes (todos los status).

**Permission**: `psi.view`

**Query params**: `product_id`, `sucursal`, `status`, `created_from`,
`created_to`, `limit`, `offset`.

**Response**: lista paginada.

---

## 11. Algoritmo de escritura al libro mensual

Es la parte más crítica del PSI. Detalle paso a paso:

```python
def write_adjustment_to_monthly_book(adj: SalesPsiAdjustment) -> tuple[str, str]:
    """Escribe el ajuste al libro mensual correspondiente.

    Retorna (file_id_del_libro, sheet_range_escrito).
    Levanta excepción si algo falla; el caller marca status='failed'.
    """
    settings = get_settings()
    drive = drive_service()
    sheets = sheets_service()

    # 1. Encontrar el libro mensual del mes de inserted_date
    year = adj.inserted_date.year
    month = adj.inserted_date.month
    year_folder_id = settings.commercial_year_folder_id  # config
    monthly_folder = find_folder_by_name(
        drive, year_folder_id, f"{month:02d}-{NOMBRE_MES[month]}"
    )
    monthly_book = find_file_by_partial_name(
        drive, monthly_folder["id"], "Ventas Vs. Costos"
    )

    # 2. Calcular fila destino: append a BASE_{sucursal}
    sheet_name = f"BASE_{adj.sucursal}"  # BASE_CASEROS, BASE_SUR, etc.
    existing = sheets.spreadsheets().values().get(
        spreadsheetId=monthly_book["id"],
        range=f"{sheet_name}!A:A"
    ).execute()
    next_row = len(existing.get("values", [])) + 1  # 1-indexed

    # 3. Armar la fila siguiendo el esquema del libro mensual
    # A Fecha | B Sucursal | C TipoVenta | D Remito | E Descripcion |
    # F SKU | G Cantidad | H Valor
    fila = [[
        adj.inserted_date.strftime("%d/%m/%Y"),
        f"{adj.sucursal}-AJUSTE_PSI",          # marca clara que es ajuste
        "AJUSTE",                              # TipoVenta
        f"PSI-{adj.id}",                       # Remito = identificador del ajuste
        adj.snapshot_descripcion(),
        adj.sku_snapshot,
        adj.cantidad_delta,
        adj.valor_estimado or 0,
    ]]

    # 4. Append
    target_range = f"{sheet_name}!A{next_row}:H{next_row}"
    sheets.spreadsheets().values().update(
        spreadsheetId=monthly_book["id"],
        range=target_range,
        valueInputOption="USER_ENTERED",
        body={"values": fila},
    ).execute()

    return monthly_book["id"], target_range
```

Reglas importantes:
- **Marcamos la fila como ajuste** poniendo `Sucursal = "CASEROS-AJUSTE_PSI"`
  y `TipoVenta = "AJUSTE"`. Eso permite:
  - Auditoría visual en el sheet
  - Que `vsc.py` y `gg.py` no la confundan con una venta normal del operador
    (los scripts ya conviven con strings arbitrarios).
- **`Remito = "PSI-{adj.id}"`** facilita el revert: para borrar, buscamos la
  fila con ese Remito en lugar de confiar solo en `applied_to_sheet_range`
  (que puede haber sido desplazado si alguien insertó filas a mano).
- **Revert**: implementación robusta busca por Remito y luego clear range:
  ```python
  def revert_adjustment(adj):
      target_remito = f"PSI-{adj.id}"
      values = sheets.values().get(
          spreadsheetId=adj.applied_to_book,
          range=f"BASE_{adj.sucursal}!A:H"
      ).execute().get("values", [])
      for i, row in enumerate(values):
          if len(row) >= 4 and row[3] == target_remito:
              # Borrar esta fila
              clear_range = f"BASE_{adj.sucursal}!A{i+1}:H{i+1}"
              sheets.values().clear(
                  spreadsheetId=adj.applied_to_book,
                  range=clear_range
              ).execute()
              return
      raise NotFound(f"No se encontró la fila con Remito={target_remito}")
  ```

---

## 12. Permisos y rol nuevo

### 12.1 Permisos nuevos en `backend/app/permissions.py`

```python
"psi.view":    "Ver módulo PSI",
"psi.adjust":  "Crear y revertir ajustes en PSI",
"psi.export":  "Exportar reportes PSI a PDF",
```

### 12.2 Rol nuevo `GERENTE_COMERCIAL`

Agregar a `ROLES_CATALOG` en `permissions.py`:

```python
"GERENTE_COMERCIAL": {
    "label": "Gerente Comercial",
    "description": "Acceso a PSI, BI comercial y herramientas de ventas/costos.",
    "permissions": [
        # PSI
        "psi.view", "psi.adjust", "psi.export",
        # BI Comercial existente
        "sales_bi.view", "sales_bi.view_costs", "sales_bi.view_margin",
        # Catálogo (necesita para crear productos no catalogados)
        "products.view", "products.manage", "products.providers.manage",
        # Herramientas legacy comerciales
        "tools.view", "tools.run.gg", "tools.run.nvsc", "tools.run.vsc",
        "tools.run.ncm", "tools.run.ncmc", "tools.run.cf",
        # Jobs (para ver salida de herramientas)
        "jobs.view",
    ],
}
```

### 12.3 Permisos agregados al rol GERENTE existente

Agregar al array de `GERENTE`:
- `psi.view`
- `psi.adjust`
- `psi.export`

`SUPERADMIN` ya recibe todo por wildcard `*`.

### 12.4 Acceso del frontend (`ProtectedLayout`)

Ruta `/comercial/psi` protegida con `permission="psi.view"` en
`frontend/src/App.tsx`.

---

## 13. Fix paralelo: bug del outlet en `gg.py`

**Tarea independiente del PSI**. Documentada acá para no perder de vista.

### 13.1 Diagnóstico

[`gg.py:265-270`](../backend/legacy_scripts/Aplicacion%20de%20ElectroGV/scripts/Generar%20GFK/gg.py):

```python
def limpiar_modelo(valor) -> str:
    if pd.isna(valor):
        return ""
    texto = str(valor).replace(" (O)", "").strip()
    texto = re.sub(r"\s+", " ", texto)
    return texto
```

Problemas:
1. Solo matchea `" (O)"` con espacio antes y `O` mayúscula. Variantes reales:
   `(O)`, `( O )`, `(0)`, `(o)` se ignoran → SKU queda "sucio" → no matchea
   precio.
2. La condición outlet se pierde tras limpiar. El reporte GFK no distingue
   outlet vs primera.

### 13.2 Fix propuesto

```python
import re

OUTLET_MARK_RX = re.compile(r"\s*\(\s*[Oo0]\s*\)\s*")

def limpiar_modelo(valor) -> str:
    if pd.isna(valor):
        return ""
    texto = OUTLET_MARK_RX.sub("", str(valor)).strip()
    return re.sub(r"\s+", " ", texto)

def es_outlet(valor) -> bool:
    return bool(OUTLET_MARK_RX.search(str(valor or "")))
```

Y en la armado del DataFrame de salida (`gg.py:637-651`), agregar columna
`Condición`:

```python
salida = pd.DataFrame({
    # … columnas existentes …
    "Condición": df["sku"].apply(lambda s: "OUTLET" if es_outlet(s) else "PRIMERA"),
})
```

Y al `SALIDA_HEADERS` (gg.py:76-90), agregar `"Condición"` en una columna
nueva (alargar plantilla GFK si hace falta, o reusar una columna libre como
`Familia de productos`).

### 13.3 Test manual

Después del fix, generar GFK del rango y verificar:
- SKUs como `HT60XA (O)`, `ACV530(O)`, `( o )XYZ` se limpian al mismo SKU base.
- El precio se resuelve correctamente desde la planilla PVP.
- La columna Condición distingue OUTLET de PRIMERA.

### 13.4 No bloquea el PSI

El PSI lee del libro mensual (no del output GFK) y resuelve marca/tipo/
condición desde el catálogo Postgres, donde la detección outlet ya está bien
hecha por `has_outlet_marker`. Por eso el bug del GFK es independiente.

---

## 14. Configuración necesaria

Agregar a `operational_config.json` (sección nueva `commercial`):

```json
{
  "commercial": {
    "year_folder_id": "1FU6G8gqqI73DjsrpbseG-0sbzX7_a2YK",
    "stock_book_id": "TU_FILE_ID_DEL_LIBRO_STOCK",
    "stock_sheet_name": "Stock",
    "price_sheet_id": "13PUriou-rXu8VnvKN5oe-yTdfTD9WPksVQftgVE5_Js",
    "cache_ttl_seconds": 900,
    "logos": {
      "gv_path": "backend/storage/brand/gv-electro.png",
      "abc_path": "backend/storage/brand/abc-electro.png"
    }
  }
}
```

Y agregar la pantalla de edición de esta sección en
`frontend/src/pages/OperationalConfigPage.tsx` (tab nuevo "Comercial").

---

## 15. Fases de implementación

Estimaciones realistas en días de trabajo efectivo.

| # | Tarea | Backend / Frontend | Estimado | Bloqueante |
|---|---|---|---|---|
| 1 | Migración Alembic + modelo ORM `SalesPsiAdjustment` | Backend | 0.5d | — |
| 2 | Reader de hoja Stock (cache 15min) + tests | Backend | 1d | — |
| 3 | Reader de libro mensual por rango (cache 15min) + tests | Backend | 1d | — |
| 4 | Endpoint `GET /api/psi/options` | Backend | 0.5d | 1 |
| 5 | Endpoint `GET /api/psi/report` (algoritmo completo) | Backend | 1.5d | 2, 3 |
| 6 | Pantalla PSI base (filtros + tabla normal) | Frontend | 1.5d | 4, 5 |
| 7 | Modo "Ajustes avanzados" (edición inline) | Frontend | 1d | 6 |
| 8 | Modal de ajuste + endpoint `POST /api/psi/adjust` | Full-stack | 2d | 1, 6 |
| 9 | Revert + endpoint `POST /api/psi/adjust/{id}/revert` | Full-stack | 1d | 8 |
| 10 | Bandeja "productos no catalogados" | Frontend | 0.5d | 5 |
| 11 | Export PDF (reportlab + endpoint) | Backend | 1.5d | 5 |
| 12 | Configuración nueva en operational_config + tab Comercial | Full-stack | 1d | — |
| 13 | Permisos + rol `GERENTE_COMERCIAL` | Backend | 0.5d | — |
| 14 | Sidebar: nueva sección "Comercial" agrupando PSI + BI + Tools | Frontend | 0.5d | 6 |
| 15 | Smoke + criterios de aceptación (sección 17) | Full-stack | 1d | todo |
|   | **TOTAL** | | **~14 días** | |

**Independiente y opcional**: 
| 16 | Fix bug outlet en `gg.py` + Condición en GFK output | Backend (legacy script) | 1d | — |

### Orden recomendado

Sprint 1 (semana 1): tareas 1, 2, 3, 4 → base de datos lista, los dos
readers funcionando.

Sprint 2 (semana 2): tareas 5, 6, 10 → pantalla operativa con datos reales
en modo solo lectura. Ya se puede mostrar al gerente.

Sprint 3 (semana 3): tareas 7, 8, 9 → ajustes manuales funcionando.

Sprint 4 (semana 4): tareas 11, 12, 13, 14, 15 → export, config, permisos,
sidebar, smoke.

---

## 16. Estructura de archivos a crear

```
backend/app/
├── models/
│   └── sales_psi.py                 ← NUEVO (modelo ORM)
├── routers/
│   └── psi/                         ← NUEVO (sub-paquete)
│       ├── __init__.py              ← router base + types
│       ├── report.py                ← GET /api/psi/report, /options
│       ├── adjustments.py           ← POST /adjust, /adjust/{id}/revert
│       └── export.py                ← POST /export-pdf
├── commercial/                       ← NUEVO (lógica de negocio)
│   ├── __init__.py
│   ├── stock_reader.py              ← lee hoja Stock con cache
│   ├── ventas_reader.py             ← lee libro mensual con cache
│   ├── psi_engine.py                ← algoritmo del report
│   ├── adjustments_writer.py        ← escribe al libro mensual
│   └── pdf_renderer.py              ← reportlab
└── permissions.py                    ← editar (rol nuevo + permissions)

backend/alembic/versions/
└── 20260603_0001_sales_psi_adjustments.py  ← NUEVO

frontend/src/
├── pages/
│   ├── PSIPage.tsx                  ← NUEVO (pantalla principal)
│   └── PSIAdjustmentModal.tsx       ← NUEVO (modal de ajuste)
├── api/
│   └── client.ts                    ← agregar funciones PSI
├── types/
│   └── index.ts                     ← agregar tipos PSI
└── App.tsx                          ← agregar ruta /comercial/psi

docs/
└── 10-modulo-comercial-fase1.md     ← este archivo
```

---

## 17. Criterios de aceptación (smoke manual)

Antes de cerrar la fase, validar:

### 17.1 Lectura

- [ ] `GET /api/psi/options` devuelve todas las marcas y tipos del catálogo.
- [ ] `GET /api/psi/report` con filtros vacíos devuelve todos los productos
      activos con stock>0 o ventas>0 en las últimas 2 semanas.
- [ ] Aplicar filtro `marcas=Samsung` reduce la tabla solo a Samsung.
- [ ] Aplicar `tipos=heladera,lavarropas` deja solo esos tipos.
- [ ] Aplicar `condicion=OUTLET` deja solo outlet.
- [ ] `data_freshness.cache_hit_*` indica `true` en la segunda request.
- [ ] `force_refresh=true` refresca el cache.
- [ ] Bandeja "productos no catalogados" muestra SKUs del libro mensual que
      no están en `products`.

### 17.2 Ajuste

- [ ] `POST /api/psi/adjust` con `fecha_mode=random` asigna una fecha dentro
      del rango y no es domingo.
- [ ] `POST /api/psi/adjust` con `fecha_mode=manual` y fecha en rango pasa.
- [ ] `POST /api/psi/adjust` con fecha fuera de rango devuelve 400.
- [ ] El ajuste pasa de `pending` → `applied_to_sheet` automáticamente.
- [ ] En el libro mensual aparece una fila nueva en `BASE_{sucursal}` con
      `TipoVenta="AJUSTE"` y `Remito="PSI-{id}"`.
- [ ] Al refrescar el PSI, el ajuste **NO se cuenta dos veces** (ya está en
      ventas, no se suma de pending).
- [ ] La siguiente ejecución de `gg.py` incluye la fila en el output GFK.

### 17.3 Revert

- [ ] `POST /api/psi/adjust/{id}/revert` borra la fila del libro mensual
      identificada por `Remito="PSI-{id}"`.
- [ ] El ajuste pasa a `status=reverted` con `reverted_at` y
      `reverted_by_user_id`.
- [ ] El PSI deja de mostrar el delta.

### 17.4 Export

- [ ] `POST /api/psi/export-pdf` con `logo=GV` genera PDF con logo GV.
- [ ] Logo ABC funciona igual.
- [ ] Sin logo, el espacio queda en blanco pero el resto del PDF está
      correcto.
- [ ] Título personalizado aparece en el PDF.

### 17.5 Permisos

- [ ] Usuario `GERENTE_COMERCIAL` puede ver, ajustar y exportar.
- [ ] Usuario `ADMINISTRADOR` puede ver pero NO ajustar.
- [ ] Usuario con solo `VENDEDOR` no puede entrar a `/comercial/psi`.

### 17.6 Modo Ajustes avanzados

- [ ] Botón `Ajustes avanzados` muestra TODOS los productos del catálogo
      filtrados, incluso con stock=0 y sell_out=0.
- [ ] Editar inline una celda dispara el modal de ajuste con delta
      precargado.

---

## 18. Riesgos y limitaciones

### 18.1 Performance

Lectura de Sheets a través de Google API es lento (1-3 segundos por sheet).
Con cache TTL 15min se mitiga, pero la primera request del día puede tardar
~10 seg si el rango cubre varios meses. Aceptable para Fase 1.

**Mitigación si se vuelve molesto**: agregar tabla cache
`sales_psi_facts` y poblarla periódicamente con un job.

### 18.2 Concurrencia con vsc.py

Si un operador corre `vsc.py` (que también escribe a `BASE_*`) **al mismo
tiempo** que el PSI escribe un ajuste, podría haber pisones. La probabilidad
es baja (`vsc.py` es manual, no automático), pero:

**Mitigación**: al escribir el ajuste, releer el sheet inmediatamente y
verificar que la fila quedó en la posición esperada. Si no, reintentar.

### 18.3 SKUs ambiguos

Si el catálogo tiene dos `products` con el mismo `sku_normalized` (improbable
pero posible), el lookup va a ser ambiguo. **Mitigación**: índice unique
sobre `products.sku_normalized` (ya existe en el modelo). Si rompe al
importar productos, hay un problema de datos a resolver antes del PSI.

### 18.4 Cambios manuales en el libro mensual

Si alguien edita el libro mensual a mano y mueve la fila de un ajuste, el
`applied_to_sheet_range` queda obsoleto. **Mitigación**: el revert busca
por `Remito="PSI-{id}"`, no por rango fijo.

### 18.5 Productos no catalogados

Si la mayoría de los SKUs del libro mensual no están en el catálogo, el PSI
muestra una bandeja gigante y los ajustes no tienen producto al cual
referirse. Es un caso de "datos sucios" que se debe atacar con
sincronización del catálogo desde la Planilla Madre (ya existe el botón
"Actualizar catálogo" en `/admin/product-catalog`).

---

## 19. Roadmap

### Fase 1 (este doc)
- PSI reporte + ajustes manuales con cruce a GFK.
- Bug del outlet en gg.py arreglado en paralelo.
- ETA: 14 días de trabajo efectivo.

### Fase 2 (próxima)
- Stock por sucursal (consumir las tabs `Planilla Caseros`, `On line Caseros`,
  etc. del libro Stock).
- Sugerencia de reposición simple: para cada producto con stock<X y
  sell_out promedio>Y, sugerir compra de Z unidades.
- Forecast por promedio móvil de las últimas N semanas.
- Histórico de cambios de stock (delta diario).

### Fase 3 (futuro)
- Modelos estadísticos de demanda (Holt-Winters, ARIMA simple).
- Optimización de reposición con costos y lead times reales.
- Alertas automáticas: quiebres inminentes, sobre-stock, productos
  estancados.
- Integración con proveedores para envío automático de pedidos sugeridos.

---

## 20. Glosario

| Sigla / término | Significado |
|---|---|
| **VSC** | Ventas VS Costos. Script `vsc.py`. Sincroniza el libro diario al mensual. |
| **GFK** | Reporte oficial generado por `gg.py`, copiado a `Drive/{año}/GFK/{MM}/`. |
| **PSI** | Planificación de Ventas e Inventario. Este módulo. |
| **Libro diario** | Sheet donde operadores cargan ventas a mano. Fuente del VSC. |
| **Libro mensual** | Sheet `Ventas Vs. Costos…` por mes en `Drive/{año}/{MM-Mes}/`. Destino del VSC, fuente del GFK. |
| **Libro Stock** | Sheet aparte con la hoja `Stock` (consolidado) y tabs por sucursal. |
| **Planilla Madre / Productos PVP** | Sheet con el catálogo de precios. ID `13PUriou…`. |
| **BASE_\*** | Hojas ocultas del libro mensual donde VSC hace append. |
| **Ventas X Total** | Hojas visibles del libro mensual con fórmulas que leen de BASE_\*. Las que GFK consume. |
| **Sell out** | Ventas en el rango temporal del PSI (lo opuesto a stock). |
| **Ajuste pending** | Existe en `sales_psi_adjustments` pero todavía no se escribió al sheet. |
| **Ajuste applied_to_sheet** | Ya fue escrito al libro mensual; el GFK lo va a incluir automáticamente. |
| **Ajuste reverted** | Borrado del libro mensual + marcado en Postgres. |

---

**Fin del documento.** Si encontrás inconsistencias o algo que falte, editá
este archivo directamente y commiteá los cambios. No abras un doc paralelo.
