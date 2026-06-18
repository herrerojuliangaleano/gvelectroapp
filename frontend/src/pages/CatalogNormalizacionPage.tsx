// Normalización diaria: cola de productos legacy + panel de datos viejos +
// formulario de alta a la derecha. Al confirmar, crea el producto nuevo,
// guarda el alias histórico y vincula el legacy (sube el detector +1).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, Loader2, Search } from 'lucide-react';
import { CatalogProductForm } from '../components/CatalogProductForm';
import { fetchCatalogTransition, fetchLegacyPending } from '../api/client';
import type { CatalogTransition, LegacyPendingItem, LegacyPendingResponse } from '../types';

export function CatalogNormalizacionPage() {
  const [pend, setPend] = useState<LegacyPendingResponse | null>(null);
  const [sel, setSel] = useState<LegacyPendingItem | null>(null);
  const [q, setQ] = useState('');
  const [t, setT] = useState<CatalogTransition | null>(null);
  const [loading, setLoading] = useState(false);

  const reloadQueue = (query = q) => {
    setLoading(true);
    fetchLegacyPending(query, 50).then((r) => { setPend(r); }).catch(() => {}).finally(() => setLoading(false));
    fetchCatalogTransition().then(setT).catch(() => {});
  };
  useEffect(() => { reloadQueue(''); }, []);

  function onSaved() {
    // quitar el normalizado de la cola y avanzar al siguiente
    const remaining = (pend?.items || []).filter((i) => i.legacy_id !== sel?.legacy_id);
    setSel(remaining[0] || null);
    reloadQueue();
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl flex items-center gap-2"><ListChecks className="size-7 text-indigo-400" /> Normalización de productos</h1>
          <p className="mt-2 text-sm text-slate-400">Depurá los productos viejos por tandas. Cada uno conserva su descripción anterior como alias.</p>
        </div>
        <Link to="/catalogo/alta" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-200 hover:bg-slate-800">+ Alta nueva</Link>
      </div>

      {t && (
        <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
            <span>Transición: <b className="text-white">{t.legacy_migrados}/{t.legacy_total}</b> normalizados</span>
            <span className={t.transicion_completa ? 'font-bold text-emerald-300' : 'text-slate-400'}>{t.transicion_completa ? '¡Transición completa!' : `${t.porcentaje}%`}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-indigo-500" style={{ width: `${t.porcentaje}%` }} /></div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        {/* cola */}
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-3 self-start">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reloadQueue()}
              placeholder="Buscar SKU / descripción…" className="w-full rounded-xl border border-slate-700 bg-slate-900 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          </div>
          <div className="mb-2 px-1 text-xs text-slate-500">{pend ? `${pend.total_pendientes} pendientes` : ''}</div>
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-slate-400"><Loader2 className="size-4 animate-spin" /> Cargando…</div>
          ) : (
            <div className="max-h-[70vh] space-y-1.5 overflow-y-auto">
              {(pend?.items || []).map((it) => (
                <button key={it.legacy_id} onClick={() => setSel(it)}
                  className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm ${sel?.legacy_id === it.legacy_id ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>
                  <div className="font-bold">{it.descripcion || '(sin descripción)'}</div>
                  <div className="text-xs opacity-80">{it.marca} · {it.sku || 'sin SKU'} · {it.tipo}</div>
                </button>
              ))}
              {pend && pend.items.length === 0 && <div className="p-3 text-sm text-slate-500">No hay pendientes que coincidan.</div>}
            </div>
          )}
        </div>

        {/* panel legacy + formulario */}
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          {!sel ? (
            <div className="py-16 text-center text-slate-500">Elegí un producto de la cola para normalizar.</div>
          ) : (
            <>
              <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="mb-1 text-xs font-black uppercase tracking-wide text-amber-300">Así venía antes (legacy)</div>
                <div className="text-sm text-slate-200">{sel.descripcion}</div>
                <div className="mt-1 text-xs text-slate-400">SKU: {sel.sku || '—'} · Marca: {sel.marca || '—'} · Tipo: {sel.tipo || '—'} · PVP: {sel.pvp_text || sel.pvp || '—'} · Costo: {sel.costo_text || sel.costo_vigente || '—'}</div>
                <div className="mt-1 text-[11px] text-amber-200/80">Se guarda como alias histórico al normalizar.</div>
              </div>
              <CatalogProductForm key={sel.legacy_id} mode="normalizacion" legacy={sel} onSaved={onSaved} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
