import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { backupDownloadUrl, createBackup, fetchBackups, getToken } from '../api/client';
import type { BackupInfo } from '../types';

export function BackupsPage() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() { setBackups(await fetchBackups()); }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  async function makeBackup() {
    setError(''); setMessage(''); setLoading(true);
    try {
      const res = await createBackup();
      setMessage(`Backup creado: ${res.filename}`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear backup'); }
    finally { setLoading(false); }
  }

  async function download(filename: string) {
    const token = getToken();
    const res = await fetch(backupDownloadUrl(filename), { headers: { Authorization: `Bearer ${token || ''}`, 'ngrok-skip-browser-warning': 'true' } });
    if (!res.ok) throw new Error('No se pudo descargar backup');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-black sm:text-3xl">Backups</h1><p className="mt-2 text-sm text-slate-400">Respaldo local de usuarios, roles, configuración, base SQLite y logs.</p></div><button onClick={makeBackup} disabled={loading} className="rounded-xl bg-blue-500 px-5 py-3 font-bold text-white disabled:opacity-50"><RefreshCw className="mr-2 inline" size={18} />{loading ? 'Creando...' : 'Crear backup ahora'}</button></div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">{message}</div>}
      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/60">
        {backups.map((b) => <div key={b.filename} className="grid gap-3 border-b border-slate-800 p-4 text-sm sm:grid-cols-[1fr_160px_180px_auto] sm:items-center"><div className="font-bold text-white">{b.filename}</div><div className="text-slate-400">{formatBytes(b.size_bytes)}</div><div className="text-slate-400">{new Date(b.created_at).toLocaleString()}</div><button onClick={() => download(b.filename).catch((err) => setError(err.message))} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200"><Download className="mr-2 inline" size={16} />Descargar</button></div>)}
        {!backups.length && <div className="p-6 text-center text-slate-500">Todavía no hay backups.</div>}
      </div>
    </div>
  );
}
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
