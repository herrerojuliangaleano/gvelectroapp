# Integracion ERP - Ventas Web

Este documento explica el modulo de ventas del portal (`sales_web`) para
conversar con el equipo del ERP. El objetivo es dejar claro que datos existen
hoy, como se identifica cada pedido, que tablas PostgreSQL lo sostienen y cual
es la forma recomendada de integracion.

> Estado: documento tecnico de alineacion. No describe una integracion ya
> implementada con el ERP.

## Resumen ejecutivo

ElectroGV ya registra solicitudes de venta en PostgreSQL. Cada solicitud tiene
una cabecera (`sales_web_requests`), una lista de productos
(`sales_web_items`) y se apoya en el catalogo local (`products`) para busqueda
de articulos.

La recomendacion tecnica es integrar con el ERP mediante API REST:

- ElectroGV no debe leer ni escribir directo en tablas internas del ERP.
- El ERP no deberia depender de tablas internas de ElectroGV como contrato.
- El identificador idempotente para intercambio debe ser
  `numero_solicitud`, por ejemplo `WEB-2026-0001`.
- El ERP debe devolver su identificador propio (`erp_order_id`) y, si aplica,
  numero real de comprobante, remito o prefactura.

## Estado actual del modulo

El modulo actual esta implementado como solicitudes de venta web:

- Router backend: `backend/app/routers/sales_web/`.
- Modelo SQLAlchemy/PostgreSQL: `backend/app/models/sales_web.py`.
- Endpoints publicos internos: `/api/sales-web/*`.
- Pantallas frontend: `/venta/*`.

El flujo actual no crea una venta final en el ERP. Crea una solicitud local que
luego pasa por estados operativos:

| Estado local | Significado |
|---|---|
| `Pendiente` | Solicitud creada por un vendedor/operador. |
| `En proceso` | La solicitud fue tomada por administracion. |
| `Completado` | Administracion cargo numero de remito/prefactura. |
| `Enviado a venta web` | La solicitud fue devuelta/enviada al vendedor. |
| `Cancelado` | La solicitud quedo anulada. |

## Sistema de identificacion

ElectroGV usa dos identificadores actuales:

| Campo | Uso | Externo |
|---|---|---:|
| `id` | PK interna BIGINT de PostgreSQL. Sirve para rutas internas actuales. | No |
| `numero_solicitud` | Codigo publico de negocio, unico, formato `WEB-YYYY-0001`. | Si |

Para ERP se propone agregar, cuando exista integracion real:

| Campo futuro | Uso |
|---|---|
| `erp_order_id` | Identificador del pedido/venta dentro del ERP. |
| `erp_status` | Estado devuelto por el ERP, separado del estado local. |
| `erp_synced_at` | Fecha/hora de ultima sincronizacion exitosa. |
| `erp_last_error` | Ultimo error recibido al intentar sincronizar. |

El campo `numero_solicitud` debe ser la clave de idempotencia. Si ElectroGV
reintenta enviar el mismo pedido, el ERP debe reconocer el mismo
`numero_solicitud` y no duplicar ventas.

## Modelo de base actual

### `sales_web_requests`

Cabecera de la solicitud/pedido local.

| Campo | Tipo conceptual | Uso |
|---|---|---|
| `id` | BIGINT PK | Identificador interno. |
| `numero_solicitud` | TEXT UNIQUE | Codigo publico `WEB-YYYY-0001`. |
| `numero_remito_prefactura` | TEXT | Numero cargado por administracion cuando exista. |
| `estado` | TEXT | Estado local del flujo. |
| `vendedor_user_id` | FK `users.id` | Usuario vendedor/creador. |
| `vendedor_nombre` | TEXT | Nombre visible del vendedor. |
| `branch_id` | FK `branches.id` nullable | Sucursal asociada. |
| `sucursal` | TEXT | Texto visible de sucursal para display/compatibilidad. |
| `canal` | TEXT | Canal de venta, hoy usualmente `Venta`. |
| `dni` | TEXT | DNI/CUIT cargado para el cliente. |
| `apellido_nombre` | TEXT | Nombre o razon social cargada. |
| `telefono` | TEXT | Telefono del cliente. |
| `correo_electronico` | TEXT | Email del cliente. |
| `domicilio` | TEXT | Domicilio cargado. |
| `codigo_postal` | TEXT | Codigo postal. |
| `localidad` | TEXT | Localidad. |
| `barrio` | TEXT | Barrio, opcional operativo. |
| `entre_calles` | TEXT | Referencia de entrega, opcional. |
| `observaciones` | TEXT | Observaciones del vendedor. |
| `pago_tipo` | TEXT | `Pago completo` o `Senia`. |
| `entrega_tipo` | TEXT | `Retira en local` o `Envio`. |
| `costo_envio` | NUMERIC(14,2) nullable | Costo de envio. |
| `senia_monto` | NUMERIC(14,2) nullable | Monto de senia. |
| `saldo_restante` | NUMERIC(14,2) nullable | Saldo pendiente calculado. |
| `observacion_admin` | TEXT | Observacion administrativa. |
| `created_at`, `updated_at` | timestamptz | Trazabilidad. |
| `taken_at`, `completed_at`, `sent_to_sales_at`, `cancelled_at` | timestamptz nullable | Fechas de workflow. |
| `taken_by_user_id`, `completed_by_user_id`, `sent_to_sales_by_user_id`, `cancelled_by_user_id` | FK `users.id` nullable | Actores del workflow. |
| `cancel_reason` | TEXT | Motivo de cancelacion. |

### `sales_web_items`

Detalle de productos de la solicitud.

| Campo | Tipo conceptual | Uso |
|---|---|---|
| `id` | BIGINT PK | Identificador interno del item. |
| `request_id` | FK `sales_web_requests.id` | Cabecera asociada. |
| `sku` | TEXT | Codigo/SKU del producto si existe. |
| `producto` | TEXT | Descripcion visible. |
| `marca` | TEXT | Marca. |
| `tipo` | TEXT | Tipo/rubro. |
| `condicion` | TEXT | Condicion del producto. |
| `cantidad` | INT | Cantidad vendida/solicitada. |
| `precio_unitario` | NUMERIC(14,2) nullable | Precio unitario. |
| `total_linea` | NUMERIC(14,2) nullable | Total calculado de la linea. |

### `products`

Catalogo local usado para busqueda de productos. Es la base para que el
vendedor encuentre articulos rapidamente, pero no debe confundirse con el
maestro interno del ERP salvo que se acuerde una sincronizacion formal.

Campos relevantes:

- `sku` y `sku_normalized`.
- `marca`, `tipo`, `descripcion`.
- `pvp` / `pvp_text`.
- `costo_vigente` / `costo_text`.
- `condicion_producto`.
- `is_active`.

## Endpoints actuales de ElectroGV

Estos endpoints ya existen para uso interno de la aplicacion:

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/sales-web/options` | Opciones del formulario. |
| GET | `/api/sales-web/products` | Busqueda de productos. |
| POST | `/api/sales-web/requests` | Crea solicitud local. |
| GET | `/api/sales-web/requests` | Lista solicitudes. |
| GET | `/api/sales-web/requests/{request_id}` | Detalle. |
| PATCH | `/api/sales-web/requests/{request_id}` | Edita datos administrativos. |
| POST | `/api/sales-web/requests/{request_id}/take` | Toma solicitud. |
| POST | `/api/sales-web/requests/{request_id}/complete` | Completa solicitud. |
| POST | `/api/sales-web/requests/{request_id}/send-to-sales` | Marca enviada/devuelta a venta. |
| POST | `/api/sales-web/requests/{request_id}/cancel` | Cancela solicitud. |
| DELETE | `/api/sales-web/requests/{request_id}` | Elimina solicitud. |

Estos endpoints no son todavia el contrato ERP. El contrato ERP debe acordarse
aparte para no atar la integracion a pantallas internas.

## Integracion recomendada con ERP

### Principio

La integracion debe ser por API REST entre sistemas. La base de datos de cada
sistema queda encapsulada por su aplicacion.

No recomendado:

- Que ElectroGV escriba directo en tablas del ERP.
- Que el ERP lea directo tablas de ElectroGV.
- Compartir credenciales de base entre sistemas.
- Acoplarse a nombres fisicos de tablas como contrato de integracion.

Recomendado:

- Endpoints versionados.
- Autenticacion por token/API key acordada.
- Payload JSON estable.
- Idempotencia usando `numero_solicitud`.
- Respuestas con identificador ERP y estado.
- Logs de sincronizacion y reintentos en ElectroGV.

## API propuesta que deberia exponer el ERP

Los nombres son una propuesta de conversacion. El ERP puede ajustar rutas, pero
debe conservar los conceptos.

### Buscar AFIP

`POST /api/v1/afip/lookup`

Uso: resolver datos fiscales desde DNI/CUIT para acelerar la carga.

Request:

```json
{
  "document_type": "CUIT",
  "document_number": "30711222333"
}
```

Response esperada:

```json
{
  "ok": true,
  "document_type": "CUIT",
  "document_number": "30711222333",
  "legal_name": "CLIENTE S.A.",
  "display_name": "CLIENTE S.A.",
  "iva_condition": "Responsable Inscripto",
  "fiscal_address": "Calle 123",
  "locality": "CABA",
  "postal_code": "1000",
  "province": "Buenos Aires",
  "raw": {}
}
```

Si el ERP no puede resolver el documento, debe responder sin romper el flujo:

```json
{
  "ok": false,
  "error": "Cliente no encontrado en AFIP"
}
```

### Crear pedido/venta

`POST /api/v1/orders`

Uso: recibir desde ElectroGV una solicitud ya cargada y convertirla en pedido,
prefactura, remito o venta segun reglas del ERP.

Headers recomendados:

```http
Idempotency-Key: WEB-2026-0001
Authorization: Bearer <token>
```

Request conceptual:

```json
{
  "source": "electrogv",
  "external_id": "WEB-2026-0001",
  "created_at": "2026-05-31T15:30:00-03:00",
  "seller": {
    "username": "vendedor",
    "name": "Nombre Vendedor"
  },
  "branch": {
    "id": "sucursal-web",
    "name": "Sucursal Web"
  },
  "customer": {
    "document_type": "CUIT",
    "document_number": "30711222333",
    "name": "CLIENTE S.A.",
    "phone": "1122334455",
    "email": "cliente@example.com",
    "address": "Calle 123",
    "postal_code": "1000",
    "locality": "CABA",
    "iva_condition": "Pendiente ERP"
  },
  "payment": {
    "type": "Pago completo",
    "deposit_amount": null,
    "remaining_amount": null
  },
  "delivery": {
    "type": "Retira en local",
    "shipping_cost": null,
    "notes": ""
  },
  "items": [
    {
      "sku": "SKU-001",
      "description": "Producto ejemplo",
      "brand": "Marca",
      "quantity": 1,
      "unit_price": "100000.00",
      "line_total": "100000.00"
    }
  ],
  "notes": "Observaciones internas"
}
```

Response esperada:

```json
{
  "ok": true,
  "external_id": "WEB-2026-0001",
  "erp_order_id": "ERP-123456",
  "erp_status": "created",
  "document_number": "PV-0001-00001234",
  "message": "Pedido creado"
}
```

Response idempotente esperada si el pedido ya existia:

```json
{
  "ok": true,
  "external_id": "WEB-2026-0001",
  "erp_order_id": "ERP-123456",
  "erp_status": "already_exists",
  "document_number": "PV-0001-00001234",
  "message": "Pedido ya registrado previamente"
}
```

## Campos fiscales obligatorios

Decision actual: los campos obligatorios reales se copiaran del ERP cuando el
ERP entregue su especificacion. Hasta ese momento, ElectroGV no debe inventar
validaciones fiscales definitivas.

Tabla pendiente de completar con el equipo ERP:

| Campo ERP | Obligatorio | Origen sugerido | Estado |
|---|---:|---|---|
| Tipo documento | Pendiente | ERP / Buscar AFIP | Pendiente ERP |
| Numero documento | Pendiente | Vendedor / Buscar AFIP | Pendiente ERP |
| Razon social / nombre | Pendiente | Buscar AFIP / carga manual | Pendiente ERP |
| Condicion IVA | Pendiente | Buscar AFIP ERP | Pendiente ERP |
| Domicilio fiscal | Pendiente | Buscar AFIP ERP | Pendiente ERP |
| Localidad | Pendiente | Buscar AFIP ERP / carga manual | Pendiente ERP |
| Provincia | Pendiente | Buscar AFIP ERP | Pendiente ERP |
| Codigo postal | Pendiente | Buscar AFIP ERP / carga manual | Pendiente ERP |
| Tipo comprobante | Pendiente | Regla ERP | Pendiente ERP |
| Lista de precios / deposito / vendedor ERP | Pendiente | Regla ERP o mapeo | Pendiente ERP |

## Venta rapida como objetivo futuro

El flujo actual pide muchos datos porque nacio como solicitud administrativa.
Para mostrador o consumidor final, el objetivo futuro es que el vendedor pueda:

1. Buscar producto rapido por SKU, marca, tipo o descripcion.
2. Agregar cantidades.
3. Ingresar DNI/CUIT.
4. Usar `Buscar AFIP` desde el ERP para completar datos fiscales si aplica.
5. Confirmar pago/entrega.
6. Enviar al ERP sin reescribir informacion.

El formulario de ElectroGV debe terminar pidiendo solo lo que el ERP marque como
obligatorio para facturar/pedir, mas los datos operativos necesarios para
sucursal, vendedor, pago, entrega y productos.

## Reglas de consistencia

- `numero_solicitud` es unico en ElectroGV y debe viajar al ERP.
- El ERP debe tratar `numero_solicitud` como idempotency key.
- Los estados locales de ElectroGV no reemplazan los estados del ERP.
- El catalogo local (`products`) acelera la busqueda, pero el ERP puede validar
  stock/precio antes de aceptar el pedido.
- Si el ERP rechaza un pedido, ElectroGV debe conservar la solicitud local y
  registrar el error para reintento o correccion manual.

## Preguntas para cerrar con el equipo ERP

1. Que endpoint pueden exponer para `Buscar AFIP`?
2. Que campos fiscales son obligatorios para crear pedido/venta?
3. El ERP permite crear pedido pendiente, prefactura, remito o venta final?
4. Cual es el identificador de producto que esperan: SKU, codigo interno u otro?
5. El ERP recalcula precio/stock o acepta lo enviado por ElectroGV?
6. Que estados devuelve el ERP y como se consultan despues?
7. Que autenticacion prefieren para integracion sistema a sistema?

## Proximo trabajo recomendado

1. Validar este documento con el equipo ERP.
2. Pedir especificacion real de campos obligatorios y endpoint AFIP.
3. Agregar campos ERP futuros mediante Alembic cuando exista contrato.
4. Disenar el MVP de venta rapida sobre el contrato confirmado.
5. Implementar sincronizacion API con logs, reintentos e idempotencia.
