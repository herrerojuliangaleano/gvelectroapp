import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronUp, Clock,
  FileCheck2, Filter, History, MessageSquareReply, PackageCheck,
  RefreshCw, Search, Send, ShieldCheck, Truck,
} from 'lucide-react';
import {
  can,
  changeWarrantyStatus,
  confirmWarrantyShipment,
  fetchWarrantyDetail,
  fetchWarrantyManagement,
  fetchWarrantyOptions,
  registerWarrantyClaim,
  resendWarrantyProviderMail,
  registerWarrantyProviderResponse,
  registerWarrantyProviderPickupRequest,
  sendWarrantyToProvider,
} from '../api/client';
import type { AuditEvent, WarrantyListResponse, WarrantyOptions, WarrantySummary } from '../types';
import { CANONICAL_WARRANTY_STATUSES, computeLogisticsAlerts, flowToneClass, getWarrantyNextStep, getWarrantyStatusMeta, historyEventLabel } from '../warrantyFlow';

const PROVIDER_STATUSES = CANONICAL_WARRANTY_STATUSES.filter((status) => status !== '1 - INGRESO');
const FINAL_STATUSES = ['10 - FINALIZADO'];

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

const REJECT_FIELDS = { notePlaceholder: 'Ej. Daño por mal uso del usuario, fuera de garantía por humedad' };

function delayClass(days?: number | null) {
  const d = Number(days || 0);
  if (d >= 15) return 'border-red-500/40 bg-red-500/10 text-red-100';
  if (d >= 7) return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  return 'border-slate-700 bg-slate-900 text-slate-200';
}

// Action pill styles
const ACTION_PILL_ACTIVE: Record<string, string> = {
  green:   'border-emerald-400 bg-emerald-500 text-white',
  red:     'border-red-400 bg-red-500 text-white',
  blue:    'border-blue-400 bg-blue-500 text-white',
  amber:   'border-amber-400 bg-amber-500 text-white',
  slate:   'border-slate-400 bg-slate-600 text-white',
};
const ACTION_PILL_INACTIVE: Record<string, string> = {
  green:   'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10',
  red:     'border-red-500/40 text-red-300 hover:bg-red-500/10',
  blue:    'border-blue-500/40 text-blue-300 hover:bg-blue-500/10',
  amber:   'border-amber-500/40 text-amber-300 hover:bg-amber-500/10',
  slate:   'border-slate-600 text-slate-300 hover:bg-slate-800',
};


export function WarrantyManagementPage() {
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [filters, setFilters] = useState({ q: '', marca: '', proveedor: '', sucursal: '', deposito: '', estado: '', demora_min: '' });
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [savingId, setSavingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'para_enviar' | 'con_proveedor' | 'respondidas' | 'para_cerrar' | 'todos'>('con_proveedor');
  const [showFilters, setShowFilters] = useState(false);

  const stats = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      listoParaEnviar: items.filter((item) => item.estado === '3 - LISTO PARA ENVIAR').length,
      enviadas: items.filter((item) => item.estado === '4 - ENVIADO AL PROVEEDOR').length,
      enProveedor: items.filter((item) => item.estado === '5 - EN EL PROVEEDOR').length,
      demoradas: items.filter((item) => Number(item.dias_sin_respuesta || 0) >= 7).length,
      finalizadas: items.filter((item) => FINAL_STATUSES.includes(item.estado)).length,
      logisticaPendiente: items.filter((item) => computeLogisticsAlerts(item).some((a) => a.priority === 'high')).length,
    };
  }, [data]);

  const estados = useMemo(() => {
    const set = new Set<string>(['3 - LISTO PARA ENVIAR', ...PROVIDER_STATUSES]);
    data?.items.forEach((item) => item.estado && set.add(item.estado));
    return Array.from(set);
  }, [data]);

  // ── Priority tabs ────────────────────────────────────────────────────────
  const tabGroups = useMemo(() => {
    const all = data?.items || [];

    function sortByDelay(list: WarrantySummary[]): WarrantySummary[] {
      return [...list].sort((a, b) => {
        const dA = Number(a.dias_sin_respuesta || 0);
        const dB = Number(b.dias_sin_respuesta || 0);
        if (dB !== dA) return dB - dA;
        return Number(b.dias_pendiente || 0) - Number(a.dias_pendiente || 0);
      });
    }

    const paraEnviar   = all.filter((i) => ['2 - PENDIENTE', '3 - LISTO PARA ENVIAR'].includes(i.estado || ''));
    const conProveedor = all.filter((i) => ['4 - ENVIADO AL PROVEEDOR', '5 - EN EL PROVEEDOR'].includes(i.estado || ''));
    const respondidas  = all.filter((i) => i.estado === '6 - RESPONDIDO POR PROVEEDOR');
    const paraCerrar   = all.filter((i) => i.estado === '7 - RESUELTO');

    return {
      para_enviar:   { label: 'Para enviar',    items: sortByDelay(paraEnviar),   urgent: paraEnviar.filter((i)   => Number(i.dias_pendiente || 0) >= 7).length },
      con_proveedor: { label: 'Con proveedor',  items: sortByDelay(conProveedor), urgent: conProveedor.filter((i) => Number(i.dias_sin_respuesta || 0) >= 7).length },
      respondidas:   { label: 'Respondidas',    items: sortByDelay(respondidas),  urgent: respondidas.filter((i)  => Number(i.dias_sin_respuesta || 0) >= 7).length },
      para_cerrar:   { label: 'Para cerrar',    items: sortByDelay(paraCerrar),   urgent: 0 },
      todos:         { label: 'Todos',          items: all,                       urgent: all.filter((i)          => Number(i.dias_sin_respuesta || 0) >= 7).length },
    } as const;
  }, [data]);

  const activeItems = tabGroups[activeTab].items;

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
        setMessage('Retiro solicitado por proveedor registrado.');
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

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-100">
            <Building2 size={14} /> Gestión con proveedor
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Garantías en gestión</h1>
          <p className="mt-2 text-slate-400">Seguimiento operativo por marca, proveedor y demora.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 font-bold transition-all ${
              showFilters
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                : 'border-slate-700 text-slate-300 hover:bg-slate-900'
            }`}
          >
            <Filter size={16} /> Filtros
            {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={() => load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 font-bold text-slate-100 hover:bg-slate-900">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
      {message && <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Kpi title="Total" value={stats.total} />
        <Kpi title="Listo p/ enviar" value={stats.listoParaEnviar} tone="warn" />
        <Kpi title="Enviadas" value={stats.enviadas} />
        <Kpi title="En proveedor" value={stats.enProveedor} />
        <Kpi title="Demoradas +7" value={stats.demoradas} tone="warn" />
        <Kpi title="Log. urgente" value={stats.logisticaPendiente} tone={stats.logisticaPendiente > 0 ? 'danger' : 'base'} />
        <Kpi title="Finalizadas" value={stats.finalizadas} tone="ok" />
      </div>

      {/* ── Priority tabs ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(tabGroups) as [typeof activeTab, typeof tabGroups[typeof activeTab]][]).map(([id, group]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all ${
              activeTab === id
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                : 'border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            {group.label}
            <span className={`rounded-full border px-1.5 py-0.5 text-xs font-black ${
              activeTab === id ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}>{group.items.length}</span>
            {group.urgent > 0 && (
              <span className="rounded-full border border-red-500/50 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-black text-red-300">
                {group.urgent} demor.
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Collapsible filter form ────────────────────────────────────────── */}
      {showFilters && (
        <form onSubmit={submit} className="rounded-3xl border border-blue-500/25 bg-slate-950/60 p-4 shadow-xl sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300"><Filter size={16} /> Filtros avanzados</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
            <label className="xl:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Buscar</span>
              <div className="relative">
                <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
                <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="ID, SKU, serie, producto..." className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-4 outline-none focus:border-blue-400" />
              </div>
            </label>
            <FText label="Marca" value={filters.marca} onChange={(v) => setFilters({ ...filters, marca: v })} placeholder="Ej. Samsung" />
            <FText label="Proveedor" value={filters.proveedor} onChange={(v) => setFilters({ ...filters, proveedor: v })} placeholder="Proveedor" />
            <FSelect label="Sucursal" value={filters.sucursal} onChange={(v) => setFilters({ ...filters, sucursal: v })} options={options?.sucursales || []} />
            <FSelect label="Estado" value={filters.estado} onChange={(v) => setFilters({ ...filters, estado: v })} options={estados} />
            <FSelect label="Demora" value={filters.demora_min} onChange={(v) => setFilters({ ...filters, demora_min: v })} options={[['7', '+7 días'], ['15', '+15 días'], ['30', '+30 días']]} />
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400">Aplicar filtros</button>
            <button
              type="button"
              onClick={() => { setFilters({ q: '', marca: '', proveedor: '', sucursal: '', deposito: '', estado: '', demora_min: '' }); load({ q: '', marca: '', proveedor: '', sucursal: '', deposito: '', estado: '', demora_min: '' }); }}
              className="rounded-xl border border-slate-700 px-4 py-3 font-bold text-slate-300 hover:bg-slate-900"
            >
              Limpiar
            </button>
          </div>
        </form>
      )}

      {/* ── Tab context label ──────────────────────────────────────────────── */}
      {!loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="font-bold text-slate-400">{tabGroups[activeTab].label}:</span>
          <span>{activeItems.length} garantía{activeItems.length !== 1 ? 's' : ''}</span>
          {tabGroups[activeTab].urgent > 0 && (
            <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-300">
              {tabGroups[activeTab].urgent} con demora
            </span>
          )}
        </div>
      )}

      {loading && <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">Cargando garantías...</div>}
      {!loading && activeItems.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-8 text-center text-slate-400">
          {activeTab === 'todos'
            ? 'No hay garantías con esos filtros.'
            : `No hay garantías en la bandeja "${tabGroups[activeTab].label}".`}
        </div>
      )}

      <div className="space-y-4">
        {activeItems.map((item) => (
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

function Kpi({ title, value, tone = 'base' }: { title: string; value: number; tone?: 'base' | 'warn' | 'danger' | 'ok' }) {
  const cls =
    tone === 'danger' ? 'border-red-500/40 bg-red-500/10' :
    tone === 'warn'   ? 'border-amber-500/30 bg-amber-500/10' :
    tone === 'ok'     ? 'border-emerald-500/30 bg-emerald-500/10' :
    'border-slate-700 bg-slate-950/50';
  const txtCls =
    tone === 'danger' ? 'text-red-300' :
    tone === 'warn'   ? 'text-amber-300' :
    tone === 'ok'     ? 'text-emerald-300' : 'text-white';
  return (
    <div className={`rounded-3xl border p-4 ${cls}`}>
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`mt-1 text-3xl font-black ${txtCls}`}>{value}</div>
    </div>
  );
}

function FText({ label, value, onChange, placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" />
    </label>
  );
}

function FSelect({ label, value, options, onChange }: { label: string; value: string; options: string[] | [string, string][]; onChange: (v: string) => void }) {
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

// ── Small helpers ────────────────────────────────────────────────────────────

function MetaItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <span className="text-sm text-slate-300">
      <span className="mr-1 text-slate-500">{label}:</span>
      {value || '—'}
    </span>
  );
}

// Strip remito codes from messages shown in management (no one sees them here)
const REMITO_CODE_RE = /\b(?:[A-Z]{2,6}-R-\d{4}-\d{4}|RP-\d{4}-\d{4})\b/g;
function sanitizeRemitoMessage(msg: string | undefined | null): string | null {
  if (!msg) return null;
  return msg.replace(REMITO_CODE_RE, '').replace(/\s{2,}/g, ' ').replace(/·\s*$/, '').trim() || null;
}

function HistoryRow({ event }: { event: AuditEvent }) {
  const label = historyEventLabel(event.event_type);
  const newStatus = event.event_type === 'status_change'
    ? ((event.details?.new_status as string) || event.status || '')
    : '';
  const displayMessage = sanitizeRemitoMessage(event.message);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-200">{label}</span>
          {newStatus && (
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-black ${flowToneClass(getWarrantyStatusMeta(newStatus).tone)}`}>
              {getWarrantyStatusMeta(newStatus).shortLabel}
            </span>
          )}
        </div>
        {displayMessage && <div className="mt-0.5 text-slate-400">{displayMessage}</div>}
        <div className="mt-1 text-slate-500">
          {event.created_at}
          {(event.actor_display_name || event.actor_username) && ` — ${event.actor_display_name || event.actor_username}`}
        </div>
      </div>
    </div>
  );
}

// ── Constants shared by ManagementCard ──────────────────────────────────────

const CLOSED_PROVIDER_STATUSES = ['8 - RECHAZADO', '9 - ANULADA', '10 - FINALIZADO'];

function normLocation(value?: string | null) {
  return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

function isDepositLocation(value?: string | null) {
  const key = normLocation(value);
  return key === 'DEPOSITO' || key.startsWith('DEPOSITO ');
}

function currentLocationLabel(item: WarrantySummary) {
  if (item.transit_status === 'en_transito') {
    return 'En tránsito a Depósito Chiclana';
  }
  // When the product is physically at the provider, append the provider name
  if (item.ubicacion_actual === 'proveedor' && item.provider_name) {
    return `En el proveedor — ${item.provider_name}`;
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

// ── ManagementCard ───────────────────────────────────────────────────────────

function ManagementCard({
  item, state, savingId, update, run,
}: {
  item: WarrantySummary;
  state: ActionState;
  savingId: string;
  update: (patch: Partial<ActionState>) => void;
  run: (type: 'send' | 'response' | 'claim' | 'resend' | 'status' | 'confirm' | 'pickup', override?: Partial<ActionState>) => void;
}) {
  // ── Phase 2: dynamic action forms ──────────────────────────────────
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // ── Phase 3: collapsible history ───────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AuditEvent[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Computed flags ─────────────────────────────────────────────────
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
  const codeMatches = state.confirm_code.trim().toUpperCase() === (item.shipment_code || '').toUpperCase();
  const helperText = getWarrantyNextStep(item);
  const statusMeta = getWarrantyStatusMeta(item.estado);
  const dias = Number(item.dias_sin_respuesta || 0);

  // Only show delay warning if the provider has NOT already responded (estado 6 = responded)
  const showDelayAlert = dias >= 7
    && !isPendingConfirm
    && !isClosed
    && !isResolvedOpen
    && logisticsReady
    && item.estado !== '6 - RESPONDIDO POR PROVEEDOR';

  // ── Available action tabs ──────────────────────────────────────────
  const actionItems: { id: string; label: string; tone: string }[] = [];
  if (!isPendingConfirm && !isApprovedPending && !isClosed && !isResolvedOpen) {
    if (canResponse && canRegisterProviderResponse)
      actionItems.push({ id: 'response', label: 'Respuesta proveedor', tone: 'green' });
    if (canResponse && canRegisterPickup)
      actionItems.push({ id: 'pickup', label: 'Solicitar retiro', tone: 'red' });
    if (canClaim && canResendMail)
      actionItems.push({ id: 'resend', label: 'Mail reenviado', tone: 'blue' });
    if (canClaim && canRegisterClaim)
      actionItems.push({ id: 'claim', label: 'Reclamo', tone: 'amber' });
    if (canStatus && canChangeStage)
      actionItems.push({ id: 'status', label: 'Cambiar estado', tone: 'slate' });
  }

  function toggleAction(id: string) {
    setActiveAction((prev) => (prev === id ? null : id));
  }

  async function handleHistoryToggle() {
    if (showHistory) { setShowHistory(false); return; }
    if (history) { setShowHistory(true); return; }
    setLoadingHistory(true);
    try {
      const detail = await fetchWarrantyDetail(item.id_garantia);
      setHistory(detail.history || []);
      setShowHistory(true);
    } catch {
      setHistory([]);
      setShowHistory(true);
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <div className={`rounded-3xl border p-4 shadow-xl sm:p-5 ${
      isClosed
        ? 'border-slate-700/50 bg-slate-950/40'
        : isApprovedPending
        ? 'border-violet-500/30 bg-violet-950/20'
        : 'border-slate-700 bg-slate-950/60'
    }`}>
      {/* ── 1. Header row ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
            className="font-mono text-xl font-black text-white hover:text-blue-200"
          >
            {item.id_garantia}
          </Link>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${flowToneClass(statusMeta.tone)}`}>
            {statusMeta.shortLabel}
          </span>
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
              <Truck size={12} className="mr-1 inline" />En tránsito
            </span>
          )}
          {item.transit_status === 'en_deposito' && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-200">
              <CheckCircle2 size={12} className="mr-1 inline" />En depósito
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
        </div>
        {/* Delay badge — always visible on the right */}
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${delayClass(item.dias_sin_respuesta)}`}>
          <Clock size={12} className="mr-1 inline" />
          {item.dias_sin_respuesta ?? '-'} días sin resp.
        </span>
      </div>

      {/* ── 2. Two-column body ──────────────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start">

        {/* ── LEFT: Product info, location, alerts, next-step ───────── */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Product name */}
          <div className="text-lg font-bold text-slate-100">{item.producto_principal || 'Sin producto'}</div>

          {/* Meta grid */}
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            <MetaItem label="SKU" value={item.sku} />
            <MetaItem label="Serie" value={item.serie} />
            <MetaItem label="Marca" value={item.marca} />
            <MetaItem label="Sucursal" value={item.sucursal} />
            {item.provider_name && <MetaItem label="Proveedor" value={item.provider_name} />}
            {item.id_de_caso && <MetaItem label="ID caso" value={item.id_de_caso} />}
            {item.fecha_envio_proveedor && <MetaItem label="Envío" value={item.fecha_envio_proveedor} />}
            {item.fecha_ultima_respuesta && <MetaItem label="Respuesta" value={item.fecha_ultima_respuesta} />}
            {item.fecha_ultimo_reclamo && <MetaItem label="Reclamo" value={item.fecha_ultimo_reclamo} />}
          </div>


          {/* Location bar */}
          {(() => {
            const atProvider   = item.ubicacion_actual === 'proveedor';
            const toProvider   = item.ubicacion_actual === 'en_transito_proveedor';
            const inTransit    = item.transit_status === 'en_transito';
            const inDeposit    = item.transit_status === 'en_deposito';
            const cls = inDeposit
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
              : inTransit
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : atProvider
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-100'
              : logisticsBlocked
              ? 'border-orange-500/40 bg-orange-500/10 text-orange-100'
              : 'border-slate-700 bg-slate-900 text-slate-200';
            const Icon = inDeposit ? CheckCircle2 : (inTransit || atProvider) ? Truck : atProvider ? PackageCheck : AlertTriangle;
            const text = inDeposit
              ? `En depósito · ${currentLocationLabel(item)}`
              : toProvider
              ? `En tránsito al proveedor${item.provider_name ? ` — ${item.provider_name}` : ''}`
              : inTransit
              ? `En tránsito al depósito · desde ${item.sucursal || '-'}`
              : `Lugar actual: ${currentLocationLabel(item)}`;
            return (
              <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${cls}`}>
                <Icon size={15} />
                <span>{text}</span>
              </div>
            );
          })()}

          {/* Transport blocked alert */}
          {logisticsBlocked && (
            <div className="flex items-start gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-sm text-orange-200">
              <Truck size={15} className="mt-0.5 shrink-0" />
              <span>
                {item.transit_status === 'en_transito'
                  ? 'Esperando llegada a Depósito Chiclana. No corresponde avanzar proveedor hasta confirmar recepción.'
                  : `Esta garantía ingresó en ${item.sucursal || 'sucursal'} y debe ir primero a Depósito Chiclana por remito interno.`}
              </span>
            </div>
          )}

          {/* Pickup urgency — only show before product is at provider */}
          {item.estado_retiro_proveedor === 'retiro_solicitado'
            && !logisticsReady
            && ['3 - LISTO PARA ENVIAR', '4 - ENVIADO AL PROVEEDOR'].includes(item.estado) && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>URGENTE: el proveedor avisó retiro, pero la garantía todavía no está en Depósito Chiclana. Traerla con prioridad.</span>
            </div>
          )}

          {/* Ready for pickup */}
          {item.estado_retiro_proveedor === 'listo_para_retiro' && logisticsReady && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-100">
              <PackageCheck size={16} className="mt-0.5 shrink-0" />
              <span>Listo para retiro: la garantía está en depósito y el proveedor puede retirarla.</span>
            </div>
          )}

          {/* Next-step block — prominent, color-coded by status tone */}
          {helperText && !isClosed && (
            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${flowToneClass(statusMeta.tone)}`}>
              <ArrowRight size={15} className="mt-0.5 shrink-0" />
              <div>
                <span className="mb-0.5 block text-xs font-black uppercase tracking-wide opacity-70">Próximo paso</span>
                {helperText}
              </div>
            </div>
          )}
          {isClosed && helperText && (
            <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-400">
              {helperText}
            </div>
          )}

          {/* Logistics context (read-only) — visible to Posventa as context */}
          {(() => {
            const logAlerts = computeLogisticsAlerts(item).filter((a) => a.targetRole !== 'gestor' || a.type === 'pickup_needed');
            if (logAlerts.length === 0) return null;
            return (
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                <div className="mb-1.5 font-bold uppercase tracking-wide text-slate-500">Estado logístico</div>
                <div className="space-y-1">
                  {logAlerts.map((alert, idx) => (
                    <div key={idx} className={`flex items-center gap-1.5 ${alert.priority === 'high' ? 'text-red-300' : 'text-amber-300'}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${alert.priority === 'high' ? 'bg-red-400' : 'bg-amber-400'}`} />
                      {alert.message}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Delay alert — only when meaningful */}
          {showDelayAlert && (
            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${dias >= 15 ? 'border-red-500/40 bg-red-500/10 text-red-100' : 'border-amber-500/30 bg-amber-500/10 text-amber-100'}`}>
              <AlertTriangle size={16} />
              {dias >= 15 ? `Demorada: ${dias} días sin respuesta` : `Seguimiento requerido — ${dias} días`}
            </div>
          )}
        </div>

        {/* ── RIGHT: Action panel ────────────────────────────────────── */}
        <div className="w-full space-y-3 xl:w-[440px]">

          {/* Confirm shipment panel */}
          {canManageProvider && isPendingConfirm && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-black text-amber-200">
                <PackageCheck size={16} /> Confirmar envío al proveedor
              </div>
              <p className="mb-2 text-xs text-slate-400">
                El lote <span className="font-mono font-bold text-amber-300">{item.shipment_code}</span> fue generado.
                Una vez enviado el mail, ingresá el código para confirmar.
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

          {/* Approved pending — redirect to export */}
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

          {/* ── Action tab buttons (Phase 2) ──────────────────────── */}
          {actionItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {actionItems.map((a) => (
                <button
                  key={a.id}
                  onClick={() => toggleAction(a.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-black transition ${
                    activeAction === a.id
                      ? (ACTION_PILL_ACTIVE[a.tone] || 'border-blue-400 bg-blue-500 text-white')
                      : (ACTION_PILL_INACTIVE[a.tone] || 'border-slate-600 text-slate-300 hover:bg-slate-800')
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* ── Active action forms ────────────────────────────────── */}

          {/* RESPONSE form */}
          {activeAction === 'response' && canResponse && canRegisterProviderResponse && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-emerald-200">
                <MessageSquareReply size={16} /> Registrar respuesta del proveedor
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={effectiveStatus}
                  onChange={(e) => update({ status: e.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                >
                  {statusOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
                <input
                  value={state.provider_case_id}
                  onChange={(e) => update({ provider_case_id: e.target.value })}
                  placeholder="ID de caso (opcional)"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                />
              </div>
              <textarea
                value={state.response_note}
                onChange={(e) => update({ response_note: e.target.value })}
                rows={2}
                placeholder="Descripción de la respuesta / aceptación del proveedor"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
              <button
                disabled={savingId === `${item.id_garantia}:response`}
                onClick={() => run('response', { status: effectiveStatus === item.estado ? '6 - RESPONDIDO POR PROVEEDOR' : effectiveStatus })}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-50"
              >
                {savingId === `${item.id_garantia}:response` ? 'Registrando...' : 'Registrar respuesta'}
              </button>
            </div>
          )}

          {/* PICKUP form */}
          {activeAction === 'pickup' && canResponse && canRegisterPickup && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-red-200">
                <Truck size={16} /> Solicitar retiro del proveedor
              </div>
              <input
                value={state.provider_case_id}
                onChange={(e) => update({ provider_case_id: e.target.value })}
                placeholder="ID de caso (opcional)"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-400"
              />
              <textarea
                value={state.response_note}
                onChange={(e) => update({ response_note: e.target.value })}
                rows={2}
                placeholder="Observación (ej: el proveedor avisa que retira el martes)"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-400"
              />
              {!logisticsReady && (
                <p className="mt-2 rounded-xl bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  ⚠ La garantía todavía no está en Depósito Chiclana. Registralo igual para marcarla como urgente.
                </p>
              )}
              <button
                disabled={savingId === `${item.id_garantia}:pickup`}
                onClick={() => run('pickup')}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-2 text-sm font-black text-white hover:bg-red-400 disabled:opacity-50"
              >
                {savingId === `${item.id_garantia}:pickup` ? 'Registrando...' : 'Registrar solicitud de retiro'}
              </button>
            </div>
          )}

          {/* RESEND MAIL form */}
          {activeAction === 'resend' && canClaim && canResendMail && (
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-blue-200">
                <Send size={16} /> Confirmar mail reenviado
              </div>
              <textarea
                value={state.resend_note}
                onChange={(e) => update({ resend_note: e.target.value })}
                rows={2}
                placeholder="Nota del mail reenviado (opcional). Reinicia el contador de días sin respuesta."
                className="w-full rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
              <button
                disabled={savingId === `${item.id_garantia}:resend`}
                onClick={() => run('resend')}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-50"
              >
                {savingId === `${item.id_garantia}:resend` ? 'Registrando...' : 'Confirmar reenvío de mail'}
              </button>
            </div>
          )}

          {/* CLAIM form */}
          {activeAction === 'claim' && canClaim && canRegisterClaim && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-amber-200">
                <AlertTriangle size={16} /> Registrar reclamo / seguimiento
              </div>
              <textarea
                value={state.claim_note}
                onChange={(e) => update({ claim_note: e.target.value })}
                rows={2}
                placeholder="Descripción del reclamo o nota de seguimiento interno"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
              <button
                disabled={savingId === `${item.id_garantia}:claim` || !state.claim_note.trim()}
                onClick={() => run('claim')}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-black text-white hover:bg-amber-400 disabled:opacity-50"
              >
                {savingId === `${item.id_garantia}:claim` ? 'Registrando...' : 'Registrar reclamo'}
              </button>
            </div>
          )}

          {/* STATUS CHANGE form */}
          {activeAction === 'status' && canStatus && canChangeStage && !isResolvedOpen && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-200">
                <ArrowRight size={16} /> Cambiar estado
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={effectiveStatus}
                  onChange={(e) => update({ status: e.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400"
                >
                  {statusOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
                <input
                  value={state.provider_case_id}
                  onChange={(e) => update({ provider_case_id: e.target.value })}
                  placeholder="ID de caso"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
              </div>

              {/* Resolution sub-form for estado 7 */}
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
                        <textarea value={state.resolution_note} onChange={(e) => update({ resolution_note: e.target.value })} rows={2} placeholder="Observación de la NC" className="sm:col-span-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                      </div>
                    )}
                    {state.resultado_resolucion === 'reparacion' && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input type="date" value={state.fecha_reparacion} onChange={(e) => update({ fecha_reparacion: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                        <textarea value={state.detalle_reparacion || state.resolution_note} onChange={(e) => update({ detalle_reparacion: e.target.value, resolution_note: e.target.value })} rows={2} placeholder="Detalle de reparación" className="sm:col-span-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
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

              {/* Rejection reason */}
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

              {/* Existing resolution data display */}
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

              <textarea
                value={state.status_note}
                onChange={(e) => update({ status_note: e.target.value })}
                rows={2}
                placeholder="Observación interna (opcional)"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
              {(() => {
                const isResuelto = effectiveStatus === '7 - RESUELTO';
                const isRechazado = effectiveStatus === '8 - RECHAZADO';
                const isProviderPickup = effectiveStatus === '5 - EN EL PROVEEDOR';
                const blocked = effectiveStatus === item.estado
                  || (isResuelto && !state.resultado_resolucion)
                  || (isProviderPickup && !logisticsReady)
                  || savingId === `${item.id_garantia}:status`;
                const label = effectiveStatus === item.estado
                  ? 'Elegí próximo estado'
                  : isProviderPickup
                  ? 'Proveedor retiró'
                  : isResuelto
                  ? 'Marcar resuelto'
                  : isRechazado
                  ? 'Marcar rechazado'
                  : 'Cambiar estado';
                return (
                  <button
                    disabled={blocked}
                    onClick={() => run('status', { status: effectiveStatus })}
                    title={
                      isProviderPickup && !logisticsReady
                        ? 'Primero tiene que llegar a Depósito Chiclana'
                        : isResuelto && !state.resultado_resolucion
                        ? 'Elegí cómo se resolvió antes de marcar'
                        : ''
                    }
                    className={`mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black disabled:opacity-50 ${
                      isResuelto
                        ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                        : isRechazado
                        ? 'bg-red-500 text-white hover:bg-red-400'
                        : 'border border-slate-600 text-slate-100 hover:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                );
              })()}
            </div>
          )}

          {/* FINALIZE panel — always shown for estado 7 (RESUELTO) */}
          {canStatus && isResolvedOpen && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-black text-emerald-200">
                <CheckCircle2 size={16} /> Resolución cargada — pendiente de cierre
              </div>
              <p className="mb-2 text-xs text-slate-400">
                Garantía RESUELTA como{' '}
                <span className="font-semibold text-emerald-300">
                  {item.resultado_resolucion_label || item.resultado_resolucion || 'resolución registrada'}
                </span>.
                Finalizá solo cuando la NC, reparación o cambio quede efectivamente cerrado.
              </p>
              <textarea
                value={state.finalizacion}
                onChange={(e) => update({ finalizacion: e.target.value })}
                rows={2}
                placeholder="Resumen de cierre / qué se entregó o aplicó"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
              <button
                disabled={savingId === `${item.id_garantia}:status`}
                onClick={() => run('status', { status: '10 - FINALIZADO' })}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-white hover:bg-emerald-400 disabled:opacity-50"
              >
                Finalizar garantía
              </button>
            </div>
          )}

          {/* Closed state info */}
          {isClosed && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-400">
              Caso cerrado. Las acciones operativas quedan ocultas.
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar: Ver detalle + Historial ───────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <Link
          to={`/warranties/${encodeURIComponent(item.id_garantia)}`}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-black text-slate-100 hover:bg-slate-900"
        >
          Ver detalle completo <ArrowRight size={16} />
        </Link>
        <button
          onClick={handleHistoryToggle}
          disabled={loadingHistory}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-900 disabled:opacity-50"
        >
          <History size={15} />
          {loadingHistory ? 'Cargando...' : showHistory ? 'Ocultar historial' : 'Ver historial'}
        </button>
      </div>

      {/* ── Phase 3: Timeline / History ───────────────────────────────────── */}
      {showHistory && history && (
        <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
            Historial de eventos ({history.length})
          </div>
          {history.length === 0 && (
            <p className="text-sm text-slate-400">No hay eventos registrados para esta garantía.</p>
          )}
          {history.map((event) => (
            <HistoryRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
