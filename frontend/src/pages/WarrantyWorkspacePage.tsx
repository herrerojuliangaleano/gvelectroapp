import { useState } from 'react';
import { MapPin, PackageCheck } from 'lucide-react';
import { getCurrentUserFromStorage } from '../api/client';
import { canSeeDepositReceivePage, canSeeSucursalLogistics, isCadeteDeposito, isPlainDepositOperator } from '../warrantyAccess';
import { WarrantySucursalPage } from './WarrantySucursalPage';
import { WarrantyDepositReceivePage } from './WarrantyDepositReceivePage';

type WorkspaceView = 'sucursal' | 'deposito';
const VIEW_KEY = 'warranty_workspace_view';

/**
 * "Mi espacio" — ruta única que muestra la vista operativa correcta:
 *   - Operador de sucursal → logística de sucursal (despacho al depósito central).
 *   - Operador de depósito → recepción de remitos + movimiento entre depósitos.
 *   - Usuario con acceso a AMBAS (gestor/admin/multi-sucursal) → toggle para
 *     alternar entre las dos vistas (su elección se recuerda).
 */
export function WarrantyWorkspacePage() {
  const user = getCurrentUserFromStorage();
  const branchType = String(user?.branch_type || '').toLowerCase();

  const canSucursal = canSeeSucursalLogistics(user);
  const canDeposito = canSeeDepositReceivePage(user);
  const hasBoth = canSucursal && canDeposito;

  // Perfil "natural" para elegir el default cuando tiene ambas vistas.
  const naturallyDeposito = isPlainDepositOperator(user) || isCadeteDeposito(user) || branchType === 'deposit';

  const [view, setView] = useState<WorkspaceView>(() => {
    if (!hasBoth) return canDeposito && !canSucursal ? 'deposito' : 'sucursal';
    try {
      const saved = localStorage.getItem(VIEW_KEY) as WorkspaceView | null;
      if (saved === 'sucursal' || saved === 'deposito') return saved;
    } catch { /* noop */ }
    return naturallyDeposito ? 'deposito' : 'sucursal';
  });

  function pick(next: WorkspaceView) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* noop */ }
  }

  // Si solo tiene acceso a una, forzamos esa.
  const effectiveView: WorkspaceView = hasBoth ? view : (canDeposito && !canSucursal ? 'deposito' : 'sucursal');

  return (
    <div>
      {hasBoth && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-[color:var(--text-3)]">Vista:</span>
          <div className="inline-flex items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1" role="tablist" aria-label="Vista de Mi espacio">
            <button
              type="button"
              onClick={() => pick('sucursal')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${effectiveView === 'sucursal' ? 'bg-[color:var(--primary)] text-white' : 'text-[color:var(--text-2)] hover:bg-[color:var(--surface-hover)]'}`}
              aria-pressed={effectiveView === 'sucursal'}
            >
              <MapPin size={14} /> Sucursal
            </button>
            <button
              type="button"
              onClick={() => pick('deposito')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${effectiveView === 'deposito' ? 'bg-[color:var(--primary)] text-white' : 'text-[color:var(--text-2)] hover:bg-[color:var(--surface-hover)]'}`}
              aria-pressed={effectiveView === 'deposito'}
            >
              <PackageCheck size={14} /> Depósito
            </button>
          </div>
        </div>
      )}

      {effectiveView === 'deposito' ? <WarrantyDepositReceivePage /> : <WarrantySucursalPage />}
    </div>
  );
}
