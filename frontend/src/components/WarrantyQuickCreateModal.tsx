import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Save, Search, ShieldCheck } from 'lucide-react';
import { can, createWarrantyEntries, getCurrentUserFromStorage, searchWarrantyProducts } from '../api/client';
import { canCrossSelectBranches } from '../branchAccess';
import {
  ErpBadge,
  ErpButton,
  ErpField,
  ErpInput,
  ErpModal,
  ErpNotice,
  ErpSection,
  ErpSelect,
  ErpTextarea,
} from './ProUI';
import type {
  WarrantyBranchOperativa,
  WarrantyCreateResponse,
  WarrantyItemPayload,
  WarrantyOptions,
  WarrantyProduct,
  WarrantySummary,
} from '../types';

const TIPO_INGRESO_FALLBACK = [
  { value: 'cliente_sucursal', label: 'Cliente en sucursal' },
  { value: 'cliente_deposito', label: 'Cliente en depósito' },
  { value: 'falla_recepcion_mercaderia', label: 'Falla al recibir mercadería' },
  { value: 'stock_interno', label: 'Stock interno' },
  { value: 'otro', label: 'Otro' },
];

function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeKey(value?: string | null) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function normalizeSerie(value?: string | null) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isClientIngreso(tipo?: string | null) {
  return tipo === 'cliente_sucursal' || tipo === 'cliente_deposito';
}

interface QuickForm {
  tipo_ingreso: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_email: string;
  numero_factura: string;
  fecha_compra: string;
  producto: string;
  productQuery: string;
  sku: string;
  marca: string;
  serie: string;
  fecha_ingreso: string;
  falla: string;
  proveedor: string;
  observaciones: string;
  // Sucursal de venta / origen (cliente_sucursal) o responsable (otros tipos).
  sucursal_venta: string;
  sucursal_venta_id: string;
  // Depósito de carga (cliente_deposito / otros).
  deposito: string;
}

function emptyForm(tipo: string): QuickForm {
  return {
    tipo_ingreso: tipo,
    cliente_nombre: '',
    cliente_telefono: '',
    cliente_email: '',
    numero_factura: '',
    fecha_compra: '',
    producto: '',
    productQuery: '',
    sku: '',
    marca: '',
    serie: '',
    fecha_ingreso: todayInputDate(),
    falla: '',
    proveedor: '',
    observaciones: '',
    sucursal_venta: '',
    sucursal_venta_id: '',
    deposito: '',
  };
}

const DRAFT_KEY = 'warranty_quick_draft_v2';

/**
 * Modal de carga de garantía — soporta el flujo completo de /warranties/new:
 * tipos de ingreso (cliente en sucursal / depósito / falla recepción / stock / otro),
 * sucursal de venta-responsable y depósito de carga, según el perfil del usuario.
 *
 * Calcula el perfil internamente (sucursal física, depósito operativo, gestor)
 * igual que WarrantyCreatePage. Carga UNA garantía por vez (caso operativo 90%);
 * para multi-producto agrupado sigue existiendo /warranties/new.
 */
export function WarrantyQuickCreateModal({
  open,
  onClose,
  onCreated,
  options,
  defaultSucursal,
  centralDeposit,
  existingWarranties = [],
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (res: WarrantyCreateResponse) => void;
  options: WarrantyOptions | null;
  /** Sucursal/depósito sugerido por la página que lo invoca. */
  defaultSucursal: string;
  /** Depósito central destino (Chiclana). */
  centralDeposit: string;
  /** Garantías ya cargadas para validar serie duplicada client-side. */
  existingWarranties?: WarrantySummary[];
}) {
  const currentUser = getCurrentUserFromStorage();

  // ── Perfil del usuario (misma lógica que WarrantyCreatePage) ──────────────
  const profile = useMemo(() => {
    const assigned = currentUser?.branches ?? [];
    const primary = assigned.find((b) => b.is_primary) || assigned[0];
    const depositBranch = assigned.find((b) => {
      const t = normalizeKey(b.type || '');
      const n = normalizeKey(b.name || '');
      return t === 'deposit' || t === 'deposito' || n.startsWith('deposito');
    });
    const canManage = can('warranties.manage') || can('warranties.manage_provider');
    const canChooseAny = canManage || canCrossSelectBranches(currentUser);
    const branchType = currentUser?.branch_type || primary?.type || depositBranch?.type || '';
    const btKey = normalizeKey(branchType);
    const isDepositBT = btKey === 'deposit' || btKey === 'deposito';
    const userBranchName = currentUser?.branch_name || currentUser?.sucursal || primary?.name || depositBranch?.name || defaultSucursal || '';
    const userBranchKey = normalizeKey(userBranchName);
    const isWeb = btKey === 'web';
    const looksDeposit = isDepositBT || userBranchKey.startsWith('deposito');
    const isSucursalFisica = ((btKey === 'physical' || btKey === 'sucursal' || btKey === 'sucursal fisica') && !canChooseAny)
      || (!btKey && !canChooseAny && Boolean(userBranchName) && !looksDeposit);
    const isDeposito = looksDeposit;
    const isDepositoOperativo = isDeposito && !canChooseAny;
    return { canManage, canChooseAny, isWeb, isSucursalFisica, isDeposito, isDepositoOperativo, userBranchName };
  }, [currentUser, defaultSucursal]);

  const branchesFisicas = useMemo<WarrantyBranchOperativa[]>(
    () => (options?.branches_operativas ?? []).filter((b) => b.type === 'physical'),
    [options],
  );
  const branchesDeposito = useMemo<WarrantyBranchOperativa[]>(
    () => (options?.branches_operativas ?? []).filter((b) => b.type === 'deposit'),
    [options],
  );
  const tiposIngreso = options?.tipos_ingreso ?? TIPO_INGRESO_FALLBACK;

  // Tipo forzado por perfil.
  const defaultTipo = profile.isSucursalFisica ? 'cliente_sucursal' : profile.isDepositoOperativo ? 'cliente_deposito' : '';

  const [form, setForm] = useState<QuickForm>(() => emptyForm(defaultTipo));
  const [suggestions, setSuggestions] = useState<WarrantyProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<WarrantyCreateResponse | null>(null);
  const [copied, setCopied] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const searchTimer = useRef<number | null>(null);

  const isSucursalTipo = form.tipo_ingreso === 'cliente_sucursal';
  const isDepositoTipo = form.tipo_ingreso === 'cliente_deposito';
  const lockTipo = profile.isSucursalFisica || profile.isDepositoOperativo;
  // Etiqueta y rol de la "sucursal de venta": origen (cliente_sucursal) o responsable (resto).
  const sucursalVentaRequired = isSucursalTipo || isDepositoTipo;

  // Al abrir: restaurar borrador o inicializar con defaults del perfil.
  useEffect(() => {
    if (!open) return;
    setError('');
    setSuccess(null);
    let base = emptyForm(defaultTipo);
    // Defaults según perfil:
    if (profile.isSucursalFisica) {
      base = { ...base, tipo_ingreso: 'cliente_sucursal', sucursal_venta: profile.userBranchName, deposito: centralDeposit };
    } else if (profile.isDepositoOperativo) {
      base = { ...base, tipo_ingreso: 'cliente_deposito', deposito: profile.userBranchName };
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<QuickForm>;
        setForm({ ...base, ...draft, tipo_ingreso: lockTipo ? base.tipo_ingreso : (draft.tipo_ingreso || base.tipo_ingreso) });
        setDraftLoaded(true);
      } else {
        setForm(base);
        setDraftLoaded(false);
      }
    } catch {
      setForm(base);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autoguardado del borrador.
  useEffect(() => {
    if (!open) return;
    const hasContent = form.cliente_nombre || form.producto || form.serie || form.falla;
    if (!hasContent) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, productQuery: '' })); } catch { /* noop */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [form, open]);

  function update(patch: Partial<QuickForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
    setDraftLoaded(false);
  }

  function onProductText(value: string) {
    update({ productQuery: value, producto: value });
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (value.trim().length < 2) { setSuggestions([]); return; }
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      try { setSuggestions(await searchWarrantyProducts(value)); }
      catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 280);
  }

  function chooseProduct(p: WarrantyProduct) {
    update({
      producto: p.producto || p.label,
      productQuery: p.producto || p.label,
      sku: p.sku || '',
      marca: p.marca || '',
      proveedor: p.provider_name || form.proveedor || '',
    });
    setSuggestions([]);
  }

  function setTipoIngreso(tipo: string) {
    // Al cambiar el tipo, reseteamos origen/destino coherentemente.
    if (tipo === 'cliente_sucursal') {
      update({ tipo_ingreso: tipo, deposito: centralDeposit, sucursal_venta: profile.isSucursalFisica ? profile.userBranchName : form.sucursal_venta });
    } else if (tipo === 'cliente_deposito') {
      update({ tipo_ingreso: tipo, deposito: profile.isDeposito ? profile.userBranchName : form.deposito });
    } else {
      update({ tipo_ingreso: tipo });
    }
  }

  // Validación de serie duplicada (client-side, garantías abiertas).
  const serieConflict = useMemo(() => {
    const target = normalizeSerie(form.serie);
    if (!target) return null;
    const FINAL = ['8 - RECHAZADO', '9 - ANULADA', '10 - FINALIZADO'];
    const match = existingWarranties.find((w) =>
      normalizeSerie(w.serie) === target && !FINAL.includes(w.estado || '') && !w.cancelled,
    );
    return match ? match.id_garantia : null;
  }, [form.serie, existingWarranties]);

  function validate(): string | null {
    if (!form.tipo_ingreso) return 'Elegí el tipo de ingreso.';
    if (isClientIngreso(form.tipo_ingreso)) {
      if (!form.cliente_nombre.trim()) return 'Falta el nombre del cliente.';
      if (!form.cliente_telefono.trim()) return 'Falta el teléfono del cliente.';
      if (!form.numero_factura.trim()) return 'Falta el N° de factura / ticket.';
      if (!form.fecha_compra.trim()) return 'Falta la fecha de compra.';
    }
    if (!form.producto.trim()) return 'Falta el producto.';
    if (!form.falla.trim()) return 'Falta la descripción de la falla.';
    if (isSucursalTipo && !form.sucursal_venta.trim()) return 'Falta la sucursal de origen.';
    if (isDepositoTipo && !form.sucursal_venta.trim()) return 'Indicá en qué sucursal compró el cliente.';
    if (!isSucursalTipo && !form.deposito.trim()) return 'Falta el depósito de ingreso.';
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError('');

    // Mapeo de "sucursal de venta" según el tipo:
    //  - cliente_sucursal: sucursal de ORIGEN (sucursal=...), destino depósito central.
    //  - resto: sucursal RESPONSABLE (dónde compró el cliente), depósito = el de carga.
    const sucursal = isSucursalTipo ? form.sucursal_venta.trim() : '';
    const sucursalResp = !isSucursalTipo ? form.sucursal_venta.trim() : '';
    const deposito = isSucursalTipo ? centralDeposit : form.deposito.trim();

    const payload: WarrantyItemPayload[] = [{
      tipo_ingreso: form.tipo_ingreso,
      producto: form.producto.trim(),
      sku: form.sku.trim() || undefined,
      marca: form.marca.trim() || undefined,
      serie: form.serie.trim() || undefined,
      falla: form.falla.trim(),
      sucursal,
      sucursal_responsable: sucursalResp || undefined,
      sucursal_responsable_id: form.sucursal_venta_id.trim() || undefined,
      deposito,
      observaciones: form.observaciones.trim() || undefined,
      proveedor: form.proveedor.trim() || undefined,
      cliente_nombre: form.cliente_nombre.trim() || undefined,
      cliente_telefono: form.cliente_telefono.trim() || undefined,
      cliente_email: form.cliente_email.trim() || undefined,
      numero_factura: form.numero_factura.trim() || undefined,
      fecha_compra: form.fecha_compra.trim() || undefined,
      fecha_ingreso: form.fecha_ingreso.trim() || undefined,
    }];
    try {
      const res = await createWarrantyEntries(payload, false);
      setSuccess(res);
      clearDraft();
      onCreated?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la garantía');
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard(value: string) {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied(''), 1600);
    }).catch(() => undefined);
  }

  // Opciones para el campo "Sucursal de venta" (siempre sucursales físicas).
  const sucursalVentaOptions = branchesFisicas.length
    ? branchesFisicas
    : (options?.sucursales || []).map((name) => ({ id: name, name } as WarrantyBranchOperativa));
  // Para cliente_sucursal en operador de sucursal, su sucursal queda fija.
  const lockSucursalVenta = isSucursalTipo && profile.isSucursalFisica;

  // ── Vista de éxito ────────────────────────────────────────────────────────
  if (success) {
    return (
      <ErpModal
        open={open}
        onClose={() => { setSuccess(null); onClose(); }}
        title="Garantía registrada"
        size="md"
        footer={
          <>
            <ErpButton variant="ghost" onClick={() => { setSuccess(null); setForm(emptyForm(defaultTipo)); }}>Cargar otra</ErpButton>
            <ErpButton variant="primary" onClick={() => { setSuccess(null); onClose(); }}>Cerrar</ErpButton>
          </>
        }
      >
        <ErpNotice tone="success" title={`${success.count} garantía registrada correctamente`}>
          Quedó en estado inicial de ingreso y aparece en el listado.
        </ErpNotice>
        <div className="mt-3 erp-stack-2">
          {success.items.map((item) => (
            <div key={item.id_garantia} className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="font-mono text-[13px] font-semibold text-[color:var(--text)]">{item.id_garantia}</div>
                <div className="text-[12px] text-[color:var(--text-2)] truncate">{item.producto}{item.sku ? ` · SKU ${item.sku}` : ''}</div>
              </div>
              <ErpButton size="sm" variant="secondary" onClick={() => copyToClipboard(item.id_garantia)} leftIcon={copied === item.id_garantia ? <Check size={13} /> : <Copy size={13} />}>
                Copiar ID
              </ErpButton>
            </div>
          ))}
        </div>
      </ErpModal>
    );
  }

  // Guard sucursal web
  if (profile.isWeb) {
    return (
      <ErpModal open={open} onClose={onClose} title="Carga de garantías" size="md"
        footer={<ErpButton variant="primary" onClick={onClose}>Entendido</ErpButton>}>
        <ErpNotice tone="warning" title="Sucursal web — sin carga directa">
          Los usuarios de sucursal web no cargan garantías directamente. Deben ingresarse desde la sucursal física o el depósito que recibe el producto.
        </ErpNotice>
      </ErpModal>
    );
  }

  return (
    <ErpModal
      open={open}
      onClose={onClose}
      title={
        <div className="flex flex-col">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Nueva garantía</span>
          <span className="inline-flex items-center gap-2"><ShieldCheck size={15} /> Registrar ingreso</span>
        </div>
      }
      size="lg"
      footer={
        <>
          {draftLoaded && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-[11.5px] text-[color:var(--text-3)]">
              <span className="erp-badge-dot" style={{ background: 'var(--warning)' }} /> Borrador autoguardado
            </span>
          )}
          <ErpButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</ErpButton>
          <ErpButton variant="primary" onClick={submit} loading={saving} leftIcon={<Save size={14} />}>
            Registrar garantía
          </ErpButton>
        </>
      }
    >
      <div className="erp-stack-6">
        {error && <ErpNotice tone="error">{error}</ErpNotice>}

        {/* 1 — Origen del ingreso */}
        <ErpSection n={1} title="Origen del ingreso" subtitle="¿Cómo llegó el producto a la garantía?">
          {lockTipo ? (
            <ErpNotice tone={profile.isSucursalFisica ? 'info' : 'success'}>
              <span className="inline-flex items-center gap-2">
                Tipo:
                <ErpBadge tone={profile.isSucursalFisica ? 'info' : 'success'}>
                  {profile.isSucursalFisica ? 'Cliente en sucursal' : 'Cliente en depósito'}
                </ErpBadge>
                {profile.isDeposito && profile.userBranchName && <span className="text-[12px]">· Depósito: <strong>{profile.userBranchName}</strong></span>}
              </span>
            </ErpNotice>
          ) : (
            <ErpField label="Tipo de ingreso" required>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {tiposIngreso.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTipoIngreso(opt.value)}
                    className={`erp-btn ${form.tipo_ingreso === opt.value ? 'erp-btn-primary' : 'erp-btn-secondary'}`}
                    style={{ justifyContent: 'flex-start' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </ErpField>
          )}

          {/* Sucursal de venta / origen / responsable + depósito */}
          {form.tipo_ingreso && (
            <div className="erp-form-grid erp-form-grid-2 mt-1">
              <ErpField
                label={isSucursalTipo ? 'Sucursal de origen' : 'Sucursal de venta'}
                required={sucursalVentaRequired}
                hint={isSucursalTipo ? 'Dónde el cliente trajo el equipo' : '¿En qué sucursal compró el cliente?'}
              >
                {lockSucursalVenta ? (
                  <div className="erp-info-row" style={{ borderColor: 'var(--primary)', background: 'var(--primary-soft)' }}>
                    <span className="erp-info-value">{form.sucursal_venta || profile.userBranchName}</span>
                  </div>
                ) : (
                  <ErpSelect
                    value={form.sucursal_venta_id || form.sucursal_venta}
                    onChange={(e) => {
                      const val = e.target.value;
                      const branch = sucursalVentaOptions.find((b) => b.id === val || b.name === val);
                      update({ sucursal_venta: branch?.name || val, sucursal_venta_id: branch?.id && branch.id !== branch.name ? branch.id : '' });
                    }}
                  >
                    <option value="">Seleccioná sucursal…</option>
                    {sucursalVentaOptions.map((b) => (
                      <option key={b.id || b.name} value={b.id || b.name}>{b.name}{b.company_name ? ` · ${b.company_name}` : ''}</option>
                    ))}
                  </ErpSelect>
                )}
              </ErpField>

              {/* Depósito destino/carga */}
              <ErpField
                label={isSucursalTipo ? 'Destino (automático)' : (profile.isDepositoOperativo ? 'Depósito asignado' : 'Depósito de ingreso')}
                required={!isSucursalTipo}
                hint={isSucursalTipo ? 'Todo ingreso de sucursal va al depósito central' : undefined}
              >
                {isSucursalTipo ? (
                  <div className="erp-info-row" style={{ borderColor: 'rgba(34,197,94,0.32)', background: 'var(--success-soft)' }}>
                    <span className="erp-info-value">{centralDeposit}</span>
                  </div>
                ) : profile.isDeposito && profile.userBranchName ? (
                  <div className="erp-info-row"><span className="erp-info-value">{profile.userBranchName}</span></div>
                ) : branchesDeposito.length > 0 ? (
                  <ErpSelect value={form.deposito} onChange={(e) => update({ deposito: e.target.value })}>
                    <option value="">Seleccioná…</option>
                    {branchesDeposito.map((b) => <option key={b.id} value={b.name}>{b.name}{b.company_name ? ` · ${b.company_name}` : ''}</option>)}
                  </ErpSelect>
                ) : (
                  <ErpSelect value={form.deposito} onChange={(e) => update({ deposito: e.target.value })}>
                    <option value="">Seleccioná…</option>
                    {(options?.depositos || []).map((d) => <option key={d} value={d}>{d}</option>)}
                  </ErpSelect>
                )}
              </ErpField>
            </div>
          )}
        </ErpSection>

        {/* 2 — Cliente (solo si es ingreso de cliente) */}
        {isClientIngreso(form.tipo_ingreso) && (
          <>
            <hr className="erp-divider" />
            <ErpSection n={2} title="Cliente" subtitle="Datos del titular de la compra">
              <div className="erp-form-grid erp-form-grid-2">
                <ErpField label="Nombre y apellido" required>
                  <ErpInput value={form.cliente_nombre} onChange={(e) => update({ cliente_nombre: e.target.value })} placeholder="Apellido y nombre" />
                </ErpField>
                <ErpField label="Teléfono" required>
                  <ErpInput value={form.cliente_telefono} onChange={(e) => update({ cliente_telefono: e.target.value })} placeholder="Número de contacto" />
                </ErpField>
                <ErpField label="Email (opcional)">
                  <ErpInput type="email" value={form.cliente_email} onChange={(e) => update({ cliente_email: e.target.value })} placeholder="cliente@email.com (si lo tenés a mano)" />
                </ErpField>
                <ErpField label="N° factura / ticket" required>
                  <ErpInput value={form.numero_factura} onChange={(e) => update({ numero_factura: e.target.value })} placeholder="Ej: 0001-00012345" />
                </ErpField>
                <ErpField label="Fecha de compra" required>
                  <ErpInput type="date" value={form.fecha_compra} onChange={(e) => update({ fecha_compra: e.target.value })} />
                </ErpField>
              </div>
            </ErpSection>
          </>
        )}

        <hr className="erp-divider" />

        {/* 3 — Producto */}
        <ErpSection n={isClientIngreso(form.tipo_ingreso) ? 3 : 2} title="Producto" subtitle="Identificación del equipo">
          <div className="erp-form-grid erp-form-grid-2">
            <div className="erp-field erp-field-wide" style={{ position: 'relative' }}>
              <label className="erp-field-label">
                <span className="inline-flex items-center gap-1.5"><Search size={13} /> Producto <span className="erp-field-required">*</span></span>
              </label>
              <ErpInput value={form.productQuery || form.producto} onChange={(e) => onProductText(e.target.value)} placeholder="Buscar por SKU, marca o descripción" autoComplete="off" />
              <span className="erp-field-hint">Buscá por SKU, marca o descripción.</span>
              {(searching || suggestions.length > 0) && (
                <div className="absolute z-20 w-full overflow-auto rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-elevated)] shadow-[var(--sh-pop)]" style={{ top: 'calc(100% - 18px)', maxHeight: 260 }}>
                  {searching && <div className="px-3 py-2 text-[12.5px] text-[color:var(--text-2)]">Buscando…</div>}
                  {suggestions.map((p) => (
                    <button key={`${p.sku}-${p.producto}`} type="button" onClick={() => chooseProduct(p)} className="block w-full border-b border-[color:var(--divider)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[color:var(--surface-hover)]">
                      <div className="text-[13px] font-medium text-[color:var(--text)]">{p.producto || p.label}</div>
                      <div className="text-[11px] text-[color:var(--text-3)]">SKU: {p.sku || '-'} · {p.marca || 'Sin marca'}{p.provider_name ? ` · ${p.provider_name}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ErpField label="Marca">
              <ErpInput value={form.marca} onChange={(e) => update({ marca: e.target.value })} placeholder="Marca" />
            </ErpField>
            <ErpField label="SKU">
              <ErpInput value={form.sku} onChange={(e) => update({ sku: e.target.value })} placeholder="SKU" />
            </ErpField>
            <ErpField label="N.º de serie" error={serieConflict ? `Este número de serie ya tiene una garantía abierta (${serieConflict}).` : undefined}>
              <ErpInput value={form.serie} onChange={(e) => update({ serie: e.target.value })} placeholder="N° de serie" invalid={!!serieConflict} />
            </ErpField>
            <ErpField label="Fecha de ingreso" required>
              <ErpInput type="date" value={form.fecha_ingreso} onChange={(e) => update({ fecha_ingreso: e.target.value })} />
            </ErpField>
          </div>
        </ErpSection>

        <hr className="erp-divider" />

        {/* 4 — Falla declarada */}
        <ErpSection n={isClientIngreso(form.tipo_ingreso) ? 4 : 3} title="Falla declarada" subtitle="Descripción y derivación">
          <div className="erp-form-grid">
            <ErpField label="Descripción de la falla" required>
              <ErpTextarea value={form.falla} onChange={(e) => update({ falla: e.target.value })} rows={3} placeholder="Ej: no enciende, hace ruido, pantalla rota…" />
            </ErpField>
            <div className="erp-form-grid erp-form-grid-2">
              <ErpField label="Proveedor a gestionar" hint="Se autocompleta al elegir producto (editable)">
                <ErpInput value={form.proveedor} onChange={(e) => update({ proveedor: e.target.value })} placeholder="Proveedor / fabricante" />
              </ErpField>
              <ErpField label="Observaciones" hint="Accesorios, estado del equipo, etc.">
                <ErpInput value={form.observaciones} onChange={(e) => update({ observaciones: e.target.value })} placeholder="Opcional" />
              </ErpField>
            </div>
          </div>
        </ErpSection>
      </div>
    </ErpModal>
  );
}
