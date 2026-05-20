import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, ClipboardCheck, Copy, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { can, fetchWarranties, fetchWarrantyCounters, fetchWarrantyOptions, getCurrentUserFromStorage, resyncWarrantyCounters } from '../api/client';
import { EmptyState, Notice, PageHeader, Panel, SearchField, SectionHeader, primaryButtonClass, proInputClass, secondaryButtonClass, subtleButtonClass } from '../components/ProUI';
import type { WarrantyCounterInfo, WarrantyListResponse, WarrantyOptions, WarrantySummary } from '../types';
import { CANONICAL_WARRANTY_STATUSES, flowToneClass, getReviewStatusMeta, getWarrantyNextStep, getWarrantyStatusMeta } from '../warrantyFlow';

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => undefined);
}

function optionKey(value: string) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\d+\s*[-.)]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function stripOptionPrefix(value: string) {
  return (value || '').replace(/^\s*\d+\s*[-.)]\s*/g, '').replace(/\s+/g, ' ').trim();
}

function uniqueOptions(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const clean = stripOptionPrefix(String(value || ''));
    const key = optionKey(clean);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function normalizeDepositOption(value: string) {
  const clean = stripOptionPrefix(value);
  const key = optionKey(clean);
  if (!key) return '';
  if (key === 'DEPOSITO CHICLANA' || key === 'CHICLANA') return 'Depósito Chiclana';
  if (key === 'DEPOSITO CORRALES' || key === 'CORRALES') return 'Depósito Corrales';
  if (key === 'DEPOSITO CACHI' || key === 'CACHI') return 'Depósito Cachi';
  return clean;
}


export function WarrantiesListPage() {
  const currentUser = getCurrentUserFromStorage();
  const isBranchOperator = !can('warranties.manage') && !can('warranties.manage_provider') && !['deposit', 'admin'].includes((currentUser?.branch_type || '').toLowerCase());
  const assignedBranch = currentUser?.branch_name || currentUser?.sucursal || '';
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [counters, setCounters] = useState<WarrantyCounterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', sucursal: isBranchOperator ? assignedBranch : '', estado: '', deposito: '', tipo_ingreso: '', fecha_desde: '', fecha_hasta: '' });

  const estados = useMemo(() => {
    // Fase 25: el listado no debe volver a mezclar estados viejos de configuración
    // ni estados legacy que puedan venir en registros antiguos. La UI filtra con
    // el flujo canónico y el backend normaliza aliases al comparar.
    const fromBackend = (options?.estados || []).filter((estado) => CANONICAL_WARRANTY_STATUSES.includes(estado));
    return fromBackend.length ? fromBackend : CANONICAL_WARRANTY_STATUSES;
  }, [options]);

  const sucursalOptions = useMemo(() => {
    const branchNames = (options?.branches_operativas ?? [])
      .filter((b) => b.type === 'physical')
      .map((b) => b.name);
    return uniqueOptions(branchNames.length ? branchNames : (options?.sucursales || []));
  }, [options]);

  const depositoOptions = useMemo(() => {
    const branchNames = (options?.branches_operativas ?? [])
      .filter((b) => b.type === 'deposit')
      .map((b) => normalizeDepositOption(b.name));
    const fallback = (options?.depositos || []).map(normalizeDepositOption);
    return uniqueOptions(branchNames.length ? branchNames : fallback);
  }, [options]);

  const resumen = useMemo(() => {
    const bySucursal: Record<string, number> = {};
    const byDeposito: Record<string, number> = {};
    const byEstado: Record<string, number> = {};
    (data?.items || []).forEach((item) => {
      const suc = item.sucursal || 'SIN SUCURSAL';
      const dep = (item as any).lugar_llegada || item.deposito || 'SIN DEPÓSITO';
      const est = item.estado || 'SIN ESTADO';
      bySucursal[suc] = (bySucursal[suc] || 0) + 1;
      byDeposito[dep] = (byDeposito[dep] || 0) + 1;
      byEstado[est] = (byEstado[est] || 0) + 1;
    });
    const top = (obj: Record<string, number>) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { bySucursal: top(bySucursal), byDeposito: top(byDeposito), byEstado: top(byEstado) };
  }, [data]);

  async function load(extra = filters) {
    setLoading(true);
    setError('');
    try {
      const effectiveFilters = isBranchOperator
        ? { ...extra, sucursal: assignedBranch, estado: '', deposito: '' }
        : extra;
      const [opts, warranties] = await Promise.all([fetchWarrantyOptions(), fetchWarranties({ ...effectiveFilters, limit: 500 })]);
      setOptions(opts);
      setData(warranties);
      if (can('warranties.manage')) {
        fetchWarrantyCounters().then((res) => setCounters(res.counters)).catch(() => setCounters([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las garantías');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    load(isBranchOperator ? { ...filters, sucursal: assignedBranch, estado: '', deposito: '' } : filters);
  }

  async function resyncCounters() {
    setError('');
    try {
      const res = await resyncWarrantyCounters();
      setCounters(res.counters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron resincronizar contadores');
    }
  }

  return (
    <div className="pro-page space-y-6">
      <PageHeader
        eyebrow={<><ShieldCheck size={14} /> Garantías</>}
        title={isBranchOperator ? "Garantías en mi sucursal" : "Gestión de garantías"}
        description={isBranchOperator
          ? "Listado operativo de garantías que todavía están físicamente en tu sucursal. Al despacharse a Chiclana salen de esta vista."
          : "Ingreso, revisión y seguimiento de garantías con trazabilidad interna."}
        actions={<>
          <button onClick={() => load()} className={secondaryButtonClass}><RefreshCw size={18} /> Actualizar</button>
          {can('warranties.manage') && <button onClick={resyncCounters} className={secondaryButtonClass}><RefreshCw size={18} /> Recalcular contadores</button>}
          {can('warranties.gestor.panel') || can('warranties.manage') ? <Link to="/warranties/gestor" className={subtleButtonClass}><Building2 size={18} /> Panel gestor</Link> : null}
          {can('warranties.sucursal.logistics') || can('warranties.remitos.dispatch') ? <Link to="/warranties/sucursal" className={subtleButtonClass}><Building2 size={18} /> Mi sucursal</Link> : null}
          {can('warranties.review') && <Link to="/warranties/revision" className={subtleButtonClass}><ClipboardCheck size={18} /> Revisión</Link>}
          {can('warranties.manage_provider') && <Link to="/warranties/gestion" className={subtleButtonClass}><Building2 size={18} /> Gestión proveedor</Link>}
          {can('warranties.create') && <Link to="/warranties/new" className={primaryButtonClass}><Plus size={18} /> Nueva garantía</Link>}
        </>}
      />

      {error && <Notice tone="error">{error}</Notice>}
      {isBranchOperator && (
        <Notice tone="info">
          Estás viendo solo garantías ubicadas en <strong>{assignedBranch || 'tu sucursal'}</strong>. Cuando se genera/despacha un remito hacia Depósito Chiclana, la garantía deja de aparecer acá y se sigue desde Remitos/Gestión.
        </Notice>
      )}

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ResumenCard title="Por sucursal" items={resumen.bySucursal} />
          <ResumenCard title="Por lugar" items={resumen.byDeposito} />
          <ResumenCard title="Por estado" items={resumen.byEstado} />
        </div>
      )}

      <Panel>
        <SectionHeader
          title="Filtros"
          description={isBranchOperator
            ? "Buscá dentro de las garantías que todavía están físicamente en tu sucursal."
            : "Refiná el listado por búsqueda, sucursal, estado o lugar actual."}
        />
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className={isBranchOperator ? "xl:col-span-3" : "xl:col-span-2"}>
              <SearchField value={filters.q} onChange={(value) => setFilters({ ...filters, q: value })} placeholder="ID, SKU, serie, producto..." />
            </div>
            {isBranchOperator ? (
              <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm">
                <div className="font-black uppercase tracking-wide text-blue-100">Sucursal asignada</div>
                <div className="mt-1 text-slate-200">{assignedBranch || 'Sin sucursal asignada'}</div>
              </div>
            ) : (
              <>
                <Select
                  label="Sucursal"
                  value={filters.sucursal}
                  onChange={(v) => setFilters({ ...filters, sucursal: v })}
                  options={sucursalOptions}
                />
                <Select label="Estado" value={filters.estado} onChange={(v) => setFilters({ ...filters, estado: v })} options={estados} />
                <Select
                  label="Depósito / lugar"
                  value={filters.deposito}
                  onChange={(v) => setFilters({ ...filters, deposito: v })}
                  options={depositoOptions}
                />
              </>
            )}
            <Select
              label="Tipo de ingreso"
              value={filters.tipo_ingreso}
              onChange={(v) => setFilters({ ...filters, tipo_ingreso: v })}
              options={(options?.tipos_ingreso || []).map((t) => t.label)}
              rawOptions={(options?.tipos_ingreso || []).map((t) => ({ value: t.value, label: t.label }))}
            />
            <button className={primaryButtonClass}>Aplicar</button>
          </div>
        </form>
      </Panel>

      {can('warranties.manage') && counters.length > 0 && (
        <Panel compact>
          <SectionHeader title="Contadores" description="Secuencia interna por año y sucursal." />
          <div className="flex flex-wrap gap-2">
            {counters.map((c) => <span key={`${c.year}-${c.sucursal}`} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-bold text-slate-200">{c.year} · {c.sucursal}: {c.last_number}</span>)}
          </div>
        </Panel>
      )}

      <div className="space-y-3">
        {loading && <Panel compact>Cargando garantías...</Panel>}
        {!loading && data?.items.length === 0 && <EmptyState
          title={isBranchOperator ? "No hay garantías en tu sucursal" : "No hay garantías para mostrar"}
          description={isBranchOperator ? "Las garantías despachadas a Chiclana ya no aparecen en este listado. Se siguen desde Remitos o Gestión." : "Ajustá los filtros o cargá una nueva garantía."}
          action={can('warranties.create') ? <Link to="/warranties/new" className={primaryButtonClass}>Nueva garantía</Link> : undefined}
        />}
        {data?.items.map((item) => <WarrantyCard key={item.id_garantia} item={item} />)}
      </div>
    </div>
  );
}

function ResumenCard({ title, items }: { title: string; items: [string, number][] }) {
  return (
    <Panel compact>
      <div className="mb-3 text-sm font-black uppercase tracking-wide text-slate-300">{title}</div>
      {items.length === 0 && <div className="text-sm text-slate-500">Sin datos todavía.</div>}
      <div className="space-y-2">
        {items.map(([name, count]) => (
          <div key={name} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
            <span className="truncate text-slate-200">{name}</span>
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-black text-blue-100">{count}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Select({
  label, value, options, onChange, rawOptions,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  rawOptions?: { value: string; label: string }[];
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={proInputClass}>
        <option value="">Todos</option>
        {rawOptions
          ? rawOptions.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)
          : options.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
    </label>
  );
}

function WarrantyCard({ item }: { item: WarrantySummary }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/65 p-4 shadow-xl transition hover:border-blue-500/40 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="font-mono text-lg font-black text-blue-100 hover:text-blue-300">{item.id_garantia}</Link>
            <button onClick={() => copyText(item.id_garantia)} className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-900" title="Copiar ID"><Copy size={15} /></button>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${flowToneClass(getWarrantyStatusMeta(item.estado).tone)}`}>{getWarrantyStatusMeta(item.estado).shortLabel}</span>
            {item.review_status && (
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${flowToneClass(getReviewStatusMeta(item.review_status).tone)}`}>
                {item.review_status_label || getReviewStatusMeta(item.review_status).label}
              </span>
            )}
            {item.tipo_ingreso_label && (
              <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-200">
                {item.tipo_ingreso_label}
              </span>
            )}
            {item.ubicacion_actual_label && (
              <span className="rounded-full border border-slate-600 bg-slate-800/60 px-3 py-1 text-xs font-semibold text-slate-300">
                📍 {item.ubicacion_actual_label}
              </span>
            )}
          </div>
          <div className="mt-2 text-lg font-bold text-white">{item.producto_principal || 'Sin producto'}</div>
          {item.cantidad_items > 1 && (
            <div className="mt-1 text-sm text-slate-400">{item.cantidad_items} productos bajo el mismo ID</div>
          )}
          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
            <span className="font-black text-slate-100">Próximo paso: </span>{getWarrantyNextStep(item)}
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-slate-500">Ingreso:</span> {item.ingreso || '-'}</div>
            <div><span className="text-slate-500">Responsable:</span> {item.responsable || '-'}</div>
            <div><span className="text-slate-500">Sucursal:</span> {item.sucursal || '-'}</div>
            <div><span className="text-slate-500">Lugar donde llega:</span> {item.lugar_llegada || item.deposito || '-'}</div>
          </div>
        </div>
        <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className={secondaryButtonClass}>
          Ver detalle <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
