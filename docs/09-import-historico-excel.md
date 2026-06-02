# Import histórico de garantías desde Excel

Esta feature trae garantías históricas (más sus items, remitos, lotes ENV y
eventos de auditoría) a Postgres desde un workbook `.xlsx` generado por la
propia app (botón **Actualizar Google Sheet**) o exportado manualmente con la
misma estructura de pestañas.

> Pensado para una migración inicial de datos viejos. No reemplaza al flujo
> normal de carga desde la UI. Es idempotente: si un `warranty_code` ya existe
> en Postgres, se omite sin pisar.

## Cuándo usarlo

- Arrancar prod con los datos del sistema anterior.
- Volver a cargar garantías históricas después de un reset de datos.
- Recuperar el estado desde un backup en formato Sheet/Excel.

## Cómo usarlo (UI)

1. Ir a **Garantías → Sincronización** (la URL del SPA es `/warranties/sync`).
2. Buscar la card amarilla **Importar histórico desde Excel**.
3. Tocar **Elegir archivo .xlsx** y seleccionar el workbook.
4. Esperar el procesamiento. Aparece un panel con stats: garantías nuevas,
   ya existían, ítems creados, eventos, remitos, lotes ENV.

Permission requerida: `warranties.sync_from_sheet` (la heredan SUPERADMIN /
GERENTE / ADMINISTRADOR / JEFE_POSVENTA).

## Estructura esperada del .xlsx

El archivo debe tener al menos las siguientes pestañas. Si alguna falta, se
omite sin error.

| Pestaña | Mapeo destino | Obligatorio |
|---|---|---|
| `GARANTIAS` | `guarantees` | sí |
| `GARANTIA_ITEMS` | `guarantee_items` | no (si falta, crea 1 ítem vacío por garantía) |
| `REMITOS` | `remitos` | no |
| `REMITO_ITEMS` | `remito_items` | no (solo si la garantía referenciada existe) |
| `EVENTOS` | `guarantee_history` | no |
| `LOTES_ENV` | `guarantee_exports` | no |

### Pestaña `GARANTIAS` — columnas clave

| Columna Excel | Postgres | Notas |
|---|---|---|
| `ID GARANTIA` | `warranty_code` | clave única, agrupa items |
| `FECHA INGRESO` | `ingreso_at` | datetime |
| `EMPRESA` | `company_id` | `electro_gv` / `electro_abc_srl` o nombre legible |
| `SUCURSAL CARGA` | `branch_id` | nombre o código (ver resolvers) |
| `SUCURSAL RESPONSABLE` | `sucursal_responsable_id` | nombre o código |
| `TIPO INGRESO` | `tipo_ingreso` | `cliente_sucursal` / `cliente_deposito` / `falla_recepcion_mercaderia` / `stock_interno` / `otro` |
| `UBICACION ACTUAL` | `ubicacion_actual` | canónico o nombre de depósito |
| `ESTADO` | `status` | `1 - INGRESO` ... `10 - FINALIZADO` |
| `REVISION` | `review_status` | `pendiente_revision` / `en_revision` / `requiere_correccion` / `revisada` |
| `ENV` | `shipment_code` | código del lote (referencia a `guarantee_exports`) |
| `PROVEEDOR` | `provider_name` | texto libre |
| `CLIENTE`, `TELEFONO`, `EMAIL` | `cliente_*` | datos del cliente |
| `FACTURA`, `FECHA COMPRA` | `numero_factura`, `fecha_compra` | |
| `OBSERVACIONES` | `observations` | texto libre |

Para el resto de columnas y el detalle exacto del mapeo, ver
[`backend/app/warranty_import.py`](../backend/app/warranty_import.py).

## Resolvers de texto → ID

El Excel viejo trae textos legibles. Los resolvers están en
[`backend/app/routers/warranties/__init__.py`](../backend/app/routers/warranties/__init__.py)
(`resolve_branch_id_from_text`, `resolve_company_id_from_text`,
`resolve_user_id_from_username`).

### Sucursales / depósitos

| Texto en Excel | branch_id |
|---|---|
| `CASEROS` / `Caseros` / `1 - CASEROS` | `caseros` |
| `LANUS` / `Lanús` / `Sur` / `2 - LANUS` | `sur` |
| `CANNING` / `Canning` | `canning` |
| `NORCENTER` / `Norcenter` / `Norte` | `norte` |
| `Depósito Chiclana` / `CHICLANA` | `deposito_chiclana` |
| `Depósito Corrales` / `CORRALES` | `deposito_corrales` |
| `Depósito Cachi` / `CACHI` | `deposito_cachi` |

### Empresas

| Texto en Excel | company_id |
|---|---|
| `electro_gv` / `Electro GV` | `electro_gv` |
| `electro_abc_srl` / `Electro ABC SRL` / `abc_electro` | `electro_abc_srl` |

### Usuarios

Se buscan por `username` (case-insensitive) y como fallback por `display_name`.
Si el usuario del Excel no existe en `users`, el campo queda en NULL pero NO
falla el import (los responsables se preservan en columnas de texto cuando
aplica).

## Idempotencia

- **Garantías**: si `warranty_code` ya existe → `warranties_skipped_existing++`.
- **Remitos**: si `remito_code` ya existe → `remitos_skipped_existing++`.
- **Lotes ENV**: si `file_name` ya existe → `exports_skipped_existing++`.
- **Eventos**: nunca se deduplican (se insertan todos). Si vas a re-importar
  el mismo archivo, conviene primero borrar los eventos del import anterior.

## Pasos POST-IMPORT obligatorios

Después de cualquier import histórico hay que ejecutar tres acciones:

### 1. Resync de contadores

El import NO actualiza la tabla `guarantee_counters`. Si quedás con códigos
`GAR-2026-CAS-0012` cargados y el contador en `0`, la próxima garantía nueva
explota con `UNIQUE violation`.

Endpoint nativo:

```http
POST /api/warranties/counters/resync
```

Permission: `warranties.manage`. Reconstruye los contadores desde
`MAX(warranty_code)` por año y sucursal.

Verificación rápida:

```sql
SELECT year, sucursal_code, last_number FROM guarantee_counters ORDER BY 1, 2;
```

### 2. Mover garantías "flotantes" al depósito (si aplica)

Si el Excel tiene garantías con `ubicacion_actual="Depósito Chiclana"` pero
sin `transit_status="en_deposito"`, van a aparecer en la pantalla **Mi
sucursal** como pendientes de despacho aunque ya están físicamente en el
depósito.

Solución: marcar masivamente las garantías como recibidas en el depósito.
Bulk UPDATE de referencia:

```sql
BEGIN;

CREATE TEMP TABLE _affected AS
SELECT id, warranty_code, ubicacion_actual AS prev_ubicacion, transit_status AS prev_transit
FROM guarantees
WHERE NOT cancelled
  AND status NOT IN ('9 - ANULADA', '10 - FINALIZADO')
  AND transit_status NOT IN ('en_transito', 'en_deposito')
  AND ubicacion_actual NOT IN ('proveedor', 'en_transito_proveedor');

UPDATE guarantees g
SET ubicacion_actual = 'Depósito Chiclana',
    transit_status   = 'en_deposito',
    lugar_llegada    = COALESCE(NULLIF(lugar_llegada, ''), 'Depósito Chiclana'),
    deposito         = COALESCE(NULLIF(deposito, ''), 'Depósito Chiclana'),
    fecha_llegada_transito = COALESCE(fecha_llegada_transito, NOW()),
    updated_at = NOW(),
    updated_by_user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
FROM _affected a
WHERE g.id = a.id;

-- Audit trail
INSERT INTO guarantee_history (guarantee_id, warranty_code, action, old_status, new_status, field_name, old_value, new_value, note, details, actor_user_id, created_at)
SELECT a.id, a.warranty_code,
       'logistics_bulk_moved_to_chiclana',
       '', '',
       'ubicacion_actual', a.prev_ubicacion, 'Depósito Chiclana',
       'Migración: garantía histórica marcada como recibida en Depósito Chiclana.',
       jsonb_build_object('prev_transit_status', a.prev_transit, 'prev_ubicacion', a.prev_ubicacion, 'reason', 'historical_bulk_relocation'),
       (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
       NOW()
FROM _affected a;

COMMIT;
```

### 3. Verificar usuarios faltantes

Los responsables del Excel (`tpizarro`, etc.) probablemente no existen como
`users` en Postgres. Resultado: `responsible_user_id`/`created_by_user_id`
quedan en NULL. Si querés mantener el rastro de quién operó la garantía,
crear esos usuarios desde la UI **antes** de re-importar.

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| `400 — El archivo debe ser .xlsx` | Extensión no es `.xlsx` (no acepta `.xls` ni CSV) |
| `400 — El archivo está vacío` | El upload llegó vacío (límite de tamaño en proxy / ngrok) |
| Stats con `errors=[…]` | Falló alguna fila — el resto del import se persiste igual |
| `company_id indeterminado` en warnings | Empresa no resolvió. Asignó `electro_gv` por defecto |
| `Remito X: garantía Y no encontrada` | El remito referencia un código que NO está en `GARANTIAS` |
| Garantías "flotantes" en Mi Sucursal post-import | Falta el bulk UPDATE del paso 2 |
| `UNIQUE violation` al crear garantía nueva post-import | Falta el `/counters/resync` del paso 1 |

## Arquitectura

```text
Frontend (WarrantySyncPage.tsx)
  ↓ FormData multipart
Backend POST /api/warranties/import/historical-upload
  ↓ openpyxl + SQLAlchemy ORM
warranty_import.import_from_xlsx(file_bytes, actor)
  ↓ resolvers de texto → IDs
Postgres (guarantees, items, history, exports, remitos, remito_items)
```

Una sola transacción por workbook: si algo revienta, rollback completo.
