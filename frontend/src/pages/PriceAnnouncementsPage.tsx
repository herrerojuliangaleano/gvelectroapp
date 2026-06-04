import {
  CheckSquare,
  Download,
  ImageDown,
  Layers3,
  MessageCircle,
  RefreshCw,
  Search,
  Share2,
  Square,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchPriceCostUpdates, generatePriceAnnouncementImages, getCurrentUserFromStorage } from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpField,
  ErpInput,
  ErpKpiCard,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
} from '../components/ProUI';
import { canUsePriceAnnouncements } from '../priceAnnouncementsAccess';
import type { PriceAnnouncementImage, PriceAnnouncementImagesResponse, PriceCostUpdate } from '../types';

interface BrandGroup {
  brand: string;
  rows: PriceCostUpdate[];
  selectedCount: number;
}

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

function brandOf(item: PriceCostUpdate) {
  return (item.marca || 'Sin marca').trim() || 'Sin marca';
}

function matchesSearch(item: PriceCostUpdate, query: string) {
  if (!query) return true;
  return [item.sku, item.producto, item.marca || ''].join(' ').toLowerCase().includes(query);
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
      const key = brandOf(item);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es'))
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((item) => {
      if (brand && brandOf(item) !== brand) return false;
      if (estado && item.estado !== estado) return false;
      return matchesSearch(item, query);
    });
  }, [items, q, brand, estado]);

  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);
  const selectedBrands = useMemo(() => Array.from(new Set(selectedItems.map(brandOf))).sort((a, b) => a.localeCompare(b, 'es')), [selectedItems]);

  const grouped = useMemo<BrandGroup[]>(() => {
    const map = new Map<string, PriceCostUpdate[]>();
    for (const item of filtered) {
      const key = brandOf(item);
      const rows = map.get(key) || [];
      rows.push(item);
      map.set(key, rows);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es'))
      .map(([name, rows]) => ({
        brand: name,
        rows,
        selectedCount: rows.filter((item) => selectedIds.has(item.id)).length,
      }));
  }, [filtered, selectedIds]);

  const selectionSummary = useMemo(() => {
    if (selectedBrands.length === 0) return 'Sin productos seleccionados';
    const visible = selectedBrands.slice(0, 4).join(', ');
    const extra = selectedBrands.length > 4 ? ` +${selectedBrands.length - 4}` : '';
    return `${visible}${extra}`;
  }, [selectedBrands]);

  function setRowsSelected(rows: PriceCostUpdate[], checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of rows) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFiltered() {
    setRowsSelected(filtered, true);
  }

  function clearFiltered() {
    setRowsSelected(filtered, false);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setResult(null);
  }

  function resetFilters() {
    setQ('');
    setBrand('');
    setEstado('');
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
      <div className="mx-auto max-w-xl rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-100">
        <div className="text-2xl font-black">Sin permisos</div>
        <p className="mt-2 text-sm text-amber-100/80">Tu usuario no tiene habilitada la generacion de anuncios de precios.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <ErpPageHeader
        title="Anuncios de precios"
        description="Placas comerciales con precios nuevos agrupados por marca."
        actions={(
          <>
            <ErpButton variant="secondary" onClick={load} disabled={loading} leftIcon={<RefreshCw size={16} />}>
              Refrescar
            </ErpButton>
            <ErpButton variant="primary" onClick={generate} loading={generating} disabled={!selectedIds.size} leftIcon={<Wand2 size={16} />}>
              Generar imagen
            </ErpButton>
          </>
        )}
      />

      {error && (
        <ErpNotice tone="error" title="No se pudo completar">
          {error}
        </ErpNotice>
      )}

      <ErpCard size="sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_190px_170px_auto]">
          <ErpField>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-3)]" size={17} />
              <ErpInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por SKU, producto o marca"
                className="pl-10"
              />
            </div>
          </ErpField>
          <ErpField>
            <ErpSelect value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">Todas las marcas</option>
              {brands.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
            </ErpSelect>
          </ErpField>
          <ErpField>
            <ErpSelect value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="Pendiente">Pendiente</option>
              <option value="En proceso">En proceso</option>
              <option value="Completado">Completado</option>
            </ErpSelect>
          </ErpField>
          <ErpField>
            <ErpSelect value={logoBrand} onChange={(e) => setLogoBrand(e.target.value)}>
              <option value="gv_electro">GV Electro</option>
              <option value="abc_electro">ABC Electro</option>
            </ErpSelect>
          </ErpField>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <ErpButton variant="secondary" onClick={selectFiltered} leftIcon={<CheckSquare size={15} />}>
              Seleccionar vista
            </ErpButton>
            <ErpButton variant="ghost" onClick={resetFilters} leftIcon={<XCircle size={15} />}>
              Limpiar filtros
            </ErpButton>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ErpBadge tone={selectedIds.size ? 'primary' : 'neutral'}>{selectedIds.size} seleccionados</ErpBadge>
          <ErpBadge tone="info">{selectedBrands.length} marcas</ErpBadge>
          <span className="text-xs text-[color:var(--text-3)]">{selectionSummary}</span>
          {selectedIds.size > 0 && (
            <button type="button" onClick={clearSelection} className="ml-auto text-xs font-black text-[color:var(--text-3)] hover:text-[color:var(--text)]">
              Limpiar seleccion
            </button>
          )}
        </div>
      </ErpCard>

      <div className="erp-kpi-row">
        <ErpKpiCard label="Cambios visibles" value={filtered.length} detail={`${brands.length} marcas en total`} />
        <ErpKpiCard label="Seleccionados" value={selectedIds.size} detail={selectionSummary} variant={selectedIds.size ? 'success' : 'default'} />
        <ErpKpiCard label="Marcas elegidas" value={selectedBrands.length} detail={selectedBrands.length ? selectedBrands.join(', ') : 'Todavia ninguna'} />
        <ErpKpiCard label="Imagenes" value={result?.images.length || 0} detail={result ? 'Listas para bajar o compartir' : 'Pendientes de generar'} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <ErpCard
          title="Seleccion por marca"
          subtitle={`${filtered.length} productos visibles`}
          actions={(
            <>
              <ErpButton variant="secondary" size="sm" onClick={selectFiltered} leftIcon={<CheckSquare size={14} />}>
                Seleccionar vista
              </ErpButton>
              <ErpButton variant="ghost" size="sm" onClick={clearFiltered}>
                Quitar vista
              </ErpButton>
            </>
          )}
        >
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3">
            <Layers3 size={15} className="text-[color:var(--text-3)]" />
            <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-3)]">Agrupar por</span>
            <ErpSelect value="brand" disabled style={{ height: 30, minWidth: 130, fontSize: 12 }}>
              <option value="brand">Marca</option>
            </ErpSelect>
            <span className="text-[11.5px] text-[color:var(--text-3)]">-</span>
            <span className="text-xs text-[color:var(--text-2)]">
              <strong className="text-[color:var(--text)]">{filtered.length}</strong> en vista
            </span>
            {selectedIds.size > 0 && (
              <span className="text-xs text-[color:var(--text-2)]">
                <strong className="text-blue-300">{selectedIds.size}</strong> seleccionados
              </span>
            )}
          </div>

          {loading && grouped.length === 0 && <div className="py-10 text-center text-sm text-[color:var(--text-3)]">Cargando cambios...</div>}

          {!loading && grouped.length === 0 && (
            <ErpEmptyState
              title="No hay cambios para mostrar"
              description="Ajusta los filtros o refresca la lista."
            />
          )}

          <div className="space-y-5">
            {grouped.map((group) => {
              const allSelected = group.rows.length > 0 && group.selectedCount === group.rows.length;
              const someSelected = group.selectedCount > 0 && !allSelected;
              return (
                <section key={group.brand} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <button
                      type="button"
                      onClick={() => setRowsSelected(group.rows, !allSelected)}
                      className={`inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-black transition ${
                        allSelected
                          ? 'border-blue-400/60 bg-blue-500/15 text-blue-100'
                          : someSelected
                            ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                            : 'border-[color:var(--border)] text-[color:var(--text-2)] hover:bg-[color:var(--surface-hover)]'
                      }`}
                    >
                      {allSelected || someSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      {group.brand}
                    </button>
                    <ErpBadge tone={group.selectedCount ? 'primary' : 'neutral'} withDot={false}>
                      {group.selectedCount}/{group.rows.length}
                    </ErpBadge>
                    <div className="ml-auto flex flex-wrap gap-2">
                      <ErpButton variant="secondary" size="sm" onClick={() => setRowsSelected(group.rows, true)}>
                        Seleccionar marca
                      </ErpButton>
                      {group.selectedCount > 0 && (
                        <ErpButton variant="ghost" size="sm" onClick={() => setRowsSelected(group.rows, false)}>
                          Quitar
                        </ErpButton>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
                    <table className="erp-table erp-table-compact" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th className="is-check" aria-label="Seleccion" />
                          <th>SKU</th>
                          <th>Producto</th>
                          <th className="is-numeric">Precio nuevo</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((item) => {
                          const selected = selectedIds.has(item.id);
                          return (
                            <tr key={item.id} className={selected ? 'is-selected' : undefined}>
                              <td className="is-check">
                                <input
                                  type="checkbox"
                                  className="erp-checkbox"
                                  checked={selected}
                                  onChange={() => toggle(item.id)}
                                  aria-label={`Seleccionar ${item.sku}`}
                                />
                              </td>
                              <td>
                                <span className="font-mono text-[12px] font-black text-[color:var(--text)]">{item.sku}</span>
                              </td>
                              <td>
                                <div className="max-w-[360px] text-[13px] font-semibold leading-tight text-[color:var(--text)]">{item.producto}</div>
                              </td>
                              <td className="is-numeric">
                                <span className="font-black text-[color:var(--text)]">{item.valor_nuevo}</span>
                              </td>
                              <td>
                                <div className="flex flex-col gap-1">
                                  <ErpBadge tone={item.estado === 'Completado' ? 'success' : item.estado === 'Pendiente' ? 'warning' : 'info'} withDot={false}>
                                    {item.estado}
                                  </ErpBadge>
                                  <span className="text-[11px] text-[color:var(--text-3)]">{formatDate(item.created_at)}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        </ErpCard>

        <ErpCard
          title="Imagenes generadas"
          subtitle={result ? result.message : 'Selecciona productos y genera una imagen.'}
          actions={<ImageDown className="text-[color:var(--text-3)]" size={26} />}
        >
          {!result && (
            <div className="rounded-2xl border border-dashed border-[color:var(--border-strong)] p-10 text-center text-[color:var(--text-3)]">
              Selecciona productos por marca y genera una imagen.
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {result.images.map((image) => (
                <article key={image.filename} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                  <img src={image.data_url} alt={image.filename} className="w-full rounded-xl border border-[color:var(--border)] bg-white" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-[color:var(--text-2)]">
                      {image.product_count} productos - {image.brand_names.join(', ')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ErpButton variant="secondary" size="sm" onClick={() => downloadImage(image)} leftIcon={<Download size={15} />}>
                        Descargar
                      </ErpButton>
                      <ErpButton variant="primary" size="sm" onClick={() => shareImage(image)} leftIcon={<Share2 size={15} />}>
                        Compartir
                      </ErpButton>
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(result.message)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="erp-btn erp-btn-secondary erp-btn-sm"
                      >
                        <MessageCircle size={15} />
                        <span>WhatsApp</span>
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </ErpCard>
      </section>
    </div>
  );
}
