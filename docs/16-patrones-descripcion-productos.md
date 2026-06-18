# Documentación — Patrones de descripción de productos para App + ERP

## 1. Objetivo del documento

Este documento reemplaza la planilla `patrones_descripcion_productos_app_erp` como referencia funcional para implementar en la app el generador de alta y normalización de productos. Define familias, rubros, campos obligatorios, patrones de descripción comercial, patrones de descripción ERP, abreviaturas, subrubros sugeridos, validaciones y observaciones de calidad detectadas en las planillas actuales.

La finalidad es que la app pida datos estructurados y genere automáticamente los nombres correctos, evitando que cada usuario escriba descripciones o SKUs de manera libre.

## 2. Resumen del análisis usado como base

- **Objetivo:** Definir patrones para que la app genere descripciones comerciales y descripciones ERP sin texto libre.
- **Base usada:** Hoja de familias/rubros del usuario + Planilla Madre + Planilla de Existencias.
- **Regla central:** Familia app = línea comercial; Rubro app = tipo; Subrubro app = detalle técnico claro.
- **ERP:** La descripción de Puma/ERP debe respetar máximo 50 caracteres.
- **No es matching:** Este archivo no decide equivalencias de producto. Solo define reglas de descripción/carga.

### Métricas del archivo analizado
- **Rubros definidos por el usuario:** 54
- **Productos en Planilla Madre leídos:** 1212
- **Productos en Existencias leídos:** 1192
- **Descripciones ERP con 50 caracteres:** 240
- **Máximo caracteres descripción ERP detectado:** 50

## 3. Regla central de clasificación

- **Familia app:** línea comercial grande de la empresa. Ejemplos: Línea Blanca, Climatización, Cocina, TV/Audio, Pequeños Electros.
- **Rubro app:** tipo de producto. Ejemplos: HELADERA, TV, COCINA, LAVARROPAS.
- **Subrubro app:** detalle técnico corto que permite agrupar y filtrar. Ejemplos: 55" 4K, 8 kg frontal, 3000W frío/calor inverter.

La clasificación del ERP se conserva como referencia, pero no debe mandar sobre los reportes comerciales.

## 4. Mapa de familias y rubros detectados

La app debe manejar estos rubros como lista controlada. Se corrige el rubro **MULTIROCESADORA** a **MULTIPROCESADORA**.

| Familia app | Rubro app | Conteo Madre | Conteo Existencias | Nota |
|---|---|---|---|---|
| CLIMATIZACIÓN | AIRE ACONDICIONADO | 67 | 65 | OK |
| COCINA | ANAFE | 30 | 30 | OK |
| COCINA | COCINA | 47 | 52 | OK |
| LÍNEA BLANCA | FREEZER | 26 | 26 | OK |
| LÍNEA BLANCA | EXHIBIDORA | 1 | 0 | OK |
| LÍNEA BLANCA | HELADERA | 257 | 256 | OK |
| COCINA | HORNO | 53 | 52 | OK |
| LÍNEA BLANCA | LAVARROPAS | 160 | 161 | OK |
| LÍNEA BLANCA | LAVASECARROPAS | 35 | 34 | OK |
| LÍNEA BLANCA | LAVAVAJILLAS | 14 | 14 | OK |
| LÍNEA BLANCA | SECARROPAS | 17 | 18 | OK |
| CLIMATIZACIÓN | TERMOTANQUE | 22 | 22 | OK |
| LÍNEA BLANCA | TORRE DE LAVADO | 2 | 2 | OK |
| TV / AUDIO | TV | 73 | 72 | OK |
| PEQUEÑOS ELECTROS | ASPIRADORA | 24 | 24 | OK |
| COCINA | CAMPANA | 20 | 20 | OK |
| CLIMATIZACIÓN | CALEFON | 2 | 2 | OK |
| PEQUEÑOS ELECTROS | CERVECERA | 1 | 1 | OK |
| CLIMATIZACIÓN | CALOVENTOR | 3 | 2 | OK |
| CLIMATIZACIÓN | CONVECTOR | 8 | 5 | OK |
| COCINA | MICROONDAS | 58 | 58 | OK |
| TV / AUDIO | MINICOMPONENTE | 2 | 2 | OK |
| TV / AUDIO | MONITOR | 5 | 5 | OK |
| CLIMATIZACIÓN | PANEL | 3 | 3 | OK |
| TV / AUDIO | PARLANTE | 9 | 10 | OK |
| CLIMATIZACIÓN | PURIFICADOR | 7 | 7 | OK |
| CLIMATIZACIÓN | VENTILADOR | 6 | 6 | OK |
| PEQUEÑOS ELECTROS | ARROCERA | 1 | 1 | OK |
| PEQUEÑOS ELECTROS | BATIDORA | 25 | 25 | OK |
| PEQUEÑOS ELECTROS | CAFETERA | 56 | 54 | OK |
| PEQUEÑOS ELECTROS | CHOPPER | 1 | 0 | OK |
| PEQUEÑOS ELECTROS | ESPUMADOR | 1 | 1 | OK |
| PEQUEÑOS ELECTROS | EXPRIMIDOR | 4 | 5 | OK |
| PEQUEÑOS ELECTROS | EXTRACTOR | 1 | 0 | OK |
| PEQUEÑOS ELECTROS | FREIDORA | 37 | 37 | OK |
| PEQUEÑOS ELECTROS | JARRA | 9 | 0 | OK |
| PEQUEÑOS ELECTROS | LICUADORA | 40 | 39 | OK |
| PEQUEÑOS ELECTROS | LIMPIADOR ZAP | 1 | 1 | OK |
| PEQUEÑOS ELECTROS | MIXER | 1 | 0 | OK |
| PEQUEÑOS ELECTROS | MOLINO | 3 | 0 | OK |
| PEQUEÑOS ELECTROS | MOLINILLO | 1 | 1 | OK |
| PEQUEÑOS ELECTROS | MULTIOLLA | 1 | 1 | OK |
| PEQUEÑOS ELECTROS | MULTIPROCESADORA | 1 | 0 | OK |
| PEQUEÑOS ELECTROS | PAVA | 23 | 32 | OK |
| PEQUEÑOS ELECTROS | PICADORA | 2 | 2 | OK |
| PEQUEÑOS ELECTROS | PLANCHA | 11 | 11 | OK |
| PEQUEÑOS ELECTROS | PROCESADORA | 7 | 8 | OK |
| PEQUEÑOS ELECTROS | QUITAPELUSAS | 2 | 2 | OK |
| PEQUEÑOS ELECTROS | SANDWICHERA | 6 | 5 | OK |
| PEQUEÑOS ELECTROS | SOPERA | 2 | 0 | OK |
| PEQUEÑOS ELECTROS | TOSTADORA | 13 | 13 | OK |
| PEQUEÑOS ELECTROS | VAPORIZADOR | 3 | 3 | OK |
| PEQUEÑOS ELECTROS | YOGURTERA | 2 | 0 | OK |
| TV / AUDIO | BARRA DE SONIDO | 1 | 0 | OK |

## 5. Reglas generales del generador

### Regla 1: El usuario no escribe descripción libre
La app debe pedir campos estructurados según rubro. Campo libre solo observación interna.

### Regla 2: Normalizar texto
Mayúsculas para ERP; comercial en formato legible; limpiar espacios, tildes opcionales y símbolos raros.

### Regla 3: Detectar condición
Si SKU contiene (O), condición = OUTLET. Si no contiene (O), condición = PRIMERA. Guardar sku_base sin (O).

### Regla 4: Generar descripción comercial
Usar patrón del rubro. Debe ser entendible para vendedor, presupuesto, web y dashboard.

### Regla 5: Generar descripción ERP
Usar patrón ERP con abreviaturas. Máximo 50 caracteres.

### Regla 6: Validar descripción ERP
Si supera 50, aplicar diccionario; si sigue superando, quitar campos opcionales; si sigue superando, estado REVISAR.

### Regla 7: Validar SKU y código Puma
SKU no puede duplicar otro activo. Código Puma puede quedar pendiente solo en estado PENDIENTE_ALTA_ERP.

### Regla 8: Guardar historial
Guardar descripción anterior, descripción nueva, usuario, fecha y motivo de cambio.

### Regla 9: Exportar a Puma
Exportar solo campos bloqueados/generados por app para que nadie cargue distinto en ERP.

### Regla 10: Revisión manual obligatoria
Casos con rubro ambiguo, descripción ERP >50, SKU duplicado, marca no reconocida o falta de dato clave.

## 6. Regla de condición y OUTLET

La condición debe ser un campo obligatorio. Para la primera etapa se usarán principalmente `PRIMERA` y `OUTLET`.

Para productos OUTLET, la app debe generar tres cosas al mismo tiempo:

- `condicion = OUTLET`
- `sku_comercial = SKU_BASE (O)`
- `descripcion_comercial = Descripción base + (OUTLET)`

La descripción ERP **no debe incluir OUTLET**. El ERP/Puma debe manejar esa diferencia por condición, circuito interno, depósito, atributo o mecanismo correspondiente.

Ejemplo:

```text
SKU base: RT38K5932SL
SKU comercial: RT38K5932SL (O)
Condición: OUTLET
Descripción comercial: Heladera Samsung RT38 385L No Frost Inox (OUTLET)
Descripción ERP: HEL SAMSUNG RT38 385L NF INOX
```

## 7. Patrones de descripción por rubro

Cada rubro debe implementarse como una plantilla de carga dentro de la app. La app debe pedir campos obligatorios, generar descripción comercial, generar descripción ERP y validar el largo de la descripción ERP.

### AIRE ACONDICIONADO — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 67.
- **Conteo Existencias:** 65.
- **Patrón actual detectado:** Arranque frecuente: A/A BGH (28), A/A ALASKA (12) | Datos que aparecen hoy: watts: 22/40; tecnología/función: detectado.
- **Problema actual:** Hoy se usa A/A + marca + capacidad, pero a veces falta función, tipo e inverter. Mantener A/A para ERP..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad W/frigorías; tipo split/portátil; función frío solo o frío/calor; tecnología on/off o inverter.
- **Campos opcionales:** color; eficiencia; wifi; kit instalación.
- **Subrubro debe salir de:** `{capacidad} {funcion} {tecnologia}`.
- **Descripción comercial patrón:** `Aire acondicionado {marca} {modelo} {capacidad} {funcion} {tecnologia}`.
- **Descripción ERP 50 patrón:** `A/A {MARCA} {MODELO} {CAPACIDAD} {FUNC_ABREV} {TEC_ABREV}`.
- **Ejemplo comercial final:** Aire acondicionado Alaska ALK3500 3500W frío/calor inverter.
- **Ejemplo ERP final:** `A/A ALASKA ALK3500 3500W F/C INV`. Largo: 32 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### ANAFE — COCINA

- **Conteo Planilla Madre:** 30.
- **Conteo Existencias:** 30.
- **Patrón actual detectado:** Arranque frecuente: ANAFE ELECTRICO (9), ANAFE A (8) | Datos que aparecen hoy: cm: 11/40; quemadores: 2/40; color: detectado.
- **Problema actual:** Hay descripciones largas con modelo pegado a guion. Separar modelo como campo propio..
- **Campos obligatorios app:** marca; modelo/SKU; tipo de energía; cantidad de hornallas/zonas; ancho cm; material/color.
- **Campos opcionales:** inducción/vitrocerámico; encendido; empotrable.
- **Subrubro debe salir de:** `{tipo_energia} {zonas} zonas {ancho_cm} cm`.
- **Descripción comercial patrón:** `Anafe {marca} {modelo} {tipo_energia} {zonas} zonas {ancho_cm} cm {material_color}`.
- **Descripción ERP 50 patrón:** `ANAFE {MARCA} {MODELO} {ENERGIA_ABREV} {ZONAS}Z {ANCHO}CM`.
- **Ejemplo comercial final:** Anafe Ariston NIS842FB inducción 4 zonas 80 cm.
- **Ejemplo ERP final:** `ANAFE ARISTON NIS842FB IND 4Z 80CM`. Largo: 34 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### COCINA — COCINA

- **Conteo Planilla Madre:** 47.
- **Conteo Existencias:** 52.
- **Patrón actual detectado:** Arranque frecuente: COCINA ESCORIAL (12), COCINA DREAN (10) | Datos que aparecen hoy: cm: 25/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Aparecen errores de escritura como ORNALLAS. Usar hornallas como campo numérico..
- **Campos obligatorios app:** marca; modelo/SKU; ancho cm; cantidad de hornallas; combustible; color/material.
- **Campos opcionales:** luz; grill; encendido; tapa; rejilla fundición.
- **Subrubro debe salir de:** `{ancho_cm} cm {combustible} {hornallas} hornallas`.
- **Descripción comercial patrón:** `Cocina {marca} {modelo} {ancho_cm} cm {combustible} {hornallas} hornallas {color}`.
- **Descripción ERP 50 patrón:** `COCINA {MARCA} {MODELO} {ANCHO}CM {HORNALLAS}H {COLOR_ABREV}`.
- **Ejemplo comercial final:** Cocina Escorial Candor 56 cm multigas 4 hornallas blanca.
- **Ejemplo ERP final:** `COCINA ESCORIAL CANDOR 56CM 4H BCA`. Largo: 34 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### FREEZER — LÍNEA BLANCA

- **Conteo Planilla Madre:** 26.
- **Conteo Existencias:** 26.
- **Patrón actual detectado:** Arranque frecuente: FREEZER NEBA (26), FREEZER MIDEA (4) | Datos que aparecen hoy: litros: 14/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Se detectó FREZEER mal escrito. Normalizar siempre FREEZER..
- **Campos obligatorios app:** marca; modelo/SKU; formato horizontal/vertical/cajón; capacidad litros; color/material.
- **Campos opcionales:** inverter; eficiencia; cantidad de cajones.
- **Subrubro debe salir de:** `{formato} {litros} L`.
- **Descripción comercial patrón:** `Freezer {marca} {modelo} {formato} {litros} litros {color}`.
- **Descripción ERP 50 patrón:** `FREEZER {MARCA} {MODELO} {FORMATO_ABREV} {LITROS}L {COLOR_ABREV}`.
- **Ejemplo comercial final:** Freezer Midea MDRC284FZE01 horizontal inverter 194 litros blanco.
- **Ejemplo ERP final:** `FREEZER MIDEA MDRC284FZE01 HORIZ 194L BCO`. Largo: 41 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### EXHIBIDORA — LÍNEA BLANCA

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: HELADERA EXHIBIDORA (1) | Datos que aparecen hoy: litros: 1/1.
- **Problema actual:** Hoy aparece mezclada como HELADERA EXHIBIDORA. En app debe ser rubro EXHIBIDORA..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; tipo exhibidora; puertas; color/material.
- **Campos opcionales:** iluminación; frío vertical.
- **Subrubro debe salir de:** `{litros} L {puertas} puertas`.
- **Descripción comercial patrón:** `Heladera exhibidora {marca} {modelo} {litros} litros {puertas} puertas {color}`.
- **Descripción ERP 50 patrón:** `EXHIBIDORA {MARCA} {MODELO} {LITROS}L {PUERTAS}P`.
- **Ejemplo comercial final:** Heladera exhibidora Neba 390 litros 1 puerta.
- **Ejemplo ERP final:** `EXHIBIDORA NEBA 390L 1P`. Largo: 23 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### HELADERA — LÍNEA BLANCA

- **Conteo Planilla Madre:** 257.
- **Conteo Existencias:** 256.
- **Patrón actual detectado:** Arranque frecuente: HELADERA BGH (14), HELADERA ARISTON (8) | Datos que aparecen hoy: litros: 19/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Muchas tienen color/modelo/capacidad, pero no siempre sistema. ERP limita y corta palabras..
- **Campos obligatorios app:** marca; modelo/SKU; sistema cíclica/no frost; capacidad litros; freezer sí/no; color/material.
- **Campos opcionales:** cantidad de puertas; dispenser; bottom/top mount; side by side.
- **Subrubro debe salir de:** `{sistema} {litros} L {puertas/freezer}`.
- **Descripción comercial patrón:** `Heladera {marca} {modelo} {sistema} {litros} litros {freezer} {color}`.
- **Descripción ERP 50 patrón:** `HEL {MARCA} {MODELO} {SIST_ABREV} {LITROS}L {COLOR_ABREV}`.
- **Ejemplo comercial final:** Heladera Samsung RB33A3070 no frost 328 litros satin.
- **Ejemplo ERP final:** `HEL SAMSUNG RB33A3070 NF 328L SATIN`. Largo: 35 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### HORNO — COCINA

- **Conteo Planilla Madre:** 53.
- **Conteo Existencias:** 52.
- **Patrón actual detectado:** Arranque frecuente: HORNO ELECTRICO (10), HORNO SAMSUNG (9) | Datos que aparecen hoy: cm: 6/40; litros: 17/40; watts: 2/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Hay mezcla de horno eléctrico, a gas y microondas. Microondas debe ir como rubro separado..
- **Campos obligatorios app:** marca; modelo/SKU; tipo energía; instalación empotrable/mesada; capacidad litros o ancho; color/material.
- **Campos opcionales:** grill; convector; eléctrico/gas; funciones.
- **Subrubro debe salir de:** `{tipo_energia} {instalacion} {litros_o_ancho}`.
- **Descripción comercial patrón:** `Horno {marca} {modelo} {tipo_energia} {instalacion} {litros_o_ancho} {color}`.
- **Descripción ERP 50 patrón:** `HORNO {MARCA} {MODELO} {ENERGIA_ABREV} {INST_ABREV} {MEDIDA}`.
- **Ejemplo comercial final:** Horno Ariston GA3124CIXA a gas empotrable acero.
- **Ejemplo ERP final:** `HORNO ARISTON GA3124CIXA GAS EMPOT AC`. Largo: 37 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### LAVARROPAS — LÍNEA BLANCA

- **Conteo Planilla Madre:** 160.
- **Conteo Existencias:** 161.
- **Patrón actual detectado:** Arranque frecuente: LAVARROPAS CANDY (25), LAVARROPAS BGH (10) | Datos que aparecen hoy: kg: 37/40; rpm: 23/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Hay casos truncados por ERP. Carga, kg y rpm deben ser campos obligatorios..
- **Campos obligatorios app:** marca; modelo/SKU; carga kg; tipo de carga; rpm; color; tecnología inverter sí/no.
- **Campos opcionales:** lavado rápido; eco; smart.
- **Subrubro debe salir de:** `{kg} kg {tipo_carga} {rpm} rpm`.
- **Descripción comercial patrón:** `Lavarropas {marca} {modelo} {kg} kg {tipo_carga} {rpm} rpm {tecnologia} {color}`.
- **Descripción ERP 50 patrón:** `LAV {MARCA} {MODELO} {KG}KG {CARGA_ABREV} {RPM}RPM`.
- **Ejemplo comercial final:** Lavarropas BGH BWFI06S24AR 6 kg carga frontal 1000 rpm inverter blanco.
- **Ejemplo ERP final:** `LAV BGH BWFI06S24AR 6KG FRONT 1000RPM INV`. Largo: 41 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### LAVASECARROPAS — LÍNEA BLANCA

- **Conteo Planilla Madre:** 35.
- **Conteo Existencias:** 34.
- **Patrón actual detectado:** Arranque frecuente: LAVASECARROPAS SAMSUNG (9), LAVASECARROPAS CANDY (8) | Datos que aparecen hoy: kg: 32/40; rpm: 9/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** La relación 10+6 debe quedar como dato estructurado, no escondida en texto..
- **Campos obligatorios app:** marca; modelo/SKU; kg lavado; kg secado; rpm; color; tecnología.
- **Campos opcionales:** inverter; carga frontal.
- **Subrubro debe salir de:** `{kg_lavado}+{kg_secado} kg {rpm} rpm`.
- **Descripción comercial patrón:** `Lavasecarropas {marca} {modelo} {kg_lavado}+{kg_secado} kg {rpm} rpm {tecnologia} {color}`.
- **Descripción ERP 50 patrón:** `LAVASEC {MARCA} {MODELO} {KG_LAV}+{KG_SEC}KG {RPM}RPM`.
- **Ejemplo comercial final:** Lavasecarropas Candy ROW41066DWHCR 10+6 kg 1400 rpm inverter gris.
- **Ejemplo ERP final:** `LAVASEC CANDY ROW41066DWHCR 10+6KG 1400RPM`. Largo: 42 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### LAVAVAJILLAS — LÍNEA BLANCA

- **Conteo Planilla Madre:** 14.
- **Conteo Existencias:** 14.
- **Patrón actual detectado:** Arranque frecuente: LAVAVAJILLAS WHIRLPOOL (14), LAVAVAJILLAS CANDY (4) | Datos que aparecen hoy: cubiertos: 12/28; color: detectado; tecnología/función: detectado.
- **Problema actual:** Cubiertos/sets puede venir como SETS; normalizar a cubiertos..
- **Campos obligatorios app:** marca; modelo/SKU; cubiertos/sets; color/material; instalación si aplica.
- **Campos opcionales:** inverter; eficiencia; programas.
- **Subrubro debe salir de:** `{cubiertos} cubiertos`.
- **Descripción comercial patrón:** `Lavavajillas {marca} {modelo} {cubiertos} cubiertos {color}`.
- **Descripción ERP 50 patrón:** `LAVAVAJ {MARCA} {MODELO} {CUBIERTOS}CUB {COLOR_ABREV}`.
- **Ejemplo comercial final:** Lavavajillas Drean 14 cubiertos inox.
- **Ejemplo ERP final:** `LAVAVAJ DREAN 14CUB INOX`. Largo: 24 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### SECARROPAS — LÍNEA BLANCA

- **Conteo Planilla Madre:** 17.
- **Conteo Existencias:** 18.
- **Patrón actual detectado:** Arranque frecuente: SECARROPAS SMART (10), SECARROPAS SAMSUNG (8) | Datos que aparecen hoy: kg: 24/35; color: detectado; tecnología/función: detectado.
- **Problema actual:** Distinguir calor/condensación/bomba para subrubro..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad kg; sistema calor/condensación/bomba; color.
- **Campos opcionales:** inverter; sensor humedad.
- **Subrubro debe salir de:** `{kg} kg {sistema}`.
- **Descripción comercial patrón:** `Secarropas {marca} {modelo} {kg} kg {sistema} {color}`.
- **Descripción ERP 50 patrón:** `SECARROPAS {MARCA} {MODELO} {KG}KG {SIST_ABREV}`.
- **Ejemplo comercial final:** Secarropas Candy 9 kg condensación blanco.
- **Ejemplo ERP final:** `SECARROPAS CANDY 9KG COND BCO`. Largo: 29 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### TERMOTANQUE — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 22.
- **Conteo Existencias:** 22.
- **Patrón actual detectado:** Arranque frecuente: TERMO ESCORIAL (10), TERMOTANQUE UNIVERSAL (8) | Datos que aparecen hoy: litros: 36/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Hoy se usa TERMO/TERMOTANQUE mezclado. Comercial largo, ERP TERMO..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; energía gas/eléctrico; conexión GN/GL si aplica.
- **Campos opcionales:** alta recuperación; color.
- **Subrubro debe salir de:** `{litros} L {energia} {conexion}`.
- **Descripción comercial patrón:** `Termotanque {marca} {modelo} {litros} litros {energia} {conexion}`.
- **Descripción ERP 50 patrón:** `TERMO {MARCA} {MODELO} {LITROS}L {ENERGIA_ABREV} {CONEXION}`.
- **Ejemplo comercial final:** Termotanque Escorial 80 litros gas natural.
- **Ejemplo ERP final:** `TERMO ESCORIAL 80L GAS GN`. Largo: 25 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### TORRE DE LAVADO — LÍNEA BLANCA

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 2.
- **Patrón actual detectado:** Arranque frecuente: TORRE DE (4) | Datos que aparecen hoy: kg: 2/4; color: detectado; tecnología/función: detectado.
- **Problema actual:** No mezclar con lavarropas ni secarropas individuales..
- **Campos obligatorios app:** marca; modelo/SKU; kg lavado; kg secado; tecnología; color.
- **Campos opcionales:** inverter; smart.
- **Subrubro debe salir de:** `{kg_lavado}/{kg_secado} kg`.
- **Descripción comercial patrón:** `Torre de lavado {marca} {modelo} {kg_lavado}/{kg_secado} kg {tecnologia} {color}`.
- **Descripción ERP 50 patrón:** `TORRE LAV {MARCA} {MODELO} {KG_LAV}/{KG_SEC}KG {COLOR_ABREV}`.
- **Ejemplo comercial final:** Torre de lavado LG WK14BS6 14/10 kg inverter black.
- **Ejemplo ERP final:** `TORRE LAV LG WK14BS6 14/10KG INV BLACK`. Largo: 38 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### TV — TV / AUDIO

- **Conteo Planilla Madre:** 73.
- **Conteo Existencias:** 72.
- **Patrón actual detectado:** Arranque frecuente: TV ENOVA (13), TV BGH (10) | Datos que aparecen hoy: tecnología/función: detectado.
- **Problema actual:** Hoy algunas tienen LED/SMART/ANDROID/GOOGLE mezclado. Siempre pedir pulgadas y sistema..
- **Campos obligatorios app:** marca; modelo/SKU; pulgadas; resolución; smart/sistema operativo; tecnología pantalla.
- **Campos opcionales:** QLED/OLED; frecuencia; color.
- **Subrubro debe salir de:** `{pulgadas}" {resolucion} {sistema_operativo}`.
- **Descripción comercial patrón:** `Smart TV {marca} {modelo} {pulgadas}" {resolucion} {sistema_operativo}`.
- **Descripción ERP 50 patrón:** `TV {MARCA} {MODELO} {PULG}" {RESOLUCION} {SO_ABREV}`.
- **Ejemplo comercial final:** Smart TV BGH B5024US6G 50" 4K Google TV.
- **Ejemplo ERP final:** `TV BGH B5024US6G 50" 4K GTV`. Largo: 27 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### ASPIRADORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 24.
- **Conteo Existencias:** 24.
- **Patrón actual detectado:** Arranque frecuente: ASPIRADORA SAMSUNG (26), ASPIRADORA PHILIPS (6) | Datos que aparecen hoy: watts: 11/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Aspiradora vertical, sin bolsa y trapeadora no son equivalentes. Poner tipo..
- **Campos obligatorios app:** marca; modelo/SKU; tipo vertical/robot/trineo; potencia W; bolsa/sin bolsa; color.
- **Campos opcionales:** trapeadora; inalámbrica; autonomía.
- **Subrubro debe salir de:** `{tipo} {potencia}W`.
- **Descripción comercial patrón:** `Aspiradora {marca} {modelo} {tipo} {potencia}W {caracteristica} {color}`.
- **Descripción ERP 50 patrón:** `ASP {MARCA} {MODELO} {TIPO_ABREV} {POTENCIA}W {COLOR_ABREV}`.
- **Ejemplo comercial final:** Aspiradora Philips XB2023/51 sin bolsa 1800W.
- **Ejemplo ERP final:** `ASP PHILIPS XB2023/51 S/BOLSA 1800W`. Largo: 35 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### CAMPANA — COCINA

- **Conteo Planilla Madre:** 20.
- **Conteo Existencias:** 20.
- **Patrón actual detectado:** Arranque frecuente: CAMPANA WHIRLPOOL (16), CAMPANA SAMSUNG (8) | Datos que aparecen hoy: cm: 24/40; color: detectado.
- **Problema actual:** Campana y purificador aparecen juntos en ERP extracción aire; separar rubro..
- **Campos obligatorios app:** marca; modelo/SKU; ancho cm; tipo campana/purificador; material/color.
- **Campos opcionales:** cantidad motores; extracción; luces.
- **Subrubro debe salir de:** `{ancho_cm} cm {tipo}`.
- **Descripción comercial patrón:** `Campana {marca} {modelo} {ancho_cm} cm {material_color}`.
- **Descripción ERP 50 patrón:** `CAMPANA {MARCA} {MODELO} {ANCHO}CM {COLOR_ABREV}`.
- **Ejemplo comercial final:** Campana Samsung NK36M5070BS 90 cm acero.
- **Ejemplo ERP final:** `CAMPANA SAMSUNG NK36M5070BS 90CM AC`. Largo: 35 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### CALEFON — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 2.
- **Patrón actual detectado:** Arranque frecuente: CALEFON ESCORIAL (4) | Datos que aparecen hoy: litros: 4/4; color: detectado.
- **Problema actual:** Diferenciar GN/GL desde el formulario..
- **Campos obligatorios app:** marca; modelo/SKU; litros/minuto; tipo gas; color.
- **Campos opcionales:** tiro natural/balanceado; encendido.
- **Subrubro debe salir de:** `{litros} L {gas}`.
- **Descripción comercial patrón:** `Calefón {marca} {modelo} {litros} litros {gas} {color}`.
- **Descripción ERP 50 patrón:** `CALEFON {MARCA} {MODELO} {LITROS}L {GAS} {COLOR_ABREV}`.
- **Ejemplo comercial final:** Calefón Escorial 14 litros gas natural blanco.
- **Ejemplo ERP final:** `CALEFON ESCORIAL 14L GN BCO`. Largo: 27 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### CERVECERA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 1.
- **Patrón actual detectado:** Arranque frecuente: CERVECERA WHIRLPOOL (2) | Datos que aparecen hoy: litros: 2/2; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; color/material.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Cervecera {marca} {modelo} {litros} litros {color}`.
- **Descripción ERP 50 patrón:** `CERVECERA {MARCA} {MODELO} {LITROS}L`.
- **Ejemplo comercial final:** Cervecera Smart Life SL-XXXX 1,7 litros negro.
- **Ejemplo ERP final:** `CERVECERA SMARTLIFE SL-XXXX 1.7L`. Largo: 32 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### CALOVENTOR — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 3.
- **Conteo Existencias:** 2.
- **Patrón actual detectado:** Arranque frecuente: CALOVENTOR SMARTLIFE (5) | Datos que aparecen hoy: watts: 5/5; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; formato; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Caloventor {marca} {modelo} {potencia}W {formato} {color}`.
- **Descripción ERP 50 patrón:** `CALOV {MARCA} {MODELO} {POTENCIA}W {FORMATO_ABREV}`.
- **Ejemplo comercial final:** Caloventor Smart Life SL-XXXX 1000W vertical negro.
- **Ejemplo ERP final:** `CALOV SMARTLIFE SL-XXXX 1000W VERT`. Largo: 34 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### CONVECTOR — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 8.
- **Conteo Existencias:** 5.
- **Patrón actual detectado:** Arranque frecuente: CONVECTOR SMARTLIFE (8), CONVECTOR SMART (3) | Datos que aparecen hoy: watts: 11/13; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; tipo vidrio/aire; timer; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Convector {marca} {modelo} {potencia}W {tipo} {color}`.
- **Descripción ERP 50 patrón:** `CONV {MARCA} {MODELO} {POTENCIA}W {TIPO_ABREV}`.
- **Ejemplo comercial final:** Convector Smart Life SL-XXXX 1000W  negro.
- **Ejemplo ERP final:** `CONV SMARTLIFE SL-XXXX 1000W`. Largo: 29 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### MICROONDAS — COCINA

- **Conteo Planilla Madre:** 58.
- **Conteo Existencias:** 58.
- **Patrón actual detectado:** Arranque frecuente: MICROONDAS BGH (10), MICROONDAS DREAN (10) | Datos que aparecen hoy: litros: 20/40; watts: 6/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Hay errores como 2O en vez de 20. Litros debe ser numérico..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; tipo digital/perilla; grill sí/no; color/material.
- **Campos opcionales:** empotrable; potencia.
- **Subrubro debe salir de:** `{litros} L {grill/control}`.
- **Descripción comercial patrón:** `Microondas {marca} {modelo} {litros} litros {tipo_control} {grill} {color}`.
- **Descripción ERP 50 patrón:** `MICRO {MARCA} {MODELO} {LITROS}L {GRILL_ABREV} {COLOR_ABREV}`.
- **Ejemplo comercial final:** Microondas BGH 28 litros digital con grill.
- **Ejemplo ERP final:** `MICRO BGH 28L DIG C/GRILL`. Largo: 25 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### MINICOMPONENTE — TV / AUDIO

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 2.
- **Patrón actual detectado:** Arranque frecuente: MINICOMPONENTE SMART (4) | Datos que aparecen hoy: tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; conectividad; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Minicomponente {marca} {modelo} {potencia}W Bluetooth`.
- **Descripción ERP 50 patrón:** `MINICOMP {MARCA} {MODELO} {POTENCIA}W BT`.
- **Ejemplo comercial final:** Minicomponente Smart Life SL-XXXX 1000W Bluetooth.
- **Ejemplo ERP final:** `MINICOMP SMARTLIFE SL-XXXX 1000W BT`. Largo: 35 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### MONITOR — TV / AUDIO

- **Conteo Planilla Madre:** 5.
- **Conteo Existencias:** 5.
- **Patrón actual detectado:** Arranque frecuente: MONITOR SAMSUNG (10).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; pulgadas; resolución; frecuencia Hz; modelo.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Monitor {marca} {modelo} {pulgadas}" {resolucion} {hz}Hz`.
- **Descripción ERP 50 patrón:** `MONITOR {MARCA} {MODELO} {PULG}" {HZ}HZ`.
- **Ejemplo comercial final:** Monitor Smart Life SL-XXXX 32" FHD 75Hz.
- **Ejemplo ERP final:** `MONITOR SMARTLIFE SL-XXXX 32" 75HZ`. Largo: 34 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### PANEL — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 3.
- **Conteo Existencias:** 3.
- **Patrón actual detectado:** Arranque frecuente: PANEL SMART (6) | Datos que aparecen hoy: watts: 6/6; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; vidrio/material; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Panel calefactor {marca} {modelo} {potencia}W {material_color}`.
- **Descripción ERP 50 patrón:** `PANEL {MARCA} {MODELO} {POTENCIA}W {COLOR_ABREV}`.
- **Ejemplo comercial final:** Panel calefactor Smart Life SL-XXXX 1000W {material_color}.
- **Ejemplo ERP final:** `PANEL SMARTLIFE SL-XXXX 1000W NGO`. Largo: 33 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### PARLANTE — TV / AUDIO

- **Conteo Planilla Madre:** 9.
- **Conteo Existencias:** 10.
- **Patrón actual detectado:** Arranque frecuente: PARLANTE SMART (14), PARLANTE SMARTLIFE (4) | Datos que aparecen hoy: tecnología/función: detectado.
- **Problema actual:** Party box, torre, portátil y barra no deben quedar todos como audio genérico..
- **Campos obligatorios app:** marca; modelo/SKU; tipo; potencia W; conectividad bluetooth; color.
- **Campos opcionales:** party box; karaoke; luces.
- **Subrubro debe salir de:** `{tipo} {potencia}W BT`.
- **Descripción comercial patrón:** `Parlante {marca} {modelo} {tipo} {potencia}W Bluetooth {color}`.
- **Descripción ERP 50 patrón:** `PARL {MARCA} {MODELO} {TIPO_ABREV} {POTENCIA}W BT`.
- **Ejemplo comercial final:** Parlante Smart Life SL-PB112030 Party Box 30W Bluetooth.
- **Ejemplo ERP final:** `PARL SMARTLIFE SL-PB112030 PARTY 30W BT`. Largo: 39 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### PURIFICADOR — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 7.
- **Conteo Existencias:** 7.
- **Patrón actual detectado:** Arranque frecuente: PURIFICADOR DE (6), PURIFICADOR WHIRLPOOL (6) | Datos que aparecen hoy: cm: 8/14; watts: 6/14; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; ancho cm o potencia; tipo aire/cocina; color/material.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Purificador {marca} {modelo} {ancho_o_potencia} {color}`.
- **Descripción ERP 50 patrón:** `PURIF {MARCA} {MODELO} {DATO_CLAVE} {COLOR_ABREV}`.
- **Ejemplo comercial final:** Purificador Smart Life SL-XXXX 60 cm negro.
- **Ejemplo ERP final:** `PURIF SMARTLIFE SL-XXXX 20BAR NGO`. Largo: 33 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### VENTILADOR — CLIMATIZACIÓN

- **Conteo Planilla Madre:** 6.
- **Conteo Existencias:** 6.
- **Patrón actual detectado:** Arranque frecuente: VENTILADOR MIDEA (4), VENTILADOR VITTA (4) | Datos que aparecen hoy: color: detectado.
- **Problema actual:** El tipo de ventilador debe ser campo obligatorio..
- **Campos obligatorios app:** marca; modelo/SKU; tipo de pie/techo/industrial; pulgadas; color.
- **Campos opcionales:** potencia; cantidad aspas; control remoto.
- **Subrubro debe salir de:** `{tipo} {pulgadas}"`.
- **Descripción comercial patrón:** `Ventilador {marca} {modelo} {tipo} {pulgadas}" {color}`.
- **Descripción ERP 50 patrón:** `VENT {MARCA} {MODELO} {TIPO_ABREV} {PULG}" {COLOR_ABREV}`.
- **Ejemplo comercial final:** Ventilador Midea SF-20B1AE1 de pie 20" negro.
- **Ejemplo ERP final:** `VENT MIDEA SF-20B1AE1 PIE 20" NGO`. Largo: 33 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### ARROCERA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 1.
- **Patrón actual detectado:** Arranque frecuente: ARROCERA OSTER (2).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad; potencia; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Arrocera {marca} {modelo} {capacidad} {color}`.
- **Descripción ERP 50 patrón:** `ARROCERA {MARCA} {MODELO} {CAPACIDAD}`.
- **Ejemplo comercial final:** Arrocera Smart Life SL-XXXX {capacidad} negro.
- **Ejemplo ERP final:** `ARROCERA SMARTLIFE SL-XXXX {CAPACIDAD}`. Largo: 38 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### BATIDORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 25.
- **Conteo Existencias:** 25.
- **Patrón actual detectado:** Arranque frecuente: BATIDORA OSTER (15), BATIDORA DE (8) | Datos que aparecen hoy: litros: 2/40; watts: 14/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo mano/mesa/planetaria; potencia; capacidad; velocidades; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Batidora {marca} {modelo} {tipo} {potencia}W {capacidad}L {color}`.
- **Descripción ERP 50 patrón:** `BAT {MARCA} {MODELO} {TIPO_ABREV} {POTENCIA}W`.
- **Ejemplo comercial final:** Batidora Smart Life SL-XXXX  1000W {capacidad}L negro.
- **Ejemplo ERP final:** `BAT SMARTLIFE SL-XXXX  1000W`. Largo: 28 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### CAFETERA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 56.
- **Conteo Existencias:** 54.
- **Patrón actual detectado:** Arranque frecuente: CAFETERA OSTER (28), CAFETERA LUSQTOFF (4) | Datos que aparecen hoy: litros: 2/40; bar: 4/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo cafetera; presión/bar o capacidad; potencia; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Cafetera {marca} {modelo} {tipo} {capacidad_o_bar} {color}`.
- **Descripción ERP 50 patrón:** `CAFETERA {MARCA} {MODELO} {TIPO_ABREV} {DATO_CLAVE}`.
- **Ejemplo comercial final:** Cafetera Smart Life SL-XXXX  20 bar negro.
- **Ejemplo ERP final:** `CAFETERA SMARTLIFE SL-XXXX  20BAR`. Largo: 33 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### CHOPPER — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: MINI CHOPPER (1).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; capacidad; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Mini chopper {marca} {modelo} {potencia}W {capacidad}L {color}`.
- **Descripción ERP 50 patrón:** `CHOPPER {MARCA} {MODELO} {POTENCIA}W`.
- **Ejemplo comercial final:** Mini chopper Smart Life SL-XXXX 1000W {capacidad}L negro.
- **Ejemplo ERP final:** `CHOPPER SMARTLIFE SL-XXXX 1000W`. Largo: 31 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### ESPUMADOR — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 1.
- **Patrón actual detectado:** Arranque frecuente: ESPUMADOR DE (2) | Datos que aparecen hoy: tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad ml; potencia; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Espumador de leche {marca} {modelo} {capacidad_ml} ml {color}`.
- **Descripción ERP 50 patrón:** `ESPUMADOR {MARCA} {MODELO} {CAPACIDAD}ML`.
- **Ejemplo comercial final:** Espumador de leche Smart Life SL-XXXX {capacidad_ml} ml negro.
- **Ejemplo ERP final:** `ESPUMADOR SMARTLIFE SL-XXXX {CAPACIDAD}ML`. Largo: 41 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### EXPRIMIDOR — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 4.
- **Conteo Existencias:** 5.
- **Patrón actual detectado:** Arranque frecuente: EXPRIMIDOR ELÉCTRICO (2), EXPRIMIDOR OSTER (2) | Datos que aparecen hoy: litros: 1/9; watts: 1/9; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad; potencia; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Exprimidor {marca} {modelo} {capacidad} {potencia}W {color}`.
- **Descripción ERP 50 patrón:** `EXPRIM {MARCA} {MODELO} {CAPACIDAD} {POTENCIA}W`.
- **Ejemplo comercial final:** Exprimidor Smart Life SL-XXXX {capacidad} 1000W negro.
- **Ejemplo ERP final:** `EXPRIM SMARTLIFE SL-XXXX {CAPACIDAD} 1000W`. Largo: 42 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### EXTRACTOR — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: EXTRACTOR PHILIPS (1) | Datos que aparecen hoy: litros: 1/1; watts: 1/1.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; capacidad; jarra; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Extractor {marca} {modelo} {potencia}W {capacidad}L {color}`.
- **Descripción ERP 50 patrón:** `EXTRACTOR {MARCA} {MODELO} {POTENCIA}W`.
- **Ejemplo comercial final:** Extractor Smart Life SL-XXXX 1000W {capacidad}L negro.
- **Ejemplo ERP final:** `EXTRACTOR SMARTLIFE SL-XXXX 1000W`. Largo: 33 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### FREIDORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 37.
- **Conteo Existencias:** 37.
- **Patrón actual detectado:** Arranque frecuente: FREIDORA PHILIPS (15), FREIDORA DE (14) | Datos que aparecen hoy: litros: 26/40; watts: 12/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo aire/aceite; litros; potencia; digital/manual; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Freidora {marca} {modelo} {tipo} {litros} litros {potencia}W {control}`.
- **Descripción ERP 50 patrón:** `FREIDORA {MARCA} {MODELO} {TIPO_ABREV} {LITROS}L {POTENCIA}W`.
- **Ejemplo comercial final:** Freidora Smart Life SL-XXXX  1,7 litros 1000W digital.
- **Ejemplo ERP final:** `FREIDORA SMARTLIFE SL-XXXX  1.7L 1000W`. Largo: 38 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### JARRA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 9.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: JARRA SMART (4), JARRA ELECTRICA (3) | Datos que aparecen hoy: litros: 1/9; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; material; control temperatura; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Jarra eléctrica {marca} {modelo} {litros} litros {material_color}`.
- **Descripción ERP 50 patrón:** `JARRA {MARCA} {MODELO} {LITROS}L {COLOR_ABREV}`.
- **Ejemplo comercial final:** Jarra eléctrica Smart Life SL-XXXX 1,7 litros {material_color}.
- **Ejemplo ERP final:** `JARRA SMARTLIFE SL-XXXX 1.7L NGO`. Largo: 32 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### LICUADORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 40.
- **Conteo Existencias:** 39.
- **Patrón actual detectado:** Arranque frecuente: LICUADORA OSTER (13), LICUADORA DE (6) | Datos que aparecen hoy: litros: 3/40; watts: 17/40; color: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo vaso/mano; potencia; capacidad; material vaso; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Licuadora {marca} {modelo} {potencia}W {capacidad}L {material_color}`.
- **Descripción ERP 50 patrón:** `LIC {MARCA} {MODELO} {POTENCIA}W {CAPACIDAD}L`.
- **Ejemplo comercial final:** Licuadora Smart Life SL-XXXX 1000W {capacidad}L {material_color}.
- **Ejemplo ERP final:** `LIC SMARTLIFE SL-XXXX 1000W {CAPACIDAD}L`. Largo: 40 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### LIMPIADOR ZAP — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 1.
- **Patrón actual detectado:** Arranque frecuente: LIMPIADOR DE (2).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo; modelo; potencia si aplica.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Limpiador de zapatillas {marca} {modelo} {tipo}`.
- **Descripción ERP 50 patrón:** `LIMP ZAP {MARCA} {MODELO}`.
- **Ejemplo comercial final:** Limpiador de zapatillas Smart Life SL-XXXX.
- **Ejemplo ERP final:** `LIMP ZAP SMARTLIFE SL-XXXX`. Largo: 26 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### MIXER — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: MIXER MIDEA (1) | Datos que aparecen hoy: watts: 1/1; color: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; accesorios; material; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Mixer {marca} {modelo} {potencia}W {accesorios}`.
- **Descripción ERP 50 patrón:** `MIXER {MARCA} {MODELO} {POTENCIA}W`.
- **Ejemplo comercial final:** Mixer Smart Life SL-XXXX 1000W {accesorios}.
- **Ejemplo ERP final:** `MIXER SMARTLIFE SL-XXXX 1000W`. Largo: 29 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### MOLINO — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 3.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: MOLINO OSTER (2), MOLINO PHILIPS (1).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo café/semillas; potencia; capacidad.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Molino {marca} {modelo} {tipo} {capacidad}`.
- **Descripción ERP 50 patrón:** `MOLINO {MARCA} {MODELO} {TIPO_ABREV}`.
- **Ejemplo comercial final:** Molino Smart Life SL-XXXX  {capacidad}.
- **Ejemplo ERP final:** `MOLINO SMARTLIFE SL-XXXX`. Largo: 25 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### MOLINILLO — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 1.
- **Patrón actual detectado:** Arranque frecuente: MOLINILLO DE (2).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo semillas/café; potencia; capacidad.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Molinillo {marca} {modelo} {tipo} {capacidad}`.
- **Descripción ERP 50 patrón:** `MOLINILLO {MARCA} {MODELO} {TIPO_ABREV}`.
- **Ejemplo comercial final:** Molinillo Smart Life SL-XXXX  {capacidad}.
- **Ejemplo ERP final:** `MOLINILLO SMARTLIFE SL-XXXX`. Largo: 28 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### MULTIOLLA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 1.
- **Patrón actual detectado:** Arranque frecuente: MULTIOLLA OVALADA (2).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; potencia; funciones; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Multiolla {marca} {modelo} {litros} litros {funciones}`.
- **Descripción ERP 50 patrón:** `MULTIOLLA {MARCA} {MODELO} {LITROS}L`.
- **Ejemplo comercial final:** Multiolla Smart Life SL-XXXX 1,7 litros {funciones}.
- **Ejemplo ERP final:** `MULTIOLLA SMARTLIFE SL-XXXX 1.7L`. Largo: 32 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### MULTIPROCESADORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: MULTIPROCESADORA SMART (1) | Datos que aparecen hoy: watts: 1/1; tecnología/función: detectado.
- **Problema actual:** Sin muestras suficientes. Definir plantilla final al revisar primeros productos..
- **Campos obligatorios app:** marca; modelo/SKU; dato técnico principal; color/material si aplica.
- **Campos opcionales:** potencia; capacidad; medida; tecnología; condición.
- **Subrubro debe salir de:** `{dato_clave_principal}`.
- **Descripción comercial patrón:** `Multirocesadora {marca} {modelo} {dato_clave} {detalle}`.
- **Descripción ERP 50 patrón:** `MULTIROCESAD {MARCA} {MODELO} {DATO_CLAVE}`.
- **Ejemplo comercial final:** Multirocesadora Marca Modelo dato clave.
- **Ejemplo ERP final:** `MULTIROCESAD MARCA MODELO DATO`. Largo: 30 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### PAVA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 23.
- **Conteo Existencias:** 32.
- **Patrón actual detectado:** Arranque frecuente: PAVA ELECTRICA (20), PAVA LUSQTOFF (4) | Datos que aparecen hoy: litros: 17/40; watts: 2/40; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad litros; material; corte mate/café; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Pava eléctrica {marca} {modelo} {litros} litros {material_color}`.
- **Descripción ERP 50 patrón:** `PAVA {MARCA} {MODELO} {LITROS}L {COLOR_ABREV}`.
- **Ejemplo comercial final:** Pava eléctrica Smart Life SL-XXXX 1,7 litros {material_color}.
- **Ejemplo ERP final:** `PAVA SMARTLIFE SL-XXXX 1.7L NGO`. Largo: 31 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** ALTA.

### PICADORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 2.
- **Patrón actual detectado:** Arranque frecuente: FOOD CHOPPER (2), PICADORA DE (2) | Datos que aparecen hoy: watts: 2/4.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; capacidad; cuchillas; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Picadora {marca} {modelo} {potencia}W {capacidad}L {color}`.
- **Descripción ERP 50 patrón:** `PICAD {MARCA} {MODELO} {POTENCIA}W {CAPACIDAD}L`.
- **Ejemplo comercial final:** Picadora Smart Life SL-XXXX 1000W {capacidad}L negro.
- **Ejemplo ERP final:** `PICAD SMARTLIFE SL-XXXX 1000W {CAPACIDAD}L`. Largo: 42 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### PLANCHA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 11.
- **Conteo Existencias:** 11.
- **Patrón actual detectado:** Arranque frecuente: PLANCHA PHILIPS (10), PLANCHA OSTER (4) | Datos que aparecen hoy: litros: 2/22; watts: 6/22; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo vapor/seca; potencia; modelo; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Plancha {marca} {modelo} {tipo} {potencia}W {color}`.
- **Descripción ERP 50 patrón:** `PLANCHA {MARCA} {MODELO} {TIPO_ABREV} {POTENCIA}W`.
- **Ejemplo comercial final:** Plancha Smart Life SL-XXXX  1000W negro.
- **Ejemplo ERP final:** `PLANCHA SMARTLIFE SL-XXXX  1000W`. Largo: 32 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### PROCESADORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 7.
- **Conteo Existencias:** 8.
- **Patrón actual detectado:** Arranque frecuente: PROCESADORA PHILIPS (6), PROCESADORA KITCHENAID (4) | Datos que aparecen hoy: litros: 3/15; watts: 10/15; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; potencia; capacidad bowl; funciones; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Procesadora {marca} {modelo} {potencia}W {capacidad}L {color}`.
- **Descripción ERP 50 patrón:** `PROC {MARCA} {MODELO} {POTENCIA}W {CAPACIDAD}L`.
- **Ejemplo comercial final:** Procesadora Smart Life SL-XXXX 1000W {capacidad}L negro.
- **Ejemplo ERP final:** `PROC SMARTLIFE SL-XXXX 1000W {CAPACIDAD}L`. Largo: 41 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### QUITAPELUSAS — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 2.
- **Patrón actual detectado:** Arranque frecuente: QUITAPELUSAS PHILIPS (2), QUITAPELUSAS ELECTRICOS (2).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo eléctrico; modelo; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Quitapelusas {marca} {modelo} eléctrico {color}`.
- **Descripción ERP 50 patrón:** `QUITAPEL {MARCA} {MODELO} ELEC`.
- **Ejemplo comercial final:** Quitapelusas Smart Life SL-XXXX eléctrico negro.
- **Ejemplo ERP final:** `QUITAPEL SMARTLIFE SL-XXXX ELEC`. Largo: 31 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### SANDWICHERA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 6.
- **Conteo Existencias:** 5.
- **Patrón actual detectado:** Arranque frecuente: SANDWICHERA SMART (3), SANDWICHERA ENOVA (2) | Datos que aparecen hoy: watts: 2/11; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; placas; posiciones; potencia; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Sandwichera {marca} {modelo} {placas_o_posiciones} {potencia}W {color}`.
- **Descripción ERP 50 patrón:** `SAND {MARCA} {MODELO} {DATO_CLAVE} {POTENCIA}W`.
- **Ejemplo comercial final:** Sandwichera Smart Life SL-XXXX {placas_o_posiciones} 1000W negro.
- **Ejemplo ERP final:** `SAND SMARTLIFE SL-XXXX 20BAR 1000W`. Largo: 34 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### SOPERA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: SOPERA SMART (2) | Datos que aparecen hoy: tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad; potencia; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Sopera eléctrica {marca} {modelo} {capacidad} {color}`.
- **Descripción ERP 50 patrón:** `SOPERA {MARCA} {MODELO} {CAPACIDAD}`.
- **Ejemplo comercial final:** Sopera eléctrica Smart Life SL-XXXX {capacidad} negro.
- **Ejemplo ERP final:** `SOPERA SMARTLIFE SL-XXXX {CAPACIDAD}`. Largo: 36 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### TOSTADORA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 13.
- **Conteo Existencias:** 13.
- **Patrón actual detectado:** Arranque frecuente: TOSTADORA SMART (7), TOSTADORA ENOVA (4) | Datos que aparecen hoy: watts: 4/26; color: detectado; tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; cantidad ranuras/rebanadas; potencia; color/material.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Tostadora {marca} {modelo} {ranuras} ranuras {potencia}W {color}`.
- **Descripción ERP 50 patrón:** `TOST {MARCA} {MODELO} {RANURAS}R {POTENCIA}W`.
- **Ejemplo comercial final:** Tostadora Smart Life SL-XXXX {ranuras} ranuras 1000W negro.
- **Ejemplo ERP final:** `TOST SMARTLIFE SL-XXXX {RANURAS}R 1000W`. Largo: 39 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** MEDIA.

### VAPORIZADOR — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 3.
- **Conteo Existencias:** 3.
- **Patrón actual detectado:** Arranque frecuente: VAPORIZADOR PHILIPS (6) | Datos que aparecen hoy: watts: 1/6.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; tipo portátil/vertical; potencia; capacidad tanque.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Vaporizador {marca} {modelo} {tipo} {potencia}W`.
- **Descripción ERP 50 patrón:** `VAPOR {MARCA} {MODELO} {TIPO_ABREV} {POTENCIA}W`.
- **Ejemplo comercial final:** Vaporizador Smart Life SL-XXXX  1000W.
- **Ejemplo ERP final:** `VAPOR SMARTLIFE SL-XXXX  1000W`. Largo: 30 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### YOGURTERA — PEQUEÑOS ELECTROS

- **Conteo Planilla Madre:** 2.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: YOGURTERA SMART (2) | Datos que aparecen hoy: tecnología/función: detectado.
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; capacidad; cantidad frascos; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Yogurtera {marca} {modelo} {capacidad}`.
- **Descripción ERP 50 patrón:** `YOGURTERA {MARCA} {MODELO} {CAPACIDAD}`.
- **Ejemplo comercial final:** Yogurtera Smart Life SL-XXXX {capacidad}.
- **Ejemplo ERP final:** `YOGURTERA SMARTLIFE SL-XXXX {CAPACIDAD}`. Largo: 39 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

### BARRA DE SONIDO — TV / AUDIO

- **Conteo Planilla Madre:** 1.
- **Conteo Existencias:** 0.
- **Patrón actual detectado:** Arranque frecuente: BARRA DE (1).
- **Problema actual:** Rubro de baja/media cantidad. Usar campos guiados para evitar texto libre y completar dato clave..
- **Campos obligatorios app:** marca; modelo/SKU; canales; potencia; conectividad; color.
- **Campos opcionales:** color/material; condición; detalle comercial relevante.
- **Subrubro debe salir de:** `{dato_clave_principal} {detalle_tecnico}`.
- **Descripción comercial patrón:** `Barra de sonido {marca} {modelo} {canales} {potencia}W Bluetooth`.
- **Descripción ERP 50 patrón:** `SOUNDBAR {MARCA} {MODELO} {CANALES} {POTENCIA}W`.
- **Ejemplo comercial final:** Barra de sonido Smart Life SL-XXXX 2.1 1000W Bluetooth.
- **Ejemplo ERP final:** `SOUNDBAR SMARTLIFE SL-XXXX 2.1 1000W`. Largo: 36 caracteres.
- **Regla de corte si supera 50:** 1) Quitar campos opcionales. 2) Abreviar con diccionario. 3) Mantener rubro+marca+modelo+dato clave. 4) Si sigue >50, mandar a revisión..
- **Prioridad de revisión:** BAJA.

## 8. Campos obligatorios por rubro

Estos campos definen qué debe pedir la app en el formulario dinámico según el rubro seleccionado. `marca`, `modelo_sku` y `condicion` aparecen como base en todos los rubros.

### AIRE ACONDICIONADO — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| capacidad | SI | número + unidad | 3500W | Requerir W o frigorías |
| funcion | SI | lista | FRÍO/CALOR | Frío solo o frío/calor |
| tecnologia | SI | lista | INVERTER | ON/OFF o INVERTER |

### ANAFE — COCINA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| energia | SI | lista | INDUCCIÓN | Gas/Eléctrico/Inducción/Vitro |
| zonas | SI | número | 4 | Hornallas/zonas |
| ancho_cm | SI | número | 80 | Medida en cm |

### COCINA — COCINA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| ancho_cm | SI | número | 56 | Medida en cm |
| hornallas | SI | número | 4 | Cantidad |
| combustible | SI | lista | MULTIGAS | Gas natural/Multigas/Eléctrica |

### FREEZER — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| formato | SI | lista | HORIZONTAL | Horizontal/Vertical/Cajón |
| litros | SI | número | 194 | Capacidad en litros |
| color | SI | lista | BLANCO | Color normalizado |

### EXHIBIDORA — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### HELADERA — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| litros | SI | número | 328 | Capacidad en litros |
| sistema | SI | lista | NO FROST | Cíclica/No Frost |
| color | SI | lista | BLANCO | Color normalizado |

### HORNO — COCINA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| energia | SI | lista | ELÉCTRICO | Gas/Eléctrico |
| instalacion | SI | lista | EMPOTRABLE | Empotrable/Mesada |
| medida | SI | texto | 40L / 60CM | Litros o ancho |

### LAVARROPAS — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| kg | SI | número | 8 | Capacidad lavado |
| tipo_carga | SI | lista | CARGA FRONTAL | Frontal/Superior |
| rpm | SI | número | 1400 | RPM entero |

### LAVASECARROPAS — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| kg_lavado | SI | número | 10 | Capacidad lavado |
| kg_secado | SI | número | 6 | Capacidad secado |
| rpm | SI | número | 1400 | RPM entero |

### LAVAVAJILLAS — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### SECARROPAS — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### TERMOTANQUE — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| litros | SI | número | 80 | Capacidad |
| energia | SI | lista | GAS | Gas/Eléctrico |
| conexion | CONDICIONAL | lista | GN | Obligatorio si es gas |

### TORRE DE LAVADO — LÍNEA BLANCA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### TV — TV / AUDIO

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| pulgadas | SI | número | 55 | Entre 24 y 100 aprox |
| resolucion | SI | lista | 4K | HD/FHD/4K/8K |
| sistema_operativo | SI | lista | GOOGLE TV | Google TV/Android/Vidaa/etc. |

### ASPIRADORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| tipo | SI | lista | VERTICAL | Vertical/robot/trineo |
| potencia_w | SI | número | 1800 | Watts |

### CAMPANA — COCINA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### CALEFON — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| litros | SI | número | 14 | Litros/min |
| gas | SI | lista | GN | GN/GL |

### CERVECERA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### CALOVENTOR — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### CONVECTOR — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MICROONDAS — COCINA

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| litros | SI | número | 28 | Capacidad |
| control | SI | lista | DIGITAL | Digital/Perilla |
| grill | SI | booleano | CON GRILL | Sí/No |

### MINICOMPONENTE — TV / AUDIO

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MONITOR — TV / AUDIO

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PANEL — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PARLANTE — TV / AUDIO

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PURIFICADOR — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### VENTILADOR — CLIMATIZACIÓN

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| tipo | SI | lista | DE PIE | De pie/techo/industrial |
| pulgadas | SI | número | 20 | Pulgadas |

### ARROCERA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### BATIDORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### CAFETERA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| tipo | SI | lista | ESPRESSO | Filtro/Espresso/Cápsulas |
| dato_clave | SI | texto | 20 BAR / 1.5L | Presión o capacidad |

### CHOPPER — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### ESPUMADOR — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### EXPRIMIDOR — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### EXTRACTOR — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### FREIDORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| litros | SI | número | 7 | Capacidad |
| potencia_w | SI | número | 1400 | Watts |
| tipo | SI | lista | DE AIRE | Aire/Aceite |

### JARRA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### LICUADORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### LIMPIADOR ZAP — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MIXER — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MOLINO — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MOLINILLO — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MULTIOLLA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### MULTIPROCESADORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PAVA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PICADORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PLANCHA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### PROCESADORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### QUITAPELUSAS — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### SANDWICHERA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### SOPERA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### TOSTADORA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### VAPORIZADOR — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### YOGURTERA — PEQUEÑOS ELECTROS

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

### BARRA DE SONIDO — TV / AUDIO

| Campo | Obligatorio | Tipo | Ejemplo | Validación |
|---|---|---|---|---|
| marca | SI | lista/controlada | SAMSUNG | Debe existir en catálogo de marcas |
| modelo_sku | SI | texto normalizado | UN55CU7000 | No duplicar SKU activo; sin espacios extremos |
| condicion | SI | lista | PRIMERA / OUTLET | Si SKU contiene (O), condición OUTLET |
| dato_clave_principal | SI | texto/número | 1000W / 1.7L / 32" | Debe ser comparable dentro del rubro |
| color_material | RECOMENDADO | lista | BLANCO / INOX | Usar diccionario de colores/materiales |

## 9. Diccionario de abreviaturas ERP

La app debe usar este diccionario para generar la descripción ERP. Las abreviaturas deben ser editables desde una pantalla administrativa, pero no deberían ser inventadas por cada usuario.

| Texto largo | Abreviatura | Tipo | Nota |
|---|---|---|---|
| AIRE ACONDICIONADO | A/A | ERP | Mantener para Puma por límite de 50 caracteres |
| LAVARROPAS | LAV | ERP |  |
| LAVASECARROPAS | LAVASEC | ERP |  |
| LAVAVAJILLAS | LAVAVAJ | ERP |  |
| SECARROPAS | SEC | ERP |  |
| HELADERA | HEL | ERP |  |
| FREEZER | FREEZER | ERP |  |
| TERMOTANQUE | TERMO | ERP |  |
| PURIFICADOR | PURIF | ERP |  |
| ASPIRADORA | ASP | ERP |  |
| CAFETERA | CAF | ERP |  |
| LICUADORA | LIC | ERP |  |
| PROCESADORA | PROC | ERP |  |
| SANDWICHERA | SAND | ERP |  |
| VENTILADOR | VENT | ERP |  |
| CONVECTOR | CONV | ERP |  |
| CALOVENTOR | CALOV | ERP |  |
| PARLANTE | PARL | ERP |  |
| BARRA DE SONIDO | SOUNDBAR | ERP |  |
| FRÍO/CALOR | F/C | Función |  |
| FRIO/CALOR | F/C | Función |  |
| FRÍO SOLO | F/S | Función |  |
| INVERTER | INV | Tecnología |  |
| ON OFF | ON/OFF | Tecnología |  |
| DIGITAL | DIG | Tecnología |  |
| ELÉCTRICO | ELEC | Energía |  |
| ELECTRICO | ELEC | Energía |  |
| EMPOTRABLE | EMPOT | Instalación |  |
| INDUCCIÓN | IND | Tecnología |  |
| INDUCCION | IND | Tecnología |  |
| VITROCERÁMICO | VITRO | Tecnología |  |
| VITROCERAMICO | VITRO | Tecnología |  |
| BLANCO | BCO | Color |  |
| BLANCA | BCA | Color |  |
| NEGRO | NGO | Color |  |
| NEGRA | NGA | Color |  |
| GRIS | GRIS | Color |  |
| ACERO | AC | Material |  |
| ACERO INOXIDABLE | INOX | Material |  |
| SILVER | SILVER | Color |  |
| CARGA FRONTAL | FRONT | Carga |  |
| CARGA SUPERIOR | SUP | Carga |  |
| CONDENSACIÓN | COND | Sistema |  |
| CONDENSACION | COND | Sistema |  |
| NO FROST | NF | Sistema |  |
| GOOGLE TV | GTV | Sistema operativo |  |
| ANDROID TV | ATV | Sistema operativo |  |
| BLUETOOTH | BT | Conectividad |  |
| CENTÍMETROS | CM | Unidad |  |
| LITROS | L | Unidad |  |
| KILOS | KG | Unidad |  |
| REVOLUCIONES | RPM | Unidad |  |
| HORNALLAS | H | Unidad |  |
| QUEMADORES | Q | Unidad |  |

## 10. Subrubros sugeridos

El subrubro no debe ser una descripción larga. Debe ser el dato corto que permite filtrar, agrupar y comparar productos dentro de un rubro.

| Familia | Rubro | Subrubro recomendado | Se define con | Ejemplos |
|---|---|---|---|---|
| CLIMATIZACIÓN | AIRE ACONDICIONADO | `{capacidad} {funcion} {tecnologia}` | marca; modelo/SKU; capacidad W/frigorías; tipo split/portátil; función frío solo o frío/calor; tecnología on/off o inverter | 2650W frío/calor; 3500W inverter; 5300W on/off |
| COCINA | ANAFE | `{tipo_energia} {zonas} zonas {ancho_cm} cm` | marca; modelo/SKU; tipo de energía; cantidad de hornallas/zonas; ancho cm; material/color | Eléctrico 4 zonas 60 cm; Inducción 4 zonas 80 cm; Gas 4Q acero |
| COCINA | COCINA | `{ancho_cm} cm {combustible} {hornallas} hornallas` | marca; modelo/SKU; ancho cm; cantidad de hornallas; combustible; color/material | 50 cm multigas 4H; 56 cm multigas 4H; eléctrica 4H |
| LÍNEA BLANCA | FREEZER | `{formato} {litros} L` | marca; modelo/SKU; formato horizontal/vertical/cajón; capacidad litros; color/material | dato técnico principal + variante útil |
| LÍNEA BLANCA | EXHIBIDORA | `{litros} L {puertas} puertas` | marca; modelo/SKU; capacidad litros; tipo exhibidora; puertas; color/material | dato técnico principal + variante útil |
| LÍNEA BLANCA | HELADERA | `{sistema} {litros} L {puertas/freezer}` | marca; modelo/SKU; sistema cíclica/no frost; capacidad litros; freezer sí/no; color/material | Cíclica 328L; No Frost 400L; Side by Side 654L; 1 puerta con freezer |
| COCINA | HORNO | `{tipo_energia} {instalacion} {litros_o_ancho}` | marca; modelo/SKU; tipo energía; instalación empotrable/mesada; capacidad litros o ancho; color/material | dato técnico principal + variante útil |
| LÍNEA BLANCA | LAVARROPAS | `{kg} kg {tipo_carga} {rpm} rpm` | marca; modelo/SKU; carga kg; tipo de carga; rpm; color; tecnología inverter sí/no | 8 kg frontal 1400 rpm; 6 kg frontal inverter; superior 7 kg |
| LÍNEA BLANCA | LAVASECARROPAS | `{kg_lavado}+{kg_secado} kg {rpm} rpm` | marca; modelo/SKU; kg lavado; kg secado; rpm; color; tecnología | dato técnico principal + variante útil |
| LÍNEA BLANCA | LAVAVAJILLAS | `{cubiertos} cubiertos` | marca; modelo/SKU; cubiertos/sets; color/material; instalación si aplica | dato técnico principal + variante útil |
| LÍNEA BLANCA | SECARROPAS | `{kg} kg {sistema}` | marca; modelo/SKU; capacidad kg; sistema calor/condensación/bomba; color | dato técnico principal + variante útil |
| CLIMATIZACIÓN | TERMOTANQUE | `{litros} L {energia} {conexion}` | marca; modelo/SKU; capacidad litros; energía gas/eléctrico; conexión GN/GL si aplica | 40L eléctrico; 80L gas GN; 120L gas |
| LÍNEA BLANCA | TORRE DE LAVADO | `{kg_lavado}/{kg_secado} kg` | marca; modelo/SKU; kg lavado; kg secado; tecnología; color | dato técnico principal + variante útil |
| TV / AUDIO | TV | `{pulgadas}" {resolucion} {sistema_operativo}` | marca; modelo/SKU; pulgadas; resolución; smart/sistema operativo; tecnología pantalla | 32" HD; 43" FHD; 50" 4K Google TV; 65" QLED |
| PEQUEÑOS ELECTROS | ASPIRADORA | `{tipo} {potencia}W` | marca; modelo/SKU; tipo vertical/robot/trineo; potencia W; bolsa/sin bolsa; color | capacidad + potencia + tipo |
| COCINA | CAMPANA | `{ancho_cm} cm {tipo}` | marca; modelo/SKU; ancho cm; tipo campana/purificador; material/color | dato técnico principal + variante útil |
| CLIMATIZACIÓN | CALEFON | `{litros} L {gas}` | marca; modelo/SKU; litros/minuto; tipo gas; color | dato técnico principal + variante útil |
| PEQUEÑOS ELECTROS | CERVECERA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad litros; color/material | capacidad + potencia + tipo |
| CLIMATIZACIÓN | CALOVENTOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; formato; color | dato técnico principal + variante útil |
| CLIMATIZACIÓN | CONVECTOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; tipo vidrio/aire; timer; color | dato técnico principal + variante útil |
| COCINA | MICROONDAS | `{litros} L {grill/control}` | marca; modelo/SKU; capacidad litros; tipo digital/perilla; grill sí/no; color/material | 20L perilla; 28L digital con grill; empotrable 40L |
| TV / AUDIO | MINICOMPONENTE | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; conectividad; color | dato técnico principal + variante útil |
| TV / AUDIO | MONITOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; pulgadas; resolución; frecuencia Hz; modelo | dato técnico principal + variante útil |
| CLIMATIZACIÓN | PANEL | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; vidrio/material; color | dato técnico principal + variante útil |
| TV / AUDIO | PARLANTE | `{tipo} {potencia}W BT` | marca; modelo/SKU; tipo; potencia W; conectividad bluetooth; color | dato técnico principal + variante útil |
| CLIMATIZACIÓN | PURIFICADOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; ancho cm o potencia; tipo aire/cocina; color/material | dato técnico principal + variante útil |
| CLIMATIZACIÓN | VENTILADOR | `{tipo} {pulgadas}"` | marca; modelo/SKU; tipo de pie/techo/industrial; pulgadas; color | dato técnico principal + variante útil |
| PEQUEÑOS ELECTROS | ARROCERA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad; potencia; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | BATIDORA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo mano/mesa/planetaria; potencia; capacidad; velocidades; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | CAFETERA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo cafetera; presión/bar o capacidad; potencia; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | CHOPPER | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; capacidad; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | ESPUMADOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad ml; potencia; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | EXPRIMIDOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad; potencia; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | EXTRACTOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; capacidad; jarra; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | FREIDORA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo aire/aceite; litros; potencia; digital/manual; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | JARRA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad litros; material; control temperatura; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | LICUADORA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo vaso/mano; potencia; capacidad; material vaso; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | LIMPIADOR ZAP | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo; modelo; potencia si aplica | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | MIXER | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; accesorios; material; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | MOLINO | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo café/semillas; potencia; capacidad | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | MOLINILLO | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo semillas/café; potencia; capacidad | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | MULTIOLLA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad litros; potencia; funciones; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | MULTIPROCESADORA | `{dato_clave_principal}` | marca; modelo/SKU; dato técnico principal; color/material si aplica | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | PAVA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad litros; material; corte mate/café; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | PICADORA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; capacidad; cuchillas; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | PLANCHA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo vapor/seca; potencia; modelo; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | PROCESADORA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; potencia; capacidad bowl; funciones; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | QUITAPELUSAS | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo eléctrico; modelo; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | SANDWICHERA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; placas; posiciones; potencia; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | SOPERA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad; potencia; color | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | TOSTADORA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; cantidad ranuras/rebanadas; potencia; color/material | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | VAPORIZADOR | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; tipo portátil/vertical; potencia; capacidad tanque | capacidad + potencia + tipo |
| PEQUEÑOS ELECTROS | YOGURTERA | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; capacidad; cantidad frascos; color | capacidad + potencia + tipo |
| TV / AUDIO | BARRA DE SONIDO | `{dato_clave_principal} {detalle_tecnico}` | marca; modelo/SKU; canales; potencia; conectividad; color | dato técnico principal + variante útil |

## 11. Observaciones de calidad detectadas en las planillas actuales

Estas observaciones justifican por qué la app debe generar nombres y no permitir texto libre.

| Tipo de alerta | Cantidad | Ejemplos | Recomendación |
|---|---:|---|---|
| Descripciones Madre mayores a 50 caracteres | 320 | HORNO MICROONDAS ELÉCTRICO ARISTON EMPOTRABLE 40LTS MP 776 IX / HELADERA BGH COMBI NO FROST INVERTER BRC330I1A 312L WATER DISPENSER DISPLAY DIG INOX / HELADERA BGH COMBI NO FROST INVERTER BRC310I1A 312L DISPLAY DIG INOX EF / HELADERA BGH COMBI NO FROST INVERTER BRC330I2A 312L WATER DISPENSER DISPLAY DIG DARK INOX EF / HELADERA BGH COMBI NO FROST INVERTER BRC310I2A 312L DISPLAY DIG DARK INOX | No usar directo para ERP; generar descripcion_erp_50. |
| Descripciones Existencias exactamente en límite 50 | 240 | ANAFE ELÉCTRICO ARISTON VITROCERAMICO 77CM-HR704BA / HORNO ELÉCTRICO ARISTON EMPOTRABLE 40LTS COMBINADO / LAVAVAJILLAS ARISTON 15 CUBIERTOS LFO3P31WLXAG (O) / HELADERA BGH COMBI NO FROST INVERTER BRC330I1A 312 / HELADERA BGH COMBI NO FROST INVERTER BRC310I1A 312 | Confirma límite práctico del ERP; evitar cortar palabras. |
| Posible typo: FREZEER | 2 | FREZEER MIDEA HORIZONTAL INVERTER 194 L MDRC284FZE01 / FREZEER MIDEA HORIZONTAL INVERTER 194 L MDRC284FZE | Corregir en plantilla/campo; no texto libre. |
| Posible typo: ORNALLAS | 12 | COCINA CALABRIA BLANCA 4 ORNALLAS / COCINA CALABRIA NEGRA 4 ORNALLAS / COCINA CALABRIA INOX 4 ORNALLAS / COCINA USMAN IRINA 6 HORNALLAS - 900RF / COCINA USMAN COMPACT 800 5 HORNALLAS | Corregir en plantilla/campo; no texto libre. |
| Posible typo: ELCETRICO | 2 | HORNO ELCETRICO BGH 55 LITROS (O) / HORNO ELCETRICO BGH 55 LITROS (O) | Corregir en plantilla/campo; no texto libre. |
| Posible typo: CONDESACIÓN | 3 | SECARROPAS CANDY 12 9KG CONDESACIÓN INOX / SECARROPAS CANDY 12 9KG CONDESACIÓN INOX / SECARROPAS CANDY 12 9KG CONDESACIÓN INOX (O) | Corregir en plantilla/campo; no texto libre. |
| Posible typo: LFIE | 1 | YOGURTERA SMART LFIE YM2305 | Corregir en plantilla/campo; no texto libre. |
| Posible typo: 2O LTS | 4 | MICROONDAS BGH 2O LTS DIGITAL (O) / MICROONDAS BGH 2O LTS PERILLA (O) / MICROONDAS BGH 2O LTS DIGITAL (O) / MICROONDAS BGH 2O LTS PERILLA (O) | Corregir en plantilla/campo; no texto libre. |
| Outlet detectado por (O) | 985 | ANAFE ARISTON 4 QUEMADORES ACERO (O) / COCINA ARISTON NEGRA ELECTRICA (O) / HELADERA ARISTON TRE44AB BLANCA (O) / HORNO A GAS EMPOTRABLE ARISTON GA3 124 CIX A (O) / LAVAVAJILLAS ARISTON 15 CUBIERTOS LFO3P31WLXAG (O) | Guardar condicion=OUTLET y sku_base separado. |
| Tipos de Madre no incluidos en mapa del usuario | 5 | ESTUFA(3), FRIGOBAR(1), SARTEN(1) | Decidir si se agregan al mapa o pasan a OTROS. |
| Productos grandes sin medida/capacidad detectable | 516 | A/A ALASKA 2650 / A/A ALASKA 2700 / A/A ALASKA 3200 / A/A ALASKA 3300 / A/A ALASKA 3500 INV | Obligar campo técnico por rubro en la app. |

## 12. Plantilla conceptual de carga en la app

La app debe mostrar una vista previa del producto generado antes de guardarlo. Debe mostrar descripción comercial, descripción ERP, largo ERP y estado de validación.

| Familia | Rubro | Marca | Modelo/SKU | Condición | Dato 1 | Dato 2 | Dato 3 | Color/material | Descripción comercial generada | Descripción ERP generada |
|---|---|---|---|---|---|---|---|---|---|---|
| CLIMATIZACIÓN | AIRE ACONDICIONADO | ALASKA | ALK3500 | PRIMERA | 3500W | FRÍO/CALOR | INVERTER | BLANCO | Aire acondicionado Alaska ALK3500 3500W frío/calor inverter blanco | A/A ALASKA ALK3500 3500W F/C INV BCO |
| LÍNEA BLANCA | HELADERA | SAMSUNG | RB33A3070WP | OUTLET | 328L | NO FROST | 2P | BLANCA | Heladera Samsung RB33A3070WP no frost 328 litros 2 puertas blanca (OUTLET) | HEL SAMSUNG RB33A3070WP NF 328L BCA |
| TV / AUDIO | TV | BGH | B5024US6G | PRIMERA | 50" | 4K | GOOGLE TV | NEGRO | Smart TV BGH B5024US6G 50" 4K Google TV | TV BGH B5024US6G 50" 4K GTV |
| COCINA | COCINA | ESCORIAL | CANDOR | PRIMERA | 56CM | 4H | MULTIGAS | BLANCA | Cocina Escorial Candor 56 cm multigas 4 hornallas blanca | COCINA ESCORIAL CANDOR 56CM 4H BCA |

## 13. Validaciones obligatorias del módulo

- No permitir guardar producto activo sin familia, rubro, marca, modelo/SKU, condición y descripción ERP.
- No permitir descripción ERP con más de 50 caracteres.
- No permitir SKU comercial duplicado en productos activos.
- No permitir código Puma duplicado en productos activos.
- Si condición es OUTLET, exigir SKU comercial con `(O)` y descripción comercial con `(OUTLET)`.
- Si condición es OUTLET, la descripción ERP debe seguir limpia, sin OUTLET.
- Si el SKU contiene `(O)` al importar desde planillas viejas, sugerir condición OUTLET y limpiar el SKU base.
- Si falta el código Puma, el producto puede existir como borrador o pendiente, pero no debe quedar activo definitivo sin control.
- Si el rubro es ambiguo, enviar a revisión manual.
- Si el producto viene de planillas existentes, guardar alias histórico.

## 14. Resultado esperado

Con estas reglas, la app podrá generar altas nuevas y normalizar productos existentes de forma consistente. La misma base servirá para la app, la nueva Planilla Madre, las hojas por marca, la descripción ERP compatible con Puma y los reportes comerciales por familia, rubro, subrubro y condición.
