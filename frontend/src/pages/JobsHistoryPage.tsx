import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJobs } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import type { JobInfo } from '../types';

export function JobsHistoryPage() {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJobs().then(setJobs).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-black">Historial de ejecuciones</h1>
      <p className="mt-2 text-slate-400">Últimos procesos ejecutados desde la app web.</p>
      {error && <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70 shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950/70 text-slate-400">
            <tr>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Herramienta</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Duración</th>
              <th className="px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-300">{new Date(job.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 font-semibold text-white">{job.tool_name}</td>
                <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                <td className="px-4 py-3 text-slate-300">{job.duration_seconds ? `${job.duration_seconds.toFixed(1)}s` : '-'}</td>
                <td className="px-4 py-3"><Link className="font-semibold text-blue-300 hover:text-blue-200" to={`/jobs/${job.id}`}>Ver logs</Link></td>
              </tr>
            ))}
            {!jobs.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Todavía no hay ejecuciones.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
