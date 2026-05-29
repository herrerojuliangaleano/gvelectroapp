import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { can, fetchRoles, fetchUsers } from '../api/client';
import {
  ErpBadge,
  ErpDataTable,
  ErpFilterBar,
  ErpKpiCard,
  ErpPageHeader,
  type ErpColumn,
} from '../components/ProUI';
import { UserDetailDrawer } from '../components/UserDetailDrawer';
import type { RoleInfo, UserInfo } from '../types';

const PHOTO_PENDING = new Set(['pendiente_aprobacion', 'solicitada_nuevamente']);

function initials(name?: string | null) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function userRoles(u: UserInfo): string[] {
  const out: string[] = [];
  for (const r of [u.role, ...(u.roles || [])]) {
    const v = String(r || '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function branchCount(u: UserInfo): number {
  if (u.branches && u.branches.length) return u.branches.length;
  return (u.branch_ids || []).length || (u.branch_id ? 1 : 0);
}

function primaryBranch(u: UserInfo): string {
  const b = (u.branches || []).find((x) => x.is_primary) || (u.branches || [])[0];
  return b?.name || u.branch_name || u.sucursal || '—';
}

type Tab = 'todos' | 'activos' | 'inactivos' | 'foto' | 'sinfoto';

function photoStatusOf(u: UserInfo): string {
  return String(u.employee?.photo_status || 'sin_foto') || 'sin_foto';
}

/**
 * U-01 · Listado de usuarios.
 * Identidad técnica de acceso: credenciales, roles, permisos y alcance.
 */
export function AdminUsuariosPage() {
  const navigate = useNavigate();
  const { username: routeUsername } = useParams();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('todos');

  const canManage = can('users.manage');
  const roleLabel = useMemo(() => {
    const map = new Map(roles.map((r) => [r.name, r.label]));
    return (name: string) => map.get(name) || name;
  }, [roles]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, r] = await Promise.all([fetchUsers(), fetchRoles().catch(() => [])]);
      setUsers(u || []);
      setRoles(r || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const kpis = useMemo(() => {
    const total = users.length;
    const activos = users.filter((u) => u.is_active).length;
    const multiSuc = users.filter((u) => branchCount(u) > 1).length;
    const multiRol = users.filter((u) => userRoles(u).length > 1).length;
    const fotoPend = users.filter((u) => PHOTO_PENDING.has(photoStatusOf(u))).length;
    const sinFoto = users.filter((u) => photoStatusOf(u) === 'sin_foto').length;
    const sinEmpleado = users.filter((u) => !u.employee || !String(u.employee?.dni || '').trim()).length;
    return { total, activos, multiSuc, multiRol, fotoPend, sinFoto, sinEmpleado };
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (tab === 'activos' && !u.is_active) return false;
      if (tab === 'inactivos' && u.is_active) return false;
      if (tab === 'foto' && !PHOTO_PENDING.has(photoStatusOf(u))) return false;
      if (tab === 'sinfoto' && photoStatusOf(u) !== 'sin_foto') return false;
      if (q) {
        const hay = [u.username, u.display_name, u.employee?.dni, primaryBranch(u), ...userRoles(u).map(roleLabel)]
          .map((v) => String(v || '').toLowerCase()).join(' ');
        if (!q.split(/\s+/).every((tok) => hay.includes(tok))) return false;
      }
      return true;
    });
  }, [users, search, tab, roleLabel]);

  const columns: ErpColumn<UserInfo>[] = [
    {
      key: 'usuario',
      header: 'Usuario',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--primary-soft)] text-[11px] font-semibold text-[color:var(--primary-soft-text)]">
            {initials(u.display_name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[color:var(--text)]">{u.display_name}</span>
            <span className="block truncate font-mono text-[11.5px] text-[color:var(--text-3)]">{u.username}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'empleado',
      header: 'Empleado',
      render: (u) => u.employee && String(u.employee.dni || '').trim()
        ? <span className="text-[12.5px]"><span className="font-mono">{u.employee.dni}</span>{u.employee.position ? <span className="text-[color:var(--text-3)]"> · {u.employee.position}</span> : null}</span>
        : <span className="text-[12px] text-[color:var(--text-3)]">Sin empleado</span>,
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) => {
        const rs = userRoles(u);
        return (
          <span className="flex flex-wrap gap-1">
            {rs.slice(0, 2).map((r) => <span key={r} className="erp-tag">{roleLabel(r)}</span>)}
            {rs.length > 2 && <span className="text-[11px] text-[color:var(--text-3)]">+{rs.length - 2}</span>}
          </span>
        );
      },
    },
    {
      key: 'alcance',
      header: 'Alcance',
      render: (u) => {
        const n = branchCount(u);
        return <span className="text-[12.5px]">{primaryBranch(u)}{n > 1 && <span className="text-[color:var(--text-3)]"> +{n - 1}</span>}</span>;
      },
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (u) => <ErpBadge tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Activo' : 'Inactivo'}</ErpBadge>,
    },
  ];

  const chips = ([
    ['todos', 'Todos'],
    ['activos', 'Activos'],
    ['inactivos', 'Inactivos'],
    ['foto', `Foto pendiente${kpis.fotoPend ? ` (${kpis.fotoPend})` : ''}`],
    ['sinfoto', `Sin foto${kpis.sinFoto ? ` (${kpis.sinFoto})` : ''}`],
  ] as [Tab, string][])
    .map(([k, label]) => ({ key: k, label, active: tab === k, onClick: () => setTab(k) }));

  return (
    <div>
      <ErpPageHeader
        title="Usuarios"
        description="Identidad técnica de acceso al sistema: credenciales, roles, permisos y alcance operativo."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="erp-btn erp-btn-secondary erp-btn-sm" onClick={load}>
              <RefreshCw size={14} /> Actualizar
            </button>
            {canManage && (
              <button type="button" className="erp-btn erp-btn-primary erp-btn-sm" onClick={() => navigate('/administracion/usuarios/nuevo')}>
                <Plus size={14} /> Nuevo usuario
              </button>
            )}
          </div>
        }
      />

      <div className="erp-kpi-grid mb-4">
        <ErpKpiCard label="Total usuarios" value={kpis.total} icon={<Users size={16} />} />
        <ErpKpiCard label="Activos" value={kpis.activos} variant="success" />
        <ErpKpiCard label="Multi-sucursal" value={kpis.multiSuc} icon={<ShieldCheck size={16} />} />
        <ErpKpiCard label="Multi-rol" value={kpis.multiRol} />
        <ErpKpiCard label="Foto pendiente" value={kpis.fotoPend} variant={kpis.fotoPend ? 'alert' : 'default'} icon={<Camera size={16} />} />
        <ErpKpiCard label="Sin empleado" value={kpis.sinEmpleado} />
      </div>

      <ErpFilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Buscar por nombre, usuario, DNI, rol…"
        chips={chips}
        onReset={() => { setSearch(''); setTab('todos'); }}
      />

      <div className="mt-3">
        <ErpDataTable
          columns={columns}
          rows={filtered}
          rowKey={(u) => u.username}
          loading={loading}
          error={error}
          onRowClick={(u) => navigate(`/administracion/usuarios/${encodeURIComponent(u.username)}`)}
          empty={{ title: 'Sin usuarios', description: 'No hay usuarios que coincidan con el filtro.' }}
          renderMobileCard={(u) => (
            <button type="button" className="erp-mcard" onClick={() => navigate(`/administracion/usuarios/${encodeURIComponent(u.username)}`)}>
              <div className="erp-mcard-head">
                <span className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--primary-soft)] text-[11px] font-semibold text-[color:var(--primary-soft-text)]">{initials(u.display_name)}</span>
                  <span className="font-semibold">{u.display_name}</span>
                </span>
                <ErpBadge tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Activo' : 'Inactivo'}</ErpBadge>
              </div>
              <div className="erp-mcard-body text-[12.5px] text-[color:var(--text-2)]">
                <div className="font-mono">{u.username}</div>
                <div>{userRoles(u).map(roleLabel).slice(0, 2).join(' · ') || 'Sin rol'} · {primaryBranch(u)}</div>
              </div>
            </button>
          )}
        />
      </div>

      <UserDetailDrawer
        user={routeUsername && routeUsername !== 'nuevo' ? (users.find((u) => u.username === routeUsername) || null) : null}
        roleLabel={roleLabel}
        open={!!routeUsername && routeUsername !== 'nuevo'}
        onClose={() => navigate('/administracion/usuarios')}
        onChanged={load}
      />
    </div>
  );
}
