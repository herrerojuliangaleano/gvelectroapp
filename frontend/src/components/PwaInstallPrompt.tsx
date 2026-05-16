import { Download, ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isPwaStandalone } from '../pwa';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const INSTALL_DISMISSED_KEY = 'electrogv:pwa-install-dismissed';
const APK_DISMISSED_KEY = 'electrogv:apk-install-dismissed';
const UPDATE_DISMISSED_KEY = 'electrogv:pwa-update-dismissed';
const APK_URL = (import.meta.env.VITE_ANDROID_APK_URL as string | undefined) || '/downloads/electrogv.apk';

function isRecentlyDismissed(key: string) {
  const raw = window.localStorage.getItem(key);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
}

function isAndroidBrowser() {
  const ua = window.navigator.userAgent || '';
  return /Android/i.test(ua);
}

function isNativeCapacitorApp() {
  const win = window as typeof window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  };
  try {
    if (win.Capacitor?.isNativePlatform?.()) return true;
    return win.Capacitor?.getPlatform?.() === 'android';
  } catch {
    return false;
  }
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installHidden, setInstallHidden] = useState(false);
  const [apkHidden, setApkHidden] = useState(false);
  const [updateReload, setUpdateReload] = useState<null | (() => void)>(null);
  const [updateHidden, setUpdateHidden] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [androidBrowser, setAndroidBrowser] = useState(false);
  const [nativeApp, setNativeApp] = useState(false);

  useEffect(() => {
    setStandalone(isPwaStandalone());
    setAndroidBrowser(isAndroidBrowser());
    setNativeApp(isNativeCapacitorApp());
    setInstallHidden(isRecentlyDismissed(INSTALL_DISMISSED_KEY));
    setApkHidden(isRecentlyDismissed(APK_DISMISSED_KEY));
    setUpdateHidden(isRecentlyDismissed(UPDATE_DISMISSED_KEY));

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setStandalone(true);
      setInstallEvent(null);
    };
    const onUpdate = (event: WindowEventMap['pwa:update-available']) => {
      setUpdateReload(() => event.detail.reload);
      setUpdateHidden(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('pwa:update-available', onUpdate);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('pwa:update-available', onUpdate);
    };
  }, []);

  const showAndroidApkPrompt = useMemo(() => {
    return androidBrowser && !standalone && !nativeApp && !apkHidden;
  }, [androidBrowser, standalone, nativeApp, apkHidden]);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    if (!choice || choice.outcome !== 'accepted') {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
      setInstallHidden(true);
    }
    setInstallEvent(null);
  }

  function dismissInstall() {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
    setInstallHidden(true);
  }

  function dismissApk() {
    window.localStorage.setItem(APK_DISMISSED_KEY, String(Date.now()));
    setApkHidden(true);
  }

  function dismissUpdate() {
    window.localStorage.setItem(UPDATE_DISMISSED_KEY, String(Date.now()));
    setUpdateHidden(true);
  }

  if (updateReload && !updateHidden) {
    return (
      <div className="fixed inset-x-3 bottom-[92px] z-50 mx-auto max-w-md rounded-3xl border border-blue-400/40 bg-slate-950/95 p-4 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-5 lg:left-auto lg:right-5 lg:mx-0">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-blue-500/15 p-2 text-blue-200"><RefreshCw size={20} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black">Nueva versión disponible</div>
            <p className="mt-1 text-xs leading-5 text-slate-400">Actualizá la app para cargar los últimos cambios del sistema.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={updateReload} className="rounded-2xl bg-blue-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-950/30">Actualizar ahora</button>
              <button type="button" onClick={dismissUpdate} className="rounded-2xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">Después</button>
            </div>
          </div>
          <button type="button" onClick={dismissUpdate} className="rounded-xl p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Cerrar"><X size={16} /></button>
        </div>
      </div>
    );
  }

  if (showAndroidApkPrompt) {
    return (
      <div className="fixed inset-x-3 bottom-[92px] z-50 mx-auto max-w-md rounded-3xl border border-violet-400/35 bg-slate-950/95 p-4 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-5 lg:left-auto lg:right-5 lg:mx-0">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-violet-500/15 p-2 text-violet-200"><Smartphone size={20} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black">Instalar app Android</div>
            <p className="mt-1 text-xs leading-5 text-slate-400">Para Android vamos a usar la app APK interna. Es la base para notificaciones nativas más confiables.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={APK_URL} download className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-violet-950/30">
                <Download size={15} /> Descargar APK
              </a>
              <button type="button" onClick={dismissApk} className="rounded-2xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">Después</button>
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><ExternalLink size={12} /> Si Android lo pide, habilitá instalar apps de este origen.</p>
          </div>
          <button type="button" onClick={dismissApk} className="rounded-xl p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Cerrar"><X size={16} /></button>
        </div>
      </div>
    );
  }

  // En Android navegador se prioriza APK. En PC/desktop se mantiene PWA.
  if (androidBrowser || !installEvent || installHidden || standalone || nativeApp) return null;

  return (
    <div className="fixed inset-x-3 bottom-[92px] z-50 mx-auto max-w-md rounded-3xl border border-emerald-400/35 bg-slate-950/95 p-4 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-5 lg:left-auto lg:right-5 lg:mx-0">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-emerald-500/15 p-2 text-emerald-200"><Smartphone size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black">Instalar ElectroGV en esta PC</div>
          <p className="mt-1 text-xs leading-5 text-slate-400">Abrí el sistema como app de escritorio, con acceso rápido y pantalla independiente del navegador.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={install} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-emerald-950/30"><Download size={15} /> Instalar PWA</button>
            <button type="button" onClick={dismissInstall} className="rounded-2xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">Después</button>
          </div>
        </div>
        <button type="button" onClick={dismissInstall} className="rounded-xl p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Cerrar"><X size={16} /></button>
      </div>
    </div>
  );
}
