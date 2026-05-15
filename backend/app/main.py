from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import init_db
from .routers import (
    admin, auth, backups, budgets, config, employees, google_admin,
    jobs, notifications, operational_config, organization, payroll,
    price_cost_updates, products, remitos, sales_bi, sales_web, system, tools, warranties,
)
from .users import ensure_auth_files

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ensure_auth_files()
    yield


app = FastAPI(title=settings.app_name, version="1.5.0-pro-base", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "app": settings.app_name, "enabled": settings.app_enabled}


app.include_router(auth.router)
app.include_router(system.router)
app.include_router(tools.router)
app.include_router(jobs.router)
app.include_router(config.router)
app.include_router(remitos.router)   # must be before warranties — remitos prefix is /api/warranties/remitos
app.include_router(warranties.router) # has catch-all /{warranty_id} that would shadow remitos if first
app.include_router(sales_web.router)
app.include_router(notifications.router)
app.include_router(price_cost_updates.router)
app.include_router(products.router)
app.include_router(sales_bi.router)
app.include_router(organization.router)
app.include_router(employees.router)
app.include_router(payroll.router)
app.include_router(budgets.router)
app.include_router(admin.router)
app.include_router(google_admin.router)
app.include_router(operational_config.router)
app.include_router(backups.router)

# Laptop/local mode: si existe frontend/dist, FastAPI también sirve el frontend.
if settings.frontend_dist_dir.exists():
    assets_dir = settings.frontend_dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        index = settings.frontend_dist_dir / "index.html"
        target = settings.frontend_dist_dir / full_path
        if full_path and target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(index)
