import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Download, FileSpreadsheet, FileText, Filter, PackageCheck, RefreshCw, Search, Settings2, Square, Truck } from 'lucide-react';
import {
  createBatchExport,
  downloadWarrantyExport,
  fetchEligibleWarranties,
  fetchExportProviderSuggestions,
  fetchWarrantyExports,
  fetchWarrantyOptions,
} from '../api/client';
import type { WarrantyExportInfo, WarrantyListResponse, WarrantyOptions, WarrantySummary } from '../types';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function delayBadge(days?: number | null) {
  const d = Number(days ?? 0);
  if (d >= 15) return 'bg-red-500/20 text-red-300 border-red-500/40';
  if (d >= 7) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-slate-800 text-slate-400 border-slate-700';
}

function exportFormatLabel(format?: string) {
  return format === 'pdf' ? 'PDF' : 'Excel';
}

function exportExtension(format?: string) {
  return format === 'pdf' ? 'pdf' : 'xlsx';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterBar({
  options,
  filters,
  onChange,
  onSearch,
  searching,
}: {
  options: WarrantyOptions | null;
  filters: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSearch: () => void;
  searching: boolean;
}) {
  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
      <div className="mb-4 flex flex-col gap-1 text-sm font-black uppercase tracking-wide text-slate-300">
        <span className="flex items-center gap-2"><Filter size={16} /> Filtrar garantías listas para ENV</span>
        <span className="text-xs font-medium normal-case tracking-normal text-slate-500">La vista muestra datos internos para elegir bien. El archivo para proveedor sale limpio: ID, producto, SKU, serie y falla.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-400">Proveedor</span>
          <input
            type="text"
            value={filters.proveedor}
            onChange={(e) => onChange('proveedor', e.target.value)}
            placeholder="Ej. Samsung"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-400">Marca</span>
          <input
            type="text"
            value={filters.marca}
            onChange={(e) => onChange('marca', e.target.value)}
            placeholder="Ej. LG"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-400">Sucursal</span>
          <select
            value={filters.sucursal}
            onChange={(e) => onChange('sucursal', e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
          >
            <option value="">Todas</option>
            {(options?.sucursales || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-400">Depósito</span>
          <select
            value={filters.deposito}
            onChange={(e) => onChange('deposito', e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
          >
            <option value="">Todos</option>
            {(options?.depositos || []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4">
        <button
          onClick={onSearch}
          disabled={searching}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Search size={16} /> {searching ? 'Buscando...' : 'Buscar listas para ENV'}
        </button>
      </div>
    </div>
  );
}

function SelectionTable({
  items,
  selected,
  onToggle,
  onToggleAll,
}: {
  items: WarrantySummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id_garantia));
  const someSelected = items.some((i) => selected.has(i.id_garantia));

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-900/80">
            <th className="px-4 py-3 text-left">
              <button
                type="button"
                onClick={onToggleAll}
                className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-300 hover:text-white"
              >
                {allSelected ? (
                  <CheckSquare size={16} className="text-emerald-400" />
                ) : someSelected ? (
                  <CheckSquare size={16} className="text-slate-500" />
                ) : (
                  <Square size={16} />
                )}
                {allSelected ? 'Quitar todo' : 'Sel. todo'}
              </button>
            </th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">ID</th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">Producto / Marca</th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">SKU / Serie</th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">Proveedor</th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">Sucursal / Ubicación</th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">Días</th>
            <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-400">Falla</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isSelected = selected.has(item.id_garantia);
            return (
              <tr
                key={item.id_garantia}
                onClick={() => onToggle(item.id_garantia)}
                className={`cursor-pointer border-b border-slate-800 transition-colors last:border-0 hover:bg-slate-800/50 ${isSelected ? 'bg-emerald-500/10' : ''}`}
              >
                <td className="px-4 py-3">
                  {isSelected ? (
                    <CheckSquare size={18} className="text-emerald-400" />
                  ) : (
                    <Square size={18} className="text-slate-600" />
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-slate-300">{item.id_garantia}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-100">{item.producto_principal}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold uppercase tracking-wide">
                    {item.productos.length > 1 && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">+{item.productos.length - 1} más</span>
                    )}
                    {item.marca && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">Marca: {item.marca}</span>
                    )}
                    {item.provider_name && (
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-300">Proveedor: {item.provider_name}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  <div className="font-mono">SKU: {item.sku || '—'}</div>
                  <div className="font-mono">Serie: {item.serie || '—'}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">{item.provider_name || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  <div>{item.sucursal || '—'}</div>
                  <div className="text-slate-500">{item.ubicacion_actual_label || item.deposito || item.lugar_llegada || '—'}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${delayBadge(item.dias_pendiente)}`}>
                    {item.dias_pendiente ?? 0}d
                  </span>
                </td>
                <td className="max-w-[180px] truncate px-4 py-3 text-xs text-slate-400">{item.falla}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShipmentBanner({ info, onDownload, downloading }: { info: WarrantyExportInfo; onDownload: () => void; downloading: boolean }) {
  const label = exportFormatLabel(info.file_format);
  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <PackageCheck size={28} className="mt-0.5 shrink-0 text-emerald-400" />
          <div>
            <div className="text-lg font-black text-emerald-100">Lote ENV generado con éxito</div>
            <div className="mt-1 text-sm text-slate-300">
              El {label} para proveedor quedó generado con solo ID, producto, SKU, serie y falla. Las garantías pasaron a <strong>3 - LISTO PARA ENVIAR</strong>. El mail se confirma después desde Gestión.
            </div>
            <div className="mt-2 inline-block rounded-xl bg-emerald-900/60 px-4 py-2 font-mono text-2xl font-black tracking-widest text-emerald-200 shadow-inner">
              {info.shipment_code}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {info.row_count} {info.row_count === 1 ? 'ítem' : 'ítems'} · {label} · {info.created_at} · {info.created_by}
            </div>
          </div>
        </div>
        <button
          onClick={onDownload}
          disabled={downloading}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-black text-white hover:bg-emerald-400 disabled:opacity-60"
        >
          <Download size={18} /> {downloading ? 'Descargando...' : `Descargar ${label}`}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WarrantyExportPage() {
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [exports, setExports] = useState<WarrantyExportInfo[]>([]);
  const [filters, setFilters] = useState({ proveedor: '', marca: '', sucursal: '', deposito: '' });

  const [searchResult, setSearchResult] = useState<WarrantyListResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proveedorBatch, setProveedorBatch] = useState('');
  const [exportFormat, setExportFormat] = useState<'excel' | 'pdf'>('pdf');
  const [logoBrand, setLogoBrand] = useState<'gv_electro' | 'abc_electro'>('gv_electro');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [providerSuggestions, setProviderSuggestions] = useState<string[]>([]);

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [searching, setSearching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [lastExport, setLastExport] = useState<WarrantyExportInfo | null>(null);
  const [error, setError] = useState('');

  // Auto-fill proveedor batch from filter when user types
  const items = useMemo(() => searchResult?.items || [], [searchResult]);
  const selectedCount = selected.size;
  const selectedProviderSuggestions = useMemo(() => {
    const values = new Set<string>();
    items.forEach((item) => {
      if (!selected.has(item.id_garantia)) return;
      if (item.provider_name) values.add(item.provider_name);
      if (item.marca) values.add(item.marca);
    });
    providerSuggestions.forEach((v) => values.add(v));
    return Array.from(values).filter(Boolean).slice(0, 40);
  }, [items, selected, providerSuggestions]);

  async function loadBase() {
    setLoadingOptions(true);
    try {
      const [opts, history, suggestions] = await Promise.all([
        fetchWarrantyOptions(),
        fetchWarrantyExports(50),
        fetchExportProviderSuggestions(''),
      ]);
      setOptions(opts);
      setExports(history.items || []);
      setProviderSuggestions(suggestions.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => { loadBase(); }, []);

  async function handleSearch() {
    setSearching(true);
    setError('');
    setLastExport(null);
    setSelected(new Set());
    try {
      const params: Record<string, string> = {};
      if (filters.proveedor) params.proveedor = filters.proveedor;
      if (filters.marca) params.marca = filters.marca;
      if (filters.sucursal) params.sucursal = filters.sucursal;
      if (filters.deposito) params.deposito = filters.deposito;
      const result = await fetchEligibleWarranties(params);
      setSearchResult(result);
      // Pre-select all results
      setSelected(new Set(result.items.map((i) => i.id_garantia)));
      const smartProviders = Array.from(new Set(result.items.map((i) => i.provider_name || i.marca).filter(Boolean) as string[]));
      if (!proveedorBatch.trim() && smartProviders.length === 1) setProveedorBatch(smartProviders[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al buscar garantías');
    } finally {
      setSearching(false);
    }
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (items.every((i) => selected.has(i.id_garantia))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id_garantia)));
    }
  }

  async function handleExport() {
    if (selectedCount === 0) return;
    setExporting(true);
    setError('');
    setLastExport(null);
    try {
      const info = await createBatchExport({
        warranty_ids: Array.from(selected),
        proveedor: proveedorBatch.trim() || filters.proveedor.trim() || undefined,
        formato: exportFormat,
        logo_brand: logoBrand,
      });
      // Auto-download
      const blob = await downloadWarrantyExport(info.id);
      saveBlob(blob, info.file_name || `garantias-${info.shipment_code || info.id}.${exportExtension(info.file_format || exportFormat)}`);
      setLastExport(info);
      // Refresh exports history and search (selected warranties now have ENV/listo para enviar)
      const [history, refreshed] = await Promise.all([
        fetchWarrantyExports(50),
        fetchEligibleWarranties(
          Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
        ),
      ]);
      setExports(history.items || []);
      setSearchResult(refreshed);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar el lote');
    } finally {
      setExporting(false);
    }
  }

  async function handleDownloadHistory(item: WarrantyExportInfo) {
    setDownloadingId(item.id);
    setError('');
    try {
      const blob = await downloadWarrantyExport(item.id);
      saveBlob(blob, item.file_name || `garantias-${item.id}.${exportExtension(item.file_format)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el archivo');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-100">
            <Truck size={14} /> Lote proveedor
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Exportación / ENV</h1>
          <p className="mt-2 text-slate-400">
            Seleccioná garantías revisadas, pendientes y sin lote previo. Esto crea el ENV y el Excel para avisar al proveedor; no implica retiro físico.
          </p>
        </div>
        <button
          onClick={loadBase}
          disabled={loadingOptions}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900 disabled:opacity-50"
        >
          <RefreshCw size={18} /> Actualizar
        </button>
      </div>

      <datalist id="export-provider-suggestions">
        {selectedProviderSuggestions.map((provider) => (
          <option key={provider} value={provider} />
        ))}
      </datalist>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-blue-300">1. Elegibles</div>
          <p className="mt-1 text-sm text-slate-400">Solo revisadas, en <strong>2 - PENDIENTE</strong> y sin ENV. La ubicación física no bloquea la creación del lote.</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-emerald-300">2. Crear ENV</div>
          <p className="mt-1 text-sm text-slate-400">Genera Excel o PDF, asigna <strong>shipment_code</strong> y pasa las garantías a <strong>3 - LISTO PARA ENVIAR</strong>.</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-amber-300">3. Gestión</div>
          <p className="mt-1 text-sm text-slate-400">El mail enviado, retiro proveedor, respuesta y resolución se registran después desde Gestión.</p>
        </div>
      </section>

      {/* Success banner after export */}
      {lastExport && (
        <ShipmentBanner
          info={lastExport}
          onDownload={async () => {
            setDownloadingId(lastExport.id);
            try {
              const blob = await downloadWarrantyExport(lastExport.id);
              saveBlob(blob, lastExport.file_name || `garantias-${lastExport.shipment_code || lastExport.id}.${exportExtension(lastExport.file_format)}`);
            } finally {
              setDownloadingId(null);
            }
          }}
          downloading={downloadingId === lastExport.id}
        />
      )}

      {/* Step 1: Filter */}
      <FilterBar
        options={options}
        filters={filters}
        onChange={(k, v) => setFilters((prev) => ({ ...prev, [k]: v }))}
        onSearch={handleSearch}
        searching={searching}
      />

      {/* Step 2: Results table */}
      {searchResult !== null && (
        <section className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-100">
                {items.length === 0
                  ? 'No hay garantías listas para ENV'
                  : `${items.length} garantía${items.length !== 1 ? 's' : ''} encontrada${items.length !== 1 ? 's' : ''}`}
              </h2>
              {items.length > 0 && (
                <p className="text-sm text-slate-400">
                  {selectedCount === 0
                    ? 'Hacé clic en las filas para seleccionar'
                    : `${selectedCount} seleccionada${selectedCount !== 1 ? 's' : ''} para crear ENV`}
                </p>
              )}
            </div>
            {items.length > 0 && selectedCount > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">Proveedor del ENV</span>
                  <input
                    type="text"
                    list="export-provider-suggestions"
                    value={proveedorBatch}
                    onChange={(e) => setProveedorBatch(e.target.value)}
                    placeholder={filters.proveedor || 'Escribí o elegí proveedor'}
                    className="w-56 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">Autocompleta, pero podés escribir manualmente.</span>
                </label>
                <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
                  <button
                    type="button"
                    onClick={() => setExportFormat('excel')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-black ${exportFormat === 'excel' ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    <FileSpreadsheet size={16} /> Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportFormat('pdf')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-black ${exportFormat === 'pdf' ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    <FileText size={16} /> PDF
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
                  title="Opciones avanzadas"
                >
                  <Settings2 size={16} /> Logo
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 font-black text-white shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportFormat === 'pdf' ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
                  {exporting
                    ? 'Generando...'
                    : `Crear ENV y descargar ${exportFormatLabel(exportFormat)} (${selectedCount})`}
                </button>
              {showAdvanced && (
                <div className="sm:col-span-2 lg:basis-full rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
                  <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Opciones avanzadas del documento</div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-400">Logo:</span>
                    <button
                      type="button"
                      onClick={() => setLogoBrand('gv_electro')}
                      className={`rounded-lg px-3 py-1.5 font-bold ${logoBrand === 'gv_electro' ? 'bg-blue-500 text-white' : 'border border-slate-700 text-slate-300'}`}
                    >
                      GV Electro
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogoBrand('abc_electro')}
                      className={`rounded-lg px-3 py-1.5 font-bold ${logoBrand === 'abc_electro' ? 'bg-blue-500 text-white' : 'border border-slate-700 text-slate-300'}`}
                    >
                      ABC Electro
                    </button>
                    <span className="text-xs text-slate-500">Por defecto queda GV. Esto solo afecta el archivo de exportación.</span>
                  </div>
                </div>
              )}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <SelectionTable
              items={items}
              selected={selected}
              onToggle={toggleItem}
              onToggleAll={toggleAll}
            />
          )}

          {items.length === 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center text-slate-400">
              No hay garantías revisadas, pendientes y sin ENV con los filtros aplicados.
              <br />
              Primero deben estar revisadas, en estado 2 - PENDIENTE y sin shipment_code. El ENV es aviso administrativo, no retiro físico.
            </div>
          )}
        </section>
      )}

      {/* Export history */}
      <section className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl">
        <div className="mb-4">
          <h2 className="text-xl font-black">Lotes ENV generados</h2>
          <p className="text-sm text-slate-400">Historial de ENV/Excel generados. El envío del mail se confirma luego desde Gestión.</p>
        </div>
        {loadingOptions && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-300">Cargando...</div>
        )}
        {!loadingOptions && exports.length === 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-300">
            Todavía no hay exportaciones generadas.
          </div>
        )}
        <div className="space-y-3">
          {exports.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.shipment_code && (
                    <span className="rounded-lg bg-emerald-900/50 px-2 py-0.5 font-mono text-sm font-black text-emerald-300">
                      {item.shipment_code}
                    </span>
                  )}
                  <span className="truncate text-sm font-bold text-slate-300">{item.file_name}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{item.created_at}</span>
                  {item.created_by && <span>· {item.created_by}</span>}
                  <span>· {item.row_count} {item.row_count === 1 ? 'ítem' : 'ítems'}</span>
                  <span>· {exportFormatLabel(item.file_format)}</span>
                  {item.provider_name && <span>· Proveedor: {item.provider_name}</span>}
                </div>
              </div>
              <button
                onClick={() => handleDownloadHistory(item)}
                disabled={downloadingId === item.id}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-60"
              >
                <Download size={16} /> {downloadingId === item.id ? 'Descargando...' : 'Descargar'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
