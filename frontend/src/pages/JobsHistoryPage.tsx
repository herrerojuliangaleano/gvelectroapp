import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, History, RefreshCw } from 'lucide-react';
import { fetchJobs } from '../api/client';
import {
  ErpBadge,
  ErpDataTable,
  ErpErrorState,
  ErpPageHeader,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpColumn,
  type ErpRowAction,
} from '../components/ProUI';
import type { JobInfo, JobStatus } from '../types';

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

export function JobsHistoryPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError('');
    fetchJobs()
      .then((res) => { setJobs(res); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }

  useEffect(load, []);

  const columns: ErpColumn<JobInfo>[] = [
    {
      key: 'created_at',
      header: 'Fecha',
      width: 160,
      muted: true,
      render: (row) => <span className="tabular-nums">{new Date(row.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>,
    },
    {
      key: 'tool',
      header: 'Herramienta',
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-stack-primary">{row.tool_name}</span>
          <span className="erp-cell-stack-secondary font-mono">{row.id}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 130,
      render: (row) => <ErpBadge tone={STATUS_TONE[row.status] || 'neutral'}>{STATUS_LABEL[row.status] || row.status}</ErpBadge>,
    },
    {
      key: 'duration',
      header: 'Duración',
      width: 100,
      align: 'right',
      muted: true,
      render: (row) => row.duration_seconds ? `${row.duration_seconds.toFixed(1)} s` : '—',
    },
  ];

  const rowActions: ErpRowAction<JobInfo>[] = [
    {
      key: 'view',
      label: 'Ver logs',
      icon: <Eye size={14} />,
      onClick: (row) => navigate(`/jobs/${row.id}`),
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Historial de ejecuciones"
        description="Últimos procesos ejecutados desde la app web, con su estado y duración."
        actions={
          <button type="button" onClick={load} className={erpBtnSecondary} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'erp-spin' : ''} /> Actualizar
          </button>
        }
      />

      {error && <ErpErrorState description={error} retry={load} />}

      {!error && (
        <ErpDataTable<JobInfo>
          columns={columns}
          rows={jobs}
          rowKey={(row) => row.id}
          loading={loading}
          onRowClick={(row) => navigate(`/jobs/${row.id}`)}
          rowActions={rowActions}
          empty={{
            title: 'Todavía no hay ejecuciones',
            description: 'Cuando dispares procesos desde Herramientas, vas a verlos acá.',
          }}
        />
      )}
    </div>
  );
}
