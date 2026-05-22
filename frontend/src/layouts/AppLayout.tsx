import {
  Activity, Archive, BarChart2, Bell, Building2, Calculator, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList, Cloud, FileSpreadsheet, FileText, Globe2, History, Home, Info, KeyRound, LayoutDashboard, LogOut, MapPin, Menu, PackageCheck, Settings, ShieldCheck, SlidersHorizontal, Truck, User, UserCog, Wrench, X,
} from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getBrandForUser } from '../brand';
import { BrandLogo } from '../components/BrandLogo';
import { PwaInstallPrompt } from '../components/PwaInstallPrompt';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { can, fetchNotifications, fetchSystemStatus, fetchUnreadNotificationsCount, getCurrentUserFromStorage, logout } from '../api/client';
import { cleanupPushNotifications, initPushNotifications } from '../services/pushNotifications';
import type { SystemPublicStatus } from '../types';
import { canSeeDepositReceivePage, canSeeGestorPanel, canSeeRemitoTracking, canSeeWarrantyConfig, canSeeWarrantyDashboard, canSeeWarrantyExport, canSeeWarrantyList, canSeeWarrantyProviderManagement, canSeeWarrantySync, canSeeSucursalLogistics, canUseRemitosHub, isCadeteDeposito, isPlainDepositOperator } from '../warrantyAccess';

type NavItemDef = {
  to: string;
  icon: ReactNode;
  label: string;
  permission?: string;
  anyPermission?: string[];
  visible?: boolean;
  exact?: boolean;
  children?: NavItemDef[];
};
type NavSectionDef = { title: string; items: NavItemDef[]; };

function basicCanSee(item: NavItemDef): boolean {
  if (item.visible === false) return false;
  if (item.permission && !can(item.permission)) return false;
  if (item.anyPermission?.length && !item.anyPermission.some((permission) => can(permission))) return false;
  return true;
}

function filterNavItem(item: NavItemDef): NavItemDef | null {
  if (item.visible === false) return null;
  if (item.children?.length) {
    const children = item.children.map(filterNavItem).filter(Boolean) as NavItemDef[];
    if (children.length === 0) return null;
    return { ...item, children };
  }
  return basicCanSee(item) ? item : null;
}

function itemIsActive(item: NavItemDef, pathname: string): boolean {
  if (item.children?.some((child) => itemIsActive(child, pathname))) return true;
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function roleLabel(user: ReturnType<typeof getCurrentUserFromStorage>) {
  if (!user) return '';
  return (user.roles && user.roles.length > 1) ? `${user.role} +${user.roles.length - 1}` : user.role;
}

function scopeLabel(user: ReturnType<typeof getCurrentUserFromStorage>) {
  if (!user) return '';
  const assignedCount = user.branches?.length || 0;
  if (user.company_name || user.branch_name || user.sucursal) {
    return `${user.company_name ? `${user.company_name} · ` : ''}${user.branch_name || user.sucursal}${assignedCount > 1 ? ` +${assignedCount - 1}` : ''}`;
  }
  if (String(user.role || '').toUpperCase().includes('ADMIN') || String(user.role || '').toUpperCase().includes('SUPER')) return 'Acceso global';
  return 'Alcance pendiente';
}

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<SystemPublicStatus | null>(null);
  const [unread, setUnread] = useState(0);
  const [lastNotificationId, setLastNotificationId] = useState<number | null>(null);
  const user = getCurrentUserFromStorage();
  const brand = getBrandForUser(user);

  useEffect(() => {
    initPushNotifications(navigate);
    return () => { cleanupPushNotifications(); };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadStatus = () => fetchSystemStatus().then((value) => { if (alive) setStatus(value); }).catch(() => { if (alive) setStatus(null); });
    loadStatus();
    const interval = window.setInterval(loadStatus, 30000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!can('notifications.view')) return;
    let alive = true;
    async function tick(showBrowser = true) {
      try {
        const count = await fetchUnreadNotificationsCount();
        if (!alive) return;
        setUnread(count.count);
        if (count.count > 0) {
          const list = await fetchNotifications(true);
          const newest = list[0];
          if (newest && newest.id !== lastNotificationId) {
            setLastNotificationId(newest.id);
            if (showBrowser && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(newest.title, { body: newest.message });
          }
        }
      } catch { if (alive) setUnread(0); }
    }
    tick(false);
    const interval = window.setInterval(() => tick(true), 10000);
    const onFocus = () => tick(true);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive = false; window.clearInterval(interval); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [lastNotificationId]);

  const navSections = useMemo<NavSectionDef[]>(() => {
    const canWorkSales = can('sales_web.manage') || can('sales_web.branch_manage') || can('sales_web.take') || can('sales_web.complete') || can('sales_web.send') || can('sales_web.cancel');
    const user = getCurrentUserFromStorage();
    const sections: NavSectionDef[] = [
      { title: 'Inicio', items: [
        { to: '/', icon: <Home size={18} />, label: 'Mi inicio', permission: 'profile.view', exact: true },
        { to: '/notificaciones', icon: <Bell size={18} />, label: unread > 0 ? `Notificaciones (${unread})` : 'Notificaciones', permission: 'notifications.view' },
      ] },
      { title: 'Operación', items: [
        { to: '/venta', icon: <Globe2 size={18} />, label: 'Ventas', children: [
          { to: '/venta/admin', icon: <Globe2 size={16} />, label: 'Bandeja', permission: 'sales_web.view', visible: canWorkSales },
          { to: '/venta/pendientes', icon: <Globe2 size={16} />, label: 'Pendientes', permission: 'sales_web.take' },
          { to: '/venta/nueva', icon: <Globe2 size={16} />, label: 'Nueva venta', permission: 'sales_web.create' },
          { to: '/venta/mis-solicitudes', icon: <Globe2 size={16} />, label: 'Mis ventas', permission: 'sales_web.view' },
          { to: '/budgets/new', icon: <Calculator size={16} />, label: 'Presupuestos', permission: 'budgets.view' },
        ] },
        { to: '/warranties', icon: <ShieldCheck size={18} />, label: 'Garantías', children: [
          { to: '/warranties/dashboard',  icon: <Activity size={16} />,         label: 'Panel',                   visible: canSeeWarrantyDashboard(user) },
          { to: '/warranties/gestor',     icon: <LayoutDashboard size={16} />,   label: 'Panel gestor',            visible: canSeeGestorPanel(user) },
          { to: '/warranties/sucursal',   icon: <MapPin size={16} />,            label: 'Mi sucursal',             visible: canSeeSucursalLogistics(user) },
          { to: '/warranties',            icon: <ShieldCheck size={16} />,       label: 'Listado',                 visible: canSeeWarrantyList(user), exact: true },
          { to: '/warranties/new',        icon: <ShieldCheck size={16} />,       label: 'Nueva garantía',          permission: 'warranties.create' },
          { to: '/warranties/gestion',    icon: <Building2 size={16} />,         label: 'Gestión',                 visible: canSeeWarrantyProviderManagement(user) },
          { to: '/warranties/deposito',          icon: <PackageCheck size={16} />,       label: 'Recepción depósito',      visible: canSeeDepositReceivePage(user) },
          { to: '/warranties/remitos',          icon: <Truck size={16} />,             label: 'Remitos',                 visible: !isPlainDepositOperator(user) && canUseRemitosHub(user) },
          { to: '/warranties/remito-historial', icon: <History size={16} />,           label: 'Historial de remitos',    visible: canSeeRemitoTracking(user) },
          { to: '/warranties/export',     icon: <FileSpreadsheet size={16} />,   label: 'Exportación',             visible: canSeeWarrantyExport(user) },
          { to: '/warranties/sync',       icon: <Cloud size={16} />,             label: 'Sincronización',          visible: canSeeWarrantySync(user) },
          { to: '/warranties/config',     icon: <SlidersHorizontal size={16} />, label: 'Configuración',           visible: canSeeWarrantyConfig(user) },
        ] },
      ] },
      { title: 'Gestión interna', items: [
        { to: '/productos', icon: <FileSpreadsheet size={18} />, label: 'Productos y proveedores', permission: 'products.view' },
        { to: '/precios-costos', icon: <CircleDollarSign size={18} />, label: 'Precios y costos', anyPermission: ['price_updates.view', 'cost_updates.view'] },
        { to: '/ventas-bi', icon: <BarChart2 size={18} />, label: 'Inteligencia comercial', children: [
          { to: '/ventas-bi/historial', icon: <History size={16} />, label: 'Historial', permission: 'sales_bi.view' },
          { to: '/ventas-bi/importar', icon: <FileSpreadsheet size={16} />, label: 'Importar planilla', permission: 'sales_bi.import' },
        ] },
        { to: '/recibos', icon: <FileText size={18} />, label: 'Recibos de sueldo', anyPermission: ['payroll_receipts.view_own', 'payroll_receipts.view_all', 'payroll_receipts.upload'] },
      ] },
      { title: 'Herramientas', items: [
        { to: '/tools', icon: <Wrench size={18} />, label: 'Herramientas internas', permission: 'tools.view' },
        { to: '/jobs', icon: <History size={18} />, label: 'Historial de procesos', permission: 'jobs.view' },
        { to: '/audit', icon: <ClipboardList size={18} />, label: 'Movimientos', permission: 'audit.view' },
      ] },
      { title: 'Administración', items: [
        { to: '/admin/users', icon: <UserCog size={18} />, label: 'Usuarios', permission: 'users.view' },
        { to: '/admin/roles', icon: <KeyRound size={18} />, label: 'Roles y permisos', permission: 'roles.view' },
        { to: '/admin/companies-branches', icon: <Building2 size={18} />, label: 'Empresas y sucursales', permission: 'branches.view' },
        { to: '/admin/operational-config', icon: <SlidersHorizontal size={18} />, label: 'Config. operativa', permission: 'ops_config.view' },
        { to: '/admin/google', icon: <Cloud size={18} />, label: 'Google', permission: 'google.manage' },
        { to: '/admin/backups', icon: <Archive size={18} />, label: 'Backups', permission: 'backups.view' },
        { to: '/admin/diagnostico', icon: <Activity size={18} />, label: 'Diagnóstico', permission: 'system.diagnostics.view' },
        { to: '/settings', icon: <Settings size={18} />, label: 'Config. técnica', permission: 'settings.view' },
      ] },
      { title: 'Cuenta', items: [
        { to: '/me', icon: <User size={18} />, label: 'Mi usuario', permission: 'profile.view' },
        { to: '/about', icon: <Info size={18} />, label: 'Acerca del sistema', permission: 'about.view' },
      ] },
    ];
    return sections
      .map((section) => ({ ...section, items: section.items.map(filterNavItem).filter(Boolean) as NavItemDef[] }))
      .filter((section) => section.items.length > 0);
  }, [unread]);

  const mobileQuickNav = useMemo<NavItemDef[]>(() => {
    const user = getCurrentUserFromStorage();
    const items: NavItemDef[] = [
      { to: '/', icon: <Home size={19} />, label: 'Inicio', permission: 'profile.view', exact: true },
      { to: '/venta/nueva', icon: <Globe2 size={19} />, label: 'Venta', permission: 'sales_web.create' },
      { to: '/venta/mis-solicitudes', icon: <ClipboardList size={19} />, label: 'Mis ventas', permission: 'sales_web.view' },
      { to: '/warranties/new', icon: <ShieldCheck size={19} />, label: 'Garantía', permission: 'warranties.create' },
      { to: '/warranties/sucursal', icon: <MapPin size={19} />, label: 'Sucursal', visible: canSeeSucursalLogistics(user) },
      { to: '/warranties/gestor', icon: <LayoutDashboard size={19} />, label: 'Gestor', visible: canSeeGestorPanel(user) },
      { to: '/warranties/deposito', icon: <PackageCheck size={19} />, label: 'Recepción', visible: canSeeDepositReceivePage(user) },
      { to: '/warranties/remitos',  icon: <Truck size={19} />,        label: 'Remitos',   visible: !isPlainDepositOperator(user) && canUseRemitosHub(user) },
      { to: '/warranties/gestion', icon: <Building2 size={19} />, label: 'Gestión', visible: canSeeWarrantyProviderManagement(user) },
      { to: '/precios-costos', icon: <CircleDollarSign size={19} />, label: 'Precios', anyPermission: ['price_updates.view', 'cost_updates.view'] },
      { to: '/notificaciones', icon: <Bell size={19} />, label: 'Avisos', permission: 'notifications.view' },
    ];
    return items.map(filterNavItem).filter(Boolean).slice(0, 5) as NavItemDef[];
  }, []);

  useEffect(() => {
    const activeGroups: Record<string, boolean> = {};
    for (const section of navSections) {
      for (const item of section.items) {
        if (item.children?.length && itemIsActive(item, location.pathname)) activeGroups[`${section.title}:${item.label}`] = true;
      }
    }
    if (Object.keys(activeGroups).length) setExpanded((prev) => ({ ...prev, ...activeGroups }));
  }, [location.pathname, navSections]);

  function doLogout() { logout(); navigate('/login'); }

  const shellBg = brand.key === 'abc'
    ? 'bg-[radial-gradient(circle_at_top_left,#0c5f7a_0,#081827_38%,#050914_100%)]'
    : 'bg-[radial-gradient(circle_at_top_left,#12365c_0,#08111f_38%,#050914_100%)]';

  return (
    <div className={`min-h-screen ${shellBg} text-slate-100`}>
      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/92 px-3 py-2 shadow-xl shadow-black/20 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setOpen(true)} className="touch-target rounded-2xl border border-slate-700 bg-slate-900/70 p-2.5 active:bg-slate-800" aria-label="Abrir menú"><Menu size={22} /></button>
          <div className="min-w-0 flex-1">
            <BrandLogo brand={brand} size="sm" className="min-w-0" />
            {user && <div className="mt-1 truncate text-[11px] font-semibold text-slate-500">{scopeLabel(user)}</div>}
          </div>
          {can('notifications.view') && <button onClick={() => navigate('/notificaciones')} className="touch-target relative rounded-2xl border border-slate-700 bg-slate-900/70 p-2.5 active:bg-slate-800" aria-label="Notificaciones"><Bell size={20} />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white">{unread}</span>}</button>}
        </div>
      </header>
      {open && <div className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed left-0 top-0 z-50 h-screen w-80 max-w-[92vw] overflow-y-auto border-r border-slate-800 bg-slate-950/95 p-4 shadow-2xl shadow-black/30 backdrop-blur transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'} lg:block`}>
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <BrandLogo brand={brand} size="md" />
            <button className="rounded-xl border border-slate-700 p-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={18} /></button>
          </div>
          <SystemPill status={status} />
          {user && (
            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/90 px-3 py-3 text-xs text-slate-300">
              <div className="truncate font-black text-white">{user.display_name}</div>
              <div className="mt-1 truncate text-slate-400">{user.username} · {roleLabel(user)}</div>
              <div className="mt-2 inline-flex max-w-full rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[11px] font-bold text-blue-100">
                <span className="truncate">{scopeLabel(user)}</span>
              </div>
            </div>
          )}
        </div>
        <nav className="mt-5 space-y-5 pb-24">
          {navSections.map((section) => <section key={section.title}>
            <div className="mb-2 px-3 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{section.title}</div>
            <div className="space-y-1.5">{section.items.map((item) => <NavEntry key={`${section.title}-${item.to}-${item.label}`} sectionTitle={section.title} item={item} expanded={expanded} setExpanded={setExpanded} onNavigate={() => setOpen(false)} />)}</div>
          </section>)}
        </nav>
        <button onClick={doLogout} className="sticky bottom-3 mt-4 flex w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-300 shadow-xl shadow-black/20 hover:bg-slate-900"><LogOut size={18} /> Salir</button>
      </aside>
      <main className="min-h-screen p-3 pb-40 sm:p-6 sm:pb-40 lg:ml-80 lg:p-8 lg:pb-8">{children}</main>
      <PwaInstallPrompt />
      <UpdatePrompt />
      <MobileQuickNav items={mobileQuickNav} unread={unread} />
    </div>
  );
}

function MobileQuickNav({ items, unread }: { items: NavItemDef[]; unread: number }) {
  if (!items.length) return null;
  return <nav className="mobile-bottom-nav lg:hidden" aria-label="Accesos rápidos">
    <div className="mobile-bottom-nav-inner">
      {items.map((item) => (
        <NavLink key={`${item.to}-${item.label}`} to={item.to} end={item.exact} className={({ isActive }) => `mobile-bottom-item ${isActive ? 'mobile-bottom-item-active' : ''}`}>
          <span className="relative">{item.icon}{item.to === '/notificaciones' && unread > 0 && <span className="mobile-bottom-badge">{unread}</span>}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  </nav>;
}

function SystemPill({ status }: { status: SystemPublicStatus | null }) {
  if (!status) return <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">Backend no disponible</div>;
  const cls = status.available ? 'border-green-500/40 bg-green-500/10 text-green-200' : status.mode === 'maintenance' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-slate-600 bg-slate-800 text-slate-200';
  return <div className={`mt-4 rounded-xl border px-3 py-2 text-xs font-bold ${cls}`}>{status.available ? 'Sistema abierto' : status.mode === 'maintenance' ? 'Mantenimiento' : 'Sistema cerrado'}</div>;
}

function NavEntry({ sectionTitle, item, expanded, setExpanded, onNavigate }: { sectionTitle: string; item: NavItemDef; expanded: Record<string, boolean>; setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>; onNavigate: () => void }) {
  const location = useLocation();
  const active = itemIsActive(item, location.pathname);
  if (item.children?.length) {
    const key = `${sectionTitle}:${item.label}`;
    const isOpen = expanded[key] ?? active;
    return <div>
      <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active ? 'bg-slate-800 text-white ring-1 ring-blue-500/30' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}>
        {item.icon}<span className="min-w-0 flex-1 truncate text-left">{item.label}</span>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {isOpen && <div className="ml-5 mt-1 space-y-1 border-l border-slate-800 pl-3">{item.children.map((child) => <NavItem key={`${key}-${child.to}-${child.label}`} {...child} onClick={onNavigate} compact />)}</div>}
    </div>;
  }
  return <NavItem {...item} onClick={onNavigate} />;
}

function NavItem({ to, icon, label, exact, onClick, compact = false }: NavItemDef & { onClick: () => void; compact?: boolean }) {
  return <NavLink to={to} end={exact} onClick={onClick} className={({ isActive }) => `flex items-center gap-3 rounded-2xl ${compact ? 'px-3 py-2.5 text-sm' : 'px-4 py-3 text-sm'} font-semibold transition ${isActive ? 'bg-blue-500 text-white shadow-lg shadow-blue-950/30' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}>{icon}<span className="truncate">{label}</span></NavLink>;
}
