// Redirected: functionality merged into WarrantySucursalPage.
// This file kept only for safety; the route /warranties/despacho now redirects to /warranties/sucursal.
import { Navigate } from 'react-router-dom';

export function BranchDispatchPage() {
  return <Navigate to="/warranties/sucursal" replace />;
}
