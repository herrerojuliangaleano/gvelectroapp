import { FormEvent, useEffect, useState } from 'react';
import { fetchAudit } from '../api/client';
import type { AuditEvent } from '../types';

export function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ actor: '', event_type: '', status: '' });

  async function load() { setEvents(await fetchAudit(500, filters)); }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); try { await load(); } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cargar auditoría'); } }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6"><h1 className="text-2xl font-black sm:text-3xl">Movimientos</h1><p className="mt-2 text-sm text-slate-400">Auditoría de inicios de sesión, garantías, presupuestos, jobs, usuarios y permisos.</p></div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      <form onSubmit={submit} className="mb-5 grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-4">
        <input value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} placeholder="Usuario o nombre" className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" />
        <input value={filters.event_type} onChange={(e) => setFilters({ ...filters, event_type: e.target.value })} placeholder="Acción: auth.login, warranties..." className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-3"><option value="">Todos los estados</option><option value="ok">OK</option><option value="error">Error</option></select>
        <button className="rounded-xl bg-blue-500 px-4 py-3 font-bold text-white">Filtrar</button>
      </form>
      <div className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div><div className="font-black text-white">{event.event_type}</div><div className="text-sm text-slate-400">{event.actor_display_name || event.actor_username || 'Sistema'} · {event.actor_role || '-'}</div></div>
              <div className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</div>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Recurso:</span> {event.resource_type || '-'}</div><div><span className="text-slate-500">ID:</span> {event.resource_id || '-'}</div><div><span className="text-slate-500">Estado:</span> {event.status || '-'}</div></div>
            {event.message && <div className="mt-2 text-sm text-slate-300">{event.message}</div>}
            {event.details && Object.keys(event.details).length > 0 && <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-300">{JSON.stringify(event.details, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
