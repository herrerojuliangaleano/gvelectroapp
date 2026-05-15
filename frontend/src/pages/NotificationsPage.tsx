import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../api/client';
import type { NotificationInfo } from '../types';

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationInfo[]>([]);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  function load() {
    // Solo mostramos no leídas. Cuando una notificación se marca como leída, desaparece de esta bandeja.
    fetchNotifications(true).then(setItems).catch((err) => setError(err.message || 'No se pudieron cargar notificaciones'));
  }

  useEffect(() => {
    load();
    const h = window.setInterval(load, 10000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(h); window.removeEventListener('focus', onFocus); };
  }, []);

  async function enableBrowserNotifications() {
    if (typeof Notification === 'undefined') {
      setError('Este navegador no soporta notificaciones.');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      new Notification('Notificaciones activadas', { body: 'Vas a recibir avisos mientras la app esté abierta.' });
    }
  }

  async function read(id: number) {
    await markNotificationRead(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function readAll() {
    await markAllNotificationsRead();
    setItems([]);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-4xl">🔔</div>
            <h1 className="mt-2 text-3xl font-black">Notificaciones</h1>
            <p className="mt-1 text-slate-400">Solo se muestran notificaciones no leídas. Al marcarlas como leídas desaparecen de esta bandeja.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={enableBrowserNotifications} className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100">Activar notificaciones</button>
            <button onClick={readAll} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold hover:bg-slate-800">Marcar todas leídas</button>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">Permiso Chrome: {permission}</div>
      </div>
      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-blue-400/40 bg-blue-500/10 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="font-black text-white">{item.title}</div>
                <div className="mt-1 text-sm text-slate-300">{item.message}</div>
                <div className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString('es-AR')}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.sales_request_id && <Link to={`/venta/${item.sales_request_id}`} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold hover:bg-slate-800">Ver solicitud</Link>}
                <button onClick={() => read(item.id)} className="rounded-lg border border-green-500/40 px-3 py-2 text-xs font-bold text-green-100 hover:bg-green-500/10">Marcar leída</button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No tenés notificaciones pendientes.</div>}
      </div>
    </div>
  );
}
