import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Clock, Eye, Filter, RefreshCw, Search } from 'lucide-react';
import { approveWarrantyReview, can, fetchWarrantyOptions, fetchWarrantyReviewQueue, markWarrantyIncomplete, takeWarrantyIntoReview } from '../api/client';
import type { WarrantyListResponse, WarrantyOptions, WarrantySummary } from '../types';

function statusPill(reviewStatus?: string) {
  if (reviewStatus === 'requiere_correccion') return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  if (reviewStatus === 'revisada') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100';
  if (reviewStatus === 'en_revision') return 'border-violet-500/40 bg-violet-500/10 text-violet-100';
  return 'border-blue-500/40 bg-blue-500/10 text-blue-100';
}

export function WarrantyReviewPage() {
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [filters, setFilters] = useState({ q: '', sucursal: '', deposito: '' });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const pendingCount = useMemo(() => (data?.items || []).filter((item) => item.review_status === 'pendiente_revision' || !item.review_status).length, [data]);
  const inProgressCount = useMemo(() => (data?.items || []).filter((item) => item.review_status === 'en_revision').length, [data]);
  const incompleteCount = useMemo(() => (data?.items || []).filter((item) => item.review_status === 'requiere_correccion').length, [data]);

  async function load(extra = filters) {
    setLoading(true);
    setError('');
    try {
      const [opts, queue] = await Promise.all([fetchWarrantyOptions(), fetchWarrantyReviewQueue({ ...extra, limit: 300 })]);
      setOptions(opts);
      setData(queue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la revisión de garantías');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    load(filters);
  }

  async function action(id: string, type: 'take' | 'incomplete' | 'approve') {
    setSavingId(id);
    setMessage('');
    setError('');
    try {
      const payload = { note: (notes[id] || '').trim() || undefined };
      if (type === 'take') {
        await takeWarrantyIntoReview(id, payload);
        setMessage('Garantía tomada en revisión interna.');
      } else if (type === 'incomplete') {
        await markWarrantyIncomplete(id, payload);
        setMessage('Garantía marcada para corrección.');
      } else {
        await approveWarrantyReview(id, payload);
        setMessage('Garantía aprobada y pasada a pendiente.');
      }
      setNotes((prev) => ({ ...prev, [id]: '' }));
      await load(filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la acción');
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-100">
            <ClipboardCheck size={14} /> Revisión interna
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Garantías para revisar</h1>
          <p className="mt-2 text-slate-400">Primero se toma la garantía, después se aprueba o se devuelve a sucursal para corregir.</p>
        </div>
        <button onClick={() => load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900">
          <RefreshCw size={18} /> Actualizar
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
      {message && <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}

      <div className="rounded-3xl border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-300 shadow-xl">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500"><Clock size={15} /> Flujo de revisión</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 font-black text-blue-100">INGRESADO</span>
          <ArrowRight size={16} className="text-slate-500" />
          <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 font-black text-violet-100">EN REVISIÓN</span>
          <ArrowRight size={16} className="text-slate-500" />
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-black text-emerald-100">PENDIENTE / GESTIÓN</span>
          <span className="mx-2 text-slate-600">o</span>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-black text-amber-100">CORRECCIÓN PENDIENTE</span>
        </div>
        <p className="mt-3 text-slate-400">Aprobar pasa la garantía a gestión. Corregir la devuelve a sucursal con una nota obligatoria y vuelve a revisión cuando la editan.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi title="Pendientes" value={pendingCount} />
        <Kpi title="En revisión interna" value={inProgressCount} color="violet" />
        <Kpi title="Requieren corrección" value={incompleteCount} color="amber" />
        <Kpi title="Total en cola" value={data?.total || 0} />
      </div>

      <form onSubmit={submit} className="rounded-3xl border border-slate-700 bg-slate-950/60 p-4 shadow-xl sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300"><Filter size={16} /> Filtros</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-300">Buscar</span>
            <div className="relative">
              <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
              <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="ID, producto, SKU, serie..." className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-4 outline-none focus:border-blue-400" />
            </div>
          </label>
          <Select label="Sucursal" value={filters.sucursal} onChange={(v) => setFilters({ ...filters, sucursal: v })} options={options?.sucursales || []} />
          <Select label="Lugar actual" value={filters.deposito} onChange={(v) => setFilters({ ...filters, deposito: v })} options={options?.depositos || []} />
        </div>
        <button className="mt-4 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400">Aplicar filtros</button>
      </form>

      {loading && <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">Cargando garantías...</div>}
      {!loading && data?.items.length === 0 && <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">No hay garantías para revisar.</div>}
      <div className="space-y-3">
        {data?.items.map((item) => (
          <ReviewCard
            key={item.id_garantia}
            item={item}
            note={notes[item.id_garantia] || ''}
            setNote={(value) => setNotes((prev) => ({ ...prev, [item.id_garantia]: value }))}
            saving={savingId === item.id_garantia}
            onTake={() => action(item.id_garantia, 'take')}
            onIncomplete={() => action(item.id_garantia, 'incomplete')}
            onApprove={() => action(item.id_garantia, 'approve')}
          />
        ))}
      </div>
    </div>
  );
}

function Kpi({ title, value, color }: { title: string; value: number; color?: 'violet' | 'amber' }) {
  const border = color === 'violet' ? 'border-violet-500/30' : color === 'amber' ? 'border-amber-500/30' : 'border-slate-700';
  const text = color === 'violet' ? 'text-violet-100' : color === 'amber' ? 'text-amber-100' : 'text-white';
  return <div className={`rounded-3xl border bg-slate-950/50 p-4 ${border}`}><div className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</div><div className={`mt-1 text-3xl font-black ${text}`}>{value}</div></div>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
        <option value="">Todos</option>
        {options.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
    </label>
  );
}

function ReviewCard({ item, note, setNote, saving, onTake, onIncomplete, onApprove }: { item: WarrantySummary; note: string; setNote: (value: string) => void; saving: boolean; onTake: () => void; onIncomplete: () => void; onApprove: () => void }) {
  const isInProgress = item.review_status === 'en_revision';
  const isCorrection = item.review_status === 'requiere_correccion';
  const canActOnReview = can('warranties.mark_incomplete') || can('warranties.approve_review') || can('warranties.review');
  return (
    <div className={`rounded-3xl border bg-slate-950/60 p-4 shadow-xl sm:p-5 ${isInProgress ? 'border-violet-500/40' : 'border-slate-700'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="font-mono text-xl font-black text-white hover:text-blue-200">{item.id_garantia}</Link>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusPill(item.review_status)}`}>{item.review_status_label || item.review_status || 'Pendiente de revisión'}</span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-bold text-slate-300">{item.estado || 'Sin estado'}</span>
          </div>
          <div className="mt-2 text-lg font-bold text-slate-100">{item.producto_principal || 'Sin producto'}</div>
          <div className="mt-2 grid gap-2 text-sm text-slate-300 md:grid-cols-3">
            <span>SKU: {item.sku || '-'}</span>
            <span>Serie: {item.serie || '-'}</span>
            <span>Sucursal: {item.sucursal || '-'}</span>
            <span>Lugar actual: {item.ubicacion_actual_label || item.lugar_llegada || item.deposito || '-'}</span>
            <span>Tipo ingreso: {item.tipo_ingreso_label || item.tipo_ingreso || '-'}</span>
            <span>Responsable: {item.responsable || '-'}</span>
          </div>
          {item.falla && <div className="mt-3 rounded-xl bg-slate-900 p-3 text-sm text-slate-300"><b>Falla:</b> {item.falla}</div>}
          {item.review_note && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100"><b>Última observación de revisión:</b> {item.review_note}</div>}
          {isCorrection && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">La sucursal debe corregir la base. Al guardar la corrección, vuelve a Pendiente de revisión.</div>}
          <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="mt-3 inline-flex text-sm font-bold text-blue-300 hover:text-blue-200">Ver detalle y corregir datos</Link>
        </div>
        {canActOnReview && (
          <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-3 lg:w-96">
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Nota de revisión</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Nota interna. Obligatoria si pedís corrección..." className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </label>
            <div className="mt-3 flex flex-col gap-2">
              {can('warranties.review') && !isInProgress && (
                <button disabled={saving} onClick={onTake} className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-500/50 px-3 py-2 text-sm font-black text-violet-100 hover:bg-violet-500/10 disabled:opacity-50">
                  <Eye size={16} /> Tomar en revisión
                </button>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {can('warranties.mark_incomplete') && <button disabled={saving || !note.trim()} title={!note.trim() ? 'Escribí qué tiene que corregirse' : undefined} onClick={onIncomplete} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/50 px-3 py-2 text-sm font-black text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"><AlertTriangle size={16} /> Pedir corrección</button>}
                {can('warranties.approve_review') && <button disabled={saving} onClick={onApprove} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-50"><CheckCircle2 size={16} /> Aprobar</button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
