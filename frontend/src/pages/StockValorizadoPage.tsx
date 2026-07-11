import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, FileSpreadsheet, MessageSquare, Upload } from 'lucide-react';
import {
  fetchOperationalStructure,
  fetchStockValorizadoMensaje,
  procesarStockValorizado,
  type StockValorizadoResult,
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
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockValorizadoResult | null>(null);
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

  const canRun = Boolean(sucursal && file && !loading);

  async function run() {
    if (!sucursal || !file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await procesarStockValorizado(sucursal, file, fecha);
      setResult(res);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el archivo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="erp-stack-4">
      <ErpPageHeader
        title="Stock valorizado"
        description="Subí el Excel crudo del ERP; se limpia, se resume y se guarda en Drive como Google Sheet, en la carpeta del mes."
      />

      <ErpCard title="Generar y subir" subtitle="Cada sucursal sube su archivo del día en su propio formulario.">
        <div className="erp-stack-3" style={{ maxWidth: 560 }}>
          <ErpField label="Sucursal" required>
            <ErpSelect value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              <option value="">Elegí la sucursal…</option>
              {sucursalOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </ErpSelect>
          </ErpField>

          <ErpField label="Fecha del stock" hint="Define la carpeta del mes en Drive. Por defecto, hoy.">
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-1)] outline-none focus:border-[color:var(--primary)]"
            />
          </ErpField>

          <ErpField label="Archivo (.xlsx)" required hint="El export de 'stock valorizado' del ERP.">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-2)] file:mr-3 file:rounded-lg file:border-0 file:bg-[color:var(--primary)] file:px-3 file:py-1.5 file:text-white"
            />
          </ErpField>

          {error && <ErpNotice tone="error">{error}</ErpNotice>}

          <ErpButton variant="primary" onClick={run} disabled={!canRun} loading={loading}>
            <Upload size={16} /> {loading ? 'Procesando y subiendo…' : 'Procesar y subir a Drive'}
          </ErpButton>
        </div>
      </ErpCard>

      <ErpCard title="Mensaje para WhatsApp" subtitle="Junta las sucursales subidas en la fecha elegida (arriba).">
        <div className="erp-stack-3" style={{ maxWidth: 560 }}>
          <ErpButton variant="secondary" onClick={generarMensaje} loading={mensajeLoading}>
            <MessageSquare size={16} /> Generar mensaje del día
          </ErpButton>
          {mensajeVacio && !mensaje && (
            <ErpNotice tone="info">No hay sucursales subidas para esa fecha todavía.</ErpNotice>
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
                <Copy size={16} /> {copiado ? '¡Copiado!' : 'Copiar mensaje'}
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
              <span className="font-bold">Subido a Drive</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Ítems" value={nf.format(result.items)} />
              <Kpi label="Cantidad total" value={nf.format(result.cantidad_total)} />
              <Kpi label="Valuación total" value={`$ ${nf.format(Math.round(result.valuacion_total))}`} />
              <Kpi label="Eliminados (Dispon < 0)" value={nf.format(result.eliminados)} />
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-sm">
              <div className="flex items-center gap-2 text-[color:var(--text-1)]">
                <FileSpreadsheet size={16} className="text-[color:var(--success-2)]" />
                <span className="font-semibold">{result.sheet_name}</span>
              </div>
              <div className="mt-1 text-[color:var(--text-3)]">Carpeta: {result.folder_name} · Sucursal: {result.sucursal}</div>
              <a
                href={result.sheet_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[color:var(--primary)] hover:underline"
              >
                <ExternalLink size={14} /> Abrir en Google Sheets
              </a>
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
