# BI Comercial - PowerPoint de marca 2.0

## Estado

[FASE] BI Comercial - presentaciones para marcas  
[ESTADO] Diseñado / pendiente de implementacion  
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

## Alcance

Incluido:

- Persistir logo PNG por marca principal.
- Permitir cambiar/reemplazar el logo guardado.
- Usar logo solo para la marca principal del informe.
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
- Guardar metadata minima en Postgres:
  - `id`
  - `marca`
  - `file_path`
  - `content_type`
  - `updated_by`
  - `updated_at`
- Exponer endpoints internos para obtener, subir y reemplazar logo.

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
6. Exportar PPT editable.

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
- Enviar `tipos` al dossier y al export Excel.
- Pasar el logo al generador de PPT editable.

En `exportBrandDossierEditable.ts`:

- Insertar logo de marca principal.
- Rediseñar slides segun este documento.
- Reemplazar productos por tipos.
- Usar barras verticales/apiladas para rankings y comparaciones.
- Usar torta/donut para in-house share por zona.

## Validacion esperada

Backend:

- `python -m compileall -q backend/app`.
- `docker compose exec backend python -c "import app.main"`.
- Dossier con marca + competidores + tipos devuelve datos sin romper el contrato
  actual.
- Logo PNG se guarda, reemplaza y sirve correctamente.
- `Lavado` suma correctamente lavarropas, lavasecarropas/lavaseca y secarropas.
- `Venta Web` clasifica por canal antes que por sucursal.

Frontend:

- `npm run build`.
- Export PPT con logo guardado.
- Export PPT sin logo guardado.
- Selector de tipos con defaults correctos.
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

1. Implementar persistencia y endpoints de logo de marca.
2. Agregar normalizador backend de tipo comercial y grupo `Lavado`.
3. Extender dossier con `tipos` y matrices nuevas.
4. Actualizar UI de exportacion.
5. Rediseñar `exportBrandDossierEditable.ts`.
6. Extender Excel con las mismas tablas base.

## Protocolo de continuidad

Cuando se cierre una implementacion de esta fase, usar el formato de
`docs/04-protocolo-agentes.md` e indicar explicitamente:

- si se tocaron endpoints;
- si se tocaron modelos/tablas;
- si se cambio el contrato del dossier;
- si se agregaron datos al Excel;
- si el PowerPoint visual o editable fue modificado.
