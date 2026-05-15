import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Eye, RefreshCw, Save, ShieldCheck, Trash2, PencilLine } from 'lucide-react';
import { approveWarrantyReview, cancelWarranty, can, deleteWarranty, fetchWarrantyDetail, fetchWarrantyOptions, markWarrantyIncomplete, takeWarrantyIntoReview, updateWarranty, updateWarrantyEntryBase } from '../api/client';
import type { WarrantyDetailResponse, WarrantyItemUpdatePayload, WarrantyOptions } from '../types';
import { flowToneClass, getReviewStatusMeta, getWarrantyNextStep, getWarrantyStatusMeta } from '../warrantyFlow';

function copyText(value: string) { navigator.clipboard?.writeText(value).catch(() => undefined); }

export function WarrantyDetailPage() {
  const { warrantyId = '' } = useParams();
  const navigate = useNavigate();
  const id = decodeURIComponent(warrantyId);
  const [data, setData] = useState<WarrantyDetailResponse | null>(null);
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [estado, setEstado] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [deposito, setDeposito] = useState('');
  const [lugarLlegada, setLugarLlegada] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [photosReference, setPhotosReference] = useState('');
  const [fechaIngreso, setFechaIngreso] = useState('');
  const [proveedorBase, setProveedorBase] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');
  const [clienteEmail, setClienteEmail] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fechaCompra, setFechaCompra] = useState('');
  const [note, setNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [items, setItems] = useState<WarrantyItemUpdatePayload[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  function hydrate(detail: WarrantyDetailResponse, opts?: WarrantyOptions | null) {
    setData(detail);
    setEstado(detail.summary.estado || opts?.estado_default || '');
    setSucursal(detail.summary.sucursal || '');
    setDeposito(detail.summary.deposito || '');
    setLugarLlegada(detail.summary.lugar_llegada || detail.summary.deposito || '');
    setObservaciones(detail.summary.observaciones || '');
    setPhotosReference(detail.summary.photos_reference || '');
    setFechaIngreso(detail.summary.ingreso_iso || '');
    setProveedorBase(detail.summary.provider_name || '');
    setClienteNombre(detail.summary.cliente_nombre || '');
    setClienteTelefono(detail.summary.cliente_telefono || '');
    setClienteEmail(detail.summary.cliente_email || '');
    setNumeroFactura(detail.summary.numero_factura || '');
    setFechaCompra(detail.summary.fecha_compra || '');
    setReviewNote(detail.summary.review_note || '');
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
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await updateWarranty(id, {
        estado,
        sucursal,
        deposito,
        lugar_llegada: lugarLlegada,
        observaciones,
        photos_reference: photosReference,
        append_observation: note.trim() || undefined,
        items,
      });
      hydrate(updated, options);
      setNote('');
      setMessage('Garantía actualizada correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la garantía');
    } finally {
      setSaving(false);
    }
  }

  async function submitEntryBase(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await updateWarrantyEntryBase(id, {
        fecha_ingreso: fechaIngreso || undefined,
        observaciones,
        photos_reference: photosReference,
        proveedor: proveedorBase,
        cliente_nombre: clienteNombre,
        cliente_telefono: clienteTelefono,
        cliente_email: clienteEmail,
        numero_factura: numeroFactura,
        fecha_compra: fechaCompra,
        items,
      });
      hydrate(updated, options);
      setMessage('Base de ingreso actualizada correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la base de ingreso');
    } finally {
      setSaving(false);
    }
  }

  async function reviewAction(type: 'take' | 'incomplete' | 'approve') {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = { note: reviewNote.trim() || undefined };
      let updated;
      if (type === 'take') {
        updated = await takeWarrantyIntoReview(id, payload);
        setMessage('Garantía tomada en revisión interna.');
      } else if (type === 'incomplete') {
        updated = await markWarrantyIncomplete(id, payload);
        setMessage('Garantía marcada para corrección.');
      } else {
        updated = await approveWarrantyReview(id, payload);
        setMessage('Garantía aprobada y pasada a pendiente.');
      }
      hydrate(updated, options);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la revisión');
    } finally {
      setSaving(false);
    }
  }

  async function cancelCurrentWarranty() {
    if (!cancelReason.trim()) {
      setError('Indicá el motivo de anulación.');
      return;
    }
    const confirmed = window.confirm('La garantía se marcará como anulada y quedará registrada en historial. ¿Continuar?');
    if (!confirmed) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await cancelWarranty(id, { reason: cancelReason.trim() });
      hydrate(updated, options);
      setCancelReason('');
      setMessage('Garantía anulada correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anular la garantía');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCurrentWarranty() {
    if (deleteConfirm.trim().toUpperCase() !== 'ELIMINAR') {
      setError('Para eliminar definitivamente, escribí ELIMINAR.');
      return;
    }
    const confirmed = window.confirm('Esta acción elimina definitivamente la garantía y sus productos asociados. Usala solo para cargas de prueba o errores de alta. ¿Continuar?');
    if (!confirmed) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await deleteWarranty(id);
      navigate('/warranties', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la garantía');
    } finally {
      setSaving(false);
    }
  }

  function updateItem(index: number, field: keyof WarrantyItemUpdatePayload, value: string) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  if (error && !data) return <Page><ErrorBox message={error} /></Page>;
  if (!data) return <Page><div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">Cargando garantía...</div></Page>;
  const s = data.summary;
  const entryBaseStatusOk = (s.estado || '').toUpperCase().includes('INGRESO') || (s.estado || '').toUpperCase().includes('CORRECCIÓN');
  const entryBaseReviewOk = ['pendiente_revision', 'requiere_correccion'].includes(s.review_status || '');
  const canEditEntryBase = !s.cancelled && (can('warranties.manage') || can('warranties.create')) && (can('warranties.manage') || (entryBaseStatusOk && entryBaseReviewOk));
  const reviewAlreadyApproved = s.review_status === 'revisada';
  const canShowReviewActions = !reviewAlreadyApproved && !s.cancelled;

  return (
    <Page>
      {error && <ErrorBox message={error} />}
      {message && <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}

      <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-100"><ShieldCheck size={14} /> Detalle de garantía</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-black sm:text-3xl">{s.id_garantia}</h1>
              <button onClick={() => copyText(s.id_garantia)} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-900"><Copy size={16} /></button>
            </div>
            <p className="mt-2 text-slate-400">{s.producto_principal} · {s.cantidad_items} producto(s)</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-black ${flowToneClass(getWarrantyStatusMeta(s.estado).tone)}`}>{getWarrantyStatusMeta(s.estado).label}</span>
              <span className={`rounded-full border px-3 py-1 text-xs font-black ${flowToneClass(getReviewStatusMeta(s.review_status).tone)}`}>{s.review_status_label || getReviewStatusMeta(s.review_status).label}</span>
              {s.resultado_resolucion && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-100">{s.resultado_resolucion_label || s.resultado_resolucion}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900"><RefreshCw size={18} /> Actualizar</button>
            <Link to="/warranties" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900"><ArrowLeft size={18} /> Volver</Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <Info label="Ingreso" value={s.ingreso} />
          <Info label="Responsable" value={s.responsable} />
          <Info label="Sucursal" value={s.sucursal} />
          <Info label="Depósito / lugar" value={s.lugar_llegada || s.deposito} />
          <Info label="Estado" value={getWarrantyStatusMeta(s.estado).label} />
          <Info label="Revisión" value={s.review_status_label || getReviewStatusMeta(s.review_status).label} />
          <Info label="Revisado por" value={s.reviewed_by_name || s.reviewed_by} />
          <Info label="Última actualización" value={s.fecha_ultima_actualizacion} />
          <Info label="Proveedor" value={s.provider_name} />
          <Info label="ID de caso" value={s.id_de_caso} />
          <Info label="Envío proveedor" value={s.fecha_envio_proveedor} />
          <Info label="Última respuesta" value={s.fecha_ultima_respuesta} />
        </div>
        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${flowToneClass(getWarrantyStatusMeta(s.estado).tone)}`}>
          <div className="text-xs font-black uppercase tracking-wide opacity-80">Próximo paso sugerido</div>
          <div className="mt-1 font-bold">{getWarrantyNextStep(s)}</div>
        </div>

        {/* ── Campos Fase 1: tipo de ingreso + ubicación + datos del cliente ─── */}
        {(s.tipo_ingreso_label || s.ubicacion_actual_label || s.cliente_nombre || s.numero_factura) && (
          <div className="mt-4 space-y-3">
            {(s.tipo_ingreso_label || s.origen_ingreso || s.ubicacion_actual_label) && (
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-violet-300">Origen y ubicación</div>
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  {s.tipo_ingreso_label && <Info label="Tipo de ingreso" value={s.tipo_ingreso_label} />}
                  {s.origen_ingreso && <Info label="Origen de ingreso" value={s.origen_ingreso === 'sucursal' ? 'Sucursal' : 'Depósito'} />}
                  {s.ubicacion_actual_label && <Info label="Ubicación actual" value={s.ubicacion_actual_label} />}
                  {s.sucursal_responsable && s.sucursal_responsable !== s.sucursal && (
                    <Info label="Sucursal responsable" value={s.sucursal_responsable} />
                  )}
                </div>
              </div>
            )}
            {(s.cliente_nombre || s.cliente_telefono || s.cliente_email || s.numero_factura || s.fecha_compra) && (
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/30 p-4">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Datos del cliente</div>
                <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                  {s.cliente_nombre && <Info label="Nombre" value={s.cliente_nombre} />}
                  {s.cliente_telefono && <Info label="Teléfono" value={s.cliente_telefono} />}
                  {s.cliente_email && <Info label="Email" value={s.cliente_email} />}
                  {s.numero_factura && <Info label="N° factura / ticket" value={s.numero_factura} />}
                  {s.fecha_compra && <Info label="Fecha de compra" value={s.fecha_compra} />}
                </div>
              </div>
            )}
          </div>
        )}

        {(s.resultado_resolucion || s.fecha_finalizacion) && (
          <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-emerald-300">Resolución y cierre</div>
            <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
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

        {s.cancelled && (
          <div className="mt-5 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">
            <b>Garantía anulada.</b> {s.cancel_reason || ''}{s.cancelled_at ? ` · ${s.cancelled_at}` : ''}
          </div>
        )}
      </div>

      {(can('warranties.review') || can('warranties.mark_incomplete') || can('warranties.approve_review')) && !s.cancelled && (
        <div className={`rounded-3xl border p-5 shadow-xl ${s.review_status === 'en_revision' ? 'border-violet-500/40 bg-violet-500/5' : 'border-slate-700 bg-slate-950/60'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black">Revisión interna</h2>
            {s.review_status === 'en_revision' && (
              <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-black text-violet-200">En revisión interna</span>
            )}
            {s.review_status === 'requiere_correccion' && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">Requiere corrección</span>
            )}
          </div>
          {reviewAlreadyApproved && (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-100">
              Revisión aprobada. Esta garantía ya no necesita acciones de revisión interna.
            </div>
          )}
          {canShowReviewActions && <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Nota de revisión</span>
              <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={3} placeholder="Observación interna de revisión..." className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <div className="flex flex-col gap-2">
              {can('warranties.review') && s.review_status !== 'en_revision' && s.review_status !== 'revisada' && (
                <button disabled={saving} onClick={() => reviewAction('take')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-500/50 px-4 py-3 font-black text-violet-100 hover:bg-violet-500/10 disabled:opacity-50">
                  <Eye size={18} /> Tomar en revisión
                </button>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                {can('warranties.mark_incomplete') && <button disabled={saving} onClick={() => reviewAction('incomplete')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/50 px-4 py-3 font-black text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"><AlertTriangle size={18} /> Requiere corrección</button>}
                {can('warranties.approve_review') && <button disabled={saving} onClick={() => reviewAction('approve')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-black text-white hover:bg-emerald-400 disabled:opacity-50"><CheckCircle2 size={18} /> Aprobar revisión</button>}
              </div>
            </div>
          </div>}
        </div>
      )}

      {canEditEntryBase && (
        <form onSubmit={submitEntryBase} className="rounded-3xl border border-blue-500/25 bg-blue-500/5 p-5 shadow-xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-black text-blue-100"><PencilLine size={20} /> Base de ingreso</h2>
              <p className="mt-1 text-sm text-slate-400">
                Corrección controlada de datos recién ingresados. No cambia revisión, remitos, ENV ni proveedor operativo.
              </p>
            </div>
            <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-100">
              Ingreso editable
            </span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Fecha de ingreso</span>
              <input type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <Input label="Proveedor / fabricante" value={proveedorBase} onChange={setProveedorBase} />
            <Input label="Cliente" value={clienteNombre} onChange={setClienteNombre} />
            <Input label="Teléfono cliente" value={clienteTelefono} onChange={setClienteTelefono} />
            <Input label="Email cliente (opcional)" value={clienteEmail} onChange={setClienteEmail} />
            <Input label="Factura / ticket" value={numeroFactura} onChange={setNumeroFactura} />
            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Fecha de compra</span>
              <input type="date" value={fechaCompra} onChange={(e) => setFechaCompra(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label className="lg:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Referencia de fotos</span>
              <input value={photosReference} onChange={(e) => setPhotosReference(e.target.value)} placeholder="Ej: Fotos enviadas al grupo con este ID" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label className="lg:col-span-4">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Observaciones generales</span>
              <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
          </div>

          <h3 className="mt-6 text-lg font-black">Productos cargados</h3>
          <div className="mt-4 space-y-4">
            {items.map((item, index) => (
              <div key={item.row_number} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Input label="Producto" value={item.producto || ''} onChange={(v) => updateItem(index, 'producto', v)} className="xl:col-span-2" />
                  <Input label="SKU" value={item.sku || ''} onChange={(v) => updateItem(index, 'sku', v)} />
                  <Input label="Marca" value={item.marca || ''} onChange={(v) => updateItem(index, 'marca', v)} />
                  <Input label="Tipo" value={item.tipo || ''} onChange={(v) => updateItem(index, 'tipo', v)} />
                  <Input label="Serie" value={item.serie || ''} onChange={(v) => updateItem(index, 'serie', v)} />
                  <Input label="Falla" value={item.falla || ''} onChange={(v) => updateItem(index, 'falla', v)} className="xl:col-span-2" />
                  <Input label="Observaciones" value={item.observaciones || ''} onChange={(v) => updateItem(index, 'observaciones', v)} className="xl:col-span-4" />
                </div>
              </div>
            ))}
          </div>
          <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400 disabled:opacity-50"><Save size={18} /> {saving ? 'Guardando...' : 'Guardar base de ingreso'}</button>
        </form>
      )}

      {can('warranties.manage') && !s.cancelled && (
        <form onSubmit={submit} className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
          <h2 className="text-xl font-black">Datos operativos</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Select label="Estado" value={estado} onChange={setEstado} options={Array.from(new Set([ ...(((options as any)?.estados || []) as string[]), options?.estado_default || '1 - INGRESO', estado ].filter(Boolean)))} />
            <Select label="Sucursal" value={sucursal} onChange={setSucursal} options={options?.sucursales || []} allowEmpty />
            <Select label="Depósito / lugar actual" value={deposito} onChange={setDeposito} options={options?.depositos || []} allowEmpty />
            <Select label="Lugar de llegada" value={lugarLlegada} onChange={setLugarLlegada} options={options?.depositos || []} allowEmpty />
            <label className="lg:col-span-3">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Referencia de fotos</span>
              <input value={photosReference} onChange={(e) => setPhotosReference(e.target.value)} placeholder="Ej: Fotos enviadas al grupo con este ID" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label className="lg:col-span-3">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Observaciones generales</span>
              <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
            <label className="lg:col-span-3">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Agregar movimiento</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Ej: Se corrigió número de serie / se agregó referencia de fotos..." className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
            </label>
          </div>

          <h3 className="mt-6 text-lg font-black">Productos asociados</h3>
          <div className="mt-4 space-y-4">
            {items.map((item, index) => (
              <div key={item.row_number} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Input label="Producto" value={item.producto || ''} onChange={(v) => updateItem(index, 'producto', v)} className="xl:col-span-2" />
                  <Input label="SKU" value={item.sku || ''} onChange={(v) => updateItem(index, 'sku', v)} />
                  <Input label="Marca" value={item.marca || ''} onChange={(v) => updateItem(index, 'marca', v)} />
                  <Input label="Tipo" value={item.tipo || ''} onChange={(v) => updateItem(index, 'tipo', v)} />
                  <Input label="Serie" value={item.serie || ''} onChange={(v) => updateItem(index, 'serie', v)} />
                  <Input label="Falla" value={item.falla || ''} onChange={(v) => updateItem(index, 'falla', v)} className="xl:col-span-2" />
                  <Input label="Observaciones" value={item.observaciones || ''} onChange={(v) => updateItem(index, 'observaciones', v)} className="xl:col-span-4" />
                </div>
              </div>
            ))}
          </div>
          <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400 disabled:opacity-50"><Save size={18} /> {saving ? 'Guardando...' : 'Guardar cambios'}</button>
        </form>
      )}

      {(!can('warranties.manage') || s.cancelled) && (
        <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
          <h2 className="text-xl font-black">Productos asociados</h2>
          <div className="mt-4 space-y-3">
            {data.rows.map((row) => <ReadOnlyItem key={row.row_number} row={row} />)}
          </div>
        </div>
      )}

      {can('warranties.cancel') && !s.cancelled && (
        <div className="rounded-3xl border border-red-500/30 bg-red-500/5 p-5 shadow-xl">
          <h2 className="text-xl font-black text-red-100">Anulación controlada</h2>
          <p className="mt-1 text-sm text-slate-400">La garantía queda anulada y se conserva la trazabilidad.</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Motivo de anulación" className="w-full rounded-xl border border-red-500/30 bg-slate-950 px-4 py-3 outline-none focus:border-red-300" />
            <button disabled={saving} onClick={cancelCurrentWarranty} className="inline-flex items-center justify-center rounded-xl border border-red-500/50 px-5 py-3 font-black text-red-100 hover:bg-red-500/10 disabled:opacity-50">Anular garantía</button>
          </div>
        </div>
      )}

      {can('warranties.delete') && (
        <div className="rounded-3xl border border-red-700/40 bg-red-950/20 p-5 shadow-xl">
          <h2 className="flex items-center gap-2 text-xl font-black text-red-100"><Trash2 size={20} /> Eliminación definitiva</h2>
          <p className="mt-1 text-sm text-slate-400">Solo para cargas de prueba o errores de alta. Para casos reales usá anulación.</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
            <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="Escribí ELIMINAR para confirmar" className="w-full rounded-xl border border-red-700/40 bg-slate-950 px-4 py-3 outline-none focus:border-red-300" />
            <button disabled={saving || deleteConfirm.trim().toUpperCase() !== 'ELIMINAR'} onClick={deleteCurrentWarranty} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-black text-white hover:bg-red-500 disabled:opacity-50"><Trash2 size={18} /> Eliminar</button>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
        <h2 className="text-xl font-black">Movimientos de esta garantía</h2>
        <div className="mt-4 space-y-3">
          {data.history.length === 0 && <p className="text-sm text-slate-400">Todavía no hay movimientos registrados.</p>}
          {data.history.map((event) => (
            <div key={event.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
              <div className="font-bold text-white">{event.event_type}</div>
              <div className="text-slate-400">{event.created_at}</div>
              <div className="text-slate-300">{event.actor_display_name || event.actor_username || 'Sistema'}</div>
              {event.message && <div className="mt-1 text-slate-300">{event.message}</div>}
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) { return <div className="mx-auto max-w-7xl space-y-6">{children}</div>; }
function ErrorBox({ message }: { message: string }) { return <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{message}</div>; }
function Info({ label, value }: { label: string; value?: string }) { return <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 font-semibold text-slate-100">{value || '-'}</div></div>; }
function Input({ label, value, onChange, className = '' }: { label: string; value: string; onChange: (v: string) => void; className?: string }) { return <label className={className}><span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-blue-400" /></label>; }
function Select({ label, value, options, onChange, allowEmpty = false }: { label: string; value: string; options: string[]; onChange: (v: string) => void; allowEmpty?: boolean }) { return <label><span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">{allowEmpty && <option value="">Sin definir</option>}{options.map((op) => <option key={op} value={op}>{op}</option>)}</select></label>; }
function ReadOnlyItem({ row }: { row: any }) { return <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><div className="font-bold text-white">{row.producto || 'Sin producto'}</div><div className="mt-2 grid gap-2 text-sm text-slate-300 sm:grid-cols-2"><span>SKU: {row.sku || '-'}</span><span>Serie: {row.serie || '-'}</span><span>Marca: {row.marca || '-'}</span><span>Tipo: {row.tipo || '-'}</span></div><div className="mt-3 rounded-xl bg-slate-950 p-3 text-sm text-slate-300"><b>Falla:</b> {row.falla || '-'}</div>{row.observaciones && <div className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-sm text-slate-300"><b>Obs:</b> {row.observaciones}</div>}</div>; }
