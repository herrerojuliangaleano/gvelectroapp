# Reparacion de identidad en anuncio de precios

## Objetivo

Corregir en produccion local el anuncio `#93` y su bandeja operativa sin perder
los precios historicos. El producto `KJH-EX395` cambio de identidad a
`TFK-EX395`; los aires `AEV09IF10-BL` y `AEV12IF10-BL` cambiaron su descripcion
a `A/A DE VENTANA`.

## Estado comprobado

- El lote `#93` se genero el 12/08/2026 a las 10:12 con cuatro productos.
- `KJH-EX395` conserva el cambio `$775.000 -> $800.000` en la actualizacion
  `#984`.
- La sincronizacion creo `TFK-EX395` como producto `#1387` y actualizacion
  `#990`, pero lo clasifico incorrectamente como nuevo ingreso porque no
  encontro el precio anterior.
- Las actualizaciones `#987`, `#988` y `#989` pertenecen a los otros tres
  productos del anuncio y estan archivadas para anuncios.
- Los lotes usan snapshots; regenerar sin reparar el snapshot reproduce los
  nombres anteriores.

## Diseno aprobado

1. Usar `products.id=1387` como producto canonico para `TFK-EX395`.
2. Corregir la identidad de la actualizacion `#984` a TELEFUNKEN/TFK-EX395,
   conservando `$775.000 -> $800.000` y sus checks/historial.
3. Cancelar las actualizaciones duplicadas `#990` y `#991`, creadas como altas
   nuevas por el cambio de SKU.
4. Desactivar el producto viejo `products.id=1380` para evitar que reaparezca.
5. Corregir las descripciones de `#988` y `#989` desde el catalogo actual.
6. Reabrir para anuncios `#984`, `#987`, `#988` y `#989`.
7. Corregir los cuatro snapshots del lote `#93` y sus `brand_names` para que
   `Regenerar` tambien produzca la placa correcta.

## Seguridad

- Crear un `pg_dump` antes de modificar datos.
- Ejecutar la reparacion en una unica transaccion PostgreSQL.
- Bloquear la transaccion si no existen exactamente los productos,
  actualizaciones y lote esperados.
- No modificar importes, checks ni estados operativos de los cuatro cambios
  originales.
- Registrar el motivo de cancelacion de los duplicados y agregar historial de
  reparacion a las actualizaciones afectadas.

## Resultado esperado

La bandeja de anuncios vuelve a mostrar exactamente cuatro cambios:

- `TFK-EX395`: TELEFUNKEN, aumento `$775.000 -> $800.000`.
- `TFK-EX500`: TELEFUNKEN, baja `$1.050.000 -> $1.000.000`.
- `AEV09IF10-BL`: ENOVA, nuevo ingreso con descripcion `A/A DE VENTANA`.
- `AEV12IF10-BL`: ENOVA, nuevo ingreso con descripcion `A/A DE VENTANA`.

El lote `#93` queda regenerable con esas mismas identidades e importes.

## Resultado de ejecucion

[HECHO] Reparacion aplicada el 12/08/2026 sobre PostgreSQL de produccion local.

- Backup previo:
  `backend/backups-prod/pre-price-announcement-repair-20260812-104327.dump`.
- `products.id=1380` quedo inactivo y `products.id=1387` quedo como identidad
  canonica `TELEFUNKEN / TFK-EX395`.
- Actualizaciones `#990/#991` quedaron canceladas como duplicados de cambio de
  identidad.
- Actualizaciones `#984/#987/#988/#989` quedaron nuevamente disponibles para
  anuncios.
- El lote `#93` fue corregido y su renderer produjo una pagina PNG de 162.359
  bytes con cuatro productos.
- Health de mini-prod: `GET http://127.0.0.1:8010/api/health` respondio
  `{"ok": true}`.
