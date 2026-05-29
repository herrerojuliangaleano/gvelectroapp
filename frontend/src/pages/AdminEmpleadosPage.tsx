import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdCard, Plus, RefreshCw, UserPlus } from 'lucide-react';
import { can, fetchEmployees } from '../api/client';
import {
  ErpBadge,
  ErpDataTable,
  ErpFilterBar,
  ErpKpiCard,
  ErpPageHeader,
  type ErpBadgeTone,
  type ErpColumn,
} from '../components/ProUI';
import type { EmployeeInfo } from '../types';

const STATUS_META: Record<string, { label: string; tone: ErpBadgeTone }> = {
  alta: { label: 'Alta', tone: 'success' },
  licencia: { label: 'Licencia', tone: 'warning' },
  baja: { label: 'Baja', tone: 'danger' },
};

function statusMeta(status?: string | null) {
  const key = String(status || 'alta').toLowerCase();
  return STATUS_META[key] || { label: status || '—', tone: 'neutral' as ErpBadgeTone };
}

function initials(name?: string | null) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

type StatusFilter = 'todos' | 'alta' | 'licencia' | 'baja';
type UserFilter = 'todos' | 'con' | 'sin';

/**
 * E-01 · Listado de empleados.
 * Identidad legal/operativa de la persona: DNI, puesto, sucursal de trabajo,
 * estado laboral y usuario vinculado (si tiene). Incluye empleados sin acceso.
 */
export function AdminEmpleadosPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmployeeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [userFilter, setUserFilter] = useState<UserFilter>('todos');

  const canManage = can('employees.manage');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEmployees({ limit: 1000 });
      setRows(res.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los empleados');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const kpis = useMemo(() => {
    const total = rows.length;
    const conUsuario = rows.filter((e) => e.has_user).length;
    const enLicencia = rows.filter((e) => String(e.status).toLowerCase() === 'licencia').length;
    const baja = rows.filter((e) => String(e.status).toLowerCase() === 'baja').length;
    return { total, conUsuario, sinUsuario: total - conUsuario, enLicencia, baja };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((e) => {
      const st = String(e.status || 'alta').toLowerCase();
      if (statusFilter !== 'todos' && st !== statusFilter) return false;
      if (userFilter === 'con' && !e.has_user) return false;
      if (userFilter === 'sin' && e.has_user) return false;
      if (q) {
        const hay = [e.display_name, e.dni, e.position, e.username, e.personal_email, e.work_branch_name, e.branch_name]
          .map((v) => String(v || '').toLowerCase()).join(' ');
        if (!q.split(/\s+/).every((tok) => hay.includes(tok))) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, userFilter]);

  const columns: ErpColumn<EmployeeInfo>[] = [
    {
      key: 'empleado',
      header: 'Empleado',
      render: (e) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--primary-soft)] text-[11px] font-semibold text-[color:var(--primary-soft-text)]">
            {initials(e.display_name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[color:var(--text)]">{e.display_name || '—'}</span>
            <span className="block truncate text-[11.5px] text-[color:var(--text-3)]">{e.position || 'Sin puesto'}</span>
          </span>
        </div>
      ),
    },
    { key: 'dni', header: 'DNI', render: (e) => <span className="font-mono tabular-nums">{e.dni || '—'}</span> },
    { key: 'sucursal', header: 'Sucursal de trabajo', render: (e) => e.work_branch_name || e.branch_name || '—' },
    {
      key: 'estado',
      header: 'Estado laboral',
      render: (e) => { const m = statusMeta(e.status); return <ErpBadge tone={m.tone}>{m.label}</ErpBadge>; },
    },
    {
      key: 'usuario',
      header: 'Usuario',
      render: (e) => e.has_user
        ? <span className="font-mono text-[12.5px]">{e.username}</span>
        : <span className="text-[12px] text-[color:var(--text-3)]">Sin usuario</span>,
    },
  ];

  const statusChips = (['todos', 'alta', 'licencia', 'baja'] as StatusFilter[]).map((k) => ({
    key: k,
    label: k === 'todos' ? 'Todos' : STATUS_META[k].label,
    active: statusFilter === k,
    onClick: () => setStatusFilter(k),
  }));
  const userChips = ([['con', 'Con usuario'], ['sin', 'Sin usuario']] as [UserFilter, string][]).map(([k, label]) => ({
    key: `u-${k}`,
    label,
    active: userFilter === k,
    onClick: () => setUserFilter((prev) => (prev === k ? 'todos' : k)),
  }));

  return (
    <div>
      <ErpPageHeader
        title="Empleados"
        description="Identidad legal y operativa de la persona: DNI, datos laborales, foto y recibos. Existe aunque no tenga usuario."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="erp-btn erp-btn-secondary erp-btn-sm" onClick={load}>
              <RefreshCw size={14} /> Actualizar
            </button>
            {canManage && (
              <button type="button" className="erp-btn erp-btn-primary erp-btn-sm" onClick={() => navigate('/administracion/empleados/nuevo')}>
                <Plus size={14} /> Nuevo empleado
              </button>
            )}
          </div>
        }
      />

      <div className="erp-kpi-grid mb-4">
        <ErpKpiCard label="Total empleados" value={kpis.total} icon={<IdCard size={16} />} />
        <ErpKpiCard label="Con usuario" value={kpis.conUsuario} variant="success" icon={<UserPlus size={16} />} />
        <ErpKpiCard label="Sin usuario" value={kpis.sinUsuario} detail="Sin acceso al sistema" />
        <ErpKpiCard label="En licencia" value={kpis.enLicencia} variant={kpis.enLicencia ? 'alert' : 'default'} />
        <ErpKpiCard label="Baja" value={kpis.baja} variant={kpis.baja ? 'danger' : 'default'} />
      </div>

      <ErpFilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Buscar por nombre, DNI, puesto…"
        chips={[...statusChips, ...userChips]}
        onReset={() => { setSearch(''); setStatusFilter('todos'); setUserFilter('todos'); }}
      />

      <div className="mt-3">
        <ErpDataTable
          columns={columns}
          rows={filtered}
          rowKey={(e) => e.id || e.username || ''}
          loading={loading}
          error={error}
          onRowClick={(e) => e.id && navigate(`/administracion/empleados/${encodeURIComponent(e.id)}`)}
          empty={{ title: 'Sin empleados', description: 'Todavía no hay empleados que coincidan con el filtro.' }}
          renderMobileCard={(e) => {
            const m = statusMeta(e.status);
            return (
              <button type="button" className="erp-mcard" onClick={() => e.id && navigate(`/administracion/empleados/${encodeURIComponent(e.id)}`)}>
                <div className="erp-mcard-head">
                  <span className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--primary-soft)] text-[11px] font-semibold text-[color:var(--primary-soft-text)]">{initials(e.display_name)}</span>
                    <span className="font-semibold">{e.display_name || '—'}</span>
                  </span>
                  <ErpBadge tone={m.tone}>{m.label}</ErpBadge>
                </div>
                <div className="erp-mcard-body text-[12.5px] text-[color:var(--text-2)]">
                  <div>DNI <span className="font-mono">{e.dni || '—'}</span> · {e.position || 'Sin puesto'}</div>
                  <div>{e.work_branch_name || e.branch_name || '—'} · {e.has_user ? `@${e.username}` : 'Sin usuario'}</div>
                </div>
              </button>
            );
          }}
        />
      </div>
    </div>
  );
}
