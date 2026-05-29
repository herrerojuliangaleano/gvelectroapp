import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchTools } from '../api/client';
import {
  ErpBadge,
  ErpEmptyState,
  ErpLoadingState,
  ErpNotice,
  ErpPageHeader,
} from '../components/ProUI';
import { ToolCard } from '../components/ToolCard';
import type { ToolInfo } from '../types';

export function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTools()
      .then((res) => { setTools(res); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

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
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Herramientas internas"
        description="Panel general para ejecutar procesos internos. Elegí la herramienta correcta antes de correr cualquier proceso pesado."
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      <div className="relative max-w-md">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-3)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="erp-input"
          style={{ paddingLeft: 32 }}
          placeholder="Buscar por nombre, categoría o uso..."
        />
      </div>

      {loading && <ErpLoadingState />}

      {!loading && !error && (
        <div className="erp-stack-6">
          {grouped.map(([category, list]) => (
            <section key={category}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-3)]">{category}</h2>
                <ErpBadge tone="neutral" withDot={false}>{list.length}</ErpBadge>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {list.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
              </div>
            </section>
          ))}
          {!grouped.length && (
            <ErpEmptyState
              icon={<Search size={20} />}
              title={query ? 'Ninguna herramienta coincide' : 'No hay herramientas disponibles'}
              description={query ? 'Ajustá el término de búsqueda o limpialo para ver todas.' : 'No tenés herramientas habilitadas con tus permisos actuales.'}
            />
          )}
        </div>
      )}
    </div>
  );
}
