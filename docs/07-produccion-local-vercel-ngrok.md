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
| DB | `electrogv_dev` | `electrogv` |
| Storage host | `backend/storage/` | `backend/storage-prod/` |
| Backups host | `backend/backups/` | `backend/backups-prod/` |
| Volumen Docker | `electrogv-pgdata` | `electrogv-prod-pgdata-local` |

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
