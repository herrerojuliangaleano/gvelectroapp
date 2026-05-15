import { useEffect, useState } from 'react';
import { fetchSystemAbout } from '../api/client';
import type { SystemAbout } from '../types';

export function AboutSystemPage() {
  const [about, setAbout] = useState<SystemAbout | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { fetchSystemAbout().then(setAbout).catch((err) => setError(err.message)); }, []);
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6"><h1 className="text-2xl font-black sm:text-3xl">Acerca del sistema</h1><p className="mt-2 text-sm text-slate-400">Versión, entorno, notas y novedades.</p></div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {about && <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="Sistema" value={about.app_name} />
          <Card label="Versión" value={about.version} />
          <Card label="Entorno" value={about.environment} />
          <Card label="Python" value={about.python} />
        </div>
        <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <h2 className="mb-3 text-lg font-black">Rutas y tecnología</h2>
          <div className="grid gap-3 text-sm lg:grid-cols-2"><Info label="Backend" value={about.backend} /><Info label="Frontend" value={about.frontend} /><Info label="Storage" value={about.storage_dir} /><Info label="Base local" value={about.database_path} /></div>
        </div>
        <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <h2 className="mb-3 text-lg font-black">Novedades</h2>
          <div className="space-y-4">{about.changelog.map((entry) => <div key={entry.version} className="rounded-2xl bg-slate-900/70 p-4"><div className="font-black text-white">v{entry.version} · {entry.title}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">{entry.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div>
        </div>
      </>}
    </div>
  );
}
function Card({ label, value }: { label: string; value: string }) { return <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-2 text-lg font-black text-white">{value}</div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-slate-900/70 p-3"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 break-all text-slate-200">{value}</div></div>; }
