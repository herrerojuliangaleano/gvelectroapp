import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileSpreadsheet, Link, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, salesBIAnalyzeFile, salesBIAnalyzeUrl, salesBIConfirm } from '../api/client';
import type { SalesBISheetPreview } from '../types';

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function SheetCard({
  id,
  sheet,
  selected,
  onToggle,
  replace,
  onReplaceChange,
  fileName,
}: {
  id: string;
  sheet: SalesBISheetPreview;
  selected: boolean;
  onToggle: () => void;
  replace: boolean;
  onReplaceChange: (v: boolean) => void;
  /** Nombre del archivo Excel del que vino la hoja (multi-file). Si está
   *  presente, se muestra como badge para distinguir hojas con el mismo
   *  nombre que vinieron de archivos distintos. */
  fileName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasConflict = !!sheet.conflict_import_id;

  return (
    <div className={`rounded-2xl border ${selected ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-white/10 bg-white/5'} p-4 transition-all`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={!sheet.ok}
          className="mt-1 h-4 w-4 cursor-pointer accent-indigo-500"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {fileName && (
              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-white/55" title={fileName}>
                📄 {fileName.length > 28 ? fileName.slice(0, 25) + '…' : fileName}
              </span>
            )}
            <span className="font-bold text-white">{sheet.sheet_name}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${sheet.tipo === 'online' ? 'bg-sky-500/20 text-sky-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              {sheet.tipo === 'online' ? 'WEB' : 'Local'}
            </span>
            {sheet.fecha && <span className="text-sm text-white/60">{sheet.fecha}</span>}
            {sheet.sucursal && <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">{sheet.sucursal}</span>}
            {sheet.branch_id
              ? <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300" title="Sucursal vinculada">⇒ {sheet.branch_name}</span>
              : sheet.ok && <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">Sin sucursal registrada</span>
            }
            {!sheet.ok && <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">Sin datos</span>}
          </div>

          {sheet.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              {sheet.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {hasConflict && (
            <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2">
              <p className="text-xs text-amber-200">
                Ya existe una importación activa para esta fecha y sucursal (ID #{sheet.conflict_import_id}).
              </p>
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-amber-100">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => onReplaceChange(e.target.checked)}
                  className="accent-amber-500"
                />
                Reemplazar importación existente (la anulará automáticamente)
              </label>
            </div>
          )}

          {sheet.ok && sheet.total_records > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-xs text-white/50">Líneas</div>
                <div className="font-bold text-white">{sheet.total_records}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-xs text-white/50">PVP total</div>
                <div className="font-bold text-emerald-400">{fmt(sheet.total_pvp)}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-xs text-white/50">Efectivo</div>
                <div className="font-bold text-white">{fmt(sheet.total_efectivo)}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-xs text-white/50">Transferencia</div>
                <div className="font-bold text-white">{fmt(sheet.total_transferencia)}</div>
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-2 text-center">
                <div className="text-xs text-emerald-200/70">Vinculados</div>
                <div className="font-bold text-emerald-300">{sheet.matched_products + sheet.matched_by_alias}</div>
              </div>
              <div className="rounded-lg bg-amber-500/10 p-2 text-center">
                <div className="text-xs text-amber-200/70">Sin vincular</div>
                <div className="font-bold text-amber-300">{sheet.unmatched_products}</div>
              </div>
            </div>
          )}

          {sheet.ok && sheet.records_preview.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs text-white/50 hover:text-white/80"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? 'Ocultar' : 'Ver'} primeras {sheet.records_preview.length} líneas
              </button>
              {expanded && (
                <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-3 py-1.5 text-left text-white/50">Remito</th>
                        <th className="px-3 py-1.5 text-left text-white/50">Producto</th>
                        <th className="px-3 py-1.5 text-left text-white/50">SKU</th>
                        <th className="px-3 py-1.5 text-left text-white/50">Condición</th>
                        <th className="px-3 py-1.5 text-right text-white/50">PVP</th>
                        <th className="px-3 py-1.5 text-right text-white/50">Total cobrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.records_preview.map((r, i) => (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-3 py-1.5 text-white/70">{r.remito || '-'}</td>
                          <td className="max-w-[200px] truncate px-3 py-1.5 text-white">{r.producto}</td>
                          <td className="px-3 py-1.5 font-mono text-white/70">{r.sku || '-'}</td>
                          <td className="px-3 py-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-xs ${r.condicion === 'OUTLET' ? 'bg-orange-500/20 text-orange-300' : 'bg-white/10 text-white/60'}`}>
                              {r.condicion}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-white/70">{fmt(r.pvp)}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-emerald-400">{fmt(r.total_cobrado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SUCURSALES = ['Caseros', 'Canning', 'Norcenter', 'Lanus'] as const;
type SucursalName = typeof SUCURSALES[number];

type SheetEntry = {
  id: string;
  // - URL tab: `${sucursal}::${sheet_name}`
  // - File tab: `file::${fileName}::${sheet_name}` — el fileName es necesario
  //   en el id para que dos archivos con una hoja llamada "Planilla" no
  //   colisionen cuando subís múltiples archivos en simultáneo.
  sheet: SalesBISheetPreview;
  url: string;       // empty for file tab
  sucursal: string;  // empty for file tab (auto-detected)
  temp_file_key: string | null; // only for file tab — uno por archivo
  fileName?: string; // solo file tab — para mostrarlo en la UI
};

export function SalesBIImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [urls, setUrls] = useState<Record<SucursalName, string>>({ Caseros: '', Canning: '', Norcenter: '', Lanus: '' });
  const [analyzing, setAnalyzing] = useState(false);
  // Progreso del análisis cuando se suben varios archivos a la vez
  // ({ done: cuántos archivos terminaron, total: cuántos en total }).
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<SheetEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replaceMap, setReplaceMap] = useState<Record<string, boolean>>({});

  if (!can('sales_bi.import')) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">
        Sin permiso para importar planillas.
      </div>
    );
  }

  async function handleAnalyzeFile() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    setError('');
    setEntries([]);
    setSelected(new Set());
    setReplaceMap({});
    setAnalyzing(true);
    setAnalyzeProgress({ done: 0, total: fileList.length });
    // Analizamos en batches de 3 para no saturar el backend si el usuario
    // sube 30+ planillas. Cada análisis sube el archivo, lo parsea y
    // devuelve un `temp_file_key` que después usamos en confirm.
    const batchSize = 3;
    const allEntries: SheetEntry[] = [];
    const errors: string[] = [];
    try {
      for (let i = 0; i < fileList.length; i += batchSize) {
        const batch = fileList.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map((f) => salesBIAnalyzeFile(f)));
        results.forEach((res, idx) => {
          const file = batch[idx];
          if (res.status === 'rejected') {
            const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
            errors.push(`${file.name}: ${msg}`);
            return;
          }
          for (const sheet of res.value.sheets) {
            allEntries.push({
              id: `file::${file.name}::${sheet.sheet_name}`,
              sheet,
              url: '',
              sucursal: '',
              temp_file_key: res.value.temp_file_key,
              fileName: file.name,
            });
          }
        });
        setAnalyzeProgress({ done: Math.min(i + batchSize, fileList.length), total: fileList.length });
      }
      setEntries(allEntries);
      setSelected(new Set(allEntries.filter((e) => e.sheet.ok && e.sheet.total_records > 0).map((e) => e.id)));
      if (errors.length > 0) setError(`Algunas planillas fallaron: ${errors.join(' | ')}`);
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
      // Limpiar el input para que el usuario pueda re-seleccionar los mismos archivos
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleAnalyzeUrls() {
    const targets = SUCURSALES.map((s) => ({ sucursal: s, url: urls[s].trim() })).filter((t) => t.url);
    if (targets.length === 0) {
      setError('Ingresá al menos una URL de Google Sheets.');
      return;
    }
    setError('');
    setEntries([]);
    setSelected(new Set());
    setReplaceMap({});
    setAnalyzing(true);
    try {
      const allEntries: SheetEntry[] = [];
      const errors: string[] = [];
      await Promise.all(
        targets.map(async ({ sucursal, url }) => {
          try {
            const result = await salesBIAnalyzeUrl(url, sucursal);
            for (const sheet of result.sheets) {
              allEntries.push({ id: `${sucursal}::${sheet.sheet_name}`, sheet, url, sucursal, temp_file_key: null });
            }
          } catch (e: unknown) {
            errors.push(`${sucursal}: ${e instanceof Error ? e.message : 'Error'}`);
          }
        }),
      );
      if (errors.length > 0) setError(errors.join(' | '));
      setEntries(allEntries);
      setSelected(new Set(allEntries.filter((e) => e.sheet.ok && e.sheet.total_records > 0).map((e) => e.id)));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleConfirm() {
    if (entries.length === 0) return;
    setError('');
    setConfirming(true);
    try {
      const selectedEntries = entries.filter((e) => selected.has(e.id));

      if (tab === 'file') {
        // Agrupamos por temp_file_key: cada archivo subido tiene su propio
        // key, y cada confirm SOLO importa hojas de UN file_key. Si el
        // usuario subió 37 planillas, hacemos 37 (o N≤37 según cuántas
        // tengan hojas seleccionadas) llamadas a /confirm.
        const byKey = new Map<string, { temp_file_key: string; sheetNames: string[]; replace: boolean; fileName: string }>();
        for (const e of selectedEntries) {
          if (!e.temp_file_key) continue;
          const group = byKey.get(e.temp_file_key) ?? {
            temp_file_key: e.temp_file_key,
            sheetNames: [],
            replace: false,
            fileName: e.fileName || 'archivo',
          };
          group.sheetNames.push(e.sheet.sheet_name);
          if (replaceMap[e.id]) group.replace = true;
          byKey.set(e.temp_file_key, group);
        }

        let totalImported = 0;
        const allSkipped: string[] = [];
        // Secuencial: cada confirm puede insertar muchos records, no queremos
        // 37 transacciones contra Postgres en paralelo.
        for (const { temp_file_key, sheetNames, replace, fileName } of byKey.values()) {
          try {
            const result = await salesBIConfirm({ temp_file_key, sheet_names: sheetNames, replace });
            totalImported += result.imported.length;
            allSkipped.push(...result.skipped.map((s) => `${fileName}: ${s.reason}`));
          } catch (e) {
            allSkipped.push(`${fileName}: ${e instanceof Error ? e.message : 'Error'}`);
          }
        }

        if (totalImported > 0) {
          navigate('/ventas-bi/historial');
        } else {
          setError('Ninguna hoja fue importada. ' + allSkipped.join(' | '));
        }
        return;
      }

      // URL tab: group by url+sucursal, one confirm call per source
      const bySource = new Map<string, { url: string; sucursal: string; sheetNames: string[]; replace: boolean }>();
      for (const e of selectedEntries) {
        const key = `${e.sucursal}::${e.url}`;
        if (!bySource.has(key)) {
          bySource.set(key, { url: e.url, sucursal: e.sucursal, sheetNames: [], replace: false });
        }
        const src = bySource.get(key)!;
        src.sheetNames.push(e.sheet.sheet_name);
        if (replaceMap[e.id]) src.replace = true;
      }

      let totalImported = 0;
      const allSkipped: string[] = [];
      await Promise.all(
        [...bySource.values()].map(async ({ url, sucursal, sheetNames, replace }) => {
          const result = await salesBIConfirm({ sheet_url: url, sheet_names: sheetNames, replace, sucursal });
          totalImported += result.imported.length;
          allSkipped.push(...result.skipped.map((s) => s.reason));
        }),
      );

      if (totalImported > 0) {
        navigate('/ventas-bi/historial');
      } else {
        setError('Ninguna hoja fue importada. ' + allSkipped.join(' '));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al confirmar la importación.');
    } finally {
      setConfirming(false);
    }
  }

  const toggleSheet = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasConflict = entries.some((e) => selected.has(e.id) && e.sheet.conflict_import_id && !replaceMap[e.id]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-black text-white">Importar planilla de ventas</h1>
        <p className="mt-1 text-sm text-white/50">Subí un archivo Excel o pegá las URLs de las planillas de Google Sheets por sucursal.</p>
      </div>

      {/* Source selector */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => { setTab('file'); setEntries([]); setSelected(new Set()); setReplaceMap({}); setError(''); }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${tab === 'file' ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white/60 hover:text-white'}`}
          >
            <Upload size={15} />
            Archivo Excel
          </button>
          <button
            onClick={() => { setTab('url'); setEntries([]); setSelected(new Set()); setReplaceMap({}); setError(''); }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${tab === 'url' ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white/60 hover:text-white'}`}
          >
            <Link size={15} />
            Google Sheets
          </button>
        </div>

        {tab === 'file' ? (
          <div
            onClick={() => { if (!analyzing) fileRef.current?.click(); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all ${analyzing ? 'border-indigo-500/60 bg-indigo-500/10 cursor-wait' : 'border-white/20 hover:border-indigo-500/50 hover:bg-indigo-500/5'}`}
          >
            {analyzing && analyzeProgress ? (
              <>
                <Loader2 size={32} className="animate-spin text-indigo-300" />
                <div>
                  <p className="text-sm font-medium text-white">Analizando planillas…</p>
                  <p className="mt-1 text-xs text-white/60">
                    {analyzeProgress.done} de {analyzeProgress.total} ({Math.round((analyzeProgress.done / analyzeProgress.total) * 100)}%)
                  </p>
                </div>
                <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-[width] duration-300 ease-out"
                    style={{ width: `${(analyzeProgress.done / analyzeProgress.total) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <FileSpreadsheet size={32} className="text-white/30" />
                <div>
                  <p className="text-sm font-medium text-white/70">Hacé clic para seleccionar uno o varios archivos</p>
                  <p className="text-xs text-white/40">.xlsx — máx. 20 MB por archivo (podés subir 30+ en una sola carga)</p>
                </div>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleAnalyzeFile} />
          </div>
        ) : (
          <div className="space-y-3">
            {SUCURSALES.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium text-white/70">{s}</span>
                <input
                  type="url"
                  value={urls[s]}
                  onChange={(e) => setUrls((prev) => ({ ...prev, [s]: e.target.value }))}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500"
                />
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <button
                onClick={handleAnalyzeUrls}
                disabled={analyzing || SUCURSALES.every((s) => !urls[s].trim())}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-indigo-500"
              >
                {analyzing ? <Loader2 size={15} className="animate-spin" /> : null}
                Analizar planillas
              </button>
            </div>
          </div>
        )}

        {analyzing && (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Loader2 size={15} className="animate-spin" />
            Analizando planillas...
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Preview */}
      {entries.length > 0 && (
        <div className="space-y-4">
          {/* Summary header */}
          {(() => {
            const fileNames = new Set(entries.map((e) => e.fileName).filter(Boolean));
            const totalSheets = entries.length;
            const selCount = entries.filter((e) => selected.has(e.id)).length;
            const okCount = entries.filter((e) => e.sheet.ok && e.sheet.total_records > 0).length;
            return (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white">
                  Resultado del análisis
                  <span className="ml-2 text-sm font-normal text-white/55">
                    {fileNames.size > 0 && `${fileNames.size} archivo${fileNames.size !== 1 ? 's' : ''} · `}
                    {totalSheets} hoja{totalSheets !== 1 ? 's' : ''} ({okCount} con datos)
                  </span>
                </h2>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(entries.filter((e) => e.sheet.ok && e.sheet.total_records > 0).map((e) => e.id)))}
                    className="rounded-lg border border-white/15 px-3 py-1.5 font-bold text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    Seleccionar todas ({okCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    disabled={selCount === 0}
                    className="rounded-lg border border-white/15 px-3 py-1.5 font-bold text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            );
          })()}

          <div className="space-y-3">
            {entries.map((entry) => (
              <SheetCard
                key={entry.id}
                id={entry.id}
                sheet={entry.sheet}
                selected={selected.has(entry.id)}
                onToggle={() => toggleSheet(entry.id)}
                replace={!!replaceMap[entry.id]}
                onReplaceChange={(v) => setReplaceMap((prev) => ({ ...prev, [entry.id]: v }))}
                fileName={entry.fileName}
              />
            ))}
          </div>

          {hasConflict && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              Hay hojas con importaciones activas para la misma fecha y sucursal. Marcá la opción de reemplazar en cada una para continuar.
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleConfirm}
              disabled={confirming || selected.size === 0 || !!hasConflict}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 font-medium text-white disabled:opacity-40 hover:bg-emerald-500"
            >
              {confirming ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Confirmar importación ({selected.size} hoja{selected.size !== 1 ? 's' : ''})
            </button>
            <button
              onClick={() => { setEntries([]); setSelected(new Set()); setReplaceMap({}); setError(''); }}
              className="rounded-xl px-4 py-2.5 text-sm text-white/50 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
