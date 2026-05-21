import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Clock, Eye, Filter, RefreshCw, Search, ExternalLink, X } from 'lucide-react';
import { approveWarrantyReview, can, fetchWarrantyOptions, fetchWarrantyReviewQueue, markWarrantyIncomplete, takeWarrantyIntoReview } from '../api/client';
import type { WarrantyListResponse, WarrantyOptions, WarrantySummary } from '../types';

function statusPill(reviewStatus?: string) {
  if (reviewStatus === 'requiere_correccion') return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  if (reviewStatus === 'revisada') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100';
  if (reviewStatus === 'en_revision') return 'border-violet-500/40 bg-violet-500/10 text-violet-100';
  return 'border-blue-500/40 bg-blue-500/10 text-blue-100';
}

export function WarrantyReviewPage() {
  const navigate = useNavigate();
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

  async function action(id: string, type: 'take' | 'incomplete' | 'approve' | 'direct_approve' | 'direct_incomplete') {
    setSavingId(id);
    setMessage('');
    setError('');
    try {
      const payload = { note: (notes[id] || '').trim() || undefined };
      if (type === 'take') {
        await takeWarrantyIntoReview(id, payload);
        // Navegar al detalle para que el revisor vea todos los datos
        navigate(`/warranties/${encodeURIComponent(id)}?from=revision`);
        return;
      } else if (type === 'incomplete') {
        await markWarrantyIncomplete(id, payload);
        setMessage('Garantía devuelta a sucursal para corrección.');
      } else if (type === 'approve') {
        await approveWarrantyReview(id, payload);
        setMessage('Garantía aprobada y pasada a gestión.');
      } else if (type === 'direct_approve') {
        // Tomar + aprobar en un solo paso (sin navegar al detalle)
        await takeWarrantyIntoReview(id, {});
        await approveWarrantyReview(id, payload);
        setMessage('Garantía tomada y aprobada directamente.');
      } else {
        // direct_incomplete: tomar + devolver para corrección
        await takeWarrantyIntoReview(id, {});
        await markWarrantyIncomplete(id, payload);
        setMessage('Garantía devuelta a sucursal para corrección.');
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

      {/* En revisión actualmente — acciones rápidas disponibles */}
      {!loading && (data?.items || []).filter(i => i.review_status === 'en_revision').length > 0 && (
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-violet-400">En revisión activa</div>
          <div className="space-y-3">
            {(data?.items || []).filter(i => i.review_status === 'en_revision').map((item) => (
              <ReviewCard
                key={item.id_garantia}
                item={item}
                note={notes[item.id_garantia] || ''}
                setNote={(value) => setNotes((prev) => ({ ...prev, [item.id_garantia]: value }))}
                saving={savingId === item.id_garantia}
                onIncomplete={() => action(item.id_garantia, 'incomplete')}
                onApprove={() => action(item.id_garantia, 'approve')}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pendientes de ser tomadas */}
      {!loading && (data?.items || []).filter(i => !i.review_status || i.review_status === 'pendiente_revision').length > 0 && (
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-blue-400">Pendientes de revisión</div>
          <div className="space-y-3">
            {(data?.items || []).filter(i => !i.review_status || i.review_status === 'pendiente_revision').map((item) => (
              <ReviewCard
                key={item.id_garantia}
                item={item}
                note={notes[item.id_garantia] || ''}
                setNote={(value) => setNotes((prev) => ({ ...prev, [item.id_garantia]: value }))}
                saving={savingId === item.id_garantia}
                onTake={() => action(item.id_garantia, 'take')}
                onDirectApprove={() => action(item.id_garantia, 'direct_approve')}
                onDirectIncomplete={() => action(item.id_garantia, 'direct_incomplete')}
              />
            ))}
          </div>
        </div>
      )}

      {/* Esperando corrección de sucursal */}
      {!loading && (data?.items || []).filter(i => i.review_status === 'requiere_correccion').length > 0 && (
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-amber-400">Esperando corrección de sucursal</div>
          <div className="space-y-3">
            {(data?.items || []).filter(i => i.review_status === 'requiere_correccion').map((item) => (
              <ReviewCard
                key={item.id_garantia}
                item={item}
                note={notes[item.id_garantia] || ''}
                setNote={(value) => setNotes((prev) => ({ ...prev, [item.id_garantia]: value }))}
                saving={savingId === item.id_garantia}
              />
            ))}
          </div>
        </div>
      )}
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

function ReviewCard({
  item, note, setNote, saving,
  onTake, onIncomplete, onApprove,
  onDirectApprove, onDirectIncomplete,
}: {
  item: WarrantySummary;
  note: string;
  setNote: (v: string) => void;
  saving: boolean;
  onTake?: () => void;
  onIncomplete?: () => void;
  onApprove?: () => void;
  onDirectApprove?: () => void;
  onDirectIncomplete?: () => void;
}) {
  const [showReturnForm, setShowReturnForm] = useState(false);
  const isPending    = !item.review_status || item.review_status === 'pendiente_revision';
  const isInProgress = item.review_status === 'en_revision';
  const isCorrection = item.review_status === 'requiere_correccion';

  const detailUrl = `/warranties/${encodeURIComponent(item.id_garantia)}?from=revision`;

  return (
    <div className={`rounded-3xl border bg-slate-950/60 p-4 shadow-xl sm:p-5 transition-colors
      ${isInProgress ? 'border-violet-500/40 bg-violet-500/[0.03]' : isCorrection ? 'border-amber-500/30' : 'border-slate-700'}`}>

      {/* ── Info principal ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link to={detailUrl} className="font-mono text-xl font-black text-white hover:text-blue-200">
          {item.id_garantia}
        </Link>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusPill(item.review_status)}`}>
          {item.review_status_label || 'Pendiente de revisión'}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-bold text-slate-300">
          {item.estado || 'Sin estado'}
        </span>
        {item.dias_pendiente != null && Number(item.dias_pendiente) > 0 && (
          <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-400">
            {item.dias_pendiente}d
          </span>
        )}
      </div>

      <div className="mt-1 text-lg font-bold text-slate-100">{item.producto_principal || 'Sin producto'}</div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-400">
        {item.sku      && <span><span className="text-slate-500">SKU:</span> {item.sku}</span>}
        {item.serie    && <span><span className="text-slate-500">Serie:</span> {item.serie}</span>}
        {item.sucursal && <span><span className="text-slate-500">Sucursal:</span> <span className="text-slate-200">{item.sucursal}</span></span>}
        {(item.ubicacion_actual_label || item.ubicacion_actual) && (
          <span><span className="text-slate-500">Lugar actual:</span> <span className="text-slate-200">{item.ubicacion_actual_label || item.ubicacion_actual}</span></span>
        )}
        {item.tipo_ingreso_label && <span><span className="text-slate-500">Tipo:</span> {item.tipo_ingreso_label}</span>}
        {item.responsable && <span><span className="text-slate-500">Responsable:</span> {item.responsable}</span>}
      </div>

      {item.falla && (
        <div className="mt-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-slate-300">
          <span className="font-bold text-slate-400">Falla: </span>{item.falla}
        </div>
      )}

      {/* Nota de corrección previa */}
      {item.review_note && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
          <span className="font-bold">Nota de revisión: </span>{item.review_note}
        </div>
      )}

      {/* ── CTA según estado ─────────────────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">

        {/* ESTADO: pendiente — acciones rápidas + opción de revisar en detalle */}
        {isPending && can('warranties.review') && (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex flex-wrap gap-2">
              {/* Aprobar directamente: take + approve en un solo paso */}
              {can('warranties.approve_review') && onDirectApprove && (
                <button
                  disabled={saving}
                  onClick={onDirectApprove}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  <CheckCircle2 size={16} /> Aprobar directamente
                </button>
              )}
              {/* Tomar en revisión — navega al detalle completo */}
              {onTake && (
                <button
                  disabled={saving}
                  onClick={onTake}
                  className="inline-flex items-center gap-2 rounded-xl border border-violet-500/50 bg-violet-500/10 px-4 py-2.5 text-sm font-black text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
                >
                  <Eye size={16} /> Revisar en detalle
                  <ArrowRight size={14} />
                </button>
              )}
              {/* Devolver para corrección — expande formulario con nota */}
              {can('warranties.mark_incomplete') && onDirectIncomplete && (
                <button
                  disabled={saving}
                  onClick={() => setShowReturnForm((v) => !v)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition-all disabled:opacity-50 ${
                    showReturnForm
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-100'
                      : 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  <AlertTriangle size={16} /> Devolver para corrección
                  {showReturnForm && <X size={13} />}
                </button>
              )}
            </div>

            {/* Formulario de corrección expandible */}
            {showReturnForm && can('warranties.mark_incomplete') && onDirectIncomplete && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-2 text-xs text-amber-300/80">
                  Indicá el motivo. La sucursal verá esta nota y la garantía vuelve automáticamente a revisión cuando la corrijan.
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Motivo de corrección (obligatorio)..."
                  className="w-full rounded-xl border border-amber-500/30 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
                  autoFocus
                />
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={saving || !note.trim()}
                    onClick={onDirectIncomplete}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-white hover:bg-amber-400 disabled:opacity-40"
                  >
                    <AlertTriangle size={14} /> Devolver con nota
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReturnForm(false)}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-400 hover:bg-slate-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <span className="text-xs text-slate-500 pl-1">
              "Aprobar directamente" toma y aprueba en un paso. "Revisar en detalle" abre la vista completa.
            </span>
          </div>
        )}

        {/* ESTADO: en revisión — Continuar + acciones rápidas */}
        {isInProgress && (
          <div className="flex flex-col gap-3 w-full sm:flex-row sm:items-end sm:justify-between">
            <Link
              to={detailUrl}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-500/50 bg-violet-500/10 px-5 py-3 font-black text-violet-100 hover:bg-violet-500/20"
            >
              <ExternalLink size={16} /> Continuar revisión
            </Link>

            {/* Acciones rápidas si quiere resolver desde la lista */}
            {(can('warranties.mark_incomplete') || can('warranties.approve_review')) && (
              <div className="flex flex-col gap-2 sm:items-end">
                <span className="text-xs text-slate-500">Acciones rápidas (desde aquí):</span>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Nota interna (obligatoria si pedís corrección)..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-blue-400"
                    />
                  </label>
                  <div className="flex flex-col gap-2">
                    {can('warranties.mark_incomplete') && onIncomplete && (
                      <button
                        disabled={saving || !note.trim()}
                        title={!note.trim() ? 'Escribí el motivo de corrección' : undefined}
                        onClick={onIncomplete}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/50 px-3 py-2 text-xs font-black text-amber-100 hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        <AlertTriangle size={14} /> Corrección
                      </button>
                    )}
                    {can('warranties.approve_review') && onApprove && (
                      <button
                        disabled={saving}
                        onClick={onApprove}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-white hover:bg-emerald-400 disabled:opacity-50"
                      >
                        <CheckCircle2 size={14} /> Aprobar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ESTADO: requiere corrección — solo info + link */}
        {isCorrection && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <p className="text-sm text-amber-200/70">
              Esperando que la sucursal corrija los datos. Vuelve automáticamente a revisión al guardar.
            </p>
            <Link
              to={detailUrl}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-900"
            >
              <ExternalLink size={14} /> Ver detalle
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
