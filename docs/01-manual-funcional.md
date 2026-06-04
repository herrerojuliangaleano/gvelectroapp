# Manual funcional - ElectroGV

Este documento explica que hace cada parte de la aplicacion y como se espera
que se use desde el punto de vista operativo.

## Inicio, sesion y navegacion

### Login

Ruta: `/login`

El usuario ingresa con usuario y password. El backend devuelve token JWT,
permisos, roles, sucursal y empresa. Si `must_change_password` esta activo, el
frontend fuerza el cambio en `/set-password`.

### Punto de entrada

Ruta: `/`

La app redirige segun el perfil:

- Usuarios con dashboard ven el centro de control.
- Ventas web pueden ir directo a sus bandejas.
- Deposito puede ir directo a `Mi espacio`.
- Usuarios sin dashboard son redirigidos al primer modulo permitido.

### Perfil y legajo

Rutas: `/me`, `/mi-legajo`

Permiten ver datos del usuario, permisos efectivos, actividad, legajo asociado,
foto profesional y recibos propios cuando corresponde.

## Dashboard

Ruta: `/`

Muestra accesos rapidos y metricas segun permisos. Puede incluir:

- Garantias activas, atrasadas o en revision.
- Ventas web pendientes o propias.
- Actividad reciente.
- Notificaciones.
- Accesos a administracion, herramientas y auditoria.

El dashboard no es un modulo de datos propio: consume resumenes de otros
modulos y aplica permisos para mostrar solo lo que corresponde.

## Garantias

Rutas principales:

- `/warranties`
- `/warranties/new`
- `/warranties/:warrantyId`
- `/warranties/dashboard`
- `/warranties/gestor`
- `/warranties/mi-espacio`
- `/warranties/sucursal`
- `/warranties/posventa`
- `/warranties/gestion`
- `/warranties/export`
- `/warranties/sync`
- `/warranties/config`

### Objetivo

Gestionar el ciclo completo de una garantia: carga inicial, revision interna,
correcciones, remitos, movimiento fisico, gestion con proveedor, resolucion,
exportacion y sincronizacion con Google Sheets.

### Flujo general

1. Un usuario con permiso `warranties.create` carga una o varias garantias.
2. El sistema genera identificadores y registra los items.
3. La garantia entra a revision o a una bandeja operativa segun su origen.
4. El gestor revisa datos, marca incompleta o aprueba.
5. Si debe moverse fisicamente, se genera remito interno.
6. Posventa o proveedor gestiona envio, retiro, respuesta, reclamo o correccion.
7. Se registra la resolucion y se finaliza/cancela segun corresponda.
8. Puede sincronizarse con Google Sheets y exportarse a Excel.

### Vistas importantes

| Vista | Uso |
|---|---|
| Lista | Buscar y filtrar garantias visibles para el usuario. |
| Nueva garantia | Carga de datos de cliente, factura, producto, falla y sucursal. |
| Detalle | Historia completa, edicion, estados, remitos y acciones. |
| Dashboard garantias | KPIs y alertas del flujo. |
| Panel gestor | Bandeja interna de revision y seguimiento. |
| Mi espacio | Vista operativa para sucursal/deposito. |
| Posventa | Entrada a gestion con proveedor y exportaciones. |
| Gestion proveedor | Envio a proveedor, respuesta, retiro, correccion, reclamo. |
| Export | Exportacion por lote o proveedor. Tambien permite regenerar un ENV si se corrigieron datos de producto, SKU, serie o falla. |
| Sync | Estado y ejecucion de sincronizacion con Google Sheets. |
| Config | Parametros del flujo de garantias. |

### Acciones clave

- Tomar en revision.
- Marcar incompleta.
- Aprobar revision.
- Confirmar envio.
- Enviar a proveedor.
- Registrar pedido de retiro.
- Registrar respuesta de proveedor.
- Resolver correccion de proveedor.
- Reenviar mail de proveedor.
- Registrar reclamo.
- Cambiar estado.
- Actualizar datos base.
- Cancelar.
- Eliminar definitivamente, solo para permisos altos.
- Exportar.
- Regenerar un lote ENV historico.
- Sincronizar hacia/desde Google Sheets.
- Resincronizar contadores.

### Regeneracion de lote ENV

Si un proveedor pide revisar un numero de serie, modelo, SKU o falla, primero se
corrige la garantia desde su detalle. Luego, desde `Exportacion / ENV`, se usa
`Regenerar` sobre el lote historico. El sistema mantiene el mismo codigo
`ENV-YYYY-0000`, crea un archivo nuevo y conserva descargable el archivo anterior.
Cada garantia incluida recibe un evento de historial para dejar trazabilidad.

### Permisos relevantes

`warranties.view`, `warranties.create`, `warranties.dashboard`,
`warranties.manage`, `warranties.review`, `warranties.mark_incomplete`,
`warranties.approve_review`, `warranties.manage_provider`,
`warranties.change_status`, `warranties.register_provider_response`,
`warranties.register_claim`, `warranties.export`, `warranties.sync_to_sheet`,
`warranties.sync_from_sheet`, `warranties.sync_logs`, `warranties.config`,
`warranties.reset_data`, `warranties.cancel`, `warranties.delete`,
`warranties.update`, `warranties.counters`, `warranties.gestor.panel`,
`warranties.sucursal.logistics`.

## Remitos de garantias

Rutas:

- `/warranties/remitos`
- `/warranties/remito-historial`
- `/warranties/deposito`

API: `/api/warranties/remitos/*`

### Objetivo

Controlar el movimiento fisico de garantias entre sucursales, depositos y
proveedores.

### Tipos de operacion

- Remito de sucursal a deposito.
- Transferencia deposito a deposito.
- Entrega deposito a proveedor.
- Confirmacion de llegada por codigo.
- Despacho.
- Historial y PDF.

### Estados esperados

Un remito puede estar pendiente, en transito, recibido o anulado/eliminado
segun permisos. Las garantias relacionadas cambian su estado logistico al
despachar o recibir.

### Permisos relevantes

`warranties.remitos.view`, `warranties.remitos.generate`,
`warranties.remitos.dispatch`, `warranties.remitos.receive`,
`warranties.remitos.deposit_transfer`,
`warranties.remitos.provider_delivery`, `warranties.remitos.delete`.

## Presupuestos

Ruta: `/budgets/new`

API: `/api/budgets/*`

### Objetivo

Crear presupuestos tomando productos desde el catalogo sincronizado con la
Planilla Madre.

### Funciones

- Cargar datos del cliente.
- Buscar productos.
- Agregar items.
- Calcular totales.
- Elegir opciones de envio.
- Guardar el presupuesto en Google Sheets.

### Permisos relevantes

`budgets.view`, `budgets.create`, `budgets.save`, `budgets.manage`,
`budgets.price_override`.

## Ventas web

Rutas:

- `/venta`
- `/venta/admin`
- `/venta/mis-solicitudes`
- `/venta/pendientes`
- `/venta/nueva`
- `/venta/:id`

API: `/api/sales-web/*`

### Objetivo

Registrar solicitudes de venta online, asignarlas, completar la gestion y
mantener trazabilidad del vendedor, datos del cliente, productos, pago y envio.

### Flujo general

1. Un vendedor crea una solicitud.
2. La solicitud queda pendiente.
3. Un usuario con permisos de gestion la toma.
4. Se completa, se envia al vendedor o se cancela.
5. Se puede editar remito/prefactura y observaciones administrativas.

### Permisos relevantes

`sales_web.view`, `sales_web.create`, `sales_web.take`,
`sales_web.complete`, `sales_web.send`, `sales_web.cancel`,
`sales_web.cancel_own`, `sales_web.branch_manage`, `sales_web.manage`,
`sales_web.delete`.

## Inteligencia comercial / Sales BI

Rutas:

- `/ventas-bi`
- `/ventas-bi/historial`
- `/ventas-bi/importar`
- `/ventas-bi/importaciones/:importId`

API: `/api/sales-bi/*`

### Objetivo

Importar, analizar y consultar planillas de ventas para generar una base
analitica con registros, saldos, costos y margenes.

### Funciones

- Analizar archivo subido.
- Analizar URL de Google Sheets.
- Confirmar importacion.
- Ver historial de importaciones.
- Ver detalle de una importacion.
- Anular importacion.
- Consultar registros.
- Consultar saldos.
- Ver estadisticas.

### Permisos relevantes

`sales_bi.view`, `sales_bi.import`, `sales_bi.void`,
`sales_bi.view_costs`, `sales_bi.view_margin`.

## Catalogo de productos

Ruta: `/productos`

API: `/api/products/*`

### Objetivo

Mantener un catalogo local de productos sincronizado desde la Planilla Madre,
con marcas, proveedores y cambios detectados en PVP/costo.

### Funciones

- Ver estado del catalogo.
- Buscar y listar productos.
- Sincronizar desde Google Sheets.
- Ver logs de sincronizacion.
- Gestionar proveedores.
- Asociar marcas a proveedores.
- Buscar proveedor por marca.

### Relacion con precios y costos

Cuando la sincronizacion detecta cambios reales de PVP o costo, puede crear
tareas en el modulo de Precios y Costos para que el equipo complete el
checklist operativo.

Los productos nuevos tambien crean tareas automaticamente cuando traen PVP y/o
costo en la planilla. Si un producto nuevo entra sin PVP, queda en el catalogo
pero no aparece en anuncios de precios hasta completar ese valor y resincronizar.

### Permisos relevantes

`products.view`, `products.sync`, `products.manage`,
`products.providers.manage`.

## Precios y costos

Ruta: `/precios-costos`

API: `/api/price-cost-updates/*`

### Objetivo

Gestionar actualizaciones urgentes de precio o costo con trazabilidad,
checklist y estado.

### Funciones

- Buscar producto por SKU.
- Crear actualizacion de precio o costo.
- Ver lista con filtros.
- Ver detalle.
- Editar.
- Marcar checks por destino segun permiso: web, Puma o Planilla Madre.
- Cancelar.
- Ver historial.
- Ver bandeja activa, archivo o todo el historial operativo.
- Archivar automaticamente actualizaciones completadas/canceladas para que no
  sigan ocupando la bandeja diaria.
- Identificar productos nuevos como `Nuevo ingreso` y confirmar si se subieron
  a web/Puma mediante los mismos checks.
- Recibir notificaciones agrupadas por marca, por ejemplo
  `Cambios de precios en Samsung`, para evitar avisos individuales por SKU.

### Permisos relevantes

`price_updates.view`, `price_updates.create`, `price_updates.check`,
`price_updates.check.web`, `price_updates.check.puma`,
`price_updates.check.master`, `price_updates.edit`, `price_updates.delete`,
`cost_updates.view`, `cost_updates.create`, `cost_updates.check`,
`cost_updates.check.puma`, `cost_updates.check.master`, `cost_updates.edit`,
`cost_updates.delete`.

Rol operativo nuevo: `ENCARGADO_WEB` (`Editor / Encargado de pagina web`).
Puede ver cambios de precio, recibir notificaciones y marcar solo los checks
web. No marca Puma, no toca costos, no crea ni cancela actualizaciones.

## Comercial - anuncios de precios

Ruta: `/comercial/anuncios-precios`

API: `/api/price-cost-updates/announcements/images`

### Objetivo

Generar imagenes comerciales con cambios de precios para compartir por WhatsApp
u otros canales, usando solo el precio nuevo.

### Funciones

- Listar cambios de precio disponibles.
- Filtrar por marca, estado o busqueda libre.
- Seleccionar productos manualmente o por marca/filtro.
- Generar una o varias imagenes PNG agrupadas por marca.
- Si una imagen se llena, el backend divide automaticamente la tanda en
  varias imagenes para que ninguna placa quede cortada.
- Los ingresos nuevos se ordenan arriba; la placa que contiene ingresos usa
  `Nuevos precios e ingresos` si mezcla cambios e ingresos, `Nuevos precios`
  si solo hay cambios y `Nuevo ingreso`/`Nuevos ingresos` si solo hay altas.
- En las placas comerciales se muestran precios con $10 menos que el valor real
  del sistema, tanto en el precio anterior tachado como en el precio nuevo.
- El footer de cada placa repite la vigencia, sin mostrar quien genero la
  imagen.
- Al generar una tanda, los productos seleccionados salen de pendientes de
  anuncio y quedan archivados en un lote regenerable. No se guarda el PNG,
  sino la informacion necesaria para volver a generarlo.
- El archivo de tandas permite regenerar las imagenes sin volver a seleccionar
  los productos.
- Descargar cada imagen.
- Compartir cada imagen con mensaje automatico:
  `Cambios de precios {fecha y hora} en {marcas}.`

### Permisos relevantes

`price_updates.view`, `price_announcements.view`,
`price_announcements.generate`.

## Recibos de sueldo

Ruta: `/recibos`

API: `/api/payroll/*`

### Objetivo

Permitir que RRHH suba recibos, que empleados los vean y firmen, y que puedan
observarlos si hay diferencias.

### Funciones

- Listar recibos propios o todos.
- Subir recibo individual.
- Previsualizar carga masiva.
- Ejecutar carga masiva por DNI/empleado.
- Descargar/ver PDF.
- Firmar conformidad.
- Observar recibo.
- Responder observacion.
- Anular recibo.

### Permisos relevantes

`payroll_receipts.view_own`, `payroll_receipts.sign_own`,
`payroll_receipts.observe_own`, `payroll_receipts.view_all`,
`payroll_receipts.upload`, `payroll_receipts.bulk_upload`,
`payroll_receipts.cancel`, `payroll_receipts.respond_observation`.

## Empleados

Rutas:

- `/administracion/empleados`
- `/administracion/empleados/nuevo`
- `/administracion/empleados/:id`
- `/administracion/fotos`
- `/mi-legajo`

API: `/api/employees/*`

### Objetivo

Administrar legajos, estados laborales, vinculo con usuarios, foto profesional
y datos operativos.

### Funciones

- Listar empleados con filtros.
- Crear empleado.
- Ver legajo.
- Editar datos.
- Vincular o desvincular usuario.
- Cambiar estado laboral.
- Ver historial de estados.
- Subir foto propia.
- Solicitar, aprobar o rechazar foto profesional.

### Permisos relevantes

`employees.view`, `employees.manage`, `employees.photo.upload_own`,
`employees.photo.request`, `employees.photo.approve`,
`employees.photo.reject`.

## Usuarios, roles y permisos

Rutas:

- `/administracion/usuarios`
- `/administracion/usuarios/nuevo`
- `/administracion/usuarios/:username`
- `/admin/roles`

API: `/api/admin/users`, `/api/admin/roles`, `/api/admin/permissions`

### Objetivo

Gestionar accesos, roles, permisos y alcance operativo por empresa/sucursal.

### Funciones

- Listar usuarios.
- Crear usuario.
- Resetear password.
- Activar/desactivar usuario.
- Eliminar usuario.
- Reparar vinculos legacy de sucursales, roles y empleados.
- Ver permisos disponibles.
- Ver y modificar roles.

### Roles por defecto

`SUPERADMIN`, `GERENTE`, `ADMINISTRADOR`, `ADMIN`, `VENDEDOR_WEB`,
`VENTA_WEB`, `GESTOR_GARANTIAS`, `JEFE_POSVENTA`,
`ENCARGADO_SUCURSAL`, `DEPOSITO`, `CADETE_DEPOSITO`, `VENDEDOR`,
`LECTURA`.

## Empresas y sucursales

Ruta: `/admin/companies-branches`

API:

- `/api/companies`
- `/api/branches`
- `/api/operational-structure`

### Objetivo

Administrar la estructura operativa: empresas, sucursales fisicas, web,
depositos y jerarquias.

### Funciones

- Crear y editar empresas.
- Crear y editar sucursales.
- Activar/desactivar.
- Definir tipo de sucursal.
- Definir sucursal padre.
- Consultar estructura completa.

### Permisos relevantes

`companies.view`, `companies.manage`, `branches.view`,
`branches.manage`, `branches.cross_select`.

## Configuracion operativa

Ruta: `/admin/operational-config`

API: `/api/admin/operational-config/*`

### Objetivo

Mantener parametros operativos editables desde la interfaz sin tocar codigo.

### Funciones

- Ver configuracion.
- Guardar configuracion.
- Bloquear/desbloquear edicion.
- Validar secciones.

### Permisos relevantes

`ops_config.view`, `ops_config.manage`.

## Google Admin

Ruta: `/admin/google`

API: `/api/admin/google/*`

### Objetivo

Gestionar la conexion OAuth con Google sin editar archivos manualmente.

### Funciones

- Ver estado de credenciales/token.
- Cargar credenciales.
- Cargar token.
- Borrar token.
- Refrescar token.
- Iniciar reconexion local.
- Consultar estado de reconexion.

### Permiso relevante

`google.manage`.

## Herramientas internas legacy

Rutas:

- `/tools`
- `/tools/:toolId`
- `/jobs`
- `/jobs/:jobId`

API:

- `/api/tools/*`
- `/api/jobs/*`

### Objetivo

Ejecutar scripts historicos de Google Drive/Sheets desde la web, con formularios,
subida de archivos, logs y seguimiento de jobs.

### Herramientas registradas

| ID | Nombre | Uso |
|---|---|---|
| `gpd` | Generar Planillas Diarias | Copias de planillas diarias por sucursal en Google Drive. |
| `cc` | Congelar Carpeta | Reemplaza formulas por valores en Sheets de una carpeta. Tiene modo prueba. |
| `cf` | Comprobar Facturas | Cruza comprobantes ARCA contra planillas de ventas. |
| `cer` | Limpiar Comprobantes | Procesa emitidos/recibidos ARCA y sube resultados. |
| `eb` | Limpiar Extractos Bancarios | Normaliza extractos de bancos. |
| `gg` | Generar GFK | Genera reporte GFK por rango de fechas. |
| `ncm` | Normalizar Carpeta Mensual | Normaliza productos de planillas diarias. |
| `ncmc` | Normalizar Carpeta Mensual con Cantidades | Variante con cantidades. |
| `nvsc` | Normalizar Ventas VS Costos | Cruza ventas contra planilla madre. |
| `vsc` | Ventas VS Costos | Sincroniza libro diario con mensual. |

### Permisos relevantes

`tools.view`, `tools.run.*`, `jobs.view`, `jobs.cancel`.

## Notificaciones y push

Ruta: `/notificaciones`

API: `/api/notifications/*`

### Objetivo

Centralizar avisos por usuario/modulo y soportar push web/mobile.

### Funciones

- Listar notificaciones.
- Resumen por modulo/prioridad.
- Contador no leidas.
- Marcar una como leida.
- Marcar todas como leidas.
- Crear notificaciones internas.
- Registrar/quitar token FCM.
- Suscribir/desuscribir push web.

### Permisos relevantes

`notifications.view`, `notifications.manage`, `push.subscribe`.

## Sistema, auditoria y backups

Rutas:

- `/about`
- `/settings`
- `/admin/diagnostico`
- `/audit`
- `/admin/backups`

API:

- `/api/system/*`
- `/api/config/status`
- `/api/admin/audit`
- `/api/admin/backups/*`

### Funciones

- Ver estado publico del sistema.
- Ver resumen operativo.
- Ver informacion de version/configuracion.
- Ejecutar diagnosticos.
- Reparar problemas operativos conocidos.
- Ver actividad de perfil.
- Ver auditoria.
- Crear y descargar backups.

### Permisos relevantes

`about.view`, `system.status.view`, `system.manage`,
`system.diagnostics.view`, `system.diagnostics.repair`, `settings.view`,
`audit.view`, `backups.view`, `backups.manage`.
