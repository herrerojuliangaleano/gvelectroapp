import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Download, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UpdateInfo } from '../services/appUpdate';
import { checkAppUpdate } from '../services/appUpdate';

export function UpdatePrompt() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkAppUpdate().then(setInfo);
  }, []);

  if (!info?.needsUpdate)        return null;
  if (dismissed && !info.required) return null;

  const { required, apkUrl, changelog, latestVersionCode, installedVersionCode } = info;

  async function openDownload() {
    // Construir URL absoluta (el apkUrl puede ser relativo como /downloads/electrogv.apk)
    const absolute = apkUrl.startsWith('http')
      ? apkUrl
      : `${window.location.origin}${apkUrl}`;

    if (Capacitor.isNativePlatform()) {
      // En el APK: abrir Chrome Custom Tabs (puede descargar el APK)
      await Browser.open({ url: absolute, presentationStyle: 'popover' });
    } else {
      window.open(absolute, '_blank');
    }
  }

  // ── Actualización obligatoria: modal bloqueante ──────────────────────────
  if (required) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl border border-blue-500/30 bg-slate-900 p-6 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/20">
              <RefreshCw size={22} className="text-blue-400" />
            </div>
            <div>
              <h2 className="font-black text-white">Actualización requerida</h2>
              <p className="text-sm text-slate-400">Versión {latestVersionCode} disponible</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Esta versión de la app{' '}
            <span className="font-bold text-white">ya no es compatible</span>. Necesitás instalar la
            nueva versión para continuar.
          </p>
          {changelog ? (
            <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-400">
              {changelog}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">
            Instalada: v{installedVersionCode} · Requerida: v{latestVersionCode}
          </p>
          <button
            type="button"
            onClick={openDownload}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-950/40 active:bg-blue-700"
          >
            <Download size={18} /> Descargar nueva versión
          </button>
        </div>
      </div>
    );
  }

  // ── Actualización opcional: banner descartable ───────────────────────────
  return (
    <div className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 lg:bottom-6">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-blue-500/30 bg-slate-900 p-3 shadow-2xl shadow-black/40">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/20">
          <RefreshCw size={16} className="text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">Nueva versión disponible</p>
          <p className="text-xs text-slate-400">v{latestVersionCode} lista para instalar</p>
        </div>
        <button
          type="button"
          onClick={openDownload}
          className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white active:bg-blue-700"
        >
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-xl p-2 text-slate-500 active:bg-slate-800"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
