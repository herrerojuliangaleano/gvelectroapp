// Formulario compartido de Alta / Normalización del catálogo maestro.
// - Campos dinámicos según rubro (template del backend).
// - "No aplica" por campo (omite el campo de la generación, sin que la app lo exija).
// - Preview en vivo (descripción comercial + ERP con contador de 50).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react';
import {
  catalogPreview, createCatalogProduct, fetchCatalogOptions, fetchCatalogTemplate,
  normalizeCatalogProduct,
} from '../api/client';
import type { CatalogField, CatalogOptions, CatalogPreview, CatalogProduct, LegacyPendingItem } from '../types';

interface Props {
  mode: 'alta' | 'normalizacion';
  legacy?: LegacyPendingItem | null;   // sólo en normalización
  onSaved?: (p: CatalogProduct) => void;
}

const lbl = 'mb-1 block text-xs font-bold text-slate-400';
const inp = 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-indigo-400';

export function CatalogProductForm({ mode, legacy, onSaved }: Props) {
  const [options, setOptions] = useState<CatalogOptions | null>(null);
  const [familia, setFamilia] = useState('');
  const [rubro, setRubro] = useState('');
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [skuBase, setSkuBase] = useState('');
  const [condicion, setCondicion] = useState('PRIMERA');
  const [codigoPuma, setCodigoPuma] = useState('');
  const [pvp, setPvp] = useState('');
  const [costo, setCosto] = useState('');
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [noAplica, setNoAplica] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [activar, setActivar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // cargar opciones
  useEffect(() => { fetchCatalogOptions().then(setOptions).catch((e) => setError(e.message)); }, []);

  // prefill en normalización desde el legacy
  useEffect(() => {
    if (mode !== 'normalizacion' || !legacy || !options) return;
    setMarca(legacy.marca || '');
    setModelo(legacy.sku || '');
    setSkuBase((legacy.sku || '').replace(/\s*\(O\)\s*$/i, '').trim());
    setCondicion(/\(O\)/i.test(legacy.sku || '') || /outlet/i.test(legacy.descripcion || '') ? 'OUTLET' : 'PRIMERA');
    if (legacy.pvp != null) setPvp(String(legacy.pvp));
    if (legacy.costo_vigente != null) setCosto(String(legacy.costo_vigente));
    // intentar adivinar rubro por el tipo del legacy
    const tipoUp = (legacy.tipo || '').toUpperCase().trim();
    for (const [fam, rubros] of Object.entries(options.rubros_por_familia)) {
      if (rubros.includes(tipoUp)) { setFamilia(fam); setRubro(tipoUp); break; }
    }
  }, [mode, legacy, options]);

  // al cambiar rubro, traer template
  useEffect(() => {
    if (!familia || !rubro) { setFields([]); return; }
    fetchCatalogTemplate(familia, rubro)
      .then((t) => { setFields(t.campos_obligatorios || []); })
      .catch(() => setFields([]));
  }, [familia, rubro]);

  // preview en vivo (debounce)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runPreview = useCallback(() => {
    if (!familia || !rubro) { setPreview(null); return; }
    const camposEnviar: Record<string, string> = {};
    for (const f of fields) {
      if (noAplica[f.name]) continue;            // "no aplica" → se omite
      if (campos[f.name]) camposEnviar[f.name] = campos[f.name];
    }
    catalogPreview({ familia_app: familia, rubro_app: rubro, marca, modelo, sku_base: skuBase, condicion, campos: camposEnviar })
      .then(setPreview).catch(() => setPreview(null));
  }, [familia, rubro, fields, campos, noAplica, marca, modelo, skuBase, condicion]);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(runPreview, 280);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [runPreview]);

  const rubros = useMemo(() => (familia && options ? options.rubros_por_familia[familia] || [] : []), [familia, options]);
  const erpLen = preview?.descripcion_erp_len ?? 0;
  const erpOver = erpLen > 50;

  async function save() {
    setSaving(true); setError(''); setOkMsg('');
    const camposEnviar: Record<string, string> = {};
    for (const f of fields) {
      if (noAplica[f.name]) continue;
      if (campos[f.name]) camposEnviar[f.name] = campos[f.name];
    }
    const payload: Record<string, unknown> = {
      familia_app: familia, rubro_app: rubro, marca, modelo, sku_base: skuBase,
      condicion, codigo_puma: codigoPuma, campos: camposEnviar,
      pvp: pvp || undefined, costo: costo || undefined, activar,
    };
    try {
      let res: CatalogProduct;
      if (mode === 'normalizacion') {
        if (!legacy) throw new Error('No hay producto legacy seleccionado.');
        res = await normalizeCatalogProduct({ ...payload, legacy_product_id: legacy.legacy_id });
      } else {
        res = await createCatalogProduct(payload);
      }
      if (res.errores && res.errores.length) {
        setOkMsg(`Guardado como ${res.estado}. Pendiente: ${res.errores.join(' ')}`);
      } else {
        setOkMsg(`Guardado como ${res.estado}.`);
      }
      onSaved?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally { setSaving(false); }
  }

  if (!options) return <div className="flex items-center gap-2 text-slate-400"><Loader2 className="size-4 animate-spin" /> Cargando…</div>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {okMsg && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100 flex items-center gap-2"><Check className="size-4" />{okMsg}</div>}

      {/* clasificación */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={lbl}>Familia</span>
          <select className={inp} value={familia} onChange={(e) => { setFamilia(e.target.value); setRubro(''); }}>
            <option value="">Elegí familia</option>
            {options.familias.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label><span className={lbl}>Rubro</span>
          <select className={inp} value={rubro} onChange={(e) => setRubro(e.target.value)} disabled={!familia}>
            <option value="">Elegí rubro</option>
            {rubros.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      {/* identificación */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className={lbl}>Marca</span>
          <input className={inp} list="catalog-marcas" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Elegí o escribí" />
          <datalist id="catalog-marcas">{options.marcas.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label><span className={lbl}>Modelo</span><input className={inp} value={modelo} onChange={(e) => setModelo(e.target.value)} /></label>
        <label><span className={lbl}>SKU base</span><input className={inp} value={skuBase} onChange={(e) => setSkuBase(e.target.value)} /></label>
        <label><span className={lbl}>Condición</span>
          <select className={inp} value={condicion} onChange={(e) => setCondicion(e.target.value)}>
            {options.condiciones.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {/* campos dinámicos del rubro con "No aplica" */}
      {fields.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-400">Datos del rubro</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const off = !!noAplica[f.name];
              return (
                <div key={f.name} className={`rounded-xl border p-3 ${off ? 'border-slate-800 bg-slate-950/40 opacity-60' : 'border-slate-800 bg-slate-950/60'}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">{f.label}{f.obligatorio && !off && <span className="text-amber-400"> *</span>}</span>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <input type="checkbox" checked={off} onChange={(e) => setNoAplica((n) => ({ ...n, [f.name]: e.target.checked }))} />
                      No aplica
                    </label>
                  </div>
                  {f.type === 'select' ? (
                    <select className={inp} disabled={off} value={campos[f.name] || ''} onChange={(e) => setCampos((c) => ({ ...c, [f.name]: e.target.value }))}>
                      <option value="">—</option>
                      {(f.opciones || []).map((o) => <option key={o.valor} value={o.valor}>{o.comercial || o.valor}</option>)}
                    </select>
                  ) : (
                    <input className={inp} disabled={off} type={f.type === 'number' ? 'number' : 'text'}
                      value={campos[f.name] || ''} onChange={(e) => setCampos((c) => ({ ...c, [f.name]: e.target.value }))} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* puma + precio/costo */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className={lbl}>Código Puma {activar && <span className="text-amber-400">(necesario para activar)</span>}</span><input className={inp} value={codigoPuma} onChange={(e) => setCodigoPuma(e.target.value)} /></label>
        <label><span className={lbl}>PVP</span><input className={inp} type="number" value={pvp} onChange={(e) => setPvp(e.target.value)} /></label>
        <label><span className={lbl}>Costo</span><input className={inp} type="number" value={costo} onChange={(e) => setCosto(e.target.value)} /></label>
      </div>

      {/* PREVIEW en vivo */}
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
        <div className="mb-2 text-xs font-black uppercase tracking-wide text-indigo-300">Vista previa</div>
        {preview?.error ? (
          <div className="text-sm text-amber-200">{preview.error}</div>
        ) : (
          <div className="space-y-2 text-sm">
            <div><span className="text-slate-400">SKU comercial: </span><b className="text-slate-100">{preview?.sku_comercial || '—'}</b></div>
            <div><span className="text-slate-400">Comercial: </span><b className="text-slate-100">{preview?.descripcion_comercial || '—'}</b></div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">ERP: </span>
              <b className={erpOver ? 'text-red-300' : 'text-slate-100'}>{preview?.descripcion_erp || '—'}</b>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${erpOver ? 'bg-red-500/20 text-red-200' : 'bg-emerald-500/20 text-emerald-200'}`}>{erpLen}/50</span>
              {preview?.estado_erp && preview.estado_erp !== 'OK_ERP_50' && (
                <span className="text-[11px] text-amber-300">{preview.estado_erp}</span>
              )}
            </div>
            <div><span className="text-slate-400">Subrubro: </span><span className="text-slate-300">{preview?.subrubro || '—'}</span></div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={activar} onChange={(e) => setActivar(e.target.checked)} />
          Activar (requiere código Puma y datos completos)
        </label>
        <button onClick={save} disabled={saving || !familia || !rubro || !marca || !skuBase}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {mode === 'normalizacion' ? 'Normalizar y vincular' : 'Guardar producto'}
        </button>
      </div>
      {(activar && !codigoPuma) && (
        <div className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle className="size-3.5" /> Sin código Puma el producto no se activa; queda pendiente.</div>
      )}
    </div>
  );
}
