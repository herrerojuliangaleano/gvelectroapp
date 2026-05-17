import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { registerFcmToken } from '../api/client';

// Link pendiente cuando la app arranca desde notificación (cold start)
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
    { id: 'electrogv_critico',   name: 'Alertas críticas', description: 'Urgencias del sistema',      importance: 5, vibration: true,  lights: true,  lightColor: '#ef4444' },
    { id: 'electrogv_garantias', name: 'Garantías',         description: 'Módulo de garantías',        importance: 4, vibration: true,  lights: true,  lightColor: '#1e40af' },
    { id: 'electrogv_ventas',    name: 'Ventas',            description: 'Solicitudes y ventas',       importance: 4, vibration: true,  lights: true,  lightColor: '#1e40af' },
    { id: 'electrogv_remitos',   name: 'Remitos',           description: 'Movimientos de remitos',     importance: 3, vibration: true,  lights: true,  lightColor: '#1e40af' },
    { id: 'electrogv_default',   name: 'General',           description: 'Notificaciones del sistema', importance: 3, vibration: true,  lights: true,  lightColor: '#1e40af' },
    { id: 'electrogv_info',      name: 'Información',       description: 'Avisos informativos',        importance: 2, vibration: false, lights: false, lightColor: '#64748b' },
  ];
  for (const ch of channels) {
    try { await PushNotifications.createChannel(ch as any); } catch { /* ya existe */ }
  }
}

export async function requestPushPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    await createChannels();
    const { receive } = await PushNotifications.requestPermissions();
    if (receive !== 'granted') return 'denied';

    await PushNotifications.register();

    await PushNotifications.addListener('registration', async ({ value: token }) => {
      try { await registerFcmToken(token); } catch { /* silent */ }
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const link = action.notification.data?.link_url as string | undefined;
      if (link) handleLink(link);
    });

    return 'granted';
  } catch {
    return 'denied';
  }
}

export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return receive as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'unavailable';
  }
}

export async function initPushNotifications(navigate: (path: string) => void): Promise<void> {
  _navigate = navigate;
  if (_pendingLink) {
    navigate(_pendingLink);
    _pendingLink = null;
  }
  if (!Capacitor.isNativePlatform()) return;
  // Pedir permiso automáticamente al montar AppLayout
  await requestPushPermission();
}

export async function cleanupPushNotifications(): Promise<void> {
  _navigate = null;
  if (!Capacitor.isNativePlatform()) return;
  try { await PushNotifications.removeAllListeners(); } catch { /* silent */ }
}
