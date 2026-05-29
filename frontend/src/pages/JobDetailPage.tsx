import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, XCircle } from 'lucide-react';
import { cancelJob, fetchJob, fetchJobLogs } from '../api/client';
import { LogsConsole } from '../components/LogsConsole';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpInfoGrid,
  ErpInfoRow,
  ErpNotice,
  ErpPageHeader,
  erpBtnGhost,
  type ErpBadgeTone,
} from '../components/ProUI';
import type { JobInfo, JobStatus } from '../types';

const runningStates = new Set<JobStatus>(['pending', 'running']);

const STATUS_TONE: Record<JobStatus, ErpBadgeTone> = {
  pending: 'warning',
  running: 'info',
  success: 'success',
  error: 'danger',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pendiente',
  running: 'Ejecutando',
  success: 'Finalizado',
  error: 'Error',
  cancelled: 'Cancelado',
};

export function JobDetailPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [logs, setLogs] = useState('');
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

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
    setCancelling(true);
    try {
      await cancelJob(jobId);
      await refresh();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title={job ? job.tool_name : 'Detalle del proceso'}
        description={job ? <>Job <span className="font-mono">{job.id}</span> · iniciado el {new Date(job.created_at).toLocaleString('es-AR')}</> : undefined}
        actions={
          <>
            <Link to="/jobs" className={erpBtnGhost}><ArrowLeft size={14} /> Historial</Link>
            <button type="button" onClick={refresh} className={erpBtnGhost}><RefreshCw size={14} /> Refrescar</button>
            {job && runningStates.has(job.status) && (
              <ErpButton variant="danger" loading={cancelling} onClick={doCancel} leftIcon={<XCircle size={14} />}>
                Cancelar ejecución
              </ErpButton>
            )}
          </>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      {job && (
        <ErpCard title="Estado del proceso" actions={<ErpBadge tone={STATUS_TONE[job.status] || 'neutral'}>{STATUS_LABEL[job.status] || job.status}</ErpBadge>}>
          <ErpInfoGrid columns={3}>
            <ErpInfoRow label="Herramienta" value={job.tool_name} />
            <ErpInfoRow label="Estado" value={STATUS_LABEL[job.status] || job.status} />
            <ErpInfoRow label="Duración" value={job.duration_seconds ? `${job.duration_seconds.toFixed(1)} s` : '—'} />
            <ErpInfoRow label="Iniciado" value={new Date(job.created_at).toLocaleString('es-AR')} />
            <ErpInfoRow label="ID del job" value={<span className="font-mono">{job.id}</span>} />
            <ErpInfoRow label="Disparado por" value={(job as any).actor_display_name || (job as any).actor_username || 'Sistema'} />
          </ErpInfoGrid>
          {job.error && (
            <div className="mt-3">
              <ErpNotice tone="error" title="Error reportado por el proceso">{job.error}</ErpNotice>
            </div>
          )}
        </ErpCard>
      )}

      <ErpCard title="Logs en vivo" subtitle="Salida del proceso. Se actualiza cada 2 segundos mientras se ejecuta.">
        <LogsConsole logs={logs} />
      </ErpCard>
    </div>
  );
}
