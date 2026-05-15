import { useEffect, useState } from 'react';
import { fetchConfigStatus } from '../api/client';
import type { ConfigStatus } from '../types';

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return <div className={`rounded-xl border px-4 py-3 ${ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-red-500/40 bg-red-500/10 text-red-100'}`}>{ok ? '✓' : '×'} {label}</div>;
}

export function SettingsPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchConfigStatus().then(setStatus).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-black">Configuración</h1>
      <p className="mt-2 text-slate-400">Estado operativo, credenciales y control de apagado.</p>
      {error && <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {status && (
        <div className="mt-6 grid max-w-4xl grid-cols-2 gap-4">
          <Flag ok={status.app_enabled} label={status.app_enabled ? 'APP_ENABLED=true: la app permite ejecutar' : 'APP_ENABLED=false: ejecuciones bloqueadas'} />
          <Flag ok={status.legacy_scripts_found} label="Scripts legacy encontrados" />
          <Flag ok={status.has_credentials_env || status.has_credentials_file} label="Credenciales Google configuradas" />
          <Flag ok={status.has_token_file} label="Token OAuth disponible" />
          <div className="col-span-2 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-sm text-slate-300">
            <h2 className="mb-3 font-bold text-white">Control total</h2>
            <p className="leading-6">Para cerrar la app: apagá el deploy, poné <b>APP_ENABLED=false</b>, eliminá usuarios o revocá credenciales Google. El storage actual es:</p>
            <code className="mt-3 block rounded-xl bg-slate-950 p-3 text-xs text-slate-400">{status.storage_dir}</code>
          </div>
        </div>
      )}
    </div>
  );
}
