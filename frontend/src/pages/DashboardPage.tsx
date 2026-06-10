import {
  AlertTriangle,
  ArrowRight,
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
  Send,
  ShieldCheck,
  Truck,
  User,
  UserCog,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  can,
  fetchNotifications,
  fetchRemitos,
  fetchSalesWebRequests,
  fetchSystemStatus,
  fetchSystemSummary,
  fetchTools,
  fetchWarrantyDashboard,
  getCurrentUserFromStorage,
} from '../api/client';
import {
  ErpBadge,
  ErpCard,
  ErpInfoRow,
  ErpKpiCard,
  ErpNotice,
  ErpPageHeader,
  erpBtnPrimary,
  erpBtnSecondary,
  type ErpKpiVariant,
} from '../components/ProUI';
import { ToolCard } from '../components/ToolCard';
import type {
  NotificationInfo,
  SalesWebRequest,
  SystemPublicStatus,
  SystemSummary,
  ToolInfo,
  WarrantyDashboardMetrics,
  WarrantyRemitoInfo,
} from '../types';

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
  const [status, setStatus] = useState<SystemPublicStatus | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [warrantyMetrics, setWarrantyMetrics] = useState<WarrantyDashboardMetrics | null>(null);
  const [remitosTransito, setRemitosTransito] = useState<WarrantyRemitoInfo[]>([]);
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

    // KPIs operativos de garantías: usamos el endpoint del dashboard solo si el usuario
    // tiene visibilidad sobre el flujo (no romper si el rol no tiene permiso).
    if (can('warranties.view') || can('warranties.manage') || can('warranties.manage_provider') || can('warranties.review') || can('warranties.dashboard')) {
      fetchWarrantyDashboard()
        .then((value) => { if (alive) setWarrantyMetrics(value.metrics); })
        .catch(() => { if (alive) setWarrantyMetrics(null); });
    }

    if (can('warranties.remitos.view') || can('warranties.remitos.dispatch') || can('warranties.remitos.receive') || can('warranties.remitos.deposit_transfer')) {
      fetchRemitos({ status: 'en_transito', limit: 50 })
        .then((value) => { if (alive) setRemitosTransito(value.items || []); })
        .catch(() => { if (alive) setRemitosTransito([]); });
    }

    return () => { alive = false; };
  }, []);

  const quickAccess = useMemo(() => {
    const depositUser = isDepositUser(user);

    const items: QuickAccess[] = [
      // ── Trabajo diario ────────────────────────────────────────────────────
      { title: 'Nueva venta', description: 'Cargar datos para prefactura o remito.', to: '/venta/nueva', icon: <Globe2 />, permission: 'sales_web.create', tone: 'blue', group: 'Trabajo diario' },
      { title: 'Mis ventas', description: 'Seguimiento de ventas cargadas por vos.', to: '/venta/mis-solicitudes', icon: <ClipboardList />, permission: 'sales_web.view', tone: 'violet', group: 'Trabajo diario' },
      { title: 'Consulta de precios', description: 'Buscar productos, armar presupuesto rápido y compartir por WhatsApp.', to: '/consulta-precios', icon: <Calculator />, permission: 'budgets.view', tone: 'green', group: 'Trabajo diario' },
      {
        title: depositUser ? 'Cargar cliente en depósito' : 'Cargar garantía',
        description: depositUser ? 'Registrar mercadería que el cliente deja en el depósito.' : 'Registrar un ingreso de garantía.',
        to: '/warranties/new', icon: <ShieldCheck />, permission: 'warranties.create', tone: 'blue', group: 'Trabajo diario',
      },
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
      { title: 'Usuarios', description: 'Accesos, roles, permisos y alcance operativo.', to: '/administracion/usuarios', icon: <UserCog />, anyPermission: ['users.view', 'roles.view'], tone: 'slate', group: 'Administración' },
      { title: 'Empleados', description: 'Legajos, datos laborales y recibos.', to: '/administracion/empleados', icon: <UserCog />, permission: 'employees.view', tone: 'slate', group: 'Administración' },
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

  // ── KPIs operativos por rol/permisos ─────────────────────────────────────
  const showWarrantyKpis = !!warrantyMetrics;
  const showSalesKpis = can('sales_web.view') || can('sales_web.manage');
  const showRemitoKpis = can('warranties.remitos.view') || can('warranties.remitos.dispatch') || can('warranties.remitos.receive') || can('warranties.remitos.deposit_transfer');

  const alerts = useMemo(() => {
    const list: Array<{ tone: 'warning' | 'error'; title: string; body: string; cta: { label: string; to: string } }> = [];
    if (warrantyMetrics && warrantyMetrics.demoradas_15 > 0) {
      list.push({
        tone: 'error',
        title: `${warrantyMetrics.demoradas_15} garantías sin respuesta hace más de 15 días`,
        body: 'Requieren seguimiento con el proveedor o decisión del gestor.',
        cta: { label: 'Revisar demoradas', to: '/warranties/gestor' },
      });
    } else if (warrantyMetrics && warrantyMetrics.demoradas_7 > 0) {
      list.push({
        tone: 'warning',
        title: `${warrantyMetrics.demoradas_7} garantías superan los 7 días sin actualización`,
        body: 'Revisalas antes de que escalen a 15 días.',
        cta: { label: 'Ver en panel gestor', to: '/warranties/gestor' },
      });
    }
    if (warrantyMetrics && warrantyMetrics.pendientes_revision > 0 && can('warranties.review')) {
      list.push({
        tone: 'warning',
        title: `${warrantyMetrics.pendientes_revision} garantías esperando revisión`,
        body: 'Hay ingresos pendientes de aprobación o corrección.',
        cta: { label: 'Ir a revisión', to: '/warranties/gestor' },
      });
    }
    if (can('sales_web.manage') && pendingAdmin >= 5) {
      list.push({
        tone: 'warning',
        title: `${pendingAdmin} ventas web pendientes en bandeja`,
        body: 'Asigná responsables antes de que se acumulen.',
        cta: { label: 'Abrir bandeja', to: '/venta/pendientes' },
      });
    }
    return list;
  }, [warrantyMetrics, pendingAdmin]);

  const systemLabel = !status ? 'Sin conexión' : status.available ? 'Abierto' : status.mode === 'maintenance' ? 'Mantenimiento' : 'Cerrado';
  const systemVariant: ErpKpiVariant = !status ? 'danger' : status.available ? 'success' : status.mode === 'maintenance' ? 'alert' : 'default';

  // Resumen de remitos: agrupados por destino para ver carga logística
  const remitosByDestino = useMemo(() => {
    const map = new Map<string, number>();
    for (const remito of remitosTransito) {
      const key = remito.destino_deposito || 'Sin destino';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [remitosTransito]);

  const showOperationalSummary = showWarrantyKpis || showRemitoKpis;

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title={`${greeting()}, ${firstName(user?.display_name || user?.username || 'usuario')}`}
        description={dashboardLead(user)}
        actions={
          <>
            {can('warranties.create') && (
              <Link to="/warranties/new" className={erpBtnPrimary}>
                <ShieldCheck size={14} />
                <span>Nueva garantía</span>
              </Link>
            )}
            {can('sales_web.create') && (
              <Link to="/venta/nueva" className={erpBtnSecondary}>
                <Globe2 size={14} />
                <span>Nueva venta</span>
              </Link>
            )}
          </>
        }
      />

      {/* KPIs operativos role-aware. Siempre mostramos sistema + notificaciones,
          y agregamos garantías + remitos + ventas según permisos. */}
      <section className={`erp-kpi-row${(showWarrantyKpis ? 1 : 0) + (showSalesKpis ? 1 : 0) + (showRemitoKpis ? 1 : 0) >= 3 ? ' is-five' : ''}`} aria-label="Indicadores principales">
        {showWarrantyKpis && warrantyMetrics && (
          <>
            <ErpKpiCard
              label="Sin respuesta +15d"
              value={warrantyMetrics.demoradas_15}
              detail={warrantyMetrics.demoradas_15 > 0 ? 'Requieren acción inmediata' : 'Sin demoras críticas'}
              variant={warrantyMetrics.demoradas_15 > 0 ? 'danger' : 'success'}
              icon={<AlertTriangle size={13} />}
            />
            <ErpKpiCard
              label="Pendientes revisión"
              value={warrantyMetrics.pendientes_revision}
              detail={warrantyMetrics.pendientes_revision > 0 ? 'Esperan aprobación o corrección' : 'Al día'}
              variant={warrantyMetrics.pendientes_revision > 0 ? 'alert' : 'default'}
              icon={<ClipboardList size={13} />}
            />
            <ErpKpiCard
              label="En proveedor"
              value={warrantyMetrics.enviadas_proveedor}
              detail={`Resueltas en total: ${warrantyMetrics.resueltas}`}
              icon={<Truck size={13} />}
            />
          </>
        )}

        {showRemitoKpis && (
          <ErpKpiCard
            label="Remitos en tránsito"
            value={remitosTransito.length}
            detail={remitosTransito.length > 0 ? `${remitosByDestino.length} destinos activos` : 'No hay envíos abiertos'}
            variant={remitosTransito.length > 0 ? 'alert' : 'default'}
            icon={<Truck size={13} />}
          />
        )}

        {showSalesKpis && (
          <ErpKpiCard
            label={can('sales_web.manage') ? 'Ventas pendientes (bandeja)' : 'Mis ventas activas'}
            value={can('sales_web.manage') ? pendingAdmin : pendingMine}
            detail={can('sales_web.manage') ? `${inProcessAdmin} en proceso · ${adminRequests.length} totales` : `${myRequests.length} cargadas por vos`}
            variant={(can('sales_web.manage') ? pendingAdmin : pendingMine) > 0 ? 'alert' : 'default'}
            icon={<Globe2 size={13} />}
          />
        )}

        {!showWarrantyKpis && !showRemitoKpis && (
          <ErpKpiCard
            label="Estado del sistema"
            value={systemLabel}
            detail={status ? `Operativo de ${status.open_time} a ${status.close_time}` : 'No se pudo conectar al backend'}
            variant={systemVariant}
            icon={systemVariant === 'success' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          />
        )}

        <ErpKpiCard
          label="Notificaciones"
          value={unreadCount}
          detail={unreadCount > 0 ? 'Sin leer en tu bandeja' : 'Todo al día'}
          variant={unreadCount > 0 ? 'alert' : 'default'}
          icon={<Bell size={13} />}
        />
      </section>

      {/* Banner de alertas operativas. Sólo si hay condiciones críticas reales. */}
      {alerts.length > 0 && (
        <div className="erp-stack-2">
          {alerts.map((alert, idx) => (
            <ErpNotice
              key={idx}
              tone={alert.tone}
              title={alert.title}
              actions={
                <Link to={alert.cta.to} className="erp-btn erp-btn-secondary erp-btn-sm">
                  {alert.cta.label} <ArrowRight size={13} />
                </Link>
              }
            >
              {alert.body}
            </ErpNotice>
          ))}
        </div>
      )}

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      {/* Fila operativa: resumen por estado garantías + remitos por destino + ventas resumen */}
      {showOperationalSummary && (
        <div className="grid gap-4 xl:grid-cols-3">
          {showWarrantyKpis && warrantyMetrics && (
            <ErpCard title="Garantías por estado" subtitle="Foto actual del flujo" actions={<ShieldCheck size={14} aria-hidden="true" />}>
              <div className="erp-stack-2">
                <StatusLine label="Ingreso" value={warrantyMetrics.ingreso} to="/warranties?estado=INGRESADO" />
                <StatusLine label="En revisión interna" value={warrantyMetrics.en_revision} tone="violet" to="/warranties/gestor" />
                <StatusLine label="Enviadas al proveedor" value={warrantyMetrics.enviadas_proveedor} tone="info" to="/warranties/gestion" />
                <StatusLine label="Resueltas" value={warrantyMetrics.resueltas} tone="success" to="/warranties?estado=RESUELTA" />
                <StatusLine label="Rechazadas" value={warrantyMetrics.rechazadas} tone="danger" to="/warranties?estado=RECHAZADA" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[color:var(--divider)] pt-3">
                <SmallStat label="Promedio pendiente" value={`${warrantyMetrics.promedio_dias_pendiente.toFixed(1)} d`} />
                <SmallStat label="Promedio resolución" value={`${warrantyMetrics.promedio_resolucion.toFixed(1)} d`} />
              </div>
            </ErpCard>
          )}

          {showRemitoKpis && (
            <ErpCard
              title="Remitos en tránsito"
              subtitle={remitosTransito.length > 0 ? `${remitosTransito.length} envíos abiertos` : 'No hay envíos abiertos'}
              actions={<Truck size={14} aria-hidden="true" />}
            >
              {remitosByDestino.length === 0 && (
                <div className="text-[12.5px] text-[color:var(--text-3)]">No hay remitos en camino en este momento.</div>
              )}
              {remitosByDestino.length > 0 && (
                <div className="erp-stack-2">
                  {remitosByDestino.slice(0, 5).map(([destino, count]) => (
                    <StatusLine key={destino} label={destino} value={count} tone="info" to="/warranties/remito-historial" />
                  ))}
                  {remitosByDestino.length > 5 && (
                    <Link to="/warranties/remito-historial" className="erp-btn erp-btn-ghost erp-btn-sm w-full">
                      Ver todos los destinos
                    </Link>
                  )}
                </div>
              )}
            </ErpCard>
          )}

          {showSalesKpis && (
            <ErpCard
              title={can('sales_web.manage') ? 'Ventas web' : 'Mis ventas web'}
              subtitle="Estado de la bandeja"
              actions={<Globe2 size={14} aria-hidden="true" />}
            >
              <div className="erp-stack-2">
                {can('sales_web.manage') ? (
                  <>
                    <StatusLine label="Pendientes" value={pendingAdmin} tone={pendingAdmin > 0 ? 'warning' : undefined} to="/venta/pendientes" />
                    <StatusLine label="En proceso" value={inProcessAdmin} tone="info" to="/venta/admin?estado=En%20proceso" />
                    <StatusLine label="Total activas" value={adminRequests.length} to="/venta/admin" />
                  </>
                ) : (
                  <>
                    <StatusLine label="Pendientes / en proceso" value={pendingMine} tone={pendingMine > 0 ? 'warning' : undefined} to="/venta/mis-solicitudes" />
                    <StatusLine label="Mis ventas activas" value={myRequests.length} to="/venta/mis-solicitudes" />
                  </>
                )}
              </div>
            </ErpCard>
          )}
        </div>
      )}

      {/* Quick access — agrupado por categoría */}
      {groupedAccess.length > 0 && (
        <div className="erp-stack-6">
          {groupedAccess.map(({ group, items }) => (
            <div key={group}>
              <div className="mb-2 flex items-end justify-between gap-3">
                <h2 className="erp-section-title">{group}</h2>
                <ErpBadge tone="neutral" withDot={false}>{items.length}</ErpBadge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {items.map((item) => <AccessCard key={item.title} item={item} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actividad reciente + Notificaciones */}
      {(can('notifications.view') || (can('dashboard.view') && summary)) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {can('notifications.view') && (
            <ErpCard
              title="Notificaciones recientes"
              subtitle={unreadCount > 0 ? `${unreadCount} sin leer` : 'Bandeja al día'}
              actions={
                <Link to="/notificaciones" className="erp-btn erp-btn-ghost erp-btn-sm">
                  Ver todas <ArrowRight size={12} />
                </Link>
              }
            >
              {notifications.length === 0 && (
                <div className="text-[12.5px] text-[color:var(--text-3)]">No hay notificaciones pendientes.</div>
              )}
              <div className="erp-stack-2">
                {notifications.map((item) => (
                  <Link
                    key={item.id}
                    to="/notificaciones"
                    className="block rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-[12.5px] transition-colors hover:bg-[color:var(--surface-hover)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[color:var(--text)]">{item.title}</div>
                        <div className="mt-0.5 truncate text-[color:var(--text-2)]">{item.message}</div>
                      </div>
                      <ArrowRight size={12} className="mt-1 shrink-0 text-[color:var(--text-3)]" />
                    </div>
                  </Link>
                ))}
              </div>
            </ErpCard>
          )}

          {can('dashboard.view') && summary && (
            <ErpCard
              title="Actividad del sistema"
              subtitle="Últimos eventos y ejecuciones"
              actions={<History size={14} aria-hidden="true" />}
            >
              <div className="erp-stack-2">
                {summary.recent_events.slice(0, 4).map((event) => (
                  <div key={event.id} className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5 text-[12.5px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[color:var(--text)]">{event.event_type}</div>
                        <div className="text-[11.5px] text-[color:var(--text-2)]">{event.actor_display_name || event.actor_username || 'Sistema'}</div>
                      </div>
                      <div className="shrink-0 text-[11px] tabular-nums text-[color:var(--text-3)]">{formatRelative(event.created_at)}</div>
                    </div>
                  </div>
                ))}
                {summary.recent_events.length === 0 && (
                  <div className="text-[12.5px] text-[color:var(--text-3)]">Sin actividad reciente.</div>
                )}
              </div>
              {summary.recent_jobs.length > 0 && (
                <>
                  <hr className="erp-divider my-3" />
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-2">Últimas ejecuciones</div>
                  <div className="erp-stack-2">
                    {summary.recent_jobs.slice(0, 3).map((job) => (
                      <Link
                        key={job.id}
                        to={`/jobs/${job.id}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-[color:var(--surface-2)] p-2 text-[12px] transition-colors hover:bg-[color:var(--surface-hover)]"
                      >
                        <span className="min-w-0 truncate font-medium text-[color:var(--text)]">{job.tool_name}</span>
                        <ErpBadge tone={job.status === 'success' ? 'success' : job.status === 'error' ? 'danger' : job.status === 'running' ? 'info' : 'neutral'}>{job.status}</ErpBadge>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </ErpCard>
          )}
        </div>
      )}

      {/* Control interno (admin) */}
      {can('dashboard.view') && summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ErpKpiCard
            label="Sistema"
            value={summary.status.available ? 'Abierto' : summary.status.mode === 'maintenance' ? 'Mantenimiento' : 'Cerrado'}
            detail={`${summary.status.open_time} a ${summary.status.close_time}`}
            variant={summary.status.available ? 'success' : 'alert'}
            icon={<Clock size={13} />}
          />
          <ErpKpiCard
            label="Google"
            value={summary.google.credentials_file && summary.google.token_file ? 'Conectado' : 'Revisar'}
            detail="Credenciales + token"
            variant={summary.google.credentials_file && summary.google.token_file ? 'success' : 'alert'}
            icon={<Cloud size={13} />}
          />
          <ErpKpiCard
            label="Usuarios activos"
            value={`${summary.counts.users_active}/${summary.counts.users_total}`}
            detail="Habilitados sobre total"
            icon={<UserCog size={13} />}
          />
          <ErpKpiCard
            label="Procesos"
            value={`${summary.counts.jobs_running}`}
            detail={`${summary.counts.jobs_errors_recent} errores recientes`}
            variant={summary.counts.jobs_errors_recent > 0 ? 'danger' : 'default'}
            icon={<Wrench size={13} />}
          />
        </div>
      )}

      {/* Herramientas internas */}
      {can('tools.view') && (
        <ErpCard
          title="Herramientas internas"
          subtitle={`${tools.length} disponibles`}
          actions={
            <label className="relative block w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-3)]" size={14} />
              <input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                className="erp-input"
                style={{ paddingLeft: '32px' }}
                placeholder="Buscar herramienta..."
              />
            </label>
          }
        >
          <div className="erp-stack-4">
            {groupedTools.map(([category, items]) => (
              <div key={category}>
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">{category}</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
                </div>
              </div>
            ))}
            {!groupedTools.length && (
              <div className="text-[12.5px] text-[color:var(--text-3)]">
                {toolQuery ? 'Ninguna herramienta coincide con la búsqueda.' : 'No tenés herramientas habilitadas.'}
              </div>
            )}
          </div>
        </ErpCard>
      )}
    </div>
  );
}

function AccessCard({ item }: { item: QuickAccess }) {
  const tone = item.tone || 'slate';
  const iconBg: Record<string, string> = {
    blue: 'bg-[color:var(--primary-soft)] text-[color:var(--primary-soft-text)]',
    green: 'bg-[color:var(--success-soft)] text-[color:var(--success-soft-text)]',
    amber: 'bg-[color:var(--warning-soft)] text-[color:var(--warning-soft-text)]',
    violet: 'bg-[color:var(--violet-soft)] text-[color:var(--violet-soft-text)]',
    slate: 'bg-[color:var(--surface-2)] text-[color:var(--text-2)]',
  };
  return (
    <Link
      to={item.to}
      className="erp-card group flex flex-col gap-2 p-3 transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-hover)]"
      style={{ minHeight: '92px' }}
    >
      <div className="flex items-start gap-2.5">
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconBg[tone]}`} aria-hidden="true">
          {item.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold leading-tight text-[color:var(--text)] group-hover:text-white">{item.title}</div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-[1.45] text-[color:var(--text-2)]">{item.description}</p>
        </div>
      </div>
    </Link>
  );
}

function StatusLine({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'violet';
  to?: string;
}) {
  const toneCls: Record<string, string> = {
    success: 'text-[color:var(--success-soft-text)]',
    warning: 'text-[color:var(--warning-soft-text)]',
    danger: 'text-[color:var(--danger-soft-text)]',
    info: 'text-[color:var(--info-soft-text)]',
    violet: 'text-[color:var(--violet-soft-text)]',
  };
  const valueCls = tone ? toneCls[tone] : 'text-[color:var(--text)]';
  const content = (
    <>
      <span className="min-w-0 truncate text-[12.5px] font-medium text-[color:var(--text-2)]">{label}</span>
      <span className={`shrink-0 text-[14px] font-bold tabular-nums ${valueCls}`}>{value}</span>
    </>
  );
  const baseCls = 'flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors';
  if (to) {
    return (
      <Link to={to} className={`${baseCls} bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-hover)]`}>
        {content}
      </Link>
    );
  }
  return <div className={`${baseCls} bg-[color:var(--surface-2)]`}>{content}</div>;
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <ErpInfoRow label={label} value={value} />
  );
}

function firstName(value: string) {
  return value.split(' ').filter(Boolean)[0] || value;
}

function formatRelative(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
