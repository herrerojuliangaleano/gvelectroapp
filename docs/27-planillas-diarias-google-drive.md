# Planillas diarias y congelado central

## Objetivo

Documentar el flujo completo de la herramienta `gpd`, la relación con Google
Drive/Sheets y el proceso externo que congela ventas. Este documento es la
fuente de verdad para Codex, Claude Code y mantenimiento operativo.

## Alcance

La herramienta genera las planillas diarias de:

- Caseros.
- Lanús (SUR).
- Norcenter (NORTE).
- Canning.

El backend corre en PostgreSQL, pero este flujo no persiste las ventas en la
base de la aplicación: crea y administra archivos de Google Sheets.

## Componentes

| Componente | Responsabilidad |
|---|---|
| `gpd.py` | Copiar las plantillas, nombrar los archivos y guardarlos en Drive. |
| Google Drive API | Crear copias, ubicarlas en carpetas y devolver enlaces. |
| Google Sheets | Interfaz donde cada sucursal carga sus ventas. |
| `congelado-central.gs` | Detectar ventas estables, convertir fórmulas a valores y proteger filas. |
| `AUX_CONGELAR` | Guardar el estado interno de las ventas procesadas. |
| Columna AX | Guardar `AUTO_ID_VENTA` por fila; permanece oculta. |

Archivos principales:

- `backend/legacy_scripts/Aplicacion de ElectroGV/scripts/Generar Planillas Diarias/gpd.py`
- `backend/legacy_scripts/Aplicacion de ElectroGV/scripts/Generar Planillas Diarias/congelado-central.gs`
- `backend/legacy_scripts/Aplicacion de ElectroGV/scripts/Generar Planillas Diarias/README-congelado-central.md`
- `backend/app/tools/registry.py`

## Flujo funcional

1. Un usuario ejecuta `Generar Planillas Diarias` desde Herramientas internas.
2. El backend inicia un job y ejecuta `gpd.py`.
3. `gpd.py` copia la plantilla correspondiente a cada sucursal.
4. Las copias se guardan en sus carpetas de Drive y el job devuelve sus links.
5. El proyecto standalone `Congelado Central` busca periódicamente planillas
   recientes en esas carpetas.
6. Una planilla vacía se ignora por completo.
7. Al aparecer una venta real, el script prepara AX y `AUX_CONGELAR`.
8. Cuando Producto (G), Cantidad (I) y Valor (J) permanecen estables durante el
   tiempo configurado, A:J se convierte a valores y la fila se protege.

## Regla de planilla vacía

Las plantillas contienen fórmulas precargadas en H y J. Esas fórmulas no deben
interpretarse como ventas ni provocar escrituras periódicas.

El detector de última fila considera las columnas de carga humana A:G, I y K.
Si AX ya existe, también se consulta para poder reconocer una fila borrada que
conserva un ID. La estructura auxiliar se crea únicamente cuando la última fila
real es igual o posterior a la fila 5.

## Importación de planillas históricas en Sales BI

Las copias históricas pueden conservar en su encabezado la sucursal o la fecha
de la plantilla usada como origen. Para archivos Excel, el nombre operativo es
la referencia principal cuando contiene datos válidos:

- `Planilla Ventas SUR - DD_MM_YYYY.xlsx` se importa como Lanús.
- `Planilla Ventas NORTE - DD_MM_YYYY.xlsx` se importa como Norcenter.
- La fecha admite separadores `_`, `-` o `.`.
- Si el nombre no contiene una fecha válida, se conserva la fecha interna.
- Si nombre e interior difieren, el preview muestra una advertencia y aplica el
  dato del nombre sin modificar el Excel original.

El nombre original también se envía al confirmar la importación. Esto evita que
el análisis muestre una sucursal y la confirmación vuelva a interpretar otra.
Un conflicto de una hoja no bloquea el lote completo: las hojas conflictivas se
omiten salvo que el usuario marque `Reemplazar`, y las demás se importan.

Caso real cubierto: `Planilla Ventas SUR - 17_03_2026.xlsx` contenía `NORTE` en
su encabezado. Debe quedar como Lanús por pertenecer al lote SUR.

## Incidente: Sheets cargando indefinidamente

### Síntoma

Los cuatro archivos se creaban correctamente y tenían permisos válidos, pero
Lanús, Norcenter y Canning quedaban cargando en Google Sheets. Caseros abría.

### Diagnóstico

- Los jobs `gpd` terminaban con éxito y devolvían los cuatro IDs.
- La API de Sheets podía leerlos y exportarlos a XLSX.
- Las planillas ABC recibían `AUX_CONGELAR`, la columna AX y nuevas fechas de
  modificación pocos minutos después de crearse.
- Caseros no era alcanzado en algunas pasadas y por eso parecía funcionar.

### Causa raíz

El Apps Script preparaba la estructura antes de comprobar si existían ventas.
Además, `prepararEstructura_` y `prepararHojaControl_` escribían encabezados en
cada trigger. Las fórmulas precargadas ampliaban el rango aparente y Google
recalculaba varias planillas cada diez minutos. Como las carpetas ABC se
recorrían primero, concentraban el problema.

### Corrección

- Detectar datos reales antes de preparar la estructura.
- Retornar sin mutaciones cuando la planilla está vacía.
- Ignorar H/J al calcular la última fila real.
- No reescribir AX, encabezados o filas congeladas si ya están correctos.
- Procesar únicamente hasta la última fila con carga real.

## Despliegue

Hay dos despliegues independientes:

1. **Aplicación:** commit/push y rebuild de `backend-prod` actualizan el código
   versionado y la herramienta `gpd`.
2. **Apps Script:** `congelado-central.gs` debe copiarse y guardarse en el
   proyecto standalone `Congelado Central` con la cuenta administradora.

Un rebuild de Docker no despliega Apps Script. Después de actualizarlo, ejecutar
`verEstadoSistema` y confirmar que hay un solo trigger de
`revisarTodasLasPlanillas`.

## Validación

1. Ejecutar `gpd` y confirmar que el job finaliza con cuatro links.
2. Abrir las cuatro planillas recién creadas.
3. Mientras estén vacías, verificar que no exista `AUX_CONGELAR` y que no se
   haya agregado AX.
4. Cargar una venta de prueba en una copia no productiva.
5. Esperar dos pasadas del trigger y verificar ID, control, congelado y
   protección.
6. Confirmar que volver a ejecutar el trigger no modifica una fila ya estable.

## Riesgos y cuidado

- `[NO TOCAR]` No cambiar IDs de plantillas o carpetas sin actualizar `gpd.py`
  y `CONFIG` en el Apps Script.
- `[RIESGO]` No instalar varios triggers de `revisarTodasLasPlanillas`.
- `[RIESGO]` No volver a usar `sheet.getLastRow()` para decidir si la planilla
  tiene ventas: H/J contienen fórmulas precargadas.
- `[RIESGO]` Al confirmar un Excel histórico, conservar siempre su nombre de
  origen; forma parte de la resolución de sucursal y fecha.
- `[NO TOCAR]` No borrar AX o `AUX_CONGELAR` de una planilla que ya tenga
  ventas congeladas.

## Estado actual

[FASE] Operación Google Drive - Planillas diarias
[ESTADO] Corregido localmente; requiere despliegue explícito en Apps Script
[BASE ACTIVA] PostgreSQL; este flujo opera sobre Google Drive/Sheets
[OBJETIVO] Crear planillas utilizables y congelar ventas sin recalcular archivos vacíos

La app sigue funcionando contra PostgreSQL. No se usan ni migran datos de
SQLite o JSON en este flujo.
