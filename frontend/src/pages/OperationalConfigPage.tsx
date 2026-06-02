import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Database,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  Lock,
  PackageSearch,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Unlock,
  Wrench,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  can,
  fetchOperationalConfig,
  fetchProductCatalogStatus,
  getCurrentUserFromStorage,
  lockOperationalConfig,
  saveOperationalConfig,
  syncProductsFromSheet,
  unlockOperationalConfig,
  validateOperationalSection,
} from '../api/client';
import type { OperationalConfigPayload, OperationalConfigResponse, OperationalConfigValidationResult, ProductCatalogStatus } from '../types';
// Páginas embebidas como tabs (Fase A consolidación).
import { SettingsPage } from './SettingsPage';
import { GoogleAdminPage } from './GoogleAdminPage';
import { WarrantyConfigPage } from './WarrantyConfigPage';

const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60';
const labelClass = 'mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400';
const cardClass = 'rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl';

type ConfigTab =
  | 'resumen'
  | 'sistema'      // Embebe SettingsPage (flags + push)
  | 'google'       // URLs Sheets (operational)
  | 'oauth'        // Embebe GoogleAdminPage (credenciales OAuth, SUPERADMIN)
  | 'productos'
  | 'garantias'    // Embebe WarrantyConfigPage (config específica del módulo)
  | 'ventas'
  | 'presupuestos'
  | 'precios_costos'
  | 'recibos'
  | 'herramientas'
  | 'comercial'    // Módulo Comercial · PSI (Fase 1)
  | 'auditoria';

function splitList(text: string): string[] { return text.split(',').map((x) => x.trim()).filter(Boolean); }
function joinList(list: string[] | undefined): string { return (list || []).join(', '); }
function moduleState(ok: boolean, warning = false) { return ok ? 'Configurado' : warning ? 'Revisar' : 'Sin configurar'; }
function openUrl(url?: string | null) { if (url) window.open(url, '_blank', 'noopener,noreferrer'); }

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return <label className="block"><span className={labelClass}>{label}</span>{children}{help && <p className="mt-1 text-xs text-slate-500">{help}</p>}</label>;
}

function ValidationBox({ result }: { result?: OperationalConfigValidationResult | null }) {
  if (!result) return null;
  return <div className={`rounded-2xl border p-4 ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
    <div className="mb-3 flex items-center gap-2 font-black text-white">
      {result.ok ? <CheckCircle2 size={18} className="text-emerald-300" /> : <AlertTriangle size={18} className="text-amber-300" />}
      Resultado de prueba · {result.section}
    </div>
    <div className="space-y-3">
      {result.results.map((r) => <div key={`${r.sheet}-${r.error || r.message || ''}`} className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm">
        <div className="flex items-center gap-2 font-bold text-slate-100">
          {r.ok ? <CheckCircle2 size={16} className="text-emerald-300" /> : <XCircle size={16} className="text-rose-300" />}
          {r.sheet}
        </div>
        {r.message && <p className="mt-1 text-slate-300">{r.message}</p>}
        {r.error && <p className="mt-1 text-rose-200">{r.error}</p>}
        {!!r.missing_headers?.length && <p className="mt-1 text-amber-200">Faltan columnas: {r.missing_headers.join(', ')}</p>}
        {!!r.headers_found?.length && <p className="mt-1 text-xs text-slate-500">Columnas detectadas: {r.headers_found.join(', ')}</p>}
      </div>)}
    </div>
  </div>;
}

export function OperationalConfigPage() {
  const [data, setData] = useState<OperationalConfigResponse | null>(null);
  const [config, setConfig] = useState<OperationalConfigPayload | null>(null);
  const [productStatus, setProductStatus] = useState<ProductCatalogStatus | null>(null);
  // Tab persistido en URL (?tab=X) para deep-link desde sidebar / redirects.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ConfigTab) || 'resumen';
  const [tab, setTabRaw] = useState<ConfigTab>(initialTab);
  const setTab = (next: ConfigTab) => {
    setTabRaw(next);
    if (next === 'resumen') {
      const params = new URLSearchParams(searchParams);
      params.delete('tab');
      setSearchParams(params, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<OperationalConfigValidationResult | null>(null);
  const user = getCurrentUserFromStorage();
  // El control "desbloquear / sobrescribir un bloqueo" se decide por permiso, no por rol.
  // Cualquier usuario con ops_config.manage (típicamente admins) puede desbloquear
  // sin importar su rol. Wildcard '*' funciona como fallback explícito.
  const canManageOps = can('ops_config.manage') || user?.permissions?.includes('*');
  const locked = !!config?.locked;
  const readOnly = locked && !canManageOps;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOperationalConfig();
      setData(res);
      setConfig(res.config);
      try { setProductStatus(await fetchProductCatalogStatus()); } catch { setProductStatus(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar configuración.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function patch(path: string, value: unknown) {
    if (!config) return;
    const keys = path.split('.');
    const clone: any = structuredClone(config);
    let target = clone;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    target[keys[keys.length - 1]] = value;
    setConfig(clone);
  }

  async function save(lockAfterSave = false) {
    if (!config) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await saveOperationalConfig(config, lockAfterSave);
      setConfig(res.config);
      setMessage(lockAfterSave ? 'Configuración guardada y bloqueada.' : 'Configuración guardada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleLock(next: boolean) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = next ? await lockOperationalConfig() : await unlockOperationalConfig();
      setConfig(res.config);
      setMessage(next ? 'Configuración bloqueada.' : 'Configuración desbloqueada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar bloqueo.');
    } finally {
      setSaving(false);
    }
  }

  async function testSection(section: string) {
    setValidation(null);
    setTesting(section);
    setError(null);
    try {
      setValidation(await validateOperationalSection(section));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo probar conexión.');
    } finally {
      setTesting(null);
    }
  }

  async function runProductSync() {
    setSyncingProducts(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncProductsFromSheet();
      setMessage(`Catálogo actualizado: ${result.rows_created} nuevos, ${result.rows_updated} actualizados, ${result.rows_skipped} omitidos.`);
      try { setProductStatus(await fetchProductCatalogStatus()); } catch { /* noop */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar catálogo.');
    } finally {
      setSyncingProducts(false);
    }
  }

  const urls = data?.sheet_urls || {};
  const productsUrl = urls.products || config?.products?.spreadsheet_url || '';
  const warrantiesUrl = urls.warranties || config?.warranties.spreadsheet_url || '';
  const budgetsUrl = urls.budgets || config?.budgets.spreadsheet_url || '';
  const auditUrl = urls.audit || config?.audit.spreadsheet_url || '';

  const tabs = useMemo(() => [
    ['resumen', 'Resumen', <SlidersHorizontal size={16} />],
    ['sistema', 'Sistema', <Settings size={16} />],
    ['google', 'Sheets', <Cloud size={16} />],
    ['oauth', 'OAuth Google', <KeyRound size={16} />],
    ['productos', 'Productos', <PackageSearch size={16} />],
    ['garantias', 'Garantías', <ShieldCheck size={16} />],
    ['ventas', 'Ventas', <Truck size={16} />],
    ['presupuestos', 'Presupuestos', <FileSpreadsheet size={16} />],
    ['precios_costos', 'Precios y costos', <Database size={16} />],
    ['recibos', 'Recibos', <Archive size={16} />],
    ['herramientas', 'Herramientas', <Wrench size={16} />],
    ['comercial', 'Comercial', <TrendingUp size={16} />],
    ['auditoria', 'Auditoría', <ClipboardCheck size={16} />],
  ] as Array<[ConfigTab, string, ReactNode]>, []);

  if (loading) return <div className="text-slate-300">Cargando configuración operativa...</div>;
  if (!config) return <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-100">{error || 'No se pudo cargar configuración.'}</div>;

  const hasProductsSource = !!(config.products?.spreadsheet_url || config.products?.spreadsheet_id);
  const hasWarrantySource = !!(config.warranties?.spreadsheet_url || config.warranties?.spreadsheet_id);
  const hasBudgetSource = !!(config.budgets?.spreadsheet_url || config.budgets?.spreadsheet_id);
  const hasAuditSource = !!(config.audit?.spreadsheet_url || config.audit?.spreadsheet_id);

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-blue-300">Administración</p>
          <h1 className="mt-2 text-3xl font-black text-white">Configuración operativa</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Central de conexiones, hojas, sincronizaciones y parámetros operativos de la app.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"><RefreshCw size={16} className="inline" /> Recargar</button>
          {locked ? <button disabled={!canManageOps || saving} onClick={() => toggleLock(false)} className="rounded-xl border border-amber-500/50 px-4 py-2 text-sm font-bold text-amber-100 disabled:opacity-40"><Unlock size={16} className="inline" /> Desbloquear</button>
            : <button disabled={saving} onClick={() => toggleLock(true)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"><Lock size={16} className="inline" /> Bloquear</button>}
          <button disabled={saving || readOnly} onClick={() => save(false)} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white disabled:opacity-40"><Save size={16} className="inline" /> Guardar</button>
          <button disabled={saving || readOnly} onClick={() => save(true)} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Guardar y bloquear</button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className={`rounded-full px-3 py-1 font-bold ${locked ? 'bg-amber-500/20 text-amber-100' : 'bg-emerald-500/20 text-emerald-100'}`}>{locked ? 'Configuración bloqueada' : 'Configuración editable'}</span>
        {config.updated_at && <span className="rounded-full bg-slate-950 px-3 py-1 text-slate-300">Último cambio: {config.updated_at} · {config.updated_by}</span>}
      </div>
    </header>

    {message && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}
    {error && <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-100">{error}</div>}
    <ValidationBox result={validation} />

    <nav className="flex flex-wrap gap-2 rounded-3xl border border-slate-800 bg-slate-950/70 p-3">
      {tabs.map(([key, label, icon]) => <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${tab === key ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{icon}{label}</button>)}
    </nav>

    {tab === 'resumen' && <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ModuleCard title="Google" icon={<Cloud size={20} />} state="OAuth" detail="Autorización y acceso a Sheets" onTest={() => testSection('google')} testing={testing === 'google'} />
      <ModuleCard title="Productos" icon={<PackageSearch size={20} />} state={moduleState(hasProductsSource)} detail={`${productStatus?.active_products || 0} productos · ${productStatus?.total_brands || 0} marcas`} onTest={() => testSection('products')} testing={testing === 'products'} />
      <ModuleCard title="Garantías" icon={<ShieldCheck size={20} />} state={moduleState(hasWarrantySource)} detail={config.warranties.raw_sheet || 'Sin hoja configurada'} onTest={() => testSection('warranties')} testing={testing === 'warranties'} />
      <ModuleCard title="Presupuestos" icon={<FileSpreadsheet size={20} />} state={moduleState(hasBudgetSource, true)} detail={config.budgets.price_sheet || 'Sin hoja de precios'} onTest={() => testSection('budgets')} testing={testing === 'budgets'} />
      <ModuleCard title="Ventas" icon={<Truck size={20} />} state={config.sales?.label || 'Venta'} detail={joinList(config.sales?.sucursales).slice(0, 70) || 'Sucursales operativas'} onTest={() => testSection('sales')} testing={testing === 'sales'} />
      <ModuleCard title="Precios y costos" icon={<Database size={20} />} state="Catálogo local" detail="Valores actuales desde productos sincronizados" onTest={() => testSection('price_cost_updates')} testing={testing === 'price_cost_updates'} />
      <ModuleCard title="Recibos" icon={<Archive size={20} />} state={config.payroll?.storage || 'local'} detail={config.payroll?.filename_hint || 'Carga individual y masiva'} onTest={() => testSection('payroll')} testing={testing === 'payroll'} />
      <ModuleCard title="Auditoría" icon={<Settings size={20} />} state={hasAuditSource ? 'Google Sheets' : 'Local'} detail={config.audit.sheet || 'AUDITORIA'} onTest={() => testSection('audit')} testing={testing === 'audit'} />
    </section>}

    {tab === 'google' && <section className={cardClass}>
      <SectionTitle title="Google" subtitle="Estado de conexión OAuth y pruebas de acceso a Sheets." actions={<button onClick={() => testSection('google')} disabled={testing === 'google'} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white disabled:opacity-60">Probar Google</button>} />
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
        <div className="font-bold text-white">Diagnóstico</div>
        <p className="mt-1">Si una sincronización falla por token OAuth, reautorizá la cuenta desde Administración &gt; Google y luego volvé a probar la conexión.</p>
      </div>
    </section>}

    {tab === 'productos' && <section className={cardClass}>
      <SectionTitle title="Productos" subtitle="Fuente externa del catálogo local: Planilla Madre de Ventas." actions={<div className="flex gap-2"><button onClick={() => testSection('products')} disabled={testing === 'products'} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200">Probar conexión</button><button onClick={runProductSync} disabled={syncingProducts} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white disabled:opacity-60">{syncingProducts ? 'Actualizando...' : 'Actualizar catálogo'}</button>{productsUrl && <button onClick={() => openUrl(productsUrl)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200"><ExternalLink size={16} className="inline" /> Abrir Sheet</button>}</div>} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="URL Planilla Madre de Ventas"><input disabled={readOnly} className={inputClass} value={config.products?.spreadsheet_url || ''} onChange={(e) => patch('products.spreadsheet_url', e.target.value)} /></Field>
        <Field label="ID spreadsheet"><input disabled={readOnly} className={inputClass} value={config.products?.spreadsheet_id || ''} onChange={(e) => patch('products.spreadsheet_id', e.target.value)} /></Field>
        <Field label="Hoja de productos"><input disabled={readOnly} className={inputClass} value={config.products?.sheet_name || 'Productos PVP'} onChange={(e) => patch('products.sheet_name', e.target.value)} /></Field>
        <Field label="Fila de encabezados"><input disabled={readOnly} type="number" min={1} className={inputClass} value={config.products?.header_row || 1} onChange={(e) => patch('products.header_row', Number(e.target.value || 1))} /></Field>
        <Field label="Rango"><input disabled={readOnly} className={inputClass} value={config.products?.range || 'A:Z'} onChange={(e) => patch('products.range', e.target.value)} /></Field>
        <Field label="Cache productos (segundos)"><input disabled={readOnly} type="number" className={inputClass} value={config.products?.cache_seconds || 300} onChange={(e) => patch('products.cache_seconds', Number(e.target.value || 300))} /></Field>
      </div>
      <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <h3 className="font-black text-white">Mapeo de columnas</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Marca"><input disabled={readOnly} className={inputClass} value={config.products?.columns?.marca || 'MARCA'} onChange={(e) => patch('products.columns.marca', e.target.value)} /></Field>
          <Field label="Tipo"><input disabled={readOnly} className={inputClass} value={config.products?.columns?.tipo || 'TIPO'} onChange={(e) => patch('products.columns.tipo', e.target.value)} /></Field>
          <Field label="Descripción"><input disabled={readOnly} className={inputClass} value={config.products?.columns?.descripcion || 'DESCRIPCION'} onChange={(e) => patch('products.columns.descripcion', e.target.value)} /></Field>
          <Field label="SKU"><input disabled={readOnly} className={inputClass} value={config.products?.columns?.sku || 'SKU'} onChange={(e) => patch('products.columns.sku', e.target.value)} /></Field>
          <Field label="PVP"><input disabled={readOnly} className={inputClass} value={config.products?.columns?.pvp || 'PVP'} onChange={(e) => patch('products.columns.pvp', e.target.value)} /></Field>
          <Field label="Costo vigente"><input disabled={readOnly} className={inputClass} value={config.products?.columns?.costo_vigente || 'COSTO VIGENTE'} onChange={(e) => patch('products.columns.costo_vigente', e.target.value)} /></Field>
        </div>
      </div>
    </section>}

    {tab === 'garantias' && (
      // Fase A consolidación: la config completa de garantías (estados, sucursales,
      // depósitos, delay_ranges, required_review_fields, métricas) vive en
      // WarrantyConfigPage. Se embebe acá para no duplicar formulario.
      <section className={cardClass}>
        <WarrantyConfigPage embedded />
      </section>
    )}

    {tab === 'sistema' && (
      <section className={cardClass}>
        <SettingsPage embedded />
      </section>
    )}

    {tab === 'oauth' && (
      <section className={cardClass}>
        <GoogleAdminPage embedded />
      </section>
    )}

    {tab === 'ventas' && <section className={cardClass}>
      <SectionTitle title="Ventas" subtitle="Parámetros operativos de carga y alcance comercial." actions={<button onClick={() => testSection('sales')} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200">Verificar</button>} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Nombre del módulo"><input disabled={readOnly} className={inputClass} value={config.sales?.label || 'Venta'} onChange={(e) => patch('sales.label', e.target.value)} /></Field>
        <Field label="Canal default"><input disabled={readOnly} className={inputClass} value={config.sales?.default_channel || 'Venta'} onChange={(e) => patch('sales.default_channel', e.target.value)} /></Field>
        <Field label="Sucursales operativas"><input disabled={readOnly} className={inputClass} value={joinList(config.sales?.sucursales)} onChange={(e) => patch('sales.sucursales', splitList(e.target.value))} /></Field>
        <Field label="Modo del sistema"><select disabled={readOnly} className={inputClass} value={config.system.mode} onChange={(e) => patch('system.mode', e.target.value)}><option value="open">Abierto</option><option value="closed">Cerrado</option><option value="maintenance">Mantenimiento</option></select></Field>
        <Field label="Apertura"><input disabled={readOnly} type="time" className={inputClass} value={config.system.open_time} onChange={(e) => patch('system.open_time', e.target.value)} /></Field>
        <Field label="Cierre"><input disabled={readOnly} type="time" className={inputClass} value={config.system.close_time} onChange={(e) => patch('system.close_time', e.target.value)} /></Field>
        <Field label="Mensaje sistema cerrado"><textarea disabled={readOnly} className={inputClass} rows={3} value={config.system.closed_message} onChange={(e) => patch('system.closed_message', e.target.value)} /></Field>
        <Field label="Mensaje mantenimiento"><textarea disabled={readOnly} className={inputClass} rows={3} value={config.system.maintenance_message} onChange={(e) => patch('system.maintenance_message', e.target.value)} /></Field>
      </div>
    </section>}

    {tab === 'presupuestos' && <section className={cardClass}>
      <SectionTitle title="Presupuestos" subtitle="Hojas de registro y parámetros de presupuestos." actions={<div className="flex gap-2"><button onClick={() => testSection('budgets')} disabled={testing === 'budgets'} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200">Probar conexión</button>{budgetsUrl && <button onClick={() => openUrl(budgetsUrl)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200"><ExternalLink size={16} className="inline" /> Abrir Sheet</button>}</div>} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="URL Google Sheet presupuestos"><input disabled={readOnly} className={inputClass} value={config.budgets.spreadsheet_url || ''} onChange={(e) => patch('budgets.spreadsheet_url', e.target.value)} /></Field>
        <Field label="ID spreadsheet"><input disabled={readOnly} className={inputClass} value={config.budgets.spreadsheet_id || ''} onChange={(e) => patch('budgets.spreadsheet_id', e.target.value)} /></Field>
        <Field label="Hoja precios"><input disabled={readOnly} className={inputClass} value={config.budgets.price_sheet || ''} onChange={(e) => patch('budgets.price_sheet', e.target.value)} /></Field>
        <Field label="Hoja fletes"><input disabled={readOnly} className={inputClass} value={config.budgets.shipping_sheet || ''} onChange={(e) => patch('budgets.shipping_sheet', e.target.value)} /></Field>
        <Field label="Hoja raw"><input disabled={readOnly} className={inputClass} value={config.budgets.raw_sheet || ''} onChange={(e) => patch('budgets.raw_sheet', e.target.value)} /></Field>
        <Field label="Hoja detalle"><input disabled={readOnly} className={inputClass} value={config.budgets.detail_sheet || ''} onChange={(e) => patch('budgets.detail_sheet', e.target.value)} /></Field>
      </div>
    </section>}

    {tab === 'precios_costos' && <section className={cardClass}>
      <SectionTitle title="Precios y costos" subtitle="Checklist operativo y fuente de valores anteriores." />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Fuente"><input disabled className={inputClass} value={config.price_cost_updates?.source || 'catalogo_local'} /></Field>
        <Field label="Checklist precios"><input disabled={readOnly} className={inputClass} value={joinList(config.price_cost_updates?.price_targets)} onChange={(e) => patch('price_cost_updates.price_targets', splitList(e.target.value))} /></Field>
        <Field label="Checklist costos"><input disabled={readOnly} className={inputClass} value={joinList(config.price_cost_updates?.cost_targets)} onChange={(e) => patch('price_cost_updates.cost_targets', splitList(e.target.value))} /></Field>
      </div>
    </section>}

    {tab === 'recibos' && <section className={cardClass}>
      <SectionTitle title="Recibos" subtitle="Parámetros de archivos, carga individual y carga masiva." />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Storage"><input disabled={readOnly} className={inputClass} value={config.payroll?.storage || 'local'} onChange={(e) => patch('payroll.storage', e.target.value)} /></Field>
        <Field label="Tamaño máximo MB"><input disabled={readOnly} type="number" className={inputClass} value={config.payroll?.max_file_mb || 10} onChange={(e) => patch('payroll.max_file_mb', Number(e.target.value || 10))} /></Field>
        <Field label="Tipos permitidos"><input disabled={readOnly} className={inputClass} value={joinList(config.payroll?.allowed_file_types)} onChange={(e) => patch('payroll.allowed_file_types', splitList(e.target.value))} /></Field>
        <Field label="Formato sugerido"><input disabled={readOnly} className={inputClass} value={config.payroll?.filename_hint || 'DNI_AAAA-MM.pdf'} onChange={(e) => patch('payroll.filename_hint', e.target.value)} /></Field>
      </div>
    </section>}

    {tab === 'herramientas' && <section className={cardClass}>
      <SectionTitle title="Herramientas" subtitle="Parámetros generales de procesos internos." actions={<button onClick={() => testSection('tools')} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200">Verificar</button>} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Estado"><select disabled={readOnly} className={inputClass} value={config.tools?.enabled === false ? 'false' : 'true'} onChange={(e) => patch('tools.enabled', e.target.value === 'true')}><option value="true">Habilitadas</option><option value="false">Deshabilitadas</option></select></Field>
        <Field label="Descripción"><input disabled={readOnly} className={inputClass} value={config.tools?.workspace_description || ''} onChange={(e) => patch('tools.workspace_description', e.target.value)} /></Field>
      </div>
    </section>}

    {tab === 'comercial' && <section className={cardClass}>
      <SectionTitle
        title="Comercial · PSI"
        subtitle="Fuentes de datos para el módulo PSI (Planificación de Ventas e Inventario). Ver docs/10-modulo-comercial-fase1.md."
      />
      <div className="mt-5 space-y-6">
        {/* Fuentes en Drive */}
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">Fuentes en Drive</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field
              label="Year Folder ID"
              help="Carpeta del año vigente en Drive (contiene 01-Enero/, 02-Febrero/, …). Mismo que usa la herramienta Generar GFK."
            >
              <input
                disabled={readOnly}
                className={inputClass}
                placeholder="1FU6G8gqqI73DjsrpbseG-0sbzX7_a2YK"
                value={config.commercial?.year_folder_id || ''}
                onChange={(e) => patch('commercial.year_folder_id', e.target.value)}
              />
            </Field>
            <Field
              label="Stock Book ID"
              help="file_id del libro de Stock (Sheet con tabs Stock/Ingresos/Planilla Caseros/…). Obligatorio para que el PSI muestre stock."
            >
              <input
                disabled={readOnly}
                className={inputClass}
                placeholder="ID del Sheet de Stock"
                value={config.commercial?.stock_book_id || ''}
                onChange={(e) => patch('commercial.stock_book_id', e.target.value)}
              />
            </Field>
            <Field
              label="Hoja maestra de Stock"
              help="Tab consolidada dentro del libro de Stock. Default: 'Stock'."
            >
              <input
                disabled={readOnly}
                className={inputClass}
                placeholder="Stock"
                value={config.commercial?.stock_sheet_name || ''}
                onChange={(e) => patch('commercial.stock_sheet_name', e.target.value)}
              />
            </Field>
            <Field
              label="Price Sheet ID (Productos PVP)"
              help="Catálogo de precios. Compartido con la herramienta GFK."
            >
              <input
                disabled={readOnly}
                className={inputClass}
                placeholder="13PUriou-rXu8VnvKN5oe-yTdfTD9WPksVQftgVE5_Js"
                value={config.commercial?.price_sheet_id || ''}
                onChange={(e) => patch('commercial.price_sheet_id', e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* Performance */}
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">Performance</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field
              label="Cache TTL (segundos)"
              help="Tiempo de vida del cache en memoria para stock y ventas. Default 900 (15 min)."
            >
              <input
                disabled={readOnly}
                type="number"
                min={60}
                max={86400}
                className={inputClass}
                value={config.commercial?.cache_ttl_seconds ?? 900}
                onChange={(e) => patch('commercial.cache_ttl_seconds', Number(e.target.value || 900))}
              />
            </Field>
          </div>
        </div>

        {/* Logos */}
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">Logos para export PDF</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field
              label="Logo GV (path relativo a backend/)"
              help="Default: storage/brand/gv-electro.png"
            >
              <input
                disabled={readOnly}
                className={inputClass}
                placeholder="storage/brand/gv-electro.png"
                value={config.commercial?.logos?.gv_path || ''}
                onChange={(e) => patch('commercial.logos.gv_path', e.target.value)}
              />
            </Field>
            <Field
              label="Logo ABC (path relativo a backend/)"
              help="Default: storage/brand/abc-electro.png"
            >
              <input
                disabled={readOnly}
                className={inputClass}
                placeholder="storage/brand/abc-electro.png"
                value={config.commercial?.logos?.abc_path || ''}
                onChange={(e) => patch('commercial.logos.abc_path', e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* Ayuda */}
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-blue-100/90">
          <p className="font-bold">Cómo obtener un file_id de Drive</p>
          <p className="mt-1">
            Abrí el Sheet en Drive. La URL es:
            <code className="ml-2 rounded bg-slate-900 px-2 py-0.5 text-xs">
              https://docs.google.com/spreadsheets/d/<b>FILE_ID</b>/edit
            </code>
          </p>
          <p className="mt-2">
            Si el PSI tira <code>500 - Falta configurar 'commercial.stock_book_id'</code>,
            es porque este campo está vacío.
          </p>
        </div>
      </div>
    </section>}

    {tab === 'auditoria' && <section className={cardClass}>
      <SectionTitle title="Auditoría" subtitle="Registro de movimientos y espejo opcional en Google Sheets." actions={<div className="flex gap-2"><button onClick={() => testSection('audit')} disabled={testing === 'audit'} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200">Probar conexión</button>{auditUrl && <button onClick={() => openUrl(auditUrl)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200"><ExternalLink size={16} className="inline" /> Abrir Sheet</button>}</div>} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Sincronizar a Google Sheets"><select disabled={readOnly} className={inputClass} value={config.audit.sync_to_google_sheets ? 'true' : 'false'} onChange={(e) => patch('audit.sync_to_google_sheets', e.target.value === 'true')}><option value="false">No</option><option value="true">Sí</option></select></Field>
        <Field label="URL Google Sheet auditoría"><input disabled={readOnly} className={inputClass} value={config.audit.spreadsheet_url || ''} onChange={(e) => patch('audit.spreadsheet_url', e.target.value)} /></Field>
        <Field label="ID spreadsheet"><input disabled={readOnly} className={inputClass} value={config.audit.spreadsheet_id || ''} onChange={(e) => patch('audit.spreadsheet_id', e.target.value)} /></Field>
        <Field label="Hoja"><input disabled={readOnly} className={inputClass} value={config.audit.sheet || 'AUDITORIA'} onChange={(e) => patch('audit.sheet', e.target.value)} /></Field>
      </div>
    </section>}
  </div>;
}

function SectionTitle({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-2xl font-black text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">{subtitle}</p></div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>;
}

function ModuleCard({ title, icon, state, detail, onTest, testing }: { title: string; icon: ReactNode; state: string; detail: string; onTest?: () => void; testing?: boolean }) {
  const ok = !['Sin configurar', 'Revisar'].includes(state);
  return <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-start justify-between gap-3"><div className="rounded-2xl bg-slate-950 p-3 text-blue-200">{icon}</div><span className={`rounded-full px-3 py-1 text-xs font-black ${ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>{state}</span></div>
    <h3 className="mt-4 text-lg font-black text-white">{title}</h3>
    <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400">{detail}</p>
    {onTest && <button onClick={onTest} disabled={testing} className="mt-4 rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-800 disabled:opacity-60">{testing ? 'Probando...' : 'Probar'}</button>}
  </div>;
}
