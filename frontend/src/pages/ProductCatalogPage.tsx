import { Link2, PackageSearch, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createProvider,
  deleteBrandProvider,
  fetchBrandProviders,
  fetchProductBrands,
  fetchProductCatalogStatus,
  fetchProductSyncLogs,
  fetchProducts,
  fetchProviders,
  setBrandProvider,
  syncProductsFromSheet,
  updateProvider,
} from '../api/client';
import { EmptyState, KpiCard, Notice, PageHeader, Panel, ResponsiveTable, SearchField, SectionHeader, TabButton, Tabs, primaryButtonClass, proInputClass, secondaryButtonClass } from '../components/ProUI';
import type { BrandProviderInfo, ProductBrandInfo, ProductCatalogStatus, ProductInfo, ProductSyncLogInfo, ProviderInfo } from '../types';

const inputClass = proInputClass;

type Tab = 'productos' | 'marcas' | 'proveedores' | 'sync';

export function ProductCatalogPage() {
  const [tab, setTab] = useState<Tab>('productos');
  const [status, setStatus] = useState<ProductCatalogStatus | null>(null);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [brands, setBrands] = useState<ProductBrandInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [relations, setRelations] = useState<BrandProviderInfo[]>([]);
  const [logs, setLogs] = useState<ProductSyncLogInfo[]>([]);
  const [q, setQ] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [providerForm, setProviderForm] = useState({ id: 0, name: '', contact_name: '', email: '', phone: '', notes: '', is_active: true });
  const [brandId, setBrandId] = useState('');
  const [providerId, setProviderId] = useState('');

  async function loadAll() {
    setLoading(true); setError('');
    try {
      const [st, prod, br, prov, rel, syncLogs] = await Promise.all([
        fetchProductCatalogStatus(),
        fetchProducts({ q, marca: brandFilter, limit: 80 }),
        fetchProductBrands(),
        fetchProviders(true),
        fetchBrandProviders(),
        fetchProductSyncLogs(12),
      ]);
      setStatus(st); setProducts(prod.items); setBrands(br); setProviders(prov); setRelations(rel); setLogs(syncLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo.');
    } finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, []);

  const activeProviders = useMemo(() => providers.filter((p) => p.is_active), [providers]);
  const mappedByBrand = useMemo(() => {
    const map = new Map<number, BrandProviderInfo>();
    for (const relation of relations) if (relation.is_default) map.set(relation.brand_id, relation);
    return map;
  }, [relations]);

  async function runSync() {
    setSyncing(true); setMessage(''); setError('');
    try {
      const res = await syncProductsFromSheet();
      const parts = [
        `Sincronización completada`,
        `${res.rows_processed} procesados`,
        `${res.rows_created} nuevos`,
        `${res.rows_updated} actualizados`,
      ];
      if (res.rows_skipped > 0) parts.push(`${res.rows_skipped} omitidos`);
      if (res.price_changes_detected > 0) parts.push(`${res.price_changes_detected} cambios de precio`);
      if (res.cost_changes_detected > 0) parts.push(`${res.cost_changes_detected} cambios de costo`);
      if (res.price_cost_updates_created > 0) parts.push(`${res.price_cost_updates_created} tareas creadas en Precios y costos`);
      if (res.price_cost_updates_skipped > 0) parts.push(`${res.price_cost_updates_skipped} omitidas por duplicado`);
      setMessage(parts.join(' · '));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar la Planilla Madre.');
    } finally { setSyncing(false); }
  }

  async function saveProvider() {
    setError(''); setMessage('');
    try {
      const payload = { ...providerForm, name: providerForm.name.trim() };
      if (!payload.name) throw new Error('Ingresá el nombre del proveedor.');
      if (providerForm.id) await updateProvider(providerForm.id, payload);
      else await createProvider(payload);
      setProviderForm({ id: 0, name: '', contact_name: '', email: '', phone: '', notes: '', is_active: true });
      setMessage('Proveedor guardado.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el proveedor.');
    }
  }

  async function assignProvider() {
    setError(''); setMessage('');
    try {
      if (!brandId || !providerId) throw new Error('Elegí una marca y un proveedor.');
      await setBrandProvider({ brand_id: Number(brandId), provider_id: Number(providerId), is_default: true });
      setBrandId(''); setProviderId('');
      setMessage('Relación marca/proveedor guardada.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo vincular la marca.');
    }
  }

  async function removeRelation(id: number) {
    setError(''); setMessage('');
    try {
      await deleteBrandProvider(id);
      setMessage('Relación eliminada.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la relación.');
    }
  }

  return <div className="pro-page space-y-6">
    <PageHeader
      eyebrow={<><PackageSearch size={14} /> Administración</>}
      title="Productos y proveedores"
      description="Catálogo operativo sincronizado desde la Planilla Madre de Ventas. Desde acá se actualizan productos, marcas y proveedores para el resto de la app."
      actions={<button onClick={runSync} disabled={syncing} className={primaryButtonClass}><RefreshCw size={18} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando' : 'Actualizar catálogo'}</button>}
    />

    {message && <Notice tone="success">{message}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}

    <section className="grid gap-4 md:grid-cols-5">
      <KpiCard label="Productos" value={status?.active_products ?? 0} tone="blue" />
      <KpiCard label="Marcas" value={status?.total_brands ?? 0} />
      <KpiCard label="Proveedores" value={status?.total_providers ?? 0} tone="violet" />
      <KpiCard label="Marcas vinculadas" value={status?.mapped_brands ?? 0} tone="green" />
      <KpiCard label="Última sync" value={status?.last_sync?.finished_at ? new Date(status.last_sync.finished_at).toLocaleDateString() : 'Sin datos'} detail={status?.last_sync?.finished_at ? new Date(status.last_sync.finished_at).toLocaleTimeString() : undefined} tone={status?.last_sync?.status === 'success' ? 'green' : status?.last_sync ? 'amber' : 'slate'} />
    </section>

    <Tabs>
      <TabButton active={tab === 'productos'} onClick={() => setTab('productos')}>Productos</TabButton>
      <TabButton active={tab === 'marcas'} onClick={() => setTab('marcas')}>Marcas</TabButton>
      <TabButton active={tab === 'proveedores'} onClick={() => setTab('proveedores')}>Proveedores</TabButton>
      <TabButton active={tab === 'sync'} onClick={() => setTab('sync')}>Sincronización</TabButton>
    </Tabs>

    {tab === 'productos' && <Panel>
      <SectionHeader title="Catálogo" description="Búsqueda rápida por SKU, descripción, marca o tipo." actions={<button onClick={loadAll} className={secondaryButtonClass}>Buscar</button>} />
      <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
        <SearchField value={q} onChange={setQ} placeholder="Buscar por SKU, descripción, marca o tipo" />
        <select className={inputClass} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}><option value="">Todas las marcas</option>{brands.map((brand) => <option key={brand.id} value={brand.name}>{brand.name}</option>)}</select>
      </div>
      <div className="mt-5">
        <ResponsiveTable>
          <table>
            <thead><tr><th>SKU</th><th>Descripción</th><th>Marca</th><th>Tipo</th><th className="text-right">PVP</th><th className="text-right">Costo</th></tr></thead>
            <tbody>{products.map((p) => <tr key={p.id}><td className="font-black text-white">{p.sku}</td><td className="text-slate-200">{p.descripcion}</td><td>{p.marca}</td><td>{p.tipo}</td><td className="text-right font-bold text-green-200">{p.pvp_text || p.precio_texto || '-'}</td><td className="text-right font-bold text-blue-200">{p.costo_text || '-'}</td></tr>)}</tbody>
          </table>
        </ResponsiveTable>
        {!products.length && <div className="mt-4"><EmptyState title={loading ? 'Cargando catálogo' : 'No hay productos para mostrar'} description={loading ? 'Estamos consultando la base local.' : 'Sincronizá la Planilla Madre o ajustá los filtros.'} /></div>}
      </div>
    </Panel>}

    {tab === 'marcas' && <Panel>
      <SectionHeader title="Relación marca / proveedor" description="Usá esta vinculación para que Garantías sugiera el proveedor correcto por marca." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
        <select className={inputClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Marca</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select>
        <select className={inputClass} value={providerId} onChange={(e) => setProviderId(e.target.value)}><option value="">Proveedor</option>{activeProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
        <button onClick={assignProvider} className={primaryButtonClass}><Link2 size={18} /> Vincular</button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{brands.map((brand) => {
        const relation = mappedByBrand.get(brand.id);
        return <div key={brand.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"><div className="font-black text-white">{brand.name}</div><div className="mt-1 text-sm text-slate-400">Proveedor: <span className={relation ? 'text-blue-200' : 'text-amber-200'}>{relation?.provider_name || 'Sin vincular'}</span></div></div>;
      })}</div>
    </Panel>}

    {tab === 'proveedores' && <section className="grid gap-5 lg:grid-cols-[420px_1fr]">
      <Panel>
        <SectionHeader title={providerForm.id ? 'Editar proveedor' : 'Nuevo proveedor'} description="Datos de contacto y notas internas del proveedor." />
        <div className="space-y-3">
          <input className={inputClass} value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} placeholder="Nombre del proveedor" />
          <input className={inputClass} value={providerForm.contact_name} onChange={(e) => setProviderForm({ ...providerForm, contact_name: e.target.value })} placeholder="Contacto" />
          <input className={inputClass} value={providerForm.email} onChange={(e) => setProviderForm({ ...providerForm, email: e.target.value })} placeholder="Email" />
          <input className={inputClass} value={providerForm.phone} onChange={(e) => setProviderForm({ ...providerForm, phone: e.target.value })} placeholder="Teléfono" />
          <textarea className={inputClass} rows={4} value={providerForm.notes} onChange={(e) => setProviderForm({ ...providerForm, notes: e.target.value })} placeholder="Notas" />
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={providerForm.is_active} onChange={(e) => setProviderForm({ ...providerForm, is_active: e.target.checked })} /> Activo</label>
          <div className="flex flex-col gap-2 sm:flex-row"><button onClick={saveProvider} className={primaryButtonClass}><Save size={18} /> Guardar</button>{providerForm.id > 0 && <button onClick={() => setProviderForm({ id: 0, name: '', contact_name: '', email: '', phone: '', notes: '', is_active: true })} className={secondaryButtonClass}>Cancelar</button>}</div>
        </div>
      </Panel>
      <Panel>
        <SectionHeader title="Proveedores" description="Listado de proveedores disponibles para garantías y marcas." />
        <div className="grid gap-3">{providers.map((provider) => <div key={provider.id} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:flex-row md:items-center md:justify-between"><div><div className="font-black text-white">{provider.name}</div><div className="text-sm text-slate-400">{[provider.contact_name, provider.email, provider.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>{!provider.is_active && <div className="mt-1 text-xs font-bold text-amber-200">Inactivo</div>}</div><button onClick={() => setProviderForm({ id: provider.id, name: provider.name, contact_name: provider.contact_name || '', email: provider.email || '', phone: provider.phone || '', notes: provider.notes || '', is_active: provider.is_active })} className={secondaryButtonClass}>Editar</button></div>)}</div>
        {!providers.length && <EmptyState title="No hay proveedores cargados" description="Creá proveedores y vinculalos con las marcas detectadas." />}
      </Panel>
    </section>}

    {tab === 'sync' && <Panel>
      <SectionHeader title="Sincronización" description="Fuente externa: Planilla Madre de Ventas." actions={<button onClick={runSync} disabled={syncing} className={primaryButtonClass}><RefreshCw size={18} className={syncing ? 'animate-spin' : ''} /> Actualizar catálogo</button>} />
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300"><div>Hoja: <span className="font-bold text-white">{String(status?.config?.sheet_name || 'Productos PVP')}</span></div><div className="break-all">URL configurada: <span className="text-slate-400">{String(status?.config?.spreadsheet_url || 'Sin configurar')}</span></div></div>
      <div className="mt-5 grid gap-3">{logs.map((log) => <div key={log.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{log.status === 'success' ? 'Exitoso' : log.status === 'partial' ? 'Parcial' : log.status === 'failed' ? 'Fallido' : log.status}</div><div className="text-xs text-slate-500">{log.finished_at ? new Date(log.finished_at).toLocaleString() : log.started_at}</div></div><div className="mt-2 text-sm text-slate-300">Procesados {log.rows_processed} · Nuevos {log.rows_created} · Actualizados {log.rows_updated} · Omitidos {log.rows_skipped}</div>{((log.price_changes_detected ?? 0) > 0 || (log.cost_changes_detected ?? 0) > 0) && <div className="mt-1 text-sm"><span className="text-amber-200">Cambios de precio: {log.price_changes_detected ?? 0}</span>{' · '}<span className="text-blue-200">Cambios de costo: {log.cost_changes_detected ?? 0}</span>{' · '}<span className="text-green-200">Tareas creadas: {log.price_cost_updates_created ?? 0}</span>{(log.price_cost_updates_skipped ?? 0) > 0 && <span className="text-slate-400"> · Omitidas: {log.price_cost_updates_skipped}</span>}</div>}{log.errors?.length > 0 && <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">{log.errors.slice(0, 4).join(' · ')}</div>}</div>)}</div>
      {!logs.length && <div className="mt-4"><EmptyState title="Sin sincronizaciones recientes" description="Actualizá el catálogo para registrar el primer proceso." /></div>}
    </Panel>}

    {relations.length > 0 && <Panel>
      <SectionHeader title="Relaciones marca/proveedor" description="Vinculaciones activas usadas por Garantías." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{relations.map((relation) => <div key={relation.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"><div><div className="font-bold text-white">{relation.brand_name}</div><div className="text-sm text-blue-200">{relation.provider_name}</div></div><button onClick={() => removeRelation(relation.id)} className="rounded-xl border border-red-500/40 p-2 text-red-200 hover:bg-red-500/10"><Trash2 size={16} /></button></div>)}</div>
    </Panel>}
  </div>;

}
