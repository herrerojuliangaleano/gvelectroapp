from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from . import (
    BudgetCreateRequest,
    BudgetCreateResponse,
    BudgetCreatedLine,
    BudgetOptions,
    BudgetProduct,
    CurrentUser,
    HEADER_DETAIL,
    HEADER_MAIN,
    SEQUENCE_LOCK,
    append_values,
    audit,
    build_whatsapp_text,
    condition_from_text,
    decimal_to_float,
    ensure_headers,
    format_budget_id,
    get_settings,
    id_slug,
    load_product_catalog,
    next_budget_sequence,
    normalize_text,
    now_ar,
    parse_decimal_ar,
    require_permission,
    runtime_budget_config,
    runtime_warranty_config,
    search_local_products,
    set_by_alias,
    sheet_money,
    shipping_options,
    today_ar_string,
)

router = APIRouter()

@router.post("/entries", response_model=BudgetCreateResponse)
def create_budget(data: BudgetCreateRequest, user: Annotated[CurrentUser, Depends(require_permission("budgets.create"))]):
    settings = get_settings()
    budget_cfg = runtime_budget_config()
    warranty_cfg = runtime_warranty_config()
    if not settings.app_enabled:
        raise HTTPException(status_code=403, detail="La aplicación está deshabilitada por el administrador.")

    allowed_sucursales = {normalize_text(x) for x in list(warranty_cfg.get("sucursales") or [])}
    if allowed_sucursales and normalize_text(data.sucursal) not in allowed_sucursales:
        raise HTTPException(status_code=400, detail=f"Sucursal inválida: {data.sucursal}")

    subtotal_dec = sum((Decimal(str(item.cantidad)) * (parse_decimal_ar(item.precio_unitario) or Decimal("0"))) for item in data.items)
    envio_dec = parse_decimal_ar(data.envio) or Decimal("0")
    total_dec = subtotal_dec + envio_dec

    subtotal = decimal_to_float(subtotal_dec) or 0.0
    envio = decimal_to_float(envio_dec) or 0.0
    total = decimal_to_float(total_dec) or 0.0

    now = now_ar()
    year = now.year
    fecha = today_ar_string(now)

    with SEQUENCE_LOCK:
        main_headers = ensure_headers(str(budget_cfg.get("raw_sheet") or "00_RAW_PRESUPUESTOS"), HEADER_MAIN)
        detail_headers = ensure_headers(str(budget_cfg.get("detail_sheet") or "00_RAW_PRESUPUESTOS_DETALLE"), HEADER_DETAIL)
        sequence = next_budget_sequence(main_headers, year, id_slug(data.sucursal))
        budget_id = format_budget_id(year, data.sucursal, sequence)

        main_row = ["" for _ in main_headers]
        set_by_alias(main_row, main_headers, ["ID PRESUPUESTO", "ID_PRESUPUESTO", "ID"], budget_id)
        set_by_alias(main_row, main_headers, ["FECHA", "FECHA CARGA", "INGRESO"], fecha)
        set_by_alias(main_row, main_headers, ["RESPONSABLE", "VENDEDOR", "CARGADO POR"], user.display_name)
        set_by_alias(main_row, main_headers, ["USUARIO", "USERNAME"], user.username)
        set_by_alias(main_row, main_headers, ["SUCURSAL", "LOCAL"], data.sucursal)
        set_by_alias(main_row, main_headers, ["CLIENTE"], (data.cliente or "").strip())
        set_by_alias(main_row, main_headers, ["TELEFONO", "TELÉFONO", "CELULAR"], (data.telefono or "").strip())
        set_by_alias(main_row, main_headers, ["SUBTOTAL_PRODUCTOS", "SUBTOTAL PRODUCTOS", "SUBTOTAL"], sheet_money(subtotal_dec))
        set_by_alias(main_row, main_headers, ["ENVIO_ZONA", "ZONA ENVIO", "ENVÍO ZONA", "LOCALIDAD"], (data.envio_zona or "").strip())
        set_by_alias(main_row, main_headers, ["ENVIO", "ENVÍO", "COSTO ENVIO"], sheet_money(envio_dec))
        set_by_alias(main_row, main_headers, ["TOTAL_FINAL", "TOTAL FINAL", "TOTAL"], sheet_money(total_dec))
        set_by_alias(main_row, main_headers, ["ESTADO", "STATUS"], str(budget_cfg.get("estado_default") or "PENDIENTE"))
        set_by_alias(main_row, main_headers, ["OBSERVACIONES", "OBS", "NOTAS"], (data.observaciones or "").strip())

        detail_rows: list[list[Any]] = []
        created_lines: list[BudgetCreatedLine] = []
        for item in data.items:
            unit_dec = parse_decimal_ar(item.precio_unitario) or Decimal("0")
            qty_dec = Decimal(str(item.cantidad))
            total_line_dec = qty_dec * unit_dec
            total_line = decimal_to_float(total_line_dec) or 0.0
            row = ["" for _ in detail_headers]
            set_by_alias(row, detail_headers, ["ID PRESUPUESTO", "ID_PRESUPUESTO", "ID"], budget_id)
            set_by_alias(row, detail_headers, ["SKU", "CODIGO", "CÓDIGO"], (item.sku or "").strip())
            set_by_alias(row, detail_headers, ["PRODUCTO", "DESCRIPCION", "DESCRIPCIÓN"], item.producto.strip())
            set_by_alias(row, detail_headers, ["MARCA"], (item.marca or "").strip())
            set_by_alias(row, detail_headers, ["TIPO", "RUBRO"], (item.tipo or "").strip())
            set_by_alias(row, detail_headers, ["CONDICION", "CONDICIÓN"], condition_from_text(item.sku or "", item.producto, item.condicion or ""))
            set_by_alias(row, detail_headers, ["CANTIDAD", "QTY"], item.cantidad)
            set_by_alias(row, detail_headers, ["PRECIO_UNITARIO", "PRECIO UNITARIO", "PVP"], sheet_money(unit_dec))
            set_by_alias(row, detail_headers, ["TOTAL_LINEA", "TOTAL LINEA", "TOTAL LÍNEA"], sheet_money(total_line_dec))
            detail_rows.append(row)
            created_lines.append(BudgetCreatedLine(
                sku=item.sku,
                producto=item.producto,
                cantidad=item.cantidad,
                precio_unitario=decimal_to_float(unit_dec) or 0.0,
                total_linea=total_line,
            ))

        append_values(str(budget_cfg.get("raw_sheet") or "00_RAW_PRESUPUESTOS"), [main_row])
        append_values(str(budget_cfg.get("detail_sheet") or "00_RAW_PRESUPUESTOS_DETALLE"), detail_rows)

    response = BudgetCreateResponse(
        ok=True,
        id_presupuesto=budget_id,
        subtotal_productos=subtotal,
        envio=envio,
        total_final=total,
        whatsapp_text="",
        items=created_lines,
    )
    response.whatsapp_text = build_whatsapp_text(response, data.sucursal, data.cliente, data.envio_zona)
    audit(
        "budgets.create",
        user=user,
        resource_type="budget",
        resource_id=budget_id,
        details={
            "subtotal": subtotal,
            "envio": envio,
            "total": total,
            "items": len(created_lines),
            "sucursal": data.sucursal,
            "formato": "es-AR",
        },
    )
    return response
