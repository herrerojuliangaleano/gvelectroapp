import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Clock, Filter, RefreshCw, Search, ShieldCheck, TrendingUp, XCircle } from 'lucide-react';
import { fetchWarrantyDashboard, fetchWarrantyDiagnostics, fetchWarrantyOptions } from '../api/client';
import type { WarrantyDashboardPoint, WarrantyDashboardResponse, WarrantyDiagnosticsResponse, WarrantyOptions } from '../types';

const STATUS_OPTIONS = [
  '1 - INGRESO',
  '2 - PENDIENTE',
  '3 - LISTO PARA ENVIAR',
  '4 - ENVIADO AL PROVEEDOR',
  '5 - EN EL PROVEEDOR',
  '6 - RESPONDIDO POR PROVEEDOR',
  '7 - RESUELTO',
  '8 - RECHAZADO',
  '9 - ANULADA',
  '10 - FINALIZADO',
];

type Filters = {
  fecha_desde: string;
  fecha_hasta: string;
  marca: string;
  proveedor: string;
  sucursal: string;
  deposito: string;
  estado: string;
};

const INITIAL_FILTERS: Filters = {
  fecha_desde: '',
  fecha_hasta: '',
  marca: '',
  proveedor: '',
  sucursal: '',
  deposito: '',
  estado: '',
};

function fmtNumber(value: number | undefined | null) {
  return Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
}

function maxValue(points: WarrantyDashboardPoint[]) {
  return Math.max(1, ...points.map((point) => Number(point.value || 0)));
}

export function WarrantyDashboardPage() {
  const [data, setData] = useState<WarrantyDashboardResponse | null>(null);
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [diagnostics, setDiagnostics] = useState<WarrantyDiagnosticsResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(extra = filters) {
    setLoading(true);
    setError('');
    try {
      const dashboard = await fetchWarrantyDashboard(extra);
      setData(dashboard);

      // Opciones y diagnóstico son complementarios. Si alguno falla, el panel principal
      // igual debe quedar disponible.
      const [optsResult, diagnosticsResult] = await Promise.allSettled([fetchWarrantyOptions(), fetchWarrantyDiagnostics()]);
      if (optsResult.status === 'fulfilled') setOptions(optsResult.value);
      if (diagnosticsResult.status === 'fulfilled') setDiagnostics(diagnosticsResult.value);
      if (optsResult.status === 'rejected' || diagnosticsResult.status === 'rejected') {
        setError('El panel cargó, pero hay información auxiliar que no se pudo actualizar. Revisá Configuración operativa si el problema continúa.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el panel de garantías');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    load(filters);
  }

  const metrics = data?.metrics;
  const hasFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-100">
            <BarChart3 size={14} /> Dashboard de garantías
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Panel de garantías</h1>
          <p className="mt-2 text-slate-400">Indicadores, evolución y seguimiento operativo.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/warranties/gestion" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900">
            <ShieldCheck size={18} /> Gestión
          </Link>
          <button onClick={() => load()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-black text-white hover:bg-blue-400">
            <RefreshCw size={18} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}

      <form onSubmit={submit} className="rounded-3xl border border-slate-700 bg-slate-950/60 p-4 shadow-xl sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300"><Filter size={16} /> Filtros</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          <DateInput label="Desde" value={filters.fecha_desde} onChange={(value) => setFilters({ ...filters, fecha_desde: value })} />
          <DateInput label="Hasta" value={filters.fecha_hasta} onChange={(value) => setFilters({ ...filters, fecha_hasta: value })} />
          <TextInput label="Marca" value={filters.marca} onChange={(value) => setFilters({ ...filters, marca: value })} placeholder="Ej. Samsung" />
          <TextInput label="Proveedor" value={filters.proveedor} onChange={(value) => setFilters({ ...filters, proveedor: value })} placeholder="Proveedor" />
          <SelectInput label="Sucursal" value={filters.sucursal} onChange={(value) => setFilters({ ...filters, sucursal: value })} options={options?.sucursales || []} />
          <SelectInput label="Depósito" value={filters.deposito} onChange={(value) => setFilters({ ...filters, deposito: value })} options={options?.depositos || []} />
          <SelectInput label="Estado" value={filters.estado} onChange={(value) => setFilters({ ...filters, estado: value })} options={STATUS_OPTIONS} />
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button className="rounded-xl bg-blue-500 px-5 py-3 font-black text-white hover:bg-blue-400">Aplicar filtros</button>
          {hasFilters && <button type="button" onClick={() => { setFilters(INITIAL_FILTERS); load(INITIAL_FILTERS); }} className="rounded-xl border border-slate-600 px-5 py-3 font-bold text-slate-100 hover:bg-slate-900">Limpiar</button>}
        </div>
      </form>

      {loading && <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-slate-300">Cargando indicadores...</div>}

      {!loading && data && (
        <>

          {diagnostics && <DiagnosticsPanel diagnostics={diagnostics} />}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi title="Total" value={metrics?.total || 0} />
            <Kpi title="Ingreso" value={metrics?.ingreso || 0} />
            <Kpi title="Pendientes de revisión" value={metrics?.pendientes_revision || 0} tone="warn" />
            <Kpi title="Listas para proveedor" value={metrics?.pendientes_proveedor || 0} />
            <Kpi title="Enviadas al proveedor" value={metrics?.enviadas_proveedor || 0} />
            <Kpi title="En revisión" value={metrics?.en_revision || 0} />
            <Kpi title="Finalizadas" value={metrics?.resueltas || 0} tone="ok" />
            <Kpi title="Rechazadas" value={metrics?.rechazadas || 0} tone="bad" />
            <Kpi title="Demoradas +7" value={metrics?.demoradas_7 || 0} tone="warn" />
            <Kpi title="Demoradas +15" value={metrics?.demoradas_15 || 0} tone="bad" />
            <Kpi title="Prom. días pendientes" value={metrics?.promedio_dias_pendiente || 0} suffix="d" />
            <Kpi title="Prom. sin respuesta" value={metrics?.promedio_dias_sin_respuesta || 0} suffix="d" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Garantías por estado" icon={<ShieldCheck size={18} />} points={data.by_status} />
            <ChartCard title="Garantías por marca" icon={<BarChart3 size={18} />} points={data.by_brand} />
            <ChartCard title="Garantías por proveedor" icon={<BuildingIcon />} points={data.by_provider} />
            <ChartCard title="Garantías por sucursal" icon={<ShieldCheck size={18} />} points={data.by_branch} />
            <ChartCard title="Garantías por depósito" icon={<ShieldCheck size={18} />} points={data.by_deposit} />
            <ChartCard title="Demora por rango" icon={<Clock size={18} />} points={data.by_delay_range} />
            <ChartCard title="Ingresos mensuales" icon={<CalendarDays size={18} />} points={data.monthly_entries} />
            <ChartCard title="Resolución promedio por proveedor" icon={<TrendingUp size={18} />} points={data.avg_resolution_by_provider} suffix=" días" />
            <ChartCard title="Resoluciones finales" icon={<ShieldCheck size={18} />} points={data.final_resolutions} />
          </div>

          <section className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
            <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300"><AlertTriangle size={16} /> Garantías críticas</div>
            {data.critical.length === 0 && <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-slate-400">Sin garantías críticas con los filtros actuales.</div>}
            <div className="space-y-3">
              {data.critical.map((item) => (
                <Link key={item.id_garantia} to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="grid gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-50 transition hover:bg-amber-500/15 lg:grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.8fr]">
                  <div><div className="text-xs font-black uppercase text-amber-200/70">Garantía</div><div className="font-black">{item.id_garantia}</div><div className="text-sm text-amber-100/80">{item.producto_principal}</div></div>
                  <div><div className="text-xs font-black uppercase text-amber-200/70">Marca / proveedor</div><div>{item.provider_name || 'Sin proveedor'}</div><div className="text-sm text-amber-100/80">{item.sku || item.serie || 'Sin SKU/serie'}</div></div>
                  <div><div className="text-xs font-black uppercase text-amber-200/70">Sucursal</div><div>{item.sucursal || '-'}</div><div className="text-sm text-amber-100/80">{item.deposito || '-'}</div></div>
                  <div><div className="text-xs font-black uppercase text-amber-200/70">Estado</div><div>{item.estado}</div></div>
                  <div><div className="text-xs font-black uppercase text-amber-200/70">Demora</div><div className="font-black">{item.dias_sin_respuesta ?? item.dias_pendiente ?? 0} días</div></div>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}


function DiagnosticsPanel({ diagnostics }: { diagnostics: WarrantyDiagnosticsResponse }) {
  const tone = diagnostics.status === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : diagnostics.status === 'error'
      ? 'border-red-500/30 bg-red-500/10'
      : 'border-amber-500/30 bg-amber-500/10';
  return <section className={`rounded-3xl border p-5 shadow-xl ${tone}`}>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="text-sm font-black uppercase tracking-wide text-slate-200">Control operativo</div>
        <p className="mt-1 text-sm text-slate-300">Revisión rápida de catálogo, proveedores, revisión interna y sincronización.</p>
      </div>
      <div className="rounded-full bg-slate-950/60 px-3 py-1 text-xs font-bold text-slate-300">Actualizado: {diagnostics.generated_at}</div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {diagnostics.items.map((item) => <DiagnosticCard key={item.key} item={item} />)}
    </div>
    {diagnostics.next_actions.length > 0 && <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
      <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Acciones recomendadas</div>
      <div className="grid gap-2 md:grid-cols-2">
        {diagnostics.next_actions.map((action) => <div key={action} className="rounded-xl bg-slate-900/80 px-3 py-2 text-sm text-slate-200">{action}</div>)}
      </div>
    </div>}
  </section>;
}

function DiagnosticCard({ item }: { item: WarrantyDiagnosticsResponse['items'][number] }) {
  const icon = item.status === 'ok' ? <CheckCircle2 size={18} className="text-emerald-300" /> : item.status === 'error' ? <XCircle size={18} className="text-red-300" /> : <AlertTriangle size={18} className="text-amber-300" />;
  const cls = item.status === 'ok' ? 'border-emerald-500/20' : item.status === 'error' ? 'border-red-500/30' : 'border-amber-500/30';
  return <div className={`rounded-2xl border bg-slate-950/50 p-4 ${cls}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-black text-white">{item.label}</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.detail}</p>
      </div>
      {icon}
    </div>
  </div>;
}

function Kpi({ title, value, suffix = '', tone = 'base' }: { title: string; value: number; suffix?: string; tone?: 'base' | 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : tone === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : tone === 'bad' ? 'border-red-500/30 bg-red-500/10 text-red-100' : 'border-slate-700 bg-slate-950/60 text-slate-100';
  return <div className={`rounded-2xl border p-4 shadow-xl ${cls}`}><div className="text-xs font-black uppercase tracking-wide opacity-70">{title}</div><div className="mt-2 text-3xl font-black">{fmtNumber(value)}{suffix}</div></div>;
}

function ChartCard({ title, icon, points, suffix = '' }: { title: string; icon: ReactNode; points: WarrantyDashboardPoint[]; suffix?: string }) {
  const max = maxValue(points);
  return <section className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
    <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300">{icon} {title}</div>
    {points.length === 0 && <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-slate-400">Sin datos disponibles.</div>}
    <div className="space-y-3">
      {points.map((point) => {
        const width = Math.max(4, Math.round((Number(point.value || 0) / max) * 100));
        return <div key={point.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-semibold text-slate-200">{point.label}</span>
            <span className="shrink-0 font-black text-slate-100">{fmtNumber(point.value)}{suffix}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${width}%` }} />
          </div>
        </div>;
      })}
    </div>
  </section>;
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label><span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span><div className="relative"><Search className="absolute left-3 top-3.5 text-slate-500" size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-4 outline-none focus:border-blue-400" /></div></label>;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400" /></label>;
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label><span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400"><option value="">Todos</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function BuildingIcon() {
  return <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-slate-700 text-[10px] font-black text-slate-200">P</span>;
}
