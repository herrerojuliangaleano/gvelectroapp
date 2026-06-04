import { Download, ImageDown, MessageCircle, RefreshCw, Search, Share2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchPriceCostUpdates, generatePriceAnnouncementImages, getCurrentUserFromStorage } from '../api/client';
import { ErpBadge, ErpPageHeader, erpBtnPrimary, erpBtnSecondary } from '../components/ProUI';
import { canUsePriceAnnouncements } from '../priceAnnouncementsAccess';
import type { PriceAnnouncementImage, PriceAnnouncementImagesResponse, PriceCostUpdate } from '../types';

function dataUrlToFile(dataUrl: string, filename: string, mimeType: string): File {
  const [meta, payload] = dataUrl.split(',');
  const binary = atob(payload || meta || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType || 'image/png' });
}

function downloadImage(image: PriceAnnouncementImage) {
  const link = document.createElement('a');
  link.href = image.data_url;
  link.download = image.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function PriceAnnouncementsPage() {
  const user = getCurrentUserFromStorage();
  const canUse = canUsePriceAnnouncements(user);
  const [items, setItems] = useState<PriceCostUpdate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [estado, setEstado] = useState('');
  const [logoBrand, setLogoBrand] = useState('gv_electro');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PriceAnnouncementImagesResponse | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchPriceCostUpdates({ type: 'price', limit: 500 });
      setItems(rows.filter((item) => item.estado !== 'Cancelado'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los cambios de precio.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const brands = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = (item.marca || 'Sin marca').trim() || 'Sin marca';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([name, count]) => ({ name, count }));
  }, [items]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((item) => {
      if (brand && (item.marca || 'Sin marca') !== brand) return false;
      if (estado && item.estado !== estado) return false;
      if (!query) return true;
      return [item.sku, item.producto, item.marca || ''].join(' ').toLowerCase().includes(query);
    });
  }, [items, q, brand, estado]);

  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);
  const selectedBrands = useMemo(() => Array.from(new Set(selectedItems.map((item) => item.marca || 'Sin marca'))), [selectedItems]);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filtered) next.add(item.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setResult(null);
  }

  async function generate() {
    if (!selectedIds.size) {
      setError('Selecciona al menos un cambio de precio.');
      return;
    }
    setGenerating(true);
    setError('');
    setResult(null);
    try {
      const response = await generatePriceAnnouncementImages({
        update_ids: Array.from(selectedIds),
        logo_brand: logoBrand,
        title: 'Cambios de precios',
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar la imagen.');
    } finally {
      setGenerating(false);
    }
  }

  async function shareImage(image: PriceAnnouncementImage) {
    if (!result) return;
    const file = dataUrlToFile(image.data_url, image.filename, image.mime_type);
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ title: 'Cambios de precios', text: result.message, files: [file] });
      return;
    }
    downloadImage(image);
    window.open(`https://wa.me/?text=${encodeURIComponent(result.message)}`, '_blank', 'noopener,noreferrer');
  }

  if (!canUse) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-100">
        <div className="text-2xl font-black">Sin permisos</div>
        <p className="mt-2 text-sm text-amber-100/80">Tu usuario no tiene habilitada la generacion de anuncios de precios.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <ErpPageHeader
        title="Anuncios de precios"
        description="Placas comerciales con precios nuevos agrupados por marca."
        actions={(
          <>
            <button type="button" className={erpBtnSecondary} onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Refrescar
            </button>
            <button type="button" className={erpBtnPrimary} onClick={generate} disabled={generating || !selectedIds.size}>
              <Wand2 size={16} /> Generar imagen
            </button>
          </>
        )}
      />

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}

      <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_190px_170px_auto_auto]">
          <label className="relative block">
            <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, producto o marca" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-10 py-3 outline-none focus:border-blue-400" />
          </label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
            <option value="">Todas las marcas</option>
            {brands.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
            <option value="">Todos los estados</option>
            <option value="Pendiente">Pendiente</option>
            <option value="En proceso">En proceso</option>
            <option value="Completado">Completado</option>
          </select>
          <select value={logoBrand} onChange={(e) => setLogoBrand(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-400">
            <option value="gv_electro">GV Electro</option>
            <option value="abc_electro">ABC Electro</option>
          </select>
          <button type="button" onClick={selectFiltered} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-100 hover:bg-slate-800">Seleccionar</button>
          <button type="button" onClick={clearSelection} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-100 hover:bg-slate-800">Limpiar</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ErpBadge tone="primary">{selectedIds.size} seleccionados</ErpBadge>
          {selectedBrands.map((name) => <ErpBadge key={name} tone="info">{name}</ErpBadge>)}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">Cambios disponibles</h2>
              <p className="text-sm text-slate-400">{filtered.length} productos visibles</p>
            </div>
            {loading && <span className="text-sm font-bold text-slate-400">Cargando...</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="w-12 px-3 py-3"></th>
                  <th className="px-3 py-3">Marca</th>
                  <th className="px-3 py-3">SKU</th>
                  <th className="px-3 py-3">Producto</th>
                  <th className="px-3 py-3 text-right">Precio nuevo</th>
                  <th className="px-3 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-slate-900/80 hover:bg-slate-900/60">
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} className="h-5 w-5 accent-blue-500" />
                    </td>
                    <td className="px-3 py-3 font-bold text-slate-200">{item.marca || 'Sin marca'}</td>
                    <td className="px-3 py-3 font-black text-white">{item.sku}</td>
                    <td className="max-w-[420px] px-3 py-3 text-slate-300">{item.producto}</td>
                    <td className="px-3 py-3 text-right font-black text-white">{item.valor_nuevo}</td>
                    <td className="px-3 py-3 text-slate-400">{item.estado} · {formatDate(item.created_at)}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">No hay cambios para mostrar.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">Imagenes generadas</h2>
              {result && <p className="text-sm text-slate-400">{result.message}</p>}
            </div>
            <ImageDown className="text-slate-500" size={28} />
          </div>

          {!result && (
            <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-500">
              Selecciona productos y genera una imagen.
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {result.images.map((image) => (
                <article key={image.filename} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                  <img src={image.data_url} alt={image.filename} className="w-full rounded-xl border border-slate-800 bg-white" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-slate-400">
                      {image.product_count} productos · {image.brand_names.join(', ')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => downloadImage(image)} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-black text-slate-100 hover:bg-slate-800">
                        <Download size={15} /> Descargar
                      </button>
                      <button type="button" onClick={() => shareImage(image)} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-black text-white hover:bg-blue-400">
                        <Share2 size={15} /> Compartir
                      </button>
                      <a href={`https://wa.me/?text=${encodeURIComponent(result.message)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-green-500/40 px-3 py-2 text-sm font-black text-green-100 hover:bg-green-500/10">
                        <MessageCircle size={15} /> WhatsApp
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
