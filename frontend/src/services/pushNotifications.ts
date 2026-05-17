import { PushNotifications } from '@capacitor/push-notifications';
import { registerFcmToken } from '../api/client';

function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as typeof window & {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  };
  try {
    return win.Capacitor?.isNativePlatform?.() === true || win.Capacitor?.getPlatform?.() === 'android';
  } catch { return false; }
}

// Guardamos un link pendiente cuando la app arranca desde una notificación
// y el navigate de React Router todavía no está disponible (cold start).
let _pendingLink: string | null = null;
let _navigate: ((path: string) => void) | null = null;

function handleLink(link: string): void {
  if (_navigate) {
    _navigate(link);
  } else {
    _pendingLink = link;
  }
}

async function createChannels(): Promise<void> {
  const channels = [
    { id: 'electrogv_critico',   name: 'Alertas críticas', description: 'Urgencias del sistema',           importance: 5, vibration: true,  lights: true, lightColor: '#ef4444' },
    { id: 'electrogv_garantias', name: 'Garantías',         description: 'Módulo de garantías',             importance: 4, vibration: true,  lights: true, lightColor: '#1e40af' },
    { id: 'electrogv_ventas',    name: 'Ventas',            description: 'Solicitudes y ventas',            importance: 4, vibration: true,  lights: true, lightColor: '#1e40af' },
    { id: 'electrogv_remitos',   name: 'Remitos',           description: 'Movimientos de remitos',          importance: 3, vibration: true,  lights: true, lightColor: '#1e40af' },
    { id: 'electrogv_default',   name: 'General',           description: 'Notificaciones del sistema',      importance: 3, vibration: true,  lights: true, lightColor: '#1e40af' },
    { id: 'electrogv_info',      name: 'Información',       description: 'Avisos informativos',             importance: 2, vibration: false, lights: false, lightColor: '#64748b' },
  ];
  for (const ch of channels) {
    try { await PushNotifications.createChannel(ch as any); } catch { /* ya existe */ }
  }
}

export async function initPushNotifications(navigate: (path: string) => void): Promise<void> {
  // Registrar el navigate para poder ejecutar links pendientes de cold start
  _navigate = navigate;
  if (_pendingLink) {
    navigate(_pendingLink);
    _pendingLink = null;
  }

  if (!isNative()) return;
  try {
    await createChannels();

    const { receive } = await PushNotifications.requestPermissions();
    if (receive !== 'granted') return;

    await PushNotifications.register();

    await PushNotifications.addListener('registration', async ({ value: token }) => {
      try { await registerFcmToken(token); } catch { /* silent */ }
    });

    // Funciona tanto con app en background como cold start
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const link = action.notification.data?.link_url as string | undefined;
      if (link) handleLink(link);
    });
  } catch {
    // Plugin no disponible en navegador web
  }
}

export async function cleanupPushNotifications(): Promise<void> {
  _navigate = null;
  if (!isNative()) return;
  try { await PushNotifications.removeAllListeners(); } catch { /* silent */ }
}
