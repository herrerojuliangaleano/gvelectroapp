# Reparacion de anuncio de precios - Implementation Plan

> **For agentic workers:** ejecutar en linea con backup y validacion entre pasos.

**Goal:** reparar la identidad de cuatro cambios de precio en produccion local
sin perder importes, checks ni trazabilidad.

**Architecture:** intervencion de datos acotada sobre PostgreSQL. Se conserva
`price_cost_updates.id=984` como cambio historico y se reasocia al producto
canonico; los snapshots del lote se corrigen de forma explicita.

**Tech Stack:** PostgreSQL 16, Docker Compose, SQLAlchemy models existentes.

## Global Constraints

- Base activa: PostgreSQL `electrogv` del compose `prod-local`.
- No tocar SQLite/JSON legacy.
- No modificar precios de los cuatro cambios originales.
- No borrar productos ni actualizaciones; usar cancelacion/desactivacion.

---

### Task 1: Resguardo y precondiciones

**Files:**
- Create: `backend/backups-prod/pre-price-announcement-repair-<timestamp>.dump`

- [ ] Crear un dump custom de la base `electrogv`.
- [ ] Confirmar que existe lote `#93` con cuatro items.
- [ ] Confirmar actualizaciones `984, 987, 988, 989, 990, 991`.
- [ ] Confirmar productos `1380` y `1387` con SKU viejo/nuevo.

### Task 2: Reparacion transaccional

**Interfaces:**
- Consumes: tablas `products`, `price_cost_updates`,
  `price_cost_update_history`, `price_announcement_batches` y
  `price_announcement_batch_items`.
- Produces: cuatro cambios pendientes de anuncio y lote `#93` regenerable.

- [ ] Reasociar `#984` a `products.id=1387` y corregir marca/SKU/descripcion.
- [ ] Corregir descripciones de `#988` y `#989` desde `products`.
- [ ] Cancelar `#990` y `#991` con motivo `identity_merge_duplicate`.
- [ ] Desactivar `products.id=1380`.
- [ ] Limpiar `announcement_archived_at/by` de `984,987,988,989`.
- [ ] Corregir items del lote `#93` y `brand_names`.
- [ ] Insertar eventos de historial y confirmar la transaccion.

### Task 3: Validacion operativa

- [ ] Consultar `announcement_pending=true` conceptualmente mediante las mismas
  condiciones del endpoint y confirmar los cuatro registros.
- [ ] Confirmar que `#984` conserva `$775.000 -> $800.000`.
- [ ] Confirmar que `#990/#991` estan canceladas y no aparecen en la bandeja.
- [ ] Regenerar el lote `#93` por API o ejecutar smoke del renderer.
- [ ] Verificar que marcas del lote sean `ENOVA` y `TELEFUNKEN`.
