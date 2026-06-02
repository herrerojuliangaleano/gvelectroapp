# Cómo usar Docker — ElectroGV (Fase 1)

Guía simple para correr la app en un contenedor. **Fase 1**: solo el backend (sigue
con SQLite). El frontend sigue en su servicio (Vercel) y le pega al backend por su URL/ngrok.

---

## 0. Qué es esto (en 30 segundos)
- Un **contenedor** es una "caja" con la app + todo lo que necesita (Python, librerías).
  Corre igual en tu PC o en un servidor. No más "en mi máquina anda".
- **docker compose** levanta esa caja con **un comando**.
- Tu forma de trabajar NO cambia: el backend corre en tu PC (ahora dentro de Docker)
  y lo exponés con **ngrok** como siempre.

---

## 1. Requisito único: instalar Docker Desktop
1. Descargá **Docker Desktop** para Windows: https://www.docker.com/products/docker-desktop/
2. Instalalo (acepta activar **WSL2** si te lo pide).
3. Abrí **Docker Desktop** y esperá a que el ícono diga **"Engine running"**.

> Docker Desktop tiene que estar **abierto** cada vez que quieras levantar la app.

---

## 2. Primera vez (setup)
1. Asegurate de tener el archivo `backend/.env`. Si no existe, copiá la plantilla:
   - `backend/.env.docker.example` → guardalo como `backend/.env`
   - Editá `AUTH_SECRET`, `CORS_ORIGINS` (tu URL de Vercel y de ngrok), etc.
2. Doble clic en **`electrogv.bat`** (en la raíz del proyecto) y elegí la opción `1`.
   - La **primera vez** compila la imagen (puede tardar unos minutos). Las siguientes son rápidas.
3. Cuando termine, abrí en el navegador: http://localhost:8000/api/health
   - Si ves `{"ok": true, ...}` → está andando. 🎉

---

## 3. Uso diario
- **Encender DEV:** `electrogv.bat` opción `1`.
- **Apagar DEV:** `electrogv.bat` opción `5`.
- **Exponer DEV con ngrok:** `electrogv.bat` opción `4`.

Eso es todo para el día a día.

---

## 4. Comandos útiles (terminal, en la raíz del proyecto)
```bash
docker compose up -d --build   # levantar (compila si hace falta), en segundo plano
docker compose logs -f         # ver logs en vivo (Ctrl+C para salir, NO apaga la app)
docker compose ps              # ver estado/health del contenedor
docker compose restart         # reiniciar
docker compose down            # apagar
docker compose up -d --build --force-recreate   # rehacer desde cero si algo quedó raro
```

---

## 5. ¿Dónde quedan los datos?
Todo lo importante vive en **`backend/storage/`** (montado como volumen):
- `electrogv.sqlite3` → la base
- `uploads/`, `outputs/` → fotos, recibos PDF, exports
- `private/` → usuarios, roles, credenciales de Google

> Reconstruir la imagen **no borra** estos datos. Solo se borran si vos borrás esa carpeta.

---

## 6. Problemas comunes
| Síntoma | Solución |
|---|---|
| `docker: command not found` o "Docker no está corriendo" | Abrí Docker Desktop y esperá "Engine running". |
| El build falla descargando paquetes | Revisá internet; reintentá `electrogv.bat` opción `1`. |
| Cambié código y no se ve | `docker compose up -d --build` (reconstruye). |
| Puerto 8000 ocupado | Cerrá lo que use el 8000, o cambiá el mapeo `8000:8000` en `docker-compose.yml`. |
| Quiero ver qué pasa adentro | `docker compose logs -f` |

---

## 7. Opcional: servir el frontend desde el backend (todo junto)
Si querés probar todo con una sola caja (sin Vercel):
1. `cd frontend && npm run build` (genera `frontend/dist`).
2. En `docker-compose.yml`, descomentá la línea del volumen `./frontend/dist:/app/frontend/dist:ro`.
3. `docker compose up -d --build`. El backend sirve el SPA en http://localhost:8000.

---

## 8. Qué viene (Fase 2)
Agregar **PostgreSQL** como otro servicio del compose y migrar el backend a
SQLAlchemy + Alembic. El comando para levantar va a seguir siendo el mismo
(`electrogv.bat` opción `1`), solo que también arrancará la base Postgres.
