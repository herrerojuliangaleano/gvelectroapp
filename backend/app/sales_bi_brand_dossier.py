"""Dossier de marca — informe presentable a un proveedor (ej. Samsung).

Arma en UNA respuesta todo lo que la reunión con una marca necesita:
share de mercado y evolución, ranking vs competidores, participación dentro
de cada categoría/tipo, top productos, presencia por sucursal, posicionamiento
de precio y deltas vs el período anterior.

Decisión de seguridad: este informe se proyecta frente a la marca, por lo que
NUNCA incluye costos ni márgenes (equivale a presentation=True siempre).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

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


def _resolve_brand_name(marca: str, names: list[str]) -> str:
    """Match exacto primero; después case-insensitive (canonicaliza)."""
    wanted = (marca or "").strip()
    if wanted in names:
        return wanted
    lowered = {n.lower(): n for n in names}
    return lowered.get(wanted.lower(), wanted)


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
    max_competidores: int = 3,
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
    branch_market: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    branch_brand: dict[str, dict[str, Any]] = defaultdict(_metric_bucket)
    products_brand: dict[tuple[str, str], dict[str, Any]] = {}

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
        suc = str(r.sucursal or "Sin sucursal")

        _add_metric(market, r)
        _add_metric(brands[name], r)
        _add_metric(monthly_by_brand[mes][name], r)
        _add_metric(monthly_market[mes], r)
        _add_metric(cat_market[cat], r)
        _add_metric(cat_brands[cat][name], r)
        _add_metric(tipo_market[tipo], r)
        _add_metric(branch_market[suc], r)

        if name == brand_name:
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
    for r in prev_records:
        name = str(r.marca or "Sin marca")
        _add_metric(prev_market, r)
        _add_metric(prev_brands[name], r)
        cat = str(r.categoria or "OTROS")
        _add_metric(prev_cat_market[cat], r)
        if name == brand_name:
            _add_metric(prev_cat_brand[cat], r)

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

    comp_list = _parse_csv_list(competidores)
    if not comp_list:
        comp_list = [row["name"] for row in ranked if row["name"] != brand_name][:max_competidores]
    comp_list = [c for c in comp_list if c in brands and c != brand_name][:5]

    # Ranking para el gráfico: top 12 + la marca si quedó afuera.
    ranking_rows = ranked[:12]
    if brand_name not in {row["name"] for row in ranking_rows}:
        me = next((row for row in ranked if row["name"] == brand_name), None)
        if me:
            ranking_rows.append(me)
    for row in ranking_rows:
        row["is_brand"] = row["name"] == brand_name
        row["is_competitor"] = row["name"] in comp_list

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
        for comp in comp_list:
            cb = _fin(monthly_by_brand[mes].get(comp) or _metric_bucket())
            row["competidores"][comp] = {"unidades": cb["unidades"], "total_vendido": cb["total_vendido"]}
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
            "share_in_branch_pct": _share(br["total_vendido"], mk["total_vendido"]),
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

    return {
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
        },
        "source": "Ventas Vs. Costos",
        "sensitive": {"include_costs": False, "include_margin": False},
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
        "weekly_series": weekly_series,
        "ranking": ranking_rows,
        "categories": categories,
        "tipos_top": tipos_top,
        "branches": branches,
        "top_products": top_products,
        "highlights": highlights[:6],
    }
