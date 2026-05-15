import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchTools } from '../api/client';
import { ToolCard } from '../components/ToolCard';
import type { ToolInfo } from '../types';

export function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchTools().then(setTools).catch((err) => setError(err.message)); }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = tools.filter((tool) => !q || [tool.name, tool.description, tool.category, ...(tool.tags || [])].join(' ').toLowerCase().includes(q));
    const map = new Map<string, ToolInfo[]>();
    for (const tool of filtered) {
      const category = tool.category || 'General';
      map.set(category, [...(map.get(category) || []), tool]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [query, tools]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black sm:text-3xl">Herramientas internas</h1>
        <p className="mt-2 text-sm text-slate-400">Panel general para ejecutar procesos internos. Elegí la herramienta correcta antes de correr cualquier proceso pesado.</p>
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
          <Search size={18} className="text-slate-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent outline-none" placeholder="Buscar por nombre, categoría o uso..." />
        </label>
      </div>
      <div className="space-y-8">
        {grouped.map(([category, list]) => (
          <section key={category}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">{category}</h2>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">{list.length} herramienta/s</span>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{list.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
          </section>
        ))}
        {!grouped.length && <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-8 text-center text-slate-400">No hay herramientas para mostrar con ese filtro.</div>}
      </div>
    </div>
  );
}
