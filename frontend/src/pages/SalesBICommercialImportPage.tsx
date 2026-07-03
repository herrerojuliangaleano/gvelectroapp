import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, SkipForward, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, salesBICommercialAnalyzeFile, salesBICommercialConfirm } from '../api/client';
import type { SalesBICommercialAnalyzeResponse, SalesBICommercialAnalyzeSheet } from '../types';
import { cn, money, num } from '../components/SalesBIWidgets';

function SheetSummary({ sheet }: { sheet: SalesBICommercialAnalyzeSheet }) {
  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-black text-[color:var(--text)]">{sheet.sheet_name}</span>
            <span className="rounded-full bg-[color:var(--chart-blue)]/15 px-2 py-0.5 text-xs font-bold text-[color:var(--chart-blue)]">{sheet.sucursal}</span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-xs font-bold',
              sheet.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300',
            )}>
              {sheet.ok ? 'Lista' : 'Sin datos'}
            </span>
          </div>
          <p className="mt-1 text-xs text-[color:var(--text-3)]">
            {sheet.period_start || '-'} al {sheet.period_end || '-'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
          <MiniStat label="Lineas" value={num(sheet.total_records)} />
          <MiniStat label="Unidades" value={num(sheet.total_units)} />
          <MiniStat label="Vendido" value={money(sheet.total_pvp)} />
          <MiniStat label="Sin match" value={num(sheet.unmatched_products)} tone={sheet.unmatched_products ? 'amber' : 'green'} />
        </div>
      </div>

      {sheet.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {sheet.warnings.map((warning, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {sheet.records_preview.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-xs">
            <thead className="bg-white/[0.04] text-[color:var(--text-3)]">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Marca</th>
                <th className="px-3 py-2 text-left">Linea</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">PVP</th>
              </tr>
            </thead>
            <tbody>
              {sheet.records_preview.map((record, idx) => (
                <tr key={`${record.sku}-${idx}`} className="border-t border-white/5">
                  <td className="px-3 py-2 text-[color:var(--text-2)]">{record.fecha}</td>
                  <td className="px-3 py-2 font-bold text-[color:var(--text)]">{record.marca}</td>
                  <td className="px-3 py-2 text-[color:var(--text-2)]">{record.tipo_producto}</td>
                  <td className="px-3 py-2 font-mono text-[color:var(--text-2)]">{record.sku || '-'}</td>
                  <td className="max-w-[320px] truncate px-3 py-2 text-[color:var(--text)]">{record.descripcion}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--text-2)]">{record.cantidad}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-300">{money(record.pvp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MiniStat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'green' }) {
  return (
    <div className={cn(
      'rounded-xl border px-3 py-2',
      tone === 'amber' ? 'border-amber-500/30 bg-amber-500/10' : tone === 'green' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-white/10 bg-white/[0.04]',
    )}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-3)]">{label}</div>
      <div className="mt-0.5 text-sm font-black text-[color:var(--text)]">{value}</div>
    </div>
  );
}

function OverlapWarning({ analysis }: { analysis: SalesBICommercialAnalyzeResponse }) {
  const overlaps = analysis.overlapping_batches || [];
  if (!overlaps.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <div className="flex items-center gap-2 font-black">
        <AlertTriangle size={16} /> Este período ya tiene datos importados
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {overlaps.map((o) => (
          <li key={o.id}>
            Lote #{o.id} · {o.fuente_nombre || 'sin nombre'} · {o.period_start} al {o.period_end} · {num(o.total_records)} líneas
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-200/80">
        Si lo importás igual, las ventas de esas fechas se van a contar DOS veces en los reportes. Lo correcto es anular el lote viejo primero (pestaña Lotes) o descartar este archivo.
      </p>
    </div>
  );
}

// ── Modo cola (varios archivos) ──────────────────────────────────────────────

type QueueStatus = 'pendiente' | 'analizando' | 'importando' | 'ok' | 'conflicto' | 'error';

interface QueueItem {
  file: File;
  name: string;
  status: QueueStatus;
  detail: string;
  tempKey?: string | null;
  period?: string;
  totals?: { records: number; pvp: number };
}

const STATUS_STYLE: Record<QueueStatus, string> = {
  pendiente: 'bg-white/10 text-[color:var(--text-2)]',
  analizando: 'bg-blue-500/15 text-blue-200',
  importando: 'bg-blue-500/15 text-blue-200',
  ok: 'bg-emerald-500/15 text-emerald-300',
  conflicto: 'bg-amber-500/15 text-amber-200',
  error: 'bg-red-500/15 text-red-300',
};

export function SalesBICommercialImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<SalesBICommercialAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);

  if (!can('sales_bi.import')) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">
        Sin permiso para importar Ventas Vs. Costos.
      </div>
    );
  }

  function patchQueue(index: number, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function processQueue(items: QueueItem[]) {
    setQueueRunning(true);
    for (let i = 0; i < items.length; i += 1) {
      patchQueue(i, { status: 'analizando', detail: 'Analizando…' });
      try {
        const result = await salesBICommercialAnalyzeFile(items[i].file);
        const period = `${result.period_start || '-'} al ${result.period_end || '-'}`;
        const totals = { records: result.total_records, pvp: result.total_pvp };
        if (!result.total_records) {
          patchQueue(i, { status: 'error', detail: 'Sin registros comerciales.', period, totals });
          continue;
        }
        if (result.overlapping_batches?.length) {
          const first = result.overlapping_batches[0];
          patchQueue(i, {
            status: 'conflicto',
            detail: `Período ya importado (lote #${first.id} · ${first.fuente_nombre || 'sin nombre'}). Salteado.`,
            tempKey: result.temp_file_key,
            period,
            totals,
          });
          continue;
        }
        patchQueue(i, { status: 'importando', detail: 'Importando…', period, totals });
        await salesBICommercialConfirm({ temp_file_key: result.temp_file_key || '', fuente_nombre: items[i].name });
        patchQueue(i, { status: 'ok', detail: `${num(totals.records)} líneas · ${money(totals.pvp)}` });
      } catch (err) {
        patchQueue(i, { status: 'error', detail: err instanceof Error ? err.message : 'Falló el import.' });
      }
    }
    setQueueRunning(false);
  }

  async function forceImport(index: number) {
    const item = queue[index];
    if (!item?.tempKey) return;
    patchQueue(index, { status: 'importando', detail: 'Importando (duplicado aceptado)…' });
    try {
      await salesBICommercialConfirm({ temp_file_key: item.tempKey, fuente_nombre: item.name, allow_overlap: true });
      patchQueue(index, { status: 'ok', detail: `Importado igual · ${item.detail}` });
    } catch (err) {
      patchQueue(index, { status: 'error', detail: err instanceof Error ? err.message : 'Falló el import.' });
    }
  }

  async function handleFileChange() {
    const files = Array.from(fileRef.current?.files || []);
    if (!files.length) return;
    setError('');
    setAnalysis(null);
    setQueue([]);

    if (files.length === 1) {
      const file = files[0];
      setFileName(file.name);
      setLoading(true);
      try {
        const result = await salesBICommercialAnalyzeFile(file);
        setAnalysis(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo analizar el archivo.');
      } finally {
        setLoading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
      return;
    }

    // Varios archivos → cola secuencial.
    const items: QueueItem[] = files.map((file) => ({ file, name: file.name, status: 'pendiente', detail: 'En cola' }));
    setQueue(items);
    if (fileRef.current) fileRef.current.value = '';
    await processQueue(items);
  }

  async function handleConfirm(allowOverlap: boolean) {
    if (!analysis?.temp_file_key) return;
    setConfirming(true);
    setError('');
    try {
      await salesBICommercialConfirm({
        temp_file_key: analysis.temp_file_key,
        fuente_nombre: fileName || analysis.source_name,
        allow_overlap: allowOverlap,
      });
      navigate('/ventas-bi/marcas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar el lote comercial.');
    } finally {
      setConfirming(false);
    }
  }

  const hasOverlap = !!analysis?.overlapping_batches?.length;
  const okCount = queue.filter((q) => q.status === 'ok').length;
  const conflictCount = queue.filter((q) => q.status === 'conflicto').length;
  const errorCount = queue.filter((q) => q.status === 'error').length;
  const queueDone = queue.length > 0 && !queueRunning && queue.every((q) => !['pendiente', 'analizando', 'importando'].includes(q.status));

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <header className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[color:var(--chart-blue)]">Inteligencia comercial</div>
        <h1 className="text-3xl font-black tracking-tight text-[color:var(--text)]">Importar Ventas Vs. Costos</h1>
        <p className="max-w-3xl text-sm leading-6 text-[color:var(--text-2)]">
          Podés seleccionar <strong>varios archivos a la vez</strong> (uno por mes): se importan en orden, y si un período ya está cargado se saltea para no duplicar ventas.
        </p>
      </header>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading || queueRunning}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.03] px-4 py-10 text-center transition hover:border-[color:var(--chart-blue)]/50 hover:bg-[color:var(--chart-blue)]/5 disabled:cursor-wait disabled:opacity-70"
        >
          {loading || queueRunning ? <Loader2 size={34} className="animate-spin text-[color:var(--chart-blue)]" /> : <Upload size={34} className="text-[color:var(--text-3)]" />}
          <div>
            <div className="font-bold text-[color:var(--text)]">
              {loading ? 'Analizando archivo...' : queueRunning ? 'Importando cola...' : 'Seleccionar uno o varios Excel Ventas Vs. Costos'}
            </div>
            <div className="mt-1 text-xs text-[color:var(--text-3)]">Hojas validas: GV Total, ABC Canning, ABC-Norte y ABC-Sur. BASE_* se ignora.</div>
          </div>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleFileChange} />
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Cola de importación múltiple ─────────────────────────────── */}
      {queue.length > 0 && (
        <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-lg font-black text-[color:var(--text)]">
              <FileSpreadsheet size={19} /> Cola de importación ({queue.length} archivos)
            </div>
            {queueDone && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-[color:var(--text-2)]">
                  ✓ {okCount} importados{conflictCount ? ` · ${conflictCount} salteados` : ''}{errorCount ? ` · ${errorCount} con error` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/ventas-bi/marcas')}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
                >
                  Ir al dashboard
                </button>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {queue.map((item, index) => (
              <div key={`${item.name}-${index}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                {['analizando', 'importando'].includes(item.status)
                  ? <Loader2 size={16} className="shrink-0 animate-spin text-blue-300" />
                  : item.status === 'ok'
                    ? <CheckCircle2 size={16} className="shrink-0 text-emerald-300" />
                    : item.status === 'conflicto'
                      ? <SkipForward size={16} className="shrink-0 text-amber-300" />
                      : item.status === 'error'
                        ? <AlertTriangle size={16} className="shrink-0 text-red-300" />
                        : <FileSpreadsheet size={16} className="shrink-0 text-[color:var(--text-3)]" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[color:var(--text)]">{item.name}</div>
                  <div className="text-xs text-[color:var(--text-3)]">
                    {item.period ? `${item.period} · ` : ''}{item.detail}
                  </div>
                </div>
                <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase', STATUS_STYLE[item.status])}>{item.status}</span>
                {item.status === 'conflicto' && item.tempKey && (
                  <button
                    type="button"
                    onClick={() => forceImport(index)}
                    className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/10"
                    title="Importa aunque el período ya tenga datos (va a duplicar ventas)"
                  >
                    Importar igual
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Análisis de archivo único ────────────────────────────────── */}
      {analysis && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-black text-[color:var(--text)]">
                  <FileSpreadsheet size={19} />
                  Resultado del analisis
                </div>
                <p className="mt-1 text-sm text-[color:var(--text-2)]">
                  {analysis.period_start || '-'} al {analysis.period_end || '-'} · {num(analysis.total_records)} lineas · {money(analysis.total_pvp)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleConfirm(hasOverlap)}
                disabled={confirming || !analysis.total_records}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-40',
                  hasOverlap
                    ? 'bg-amber-600 shadow-amber-950/30 hover:bg-amber-500'
                    : 'bg-emerald-600 shadow-emerald-950/30 hover:bg-emerald-500',
                )}
              >
                {confirming ? <Loader2 size={16} className="animate-spin" /> : hasOverlap ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                {hasOverlap ? 'Importar igual (duplica el período)' : 'Confirmar lote comercial'}
              </button>
            </div>
            <OverlapWarning analysis={analysis} />
            {analysis.warnings.length > 0 && (
              <div className="mt-4 space-y-1">
                {analysis.warnings.map((warning, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-amber-200">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    {warning}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-3">
            {analysis.sheets.map((sheet) => <SheetSummary key={sheet.sheet_name} sheet={sheet} />)}
          </div>
        </div>
      )}
    </div>
  );
}
