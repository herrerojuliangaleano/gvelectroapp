import {
  Activity, Archive, BarChart2, Bell, Building2, Calculator, Camera, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList, Cloud, FileSpreadsheet, FileText, Globe2, History, Home, IdCard, Info, KeyRound, LayoutDashboard, LogOut, MapPin, Megaphone, Menu, MoreHorizontal, PackageCheck, Settings, ShieldCheck, SlidersHorizontal, TrendingUp, Truck, User, UserCog, Users, Wrench, X,
} from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getBrandForUser } from '../brand';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { MobileFabProvider } from '../components/MobileFab';
import { Topbar } from '../components/Topbar';
import { PwaInstallPrompt } from '../components/PwaInstallPrompt';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { useEdgeSwipe } from '../hooks/useEdgeSwipe';
import { can, fetchNotifications, fetchSystemStatus, fetchUnreadNotificationsCount, getCurrentUserFromStorage, logout } from '../api/client';
import { cleanupPushNotifications, initPushNotifications } from '../services/pushNotifications';
import type { SystemPublicStatus } from '../types';
import { canSeeDepositReceivePage, canSeeGestorPanel, canSeeRemitoTracking, canSeeWarrantyConfig, canSeeWarrantyDashboard, canSeeWarrantyExport, canSeeWarrantyList, canSeeWarrantyProviderManagement, canSeeWarrantySync, canSeeSucursalLogistics, canUseRemitosHub, isCadeteDeposito, isPlainDepositOperator } from '../warrantyAccess';
import { canCrossSelectBranches } from '../branchAccess';
import { canUsePriceAnnouncements } from '../priceAnnouncementsAccess';

type NavItemDef = {
  to: string;
  icon: ReactNode;
  label: string;
  permission?: string;
  anyPermission?: string[];
  visible?: boolean;
  exact?: boolean;
  children?: NavItemDef[];
  count?: number;
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
    const base = `${user.company_name ? `${user.company_name} · ` : ''}${user.branch_name || user.sucursal}${assignedCount > 1 ? ` +${assignedCount - 1}` : ''}`;
    // Si tiene permiso para cruzar sucursales, lo marcamos sutilmente en el label.
    if (canCrossSelectBranches(user) && assignedCount > 0) {
      return `${base} · multi-sucursal`;
    }
    return base;
  }
  // Sin sucursal asignada pero con permiso de cruzar sucursales = acceso global por permisos.
  if (canCrossSelectBranches(user)) return 'Acceso global';
  return 'Alcance pendiente';
}

function userInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || name[0]?.toUpperCase() || '?';
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
        { to: '/', icon: <Home size={16} />, label: 'Mi inicio', permission: 'profile.view', exact: true },
        { to: '/notificaciones', icon: <Bell size={16} />, label: 'Notificaciones', permission: 'notifications.view', count: unread },
      ] },
      { title: 'Operación', items: [
        { to: '/venta', icon: <Globe2 size={16} />, label: 'Ventas', children: [
          { to: '/venta/admin', icon: <Globe2 size={14} />, label: 'Bandeja', permission: 'sales_web.view', visible: canWorkSales },
          { to: '/venta/pendientes', icon: <Globe2 size={14} />, label: 'Pendientes', permission: 'sales_web.take' },
          { to: '/venta/nueva', icon: <Globe2 size={14} />, label: 'Nueva venta', permission: 'sales_web.create' },
          { to: '/venta/mis-solicitudes', icon: <Globe2 size={14} />, label: 'Mis ventas', permission: 'sales_web.view' },
          { to: '/consulta-precios', icon: <Calculator size={14} />, label: 'Consulta de precios', permission: 'budgets.view' },
        ] },
        { to: '/warranties', icon: <ShieldCheck size={16} />, label: 'Garantías', children: [
          // ── Núcleo operativo (el flujo: sucursal → gestor → posventa) ──
          // Espacio operativo unificado: sucursal o depósito según el perfil.
          { to: '/warranties/mi-espacio', icon: <MapPin size={14} />,            label: 'Mi espacio',              visible: canSeeSucursalLogistics(user) || canSeeDepositReceivePage(user) },
          // Revisor: el puente entre sucursal y posventa (aprueba/corrige ingresos).
          { to: '/warranties/gestor',     icon: <LayoutDashboard size={14} />,   label: 'Panel gestor',            visible: canSeeGestorPanel(user) },
          // Posventa consolidado: gestión proveedor + entrega + exportación.
          { to: '/warranties/posventa',   icon: <Building2 size={14} />,         label: 'Posventa',                visible: canSeeWarrantyProviderManagement(user) || canSeeWarrantyExport(user) },
          { to: '/warranties/new',        icon: <ShieldCheck size={14} />,       label: 'Carga masiva',            permission: 'warranties.create' },
          // ── Consulta / global (no operativo: ver el panorama) ──
          { to: '/warranties',            icon: <ShieldCheck size={14} />,       label: 'Listado',                 visible: canSeeWarrantyList(user), exact: true },
          { to: '/warranties/dashboard',  icon: <Activity size={14} />,          label: 'Métricas',                visible: canSeeWarrantyDashboard(user) },
          { to: '/warranties/remito-historial', icon: <History size={14} />,           label: 'Historial de remitos',    visible: canSeeRemitoTracking(user) },
          // ── Administración del módulo ──
          { to: '/warranties/sync',       icon: <Cloud size={14} />,             label: 'Sincronización',          visible: canSeeWarrantySync(user) },
          // /warranties/config se consolidó en /admin/operational-config?tab=garantias (Fase A).
          { to: '/admin/operational-config?tab=garantias', icon: <SlidersHorizontal size={14} />, label: 'Configuración',           visible: canSeeWarrantyConfig(user) },
        ] },
      ] },
      { title: 'Comercial', items: [
        { to: '/comercial/psi', icon: <TrendingUp size={16} />, label: 'PSI · Planificación', permission: 'psi.view' },
        { to: '/comercial/anuncios-precios', icon: <Megaphone size={16} />, label: 'Anuncios de precios', visible: canUsePriceAnnouncements(user) },
        { to: '/ventas-bi', icon: <BarChart2 size={16} />, label: 'Inteligencia comercial', children: [
          { to: '/ventas-bi/marcas', icon: <BarChart2 size={14} />, label: 'Marcas', permission: 'sales_bi.view' },
          { to: '/ventas-bi/lineas', icon: <TrendingUp size={14} />, label: 'Categorias', permission: 'sales_bi.view' },
          { to: '/ventas-bi/sucursales', icon: <Building2 size={14} />, label: 'Sucursales', permission: 'sales_bi.view' },
          { to: '/ventas-bi/vendedores', icon: <Users size={14} />, label: 'Vendedores', permission: 'sales_bi.view' },
          { to: '/ventas-bi/historial', icon: <History size={14} />, label: 'Historial', permission: 'sales_bi.view' },
          { to: '/ventas-bi/importar', icon: <FileSpreadsheet size={14} />, label: 'Importar planilla diaria', permission: 'sales_bi.import' },
          { to: '/ventas-bi/comercial/importar', icon: <FileSpreadsheet size={14} />, label: 'Importar Ventas Vs Costos', permission: 'sales_bi.import' },
        ] },
      ] },
      { title: 'Gestión interna', items: [
        { to: '/productos', icon: <FileSpreadsheet size={16} />, label: 'Productos y proveedores', permission: 'products.view' },
        { to: '/precios-costos', icon: <CircleDollarSign size={16} />, label: 'Precios y costos', anyPermission: ['price_updates.view', 'cost_updates.view'] },
        { to: '/recibos', icon: <FileText size={16} />, label: 'Recibos de sueldo', anyPermission: ['payroll_receipts.view_own', 'payroll_receipts.view_all', 'payroll_receipts.upload'] },
      ] },
      { title: 'Herramientas', items: [
        { to: '/tools', icon: <Wrench size={16} />, label: 'Herramientas internas', permission: 'tools.view' },
        { to: '/jobs', icon: <History size={16} />, label: 'Historial de procesos', permission: 'jobs.view' },
        { to: '/audit', icon: <ClipboardList size={16} />, label: 'Movimientos', permission: 'audit.view' },
      ] },
      { title: 'Administración', items: [
        { to: '/administracion/usuarios', icon: <UserCog size={16} />, label: 'Usuarios', permission: 'users.view' },
        { to: '/administracion/empleados', icon: <IdCard size={16} />, label: 'Empleados', permission: 'employees.view' },
        { to: '/administracion/fotos', icon: <Camera size={16} />, label: 'Fotos profesionales', permission: 'employees.photo.approve' },
        { to: '/admin/roles', icon: <KeyRound size={16} />, label: 'Roles y permisos', permission: 'roles.view' },
        { to: '/admin/companies-branches', icon: <Building2 size={16} />, label: 'Empresas y sucursales', permission: 'branches.view' },
        { to: '/admin/operational-config', icon: <SlidersHorizontal size={16} />, label: 'Configuración', permission: 'ops_config.view' },
        // /admin/google se consolidó como tab "OAuth Google" en operational-config (Fase A).
        // /settings se consolidó como tab "Sistema" en operational-config (Fase A).
        { to: '/admin/backups', icon: <Archive size={16} />, label: 'Backups', permission: 'backups.view' },
        { to: '/admin/diagnostico', icon: <Activity size={16} />, label: 'Diagnóstico', permission: 'system.diagnostics.view' },
      ] },
      { title: 'Cuenta', items: [
        { to: '/me', icon: <User size={16} />, label: 'Mi usuario', permission: 'profile.view' },
        { to: '/mi-legajo', icon: <IdCard size={16} />, label: 'Mi legajo', permission: 'profile.view' },
        { to: '/about', icon: <Info size={16} />, label: 'Acerca del sistema', permission: 'about.view' },
      ] },
    ];
    return sections
      .map((section) => ({ ...section, items: section.items.map(filterNavItem).filter(Boolean) as NavItemDef[] }))
      .filter((section) => section.items.length > 0);
  }, [unread]);

  const mobileQuickNav = useMemo<NavItemDef[]>(() => {
    const user = getCurrentUserFromStorage();
    // 4 ítems prioritarios mobile (estilo mockup): Inicio · Garantías · Remitos · Reportes.
    // Los demás accesos viven en "Más" (botón del bottom nav).
    const items: NavItemDef[] = [
      { to: '/', icon: <Home size={19} />, label: 'Inicio', permission: 'profile.view', exact: true },
      // Garantías: para roles que las cargan, el link va a "Nueva"; para gestor al panel.
      ...(can('warranties.create')
        ? [{ to: '/warranties/new', icon: <ShieldCheck size={19} />, label: 'Garantía', permission: 'warranties.create' }]
        : []
      ),
      ...(!can('warranties.create') && canSeeGestorPanel(user)
        ? [{ to: '/warranties/gestor', icon: <LayoutDashboard size={19} />, label: 'Garantías', visible: canSeeGestorPanel(user) }]
        : []
      ),
      ...(!can('warranties.create') && !canSeeGestorPanel(user) && canSeeWarrantyList(user)
        ? [{ to: '/warranties', icon: <ShieldCheck size={19} />, label: 'Garantías', visible: canSeeWarrantyList(user), exact: true }]
        : []
      ),
      // Espacio operativo / posventa: depósito y sucursal van a "Mi espacio";
      // posventa a su pantalla; el resto al historial de remitos.
      ...(canSeeDepositReceivePage(user) || canSeeSucursalLogistics(user)
        ? [{ to: '/warranties/mi-espacio', icon: <PackageCheck size={19} />, label: 'Mi espacio', visible: true }]
        : (canSeeWarrantyProviderManagement(user) || canSeeWarrantyExport(user))
          ? [{ to: '/warranties/posventa', icon: <Building2 size={19} />, label: 'Posventa', visible: true }]
          : canSeeRemitoTracking(user)
            ? [{ to: '/warranties/remito-historial', icon: <Truck size={19} />, label: 'Remitos', visible: true }]
            : []
      ),
      // Reportes / BI
      ...(can('sales_bi.view')
        ? [{ to: '/ventas-bi/marcas', icon: <BarChart2 size={19} />, label: 'Reportes', permission: 'sales_bi.view' }]
        : canSeeWarrantyDashboard(user)
          ? [{ to: '/warranties/dashboard', icon: <BarChart2 size={19} />, label: 'Reportes', visible: true }]
          : []
      ),
      // Fallback: ventas web
      { to: '/venta', icon: <Globe2 size={19} />, label: 'Ventas', permission: 'sales_web.view' },
    ];
    return items.map(filterNavItem).filter(Boolean).slice(0, 4) as NavItemDef[];
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

  const systemPillState = !status
    ? { className: 'erp-sidebar-status erp-sidebar-status-err', label: 'Backend no disponible' }
    : status.available
      ? { className: 'erp-sidebar-status erp-sidebar-status-ok', label: 'Sistema abierto' }
      : status.mode === 'maintenance'
        ? { className: 'erp-sidebar-status erp-sidebar-status-warn', label: 'En mantenimiento' }
        : { className: 'erp-sidebar-status', label: 'Sistema cerrado' };

  // Swipe gestures (mobile): borde izquierdo abre el menú, swipe-left dentro lo cierra.
  const sidebarRef = useRef<HTMLElement | null>(null);
  const isMobile = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches;
  useEdgeSwipe({
    edge: 'left',
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
    drawerRef: sidebarRef,
    isOpen: open,
    disabled: !isMobile,
  });

  // Saludo corto para el header mobile.
  const mobileGreeting = useMemo(() => {
    const hour = new Date().getHours();
    const tod = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
    const first = user ? (user.display_name || user.username || '').split(' ')[0] : '';
    return first ? `${tod}, ${first}` : tod;
  }, [user]);

  // Estado de conexión (banner offline).
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    function onOnline() { setOnline(true); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <div className={`erp-shell ${open ? 'is-drawer-open' : ''}`}>
      {/* Banner global de conexión (no se muestra si hay sesión normal con red) */}
      {!online && (
        <div className="erp-global-banner is-error" role="status" aria-live="polite">
          <span aria-hidden="true">⚠</span>
          <span>Sin conexión a internet. Algunas acciones pueden fallar hasta que se restablezca.</span>
        </div>
      )}
      {/* Banner "sistema cerrado / mantenimiento" eliminado: la info ya está
          visible en el topbar (chip de estado) y en el sidebar ("Sistema cerrado"),
          y aparecía siempre fuera del horario 09:00–16:00 generando ruido visual
          permanente. Solo se mantiene el banner offline (arriba) que sí es crítico. */}
      {/* Header móvil estilo ERP (lg:hidden) */}
      <header className="erp-mobile-header lg:hidden" role="banner">
        <button
          onClick={() => setOpen(true)}
          className="erp-mobile-header-grip"
          aria-label="Abrir menú"
          title="Abrir menú (también podés deslizar desde el borde izquierdo)"
        >
          <Menu size={18} />
        </button>
        <div className="erp-mobile-header-text">
          <span className="erp-mobile-header-title">{mobileGreeting}</span>
          {user && <span className="erp-mobile-header-sub">{scopeLabel(user)}</span>}
        </div>
        {can('notifications.view') && (
          <button
            onClick={() => navigate('/notificaciones')}
            className="erp-mobile-header-bell"
            aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="erp-mobile-header-bell-dot">{unread > 99 ? '99+' : unread}</span>
            )}
          </button>
        )}
      </header>

      {open && <div className="erp-sidebar-overlay lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      {/* Sidebar — drawer mobile (overlay) + fijo en desktop (estilo ERP nuevo) */}
      <aside
        ref={sidebarRef}
        className={`erp-sidebar transition-transform ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        aria-label="Navegación principal"
      >
        <div className="erp-sidebar-header">
          <span
            className="erp-sidebar-brand-dot"
            style={{ background: brand.accentDark, boxShadow: `0 0 0 3px ${brand.accentDark}33` }}
            aria-hidden="true"
          />
          <div className="erp-sidebar-brand-text">
            <span className="erp-sidebar-brand-name">{brand.name}</span>
            <span className="erp-sidebar-brand-sub">{brand.subtitle}</span>
          </div>
          <button
            className="ml-auto rounded-md border border-slate-700 p-1.5 text-slate-300 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            <X size={16} />
          </button>
        </div>

        <span className={systemPillState.className}>
          <span className="erp-sidebar-status-dot" aria-hidden="true" />
          <span>{systemPillState.label}</span>
        </span>

        <nav className="erp-sidebar-nav">
          {navSections.map((section) => (
            <div key={section.title} className="erp-sidebar-section">
              <div className="erp-sidebar-section-title">{section.title}</div>
              {section.items.map((item) => (
                <SidebarEntry
                  key={`${section.title}-${item.to}-${item.label}`}
                  sectionTitle={section.title}
                  item={item}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="erp-sidebar-footer">
          <div className="erp-sidebar-avatar" aria-hidden="true">{userInitials(user?.display_name || user?.username || '?')}</div>
          <div className="erp-sidebar-user">
            <span className="erp-sidebar-user-name">{user?.display_name || user?.username || 'Sin sesión'}</span>
            <span className="erp-sidebar-user-meta">{roleLabel(user)} · {scopeLabel(user)}</span>
          </div>
          <button className="erp-sidebar-logout" onClick={doLogout} aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* Main: topbar + breadcrumbs + content */}
      <div className="erp-main">
        <Topbar
          user={user}
          status={status}
          unread={unread}
          canSeeNotifications={can('notifications.view')}
          branchLabel={scopeLabel(user)}
        />
        <MobileFabProvider>
          <main className="erp-content">
            <div className="hidden lg:block">
              <Breadcrumbs />
            </div>
            {children}
          </main>
        </MobileFabProvider>
      </div>

      <PwaInstallPrompt />
      <UpdatePrompt />
      <MobileQuickNav items={mobileQuickNav} unread={unread} onOpenMenu={() => setOpen(true)} />
    </div>
  );
}

function MobileQuickNav({ items, unread, onOpenMenu }: { items: NavItemDef[]; unread: number; onOpenMenu: () => void }) {
  // Garantizamos 5 slots: 4 ítems prioritarios + "Más" que abre el sidebar.
  // Si el usuario tiene menos de 4 accesos, dejamos los que haya + el botón "Más".
  const prioritized = items.slice(0, 4);
  const slots = prioritized.length + 1;
  return (
    <nav className="mobile-bottom-nav lg:hidden" aria-label="Accesos rápidos" style={{ ['--mobile-nav-count' as any]: slots }}>
      <div className="mobile-bottom-nav-inner" style={{ ['--mobile-nav-count' as any]: slots }}>
        {prioritized.map((item) => (
          <NavLink key={`${item.to}-${item.label}`} to={item.to} end={item.exact} className={({ isActive }) => `mobile-bottom-item ${isActive ? 'mobile-bottom-item-active' : ''}`}>
            <span className="relative">{item.icon}{item.to === '/notificaciones' && unread > 0 && <span className="mobile-bottom-badge">{unread}</span>}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={onOpenMenu} className="mobile-bottom-item" aria-label="Abrir menú completo" title="Más opciones · podés deslizar desde el borde izquierdo">
          <span className="relative"><MoreHorizontal size={19} /></span>
          <span>Más</span>
        </button>
      </div>
    </nav>
  );
}

function SidebarEntry({ sectionTitle, item, expanded, setExpanded, onNavigate }: { sectionTitle: string; item: NavItemDef; expanded: Record<string, boolean>; setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>; onNavigate: () => void }) {
  const location = useLocation();
  const active = itemIsActive(item, location.pathname);
  if (item.children?.length) {
    const key = `${sectionTitle}:${item.label}`;
    const isOpen = expanded[key] ?? active;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
          className={`erp-sidebar-item ${active ? 'is-active' : ''} w-full text-left`}
          aria-expanded={isOpen}
        >
          <span className="erp-sidebar-icon">{item.icon}</span>
          <span className="erp-sidebar-label">{item.label}</span>
          <ChevronRight size={14} className={`erp-sidebar-chevron ${isOpen ? 'is-open' : ''}`} />
        </button>
        {isOpen && (
          <div className="erp-sidebar-subnav">
            {item.children.map((child) => (
              <SidebarLink key={`${key}-${child.to}-${child.label}`} item={child} onClick={onNavigate} />
            ))}
          </div>
        )}
      </div>
    );
  }
  return <SidebarLink item={item} onClick={onNavigate} />;
}

function SidebarLink({ item, onClick }: { item: NavItemDef; onClick: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      onClick={onClick}
      className={({ isActive }) => `erp-sidebar-item ${isActive ? 'is-active' : ''}`}
    >
      <span className="erp-sidebar-icon">{item.icon}</span>
      <span className="erp-sidebar-label">{item.label}</span>
      {typeof item.count === 'number' && item.count > 0 && (
        <span className="erp-sidebar-count">{item.count > 99 ? '99+' : item.count}</span>
      )}
    </NavLink>
  );
}
