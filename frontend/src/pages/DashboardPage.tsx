import {
  AlertTriangle,
  Bell,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Cloud,
  Download,
  FileText,
  Globe2,
  History,
  PackageCheck,
  Search,
  ShieldCheck,
  Send,
  Truck,
  User,
  UserCog,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBrandForUser } from '../brand';
import { BrandLogo } from '../components/BrandLogo';
import {
  can,
  fetchNotifications,
  fetchSalesWebRequests,
  fetchSystemStatus,
  fetchSystemSummary,
  fetchTools,
  getCurrentUserFromStorage,
} from '../api/client';
import { ToolCard } from '../components/ToolCard';
import type { NotificationInfo, SalesWebRequest, SystemPublicStatus, SystemSummary, ToolInfo } from '../types';

type QuickAccess = {
  title: string;
  description: string;
  to: string;
  icon: ReactNode;
  permission?: string;
  anyPermission?: string[];
  tone?: 'blue' | 'green' | 'amber' | 'violet' | 'slate';
  group: 'Trabajo diario' | 'Seguimiento' | 'Administración' | 'Herramientas';
};

function allowed(item: QuickAccess): boolean {
  if (item.permission && !can(item.permission)) return false;
  if (item.anyPermission?.length && !item.anyPermission.some((permission) => can(permission))) return false;
  return true;
}

function roleTitle(role?: string) {
  const normalized = String(role || '').toUpperCase();
  if (normalized.includes('SUPERADMIN')) return 'Panel completo del sistema';
  if (normalized.includes('GERENTE')) return 'Resumen gerencial';
  if (normalized.includes('JEFE_POSVENTA') || normalized.includes('JEFE POSVENTA')) return 'Jefe de Posventa';
  if (normalized.includes('GESTOR_GARANTIAS') || normalized.includes('GESTOR GARANTIAS')) return 'Gestión de Garantías';
  if (normalized.includes('ENCARGADO_SUCURSAL') || normalized.includes('ENCARGADO SUCURSAL')) return 'Logística de Sucursal';
  if (normalized.includes('CADETE_DEPOSITO') || normalized.includes('CADETE DEPOSITO')) return 'Cadete de Depósito';
  if (normalized.includes('DEPOSITO')) return 'Encargado de Depósito';
  if (normalized.includes('ADMIN')) return 'Administración operativa';
  if (normalized.includes('VENDEDOR_WEB')) return 'Ventas web';
  if (normalized.includes('VENDEDOR')) return 'Ventas';
  return 'Espacio de trabajo';
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function normalizedRole(user: ReturnType<typeof getCurrentUserFromStorage>): string {
  return [user?.role, ...(user?.roles || [])].filter(Boolean).join(' ').toUpperCase();
}

function isDepositUser(user: ReturnType<typeof getCurrentUserFromStorage>): boolean {
  const role = normalizedRole(user);
  const branchType = String(user?.branch_type || '').toLowerCase();
  const branchName = String(user?.branch_name || user?.sucursal || '').toLowerCase();
  return role.includes('DEPOSITO') || role.includes('DEPÓSITO') || branchType.includes('deposit') || branchType.includes('deposito') || branchName.includes('depósito') || branchName.includes('deposito');
}

function isSellerUser(user: ReturnType<typeof getCurrentUserFromStorage>): boolean {
  const role = normalizedRole(user);
  return role.includes('VENDEDOR') && !role.includes('ADMIN') && !isDepositUser(user);
}

function dashboardLead(user: ReturnType<typeof getCurrentUserFromStorage>): string {
  const role = normalizedRole(user);
  if (role.includes('GESTOR_GARANTIAS')) return 'Revisión de garantías, seguimiento de tránsito, comunicación con sucursales y coordinación logística interna.';
  if (role.includes('JEFE_POSVENTA')) return 'Gestión de garantías con proveedores, exportaciones, registro de respuestas y alertas de comunicación.';
  if (role.includes('ENCARGADO_SUCURSAL')) return 'Garantías de tu sucursal, despacho de equipos al depósito y seguimiento del tránsito.';
  if (role.includes('CADETE_DEPOSITO')) return 'Cargá garantías de clientes que traen equipos al depósito y confirmá la llegada de remitos entrantes.';
  if (isDepositUser(user)) return 'Recibí remitos, cargá garantías de clientes en depósito y gestioná movimientos entre depósitos.';
  if (isSellerUser(user)) return 'Accesos rápidos para cargar ventas, registrar garantías y despachar productos hacia Chiclana.';
  if (role.includes('ADMIN') || role.includes('GERENTE') || role.includes('SUPERADMIN')) return 'Panel operativo con accesos de gestión, seguimiento y administración según tus permisos.';
  return 'Resumen operativo y accesos disponibles para tu perfil.';
}

export function DashboardPage() {
  const user = getCurrentUserFromStorage();
  const brand = getBrandForUser(user);
  const [status, setStatus] = useState<SystemPublicStatus | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [myRequests, setMyRequests] = useState<SalesWebRequest[]>([]);
  const [adminRequests, setAdminRequests] = useState<SalesWebRequest[]>([]);
  const [notifications, setNotifications] = useState<NotificationInfo[]>([]);
  const [toolQuery, setToolQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    fetchSystemStatus()
      .then((value) => { if (alive) setStatus(value); })
      .catch(() => { if (alive) setStatus(null); });

    if (can('dashboard.view')) {
      fetchSystemSummary()
        .then((value) => { if (alive) setSummary(value); })
        .catch((err) => { if (alive) setError(err.message); });
    }

    if (can('tools.view')) {
      fetchTools()
        .then((value) => { if (alive) setTools(value); })
        .catch(() => { if (alive) setTools([]); });
    }

    if (can('sales_web.view')) {
      fetchSalesWebRequests({ mine: true, active_only: true })
        .then((value) => { if (alive) setMyRequests(value); })
        .catch(() => { if (alive) setMyRequests([]); });
    }

    if (can('sales_web.manage')) {
      fetchSalesWebRequests({ active_only: true })
        .then((value) => { if (alive) setAdminRequests(value); })
        .catch(() => { if (alive) setAdminRequests([]); });
    }

    if (can('notifications.view')) {
      fetchNotifications(true)
        .then((value) => { if (alive) setNotifications(value.slice(0, 5)); })
        .catch(() => { if (alive) setNotifications([]); });
    }

    return () => { alive = false; };
  }, []);

  const quickAccess = useMemo(() => {
    const depositUser = isDepositUser(user);

    const items: QuickAccess[] = [
      // ── Trabajo diario ────────────────────────────────────────────────────
      { title: 'Nueva venta', description: 'Cargar datos para prefactura o remito.', to: '/venta/nueva', icon: <Globe2 />, permission: 'sales_web.create', tone: 'blue', group: 'Trabajo diario' },
      { title: 'Mis ventas', description: 'Seguimiento de ventas cargadas por vos.', to: '/venta/mis-solicitudes', icon: <ClipboardList />, permission: 'sales_web.view', tone: 'violet', group: 'Trabajo diario' },
      { title: 'Presupuesto rápido', description: 'Buscar productos y preparar importes.', to: '/budgets/new', icon: <Calculator />, permission: 'budgets.view', tone: 'green', group: 'Trabajo diario' },
      {
        title: depositUser ? 'Cargar cliente en depósito' : 'Cargar garantía',
        description: depositUser ? 'Registrar mercadería que el cliente deja en el depósito.' : 'Registrar un ingreso de garantía.',
        to: '/warranties/new', icon: <ShieldCheck />, permission: 'warranties.create', tone: 'blue', group: 'Trabajo diario',
      },
      // Recepción en depósito: tile unificado para operadores de depósito (va a /warranties/deposito).
      // Para usuarios no-depósito (gestores) se mantienen tiles separados con rutas correctas.
      ...(depositUser
        ? [{
            title: 'Recepción en depósito',
            description: 'Confirmá remitos entrantes y gestioná movimientos entre depósitos.',
            to: '/warranties/deposito', icon: <PackageCheck />,
            anyPermission: ['warranties.remitos.receive', 'warranties.remitos.deposit_transfer'],
            tone: 'green' as const, group: 'Trabajo diario' as const,
          }]
        : [
            { title: 'Recibir remitos', description: 'Confirmar llegada de bultos al depósito.', to: '/warranties/remitos', icon: <PackageCheck />, permission: 'warranties.remitos.receive', tone: 'green' as const, group: 'Trabajo diario' as const },
            { title: 'Mover entre depósitos', description: 'Trasladar garantías desde tu depósito hacia otro depósito.', to: '/warranties/remitos', icon: <Truck />, permission: 'warranties.remitos.deposit_transfer', tone: 'amber' as const, group: 'Trabajo diario' as const },
          ]
      ),
      { title: 'Despachar a Chiclana', description: 'Generar remito interno desde tu sucursal.', to: '/warranties/sucursal', icon: <Send />, permission: 'warranties.remitos.dispatch', tone: 'amber', group: 'Trabajo diario' },

      // ── Seguimiento ───────────────────────────────────────────────────────
      {
        title: depositUser ? 'Garantías recibidas' : 'Mis garantías',
        description: depositUser ? 'Ver garantías registradas y recibidas en tu depósito.' : 'Ver las garantías de tu sucursal.',
        to: '/warranties', icon: <ShieldCheck />, permission: 'warranties.view', tone: 'blue', group: 'Seguimiento',
      },
      { title: 'Bandeja de ventas', description: 'Pendientes, en proceso y completadas.', to: '/venta/admin', icon: <Globe2 />, permission: 'sales_web.manage', tone: 'amber', group: 'Seguimiento' },
      { title: 'Dashboard de garantías', description: 'Métricas, estados y alertas del flujo.', to: '/warranties/dashboard', icon: <ShieldCheck />, anyPermission: ['warranties.dashboard', 'warranties.manage_provider', 'warranties.review'], tone: 'blue', group: 'Seguimiento' },
      { title: 'Panel gestor', description: 'Revisión interna, logística y comunicación con sucursales.', to: '/warranties/gestor', icon: <ClipboardList />, anyPermission: ['warranties.gestor.panel', 'warranties.manage'], tone: 'violet', group: 'Seguimiento' },
      { title: 'Mi sucursal — logística', description: 'Despachar equipos al depósito y ver tránsito.', to: '/warranties/sucursal', icon: <Truck />, permission: 'warranties.sucursal.logistics', tone: 'amber', group: 'Seguimiento' },
      { title: 'Revisión de garantías', description: 'Aprobar ingresos o pedir correcciones.', to: '/warranties/gestor', icon: <ClipboardList />, permission: 'warranties.review', tone: 'violet', group: 'Seguimiento' },
      { title: 'Gestión proveedor', description: 'ENV, mails, retiros y respuestas del proveedor.', to: '/warranties/gestion', icon: <Truck />, permission: 'warranties.manage_provider', tone: 'green', group: 'Seguimiento' },
      { title: 'Exportar garantías', description: 'Generar planilla para comunicar al proveedor.', to: '/warranties/export', icon: <Download />, permission: 'warranties.export', tone: 'amber', group: 'Seguimiento' },
      { title: 'Historial de remitos', description: 'Trazabilidad completa de todos los remitos internos.', to: '/warranties/remito-historial', icon: <FileText />, permission: 'warranties.remitos.view', tone: 'violet', group: 'Seguimiento' },
      { title: 'Precios y costos', description: 'Actualizaciones urgentes de productos.', to: '/precios-costos', icon: <CircleDollarSign />, anyPermission: ['price_updates.view', 'cost_updates.view'], tone: 'amber', group: 'Seguimiento' },

      // ── Administración ────────────────────────────────────────────────────
      { title: 'Usuarios y roles', description: 'Accesos, permisos y alcance operativo.', to: '/admin/users', icon: <UserCog />, anyPermission: ['users.view', 'roles.view'], tone: 'slate', group: 'Administración' },
      { title: 'Mi usuario', description: 'Perfil, permisos y datos laborales.', to: '/me', icon: <User />, permission: 'profile.view', tone: 'slate', group: 'Administración' },

      // ── Herramientas ──────────────────────────────────────────────────────
      { title: 'Herramientas internas', description: 'Automatizaciones y procesos controlados.', to: '/tools', icon: <Wrench />, permission: 'tools.view', tone: 'slate', group: 'Herramientas' },
      { title: 'Movimientos', description: 'Auditoría y actividad del sistema.', to: '/audit', icon: <History />, permission: 'audit.view', tone: 'slate', group: 'Herramientas' },
    ];

    return items.filter(allowed);
  }, [user]);

  const groupedAccess = useMemo(() => {
    const order: QuickAccess['group'][] = ['Trabajo diario', 'Seguimiento', 'Administración', 'Herramientas'];
    return order
      .map((group) => ({ group, items: quickAccess.filter((item) => item.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [quickAccess]);

  const groupedTools = useMemo(() => {
    const normalizedQuery = toolQuery.trim().toLowerCase();
    const filtered = normalizedQuery
      ? tools.filter((tool) => `${tool.name} ${tool.description} ${tool.category || ''}`.toLowerCase().includes(normalizedQuery))
      : tools;
    const map = new Map<string, ToolInfo[]>();
    for (const tool of filtered) {
      const key = tool.category || 'General';
      map.set(key, [...(map.get(key) || []), tool]);
    }
    return Array.from(map.entries());
  }, [tools, toolQuery]);

  const pendingMine = myRequests.filter((item) => ['Pendiente', 'En proceso'].includes(String(item.estado))).length;
  const pendingAdmin = adminRequests.filter((item) => String(item.estado) === 'Pendiente').length;
  const inProcessAdmin = adminRequests.filter((item) => String(item.estado) === 'En proceso').length;
  const unreadCount = notifications.length;

  return (
    <div className="space-y-8 pb-10">
      <section className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950/55 shadow-2xl shadow-black/10">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.5fr_0.9fr] lg:p-8">
          <div className="min-w-0">
            <BrandLogo brand={brand} size="md" />
            <div className="mt-8 inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-blue-100">
              {roleTitle(user?.role)}
            </div>
            <h1 className="mt-4 text-3xl font-black leading-tight text-white sm:text-5xl">{greeting()}, {firstName(user?.display_name || user?.username || 'usuario')}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">{dashboardLead(user)}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {(can('sales_web.view') || can('sales_web.manage')) && (
                <>
                  <HeroMetric label="Ventas activas" value={can('sales_web.manage') ? adminRequests.length : myRequests.length} />
                  <HeroMetric label="Pendientes" value={can('sales_web.manage') ? pendingAdmin : pendingMine} />
                </>
              )}
              <HeroMetric label="Notificaciones" value={unreadCount} />
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900/70 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Estado del sistema</div>
                <div className="mt-2 text-3xl font-black text-white">
                  {!status ? 'Sin conexión' : status.available ? 'Abierto' : status.mode === 'maintenance' ? 'Mantenimiento' : 'Cerrado'}
                </div>
              </div>
              {status?.available ? <CheckCircle2 className="text-green-300" size={30} /> : <AlertTriangle className="text-amber-300" size={30} />}
            </div>
            <p className="text-sm leading-6 text-slate-400">{status?.message || 'No se pudo conectar con el backend local.'}</p>
            {status && <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300"><Clock size={16} className="mr-2 inline text-blue-300" />Horario operativo: {status.open_time} a {status.close_time}</div>}
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}

      <section className="space-y-6">
        {groupedAccess.map(({ group, items }) => (
          <div key={group}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white sm:text-2xl">{group}</h2>
              <div className="hidden h-px flex-1 bg-slate-800 sm:block" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {items.map((item) => <AccessCard key={item.title} item={item} />)}
            </div>
          </div>
        ))}
      </section>

      {(can('sales_web.view') || can('notifications.view')) && (
        <section className="grid gap-4 xl:grid-cols-3">
          {can('sales_web.view') && (
            <WorkPanel
              title={can('sales_web.manage') ? 'Ventas' : 'Mis ventas'}
              icon={<Globe2 />}
              items={can('sales_web.manage')
                ? [
                    { label: 'Pendientes', value: pendingAdmin, to: '/venta/pendientes' },
                    { label: 'En proceso', value: inProcessAdmin, to: '/venta/admin?estado=En%20proceso' },
                    { label: 'Bandeja completa', value: adminRequests.length, to: '/venta/admin' },
                  ]
                : [
                    { label: 'Pendientes / en proceso', value: pendingMine, to: '/venta/mis-solicitudes' },
                    { label: 'Mis ventas activas', value: myRequests.length, to: '/venta/mis-solicitudes' },
                  ]}
            />
          )}

          {can('notifications.view') && (
            <div className="rounded-[2rem] border border-slate-800 bg-slate-950/60 p-5 xl:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Bell className="text-blue-300" /><h2 className="text-lg font-black">Notificaciones</h2></div>
                <Link to="/notificaciones" className="text-sm font-bold text-blue-300 hover:text-blue-200">Ver todas</Link>
              </div>
              <div className="space-y-3">
                {notifications.map((item) => (
                  <Link to="/notificaciones" key={item.id} className="block rounded-2xl bg-slate-900/70 p-3 text-sm hover:bg-slate-900">
                    <div className="font-bold text-white">{item.title}</div>
                    <div className="mt-1 text-slate-400">{item.message}</div>
                  </Link>
                ))}
                {!notifications.length && <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">No hay notificaciones pendientes.</div>}
              </div>
            </div>
          )}
        </section>
      )}

      {can('dashboard.view') && summary && (
        <section>
          <div className="mb-4">
            <h2 className="text-2xl font-black">Control interno</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatusCard title="Sistema" value={summary.status.available ? 'Abierto' : summary.status.mode === 'maintenance' ? 'Mantenimiento' : 'Cerrado'} detail={`${summary.status.open_time} a ${summary.status.close_time}`} ok={summary.status.available} icon={<Clock />} />
            <StatusCard title="Google" value={summary.google.credentials_file && summary.google.token_file ? 'Conectado' : 'Revisar'} detail="Credenciales y token" ok={summary.google.credentials_file && summary.google.token_file} icon={<Cloud />} />
            <StatusCard title="Usuarios activos" value={`${summary.counts.users_active}/${summary.counts.users_total}`} detail="usuarios habilitados" ok={summary.counts.users_active > 0} icon={<UserCog />} />
            <StatusCard title="Procesos" value={`${summary.counts.jobs_running} corriendo`} detail={`${summary.counts.jobs_errors_recent} errores recientes`} ok={summary.counts.jobs_errors_recent === 0} icon={<Wrench />} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-800 bg-slate-950/60 p-5">
              <h3 className="mb-4 text-lg font-black">Últimos movimientos</h3>
              <div className="space-y-3">
                {summary.recent_events.slice(0, 5).map((event) => (
                  <div key={event.id} className="rounded-2xl bg-slate-900/70 p-3 text-sm">
                    <div className="font-bold text-white">{event.event_type}</div>
                    <div className="text-slate-400">{event.actor_display_name || event.actor_username || 'Sistema'} · {formatDateTime(event.created_at)}</div>
                  </div>
                ))}
                {!summary.recent_events.length && <div className="text-sm text-slate-500">Sin movimientos recientes.</div>}
              </div>
            </div>
            <div className="rounded-[2rem] border border-slate-800 bg-slate-950/60 p-5">
              <h3 className="mb-4 text-lg font-black">Últimas ejecuciones</h3>
              <div className="space-y-3">
                {summary.recent_jobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="rounded-2xl bg-slate-900/70 p-3 text-sm">
                    <div className="flex justify-between gap-3"><span className="font-bold text-white">{job.tool_name}</span><span className="text-slate-400">{job.status}</span></div>
                    <div className="text-slate-400">{formatDateTime(job.created_at)}</div>
                  </div>
                ))}
                {!summary.recent_jobs.length && <div className="text-sm text-slate-500">Sin ejecuciones recientes.</div>}
              </div>
            </div>
          </div>
        </section>
      )}

      {can('tools.view') && (
        <section>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-black">Herramientas internas</h2>
            </div>
            <label className="relative block w-full lg:w-96">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={18} />
              <input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500"
                placeholder="Buscar herramienta..."
              />
            </label>
          </div>
          <div className="space-y-8">
            {groupedTools.map(([category, items]) => (
              <section key={category}>
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">{category}</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
                </div>
              </section>
            ))}
            {!groupedTools.length && <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 text-sm text-slate-500">No hay herramientas que coincidan con la búsqueda.</div>}
          </div>
        </section>
      )}
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>;
}

function AccessCard({ item }: { item: QuickAccess }) {
  const tone = item.tone || 'slate';
  const toneClass = {
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    green: 'border-green-500/30 bg-green-500/10 text-green-200',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    slate: 'border-slate-700 bg-slate-900/70 text-slate-200',
  }[tone];

  return (
    <Link to={item.to} className="group rounded-[1.6rem] border border-slate-800 bg-slate-950/60 p-5 transition hover:-translate-y-0.5 hover:border-blue-500/40 hover:bg-slate-900/80 hover:shadow-xl hover:shadow-black/20">
      <div className={`mb-4 inline-flex rounded-2xl border p-3 ${toneClass}`}>{item.icon}</div>
      <div className="text-lg font-black text-white group-hover:text-blue-100">{item.title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
    </Link>
  );
}

function WorkPanel({ title, icon, items }: { title: string; icon: ReactNode; items: Array<{ label: string; value: number; to: string }> }) {
  return (
    <div className="rounded-[2rem] border border-slate-800 bg-slate-950/60 p-5">
      <div className="mb-4 flex items-center gap-2 text-lg font-black"><span className="text-blue-300">{icon}</span>{title}</div>
      <div className="space-y-3">
        {items.map((item) => (
          <Link key={item.label} to={item.to} className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3 hover:bg-slate-900">
            <span className="text-sm font-bold text-slate-200">{item.label}</span>
            <span className="rounded-full bg-blue-500/20 px-3 py-1 text-sm font-black text-blue-200">{item.value}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusCard({ title, value, detail, ok, icon }: { title: string; value: string; detail: string; ok: boolean; icon: ReactNode }) {
  return (
    <div className="rounded-[2rem] border border-slate-800 bg-slate-950/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className={ok ? 'text-green-300' : 'text-amber-300'}>{icon}</div>
        {ok ? <CheckCircle2 className="text-green-300" size={18} /> : <AlertTriangle className="text-amber-300" size={18} />}
      </div>
      <div className="text-sm text-slate-400">{title}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function firstName(value: string) {
  return value.split(' ').filter(Boolean)[0] || value;
}

function formatDateTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}
