import { ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

// Mapa de segmentos de path → etiqueta legible. Se mantiene chico a propósito:
// solo se cubren las rutas más visitadas. Para segmentos no mapeados se usa
// el segmento crudo (capitalizado).
const SEGMENT_LABELS: Record<string, string> = {
  '': 'Inicio',
  warranties: 'Garantías',
  dashboard: 'Panel',
  new: 'Nueva',
  gestor: 'Panel gestor',
  sucursal: 'Mi sucursal',
  gestion: 'Gestión',
  deposito: 'Recepción depósito',
  remitos: 'Remitos',
  'remito-historial': 'Historial de remitos',
  export: 'Exportación',
  sync: 'Sincronización',
  config: 'Configuración',
  venta: 'Ventas',
  ventas: 'Ventas',
  admin: 'Administración',
  'mis-solicitudes': 'Mis ventas',
  pendientes: 'Pendientes',
  nueva: 'Nueva venta',
  'ventas-bi': 'Inteligencia comercial',
  historial: 'Historial',
  importar: 'Importar planilla',
  vendedores: 'Vendedores',
  marcas: 'Marcas',
  lineas: 'Lineas',
  sucursales: 'Sucursales',
  importaciones: 'Importación',
  comercial: 'Comercial',
  'anuncios-precios': 'Anuncios de precios',
  notificaciones: 'Notificaciones',
  productos: 'Productos',
  'precios-costos': 'Precios y costos',
  recibos: 'Recibos de sueldo',
  tools: 'Herramientas',
  jobs: 'Procesos',
  settings: 'Configuración técnica',
  audit: 'Movimientos',
  budgets: 'Presupuestos',
  'companies-branches': 'Empresas y sucursales',
  users: 'Usuarios',
  roles: 'Roles y permisos',
  'operational-config': 'Config. operativa',
  google: 'Google',
  backups: 'Backups',
  diagnostico: 'Diagnóstico',
  me: 'Mi usuario',
  about: 'Acerca del sistema',
};

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // IDs numéricos o UUIDs → "Detalle"
  if (/^\d+$/.test(segment) || /^[0-9a-f-]{8,}$/i.test(segment)) return 'Detalle';
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  // En la ruta raíz, no mostramos breadcrumbs (la página ya dice "Inicio").
  if (segments.length === 0) return null;

  const items = segments.map((segment, idx) => {
    const href = '/' + segments.slice(0, idx + 1).join('/');
    return { href, label: labelFor(segment), isLast: idx === segments.length - 1 };
  });

  return (
    <nav className="erp-breadcrumbs" aria-label="Breadcrumb">
      <Link to="/">Inicio</Link>
      {items.map((item) => (
        <span key={item.href} className="contents">
          <ChevronRight size={12} className="erp-breadcrumbs-sep" aria-hidden="true" />
          {item.isLast ? (
            <span className="erp-breadcrumbs-current" aria-current="page">{item.label}</span>
          ) : (
            <Link to={item.href}>{item.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
