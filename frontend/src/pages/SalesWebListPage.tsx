import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { can, fetchSalesWebOptions, fetchSalesWebRequests, getCurrentUserFromStorage } from '../api/client';
import type { SalesWebOptions, SalesWebRequest } from '../types';

const STATUS_ORDER = ['Pendiente', 'En proceso', 'Completado', 'Enviado a venta web', 'Cancelado'];

function displaySalesStatus(estado: string) {
  return estado === 'Enviado a venta web' ? 'Enviado a venta' : estado;
}

type ListMode = 'auto' | 'mine' | 'admin';

export function SalesWebListPage({ mode = 'auto', defaultEstado = '' }: { mode?: ListMode; defaultEstado?: string }) {
  const [items, setItems] = useState<SalesWebRequest[]>([]);
  const [options, setOptions] = useState<SalesWebOptions | null>(null);
  const [estado, setEstado] = useState(defaultEstado);
  const [sucursal, setSucursal] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const user = getCurrentUserFromStorage();
  const canManageAll = can('sales_web.manage');
  const canManageBranch = can('sales_web.branch_manage') || can('sales_web.take') || can('sales_web.complete') || can('sales_web.send') || can('sales_web.cancel');
  const mineOnly = mode === 'mine' || (!canManageAll && !canManageBranch && mode !== 'admin');
  const adminView = mode === 'admin' && (canManageAll || canManageBranch);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [reqs, opts] = await Promise.all([
        fetchSalesWebRequests({ estado: estado || undefined, q: q || undefined, mine: mineOnly, active_only: mineOnly, sucursal: sucursal || undefined }),
        fetchSalesWebOptions(),
      ]);
      setItems(reqs);
      setOptions(opts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar ventas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [mode, estado, sucursal]);

  function search(e: FormEvent) {
    e.preventDefault();
    load();
  }

  const sorted = useMemo(() => [...items].sort((a, b) => {
    const oa = STATUS_ORDER.indexOf(a.estado);
    const ob = STATUS_ORDER.indexOf(b.estado);
    if (oa !== ob) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    return b.id - a.id;
  }), [items]);

  const bySucursal = useMemo(() => {
    const map = new Map<string, SalesWebRequest[]>();
    for (const item of sorted) {
      const key = item.sucursal?.trim() || 'Sin sucursal';
      map.set(key, [...(map.get(key) || []), item]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sorted]);

  const statusCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of STATUS_ORDER) out[st] = 0;
    for (const item of items) out[item.estado] = (out[item.estado] || 0) + 1;
    return out;
  }, [items]);

  const title = mineOnly ? 'Mis ventas' : 'Panel de Ventas';
  const subtitle = mineOnly
    ? 'Seguimiento de tus ventas: pendientes, en proceso, completadas y enviadas.'
    : canManageAll
      ? 'Bandeja general por sucursal operativa para tomar, facturar y gestionar ventas.'
      : `Bandeja de trabajo de ${user?.sucursal || 'tu sucursal'}.`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-7 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-4xl">🧾</div>
            <h1 className="mt-2 text-3xl font-black">{title}</h1>
            <p className="mt-1 max-w-3xl text-slate-400">{subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('sales_web.create') && <Link to="/venta/nueva" className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-black text-white hover:bg-blue-400">Nueva venta</Link>}
            {!mineOnly && <Link to="/venta/mis-solicitudes" className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800">Mis ventas</Link>}
          </div>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {STATUS_ORDER.map((st) => (
          <button key={st} onClick={() => setEstado(estado === st ? '' : st)} className={`rounded-2xl border p-4 text-left transition ${estado === st ? 'border-blue-400 bg-blue-500/15' : 'border-slate-800 bg-slate-950/60 hover:bg-slate-900'}`}>
            <StatusBadge estado={st} />
            <div className="mt-3 text-2xl font-black text-white">{statusCounts[st] || 0}</div>
            <div className="text-xs text-slate-500">{st === 'Pendiente' ? 'Para tomar' : displaySalesStatus(st)}</div>
          </button>
        ))}
      </div>

      <form onSubmit={search} className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/60 p-4 lg:grid-cols-[1fr_220px_220px_auto]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por venta, solicitud, DNI, cliente, teléfono o vendedor" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
          <option value="">Todos los estados</option>
          {options?.estados.map((st) => <option key={st} value={st}>{displaySalesStatus(st)}</option>)}
        </select>
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} disabled={!canManageAll && !!user?.sucursal} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400 disabled:opacity-60">
          <option value="">{canManageAll ? 'Todas las sucursales' : (user?.sucursal || 'Mi sucursal')}</option>
          {options?.sucursales.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="rounded-xl bg-blue-500 px-5 py-3 font-black text-white">Buscar</button>
      </form>

      {loading && <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-slate-300">Cargando ventas...</div>}

      {adminView ? (
        <div className="space-y-6">
          {bySucursal.map(([branch, group]) => (
            <section key={branch} className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-white">{branch}</h2>
                  <p className="text-sm text-slate-400">{group.length} venta/s · pendientes primero</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {STATUS_ORDER.slice(0, 4).map((st) => <span key={st} className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{displaySalesStatus(st)}: {group.filter((x) => x.estado === st).length}</span>)}
                </div>
              </div>
              <div className="space-y-3">{group.map((item) => <RequestCard key={item.id} item={item} />)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3">{sorted.map((item) => <RequestCard key={item.id} item={item} />)}</div>
      )}

      {!loading && sorted.length === 0 && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No hay ventas para mostrar.</div>}
    </div>
  );
}

function RequestCard({ item }: { item: SalesWebRequest }) {
  return (
    <Link to={`/venta/${item.id}`} className="block rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-blue-400/60 hover:bg-slate-900/80">
      <div className="grid gap-3 lg:grid-cols-[160px_1fr_170px_170px_150px] lg:items-center">
        <div><div className="text-xs font-bold uppercase text-slate-500">Venta</div><div className="font-black text-white">{item.numero_solicitud}</div><div className="mt-1"><StatusBadge estado={item.estado} /></div></div>
        <div><div className="font-bold text-white">{item.apellido_nombre}</div><div className="text-sm text-slate-400">DNI {item.dni} · {item.telefono}</div><div className="text-xs text-slate-500">{item.items.length} producto/s</div></div>
        <div><div className="text-xs font-bold uppercase text-slate-500">Sucursal</div><div className="text-sm text-slate-300">{item.sucursal || '-'}</div></div>
        <div><div className="text-xs font-bold uppercase text-slate-500">Vendedor</div><div className="text-sm text-slate-300">{item.vendedor_nombre}</div></div>
        <div className="text-sm text-slate-300 lg:text-right"><div>{item.created_at_text}</div>{item.numero_remito_prefactura && <div className="font-bold text-green-200">Remito: {item.numero_remito_prefactura}</div>}</div>
      </div>
    </Link>
  );
}

export function StatusBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    Pendiente: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
    'En proceso': 'border-blue-400/40 bg-blue-500/15 text-blue-100',
    Completado: 'border-green-400/40 bg-green-500/15 text-green-100',
    'Enviado a venta web': 'border-violet-400/40 bg-violet-500/15 text-violet-100',
    Cancelado: 'border-red-400/40 bg-red-500/15 text-red-100',
  };
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${styles[estado] || 'border-slate-600 bg-slate-800 text-slate-200'}`}>{displaySalesStatus(estado)}</span>;
}
