import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { can, getCurrentUserFromStorage, getToken } from './api/client';
import { AppLayout } from './layouts/AppLayout';
import { canSeeDepositReceivePage, canSeeGestorPanel, canSeeRemitoTracking, canSeeSucursalLogistics, canSeeWarrantyConfig, canSeeWarrantyDashboard, canSeeWarrantyExport, canSeeWarrantyList, canSeeWarrantyProviderManagement, canSeeWarrantySync, canUseRemitosHub, isCadeteDeposito, isPlainDepositOperator } from './warrantyAccess';
import { AboutSystemPage } from './pages/AboutSystemPage';
import { AdminRolesPage } from './pages/AdminRolesPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { BackupsPage } from './pages/BackupsPage';
import { BudgetCreatePage } from './pages/BudgetCreatePage';
import { CompaniesBranchesPage } from './pages/CompaniesBranchesPage';
import { DashboardPage } from './pages/DashboardPage';
import { GoogleAdminPage } from './pages/GoogleAdminPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { JobsHistoryPage } from './pages/JobsHistoryPage';
import { LoginPage } from './pages/LoginPage';
import { MyUserPage } from './pages/MyUserPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PayrollReceiptsPage } from './pages/PayrollReceiptsPage';
import { PriceCostUpdatesPage } from './pages/PriceCostUpdatesPage';
import { ProductCatalogPage } from './pages/ProductCatalogPage';
import { OperationalConfigPage } from './pages/OperationalConfigPage';
import { SalesWebCreatePage } from './pages/SalesWebCreatePage';
import { SalesWebDetailPage } from './pages/SalesWebDetailPage';
import { SalesWebListPage } from './pages/SalesWebListPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { SystemDiagnosticsPage } from './pages/SystemDiagnosticsPage';
import { ToolRunPage } from './pages/ToolRunPage';
import { ToolsPage } from './pages/ToolsPage';
import { WarrantiesListPage } from './pages/WarrantiesListPage';
import { WarrantyCreatePage } from './pages/WarrantyCreatePage';
import { WarrantyDashboardPage } from './pages/WarrantyDashboardPage';
import { WarrantyDetailPage } from './pages/WarrantyDetailPage';
import { WarrantyManagementPage } from './pages/WarrantyManagementPage';
import { WarrantyExportPage } from './pages/WarrantyExportPage';
import { WarrantySyncPage } from './pages/WarrantySyncPage';
import { WarrantyConfigPage } from './pages/WarrantyConfigPage';
import { WarrantyGestorPage } from './pages/WarrantyGestorPage';
import { WarrantySucursalPage } from './pages/WarrantySucursalPage';
import { WarrantyDepositReceivePage } from './pages/WarrantyDepositReceivePage';
import { WarrantyRemitosPage } from './pages/WarrantyRemitosPage';
import { WarrantyRemitoTrackingPage } from './pages/WarrantyRemitoTrackingPage';
import { SalesBIImportPage } from './pages/SalesBIImportPage';
import { SalesBIHistoryPage } from './pages/SalesBIHistoryPage';
import { SalesBIDetailPage } from './pages/SalesBIDetailPage';

function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NoAccessPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-xl rounded-3xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-100">
        <div className="text-2xl font-black">Sin permisos suficientes</div>
        <p className="mt-2 text-sm text-amber-100/80">Tu usuario no tiene acceso a esta sección. Pedile a un administrador que revise tu rol.</p>
      </div>
    </AppLayout>
  );
}

function ProtectedLayout({ children, permission, anyPermission, allowed }: { children: ReactNode; permission?: string; anyPermission?: string[]; allowed?: () => boolean }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  const user = getCurrentUserFromStorage();
  if (user?.must_change_password) return <Navigate to="/set-password" replace />;
  if (permission && !can(permission)) return <NoAccessPage />;
  if (anyPermission?.length && !anyPermission.some((perm) => can(perm))) return <NoAccessPage />;
  if (allowed && !allowed()) return <NoAccessPage />;
  return <AppLayout>{children}</AppLayout>;
}

function defaultRedirect() {
  if (can('sales_web.manage') || can('sales_web.branch_manage')) return <Navigate to="/venta/admin" replace />;
  if (can('sales_web.view')) return <Navigate to="/venta/mis-solicitudes" replace />;
  if (can('price_updates.view') || can('cost_updates.view')) return <Navigate to="/precios-costos" replace />;
  if (can('payroll_receipts.view_own') || can('payroll_receipts.view_all')) return <Navigate to="/recibos" replace />;
  if (can('warranties.gestor.panel') || can('warranties.manage') || can('warranties.review')) return <Navigate to="/warranties/gestor" replace />;
  if (can('warranties.manage_provider')) return <Navigate to="/warranties/gestion" replace />;
  if (can('warranties.sucursal.logistics')) return <Navigate to="/warranties/sucursal" replace />;
  if (can('warranties.view')) return <Navigate to="/warranties" replace />;
  if (can('warranties.create')) return <Navigate to="/warranties/new" replace />;
  if (can('warranties.remitos.receive') || can('warranties.remitos.deposit_transfer')) {
    if (isPlainDepositOperator(getCurrentUserFromStorage())) return <Navigate to="/warranties/deposito" replace />;
  }
  if (can('warranties.remitos.deposit_transfer') || can('warranties.remitos.provider_delivery')) return <Navigate to="/warranties/remitos" replace />;
  if (can('budgets.view')) return <Navigate to="/budgets/new" replace />;
  return <NoAccessPage />;
}

function EntryPoint() {
  if (!getToken()) return <Navigate to="/login" replace />;
  const user = getCurrentUserFromStorage();
  if (user?.must_change_password) return <Navigate to="/set-password" replace />;
  // Encargado de Depósito → directo a su pantalla de recepción, sin pasar por el Dashboard
  if (isPlainDepositOperator(user)) return <Navigate to="/warranties/deposito" replace />;
  if (can('profile.view')) return <ProtectedLayout permission="profile.view"><DashboardPage /></ProtectedLayout>;
  return defaultRedirect();
}

function FallbackRoute() {
  if (!getToken()) return <Navigate to="/login" replace />;
  const user = getCurrentUserFromStorage();
  if (user?.must_change_password) return <Navigate to="/set-password" replace />;
  if (can('profile.view')) return <Navigate to="/" replace />;
  return defaultRedirect();
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<RequireAuth><SetPasswordPage /></RequireAuth>} />
      <Route path="/" element={<EntryPoint />} />
      <Route path="/me" element={<ProtectedLayout permission="profile.view"><MyUserPage /></ProtectedLayout>} />
      <Route path="/about" element={<ProtectedLayout permission="about.view"><AboutSystemPage /></ProtectedLayout>} />
      <Route path="/tools" element={<ProtectedLayout permission="tools.view"><ToolsPage /></ProtectedLayout>} />
      <Route path="/tools/:toolId" element={<ProtectedLayout permission="tools.view"><ToolRunPage /></ProtectedLayout>} />
      <Route path="/warranties" element={<ProtectedLayout allowed={() => canSeeWarrantyList(getCurrentUserFromStorage())}><WarrantiesListPage /></ProtectedLayout>} />
      <Route path="/warranties/dashboard" element={<ProtectedLayout allowed={() => canSeeWarrantyDashboard(getCurrentUserFromStorage())}><WarrantyDashboardPage /></ProtectedLayout>} />
      <Route path="/warranties/panel" element={<Navigate to="/warranties/dashboard" replace />} />
      <Route path="/warranties/new" element={<ProtectedLayout permission="warranties.create"><WarrantyCreatePage /></ProtectedLayout>} />
      <Route path="/warranties/revision" element={<Navigate to="/warranties/gestor" replace />} />
      <Route path="/warranties/review" element={<Navigate to="/warranties/gestor" replace />} />
      <Route path="/warranties/gestor" element={<ProtectedLayout allowed={() => canSeeGestorPanel(getCurrentUserFromStorage())}><WarrantyGestorPage /></ProtectedLayout>} />
      <Route path="/warranties/sucursal" element={<ProtectedLayout allowed={() => canSeeSucursalLogistics(getCurrentUserFromStorage())}><WarrantySucursalPage /></ProtectedLayout>} />
      <Route path="/warranties/gestion" element={<ProtectedLayout allowed={() => canSeeWarrantyProviderManagement(getCurrentUserFromStorage())}><WarrantyManagementPage /></ProtectedLayout>} />
      <Route path="/warranties/management" element={<Navigate to="/warranties/gestion" replace />} />
      <Route path="/warranties/export" element={<ProtectedLayout allowed={() => canSeeWarrantyExport(getCurrentUserFromStorage())}><WarrantyExportPage /></ProtectedLayout>} />
      <Route path="/warranties/exportar" element={<Navigate to="/warranties/export" replace />} />
      <Route path="/warranties/sync" element={<ProtectedLayout allowed={() => canSeeWarrantySync(getCurrentUserFromStorage())}><WarrantySyncPage /></ProtectedLayout>} />
      <Route path="/warranties/sincronizacion" element={<Navigate to="/warranties/sync" replace />} />
      <Route path="/warranties/config" element={<ProtectedLayout allowed={() => canSeeWarrantyConfig(getCurrentUserFromStorage())}><WarrantyConfigPage /></ProtectedLayout>} />
      <Route path="/warranties/configuracion" element={<Navigate to="/warranties/config" replace />} />
      <Route path="/warranties/deposito" element={<ProtectedLayout allowed={() => canSeeDepositReceivePage(getCurrentUserFromStorage())}><WarrantyDepositReceivePage /></ProtectedLayout>} />
      <Route path="/warranties/remitos" element={<ProtectedLayout allowed={() => canUseRemitosHub(getCurrentUserFromStorage())}><WarrantyRemitosPage /></ProtectedLayout>} />
      <Route path="/warranties/remito-historial" element={<ProtectedLayout allowed={() => canSeeRemitoTracking(getCurrentUserFromStorage())}><WarrantyRemitoTrackingPage /></ProtectedLayout>} />
      <Route path="/warranties/:warrantyId" element={<ProtectedLayout permission="warranties.view"><WarrantyDetailPage /></ProtectedLayout>} />
      <Route path="/budgets/new" element={<ProtectedLayout permission="budgets.view"><BudgetCreatePage /></ProtectedLayout>} />
      <Route path="/venta" element={<ProtectedLayout permission="sales_web.view"><SalesWebListPage /></ProtectedLayout>} />
      <Route path="/venta/admin" element={<ProtectedLayout permission="sales_web.view"><SalesWebListPage mode="admin" /></ProtectedLayout>} />
      <Route path="/venta/mis-solicitudes" element={<ProtectedLayout permission="sales_web.view"><SalesWebListPage mode="mine" /></ProtectedLayout>} />
      <Route path="/venta/pendientes" element={<ProtectedLayout permission="sales_web.take"><SalesWebListPage mode="admin" defaultEstado="Pendiente" /></ProtectedLayout>} />
      <Route path="/venta/nueva" element={<ProtectedLayout permission="sales_web.create"><SalesWebCreatePage /></ProtectedLayout>} />
      <Route path="/venta/:id" element={<ProtectedLayout permission="sales_web.view"><SalesWebDetailPage /></ProtectedLayout>} />
      <Route path="/ventas" element={<Navigate to="/venta" replace />} />
      <Route path="/ventas/admin" element={<Navigate to="/venta/admin" replace />} />
      <Route path="/ventas/mis-solicitudes" element={<Navigate to="/venta/mis-solicitudes" replace />} />
      <Route path="/ventas/pendientes" element={<Navigate to="/venta/pendientes" replace />} />
      <Route path="/ventas/nueva" element={<Navigate to="/venta/nueva" replace />} />
      <Route path="/ventas/:id" element={<ProtectedLayout permission="sales_web.view"><SalesWebDetailPage /></ProtectedLayout>} />
      <Route path="/solicitudes-venta-web" element={<Navigate to="/venta/admin" replace />} />
      <Route path="/solicitudes-venta-web/mis-solicitudes" element={<Navigate to="/venta/mis-solicitudes" replace />} />
      <Route path="/solicitudes-venta-web/pendientes" element={<Navigate to="/venta/pendientes" replace />} />
      <Route path="/solicitudes-venta-web/nueva" element={<Navigate to="/venta/nueva" replace />} />
      <Route path="/solicitudes-venta-web/:id" element={<ProtectedLayout permission="sales_web.view"><SalesWebDetailPage /></ProtectedLayout>} />
      <Route path="/ventas-bi" element={<ProtectedLayout permission="sales_bi.view"><SalesBIHistoryPage /></ProtectedLayout>} />
      <Route path="/ventas-bi/historial" element={<ProtectedLayout permission="sales_bi.view"><SalesBIHistoryPage /></ProtectedLayout>} />
      <Route path="/ventas-bi/importar" element={<ProtectedLayout permission="sales_bi.import"><SalesBIImportPage /></ProtectedLayout>} />
      <Route path="/ventas-bi/importaciones/:importId" element={<ProtectedLayout permission="sales_bi.view"><SalesBIDetailPage /></ProtectedLayout>} />
      <Route path="/notificaciones" element={<ProtectedLayout permission="notifications.view"><NotificationsPage /></ProtectedLayout>} />
      <Route path="/productos" element={<ProtectedLayout permission="products.view"><ProductCatalogPage /></ProtectedLayout>} />
      <Route path="/admin/productos" element={<Navigate to="/productos" replace />} />
      <Route path="/precios-costos" element={<ProtectedLayout anyPermission={["price_updates.view", "cost_updates.view"]}><PriceCostUpdatesPage /></ProtectedLayout>} />
      <Route path="/recibos" element={<ProtectedLayout anyPermission={["payroll_receipts.view_own", "payroll_receipts.view_all"]}><PayrollReceiptsPage /></ProtectedLayout>} />
      <Route path="/payroll" element={<Navigate to="/recibos" replace />} />
      <Route path="/price-cost-updates" element={<Navigate to="/precios-costos" replace />} />
      <Route path="/notifications" element={<Navigate to="/notificaciones" replace />} />
      <Route path="/jobs" element={<ProtectedLayout permission="jobs.view"><JobsHistoryPage /></ProtectedLayout>} />
      <Route path="/jobs/:jobId" element={<ProtectedLayout permission="jobs.view"><JobDetailPage /></ProtectedLayout>} />
      <Route path="/settings" element={<ProtectedLayout permission="settings.view"><SettingsPage /></ProtectedLayout>} />
      <Route path="/admin/operational-config" element={<ProtectedLayout permission="ops_config.view"><OperationalConfigPage /></ProtectedLayout>} />
      <Route path="/admin/companies-branches" element={<ProtectedLayout permission="branches.view"><CompaniesBranchesPage /></ProtectedLayout>} />
      <Route path="/admin/empresas-sucursales" element={<Navigate to="/admin/companies-branches" replace />} />
      <Route path="/admin/users" element={<ProtectedLayout permission="users.view"><AdminUsersPage /></ProtectedLayout>} />
      <Route path="/admin/roles" element={<ProtectedLayout permission="roles.view"><AdminRolesPage /></ProtectedLayout>} />
      <Route path="/admin/google" element={<ProtectedLayout permission="google.manage"><GoogleAdminPage /></ProtectedLayout>} />
      <Route path="/admin/backups" element={<ProtectedLayout permission="backups.view"><BackupsPage /></ProtectedLayout>} />
      <Route path="/admin/diagnostico" element={<ProtectedLayout permission="system.diagnostics.view"><SystemDiagnosticsPage /></ProtectedLayout>} />
      <Route path="/admin/diagnostics" element={<Navigate to="/admin/diagnostico" replace />} />
      <Route path="/audit" element={<ProtectedLayout permission="audit.view"><AuditLogPage /></ProtectedLayout>} />
      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  );
}
