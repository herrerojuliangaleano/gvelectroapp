import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cancelJob, fetchJob, fetchJobLogs } from '../api/client';
import { LogsConsole } from '../components/LogsConsole';
import { StatusBadge } from '../components/StatusBadge';
import type { JobInfo } from '../types';

const runningStates = new Set(['pending', 'running']);

export function JobDetailPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [logs, setLogs] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    if (!jobId) return;
    try {
      const [j, l] = await Promise.all([fetchJob(jobId), fetchJobLogs(jobId)]);
      setJob(j);
      setLogs(l.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error consultando job');
    }
  }

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [jobId]);

  async function doCancel() {
    if (!jobId) return;
    await cancelJob(jobId);
    await refresh();
  }

  return (
    <div>
      <Link to="/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white"><ArrowLeft size={16} /> Historial</Link>
      {error && <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {job && (
        <div className="mb-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black">{job.tool_name}</h1>
              <p className="mt-1 text-sm text-slate-400">Job {job.id} · {new Date(job.created_at).toLocaleString()}</p>
              {job.error && <p className="mt-3 text-sm text-red-200">{job.error}</p>}
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={job.status} />
              {runningStates.has(job.status) && <button onClick={doCancel} className="rounded-xl border border-red-500/50 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/10">Cancelar</button>}
            </div>
          </div>
        </div>
      )}
      <LogsConsole logs={logs} />
    </div>
  );
}
