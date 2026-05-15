import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Check, Copy, MessageCircle, Plus, Save, Search, Trash2 } from 'lucide-react';
import { can, createBudget, fetchBudgetOptions, getCurrentUserFromStorage, searchBudgetProducts } from '../api/client';
import type { BudgetCreateResponse, BudgetLinePayload, BudgetOptions, BudgetProduct, BudgetShippingOption } from '../types';

type BudgetLine = Omit<BudgetLinePayload, 'precio_unitario'> & {
  localId: string;
  precio_unitario: number;
  precioTexto: string;
  productQuery: string;
  suggestions: BudgetProduct[];
  searching: boolean;
  stock?: string | null;
};

function makeLocalId() {
  return globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseArNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value).trim();
  if (!text) return 0;
  text = text.replace(/\u00a0/g, ' ');
  text = text.replace(/[^0-9,.-]/g, '');
  if (!text || text === '-' || text === ',' || text === '.') return 0;

  const negative = text.startsWith('-');
  text = text.replace(/^-/, '');

  if (text.includes(',') && text.includes('.')) {
    // Argentina: 1.234.567,89
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234,567.89
      text = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes('.')) {
    const parts = text.split('.');
    if (parts.length > 1 && parts.slice(1).every((part) => part.length === 3)) {
      text = parts.join('');
    }
  }

  const parsed = Number(`${negative ? '-' : ''}${text}`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatArNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'A confirmar';
  return `$ ${formatArNumber(value, 2)}`;
}

function newLine(defaults?: Partial<BudgetLine>): BudgetLine {
  const initialPrice = defaults?.precio_unitario ?? 0;
  return {
    localId: makeLocalId(),
    producto: '',
    sku: '',
    marca: '',
    tipo: '',
    condicion: '',
    cantidad: 1,
    precio_unitario: initialPrice,
    precioTexto: initialPrice ? formatArNumber(initialPrice, 2) : '',
    productQuery: '',
    suggestions: [],
    searching: false,
    stock: '',
    ...defaults,
  };
}

function buildQuickText(lines: BudgetLine[], subtotal: number, shipping: BudgetShippingOption | null, shippingValue: number, total: number, sucursal: string) {
  const text: string[] = [];
  text.push('Presupuesto ElectroGV');
  if (sucursal) text.push(`Sucursal: ${sucursal}`);
  text.push('');
  text.push('Productos:');
  lines.forEach((line) => {
    const sku = line.sku ? ` (${line.sku})` : '';
    text.push(`- ${line.cantidad} x ${line.producto}${sku}: ${money(line.cantidad * line.precio_unitario)}`);
  });
  text.push('');
  text.push(`Subtotal: ${money(subtotal)}`);
  if (shipping) text.push(`Envío ${shipping.label}: ${money(shippingValue)}`);
  text.push(`Total: ${money(total)}`);
  text.push('');
  text.push('Sujeto a disponibilidad de stock y vigencia de precios del día.');
  return text.join('\n');
}

export function BudgetCreatePage() {
  const [options, setOptions] = useState<BudgetOptions | null>(null);
  const [sucursal, setSucursal] = useState('');
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [shippingId, setShippingId] = useState('');
  const [manualShipping, setManualShipping] = useState<number>(0);
  const [manualShippingText, setManualShippingText] = useState('0,00');
  const [rows, setRows] = useState<BudgetLine[]>([newLine()]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<BudgetCreateResponse | null>(null);
  const [copied, setCopied] = useState('');

  const user = getCurrentUserFromStorage();
  const canOverridePrice = can('budgets.price_override');
  const canSaveBudget = can('budgets.save') || can('budgets.create');

  useEffect(() => {
    fetchBudgetOptions()
      .then((res) => {
        setOptions(res);
        setSucursal(res.sucursales[0] || '');
        const firstShip = res.shipping_options[0];
        setShippingId(firstShip?.id || '');
        const ship = firstShip?.price ?? 0;
        setManualShipping(ship);
        setManualShippingText(formatArNumber(ship, 2));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración de presupuestos'));
  }, []);

  const activeRows = useMemo(() => rows.filter((row) => row.producto.trim() || row.sku?.trim()), [rows]);
  const selectedShipping = useMemo(() => options?.shipping_options.find((item) => item.id === shippingId) || null, [options, shippingId]);
  const subtotal = useMemo(() => activeRows.reduce((sum, row) => sum + row.cantidad * row.precio_unitario, 0), [activeRows]);
  const total = subtotal + manualShipping;
  const quickText = useMemo(() => buildQuickText(activeRows, subtotal, selectedShipping, manualShipping, total, sucursal), [activeRows, subtotal, selectedShipping, manualShipping, total, sucursal]);

  function updateRow(localId: string, patch: Partial<BudgetLine>) {
    setRows((prev) => prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }

  function updateRowPrice(localId: string, value: string) {
    updateRow(localId, { precioTexto: value, precio_unitario: parseArNumber(value) });
  }

  function normalizeRowPrice(localId: string) {
    setRows((prev) => prev.map((row) => {
      if (row.localId !== localId) return row;
      return { ...row, precioTexto: row.precio_unitario ? formatArNumber(row.precio_unitario, 2) : '' };
    }));
  }

  function updateShippingText(value: string) {
    setManualShippingText(value);
    setManualShipping(parseArNumber(value));
  }

  function normalizeShipping() {
    setManualShippingText(formatArNumber(manualShipping, 2));
  }

  function addRow() {
    setRows((prev) => [...prev, newLine()]);
  }

  function removeRow(localId: string) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.localId !== localId)));
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setMessage('Copiado al portapapeles.');
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setError('No se pudo copiar automáticamente. El texto queda visible para copiarlo manualmente.');
    }
  }

  async function onProductTextChange(row: BudgetLine, value: string) {
    updateRow(row.localId, { productQuery: value, producto: value, suggestions: [] });
    if (value.trim().length < 2) return;
    updateRow(row.localId, { searching: true });
    try {
      const results = await searchBudgetProducts(value);
      updateRow(row.localId, { suggestions: results, searching: false });
    } catch {
      updateRow(row.localId, { suggestions: [], searching: false });
    }
  }

  function chooseProduct(row: BudgetLine, product: BudgetProduct) {
    const price = product.precio ?? 0;
    updateRow(row.localId, {
      producto: product.producto || product.label,
      productQuery: product.producto || product.label,
      sku: product.sku || '',
      marca: product.marca || '',
      tipo: product.tipo || '',
      condicion: product.condicion || '',
      precio_unitario: price,
      precioTexto: price ? formatArNumber(price, 2) : '',
      stock: product.stock || '',
      suggestions: [],
      searching: false,
    });
  }

  function selectShipping(id: string) {
    setShippingId(id);
    const option = options?.shipping_options.find((item) => item.id === id);
    const value = option?.price ?? 0;
    setManualShipping(value);
    setManualShippingText(formatArNumber(value, 2));
  }

  function validate(): string | null {
    if (!sucursal.trim()) return 'Seleccioná una sucursal.';
    if (activeRows.length === 0) return 'Agregá al menos un producto.';
    for (let i = 0; i < activeRows.length; i += 1) {
      const row = activeRows[i];
      const index = i + 1;
      if (!row.producto.trim()) return `Fila ${index}: falta producto.`;
      if (!row.cantidad || row.cantidad < 1) return `Fila ${index}: cantidad inválida.`;
      if (row.precio_unitario < 0) return `Fila ${index}: precio inválido.`;
      if (row.precio_unitario === 0) return `Fila ${index}: el producto no tiene precio cargado. Revisalo antes de presupuestar.`;
    }
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setMessage(''); setSaved(null);
    const validation = validate();
    if (validation) { setError(validation); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSaving(true);
    try {
      const payload = {
        sucursal: sucursal.trim(),
        cliente: cliente.trim() || undefined,
        telefono: telefono.trim() || undefined,
        envio_zona: selectedShipping?.label || undefined,
        envio: manualShipping,
        observaciones: observaciones.trim() || undefined,
        items: activeRows.map((row) => ({
          producto: row.producto.trim(),
          sku: row.sku || undefined,
          marca: row.marca || undefined,
          tipo: row.tipo || undefined,
          condicion: row.condicion || undefined,
          cantidad: row.cantidad,
          precio_unitario: row.precio_unitario,
        })),
      };
      const response = await createBudget(payload);
      setSaved(response);
      setMessage(`Presupuesto guardado: ${response.id_presupuesto}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el presupuesto');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  function clearBudget() {
    setCliente(''); setTelefono(''); setObservaciones(''); setSaved(null); setMessage(''); setError('');
    setRows([newLine()]);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">Presupuestos rápidos</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400 sm:text-base">
            Buscá productos, sumá cantidades, agregá envío y decile el total al cliente en el momento. Guardar y copiar WhatsApp son opcionales.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
          Vendedor: <span className="font-bold text-white">{user?.display_name || user?.username || 'usuario'}</span>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100">{message}</div>}

      {saved && (
        <div className="mb-6 rounded-3xl border border-blue-500/40 bg-blue-500/10 p-4 text-blue-100 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-lg font-black">Presupuesto guardado</div>
              <div className="text-sm text-blue-200">ID: <span className="font-black text-white">{saved.id_presupuesto}</span> · Total: {money(saved.total_final)}</div>
            </div>
            <button onClick={() => copyToClipboard(saved.whatsapp_text)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-sm font-black text-white">
              <MessageCircle size={18} /> Copiar texto opcional
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-5">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
            <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label>
                <span className="mb-1 block text-xs font-bold text-slate-400">Sucursal</span>
                <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3">
                  {(options?.sucursales || []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-bold text-slate-400">Cliente opcional</span>
                <input value={cliente} onChange={(e) => setCliente(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" placeholder="Nombre del cliente" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-bold text-slate-400">Teléfono opcional</span>
                <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" placeholder="WhatsApp / teléfono" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-bold text-slate-400">Envío</span>
                <select value={shippingId} onChange={(e) => selectShipping(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3">
                  {(options?.shipping_options || []).map((item) => <option key={item.id} value={item.id}>{item.label} · {item.price_text}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-400">Observaciones opcionales</span>
              <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" placeholder="Ej: precio sujeto a disponibilidad, color solicitado, etc." />
            </label>
          </div>

          {rows.map((row, index) => (
            <div key={row.localId} className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="font-black text-white">Producto {index + 1}</div>
                <button type="button" onClick={() => removeRow(row.localId)} disabled={rows.length === 1} className="rounded-xl border border-red-500/30 px-3 py-2 text-sm text-red-200 disabled:opacity-40"><Trash2 size={16} /></button>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_110px_190px]">
                <div className="relative">
                  <span className="mb-1 block text-xs font-bold text-slate-400">Buscar producto / SKU</span>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
                    <Search size={18} className="text-slate-500" />
                    <input value={row.productQuery} onChange={(e) => onProductTextChange(row, e.target.value)} className="w-full bg-transparent py-1 outline-none" placeholder="Ej: heladera samsung, SKU, marca..." />
                  </div>
                  {row.suggestions.length > 0 && (
                    <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
                      {row.suggestions.map((product) => (
                        <button key={`${product.sku}-${product.producto}`} type="button" onClick={() => chooseProduct(row, product)} className="block w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-900">
                          <div className="font-bold text-white">{product.producto}</div>
                          <div className="mt-1 text-xs text-slate-400">{product.sku || 'sin SKU'} · {product.marca || 'sin marca'} · {product.precio_texto || 'sin precio'} {product.stock ? `· Stock: ${product.stock}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label>
                  <span className="mb-1 block text-xs font-bold text-slate-400">Cantidad</span>
                  <input type="number" min={1} value={row.cantidad} onChange={(e) => updateRow(row.localId, { cantidad: Number(e.target.value) || 1 })} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3" />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold text-slate-400">Precio unitario</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.precioTexto}
                    onChange={(e) => updateRowPrice(row.localId, e.target.value)}
                    onBlur={() => normalizeRowPrice(row.localId)}
                    readOnly={!canOverridePrice && row.precio_unitario > 0}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 read-only:opacity-80"
                    placeholder="525.000,00"
                  />
                </label>
              </div>
              {(row.sku || row.marca || row.condicion || row.stock) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                  {row.sku && <span className="rounded-full bg-slate-800 px-3 py-1">SKU: {row.sku}</span>}
                  {row.marca && <span className="rounded-full bg-slate-800 px-3 py-1">Marca: {row.marca}</span>}
                  {row.condicion && <span className="rounded-full bg-slate-800 px-3 py-1">{row.condicion}</span>}
                  {row.stock && <span className="rounded-full bg-slate-800 px-3 py-1">Stock informado: {row.stock}</span>}
                  <span className="rounded-full bg-blue-500/20 px-3 py-1 text-blue-100">Total línea: {money(row.cantidad * row.precio_unitario)}</span>
                </div>
              )}
            </div>
          ))}

          <button type="button" onClick={addRow} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-5 py-4 font-black text-slate-100 hover:bg-slate-800 sm:w-auto">
            <Plus size={18} /> Agregar otro producto
          </button>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 shadow-2xl">
            <h2 className="text-xl font-black">Total para decir en persona</h2>
            <p className="mt-1 text-sm text-slate-400">No hace falta guardar ni mandar WhatsApp. Esto sirve para calcular rápido frente al cliente.</p>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-400">Subtotal productos</span><span className="font-black text-white">{money(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Envío</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualShippingText}
                  onChange={(e) => updateShippingText(e.target.value)}
                  onBlur={normalizeShipping}
                  className="w-36 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right font-bold"
                  placeholder="0,00"
                />
              </div>
              <div className="border-t border-slate-800 pt-3 text-lg">
                <div className="flex justify-between gap-3"><span className="font-bold">TOTAL</span><span className="text-2xl font-black text-emerald-300">{money(total)}</span></div>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => copyToClipboard(quickText)} disabled={activeRows.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-400/40 bg-blue-500/10 px-4 py-3 font-black text-blue-100 disabled:opacity-40">
                {copied === quickText ? <Check size={18} /> : <Copy size={18} />} Copiar resumen opcional
              </button>
              <button type="submit" disabled={saving || !canSaveBudget} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-black text-white disabled:opacity-50">
                <Save size={18} /> {saving ? 'Guardando...' : 'Guardar presupuesto'}
              </button>
              <button type="button" onClick={clearBudget} className="rounded-xl border border-slate-700 px-4 py-3 font-bold text-slate-300">Nuevo presupuesto</button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="text-sm font-black text-white">Vista de texto opcional</div>
            <textarea readOnly value={saved?.whatsapp_text || quickText} className="mt-3 h-64 w-full rounded-2xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-200" />
          </div>
        </aside>
      </form>
    </div>
  );
}
