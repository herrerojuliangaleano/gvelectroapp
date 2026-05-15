import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock, FileCheck2, Filter, MessageSquareReply, PackageCheck, RefreshCw, Search, Send, ShieldCheck, Truck } from 'lucide-react';
import {
  can,
  changeWarrantyStatus,
  confirmWarrantyShipment,
  fetchWarrantyManagement,
  fetchWarrantyOptions,
  registerWarrantyClaim,
  resendWarrantyProviderMail,
  registerWarrantyProviderResponse,
  registerWarrantyProviderPickupRequest,
  sendWarrantyToProvider,
} from '../api/client';
import type { WarrantyListResponse, WarrantyOptions, WarrantySummary } from '../types';
import { CANONICAL_WARRANTY_STATUSES, flowToneClass, getWarrantyNextStep, getWarrantyStatusMeta } from '../warrantyFlow';

const PROVIDER_STATUSES = CANONICAL_WARRANTY_STATUSES.filter((status) => status !== '1 - INGRESO');

const FINAL_STATUSES = ['10 - FINALIZADO'];

// Opciones de resultado_resolucion cuando estado = "7 - RESUELTO"
const RESOLUTION_TYPES: { value: string; label: string; helper: string }[] = [
  { value: 'nota_credito', label: 'Nota de crédito', helper: 'Proveedor reconoce el caso con NC. Después se finaliza cuando la NC queda aplicada/cerrada.' },
  { value: 'reparacion', label: 'Reparación', helper: 'Proveedor repara el mismo equipo. Después se finaliza cuando el equipo vuelve/se entrega.' },
  { value: 'cambio_equipo', label: 'Cambio de equipo', helper: 'Proveedor aprueba reemplazo. Después se finaliza cuando se recibe/entrega el equipo nuevo.' },
];

interface ActionState {
  provider_name: string;
  provider_case_id: string;
  response_note: string;
  claim_note: string;
  resend_note: string;
  status: string;
  status_note: string;
  resolution_note: string;
  resolution_reference: string;
  resultado_resolucion: string;
  numero_nota_credito: string;
  importe_nota_credito: string;
  fecha_nota_credito: string;
  detalle_reparacion: string;
  fecha_reparacion: string;
  producto_reemplazo: string;
  sku_reemplazo: string;
  serie_reemplazo: string;
  fecha_recepcion_reemplazo: string;
  finalizacion: string;
  confirm_code: string;
}

function emptyAction(item?: WarrantySummary): ActionState {
  return {
    provider_name: item?.provider_name || '',
    provider_case_id: item?.id_de_caso || '',
    response_note: '',
    claim_note: '',
    resend_note: '',
    status: item?.estado || '6 - RESPONDIDO POR PROVEEDOR',
    status_note: '',
    resolution_note: item?.resolution_note || '',
    resolution_reference: item?.resolution_reference || '',
    resultado_resolucion: item?.resultado_resolucion || '',
    numero_nota_credito: item?.numero_nota_credito || '',
    importe_nota_credito: item?.importe_nota_credito || '',
    fecha_nota_credito: item?.fecha_nota_credito || '',
    detalle_reparacion: item?.detalle_reparacion || '',
    fecha_reparacion: item?.fecha_reparacion || '',
    producto_reemplazo: item?.producto_reemplazo || '',
    sku_reemplazo: item?.sku_reemplazo || '',
    serie_reemplazo: item?.serie_reemplazo || '',
    fecha_recepcion_reemplazo: item?.fecha_recepcion_reemplazo || '',
    finalizacion: item?.finalizacion || '',
    confirm_code: '',
  };
}

// Cuando el estado es "8 - RECHAZADO" pedimos solo motivo (sin sub-tipo)
const REJECT_FIELDS = { noteLabel: 'Motivo del rechazo', notePlaceholder: 'Ej. Daño por mal uso del usuario, fuera de garantía por humedad' };

function delayClass(days?: number | null) {
  const d = Number(days || 0);
  if (d >= 15) return 'border-red-500/40 bg-red-500/10 text-red-100';
  if (d >= 7) return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  return 'border-slate-700 bg-slate-900 text-slate-200';
}

export function WarrantyManagementPage() {
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [filters, setFilters] = useState({ q: '', marca: '', proveedor: '', sucursal: '', deposito: '', estado: '', demora_min: '' });
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [savingId, setSavingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const stats = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      listoParaEnviar: items.filter((item) => item.estado === '3 - LISTO PARA ENVIAR').length,
      enviadas: items.filter((item) => item.estado === '4 - ENVIADO AL PROVEEDOR').length,
      enProveedor: items.filter((item) => item.estado === '5 - EN EL PROVEEDOR').length,
      demoradas: items.filter((item) => Number(item.dias_sin_respuesta || 0) >= 7).length,
      finalizadas: items.filter((item) => FINAL_STATUSES.includes(item.estado)).length,
    };
  }, [data]);

  const estados = useMemo(() => {
    const set = new Set<string>(['3 - LISTO PARA ENVIAR', ...PROVIDER_STATUSES]);
    data?.items.forEach((item) => item.estado && set.add(item.estado));
    return Array.from(set);
  }, [data]);

  async function load(extra = filters) {
    setLoading(true);
    setError('');
    try {
      const [opts, warranties] = await Promise.all([fetchWarrantyOptions(), fetchWarrantyManagement({ ...extra, limit: 300 })]);
      setOptions(opts);
      setData(warranties);
      setActions((prev) => {
        const next = { ...prev };
        warranties.items.forEach((item) => {
          if (!next[item.id_garantia]) next[item.id_garantia] = emptyAction(item);
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la gestión de garantías');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    load(filters);
  }

  function updateAction(id: string, patch: Partial<ActionState>) {
    setActions((prev) => ({ ...prev, [id]: { ...(prev[id] || emptyAction()), ...patch } }));
  }

  async function doAction(id: string, type: 'send' | 'response' | 'claim' | 'resend' | 'status' | 'confirm' | 'pickup', override: Partial<ActionState> = {}) {
    const state = { ...(actions[id] || emptyAction()), ...override };
    setSavingId(`${id}:${type}`);
    setMessage('');
    setError('');
    try {
      if (type === 'confirm') {
        await confirmWarrantyShipment(id, {
          shipment_code: state.confirm_code.trim(),
          provider_name: state.provider_name.trim() || undefined,
        });
        setMessage('Envío confirmado. La garantía pasó a ENVIADO AL PROVEEDOR.');
        setActions((prev) => ({ ...prev, [id]: { ...(prev[id] || emptyAction()), confirm_code: '' } }));
        await load(filters);
        return;
      }
      if (type === 'send') {
        await sendWarrantyToProvider(id, {
          provider_name: state.provider_name.trim(),
          provider_case_id: state.provider_case_id.trim() || undefined,
          note: state.status_note.trim() || undefined,
        });
        setMessage('Garantía enviada al proveedor.');
      }
      if (type === 'response') {
        await registerWarrantyProviderResponse(id, {
          provider_case_id: state.provider_case_id.trim() || undefined,
          note: state.response_note.trim() || undefined,
          estado: state.status || '6 - RESPONDIDO POR PROVEEDOR',
        });
        setMessage('Respuesta del proveedor registrada.');
      }
      if (type === 'pickup') {
        await registerWarrantyProviderPickupRequest(id, {
          provider_case_id: state.provider_case_id.trim() || undefined,
          note: state.response_note.trim() || undefined,
        });
        setMessage('Retiro solicitado por proveedor registrado. Si no está en Chiclana, queda como urgente para traer.');
      }
      if (type === 'claim') {
        await registerWarrantyClaim(id, { note: state.claim_note.trim() });
        setMessage('Reclamo registrado.');
      }
      if (type === 'resend') {
        await resendWarrantyProviderMail(id, { note: state.resend_note.trim() || undefined });
        setMessage('Mail reenviado. Se reinició el contador de días sin respuesta.');
      }
      if (type === 'status') {
        await changeWarrantyStatus(id, {
          estado: state.status,
          note: state.status_note.trim() || undefined,
          resolution_note: state.resolution_note.trim() || undefined,
          resolution_reference: state.resolution_reference.trim() || undefined,
          resultado_resolucion: state.resultado_resolucion.trim() || undefined,
          numero_nota_credito: state.numero_nota_credito.trim() || undefined,
          importe_nota_credito: state.importe_nota_credito.trim() || undefined,
          fecha_nota_credito: state.fecha_nota_credito || undefined,
          detalle_reparacion: state.detalle_reparacion.trim() || undefined,
          fecha_reparacion: state.fecha_reparacion || undefined,
          producto_reemplazo: state.producto_reemplazo.trim() || undefined,
          sku_reemplazo: state.sku_reemplazo.trim() || undefined,
          serie_reemplazo: state.serie_reemplazo.trim() || undefined,
          fecha_recepcion_reemplazo: state.fecha_recepcion_reemplazo || undefined,
          finalizacion: state.finalizacion.trim() || undefined,
        });
        setMessage('Estado actualizado.');
      }
      setActions((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || emptyAction()),
          response_note: '',
          claim_note: '',
          resend_note: '',
          status_note: '',
          resolution_note: '',
          resolution_reference: '',
        },
      }));
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
            <Building2 size={14} /> Gestión con proveedor
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Garantías en gestión</h1>
          <p className="mt-2 text-slate-400">Seguimiento operativo por marca, proveedor y demora.</p>
        </div>
        <button onClick={() => load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900">
          <RefreshCw size={18} /> Actualizar
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
      {message && <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi title="Total" value={stats.total} />
        <Kpi title="Listo p/ enviar" value={stats.listoParaEnviar} tone="warn" />
        <Kpi title="Enviadas" value={stats.enviadas} />
        <Kpi title="En proveedor" value={stats.enProveedor} />
        <Kpi title="Demoradas +7" value={stats.demoradas} tone="warn" />
        <Kpi title="Finalizadas" value={stats.finalizadas} tone="ok" />
      </div>

      <form onSubmit={submit} className="rounded-3xl border border-slate-700 bg-slate-950/60 p-4 shadow-xl sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300"><Filter size={16} /> Filtros</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          <label className="xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-300">Buscar</span>
            <div className="relative">
              <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
              <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="ID, SKU, serie, producto..." className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-4 outline-none focus:border-blue-400" />
            </div>
          </label>
          <Text label="Marca" value={filters.marca} onChange={(v) => setFilters({ ...filters, marca: v })} placeholder="Ej. Samsung" />
          <Text label="Proveedor" value={filters.proveedor} onChange={(v) => setFilters({ ...filters, proveedor: v })} placeholder="Proveedor" />
          <Select label="Sucursal" value={filters.sucursal} onChange={(v) => setFilters({ ...filters, sucursal: v })} options={options?.sucursales || []} />
          <Select label="Estado" value={filters.estado} onChange={(v) => setFilters({ ...filters, estado: v })} options={estados} />
          <Select label="Demora" value={filters.demora_min} onChange={(v) => setFilters({ ...filters, demora_min: v })} options={[['7', '+7 días sin respuesta'], ['15', '+15 días sin respuesta'], ['30', '+30 días sin respuesta']]} />
        </div>
        <button className="mt-4 rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400">Aplicar filtros</button>
      </form>

      {loading && <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">Cargando garantías...</div>}
      {!loading && data?.items.length === 0 && <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">No hay garantías con esos filtros.</div>}

      <div className="space-y-4">
        {data?.items.map((item) => (
          <ManagementCard
            key={item.id_garantia}
            item={item}
            state={actions[item.id_garantia] || emptyAction(item)}
            savingId={savingId}
            update={(patch) => updateAction(item.id_garantia, patch)}
            run={(type, override) => doAction(item.id_garantia, type, override)}
          />
        ))}
      </div>
    </div>
  );
}

function Kpi({ title, value, tone = 'base' }: { title: string; value: number; tone?: 'base' | 'warn' | 'ok' }) {
  const cls = tone === 'warn' ? 'border-amber-500/30 bg-amber-500/10' : tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-700 bg-slate-950/50';
  return <div className={`rounded-3xl border p-4 ${cls}`}><div className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</div><div className="mt-1 text-3xl font-black text-white">{value}</div></div>;
}

function Text({ label, value, onChange, placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[] | [string, string][]; onChange: (v: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
        <option value="">Todos</option>
        {options.map((op) => Array.isArray(op) ? <option key={op[0]} value={op[0]}>{op[1]}</option> : <option key={op} value={op}>{op}</option>)}
      </select>
    </label>
  );
}


const CLOSED_PROVIDER_STATUSES = ['8 - RECHAZADO', '9 - ANULADA', '10 - FINALIZADO'];

function normLocation(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function isDepositLocation(value?: string | null) {
  const key = normLocation(value);
  return key === 'DEPOSITO' || key.startsWith('DEPOSITO ');
}

function currentLocationLabel(item: WarrantySummary) {
  if (item.transit_status === 'en_transito') {
    return `En tránsito a Depósito Chiclana${item.remito_interno ? ` · ${item.remito_interno}` : ''}`;
  }
  if (item.ubicacion_actual_label || item.ubicacion_actual) {
    return item.ubicacion_actual_label || item.ubicacion_actual;
  }
  if (item.transit_status === 'en_deposito') {
    return item.lugar_llegada || item.deposito || 'Depósito';
  }
  return item.lugar_llegada || item.deposito || item.sucursal || '-';
}

function internalTransportReady(item: WarrantySummary) {
  if (item.origen_ingreso !== 'sucursal') return true;
  return item.transit_status === 'en_deposito' || isDepositLocation(item.ubicacion_actual);
}

function hasInternalTransportBlocked(item: WarrantySummary) {
  return item.origen_ingreso === 'sucursal' && !internalTransportReady(item);
}

function nextProviderStatuses(item: WarrantySummary) {
  if (item.estado === '4 - ENVIADO AL PROVEEDOR') return ['5 - EN EL PROVEEDOR'];
  if (item.estado === '5 - EN EL PROVEEDOR') return ['6 - RESPONDIDO POR PROVEEDOR', '7 - RESUELTO', '8 - RECHAZADO', '9 - ANULADA'];
  if (item.estado === '6 - RESPONDIDO POR PROVEEDOR') return ['7 - RESUELTO', '8 - RECHAZADO', '9 - ANULADA'];
  if (item.estado === '7 - RESUELTO') return ['10 - FINALIZADO'];
  return [];
}

function statusHelperText(item: WarrantySummary) {
  if (item.estado === '2 - PENDIENTE') return 'Ya fue revisada. El próximo paso es Exportación para generar ENV.';
  if (item.estado === '3 - LISTO PARA ENVIAR') return 'Ya tiene lote ENV. Confirmá el mail enviado al proveedor.';
  if (item.estado === '4 - ENVIADO AL PROVEEDOR') return 'Mail/ENV enviado. Si el proveedor acepta o avisa retiro, registrá “solicita retiro” para traerla urgente a Chiclana.';
  if (item.estado === '5 - EN EL PROVEEDOR') return 'El producto está en proveedor. Podés registrar respuesta, rechazo o resolución.';
  if (item.estado === '6 - RESPONDIDO POR PROVEEDOR') return 'Ya hubo respuesta. Definí resolución, rechazo o anulación.';
  if (item.estado === '7 - RESUELTO') return 'Ya tiene resolución. Solo falta cerrar/finalizar cuando se ejecute la solución.';
  if (CLOSED_PROVIDER_STATUSES.includes(item.estado)) return 'Caso cerrado para gestión. No hay acciones operativas disponibles.';
  return '';
}

function ManagementCard({ item, state, savingId, update, run }: { item: WarrantySummary; state: ActionState; savingId: string; update: (patch: Partial<ActionState>) => void; run: (type: 'send' | 'response' | 'claim' | 'resend' | 'status' | 'confirm' | 'pickup', override?: Partial<ActionState>) => void }) {
  const canManageProvider = can('warranties.manage_provider');
  const canResponse = can('warranties.register_provider_response');
  const canClaim = can('warranties.register_claim');
  const canStatus = can('warranties.change_status');
  const hasProvider = Boolean(item.provider_name || item.fecha_envio_proveedor);
  const isPendingConfirm = Boolean(item.shipment_code) && !item.fecha_envio_proveedor;
  const isApprovedPending = item.estado === '2 - PENDIENTE' && !item.shipment_code;
  const isClosed = CLOSED_PROVIDER_STATUSES.includes(item.estado);
  const isResolvedOpen = item.estado === '7 - RESUELTO';
  const logisticsReady = internalTransportReady(item);
  const logisticsBlocked = hasInternalTransportBlocked(item);
  const nextStatuses = nextProviderStatuses(item);
  const statusOptions = Array.from(new Set([item.estado, ...nextStatuses].filter(Boolean)));
  const effectiveStatus = statusOptions.includes(state.status) ? state.status : (nextStatuses[0] || item.estado);
  const canTrackProvider = hasProvider && !isApprovedPending && !isPendingConfirm && !isClosed && !isResolvedOpen;
  const canRegisterProviderResponse = canTrackProvider && ['4 - ENVIADO AL PROVEEDOR', '5 - EN EL PROVEEDOR', '6 - RESPONDIDO POR PROVEEDOR'].includes(item.estado);
  const canRegisterPickup = canTrackProvider && ['4 - ENVIADO AL PROVEEDOR', '6 - RESPONDIDO POR PROVEEDOR'].includes(item.estado) && item.estado_retiro_proveedor !== 'retirado';
  const canRegisterClaim = canTrackProvider && ['4 - ENVIADO AL PROVEEDOR', '5 - EN EL PROVEEDOR', '6 - RESPONDIDO POR PROVEEDOR'].includes(item.estado);
  const canResendMail = canRegisterClaim && item.estado === '4 - ENVIADO AL PROVEEDOR';
  const canChangeStage = !isClosed && nextStatuses.length > 0;
  // Necesita traslado: ingresó en sucursal y todavía no llegó al depósito
  const needsTransport = logisticsBlocked;
  const codeMatches = state.confirm_code.trim().toUpperCase() === (item.shipment_code || '').toUpperCase();
  const helperText = getWarrantyNextStep(item);
  return (
    <div className={`rounded-3xl border p-4 shadow-xl sm:p-5 ${isApprovedPending ? 'border-violet-500/30 bg-violet-950/20' : 'border-slate-700 bg-slate-950/60'}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="font-mono text-xl font-black text-white hover:text-blue-200">{item.id_garantia}</Link>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${flowToneClass(getWarrantyStatusMeta(item.estado).tone)}`}>{getWarrantyStatusMeta(item.estado).shortLabel}</span>
            {isApprovedPending && (
              <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-black text-violet-200">
                ✓ Revisada — pendiente de exportación
              </span>
            )}
            {isPendingConfirm && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-black text-amber-200">
                Lote: {item.shipment_code}
              </span>
            )}
            {item.transit_status === 'en_transito' && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-black text-amber-200">
                <Truck size={12} className="mr-1 inline" />En tránsito {item.remito_interno && `· ${item.remito_interno}`}
              </span>
            )}
            {item.transit_status === 'en_deposito' && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-200">
                <CheckCircle2 size={12} className="mr-1 inline" />En depósito {item.remito_interno && `· ${item.remito_interno}`}
              </span>
            )}
            {item.estado_retiro_proveedor === 'retiro_solicitado' && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-black text-red-200">
                <AlertTriangle size={12} className="mr-1 inline" />Retiro solicitado
              </span>
            )}
            {item.estado_retiro_proveedor === 'listo_para_retiro' && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-200">
                <PackageCheck size={12} className="mr-1 inline" />Listo para retiro
              </span>
            )}
            {!isPendingConfirm && (
              <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${delayClass(item.dias_sin_respuesta)}`}><Clock size={12} className="mr-1 inline" />{item.dias_sin_respuesta ?? '-'} días sin respuesta</span>
            )}
          </div>
          <div className="mt-2 text-lg font-bold text-slate-100">{item.producto_principal || 'Sin producto'}</div>
          <div className="mt-2 grid gap-2 text-sm text-slate-300 md:grid-cols-3">
            <span>SKU: {item.sku || '-'}</span>
            <span>Serie: {item.serie || '-'}</span>
            <span>Sucursal: {item.sucursal || '-'}</span>
            <span>Proveedor: {item.provider_name || '-'}</span>
            <span>ID de caso: {item.id_de_caso || '-'}</span>
            <span>Envío: {item.fecha_envio_proveedor || '-'}</span>
            <span>Última respuesta: {item.fecha_ultima_respuesta || '-'}</span>
            <span>Último reclamo: {item.fecha_ultimo_reclamo || '-'}</span>
          </div>

          {/* Ubicación física prominente */}
          <div className={`mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${
            item.transit_status === 'en_deposito'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
              : item.transit_status === 'en_transito'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : needsTransport
              ? 'border-orange-500/40 bg-orange-500/10 text-orange-100'
              : 'border-slate-700 bg-slate-900 text-slate-200'
          }`}>
            {item.transit_status === 'en_deposito' ? <CheckCircle2 size={15} /> : item.transit_status === 'en_transito' ? <Truck size={15} /> : <AlertTriangle size={15} />}
            <span>
              {item.transit_status === 'en_deposito' && `En depósito · ${currentLocationLabel(item)}`}
              {item.transit_status === 'en_transito' && `En tránsito al depósito · desde ${item.sucursal || '-'}`}
              {!item.transit_status && `Lugar actual: ${currentLocationLabel(item)}`}
              
            </span>
          </div>

          {/* Aviso de traslado / guía de próximo paso */}
          {needsTransport && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-sm text-orange-200">
              <Truck size={15} className="mt-0.5 shrink-0" />
              <span>
                {item.transit_status === 'en_transito'
                  ? `Esperando llegada a Depósito Chiclana${item.remito_interno ? ` · ${item.remito_interno}` : ''}. No corresponde avanzar proveedor hasta confirmar recepción.`
                  : `Esta garantía ingresó en ${item.sucursal || 'sucursal'} y debe ir primero a Depósito Chiclana por remito interno.`}
              </span>
            </div>
          )}
          {item.estado_retiro_proveedor === 'retiro_solicitado' && !logisticsReady && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>URGENTE: el proveedor avisó retiro, pero la garantía todavía no está en Depósito Chiclana. Traerla con prioridad.</span>
            </div>
          )}
          {item.estado_retiro_proveedor === 'listo_para_retiro' && logisticsReady && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-100">
              <PackageCheck size={16} className="mt-0.5 shrink-0" />
              <span>Listo para retiro: la garantía está en depósito y el proveedor puede retirarla.</span>
            </div>
          )}
          {helperText && (
            <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-300">
              <span className="font-black text-slate-100">Próximo paso: </span>{helperText}
            </div>
          )}

          {Number(item.dias_sin_respuesta || 0) >= 7 && !isPendingConfirm && !isClosed && !isResolvedOpen && logisticsReady && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-bold text-amber-100">
              <AlertTriangle size={16} /> Seguimiento requerido
            </div>
          )}
        </div>

        <div className="w-full space-y-3 xl:w-[440px]">
          {/* Confirmar envío: garantía exportada esperando confirmación */}
          {canManageProvider && isPendingConfirm && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-black text-amber-200">
                <PackageCheck size={16} /> Confirmar envío al proveedor
              </div>
              <p className="mb-2 text-xs text-slate-400">
                El lote <span className="font-mono font-bold text-amber-300">{item.shipment_code}</span> fue generado.
                Una vez que enviaste el mail al proveedor, ingresá el código del lote para confirmar. Esto no significa retiro físico.
              </p>
              {item.shipment_file_name && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
                  <ShieldCheck size={14} className="shrink-0 text-slate-400" />
                  <span className="truncate font-mono text-xs text-slate-300">{item.shipment_file_name}</span>
                </div>
              )}
              <input
                value={state.confirm_code}
                onChange={(e) => update({ confirm_code: e.target.value.toUpperCase() })}
                placeholder={`Ingresá ${item.shipment_code}`}
                className={`w-full rounded-xl border px-3 py-2 font-mono text-sm outline-none transition ${
                  state.confirm_code && !codeMatches
                    ? 'border-red-500/60 bg-red-500/10 text-red-200'
                    : codeMatches && state.confirm_code
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-700 bg-slate-950 text-slate-100 focus:border-amber-400'
                }`}
              />
              {state.confirm_code && !codeMatches && (
                <p className="mt-1 text-xs text-red-400">El código no coincide con el lote asignado.</p>
              )}
              <input
                value={state.provider_name}
                onChange={(e) => update({ provider_name: e.target.value })}
                placeholder="Nombre del proveedor (opcional)"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400"
              />
              <button
                disabled={!codeMatches || savingId === `${item.id_garantia}:confirm`}
                onClick={() => run('confirm')}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-black text-white hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={15} />
                {savingId === `${item.id_garantia}:confirm` ? 'Confirmando...' : 'Confirmar envío al proveedor'}
              </button>
            </div>
          )}
          {/* Aprobada en revisión, esperando ser incluida en un lote de exportación */}
          {isApprovedPending && (
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-black text-violet-200">
                <FileCheck2 size={16} /> Revisada — pendiente de exportación
              </div>
              <p className="text-xs text-slate-400">
                Esta garantía fue aprobada en revisión. Para avanzar, incluyela en un lote desde{' '}
                <Link to="/warranties/export" className="font-semibold text-violet-300 hover:underline">Exportación</Link>.
                Una vez asignada al lote aparecerá el código ENV y podrás confirmar el envío al proveedor.
              </p>
            </div>
          )}
          {/* Enviar a proveedor: para garantías ya enviadas anteriormente pero sin seguimiento */}
          {false && canManageProvider && !hasProvider && !isPendingConfirm && item.estado !== '2 - PENDIENTE' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-200"><Send size={16} /> Enviar a proveedor</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={state.provider_name} onChange={(e) => update({ provider_name: e.target.value })} placeholder="Proveedor" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                <input value={state.provider_case_id} onChange={(e) => update({ provider_case_id: e.target.value })} placeholder="ID de caso" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <textarea value={state.status_note} onChange={(e) => update({ status_note: e.target.value })} rows={2} placeholder="Observación interna" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <button disabled={savingId === `${item.id_garantia}:send` || !state.provider_name.trim()} onClick={() => run('send')} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-50"><Send size={16} /> Registrar envío</button>
            </div>
          )}

          {canTrackProvider && (canResponse || canClaim || canStatus) && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-200"><MessageSquareReply size={16} /> Seguimiento</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select value={effectiveStatus} onChange={(e) => update({ status: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400">
                  {statusOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
                <input value={state.provider_case_id} onChange={(e) => update({ provider_case_id: e.target.value })} placeholder="ID de caso" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>

              {/* Fase 12: resolución normalizada. RESUELTO no es FINALIZADO. */}
              {effectiveStatus === '7 - RESUELTO' && (() => {
                const rt = RESOLUTION_TYPES.find((r) => r.value === state.resultado_resolucion);
                return (
                  <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-emerald-300">
                      <FileCheck2 size={13} /> Resolución del proveedor
                    </div>
                    <select
                      value={state.resultado_resolucion}
                      onChange={(e) => update({ resultado_resolucion: e.target.value })}
                      className="mb-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    >
                      <option value="">— Elegí resolución —</option>
                      {RESOLUTION_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    {rt && <p className="mb-3 rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-300">{rt.helper}</p>}
                    {state.resultado_resolucion === 'nota_credito' && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input value={state.numero_nota_credito} onChange={(e) => update({ numero_nota_credito: e.target.value, resolution_reference: e.target.value })} placeholder="N° nota de crédito" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <input value={state.importe_nota_credito} onChange={(e) => update({ importe_nota_credito: e.target.value })} placeholder="Importe NC" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <input type="date" value={state.fecha_nota_credito} onChange={(e) => update({ fecha_nota_credito: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <textarea value={state.resolution_note} onChange={(e) => update({ resolution_note: e.target.value })} rows={2} placeholder="Observación administrativa de la NC" className="sm:col-span-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                      </div>
                    )}
                    {state.resultado_resolucion === 'reparacion' && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input type="date" value={state.fecha_reparacion} onChange={(e) => update({ fecha_reparacion: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <textarea value={state.detalle_reparacion || state.resolution_note} onChange={(e) => update({ detalle_reparacion: e.target.value, resolution_note: e.target.value })} rows={2} placeholder="Detalle de reparación realizada" className="sm:col-span-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                      </div>
                    )}
                    {state.resultado_resolucion === 'cambio_equipo' && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input value={state.producto_reemplazo} onChange={(e) => update({ producto_reemplazo: e.target.value, resolution_note: e.target.value })} placeholder="Producto de reemplazo" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 sm:col-span-2" />
                        <input value={state.sku_reemplazo} onChange={(e) => update({ sku_reemplazo: e.target.value })} placeholder="SKU/modelo reemplazo" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <input value={state.serie_reemplazo} onChange={(e) => update({ serie_reemplazo: e.target.value, resolution_reference: e.target.value })} placeholder="Serie reemplazo" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-xs text-slate-400">Fecha de recepción del reemplazo</span>
                          <input type="date" value={state.fecha_recepcion_reemplazo} onChange={(e) => update({ fecha_recepcion_reemplazo: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Sub-formulario para "8 - RECHAZADO": solo motivo */}
              {effectiveStatus === '8 - RECHAZADO' && (
                <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-red-300">
                    <FileCheck2 size={13} /> Motivo del rechazo
                  </div>
                  <textarea
                    value={state.resolution_note}
                    onChange={(e) => update({ resolution_note: e.target.value })}
                    rows={2}
                    placeholder={REJECT_FIELDS.notePlaceholder}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-400"
                  />
                </div>
              )}

              {/* Si ya tenía datos de resolución guardados, mostrarlos */}
              {!FINAL_STATUSES.includes(state.status) && (item.resolution_note || item.resolution_reference || item.resultado_resolucion) && (
                <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                  <CheckCircle2 size={12} className="mr-1 inline text-emerald-400" />
                  Resolución registrada:{' '}
                  {item.resultado_resolucion && (
                    <span className="font-semibold text-emerald-300">
                      {item.resultado_resolucion_label || RESOLUTION_TYPES.find((r) => r.value === item.resultado_resolucion)?.label || item.resultado_resolucion}
                    </span>
                  )}
                  {' — '}
                  {[
                    item.numero_nota_credito && `NC ${item.numero_nota_credito}`,
                    item.importe_nota_credito,
                    item.detalle_reparacion,
                    item.producto_reemplazo,
                    item.sku_reemplazo,
                    item.serie_reemplazo,
                    item.resolution_reference,
                    item.resolution_note,
                  ].filter(Boolean).join(' — ')}
                </div>
              )}

              <textarea value={state.response_note} onChange={(e) => update({ response_note: e.target.value })} rows={2} placeholder="Respuesta del proveedor / aceptación / observación" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              {canResendMail && (
                <textarea value={state.resend_note} onChange={(e) => update({ resend_note: e.target.value })} rows={2} placeholder="Nota del mail reenviado (opcional). Reinicia días sin respuesta." className="mt-2 w-full rounded-xl border border-blue-500/40 bg-blue-500/5 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              )}
              <textarea value={state.claim_note} onChange={(e) => update({ claim_note: e.target.value })} rows={2} placeholder="Reclamo o seguimiento interno" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {canResponse && canRegisterProviderResponse && <button disabled={savingId === `${item.id_garantia}:response`} onClick={() => run('response', { status: effectiveStatus === item.estado ? '6 - RESPONDIDO POR PROVEEDOR' : effectiveStatus })} className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-50">Respuesta</button>}
                {canResponse && canRegisterPickup && <button disabled={savingId === `${item.id_garantia}:pickup`} onClick={() => run('pickup')} className="rounded-xl border border-red-500/50 px-3 py-2 text-sm font-black text-red-100 hover:bg-red-500/10 disabled:opacity-50">Solicita retiro</button>}
                {canClaim && canResendMail && <button disabled={savingId === `${item.id_garantia}:resend`} onClick={() => run('resend')} className="rounded-xl border border-blue-500/50 px-3 py-2 text-sm font-black text-blue-100 hover:bg-blue-500/10 disabled:opacity-50">Mail reenviado</button>}
                {canClaim && canRegisterClaim && <button disabled={savingId === `${item.id_garantia}:claim` || !state.claim_note.trim()} onClick={() => run('claim')} className="rounded-xl border border-amber-500/50 px-3 py-2 text-sm font-black text-amber-100 hover:bg-amber-500/10 disabled:opacity-50">Reclamo</button>}
                {canStatus && canChangeStage && (() => {
                  const isResuelto = effectiveStatus === '7 - RESUELTO';
                  const isRechazado = effectiveStatus === '8 - RECHAZADO';
                  const isFinal = isResuelto || isRechazado;
                  const isProviderPickup = effectiveStatus === '5 - EN EL PROVEEDOR';
                  const blocked = effectiveStatus === item.estado || (isResuelto && !state.resultado_resolucion) || (isProviderPickup && !logisticsReady) || savingId === `${item.id_garantia}:status`;
                  const label = effectiveStatus === item.estado ? 'Elegí próximo estado' : isProviderPickup ? 'Proveedor retiró' : isResuelto ? 'Marcar resuelto' : isRechazado ? 'Marcar rechazado' : 'Cambiar estado';
                  return (
                    <button
                      disabled={blocked}
                      onClick={() => run('status', { status: effectiveStatus })}
                      className={`rounded-xl px-3 py-2 text-sm font-black disabled:opacity-50 ${isResuelto ? 'bg-emerald-500 text-white hover:bg-emerald-400' : isRechazado ? 'bg-red-500 text-white hover:bg-red-400' : 'border border-slate-600 text-slate-100 hover:bg-slate-800'}`}
                      title={isProviderPickup && !logisticsReady ? 'Primero tiene que llegar a Depósito Chiclana' : isResuelto && !state.resultado_resolucion ? 'Elegí cómo se resolvió antes de marcar' : ''}
                    >
                      {label}
                    </button>
                  );
                })()}
              </div>
            </div>
          )}
          {canStatus && item.estado === '7 - RESUELTO' && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-black text-emerald-200"><CheckCircle2 size={16} /> Resolución cargada</div>
              <p className="mb-2 text-xs text-slate-400">
                La garantía ya está RESUELTA como {item.resultado_resolucion_label || item.resultado_resolucion || 'resolución registrada'}. Finalizala solo cuando la NC, reparación o cambio ya quede cerrado.
              </p>
              <textarea value={state.finalizacion} onChange={(e) => update({ finalizacion: e.target.value })} rows={2} placeholder="Resumen de cierre / qué se entregó o aplicó" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              <button disabled={savingId === `${item.id_garantia}:status`} onClick={() => run('status', { status: '10 - FINALIZADO' })} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-50">
                Finalizar garantía
              </button>
            </div>
          )}
          {isClosed && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-300">
              Caso cerrado. Las acciones de proveedor quedan ocultas para evitar cambios duplicados o fuera de flujo.
            </div>
          )}
          <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-black text-slate-100 hover:bg-slate-900">Ver detalle <ArrowRight size={16} /></Link>
        </div>
      </div>
    </div>
  );
}
