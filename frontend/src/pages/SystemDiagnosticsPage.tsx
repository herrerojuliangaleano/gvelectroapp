import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchSystemDiagnostics, repairSystemDiagnostics } from '../api/client';
import type { SystemDiagnostics, SystemDiagnosticIssue } from '../types';

const SUMMARY_LABELS: Record<string, string> = {
  users_total: 'Usuarios',
  users_active: 'Usuarios activos',
  users_without_roles: 'Sin rol',
  users_without_branch: 'Sin sucursal',
  users_without_employee: 'Sin empleado',
  users_must_change_password: 'Cambio de clave pendiente',
  companies: 'Empresas',
  branches: 'Sucursales',
  employees: 'Empleados',
  employees_without_dni: 'Sin DNI',
  employees_without_photo: 'Fotos pendientes',
  payroll_total: 'Recibos',
  payroll_pending: 'Recibos pendientes',
  payroll_signed: 'Recibos firmados',
  payroll_observed: 'Recibos observados',
  payroll_duplicate_groups: 'Duplicados',
  payroll_missing_files: 'Archivos faltantes',
  jobs_recent_errors: 'Procesos con error',
};

const SUMMARY_ORDER = [
  'users_total', 'users_active', 'users_without_roles', 'users_without_branch', 'users_without_employee',
  'employees', 'employees_without_dni', 'employees_without_photo',
  'companies', 'branches', 'payroll_total', 'payroll_pending', 'payroll_observed', 'payroll_duplicate_groups', 'payroll_missing_files', 'jobs_recent_errors',
];

export function SystemDiagnosticsPage() {
  const [data, setData] = useState<SystemDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSystemDiagnostics());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el diagnóstico');
    } finally {
      setLoading(false);
    }
  }

  async function repair() {
    if (!window.confirm('¿Ejecutar reparación automática de roles, sucursales y empleados?')) return;
    setRepairing(true);
    setMessage('');
    setError('');
    try {
      const result = await repairSystemDiagnostics();
      setMessage(`Reparación ejecutada. Roles: ${result.roles.changed_users ?? result.roles.synced ?? 0}. Sucursales: ${result.branches.changed ?? result.branches.synced ?? 0}. Empleados: ${result.employees.created ?? 0} creados.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ejecutar la reparación');
    } finally {
      setRepairing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const summaryCards = useMemo(() => {
    const summary = data?.summary || {};
    return SUMMARY_ORDER.filter((key) => key in summary).map((key) => ({ key, label: SUMMARY_LABELS[key] || key, value: summary[key] }));
  }, [data]);

  const issues = data?.issues || [];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-100">Control operativo</div>
          <h1 className="mt-3 text-2xl font-black sm:text-3xl">Diagnóstico del sistema</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Revisión de usuarios, roles, sucursales, empleados, recibos y procesos recientes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900 disabled:opacity-60"><RefreshCw size={16} /> Actualizar</button>
          <button onClick={repair} disabled={repairing} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-400 disabled:opacity-60"><Wrench size={16} /> {repairing ? 'Reparando...' : 'Reparar base operativa'}</button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">{message}</div>}

      <div className="mb-5 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon status={data?.status || 'warning'} />
            <div>
              <div className="text-lg font-black text-white">{statusTitle(data?.status || 'warning')}</div>
              <div className="text-sm text-slate-400">Última revisión: {data?.generated_at ? new Date(data.generated_at).toLocaleString() : loading ? 'Cargando...' : '-'}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
            Incidencias: <b className="text-white">{issues.length}</b>
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((item) => <Metric key={item.key} label={item.label} value={String(item.value)} tone={toneForMetric(item.key, item.value)} />)}
      </div>

      <section className="mb-5 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="mb-4 flex items-center gap-2"><ShieldCheck size={18} /><h2 className="text-lg font-black">Puntos a revisar</h2></div>
        <div className="space-y-3">
          {issues.map((issue, index) => <IssueCard key={`${issue.title}-${index}`} issue={issue} />)}
          {!issues.length && <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-100">No se detectaron puntos críticos en la revisión actual.</div>}
        </div>
      </section>

      {!!data?.recent_errors?.length && <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
        <h2 className="mb-4 text-lg font-black">Procesos recientes con error</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="min-w-full text-sm"><thead className="bg-slate-900 text-xs uppercase text-slate-400"><tr><th className="px-4 py-3 text-left">Proceso</th><th className="px-4 py-3 text-left">Fecha</th><th className="px-4 py-3 text-left">Error</th></tr></thead><tbody className="divide-y divide-slate-800">{data.recent_errors.map((job) => <tr key={job.id}><td className="px-4 py-3 font-semibold text-white">{job.tool_name}</td><td className="px-4 py-3 text-slate-400">{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</td><td className="px-4 py-3 text-red-200">{job.error || '-'}</td></tr>)}</tbody></table>
        </div>
      </section>}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="text-green-300" size={30} />;
  return <AlertTriangle className={status === 'critical' ? 'text-red-300' : 'text-amber-300'} size={30} />;
}

function statusTitle(status: string) {
  if (status === 'ok') return 'Sistema en condiciones';
  if (status === 'critical') return 'Requiere atención inmediata';
  return 'Revisión recomendada';
}

function toneForMetric(key: string, value: unknown) {
  const numberValue = Number(value || 0);
  if (['users_without_roles', 'payroll_missing_files'].includes(key) && numberValue > 0) return 'red';
  if (['users_without_branch', 'users_without_employee', 'employees_without_dni', 'payroll_observed', 'payroll_duplicate_groups', 'jobs_recent_errors'].includes(key) && numberValue > 0) return 'amber';
  if (['employees_without_photo', 'payroll_pending'].includes(key) && numberValue > 0) return 'blue';
  return 'default';
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  const toneClass = tone === 'red' ? 'border-red-500/40 bg-red-500/10 text-red-100' : tone === 'amber' ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : tone === 'blue' ? 'border-blue-500/40 bg-blue-500/10 text-blue-100' : 'border-slate-800 bg-slate-950/60 text-white';
  return <div className={`rounded-3xl border p-4 ${toneClass}`}><div className="text-xs font-bold uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>;
}

function IssueCard({ issue }: { issue: SystemDiagnosticIssue }) {
  const cls = issue.severity === 'critical' ? 'border-red-500/40 bg-red-500/10 text-red-100' : issue.severity === 'warning' ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-blue-500/30 bg-blue-500/10 text-blue-100';
  return <div className={`rounded-2xl border p-4 ${cls}`}><div className="font-black">{issue.title}</div><div className="mt-1 text-sm opacity-90">{issue.detail}</div>{issue.action && <div className="mt-2 text-xs font-bold uppercase tracking-wide opacity-80">{issue.action}</div>}</div>;
}
