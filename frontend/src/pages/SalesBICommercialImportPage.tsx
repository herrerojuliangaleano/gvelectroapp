import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
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

export function SalesBICommercialImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<SalesBICommercialAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  if (!can('sales_bi.import')) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">
        Sin permiso para importar Ventas Vs. Costos.
      </div>
    );
  }

  async function handleFileChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError('');
    setAnalysis(null);
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
  }

  async function handleConfirm() {
    if (!analysis?.temp_file_key) return;
    setConfirming(true);
    setError('');
    try {
      await salesBICommercialConfirm({ temp_file_key: analysis.temp_file_key, fuente_nombre: fileName || analysis.source_name });
      navigate('/ventas-bi/marcas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar el lote comercial.');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <header className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[color:var(--chart-blue)]">Inteligencia comercial</div>
        <h1 className="text-3xl font-black tracking-tight text-[color:var(--text)]">Importar Ventas Vs. Costos</h1>
        <p className="max-w-3xl text-sm leading-6 text-[color:var(--text-2)]">
          Importador separado de las planillas diarias. Usa solo las hojas comerciales por sucursal y no carga datos operativos de pagos, senas, remitos ni vendedores.
        </p>
      </header>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/70 p-5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.03] px-4 py-10 text-center transition hover:border-[color:var(--chart-blue)]/50 hover:bg-[color:var(--chart-blue)]/5 disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? <Loader2 size={34} className="animate-spin text-[color:var(--chart-blue)]" /> : <Upload size={34} className="text-[color:var(--text-3)]" />}
          <div>
            <div className="font-bold text-[color:var(--text)]">{loading ? 'Analizando archivo...' : 'Seleccionar Excel Ventas Vs. Costos'}</div>
            <div className="mt-1 text-xs text-[color:var(--text-3)]">Hojas validas: GV Total, ABC Canning, ABC-Norte y ABC-Sur. BASE_* se ignora.</div>
          </div>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

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
                onClick={handleConfirm}
                disabled={confirming || !analysis.total_records}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-950/30 hover:bg-emerald-500 disabled:opacity-40"
              >
                {confirming ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Confirmar lote comercial
              </button>
            </div>
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
