# Referencia de API

Base: todos los endpoints funcionales viven bajo `/api`. La autenticacion usa
Bearer token salvo endpoints publicos como `/api/health` y login.

## Salud

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/health` | Verifica que el backend esta activo. |

## Auth

| Metodo | Ruta | Uso |
|---|---|---|
| POST | `/api/auth/login` | Login y emision de token. |
| GET | `/api/auth/me` | Usuario actual, roles, permisos y alcance. |
| POST | `/api/auth/change-password` | Cambio de password del usuario logueado. |

## Sistema y configuracion

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/system/status` | Estado publico del sistema. |
| GET | `/api/system/summary` | Resumen operativo para dashboard. |
| GET | `/api/system/about` | Informacion de version/configuracion. |
| GET | `/api/system/diagnostics` | Diagnostico operativo. |
| POST | `/api/system/diagnostics/repair` | Ejecuta reparaciones conocidas. |
| GET | `/api/system/profile/activity` | Actividad del usuario/perfil. |
| GET | `/api/config/status` | Estado de configuracion tecnica. |

## Herramientas y jobs

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/tools` | Lista herramientas disponibles. |
| GET | `/api/tools/{tool_id}` | Detalle de herramienta. |
| POST | `/api/tools/{tool_id}/run` | Ejecuta herramienta como job. |
| GET | `/api/jobs` | Lista jobs recientes. |
| GET | `/api/jobs/{job_id}` | Detalle de job. |
| GET | `/api/jobs/{job_id}/logs` | Logs del job. |
| POST | `/api/jobs/{job_id}/cancel` | Cancela job si es posible. |

## Garantias

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/warranties/options` | Opciones para formularios. |
| GET | `/api/warranties/products` | Busqueda de productos para garantia. |
| POST | `/api/warranties/entries` | Crea una o varias garantias. |
| GET | `/api/warranties/list` | Lista de garantias. |
| GET | `/api/warranties/review-queue` | Bandeja de revision. |
| GET | `/api/warranties/management` | Bandeja de gestion. |
| GET | `/api/warranties/delayed` | Garantias atrasadas. |
| GET | `/api/warranties/dashboard` | KPIs de garantias. |
| GET | `/api/warranties/{warranty_id}` | Detalle de garantia. |
| PATCH | `/api/warranties/{warranty_id}` | Actualiza garantia. |
| PATCH | `/api/warranties/{warranty_id}/entry-base` | Actualiza datos base de carga. |
| GET | `/api/warranties/{warranty_id}/history` | Historial. |
| POST | `/api/warranties/{warranty_id}/take-review` | Toma revision. |
| POST | `/api/warranties/{warranty_id}/mark-incomplete` | Marca incompleta. |
| POST | `/api/warranties/{warranty_id}/approve-review` | Aprueba revision. |
| POST | `/api/warranties/{warranty_id}/confirm-shipment` | Confirma envio. |
| POST | `/api/warranties/{warranty_id}/send-provider` | Envia a proveedor. |
| POST | `/api/warranties/{warranty_id}/provider-pickup-request` | Registra pedido de retiro. |
| POST | `/api/warranties/{warranty_id}/provider-response` | Registra respuesta de proveedor. |
| POST | `/api/warranties/{warranty_id}/provider-correction-resolve` | Resuelve correccion. |
| POST | `/api/warranties/{warranty_id}/resend-provider-mail` | Reenvia mail de proveedor. |
| POST | `/api/warranties/{warranty_id}/claim` | Registra reclamo. |
| POST | `/api/warranties/{warranty_id}/status` | Cambia estado. |
| POST | `/api/warranties/{warranty_id}/cancel` | Cancela garantia. |
| DELETE | `/api/warranties/{warranty_id}` | Elimina garantia. |
| GET | `/api/warranties/counters` | Contadores de garantia. |
| POST | `/api/warranties/counters/resync` | Resincroniza contadores. |
| GET | `/api/warranties/config` | Configuracion de garantias. |
| PATCH | `/api/warranties/config` | Guarda configuracion de garantias. |
| GET | `/api/warranties/diagnostics` | Diagnostico especifico. |
| GET | `/api/warranties/production-reset/preview` | Previsualiza reset. |
| POST | `/api/warranties/production-reset/backup` | Backup previo a reset. |
| POST | `/api/warranties/production-reset/execute` | Ejecuta reset. |

## Garantias - exportacion y sync

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/warranties/export/provider-suggestions` | Sugerencias de proveedor. |
| GET | `/api/warranties/export/eligible` | Garantias elegibles para exportar. |
| POST | `/api/warranties/export/batch` | Exporta lote. |
| POST | `/api/warranties/export/provider` | Exporta para proveedor. |
| GET | `/api/warranties/exports` | Lista exportaciones. |
| POST | `/api/warranties/exports/{export_id}/regenerate` | Regenera un ENV existente con los datos actuales. |
| GET | `/api/warranties/exports/{export_id}/download` | Descarga exportacion. |
| GET | `/api/warranties/sync/status` | Estado de sync con Sheets. |
| GET | `/api/warranties/sync/logs` | Logs de sync. |
| POST | `/api/warranties/sync/setup-sheet` | Prepara hoja. |
| POST | `/api/warranties/sync/push-to-sheet` | Envia datos a Sheets. |

> `POST /api/warranties/sync/pull-from-sheet` fue eliminado: Sheets queda como
> espejo/exportacion, no como fuente para importar datos.

## Remitos de garantias

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/warranties/remitos/available-warranties` | Garantias disponibles para remito. |
| GET | `/api/warranties/remitos/deposit-transfer/options` | Opciones de transferencia. |
| GET | `/api/warranties/remitos/deposit-transfer/available-warranties` | Garantias transferibles. |
| POST | `/api/warranties/remitos/deposit-transfer/generate` | Genera transferencia deposito-deposito. |
| GET | `/api/warranties/remitos/provider-delivery/available-warranties` | Garantias para proveedor. |
| POST | `/api/warranties/remitos/provider-delivery/generate` | Genera remito a proveedor. |
| POST | `/api/warranties/remitos/generate` | Genera remito interno. |
| GET | `/api/warranties/remitos/` | Lista remitos. |
| POST | `/api/warranties/remitos/confirm-arrival-by-code` | Confirma llegada por codigo. |
| GET | `/api/warranties/remitos/by-code/{remito_code}` | Busca por codigo. |
| GET | `/api/warranties/remitos/{remito_code}` | Detalle de remito. |
| GET | `/api/warranties/remitos/{remito_code}/pdf` | PDF del remito. |
| POST | `/api/warranties/remitos/{remito_code}/dispatch` | Despacha remito. |
| POST | `/api/warranties/remitos/{remito_code}/confirm-arrival` | Confirma llegada. |
| POST | `/api/warranties/remitos/batch-pickup` | Marca retiro/lote. |
| DELETE | `/api/warranties/remitos/{remito_code}` | Elimina remito. |

## Presupuestos

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/budgets/options` | Opciones para presupuestos. |
| GET | `/api/budgets/products` | Busqueda de productos. |
| POST | `/api/budgets/entries` | Guarda presupuesto. |

## Ventas web

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/sales-web/options` | Opciones de formulario. |
| GET | `/api/sales-web/products` | Busqueda de productos. |
| POST | `/api/sales-web/requests` | Crea solicitud. |
| GET | `/api/sales-web/requests` | Lista solicitudes. |
| GET | `/api/sales-web/requests/{request_id}` | Detalle. |
| PATCH | `/api/sales-web/requests/{request_id}` | Edita datos administrativos. |
| POST | `/api/sales-web/requests/{request_id}/take` | Toma solicitud. |
| POST | `/api/sales-web/requests/{request_id}/complete` | Completa solicitud. |
| POST | `/api/sales-web/requests/{request_id}/send-to-sales` | Devuelve/envia al vendedor. |
| POST | `/api/sales-web/requests/{request_id}/cancel` | Cancela solicitud. |
| DELETE | `/api/sales-web/requests/{request_id}` | Elimina solicitud. |

## Sales BI

| Metodo | Ruta | Uso |
|---|---|---|
| POST | `/api/sales-bi/analyze` | Analiza archivo o URL. |
| POST | `/api/sales-bi/confirm` | Confirma importacion. |
| GET | `/api/sales-bi/imports` | Lista importaciones. |
| GET | `/api/sales-bi/imports/{import_id}` | Detalle de importacion. |
| POST | `/api/sales-bi/imports/{import_id}/void` | Anula importacion. |
| GET | `/api/sales-bi/records` | Consulta registros. |
| GET | `/api/sales-bi/balances` | Consulta saldos. |
| GET | `/api/sales-bi/stats` | Estadisticas. |

## Productos

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/products/status` | Estado del catalogo. |
| GET | `/api/products/catalog` | Lista catalogo. |
| GET | `/api/products/search` | Busqueda rapida. |
| POST | `/api/products/sync/from-sheet` | Sincroniza desde Sheets. |
| GET | `/api/products/sync/logs` | Logs de sync. |
| GET | `/api/products/brands` | Marcas. |
| GET | `/api/products/providers` | Proveedores. |
| POST | `/api/products/providers` | Crea proveedor. |
| PATCH | `/api/products/providers/{provider_id}` | Edita proveedor. |
| GET | `/api/products/brand-providers` | Relaciones marca-proveedor. |
| POST | `/api/products/brand-providers` | Crea/actualiza relacion. |
| DELETE | `/api/products/brand-providers/{relation_id}` | Elimina relacion. |
| GET | `/api/products/provider-by-brand` | Busca proveedor por marca. |

## Precios y costos

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/price-cost-updates/lookup-product` | Busca producto por SKU/tipo. |
| GET | `/api/price-cost-updates` | Lista actualizaciones. |
| POST | `/api/price-cost-updates` | Crea actualizacion. |
| GET | `/api/price-cost-updates/{update_id}` | Detalle. |
| PATCH | `/api/price-cost-updates/{update_id}` | Edita. |
| POST | `/api/price-cost-updates/{update_id}/check` | Marca/desmarca check. Backend valida permiso por destino (`web`, `puma`, `planilla_madre`). |
| POST | `/api/price-cost-updates/{update_id}/cancel` | Cancela. |
| GET | `/api/price-cost-updates/{update_id}/history` | Historial. |
| POST | `/api/price-cost-updates/announcements/images` | Genera PNGs comerciales con precios nuevos seleccionados. Devuelve imagenes en base64 y mensaje para compartir. |

## Empleados

| Metodo | Ruta | Uso |
|---|---|---|
| POST | `/api/employees/me/photo` | Sube foto propia. |
| GET | `/api/employees/{username}/photo` | Obtiene foto por usuario. |
| POST | `/api/employees/{username}/photo/request` | Solicita nueva foto. |
| POST | `/api/employees/{username}/photo/approve` | Aprueba foto. |
| POST | `/api/employees/{username}/photo/reject` | Rechaza foto. |
| GET | `/api/employees` | Lista empleados. |
| GET | `/api/employees/users/link-candidates` | Usuarios candidatos a vincular. |
| POST | `/api/employees` | Crea empleado. |
| GET | `/api/employees/{employee_id}` | Detalle de empleado. |
| PATCH | `/api/employees/{employee_id}` | Edita empleado. |
| POST | `/api/employees/{employee_id}/link-user` | Vincula usuario. |
| POST | `/api/employees/{employee_id}/unlink-user` | Desvincula usuario. |
| POST | `/api/employees/{employee_id}/status` | Cambia estado laboral. |
| GET | `/api/employees/{employee_id}/status-history` | Historial de estados. |

## Recibos de sueldo

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/payroll/receipts` | Lista recibos. |
| POST | `/api/payroll/receipts` | Sube recibo individual. |
| POST | `/api/payroll/receipts/bulk/preview` | Previsualiza carga masiva. |
| POST | `/api/payroll/receipts/bulk/upload` | Ejecuta carga masiva. |
| GET | `/api/payroll/receipts/{receipt_id}` | Detalle. |
| GET | `/api/payroll/receipts/{receipt_id}/file` | Archivo/PDF. |
| POST | `/api/payroll/receipts/{receipt_id}/sign` | Firma conformidad. |
| POST | `/api/payroll/receipts/{receipt_id}/observe` | Observa recibo. |
| POST | `/api/payroll/receipts/{receipt_id}/observations/respond` | Responde observacion. |
| POST | `/api/payroll/receipts/{receipt_id}/cancel` | Anula recibo. |

## Notificaciones

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/notifications` | Lista notificaciones. |
| GET | `/api/notifications/summary` | Resumen. |
| GET | `/api/notifications/unread-count` | Contador no leidas. |
| POST | `/api/notifications/{notification_id}/read` | Marca leida. |
| POST | `/api/notifications/mark-all-read` | Marca todas leidas. |
| POST | `/api/notifications/internal` | Crea notificacion interna. |
| POST | `/api/notifications/push/fcm-token` | Registra token FCM. |
| DELETE | `/api/notifications/push/fcm-token` | Elimina token FCM. |
| POST | `/api/notifications/push/subscribe` | Suscribe push web. |
| POST | `/api/notifications/push/unsubscribe` | Desuscribe push web. |

## Administracion

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/admin/permissions` | Lista permisos disponibles. |
| GET | `/api/admin/roles` | Lista roles. |
| PUT | `/api/admin/roles/{role_name}` | Actualiza rol/permisos. |
| GET | `/api/admin/users` | Lista usuarios. |
| POST | `/api/admin/users` | Crea usuario. |
| POST | `/api/admin/users/repair-branch-links` | Repara sucursales legacy. |
| POST | `/api/admin/users/repair-legacy-roles` | Repara roles legacy. |
| POST | `/api/admin/users/repair-employees` | Repara empleados vinculados. |
| POST | `/api/admin/users/{username}/reset-password` | Resetea password. |
| DELETE | `/api/admin/users/{username}` | Elimina usuario. |
| POST | `/api/admin/users/{username}/deactivate` | Desactiva usuario. |
| POST | `/api/admin/users/{username}/activate` | Activa usuario. |
| GET | `/api/admin/audit` | Auditoria. |

## Google Admin

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/admin/google/status` | Estado OAuth. |
| POST | `/api/admin/google/credentials` | Carga credenciales. |
| POST | `/api/admin/google/token` | Carga token. |
| DELETE | `/api/admin/google/token` | Borra token. |
| POST | `/api/admin/google/refresh-token` | Refresca token. |
| POST | `/api/admin/google/reconnect-local/start` | Inicia reconexion local. |
| GET | `/api/admin/google/reconnect-local/status` | Estado de reconexion. |

## Organizacion

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/companies` | Lista empresas. |
| POST | `/api/companies` | Crea empresa. |
| PATCH | `/api/companies/{company_id}` | Edita empresa. |
| GET | `/api/branches` | Lista sucursales. |
| POST | `/api/branches` | Crea sucursal. |
| PATCH | `/api/branches/{branch_id}` | Edita sucursal. |
| GET | `/api/operational-structure` | Estructura operativa completa. |

## Configuracion operativa

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/admin/operational-config` | Lee configuracion. |
| PUT | `/api/admin/operational-config` | Guarda configuracion. |
| POST | `/api/admin/operational-config/lock` | Bloquea edicion. |
| POST | `/api/admin/operational-config/unlock` | Desbloquea edicion. |
| POST | `/api/admin/operational-config/validate` | Valida seccion. |

## Backups

| Metodo | Ruta | Uso |
|---|---|---|
| GET | `/api/admin/backups` | Lista backups. |
| POST | `/api/admin/backups` | Crea backup. |
| GET | `/api/admin/backups/{filename}` | Descarga backup. |
