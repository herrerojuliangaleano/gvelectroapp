"""Dossier de marca — informe presentable a un proveedor (ej. Samsung).

Arma en UNA respuesta todo lo que la reunión con una marca necesita:
share de mercado y evolución, ranking vs competidores, participación dentro
de cada categoría/tipo, top productos, presencia por sucursal, posicionamiento
de precio y deltas vs el período anterior.

Decisión de seguridad: este informe se proyecta frente a la marca, por lo que
NUNCA incluye costos ni márgenes (equivale a presentation=True siempre).
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from .brand_logo_store import brand_logo_info, brand_style_info
from .sales_bi import _fmt_date
from .sales_bi_commercial import (
    _add_metric,
    _commercial_rows,
    _finalize_metric,
    _metric_bucket,
    _parse_csv_list,
)


def _fin(bucket: dict[str, Any], total_reference: float | None = None) -> dict[str, Any]:
    """Finaliza un bucket SIEMPRE sin costos/margen (informe para la marca)."""
    return _finalize_metric(bucket, include_costs=False, include_margin=False, total_reference=total_reference)


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _week_key(d: date) -> str:
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _avg(bucket: dict[str, Any]) -> float:
    units = int(bucket.get("unidades") or 0)
    total = float(bucket.get("total_vendido") or 0.0)
    return round(total / units, 2) if units else 0.0


def _share(part: float, whole: float) -> float:
    return round(part / whole * 100, 2) if whole else 0.0


_DEFAULT_TIPOS = ["HELADERA", "Lavado", "A/A", "TELEVISION"]
_LAVADO_ALIASES = {"LAVARROPAS", "LAVASECARROPAS", "LAVASECA", "SECARROPAS"}
_AA_ALIASES = {"AIRE ACONDICIONADO", "A/A", "AA", "A A"}
_ZONE_ORDER = ["CABA", "GBA", "Venta Web"]


def _norm_dim(value: Any) -> str:
    raw = str(value or "").strip().upper()
    raw = raw.replace("Á", "A").replace("É", "E").replace("Í", "I").replace("Ó", "O").replace("Ú", "U")
    raw = raw.replace("Ü", "U").replace("Ñ", "N")
    return " ".join(raw.replace("/", " / ").split())


def _commercial_tipo(value: Any) -> str:
    key = _norm_dim(value)
    compact = key.replace(" ", "")
    if key in _LAVADO_ALIASES or compact in {v.replace(" ", "") for v in _LAVADO_ALIASES}:
        return "Lavado"
    if key in _AA_ALIASES or compact in {"AIREACONDICIONADO", "A/A", "AA"}:
        return "A/A"
    return key or "SIN TIPO"


def _commercial_zone(sucursal: Any, tipo_venta: Any) -> str:
    venta = _norm_dim(tipo_venta)
    if "ONLINE" in venta or "WEB" in venta:
        return "Venta Web"
    suc = _norm_dim(sucursal)
    if "CASEROS" in suc:
        return "CABA"
    if any(name in suc for name in ("CANNING", "LANUS", "LANUS", "NORCENTER", "NORTE", "SUR")):
        return "GBA"
    return "GBA" if suc else "Sin zona"


def _tipo_sort_key(name: str, market_bucket: dict[str, Any], brand_bucket: dict[str, Any] | None = None) -> tuple[int, float, str]:
    preferred = {name: i for i, name in enumerate(_DEFAULT_TIPOS)}
    if name in preferred:
        return (0, float(preferred[name]), name)
    brand_total = float((brand_bucket or {}).get("total_vendido") or 0.0)
    market_total = float((market_bucket or {}).get("total_vendido") or 0.0)
    return (1, -(brand_total or market_total), name)


def _resolve_selected_tipos(tipos: list[str] | str | None, available: list[str]) -> list[str]:
    available_map = {_norm_dim(t): t for t in available}
    available_map.update({_commercial_tipo(t): t for t in available})
    requested = _parse_csv_list(tipos)
    if requested:
        out: list[str] = []
        for raw in requested:
            key = _commercial_tipo(raw)
            value = available_map.get(_norm_dim(raw)) or available_map.get(key)
            if value and value not in out:
                out.append(value)
        return out
    out = [t for t in _DEFAULT_TIPOS if t in available]
    for t in available:
        if t not in out:
            out.append(t)
        if len(out) >= 6:
            break
    return out


def _price_bands(
    market_prices: list[tuple[float, int]],
    brand_prices: list[tuple[float, int]],
) -> dict[str, Any] | None:
    """Gamas Entrada/Media/Premium con cortes = terciles del mercado
    ponderados por unidades. Muestra dónde juega la marca vs el mercado."""
    total_units = sum(u for _, u in market_prices)
    if not total_units:
        return None
    ordered = sorted(market_prices)
    c1: float | None = None
    c2: float | None = None
    acc = 0
    for price, units in ordered:
        acc += units
        if c1 is None and acc >= total_units / 3:
            c1 = price
        if c2 is None and acc >= 2 * total_units / 3:
            c2 = price
    c1 = float(c1 or 0)
    c2 = float(c2 or c1)

    def bucketize(pairs: list[tuple[float, int]]) -> list[dict[str, float]]:
        out = [{"unidades": 0, "pvp": 0.0} for _ in range(3)]
        for price, units in pairs:
            idx = 0 if price <= c1 else (1 if price <= c2 else 2)
            out[idx]["unidades"] += units
            out[idx]["pvp"] += price * units
        return out

    mk = bucketize(market_prices)
    br = bucketize(brand_prices)
    brand_units_total = sum(b["unidades"] for b in br)
    names = ["Entrada", "Media", "Premium"]
    bands = []
    for i, nombre in enumerate(names):
        bands.append({
            "banda": nombre,
            "corte_min": 0.0 if i == 0 else (c1 if i == 1 else c2),
            "corte_max": c1 if i == 0 else (c2 if i == 1 else None),
            "brand_unidades": int(br[i]["unidades"]),
            "brand_pvp": round(br[i]["pvp"], 2),
            "market_unidades": int(mk[i]["unidades"]),
            "market_pvp": round(mk[i]["pvp"], 2),
            "share_units_pct": _share(br[i]["unidades"], mk[i]["unidades"]),
            "share_pvp_pct": _share(br[i]["pvp"], mk[i]["pvp"]),
            "brand_mix_units_pct": _share(br[i]["unidades"], brand_units_total),
            "market_mix_units_pct": _share(mk[i]["unidades"], total_units),
        })
    return {"cortes": {"entrada_hasta": round(c1, 2), "media_hasta": round(c2, 2)}, "bands": bands}


def _money_ar(value: float) -> str:
    return f"${value:,.0f}".replace(",", ".")


def _resolve_brand_name(marca: str, names: list[str]) -> str:
    """Match exacto primero; después case-insensitive (canonicaliza)."""
    wanted = (marca or "").strip()
    if wanted in names:
        return wanted
    lowered = {n.lower(): n for n in names}
    return lowered.get(wanted.lower(), wanted)


def _merge_metric_bucket(target: dict[str, Any], source: dict[str, Any] | None) -> dict[str, Any]:
    if not source:
        return target
    target["total_vendido"] += float(source.get("total_vendido") or 0.0)
    target["unidades"] += int(source.get("unidades") or 0)
    target["lineas"] += int(source.get("lineas") or 0)
    target["diferencia"] += float(source.get("diferencia") or 0.0)
    target["costo_total"] += float(source.get("costo_total") or 0.0)
    target["productos"].update(source.get("productos") or set())
    return target


def _bucket_for_brands(source: dict[str, dict[str, Any]], brand_names: list[str]) -> dict[str, Any]:
    bucket = _metric_bucket()
    for name in brand_names:
        _merge_metric_bucket(bucket, source.get(name))
    return bucket


def _parse_competitor_groups(value: Any, brand_names: list[str]) -> list[dict[str, Any]]:
    if not value:
        return []
    payload: Any = value
    if isinstance(value, str):
        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            return []
    if isinstance(payload, dict):
        payload = [{"alias": alias, "marcas": marcas} for alias, marcas in payload.items()]
    if not isinstance(payload, list):
        return []

    groups: list[dict[str, Any]] = []
    for raw in payload:
        if not isinstance(raw, dict):
            continue
        alias = str(raw.get("alias") or raw.get("name") or "").strip()
        marcas_raw = raw.get("marcas") or raw.get("brands") or []
        marcas = []
        for item in _parse_csv_list(marcas_raw):
            resolved = _resolve_brand_name(item, brand_names)
            if resolved in brand_names and resolved not in marcas:
                marcas.append(resolved)
        if not alias and marcas:
            alias = " + ".join(marcas)
        if alias and marcas:
            groups.append({"alias": alias, "marcas": marcas})
    return groups


def _comparison_label(alias: str, used: set[str]) -> str:
    base = alias.strip() or "Grupo"
    if base not in used:
        used.add(base)
        return base
    idx = 2
    while f"{base} {idx}" in used:
        idx += 1
    value = f"{base} {idx}"
    used.add(value)
    return value


def _build_comparisons(
    brand_name: str,
    brands: dict[str, dict[str, Any]],
    ranked: list[dict[str, Any]],
    competidores: list[str] | str | None,
    competidor_grupos: list[dict[str, Any]] | dict[str, Any] | str | None,
    max_competidores: int,
) -> list[dict[str, Any]]:
    brand_names = sorted(brands.keys())
    used = {brand_name}
    out: list[dict[str, Any]] = []

    for raw in _parse_csv_list(competidores):
        name = _resolve_brand_name(raw, brand_names)
        if name in brands and name != brand_name:
            out.append({"label": _comparison_label(name, used), "marcas": [name], "kind": "brand"})

    for group in _parse_competitor_groups(competidor_grupos, brand_names):
        marcas = [name for name in group["marcas"] if name != brand_name]
        if marcas:
            out.append({"label": _comparison_label(str(group["alias"]), used), "marcas": marcas, "kind": "group"})

    if not out:
        for row in ranked:
            name = row["name"]
            if name != brand_name:
                out.append({"label": _comparison_label(name, used), "marcas": [name], "kind": "brand"})
            if len(out) >= max_competidores:
                break
    return out[:max_competidores]


def _comparison_rows(
    source: dict[str, dict[str, Any]],
    comparisons: list[dict[str, Any]],
    total_reference: float,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in comparisons:
        bucket = _bucket_for_brands(source, list(item["marcas"]))
        if not bucket["unidades"] and not bucket["total_vendido"]:
            continue
        rows.append({
            "name": item["label"],
            **_fin(bucket, total_reference=total_reference),
            "is_brand": False,
            "is_competitor": True,
            "kind": item["kind"],
            "marcas": item["marcas"],
        })
    return rows


def build_brand_dossier(
    marca: str,
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    *,
    empresa: str | None = None,
    sucursal: str | None = None,
    sucursales: list[str] | str | None = None,
    tipo_venta: str | None = None,
    competidores: list[str] | str | None = None,
    competidor_grupos: list[dict[str, Any]] | dict[str, Any] | str | None = None,
    tipos: list[str] | str | None = None,
    max_competidores: int = 6,
    detail_series: bool = False,
) -> dict[str, Any]:
    records, bounds = _commercial_rows(
        fecha_desde, fecha_hasta,
        empresa=empresa, sucursal=sucursal, sucursales=sucursales, tipo_venta=tipo_venta,
    )

    # Período anterior de la misma longitud, pegado al actual.
    span_days = (bounds[1] - bounds[0]).days + 1
    prev_hasta = bounds[0] - timedelta(days=1)
    prev_desde = prev_hasta - timedelta(days=span_days - 1)
    prev_records, prev_bounds = _commercial_rows(
        prev_desde.isoformat(), prev_hasta.isoformat(),
        empresa=empresa, sucursal=sucursal, sucursales=sucursales, tipo_venta=tipo_venta,
    )

    # ── Pase 1: agregaciones del período actual ─────────────────────────
    market = _metric_bucket()
    brands: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    monthly_by_brand: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    monthly_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    weekly_brand: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    weekly_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    cat_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    cat_brands: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    tipo_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    tipo_brands: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    commercial_tipo_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    commercial_tipo_brands: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    commercial_tipo_month_market: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    commercial_tipo_month_brands: dict[str, dict[str, dict[str, dict[str, Any]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(_metric_bucket)))
    commercial_tipo_zone_market: dict[tuple[str, str], dict[str, Any]] = defaultdict(_metric_bucket)
    commercial_tipo_zone_brand: dict[tuple[str, str], dict[str, Any]] = defaultdict(_metric_bucket)
    zone_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    zone_brand: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    branch_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    branch_brand: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    products_brand: dict[tuple[str, str], dict[str, Any]] = {}
    product_branch_metrics: dict[tuple[str, str], dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    # Serie DIARIA completa (marca vs mercado): el frontend la re-agrupa en
    # mensual/bimestral/trimestral y permite drill-down de un mes al día a día.
    daily_brand: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    daily_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    # (pvp unitario, unidades) para bandas de precio Entrada/Media/Premium.
    market_prices: list[tuple[float, int]] = []
    brand_prices: list[tuple[float, int]] = []
    market_prices_by_tipo: dict[str, list[tuple[float, int]]] = defaultdict(list)
    brand_prices_by_tipo: dict[str, list[tuple[float, int]]] = defaultdict(list)
    # Semana × marca (todas): para el área apilada de share en el tiempo.
    weekly_by_brand: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    # Día × categoría (solo la marca): evolución por categoría.
    daily_cat_brand: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    # Sucursal × marca (todas): comparativa por sucursal vs competidores.
    branch_brands: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    # Mes × categoría / mes × tipo (marca y mercado), total y por sucursal.
    # Alimentan las hojas de evolución del Excel (share % mensual).
    m_cat_brand: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    m_cat_market: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    m_tipo_brand: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    m_tipo_market: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_metric_bucket))
    ms_cat_brand: dict[tuple, dict[str, Any]] = defaultdict(_metric_bucket)   # (mes, suc, cat)
    ms_cat_market: dict[tuple, dict[str, Any]] = defaultdict(_metric_bucket)
    ms_tipo_brand: dict[tuple, dict[str, Any]] = defaultdict(_metric_bucket)  # (mes, suc, tipo)
    ms_tipo_market: dict[tuple, dict[str, Any]] = defaultdict(_metric_bucket)

    brand_names_seen: set[str] = set()
    for r in records:
        name = str(r.marca or "Sin marca")
        brand_names_seen.add(name)

    brand_name = _resolve_brand_name(marca, sorted(brand_names_seen))

    for r in records:
        name = str(r.marca or "Sin marca")
        mes = _month_key(r.fecha)
        cat = str(r.categoria or "OTROS")
        tipo = str(r.tipo_producto or "Sin tipo")
        tipo_comercial = _commercial_tipo(tipo)
        suc = str(r.sucursal or "Sin sucursal")
        zona = _commercial_zone(suc, r.tipo_venta)

        _add_metric(market, r)
        _add_metric(brands[name], r)
        _add_metric(monthly_by_brand[mes][name], r)
        _add_metric(monthly_market[mes], r)
        _add_metric(cat_market[cat], r)
        _add_metric(cat_brands[cat][name], r)
        _add_metric(tipo_market[tipo], r)
        _add_metric(commercial_tipo_market[tipo_comercial], r)
        _add_metric(commercial_tipo_brands[tipo_comercial][name], r)
        _add_metric(commercial_tipo_month_market[mes][tipo_comercial], r)
        _add_metric(commercial_tipo_month_brands[mes][tipo_comercial][name], r)
        _add_metric(commercial_tipo_zone_market[(tipo_comercial, zona)], r)
        _add_metric(zone_market[zona], r)
        _add_metric(branch_market[suc], r)
        dia = r.fecha.isoformat()
        _add_metric(daily_market[dia], r)
        unidades_r = int(r.cantidad or 0)
        precio_r = float(r.pvp or 0)
        if unidades_r > 0 and precio_r > 0:
            market_prices.append((precio_r, unidades_r))
            market_prices_by_tipo[tipo_comercial].append((precio_r, unidades_r))

        _add_metric(branch_brands[suc][name], r)
        _add_metric(weekly_by_brand[_week_key(r.fecha)][name], r)
        _add_metric(m_cat_market[mes][cat], r)
        _add_metric(m_tipo_market[mes][tipo], r)
        _add_metric(ms_cat_market[(mes, suc, cat)], r)
        _add_metric(ms_tipo_market[(mes, suc, tipo)], r)

        if name == brand_name:
            _add_metric(commercial_tipo_zone_brand[(tipo_comercial, zona)], r)
            _add_metric(zone_brand[zona], r)
            _add_metric(m_cat_brand[mes][cat], r)
            _add_metric(m_tipo_brand[mes][tipo], r)
            _add_metric(ms_cat_brand[(mes, suc, cat)], r)
            _add_metric(ms_tipo_brand[(mes, suc, tipo)], r)
            _add_metric(daily_brand[dia], r)
            _add_metric(daily_cat_brand[dia][cat], r)
            if unidades_r > 0 and precio_r > 0:
                brand_prices.append((precio_r, unidades_r))
                brand_prices_by_tipo[tipo_comercial].append((precio_r, unidades_r))
            sem = _week_key(r.fecha)
            _add_metric(weekly_brand[sem], r)
            _add_metric(tipo_brands[tipo][name], r)
            _add_metric(branch_brand[suc], r)
            key = (str(r.sku or ""), str(r.descripcion or ""))
            if key not in products_brand:
                products_brand[key] = {
                    "sku": key[0], "producto": key[1],
                    "tipo_producto": tipo, **_metric_bucket(),
                }
            _add_metric(products_brand[key], r)
            _add_metric(product_branch_metrics[key][suc], r)
        sem = _week_key(r.fecha)
        _add_metric(weekly_market[sem], r)

    brand_bucket = brands.get(brand_name) or _metric_bucket()
    brand_tot = _fin(brand_bucket)
    market_tot = _fin(market)

    # ── Pase 2: período anterior (solo lo que se compara) ───────────────
    prev_market = _metric_bucket()
    prev_brands: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    prev_cat_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    prev_cat_brand: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    prev_products_units: dict[tuple[str, str], int] = defaultdict(int)
    for r in prev_records:
        name = str(r.marca or "Sin marca")
        _add_metric(prev_market, r)
        _add_metric(prev_brands[name], r)
        cat = str(r.categoria or "OTROS")
        _add_metric(prev_cat_market[cat], r)
        if name == brand_name:
            _add_metric(prev_cat_brand[cat], r)
            prev_products_units[(str(r.sku or ""), str(r.descripcion or ""))] += int(r.cantidad or 0)

    prev_brand_tot = _fin(prev_brands.get(brand_name) or _metric_bucket())
    prev_market_tot = _fin(prev_market)

    # ── Ranking y competidores ──────────────────────────────────────────
    ranked = sorted(
        ({"name": n, **_fin(b, total_reference=float(market_tot["total_vendido"] or 0.0))} for n, b in brands.items()),
        key=lambda row: (float(row["total_vendido"]), int(row["unidades"])),
        reverse=True,
    )
    rank_pvp = next((i + 1 for i, row in enumerate(ranked) if row["name"] == brand_name), None)
    ranked_units = sorted(ranked, key=lambda row: int(row["unidades"]), reverse=True)
    rank_units = next((i + 1 for i, row in enumerate(ranked_units) if row["name"] == brand_name), None)

    prev_ranked = sorted(
        ((n, float(_fin(b)["total_vendido"])) for n, b in prev_brands.items()),
        key=lambda t: t[1], reverse=True,
    )
    prev_rank = next((i + 1 for i, (n, _) in enumerate(prev_ranked) if n == brand_name), None)

    brand_names_all = sorted(brands.keys())
    comparison_closed = bool(
        _parse_csv_list(competidores)
        or _parse_competitor_groups(competidor_grupos, brand_names_all)
    )
    comparisons = _build_comparisons(
        brand_name,
        brands,
        ranked,
        competidores,
        competidor_grupos,
        max_competidores,
    )
    comp_list = [item["label"] for item in comparisons]
    comp_detail = [{"alias": item["label"], "marcas": item["marcas"], "kind": item["kind"]} for item in comparisons]
    comparison_rows = _comparison_rows(brands, comparisons, float(market_tot["total_vendido"] or 0.0))
    brand_comparison_row = {
        "name": brand_name,
        **brand_tot,
        "is_brand": True,
        "is_competitor": False,
        "kind": "brand",
        "marcas": [brand_name],
    }
    comparison_ranking = [brand_comparison_row, *comparison_rows]

    # Ranking para el gráfico: top 12 + la marca si quedó afuera.
    ranking_rows = ranked[:12]
    if brand_name not in {row["name"] for row in ranking_rows}:
        me = next((row for row in ranked if row["name"] == brand_name), None)
        if me:
            ranking_rows.append(me)
    ranking_names = {row["name"] for row in ranking_rows}
    for comp_row in comparison_rows:
        comp = comp_row["name"]
        if comp not in ranking_names:
            ranking_rows.append(comp_row)
            ranking_names.add(comp)
    for row in ranking_rows:
        row["is_brand"] = row["name"] == brand_name
        row["is_competitor"] = row["name"] in comp_list

    available_tipos = sorted(
        commercial_tipo_market.keys(),
        key=lambda t: _tipo_sort_key(t, commercial_tipo_market[t], commercial_tipo_brands[t].get(brand_name)),
    )
    selected_tipos = _resolve_selected_tipos(tipos, available_tipos)

    ranking_by_tipo: list[dict[str, Any]] = []
    for tipo_sel in selected_tipos:
        mk_tipo = _fin(commercial_tipo_market.get(tipo_sel) or _metric_bucket())
        tipo_ranked = sorted(
            (
                {
                    "name": n,
                    **_fin(b, total_reference=float(mk_tipo["total_vendido"] or 0.0)),
                    "is_brand": n == brand_name,
                    "is_competitor": n in comp_list,
                }
                for n, b in commercial_tipo_brands.get(tipo_sel, {}).items()
            ),
            key=lambda row: (float(row["total_vendido"]), int(row["unidades"])),
            reverse=True,
        )
        tipo_comparison_rows = _comparison_rows(
            commercial_tipo_brands.get(tipo_sel, {}),
            comparisons,
            float(mk_tipo["total_vendido"] or 0.0),
        )
        if comparison_closed:
            brand_tipo_row = next((row for row in tipo_ranked if row["name"] == brand_name), None) or {
                "name": brand_name,
                **_fin(
                    commercial_tipo_brands.get(tipo_sel, {}).get(brand_name) or _metric_bucket(),
                    total_reference=float(mk_tipo["total_vendido"] or 0.0),
                ),
                "is_brand": True,
                "is_competitor": False,
            }
            tipo_rows = [brand_tipo_row, *tipo_comparison_rows]
        else:
            tipo_rows = tipo_ranked[:8]
            keep_names = {row["name"] for row in tipo_rows}
            for required_name in [brand_name, *comp_list]:
                if required_name in keep_names:
                    continue
                found = next((row for row in tipo_ranked if row["name"] == required_name), None)
                if not found:
                    found = next((row for row in tipo_comparison_rows if row["name"] == required_name), None)
                if found:
                    tipo_rows.append(found)
                    keep_names.add(required_name)
        ranking_by_tipo.append({
            "tipo": tipo_sel,
            "market": mk_tipo,
            "brand": _fin(commercial_tipo_brands.get(tipo_sel, {}).get(brand_name) or _metric_bucket()),
            "rows": tipo_rows,
        })

    monthly_share_by_tipo: list[dict[str, Any]] = []
    for tipo_sel in selected_tipos:
        rows = []
        for mes in sorted(monthly_market.keys()):
            mk = _fin(commercial_tipo_month_market.get(mes, {}).get(tipo_sel) or _metric_bucket())
            br = _fin(commercial_tipo_month_brands.get(mes, {}).get(tipo_sel, {}).get(brand_name) or _metric_bucket())
            if not mk["unidades"] and not mk["total_vendido"] and not br["unidades"] and not br["total_vendido"]:
                continue
            rows.append({
                "mes": mes,
                "brand_unidades": br["unidades"],
                "brand_pvp": br["total_vendido"],
                "market_unidades": mk["unidades"],
                "market_pvp": mk["total_vendido"],
                "share_units_pct": _share(br["unidades"], mk["unidades"]),
                "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
            })
        monthly_share_by_tipo.append({"tipo": tipo_sel, "rows": rows})

    zone_order = [*_ZONE_ORDER, *sorted(z for z in zone_market.keys() if z not in _ZONE_ORDER)]
    zone_share: list[dict[str, Any]] = []
    for zone in zone_order:
        mk = _fin(zone_market.get(zone) or _metric_bucket())
        br = _fin(zone_brand.get(zone) or _metric_bucket())
        if not mk["unidades"] and not mk["total_vendido"]:
            continue
        zone_share.append({
            "zona": zone,
            "brand_unidades": br["unidades"],
            "brand_pvp": br["total_vendido"],
            "market_unidades": mk["unidades"],
            "market_pvp": mk["total_vendido"],
            "share_units_pct": _share(br["unidades"], mk["unidades"]),
            "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
            "brand_mix_units_pct": _share(br["unidades"], brand_tot["unidades"]),
            "brand_mix_pvp_pct": _share(br["total_vendido"], brand_tot["total_vendido"]),
        })

    tipo_zone_matrix: list[dict[str, Any]] = []
    for tipo_sel in selected_tipos:
        zone_items: dict[str, Any] = {}
        tipo_brand_total = _fin(commercial_tipo_brands.get(tipo_sel, {}).get(brand_name) or _metric_bucket())
        for zone in zone_order:
            mk = _fin(commercial_tipo_zone_market.get((tipo_sel, zone)) or _metric_bucket())
            br = _fin(commercial_tipo_zone_brand.get((tipo_sel, zone)) or _metric_bucket())
            zone_items[zone] = {
                "brand_unidades": br["unidades"],
                "brand_pvp": br["total_vendido"],
                "market_unidades": mk["unidades"],
                "market_pvp": mk["total_vendido"],
                "share_units_pct": _share(br["unidades"], mk["unidades"]),
                "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
            }
        tipo_zone_matrix.append({
            "tipo": tipo_sel,
            "brand_unidades": tipo_brand_total["unidades"],
            "brand_pvp": tipo_brand_total["total_vendido"],
            "zones": zone_items,
        })

    price_bands_by_tipo: list[dict[str, Any]] = []
    for tipo_sel in selected_tipos:
        bands = _price_bands(market_prices_by_tipo.get(tipo_sel, []), brand_prices_by_tipo.get(tipo_sel, []))
        if bands:
            price_bands_by_tipo.append({"tipo": tipo_sel, **bands})

    # ── Series mensuales (marca + mercado + competidores) ───────────────
    monthly_series: list[dict[str, Any]] = []
    for mes in sorted(monthly_market.keys()):
        mk = _fin(monthly_market[mes])
        br = _fin(monthly_by_brand[mes].get(brand_name) or _metric_bucket())
        row: dict[str, Any] = {
            "mes": mes,
            "brand_unidades": br["unidades"],
            "brand_pvp": br["total_vendido"],
            "market_unidades": mk["unidades"],
            "market_pvp": mk["total_vendido"],
            "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
            "share_units_pct": _share(br["unidades"], mk["unidades"]),
            "competidores": {},
        }
        for item in comparisons:
            cb = _fin(_bucket_for_brands(monthly_by_brand[mes], list(item["marcas"])))
            row["competidores"][item["label"]] = {"unidades": cb["unidades"], "total_vendido": cb["total_vendido"]}
        monthly_series.append(row)

    weekly_series = [
        {
            "semana": sem,
            "brand_unidades": (b := _fin(weekly_brand.get(sem) or _metric_bucket()))["unidades"],
            "brand_pvp": b["total_vendido"],
            "market_pvp": (m := _fin(weekly_market[sem]))["total_vendido"],
            "share_pvp_pct": _share(b["total_vendido"], m["total_vendido"]),
        }
        for sem in sorted(weekly_market.keys())
    ]

    # ── Categorías: dónde juega y dónde es fuerte ────────────────────────
    categories: list[dict[str, Any]] = []
    for cat in sorted(cat_market.keys()):
        mk = _fin(cat_market[cat])
        br = _fin(cat_brands[cat].get(brand_name) or _metric_bucket())
        cat_rank_rows = sorted(
            ((n, float(_fin(b)["total_vendido"])) for n, b in cat_brands[cat].items()),
            key=lambda t: t[1], reverse=True,
        )
        rank_in_cat = next((i + 1 for i, (n, _) in enumerate(cat_rank_rows) if n == brand_name), None)
        leader_name, leader_total = (cat_rank_rows[0] if cat_rank_rows else ("", 0.0))
        prev_br = _fin(prev_cat_brand.get(cat) or _metric_bucket())
        prev_mk = _fin(prev_cat_market.get(cat) or _metric_bucket())
        share_now = _share(br["total_vendido"], mk["total_vendido"])
        share_prev = _share(prev_br["total_vendido"], prev_mk["total_vendido"])
        brand_avg = _avg(cat_brands[cat].get(brand_name) or _metric_bucket())
        market_avg = _avg(cat_market[cat])
        categories.append({
            "categoria": cat,
            "brand_unidades": br["unidades"],
            "brand_pvp": br["total_vendido"],
            "brand_mix_pct": _share(br["total_vendido"], float(brand_tot["total_vendido"] or 0.0)),
            "market_pvp": mk["total_vendido"],
            "market_unidades": mk["unidades"],
            "share_pvp_pct": share_now,
            "share_units_pct": _share(br["unidades"], mk["unidades"]),
            "share_prev_pct": share_prev,
            "share_delta_pts": round(share_now - share_prev, 2),
            "rank_in_categoria": rank_in_cat,
            "marcas_en_categoria": len(cat_rank_rows),
            "leader_name": leader_name,
            "leader_share_pct": _share(leader_total, mk["total_vendido"]),
            "brand_avg_pvp": brand_avg,
            "market_avg_pvp": market_avg,
            "price_index": round(brand_avg / market_avg * 100, 1) if market_avg else 0.0,
        })
    categories.sort(key=lambda c: float(c["brand_pvp"]), reverse=True)

    # ── Tipos (granular) donde la marca juega ────────────────────────────
    tipos_top: list[dict[str, Any]] = []
    for tipo, per_brand in tipo_brands.items():
        br = _fin(per_brand.get(brand_name) or _metric_bucket())
        if not br["unidades"] and not br["total_vendido"]:
            continue
        mk = _fin(tipo_market[tipo])
        tipos_top.append({
            "tipo": tipo,
            "unidades": br["unidades"],
            "total_vendido": br["total_vendido"],
            "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
            "market_pvp": mk["total_vendido"],
        })
    tipos_top.sort(key=lambda t: float(t["total_vendido"]), reverse=True)
    tipos_top = tipos_top[:12]

    # ── Sucursales ───────────────────────────────────────────────────────
    branches: list[dict[str, Any]] = []
    for suc in sorted(branch_market.keys()):
        mk = _fin(branch_market[suc])
        br = _fin(branch_brand.get(suc) or _metric_bucket())
        branches.append({
            "sucursal": suc,
            "brand_unidades": br["unidades"],
            "brand_pvp": br["total_vendido"],
            "market_unidades": mk["unidades"],
            "share_in_branch_pct": _share(br["total_vendido"], mk["total_vendido"]),
            "share_units_in_branch_pct": _share(br["unidades"], mk["unidades"]),
            "brand_mix_pct": _share(br["total_vendido"], float(brand_tot["total_vendido"] or 0.0)),
            "market_pvp": mk["total_vendido"],
        })
    branches.sort(key=lambda b: float(b["brand_pvp"]), reverse=True)

    # ── Top productos de la marca ────────────────────────────────────────
    top_products = sorted(
        (
            {
                "sku": v["sku"], "producto": v["producto"], "tipo_producto": v["tipo_producto"],
                **_fin({k: x for k, x in v.items() if k not in ("sku", "producto", "tipo_producto")},
                       total_reference=float(brand_tot["total_vendido"] or 0.0)),
            }
            for v in products_brand.values()
        ),
        key=lambda p: float(p["total_vendido"]), reverse=True,
    )[:12]

    product_branch_metric_rows = []
    for product in top_products:
        key = (str(product["sku"] or ""), str(product["producto"] or ""))
        branch_values = {}
        for branch_name, bucket in (product_branch_metrics.get(key) or {}).items():
            metric = _fin(bucket)
            branch_values[branch_name] = {
                "unidades": metric["unidades"],
                "total_vendido": metric["total_vendido"],
            }
        product_branch_metric_rows.append({
            "sku": product["sku"],
            "producto": product["producto"],
            "tipo_producto": product["tipo_producto"],
            "total_unidades": int(product.get("unidades") or 0),
            "total_vendido": float(product.get("total_vendido") or 0.0),
            "branches": branch_values,
        })

    # ── Serie diaria (para granularidad libre + drill-down en el front) ──
    daily_series: list[dict[str, Any]] = []
    for dia in sorted(daily_market.keys()):
        mk = _fin(daily_market[dia])
        br = _fin(daily_brand.get(dia) or _metric_bucket())
        daily_series.append({
            "fecha": dia,
            "brand_unidades": br["unidades"],
            "brand_pvp": br["total_vendido"],
            "market_unidades": mk["unidades"],
            "market_pvp": mk["total_vendido"],
            "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
        })

    # ── Share apilado por semana (marca + competidores/grupos) ───────────
    share_series: list[dict[str, Any]] = []
    stack_items = [{"label": brand_name, "marcas": [brand_name], "kind": "brand"}, *comparisons]
    for sem in sorted(weekly_market.keys()):
        mk_fin = _fin(weekly_market[sem])
        mk_total = float(mk_fin["total_vendido"])
        mk_units = int(mk_fin["unidades"])
        row: dict[str, Any] = {"semana": sem, "values": {}, "values_units": {}}
        usado = 0.0
        usado_u = 0.0
        for item in stack_items:
            n = item["label"]
            b_fin = _fin(_bucket_for_brands(weekly_by_brand[sem], list(item["marcas"])))
            pct = _share(float(b_fin["total_vendido"]), mk_total)
            pct_u = _share(int(b_fin["unidades"]), mk_units)
            row["values"][n] = pct
            row["values_units"][n] = pct_u
            usado += pct
            usado_u += pct_u
        if not comparison_closed:
            row["values"]["OTRAS"] = round(max(0.0, 100.0 - usado), 2) if mk_total else 0.0
            row["values_units"]["OTRAS"] = round(max(0.0, 100.0 - usado_u), 2) if mk_units else 0.0
        share_series.append(row)

    # ── Evolución diaria por categoría (solo la marca, top 5 categorías) ─
    top_cats = [c["categoria"] for c in categories if float(c["brand_pvp"]) > 0][:5]
    category_daily: list[dict[str, Any]] = []
    for dia in sorted(daily_market.keys()):
        row = {"fecha": dia, "values": {}}
        for cat in top_cats:
            b = _fin(daily_cat_brand.get(dia, {}).get(cat) or _metric_bucket())
            row["values"][cat] = {"unidades": b["unidades"], "total_vendido": b["total_vendido"]}
        category_daily.append(row)

    # ── Comparativa por sucursal: marca vs competidores ──────────────────
    branch_compare: list[dict[str, Any]] = []
    for suc in sorted(branch_market.keys(), key=lambda s: -float(_fin(branch_market[s])["total_vendido"])):
        row = {"sucursal": suc, "values": {}}
        for item in stack_items:
            n = item["label"]
            b = _fin(_bucket_for_brands(branch_brands[suc], list(item["marcas"])))
            row["values"][n] = {"unidades": b["unidades"], "total_vendido": b["total_vendido"]}
        branch_compare.append(row)

    # ── Bandas de precio ─────────────────────────────────────────────────
    price_bands = _price_bands(market_prices, brand_prices)

    # ── Momentum por categoría (crece más o menos que el mercado) ────────
    category_momentum: list[dict[str, Any]] = []
    for cat in cat_market.keys():
        now_b = float(_fin(cat_brands[cat].get(brand_name) or _metric_bucket())["total_vendido"])
        prev_b = float(_fin(prev_cat_brand.get(cat) or _metric_bucket())["total_vendido"])
        now_m = float(_fin(cat_market[cat])["total_vendido"])
        prev_m = float(_fin(prev_cat_market.get(cat) or _metric_bucket())["total_vendido"])
        if prev_m <= 0 or (now_b <= 0 and prev_b <= 0):
            continue
        brand_g = ((now_b - prev_b) / prev_b * 100) if prev_b > 0 else (100.0 if now_b > 0 else 0.0)
        market_g = (now_m - prev_m) / prev_m * 100
        category_momentum.append({
            "categoria": cat,
            "brand_growth_pct": round(brand_g, 1),
            "market_growth_pct": round(market_g, 1),
            "outperform_pts": round(brand_g - market_g, 1),
            "brand_pvp": round(now_b, 2),
        })
    category_momentum.sort(key=lambda m: float(m["brand_pvp"]), reverse=True)

    # ── Productos en alza / en baja vs período anterior (por unidades) ───
    cur_units: dict[tuple[str, str], int] = {
        k: int(v.get("unidades") or 0) for k, v in products_brand.items()
    }
    movers: list[dict[str, Any]] = []
    # Sin período anterior no hay "alza/baja" (todo daría alza falsa).
    keys_movers = (set(cur_units) | set(prev_products_units)) if int(prev_market_tot["unidades"] or 0) > 0 else set()
    for key in keys_movers:
        now_u = cur_units.get(key, 0)
        prev_u = prev_products_units.get(key, 0)
        delta = now_u - prev_u
        if delta == 0:
            continue
        meta = products_brand.get(key)
        movers.append({
            "sku": key[0],
            "producto": key[1],
            "tipo_producto": str(meta.get("tipo_producto") if meta else ""),
            "unidades": now_u,
            "unidades_prev": prev_u,
            "delta_unidades": delta,
        })
    product_movers = {
        "up": sorted([m for m in movers if m["delta_unidades"] > 0], key=lambda m: -m["delta_unidades"])[:6],
        "down": sorted([m for m in movers if m["delta_unidades"] < 0], key=lambda m: m["delta_unidades"])[:6],
    }

    # ── Share global y precio ────────────────────────────────────────────
    share_pvp = _share(float(brand_tot["total_vendido"] or 0.0), float(market_tot["total_vendido"] or 0.0))
    share_units = _share(float(brand_tot["unidades"] or 0), float(market_tot["unidades"] or 0))
    share_prev = _share(float(prev_brand_tot["total_vendido"] or 0.0), float(prev_market_tot["total_vendido"] or 0.0))

    # Índice de precio ponderado por las categorías donde la marca vende.
    played = [c for c in categories if c["brand_pvp"]]
    if played:
        weight_total = sum(float(c["brand_pvp"]) for c in played)
        price_index_global = round(
            sum(float(c["price_index"]) * float(c["brand_pvp"]) for c in played) / weight_total, 1
        ) if weight_total else 0.0
    else:
        price_index_global = 0.0

    # ── Highlights automáticos (para el resumen ejecutivo) ──────────────
    highlights: list[str] = []
    if prev_brand_tot["unidades"]:
        growth_u = (brand_tot["unidades"] - prev_brand_tot["unidades"]) / prev_brand_tot["unidades"] * 100
        verbo = "creció" if growth_u >= 0 else "cayó"
        highlights.append(
            f"{brand_name} {verbo} {abs(growth_u):.1f}% en unidades vs el período anterior "
            f"({prev_brand_tot['unidades']:,} → {brand_tot['unidades']:,})".replace(",", ".")
        )
    if rank_pvp:
        delta_rank = f" (venía #{prev_rank})" if prev_rank and prev_rank != rank_pvp else ""
        highlights.append(
            f"#{rank_pvp} de {len(ranked)} marcas por facturación, con {share_pvp:.1f}% de participación"
            f" ({share_pvp - share_prev:+.1f} pts){delta_rank}"
        )
    lider_en = [c for c in played if c["rank_in_categoria"] == 1]
    if lider_en:
        top_cat = max(lider_en, key=lambda c: float(c["brand_pvp"]))
        highlights.append(f"Líder en {top_cat['categoria']} con {top_cat['share_pvp_pct']:.1f}% de share")
    elif played:
        best = max(played, key=lambda c: float(c["share_pvp_pct"]))
        highlights.append(
            f"Mejor posición: #{best['rank_in_categoria']} en {best['categoria']} "
            f"({best['share_pvp_pct']:.1f}% de share)"
        )
    oportunidades = [
        c for c in categories
        if float(c["market_pvp"]) > 0 and float(c["share_pvp_pct"]) < share_pvp * 0.6
        and float(c["market_pvp"]) >= float(market_tot["total_vendido"] or 0.0) * 0.08
    ]
    if oportunidades:
        opp = max(oportunidades, key=lambda c: float(c["market_pvp"]))
        highlights.append(
            f"Oportunidad en {opp['categoria']}: {opp['share_pvp_pct']:.1f}% de share vs {share_pvp:.1f}% global"
        )
    if price_index_global:
        pos = "por encima" if price_index_global >= 100 else "por debajo"
        highlights.append(
            f"Precio promedio {abs(price_index_global - 100):.0f}% {pos} del mercado en sus categorías"
        )
    if top_products:
        star = top_products[0]
        highlights.append(f"Producto estrella: {star['producto']} ({star['unidades']} u)")

    # ── "La lectura" por sección: una línea que dice QUÉ SIGNIFICA lo que
    # se ve en cada slide. Es la narrativa del deck (data storytelling).
    narratives: dict[str, str] = {}
    if monthly_series:
        best_month = max(monthly_series, key=lambda m: float(m["brand_pvp"]))
        shares_m = [float(m["share_pvp_pct"]) for m in monthly_series if float(m["market_pvp"]) > 0]
        if shares_m:
            mes_nombre = best_month["mes"]
            narratives["evolucion"] = (
                f"El mejor mes fue {mes_nombre} ({best_month['brand_unidades']} u · {_money_ar(float(best_month['brand_pvp']))}); "
                f"el share se movió entre {min(shares_m):.1f}% y {max(shares_m):.1f}%."
            )
    if rank_pvp and ranked:
        if rank_pvp == 1 and len(ranked) > 1:
            gap = float(brand_tot["total_vendido"]) - float(ranked[1]["total_vendido"])
            narratives["competencia"] = f"Lidera el mercado con {_money_ar(gap)} de ventaja sobre {ranked[1]['name']} (#2)."
        elif rank_pvp > 1:
            arriba = ranked[rank_pvp - 2]
            gap = float(arriba["total_vendido"]) - float(brand_tot["total_vendido"])
            narratives["competencia"] = f"Está a {_money_ar(gap)} de alcanzar a {arriba['name']} (#{rank_pvp - 1})."
    if category_momentum:
        wins = [m for m in category_momentum if float(m["outperform_pts"]) > 0]
        best_m = max(category_momentum, key=lambda m: float(m["outperform_pts"]))
        narratives["momentum"] = (
            f"Gana terreno en {len(wins)} de {len(category_momentum)} categorías; "
            f"el mayor avance es {best_m['categoria']} ({'+' if float(best_m['outperform_pts']) >= 0 else ''}{best_m['outperform_pts']} pts sobre el mercado)."
        )
    if played:
        c0 = played[0]
        narratives["categorias"] = (
            f"El {c0['brand_mix_pct']:.0f}% de la venta de {brand_name} sale de {c0['categoria']}, "
            f"donde es #{c0['rank_in_categoria']} con {c0['share_pvp_pct']:.1f}% de share."
        )
    # Upside cuantificado: cuánto sumaría igualar el share global donde está abajo.
    upside = sum(
        (share_pvp - float(c["share_pvp_pct"])) / 100 * float(c["market_pvp"])
        for c in categories
        if float(c["market_pvp"]) > 0 and float(c["share_pvp_pct"]) < share_pvp
    )
    if upside > 0:
        narratives["oportunidad"] = (
            f"Si {brand_name} igualara su share global ({share_pvp:.1f}%) en las categorías donde hoy está por debajo, "
            f"sumaría ≈ {_money_ar(upside)} por período."
        )
    if price_bands:
        strongest_band = max(price_bands["bands"], key=lambda b: float(b["brand_mix_units_pct"]))
        weakest_band = min(price_bands["bands"], key=lambda b: float(b["share_units_pct"]))
        narratives["bandas"] = (
            f"Concentra el {strongest_band['brand_mix_units_pct']:.0f}% de sus unidades en la gama {strongest_band['banda']}; "
            f"en la gama {weakest_band['banda']} solo captura {weakest_band['share_units_pct']:.1f}% del mercado."
        )
    if tipos_top:
        t0 = tipos_top[0]
        narratives["tipos"] = (
            f"{t0['tipo']} es su motor: {_money_ar(float(t0['total_vendido']))} "
            f"({t0['share_pvp_pct']:.1f}% de todo lo que se vende de ese tipo)."
        )
    if top_products:
        top3_pct = sum(float(p.get("participacion_pct") or 0) for p in top_products[:3])
        narratives["productos"] = (
            f"Los 3 productos top concentran el {top3_pct:.0f}% de la venta de la marca — "
            f"lidera {top_products[0]['producto']}."
        )
    if product_movers["up"] or product_movers["down"]:
        subas = sum(int(m["delta_unidades"]) for m in product_movers["up"])
        bajas = sum(int(m["delta_unidades"]) for m in product_movers["down"])
        narratives["movers"] = f"Los productos en alza suman +{subas} unidades; los en baja restan {bajas}."
    if branches:
        best_b = max(branches, key=lambda b: float(b["share_in_branch_pct"]))
        worst_b = min(branches, key=lambda b: float(b["share_in_branch_pct"]))
        if best_b is not worst_b:
            narratives["sucursales"] = (
                f"{best_b['sucursal']} es su mejor plaza ({best_b['share_in_branch_pct']:.1f}% de share); "
                f"{worst_b['sucursal']} la más floja ({worst_b['share_in_branch_pct']:.1f}%)."
            )
    if price_index_global:
        pos = "por encima" if price_index_global >= 100 else "por debajo"
        narratives["precios"] = (
            f"Vende {abs(price_index_global - 100):.0f}% {pos} del precio promedio del mercado — "
            f"{'coherente con una propuesta premium' if price_index_global >= 100 else 'compite por precio'}."
        )

    # ── Conclusiones estructuradas (slide final del deck) ────────────────
    has_prev_data = int(prev_market_tot["unidades"] or 0) > 0
    conclusions: dict[str, list[str]] = {"fortalezas": [], "oportunidades": [], "acciones": []}
    for c in lider_en[:2]:
        conclusions["fortalezas"].append(
            f"Líder en {c['categoria']} con {c['share_pvp_pct']:.1f}% de share (compiten {c['marcas_en_categoria']} marcas)"
        )
    if has_prev_data and prev_brand_tot["unidades"]:
        growth_u = (brand_tot["unidades"] - prev_brand_tot["unidades"]) / prev_brand_tot["unidades"] * 100
        if growth_u > 0:
            conclusions["fortalezas"].append(f"Crecimiento de {growth_u:.1f}% en unidades vs el período anterior")
    best_branch = max(branches, key=lambda b: float(b["share_in_branch_pct"])) if branches else None
    if best_branch and float(best_branch["share_in_branch_pct"]) > share_pvp:
        conclusions["fortalezas"].append(
            f"Plaza fuerte: {best_branch['sucursal']} con {best_branch['share_in_branch_pct']:.1f}% de share (global {share_pvp:.1f}%)"
        )
    if price_index_global >= 110:
        conclusions["fortalezas"].append(
            f"Posicionamiento premium consolidado (precio {price_index_global - 100:.0f}% sobre el mercado)"
        )
    for opp in sorted(oportunidades, key=lambda c: -float(c["market_pvp"]))[:2]:
        conclusions["oportunidades"].append(
            f"{opp['categoria']}: {opp['share_pvp_pct']:.1f}% de share en una categoría que mueve {opp['market_pvp']:,.0f}".replace(",", ".")
        )
    if price_bands:
        for band in price_bands["bands"]:
            if float(band["market_mix_units_pct"]) >= 25 and float(band["share_units_pct"]) < share_units * 0.6:
                conclusions["oportunidades"].append(
                    f"Gama {band['banda']}: {band['share_units_pct']:.1f}% de share en unidades vs {share_units:.1f}% global — hueco de surtido"
                )
                break
    worst_branch = min(branches, key=lambda b: float(b["share_in_branch_pct"])) if len(branches) > 1 else None
    if worst_branch and float(worst_branch["share_in_branch_pct"]) < share_pvp * 0.5:
        conclusions["oportunidades"].append(
            f"{worst_branch['sucursal']}: share de {worst_branch['share_in_branch_pct']:.1f}%, muy por debajo del global"
        )
    if product_movers["down"]:
        d = product_movers["down"][0]
        conclusions["oportunidades"].append(
            f"Recuperar volumen de {d['producto']} ({d['unidades_prev']} → {d['unidades']} u)"
        )
    if oportunidades:
        opp = max(oportunidades, key=lambda c: float(c["market_pvp"]))
        conclusions["acciones"].append(f"Ampliar surtido y exhibición en {opp['categoria']}")
    if price_bands:
        weak_band = min(price_bands["bands"], key=lambda b: float(b["share_units_pct"]))
        conclusions["acciones"].append(f"Evaluar modelos para la gama {weak_band['banda']}")
    if worst_branch and float(worst_branch["share_in_branch_pct"]) < share_pvp * 0.5:
        conclusions["acciones"].append(f"Plan comercial específico en {worst_branch['sucursal']}")
    if not conclusions["acciones"]:
        conclusions["acciones"].append("Sostener el mix actual y monitorear el share mensual")

    # ── Series de detalle para el Excel (mes × categoría/tipo, y por sucursal) ──
    detail: dict[str, Any] = {}
    if detail_series:
        brand_tipos = {t for mes_k in m_tipo_brand for t in m_tipo_brand[mes_k]}

        def _row(mes_k: str, dim_nombre: str, dim_valor: str, br_b, mk_b, mix_total_u: int, sucursal_n: str | None = None) -> dict[str, Any]:
            br = _fin(br_b or _metric_bucket())
            mk = _fin(mk_b or _metric_bucket())
            out: dict[str, Any] = {"mes": mes_k}
            if sucursal_n is not None:
                out["sucursal"] = sucursal_n
            out[dim_nombre] = dim_valor
            out.update({
                "brand_unidades": br["unidades"],
                "brand_pvp": br["total_vendido"],
                "market_unidades": mk["unidades"],
                "market_pvp": mk["total_vendido"],
                "share_units_pct": _share(br["unidades"], mk["unidades"]),
                "share_pvp_pct": _share(br["total_vendido"], mk["total_vendido"]),
                "mix_brand_units_pct": _share(br["unidades"], mix_total_u),
            })
            return out

        category_monthly: list[dict[str, Any]] = []
        tipo_monthly: list[dict[str, Any]] = []
        for mes_k in sorted(m_cat_market.keys()):
            brand_mes_u = int(_fin(monthly_by_brand[mes_k].get(brand_name) or _metric_bucket())["unidades"])
            for cat_k in sorted(m_cat_market[mes_k].keys()):
                row = _row(mes_k, "categoria", cat_k, m_cat_brand[mes_k].get(cat_k), m_cat_market[mes_k][cat_k], brand_mes_u)
                if row["market_unidades"] or row["brand_unidades"]:
                    category_monthly.append(row)
            for tipo_k in sorted(m_tipo_market[mes_k].keys()):
                if tipo_k not in brand_tipos:
                    continue
                row = _row(mes_k, "tipo", tipo_k, m_tipo_brand[mes_k].get(tipo_k), m_tipo_market[mes_k][tipo_k], brand_mes_u)
                if row["market_unidades"] or row["brand_unidades"]:
                    tipo_monthly.append(row)

        # Totales marca por (mes, sucursal) para el mix por sucursal.
        ms_brand_tot_u: dict[tuple, int] = defaultdict(int)
        for (mes_k, suc_k, _c), b in ms_cat_brand.items():
            ms_brand_tot_u[(mes_k, suc_k)] += int(b.get("unidades") or 0)

        category_branch_monthly: list[dict[str, Any]] = []
        for (mes_k, suc_k, cat_k) in sorted(ms_cat_market.keys()):
            row = _row(mes_k, "categoria", cat_k, ms_cat_brand.get((mes_k, suc_k, cat_k)), ms_cat_market[(mes_k, suc_k, cat_k)], ms_brand_tot_u[(mes_k, suc_k)], sucursal_n=suc_k)
            if row["market_unidades"] or row["brand_unidades"]:
                category_branch_monthly.append(row)

        tipo_branch_monthly: list[dict[str, Any]] = []
        for (mes_k, suc_k, tipo_k) in sorted(ms_tipo_market.keys()):
            if tipo_k not in brand_tipos:
                continue
            row = _row(mes_k, "tipo", tipo_k, ms_tipo_brand.get((mes_k, suc_k, tipo_k)), ms_tipo_market[(mes_k, suc_k, tipo_k)], ms_brand_tot_u[(mes_k, suc_k)], sucursal_n=suc_k)
            if row["market_unidades"] or row["brand_unidades"]:
                tipo_branch_monthly.append(row)

        detail = {
            "category_monthly": category_monthly,
            "tipo_monthly": tipo_monthly,
            "category_branch_monthly": category_branch_monthly,
            "tipo_branch_monthly": tipo_branch_monthly,
        }

    return {
        **detail,
        "marca": brand_name,
        "filters": {
            "fecha_desde": bounds[0].isoformat(),
            "fecha_hasta": bounds[1].isoformat(),
            "prev_desde": prev_bounds[0].isoformat(),
            "prev_hasta": prev_bounds[1].isoformat(),
            "sucursal": sucursal or "",
            "sucursales": _parse_csv_list(sucursales),
            "tipo_venta": tipo_venta or "",
            "competidores": comp_list,
            "competidor_grupos": comp_detail,
            "comparison_closed": comparison_closed,
            "tipos": selected_tipos,
        },
        "source": "Ventas Vs. Costos",
        "sensitive": {"include_costs": False, "include_margin": False},
        "brand_logo": brand_logo_info(brand_name),
        "brand_style": brand_style_info(brand_name),
        "available_tipos": available_tipos,
        "selected_tipos": selected_tipos,
        "tipo_groups": {
            "Lavado": sorted(_LAVADO_ALIASES),
            "A/A": sorted(_AA_ALIASES),
        },
        "totals": {
            "brand": brand_tot,
            "market": market_tot,
            "brand_prev": prev_brand_tot,
            "market_prev": prev_market_tot,
        },
        "share": {
            "pvp_pct": share_pvp,
            "units_pct": share_units,
            "prev_pvp_pct": share_prev,
            "delta_pts": round(share_pvp - share_prev, 2),
            "rank_pvp": rank_pvp,
            "rank_units": rank_units,
            "rank_prev": prev_rank,
            "total_brands": len(ranked),
        },
        "price_index_global": price_index_global,
        "monthly_series": monthly_series,
        "competitor_period_bars": monthly_series,
        "weekly_series": weekly_series,
        "daily_series": daily_series,
        "share_series": share_series,
        "category_daily": category_daily,
        "branch_compare": branch_compare,
        "ranking_by_tipo": ranking_by_tipo,
        "monthly_share_by_tipo": monthly_share_by_tipo,
        "zone_share": zone_share,
        "tipo_zone_matrix": tipo_zone_matrix,
        "price_bands_by_tipo": price_bands_by_tipo,
        "price_bands": price_bands,
        "category_momentum": category_momentum,
        "product_movers": product_movers,
        "conclusions": conclusions,
        "narratives": narratives,
        "ranking": ranking_rows,
        "comparison_items": [{"alias": brand_name, "marcas": [brand_name], "kind": "brand", "is_brand": True}, *comp_detail],
        "comparison_ranking": comparison_ranking,
        "categories": categories,
        "tipos_top": tipos_top,
        "branches": branches,
        "top_products": top_products,
        "product_branch_metrics": product_branch_metric_rows,
        "highlights": highlights[:6],
    }
