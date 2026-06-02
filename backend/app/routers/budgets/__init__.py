from __future__ import annotations

import json
import re
import threading
import time
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ...audit import audit
from ...auth import require_permission
from ...config import get_settings
from ...operational_config import runtime_budget_config, runtime_warranty_config
from ...google_sheets import quote_sheet_name, sheets_service
from ...users import CurrentUser
from ...product_catalog import search_products as search_local_products

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

QUOTE_CACHE: dict[str, Any] = {"loaded_at": 0.0, "items": []}
SEQUENCE_LOCK = threading.Lock()

HEADER_MAIN = [
    "ID PRESUPUESTO",
    "FECHA",
    "RESPONSABLE",
    "USUARIO",
    "SUCURSAL",
    "CLIENTE",
    "TELEFONO",
    "SUBTOTAL_PRODUCTOS",
    "ENVIO_ZONA",
    "ENVIO",
    "TOTAL_FINAL",
    "ESTADO",
    "OBSERVACIONES",
]

HEADER_DETAIL = [
    "ID PRESUPUESTO",
    "SKU",
    "PRODUCTO",
    "MARCA",
    "TIPO",
    "CONDICION",
    "CANTIDAD",
    "PRECIO_UNITARIO",
    "TOTAL_LINEA",
]

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


class BudgetProduct(BaseModel):
    producto: str
    sku: str | None = None
    marca: str | None = None
    tipo: str | None = None
    condicion: str | None = None
    precio: float | None = None
    precio_texto: str | None = None
    stock: str | None = None
    label: str


class ShippingOption(BaseModel):
    id: str
    label: str
    price: float | None = None
    price_text: str


class BudgetOptions(BaseModel):
    sucursales: list[str]
    shipping_options: list[ShippingOption]
    estado_default: str


class BudgetLineIn(BaseModel):
    producto: str = Field(min_length=1)
    sku: str | None = None
    marca: str | None = None
    tipo: str | None = None
    condicion: str | None = None
    cantidad: int = Field(default=1, ge=1, le=999)
    precio_unitario: float = Field(ge=0)


class BudgetCreateRequest(BaseModel):
    sucursal: str = Field(min_length=1)
    cliente: str | None = None
    telefono: str | None = None
    envio_zona: str | None = None
    envio: float = Field(default=0, ge=0)
    observaciones: str | None = None
    items: list[BudgetLineIn] = Field(min_length=1, max_length=100)


class BudgetCreatedLine(BaseModel):
    sku: str | None = None
    producto: str
    cantidad: int
    precio_unitario: float
    total_linea: float


class BudgetCreateResponse(BaseModel):
    ok: bool
    id_presupuesto: str
    subtotal_productos: float
    envio: float
    total_final: float
    whatsapp_text: str
    items: list[BudgetCreatedLine]


def now_ar() -> datetime:
    return datetime.now(AR_TZ)


def today_ar_string(dt: datetime | None = None) -> str:
    return (dt or now_ar()).strftime("%d/%m/%Y")


def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper().strip()
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def header_key(value: Any) -> str:
    return normalize_text(value).replace(" ", "")


def id_slug(value: Any) -> str:
    text = normalize_text(value)
    return re.sub(r"[^A-Z0-9]+", "-", text).strip("-") or "SIN-SUCURSAL"


def parse_decimal_ar(value: Any) -> Decimal | None:
    """Parsea plata/números en formato Argentina y también tolera formato US.

    Ejemplos válidos:
    - 525.000,00 -> 525000.00
    - 525000,00  -> 525000.00
    - $ 1.234.567,89 -> 1234567.89
    - 1234567.89 -> 1234567.89

    Regla importante:
    Si hay punto y coma, se toma como formato AR cuando la coma aparece después
    del último punto. Si solo hay punto y tiene exactamente 3 dígitos a la derecha,
    se interpreta como separador de miles, no como decimal.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None

    text = str(value).strip()
    if not text:
        return None
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None

    negative = text.startswith("-")
    text = text.lstrip("-")

    if "," in text and "." in text:
        # AR: 1.234.567,89
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        # US: 1,234,567.89
        else:
            text = text.replace(",", "")
    elif "," in text:
        # AR decimal comma.
        text = text.replace(".", "").replace(",", ".")
    elif "." in text:
        # Si tiene un solo punto y 3 dígitos después, probablemente es miles: 525.000
        parts = text.split(".")
        if len(parts) > 1 and all(len(part) == 3 for part in parts[1:]) and len(parts[-1]) == 3:
            text = "".join(parts)
        # si no, lo dejamos como decimal punto

    if negative:
        text = "-" + text
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def parse_money(value: Any) -> float | None:
    return decimal_to_float(parse_decimal_ar(value))


def format_number_ar(value: Decimal | float | int | None, decimals: int = 2) -> str:
    if value is None:
        return ""
    dec = value if isinstance(value, Decimal) else Decimal(str(value))
    quant = Decimal("1") if decimals == 0 else Decimal("1." + ("0" * decimals))
    dec = dec.quantize(quant, rounding=ROUND_HALF_UP)
    sign = "-" if dec < 0 else ""
    dec = abs(dec)
    int_part, _, frac_part = f"{dec:f}".partition(".")
    int_part = f"{int(int_part):,}".replace(",", ".")
    if decimals <= 0:
        return sign + int_part
    frac_part = (frac_part + "0" * decimals)[:decimals]
    return f"{sign}{int_part},{frac_part}"


def format_money(value: float | Decimal | None) -> str:
    if value is None:
        return "A confirmar"
    return "$ " + format_number_ar(value, 2)


def sheet_money(value: float | Decimal | None) -> str:
    """Valor para Google Sheets en locale Argentina con USER_ENTERED."""
    if value is None:
        return ""
    return format_number_ar(value, 2)


def require_spreadsheet_id() -> str:
    spreadsheet_id = runtime_budget_config().get("spreadsheet_id")
    if not spreadsheet_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falta configurar la planilla de Presupuestos en Configuración operativa.",
        )
    return str(spreadsheet_id)


def get_values(sheet_name: str, a1: str) -> list[list[Any]]:
    service = sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=require_spreadsheet_id(),
        range=f"{quote_sheet_name(sheet_name)}!{a1}",
        valueRenderOption="FORMATTED_VALUE",
        dateTimeRenderOption="FORMATTED_STRING",
    ).execute()
    return result.get("values", [])


def update_values(sheet_name: str, a1: str, values: list[list[Any]]) -> None:
    service = sheets_service()
    service.spreadsheets().values().update(
        spreadsheetId=require_spreadsheet_id(),
        range=f"{quote_sheet_name(sheet_name)}!{a1}",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()


def append_values(sheet_name: str, values: list[list[Any]]) -> None:
    service = sheets_service()
    service.spreadsheets().values().append(
        spreadsheetId=require_spreadsheet_id(),
        range=f"{quote_sheet_name(sheet_name)}!A1",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": values},
    ).execute()


def find_column(headers: list[str], candidates: list[str], fallback_index: int | None = None) -> int | None:
    keys = {header_key(c) for c in candidates}
    for index, header in enumerate(headers):
        if header_key(header) in keys:
            return index
    if fallback_index is not None and fallback_index < len(headers):
        return fallback_index
    return None


def ensure_headers(sheet_name: str, default_headers: list[str]) -> list[str]:
    values = get_values(sheet_name, "1:1")
    headers = [str(x).strip() for x in values[0]] if values else []
    headers = [h for h in headers if h]
    if not headers:
        update_values(sheet_name, "1:1", [default_headers])
        return default_headers.copy()
    existing = {header_key(h) for h in headers}
    missing = [h for h in default_headers if header_key(h) not in existing]
    if missing:
        headers = headers + missing
        update_values(sheet_name, "1:1", [headers])
    return headers


def set_by_alias(row: list[Any], headers: list[str], aliases: list[str], value: Any) -> None:
    keys = {header_key(alias) for alias in aliases}
    for index, header in enumerate(headers):
        if header_key(header) in keys:
            row[index] = value
            return


def has_outlet_marker(*values: Any) -> bool:
    joined_raw = " ".join("" if value is None else str(value) for value in values).upper()
    joined_norm = normalize_text(joined_raw)
    return bool(
        re.search(r"\(\s*O\s*\)", joined_raw)
        or " OUTLET " in f" {joined_norm} "
    )


def condition_from_text(sku: str, producto: str, explicit: str = "") -> str:
    if has_outlet_marker(sku, producto):
        return "OUTLET"
    explicit_norm = normalize_text(explicit)
    if explicit_norm in {"OUTLET", "O"}:
        return "OUTLET"
    return "PRIMERA"


def load_product_catalog() -> list[dict[str, Any]]:
    budget_cfg = runtime_budget_config()
    cache_seconds = int(budget_cfg.get("product_cache_seconds") or get_settings().budget_product_cache_seconds)
    price_sheet = str(budget_cfg.get("price_sheet") or "precios")

    now = time.time()
    if QUOTE_CACHE["items"] and now - float(QUOTE_CACHE["loaded_at"]) < cache_seconds:
        return QUOTE_CACHE["items"]

    values = get_values(price_sheet, "A:Z")
    if not values:
        QUOTE_CACHE["loaded_at"] = now
        QUOTE_CACHE["items"] = []
        return []

    headers = [str(x).strip() for x in values[0]]
    producto_col = find_column(headers, ["PRODUCTO", "DESCRIPCION", "DESCRIPCIÓN", "ARTICULO", "ARTÍCULO", "NOMBRE", "MODELO"], fallback_index=2)
    sku_col = find_column(headers, ["SKU", "CODIGO", "CÓDIGO", "COD", "CODE"], fallback_index=3)
    marca_col = find_column(headers, ["MARCA"], fallback_index=0)
    tipo_col = find_column(headers, ["TIPO", "RUBRO", "TIPO PRODUCTO", "FAMILIA"], fallback_index=1)
    precio_col = find_column(headers, ["PVP", "PRECIO", "PRECIO VENTA", "PRECIO DE VENTA", "PVP FINAL", "VALOR", "PUBLICO", "PÚBLICO", "CONTADO", "PRECIO CONTADO"], fallback_index=4)
    stock_col = find_column(headers, ["STOCK", "STOCK DIA", "STOCK DÍA", "STOCK ACTUAL", "DISPONIBLE"], fallback_index=8 if len(headers) > 8 else None)
    condicion_col = find_column(headers, ["CONDICION", "CONDICIÓN", "CONDICION PRODUCTO", "CONDICION_PRODUCTO"], fallback_index=10 if len(headers) > 10 else None)
    sucursal_col = find_column(headers, ["SUCURSAL", "LOCAL", "DEPOSITO", "DEPÓSITO"], fallback_index=9 if len(headers) > 9 else None)
    activo_col = find_column(headers, ["ACTIVO", "HABILITADO", "ESTADO", "VISIBLE"])
    observacion_col = find_column(headers, ["OBSERVACION", "OBSERVACIÓN", "OBS", "NOTA", "COMENTARIO"])

    if producto_col is None and sku_col is None:
        raise HTTPException(status_code=500, detail=f"La hoja de precios '{price_sheet}' no tiene columnas PRODUCTO ni SKU.")
    if precio_col is None:
        raise HTTPException(status_code=500, detail=f"La hoja de precios '{price_sheet}' no tiene columna PRECIO.")

    items: list[dict[str, Any]] = []
    for raw in values[1:]:
        def get(col: int | None) -> str:
            if col is None or col >= len(raw):
                return ""
            return str(raw[col]).strip()

        producto = get(producto_col)
        sku = get(sku_col)
        marca = get(marca_col)
        tipo = get(tipo_col)
        sucursal = get(sucursal_col)
        activo_raw = get(activo_col)
        activo = normalize_text(activo_raw)
        if activo_col is not None and activo in {"NO", "N", "FALSE", "FALSO", "INACTIVO", "INACTIVA", "0", "BAJA"}:
            continue
        condicion = condition_from_text(sku, producto, get(condicion_col))
        precio = parse_money(get(precio_col))
        stock = get(stock_col)
        observacion = get(observacion_col)
        if not producto and not sku:
            continue
        label_parts = [producto or sku]
        if sku and sku != producto:
            label_parts.append(sku)
        if marca:
            label_parts.append(marca)
        if precio is not None:
            label_parts.append(format_money(precio))
        if sucursal:
            label_parts.append(sucursal)
        label = " — ".join(label_parts)
        items.append({
            "producto": producto or sku,
            "sku": sku,
            "marca": marca,
            "tipo": tipo,
            "condicion": condicion,
            "precio": precio,
            "precio_texto": format_money(precio) if precio is not None else "",
            "stock": stock,
            "label": label,
            "search": normalize_text(" ".join([producto, sku, marca, tipo, condicion, sucursal, observacion])),
        })

    QUOTE_CACHE["loaded_at"] = now
    QUOTE_CACHE["items"] = items
    return items


def shipping_options() -> list[ShippingOption]:
    settings = get_settings()
    budget_cfg = runtime_budget_config()
    options: list[ShippingOption] = []

    try:
        values = get_values(str(budget_cfg.get("shipping_sheet") or "fletes"), "A:Z")
        if values:
            headers = [str(x).strip() for x in values[0]]
            zona_col = find_column(headers, ["ZONA", "LOCALIDAD", "DESTINO", "LUGAR", "BARRIO"], fallback_index=0)
            precio_col = find_column(headers, ["PRECIO", "FLETE", "VALOR", "COSTO", "ENVIO", "ENVÍO"], fallback_index=2 if len(headers) > 2 else 1)
            activo_col = find_column(headers, ["ACTIVO", "HABILITADO", "ESTADO"])
            obs_col = find_column(headers, ["OBSERVACION", "OBSERVACIÓN", "OBS", "NOTA"])
            for row in values[1:]:
                def get(col: int | None) -> str:
                    if col is None or col >= len(row):
                        return ""
                    return str(row[col]).strip()
                zona = get(zona_col)
                if not zona:
                    continue
                activo = normalize_text(get(activo_col)) if activo_col is not None else "SI"
                if activo and activo in {"NO", "N", "FALSE", "FALSO", "INACTIVO", "0"}:
                    continue
                price = parse_money(get(precio_col))
                obs = get(obs_col)
                label = zona if not obs else f"{zona} · {obs}"
                options.append(ShippingOption(id=id_slug(zona), label=label, price=price, price_text=format_money(price)))
    except Exception as exc:
        print(f"[AVISO] No se pudieron leer fletes desde Google Sheets: {exc}")
        options = []

    raw_json = settings.budget_shipping_options_json
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, list):
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    label = str(item.get("label") or item.get("name") or "").strip()
                    if not label:
                        continue
                    price = parse_money(item.get("price")) if item.get("price") is not None else None
                    options.append(ShippingOption(
                        id=id_slug(item.get("id") or label),
                        label=label,
                        price=price,
                        price_text=str(item.get("price_text") or format_money(price)),
                    ))
        except Exception:
            pass

    if not options:
        for chunk in settings.budget_shipping_options.split(","):
            if not chunk.strip():
                continue
            if "=" in chunk:
                label, price_raw = chunk.split("=", 1)
                price = parse_money(price_raw)
            else:
                label, price = chunk, None
            label = label.strip()
            if label:
                options.append(ShippingOption(id=id_slug(label), label=label, price=price, price_text=format_money(price)))

    if not options:
        options = [
            ShippingOption(id="RETIRO-EN-LOCAL", label="Retiro en local", price=0, price_text="$ 0,00"),
            ShippingOption(id="ENVIO-A-CONFIRMAR", label="Envío a confirmar", price=None, price_text="A confirmar"),
        ]
    return options


def extract_budget_sequence(value: Any, year: int, sucursal_slug: str) -> int | None:
    text = str(value or "").strip().upper()
    match = re.fullmatch(rf"PRES-{year}-{re.escape(sucursal_slug)}-(\d+)", text)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def next_budget_sequence(headers: list[str], year: int, sucursal_slug: str) -> int:
    id_col = find_column(headers, ["ID PRESUPUESTO", "ID_PRESUPUESTO", "ID"], fallback_index=0)
    if id_col is None:
        return 1
    values = get_values(str(runtime_budget_config().get("raw_sheet") or "00_RAW_PRESUPUESTOS"), "A:Z")
    max_sequence = 0
    for row in values[1:]:
        if id_col < len(row):
            seq = extract_budget_sequence(row[id_col], year, sucursal_slug)
            if seq and seq > max_sequence:
                max_sequence = seq
    return max_sequence + 1


def format_budget_id(year: int, sucursal: str, sequence: int) -> str:
    return f"PRES-{year}-{id_slug(sucursal)}-{sequence:04d}"


def build_whatsapp_text(resp: BudgetCreateResponse, sucursal: str, cliente: str | None, envio_zona: str | None) -> str:
    lines: list[str] = []
    lines.append("Presupuesto ElectroGV")
    lines.append(f"ID: {resp.id_presupuesto}")
    if cliente:
        lines.append(f"Cliente: {cliente}")
    lines.append(f"Sucursal: {sucursal}")
    lines.append("")
    lines.append("Productos:")
    for item in resp.items:
        sku = f" ({item.sku})" if item.sku else ""
        lines.append(f"- {item.cantidad} x {item.producto}{sku}: {format_money(item.total_linea)}")
    lines.append("")
    lines.append(f"Subtotal: {format_money(resp.subtotal_productos)}")
    if envio_zona:
        lines.append(f"Envío {envio_zona}: {format_money(resp.envio)}")
    else:
        lines.append(f"Envío: {format_money(resp.envio)}")
    lines.append(f"Total: {format_money(resp.total_final)}")
    lines.append("")
    lines.append("Presupuesto sujeto a disponibilidad de stock y vigencia de precios del día.")
    return "\n".join(lines)

# Sub-routers (Fase 3.B.3)
# Helpers compartidos quedan exportados para sales_web y price_cost_updates.
from . import options as _options_module  # noqa: E402
from . import catalog as _catalog_module  # noqa: E402
from . import entries as _entries_module  # noqa: E402

router.include_router(_options_module.router)
router.include_router(_catalog_module.router)
router.include_router(_entries_module.router)
