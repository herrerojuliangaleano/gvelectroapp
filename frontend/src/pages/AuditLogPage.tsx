import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw, Search } from 'lucide-react';
import { fetchAudit } from '../api/client';
import {
  ErpBadge,
  ErpDataTable,
  ErpDrawer,
  ErpField,
  ErpInfoGrid,
  ErpInfoRow,
  ErpInput,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  erpBtnPrimary,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpColumn,
  type ErpRowAction,
} from '../components/ProUI';
import type { AuditEvent } from '../types';

function statusTone(status?: string): ErpBadgeTone {
  if (!status) return 'neutral';
  if (status === 'ok' || status === 'success') return 'success';
  if (status === 'error' || status === 'failed') return 'danger';
  if (status === 'warning') return 'warning';
  return 'neutral';
}

export function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ actor: '', event_type: '', status: '' });
  const [drawerEvent, setDrawerEvent] = useState<AuditEvent | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAudit(500, filters);
      setEvents(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar auditoría');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function submit(e: FormEvent) { e.preventDefault(); load(); }

  const columns: ErpColumn<AuditEvent>[] = [
    {
      key: 'created_at',
      header: 'Fecha',
      width: 150,
      muted: true,
      render: (row) => <span className="tabular-nums">{new Date(row.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>,
    },
    {
      key: 'event',
      header: 'Evento',
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-stack-primary font-mono text-[12px]">{row.event_type}</span>
          {row.message && <span className="erp-cell-stack-secondary line-clamp-1">{row.message}</span>}
        </div>
      ),
    },
    {
      key: 'actor',
      header: 'Usuario',
      width: 160,
      render: (row) => (
        <div className="erp-cell-stack">
          <span className="erp-cell-stack-primary">{row.actor_display_name || row.actor_username || 'Sistema'}</span>
          {row.actor_role && <span className="erp-cell-stack-secondary">{row.actor_role}</span>}
        </div>
      ),
    },
    {
      key: 'resource',
      header: 'Recurso',
      width: 180,
      muted: true,
      render: (row) => row.resource_type ? (
        <div className="erp-cell-stack">
          <span>{row.resource_type}</span>
          {row.resource_id && <span className="erp-cell-stack-secondary font-mono">{row.resource_id}</span>}
        </div>
      ) : <span className="text-[color:var(--text-3)]">—</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      width: 110,
      render: (row) => row.status ? <ErpBadge tone={statusTone(row.status)}>{row.status}</ErpBadge> : <span className="text-[color:var(--text-3)]">—</span>,
    },
  ];

  const rowActions: ErpRowAction<AuditEvent>[] = [
    {
      key: 'view',
      label: 'Ver detalle',
      icon: <Eye size={14} />,
      onClick: (row) => setDrawerEvent(row),
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Movimientos"
        description="Auditoría completa de inicios de sesión, garantías, presupuestos, jobs, usuarios y permisos."
        actions={
          <button type="button" onClick={() => load()} className={erpBtnSecondary} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'erp-spin' : ''} /> Actualizar
          </button>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      <form onSubmit={submit} className="erp-card erp-card-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <ErpField label="Usuario">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-3)]" />
              <ErpInput value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} placeholder="Username o nombre" style={{ paddingLeft: 32 }} />
            </div>
          </ErpField>
          <ErpField label="Tipo de evento">
            <ErpInput value={filters.event_type} onChange={(e) => setFilters({ ...filters, event_type: e.target.value })} placeholder="auth.login, warranties..." />
          </ErpField>
          <ErpField label="Estado">
            <ErpSelect value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Todos los estados</option>
              <option value="ok">OK</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
            </ErpSelect>
          </ErpField>
          <div className="flex items-end">
            <button type="submit" className={`${erpBtnPrimary} w-full`}>Aplicar filtros</button>
          </div>
        </div>
      </form>

      <ErpDataTable<AuditEvent>
        columns={columns}
        rows={events}
        rowKey={(row) => row.id}
        loading={loading}
        onRowClick={(row) => setDrawerEvent(row)}
        rowActions={rowActions}
        empty={{
          title: 'Sin movimientos para mostrar',
          description: 'Ajustá los filtros o esperá a que ocurran eventos.',
        }}
      />

      <ErpDrawer
        open={drawerEvent !== null}
        onClose={() => setDrawerEvent(null)}
        title={drawerEvent ? <span className="font-mono">{drawerEvent.event_type}</span> : 'Evento'}
        subtitle={drawerEvent ? <div className="mt-1 text-[12.5px] text-[color:var(--text-2)]">{new Date(drawerEvent.created_at).toLocaleString('es-AR')} · {drawerEvent.actor_display_name || drawerEvent.actor_username || 'Sistema'}</div> : null}
      >
        {drawerEvent && (
          <div className="erp-stack-4">
            <ErpInfoGrid columns={2}>
              <ErpInfoRow label="ID evento" value={<span className="font-mono">{drawerEvent.id}</span>} />
              <ErpInfoRow label="Tipo" value={<span className="font-mono">{drawerEvent.event_type}</span>} />
              <ErpInfoRow label="Usuario" value={drawerEvent.actor_display_name || drawerEvent.actor_username || 'Sistema'} />
              <ErpInfoRow label="Rol" value={drawerEvent.actor_role || '—'} />
              <ErpInfoRow label="Recurso" value={drawerEvent.resource_type || '—'} />
              <ErpInfoRow label="ID recurso" value={drawerEvent.resource_id ? <span className="font-mono">{drawerEvent.resource_id}</span> : '—'} />
              <ErpInfoRow label="Estado" value={drawerEvent.status ? <ErpBadge tone={statusTone(drawerEvent.status)}>{drawerEvent.status}</ErpBadge> : '—'} />
              <ErpInfoRow label="Fecha" value={<span className="tabular-nums">{new Date(drawerEvent.created_at).toLocaleString('es-AR')}</span>} />
            </ErpInfoGrid>

            {drawerEvent.message && (
              <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-1">Mensaje</div>
                <div className="text-[12.5px] text-[color:var(--text)] leading-[1.55]">{drawerEvent.message}</div>
              </div>
            )}

            {drawerEvent.details && Object.keys(drawerEvent.details).length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-1.5">Detalles técnicos</div>
                <pre className="max-h-96 overflow-auto rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-[11.5px] text-[color:var(--text-2)] leading-[1.55]">
                  {JSON.stringify(drawerEvent.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </ErpDrawer>
    </div>
  );
}
