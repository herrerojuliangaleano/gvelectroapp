# BI Comercial - PowerPoint de marca 2.0

## Estado

[FASE] BI Comercial - presentaciones para marcas  
[ESTADO] Corte 1 implementado / pendiente de prueba manual con PPT real
[BASE ACTIVA] PostgreSQL  
[FUENTE] `Ventas Vs. Costos`  
[DOCUMENTO BASE] `docs/12-comercial-bi-marcas-lineas-sucursales.md`

## Objetivo

Rediseñar el PowerPoint editable del dossier de marca para que funcione mejor en
reuniones con proveedores. La presentacion debe explicar participacion,
competencia, presencia por zona y oportunidades comerciales usando tipos de
producto, no SKUs puntuales.

El foco de esta fase es el PowerPoint. La app y el Excel deben acompañar con
los datos necesarios, pero no se busca rediseñar todo el BI comercial en el
mismo paso.

## Audiencia

- Gerencia comercial.
- Equipo comercial interno.
- Proveedores y marcas externas cuando se use modo presentacion.
- Agentes de codigo Codex / Claude Code que tengan que implementar la fase.

## Principios de diseño

- La presentacion debe ser limpia, ejecutiva y entendible sin hover.
- No mostrar costos, diferencia, margen ni recomendaciones internas sensibles.
- Evitar productos puntuales en la narrativa principal.
- Priorizar tipos comerciales, zonas, participacion y comparacion competitiva.
- Usar graficos editables de PowerPoint siempre que sea posible.
- Usar barras verticales o apiladas para comparaciones ejecutivas.
- Usar torta solo para in-house share por zona, donde la pregunta es parte del
  total.

## Tecnologia actual

- Dashboard web: React + `recharts` para graficos interactivos dentro de la app.
- PowerPoint editable: `pptxgenjs` desde frontend, con graficos nativos y tablas
  editables en PowerPoint.
- Fuente de datos: endpoint `GET /api/sales-bi/commercial/brand-dossier`.
- Logo de marca: PNG guardado en el storage activo del backend bajo
  `storage/brand-logos/{marca_slug}.png`.
- Color de marca: HEX guardado en el storage activo del backend bajo
  `storage/brand-styles/{marca_slug}.json`.

Decision: mantener el PowerPoint editable en frontend por ahora. La razon es
que la salida actual ya queda bien visualmente y `pptxgenjs` permite conservar
graficos y tablas editables sin capturarlos como imagen.

## Alcance

Incluido:

- Persistir logo PNG por marca principal.
- Permitir cambiar/reemplazar el logo guardado.
- Persistir color principal HEX por marca principal.
- Usar logo solo para la marca principal del informe.
- Usar color de marca solo para la marca principal; competidores, zonas, tipos
  y categorias usan paletas secundarias desaturadas.
- Mostrar competidores como texto, no como logos.
- Agregar selector de tipos comerciales para el dossier.
- Agregar la agrupacion especial `Lavado`.
- Reemplazar slides centradas en productos/SKUs por slides centradas en tipos.
- Cambiar el PowerPoint editable para usar nuevos graficos y nuevas lecturas.
- Documentar los datos necesarios para que Excel y backend acompañen la fase.

Excluido:

- No integrar logos de competidores.
- No crear biblioteca visual completa de marcas con colores corporativos.
- No incluir costos, diferencia ni margen.
- No mezclar planillas diarias operativas.
- No cambiar el importador de `Ventas Vs. Costos`.
- No modificar la capa de vendedores, remitos, señas ni medios de pago.

## Conceptos nuevos

### Logo de marca

Cada marca puede tener un logo PNG guardado. El logo se usa solo cuando esa
marca es la marca principal del dossier.

Reglas:

- Formato aceptado: PNG.
- Debe guardarse asociado al nombre canonico de la marca.
- Si se sube otro logo para la misma marca, reemplaza al anterior.
- Si no hay logo, la portada y las slides usan el nombre de marca en texto.
- Los competidores nunca muestran logo en esta fase.
- El logo debe verse en portada y en el encabezado o pie visual de todas las
  slides.

Implementacion sugerida:

- Guardar archivo en el storage activo de backend, por ejemplo
  `storage/brand-logos/{marca_slug}.png`.
- En el corte 1 no se agrego tabla nueva: la metadata se deriva del archivo
  guardado para evitar migracion innecesaria.
- Exponer endpoints internos para obtener, subir y reemplazar logo.

### Color de marca

Cada marca puede tener un color principal HEX guardado. Ese color se usa para
la marca principal en portada, KPIs, series propias y comparaciones donde la
marca aparece como serie.

Reglas:

- Formato aceptado: `#RRGGBB`.
- Samsung usa por defecto `#1428A0` si no hay color guardado.
- Si se guarda otro color para la misma marca, reemplaza al anterior.
- Los competidores nunca usan el color de la marca principal.
- Tipos, categorias y zonas usan una paleta secundaria menos saturada para no
  opacar el color de marca.
- El color es un asset visual de presentacion; no cambia ningun dato comercial.

### Tipo comercial

El PowerPoint debe trabajar con tipos comerciales, no con productos.

Un tipo comercial normalmente coincide con `tipo_producto` normalizado:

- `HELADERA`
- `AIRE ACONDICIONADO`
- `TELEVISION`
- `COCINA`
- `CAFETERA`
- `MICROONDAS`
- `TERMOTANQUE`
- `HORNO`
- `ANAFE`
- otros tipos existentes en `Ventas Vs. Costos`

La excepcion es `Lavado`.

### Agrupacion `Lavado`

`Lavado` es un tipo comercial ejecutivo que agrupa productos muy relacionados:

- `LAVARROPAS`
- `LAVASECARROPAS`
- `LAVASECA`
- `SECARROPAS`

No se deben crear otras fusiones especiales sin decision explicita. El objetivo
es que el informe hable en el lenguaje comercial esperado sin perder trazabilidad
al `tipo_producto` original.

### Zona de share

Para in-house share y share por punto de venta, las sucursales/canales se
agrupan en tres zonas:

| Zona | Regla |
|---|---|
| `CABA` | Caseros local |
| `GBA` | Norte / Norcenter, Sur / Lanus y Canning locales |
| `Venta Web` | ventas online/web, independientemente de la sucursal de origen |

Regla de precedencia: si `tipo_venta` es online/web, clasifica como `Venta Web`
antes de mirar sucursal. Si no es online, se clasifica por sucursal.

## Cambios en la experiencia de exportacion

Al exportar PowerPoint editable desde el dossier:

1. Elegir marca principal.
2. Elegir competidores.
3. Elegir tipos comerciales a incluir.
4. Ver logo guardado de la marca principal, si existe.
5. Subir o reemplazar logo PNG de la marca principal.
6. Elegir/guardar color principal de marca.
7. Exportar PPT editable.

Defaults recomendados para tipos:

- `HELADERA`
- `Lavado`
- `AIRE ACONDICIONADO`
- `TELEVISION`

El usuario puede agregar otros tipos como `COCINA`, `CAFETERA`, `MICROONDAS` o
los que existan en el periodo filtrado.

## Slides propuestas

### 1. Portada

Contenido:

- Logo de la marca principal.
- Nombre de la marca.
- Periodo.
- Fuente: `Ventas Vs. Costos`.
- Nota: sin medios de pago, señas, recibos, remitos ni vendedores.

### 2. Resumen ejecutivo

Contenido:

- Unidades.
- Facturacion/PVP vendido.
- Share en unidades.
- Share en pesos.
- Ranking total.
- Tipos donde la marca es fuerte.
- Oportunidades principales.

### 3. Ranking competitivo total

Grafico:

- Barras apiladas o columnas apiladas por marca.
- Debe mostrar el total y el mix por tipos seleccionados.

Lectura esperada:

- Donde queda la marca principal contra competidores.
- Que parte de su venta viene de cada tipo seleccionado.

### 4. Ranking competitivo por tipo

Una seccion por tipo seleccionado:

- Heladeras.
- Lavado.
- A/A.
- Television.
- Otros tipos elegidos.

Grafico:

- Barras verticales por marca para el tipo.
- Mostrar unidades y pesos segun metrica seleccionada.

### 5. Participacion mensual total

Grafico:

- Barras verticales por mes.
- Puede mostrar share de marca en unidades y/o pesos.
- Evitar lineas si la comparacion se entiende mejor como columnas por periodo.

### 6. Participacion mensual por tipo

Grafico:

- Columnas agrupadas o apiladas por mes y tipo.
- Debe permitir ver si la participacion mejora o cae en cada tipo seleccionado.

### 7. In-house share por zona

Grafico:

- Torta o donut por zona:
  - `CABA`
  - `GBA`
  - `Venta Web`

Lectura esperada:

- Como se reparte la participacion de la marca en la red.
- Donde la marca esta mas fuerte o mas debil.

### 8. Share por punto de venta / zona

Grafico:

- Barras verticales por zona o sucursal, segun espacio.
- Debe complementar la torta de in-house share con valores comparables.

### 9. Tipos destacados

Reemplaza `Productos destacados`.

Contenido:

- Ranking de tipos comerciales de la marca.
- Unidades.
- Pesos/PVP vendido.
- Share dentro de cada tipo.
- Mix dentro de la marca.

### 10. Tipos x punto de venta

Reemplaza `Producto x punto de venta`.

Contenido:

- Matriz tipo comercial x zona/sucursal.
- Unidades y pesos.
- Resaltar tipos fuertes y debiles por zona.

### 11. Gamas de precio por tipo

Grafico:

- Barras verticales por gama de precio.
- Separar o filtrar por tipo comercial seleccionado.

Lectura esperada:

- En que posicionamiento de precio participa la marca.
- Si compite en entrada, media o premium dentro de cada tipo.

### 12. Marca vs competidores por periodo

Reemplaza la comparacion de lineas.

Grafico:

- Barras verticales por periodo.
- Serie por marca principal y competidores.
- Debe poder verse en unidades y pesos.

### 13. Conclusiones y proximos pasos

Contenido:

- Fortalezas.
- Oportunidades.
- Acciones sugeridas.
- No mostrar margen/costo/diferencia.

## Datos backend necesarios

El dossier debe poder devolver:

- `available_tipos`: tipos comerciales disponibles en el periodo.
- `selected_tipos`: tipos elegidos para el informe.
- `tipo_groups`: definicion de `Lavado` y tipos directos.
- `brand_logo`: metadata/URL del logo de marca principal, si existe.
- `brand_style`: color principal de la marca.
- `ranking_by_tipo`: ranking de marcas por tipo comercial.
- `monthly_share_by_tipo`: participacion mensual por tipo comercial.
- `zone_share`: share por `CABA`, `GBA`, `Venta Web`.
- `tipo_zone_matrix`: matriz tipo comercial x zona/sucursal.
- `price_bands_by_tipo`: gamas de precio por tipo comercial.
- `competitor_period_bars`: marca vs competidores por periodo.

## Endpoints propuestos

Logo de marca:

- `GET /api/sales-bi/commercial/brand-logos/{marca}`
- `POST /api/sales-bi/commercial/brand-logos/{marca}`
- `DELETE /api/sales-bi/commercial/brand-logos/{marca}`

Estilo de marca:

- `GET /api/sales-bi/commercial/brand-styles/{marca}`
- `PUT /api/sales-bi/commercial/brand-styles/{marca}`

Dossier:

- Extender `GET /api/sales-bi/commercial/brand-dossier` con:
  - `tipos=HELADERA,Lavado,AIRE ACONDICIONADO`
  - campos nuevos descriptos arriba.
- Extender `GET /api/sales-bi/commercial/brand-dossier/export-xlsx` con los
  mismos tipos para que el Excel tenga la base de calculo.

PowerPoint:

- El PowerPoint editable sigue generandose en frontend con datos del dossier.
- Si se decide moverlo al backend, debe documentarse como cambio de arquitectura
  antes de implementarlo.

## Cambios esperados en frontend

En `BrandDossierView`:

- Agregar selector de tipos comerciales.
- Mostrar logo actual de la marca.
- Permitir subir/reemplazar logo PNG.
- Permitir elegir y guardar color HEX de marca.
- Mostrar todos los tipos disponibles, no solo los primeros.
- Enviar `tipos` al dossier y al export Excel.
- Pasar el logo al generador de PPT editable.

En `exportBrandDossierEditable.ts`:

- Insertar logo de marca principal.
- Usar el color de marca solo para la marca principal.
- Rediseñar slides segun este documento.
- Reemplazar productos por tipos.
- Usar barras verticales/apiladas para rankings y comparaciones.
- Usar torta/donut para in-house share por zona.
- Cambiar presencia por sucursal a presencia por zona.
- Generar gamas de precio con graficos de barras por cada tipo seleccionado.

## Validacion esperada

Backend:

- `python -m compileall -q backend/app`.
- `docker compose exec backend python -c "import app.main"`.
- Dossier con marca + competidores + tipos devuelve datos sin romper el contrato
  actual.
- Logo PNG se guarda, reemplaza y sirve correctamente.
- Color HEX de marca se guarda y queda asociado a la marca.
- `Lavado` suma correctamente lavarropas, lavasecarropas/lavaseca y secarropas.
- `Venta Web` clasifica por canal antes que por sucursal.

Frontend:

- `npm run build`.
- Export PPT con logo guardado.
- Export PPT sin logo guardado.
- Selector de tipos con defaults correctos.
- Selector de tipos muestra todos los tipos disponibles.
- Selector de color guarda el color de la marca.
- Competidores siguen funcionando sin logo.

Manual:

- Generar PPT de Samsung con competidores.
- Incluir tipos: Heladeras, Lavado, A/A, Television.
- Confirmar que no aparecen productos/SKUs como slide principal.
- Confirmar que no aparecen costos, margen ni diferencia.
- Confirmar que el logo se ve bien en portada y slides.

## Riesgos / decisiones a cuidar

- `Lavado` no debe reemplazar el dato original: es una agrupacion de reporte.
- No mezclar `categoria` existente con `tipo comercial`; son conceptos distintos.
- No exponer rentabilidad interna en modo presentacion.
- No hacer que los competidores requieran logo.
- No duplicar logica de clasificacion en frontend si puede venir del backend.
- Evitar que el PPT quede demasiado largo: si se eligen muchos tipos, limitar
  slides o agrupar en anexos.

## Proximo paso recomendado

1. Probar manualmente export PPT con logo real de Samsung.
2. Revisar si el largo de la presentacion queda bien con 4 tipos seleccionados.
3. Extender Excel con las mismas tablas base de tipos/zona si gerencia las pide
   como archivo auditable.
4. Llevar los graficos nuevos a la app en una fase separada.

## Corte 1 implementado

Archivos tocados:

- `backend/app/brand_logo_store.py`
- `backend/app/sales_bi_brand_dossier.py`
- `backend/app/routers/sales_bi.py`
- `frontend/src/api/client.ts`
- `frontend/src/components/BrandDossierView.tsx`
- `frontend/src/lib/exportBrandDossierEditable.ts`
- `frontend/src/types/index.ts`

Cambios hechos:

- Se agregaron endpoints para consultar, subir y borrar logo PNG de marca.
- Se agregaron endpoints para consultar y guardar color HEX por marca.
- El dossier acepta `tipos` y devuelve:
  - `available_tipos`;
  - `selected_tipos`;
  - `tipo_groups`;
  - `brand_logo`;
  - `brand_style`;
  - `ranking_by_tipo`;
  - `monthly_share_by_tipo`;
  - `zone_share`;
  - `tipo_zone_matrix`;
  - `price_bands_by_tipo`.
- `Lavado` agrupa lavarropas, lavaseca/lavasecarropas y secarropas.
- `Venta Web` se detecta primero por canal/tipo de venta y despues por sucursal.
- La UI del dossier permite seleccionar tipos comerciales y subir/reemplazar el
  logo PNG de la marca principal.
- La UI muestra todos los tipos disponibles y permite guardar color principal de
  marca.
- El PowerPoint editable usa logo de marca en portada y encabezado.
- El PowerPoint editable usa el color de la marca solo para la marca principal y
  usa paletas secundarias desaturadas para tipos, zonas y competidores.
- El PowerPoint reemplaza slides centradas en productos por:
  - tipos x punto de venta;
  - tipos destacados;
  - participacion mensual por tipo;
  - gamas de precio por tipo;
  - ranking competitivo total apilado por tipos;
  - ranking competitivo por tipo.
- `Marca vs competidores` usa barras verticales por periodo.
- `In-house share` se muestra por zonas `CABA`, `GBA` y `Venta Web`.
- `Presencia por sucursal` queda reemplazada por `Presencia por zona`.
- `Gamas de precio` genera graficos de barras por cada tipo seleccionado.

Validacion ejecutada:

- `python -m compileall -q backend/app`: OK.
- `docker compose exec backend python -c "import app.main; print('ok')"`: OK.
- `npm.cmd run build` en `frontend/`: OK.
- `docker compose build backend && docker compose up -d backend`: OK.
- `docker compose --env-file backend/.env.production.local -f docker-compose.prod-local.yml build backend-prod && ... up -d backend-prod`: OK.
- Healthcheck HTTP dev `http://127.0.0.1:8000/api/health`: OK.
- Healthcheck HTTP mini-prod `http://127.0.0.1:8010/api/health`: OK.
- OpenAPI dev y mini-prod muestra `/api/sales-bi/commercial/brand-logos/{marca}` y
  `/api/sales-bi/commercial/brand-dossier`: OK.

Lo no validado todavia:

- Export manual de PPT desde navegador con logo real.
- Apertura del `.pptx` resultante en PowerPoint para revisar layout final.
- Flujo real de subir/reemplazar/borrar logo desde la UI.

## Protocolo de continuidad

Cuando se cierre una implementacion de esta fase, usar el formato de
`docs/04-protocolo-agentes.md` e indicar explicitamente:

- si se tocaron endpoints;
- si se tocaron modelos/tablas;
- si se cambio el contrato del dossier;
- si se agregaron datos al Excel;
- si el PowerPoint visual o editable fue modificado.
