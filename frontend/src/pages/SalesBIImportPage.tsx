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
}: {
  id: string;
  sheet: SalesBISheetPreview;
  selected: boolean;
  onToggle: () => void;
  replace: boolean;
  onReplaceChange: (v: boolean) => void;
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
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
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
  id: string; // `${sucursal}::${sheet_name}` for url tab, `file::${sheet_name}` for file tab
  sheet: SalesBISheetPreview;
  url: string;       // empty for file tab
  sucursal: string;  // empty for file tab (auto-detected)
  temp_file_key: string | null; // only for file tab
};

export function SalesBIImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [urls, setUrls] = useState<Record<SucursalName, string>>({ Caseros: '', Canning: '', Norcenter: '', Lanus: '' });
  const [analyzing, setAnalyzing] = useState(false);
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
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError('');
    setEntries([]);
    setSelected(new Set());
    setReplaceMap({});
    setAnalyzing(true);
    try {
      const result = await salesBIAnalyzeFile(file);
      const newEntries: SheetEntry[] = result.sheets.map((sheet) => ({
        id: `file::${sheet.sheet_name}`,
        sheet,
        url: '',
        sucursal: '',
        temp_file_key: result.temp_file_key,
      }));
      setEntries(newEntries);
      setSelected(new Set(newEntries.filter((e) => e.sheet.ok && e.sheet.total_records > 0).map((e) => e.id)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al analizar el archivo.');
    } finally {
      setAnalyzing(false);
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
        const entry = selectedEntries[0];
        if (!entry) return;
        const temp_file_key = entry.temp_file_key ?? undefined;
        const replace = selectedEntries.some((e) => replaceMap[e.id]);
        const result = await salesBIConfirm({
          temp_file_key,
          sheet_names: selectedEntries.map((e) => e.sheet.sheet_name),
          replace,
        });
        if (result.imported.length > 0) {
          navigate('/ventas-bi/historial');
        } else {
          setError('Ninguna hoja fue importada. ' + result.skipped.map((s) => s.reason).join(' '));
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
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/20 p-8 text-center transition-all hover:border-indigo-500/50 hover:bg-indigo-500/5"
          >
            <FileSpreadsheet size={32} className="text-white/30" />
            <div>
              <p className="text-sm font-medium text-white/70">Hacé clic para seleccionar un archivo</p>
              <p className="text-xs text-white/40">.xlsx — máx. 20 MB</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleAnalyzeFile} />
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
          <h2 className="text-lg font-bold text-white">
            Resultado del análisis — {entries.length} hoja{entries.length !== 1 ? 's' : ''}
          </h2>

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
