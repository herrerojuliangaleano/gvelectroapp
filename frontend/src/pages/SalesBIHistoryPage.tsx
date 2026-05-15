import { AlertTriangle, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { can, fetchSalesBIImports, fetchSalesBIStats, voidSalesBIImport } from '../api/client';
import type { SalesBIImport, SalesBIStats } from '../types';

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(s: string) {
  if (!s) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(s + 'T00:00:00'));
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

export function SalesBIHistoryPage() {
  const [items, setItems] = useState<SalesBIImport[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SalesBIStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('activo');
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoidModal, setShowVoidModal] = useState<SalesBIImport | null>(null);
  const canVoid = can('sales_bi.void');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [res, st] = await Promise.all([
        fetchSalesBIImports({ fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined, sucursal: sucursal || undefined, tipo: tipo || undefined, status: status || undefined }),
        fetchSalesBIStats(),
      ]);
      setItems(res.items);
      setTotal(res.total);
      setStats(st);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar las importaciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [fechaDesde, fechaHasta, sucursal, tipo, status]);

  async function handleVoid() {
    if (!showVoidModal) return;
    setVoidingId(showVoidModal.id);
    try {
      await voidSalesBIImport(showVoidModal.id, voidReason);
      setShowVoidModal(null);
      setVoidReason('');
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al anular la importación.');
    } finally {
      setVoidingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Historial de importaciones</h1>
          <p className="mt-1 text-sm text-white/50">{total} importación{total !== 1 ? 'es' : ''} encontrada{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/70 hover:text-white">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          {can('sales_bi.import') && (
            <Link to="/ventas-bi/importar" className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              + Nueva importación
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Importaciones activas', value: stats.total_imports },
            { label: 'Líneas de venta', value: stats.total_records.toLocaleString('es-AR') },
            { label: 'PVP total', value: fmt(stats.total_pvp) },
            { label: 'Última importación', value: stats.last_import ? `${stats.last_import.sucursal} ${fmtDate(stats.last_import.fecha)}` : '-' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/50">{label}</div>
              <div className="mt-1 text-lg font-bold text-white truncate">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="rounded-xl border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" placeholder="Desde" />
        <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="rounded-xl border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" placeholder="Hasta" />
        <input value={sucursal} onChange={(e) => setSucursal(e.target.value)} placeholder="Sucursal" className="w-36 rounded-xl border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-xl border border-white/20 bg-[#1a1a2e] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500">
          <option value="">Todos los tipos</option>
          <option value="local">Local</option>
          <option value="online">Web/Online</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-white/20 bg-[#1a1a2e] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500">
          <option value="">Todos</option>
          <option value="activo">Activos</option>
          <option value="anulado">Anulados</option>
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Fecha</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Sucursal</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Tipo</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-white/50">Líneas</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-white/50">PVP</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Estado</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Importado</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/50"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-white/40">
                  No hay importaciones para los filtros seleccionados.
                </td>
              </tr>
            )}
            {items.map((imp) => (
              <tr key={imp.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium text-white">{fmtDate(imp.fecha)}</td>
                <td className="px-4 py-3 text-white/80">{imp.sucursal}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${imp.tipo === 'online' ? 'bg-sky-500/20 text-sky-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                    {imp.tipo === 'online' ? 'WEB' : 'Local'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-white/70">{imp.total_records}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">{fmt(imp.total_pvp)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${imp.status === 'activo' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                    {imp.status === 'activo' ? 'Activo' : 'Anulado'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-white/40">{fmtDateTime(imp.created_at)}<br />{imp.imported_by_name || imp.imported_by}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Link to={`/ventas-bi/importaciones/${imp.id}`} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white" title="Ver detalle">
                      <Eye size={14} />
                    </Link>
                    {canVoid && imp.status === 'activo' && (
                      <button onClick={() => { setShowVoidModal(imp); setVoidReason(''); }} className="rounded-lg p-1.5 text-white/40 hover:bg-red-500/10 hover:text-red-400" title="Anular">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Void modal */}
      {showVoidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#1a1a2e] p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Anular importación</h3>
            <p className="mt-1 text-sm text-white/60">
              {fmtDate(showVoidModal.fecha)} — {showVoidModal.sucursal} ({showVoidModal.total_records} líneas)
            </p>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Motivo (opcional)"
              rows={3}
              className="mt-4 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-red-500"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={handleVoid} disabled={voidingId !== null} className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-red-500">
                {voidingId !== null ? 'Anulando...' : 'Anular'}
              </button>
              <button onClick={() => setShowVoidModal(null)} className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/70 hover:text-white">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
