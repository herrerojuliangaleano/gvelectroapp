# 13 — Integracion Mobile con Puma Software

> **Estado**: documento tecnico de alineacion para la reunion con Puma.
> No describe una integracion implementada. Sirve como guion para la
> reunion y como input para debate con otra IA / consultor.
>
> **Audiencia**: Victor (CEO ElectroGV), equipo tecnico de Puma Software,
> consultores externos. Asume vocabulario tecnico medio-alto.
>
> **Fecha**: 2026-06-09 · **Version doc**: 0.1 — borrador inicial,
> esperando confirmacion de la 6ta pantalla del flujo Puma (cobranza /
> impresion final) para cerrarse.

---

## 0. Resumen ejecutivo (1 pagina)

### El problema operativo

En sucursales chicas (Norcenter, Lanus) el flujo de venta actual en
Puma — 6 pantallas, ~12 ventanas modales sobre el escritorio — es
manejable. En **Caseros**, la sucursal mas grande, **se pierden ventas
por velocidad**: cliente parado en el mostrador, vendedor tipeando en
un Windows, multiple click para abrir asistente de busqueda, buscar
articulo, elegir deposito, elegir plan, datos finales, orden de
entrega. Cada paso suma segundos. En hora pico **el cuello de botella
es la PC**, no la decision del cliente.

### La idea

Tener una app movil (gvelectroapp + Capacitor) que el vendedor pueda
operar parado al lado del cliente, escaneando codigos de barra,
buscando con autocompletado, y armando la venta en 3-4 pasos en vez
de 6 pantallas. La venta final se materializa en Puma (es el sistema
fiscal/contable de verdad) — la app es un **front-end alternativo**
para la operacion comercial.

### La pregunta tecnica que hay que cerrar en la reunion

> Como conectamos la app movil con Puma sin romper la integridad
> de los datos del ERP y sin atarse a su schema interno?

Puma propuso que **escribamos directo en su base Postgres**. Esa
opcion es la mas rapida de arrancar pero la **mas riesgosa** a
mediano plazo (ver §3.1). La recomendacion tecnica que llevamos a la
reunion es un **hibrido** (§3.3):

- **Lectura**: replica de solo-lectura de Postgres de Puma (productos,
  stock, clientes, vendedores, planes de credito).
- **Escritura**: por **API REST** que Puma exponga, con idempotencia.
- **Borrador**: la app mantiene el estado intermedio en su propia
  base hasta que Puma confirme.

### Decisiones que hay que cerrar en la reunion

1. Modelo de integracion (A / B / C / D — ver §3).
2. Quien expone que (Puma API? replica? webhook?).
3. Que entidades se exponen primero (P0 vs P1 — ver §4).
4. Quien paga el desarrollo de la API en Puma si no existe (§7).
5. SLA de respuesta y disponibilidad esperada del ERP.
6. Plan de contingencia cuando Puma esta caido.

---

## 1. Analisis del flujo actual en Puma

### 1.1 Las 6 pantallas / 12 ventanas

Recorrido completo de **una venta tipica** (TV con plan de credito,
retira el cliente, anticipo en efectivo) tal como se vio en las
capturas del 2026-06-06 / 2026-06-09:

| # | Pantalla / paso          | Ventanas abiertas | Entidades manipuladas             | Friccion observada |
|---|--------------------------|-------------------|-----------------------------------|--------------------|
| 1 | Identificar cliente      | Prefactura + **Asistente de busqueda** | Cliente (search por nombre/DNI) | 2 ventanas para encontrar 1 cliente; teclado obligatorio |
| 2 | Agregar articulo         | Prefactura + **Buscar articulo** | Producto, stock multi-deposito (LANUS / CANNING / CHICLANA / TOTAL), precio | Hay que elegir manualmente deposito de origen; no hay scan |
| 3 | Forma de pago + plan     | Prefactura (la misma) | Plan de credito (`CANCELAR PARA RETIRAR`, cuotas, fecha 1° cuota) | Sub-formulario embebido — visualmente cargado |
| 4 | Datos finales            | Prefactura + **Datos Finales** | Anticipo, Efectivo, Cheques, Saldo a favor, Vendedor (cod. `0011`), Percepciones | Otra ventana modal, repite cliente abajo |
| 5 | Emitir orden de entrega  | **Emitir Orden de Entrega** + **Confirmar Orden de Entrega** | Deposito de salida, tipo reparto (Envio/Retira), fecha, turno, domicilio, persona que retira (DNI + tel) | 2 ventanas + decision logistica al final del flujo |
| 6 | _(pendiente — falta foto)_ | — | Probable: impresion + cierre de caja / recibo | — |

**Total observado**: 5 pantallas confirmadas, 9 ventanas. Victor
reporta el flujo completo como **6 pantallas, 12 ventanas** — falta
documentar el paso final (impresion / cierre).

### 1.2 Entidades de negocio que Puma maneja (y la app necesita)

| Entidad             | Operaciones que la app necesita                     | Criticidad |
|---------------------|------------------------------------------------------|------------|
| Cliente             | search por nombre/DNI, alta rapida, ver saldo a favor / credito disponible / disponible en cuotas | P0 |
| Producto / articulo | search por codigo / descripcion, ver marca / modelo / garantia / precio | P0 |
| Stock               | ver stock por sucursal/deposito en tiempo real     | P0 |
| Vendedor            | cod. vendedor para asignar la venta                 | P0 |
| Sucursal / deposito | catalogo de depositos por sucursal                  | P0 |
| Plan de credito     | listado de planes vigentes + parametros (cuotas, anticipo) | P0 |
| Prefactura / venta  | crear, listar, anular, marcar como pagada           | P0 |
| Forma de pago       | catalogo (efectivo, cheques, tarjetas, combinadas)  | P0 |
| Anticipo / sena     | registrar parcial                                    | P0 |
| Recibo a cuenta     | registrar pagos previos del cliente                  | P1 |
| Orden de entrega    | crear, indicar tipo (envio/retira), turno, persona que retira | P0 |
| Garantia extendida  | opcional sobre articulo                              | P1 |
| Cargos extras       | instalacion, armado, fletes                          | P2 |
| AFIP / facturacion  | resolucion fiscal del cliente                        | P1 |

### 1.3 Dolores operativos detectados

1. **Velocidad**: en Caseros un vendedor demora ~3-5 min por venta solo
   en datos (sin contar la decision del cliente). Multiplicado por
   ~80 ventas/dia en hora pico → fila.
2. **Movilidad**: la PC esta fija. Si hay 3 clientes en mostrador y 2
   PCs, hay un cliente esperando solo para empezar.
3. **Multi-ventana**: el flujo de 12 ventanas modales es ergonomicamente
   pesado y, en mobile, **inviable** tal cual esta.
4. **Sin scanner integrado**: cargar SKU a mano es lento y propenso a
   error.
5. **Sin offline**: si Puma esta caido, no se vende. No hay backup.

---

## 2. Estado actual de gvelectroapp

### 2.1 Stack tecnico

| Capa              | Tecnologia                                         |
|-------------------|----------------------------------------------------|
| Backend           | FastAPI 0.110+ (Python 3.11)                      |
| ORM               | SQLAlchemy 2.x con `Mapped[]`                     |
| Migraciones       | Alembic                                            |
| Base de datos     | PostgreSQL 16 (dev `:5432`, prod-local `:5433`)   |
| Frontend          | React 18 + TypeScript + Vite                      |
| Diseno UI         | ProUI design system custom                         |
| Charts            | Recharts                                           |
| Mobile            | Capacitor (Android, iOS posible)                  |
| Auth              | JWT + Google OAuth + permisos granulares por rol  |
| Despliegue        | Docker (compose dev / prod-local)                 |
| Acceso remoto     | ngrok / Vercel + ngrok para prod-local            |

### 2.2 Modulos ya en produccion

| Modulo                  | Estado | Funciones principales                                  |
|-------------------------|--------|--------------------------------------------------------|
| Auth + roles + permisos | Prod   | login, JWT, ~50 permisos granulares, audit log         |
| Catalogo de productos   | Prod   | sync con Google Sheet, ~5k SKUs vigentes, precios/costos |
| Garantias               | Prod   | alta, revision, deposito, remitos, dashboard           |
| Recibos de sueldo       | Prod   | distribucion mensual a empleados                       |
| Empleados / legajos     | Prod   | alta, fotos, organigrama                                |
| Ventas Web (`sales_web`) | Prod   | solicitud → tomada → completada (numero remito carga admin) — **NO conecta con Puma todavia** |
| BI Comercial            | Prod   | dashboard 6 buckets (categorias) + marcas + sucursales + comparador + oportunidades |
| BI Vendedores           | Prod   | ranking, perfil, compare, periods                       |
| PSI (planificacion)     | Prod   | ajustes manuales, escritura a Google Sheets mensuales  |
| Anuncios de precios     | Prod   | comunicacion interna de cambios                         |
| Logistica de garantias  | Prod   | flujo deposito sucursal → reparacion → devolucion      |
| Tools / scripts         | Prod   | utilidades operativas                                  |

### 2.3 Mapeo de entidades app ↔ Puma

Lo que ya esta modelado del lado de la app y como se relacionaria
con Puma:

| Entidad en app         | Tabla Postgres                  | Equivalente Puma     | Fuente de verdad actual          | Que falta para mobile-Puma |
|------------------------|---------------------------------|----------------------|----------------------------------|----------------------------|
| Producto               | `products`                      | Catalogo articulos   | Google Sheet (manual de comercial) | Reemplazar fuente por Puma o sincronizar |
| Marca                  | `product_brands`                | Marca articulo       | Google Sheet                      | OK, ya cubre                |
| Proveedor              | `providers`                     | Proveedor            | App                               | OK                          |
| Sucursal               | `branches`                      | Sucursal / deposito  | App                               | Mapear ID app ↔ ID Puma     |
| Vendedor (employee)    | `employees`                     | Vendedor             | App                               | Mapear cod. vendedor (`0011`) ↔ app user |
| Cliente                | **no existe** (solo string en sales_web) | Cliente | Puma                              | **CRITICO**: hay que crear `customers` o consumir via API |
| Stock                  | **no existe**                   | Stock multi-deposito | Puma                              | **CRITICO**: idem            |
| Plan de credito        | **no existe**                   | Plan de credito      | Puma                              | **CRITICO**: idem            |
| Venta / prefactura     | `sales_web_requests`            | Prefactura           | App (solo solicitud)              | Falta el numero/comprobante real de Puma |
| Item de venta          | `sales_web_items`               | Detalle prefactura   | App                               | OK                          |
| Forma de pago          | `sales_web_requests.pago_tipo`  | Forma de pago        | App (string libre)                | Catalogarlo con IDs de Puma |
| Orden de entrega       | **no existe** (esta como campos en sales_web) | Orden de entrega | Puma | Falta entidad propia        |
| Cuenta corriente cliente | **no existe**                 | Cuenta corriente     | Puma                              | **CRITICO** para mostrar saldo |
| Recibo a cuenta        | **no existe**                   | Recibo               | Puma                              | P1                          |
| Garantia extendida     | `warranties.*` (otra cosa: garantias _post_-venta) | Garantia extendida en venta | Puma | P1 — son cosas distintas    |

### 2.4 Modulo `sales_web` — la base existente

El doc 06 (`docs/06-integracion-erp-ventas.md`) ya describe el modelo
de datos y el contrato propuesto. Sintesis:

- Tabla `sales_web_requests`: cabecera con cliente, vendedor, sucursal,
  pago, entrega.
- Tabla `sales_web_items`: detalle por SKU con cantidad y precio.
- Workflow: `Pendiente` → `Tomado` → `Completado` (admin escribe el
  numero de remito/prefactura de Puma a mano) → `Enviado a venta web`
  / `Cancelado`.
- Identificador idempotente: `numero_solicitud` formato `WEB-YYYY-0001`.
- Endpoints: `/api/sales-web/*` (10 endpoints REST).
- Pantallas: `/venta/admin`, `/venta/mis-solicitudes`, `/venta/nueva`,
  `/venta/:id`.

**Esto es la base sobre la que se construye la integracion mobile-Puma.**
Hoy es manual: admin copia y pega el numero de Puma. La integracion
real lo automatizaria.

### 2.5 Lo que falta para igualar el flujo de Puma

| Gap                                    | Impacto en mobile | Estimacion |
|----------------------------------------|-------------------|-----------|
| Tabla `customers` con cuenta corriente | Alto              | M (10-15 d) |
| Tabla `stock` por sucursal/deposito    | Alto              | M (10 d)  |
| Tabla `credit_plans` (planes vigentes) | Medio             | S (3 d)   |
| Tabla `payment_methods`                | Bajo              | S (2 d)   |
| Captura de codigo de barras (Capacitor) | Alto             | S (3 d)   |
| Pantalla "Nueva venta" en 3-4 pasos    | Alto              | L (15 d)  |
| Orden de entrega como entidad         | Medio             | S (5 d)   |
| Cliente firma en celular (touch sign) | Alto (UX)         | S (5 d)   |
| Sync con Puma (lectura)                | Alto              | M (10 d)  |
| Sync con Puma (escritura)              | Alto              | L (20 d)  |
| Manejo de offline / cola               | Alto              | M (10 d)  |
| Auditoria de cambios bidireccional    | Medio             | M (8 d)   |

Total estimado bruto: ~4-5 meses dev a 1 persona. Con scope reducido a P0: ~3 meses.

---

## 3. Opciones de integracion

Cuatro caminos para conectar gvelectroapp con Puma. Pros, contras y
veredicto de cada uno.

### 3.1 Opcion A — Escritura directa a Postgres del ERP

**Que es**: la app se conecta directo al Postgres de Puma y hace
SELECT/INSERT/UPDATE sobre sus tablas. Es lo que Puma propuso.

**Pros**:

- ✅ Time-to-market mas corto si Puma comparte el schema.
- ✅ No depende de que Puma desarrolle API.
- ✅ Lectura veloz (sin overhead HTTP).

**Contras (criticos)**:

- ❌ **Acoplamiento total al schema interno**. Cualquier cambio que
   Puma haga internamente — agregar columna NOT NULL, renombrar
   tabla, cambiar tipo NUMERIC — rompe la app sin aviso.
- ❌ **Bypass de toda la logica de negocio del ERP**. Una "venta" en
   Puma no es 1 INSERT — es 5-10 INSERTs coordinados: prefactura +
   detalle + asiento contable + libro IVA + cuenta corriente +
   stock + auditoria. Si nos olvidamos un INSERT, el balance no
   cuadra y se descubre **a fin de mes** cuando el contador cierra.
- ❌ **Sin transacciones cross-system**. Si la app cae a la mitad,
   quedan datos huerfanos (prefactura sin asiento).
- ❌ **Sin validaciones de Puma**. Reglas como "no vender por debajo
   de costo + X%", "no exceder cupo de credito", "no usar plan
   vencido" — todas hay que replicar manualmente en la app, y se
   desincronizan cuando Puma las cambia.
- ❌ **Auditoria rota**. Puma no sabe que la app escribio. Si pasa
   algo raro, el log de Puma no tiene rastro.
- ❌ **Garantia contable destruida**. Si llega una inspeccion fiscal
   y un asiento no esta porque la app no lo sabia escribir, la
   responsabilidad legal es del cliente final, no de Puma.
- ❌ **Soporte de Puma se pierde**. Si llamas a Puma porque algo no
   anda, lo primero que te van a decir es "vos escribis directo,
   resolvelo vos".
- ❌ **Upgrades de Puma rompen la app sin aviso**. Cada release
   nueva de Puma puede mover tablas.
- ❌ **Riesgo de borrado masivo**. Un `UPDATE` sin `WHERE` mal
   tipeado en produccion borra 10k clientes. Sin red de seguridad.
- ❌ **Vendor lock invertido**. La app queda casada al schema de
   Puma; cambiar de ERP en el futuro requiere reescribir todo.

**Veredicto**: **NO recomendado**. Es atractivo por velocidad pero
acumula deuda tecnica y riesgo legal/contable que no se ve hasta
que ya es tarde.

### 3.2 Opcion B — API REST entre sistemas

**Que es**: Puma expone endpoints HTTP (JSON), la app los consume.
La app nunca toca el Postgres de Puma.

**Pros**:

- ✅ Contrato versionado y estable (`v1`, `v2`, ...).
- ✅ Cada sistema mantiene su logica interna intacta.
- ✅ Idempotencia con `Idempotency-Key` (el `numero_solicitud` cumple
   ese rol — ver doc 06 §"Sistema de identificacion").
- ✅ Auditoria nativa (HTTP logs en ambos lados).
- ✅ Puma garantiza compatibilidad de su API contra sus releases.
- ✅ Soporte Puma sigue activo.
- ✅ Si en el futuro cambiamos ERP, solo re-implementamos el cliente
   HTTP. La app no se reescribe.
- ✅ El ERP devuelve identificador propio (`erp_order_id`, numero de
   comprobante) que se persiste como FK conceptual del lado app.

**Contras**:

- ⚠️ Requiere que **Puma desarrolle o exponga** endpoints. Si hoy no
   los tienen, hay costo y tiempo.
- ⚠️ Latencia HTTP (~50-200ms por request) vs ~5ms de query local.
   Mitigable con cache local + batching.
- ⚠️ Si Puma esta caido, la app no vende.
- ⚠️ Negociar el contrato de API toma tiempo (estimar 2-4 reuniones).

**Veredicto**: **recomendacion estandar de la industria**. Es lo que
hace cualquier integracion seria entre sistemas. Pero el contra de
"si Puma cae, no se vende" es serio en una sucursal grande.

### 3.3 Opcion C — Replica read-only + escritura por API (recomendacion propia)

**Que es**: hibrido pragmatico.

- **Lectura**: Postgres de Puma replica logica (logical replication
  o trigger-based CDC) hacia una **replica de solo lectura** que la
  app puede consultar directo. Productos, stock, clientes,
  vendedores, planes — todo lo que cambia poco y se lee mucho.
- **Escritura**: cualquier mutacion (crear venta, registrar pago,
  emitir orden de entrega) **siempre por API REST** que Puma exponga.
  La app nunca escribe directo a Puma.
- **Estado intermedio**: la app mantiene la **prefactura borrador**
  en su propia base hasta que Puma confirme con un numero de
  comprobante. Si la API de Puma cae, la prefactura queda en estado
  `pendiente_sync` y se reintenta.

**Arquitectura**:

```
[Mobile App / Web App]
        |
        ↓ HTTPS
[gvelectroapp Postgres]   ←─── (read replica)  ←─── [Puma Postgres]
        |                                              ↑
        ↓ HTTPS (cuando hay que confirmar)              |
[Puma API REST] ──────────────────────────────────────┘
```

**Pros**:

- ✅ **Lectura veloz** (la replica esta local — mismo data center,
   ~5-10ms): no afecta UX del vendedor en mostrador.
- ✅ **Escritura segura**: toda mutacion pasa por la logica de negocio
   de Puma (validaciones, asientos, stock, cuenta corriente).
- ✅ **Resiliente a caidas de Puma**: el vendedor sigue armando
   borradores; cuando Puma vuelve, se confirman en cola.
- ✅ **Auditoria intacta** en ambos lados.
- ✅ **Sin acoplamiento de escritura** al schema de Puma.
- ✅ Idempotencia + retry naturales.

**Contras**:

- ⚠️ Doble configuracion: replica + API.
- ⚠️ Replica lag (~segundos): si un producto se actualiza en Puma,
   la app lo ve con ~1-5s de delay. Aceptable para precio/stock.
- ⚠️ Para que la replica logica funcione, Puma tiene que habilitar
   `wal_level=logical` y crear el slot. **Necesita su cooperacion**.
- ⚠️ Resolver conflictos cuando un mismo cliente toca el carrito en
   Puma y en mobile a la vez (raro pero pasa).

**Veredicto**: **recomendacion para el meet**. Da velocidad de lectura
sin sacrificar integridad de escritura. Es lo que hace, por ejemplo,
Shopify POS con su back-office, o cualquier app movil bancaria
contra el core legacy.

### 3.4 Opcion D — Sin integracion, doble carga "optimizada"

**Que es**: la app NO se conecta con Puma. El vendedor arma el
pedido en la app (rapido en mobile), genera un QR / link / numero
de borrador, y un cajero en la PC de Puma lo carga en 30 segundos
(copia/pega en vez de tipear todo).

**Pros**:

- ✅ Cero dependencia tecnica con Puma — arrancamos manana.
- ✅ Sin riesgo legal/contable.
- ✅ Fallback obvio si Puma cae.

**Contras**:

- ❌ Sigue habiendo doble carga (aunque mas rapida).
- ❌ Cliente en mostrador igual espera al cajero.
- ❌ No mata el dolor de Caseros, solo lo atenua.

**Veredicto**: **viable como Fase 0** para validar UX mobile sin
inversion en integracion. No es solucion final.

### 3.5 Matriz comparativa

| Criterio                       | A (Direct DB) | B (API only) | C (Hibrido) | D (Sin integ.) |
|--------------------------------|:-------------:|:------------:|:-----------:|:--------------:|
| Time-to-market                 | ⭐⭐⭐          | ⭐⭐           | ⭐⭐          | ⭐⭐⭐⭐           |
| Velocidad lectura (UX)         | ⭐⭐⭐⭐         | ⭐⭐           | ⭐⭐⭐⭐         | ⭐⭐⭐            |
| Integridad contable            | ⭐             | ⭐⭐⭐⭐         | ⭐⭐⭐⭐         | ⭐⭐⭐⭐           |
| Resiliencia a caidas Puma      | ⭐             | ⭐⭐           | ⭐⭐⭐          | ⭐⭐⭐⭐           |
| Soporte de Puma                | ⭐             | ⭐⭐⭐⭐         | ⭐⭐⭐⭐         | ⭐⭐⭐⭐           |
| Riesgo legal/fiscal            | ⭐             | ⭐⭐⭐⭐         | ⭐⭐⭐⭐         | ⭐⭐⭐⭐           |
| Costo de mantenimiento         | ⭐             | ⭐⭐⭐          | ⭐⭐⭐          | ⭐⭐⭐⭐           |
| Costo de desarrollo (Puma)     | ⭐⭐⭐⭐         | ⭐⭐           | ⭐⭐           | ⭐⭐⭐⭐           |
| Costo de desarrollo (nuestro) | ⭐⭐           | ⭐⭐⭐          | ⭐⭐          | ⭐⭐⭐            |
| Portabilidad (cambiar ERP)    | ⭐             | ⭐⭐⭐⭐         | ⭐⭐⭐          | ⭐⭐⭐⭐           |
| **TOTAL (sobre 40)**           | **18**        | **30**       | **32**      | **34**         |

> **Sobre el total**: D gana en numeros porque "no hace nada riesgoso",
> pero **no resuelve el problema operativo**. La decision real es
> entre B y C. Recomiendo C.

---

## 4. Modelo de datos necesario

### 4.1 Lectura (replica desde Puma)

Que necesitamos leer y con que frecuencia se actualiza:

| Entidad         | Volumen aprox.    | Frecuencia de cambio | Tolerancia a desfase | Estrategia recomendada |
|-----------------|-------------------|----------------------|----------------------|------------------------|
| Productos       | ~5k SKUs activos  | Diaria (precios)     | ~5 min               | Replica logica + cache local 30s |
| Stock           | ~5k SKUs × 4 depositos = 20k filas | Cada venta | **< 30 seg**         | Replica logica + cache 10s **+** webhook on venta |
| Clientes        | ~20-50k historico | Esporadica (altas)   | ~1 hora              | Replica logica nocturna + delta on demand |
| Cuenta corriente | mismo que clientes | Cada pago/venta      | **< 1 min**          | Replica logica casi-realtime |
| Vendedores      | ~30                | Anual                | 1 dia                | Sync diario                            |
| Planes credito  | ~20                | Mensual              | 1 dia                | Sync diario                            |
| Formas de pago  | ~10                | Anual                | 1 semana             | Hardcode + sync mensual                |
| Depositos       | ~10                | Anual                | 1 dia                | Sync diario                            |

### 4.2 Escritura (API hacia Puma)

Que necesitamos escribir y como:

| Operacion                  | Critica? | Endpoint propuesto Puma              | Idempotency-Key      |
|----------------------------|----------|--------------------------------------|----------------------|
| Crear prefactura/venta     | Si       | `POST /api/v1/orders`                | `numero_solicitud`   |
| Anular prefactura          | Si       | `POST /api/v1/orders/:id/cancel`     | `numero_solicitud + revision` |
| Registrar pago / anticipo  | Si       | `POST /api/v1/orders/:id/payments`   | `payment_id` propio  |
| Emitir orden de entrega    | Si       | `POST /api/v1/orders/:id/delivery`   | `delivery_id` propio |
| Alta de cliente            | Si       | `POST /api/v1/customers`             | DNI/CUIT             |
| Update cliente             | No       | `PATCH /api/v1/customers/:id`        | revision             |
| Recibo a cuenta            | Si       | `POST /api/v1/customers/:id/payments` | `payment_id` propio |
| Resolver AFIP              | No       | `POST /api/v1/afip/lookup`           | DNI/CUIT             |

> Los nombres son una propuesta. Ya estan plasmados con detalle en
> doc 06 §"API propuesta que deberia exponer el ERP" (payloads JSON
> de ejemplo).

---

## 5. UX simplificada en el celular

### 5.1 De 6 pantallas a 3-4 pasos

Reduccion del flujo de Puma al minimo viable:

| Paso movil          | Equivalente Puma                       | Como se acelera                |
|---------------------|----------------------------------------|--------------------------------|
| **1. Articulos**    | Pantallas 2 + 3 (buscar + plan)        | Scan de codigo de barras + autocomplete; plan precargado |
| **2. Cliente**      | Pantalla 1 + parte 4                   | Search instantaneo + DNI por foto del DNI (OCR opcional) |
| **3. Pago + entrega** | Pantallas 3 (forma de pago) + 4 (anticipo) + 5 (orden entrega) | Una sola pantalla con 3 secciones colapsables |
| **4. Confirmar**    | Pantalla 6 (impresion / cierre)        | Cliente firma en celular; comprobante PDF al email/WhatsApp + opcion imprimir en sucursal |

### 5.2 Patrones moviles a aplicar

- **Step indicator** arriba (1 / 2 / 3 / 4) — el vendedor siempre ve
  donde esta.
- **Scanner de barras** integrado (Capacitor: `@capacitor-community/barcode-scanner`).
- **Search-as-you-type** con debounce 300ms — sin botones "Buscar".
- **Auto-fill de cliente** por DNI: pega DNI y autocompleta domicilio
  / iva / saldo (consume API o replica).
- **Bottom sheets** en vez de modales superpuestos — gestualmente
  natural en mobile.
- **Persistencia automatica** del borrador: si la app se cierra, el
  vendedor retoma donde quedo.
- **Sticky bar** con total siempre visible.
- **Modo offline indicador** — si esta sin conexion, badge amarillo
  arriba ("Sin conexion. Tu venta se sincronizara cuando vuelva").

### 5.3 Wireframe verbal de la pantalla "Nueva venta paso 1"

```
┌─────────────────────────────────┐
│ ← Volver                        │
│                                 │
│ Nueva venta · CASEROS · Juan G. │
│ ────────●────○────○────○─────── │
│         1    2    3    4         │
│                                 │
│ ╔═══════════════════════════╗   │
│ ║ 📷 Escanear codigo        ║   │
│ ╚═══════════════════════════╝   │
│                                 │
│  o buscar manual:               │
│ ┌─────────────────────────────┐ │
│ │ 🔍 TV kanji 65...           │ │
│ └─────────────────────────────┘ │
│                                 │
│ 📦 TV KANJI 65" QLED 4K SMART   │
│    KJ-65ST005-2QW · $840,000    │
│    Stock: NORCENTER ⚠ Sin stock │
│           CHICLANA ✓ 96 unid    │
│                                 │
│ [Agregar al carrito]            │
│                                 │
│ ─────────────────────────────── │
│ Carrito (1)              $840k  │
│  TV Kanji 65"  x1     [-][1][+] │
│                                 │
│ [Siguiente →]                   │
└─────────────────────────────────┘
```

---

## 6. Roadmap

### Fase 0 — Alineacion (2 semanas)

- ✅ Doc 06 escrito (ya existe).
- ✅ Este documento (13) — borrador para la reunion.
- ⬜ Reunion con Puma — definir opcion A/B/C/D.
- ⬜ Firmar minuta de la reunion con acuerdos.

### Fase 1 — Lectura (4-6 semanas, si C)

- ⬜ Habilitar `wal_level=logical` en Postgres de Puma.
- ⬜ Configurar replica logica (publication + subscription).
- ⬜ Crear tablas espejo en gvelectroapp: `customers`, `stock`,
  `credit_plans`, `payment_methods`, `depositos_puma`.
- ⬜ Endpoints `/api/puma-mirror/customers`, `/products-with-stock`,
  `/credit-plans`.
- ⬜ Pantalla mobile "Buscar producto con stock" (read-only,
  validar UX).
- ⬜ Pantalla mobile "Buscar cliente" (read-only).

**Hito Fase 1**: vendedor puede consultar stock y cliente desde
mobile, **sin crear venta**. Validamos UX y velocidad real.

### Fase 2 — Borrador (4 semanas)

- ⬜ Extender `sales_web_requests` con campos de plan de credito,
  anticipo detallado, orden de entrega.
- ⬜ Pantalla "Nueva venta" 4 pasos en mobile.
- ⬜ Scanner de codigo de barras.
- ⬜ Firma del cliente en pantalla.
- ⬜ Generar PDF de borrador / proforma.
- ⬜ Sigue siendo manual del lado Puma: el cajero lee el borrador y
  carga la venta real en Puma (Opcion D temporal).

**Hito Fase 2**: vendedor opera 100% en mobile, cajero solo confirma
en Puma. Caseros gana velocidad **sin** integracion de escritura.

### Fase 3 — Escritura via API (6-8 semanas, requiere API de Puma)

- ⬜ Puma expone `POST /api/v1/orders` y endpoints relacionados.
- ⬜ Integracion bidireccional con `Idempotency-Key`.
- ⬜ Cola de reintentos para escrituras fallidas.
- ⬜ Webhook de Puma → app cuando una orden cambia de estado
  (pagada, anulada).

**Hito Fase 3**: venta nace y vive en Puma sin intervencion manual.

### Fase 4 — Cobranza y recibos (4 semanas)

- ⬜ Registrar pagos parciales / cuenta corriente.
- ⬜ Recibos a cuenta.
- ⬜ Notificacion al cliente por WhatsApp.

### Fase 5 — Offline / contingencia (3 semanas)

- ⬜ IndexedDB local para catalogo de productos.
- ⬜ Cola de ventas offline con sync al volver online.
- ⬜ Indicador de estado de conexion en UI.

**Total bruto**: 23-27 semanas (~6 meses calendario, 1 dev). Con un
equipo de 2: ~4 meses.

---

## 7. Preguntas tecnicas para la reunion con Puma

Lleva esta lista preparada. Marca las respuestas en vivo.

### Sobre la base de datos de Puma

1. ¿Que version de Postgres usa Puma? (afecta opciones de replica
   logica).
2. ¿Tienen `wal_level=logical` habilitado o lo pueden habilitar?
3. ¿Que tablas conforman una "venta" completa? (el set de INSERTs).
4. ¿Hay triggers / stored procedures criticos en INSERT/UPDATE de
   tablas claves?
5. ¿Schema documentado? ¿Hay ER diagram?
6. ¿Que volumen aprox. (filas) tienen `productos`, `clientes`,
   `stock`, `ventas` historicas?
7. ¿Hay backup point-in-time? ¿Como recuperan si nuestra app rompe
   datos?

### Sobre integracion / API

8. ¿Existe API REST hoy? ¿En que estado? ¿Documentada?
9. Si no existe, ¿pueden desarrollarla? ¿Costo? ¿Tiempo?
10. ¿Aceptan idempotencia por header `Idempotency-Key`?
11. ¿Que esquema de auth prefieren? (API key, OAuth2, JWT mutual TLS).
12. ¿Manejan webhooks? (notificacion outbound de Puma → nosotros).
13. ¿Aceptan que les pasemos un identificador externo
    (`numero_solicitud = WEB-2026-0001`) en cada venta?

### Sobre operacion

14. ¿Cual es la disponibilidad real del ERP? (uptime ultimos 6
    meses).
15. ¿Hay ventana de mantenimiento? (horario, frecuencia).
16. ¿Que pasa si nuestra app crea una venta y Puma esta caido?
17. ¿Pueden generar una replica fisica de produccion para testear
    sin riesgo?
18. ¿Que SLA pueden dar para incidentes que afecten la app?

### Sobre escalabilidad

19. ¿Cuantos requests/seg soporta el ERP hoy?
20. ¿Hay rate limit? ¿Pueden tunearlo para nuestra integracion?
21. ¿Hay logs / observabilidad que podamos consultar para
    debuggear?

### Sobre legal / contable

22. ¿Quien firma responsabilidad si una venta queda inconsistente
    por la integracion?
23. ¿Esta resguardado el cumplimiento fiscal (AFIP / libros) si la
    app escribe?
24. ¿Hay un NDA o contrato de integracion que firmar?

### Sobre dinero

25. ¿Cobran por desarrollar la API? Cuanto.
26. ¿Cobran soporte mensual de la integracion?
27. ¿Cobran por la replica logica?
28. ¿Hay licencias adicionales si conectamos N dispositivos
    moviles?

---

## 8. Riesgos y mitigaciones

| Riesgo                                              | Probabilidad | Impacto | Mitigacion |
|-----------------------------------------------------|--------------|---------|------------|
| Puma rechaza opcion B/C y solo ofrece A             | Media        | Alto    | Tener Opcion D (sin integ.) lista como Fase 0 — el dolor de Caseros no espera |
| Puma cobra mucho por desarrollar API                | Alta         | Medio   | Negociar acceso a replica primero (Fase 1) y postergar API a Fase 3 |
| Replica logica no soportada por la version Puma     | Baja         | Medio   | Fallback: trigger-based CDC custom, o sync por API GET con polling |
| Latencia de la API hace UX mala                     | Media        | Medio   | Cache local + escritura optimista + cola |
| Una venta queda inconsistente entre Puma y app      | Media        | Alto    | Reconciliacion nocturna + alertas + UI para resolver manual |
| Vendedor sigue prefiriendo Puma por habito          | Alta         | Medio   | Onboarding gradual: arrancar por 2 vendedores piloto en Caseros |
| Puma actualiza version y rompe replica              | Media        | Alto    | Contrato explicito de version y notificacion previa |
| Cliente firma en celular pero la venta no se crea   | Baja         | Alto    | Estado "firmado-pendiente" con reintentos automaticos + log |
| Internet inestable en Caseros                       | Media        | Alto    | Modo offline Fase 5 (IndexedDB + cola) |
| Equipos Android viejos en sucursal                  | Alta         | Bajo    | Mantener versiones soportadas en Capacitor; provisioning de tablets |

---

## 9. Anexos

### A. Glosario Puma ↔ gvelectroapp

| Termino Puma           | Termino app          | Notas |
|------------------------|----------------------|-------|
| Prefactura             | Solicitud / Pedido   | En la app es `sales_web_request` |
| Articulo               | Producto             | `products.sku` |
| Codigo cliente (00036) | DNI / `customer_id`  | Falta entidad cliente en app |
| Deposito (4.NORCENTER) | Sucursal / branch    | Hay que mapear ID Puma ↔ app |
| Plan de credito        | Plan de credito      | No existe en app todavia |
| Orden de Entrega       | Orden de entrega     | No existe como entidad propia |
| Garantia extendida     | (no confundir con `warranties`) | warranties en app = post-venta |
| Tipo reparto: Envio / Retira | `entrega_tipo`: Envio / Retira en local | OK |
| Caja Recaudadora       | (no modelado)        | P2 |

### B. Referencias internas

- `docs/06-integracion-erp-ventas.md` — contrato API REST detallado
  (payloads JSON, sistema de identificacion idempotente).
- `docs/02-guia-tecnica-agentes.md` — stack tecnico de la app.
- `docs/08-android-capacitor.md` — empaquetado mobile.
- `docs/10-modulo-comercial-fase1.md` — PSI (planificacion de stock).
- `docs/03-api-endpoints.md` — endpoints existentes.
- `backend/app/models/sales_web.py` — modelo `SalesWebRequest`.
- `backend/app/models/products.py` — catalogo de productos.

### C. Para debate con otra IA

Si vas a discutir esto con otra IA o consultor externo, pasale el
documento entero **mas** estos puntos como pregunta especifica:

1. ¿La Opcion C (replica + API) es realmente el sweet spot o me esta
   sobrando complejidad? ¿Cuando preferirias B puro?
2. ¿La estimacion de 6 meses calendario es realista para un dev solo?
   ¿Que parte estoy subestimando?
3. ¿Que opinas de Fase 2 (borrador manual) como puente? ¿Vale o me
   ahorra problema chico y crea uno grande (vendedores que se
   acostumbran al doble flujo y no migran)?
4. ¿Que patron de reconciliacion nocturna es estandar para POS
   distribuidos? (referencias a Shopify POS, Square, Lightspeed).
5. ¿Hay precedentes de migracion exitosa de un ERP legacy de
   escritorio (VB/Delphi/Clipper) hacia un front mobile sin
   reescribir el ERP? Casos.
6. ¿La idempotencia con `numero_solicitud` como header es suficiente
   o conviene un `revision` por mutacion?
7. Riesgos de Capacitor en flota mixta Android 8-13 (tablets en
   sucursal).
8. Cuando arrancar offline (Fase 5) vs dejarlo para v2: ¿el dolor
   real de "internet inestable" justifica adelantarlo a Fase 2?

---

## 10. Proximos pasos (concretos, semana del 9/6)

- [ ] Cerrar la 6ta pantalla del flujo Puma (foto del paso de
      impresion / cierre) → completar §1.1.
- [ ] Compartir este doc al equipo Puma 48h antes de la reunion para
      que vengan con respuestas a §7.
- [ ] Imprimir matriz §3.5 a la reunion (es el ancla de la
      decision).
- [ ] Definir piloto: 2 vendedores en Caseros, 4 SKUs, 2 semanas.
- [ ] Estimar costo Fase 1 (replica + lectura) para presentar a
      gerencia.

---

_Doc generado para la reunion del [fecha]. Owner tecnico: Victor.
Owner producto: Victor. Revisar trimestral._
