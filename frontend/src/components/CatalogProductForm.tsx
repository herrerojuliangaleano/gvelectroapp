// Formulario compartido de Alta / Normalización del catálogo maestro.
// "Armador" de descripción: el operador elige QUÉ atributos cargar, en QUÉ
// orden (▲▼), puede quitar los que no aplican y agregar detalles libres
// (ej "LÍNEA 2022", "(PN)"). Preview en vivo (comercial + ERP con contador 50).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Copy, Eye, Globe2, Loader2, PackageCheck, Plus, Save, Sparkles, X } from 'lucide-react';
import {
  addCatalogTemplateField, addCatalogTemplateFieldOption,
  catalogPreview, createCatalogProduct, fetchCatalogOptions, fetchCatalogTemplate,
  normalizeCatalogProduct,
} from '../api/client';
import type { CatalogField, CatalogOptions, CatalogPreview, CatalogProduct, LegacyPendingItem } from '../types';

interface Extra { valor: string; en_erp: boolean; }
interface Props {
  mode: 'alta' | 'normalizacion';
  legacy?: LegacyPendingItem | null;
  onSaved?: (p: CatalogProduct) => void;
}

const lbl = 'mb-1 block text-xs font-bold text-slate-400';
const inp = 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-indigo-400';
const inpSm = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm outline-none focus:border-indigo-400';

function titleHealth(title: string) {
  const len = title.trim().length;
  if (!len) return { label: 'Pendiente', cls: 'border-slate-700 bg-slate-800/70 text-slate-300' };
  if (len > 120) return { label: 'Muy largo', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-100' };
  if (len < 28) return { label: 'Muy corto', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-100' };
  return { label: 'Listo para web', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' };
}

export function CatalogProductForm({ mode, legacy, onSaved }: Props) {
  const [options, setOptions] = useState<CatalogOptions | null>(null);
  const [familia, setFamilia] = useState('');
  const [rubro, setRubro] = useState('');
  const [fieldDefs, setFieldDefs] = useState<CatalogField[]>([]);
  const [orden, setOrden] = useState<string[]>([]);     // nombres de campos en orden (los activos)
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [skuBase, setSkuBase] = useState('');
  const [condicion, setCondicion] = useState('PRIMERA');
  const [codigoPuma, setCodigoPuma] = useState('');
  const [pvp, setPvp] = useState('');
  const [costo, setCosto] = useState('');
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [activar, setActivar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'number' | 'select'>('text');
  const [newFieldFirstOption, setNewFieldFirstOption] = useState('');
  const [newOptionFor, setNewOptionFor] = useState<string | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');
  const [newOptionErp, setNewOptionErp] = useState('');

  useEffect(() => { fetchCatalogOptions().then(setOptions).catch((e) => setError(e.message)); }, []);

  // prefill normalización
  useEffect(() => {
    if (mode !== 'normalizacion' || !legacy || !options) return;
    setMarca(legacy.marca || '');
    setModelo(legacy.sku || '');
    setSkuBase((legacy.sku || '').replace(/\s*\(O\)\s*$/i, '').trim());
    setCondicion(/\(O\)/i.test(legacy.sku || '') || /outlet/i.test(legacy.descripcion || '') ? 'OUTLET' : 'PRIMERA');
    if (legacy.pvp != null) setPvp(String(legacy.pvp));
    if (legacy.costo_vigente != null) setCosto(String(legacy.costo_vigente));
    const tipoUp = (legacy.tipo || '').toUpperCase().trim();
    for (const [fam, rubros] of Object.entries(options.rubros_por_familia)) {
      if (rubros.includes(tipoUp)) { setFamilia(fam); setRubro(tipoUp); break; }
    }
  }, [mode, legacy, options]);

  // template → defs + orden por defecto
  useEffect(() => {
    if (!familia || !rubro) { setFieldDefs([]); setOrden([]); return; }
    fetchCatalogTemplate(familia, rubro).then((t) => {
      setFieldDefs(t.campos_obligatorios || []);
      const def = (t.orden_default || []).map((o) => o.name).filter(Boolean) as string[];
      setOrden(def.length ? def : (t.campos_obligatorios || []).map((f) => f.name));
      setCampos({});
      setExtras([]);
      setNewFieldOpen(false);
      setNewFieldLabel('');
      setNewFieldType('text');
      setNewFieldFirstOption('');
      setNewOptionFor(null);
      setNewOptionValue('');
      setNewOptionErp('');
    }).catch(() => { setFieldDefs([]); setOrden([]); });
  }, [familia, rubro]);

  const defByName = useMemo(() => Object.fromEntries(fieldDefs.map((f) => [f.name, f])), [fieldDefs]);
  const disponibles = useMemo(() => fieldDefs.filter((f) => !orden.includes(f.name)), [fieldDefs, orden]);

  // preview en vivo
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildPayload = useCallback(() => {
    const camposEnviar: Record<string, string> = {};
    for (const name of orden) if (campos[name]) camposEnviar[name] = campos[name];
    return {
      familia_app: familia, rubro_app: rubro, marca, modelo, sku_base: skuBase, condicion,
      campos: camposEnviar,
      orden: orden.map((name) => ({ kind: 'campo', name })),
      extras: extras.filter((e) => e.valor.trim()).map((e) => ({ valor: e.valor.trim(), en_erp: e.en_erp })),
    };
  }, [familia, rubro, marca, modelo, skuBase, condicion, orden, campos, extras]);

  const runPreview = useCallback(() => {
    if (!familia || !rubro) { setPreview(null); return; }
    catalogPreview(buildPayload()).then(setPreview).catch(() => setPreview(null));
  }, [familia, rubro, buildPayload]);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(runPreview, 280);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [runPreview]);

  const rubros = useMemo(() => (familia && options ? options.rubros_por_familia[familia] || [] : []), [familia, options]);
  const erpLen = preview?.descripcion_erp_len ?? 0;
  const erpOver = erpLen > 50;
  const commercialTitle = preview?.descripcion_comercial || '';
  const health = titleHealth(commercialTitle);

  async function copyCommercialName() {
    if (!commercialTitle) return;
    try {
      await navigator.clipboard?.writeText(commercialTitle);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  function move(i: number, dir: -1 | 1) {
    setOrden((o) => {
      const n = [...o]; const j = i + dir;
      if (j < 0 || j >= n.length) return o;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }
  const removeAttr = (name: string) => setOrden((o) => o.filter((x) => x !== name));
  const addAttr = (name: string) => { if (name) setOrden((o) => [...o, name]); };
  const addExtra = () => setExtras((e) => [...e, { valor: '', en_erp: true }]);

  async function saveTemplateField() {
    if (!familia || !rubro || !newFieldLabel.trim()) return;
    setTemplateSaving(true); setError(''); setOkMsg('');
    try {
      const initial = newFieldType === 'select' && newFieldFirstOption.trim()
        ? { valor: newFieldFirstOption.trim(), comercial: newFieldFirstOption.trim(), erp: newFieldFirstOption.trim() }
        : undefined;
      const t = await addCatalogTemplateField({
        familia_app: familia,
        rubro_app: rubro,
        label: newFieldLabel.trim(),
        type: newFieldType,
        initial_option: initial,
      });
      setFieldDefs(t.campos_obligatorios || []);
      const createdName = t.created_field?.name;
      if (createdName) {
        setOrden((o) => o.includes(createdName) ? o : [...o, createdName]);
        if (newFieldType === 'select' && newFieldFirstOption.trim()) {
          setCampos((c) => ({ ...c, [createdName]: newFieldFirstOption.trim() }));
        }
      }
      setNewFieldLabel('');
      setNewFieldType('text');
      setNewFieldFirstOption('');
      setNewFieldOpen(false);
      setOkMsg('Atributo guardado en la plantilla del rubro.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el atributo.');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function saveTemplateOption(fieldName: string) {
    if (!familia || !rubro || !fieldName || !newOptionValue.trim()) return;
    setTemplateSaving(true); setError(''); setOkMsg('');
    try {
      const value = newOptionValue.trim();
      const t = await addCatalogTemplateFieldOption({
        familia_app: familia,
        rubro_app: rubro,
        field_name: fieldName,
        valor: value,
        comercial: value,
        erp: newOptionErp.trim() || value,
      });
      setFieldDefs(t.campos_obligatorios || []);
      setCampos((c) => ({ ...c, [fieldName]: value }));
      setNewOptionFor(null);
      setNewOptionValue('');
      setNewOptionErp('');
      setOkMsg('Opcion guardada en la plantilla del rubro.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la opcion.');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function save() {
    setSaving(true); setError(''); setOkMsg('');
    try {
      let res: CatalogProduct;
      const payload: Record<string, unknown> = { ...buildPayload(), codigo_puma: codigoPuma, pvp: pvp || undefined, costo: costo || undefined, activar };
      if (mode === 'normalizacion') {
        if (!legacy) throw new Error('No hay producto legacy seleccionado.');
        res = await normalizeCatalogProduct({ ...payload, legacy_product_id: legacy.legacy_id });
      } else {
        res = await createCatalogProduct(payload);
      }
      setOkMsg(res.errores && res.errores.length ? `Guardado como ${res.estado}. Pendiente: ${res.errores.join(' ')}` : `Guardado como ${res.estado}.`);
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={lbl}>Familia</span>
          <select className={inp} value={familia} onChange={(e) => { setFamilia(e.target.value); setRubro(''); }}>
            <option value="">Elegí familia</option>{options.familias.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label><span className={lbl}>Rubro</span>
          <select className={inp} value={rubro} onChange={(e) => setRubro(e.target.value)} disabled={!familia}>
            <option value="">Elegí rubro</option>{rubros.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

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

      {/* ARMADOR: atributos en orden, reordenables, removibles + extras */}
      {(orden.length > 0 || fieldDefs.length > 0) && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-1 text-xs font-black uppercase tracking-wide text-slate-400">Cómo se arma la descripción</div>
          <p className="mb-3 text-[11px] text-slate-500">Reordená con ▲▼, quitá lo que no aplica (✕) y agregá detalles libres. La descripción se arma en este orden.</p>
          <div className="space-y-2">
            {orden.map((name, i) => {
              const f = defByName[name];
              if (!f) return null;
              return (
                <div key={name} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => move(i, 1)} disabled={i === orden.length - 1} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowDown size={14} /></button>
                  </div>
                  <span className="w-32 shrink-0 text-xs font-bold text-slate-300">{f.label}</span>
                  <div className="flex-1">
                    {f.type === 'select' ? (
                      <>
                      <select className={inpSm} value={campos[name] || ''} onChange={(e) => setCampos((c) => ({ ...c, [name]: e.target.value }))}>
                        <option value="">—</option>{(f.opciones || []).map((o) => <option key={o.valor} value={o.valor}>{o.comercial || o.valor}</option>)}
                      </select>
                      {newOptionFor === name ? (
                        <div className="mt-2 grid gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                          <input className={inpSm} placeholder="Nueva opcion comercial" value={newOptionValue} onChange={(e) => setNewOptionValue(e.target.value)} />
                          <input className={inpSm} placeholder="ERP/Puma (opcional)" value={newOptionErp} onChange={(e) => setNewOptionErp(e.target.value)} />
                          <button type="button" disabled={templateSaving || !newOptionValue.trim()} onClick={() => saveTemplateOption(name)}
                            className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                            Guardar
                          </button>
                          <button type="button" onClick={() => setNewOptionFor(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300">
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setNewOptionFor(name); setNewOptionValue(''); setNewOptionErp(''); }}
                          className="mt-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] font-black text-blue-100 hover:bg-blue-500/20"
                        >
                          + opcion para este atributo
                        </button>
                      )}
                      </>
                    ) : (
                      <input className={inpSm} type={f.type === 'number' ? 'number' : 'text'} value={campos[name] || ''} onChange={(e) => setCampos((c) => ({ ...c, [name]: e.target.value }))} />
                    )}
                  </div>
                  <button onClick={() => removeAttr(name)} title="No aplica / quitar" className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"><X size={15} /></button>
                </div>
              );
            })}

            {/* extras */}
            {extras.map((ex, idx) => (
              <div key={`ex${idx}`} className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2">
                <span className="w-32 shrink-0 text-xs font-bold text-amber-300">Detalle libre</span>
                <input className={inpSm} placeholder="LÍNEA 2022, (PN)…" value={ex.valor}
                  onChange={(e) => setExtras((arr) => arr.map((x, i) => i === idx ? { ...x, valor: e.target.value } : x))} />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                  <input type="checkbox" checked={ex.en_erp} onChange={(e) => setExtras((arr) => arr.map((x, i) => i === idx ? { ...x, en_erp: e.target.checked } : x))} /> en ERP
                </label>
                <button onClick={() => setExtras((arr) => arr.filter((_, i) => i !== idx))} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"><X size={15} /></button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {disponibles.length > 0 && (
              <select className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300" value="" onChange={(e) => addAttr(e.target.value)}>
                <option value="">+ Agregar atributo…</option>
                {disponibles.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
              </select>
            )}
            <button onClick={addExtra} className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-bold text-amber-100"><Plus size={13} /> Detalle libre</button>
            <button
              type="button"
              onClick={() => setNewFieldOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-100"
            >
              <Plus size={13} /> Guardar atributo para este rubro
            </button>
          </div>

          {newFieldOpen && (
            <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
              <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-emerald-200">Atributo reusable de plantilla</div>
              <div className="grid gap-2 lg:grid-cols-[1.4fr_0.8fr_1fr_auto_auto]">
                <input className={inpSm} placeholder="Nombre: Color comercial, Linea, Tecnologia..." value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} />
                <select className={inpSm} value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as 'text' | 'number' | 'select')}>
                  <option value="text">Texto</option>
                  <option value="number">Numero</option>
                  <option value="select">Opciones</option>
                </select>
                <input className={inpSm} disabled={newFieldType !== 'select'} placeholder="Primera opcion (si aplica)" value={newFieldFirstOption} onChange={(e) => setNewFieldFirstOption(e.target.value)} />
                <button type="button" disabled={templateSaving || !newFieldLabel.trim()} onClick={saveTemplateField}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                  Guardar
                </button>
                <button type="button" onClick={() => setNewFieldOpen(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300">
                  Cancelar
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Queda disponible para futuras altas del mismo rubro. Si es de tipo Opciones, despues podes sumar nuevas opciones desde el combo.</p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className={lbl}>Código Puma {activar && <span className="text-amber-400">(necesario para activar)</span>}</span><input className={inp} value={codigoPuma} onChange={(e) => setCodigoPuma(e.target.value)} /></label>
        <label><span className={lbl}>PVP</span><input className={inp} type="number" value={pvp} onChange={(e) => setPvp(e.target.value)} /></label>
        <label><span className={lbl}>Costo</span><input className={inp} type="number" value={costo} onChange={(e) => setCosto(e.target.value)} /></label>
      </div>

      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-indigo-300">
            <Eye className="size-4" /> Vista previa
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${health.cls}`}>
            <PackageCheck className="size-3.5" /> {health.label}
          </span>
        </div>
        {preview?.error ? <div className="text-sm text-amber-200">{preview.error}</div> : (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-indigo-950/20">
              <div className="bg-gradient-to-r from-slate-900 via-blue-950/70 to-slate-900 p-4 sm:p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-blue-100">
                    <Globe2 className="size-3.5" /> Nombre comercial
                  </span>
                  {marca && <span className="rounded-full bg-slate-800/80 px-2 py-1 text-[11px] font-bold text-slate-200">{marca}</span>}
                  {rubro && <span className="rounded-full bg-slate-800/80 px-2 py-1 text-[11px] font-bold text-slate-200">{rubro}</span>}
                  {condicion && <span className="rounded-full bg-slate-800/80 px-2 py-1 text-[11px] font-bold text-slate-200">{condicion}</span>}
                </div>
                <h3 className="min-h-[2.8rem] text-balance text-2xl font-black leading-tight text-white sm:text-3xl">
                  {commercialTitle || 'El nombre comercial aparece aca'}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className="rounded-lg bg-slate-950/70 px-2 py-1">SKU {preview?.sku_comercial || '---'}</span>
                  <span className="rounded-lg bg-slate-950/70 px-2 py-1">{commercialTitle.length} caracteres</span>
                  {preview?.subrubro && <span className="rounded-lg bg-slate-950/70 px-2 py-1">{preview.subrubro}</span>}
                </div>
              </div>
              <div className="grid gap-0 border-t border-slate-800 bg-slate-900/70 sm:grid-cols-[1.2fr_0.8fr]">
                <div className="p-4">
                  <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
                    <Sparkles className="size-3.5" /> Ficha web
                  </div>
                  <div className="text-base font-black leading-snug text-slate-100">{commercialTitle || 'Sin nombre generado'}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                    {familia && <span className="rounded-full bg-slate-800 px-2 py-1">{familia}</span>}
                    {rubro && <span className="rounded-full bg-slate-800 px-2 py-1">{rubro}</span>}
                    {preview?.subrubro && <span className="rounded-full bg-slate-800 px-2 py-1">{preview.subrubro}</span>}
                  </div>
                </div>
                <div className="border-t border-slate-800 p-4 sm:border-l sm:border-t-0">
                  <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">ERP / Puma</div>
                  <div className={`font-mono text-sm font-black ${erpOver ? 'text-red-300' : 'text-slate-100'}`}>{preview?.descripcion_erp || '---'}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${erpOver ? 'bg-red-500/20 text-red-200' : 'bg-emerald-500/20 text-emerald-200'}`}>{erpLen}/50</span>
                    {preview?.estado_erp && preview.estado_erp !== 'OK_ERP_50' && <span className="text-[11px] text-amber-300">{preview.estado_erp}</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={copyCommercialName}
                disabled={!commercialTitle}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                <Copy className="size-4" /> {copied ? 'Copiado' : 'Copiar nombre'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={activar} onChange={(e) => setActivar(e.target.checked)} /> Activar (requiere Puma y datos completos)</label>
        <button onClick={save} disabled={saving || !familia || !rubro || !marca || !skuBase}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {mode === 'normalizacion' ? 'Normalizar y vincular' : 'Guardar producto'}
        </button>
      </div>
      {(activar && !codigoPuma) && <div className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle className="size-3.5" /> Sin código Puma el producto no se activa; queda pendiente.</div>}
    </div>
  );
}
