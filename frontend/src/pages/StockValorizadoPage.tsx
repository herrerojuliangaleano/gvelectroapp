import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, ExternalLink, FileSpreadsheet, MessageSquare, Upload } from 'lucide-react';
import {
  fetchOperationalStructure,
  fetchStockValorizadoMensaje,
  procesarStockValorizadoMasivo,
  type StockValorizadoBulkResult,
} from '../api/client';
import type { BranchInfo } from '../types';
import {
  ErpButton,
  ErpCard,
  ErpField,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
} from '../components/ProUI';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const nf = new Intl.NumberFormat('es-AR');

export function StockValorizadoPage() {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [sucursal, setSucursal] = useState('');
  const [fecha, setFecha] = useState(todayISO());
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockValorizadoBulkResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [mensaje, setMensaje] = useState('');
  const [mensajeVacio, setMensajeVacio] = useState(false);
  const [mensajeLoading, setMensajeLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function generarMensaje() {
    setMensajeLoading(true);
    setError(null);
    setCopiado(false);
    try {
      const res = await fetchStockValorizadoMensaje(fecha);
      setMensaje(res.mensaje);
      setMensajeVacio(!res.mensaje);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el mensaje');
    } finally {
      setMensajeLoading(false);
    }
  }

  async function copiarMensaje() {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    fetchOperationalStructure()
      .then((s) => setBranches(s.branches || []))
      .catch(() => undefined);
  }, []);

  const sucursalOptions = useMemo(
    () => [...new Set(branches.map((b) => b.name).filter(Boolean))].sort(),
    [branches],
  );

  const selectedFileNames = useMemo(() => files.map((file) => file.name), [files]);
  const canRun = Boolean(files.length && !loading);
  const okItems = result?.items.filter((item) => item.ok) || [];
  const totalUnidades = okItems.reduce((acc, item) => acc + (item.cantidad_total || 0), 0);
  const totalValorizado = okItems.reduce((acc, item) => acc + (item.valuacion_total || 0), 0);

  async function run() {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setMensaje('');
    setMensajeVacio(false);
    try {
      const res = await procesarStockValorizadoMasivo({ files, sucursal, fecha });
      setResult(res);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el lote');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="erp-stack-4">
      <ErpPageHeader
        title="Stock valorizado"
        description="Subi uno o varios Excel del ERP; la app toma fecha y sucursal desde el nombre, limpia totales y guarda cada archivo en Drive."
      />

      <ErpCard title="Carga masiva" subtitle="Formato recomendado: stock valorizado canning 11-07-2026.xlsx. Tambien acepta caseros, lanus y norte.">
        <div className="erp-stack-3" style={{ maxWidth: 720 }}>
          <div className="grid gap-3 md:grid-cols-2">
            <ErpField label="Sucursal de respaldo" hint="Se usa solo si el nombre no trae caseros/canning/lanus/norte.">
              <ErpSelect value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
                <option value="">Detectar desde archivo</option>
                {sucursalOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </ErpSelect>
            </ErpField>

            <ErpField label="Fecha de respaldo" hint="Si el nombre trae DD-MM-YYYY, esa fecha tiene prioridad.">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-1)] outline-none focus:border-[color:var(--primary)]"
              />
            </ErpField>
          </div>

          <ErpField label="Archivos (.xlsx)" required hint="Podes seleccionar todos los archivos de una vez.">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-2)] file:mr-3 file:rounded-lg file:border-0 file:bg-[color:var(--primary)] file:px-3 file:py-1.5 file:text-white"
            />
          </ErpField>

          {selectedFileNames.length > 0 && (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-sm text-[color:var(--text-2)]">
              <div className="font-bold text-[color:var(--text-1)]">{selectedFileNames.length} archivos seleccionados</div>
              <div className="mt-2 max-h-32 space-y-1 overflow-auto font-mono text-xs">
                {selectedFileNames.map((name) => <div key={name}>{name}</div>)}
              </div>
            </div>
          )}

          {error && <ErpNotice tone="error">{error}</ErpNotice>}

          <ErpButton variant="primary" onClick={run} disabled={!canRun} loading={loading}>
            <Upload size={16} /> {loading ? 'Procesando y subiendo...' : `Procesar ${files.length || ''} archivo${files.length === 1 ? '' : 's'}`}
          </ErpButton>
        </div>
      </ErpCard>

      <ErpCard title="Mensaje para WhatsApp" subtitle="Junta las sucursales subidas en la fecha elegida como respaldo.">
        <div className="erp-stack-3" style={{ maxWidth: 560 }}>
          <ErpButton variant="secondary" onClick={generarMensaje} loading={mensajeLoading}>
            <MessageSquare size={16} /> Generar mensaje del dia
          </ErpButton>
          {mensajeVacio && !mensaje && (
            <ErpNotice tone="info">No hay sucursales subidas para esa fecha todavia.</ErpNotice>
          )}
          {mensaje && (
            <>
              <textarea
                readOnly
                value={mensaje}
                rows={Math.min(22, mensaje.split('\n').length + 1)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 font-mono text-[13px] leading-relaxed text-[color:var(--text-1)] outline-none"
              />
              <ErpButton variant="primary" onClick={copiarMensaje}>
                <Copy size={16} /> {copiado ? 'Copiado!' : 'Copiar mensaje'}
              </ErpButton>
            </>
          )}
        </div>
      </ErpCard>

      {result && (
        <ErpCard>
          <div className="erp-stack-3">
            <div className="flex items-center gap-2 text-[color:var(--success-2)]">
              <CheckCircle2 size={18} />
              <span className="font-bold">Carga procesada</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi label="Archivos" value={nf.format(result.total)} />
              <Kpi label="Subidos" value={nf.format(result.uploaded)} />
              <Kpi label="Errores" value={nf.format(result.errors)} />
              <Kpi label="Cantidad total" value={nf.format(totalUnidades)} />
              <Kpi label="Valuacion total" value={`$ ${nf.format(Math.round(totalValorizado))}`} />
            </div>
            <div className="space-y-3">
              {result.items.map((item) => (
                <div
                  key={item.filename}
                  className={`rounded-xl border p-3 text-sm ${
                    item.ok
                      ? 'border-[color:var(--border)] bg-[color:var(--surface-2)]'
                      : 'border-red-500/40 bg-red-500/10'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[color:var(--text-1)]">
                        {item.ok ? (
                          <FileSpreadsheet size={16} className="text-[color:var(--success-2)]" />
                        ) : (
                          <AlertCircle size={16} className="text-red-300" />
                        )}
                        <span className="truncate font-semibold">{item.filename}</span>
                      </div>
                      {item.ok ? (
                        <div className="mt-1 text-[color:var(--text-3)]">
                          Carpeta: {item.folder_name} · Sucursal: {item.sucursal} · Fecha: {item.fecha}
                        </div>
                      ) : (
                        <div className="mt-1 text-red-200">{item.error}</div>
                      )}
                    </div>
                    {item.ok && item.sheet_url && (
                      <a
                        href={item.sheet_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[color:var(--primary)] hover:underline"
                      >
                        <ExternalLink size={14} /> Abrir
                      </a>
                    )}
                  </div>
                  {item.ok && (
                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                      <MiniKpi label="Items" value={nf.format(item.items || 0)} />
                      <MiniKpi label="Cantidad" value={nf.format(item.cantidad_total || 0)} />
                      <MiniKpi label="Valorizado" value={`$ ${nf.format(Math.round(item.valuacion_total || 0))}`} />
                      <MiniKpi label="Negativos" value={nf.format(item.eliminados || 0)} />
                      <MiniKpi label="Totales quitados" value={nf.format(item.filas_total_eliminadas || 0)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </ErpCard>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-3)]">{label}</div>
      <div className="mt-1 text-lg font-black tabular-nums text-[color:var(--text-1)]">{value}</div>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-3)]">{label}</div>
      <div className="mt-1 font-black tabular-nums text-[color:var(--text-1)]">{value}</div>
    </div>
  );
}
