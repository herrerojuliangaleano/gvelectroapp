"""Endpoint del tool interno de Stock valorizado por sucursal."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..audit import audit
from ..auth import require_permission
from ..stock_valorizado import generar_mensaje_whatsapp, procesar_stock, subir_a_drive
from ..users import CurrentUser

router = APIRouter(prefix="/api/stock-valorizado", tags=["stock-valorizado"])


@router.post("/procesar")
async def procesar(
    user: Annotated[CurrentUser, Depends(require_permission("tools.view"))],
    sucursal: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    fecha: Annotated[str | None, Form()] = None,
):
    """Procesa el Excel crudo de stock valorizado y lo sube a Drive como Google Sheet."""
    sucursal = (sucursal or "").strip()
    if not sucursal:
        raise HTTPException(status_code=400, detail="Elegí la sucursal.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")

    try:
        procesado, resumen = procesar_stock(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No se pudo procesar el archivo: {exc}")

    try:
        fecha_ref = date.fromisoformat(fecha) if fecha else date.today()
    except ValueError:
        fecha_ref = date.today()

    try:
        subida = subir_a_drive(procesado, sucursal, fecha_ref, resumen)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"El archivo se procesó pero falló la subida a Drive: {exc}",
        )

    audit(
        "stock_valorizado.upload", user=user, resource_type="stock_valorizado",
        resource_id=subida.get("sheet_id"),
        message=f"Stock valorizado {sucursal} subido a Drive",
        details={"sucursal": sucursal, "fecha": fecha_ref.isoformat(), **resumen},
    )
    return {"sucursal": sucursal, "fecha": fecha_ref.isoformat(), **resumen, **subida}


@router.get("/mensaje")
def mensaje(
    user: Annotated[CurrentUser, Depends(require_permission("tools.view"))],
    fecha: str | None = None,
):
    """Arma el mensaje de WhatsApp con las sucursales subidas en esa fecha."""
    try:
        fecha_ref = date.fromisoformat(fecha) if fecha else date.today()
    except ValueError:
        fecha_ref = date.today()
    return generar_mensaje_whatsapp(fecha_ref)
