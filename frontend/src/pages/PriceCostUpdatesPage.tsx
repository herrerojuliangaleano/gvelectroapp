import { AlertTriangle, CheckCircle2, CircleDollarSign, ClipboardCheck, RefreshCw, Search, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  can,
  cancelPriceCostUpdate,
  createPriceCostUpdate,
  fetchPriceCostUpdateHistory,
  fetchPriceCostUpdates,
  lookupPriceCostProduct,
  setPriceCostUpdateCheck,
} from '../api/client';
import type { PriceCostProductLookup, PriceCostUpdate, PriceCostUpdateHistory, PriceCostUpdateType } from '../types';

const STATUS_ORDER = ['Pendiente', 'En proceso', 'Completado', 'Cancelado'];

function typeLabel(type: PriceCostUpdateType) {
  return type === 'price' ? 'Precio' : 'Costo';
}

function lowerTypeLabel(type: PriceCostUpdateType) {
  return type === 'price' ? 'precio' : 'costo';
}

function canCreate(type: PriceCostUpdateType) {
  return can(type === 'price' ? 'price_updates.create' : 'cost_updates.create');
}

function canCheck(type: PriceCostUpdateType) {
  return can(type === 'price' ? 'price_updates.check' : 'cost_updates.check');
}

function canCancel(type: PriceCostUpdateType) {
  return can(type === 'price' ? 'price_updates.delete' : 'cost_updates.delete');
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function PriceCostUpdatesPage() {
  const canViewPrice = can('price_updates.view');
  const canViewCost = can('cost_updates.view');
  const defaultType: PriceCostUpdateType = canViewPrice ? 'price' : 'cost';
  const [items, setItems] = useState<PriceCostUpdate[]>([]);
  const [selected, setSelected] = useState<PriceCostUpdate | null>(null);
  const [history, setHistory] = useState<PriceCostUpdateHistory[]>([]);
  const [type, setType] = useState<PriceCostUpdateType | ''>('');
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchPriceCostUpdates({ type, estado, q, limit: 250 });
      setItems(rows);
      if (selected) {
        const fresh = rows.find((item) => item.id === selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las actualizaciones.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [type, estado]);

  async function search(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function openDetail(item: PriceCostUpdate) {
    setSelected(item);
    setHistory([]);
    try {
      const rows = await fetchPriceCostUpdateHistory(item.id);
      setHistory(rows);
    } catch {
      setHistory([]);
    }
  }

  async function toggleCheck(item: PriceCostUpdate, checkKey: string, checked: boolean) {
    setBusy(true);
    setError('');
    try {
      const updated = await setPriceCostUpdateCheck(item.id, checkKey, checked);
      setItems((prev) => prev.map((row) => row.id === updated.id ? updated : row));
      setSelected(updated);
      const rows = await fetchPriceCostUpdateHistory(updated.id).catch(() => []);
      setHistory(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el check.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelItem(item: PriceCostUpdate) {
    const ok = window.confirm(`¿Cancelar esta actualización urgente de ${lowerTypeLabel(item.type)}?`);
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const updated = await cancelPriceCostUpdate(item.id, 'Cancelado desde el panel');
      setItems((prev) => prev.map((row) => row.id === updated.id ? updated : row));
      setSelected(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar.');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const result: Record<string, number> = { Pendiente: 0, 'En proceso': 0, Completado: 0, Cancelado: 0, price: 0, cost: 0 };
    for (const item of items) {
      result[item.estado] = (result[item.estado] || 0) + 1;
      result[item.type] = (result[item.type] || 0) + 1;
    }
    return result;
  }, [items]);

  const sorted = useMemo(() => [...items].sort((a, b) => {
    const oa = STATUS_ORDER.indexOf(a.estado);
    const ob = STATUS_ORDER.indexOf(b.estado);
    if (oa !== ob) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    return b.id - a.id;
  }), [items]);

  if (!canViewPrice && !canViewCost) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-100">
        <div className="text-2xl font-black">Sin permisos</div>
        <p className="mt-2 text-sm text-amber-100/80">Tu usuario no tiene habilitado el módulo de precios/costos.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-red-200">
              <AlertTriangle size={14} /> Urgente por defecto
            </div>
            <h1 className="mt-3 text-3xl font-black">Actualizaciones de precios y costos</h1>
            <p className="mt-2 max-w-3xl text-slate-400">Seguimiento de cambios urgentes con control por sistema: Puma, webs y Planilla Madre.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(canCreate('price') || canCreate('cost')) && <button onClick={() => setShowNew(true)} className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-black text-white hover:bg-blue-400">Nueva actualización</button>}
            <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800"><RefreshCw size={16} /> Refrescar</button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Pendientes" value={counts.Pendiente || 0} tone="amber" />
        <StatCard label="En proceso" value={counts['En proceso'] || 0} tone="blue" />
        <StatCard label="Completados" value={counts.Completado || 0} tone="green" />
        <StatCard label="Cancelados" value={counts.Cancelado || 0} tone="slate" />
        {canViewPrice && <StatCard label="Precios" value={counts.price || 0} tone="violet" />}
        {canViewCost && <StatCard label="Costos" value={counts.cost || 0} tone="red" />}
      </div>

      <form onSubmit={search} className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/60 p-4 lg:grid-cols-[1fr_180px_180px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, producto o marca" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-10 py-3 outline-none focus:border-blue-400" />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as PriceCostUpdateType | '')} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
          <option value="">Precio/costo</option>
          {canViewPrice && <option value="price">Precios</option>}
          {canViewCost && <option value="cost">Costos</option>}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
          <option value="">Todos los estados</option>
          {STATUS_ORDER.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <button className="rounded-xl bg-blue-500 px-5 py-3 font-black text-white">Buscar</button>
      </form>

      {loading && <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-slate-300">Cargando actualizaciones</div>}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3">
          {sorted.map((item) => <UpdateCard key={item.id} item={item} selected={selected?.id === item.id} onClick={() => openDetail(item)} />)}
          {!loading && sorted.length === 0 && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No hay actualizaciones para mostrar.</div>}
        </div>

        <aside className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5 xl:sticky xl:top-6 xl:self-start">
          {selected ? (
            <DetailPanel item={selected} history={history} busy={busy} onToggle={toggleCheck} onCancel={cancelItem} />
          ) : (
            <div className="py-10 text-center text-slate-400">
              <ClipboardCheck className="mx-auto mb-3 text-slate-500" size={42} />
              Seleccioná una actualización para marcar checks y ver el historial.
            </div>
          )}
        </aside>
      </section>

      {showNew && <NewUpdateModal defaultType={defaultType} onClose={() => setShowNew(false)} onCreated={(item) => { setShowNew(false); setItems((prev) => [item, ...prev]); openDetail(item); }} />}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'blue' | 'green' | 'slate' | 'violet' | 'red' }) {
  const styles: Record<'amber' | 'blue' | 'green' | 'slate' | 'violet' | 'red', string> = {
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    blue: 'border-blue-400/30 bg-blue-500/10 text-blue-100',
    green: 'border-green-400/30 bg-green-500/10 text-green-100',
    slate: 'border-slate-700 bg-slate-950/60 text-slate-200',
    violet: 'border-violet-400/30 bg-violet-500/10 text-violet-100',
    red: 'border-red-400/30 bg-red-500/10 text-red-100',
  };
  return <div className={`rounded-2xl border p-4 ${styles[tone]}`}><div className="text-xs font-black uppercase tracking-wide opacity-80">{label}</div><div className="mt-2 text-3xl font-black">{value}</div></div>;
}

function UpdateCard({ item, selected, onClick }: { item: PriceCostUpdate; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`block w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-blue-400 bg-blue-500/10' : 'border-slate-800 bg-slate-950/70 hover:border-blue-400/60 hover:bg-slate-900/80'}`}>
      <div className="grid gap-3 lg:grid-cols-[120px_1fr_150px_160px] lg:items-center">
        <div>
          <TypeBadge type={item.type} />
          <div className="mt-2"><StatusBadge estado={item.estado} /></div>
        </div>
        <div className="min-w-0">
          <div className="truncate font-black text-white">{item.producto}</div>
          <div className="text-sm text-slate-400">SKU {item.sku} {item.marca ? `· ${item.marca}` : ''}</div>
          {item.auto_created && <div className="mt-1 text-xs font-bold text-violet-300">Origen: Actualización de catálogo</div>}
          {item.lookup_warning && <div className="mt-1 text-xs text-amber-200">{item.lookup_warning}</div>}
        </div>
        <div>
          <div className="text-xs font-bold uppercase text-slate-500">Antes → Nuevo</div>
          <div className="text-sm font-bold text-slate-100">{item.valor_anterior || '-'} → {item.valor_nuevo}</div>
        </div>
        <div className="lg:text-right">
          <div className="text-sm font-black text-white">{item.checked_count}/{item.total_checks} checks</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-blue-500" style={{ width: `${item.progress_percent}%` }} /></div>
          <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
        </div>
      </div>
    </button>
  );
}

function DetailPanel({ item, history, busy, onToggle, onCancel }: { item: PriceCostUpdate; history: PriceCostUpdateHistory[]; busy: boolean; onToggle: (item: PriceCostUpdate, checkKey: string, checked: boolean) => void; onCancel: (item: PriceCostUpdate) => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <TypeBadge type={item.type} />
          <h2 className="mt-3 text-2xl font-black text-white">{item.producto}</h2>
          <p className="text-sm text-slate-400">SKU {item.sku} {item.marca ? `· ${item.marca}` : ''}</p>
          {item.auto_created && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-bold text-violet-300">
              Origen: Actualización de catálogo
            </p>
          )}
        </div>
        <StatusBadge estado={item.estado} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniValue label={`${typeLabel(item.type)} anterior`} value={item.valor_anterior || '-'} />
        <MiniValue label={`${typeLabel(item.type)} nuevo`} value={item.valor_nuevo} />
        <MiniValue label="Diferencia" value={item.diferencia || '-'} />
      </div>

      <div>
        <h3 className="mb-3 text-lg font-black">Checklist urgente</h3>
        <div className="space-y-2">
          {item.checks.map((check) => (
            <label key={check.key} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${check.checked ? 'border-green-400/30 bg-green-500/10' : 'border-slate-800 bg-slate-900/60'}`}>
              <input type="checkbox" checked={check.checked} disabled={busy || !canCheck(item.type) || item.estado === 'Cancelado'} onChange={(e) => onToggle(item, check.key, e.target.checked)} className="mt-1 h-5 w-5 accent-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-white">{check.label}</div>
                <div className="text-xs text-slate-400">{check.checked ? `Marcado por ${check.checked_by_name || check.checked_by || '-'} · ${formatDateTime(check.checked_at)}` : 'Pendiente de actualizar'}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {canCancel(item.type) && item.estado !== 'Cancelado' && <button onClick={() => onCancel(item)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-3 text-sm font-black text-red-100 hover:bg-red-500/10"><XCircle size={16} /> Cancelar actualización</button>}

      <div>
        <h3 className="mb-3 text-lg font-black">Historial</h3>
        <div className="space-y-2">
          {history.map((row) => <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-sm"><div className="font-bold text-white">{row.action}</div><div className="text-xs text-slate-400">{row.display_name} · {formatDateTime(row.created_at)}</div></div>)}
          {history.length === 0 && <div className="text-sm text-slate-500">Sin historial para mostrar.</div>}
        </div>
      </div>
    </div>
  );
}

function NewUpdateModal({ defaultType, onClose, onCreated }: { defaultType: PriceCostUpdateType; onClose: () => void; onCreated: (item: PriceCostUpdate) => void }) {
  const availableTypes = useMemo(() => {
    const out: PriceCostUpdateType[] = [];
    if (canCreate('price')) out.push('price');
    if (canCreate('cost')) out.push('cost');
    return out;
  }, []);
  const [type, setType] = useState<PriceCostUpdateType>(availableTypes.includes(defaultType) ? defaultType : availableTypes[0] || 'price');
  const [sku, setSku] = useState('');
  const [producto, setProducto] = useState('');
  const [marca, setMarca] = useState('');
  const [valorAnterior, setValorAnterior] = useState('');
  const [valorNuevo, setValorNuevo] = useState('');
  const [lookup, setLookup] = useState<PriceCostProductLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function doLookup() {
    if (!sku.trim()) return;
    setLookupLoading(true);
    setError('');
    try {
      const result = await lookupPriceCostProduct(sku.trim(), type);
      setLookup(result);
      if (result.producto) setProducto(result.producto);
      if (result.marca) setMarca(result.marca);
      if (result.sku) setSku(result.sku);
      if (result.valor_anterior) setValorAnterior(result.valor_anterior);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo buscar el producto.');
    } finally {
      setLookupLoading(false);
    }
  }

  useEffect(() => {
    setLookup(null);
    setValorAnterior('');
  }, [type]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await createPriceCostUpdate({ type, sku, producto, marca, valor_anterior: valorAnterior, valor_nuevo: valorNuevo });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la actualización.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-black uppercase text-red-200"><AlertTriangle size={14} /> Urgente</div>
            <h2 className="mt-3 text-2xl font-black">Nueva actualización</h2>
            <p className="mt-1 text-sm text-slate-400">El valor anterior se toma del catálogo local sincronizado por SKU/modelo.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 p-2 hover:bg-slate-800"><XCircle size={20} /></button>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-300">Tipo</span>
            <select value={type} onChange={(e) => setType(e.target.value as PriceCostUpdateType)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
              {availableTypes.includes('price') && <option value="price">Precio</option>}
              {availableTypes.includes('cost') && <option value="cost">Costo</option>}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-300">SKU / modelo</span>
            <div className="flex gap-2">
              <input value={sku} onChange={(e) => setSku(e.target.value)} onBlur={doLookup} required className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
              <button type="button" onClick={doLookup} disabled={lookupLoading || !sku.trim()} className="rounded-xl border border-slate-700 px-4 py-3 font-bold hover:bg-slate-800 disabled:opacity-50">Buscar</button>
            </div>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-bold text-slate-300">Producto</span>
            <input value={producto} onChange={(e) => setProducto(e.target.value)} required className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-300">Marca</span>
            <input value={marca} onChange={(e) => setMarca(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-300">{typeLabel(type)} anterior</span>
            <input value={valorAnterior} onChange={(e) => setValorAnterior(e.target.value)} placeholder="Autocompletado" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-bold text-slate-300">{typeLabel(type)} nuevo</span>
            <input value={valorNuevo} onChange={(e) => setValorNuevo(e.target.value)} required placeholder="Ej: 950.000" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
          </label>
        </div>

        {lookup && <div className={`mt-4 rounded-xl border p-3 text-sm ${lookup.found ? 'border-green-400/30 bg-green-500/10 text-green-100' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'}`}>{lookup.found ? `Encontrado en ${lookup.source}. Valor anterior: ${lookup.valor_anterior || '-'}` : lookup.warning}</div>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-5 py-3 font-bold text-slate-200 hover:bg-slate-800">Cancelar</button>
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400 disabled:opacity-60"><CircleDollarSign size={18} /> Crear actualización urgente</button>
        </div>
      </form>
    </div>
  );
}

function MiniValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 break-words text-lg font-black text-white">{value}</div></div>;
}

function TypeBadge({ type }: { type: PriceCostUpdateType }) {
  const cls = type === 'price' ? 'border-violet-400/40 bg-violet-500/15 text-violet-100' : 'border-red-400/40 bg-red-500/15 text-red-100';
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${cls}`}>{typeLabel(type)}</span>;
}

function StatusBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    Pendiente: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
    'En proceso': 'border-blue-400/40 bg-blue-500/15 text-blue-100',
    Completado: 'border-green-400/40 bg-green-500/15 text-green-100',
    Cancelado: 'border-red-400/40 bg-red-500/15 text-red-100',
  };
  const icon = estado === 'Completado' ? <CheckCircle2 size={12} /> : null;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-black ${styles[estado] || 'border-slate-600 bg-slate-800 text-slate-200'}`}>{icon}{estado}</span>;
}
