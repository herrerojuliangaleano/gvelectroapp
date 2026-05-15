import { AlertTriangle, ArrowLeft, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { can, fetchSalesBIImport, voidSalesBIImport } from '../api/client';
import type { SalesBIImportDetail, SalesBIRecord } from '../types';

function fmt(n: number | undefined) {
  if (n === undefined) return '-';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(s: string) {
  if (!s) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(s + 'T00:00:00'));
  } catch {
    return s;
  }
}

function fmtDateTime(s: string) {
  if (!s) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s));
  } catch {
    return s;
  }
}

function pct(n: number | undefined) {
  if (n === undefined) return '-';
  return n.toFixed(1) + '%';
}

export function SalesBIDetailPage() {
  const { importId } = useParams<{ importId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SalesBIImportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Filters
  const [q, setQ] = useState('');
  const [filterVendedor, setFilterVendedor] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [filterCondicion, setFilterCondicion] = useState('');

  const canVoid = can('sales_bi.void');
  const canViewCosts = can('sales_bi.view_costs');
  const canViewMargin = can('sales_bi.view_margin');

  async function load() {
    if (!importId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchSalesBIImport(Number(importId));
      setDetail(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar la importación.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [importId]);

  async function handleVoid() {
    if (!detail) return;
    setVoiding(true);
    try {
      await voidSalesBIImport(detail.id, voidReason);
      navigate('/ventas-bi/historial');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al anular.');
      setVoiding(false);
    }
  }

  const filteredRecords: SalesBIRecord[] = (detail?.records ?? []).filter((r) => {
    if (q && !r.producto.toLowerCase().includes(q.toLowerCase()) && !r.sku.toLowerCase().includes(q.toLowerCase()) && !r.marca.toLowerCase().includes(q.toLowerCase())) return false;
    if (filterVendedor && r.vendedor !== filterVendedor) return false;
    if (filterCategoria && r.categoria !== filterCategoria) return false;
    if (filterCondicion && r.condicion !== filterCondicion) return false;
    return true;
  });

  const vendedores = [...new Set((detail?.records ?? []).map((r) => r.vendedor).filter(Boolean))].sort();
  const categorias = [...new Set((detail?.records ?? []).map((r) => r.categoria).filter(Boolean))].sort();

  if (loading) return <div className="text-white/50 text-sm">Cargando...</div>;
  if (error) return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      {error}
    </div>
  );
  if (!detail) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/ventas-bi/historial" className="mb-2 flex items-center gap-1 text-sm text-white/40 hover:text-white">
            <ArrowLeft size={13} />
            Historial
          </Link>
          <h1 className="text-2xl font-black text-white">
            {fmtDate(detail.fecha)} — {detail.sucursal}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${detail.tipo === 'online' ? 'bg-sky-500/20 text-sky-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              {detail.tipo === 'online' ? 'WEB/Online' : 'Local'}
            </span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${detail.status === 'activo' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
              {detail.status === 'activo' ? 'Activo' : 'Anulado'}
            </span>
            <span className="text-xs text-white/40">Importado {fmtDateTime(detail.created_at)} por {detail.imported_by_name || detail.imported_by}</span>
          </div>
          {detail.status === 'anulado' && (
            <p className="mt-1 text-xs text-red-300">
              Anulado {fmtDateTime(detail.voided_at)} por {detail.voided_by}
              {detail.void_reason ? ` — ${detail.void_reason}` : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/60 hover:text-white">
            <RefreshCw size={14} />
          </button>
          {canVoid && detail.status === 'activo' && (
            <button onClick={() => { setShowVoidModal(true); setVoidReason(''); }} className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/20">
              <Trash2 size={14} />
              Anular
            </button>
          )}
        </div>
      </div>

      {/* Warnings */}
      {detail.warnings?.length > 0 && (
        <div className="space-y-1">
          {detail.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {[
          { label: 'Líneas', value: detail.total_records.toLocaleString('es-AR') },
          { label: 'PVP total', value: fmt(detail.total_pvp), highlight: true },
          { label: 'Efectivo', value: fmt(detail.total_efectivo) },
          { label: 'Transferencia', value: fmt(detail.total_transferencia) },
          { label: 'Tarjeta', value: fmt(detail.total_tarjeta) },
          { label: 'USD', value: fmt(detail.total_usd) },
          { label: 'Cta. Cte.', value: fmt(detail.total_cuenta_corriente) },
          { label: 'Otros', value: fmt(detail.total_otros) },
        ].map(({ label, value, highlight }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-xs text-white/50">{label}</div>
            <div className={`mt-1 text-base font-bold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Balances */}
      {detail.balances?.length > 0 && (
        <div>
          <h2 className="mb-2 text-base font-bold text-white">Saldos por remito</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-2 text-left text-xs text-white/50">Remito</th>
                  <th className="px-4 py-2 text-right text-xs text-white/50">Efectivo</th>
                  <th className="px-4 py-2 text-right text-xs text-white/50">Transferencia</th>
                  <th className="px-4 py-2 text-right text-xs text-white/50">Tarjeta</th>
                  <th className="px-4 py-2 text-right text-xs text-white/50">USD</th>
                  <th className="px-4 py-2 text-right text-xs text-white/50">Otros</th>
                  <th className="px-4 py-2 text-right text-xs text-white/50">Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.balances.map((b) => (
                  <tr key={b.id} className="border-b border-white/5">
                    <td className="px-4 py-2 text-white/80">{b.remito || '-'}</td>
                    <td className="px-4 py-2 text-right text-white/70">{b.efectivo ? fmt(b.efectivo) : '-'}</td>
                    <td className="px-4 py-2 text-right text-white/70">{b.transferencia ? fmt(b.transferencia) : '-'}</td>
                    <td className="px-4 py-2 text-right text-white/70">{b.tarjeta ? fmt(b.tarjeta) : '-'}</td>
                    <td className="px-4 py-2 text-right text-white/70">{b.usd ? fmt(b.usd) : '-'}</td>
                    <td className="px-4 py-2 text-right text-white/70">{b.otros ? fmt(b.otros) : '-'}</td>
                    <td className="px-4 py-2 text-right font-medium text-white">{fmt(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Records */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-white">Líneas de venta</h2>
          <span className="text-xs text-white/40">({filteredRecords.length} de {detail.total_records})</span>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto / SKU..." className="w-48 rounded-xl border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500" />
          {vendedores.length > 1 && (
            <select value={filterVendedor} onChange={(e) => setFilterVendedor(e.target.value)} className="rounded-xl border border-white/20 bg-[#1a1a2e] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500">
              <option value="">Todos los vendedores</option>
              {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {categorias.length > 1 && (
            <select value={filterCategoria} onChange={(e) => setFilterCategoria(e.target.value)} className="rounded-xl border border-white/20 bg-[#1a1a2e] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select value={filterCondicion} onChange={(e) => setFilterCondicion(e.target.value)} className="rounded-xl border border-white/20 bg-[#1a1a2e] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500">
            <option value="">Condición</option>
            <option value="PRIMERA">Primera</option>
            <option value="OUTLET">Outlet</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2.5 text-left text-xs text-white/50">Remito</th>
                <th className="px-3 py-2.5 text-left text-xs text-white/50">Vendedor</th>
                <th className="px-3 py-2.5 text-left text-xs text-white/50">Producto</th>
                <th className="px-3 py-2.5 text-left text-xs text-white/50">SKU</th>
                <th className="px-3 py-2.5 text-left text-xs text-white/50">Marca</th>
                <th className="px-3 py-2.5 text-left text-xs text-white/50">Categ.</th>
                <th className="px-3 py-2.5 text-left text-xs text-white/50">Cond.</th>
                <th className="px-3 py-2.5 text-right text-xs text-white/50">Cant.</th>
                <th className="px-3 py-2.5 text-right text-xs text-white/50">PVP</th>
                {canViewCosts && <th className="px-3 py-2.5 text-right text-xs text-white/50">Costo</th>}
                {canViewMargin && <th className="px-3 py-2.5 text-right text-xs text-white/50">Margen</th>}
                <th className="px-3 py-2.5 text-right text-xs text-white/50">Total cobrado</th>
                <th className="px-3 py-2.5 text-right text-xs text-white/50">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-6 text-center text-white/40">Sin resultados para los filtros aplicados.</td>
                </tr>
              )}
              {filteredRecords.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 text-xs text-white/50">{r.remito || '-'}</td>
                  <td className="px-3 py-2 text-xs text-white/70">{r.vendedor || '-'}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-white" title={r.producto}>{r.producto}</td>
                  <td className="px-3 py-2 font-mono text-xs text-white/60">{r.sku || '-'}</td>
                  <td className="px-3 py-2 text-xs text-white/60">{r.marca || '-'}</td>
                  <td className="px-3 py-2">
                    {r.categoria && <span className="rounded px-1.5 py-0.5 text-xs bg-white/10 text-white/60">{r.categoria}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${r.condicion === 'OUTLET' ? 'bg-orange-500/20 text-orange-300' : 'bg-white/10 text-white/50'}`}>
                      {r.condicion}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-white/70">{r.cantidad}</td>
                  <td className="px-3 py-2 text-right text-white/70">{fmt(r.pvp)}</td>
                  {canViewCosts && <td className="px-3 py-2 text-right text-white/50">{fmt(r.costo)}</td>}
                  {canViewMargin && (
                    <td className={`px-3 py-2 text-right text-xs font-medium ${(r.margen_porcentaje ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {pct(r.margen_porcentaje)}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-medium text-emerald-400">{fmt(r.total_cobrado)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.saldo > 0
                      ? <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">{fmt(r.saldo)}</span>
                      : <span className="text-xs text-white/20">-</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Void modal */}
      {showVoidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#1a1a2e] p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Anular importación</h3>
            <p className="mt-1 text-sm text-white/60">{fmtDate(detail.fecha)} — {detail.sucursal} ({detail.total_records} líneas)</p>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Motivo (opcional)"
              rows={3}
              className="mt-4 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-red-500"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={handleVoid} disabled={voiding} className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-red-500">
                {voiding ? 'Anulando...' : 'Anular'}
              </button>
              <button onClick={() => setShowVoidModal(false)} className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/70 hover:text-white">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
