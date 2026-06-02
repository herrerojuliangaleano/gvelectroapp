# Deploy en VPS Linux (Fase 3 · futuro)

Cuando la Fase 2 esté terminada y la app corra 100% sobre Postgres, llevamos el
stack a un VPS. Esto resume cómo va a quedar (no requiere ejecutarlo ahora).

> Idea central: **mismo `docker-compose.yml`**, otro `.env`, ningún rediseño.
> El VPS es "tu laptop con dominio público".

---

## Arquitectura objetivo

```
Internet
   │
   ▼  HTTPS (443)
┌──────────────┐
│    Caddy     │  ← reverse proxy + TLS automático (Let's Encrypt)
└──────┬───────┘
       │ HTTP interno
       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   backend    │───▶│  postgres    │◀───│  db-backup   │
│  (FastAPI)   │    │ (no expuesto)│    │ (pg_dump auto)│
└──────────────┘    └──────────────┘    └──────────────┘
                          ▲
                          │ solo via SSH/Tailscale
                          │
                    ┌──────────────┐
                    │   Adminer    │  ← 127.0.0.1:8080
                    └──────────────┘

Puertos públicos: 80 (Caddy redirect→443), 443 (HTTPS), 22 (SSH).
```

---

## Pasos para el primer deploy

### 1) Preparar el VPS (una vez)
- Distro recomendada: Ubuntu 22.04 o 24.04 LTS.
- Crear usuario no-root con sudo, deshabilitar login root + login por password (solo SSH key).
- Firewall: dejar pasar solo 22, 80, 443.
- Instalar Docker:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
  sudo usermod -aG docker $USER
  ```
- Apuntar tu dominio (ej. `app.electrogv.com`) al IP del VPS (registro A).

### 2) Traer el repo y configurar
```bash
git clone <repo> /opt/electrogv
cd /opt/electrogv
cp backend/.env.docker.example backend/.env
nano backend/.env  # ← editar AUTH_SECRET, POSTGRES_PASSWORD, CORS_ORIGINS (con tu dominio)
```

### 3) Levantar el stack
```bash
docker compose up -d
docker compose exec backend alembic upgrade head   # crea el esquema desde cero
docker compose exec backend python -m app.seed     # admin + companies + branches
```

### 4) Caddy delante (HTTPS automático)
En la raíz del proyecto va a haber un `Caddyfile` así:
```caddy
app.electrogv.com {
    reverse_proxy backend:8000
    encode gzip
}
```
Y se suma al compose como otro servicio (perfil `prod`). Caddy se encarga del
certificado Let's Encrypt automáticamente.

---

## Que la app quede "siempre arriba"

Está pensado:

1. **`restart: unless-stopped`** en todos los servicios — si crashea, vuelve.
2. **Docker arranca con el sistema** (systemd lo deja habilitado al instalar).
3. **`restart: unless-stopped` + Docker enabled + reverse proxy** = uptime 24/7 sin demonios extra.
4. **Logs rotados** en el compose (`max-size`, `max-file`) para que no llenen el disco.

Reinicio del VPS (corte, update kernel): Docker arranca → contenedores con
`unless-stopped` vuelven → backend operativo en <30s.

Comprobación manual:
```bash
docker compose ps          # estado
docker compose logs -f     # logs en vivo
```

---

## Acceso a la base remota
Postgres y Adminer **no se exponen** a internet (bindeados a `127.0.0.1` del VPS).

Para administrar:
- **SSH tunnel** (simple): `ssh -L 8080:localhost:8080 -L 5432:localhost:5432 user@vps`
- **Tailscale** (más cómodo): instalar agente en VPS y en tu(s) PC(s); accedés a
  `electrogv-vps:8080` como si fuera LAN. Detalles en
  [`02-administracion-db.md`](02-administracion-db.md).

---

## Updates de la app (releases)
```bash
cd /opt/electrogv
git pull
docker compose pull              # imágenes externas (postgres, adminer, etc.)
docker compose build backend     # rebuild backend con código nuevo
docker compose up -d             # aplica el cambio
docker compose exec backend alembic upgrade head   # si hay migraciones
```
Downtime: pocos segundos (recreate del contenedor backend).

> Si querés zero-downtime: se puede sumar un blue-green simple, pero no hace
> falta al principio.

---

## Backups en producción
- El contenedor `db-backup` deja dumps en `/opt/electrogv/backend/backups/`.
- **Recomendación:** sumar un cron / systemd timer en el VPS que copie esos
  dumps a una cuenta externa (Google Drive, S3, otro VPS) — el "offsite backup"
  para no perderlo todo si se quema el VPS.

Ejemplo simple con `rclone`:
```bash
0 4 * * * rclone copy /opt/electrogv/backend/backups gdrive:electrogv-backups
```

---

## Diferencias prácticas con Windows local

| | Local (Windows) | VPS (Linux) |
|---|---|---|
| Arranque | `electrogv.bat` opcion `1` | `docker compose up -d` (o systemd) |
| Acceso público | `ngrok http 8000` | Dominio + Caddy (HTTPS automático) |
| Rutas de volúmenes | `./backend/storage` | `/opt/electrogv/backend/storage` |
| Backups van a | `backend\backups\` | `/opt/electrogv/backend/backups/` |
| Acceso a la base | `localhost:5432` directo | SSH tunnel o Tailscale |
| Reinicio del SO | Manual (cerrás la app) | Automático (Docker enabled at boot) |

Mismo `docker-compose.yml`, mismas imágenes, mismas migraciones, mismos backups.
La operación es **virtualmente idéntica**.
