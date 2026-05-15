import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Link2, RefreshCw, Save, Settings, ShieldCheck } from 'lucide-react';
import { fetchWarrantyConfig, saveWarrantyConfig } from '../api/client';
import type { WarrantyConfigResponse } from '../types';

const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-400';
const cardClass = 'rounded-3xl border border-slate-800 bg-slate-950/70 p-5 shadow-xl';

const REVIEW_FIELDS = [
  ['producto', 'Producto'],
  ['sku', 'SKU'],
  ['marca', 'Marca'],
  ['serie', 'Serie'],
  ['falla', 'Falla'],
  ['sucursal', 'Sucursal'],
  ['deposito', 'Depósito'],
  ['lugar_llegada', 'Lugar llegada'],
  ['observaciones', 'Observaciones'],
  ['photos_reference', 'Referencia fotos'],
];

function linesToList(value: string): string[] {
  return value.split('\n').map((x) => x.trim()).filter(Boolean);
}

function numbersToList(value: string): number[] {
  return Array.from(new Set(value.split(/[\n,;]/).map((x) => Number.parseInt(x.trim(), 10)).filter((x) => Number.isFinite(x) && x > 0))).sort((a, b) => a - b);
}

export function WarrantyConfigPage() {
  const [data, setData] = useState<WarrantyConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [statuses, setStatuses] = useState('');
  const [finalStatuses, setFinalStatuses] = useState('');
  const [sucursales, setSucursales] = useState('');
  const [depositos, setDepositos] = useState('');
  const [delayRanges, setDelayRanges] = useState('');
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [rawSheet, setRawSheet] = useState('');
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');

  function hydrate(next: WarrantyConfigResponse) {
    setData(next);
    setStatuses((next.config.statuses || []).join('\n'));
    setFinalStatuses((next.config.final_statuses || []).join('\n'));
    setSucursales((next.config.sucursales || []).join('\n'));
    setDepositos((next.config.depositos || []).join('\n'));
    setDelayRanges((next.config.delay_ranges || []).join(', '));
    setRequiredFields(next.config.required_review_fields || []);
    setRawSheet(next.config.sheet_raw || '');
    setSpreadsheetUrl(next.config.spreadsheet_url || '');
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      hydrate(await fetchWarrantyConfig());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración de garantías');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const saved = await saveWarrantyConfig({
        statuses: linesToList(statuses),
        final_statuses: linesToList(finalStatuses),
        sucursales: linesToList(sucursales),
        depositos: linesToList(depositos),
        delay_ranges: numbersToList(delayRanges),
        required_review_fields: requiredFields,
        raw_sheet: rawSheet,
        spreadsheet_url: spreadsheetUrl,
      });
      hydrate(saved);
      setMessage('Configuración de garantías actualizada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración');
    } finally {
      setSaving(false);
    }
  }

  const missingProviderRatio = useMemo(() => {
    if (!data?.brands_count) return 0;
    return Math.round((data.unmapped_brands_count / data.brands_count) * 100);
  }, [data]);

  if (loading) return <div className={cardClass}>Cargando configuración...</div>;

  return <form onSubmit={submit} className="mx-auto max-w-7xl space-y-6">
    {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}
    {message && <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}

    <section className={cardClass}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-100"><Settings size={14} /> Configuración avanzada</div>
          <h1 className="mt-3 text-3xl font-black text-white">Garantías</h1>
          <p className="mt-2 max-w-3xl text-slate-400">Catálogos, revisión, demoras y control operativo del flujo de garantías.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-100 hover:bg-slate-900"><RefreshCw size={18} /> Actualizar</button>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-60"><Save size={18} /> {saving ? 'Guardando...' : 'Guardar configuración'}</button>
        </div>
      </div>
      {data && <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Garantías activas" value={data.active_count} />
        <Metric label="Pendientes de revisión" value={data.pending_review_count} />
        <Metric label="Proveedores" value={data.providers_count} />
        <Metric label="Marcas" value={data.brands_count} />
        <Metric label="Marcas sin proveedor" value={`${data.unmapped_brands_count} (${missingProviderRatio}%)`} warn={data.unmapped_brands_count > 0} />
      </div>}
    </section>

    <section className="grid gap-6 xl:grid-cols-2">
      <div className={cardClass}>
        <h2 className="flex items-center gap-2 text-xl font-black text-white"><ShieldCheck size={20} /> Estados</h2>
        <p className="mt-1 text-sm text-slate-400">Un estado por línea. Mantené la numeración si la Google Sheet de gerencia la usa en informes.</p>
        <textarea className={`${inputClass} mt-4 min-h-64 font-mono`} value={statuses} onChange={(e) => setStatuses(e.target.value)} />
      </div>
      <div className={cardClass}>
        <h2 className="text-xl font-black text-white">Estados finales</h2>
        <p className="mt-1 text-sm text-slate-400">Se usan para calcular resolución y métricas de cierre.</p>
        <textarea className={`${inputClass} mt-4 min-h-64 font-mono`} value={finalStatuses} onChange={(e) => setFinalStatuses(e.target.value)} />
      </div>
    </section>

    <section className="grid gap-6 xl:grid-cols-2">
      <div className={cardClass}>
        <h2 className="text-xl font-black text-white">Sucursales de garantías</h2>
        <p className="mt-1 text-sm text-slate-400">Catálogo operativo usado en alta, filtros y exportaciones.</p>
        <textarea className={`${inputClass} mt-4 min-h-52 font-mono`} value={sucursales} onChange={(e) => setSucursales(e.target.value)} />
      </div>
      <div className={cardClass}>
        <h2 className="text-xl font-black text-white">Depósitos y lugares</h2>
        <p className="mt-1 text-sm text-slate-400">Lugares actuales o destinos internos para seguimiento.</p>
        <textarea className={`${inputClass} mt-4 min-h-52 font-mono`} value={depositos} onChange={(e) => setDepositos(e.target.value)} />
      </div>
    </section>

    <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <div className={cardClass}>
        <h2 className="text-xl font-black text-white">Revisión interna</h2>
        <p className="mt-1 text-sm text-slate-400">Campos que se controlan antes de pasar una garantía a pendiente.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {REVIEW_FIELDS.map(([value, label]) => <label key={value} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-200">
            <input type="checkbox" checked={requiredFields.includes(value)} onChange={(e) => setRequiredFields((prev) => e.target.checked ? Array.from(new Set([...prev, value])) : prev.filter((x) => x !== value))} />
            <span>{label}</span>
          </label>)}
        </div>
      </div>
      <div className={cardClass}>
        <h2 className="text-xl font-black text-white">Demoras</h2>
        <p className="mt-1 text-sm text-slate-400">Rangos usados en dashboard y seguimiento. Separalos con coma.</p>
        <input className={`${inputClass} mt-4`} value={delayRanges} onChange={(e) => setDelayRanges(e.target.value)} placeholder="3, 7, 14, 30" />
        <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><AlertTriangle size={18} className="mb-2" /> Las garantías anuladas quedan en historial y no se eliminan de la base.</div>
      </div>
    </section>

    <section className={cardClass}>
      <h2 className="text-xl font-black text-white">Google Sheet de garantías</h2>
      <p className="mt-1 text-sm text-slate-400">La app opera con base local. Esta planilla queda como espejo para informes y gerencia.</p>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_280px_auto]">
        <label><span className="mb-2 block text-sm font-bold text-slate-300">URL Google Sheet</span><input className={inputClass} value={spreadsheetUrl} onChange={(e) => setSpreadsheetUrl(e.target.value)} /></label>
        <label><span className="mb-2 block text-sm font-bold text-slate-300">Hoja raw</span><input className={inputClass} value={rawSheet} onChange={(e) => setRawSheet(e.target.value)} /></label>
        <Link to="/admin/operational-config" className="inline-flex items-center justify-center gap-2 self-end rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-100 hover:bg-slate-900"><Link2 size={18} /> Configuración operativa</Link>
      </div>
    </section>

    <section className={cardClass}>
      <h2 className="text-xl font-black text-white">Proveedores y marcas</h2>
      <p className="mt-1 text-sm text-slate-400">Las marcas vienen del catálogo de productos. Los proveedores se administran desde Productos y proveedores.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/productos" className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-black text-white hover:bg-blue-400">Abrir productos y proveedores</Link>
        <Link to="/warranties/gestion" className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-100 hover:bg-slate-900">Ir a gestión</Link>
      </div>
    </section>
  </form>;
}

function Metric({ label, value, warn = false }: { label: string; value: string | number; warn?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${warn ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-800 bg-slate-900/70'}`}><div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-2 text-2xl font-black ${warn ? 'text-amber-100' : 'text-white'}`}>{value}</div></div>;
}
