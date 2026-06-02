# Administración de la base — día a día

Cómo trabajar con la base PostgreSQL: ver/editar datos, backups, restaurar,
correr migraciones. Mismo flujo en Windows (Docker Desktop) y en VPS Linux.

---

## Las herramientas

| Herramienta | Para qué | Cómo se accede |
|---|---|---|
| **Adminer** (web, en el compose) | "Dashboard" estilo Supabase: ver tablas, correr SQL, editar filas. | `http://localhost:8080` (con sesión SSH si es el VPS) |
| **DBeaver / TablePlus** (escritorio, opcional) | Cliente nativo más cómodo para queries complejas. | Conectás a `localhost:5432` con el `DATABASE_URL` |
| **psql** (CLI) | Comandos rápidos, scripts. | `docker compose exec postgres psql -U electrogv electrogv` |
| **`electrogv.bat`** | Panel local para migrar, seed, backup, restore, ngrok y Android. | Doble clic |

---

## Acceso en LOCAL (laptop, Docker Desktop)

Postgres está bindeado a `127.0.0.1:5432` (solo tu PC lo ve). Adminer igual en `127.0.0.1:8080`.

### Adminer
1. Levantá la app: `electrogv.bat` opción `1`.
2. Abrí http://localhost:8080
3. Login:
   - **Motor:** PostgreSQL
   - **Servidor:** `postgres` (nombre del servicio del compose)
   - **Usuario:** `electrogv` (de tu `.env`)
   - **Contraseña:** la que pusiste en `POSTGRES_PASSWORD`
   - **Base:** `electrogv`

### DBeaver / TablePlus
- Host: `localhost`
- Puerto: `5432`
- DB / User / Pass: los mismos del `.env`.

### LAN (otras PCs de la misma wifi)
Solo si lo querés explícitamente: en `docker-compose.yml`, cambiá
`127.0.0.1:5432:5432` → `5432:5432`. Desde otra PC se conecta a `192.168.x.x:5432`.
**Solo en redes confiables.**

---

## Acceso al VPS (cuando exista)

La regla: **ni Postgres ni Adminer se exponen a internet**. Solo el puerto 22 (SSH)
y 443 (HTTPS del backend, vía Caddy). Las dos formas de entrar a la DB:

### Opción 1 · SSH tunnel (cero infra)

Cuando querés trabajar con la base remota:

1. Abrís terminal en tu PC y corrés:
   ```bash
   ssh -L 8080:localhost:8080 -L 5432:localhost:5432 victor@tu-vps.com
   ```
   Esto redirige tu `localhost:8080` y `localhost:5432` al VPS, cifrado por SSH.

2. Mientras esa terminal esté abierta:
   - http://localhost:8080 → Adminer del VPS.
   - DBeaver → `localhost:5432` → Postgres del VPS.

3. Para cortar el acceso, cerrás la terminal SSH. El túnel muere.

Sin atajo local activo por ahora: cuando exista VPS, usar el comando SSH de
arriba o agregar una opción nueva al panel `electrogv.bat`.

### Opción 2 · Tailscale (recomendado cuando se vuelva habitual)

Crea una red privada virtual entre tu(s) PC(s) y el VPS, sin abrir puertos públicos.

**Setup (una sola vez):**
1. Cuenta gratis en https://tailscale.com (login con Google/GitHub).
2. Instalá el cliente en tu PC (Windows installer normal).
3. En el VPS: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
   → autorizás el dispositivo desde la cuenta.

**Día a día:**
- Tu VPS aparece en la red Tailscale con una IP `100.x.x.x` (o nombre `electrogv-vps`).
- Abrís `http://electrogv-vps:8080` en el navegador → Adminer (sin SSH).
- DBeaver: `electrogv-vps:5432`.
- Para sumar otra PC o un colaborador: instalan Tailscale y le das acceso. Listo.

---

## Backups

### Automáticos (sin hacer nada)
El compose levanta un contenedor `db-backup` que corre `pg_dump` **cada noche** y
guarda los últimos N días en `backend/backups/`. Política por defecto:
- 7 días diarios
- 4 semanales
- 3 mensuales

### Manual on-demand
En `electrogv.bat`, opción `12`:
- Genera `backend/backups/manual-dev-YYYY-MM-DD_HH-MM.sql`.

Equivalente a:
```bash
docker compose exec -T postgres pg_dump -U electrogv electrogv > backups/manual.sql
```

### Restaurar
En `electrogv.bat`, opción `14`, elegís el archivo `.sql`, o:
```bash
docker compose exec -T postgres psql -U electrogv electrogv < backups/manual.sql
```

> **Atención:** restaurar reemplaza el contenido. Hacé backup antes de restaurar.

---

## Migraciones (Alembic)

Cuando cambia el esquema (nuevas columnas, tablas, índices):

1. **Definir el cambio en el modelo** (`app/models/...`).
2. **Generar la migración:**
   ```bash
   docker compose exec backend alembic revision --autogenerate -m "agrega columna X"
   ```
   Esto crea un archivo en `backend/alembic/versions/` con `upgrade()` y `downgrade()`.
3. **Revisar** el archivo generado (Alembic acierta el 95%; corregir si hace falta).
4. **Aplicar:**
   ```bash
   docker compose exec backend alembic upgrade head
   ```
   O el atajo: `electrogv.bat` opción `2`.

Comandos útiles:
- `alembic current` — versión actual de la DB.
- `alembic history` — historial.
- `alembic downgrade -1` — revertir una migración.

---

## Tareas frecuentes (referencia rápida)

| Tarea | Comando |
|---|---|
| Ver logs de Postgres | `docker compose logs postgres -f` |
| Conectar con psql | `docker compose exec postgres psql -U electrogv electrogv` |
| Listar tablas | `\dt` (dentro de psql) |
| Tamaño de las tablas | `\dt+` |
| Salir de psql | `\q` |
| Reiniciar Postgres | `docker compose restart postgres` |
| Ver backups | `dir backend\backups\` (Win) · `ls backend/backups/` (Linux) |

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| Adminer no conecta | Servicio postgres aún no healthy | Esperar 10-20s y reintentar; ver `docker compose ps` |
| "FATAL: password authentication failed" | Password en `.env` no coincide con el del volumen | Revisar `POSTGRES_PASSWORD`; si la base ya tenía otra pass, hay que recrear el volumen `pgdata` o cambiar la pass dentro |
| Backup falla | El contenedor `db-backup` no arrancó | `docker compose logs db-backup` |
| `alembic upgrade` falla con conflicto | Migraciones desfasadas | `alembic current` + `alembic history` para entender; revertir/corregir |
