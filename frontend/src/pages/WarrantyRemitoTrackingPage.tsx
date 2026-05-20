import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  MapPin,
  Printer,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { downloadRemitoPdf, fetchRemitos } from '../api/client';
import type { WarrantyRemitoInfo, WarrantyRemitosResponse } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: WarrantyRemitoInfo['status']) {
  if (status === 'llegado')
    return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">LLEGADO</span>;
  if (status === 'en_transito')
    return <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">EN TRÁNSITO</span>;
  return <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-xs font-semibold text-slate-300">PENDIENTE</span>;
}

function calcDuration(startIso?: string | null, endIso?: string | null): { label: string; hours: number } | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = end - start;
  if (ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(ms / 3600000);
  if (totalMinutes < 60) return { label: `${totalMinutes} min`, hours: 0 };
  if (totalHours < 24) return { label: `${totalHours}h`, hours: totalHours };
  const days = Math.floor(totalHours / 24);
  const remH = totalHours % 24;
  return { label: remH > 0 ? `${days}d ${remH}h` : `${days}d`, hours: totalHours };
}

function TransitTimer({ remito }: { remito: WarrantyRemitoInfo }) {
  if (remito.status === 'pendiente') {
    const d = calcDuration(remito.created_at);
    if (!d) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/80 px-2 py-0.5 text-xs text-slate-400">
        <Clock className="h-3 w-3" /> Creado hace {d.label}
      </span>
    );
  }
  if (remito.status === 'en_transito') {
    const d = calcDuration(remito.fecha_despacho, null);
    if (!d) return null;
    const color =
      d.hours >= 120
        ? 'border-red-500/40 bg-red-500/10 text-red-300'
        : d.hours >= 48
        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>
        <Truck className="h-3 w-3" /> {d.label} en tránsito{d.hours >= 120 ? ' ⚠' : ''}
      </span>
    );
  }
  if (remito.status === 'llegado') {
    const d = calcDuration(remito.fecha_despacho, remito.fecha_llegada);
    if (!d) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> Tránsito: {d.label}
      </span>
    );
  }
  return null;
}

async function printRemitoPdf(remitoCode: string): Promise<void> {
  const blob = await downloadRemitoPdf(remitoCode);
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(iframe);
  await new Promise<void>((resolve) => {
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
      catch { window.open(url, '_blank'); }
      setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); resolve(); }, 2000);
    };
    iframe.onerror = () => { document.body.removeChild(iframe); URL.revokeObjectURL(url); window.open(url, '_blank'); resolve(); };
    iframe.src = url;
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export function WarrantyRemitoTrackingPage() {
  const [data, setData] = useState<WarrantyRemitosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Expanded state per remito
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filterStatus) params.status = filterStatus;
      if (filterBranch.trim()) params.origen_sucursal = filterBranch.trim();
      const res = await fetchRemitos(params);
      setData(res);
    } catch (e: unknown) {
      setError((e as Error).message || 'Error al cargar remitos');
    } finally {
      setLoading(false);
    }
  }

  // Re-load when filters change
  useEffect(() => { load(); }, [filterStatus, filterBranch]);

  async function handleDownloadPdf(remitoCode: string) {
    try {
      const blob = await downloadRemitoPdf(remitoCode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${remitoCode}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      alert((e as Error).message || 'Error al descargar PDF');
    }
  }

  const remitos = useMemo<WarrantyRemitoInfo[]>(
    () => (Array.isArray(data?.items) ? data!.items : []),
    [data],
  );

  // All unique branches in the results (for filter dropdown)
  const allBranches = useMemo(
    () => [...new Set(remitos.map((r) => r.origen_sucursal).filter(Boolean))].sort(),
    [remitos],
  );

  // Group remitos by origen_sucursal
  const grouped = useMemo(() => {
    const map = new Map<string, WarrantyRemitoInfo[]>();
    for (const r of remitos) {
      const key = r.origen_sucursal || 'Sin sucursal';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // Sort groups: branches with en_transito first, then by name
    return [...map.entries()].sort(([aKey, aItems], [bKey, bItems]) => {
      const aHasTransit = aItems.some((r) => r.status === 'en_transito') ? 1 : 0;
      const bHasTransit = bItems.some((r) => r.status === 'en_transito') ? 1 : 0;
      if (aHasTransit !== bHasTransit) return bHasTransit - aHasTransit;
      return aKey.localeCompare(bKey);
    });
  }, [remitos]);

  const totalRemitos = data?.total ?? remitos.length;
  const transitCount = remitos.filter((r) => r.status === 'en_transito').length;
  const pendCount = remitos.filter((r) => r.status === 'pendiente').length;
  const llegCount = remitos.filter((r) => r.status === 'llegado').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950/40 p-5 shadow-2xl shadow-blue-950/20">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-blue-500/15 p-3 ring-1 ring-blue-400/30">
              <Truck className="h-8 w-8 text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Historial de remitos</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Seguimiento global de todos los remitos internos, agrupados por sucursal de origen.
              </p>
            </div>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[420px]">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/60 p-3 text-center">
              <div className="text-xl font-black text-white">{totalRemitos}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Total</div>
            </div>
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/60 p-3 text-center">
              <div className="text-xl font-black text-slate-200">{pendCount}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Pendientes</div>
            </div>
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
              <div className="text-xl font-black text-amber-200">{transitCount}</div>
              <div className="text-[11px] uppercase tracking-wide text-amber-300/70">En tránsito</div>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
              <div className="text-xl font-black text-emerald-200">{llegCount}</div>
              <div className="text-[11px] uppercase tracking-wide text-emerald-300/70">Llegados</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
        >
          <option value="">Todas las sucursales</option>
          {allBranches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select
          className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_transito">En tránsito</option>
          <option value="llegado">Llegado</option>
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
        {(filterBranch || filterStatus) && (
          <button
            onClick={() => { setFilterBranch(''); setFilterStatus(''); }}
            className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-900"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center text-slate-400">
          <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin" />
          Cargando remitos...
        </div>
      )}

      {!loading && remitos.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 py-14 text-center text-slate-400">
          <Truck className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">No hay remitos que coincidan con los filtros.</p>
        </div>
      )}

      {/* Groups */}
      {!loading && grouped.map(([branchName, items]) => {
        const hasTransit = items.some((r) => r.status === 'en_transito');
        const branchPend = items.filter((r) => r.status === 'pendiente').length;
        const branchTransit = items.filter((r) => r.status === 'en_transito').length;
        const branchLleg = items.filter((r) => r.status === 'llegado').length;

        return (
          <section
            key={branchName}
            className={`overflow-hidden rounded-3xl border ${
              hasTransit ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800 bg-slate-950'
            }`}
          >
            {/* Branch header */}
            <div className={`flex flex-wrap items-center gap-3 px-5 py-4 ${
              hasTransit ? 'border-b border-amber-500/20' : 'border-b border-slate-800'
            }`}>
              <Building2 className={`h-5 w-5 shrink-0 ${hasTransit ? 'text-amber-400' : 'text-slate-500'}`} />
              <h2 className="text-base font-black text-white">{branchName}</h2>
              <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                {branchPend > 0 && (
                  <span className="rounded-full bg-slate-700/60 px-2 py-0.5 font-semibold text-slate-300">
                    {branchPend} pendiente{branchPend !== 1 ? 's' : ''}
                  </span>
                )}
                {branchTransit > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">
                    {branchTransit} en tránsito
                  </span>
                )}
                {branchLleg > 0 && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-300">
                    {branchLleg} llegado{branchLleg !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Remitos list */}
            <div className="divide-y divide-slate-800/60 p-2">
              {items.map((remito) => {
                const isExp = expanded[remito.remito_code] ?? false;

                return (
                  <div key={remito.remito_code} className="overflow-hidden rounded-2xl">
                    {/* Row */}
                    <div className="flex flex-wrap items-start gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-black text-white">{remito.remito_code}</span>
                          {statusBadge(remito.status)}
                          <TransitTimer remito={remito} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{remito.destino_deposito}
                          </span>
                          <span>·</span>
                          <span>{remito.warranties_count} garantía{remito.warranties_count !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{remito.created_at_display}</span>
                          {remito.created_by_name && <><span>·</span><span>{remito.created_by_name}</span></>}
                        </div>
                        {remito.status === 'en_transito' && remito.fecha_despacho_display && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-amber-300/80">
                            <Truck className="h-3 w-3" />
                            Despachado el {remito.fecha_despacho_display}
                            {remito.despachado_por_name && ` · ${remito.despachado_por_name}`}
                          </div>
                        )}
                        {remito.status === 'llegado' && remito.fecha_llegada_display && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-emerald-300/80">
                            <CheckCircle2 className="h-3 w-3" />
                            Llegó el {remito.fecha_llegada_display}
                            {remito.recibido_por_name && ` · recibido por ${remito.recibido_por_name}`}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => handleDownloadPdf(remito.remito_code)}
                          className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-blue-500 hover:text-blue-300"
                          title="Descargar PDF"
                        >
                          <Download className="h-3.5 w-3.5" /> PDF
                        </button>
                        <button
                          onClick={() => printRemitoPdf(remito.remito_code)}
                          className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-violet-500 hover:text-violet-300"
                          title="Imprimir"
                        >
                          <Printer className="h-3.5 w-3.5" /> Imprimir
                        </button>
                        <button
                          onClick={() => setExpanded((p) => ({ ...p, [remito.remito_code]: !p[remito.remito_code] }))}
                          className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                        >
                          {isExp ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isExp ? 'Ocultar' : 'Detalle'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExp && (
                      <div className="border-t border-slate-800/60 bg-slate-900/40 p-4 space-y-3">
                        {remito.nota && (
                          <p className="text-sm text-slate-400">
                            <span className="font-semibold text-slate-300">Nota:</span> {remito.nota}
                          </p>
                        )}
                        {remito.warranties && remito.warranties.length > 0 && (
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-950 text-left text-xs text-slate-400">
                                <tr>
                                  <th className="px-3 py-2">ID</th>
                                  <th className="px-3 py-2">Producto</th>
                                  <th className="px-3 py-2">SKU</th>
                                  <th className="px-3 py-2">Serie</th>
                                  <th className="px-3 py-2">Falla</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800">
                                {remito.warranties.map((w) => (
                                  <tr key={`${remito.remito_code}-${w.warranty_code}`}>
                                    <td className="px-3 py-2 font-mono text-xs font-bold text-slate-300">{w.warranty_code}</td>
                                    <td className="px-3 py-2 text-white"><div className="max-w-[180px] truncate">{w.producto}</div></td>
                                    <td className="px-3 py-2 text-slate-300">{w.sku || '—'}</td>
                                    <td className="px-3 py-2 text-slate-300">{w.serie || '—'}</td>
                                    <td className="px-3 py-2 text-slate-400">{w.falla || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />{remito.origen_sucursal}
                          </span>
                          <ArrowRight className="h-3 w-3" />
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{remito.destino_deposito}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Legend */}
      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Flujo operativo</h3>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-slate-600/40 px-2 py-0.5 font-semibold text-slate-300">PENDIENTE</span>
            PDF generado
          </span>
          <ArrowRight className="h-3 w-3 text-slate-600" />
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">EN TRÁNSITO</span>
            Salió del origen
          </span>
          <ArrowRight className="h-3 w-3 text-slate-600" />
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-300">LLEGADO</span>
            Recibido en depósito
          </span>
        </div>
      </section>
    </div>
  );
}
