import { AlertTriangle, CheckCircle2, Clipboard, KeyRound, Loader2, RefreshCw, Save, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  deleteGoogleToken,
  fetchGoogleAdminStatus,
  fetchGoogleReconnectStatus,
  refreshGoogleToken,
  saveGoogleCredentials,
  saveGoogleToken,
  startGoogleLocalReconnect,
} from '../api/client';
import type { GoogleAdminStatus } from '../types';

export function GoogleAdminPage() {
  const [status, setStatus] = useState<GoogleAdminStatus | null>(null);
  const [credentialsText, setCredentialsText] = useState('');
  const [tokenText, setTokenText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await fetchGoogleAdminStatus();
    setStatus(data);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el estado de Google'));
  }, []);

  useEffect(() => {
    if (!status?.reconnect?.running) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await fetchGoogleReconnectStatus();
        setStatus((prev) => prev ? { ...prev, reconnect: data.reconnect, token: data.status } : prev);
        if (!data.reconnect.running) window.clearInterval(timer);
      } catch {
        // keep polling quiet
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [status?.reconnect?.running]);

  const health = useMemo(() => {
    if (!status) return { ok: false, label: 'Cargando...', detail: '' };
    if (!status.credentials.exists) return { ok: false, label: 'Faltan credenciales OAuth', detail: 'Cargá credentials.local.json o pegá el JSON.' };
    if (!status.token.exists) return { ok: false, label: 'Falta token OAuth', detail: 'Reconectá Google desde la laptop o pegá token.json.' };
    if (status.token.valid) return { ok: true, label: 'Google conectado', detail: 'Credenciales y token disponibles.' };
    if (status.token.expired && status.token.has_refresh_token) return { ok: false, label: 'Token vencido pero refrescable', detail: 'Usá la acción Refrescar token.' };
    return { ok: false, label: 'Token inválido', detail: 'Probá Reconectar Google desde la laptop.' };
  }, [status]);

  async function doSaveCredentials() {
    setLoading(true); setError(''); setMessage('');
    try {
      await saveGoogleCredentials(credentialsText);
      setCredentialsText('');
      setMessage('Credenciales OAuth guardadas correctamente.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron guardar las credenciales'); }
    finally { setLoading(false); }
  }

  async function doSaveToken() {
    setLoading(true); setError(''); setMessage('');
    try {
      await saveGoogleToken(tokenText);
      setTokenText('');
      setMessage('Token OAuth guardado correctamente.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el token'); }
    finally { setLoading(false); }
  }

  async function doRefreshToken() {
    setLoading(true); setError(''); setMessage('');
    try {
      await refreshGoogleToken();
      setMessage('Token refrescado correctamente.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo refrescar el token'); }
    finally { setLoading(false); }
  }

  async function doDeleteToken() {
    if (!confirm('¿Eliminar token.json? Luego vas a tener que reconectar Google.')) return;
    setLoading(true); setError(''); setMessage('');
    try {
      await deleteGoogleToken();
      setMessage('Token eliminado.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo eliminar el token'); }
    finally { setLoading(false); }
  }

  async function doReconnect() {
    setLoading(true); setError(''); setMessage('');
    try {
      const res = await startGoogleLocalReconnect();
      setStatus((prev) => prev ? { ...prev, reconnect: res.reconnect } : prev);
      setMessage('Reconexión iniciada. Revisá la laptop: debería abrirse el navegador para autorizar Google.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo iniciar la reconexión'); }
    finally { setLoading(false); }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setMessage('Copiado al portapapeles.');
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-black sm:text-3xl">Google OAuth</h1>
        <p className="mt-2 text-sm text-slate-400">Panel SUPERADMIN para administrar credenciales y token de Google en modo laptop.</p>
      </div>

      {error && <AlertBox type="error" text={error} />}
      {message && <AlertBox type="success" text={message} />}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className={`rounded-3xl border p-5 ${health.ok ? 'border-green-500/40 bg-green-500/10' : 'border-yellow-500/40 bg-yellow-500/10'}`}>
          <div className="flex items-start gap-3">
            {health.ok ? <CheckCircle2 className="mt-1 text-green-300" /> : <AlertTriangle className="mt-1 text-yellow-300" />}
            <div>
              <h2 className="font-black">{health.label}</h2>
              <p className="mt-1 text-sm text-slate-300">{health.detail}</p>
            </div>
          </div>
        </div>
        <StatusCard label="Credentials" ok={!!status?.credentials.exists} detail={status ? `${status.credentials.kind} · ${status.credentials.project_id || 'sin project_id'}` : 'Cargando...'} />
        <StatusCard label="Token" ok={!!status?.token.exists && !!status?.token.valid} detail={status ? `${status.token.source} · ${status.token.expiry || 'sin vencimiento visible'}` : 'Cargando...'} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Credenciales OAuth" subtitle="Pegá acá credentials.local.json si necesitás cargarlo desde el panel.">
          <InfoLine label="Ruta" value={status?.credentials.path || '...'} onCopy={() => status?.credentials.path && copy(status.credentials.path)} />
          <InfoLine label="Origen" value={status ? `${status.credentials.exists_file ? 'archivo local' : ''}${status.credentials.exists_env ? ' variable de entorno' : ''}` || 'ninguno' : '...'} />
          <textarea value={credentialsText} onChange={(e) => setCredentialsText(e.target.value)} placeholder='{"installed":{"client_id":"..."}}' className="mt-4 min-h-44 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs outline-none focus:border-blue-400" />
          <button disabled={loading || !credentialsText.trim()} onClick={doSaveCredentials} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-400 disabled:opacity-50 sm:w-auto">
            <Save size={18} /> Guardar credentials
          </button>
        </Panel>

        <Panel title="Token OAuth" subtitle="Si ya tenés token.json generado por script, podés pegarlo acá. Si no, usá Reconectar Google.">
          <InfoLine label="Ruta" value={status?.token.path || '...'} onCopy={() => status?.token.path && copy(status.token.path)} />
          <InfoLine label="Refresh token" value={status?.token.has_refresh_token ? 'Sí' : 'No'} />
          <InfoLine label="Estado" value={status?.token.valid ? 'Válido' : status?.token.error || 'No válido'} />
          <textarea value={tokenText} onChange={(e) => setTokenText(e.target.value)} placeholder='{"token":"...","refresh_token":"..."}' className="mt-4 min-h-44 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs outline-none focus:border-blue-400" />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button disabled={loading || !tokenText.trim()} onClick={doSaveToken} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-400 disabled:opacity-50"><Save size={18} /> Guardar token</button>
            <button disabled={loading || !status?.token.exists} onClick={doDeleteToken} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/50 px-4 py-3 font-bold text-red-200 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={18} /> Eliminar</button>
          </div>
        </Panel>
      </section>

      <Panel title="Reconectar Google desde la laptop" subtitle="Usá esto si el token queda inválido, se revocó el permiso o Google vuelve a pedir autorización.">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
          <p><b>Importante:</b> este botón debe usarse con el backend corriendo en la laptop. El navegador de autorización se abre en esa laptop, no en una PC remota.</p>
          <p className="mt-2">Sirve bien para tu esquema: prendés laptop, entrás como SUPERADMIN, reconectás Google si hace falta y después habilitás la operación.</p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <button disabled={loading || status?.reconnect.running || !status?.credentials.exists} onClick={doReconnect} className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-3 font-black text-white hover:bg-green-400 disabled:opacity-50">
            {status?.reconnect.running ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />} Reconectar Google
          </button>
          <button disabled={loading || !status?.token.exists} onClick={doRefreshToken} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 font-bold text-slate-200 hover:bg-slate-900 disabled:opacity-50">
            <RefreshCw size={18} /> Refrescar token
          </button>
          <button onClick={() => load().catch((err) => setError(err.message))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 font-bold text-slate-200 hover:bg-slate-900">
            <RefreshCw size={18} /> Actualizar estado
          </button>
        </div>
        {status?.reconnect && (
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm">
            <div className="font-bold text-white">Estado reconexión: {status.reconnect.status}</div>
            <div className="mt-1 text-slate-300">{status.reconnect.message}</div>
            {status.reconnect.error && <div className="mt-2 text-red-300">{status.reconnect.error}</div>}
          </div>
        )}
      </Panel>

      <Panel title="Rutas locales privadas" subtitle="Estos archivos no se suben a GitHub. Quedan en la laptop.">
        <div className="grid gap-3 text-sm">
          <InfoLine label="Carpeta privada" value={status?.storage_private_dir || '...'} onCopy={() => status?.storage_private_dir && copy(status.storage_private_dir)} />
          <InfoLine label="Scopes Google" value={status?.scopes.join(', ') || '...'} />
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 shadow-xl sm:p-5">
      <h2 className="text-lg font-black text-white">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatusCard({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
      <div className="flex items-start gap-3">
        {ok ? <CheckCircle2 className="mt-1 text-green-300" /> : <XCircle className="mt-1 text-red-300" />}
        <div className="min-w-0">
          <h2 className="font-black">{label}</h2>
          <p className="mt-1 break-words text-sm text-slate-400">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function InfoLine({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="break-all text-sm text-slate-200">{value}</div>
        {onCopy && <button onClick={onCopy} className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title="Copiar"><Clipboard size={15} /></button>}
      </div>
    </div>
  );
}

function AlertBox({ type, text }: { type: 'success' | 'error'; text: string }) {
  const cls = type === 'success' ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-red-500/40 bg-red-500/10 text-red-200';
  return <div className={`rounded-xl border p-4 text-sm ${cls}`}>{text}</div>;
}
