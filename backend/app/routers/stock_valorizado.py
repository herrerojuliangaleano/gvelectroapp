"""Endpoint del tool interno de Stock valorizado por sucursal."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..audit import audit
from ..auth import require_permission
from ..stock_valorizado import (
    fecha_desde_nombre_archivo,
    generar_mensaje_whatsapp,
    procesar_stock,
    subir_a_drive,
    sucursal_desde_nombre_archivo,
)
from ..users import CurrentUser

router = APIRouter(prefix="/api/stock-valorizado", tags=["stock-valorizado"])


def _fecha_form(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


async def _procesar_upload(
    *,
    file: UploadFile,
    user: CurrentUser,
    sucursal_fallback: str | None = None,
    fecha_fallback: str | None = None,
) -> dict:
    filename = file.filename or "archivo.xlsx"
    sucursal = sucursal_desde_nombre_archivo(filename) or (sucursal_fallback or "").strip()
    if not sucursal:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No se pudo detectar la sucursal en '{filename}'. "
                "Agrega caseros/canning/lanus/norte al nombre o elegi una sucursal."
            ),
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"El archivo '{filename}' esta vacio.")

    try:
        procesado, resumen = procesar_stock(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No se pudo procesar '{filename}': {exc}")

    fecha_ref = fecha_desde_nombre_archivo(filename) or _fecha_form(fecha_fallback) or date.today()

    try:
        subida = subir_a_drive(procesado, sucursal, fecha_ref, resumen)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"'{filename}' se proceso pero fallo la subida a Drive: {exc}",
        )

    audit(
        "stock_valorizado.upload", user=user, resource_type="stock_valorizado",
        resource_id=subida.get("sheet_id"),
        message=f"Stock valorizado {sucursal} subido a Drive",
        details={"filename": filename, "sucursal": sucursal, "fecha": fecha_ref.isoformat(), **resumen},
    )
    return {
        "filename": filename,
        "sucursal": sucursal,
        "fecha": fecha_ref.isoformat(),
        **resumen,
        **subida,
    }


@router.post("/procesar")
async def procesar(
    user: Annotated[CurrentUser, Depends(require_permission("tools.view"))],
    sucursal: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    fecha: Annotated[str | None, Form()] = None,
):
    """Procesa un Excel crudo de stock valorizado y lo sube a Drive como Google Sheet."""
    return await _procesar_upload(file=file, user=user, sucursal_fallback=sucursal, fecha_fallback=fecha)


@router.post("/procesar-masivo")
async def procesar_masivo(
    user: Annotated[CurrentUser, Depends(require_permission("tools.view"))],
    files: Annotated[list[UploadFile], File()],
    sucursal: Annotated[str | None, Form()] = None,
    fecha: Annotated[str | None, Form()] = None,
):
    """Procesa varios exports usando fecha y sucursal desde el nombre de cada archivo."""
    if not files:
        raise HTTPException(status_code=400, detail="No se recibieron archivos.")

    items: list[dict] = []
    for file in files:
        filename = file.filename or "archivo.xlsx"
        try:
            result = await _procesar_upload(
                file=file,
                user=user,
                sucursal_fallback=sucursal,
                fecha_fallback=fecha,
            )
            items.append({"ok": True, **result})
        except HTTPException as exc:
            items.append({"ok": False, "filename": filename, "error": exc.detail})
        except Exception as exc:  # noqa: BLE001
            items.append({"ok": False, "filename": filename, "error": str(exc)})

    uploaded = sum(1 for item in items if item.get("ok"))
    errors = len(items) - uploaded
    return {"total": len(items), "uploaded": uploaded, "errors": errors, "items": items}


@router.get("/mensaje")
def mensaje(
    user: Annotated[CurrentUser, Depends(require_permission("tools.view"))],
    fecha: str | None = None,
):
    """Arma el mensaje de WhatsApp con las sucursales subidas en esa fecha."""
    fecha_ref = _fecha_form(fecha) or date.today()
    return generar_mensaje_whatsapp(fecha_ref)
