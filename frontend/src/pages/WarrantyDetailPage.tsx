import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp,
  Copy, Eye, Package, PencilLine, RefreshCw, Save, ShieldCheck,
  Trash2, X, Clock, MapPin, Wrench, FileText, Send, Building2,
} from 'lucide-react';
import {
  approveWarrantyReview, cancelWarranty, can, deleteWarranty,
  fetchWarrantyDetail, fetchWarrantyOptions, markWarrantyIncomplete,
  takeWarrantyIntoReview, updateWarranty, updateWarrantyEntryBase,
} from '../api/client';
import type { WarrantyDetailResponse, WarrantyItemUpdatePayload, WarrantyOptions } from '../types';
import {
  flowToneClass, getDetailStateConfig, getReviewStatusMeta,
  getWarrantyNextStep, getWarrantyStatusMeta, historyEventLabel,
} from '../warrantyFlow';

// ─── helpers ────────────────────────────────────────────────────────────────

function copyText(v: string) { navigator.clipboard?.writeText(v).catch(() => undefined); }

function historyIcon(eventType: string) {
  if (eventType.includes('status')) return <Clock size={14} />;
  if (eventType.includes('review')) return <Eye size={14} />;
  if (eventType.includes('remito') || eventType.includes('delivery')) return <FileText size={14} />;
  if (eventType.includes('provider')) return <Building2 size={14} />;
  if (eventType.includes('location') || eventType.includes('transit')) return <MapPin size={14} />;
  if (eventType.includes('resolution')) return <Wrench size={14} />;
  if (eventType.includes('notif') || eventType.includes('mail')) return <Send size={14} />;
  return <Package size={14} />;
}

// ─── main component ──────────────────────────────────────────────────────────

export function WarrantyDetailPage() {
  const { warrantyId = '' } = useParams();
  const navigate = useNavigate();
  const id = decodeURIComponent(warrantyId);

  const [data, setData] = useState<WarrantyDetailResponse | null>(null);
  const [options, setOptions] = useState<WarrantyOptions | null>(null);

  // operational form
  const [estado, setEstado] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [deposito, setDeposito] = useState('');
  const [lugarLlegada, setLugarLlegada] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [photosReference, setPhotosReference] = useState('');
  const [note, setNote] = useState('');

  // entry-base form
  const [fechaIngreso, setFechaIngreso] = useState('');
  const [proveedorBase, setProveedorBase] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');
  const [clienteEmail, setClienteEmail] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fechaCompra, setFechaCompra] = useState('');
  const [observacionesBase, setObservacionesBase] = useState('');
  const [photosBase, setPhotosBase] = useState('');

  // shared
  const [items, setItems] = useState<WarrantyItemUpdatePayload[]>([]);
  const [editingItems, setEditingItems] = useState(false);

  // review
  const [reviewNote, setReviewNote] = useState('');

  // admin actions
  const [cancelReason, setCancelReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showAdminActions, setShowAdminActions] = useState(false);

  // ui
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  function hydrate(detail: WarrantyDetailResponse, opts?: WarrantyOptions | null) {
    setData(detail);
    const s = detail.summary;
    setEstado(s.estado || opts?.estado_default || '');
    setSucursal(s.sucursal || '');
    setDeposito(s.deposito || '');
    setLugarLlegada(s.lugar_llegada || s.deposito || '');
    setObservaciones(s.observaciones || '');
    setPhotosReference(s.photos_reference || '');
    setFechaIngreso(s.ingreso_iso || '');
    setProveedorBase(s.provider_name || '');
    setClienteNombre(s.cliente_nombre || '');
    setClienteTelefono(s.cliente_telefono || '');
    setClienteEmail(s.cliente_email || '');
    setNumeroFactura(s.numero_factura || '');
    setFechaCompra(s.fecha_compra || '');
    setReviewNote(s.review_note || '');
    setObservacionesBase(s.observaciones || '');
    setPhotosBase(s.photos_reference || '');
    setItems(detail.rows.map((row) => ({
      row_number: row.row_number,
      producto: row.producto || '',
      sku: row.sku || '',
      marca: row.marca || '',
      tipo: row.tipo || '',
      serie: row.serie || '',
      falla: row.falla || '',
      observaciones: row.observaciones || '',
    })));
  }

  async function load() {
    setError('');
    try {
      const [detail, opts] = await Promise.all([fetchWarrantyDetail(id), fetchWarrantyOptions()]);
      setOptions(opts);
      hydrate(detail, opts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la garantía');
    }
  }

  useEffect(() => { load(); }, [id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const updated = await updateWarranty(id, {
        estado, sucursal, deposito, lugar_llegada: lugarLlegada,
        observaciones, photos_reference: photosReference,
        append_observation: note.trim() || undefined,
        items,
      });
      hydrate(updated, options);
      setNote('');
      setMessage('Garantía actualizada correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la garantía');
    } finally { setSaving(false); }
  }

  async function submitEntryBase(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const updated = await updateWarrantyEntryBase(id, {
        fecha_ingreso: fechaIngreso || undefined,
        observaciones: observacionesBase,
        photos_reference: photosBase,
        proveedor: proveedorBase,
        cliente_nombre: clienteNombre,
        cliente_telefono: clienteTelefono,
        cliente_email: clienteEmail,
        numero_factura: numeroFactura,
        fecha_compra: fechaCompra,
        items,
      });
      hydrate(updated, options);
      setEditingItems(false);
      setMessage('Base de ingreso actualizada correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la base de ingreso');
    } finally { setSaving(false); }
  }

  async function reviewAction(type: 'take' | 'incomplete' | 'approve') {
    setSaving(true); setError(''); setMessage('');
    try {
      const payload = { note: reviewNote.trim() || undefined };
      let updated;
      if (type === 'take') { updated = await takeWarrantyIntoReview(id, payload); setMessage('Garantía tomada en revisión interna.'); }
      else if (type === 'incomplete') { updated = await markWarrantyIncomplete(id, payload); setMessage('Garantía marcada para corrección.'); }
      else { updated = await approveWarrantyReview(id, payload); setMessage('Garantía aprobada y pasada a pendiente.'); }
      hydrate(updated, options);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la revisión');
    } finally { setSaving(false); }
  }

  async function cancelCurrentWarranty() {
    if (!cancelReason.trim()) { setError('Indicá el motivo de anulación.'); return; }
    if (!window.confirm('La garantía se marcará como anulada y quedará registrada en historial. ¿Continuar?')) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const updated = await cancelWarranty(id, { reason: cancelReason.trim() });
      hydrate(updated, options);
      setCancelReason('');
      setMessage('Garantía anulada correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anular la garantía');
    } finally { setSaving(false); }
  }

  async function deleteCurrentWarranty() {
    if (deleteConfirm.trim().toUpperCase() !== 'ELIMINAR') { setError('Para eliminar definitivamente, escribí ELIMINAR.'); return; }
    if (!window.confirm('Esta acción elimina definitivamente la garantía y sus productos asociados. Usala solo para cargas de prueba o errores de alta. ¿Continuar?')) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await deleteWarranty(id);
      navigate('/warranties', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la garantía');
    } finally { setSaving(false); }
  }

  function updateItem(index: number, field: keyof WarrantyItemUpdatePayload, value: string) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  // ── loading / error states ─────────────────────────────────────────────────
  if (error && !data) return <Page><ErrorBox message={error} /></Page>;
  if (!data) return (
    <Page>
      <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center text-slate-300">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
        Cargando garantía...
      </div>
    </Page>
  );

  const s = data.summary;
  const stateConfig = getDetailStateConfig(s.estado);
  const statusMeta = getWarrantyStatusMeta(s.estado);
  const reviewMeta = getReviewStatusMeta(s.review_status);

  // Permission + state derived flags
  const isReadOnly = stateConfig.isFinal || !!s.cancelled;
  const entryBaseStatusOk = (s.estado || '').toUpperCase().includes('INGRESO') || (s.estado || '').toUpperCase().includes('CORRECCIÓN');
  const entryBaseReviewOk = ['pendiente_revision', 'requiere_correccion'].includes(s.review_status || '');
  const canEditEntryBase = !s.cancelled && !stateConfig.isFinal &&
    (can('warranties.manage') || can('warranties.create')) &&
    (can('warranties.manage') || (entryBaseStatusOk && entryBaseReviewOk));
  const canEditOperational = can('warranties.manage') && !isReadOnly;
  const reviewAlreadyApproved = s.review_status === 'revisada';
  const canShowReviewBlock = stateConfig.showReviewBlock &&
    (can('warranties.review') || can('warranties.mark_incomplete') || can('warranties.approve_review')) &&
    !s.cancelled;

  return (
    <Page>
      {/* ── feedback banners ─────────────────────────────────────────────── */}
      {error && <ErrorBox message={error} />}
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">
          <CheckCircle2 size={18} className="shrink-0" />
          <span className="font-semibold">{message}</span>
          <button onClick={() => setMessage('')} className="ml-auto text-emerald-300 hover:text-emerald-100"><X size={16} /></button>
        </div>
      )}

      {/* ── cancelled banner ─────────────────────────────────────────────── */}
      {s.cancelled && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/50 bg-red-500/10 p-4 text-red-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            <div className="font-black">Garantía anulada</div>
            {s.cancel_reason && <div className="mt-0.5 text-sm text-red-200">{s.cancel_reason}</div>}
            {s.cancelled_at && <div className="mt-0.5 text-xs text-red-300/70">{s.cancelled_at}</div>}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          HEADER CARD
      ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
        {/* top row: label + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-100">
            <ShieldCheck size={13} /> Detalle de garantía
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-slate-900">
              <RefreshCw size={15} /> Actualizar
            </button>
            <Link to="/warranties" className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-slate-900">
              <ArrowLeft size={15} /> Volver
            </Link>
          </div>
        </div>

        {/* ID + product */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <h1 className="font-mono text-3xl font-black sm:text-4xl">{s.id_garantia}</h1>
          <button onClick={() => copyText(s.id_garantia)} title="Copiar ID" className="mb-1 rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-900 hover:text-slate-100">
            <Copy size={15} />
          </button>
        </div>
        <p className="mt-1 text-slate-400">{s.producto_principal} · {s.cantidad_items} producto(s)</p>

        {/* status badges */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-black ${flowToneClass(statusMeta.tone)}`}>
            {statusMeta.label}
          </span>
          <span className={`rounded-full border px-3 py-1 text-xs font-black ${flowToneClass(reviewMeta.tone)}`}>
            {s.review_status_label || reviewMeta.label}
          </span>
          {s.resultado_resolucion && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-100">
              {s.resultado_resolucion_label || s.resultado_resolucion}
            </span>
          )}
          {isReadOnly && (
            <span className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-black text-slate-400">
              Solo lectura
            </span>
          )}
        </div>

        {/* summary row */}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-400">
          {s.sucursal && <span><span className="text-slate-500">Sucursal:</span> <span className="text-slate-200">{s.sucursal}</span></span>}
          {s.provider_name && <span><span className="text-slate-500">Proveedor:</span> <span className="text-slate-200">{s.provider_name}</span></span>}
          {s.ingreso && <span><span className="text-slate-500">Ingreso:</span> <span className="text-slate-200">{s.ingreso}</span></span>}
          {s.fecha_ultima_actualizacion && <span><span className="text-slate-500">Última act.:</span> <span className="text-slate-200">{s.fecha_ultima_actualizacion}</span></span>}
          {s.ubicacion_actual_label && <span><span className="text-slate-500">Ubicación:</span> <span className="text-slate-200">{s.ubicacion_actual_label}</span></span>}
        </div>

        {/* next step block */}
        <div className={`mt-5 rounded-2xl border px-4 py-3 ${flowToneClass(statusMeta.tone)}`}>
          <div className="text-xs font-black uppercase tracking-wide opacity-70">Próximo paso</div>
          <div className="mt-0.5 font-bold">{getWarrantyNextStep(s)}</div>
        </div>

        {/* info grid */}
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Ingreso" value={s.ingreso} />
          <Info label="Responsable" value={s.responsable} />
          <Info label="Revisado por" value={s.reviewed_by_name || s.reviewed_by} />
          <Info label="Última actualización" value={s.fecha_ultima_actualizacion} />
          <Info label="ID de caso" value={s.id_de_caso} />
          <Info label="Envío proveedor" value={s.fecha_envio_proveedor} />
          <Info label="Última respuesta" value={s.fecha_ultima_respuesta} />
          {s.remito_interno && <Info label="Remito interno" value={s.remito_interno} />}
          {s.remito_proveedor && <Info label="Remito proveedor" value={s.remito_proveedor} />}
        </div>

        {/* origin + location block */}
        {(s.tipo_ingreso_label || s.origen_ingreso || s.ubicacion_actual_label) && (
          <div className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-300">Origen y ubicación</div>
            <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {s.tipo_ingreso_label && <Info label="Tipo de ingreso" value={s.tipo_ingreso_label} />}
              {s.origen_ingreso && <Info label="Origen" value={s.origen_ingreso === 'sucursal' ? 'Sucursal' : 'Depósito'} />}
              {s.ubicacion_actual_label && <Info label="Ubicación actual" value={s.ubicacion_actual_label} />}
              {s.sucursal_responsable && s.sucursal_responsable !== s.sucursal && (
                <Info label="Sucursal responsable" value={s.sucursal_responsable} />
              )}
            </div>
          </div>
        )}

        {/* client data block */}
        {(s.cliente_nombre || s.cliente_telefono || s.cliente_email || s.numero_factura || s.fecha_compra) && (
          <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-900/30 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Datos del cliente</div>
            <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {s.cliente_nombre && <Info label="Nombre" value={s.cliente_nombre} />}
              {s.cliente_telefono && <Info label="Teléfono" value={s.cliente_telefono} />}
              {s.cliente_email && <Info label="Email" value={s.cliente_email} />}
              {s.numero_factura && <Info label="Factura / ticket" value={s.numero_factura} />}
              {s.fecha_compra && <Info label="Fecha de compra" value={s.fecha_compra} />}
            </div>
          </div>
        )}

        {/* resolution block */}
        {(s.resultado_resolucion || s.fecha_finalizacion) && (
          <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-300">Resolución y cierre</div>
            <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {s.resultado_resolucion && <Info label="Resolución" value={s.resultado_resolucion_label || s.resultado_resolucion} />}
              {s.numero_nota_credito && <Info label="N° nota de crédito" value={s.numero_nota_credito} />}
              {s.importe_nota_credito && <Info label="Importe NC" value={s.importe_nota_credito} />}
              {s.fecha_nota_credito && <Info label="Fecha NC" value={s.fecha_nota_credito} />}
              {s.detalle_reparacion && <Info label="Detalle reparación" value={s.detalle_reparacion} />}
              {s.fecha_reparacion && <Info label="Fecha reparación" value={s.fecha_reparacion} />}
              {s.producto_reemplazo && <Info label="Equipo de cambio" value={s.producto_reemplazo} />}
              {s.sku_reemplazo && <Info label="SKU reemplazo" value={s.sku_reemplazo} />}
              {s.serie_reemplazo && <Info label="Serie reemplazo" value={s.serie_reemplazo} />}
              {s.fecha_recepcion_reemplazo && <Info label="Recepción reemplazo" value={s.fecha_recepcion_reemplazo} />}
              {s.fecha_finalizacion && <Info label="Fecha finalización" value={s.fecha_finalizacion} />}
              {s.finalizacion && <Info label="Cierre" value={s.finalizacion} />}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          REVIEW BLOCK (only for INGRESO + non-final + has permissions)
      ══════════════════════════════════════════════════════════════════ */}
      {canShowReviewBlock && (
        <div className={`rounded-3xl border p-5 shadow-xl ${s.review_status === 'en_revision' ? 'border-violet-500/40 bg-violet-500/5' : 'border-slate-700 bg-slate-950/60'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black">Revisión interna</h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${flowToneClass(reviewMeta.tone)}`}>
              {s.review_status_label || reviewMeta.label}
            </span>
          </div>
          {reviewAlreadyApproved ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-100">
              Revisión aprobada. Esta garantía ya no necesita acciones de revisión interna.
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <label>
                <span className="mb-2 block text-sm font-semibold text-slate-300">Nota de revisión</span>
                <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={3}
                  placeholder="Observación interna de revisión..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
              </label>
              <div className="flex flex-col gap-2">
                {can('warranties.review') && s.review_status !== 'en_revision' && s.review_status !== 'revisada' && (
                  <button disabled={saving} onClick={() => reviewAction('take')}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-500/50 px-4 py-3 font-black text-violet-100 hover:bg-violet-500/10 disabled:opacity-50">
                    <Eye size={18} /> Tomar en revisión
                  </button>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {can('warranties.mark_incomplete') && (
                    <button disabled={saving} onClick={() => reviewAction('incomplete')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/50 px-4 py-3 font-black text-amber-100 hover:bg-amber-500/10 disabled:opacity-50">
                      <AlertTriangle size={18} /> Requiere corrección
                    </button>
                  )}
                  {can('warranties.approve_review') && (
                    <button disabled={saving} onClick={() => reviewAction('approve')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-black text-white hover:bg-emerald-400 disabled:opacity-50">
                      <CheckCircle2 size={18} /> Aprobar revisión
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ENTRY BASE FORM (editable states only, canEditEntryBase)
      ══════════════════════════════════════════════════════════════════ */}
      {canEditEntryBase && (
        <form onSubmit={submitEntryBase} className="rounded-3xl border border-blue-500/25 bg-blue-500/5 p-5 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-black text-blue-100">
                <PencilLine size={20} /> Base de ingreso
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Corrección controlada de datos recién ingresados. No cambia revisión, remitos ni proveedor operativo.
              </p>
            </div>
            <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-100">
              Ingreso editable
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Fecha de ingreso</span>
              <input type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <Input label="Proveedor / fabricante" value={proveedorBase} onChange={setProveedorBase} />
            <Input label="Cliente" value={clienteNombre} onChange={setClienteNombre} />
            <Input label="Teléfono cliente" value={clienteTelefono} onChange={setClienteTelefono} />
            <Input label="Email cliente" value={clienteEmail} onChange={setClienteEmail} />
            <Input label="Factura / ticket" value={numeroFactura} onChange={setNumeroFactura} />
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Fecha de compra</span>
              <input type="date" value={fechaCompra} onChange={(e) => setFechaCompra(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Referencia de fotos</span>
              <input value={photosBase} onChange={(e) => setPhotosBase(e.target.value)}
                placeholder="Ej: Fotos enviadas al grupo con este ID"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label className="sm:col-span-2 lg:col-span-4">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Observaciones generales</span>
              <textarea value={observacionesBase} onChange={(e) => setObservacionesBase(e.target.value)} rows={3}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
          </div>

          {/* Products — toggle edit */}
          <div className="mt-6 flex items-center justify-between">
            <h3 className="text-lg font-black">Productos cargados</h3>
            <button type="button" onClick={() => setEditingItems((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-bold text-slate-300 hover:bg-slate-800">
              <PencilLine size={14} /> {editingItems ? 'Ver solo lectura' : 'Editar productos'}
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {editingItems ? (
              items.map((item, index) => (
                <div key={item.row_number} className="rounded-2xl border border-blue-500/20 bg-slate-900/60 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Input label="Producto" value={item.producto || ''} onChange={(v) => updateItem(index, 'producto', v)} className="sm:col-span-2" />
                    <Input label="SKU" value={item.sku || ''} onChange={(v) => updateItem(index, 'sku', v)} />
                    <Input label="Marca" value={item.marca || ''} onChange={(v) => updateItem(index, 'marca', v)} />
                    <Input label="Tipo" value={item.tipo || ''} onChange={(v) => updateItem(index, 'tipo', v)} />
                    <Input label="Serie" value={item.serie || ''} onChange={(v) => updateItem(index, 'serie', v)} />
                    <Input label="Falla" value={item.falla || ''} onChange={(v) => updateItem(index, 'falla', v)} className="sm:col-span-2" />
                    <Input label="Observaciones" value={item.observaciones || ''} onChange={(v) => updateItem(index, 'observaciones', v)} className="sm:col-span-2 xl:col-span-4" />
                  </div>
                </div>
              ))
            ) : (
              data.rows.map((row) => <ReadOnlyItem key={row.row_number} row={row} />)
            )}
          </div>
          <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400 disabled:opacity-50">
            <Save size={18} /> {saving ? 'Guardando...' : 'Guardar base de ingreso'}
          </button>
        </form>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          OPERATIONAL FORM (manage perm + not readonly + not entry-base edit)
      ══════════════════════════════════════════════════════════════════ */}
      {canEditOperational && (
        <form onSubmit={submit} className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
          <h2 className="text-xl font-black">Datos operativos</h2>
          <p className="mt-1 text-sm text-slate-400">Estado, ubicación física y notas de gestión.</p>

          {/* A) Estado admin */}
          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Estado administrativo</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Estado" value={estado} onChange={setEstado}
                options={Array.from(new Set([...((options as any)?.estados || [] as string[]), options?.estado_default || '1 - INGRESO', estado].filter(Boolean)))} />
              <Select label="Sucursal" value={sucursal} onChange={setSucursal} options={options?.sucursales || []} allowEmpty />
            </div>
          </div>

          {/* B) Ubicación física */}
          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Ubicación física</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Depósito / lugar actual" value={deposito} onChange={setDeposito} options={options?.depositos || []} allowEmpty />
              <Select label="Lugar de llegada" value={lugarLlegada} onChange={setLugarLlegada} options={options?.depositos || []} allowEmpty />
            </div>
          </div>

          {/* C) Observaciones + fotos + nota */}
          <div className="mt-3 grid gap-4">
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Referencia de fotos</span>
              <input value={photosReference} onChange={(e) => setPhotosReference(e.target.value)}
                placeholder="Ej: Fotos enviadas al grupo con este ID"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Observaciones generales</span>
              <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Agregar movimiento / nota</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="Ej: Se corrigió número de serie / se confirmó retiro del proveedor..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
          </div>

          {/* Products — read-only view with toggle */}
          <div className="mt-6 flex items-center justify-between">
            <h3 className="text-lg font-black">Productos asociados</h3>
            <button type="button" onClick={() => setEditingItems((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-bold text-slate-300 hover:bg-slate-800">
              <PencilLine size={14} /> {editingItems ? 'Ver solo lectura' : 'Editar productos'}
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {editingItems ? (
              items.map((item, index) => (
                <div key={item.row_number} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Input label="Producto" value={item.producto || ''} onChange={(v) => updateItem(index, 'producto', v)} className="sm:col-span-2" />
                    <Input label="SKU" value={item.sku || ''} onChange={(v) => updateItem(index, 'sku', v)} />
                    <Input label="Marca" value={item.marca || ''} onChange={(v) => updateItem(index, 'marca', v)} />
                    <Input label="Tipo" value={item.tipo || ''} onChange={(v) => updateItem(index, 'tipo', v)} />
                    <Input label="Serie" value={item.serie || ''} onChange={(v) => updateItem(index, 'serie', v)} />
                    <Input label="Falla" value={item.falla || ''} onChange={(v) => updateItem(index, 'falla', v)} className="sm:col-span-2" />
                    <Input label="Observaciones" value={item.observaciones || ''} onChange={(v) => updateItem(index, 'observaciones', v)} className="sm:col-span-2 xl:col-span-4" />
                  </div>
                </div>
              ))
            ) : (
              data.rows.map((row) => <ReadOnlyItem key={row.row_number} row={row} />)
            )}
          </div>

          <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400 disabled:opacity-50">
            <Save size={18} /> {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      )}

      {/* ── read-only products (when no form shown) ─────────────────────────── */}
      {!canEditOperational && !canEditEntryBase && (
        <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
          <h2 className="text-xl font-black">Productos asociados</h2>
          <div className="mt-4 space-y-3">
            {data.rows.map((row) => <ReadOnlyItem key={row.row_number} row={row} />)}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          HISTORY / MOVEMENTS — collapsible
      ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-3xl border border-slate-700 bg-slate-950/60 shadow-xl">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="flex w-full items-center justify-between p-5 text-left"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black">Movimientos</h2>
            {data.history.length > 0 && (
              <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-300">
                {data.history.length}
              </span>
            )}
          </div>
          {showHistory ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
        </button>

        {showHistory && (
          <div className="border-t border-slate-800 p-5">
            {data.history.length === 0 ? (
              <p className="text-sm text-slate-400">Todavía no hay movimientos registrados.</p>
            ) : (
              <div className="relative space-y-0">
                {/* vertical timeline line */}
                <div className="absolute left-[17px] top-0 h-full w-px bg-slate-800" aria-hidden />
                {data.history.map((event, idx) => {
                  const details = event.details as Record<string, unknown> | undefined;
                  const oldStatus = details?.old_status as string | undefined;
                  const newStatus = details?.new_status as string | undefined;
                  const remitoCode = details?.remito_code as string | undefined;
                  return (
                    <div key={event.id} className={`relative flex gap-3 pb-4 ${idx === data.history.length - 1 ? '' : ''}`}>
                      {/* dot */}
                      <div className="relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-400">
                        {historyIcon(event.event_type)}
                      </div>
                      <div className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white">{historyEventLabel(event.event_type)}</span>
                          {event.status && (
                            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                              {event.status}
                            </span>
                          )}
                        </div>
                        {oldStatus && newStatus && (
                          <div className="mt-1 text-xs text-slate-400">
                            <span className="text-slate-500">{getWarrantyStatusMeta(oldStatus).shortLabel}</span>
                            {' → '}
                            <span className="text-slate-200">{getWarrantyStatusMeta(newStatus).shortLabel}</span>
                          </div>
                        )}
                        {remitoCode && (
                          <div className="mt-1 text-xs text-slate-400">Remito: <span className="font-mono text-slate-200">{remitoCode}</span></div>
                        )}
                        {event.message && <div className="mt-1 text-sm text-slate-300">{event.message}</div>}
                        <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{event.created_at}</span>
                          {(event.actor_display_name || event.actor_username) && (
                            <span>· {event.actor_display_name || event.actor_username}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ADMIN ACTIONS — collapsible (cancel + delete)
      ══════════════════════════════════════════════════════════════════ */}
      {(can('warranties.cancel') || can('warranties.delete')) && (
        <div className="rounded-3xl border border-slate-700 bg-slate-950/60 shadow-xl">
          <button
            type="button"
            onClick={() => setShowAdminActions((v) => !v)}
            className="flex w-full items-center justify-between p-5 text-left"
          >
            <div className="flex items-center gap-2 text-slate-400">
              <AlertTriangle size={16} />
              <span className="font-bold text-sm">Acciones administrativas avanzadas</span>
            </div>
            {showAdminActions ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
          </button>

          {showAdminActions && (
            <div className="space-y-4 border-t border-slate-800 p-5">
              {/* Anulación */}
              {can('warranties.cancel') && !s.cancelled && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                  <div className="flex items-center gap-2 text-red-200">
                    <AlertTriangle size={16} />
                    <span className="font-black">Anulación controlada</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    La garantía queda anulada pero se conserva toda la trazabilidad e historial. Usala para casos cerrados sin resolución o ingresados por error con historial.
                  </p>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2}
                      placeholder="Motivo de anulación (obligatorio)"
                      className="w-full rounded-xl border border-red-500/30 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-red-300" />
                    <button disabled={saving || !cancelReason.trim()} onClick={cancelCurrentWarranty}
                      className="inline-flex items-center justify-center rounded-xl border border-red-500/50 px-4 py-3 text-sm font-black text-red-100 hover:bg-red-500/10 disabled:opacity-40">
                      Anular garantía
                    </button>
                  </div>
                </div>
              )}
              {s.cancelled && (
                <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                  Esta garantía ya está anulada. No se puede volver a anular.
                </div>
              )}

              {/* Eliminación */}
              {can('warranties.delete') && (
                <div className="rounded-2xl border border-red-700/40 bg-red-950/20 p-4">
                  <div className="flex items-center gap-2 text-red-200">
                    <Trash2 size={16} />
                    <span className="font-black">Eliminación definitiva</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    Borra permanentemente la garantía y todos sus productos. <strong className="text-red-300">No tiene vuelta atrás.</strong> Solo para cargas de prueba o errores de alta sin historial relevante. Para casos reales usá anulación.
                  </p>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="Escribí ELIMINAR para confirmar"
                      className="w-full rounded-xl border border-red-700/40 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-red-300" />
                    <button disabled={saving || deleteConfirm.trim().toUpperCase() !== 'ELIMINAR'} onClick={deleteCurrentWarranty}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white hover:bg-red-500 disabled:opacity-40">
                      <Trash2 size={16} /> Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

// ─── helper components ───────────────────────────────────────────────────────

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl space-y-5 px-4 pb-10 sm:px-6">{children}</div>;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">
      <AlertTriangle size={18} className="shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-100">{value || <span className="text-slate-600">—</span>}</div>
    </div>
  );
}

function Input({ label, value, onChange, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-sm font-semibold text-slate-300">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
    </label>
  );
}

function Select({ label, value, options, onChange, allowEmpty = false }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; allowEmpty?: boolean;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-semibold text-slate-300">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-blue-400">
        {allowEmpty && <option value="">Sin definir</option>}
        {options.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
    </label>
  );
}

function ReadOnlyItem({ row }: { row: any }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="font-bold text-white">{row.producto || 'Sin producto'}</div>
      <div className="mt-2 grid gap-x-4 gap-y-1 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
        {row.sku && <span><span className="text-slate-500">SKU:</span> {row.sku}</span>}
        {row.serie && <span><span className="text-slate-500">Serie:</span> {row.serie}</span>}
        {row.marca && <span><span className="text-slate-500">Marca:</span> {row.marca}</span>}
        {row.tipo && <span><span className="text-slate-500">Tipo:</span> {row.tipo}</span>}
      </div>
      <div className="mt-3 rounded-xl bg-slate-950 p-3 text-sm text-slate-300">
        <span className="font-bold text-slate-400">Falla: </span>{row.falla || <span className="text-slate-600">—</span>}
      </div>
      {row.observaciones && (
        <div className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-sm text-slate-300">
          <span className="font-bold text-slate-400">Obs: </span>{row.observaciones}
        </div>
      )}
    </div>
  );
}
