# Congelado central de planillas — instalación (una sola vez)

`congelado-central.gs` es la versión **centralizada** del sistema de
congelado automático de ventas. Reemplaza al script que había que
instalar planilla por planilla (el que se olvidaba).

## Por qué centralizado

Cuando `gpd.py` copia la plantilla, el código Apps Script viaja con la
copia pero **los triggers no se copian nunca** — Google no permite
crearlos desde afuera (ni por API). Por eso el sistema viejo obligaba a
abrir cada planilla nueva y tocar "Instalar".

La versión central invierte el problema: **un único proyecto standalone
con un único trigger**, que cada 10 minutos escanea las 4 carpetas de
Drive (SUR / NORTE / CANNING / CASEROS), detecta las planillas
recientes y les aplica el congelado. Las planillas nuevas de cada
mañana (incluida la del domingo de NORTE que se genera los sábados)
las agarra solo. Corre en los servidores de Google: funciona aunque
todas las PCs estén apagadas.

## Instalación (5 minutos, una vez en la vida)

1. Entrar a <https://script.google.com> con la cuenta de Google que es
   **dueña de las carpetas de planillas** (la misma que usa gpd.py).
2. "Nuevo proyecto" → borrar el contenido de `Código.gs` → pegar el
   contenido completo de `congelado-central.gs`.
3. Ponerle nombre al proyecto: `Congelado central planillas`.
4. En `CONFIG.protectionEditors` agregar tu mail (quién puede editar
   filas ya congeladas).
5. En la barra superior elegir la función **`instalarSistemaCentral`**
   y apretar **Ejecutar**. Autorizar los permisos (Drive + Sheets).
6. Verificar con la función **`verEstadoSistema`** → en el log tienen
   que aparecer las planillas recientes y `Triggers activos: 1`.

Listo. No hay paso 7. No hay que volver a tocarlo.

## Semántica (igual que el sistema viejo)

- Una venta se considera **completa** cuando tiene Producto (G),
  Cantidad (I) y Valor (J).
- Cuando una venta completa pasa `minutesToWait` (10 min) **sin
  cambios** (mismo hash de fila entre pasadas), se congelan las
  fórmulas a valores en A:J y se protege el rango.
- Con escaneo cada 10 min, el congelado efectivo ocurre **entre 10 y
  20 minutos** después del último cambio.
- El control vive en la hoja oculta `AUX_CONGELAR` de cada planilla,
  y el ID por venta en la columna AX (oculta).

## Convivencia con el sistema viejo

- El código viejo que quedó pegado en la plantilla es **inerte** en las
  copias (sin triggers no hace nada). Se puede dejar o borrar de la
  plantilla — recomendado borrarlo para que no confunda.
- Si alguna planilla vieja todavía tiene los triggers del sistema
  por-planilla instalados, conviven sin romper nada (las protecciones
  usan la misma descripción y son idempotentes), pero conviene
  desinstalarlos para no gastar cuota: menú "Automatización ventas →
  Desinstalar triggers del sistema" en esa planilla.

## Cuotas de Apps Script

Con `triggerEveryMinutes: 10` y ~4-6 planillas activas, el consumo
diario queda muy por debajo del límite de cuentas gratuitas (90
min/día de triggers). Si la cuenta es Google Workspace se puede bajar
a 5 minutos sin problema.

## Mantenimiento

- Sucursal nueva → agregar su carpeta a `CONFIG.folderIds`.
- Cambia una plantilla → actualizar `CONFIG.excludeFileIds`.
- Después de editar CONFIG no hace falta reinstalar el trigger
  (los cambios aplican en la próxima pasada), salvo que cambies
  `triggerEveryMinutes` — en ese caso correr `instalarSistemaCentral`
  de nuevo (borra y recrea el trigger).
