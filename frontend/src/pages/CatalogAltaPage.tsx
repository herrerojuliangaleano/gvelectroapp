// Alta guiada de producto nuevo en el catálogo maestro.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackagePlus } from 'lucide-react';
import { CatalogProductForm } from '../components/CatalogProductForm';
import { fetchCatalogTransition } from '../api/client';
import type { CatalogTransition } from '../types';

export function CatalogAltaPage() {
  const [t, setT] = useState<CatalogTransition | null>(null);
  const reload = () => fetchCatalogTransition().then(setT).catch(() => {});
  useEffect(() => { reload(); }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl flex items-center gap-2"><PackagePlus className="size-7 text-indigo-400" /> Alta de producto</h1>
          <p className="mt-2 text-sm text-slate-400">Cargá datos estructurados; la app genera el SKU comercial, la descripción comercial y la ERP. No se escribe la descripción a mano.</p>
        </div>
        <Link to="/catalogo/normalizar" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-200 hover:bg-slate-800">Normalizar viejos →</Link>
      </div>

      {t && (
        <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-300">
          Catálogo nuevo: <b className="text-white">{t.catalogo_total}</b> productos ({t.catalogo_activos} activos) · Transición de legacy: <b className="text-white">{t.legacy_migrados}/{t.legacy_total}</b> ({t.porcentaje}%)
        </div>
      )}

      <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
        <CatalogProductForm mode="alta" onSaved={reload} />
      </div>
    </div>
  );
}
