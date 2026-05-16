import { Download, RefreshCw, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { activateWaitingServiceWorker, clearDeferredInstallPrompt, getDeferredInstallPrompt, isStandalonePwa, type BeforeInstallPromptEvent } from '../pwa';

const DISMISS_INSTALL_KEY = 'electrogv_pwa_install_dismissed_at';

function recentlyDismissed(): boolean {
  const raw = localStorage.getItem(DISMISS_INSTALL_KEY);
  if (!raw) return false;
  const date = new Date(raw).getTime();
  if (!Number.isFinite(date)) return false;
  return Date.now() - date < 1000 * 60 * 60 * 24 * 7;
}

export function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getDeferredInstallPrompt());
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [dismissed, setDismissed] = useState(() => recentlyDismissed());
  const [standalone, setStandalone] = useState(() => isStandalonePwa());

  useEffect(() => {
    const onInstall = (event: WindowEventMap['electrogv:pwa-install-available']) => {
      if (!recentlyDismissed()) {
        setInstallPrompt(event.detail);
        setDismissed(false);
      }
    };
    const onUpdate = (event: WindowEventMap['electrogv:pwa-update-available']) => setUpdateRegistration(event.detail);
    const onDisplayChange = () => setStandalone(isStandalonePwa());
    window.addEventListener('electrogv:pwa-install-available', onInstall);
    window.addEventListener('electrogv:pwa-update-available', onUpdate);
    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', onDisplayChange);
    return () => {
      window.removeEventListener('electrogv:pwa-install-available', onInstall);
      window.removeEventListener('electrogv:pwa-update-available', onUpdate);
      window.matchMedia?.('(display-mode: standalone)').removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    clearDeferredInstallPrompt();
    setInstallPrompt(null);
  }

  function dismissInstall() {
    localStorage.setItem(DISMISS_INSTALL_KEY, new Date().toISOString());
    setDismissed(true);
  }

  if (updateRegistration) {
    return (
      <div className="fixed bottom-24 left-3 right-3 z-50 mx-auto max-w-md rounded-3xl border border-blue-400/40 bg-slate-950/95 p-4 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-5 lg:left-auto lg:right-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-blue-500/15 p-2 text-blue-200"><RefreshCw size={20} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black">Nueva versión disponible</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">Actualizá la app para tomar los últimos cambios del sistema.</p>
            <button onClick={() => activateWaitingServiceWorker(updateRegistration)} className="mt-3 rounded-2xl bg-blue-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400">
              Actualizar ahora
            </button>
          </div>
          <button onClick={() => setUpdateRegistration(null)} className="rounded-xl border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-900" aria-label="Ocultar"><X size={16} /></button>
        </div>
      </div>
    );
  }

  if (standalone || dismissed || !installPrompt) return null;

  return (
    <div className="fixed bottom-24 left-3 right-3 z-50 mx-auto max-w-md rounded-3xl border border-slate-700 bg-slate-950/95 p-4 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-5 lg:left-auto lg:right-5">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-emerald-500/15 p-2 text-emerald-200"><Smartphone size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black">Instalar app interna</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">Agregá ElectroGV al Android para abrirlo como aplicación. Funciona online y usa siempre el backend actual.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={install} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950/20 hover:bg-emerald-400"><Download size={15} /> Instalar</button>
            <button onClick={dismissInstall} className="rounded-2xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-900">Después</button>
          </div>
        </div>
        <button onClick={dismissInstall} className="rounded-xl border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-900" aria-label="Ocultar"><X size={16} /></button>
      </div>
    </div>
  );
}
