import { useMemo, useState } from 'react';
import { Building2, FileSpreadsheet, Truck } from 'lucide-react';
import { can } from '../api/client';
import { ErpPageHeader } from '../components/ProUI';
import { WarrantyManagementPage } from './WarrantyManagementPage';
import { WarrantyRemitosPage } from './WarrantyRemitosPage';
import { WarrantyExportPage } from './WarrantyExportPage';

type PosventaTab = 'gestion' | 'proveedor' | 'exportacion';

/**
 * Espacio de trabajo de Posventa — consolida en una sola pantalla con tabs:
 *   - Gestión con proveedor (seguimiento, respuestas, reclamos, cambios de estado)
 *   - Entrega a proveedor (remito físico depósito → proveedor)
 *   - Exportación / ENV (lote de aviso al proveedor)
 *
 * Cada tab embebe la página existente (con `embedded` para ocultar su header
 * propio). Los tabs aparecen sólo si el usuario tiene el permiso correspondiente.
 */
export function WarrantyPosventaPage() {
  const tabs = useMemo(() => {
    const list: { key: PosventaTab; label: string; icon: typeof Building2 }[] = [];
    if (can('warranties.manage_provider') || can('warranties.change_status') || can('warranties.register_provider_response')) {
      list.push({ key: 'gestion', label: 'Gestión con proveedor', icon: Building2 });
    }
    if (can('warranties.remitos.provider_delivery')) {
      list.push({ key: 'proveedor', label: 'Entrega a proveedor', icon: Truck });
    }
    if (can('warranties.export')) {
      list.push({ key: 'exportacion', label: 'Exportación / ENV', icon: FileSpreadsheet });
    }
    return list;
  }, []);

  const [active, setActive] = useState<PosventaTab>(() => tabs[0]?.key || 'gestion');

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Posventa"
        description="Gestión con proveedor, entrega física y exportación de lotes — todo en un solo espacio."
      />

      {tabs.length > 1 && (
        <div className="erp-tab-bar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                className={`erp-tab ${active === tab.key ? 'is-active' : ''}`}
                onClick={() => setActive(tab.key)}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {active === 'gestion' && <WarrantyManagementPage embedded />}
      {active === 'proveedor' && <WarrantyRemitosPage embedded section="provider" />}
      {active === 'exportacion' && <WarrantyExportPage embedded />}
    </div>
  );
}
