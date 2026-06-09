# 13 — Integracion Mobile con Puma Software

> **Estado**: documento tecnico de alineacion para la reunion con Puma.
> No describe una integracion implementada. Sirve como guion para la
> reunion y como input para debate con otra IA / consultor.
>
> **Audiencia**: Victor (CEO ElectroGV), equipo tecnico de Puma Software,
> consultores externos. Asume vocabulario tecnico medio-alto.
>
> **Fecha**: 2026-06-09 · **Version doc**: 0.4 — agregado el
> caso "Buscar AFIP" como necesidad P0 desde Fase 2 (lookup
> fiscal por DNI/CUIT a traves de Puma como proxy hacia AFIP).
> Esto es el primer caso real donde la integracion API es
> **obligatoria desde el dia 1**, no diferible.

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
7. **Como se devuelve el CAE de AFIP** (sincrono / asincrono /
   webhook) — esto define la arquitectura de la pantalla 4 mobile.
8. **Endpoint "Buscar AFIP"** (`POST /afip/lookup`) — proxy desde la
   app movil hacia Puma para consultar AFIP por DNI/CUIT y
   autocompletar alta de cliente. **NECESARIO desde Fase 2**, no
   diferible. Ver §1.2 (P0) y §4.2.

### Hallazgo crítico — separacion Prefactura vs Factura emitida

Las 6 pantallas del flujo Puma generan una **prefactura**, no una
factura final con CAE. La prefactura queda **guardada en el modulo
"Caja Recaudadora"** con todos los datos: cliente, items, plan,
medios de pago elegidos, observaciones. **NO se llama a AFIP en
este momento**.

La **emision real** (que dispara WSFE AFIP y genera el CAE) es
**otra pantalla aparte** dentro de Caja Recaudadora, donde el
operador toma una prefactura pendiente y le da "Emitir".

Implicancias para la integracion mobile:

- **La app movil puede generar prefacturas perfectamente**
  sin tocar AFIP. Eso era el cuello de botella conceptual y se cae.
- **La emision queda en Puma** (al menos en Fase 2/3). El cajero
  toma prefacturas creadas en mobile y las emite desde su PC.
- **Fase 2 (mobile-first) se vuelve mucho mas barata**: no hay que
  integrar WSFE, no hay que manejar CAE, no hay impresoras fiscales
  en mobile.
- **Fase 3 (escritura por API)** puede separar dos endpoints:
  `POST /prefacturas` (sin AFIP) y `POST /prefacturas/:id/emit`
  (con AFIP, lo dispara cuando lo decida el negocio).
- **La Opcion A (escritura directa) recobra parcial viabilidad
  SOLO para crear prefacturas** — el argumento del CAE no aplica si
  no estamos emitiendo. Pero sigue teniendo los otros 8 contras de
  §3.1.

Ver §1.1 (paso 6 = prefactura) y §1.1.bis (paso 7 = emision real
separada).

---

## 1. Analisis del flujo actual en Puma

### 1.1 Las 6 pantallas / 12 ventanas

Recorrido completo de **una venta tipica** (TV con plan de credito,
retira el cliente, anticipo en efectivo) tal como se vio en las
capturas del 2026-06-06 / 2026-06-09:

| # | Pantalla / paso          | Ventanas abiertas | Entidades manipuladas             | Friccion observada |
|---|--------------------------|-------------------|-----------------------------------|--------------------|
| 1 | Identificar cliente      | Prefactura + **Asistente de busqueda** | Cliente (search por nombre/DNI). Si es nuevo: **boton "Buscar AFIP"** que consulta padron AFIP por DNI/CUIT y autocompleta razon social, domicilio, condicion IVA, localidad. | 2 ventanas para encontrar 1 cliente; teclado obligatorio. La feature "Buscar AFIP" es **clave** para alta rapida — mobile tiene que tenerla. |
| 2 | Agregar articulo         | Prefactura + **Buscar articulo** | Producto, stock multi-deposito (LANUS / CANNING / CHICLANA / TOTAL), precio | Hay que elegir manualmente deposito de origen; no hay scan |
| 3 | Forma de pago + plan     | Prefactura (la misma) | Plan de credito (`CANCELAR PARA RETIRAR`, cuotas, fecha 1° cuota) | Sub-formulario embebido — visualmente cargado |
| 4 | Datos finales            | Prefactura + **Datos Finales** | Anticipo, Efectivo, Cheques, Saldo a favor, Vendedor (cod. `0011`), Percepciones | Otra ventana modal, repite cliente abajo |
| 5 | Emitir orden de entrega  | **Emitir Orden de Entrega** + **Confirmar Orden de Entrega** | Deposito de salida, tipo reparto (Envio/Retira), fecha, turno, domicilio, persona que retira (DNI + tel) | 2 ventanas + decision logistica al final del flujo |
| 6 | Confirmar medios de pago (cierre de **prefactura**) | **Confirmar medios de pagos. Factura** | Numero de comprobante reservado (`0904-00001302-B` — _planificado_, todavia sin CAE), MONTO TOTAL, fecha de emision planeada, **desglose granular de pago** (Saldo a favor / Efectivo / Tarjeta / Cheque / Depositos-Transf. / Monedas Extranjeras / Retenciones / Otras monedas), Entrega + Vuelto, "Sin aplicar", **Bloquear ENTREGA DE MERCADERIA** (checkbox), observaciones del comprobante, botones Guardar / Verificar / Cancelar / Cerrar | **El "Guardar" persiste la prefactura en Caja Recaudadora — NO llama a AFIP todavia.** Es el cierre de la operacion comercial; la emision fiscal viene despues. |

> **Aclaracion clave**: el titulo de la ventana superior dice
> _"Prefacturas y Presupuestos NORMAL"_. Todo este flujo (1-6) opera
> sobre **prefacturas o presupuestos** — el operador elige al final
> del paso 3 con los botones `[Prefactura]` o `[Presupuesto]` (lo
> que define si genera saldo deudor real o solo cotizacion). El
> CAE NO se emite en este paso 6, aunque el numero de comprobante
> aparezca.

#### 1.1.b Pantalla 7 — Emision real (paso separado, otra ventana)

| # | Pantalla / paso          | Modulo Puma          | Que pasa                               |
|---|--------------------------|----------------------|----------------------------------------|
| 7 | **Emitir factura** desde la prefactura guardada | Caja Recaudadora → "Emitir" sobre una prefactura pendiente | El operador (cajero/admin) selecciona una prefactura del listado de pendientes y la emite. Aca es donde **Puma llama a AFIP WSFE**, obtiene el **CAE + fecha vencimiento**, persiste el numero definitivo, dispara el controlador fiscal y genera el PDF. |

Esta pantalla **no se vio en las capturas** porque Victor mostro
el flujo de creacion de prefactura. La emision es una operacion
**posterior, asincrona y desacoplada** del vendedor de mostrador.

**Quien la ejecuta**: normalmente un cajero / administrador, no el
vendedor.

**Cuando**: cuando el cliente paga (o se decide formalmente generar
la factura). En algunos esquemas se emite inmediatamente; en otros
queda en cola hasta fin del dia.

**Total flujo**: **6 pantallas para armar la prefactura + 1
pantalla aparte para emitirla** = 7 pantallas funcionales, ~12
ventanas modales en total contando los dialogos auxiliares.

### 1.1.bis Consecuencias tecnicas: prefactura vs emision

#### En la pantalla 6 (Guardar prefactura) SI pasa:

1. **Se persiste la prefactura completa**: cabecera + items +
   plan de credito + medios de pago + observaciones.
2. **Se persiste el desglose granular de pago**: 8 columnas
   paralelas (Saldo a favor, Efectivo, Tarjeta, Cheque,
   Deposito/Transf., Monedas Extranjeras, Retenciones, Otras
   monedas) que suman al MONTO TOTAL. El "Vuelto" se calcula
   contra "Entrega".
3. **Se reserva un numero de comprobante** (`0904-00001302-B`) o
   se planifica — depende del modelo Puma: puede ser un numero
   tentativo o vacio hasta emitir.
4. **Se setea el flag "Bloquear ENTREGA DE MERCADERIA"** (caso
   entrega diferida).
5. **La prefactura entra en estado pendiente_de_emision** y
   aparece en el listado del modulo Caja Recaudadora.

#### En la pantalla 7 (Emitir desde Caja) recien pasa:

1. **Llamada al WSFE de AFIP** (web service de facturacion
   electronica).
2. **Validacion + obtencion del CAE** (Codigo de Autorizacion
   Electronica) con fecha de vencimiento (~10 dias).
3. **Persistencia del numero definitivo de comprobante** (puede
   confirmarse el reservado o cambiar).
4. **Actualizacion de cuenta corriente del cliente**: si pago
   con "Saldo a favor", se descuenta; si queda "Sin aplicar",
   queda como credito.
5. **Disparo del controlador fiscal** (driver Windows-only) →
   imprime ticket / factura B.
6. **Generacion del PDF** firmado.
7. **Asiento contable + libro IVA + actualizacion stock** (si no
   se hizo al crear la prefactura).

#### Implicancia para la integracion mobile

Esto **cambia mucho** la arquitectura propuesta:

- La app movil **puede generar prefacturas sin tocar AFIP**.
  Es exactamente el mismo modelo que ya tiene Puma — la app es
  un cliente alternativo del flujo "Prefacturas y Presupuestos".
- La **emision real** (que es lo riesgoso desde el punto de
  vista legal/fiscal) **sigue siendo de Puma**. La app movil
  ni se mete.
- En Fase 2 (borrador), la prefactura se puede vivir en la app
  y un cajero la transcribe a Puma — operativamente similar a
  lo que hace hoy `sales_web`.
- En Fase 3 (escritura API), la app puede `POST /prefacturas` a
  Puma directamente. La emision se sigue haciendo desde Puma o
  desde un endpoint `/emit` separado.
- **La Opcion A (escritura directa a Postgres) ya no es
  imposible** — si la app SOLO escribe prefacturas (no factura
  emitida), el argumento legal/AFIP no aplica. **Pero los otros
  8 contras siguen vigentes** (schema lock, validaciones de
  negocio, etc. — ver §3.1).

#### Beneficio adicional inesperado

Este desacople **abre la puerta a un modelo organizacional
limpio**: el vendedor (mobile) arma; el cajero (Puma desktop)
emite y cobra. Esa division de tareas ya existe en muchas
sucursales como practica informal — formalizarla en software
es ordenar lo que ya pasa.

### 1.2 Entidades de negocio que Puma maneja (y la app necesita)

| Entidad             | Operaciones que la app necesita                     | Criticidad |
|---------------------|------------------------------------------------------|------------|
| Cliente             | search por nombre/DNI, alta rapida, ver saldo a favor / credito disponible / disponible en cuotas | P0 |
| Producto / articulo | search por codigo / descripcion, ver marca / modelo / garantia / precio | P0 |
| Stock               | ver stock por sucursal/deposito en tiempo real     | P0 |
| Vendedor            | cod. vendedor para asignar la venta                 | P0 |
| Sucursal / deposito | catalogo de depositos por sucursal                  | P0 |
| Plan de credito     | listado de planes vigentes + parametros (cuotas, anticipo) | P0 |
| **Prefactura** | crear, listar, anular, modificar **(sin CAE, sin AFIP)** — es el output de las 6 pantallas | **P0** |
| **Factura emitida (con CAE)** | leer numero + CAE + PDF — la app **no emite**, solo consulta | **P0** (lectura) |
| Forma de pago       | catalogo (efectivo, cheques, tarjetas, combinadas)  | P0 |
| Anticipo / sena     | registrar parcial                                    | P0 |
| Recibo a cuenta     | registrar pagos previos del cliente                  | P1 |
| Orden de entrega    | crear, indicar tipo (envio/retira), turno, persona que retira | P0 |
| **Medios de pago granular** | **desglose 8 columnas: efectivo, tarjeta, cheque, transf., monedas extranjeras, retenciones, otras monedas, saldo a favor** | **P0** (parte de la prefactura) |
| **Vuelto / cambio** | **calcular contra "Entrega" del cliente; si falta, "Sin aplicar"** | **P0** |
| **Bloqueo de entrega** | **flag "Bloquear ENTREGA DE MERCADERIA" — entrega diferida** | **P0** |
| Garantia extendida  | opcional sobre articulo                              | P1 |
| Cargos extras       | instalacion, armado, fletes                          | P2 |
| **AFIP / consulta fiscal** | **lookup por DNI/CUIT — el vendedor en mobile carga el doc, Puma proxiea a AFIP, devuelve razon social + domicilio + condicion IVA + localidad → autocompleta alta de cliente nuevo**. Necesario desde Fase 2 (no diferible). | **P0** |

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
| **Factura AFIP / CAE** | **no existe**                  | **Comprobante FC B/A/C** | **Puma + AFIP WSFE** | **CRITICO** — la app no debe emitir CAE directo |
| **Medios de pago detallados** | **no existe** (solo `pago_tipo` string) | **8 columnas en pantalla 6** | Puma | **CRITICO** — tabla nueva `payment_breakdowns` |
| **Bloqueo entrega mercaderia** | **no existe**             | **flag "Bloquear..." en pant. 6** | Puma | Modelar como `delivery_blocked` boolean |
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
| Tabla `payment_breakdowns` (desglose 8 medios) | Alto      | S (3 d)   |
| Persistencia del CAE / numero comprobante      | Alto      | S (3 d)   |
| Flag `delivery_blocked` en venta               | Bajo      | XS (1 d)  |
| Calculo de vuelto en UI mobile                 | Bajo      | XS (1 d)  |

Total estimado bruto: ~4-5 meses dev a 1 persona. Con scope reducido a P0: ~3 meses.

> **Nota critica**: la emision de factura con CAE de AFIP **NO se
> implementa del lado app**. Es 100% responsabilidad de Puma. La app
> solo registra el numero devuelto. Cualquier flujo que requiera
> "emitir factura sin Puma" esta fuera de scope.

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
- ⚠️ **AFIP / CAE** (matizado tras v0.3): si la app **solo crea
   prefacturas** y deja la emision en manos de Puma, este punto
   **no aplica**. Pero si en algun punto se pretende que la app
   tambien emita facturas via escritura directa, ahi si reaparece
   el problema: hay que llamar al WSFE de AFIP, obtener CAE,
   validarlo, persistir el numero, disparar el controlador fiscal.
   Eso lo hace hoy Puma. Replicarlo desde la app es re-implementar
   un facturador electronico certificado.

**Veredicto**: **NO recomendado para escritura full**. Sigue
acumulando deuda tecnica y riesgo a mediano plazo (schema lock,
validaciones, etc.) aunque la app solo escriba prefacturas. Si el
equipo de Puma INSISTE en esta opcion, la podemos aceptar **solo
para la creacion de prefacturas** (no emision) en Fase 2/3 como
puente — pero con plan explicito de migrar a Opcion C cuando sea
posible.

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
| **Crear prefactura** (sin AFIP) | Si  | **`POST /api/v1/prefacturas`**       | `numero_solicitud`   |
| Modificar prefactura       | Si       | `PATCH /api/v1/prefacturas/:id`      | `numero_solicitud + revision` |
| Anular prefactura          | Si       | `POST /api/v1/prefacturas/:id/cancel` | `numero_solicitud + revision` |
| Registrar anticipo / sena  | Si       | `POST /api/v1/prefacturas/:id/payments` | `payment_id` propio |
| Emitir orden de entrega    | Si       | `POST /api/v1/prefacturas/:id/delivery` | `delivery_id` propio |
| **Emitir factura desde prefactura** (con AFIP) | **Si (critico)** | **`POST /api/v1/prefacturas/:id/emit`** | **`numero_solicitud`** |
| **Anular factura emitida (nota credito)** | Si | `POST /api/v1/invoices/:numero/credit-note` | `nota_credito_id` propio |
| Alta de cliente            | Si       | `POST /api/v1/customers`             | DNI/CUIT             |
| Update cliente             | No       | `PATCH /api/v1/customers/:id`        | revision             |
| Recibo a cuenta            | Si       | `POST /api/v1/customers/:id/payments` | `payment_id` propio |
| **"Buscar AFIP" (lookup fiscal)** | **Si (P0, Fase 2)** | **`POST /api/v1/afip/lookup`** | **DNI/CUIT**         |

> **Cambio clave en v0.3**: las operaciones de venta se separaron en
> **dos endpoints distintos**: `/prefacturas` (sin AFIP) y
> `/prefacturas/:id/emit` (con AFIP). Esto refleja el modelo real
> de Puma y permite que la app movil opere solo el primero,
> dejando el segundo a la operatoria de Caja.

#### Payload `POST /api/v1/afip/lookup` ("Buscar AFIP" desde mobile)

Caso de uso: el vendedor en mobile esta dando de alta un cliente
nuevo. Tipea el DNI/CUIT en el formulario y aprieta el boton
"Buscar en AFIP" (lo mismo que el boton del flujo Puma desktop). La
app movil **no consulta AFIP directamente** — manda el documento a
Puma, Puma proxiea hacia AFIP (usa sus propios certificados WSAA),
y devuelve la respuesta normalizada.

Request:

```json
{
  "document_type": "CUIT",
  "document_number": "20954993368"
}
```

Response esperada cuando AFIP resuelve:

```json
{
  "ok": true,
  "document_type": "CUIT",
  "document_number": "20954993368",
  "legal_name": "GALEANO HERRERA, VICTOR JULIAN",
  "display_name": "Victor Galeano",
  "iva_condition": "Consumidor Final",
  "fiscal_address": "CURAPALIGUE 1891",
  "locality": "CAPITAL FEDERAL",
  "postal_code": "1406",
  "province": "Buenos Aires",
  "actividades": [],
  "estado": "ACTIVO",
  "raw": {
    "padron_a5_response": "<respuesta cruda de AFIP por si Puma quiere mostrarla>"
  }
}
```

Response cuando no se encuentra (la app no debe romperse):

```json
{
  "ok": false,
  "error": "Documento no encontrado en padron AFIP",
  "fallback": "manual"
}
```

**Por que este endpoint es P0 y no diferible**:

- Sin AFIP lookup, el vendedor tiene que tipear razon social,
  domicilio, IVA, localidad y CP a mano para cada cliente nuevo.
  En Caseros (sucursal grande con tasa alta de clientes nuevos)
  esto **anula gran parte de la ganancia de velocidad** que
  buscamos en mobile.
- Es la unica operacion donde la app movil **requiere
  obligatoriamente** una API de Puma desde el inicio. No se puede
  postergar a Fase 3.
- Hoy ya existe el boton "Buscar AFIP" en Puma desktop — la
  infraestructura existe. Solo hay que exponerla.

**Caching y costo**: la app movil cachea la respuesta por DNI/CUIT
en su propia BD (`afip_cache`) por 30 dias para no martillar al
ERP. Si AFIP cambia algo del cliente, se invalida al usarlo.

#### Payload `POST /api/v1/prefacturas` (lo que la app mobile crea)

```json
{
  "external_id": "WEB-2026-0001",
  "tipo": "prefactura",
  "branch_id": "norcenter",
  "vendedor_codigo": "0011",
  "cliente": {
    "codigo_puma": "00036",
    "documento": "95499336",
    "nombre": "GALEANO HERRERA, VICTOR JULIAN",
    "domicilio": "CURAPALIGUE 1891",
    "localidad": "CAPITAL FEDERAL",
    "cp": "1406"
  },
  "items": [
    {
      "sku": "001192",
      "descripcion": "TV KANJI 65\" QLED 4K SMART WHALE.OS",
      "deposito_origen": "4.NORCENTER",
      "cantidad": 1,
      "precio_unitario": "840000.00",
      "garantia_extendida_id": null
    }
  ],
  "plan_credito": {
    "codigo": "CANCELAR_PARA_RETIRAR",
    "cuotas": 1,
    "anticipo": "0.00",
    "primera_cuota_fecha": "2026-06-19"
  },
  "payment_breakdown": {
    "saldo_a_favor": "0.00",
    "efectivo": "840000.00",
    "tarjeta": "0.00",
    "cheque": "0.00",
    "deposito_transf": "0.00",
    "monedas_extranjeras": "0.00",
    "retenciones": "0.00",
    "otras_monedas": "0.00"
  },
  "entrega": "840000.00",
  "vuelto": "0.00",
  "sin_aplicar": "0.00",
  "delivery": {
    "tipo": "retira_cliente",
    "fecha": "2026-06-09",
    "turno": "manana",
    "blocked": false,
    "domicilio_entrega": null,
    "persona_retira": null
  },
  "observaciones": ""
}
```

Response esperada:

```json
{
  "ok": true,
  "external_id": "WEB-2026-0001",
  "prefactura": {
    "id_puma": "PF-2026-256-9",
    "numero_reservado": "0904-00001302-B",
    "estado": "pendiente_de_emision",
    "monto_total": "840000.00",
    "creada_en": "2026-06-09T15:32:11-03:00"
  }
}
```

#### Payload `POST /api/v1/prefacturas/:id/emit` (cuando Caja emite)

Este endpoint puede ser llamado **desde la app movil** (si se decide
asi) o **desde Puma desktop** (modelo actual). Lo que cambia
respecto al payload de prefactura es que **no manda datos** — solo
el ID — porque la prefactura ya tiene todo. Puma toma esos datos y
los manda a AFIP.

```json
{
  "external_id": "WEB-2026-0001",
  "emit_now": true
}
```

Response:

```json
{
  "ok": true,
  "external_id": "WEB-2026-0001",
  "invoice": {
    "punto_venta": "0904",
    "numero": "00001302",
    "tipo": "B",
    "numero_completo": "0904-00001302-B",
    "cae": "75123456789012",
    "cae_vencimiento": "2026-06-19",
    "fecha_emision": "2026-06-09T15:32:11-03:00",
    "monto_total": "840000.00",
    "pdf_url": "https://puma.../invoices/0904-00001302-B.pdf"
  }
}
```

La app persiste `numero_completo`, `cae`, `cae_vencimiento` y
`pdf_url` en una tabla nueva `puma_invoices` con FK a
`sales_web_requests`.

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
| **4. Cerrar prefactura** | Pantalla 6 (medios de pago detallados) | Cliente confirma desglose y firma en celular. App envia `POST /prefacturas` → Puma persiste pendiente_de_emision. **No se llama AFIP en este paso**. El vendedor termina aca; el cajero emite despues. |
| _(post-flujo, opcional movil)_ | Pantalla 7 (Emitir desde Caja) | Cajero / admin selecciona la prefactura en su PC y le da "Emitir". Aca recien va a AFIP. **La app puede mostrar al vendedor cuando se emitio, pero no necesariamente la opera.** |

### 5.2 Patrones moviles a aplicar

- **Step indicator** arriba (1 / 2 / 3 / 4) — el vendedor siempre ve
  donde esta.
- **Scanner de barras** integrado (Capacitor: `@capacitor-community/barcode-scanner`).
- **Search-as-you-type** con debounce 300ms — sin botones "Buscar".
- **Auto-fill de cliente** por DNI: pega DNI y autocompleta domicilio
  / iva / saldo (consume API o replica).
- **Buscar AFIP integrado en el formulario de alta**: si el DNI/CUIT
  no esta en la base local, la app llama a `/api/v1/afip/lookup`
  (proxy de Puma) y autocompleta razon social + domicilio + IVA +
  localidad. **El vendedor solo tipea el DNI** — el resto es
  AFIP-fill.
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

### 5.4 Wireframe del paso 2 — Cliente (con Buscar AFIP)

```
┌─────────────────────────────────┐
│ ← Volver                        │
│ Nueva venta · Paso 2: Cliente   │
│ ────●────●────○────○─────────── │
│     1    2    3    4             │
│                                 │
│ 🔍 Buscar cliente existente:    │
│ ┌─────────────────────────────┐ │
│ │ DNI / CUIT / nombre...      │ │
│ └─────────────────────────────┘ │
│                                 │
│  o crear cliente nuevo:         │
│ ┌─────────────────────────────┐ │
│ │ DNI o CUIT  20954993368   ⚡│ │  ← icono "Buscar AFIP"
│ └─────────────────────────────┘ │
│                                 │
│ ╔═══════════════════════════╗   │
│ ║  Buscando en AFIP...      ║   │  ← spinner ~1s
│ ╚═══════════════════════════╝   │
│                                 │
│ ✅ AFIP encontro:               │
│ Razon social: GALEANO HERRERA, .│
│ Domicilio:    CURAPALIGUE 1891  │
│ Localidad:    CAPITAL FEDERAL   │
│ CP:           1406              │
│ IVA:          Consumidor Final  │
│                                 │
│ [Editar campos]  [Confirmar →]  │
└─────────────────────────────────┘
```

El "rayito" ⚡ al lado del campo DNI es el detalle UX clave: el
vendedor lo aprieta (o se dispara solo cuando completa 8 digitos)
y en ~1 segundo tiene 5 campos completados sin tipear.

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

### Fase 2 — Prefactura mobile con un solo endpoint API: AFIP lookup (4-5 semanas)

- ⬜ Extender `sales_web_requests` con campos de plan de credito,
  anticipo detallado, orden de entrega, **desglose de pago 8
  columnas**, **flag delivery_blocked**.
- ⬜ Pantalla "Nueva venta" 4 pasos en mobile.
- ⬜ Scanner de codigo de barras.
- ⬜ Firma del cliente en pantalla.
- ⬜ Generar PDF de prefactura (formato Puma-compatible).
- ⬜ **Endpoint `POST /api/v1/afip/lookup` de Puma**: unico endpoint
  API necesario en esta fase. La app movil lo llama cuando el
  vendedor da de alta cliente nuevo (consulta AFIP por DNI/CUIT,
  autocompleta razon social + domicilio + IVA).
- ⬜ Tabla `afip_cache` local con TTL 30 dias para no repetir
  consultas.
- ⬜ Resto sigue manual del lado Puma: el cajero abre la prefactura
  en mobile (o ve el PDF), la transcribe en su PC en la pantalla
  "Prefacturas y Presupuestos" de Puma, y emite cuando corresponde.

**Hito Fase 2**: vendedor opera 100% en mobile creando prefacturas
**con autocompletado AFIP para clientes nuevos**. Cajero las pasa a
Puma. Caseros gana velocidad real (no solo en armar prefactura,
tambien en alta de cliente nuevo). La emision con AFIP queda
intacta en Puma.

> **Nota**: si Puma no expone `/afip/lookup` en Fase 2, hay
> fallback: alta manual con teclado (el dolor que estamos tratando
> de eliminar). Si esto pasa, mueve el endpoint AFIP a Fase 1.5
> intermedia y manten Fase 2 vendible internamente.

### Fase 3 — Escritura de prefacturas via API (6 semanas)

- ⬜ Puma expone `POST /api/v1/prefacturas` y endpoints relacionados.
- ⬜ La app envia prefacturas directamente a Puma (sin transcripcion
  manual del cajero).
- ⬜ Integracion bidireccional con `Idempotency-Key`.
- ⬜ Cola de reintentos para escrituras fallidas.
- ⬜ Webhook de Puma → app cuando una prefactura se emite
  (notificacion + PDF + CAE para mostrar al vendedor).

**Hito Fase 3**: la prefactura nace en mobile, llega a Puma sin
intervencion manual, y queda en Caja Recaudadora lista para emitir.
La emision sigue en manos del cajero pero el flujo administrativo
ya no requiere doble carga.

### Fase 3.5 — Emision desde mobile (opcional, 2-3 semanas)

- ⬜ Botón "Emitir" en mobile que dispara
  `POST /prefacturas/:id/emit`.
- ⬜ UX para el caso AFIP caido (estado pendiente_cae + reintentos).
- ⬜ Mostrar CAE + numero definitivo + link al PDF en la pantalla
  de detalle.

**Hito Fase 3.5**: el vendedor puede facturar al cliente parado en
mostrador, sin pasar por la caja. **Decision de negocio**: si esto
es deseado o si conviene mantener la separacion vendedor/cajero
para control interno.

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

### Sobre el modelo Prefactura / Caja Recaudadora

22. ¿La prefactura tiene un **numero de comprobante reservado**
    desde su creacion o se asigna solo al emitir?
23. ¿Que estados maneja una prefactura?
    (pendiente_de_emision / emitida / anulada / vencida / otros?).
24. ¿Hay **timeout** o vencimiento de una prefactura no emitida?
    ¿Que pasa si queda 30 dias sin emitir?
25. ¿Como se vincula tecnicamente la prefactura con la factura
    emitida en su schema?
26. ¿La prefactura puede modificarse despues de creada y antes de
    emitirse?
27. ¿Quien tiene permiso para emitir? ¿Es por rol / por sucursal /
    por turno?
28. ¿Se puede emitir una prefactura desde otra sucursal de la que
    se creo? (caso: vendedor crea en Norcenter, cajero centralizado
    emite).

### Sobre "Buscar AFIP" / lookup fiscal (P0 desde Fase 2)

> Estas preguntas son **bloqueantes para Fase 2** — sin respuestas
> aca no hay alta rapida de clientes nuevos en mobile.

28a. ¿El boton "Buscar AFIP" que existe en Puma desktop, llama al
     padron A5 (constancia de inscripcion) o a algun otro web
     service?
28b. ¿Pueden exponer ese mismo lookup como endpoint REST
     (`POST /api/v1/afip/lookup`) para que la app movil lo consuma?
     ¿Que costo / tiempo?
28c. ¿Cual es la latencia tipica del lookup (Puma → AFIP → Puma)?
     ¿Hace cache del lado Puma?
28d. ¿Hay rate limit del lado AFIP? Si llamamos 200 veces/dia desde
     mobile, ¿hay riesgo de baneo?
28e. ¿La respuesta de AFIP devuelve domicilio fiscal + localidad +
     CP + condicion IVA + razon social en un solo response, o hay
     que hacer 2-3 llamadas?
28f. ¿Que pasa si AFIP esta caido al hacer un lookup? ¿Puma puede
     responder con fallback "sin datos, completar manual"?

### Sobre AFIP / emision (cuando lleguemos a Fase 3.5)

29. ¿Como manejan hoy la emision de CAE (WSFE de AFIP)? ¿Es
    sincrona al "Emitir" en Caja o asincrona?
30. ¿Pueden devolver via API el numero de comprobante + CAE +
    fecha de vencimiento + URL del PDF?
31. ¿Que pasa si AFIP esta caido al momento de emitir? ¿Cola? ¿Da
    CAE provisorio? ¿Rechaza?
32. ¿Soportan emision de Factura A / B / C / M / E desde la API o
    solo B?
33. ¿La impresion fiscal (controlador hardware) es necesaria o se
    puede omitir en venta mobile? ¿La factura electronica reemplaza
    al ticket fiscal en venta no presencial?

### Sobre legal / contable

34. ¿Quien firma responsabilidad si una prefactura queda
    inconsistente por la integracion?
35. ¿Esta resguardado el cumplimiento fiscal si la app escribe
    prefacturas directamente (no facturas emitidas)?
36. ¿Hay un NDA o contrato de integracion que firmar?
37. ¿Bloqueo de entrega de mercaderia se modela como flag en la
    prefactura o como entidad separada (orden de entrega vinculada)?

### Sobre dinero

38. ¿Cobran por desarrollar la API? Cuanto.
39. ¿Cobran soporte mensual de la integracion?
40. ¿Cobran por la replica logica?
41. ¿Hay licencias adicionales si conectamos N dispositivos
    moviles?
42. ¿AFIP / facturacion electronica tiene costo por comprobante o
    esta incluido?

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
| **AFIP caido al momento de facturar**               | Media        | Alto    | Estado `pendiente_cae` en la venta + cola de reintentos + UI clara para el vendedor ("Factura sin emitir, reintentando") |
| **Latencia de AFIP > 5s degrada UX**                | Alta         | Medio   | Spinner con tip ("AFIP tarda en pico horario"); emision asincrona con notificacion push |
| **Mismatch entre desglose app y monto total Puma**  | Baja         | Alto    | Validar suma de medios = MONTO TOTAL en frontend antes de enviar; verificacion server-side |
| **Cliente firma pero CAE falla y queda apocrifa**   | Baja         | Critico | NO entregar mercaderia hasta que la API confirme CAE valido; si falla, anular en Puma y rehacer |
| **Vendedor confunde "Entrega diferida" con "Retira en local"** | Media | Medio | UX explicita: 2 toggles separados; tooltip + ejemplos |

---

## 9. Anexos

### A. Glosario Puma ↔ gvelectroapp

| Termino Puma           | Termino app          | Notas |
|------------------------|----------------------|-------|
| **Prefactura**         | Solicitud / Pedido (a futuro: `prefactura`) | Output de las 6 pantallas del flujo de venta. Tiene cabecera + items + plan + medios de pago, pero **NO tiene CAE todavia**. Queda guardada en Caja Recaudadora pendiente de emision. |
| **Factura emitida**    | _(nueva tabla `puma_invoices` a crear)_ | Output de la pantalla 7 (Emitir). Tiene numero definitivo, CAE, fecha emision, PDF. Solo se persiste como espejo de Puma. |
| **Presupuesto**        | (no modelado en app)  | Variante de la prefactura — solo cotizacion, no genera obligacion. Decision en el paso 3 del flujo: boton `[Prefactura]` vs `[Presupuesto]`. |
| **Caja Recaudadora**   | _(modulo a crear, post Fase 3)_ | Modulo de Puma donde viven las prefacturas pendientes y se emiten. La app movil **no entra aca por ahora** — sigue siendo terreno del cajero. |
| Articulo               | Producto             | `products.sku` |
| Codigo cliente (00036) | DNI / `customer_id`  | Falta entidad cliente en app |
| Deposito (4.NORCENTER) | Sucursal / branch    | Hay que mapear ID Puma ↔ app |
| Plan de credito        | Plan de credito      | No existe en app todavia |
| Orden de Entrega       | Orden de entrega     | No existe como entidad propia |
| Garantia extendida     | (no confundir con `warranties`) | warranties en app = post-venta |
| Tipo reparto: Envio / Retira | `entrega_tipo`: Envio / Retira en local | OK |
| Caja Recaudadora       | (no modelado)        | P2 |
| FC B (`0904-00001302-B`) | Factura electronica tipo B | Generada por Puma + AFIP WSFE en la **pantalla 7 (Emitir desde Caja)**, no en la pantalla 6. La app la persiste como lectura, no la emite. |
| CAE                    | Codigo Autorizacion Electronica (AFIP) | Devuelto por WSFE cuando Puma "emite". Vence (~10 dias). Sin CAE = factura invalida. |
| **Numero reservado**   | numero tentativo asignado a la prefactura | Aparece en la pantalla 6 como `0904-00001302-B (FC)` antes de emitir. Puede confirmarse o cambiarse en la emision. |
| Punto de venta (0904)  | PV asignado por AFIP a la sucursal/caja | Probablemente 1 PV por sucursal |
| Sin aplicar            | Pago entregado que no se aplico a esta factura | Queda como saldo a favor del cliente |
| Entrega / Vuelto       | Lo que entrega el cliente / lo que se le devuelve | Solo aplica a efectivo |
| Bloquear ENTREGA DE MERCADERIA | Flag: mercaderia facturada pero retenida en deposito | Caso "entrega diferida" |
| Entrega diferida       | Operacion donde la mercaderia se entrega despues de la factura | Checkbox en pantalla 6 |
| **Buscar AFIP / Padron A5** | Boton que consulta el padron AFIP por DNI/CUIT y devuelve razon social, domicilio, IVA, localidad | En mobile lo expone Puma via `POST /api/v1/afip/lookup` — P0 desde Fase 2 |
| WSAA / WSFE / Padron A5 | Web services de AFIP — autenticacion / facturacion electronica / padron de contribuyentes | La app movil NO los toca directo. Los usa Puma como proxy. |

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

- [x] Cerrar la 6ta pantalla del flujo Puma → **v0.2**.
- [x] Corregir interpretacion: la pantalla 6 cierra prefactura, NO
      emite factura. La emision es paso 7 separado en Caja
      Recaudadora → **v0.3**.
- [x] "Buscar AFIP" como necesidad P0 desde Fase 2: la app movil
      delega el lookup fiscal a Puma → **v0.4** (este doc).
- [ ] Compartir este doc al equipo Puma 48h antes de la reunion para
      que vengan con respuestas a §7 (especialmente preguntas 22-28
      sobre modelo de prefactura, 28a-f sobre Buscar AFIP, y 29-33
      sobre AFIP emision cuando llegue Fase 3.5).
- [ ] Imprimir matriz §3.5 a la reunion (es el ancla de la
      decision).
- [ ] Definir piloto: 2 vendedores en Caseros, 4 SKUs, 2 semanas.
- [ ] Estimar costo Fase 1 (replica + lectura) para presentar a
      gerencia.
- [ ] Pasar este doc a otra IA con las 8 preguntas del Anexo C para
      recibir critica antes de v1.0.

---

_Doc generado para la reunion del [fecha]. Owner tecnico: Victor.
Owner producto: Victor. Revisar trimestral._
