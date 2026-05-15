import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSalesWebRequest, fetchSalesWebOptions, getCurrentUserFromStorage, searchSalesWebProducts } from '../api/client';
import type { BudgetProduct, SalesWebCreatePayload, SalesWebOptions } from '../types';

type Line = {
  sku?: string | null;
  producto: string;
  marca?: string | null;
  tipo?: string | null;
  condicion?: string | null;
  cantidad: number;
  precio_unitario?: string | number | null;
  precio_texto?: string | null;
};

const emptyForm = {
  dni: '',
  apellido_nombre: '',
  domicilio: '',
  codigo_postal: '',
  localidad: '',
  telefono: '',
  correo_electronico: '',
  pago_tipo: 'Pago completo',
  entrega_tipo: 'Retira en local',
  barrio: '',
  entre_calles: '',
  observaciones: '',
  costo_envio: '',
  senia_monto: '',
  sucursal: '',
};

export function SalesWebCreatePage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUserFromStorage();
  const [options, setOptions] = useState<SalesWebOptions | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BudgetProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSalesWebOptions().then((data) => {
      setOptions(data);
      setForm((prev) => ({ ...prev, sucursal: prev.sucursal || currentUser?.sucursal || data.sucursales[0] || '' }));
    }).catch((err) => setError(err.message || 'No se pudieron cargar opciones'));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      setLoadingProducts(true);
      searchSalesWebProducts(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoadingProducts(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const requiresShippingCost = form.entrega_tipo === 'Envío';
  const isSenia = form.pago_tipo === 'Seña';
  const subtotalProductos = useMemo(() => items.reduce((acc, item) => {
    const unit = parseMoneyAr(item.precio_unitario ?? item.precio_texto ?? '');
    if (unit === null) return acc;
    return acc + unit * Math.max(1, Number(item.cantidad) || 1);
  }, 0), [items]);
  const envio = parseMoneyAr(form.costo_envio) ?? 0;
  const totalOperacion = subtotalProductos + envio;
  const seniaMonto = parseMoneyAr(form.senia_monto);
  const resto = isSenia && seniaMonto !== null ? totalOperacion - seniaMonto : 0;
  const seniaInvalida = isSenia && (seniaMonto === null || seniaMonto <= 0 || resto < 0);

  const canSave = useMemo(() => {
    const required = [form.dni, form.apellido_nombre, form.domicilio, form.codigo_postal, form.localidad, form.telefono, form.correo_electronico, form.pago_tipo, form.entrega_tipo];
    if (required.some((v) => !String(v || '').trim())) return false;
    if (requiresShippingCost && !String(form.costo_envio || '').trim()) return false;
    if (isSenia && seniaInvalida) return false;
    if (items.length === 0) return false;
    return true;
  }, [form, requiresShippingCost, isSenia, seniaInvalida, items.length]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addProduct(product: BudgetProduct) {
    setItems((prev) => [...prev, {
      sku: product.sku,
      producto: product.producto,
      marca: product.marca,
      tipo: product.tipo,
      condicion: product.condicion,
      cantidad: 1,
      precio_unitario: product.precio_texto ?? product.precio ?? '',
      precio_texto: product.precio_texto,
    }]);
    setQuery('');
    setResults([]);
  }

  function setQty(index: number, cantidad: number) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, cantidad: Math.max(1, cantidad || 1) } : item));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setError('');
    if (!canSave) {
      setError('Completá todos los campos obligatorios y agregá al menos un producto. Si es envío, cargá el costo del envío. Si es seña, cargá el monto y verificá que no supere el total.');
      return;
    }
    setSaving(true);
    try {
      const payload: SalesWebCreatePayload = {
        ...form,
        canal: 'Venta',
        items: items.map((item) => ({
          sku: item.sku,
          producto: item.producto,
          marca: item.marca,
          tipo: item.tipo,
          condicion: item.condicion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
        })),
      };
      const created = await createSalesWebRequest(payload);
      navigate(`/venta/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la venta');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-7 shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-4xl">🧾</div>
            <h1 className="mt-2 text-3xl font-black">Nueva venta</h1>
            <p className="mt-1 text-slate-400">Cargá los datos para que administración prepare la prefactura/remito de la venta.</p>
          </div>
          <button onClick={() => navigate('/venta')} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800">Ver ventas</button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">{error}</div>}

      <section className="grid gap-5 lg:grid-cols-2">
        <Card title="Datos del cliente">
          <Input label="DNI *" value={form.dni} onChange={(v) => update('dni', v)} />
          <Input label="Apellido y nombre *" value={form.apellido_nombre} onChange={(v) => update('apellido_nombre', v)} />
          <Input label="Teléfono *" value={form.telefono} onChange={(v) => update('telefono', v)} />
          <Input label="Correo electrónico *" value={form.correo_electronico} onChange={(v) => update('correo_electronico', v)} />
        </Card>
        <Card title="Domicilio">
          <Input label="Domicilio *" value={form.domicilio} onChange={(v) => update('domicilio', v)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Código postal *" value={form.codigo_postal} onChange={(v) => update('codigo_postal', v)} />
            <Input label="Localidad *" value={form.localidad} onChange={(v) => update('localidad', v)} />
          </div>
          <Input label="Barrio" value={form.barrio} onChange={(v) => update('barrio', v)} />
          <Input label="Entre calles" value={form.entre_calles} onChange={(v) => update('entre_calles', v)} />
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <Card title="Productos que se lleva el cliente">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-400">Buscar producto</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por producto, SKU, marca o tipo" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" />
          {loadingProducts && <div className="mt-2 text-sm text-slate-400">Buscando...</div>}
          {results.length > 0 && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/80">
              {results.map((product, index) => (
                <button key={`${product.sku || product.producto}-${index}`} onClick={() => addProduct(product)} className="block w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-900">
                  <div className="font-bold text-white">{product.producto}</div>
                  <div className="text-xs text-slate-400">{product.sku || 'Sin SKU'} · {product.marca || 'Sin marca'} · {product.precio_texto || 'Sin precio'} · Stock {product.stock || '-'}</div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 space-y-3">
            {items.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Todavía no agregaste productos.</div>}
            {items.map((item, index) => (
              <div key={`${item.sku || item.producto}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-white">{item.producto}</div>
                    <div className="text-xs text-slate-400">{item.sku || 'Sin SKU'} · {item.marca || 'Sin marca'} · {item.condicion || '-'}</div>
                    {item.precio_texto && <div className="mt-1 text-sm font-bold text-green-200">{item.precio_texto}</div>}
                  </div>
                  <button onClick={() => removeItem(index)} className="rounded-lg border border-red-500/40 px-3 py-1 text-xs font-bold text-red-200 hover:bg-red-500/10">Quitar</button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[130px_1fr] sm:items-end">
                  <Input label="Cantidad" value={String(item.cantidad)} onChange={(v) => setQty(index, Number(v))} />
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300">Total línea: <b className="text-green-200">{formatMoneyAr((parseMoneyAr(item.precio_unitario ?? item.precio_texto ?? '') ?? 0) * Math.max(1, Number(item.cantidad) || 1))}</b></div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Datos de operación">
          <Select label="Sucursal" value={form.sucursal} onChange={(v) => update('sucursal', v)} options={options?.sucursales || []} placeholder="Sin sucursal" />
          <Select label="Pago completo o seña *" value={form.pago_tipo} onChange={(v) => update('pago_tipo', v)} options={options?.pagos || ['Pago completo', 'Seña']} />
          {isSenia && (
            <>
              <Input label="Monto de la seña *" value={form.senia_monto} onChange={(v) => update('senia_monto', v)} placeholder="Ej: 100.000,00" />
              {seniaInvalida && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">Cargá una seña válida. No puede estar vacía ni superar el total.</div>}
            </>
          )}
          <Select label="Retira en local o envío *" value={form.entrega_tipo} onChange={(v) => update('entrega_tipo', v)} options={options?.entregas || ['Retira en local', 'Envío']} />
          <Input label={`Costo del envío${requiresShippingCost ? ' *' : ''}`} value={form.costo_envio} onChange={(v) => update('costo_envio', v)} placeholder="Ej: 15.000,00" />
          {requiresShippingCost && !form.costo_envio && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">Si es envío, cargá el costo del envío o aclaralo antes de guardar.</div>}

          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
            <div className="text-sm font-bold text-blue-100">Resumen para enviar a administración</div>
            <div className="mt-3 space-y-2 text-sm text-slate-200">
              <Row label="Subtotal productos" value={formatMoneyAr(subtotalProductos)} />
              <Row label="Envío" value={formatMoneyAr(envio)} />
              <Row label="Total" value={formatMoneyAr(totalOperacion)} strong />
              {isSenia && <Row label="Seña" value={seniaMonto !== null ? formatMoneyAr(seniaMonto) : '-'} />}
              {isSenia && <Row label="Resta a cobrar" value={resto >= 0 ? formatMoneyAr(resto) : '-'} strong />}
            </div>
          </div>

          <label className="text-xs font-bold uppercase tracking-wide text-slate-400">Observaciones</label>
          <textarea value={form.observaciones} onChange={(e) => update('observaciones', e.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" />
        </Card>
      </section>

      <div className="sticky bottom-4 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
        <button disabled={saving || !canSave} onClick={submit} className="w-full rounded-xl bg-blue-500 px-5 py-4 font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? 'Guardando...' : 'Crear venta pendiente'}
        </button>
      </div>
    </div>
  );
}

function parseMoneyAr(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/\$/g, '').replace(/\s/g, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatMoneyAr(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl"><h2 className="text-xl font-black">{title}</h2>{children}</div>;
}

function Input({ label, value, onChange, placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400" /></label>;
}

function Select({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-400"><option value="">{placeholder || 'Seleccionar'}</option>{options.map((op) => <option key={op} value={op}>{op}</option>)}</select></label>;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{label}</span><span className={strong ? 'text-lg font-black text-white' : 'font-bold text-slate-100'}>{value}</span></div>;
}
