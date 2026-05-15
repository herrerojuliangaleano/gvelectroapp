# ElectroGV Web Tools

Plataforma web interna para gestión operativa de ElectroGV. Cubre garantías, ventas web, actualizaciones de precios y costos, presupuestos, catálogo de productos, recibos de sueldo y administración de usuarios.

## Arquitectura

```
Backend (FastAPI · Python 3.11)  →  ngrok  →  Internet
                                                   ↑
Frontend (React + Vite · Render)  ────────────────┘
```

- **Backend**: corre localmente en la laptop del operador (`http://127.0.0.1:8000`). Se expone a internet mediante un túnel ngrok con dominio fijo.
- **Frontend**: desplegado en [Render](https://render.com). Se conecta al backend a través de la URL de ngrok definida en `VITE_API_BASE_URL`.
- **Base de datos**: SQLite en `backend/storage/electrogv.sqlite3`. Sin servidor, sin configuración extra.
- **Google Sheets**: integración via OAuth para sincronizar garantías, catálogo de productos y presupuestos.

---

## Módulos

| Módulo | Ruta | Descripción |
|---|---|---|
| **Herramientas** | `/tools` | Scripts legacy de Google Drive ejecutados como jobs web |
| **Garantías** | `/warranties` | Gestión completa del ciclo de garantías, sincronización con Google Sheets |
| **Ventas Web** | `/venta` | Solicitudes de venta online, asignación y seguimiento |
| **Precios y Costos** | `/precios-costos` | Actualizaciones urgentes de PVP y costo con checklist de pasos |
| **Catálogo** | `/productos` | Catálogo sincronizado desde la Planilla Madre (Google Sheets) |
| **Presupuestos** | `/budgets/new` | Generación de presupuestos con productos del catálogo |
| **Recibos de Sueldo** | `/recibos` | Carga, firma y observación de recibos por empleado |
| **Administración** | `/admin/...` | Usuarios, roles, empresas, sucursales, config operacional, backups |

---

## Inicio rápido — Backend

Todo el setup está automatizado. Doble clic en:

```
scripts_laptop/01_start_backend.bat
```

Este script:
1. Verifica que exista `backend/.env` (si no existe, copia `.env.laptop.example` y lo abre en el Bloc de Notas)
2. Crea el entorno virtual con Python 3.11 si no existe
3. Instala/actualiza las dependencias desde `requirements.txt`
4. Levanta el servidor en `http://127.0.0.1:8000`

Para levantar backend y ngrok juntos:

```
scripts_laptop/03_start_complete.bat
```

---

## Configuración del entorno (`backend/.env`)

Variables mínimas para funcionar:

```env
APP_ENABLED=true
AUTH_SECRET=una-clave-secreta-larga-y-random

# Google Sheets (necesario para garantías, catálogo, presupuestos)
WARRANTY_SPREADSHEET_ID=1ABC...XYZ
```

Variables opcionales frecuentes:

```env
# Sucursales para garantías (separadas por coma)
WARRANTY_SUCURSALES=CASEROS,LANUS,CANNING,NORCENTER

# Credenciales Google si no usás el archivo local
GOOGLE_CREDENTIALS_JSON={...json completo...}
GOOGLE_TOKEN_JSON={...json completo...}
```

Ver `.env.laptop.example` para la lista completa.

---

## Túnel ngrok

Editá `scripts_laptop/02_start_ngrok_fixed_backend.bat` y reemplazá el dominio:

```bat
set NGROK_DOMAIN=tu-dominio.ngrok-free.dev
```

Ese mismo dominio tiene que estar en `VITE_API_BASE_URL` en la configuración de Render.

Si no tenés authtoken de ngrok configurado:

```
ngrok config add-authtoken TU_TOKEN_NGROK
```

---

## Frontend en Render

El frontend se despliega automáticamente desde el repositorio Git al hacer `git push`.

Configuración en Render:
- **Build command**: `npm install && npm run build`
- **Publish directory**: `dist`
- **Variable de entorno**: `VITE_API_BASE_URL=https://tu-dominio.ngrok-free.dev`

Para hacer un build local (modo laptop sin Render):

```
scripts_laptop/04_build_frontend.bat
```

El backend sirve automáticamente los archivos desde `frontend/dist/` si existen.

---

## Primer uso — Crear usuario administrador

```bash
cd backend
.venv\Scripts\python.exe scripts/create_user.py
```

El script pide interactivamente: usuario, nombre, rol y contraseña.

---

## Credenciales Google

Las credenciales OAuth nunca van al repositorio. Se guardan en:

```
backend/storage/private/credentials.local.json   ← OAuth client secret
backend/storage/private/token.json               ← token de acceso (se genera solo)
```

Para generar o renovar el token:

```bash
cd backend
.venv\Scripts\python.exe scripts/google_oauth_bootstrap.py
```

Se abre el navegador para autorizar el acceso. Una vez completado, el token queda guardado y el backend lo usa automáticamente.

Alternativamente, desde el panel de administración (`/admin/google`) podés cargar las credenciales y el token directamente desde la interfaz web.

---

## Estructura del proyecto

```
electrogv-web-tools/
├── backend/
│   ├── app/
│   │   ├── main.py               ← FastAPI app, lifespan, routers
│   │   ├── config.py             ← Settings desde variables de entorno
│   │   ├── database.py           ← init_db(), esquema SQLite, eventos
│   │   ├── auth.py               ← JWT, login, permisos
│   │   ├── users.py              ← Gestión de usuarios y roles (JSON)
│   │   ├── permissions.py        ← Lógica de permisos
│   │   ├── product_catalog.py    ← Catálogo, sync desde Sheets, detección de cambios
│   │   ├── google_auth.py        ← OAuth Google
│   │   ├── google_sheets.py      ← Cliente de Google Sheets API
│   │   ├── operational_config.py ← Config operacional en runtime
│   │   ├── audit.py              ← Registro de eventos de auditoría
│   │   ├── jobs.py               ← Ejecución y seguimiento de jobs
│   │   ├── routers/              ← Endpoints por módulo
│   │   └── tools/                ← Runner de scripts legacy
│   ├── legacy_scripts/
│   │   └── Aplicacion de ElectroGV/   ← Scripts de automatización Google Drive
│   ├── scripts/
│   │   ├── create_user.py             ← Crear/actualizar usuarios por consola
│   │   └── google_oauth_bootstrap.py  ← Generar token OAuth
│   ├── storage/                  ← Base de datos, uploads, logs (no va a git)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   └── src/
│       ├── api/client.ts         ← Todas las llamadas al backend
│       ├── types/index.ts        ← Tipos TypeScript compartidos
│       ├── pages/                ← Una página por módulo
│       └── App.tsx               ← Rutas y control de acceso
├── scripts_laptop/
│   ├── 01_start_backend.bat      ← Levanta el backend (setup automático)
│   ├── 02_start_ngrok_fixed_backend.bat  ← Abre el túnel ngrok
│   ├── 03_start_complete.bat     ← Levanta backend + ngrok juntos
│   └── 04_build_frontend.bat     ← Build local del frontend
├── .gitignore
└── README.md
```

---

## Flujo de sincronización del catálogo

Al sincronizar el catálogo desde la Planilla Madre (`/productos` → Sincronizar):

1. Se leen los productos desde Google Sheets
2. Se compara PVP y Costo Vigente contra los valores anteriores en la base de datos
3. Si detecta un cambio real (tolerancia de ±$0.005), crea automáticamente una tarea en el módulo **Precios y Costos** con:
   - El check "Planilla Madre actualizada" ya marcado
   - Origen: "Actualización de catálogo"
4. No crea duplicados si ya existe una tarea pendiente o en proceso para el mismo SKU y valor

---

## Variables de roles y permisos

Los roles y permisos se definen en `backend/storage/private/roles.json`. Cada rol tiene una lista de permisos que habilitan funcionalidades específicas (ej: `warranties.view`, `price_updates.create`, `products.sync`). Los usuarios se guardan en `backend/storage/private/users.json`.

Ambos archivos se crean automáticamente al iniciar el backend por primera vez.

---

## Notas de operación

- El backend usa SQLite en modo WAL, lo que permite lecturas concurrentes sin bloqueos
- Los backups se pueden generar desde `/admin/backups` y se guardan en `backend/storage/backups/`
- Los logs de ejecución de jobs quedan en `backend/storage/logs/`
- Si el backend está apagado, el frontend muestra un mensaje de error de conexión — es el comportamiento esperado
