import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { can, cancelSalesWebRequest, completeSalesWebRequest, deleteSalesWebRequest, fetchSalesWebRequest, getCurrentUserFromStorage, sendSalesWebRequest, takeSalesWebRequest, updateSalesWebRequest } from '../api/client';
import type { SalesWebRequest } from '../types';
import { StatusBadge } from './SalesWebListPage';

export function SalesWebDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SalesWebRequest | null>(null);
  const [error, setError] = useState('');
  const [remito, setRemito] = useState('');
  const [obsAdmin, setObsAdmin] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [copied, setCopied] = useState('');
  const canManage = can('sales_web.manage');
  const canDelete = can('sales_web.delete');
  const currentUser = getCurrentUserFromStorage();

  function load() {
    if (!id) return;
    setError('');
    fetchSalesWebRequest(id).then((req) => {
      setData(req);
      setRemito(req.numero_remito_prefactura || '');
      setObsAdmin(req.observacion_admin || '');
    }).catch((err) => setError(err.message || 'No se pudo cargar la venta'));
  }

  useEffect(() => { load(); }, [id]);

  const copyText = useMemo(() => data ? buildCopyText(data) : '', [data]);
  const isOwner = Boolean(data && currentUser?.username === data.vendedor_id);
  const canCancelOwn = Boolean(data && isOwner && can('sales_web.cancel_own') && ['Pendiente', 'En proceso'].includes(data.estado));

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value || '');
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1600);
  }

  async function action(fn: () => Promise<SalesWebRequest>) {
    setError('');
    try {
      const updated = await fn();
      setData(updated);
      setRemito(updated.numero_remito_prefactura || '');
      setObsAdmin(updated.observacion_admin || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo realizar la acción');
    }
  }

  async function deleteRequest() {
    if (!data) return;
    if (!window.confirm(`¿Eliminar definitivamente ${data.numero_solicitud}? Esta acción no se puede deshacer.`)) return;
    setError('');
    try {
      await deleteSalesWebRequest(data.id);
      navigate('/venta');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la venta');
    }
  }

  if (error && !data) return <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>;
  if (!data) return <div className="text-slate-400">Cargando venta...</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link to="/venta" className="text-sm font-bold text-blue-300">← Volver a ventas</Link>
            <div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-black">{data.numero_solicitud}</h1><StatusBadge estado={data.estado} /></div>
            <p className="mt-1 text-slate-400">{data.apellido_nombre} · cargado por {data.vendedor_nombre} · {data.created_at_text}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => copy(copyText, 'todos los datos')} className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-black text-white">Copiar todo</button>
            {copied && <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-100">Copiado: {copied}</div>}
          </div>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_.9fr]">
        <section className="space-y-5">
          <Card title="Datos del cliente">
            <Data label="DNI" value={data.dni} onCopy={() => copy(data.dni, 'DNI')} />
            <Data label="Apellido y nombre" value={data.apellido_nombre} onCopy={() => copy(data.apellido_nombre, 'nombre')} />
            <Data label="Teléfono" value={data.telefono} onCopy={() => copy(data.telefono, 'teléfono')} />
            <Data label="Correo" value={data.correo_electronico} onCopy={() => copy(data.correo_electronico, 'correo')} />
          </Card>
          <Card title="Domicilio">
            <Data label="Domicilio" value={data.domicilio} onCopy={() => copy(data.domicilio, 'domicilio')} />
            <Data label="Código postal" value={data.codigo_postal} />
            <Data label="Localidad" value={data.localidad} />
            <Data label="Barrio" value={data.barrio || '-'} />
            <Data label="Entre calles" value={data.entre_calles || '-'} />
            <Data label="Observaciones" value={data.observaciones || '-'} />
          </Card>
          <Card title="Productos">
            <div className="space-y-3">
              {data.items.map((item) => (
                <div key={item.id || `${item.sku}-${item.producto}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="font-bold text-white">{item.cantidad} x {item.producto}</div>
                  <div className="text-xs text-slate-400">{item.sku || 'Sin SKU'} · {item.marca || 'Sin marca'} · {item.condicion || '-'}</div>
                  {(item.precio_unitario || item.total_linea) && <div className="mt-1 text-sm text-green-200">Precio: {item.precio_unitario || '-'} · Total: {item.total_linea || '-'}</div>}
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="space-y-5">
          <Card title="Operación">
            <Data label="Pago" value={data.pago_tipo} />
            {data.pago_tipo === 'Seña' && <Data label="Monto de seña" value={data.senia_monto || '-'} />}
            {data.pago_tipo === 'Seña' && <Data label="Resta a cobrar" value={data.saldo_restante || '-'} />}
            <Data label="Entrega" value={data.entrega_tipo} />
            <Data label="Costo envío" value={data.costo_envio || '-'} />
            <Data label="Sucursal/canal" value={data.sucursal || data.canal || '-'} />
            <Data label="Remito/prefactura real" value={data.numero_remito_prefactura || 'Pendiente'} />
            <Data label="Observación admin" value={data.observacion_admin || '-'} />
          </Card>

          {canManage && <Card title="Administración">
            <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Número real de remito/prefactura</span><input value={remito} onChange={(e) => setRemito(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" /></label>
            <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Observación admin</span><textarea value={obsAdmin} onChange={(e) => setObsAdmin(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              {can('sales_web.take') && <button onClick={() => action(() => takeSalesWebRequest(data.id))} className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100">Tomar / En proceso</button>}
              <button onClick={() => action(() => updateSalesWebRequest(data.id, { numero_remito_prefactura: remito, observacion_admin: obsAdmin }))} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold hover:bg-slate-800">Guardar datos</button>
              {can('sales_web.complete') && <button onClick={() => action(() => completeSalesWebRequest(data.id, { numero_remito_prefactura: remito, observacion_admin: obsAdmin }))} className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-100">Marcar completado</button>}
              {can('sales_web.send') && <button onClick={() => window.confirm('¿Marcar como enviado a venta?') && action(() => sendSalesWebRequest(data.id, { observacion_admin: obsAdmin }))} className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm font-bold text-violet-100">Enviado a venta</button>}
            </div>
            {can('sales_web.cancel') && <div className="mt-4 rounded-2xl border border-red-500/30 p-3"><input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo de cancelación" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-red-400" /><button onClick={() => cancelReason.trim() && window.confirm('¿Cancelar la venta?') && action(() => cancelSalesWebRequest(data.id, cancelReason))} className="mt-2 w-full rounded-xl bg-red-500 px-4 py-3 text-sm font-black text-white">Cancelar venta</button></div>}
            {canDelete && <div className="mt-4 rounded-2xl border border-red-700/50 bg-red-950/30 p-3"><div className="text-sm font-bold text-red-100">Eliminación definitiva</div><p className="mt-1 text-xs text-red-100/70">Solo roles autorizados. Borra venta, productos y notificaciones vinculadas.</p><button onClick={deleteRequest} className="mt-3 w-full rounded-xl border border-red-500 bg-red-600 px-4 py-3 text-sm font-black text-white">Eliminar definitivamente</button></div>}
          </Card>}

          {!canManage && canCancelOwn && <Card title="Administrar mi venta">
            <p className="text-sm text-slate-400">Podés cancelar esta venta porque todavía está pendiente o en proceso. Al cancelarla deja de aparecer en tus ventas activas.</p>
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo opcional de cancelación" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-red-400" />
            <button onClick={() => window.confirm('¿Cancelar esta venta?') && action(() => cancelSalesWebRequest(data.id, cancelReason || 'Cancelada por el vendedor'))} className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100">Cancelar mi venta</button>
          </Card>}
        </section>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl"><h2 className="text-xl font-black">{title}</h2>{children}</div>;
}

function Data({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 break-words text-slate-100">{value || '-'}</div>{onCopy && <button onClick={onCopy} className="mt-2 rounded-lg border border-slate-700 px-3 py-1 text-xs font-bold text-slate-300 hover:bg-slate-800">Copiar</button>}</div>;
}

function buildCopyText(data: SalesWebRequest): string {
  const products = data.items.map((item) => `- ${item.cantidad} x ${item.producto}${item.sku ? ` (${item.sku})` : ''}${item.precio_unitario ? ` - ${item.precio_unitario}` : ''}`).join('\n');
  return `Venta: ${data.numero_solicitud}\n\nDNI: ${data.dni}\nApellido y nombre: ${data.apellido_nombre}\nTeléfono: ${data.telefono}\nCorreo electrónico: ${data.correo_electronico}\n\nDomicilio: ${data.domicilio}\nCódigo postal: ${data.codigo_postal}\nLocalidad: ${data.localidad}\nBarrio: ${data.barrio || ''}\nEntre calles: ${data.entre_calles || ''}\nObservaciones: ${data.observaciones || ''}\n\nProductos:\n${products}\n\nPago completo o seña: ${data.pago_tipo}\nRetira en local o envío: ${data.entrega_tipo}\nCosto del envío: ${data.costo_envio || ''}\n\nVendedor: ${data.vendedor_nombre}\nFecha de carga: ${data.created_at_text}\nRemito/prefactura real: ${data.numero_remito_prefactura || ''}`;
}
