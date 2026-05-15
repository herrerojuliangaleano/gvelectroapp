import type { JobStatus } from '../types';

const labels: Record<JobStatus, string> = {
  pending: 'Pendiente',
  running: 'Ejecutando',
  success: 'Finalizado',
  error: 'Error',
  cancelled: 'Cancelado'
};

const classes: Record<JobStatus, string> = {
  pending: 'pro-badge pro-badge-amber',
  running: 'pro-badge pro-badge-blue',
  success: 'pro-badge pro-badge-green',
  error: 'pro-badge pro-badge-red',
  cancelled: 'pro-badge'
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={classes[status]}>{labels[status]}</span>;
}
