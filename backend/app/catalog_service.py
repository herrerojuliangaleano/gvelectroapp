"""Servicio del catálogo maestro: alta, normalización, listados, opciones.

Usa catalog_generator (motor de descripciones) + catalog_seed (abreviaturas).
Maneja: upsert de marca controlada, validaciones, historial de precio/costo
inicial, alias en normalización, link legacy→catálogo, change log.

Regla de estado (decisión 2026-06): sin código Puma NO se activa.
- Si el usuario pide activar y pasa todas las validaciones → ACTIVO.
- Si lo único que falta es el Puma → PENDIENTE_CODIGO_PUMA.
- Si faltan otras cosas → BORRADOR (con los errores devueltos).
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from sqlalchemy import func, or_, select

from .catalog_generator import default_attr_order, generate, generate_parts, norm_key, validate_for_activation
from .catalog_seed import abbreviations_map
from .db import db_session
from .models.catalog import (
    CatalogAlias, CatalogChangeLog, CatalogCostHistory, CatalogPriceHistory,
    CatalogProduct, CatalogTemplate,
)
from .models.products import Product, ProductBrand


# ── Helpers ─────────────────────────────────────────────────────────────

def _template_dict(t: CatalogTemplate) -> dict[str, Any]:
    return {
        "familia_app": t.familia_app, "rubro_app": t.rubro_app,
        "campos_obligatorios": list(t.campos_obligatorios or []),
        "formato_descripcion_comercial": t.formato_descripcion_comercial,
        "formato_descripcion_erp": t.formato_descripcion_erp,
        "formato_subrubro": t.formato_subrubro,
    }


def _get_template(session, familia: str, rubro: str) -> CatalogTemplate | None:
    return session.scalar(select(CatalogTemplate).where(
        CatalogTemplate.familia_app == familia, CatalogTemplate.rubro_app == rubro))


def _template_with_order(t: CatalogTemplate) -> dict[str, Any]:
    d = _template_dict(t)
    d["orden_default"] = default_attr_order(d)
    return d


def _field_name_from_label(label: str) -> str:
    base = norm_key(label).lower()
    base = re.sub(r"[^a-z0-9]+", "_", base).strip("_")
    if not base:
        base = "detalle"
    if base[0].isdigit():
        base = f"detalle_{base}"
    return base


def _unique_field_name(label: str, fields: list[dict[str, Any]]) -> str:
    base = _field_name_from_label(label)
    used = {str(f.get("name") or "").strip() for f in fields}
    if base not in used:
        return base
    i = 2
    while f"{base}_{i}" in used:
        i += 1
    return f"{base}_{i}"


def _clean_option(payload: dict[str, Any]) -> dict[str, str]:
    valor = str(payload.get("valor") or payload.get("comercial") or payload.get("erp") or "").strip()
    if not valor:
        raise ValueError("Falta el valor de la opcion.")
    comercial = str(payload.get("comercial") or valor).strip()
    erp = str(payload.get("erp") or comercial or valor).strip()
    return {"valor": valor, "comercial": comercial, "erp": erp}


def _resolve_marca(session, marca_raw: str) -> str:
    """Devuelve el nombre canónico de la marca; la crea si no existe (lista
    controlada + agregar nueva)."""
    marca_raw = str(marca_raw or "").strip()
    if not marca_raw:
        return ""
    norm = norm_key(marca_raw)
    row = session.scalar(select(ProductBrand).where(ProductBrand.normalized_name == norm))
    if row:
        return row.name
    session.add(ProductBrand(name=marca_raw, normalized_name=norm, is_active=True))
    return marca_raw


def _public(p: CatalogProduct) -> dict[str, Any]:
    return {
        "id": p.id, "codigo_puma": p.codigo_puma,
        "sku_base": p.sku_base, "sku_comercial": p.sku_comercial,
        "descripcion_base": p.descripcion_base, "descripcion_comercial": p.descripcion_comercial,
        "descripcion_erp": p.descripcion_erp, "descripcion_erp_len": len(p.descripcion_erp or ""),
        "descripcion_original": p.descripcion_original,
        "marca": p.marca, "familia_app": p.familia_app, "rubro_app": p.rubro_app,
        "subrubro_app": p.subrubro_app, "condicion": p.condicion, "estado": p.estado,
        "activo": p.activo, "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "datos": dict(p.datos or {}),
    }


# ── Opciones para los formularios ───────────────────────────────────────

def build_options() -> dict[str, Any]:
    with db_session() as session:
        templates = session.scalars(select(CatalogTemplate).where(CatalogTemplate.activo.is_(True))).all()
        rubros_por_familia: dict[str, list[str]] = {}
        for t in templates:
            rubros_por_familia.setdefault(t.familia_app, [])
            if t.rubro_app not in rubros_por_familia[t.familia_app]:
                rubros_por_familia[t.familia_app].append(t.rubro_app)
        for fam in rubros_por_familia:
            rubros_por_familia[fam].sort()
        marcas = [b.name for b in session.scalars(
            select(ProductBrand).where(ProductBrand.is_active.is_(True)).order_by(ProductBrand.name)).all()]
    return {
        "familias": sorted(rubros_por_familia.keys()),
        "rubros_por_familia": rubros_por_familia,
        "marcas": marcas,
        "condiciones": ["PRIMERA", "OUTLET"],
        "estados": ["BORRADOR", "PENDIENTE_REVISION", "PENDIENTE_CODIGO_PUMA",
                    "ACTIVO", "INACTIVO", "RECHAZADO", "DISCONTINUADO"],
    }


def get_template(familia: str, rubro: str) -> dict[str, Any] | None:
    with db_session() as session:
        t = _get_template(session, familia, rubro)
        if not t:
            return None
        return _template_with_order(t)


def suggest_from_legacy(payload: dict[str, Any]) -> dict[str, Any]:
    """Carril A: precarga el armador desde una descripción legacy.

    Acepta {descripcion, sku, familia_app, rubro_app} (lo que tiene la pantalla
    de normalización). Si hay plantilla del rubro, extrae campos numéricos y
    select; siempre detecta OUTLET y corrige typos conocidos."""
    from . import catalog_normalizer
    familia = str(payload.get("familia_app") or "")
    rubro = str(payload.get("rubro_app") or "")
    tdict: dict[str, Any] | None = None
    if familia and rubro:
        with db_session() as session:
            t = _get_template(session, familia, rubro)
            if t:
                tdict = _template_dict(t)
    return catalog_normalizer.suggest(
        descripcion=str(payload.get("descripcion") or ""),
        sku=str(payload.get("sku") or ""),
        template=tdict,
    )


def add_template_field(payload: dict[str, Any]) -> dict[str, Any]:
    """Agrega un atributo reutilizable a la plantilla familia+rubro.

    No requiere migracion: se persiste dentro del JSONB `campos_obligatorios`.
    Los campos nuevos son opcionales y no entran al orden default, pero quedan
    disponibles en el armador para futuros productos del mismo rubro.
    """
    familia = str(payload.get("familia_app") or "").strip()
    rubro = str(payload.get("rubro_app") or "").strip()
    label = str(payload.get("label") or "").strip()
    if not familia or not rubro or not label:
        raise ValueError("Falta familia, rubro o nombre del atributo.")
    ftype = str(payload.get("type") or "text").strip().lower()
    if ftype not in {"text", "number", "select"}:
        raise ValueError("Tipo de atributo invalido.")

    with db_session() as session:
        t = _get_template(session, familia, rubro)
        if not t:
            raise ValueError(f"No hay plantilla para {familia} / {rubro}.")
        fields = [dict(f) for f in (t.campos_obligatorios or [])]
        raw_name = str(payload.get("name") or "").strip()
        name = _field_name_from_label(raw_name) if raw_name else _unique_field_name(label, fields)
        if any(norm_key(f.get("name")) == norm_key(name) for f in fields):
            raise ValueError("Ya existe un atributo con ese nombre en la plantilla.")

        field: dict[str, Any] = {
            "name": name,
            "label": label,
            "type": ftype,
            "obligatorio": False,
        }
        if payload.get("sufijo_comercial"):
            field["sufijo_comercial"] = str(payload.get("sufijo_comercial") or "").strip()
        if payload.get("sufijo_erp"):
            field["sufijo_erp"] = str(payload.get("sufijo_erp") or "").strip()
        if ftype == "select":
            option_payload = payload.get("initial_option")
            field["opciones"] = [_clean_option(option_payload)] if isinstance(option_payload, dict) else []

        fields.append(field)
        t.campos_obligatorios = fields
        session.commit()
        result = _template_with_order(t)
        result["created_field"] = field
        return result


def add_template_field_option(payload: dict[str, Any]) -> dict[str, Any]:
    """Agrega/actualiza una opcion de un campo select dentro de la plantilla."""
    familia = str(payload.get("familia_app") or "").strip()
    rubro = str(payload.get("rubro_app") or "").strip()
    field_name = str(payload.get("field_name") or "").strip()
    if not familia or not rubro or not field_name:
        raise ValueError("Falta familia, rubro o atributo.")
    new_option = _clean_option(payload)

    with db_session() as session:
        t = _get_template(session, familia, rubro)
        if not t:
            raise ValueError(f"No hay plantilla para {familia} / {rubro}.")
        fields = [dict(f) for f in (t.campos_obligatorios or [])]
        target: dict[str, Any] | None = None
        for f in fields:
            if norm_key(f.get("name")) == norm_key(field_name):
                target = f
                break
        if not target:
            raise ValueError("Atributo no encontrado en la plantilla.")
        if target.get("type") != "select":
            raise ValueError("Solo se pueden agregar opciones a atributos de tipo select.")

        options = [dict(o) for o in (target.get("opciones") or [])]
        replaced = False
        for idx, op in enumerate(options):
            same_value = norm_key(op.get("valor")) == norm_key(new_option["valor"])
            same_label = norm_key(op.get("comercial")) == norm_key(new_option["comercial"])
            if same_value or same_label:
                options[idx] = {**op, **new_option}
                replaced = True
                break
        if not replaced:
            options.append(new_option)
        target["opciones"] = options
        t.campos_obligatorios = fields
        session.commit()
        result = _template_with_order(t)
        result["updated_field"] = target
        result["saved_option"] = new_option
        return result


def _gen(tdict: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Genera usando el armador por partes si vino 'orden'; si no, el orden por
    defecto del template (compat)."""
    attr_parts = payload.get("orden")
    if attr_parts is None:
        attr_parts = default_attr_order(tdict)
    # los extras pueden venir aparte o ya intercalados en 'orden'
    for ex in (payload.get("extras") or []):
        if isinstance(ex, str):
            attr_parts = attr_parts + [{"kind": "extra", "valor": ex, "en_erp": True}]
        elif isinstance(ex, dict):
            attr_parts = attr_parts + [{"kind": "extra", "valor": ex.get("valor", ""), "en_erp": ex.get("en_erp", True)}]
    return generate_parts(
        tdict, attr_parts, payload.get("campos") or {},
        marca=payload.get("marca", ""), modelo=payload.get("modelo", ""),
        sku_base=payload.get("sku_base", ""), condicion=payload.get("condicion", "PRIMERA"),
        abbr_map=abbreviations_map(),
    )


# ── Preview (generación en vivo, sin guardar) ───────────────────────────

def preview(payload: dict[str, Any]) -> dict[str, Any]:
    familia = str(payload.get("familia_app") or "")
    rubro = str(payload.get("rubro_app") or "")
    with db_session() as session:
        t = _get_template(session, familia, rubro)
        if not t:
            return {"error": f"No hay plantilla para {familia} / {rubro}."}
        tdict = _template_dict(t)
    return _gen(tdict, payload)


# ── Crear / Normalizar ──────────────────────────────────────────────────

def _build_and_validate(session, payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """Genera descripciones + arma el dict del producto + valida. Devuelve
    (gen, prod_fields, errores)."""
    familia = str(payload.get("familia_app") or "")
    rubro = str(payload.get("rubro_app") or "")
    t = _get_template(session, familia, rubro)
    if not t:
        raise ValueError(f"No hay plantilla para {familia} / {rubro}.")
    marca = _resolve_marca(session, payload.get("marca", ""))
    tdict = _template_dict(t)
    gen = _gen(tdict, {**payload, "marca": marca})
    prod = {
        "codigo_puma": str(payload.get("codigo_puma") or "").strip(),
        "sku_base": str(payload.get("sku_base") or "").strip(),
        "sku_comercial": gen["sku_comercial"],
        "sku_comercial_normalized": norm_key(gen["sku_comercial"]),
        "descripcion_base": gen["descripcion_base"],
        "descripcion_comercial": gen["descripcion_comercial"],
        "descripcion_erp": gen["descripcion_erp"],
        "descripcion_original": str(payload.get("descripcion_original") or "").strip(),
        "marca": marca, "marca_normalized": norm_key(marca),
        "familia_app": familia, "rubro_app": rubro, "subrubro_app": gen["subrubro"],
        "familia_erp": str(payload.get("familia_erp") or "").strip(),
        "rubro_erp": str(payload.get("rubro_erp") or "").strip(),
        "subrubro_erp": str(payload.get("subrubro_erp") or "").strip(),
        "condicion": str(payload.get("condicion") or "PRIMERA").strip().upper(),
        "datos": {
            "orden": payload.get("orden"),
            "campos": payload.get("campos") or {},
            "extras": payload.get("extras") or [],
        },
    }
    errs = validate_for_activation(prod)
    # Unicidad SKU comercial / código Puma entre activos.
    if prod["sku_comercial"]:
        dup = session.scalar(select(func.count()).select_from(CatalogProduct).where(
            CatalogProduct.sku_comercial_normalized == prod["sku_comercial_normalized"],
            CatalogProduct.activo.is_(True)))
        if dup:
            errs.append("Ya existe un producto activo con ese SKU comercial.")
    if prod["codigo_puma"]:
        dupp = session.scalar(select(func.count()).select_from(CatalogProduct).where(
            CatalogProduct.codigo_puma == prod["codigo_puma"], CatalogProduct.activo.is_(True)))
        if dupp:
            errs.append("Ya existe un producto activo con ese código Puma.")
    return gen, prod, errs


def _estado_for(prod: dict[str, Any], errs: list[str], quiere_activar: bool) -> str:
    if not quiere_activar:
        return "BORRADOR"
    if not errs:
        return "ACTIVO"
    # Si lo único que falta es el Puma → PENDIENTE_CODIGO_PUMA.
    solo_puma = all("puma" in e.lower() for e in errs)
    return "PENDIENTE_CODIGO_PUMA" if solo_puma else "PENDIENTE_REVISION"


def _save_price_cost(session, product_id: int, payload: dict[str, Any], user_id: int | None) -> None:
    pvp = payload.get("pvp")
    if pvp not in (None, ""):
        session.add(CatalogPriceHistory(catalog_product_id=product_id, pvp=pvp, fecha_desde=date.today(),
                                        motivo="Alta", created_by_user_id=user_id))
    costo = payload.get("costo")
    if costo not in (None, ""):
        session.add(CatalogCostHistory(catalog_product_id=product_id, costo=costo, moneda=str(payload.get("moneda") or "ARS"),
                                       proveedor=str(payload.get("proveedor") or ""), fecha_desde=date.today(),
                                       motivo="Alta", created_by_user_id=user_id))


def create_product(payload: dict[str, Any], user_id: int | None = None) -> dict[str, Any]:
    quiere_activar = bool(payload.get("activar"))
    with db_session() as session:
        gen, prod, errs = _build_and_validate(session, payload)
        estado = _estado_for(prod, errs, quiere_activar)
        p = CatalogProduct(**prod, estado=estado, activo=(estado == "ACTIVO"),
                           created_by_user_id=user_id, updated_by_user_id=user_id)
        session.add(p)
        session.flush()
        _save_price_cost(session, p.id, payload, user_id)
        session.add(CatalogChangeLog(catalog_product_id=p.id, campo="__alta__", valor_anterior="",
                                     valor_nuevo=p.descripcion_comercial, motivo="Alta de producto",
                                     changed_by_user_id=user_id))
        session.commit()
        result = _public(p)
    result["errores"] = errs
    result["generado"] = gen
    return result


def normalize_product(payload: dict[str, Any], user_id: int | None = None) -> dict[str, Any]:
    """Crea un producto en el catálogo a partir de un legacy, lo vincula y
    guarda el alias histórico (descripción/SKU viejos)."""
    legacy_id = payload.get("legacy_product_id")
    if not legacy_id:
        raise ValueError("Falta legacy_product_id.")
    with db_session() as session:
        legacy = session.get(Product, int(legacy_id))
        if not legacy:
            raise ValueError("Producto legacy no encontrado.")
        if legacy.catalog_product_id:
            raise ValueError("Ese producto legacy ya fue normalizado.")
        # descripción original = la del legacy (trazabilidad)
        payload.setdefault("descripcion_original", legacy.descripcion or "")
        gen, prod, errs = _build_and_validate(session, payload)
        estado = _estado_for(prod, errs, bool(payload.get("activar")))
        p = CatalogProduct(**prod, estado=estado, activo=(estado == "ACTIVO"),
                           created_by_user_id=user_id, updated_by_user_id=user_id)
        session.add(p)
        session.flush()
        # alias histórico
        session.add(CatalogAlias(
            catalog_product_id=p.id, sku_anterior=legacy.sku or "",
            descripcion_anterior=legacy.descripcion or "", origen="planilla_madre",
            tipo_equivalencia="MIGRACION_INICIAL", confianza=100, revisado=True,
            created_by_user_id=user_id))
        # link legacy → catálogo (sube el detector de transición +1)
        legacy.catalog_product_id = p.id
        _save_price_cost(session, p.id, payload, user_id)
        session.add(CatalogChangeLog(catalog_product_id=p.id, campo="__normalizacion__",
                                     valor_anterior=legacy.descripcion or "", valor_nuevo=p.descripcion_comercial,
                                     motivo="Normalización de producto legacy", changed_by_user_id=user_id))
        session.commit()
        result = _public(p)
    result["errores"] = errs
    result["generado"] = gen
    return result


# ── Listados ────────────────────────────────────────────────────────────

def list_products(q: str = "", familia: str = "", rubro: str = "", estado: str = "",
                  condicion: str = "", sin_puma: bool = False, limit: int = 100) -> list[dict[str, Any]]:
    with db_session() as session:
        stmt = select(CatalogProduct)
        if q.strip():
            k = f"%{q.strip().lower()}%"
            stmt = stmt.where(or_(
                func.lower(CatalogProduct.sku_comercial).like(k),
                func.lower(CatalogProduct.descripcion_comercial).like(k),
                func.lower(CatalogProduct.codigo_puma).like(k),
                func.lower(CatalogProduct.marca).like(k)))
        if familia:
            stmt = stmt.where(CatalogProduct.familia_app == familia)
        if rubro:
            stmt = stmt.where(CatalogProduct.rubro_app == rubro)
        if estado:
            stmt = stmt.where(CatalogProduct.estado == estado)
        if condicion:
            stmt = stmt.where(CatalogProduct.condicion == condicion)
        if sin_puma:
            stmt = stmt.where(func.trim(func.coalesce(CatalogProduct.codigo_puma, "")) == "")
        rows = session.scalars(stmt.order_by(CatalogProduct.updated_at.desc()).limit(limit)).all()
        return [_public(p) for p in rows]


def get_product(product_id: int) -> dict[str, Any] | None:
    with db_session() as session:
        p = session.get(CatalogProduct, int(product_id))
        if not p:
            return None
        data = _public(p)
        data["aliases"] = [{
            "sku_anterior": a.sku_anterior, "descripcion_anterior": a.descripcion_anterior,
            "origen": a.origen, "tipo_equivalencia": a.tipo_equivalencia,
        } for a in p.aliases]
        return data


def update_product(product_id: int, payload: dict[str, Any], user_id: int | None = None) -> dict[str, Any]:
    """Edita un producto existente: re-genera descripciones desde los campos
    y aplica cambios. Recalcula estado si se pide activar."""
    with db_session() as session:
        p = session.get(CatalogProduct, int(product_id))
        if not p:
            raise ValueError("Producto no encontrado.")
        # payload trae los mismos campos que el alta; re-generamos.
        gen, prod, errs = _build_and_validate(session, payload)
        # No re-chequear unicidad contra sí mismo: quitar errores de duplicado
        # si el duplicado es este mismo producto.
        anterior = p.descripcion_comercial
        for k, v in prod.items():
            setattr(p, k, v)
        if payload.get("activar"):
            p.estado = _estado_for(prod, errs, True)
            p.activo = (p.estado == "ACTIVO")
        p.updated_by_user_id = user_id
        _save_price_cost(session, p.id, payload, user_id)
        if anterior != p.descripcion_comercial:
            session.add(CatalogChangeLog(catalog_product_id=p.id, campo="descripcion_comercial",
                                         valor_anterior=anterior, valor_nuevo=p.descripcion_comercial,
                                         motivo=str(payload.get("motivo") or "Edición"), changed_by_user_id=user_id))
        session.commit()
        result = _public(p)
    result["errores"] = errs
    return result


def legacy_pending(limit: int = 50, q: str = "") -> dict[str, Any]:
    """Cola de normalización: products legacy sin catalog_product_id, en orden
    de prioridad (con SKU primero, luego por descripción). Incluye sus datos
    viejos para mostrarlos al lado del formulario."""
    with db_session() as session:
        total = session.scalar(select(func.count()).select_from(Product).where(
            Product.is_active.is_(True), Product.catalog_product_id.is_(None))) or 0
        stmt = select(Product).where(Product.is_active.is_(True), Product.catalog_product_id.is_(None))
        if q.strip():
            k = f"%{q.strip().lower()}%"
            stmt = stmt.where(or_(func.lower(Product.sku).like(k),
                                  func.lower(Product.descripcion).like(k),
                                  func.lower(Product.marca).like(k)))
        # prioridad: los que tienen SKU primero, luego alfabético por marca/desc
        rows = session.scalars(stmt.order_by(
            (func.trim(func.coalesce(Product.sku, "")) == "").asc(),
            Product.marca, Product.descripcion).limit(limit)).all()
        items = [{
            "legacy_id": p.id, "sku": p.sku, "marca": p.marca, "tipo": p.tipo,
            "descripcion": p.descripcion, "pvp": float(p.pvp) if p.pvp is not None else None,
            "pvp_text": p.pvp_text, "costo_vigente": float(p.costo_vigente) if p.costo_vigente is not None else None,
            "costo_text": p.costo_text, "condicion_producto": p.condicion_producto,
        } for p in rows]
    return {"total_pendientes": int(total), "mostrados": len(items), "items": items}
