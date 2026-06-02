# Fase 3.B — División de routers grandes en sub-módulos

**Estado:** [HECHO]. Patrón validado y aplicado a todos los routers grandes
definidos para Fase B.

## Por qué

Routers monolíticos generan problemas:

- **Imposible de leer.** `warranties.py` tenía 5286 líneas con 43 endpoints + ~50 helpers + 30 modelos Pydantic mezclados.
- **Difícil de modificar sin romper.** Cambios en un dominio (ej. provider) tocan código cerca de otro dominio (ej. exports), riesgo de regresión.
- **Lento de cargar mentalmente.** Cualquier agente (humano o LLM) tiene que escanear todo el archivo para entender qué hay.
- **Conflictos al colaborar.** Dos personas tocando el mismo archivo grande casi siempre genera merge conflicts.

División por dominio resuelve los 4 puntos.

## Routers grandes a partir

| Router | Líneas | Estado |
|---|---:|---|
| `routers/warranties/` | 5279 | [HECHO] completo (paquete creado, **9/9 sub-modulos extraidos**) |
| `routers/payroll/` | 1227 | [HECHO] completo (paquete creado, **3/3 sub-modulos extraidos**) |
| `routers/remitos/` | 978 | [HECHO] completo (paquete creado, **8/8 sub-modulos extraidos**) |
| `routers/sales_web/` | 749 | [HECHO] completo (paquete creado, **4/4 sub-modulos extraidos**) |
| `routers/budgets/` | 601 | [HECHO] completo (paquete creado, **3/3 sub-modulos extraidos**) |
| `routers/price_cost_updates/` | 603 | [HECHO] completo (paquete creado, **5/5 sub-modulos extraidos**) |

## El patrón

### Paso 1 · Convertir archivo a paquete

```
ANTES                            DESPUÉS
routers/warranties.py            routers/warranties/
                                 └── __init__.py    (= contenido original)
```

```bash
mkdir app/routers/warranties
mv app/routers/warranties.py app/routers/warranties/__init__.py
```

**Importante:** los imports relativos suben un nivel.

| Era | Pasa a |
|---|---|
| `from ..audit import audit` | `from ...audit import audit` |
| `from .notifications import notify_many` | `from ..notifications import notify_many` |

Razón: el módulo pasó de estar 2 niveles profundo (`app.routers.warranties`) a 3 niveles (`app.routers.warranties.__init__`).

**Validación:** `from app.routers import warranties; len(warranties.router.routes)` debe devolver el mismo número que antes. Si es así, cero cambio funcional.

### Paso 2 · Extraer sub-módulos uno por uno

Para cada dominio (ej. `reset`, `sync`, `provider`):

1. **Crear `<dominio>.py` dentro del paquete** con un `APIRouter` propio (sin prefix, hereda del padre cuando se monta).
2. **Mover los endpoints + helpers privados que solo esos endpoints usan.**
3. **Importar símbolos compartidos del paquete padre** con `from . import xxx` (apunta a `__init__.py`).
4. **Importar dependencias externas** con `from ...xxx` (sube al paquete `app`).
5. **En `__init__.py`**, eliminar los endpoints movidos y agregar al final:

   ```python
   # ── Sub-routers ──
   from . import reset as _reset_module  # noqa: E402
   router.include_router(_reset_module.router)
   ```

   El import va AL FINAL porque el sub-módulo importa símbolos del `__init__.py`. Cuando se ejecuta este `from . import reset`, todo lo que reset necesita ya está definido arriba.

### Estructura final del paquete

```
app/routers/warranties/
├── __init__.py    ← router unificado + constantes/modelos/helpers compartidos
├── intake.py      ← /options, /products, POST /entries
├── review.py      ← /review-queue, /take-review, /mark-incomplete, /approve-review
├── provider.py    ← /confirm-shipment, /send-provider, /pickup-request, /response, ...
├── lifecycle.py   ← /cancel, DELETE /{id}, /entry-base, GET /{id}, /history, PATCH /{id}
├── listing.py     ← /list, /management, /delayed
├── exports.py     ← /counters, /export/*, /exports/*
├── sync.py        ← /sync/status, /sync/logs, /sync/setup-sheet, /sync/push-to-sheet
├── config.py      ← /config GET/PATCH, /diagnostics, /dashboard
└── reset.py       ← /production-reset/preview, /backup, /execute  ✅ extraído
```

### Orden de registro (gotcha)

El router de `warranties` tiene un catch-all `GET /{warranty_id}` en `lifecycle.py`. **Tiene que registrarse al final** porque cualquier ruta más específica registrada después quedaría tapada por el catch-all.

Orden recomendado en `__init__.py`:

```python
# ── Sub-routers ──
from . import (
    intake, review, provider, listing,
    exports, sync, config, reset,
    lifecycle,  # ← catch-all, último
)
for mod in (intake, review, provider, listing, exports, sync, config, reset, lifecycle):
    router.include_router(mod.router)
```

### Estado actual (Fase B.1 · warranties.py)

| Sub-módulo | Endpoints | Estado |
|---|---:|---|
| `reset.py` | 3 | ✅ extraído + persistente en imagen Docker |
| `sync.py` | 4 | ✅ extraído + persistente en imagen Docker |
| `intake.py` | 3 (incl. `POST /entries` de 380 líneas) | ✅ extraído + persistente en imagen Docker |
| `review.py` | 4 | ✅ extraído + persistente en imagen Docker |
| `provider.py` | 8 | ✅ extraído + persistente en imagen Docker |
| `lifecycle.py` | 6 | ✅ extraído + persistente en imagen Docker (catch-all registrado último) |
| `listing.py` | 3 | ✅ extraído + persistente en imagen Docker |
| `exports.py` | 8 | ✅ extraído + persistente en imagen Docker |
| `config.py` | 4 (incl. `/diagnostics` ~330 líneas y `/dashboard` ~130 líneas) | ✅ extraído + persistente en imagen Docker |

**Verificación runtime:** `len(warranties.router.routes) == 43` (igual que antes de la división). Smoke `/api/health` → 200. Smoke autorizado con admin seed: `/api/warranties/list`, `/review-queue`, `/counters`, `/export/eligible`, `/config`, `/diagnostics`, `/dashboard`, `/options`, `/products`, `POST /entries` con body inválido → 422 esperado y lifecycle `GET /NOPE` / `GET /NOPE/history` → 404 esperado. Smoke provider: `POST /api/warranties/NOPE/status` → 404 esperado (ruta alcanzada, garantía inexistente).

**Imagen Docker rebuildeada:** la estructura del paquete está dentro de la imagen, no solo en bind-mount. Si el container se recrea, el cambio persiste.

### Estado actual (Fase B.2 · payroll + remitos)

| Router | Sub-modulos | Rutas | Estado |
|---|---|---:|---|
| `payroll/` | `listing.py`, `uploads.py`, `lifecycle.py` | 10 | [HECHO] extraido + persistente en imagen Docker |
| `remitos/` | `availability.py`, `deposit_transfer.py`, `provider.py`, `generation.py`, `listing.py`, `receive.py`, `lookup.py`, `lifecycle.py` | 16 | [HECHO] extraido + persistente en imagen Docker |

**Verificacion runtime:** `len(payroll.router.routes) == 10` y
`len(remitos.router.routes) == 16`. Smokes autorizados con admin seed:
`GET /api/payroll/receipts?limit=5` -> 200, `GET /api/payroll/receipts/NOPE`
-> 404 esperado; `GET /api/warranties/remitos/?limit=5` -> 200,
`GET /api/warranties/remitos/NOPE` -> 404 esperado,
`GET /api/warranties/remitos/by-code/NOPE` -> 404 esperado y
`POST /api/warranties/remitos/batch-pickup` con body invalido -> 422 esperado.

**Orden de rutas:** `remitos/lifecycle.py` queda registrado al final porque
contiene rutas dinamicas `/{remito_code}`. `receive.py` y `lookup.py` quedan
antes para preservar los endpoints estaticos de busqueda/recepcion.

### Estado actual (Fase B.3 · sales_web)

| Router | Sub-modulos | Rutas | Estado |
|---|---|---:|---|
| `sales_web/` | `options.py`, `catalog.py`, `requests.py`, `lifecycle.py` | 11 | [HECHO] extraido + persistente en imagen Docker |

**Verificacion runtime:** `len(sales_web.router.routes) == 11`. Smokes
autorizados con admin seed: `GET /api/sales-web/options` -> 200,
`GET /api/sales-web/products?q=z` -> 200, `GET /api/sales-web/requests?limit=5`
-> 200 y `GET /api/sales-web/requests/999999999` -> 404 esperado.

**Nota de validacion:** `GET /api/sales-web/products?q=zzzzzz` puede devolver
500 en Docker si no hay token OAuth de Google configurado, porque la busqueda
real intenta cargar catalogo desde Sheets. Para validar la ruta sin depender de
Google, usar una busqueda corta (`q=z`), que retorna lista vacia antes de tocar
Sheets.

**Decision de arquitectura:** `sales_web` se parte antes de implementar ERP para
que la integracion futura entre como un submodulo propio (`erp.py`, por ejemplo)
sin mezclar contrato ERP, AFIP lookup, reintentos y estados externos con la
carga/listado/lifecycle local.

### Estado actual (Fase B.3 · budgets)

| Router | Sub-modulos | Rutas | Estado |
|---|---|---:|---|
| `budgets/` | `options.py`, `catalog.py`, `entries.py` | 3 | [HECHO] extraido + persistente en imagen Docker |

**Verificacion runtime:** `len(budgets.router.routes) == 3`. Smokes
autorizados con admin seed: `GET /api/budgets/options` -> 200,
`GET /api/budgets/products?q=z` -> 200 y `POST /api/budgets/entries` con body
invalido -> 422 esperado.

**Compatibilidad interna:** `sales_web/` y `price_cost_updates/` siguen
importando helpers compartidos desde `budgets/` (`BudgetProduct`,
`load_product_catalog`, `normalize_text`, `parse_decimal_ar`, `sheet_money`,
etc.). Por eso esos helpers quedan exportados desde `budgets/__init__.py`.

### Estado actual (Fase B.3 · price_cost_updates)

| Router | Sub-modulos | Rutas | Estado |
|---|---|---:|---|
| `price_cost_updates/` | `lookup.py`, `listing.py`, `creation.py`, `lifecycle.py`, `history.py` | 8 | [HECHO] extraido + persistente en imagen Docker |

**Verificacion runtime:** `len(price_cost_updates.router.routes) == 8`.
Smokes autorizados con admin seed: `GET /api/price-cost-updates?limit=5` -> 200,
`GET /api/price-cost-updates/999999999` -> 404 esperado,
`GET /api/price-cost-updates/999999999/history` -> 404 esperado y
`POST /api/price-cost-updates` con body invalido -> 422 esperado.

**Nota tecnica:** este router conserva endpoints raiz
(`GET/POST /api/price-cost-updates`) sin slash final. Para preservar esas URLs,
el router padre queda sin prefix y cada submodulo registra el prefix completo
`/api/price-cost-updates`.

**Decision de arquitectura:** las proximas funciones comerciales de
precios/costos (vista de nuevos/completados, archivado por antiguedad,
agrupacion por marca y PDFs comerciales por marca) deben entrar como submodulos
nuevos, por ejemplo `archive.py`, `exports.py` o `pdfs.py`, sin mezclar la
logica ya estabilizada de lookup/listado/creacion/lifecycle/historial.

## Reglas

### R1 · El frontend no debe romper

- Los paths quedan idénticos (`/api/warranties/...`).
- Los response models quedan idénticos.
- La lógica de permisos queda idéntica.

Validar después de cada extracción: `len(router.routes)` antes y después debe ser el mismo, y los paths también.

### R2 · Helpers compartidos en el `__init__.py`

Cosas que usan varios sub-módulos (constantes, modelos Pydantic, helpers como `_user_role_keys`) viven en `__init__.py`. Los sub-módulos los importan con `from . import xxx`.

Si un helper resulta ser usado por solo un sub-módulo después de la división, se mueve a ese sub-módulo.

### R3 · No tocar `main.py`

El registro en `main.py` (`from .routers import warranties; app.include_router(warranties.router)`) no cambia porque el paquete expone el `router` igual que el archivo monolítico lo hacía.

### R4 · Container debe rebuildearse al final

Mientras se trabaja en host, el container tiene la imagen vieja. Para validar cambios en runtime hay que copiar al container con `docker cp` (rápido pero efímero). Al cerrar Fase B se debe rebuildear:

```powershell
docker compose build backend
docker compose up -d backend
```

## Cierre de Fase B

**Estado:** [HECHO]. Los routers grandes definidos para esta fase ya fueron
convertidos a paquetes y divididos por dominio:

- `warranties/`: 9 submodulos, 43 rutas.
- `payroll/`: 3 submodulos, 10 rutas.
- `remitos/`: 8 submodulos, 16 rutas.
- `sales_web/`: 4 submodulos, 11 rutas.
- `budgets/`: 3 submodulos, 3 rutas.
- `price_cost_updates/`: 5 submodulos, 8 rutas.

**Proximo paso recomendado:** avanzar a Fase C (auditoria intensa de codigo
muerto y helpers duplicados) o abrir una fase funcional nueva para precios/costos
si se priorizan vistas de nuevos/completados, archivado automatico y PDFs por
marca.

**Gotchas detectados en B.1:**

- **Imports relativos suben un nivel** cuando se convierte a paquete (`..xxx` → `...xxx`, `.xxx` → `..xxx`).
- **Container Docker** tiene el código de la imagen, no del host. Para validar cambios hay que `docker cp` (efímero) o `docker compose build` (persistente).
- **`/sync/pull-from-sheet`** ya fue eliminado en Fase 2.5h.2e (PG fuente única). No reaparece.
- **Ciclo de imports** se evita poniendo `from . import xxx` al FINAL del `__init__.py`, no al principio.
- **Rutas dinamicas** como `/{remito_code}` o `/{id}` deben registrarse despues de rutas estaticas del mismo dominio.
- **Integraciones futuras** deben entrar como submodulos nuevos despues del split, no dentro de archivos gigantes ya estabilizados.

## Decisiones para trabajo futuro

- **ERP ventas:** no implementar dentro del monolito viejo. La base ya quedo en
  `sales_web/`; el modulo ERP futuro debe vivir aislado (por ejemplo `erp.py`)
  y apoyarse en `requests.py`/`lifecycle.py` sin cambiar los paths actuales.
- **Presupuestos (`budgets/`):** ya quedo modularizado antes de agregar nuevas
  funciones o reutilizacion de catalogo/PDFs. Mantener helpers compartidos
  exportados porque otros modulos los consumen.
- **Precios y costos (`price_cost_updates/`):** ya quedo modularizado antes de
  sumar nuevas vistas de "nuevos/completados", archivo automatico por antiguedad,
  division por marcas y PDFs comerciales por marca. Esas funciones deben entrar
  como submodulos nuevos de listado/lifecycle, archivo, exportacion/PDFs o
  historial.

## Después de Fase B (toda)

Con los routers grandes partidos:

- **Fase A.5.4** (display strings) se puede ejecutar — ya no es trabajo masivo porque cada dominio está aislado.
- **Fase C** (auditoría intensa de código muerto) se hace sobre archivos chicos y manejables.
- **Re-usar el patrón** en otros routers grandes si surgieran después.

## Fases B.2 y B.3 (otros routers)

Estado actual:

- **B.2** · `payroll/` y `remitos/`: [HECHO].
- **B.3** · `sales_web/`, `budgets/` y `price_cost_updates/`: [HECHO].

Fase B queda cerrada. Proximo bloque recomendado: Fase C, salvo que se priorice
una funcionalidad nueva.
