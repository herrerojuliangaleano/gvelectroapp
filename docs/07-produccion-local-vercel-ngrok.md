# Produccion inicial - Vercel + ngrok + Postgres local

Este modo es la **mini-produccion actual** antes del VPS:

```text
Vercel frontend -> ngrok HTTPS -> backend Docker local -> Postgres Docker local
```

La produccion queda separada del desarrollo. Desarrollo usa `electrogv_dev` y
produccion local usa `electrogv`.

## Entrada principal

Para evitar una raiz llena de scripts, el manejo diario se concentra en:

```text
electrogv.bat
```

Ese panel permite levantar/apagar dev, levantar/apagar produccion local, correr
migraciones, seed, ngrok, compilar Android, generar token OAuth Google y
ejecutar operaciones de datos.

Archivos de configuracion relacionados:

- `docker-compose.prod-local.yml`: compose aislado para mini-prod.
- `backend/.env.production.local.example`: plantilla versionable.
- `backend/.env.production.local`: archivo real local, ignorado por Git.
- `frontend/.env.production.example`: variable que debe ir en Vercel.
- `frontend/.env.staging.example`: variable que debe ir en Vercel de prueba.

## Separacion de entornos

| Uso | Desarrollo | Mini-prod local |
|---|---:|---:|
| Backend host | `localhost:8000` | `localhost:8010` |
| Postgres host | `localhost:5432` | `localhost:5433` |
| Adminer | `localhost:8080` | `localhost:8081` |
| pgAdmin (opcional) | `localhost:5050` (ve los dos) | — |
| DB | `electrogv_dev` | `electrogv` |
| Storage host | `backend/storage/` | `backend/storage-prod/` |
| Backups host | `backend/backups/` | `backend/backups-prod/` |
| Volumen Docker | `electrogv-pgdata` | `electrogv-prod-pgdata-local` |

### pgAdmin (alternativa mas completa a Adminer)

Para trabajo "en serio" (modelar schemas, debuggear queries
lentos, ver triggers, etc.) hay un servicio **pgAdmin** opcional
en el compose principal:

```bash
docker compose --profile tools up -d pgadmin
```

Acceso: <http://localhost:5050>

- Email login: `admin@example.com`
- Password login: `electrogv`

Las dos conexiones (dev :5432 + prod-local :5433) **vienen
precargadas** via `infra/pgadmin/servers.json`. Solo hay que
tipear la password del Postgres la primera vez (queda guardada en
el volumen `electrogv-pgdata-pgadmin`).

Para apagar: `docker compose --profile tools down pgadmin`. El
volumen sobrevive para no perder las conexiones guardadas.

Cuando usar Adminer vs pgAdmin:
- **Adminer (8080/8081)**: consulta rapida, edit puntual de filas.
- **pgAdmin (5050)**: modelado de schema, performance, triggers,
  scripts SQL largos, comparacion entre dev y prod-local en una
  misma sesion.

## Puesta en marcha

1. Revisar `backend/.env.production.local`.
   - Ya queda apuntado a `https://electrogv.vayori.net`.
   - Ya queda apuntado a `https://electrogv.ngrok.dev`.
   - `WARRANTY_SPREADSHEET_URL` puede quedar vacio hasta conectar Google.
   - Los JSON reales de Google/Firebase no van al repo; se copian en storage.
2. Doble clic en `electrogv.bat`.
3. Opcion `6` para levantar PROD local.
4. Opcion `7` para migrar PROD local.
5. Opcion `8` para seed de PROD local.
6. Opcion `9` para exponer PROD local con ngrok.
7. Copiar la URL HTTPS de ngrok.
8. En Vercel, configurar:
   - Project root: `frontend`
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variable produccion: `VITE_API_BASE_URL=https://electrogv.ngrok.dev`
   - Environment variable prueba: `VITE_API_BASE_URL=https://electrogvdev.ngrok.dev`
   - Si no se configura `VITE_API_BASE_URL`, `frontend/vercel.json` usa como
     fallback `https://electrogvdev.ngrok.dev` para no pegarle a produccion
     durante las pruebas.
9. Deploy en Vercel.

## Donde poner los JSON

Para **mini-prod local**:

```text
backend/storage-prod/private/credentials.local.json
backend/storage-prod/private/firebase-service-account.json
```

- `credentials.local.json`: OAuth client de Google.
- `firebase-service-account.json`: service account de Firebase Admin.
- `token.json`: se genera en `backend/storage-prod/private/token.json` cuando
  conectes Google desde el panel o con el bootstrap OAuth.

Para **desarrollo** siguen siendo:

```text
backend/storage/private/credentials.local.json
backend/storage/private/firebase-service-account.json
```

Tambien existe compatibilidad vieja con:

```text
backend/secrets/credentials.local.json
backend/secrets/firebase-service-account.json
```

pero para mini-prod usar `backend/storage-prod/private/`.

## Logos para PDFs y Excels

Los exports de PDF/Excel resuelven los logos desde el storage activo del
backend. En desarrollo el storage es `backend/storage/`; en mini-prod local es
`backend/storage-prod/`.

Archivos esperados:

```text
backend/storage/logos/gv_electro.png
backend/storage/logos/abc_electro.png
backend/storage-prod/logos/gv_electro.png
backend/storage-prod/logos/abc_electro.png
```

El panel `electrogv.bat` copia automaticamente los logos de desarrollo a
`storage-prod/logos/` al levantar mini-prod local. Si se cambia un logo, copiarlo
tambien al storage del entorno que esta sirviendo la app.

Para **Android Firebase / push nativo**, el archivo no es el mismo que el del
backend. Debe ir en:

```text
frontend/android/app/google-services.json
```

Para generar `token.json` de Google en Windows:

1. Copiar `credentials.local.json` en `backend/storage/private/`.
2. Abrir `electrogv.bat`.
3. Usar la opcion `18`.
4. Autorizar Google en el navegador.
5. Volver a la pantalla OAuth Google y tocar `Actualizar estado`.

## Remotes Git

Convencion actual del proyecto:

| Remote | Uso | Repo |
|---|---|---|
| `origin` | Produccion | `herrerojuliangaleano/gvelectroapp` |
| `repo2` | Prueba / staging | `herrerojuliangaleano/electrogv` |

La forma segura de trabajar es:

1. Desarrollar y validar localmente.
2. Publicar primero a prueba:

```powershell
git push repo2 HEAD:main
```

3. Probar Vercel + ngrok contra la base de prueba.
4. Cuando este validado, publicar a produccion:

```powershell
git push origin HEAD:main
```

Vercel de prueba deberia estar conectado a `repo2`. Vercel de produccion
deberia estar conectado a `origin`.

## Flujo prueba -> produccion con datos cargados

Mientras se completan las piezas faltantes, se puede usar el entorno de prueba
para cargar los datos base necesarios y despues elevarlos a produccion.

Flujo recomendado si todavia no hay usuarios reales escribiendo en produccion:

1. Levantar prueba con Postgres aislado.
2. Cargar empresas, sucursales, roles, permisos, usuarios, catalogos y datos
   operativos necesarios.
3. Validar login, permisos y modulos principales desde Vercel de prueba.
4. Congelar escrituras por unos minutos.
5. Hacer backup de la DB de prueba.
6. Restaurar ese backup en la DB de produccion durante el corte, o usar la
   opcion `17` de `electrogv.bat` si la prueba cargada vive en dev local.
7. Apuntar Vercel de produccion al ngrok/backend de produccion.
8. Hacer smoke final con usuario admin y un usuario comun.

Si produccion ya tiene usuarios cargando datos reales, no alcanza con restaurar
la base de prueba encima. En ese caso hay que preparar una migracion/merge por
tablas para no pisar datos nuevos.

## Opciones de datos en `electrogv.bat`

| Opcion | Accion | Cuidado |
|---:|---|---|
| 12 | Backup de dev (`electrogv_dev`) | No borra nada |
| 13 | Backup de prod local (`electrogv`) | No borra nada |
| 14 | Restaura dev desde SQL | Borra dev, pide `RESTORE` |
| 15 | Restaura prod local desde dump | Borra prod, pide `RESTORE-PROD` |
| 16 | Copia prod local hacia dev | Borra dev, pide `CLONAR` |
| 17 | Copia dev hacia prod local | Borra prod, pide `PROMOVER` y hace backup defensivo |

## Checklist de smoke

- `http://localhost:8010/api/health` responde OK.
- Login admin funciona.
- Vercel abre la app y pega al ngrok correcto.
- `GET /api/sales-web/requests?limit=5` responde.
- `GET /api/warranties/list` responde.
- `GET /api/warranties/remitos/?limit=5` responde.
- `GET /api/price-cost-updates?limit=5` responde.
- Adminer mini-prod entra en `http://localhost:8081` con:
  - Sistema: PostgreSQL
  - Servidor: `postgres-prod`
  - Usuario/clave/base: los valores `PROD_POSTGRES_*`.

## Regla de seguridad

No usar la DB de desarrollo para Vercel/ngrok produccion. Si hay que probar un
cambio nuevo, probarlo en `repo2` o en desarrollo y recien despues empujarlo a
`origin`.

## Switch dev → prod paso a paso (procedure validado)

Procedure usado para promover dev a prod local. Es el camino corto cuando no
hace falta merge de tablas (prod arranca limpia o el operador autoriza
sobreescribir).

### 0. Pre-flight

```bash
# Verificar que no hay cambios sin commitear que vayan a perderse
git status

# Confirmar que estás en main
git branch --show-current
```

### 1. Push del código a Vercel

```bash
git push origin main
```

Vercel detecta el push y empieza a buildear el frontend automáticamente
(https://electrogv.vayori.net). Mirá el progreso en
https://vercel.com/herrerojuliangaleanos-projects.

### 2. Levantar prod Postgres (sin backend todavía)

```bash
docker compose --env-file backend/.env.production.local \
  -f docker-compose.prod-local.yml up -d postgres-prod
```

Esperá a que esté healthy:

```bash
until docker exec electrogv-postgres-prod pg_isready \
  -U electrogv_prod -d electrogv 2>/dev/null; do sleep 2; done
```

### 3. Dump dev → restore prod

```bash
# Dump completo, sin owner/acl (los users son distintos: electrogv vs electrogv_prod)
docker exec electrogv-postgres pg_dump \
  -U electrogv -d electrogv_dev \
  --no-owner --no-acl --no-privileges --clean --if-exists \
  > backend/backups-prod/dev-snapshot.sql

# Restore en prod
docker exec -i electrogv-postgres-prod psql \
  -U electrogv_prod -d electrogv < backend/backups-prod/dev-snapshot.sql
```

### 4. Apagar dev y levantar prod completo

```bash
docker compose down
docker compose --env-file backend/.env.production.local \
  -f docker-compose.prod-local.yml up -d --build
```

### 5. Migrar y verificar

```bash
# Alembic upgrade
docker exec electrogv-backend-prod alembic upgrade head

# Health
curl -s http://localhost:8010/api/health

# Conteo sanity check
docker exec electrogv-postgres-prod psql -U electrogv_prod -d electrogv -c "
SELECT 'guarantees', COUNT(*) FROM guarantees
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'users', COUNT(*) FROM users;
"
```

### 6. Ngrok prod

Si ya hay un proceso ngrok corriendo apuntando al dominio prod, no hace falta
levantarlo de nuevo. Verificar:

```bash
curl -s https://electrogv.ngrok.dev/api/health
```

Si no responde, levantarlo desde `electrogv.bat` opción 9.

## Gotchas post-corte (lessons learned)

Dos problemas que aparecieron en el primer corte real. Hay que tenerlos en
mente cada vez que se cambia el origen de datos de prod.

### 1. Contadores no se sincronizan con el restore

`pg_dump`/`restore` copia la tabla `guarantee_counters` tal cual está, **pero
si los datos en `guarantees` vinieron por otro camino** (import histórico,
inserts directos a Postgres, etc.), los contadores quedan desincronizados.

Resultado: al primer intento de crear una garantía nueva el sistema empieza
desde el contador (que puede ser 0) y choca con `UNIQUE violation` contra los
warranty_codes existentes.

**Fix**: ejecutar el resync nativo después de cualquier carga masiva.

```http
POST /api/warranties/counters/resync
```

O desde la línea de comandos del backend:

```bash
docker exec electrogv-backend-prod python -c \
  "from app.warranties_db import pg_resync_counters; print(pg_resync_counters())"
```

Verificación:

```sql
SELECT year, sucursal_code, last_number FROM guarantee_counters;
```

### 2. Token OAuth de Google no se replica automáticamente

El backend prod necesita un `token.json` válido en
`backend/storage-prod/private/` para que funcionen:

- El sync de productos desde Planilla Madre.
- La feature **Herramientas** (scripts legacy que usan Google Sheets/Drive).

Si el token solo existe en `backend/storage/private/` (dev), las Herramientas
revientan en prod con:

```text
webbrowser.Error: could not locate runnable browser
```

porque el script `eb.py`/`gpd.py` intenta hacer OAuth desde dentro del
container Docker, que no tiene browser.

**Fix automatizado**: `electrogv.bat` opción 18 (**Generar token OAuth
Google**) ahora replica el token a `storage-prod/private/` automáticamente
después de generarlo. Como el `credentials.local.json` es el mismo OAuth
client en dev y prod, el mismo token vale para ambos.

**Fix manual** (si el token de dev ya existe y solo hay que copiarlo):

```bash
cp backend/storage/private/token.json backend/storage-prod/private/token.json
```

### 3. Bug histórico: garantías "flotantes" en Mi Sucursal

Si el último import trajo garantías con `ubicacion_actual="Depósito Chiclana"`
pero sin `transit_status="en_deposito"`, van a aparecer como pendientes de
despacho en la pantalla Mi Sucursal aunque ya están físicamente en el
depósito.

Ver `docs/09-import-historico-excel.md` sección "Pasos POST-IMPORT
obligatorios → 2. Mover garantías flotantes al depósito" para el bulk UPDATE
con audit trail.
