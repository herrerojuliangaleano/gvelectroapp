import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Save,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import {
  can,
  createWarrantyEntries,
  fetchWarrantyOptions,
  getCurrentUsername,
  getCurrentUserFromStorage,
  searchWarrantyProducts,
} from '../api/client';
import type {
  WarrantyBranchOperativa,
  WarrantyCreateResponse,
  WarrantyItemPayload,
  WarrantyOptions,
  WarrantyProduct,
} from '../types';

// ── Tipos de ingreso con descripción visual ───────────────────────────────────
const TIPO_INGRESO_FALLBACK = [
  { value: 'cliente_sucursal',           label: 'Cliente en sucursal' },
  { value: 'cliente_deposito',           label: 'Cliente en depósito' },
  { value: 'falla_recepcion_mercaderia', label: 'Falla al recibir mercadería' },
  { value: 'stock_interno',              label: 'Stock interno' },
  { value: 'otro',                       label: 'Otro' },
];

type WarrantyLine = WarrantyItemPayload & {
  localId: string;
  productQuery: string;
  suggestions: WarrantyProduct[];
  searching: boolean;
  showClientData: boolean;
  sucursal_responsable: string;
};

function makeLocalId() {
  return globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function newLine(defaults?: Partial<WarrantyLine>): WarrantyLine {
  return {
    localId: makeLocalId(),
    tipo_ingreso: '',
    producto: '',
    sku: '',
    marca: '',
    tipo: '',
    serie: '',
    falla: '',
    sucursal: '',
    deposito: '',
    observaciones: '',
    proveedor: '',
    cliente_nombre: '',
    cliente_telefono: '',
    cliente_email: '',
    numero_factura: '',
    fecha_compra: '',
    fecha_ingreso: todayInputDate(),
    sucursal_responsable: '',
    productQuery: '',
    suggestions: [],
    searching: false,
    showClientData: false,
    ...defaults,
  };
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
function centralWarrantyDepositName(options: WarrantyOptions | null): string {
  const configured = options?.warranty_central_deposit?.name?.trim();
  if (configured && configured.toLowerCase().includes('chiclana')) return configured;
  const branches = options?.branches_operativas ?? [];
  const byChiclana = branches.find((b) => b.type === 'deposit' && `${b.code} ${b.name}`.toLowerCase().includes('chiclana'));
  if (byChiclana?.name) return byChiclana.name;
  const cfgChiclana = options?.depositos?.find((d) => d.toLowerCase().includes('chiclana'));
  return cfgChiclana || 'Depósito Chiclana';
}


function buildWhatsappText(ids: string[]) {
  const uniqueIds = uniqueValues(ids);
  if (uniqueIds.length === 0) return '';
  if (uniqueIds.length === 1) return uniqueIds[0];
  return uniqueIds.join('\n');
}

function copiedLabel(copied: string, value: string) {
  return copied === value ? <Check size={16} /> : <Copy size={16} />;
}

function isClientIngreso(tipo?: string | null) {
  return tipo === 'cliente_sucursal' || tipo === 'cliente_deposito';
}

export function WarrantyCreatePage() {
  const [options, setOptions] = useState<WarrantyOptions | null>(null);
  const [rows, setRows] = useState<WarrantyLine[]>([newLine()]);
  const [groupUnderOneId, setGroupUnderOneId] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<WarrantyCreateResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');
  const [sharedClientData, setSharedClientData] = useState({
    cliente_nombre: '',
    cliente_telefono: '',
    cliente_email: '',
    numero_factura: '',
    fecha_compra: '',
  });

  const username = getCurrentUsername() || 'usuario actual';
  const currentUser = getCurrentUserFromStorage();

  // ── Perfil del usuario ───────────────────────────────────────────────────
  const normalizeKey = (value?: string | null) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const assignedBranches = currentUser?.branches ?? [];
  const primaryAssignedBranch = assignedBranches.find((b) => b.is_primary) || assignedBranches[0];
  const depositAssignedBranch = assignedBranches.find((b) => {
    const bType = normalizeKey(b.type || '');
    const bName = normalizeKey(b.name || '');
    return bType === 'deposit' || bType === 'deposito' || bName.startsWith('deposito');
  });
  const userRoleKey = normalizeKey(currentUser?.role || '');
  const canManage   = can('warranties.manage') || can('warranties.manage_provider');

  // Fase 31: el alcance principal es solo default operativo, no una cárcel.
  // - Gestores/Admin/Superadmin usan la unidad principal como sugerencia, pero pueden cargar desde cualquier sucursal/deposito permitido.
  // - Personal DEPOSITO sin permisos de gestión usa su depósito asignado aunque la branch principal haya quedado en otra unidad.
  // - Vendedores usan su sucursal principal.
  const operationalDepositFallback = !canManage && userRoleKey === 'deposito' ? depositAssignedBranch : null;
  const effectiveBranch = canManage
    ? (primaryAssignedBranch || depositAssignedBranch)
    : (operationalDepositFallback || primaryAssignedBranch || depositAssignedBranch);
  const branchType  = currentUser?.branch_type || effectiveBranch?.type || '';
  const branchTypeKey = normalizeKey(branchType);
  const userBranchNameRaw = currentUser?.branch_name || currentUser?.sucursal || effectiveBranch?.name || '';
  const userBranchNameKey = normalizeKey(userBranchNameRaw);

  // WEB: no puede cargar garantías.
  const isWebBranch = branchTypeKey === 'web';

  // Sucursal física: branch_type = "physical" sin permisos de gestión.
  // Fallback legacy: sin branch_type pero sin manage → asumimos sucursal, salvo que sea depósito.
  const looksLikeDepositUser = branchTypeKey === 'deposit' || branchTypeKey === 'deposito' || userRoleKey === 'deposito' || userBranchNameKey.startsWith('deposito');
  const isSucursalFisica = ((branchTypeKey === 'physical' || branchTypeKey === 'sucursal' || branchTypeKey === 'sucursal fisica') && !canManage)
    || (!branchTypeKey && !canManage && Boolean(currentUser?.branch_name || currentUser?.sucursal) && !looksLikeDepositUser);
  // Depósito: branch_type = "deposit" / "deposito" o rol DEPOSITO.
  const isDeposito = looksLikeDepositUser;
  // Depósito operativo: personal de depósito sin permisos de gestión/admin.
  // Estos usuarios solo cargan "Cliente en depósito"; las otras opciones quedan para gestores/admin.
  const isDepositoOperativo = isDeposito && !canManage;

  // Nombre y ID de la unidad asignada al usuario (sucursal o depósito).
  const userBranchId   = currentUser?.branch_id   || effectiveBranch?.id || '';
  const userBranchName = userBranchNameRaw;
  const userCompanyId  = currentUser?.company_id   || effectiveBranch?.company_id || '';

  // Alias semántico para mayor claridad en el template.
  const userSucursal   = userBranchName;   // para compatibilidad con código existente

  const tiposIngreso = options?.tipos_ingreso ?? TIPO_INGRESO_FALLBACK;

  // Branches reales del sistema, separadas por tipo.
  const branchesParaSucursal:    WarrantyBranchOperativa[] = (options?.branches_operativas ?? []).filter((b) => b.type === 'physical');
  const branchesParaDeposito:    WarrantyBranchOperativa[] = (options?.branches_operativas ?? []).filter((b) => b.type === 'deposit');
  const branchesParaResponsable: WarrantyBranchOperativa[] = branchesParaSucursal; // sucursal responsable = físicas
  const centralDepositName = centralWarrantyDepositName(options);

  // ── Inicialización con opciones del servidor ───────────────────────────────
  useEffect(() => {
    fetchWarrantyOptions()
      .then((res) => {
        setOptions(res);
        // Depósito por defecto: primero usar branch real del sistema, si no la lista de config.
        const centralDestino = centralWarrantyDepositName(res);
        const defaultDeposito = isDeposito && userBranchName ? userBranchName : centralDestino;
        // Sucursal por defecto (solo para gestor/admin, donde no está forzada).
        const physicalBranches = (res.branches_operativas ?? []).filter((b) => b.type === 'physical');
        const defaultSucursal = physicalBranches[0]?.name || res.sucursales[0] || '';
        setRows((prev) => prev.map((row) => ({
          ...row,
          // Sucursal física: forzar tipo y sucursal al cargar.
          ...(isSucursalFisica && userBranchName ? {
            tipo_ingreso: 'cliente_sucursal',
            sucursal: userBranchName,
            deposito: centralDestino,
          } : isDepositoOperativo && userBranchName ? {
            tipo_ingreso: 'cliente_deposito',
            sucursal: '',
            deposito: userBranchName,
          } : {
            sucursal: row.sucursal || defaultSucursal,
            deposito: row.deposito || defaultDeposito,
          }),
        })));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración de garantías'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validRows = useMemo(
    () => rows.filter((row) => row.producto.trim() || row.sku?.trim() || row.serie?.trim() || row.falla.trim()),
    [rows],
  );

  const successIds = useMemo(() => uniqueValues(success?.ids || []), [success]);
  const whatsappIdsText = useMemo(() => buildWhatsappText(success?.ids || []), [success]);

  function updateRow(localId: string, patch: Partial<WarrantyLine>) {
    setRows((prev) => prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }

  function updateSharedClientData(patch: Partial<typeof sharedClientData>) {
    setSharedClientData((prev) => ({ ...prev, ...patch }));
  }

  function requiredClientDataFor(row: WarrantyLine) {
    return groupUnderOneId ? sharedClientData : row;
  }

  function addRow() {
    const lastRow = rows[rows.length - 1];
    const depositBranches  = (options?.branches_operativas ?? []).filter((b) => b.type === 'deposit');
    const physicalBranches = (options?.branches_operativas ?? []).filter((b) => b.type === 'physical');
    const defaultDeposito = centralWarrantyDepositName(options);
    const defaultSucursal = physicalBranches[0]?.name || options?.sucursales[0] || '';
    setRows((prev) => [...prev, newLine({
      tipo_ingreso: isSucursalFisica ? 'cliente_sucursal' : (isDepositoOperativo ? 'cliente_deposito' : (lastRow?.tipo_ingreso || '')),
      sucursal: isSucursalFisica ? userBranchName : (isDepositoOperativo ? '' : (lastRow?.sucursal || defaultSucursal)),
      sucursal_responsable: isSucursalFisica ? '' : (lastRow?.sucursal_responsable || ''),
      sucursal_responsable_id: isSucursalFisica ? '' : (lastRow?.sucursal_responsable_id || ''),
      deposito: isSucursalFisica ? defaultDeposito : (isDeposito && userBranchName ? userBranchName : (lastRow?.deposito || defaultDeposito)),
    })]);
  }

  function removeRow(localId: string) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.localId !== localId)));
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setError('No se pudo copiar automáticamente. El ID queda visible para copiarlo manualmente.');
    }
  }

  async function onProductTextChange(row: WarrantyLine, value: string) {
    updateRow(row.localId, { productQuery: value, producto: value, suggestions: [] });
    if (value.trim().length < 2) return;
    updateRow(row.localId, { searching: true });
    try {
      const results = await searchWarrantyProducts(value);
      updateRow(row.localId, { suggestions: results, searching: false });
    } catch {
      updateRow(row.localId, { suggestions: [], searching: false });
    }
  }

  function chooseProduct(row: WarrantyLine, product: WarrantyProduct) {
    updateRow(row.localId, {
      producto: product.producto || product.label,
      productQuery: product.producto || product.label,
      sku: product.sku || '',
      marca: product.marca || '',
      tipo: product.tipo || '',
      proveedor: product.provider_name || row.proveedor || '',
      suggestions: [],
      searching: false,
    });
  }

  function validate(): string | null {
    if (validRows.length === 0) return 'Cargá al menos una garantía.';

    for (let i = 0; i < validRows.length; i += 1) {
      const row = validRows[i];
      const n = i + 1;
      if (!row.tipo_ingreso.trim()) return `Fila ${n}: seleccioná el tipo de ingreso.`;
      if (isDepositoOperativo && row.tipo_ingreso !== 'cliente_deposito')
        return `Fila ${n}: el usuario de depósito solo puede cargar Cliente en depósito.`;
      if (!row.producto.trim()) return `Fila ${n}: falta el producto.`;
      if (!row.falla.trim()) return `Fila ${n}: falta la falla/descripción del problema.`;
      if (!row.fecha_ingreso?.trim()) return `Fila ${n}: falta la fecha de ingreso.`;
      if (isClientIngreso(row.tipo_ingreso)) {
        const clientData = requiredClientDataFor(row);
        const label = groupUnderOneId ? 'Datos del cliente general' : `Fila ${n}`;
        if (!clientData.cliente_nombre?.trim()) return `${label}: falta el nombre del cliente.`;
        if (!clientData.cliente_telefono?.trim()) return `${label}: falta el teléfono del cliente.`;
        if (!clientData.numero_factura?.trim()) return `${label}: falta el N° de factura / ticket.`;
        if (!clientData.fecha_compra?.trim()) return `${label}: falta la fecha de compra.`;
      }
      if (row.tipo_ingreso === 'cliente_sucursal' && !row.sucursal.trim())
        return `Fila ${n}: la sucursal es obligatoria cuando el ingreso es "Cliente en sucursal".`;
      // sucursal_responsable_id requerida para cliente_deposito (gestores/depósito)
      if (!isSucursalFisica && row.tipo_ingreso === 'cliente_deposito') {
        const hasResp = row.sucursal_responsable_id?.trim() || row.sucursal_responsable?.trim();
        if (!hasResp) return `Fila ${n}: indicá la sucursal responsable cuando el cliente viene al depósito.`;
      }
      if (!row.deposito.trim()) return `Fila ${n}: falta el depósito destino.`;
    }

    if (groupUnderOneId && validRows.length > 1) {
      // Para agrupar bajo un ID, todas deben tener el mismo origen de código
      const firstSource = (validRows[0].tipo_ingreso === 'cliente_sucursal'
        ? validRows[0].sucursal : validRows[0].deposito
      ).trim().toUpperCase();
      const allSame = validRows.every((row) => {
        const src = (row.tipo_ingreso === 'cliente_sucursal' ? row.sucursal : row.deposito)
          .trim().toUpperCase();
        return src === firstSource;
      });
      if (!allSame) return 'Para usar un solo ID, todas las filas deben tener el mismo origen (misma sucursal o mismo depósito).';
    }

    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess(null);

    const validation = validate();
    if (validation) {
      setError(validation);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const payload: WarrantyItemPayload[] = validRows.map((row) => ({
      tipo_ingreso: row.tipo_ingreso.trim(),
      producto: row.producto.trim(),
      sku: row.sku?.trim() || undefined,
      marca: row.marca?.trim() || undefined,
      tipo: row.tipo?.trim() || undefined,
      serie: row.serie?.trim() || undefined,
      falla: row.falla.trim(),
      sucursal: row.sucursal.trim(),
      sucursal_responsable: row.sucursal_responsable?.trim() || undefined,
      sucursal_responsable_id: row.sucursal_responsable_id?.trim() || undefined,
      deposito: (row.tipo_ingreso === 'cliente_sucursal' ? centralDepositName : (isDeposito && userBranchName ? userBranchName : row.deposito)).trim(),
      observaciones: row.observaciones?.trim() || undefined,
      proveedor: row.proveedor?.trim() || undefined,
      cliente_nombre: (isClientIngreso(row.tipo_ingreso) ? requiredClientDataFor(row).cliente_nombre : row.cliente_nombre)?.trim() || undefined,
      cliente_telefono: (isClientIngreso(row.tipo_ingreso) ? requiredClientDataFor(row).cliente_telefono : row.cliente_telefono)?.trim() || undefined,
      cliente_email: (isClientIngreso(row.tipo_ingreso) ? requiredClientDataFor(row).cliente_email : row.cliente_email)?.trim() || undefined,
      numero_factura: (isClientIngreso(row.tipo_ingreso) ? requiredClientDataFor(row).numero_factura : row.numero_factura)?.trim() || undefined,
      fecha_compra: (isClientIngreso(row.tipo_ingreso) ? requiredClientDataFor(row).fecha_compra : row.fecha_compra)?.trim() || undefined,
      fecha_ingreso: row.fecha_ingreso?.trim() || undefined,
    }));

    setSaving(true);
    try {
      const res = await createWarrantyEntries(payload, groupUnderOneId);
      setSuccess(res);
      const physicalBranches = (options?.branches_operativas ?? []).filter((b) => b.type === 'physical');
      setRows([newLine({
        tipo_ingreso: isSucursalFisica ? 'cliente_sucursal' : (isDepositoOperativo ? 'cliente_deposito' : (validRows[0]?.tipo_ingreso || '')),
        sucursal: isSucursalFisica ? userBranchName : (isDepositoOperativo ? '' : (physicalBranches[0]?.name || options?.sucursales[0] || '')),
        deposito: isSucursalFisica ? centralDepositName : (isDeposito && userBranchName ? userBranchName : centralDepositName),
      })]);
      setGroupUnderOneId(false);
      setSharedClientData({ cliente_nombre: '', cliente_telefono: '', cliente_email: '', numero_factura: '', fecha_compra: '' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar las garantías');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  // Usuarios de sucursal web: no pueden cargar garantías.
  if (isWebBranch) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-8 text-center shadow-xl">
          <div className="mb-4 text-5xl">🌐</div>
          <h1 className="text-2xl font-black text-amber-100">Sucursal web</h1>
          <p className="mt-3 text-amber-200/80">
            Los usuarios de sucursal web no cargan garantías directamente.
            Las garantías deben ingresarse desde la{' '}
            <strong className="text-amber-100">sucursal física</strong> o el{' '}
            <strong className="text-amber-100">depósito</strong> que recibe el producto.
          </p>
          <p className="mt-4 text-sm text-amber-200/60">
            Si recibís un producto para garantía, coordina con el depósito o sucursal correspondiente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">Carga de garantías</h1>
          <p className="mt-2 text-sm text-slate-400 sm:text-base">
            Registrá garantías con responsable automático, ID interno y seguimiento operativo.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
          Responsable: <span className="font-bold text-white">{username}</span>
          {userSucursal && !canManage && (
            <span className="ml-2 rounded-lg bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-200">
              {userSucursal}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 sm:text-base">
          {error}
        </div>
      )}

      {/* Resultado exitoso */}
      {success && (
        <div className="mb-6 space-y-4 rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-100 shadow-xl sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-lg font-black">Garantías guardadas correctamente</div>
              <div className="mt-1 text-sm text-emerald-200">
                Se registraron {success.count} producto(s) en la base operativa.
              </div>
            </div>
            <div className="rounded-full border border-emerald-400/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-100">
              Listo ✓
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-300/40 bg-slate-950/60 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-base font-black text-white">ID para WhatsApp</div>
                <div className="text-xs text-emerald-200/80">
                  Copiá el ID para identificar las fotos y el seguimiento interno.
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(whatsappIdsText)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-lg active:bg-emerald-600 sm:w-auto"
              >
                Copiar {successIds.length > 1 ? 'todos' : 'ID'} {copiedLabel(copied, whatsappIdsText)}
              </button>
            </div>

            <textarea
              readOnly
              value={whatsappIdsText}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-[92px] w-full resize-none rounded-2xl border border-emerald-400/30 bg-slate-950 px-4 py-3 font-mono text-lg font-black text-emerald-50 outline-none"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {successIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => copyToClipboard(id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 font-mono text-xs font-bold text-emerald-50 active:bg-emerald-500/20 sm:text-sm"
                >
                  {id} {copiedLabel(copied, id)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 text-xs text-emerald-200/90 sm:text-sm">
            {success.items.map((item, index) => (
              <div key={`${item.id_garantia}-${index}`} className="break-words">
                <span className="font-mono font-bold">{item.id_garantia}</span>
                {' · '}{item.producto}{item.sku ? ` · SKU ${item.sku}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-5 pb-24 md:pb-0">
        {/* Opción: agrupar bajo un mismo ID */}
        <div className="rounded-3xl border border-blue-500/40 bg-blue-500/10 p-4 text-sm text-blue-100 shadow-lg sm:p-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={groupUnderOneId}
              onChange={(event) => setGroupUnderOneId(event.target.checked)}
              className="mt-1 h-6 w-6 shrink-0 rounded border-slate-600 bg-slate-900"
            />
            <span>
              <span className="block text-base font-black">
                Todo lo cargado pertenece al mismo caso
              </span>
              <span className="mt-1 block text-blue-100/80">
                Activá esto cuando cargás varios productos del mismo cliente/caso.
                Se generan ítems operativos separados. Ej: <b>GAR-2026-CAS-0001-01</b>, <b>GAR-2026-CAS-0001-02</b>.
              </span>
              <span className="mt-1 block text-blue-100/70">
                Sin activar, cada producto genera un caso independiente con su propio ID correlativo.
              </span>
            </span>
          </label>
        </div>

        {groupUnderOneId && validRows.some((row) => isClientIngreso(row.tipo_ingreso)) && (
          <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100 shadow-lg sm:p-5">
            <div className="mb-3">
              <div className="text-base font-black text-white">Datos del cliente para esta garantía</div>
              <p className="mt-1 text-sm text-amber-100/80">
                Como todo pertenece al mismo caso madre, estos datos se cargan una sola vez y se copian a todos los ítems.
                Cada producto igual queda separado para revisión, remitos, ENV/proveedor y resolución. El mail es opcional.
              </p>
            </div>
            <div className="grid grid-cols-12 gap-4">
              <label className="col-span-12 sm:col-span-6">
                <span className="mb-2 block text-sm font-semibold text-slate-200">Nombre del cliente <span className="text-red-400">*</span></span>
                <input
                  value={sharedClientData.cliente_nombre}
                  onChange={(event) => updateSharedClientData({ cliente_nombre: event.target.value })}
                  placeholder="Apellido y nombre"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </label>
              <label className="col-span-12 sm:col-span-6">
                <span className="mb-2 block text-sm font-semibold text-slate-200">Teléfono <span className="text-red-400">*</span></span>
                <input
                  value={sharedClientData.cliente_telefono}
                  onChange={(event) => updateSharedClientData({ cliente_telefono: event.target.value })}
                  placeholder="Número de contacto"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </label>
              <label className="col-span-12 sm:col-span-6">
                <span className="mb-2 block text-sm font-semibold text-slate-200">Correo electrónico <span className="text-xs font-normal text-slate-400">(opcional)</span></span>
                <input
                  type="email"
                  value={sharedClientData.cliente_email}
                  onChange={(event) => updateSharedClientData({ cliente_email: event.target.value })}
                  placeholder="cliente@email.com"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </label>
              <label className="col-span-12 sm:col-span-3">
                <span className="mb-2 block text-sm font-semibold text-slate-200">N° factura / ticket <span className="text-red-400">*</span></span>
                <input
                  value={sharedClientData.numero_factura}
                  onChange={(event) => updateSharedClientData({ numero_factura: event.target.value })}
                  placeholder="Ej: 0001-00012345"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </label>
              <label className="col-span-12 sm:col-span-3">
                <span className="mb-2 block text-sm font-semibold text-slate-200">Fecha de compra <span className="text-red-400">*</span></span>
                <input
                  type="date"
                  value={sharedClientData.fecha_compra}
                  onChange={(event) => updateSharedClientData({ fecha_compra: event.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </label>
            </div>
          </div>
        )}

        {/* Filas de garantías */}
        {rows.map((row, index) => {
          const isSucursal = row.tipo_ingreso === 'cliente_sucursal';
          const isDepositoTipo = row.tipo_ingreso === 'cliente_deposito';
          // La sucursal queda bloqueada para usuarios de sucursal física.
          const sucursalLocked = isSucursal && isSucursalFisica;
          // Mostrar sucursal_responsable cuando el tipo no es sucursal y hay opciones disponibles o el usuario es gestor.
          // Para usuarios de depósito: siempre que no sea cliente_sucursal.
          // Para gestores: cuando no es cliente_sucursal.
          const showSucursalResponsable = !isSucursalFisica && row.tipo_ingreso !== '' && !isSucursal;
          const sucursalResponsableRequired = isDepositoTipo;

          return (
            <div key={row.localId} className="rounded-3xl border border-slate-700 bg-slate-950/60 p-4 shadow-xl sm:p-5">
              {/* Cabecera de fila */}
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Garantía #{index + 1}</h2>
                  <p className="text-sm text-slate-400">
                    Estado inicial: <span className="text-slate-300">{options?.estado_default || '1 - INGRESO'}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.localId)}
                  disabled={rows.length === 1}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-red-500/30 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={16} /> <span className="hidden sm:inline">Quitar</span>
                </button>
              </div>

              <div className="space-y-4">
                {/* ── TIPO DE INGRESO ───────────────────────────────────────── */}
                {isSucursalFisica ? (
                  /* Usuario de sucursal física: tipo fijo "cliente_sucursal" */
                  <div className="flex items-center gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm">
                    <span className="font-semibold text-blue-200">Tipo de ingreso:</span>
                    <span className="rounded-full border border-blue-400/40 bg-blue-500/20 px-3 py-1 text-xs font-bold text-blue-100">
                      Cliente en sucursal
                    </span>
                  </div>
                ) : isDepositoOperativo ? (
                  /* Usuario operativo de depósito: tipo fijo "cliente_deposito". */
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-emerald-200">Tipo de ingreso:</span>
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-100">
                        Cliente en depósito
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-emerald-100/75">
                      Para personal de depósito este ingreso es automático. Falla al recibir mercadería, stock interno y otros tipos quedan para gestores/administradores.
                    </p>
                  </div>
                ) : (
                  /* Gestor/Admin: todos los tipos */
                  <div>
                    <label className="mb-1 block text-sm font-bold text-white">
                      Tipo de ingreso <span className="text-red-400">*</span>
                    </label>
                    <p className="mb-2 text-xs text-slate-400">
                      ¿Cómo llegó el producto a la garantía?
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {tiposIngreso.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateRow(row.localId, {
                            tipo_ingreso: opt.value,
                            sucursal: opt.value !== 'cliente_sucursal' ? '' : row.sucursal,
                            deposito: opt.value === 'cliente_sucursal' ? centralDepositName : row.deposito,
                            sucursal_responsable: '',
                            sucursal_responsable_id: '',
                          })}
                          className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all ${
                            row.tipo_ingreso === opt.value
                              ? 'border-blue-400 bg-blue-500/20 text-white ring-2 ring-blue-400/40'
                              : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── DEPÓSITO ASIGNADO (usuario de depósito) ────────────────── */}
                {isDeposito && userBranchName && (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-600/40 bg-slate-900/40 px-4 py-3 text-sm">
                    <span className="font-semibold text-slate-300">Depósito de carga:</span>
                    <span className="rounded-full border border-slate-500/40 bg-slate-800 px-3 py-1 text-xs font-bold text-slate-100">
                      {userBranchName}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">(tu depósito asignado)</span>
                  </div>
                )}

                {/* ── SUCURSAL DE ORIGEN (cliente_sucursal) ──────────────────── */}
                {isSucursal && (
                  <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4">
                    <label className="mb-1 block text-sm font-bold text-blue-200">
                      Sucursal de origen <span className="text-red-400">*</span>
                    </label>
                    {sucursalLocked ? (
                      <div className="flex items-center gap-2 rounded-xl border border-blue-400/30 bg-slate-900 px-4 py-3">
                        <span className="font-semibold text-white">{userSucursal}</span>
                        <span className="ml-auto text-xs text-blue-300/70">(tu sucursal)</span>
                      </div>
                    ) : branchesParaSucursal.length > 0 ? (
                      /* Sucursales reales del sistema */
                      <select
                        value={row.sucursal}
                        onChange={(event) => updateRow(row.localId, { sucursal: event.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                      >
                        <option value="">Seleccioná sucursal…</option>
                        {branchesParaSucursal.map((b) => (
                          <option key={b.id} value={b.name}>{b.name}{b.company_name ? ` · ${b.company_name}` : ''}</option>
                        ))}
                      </select>
                    ) : (
                      /* Fallback: lista de config (sin branches configuradas aún) */
                      <select
                        value={row.sucursal}
                        onChange={(event) => updateRow(row.localId, { sucursal: event.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                      >
                        <option value="">Seleccioná sucursal…</option>
                        {(options?.sucursales || []).map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* ── SUCURSAL RESPONSABLE (depósito/gestor con tipo depósito) ── */}
                {showSucursalResponsable && (
                  <div className={`rounded-2xl border p-4 ${
                    sucursalResponsableRequired
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-slate-700/60 bg-slate-900/30'
                  }`}>
                    <label className="mb-1 block text-sm font-bold text-amber-200">
                      Sucursal responsable
                      {sucursalResponsableRequired && <span className="text-red-400"> *</span>}
                      {!sucursalResponsableRequired && <span className="ml-1 text-xs font-normal text-slate-400">(opcional)</span>}
                    </label>
                    <p className="mb-2 text-xs text-slate-400">
                      {isDepositoTipo
                        ? '¿En qué sucursal realizó la compra el cliente?'
                        : '¿Qué sucursal es responsable comercialmente de esta garantía?'}
                    </p>
                    {branchesParaResponsable.length > 0 ? (
                      /* Usar branches reales del sistema (con IDs) */
                      <select
                        value={row.sucursal_responsable_id}
                        onChange={(event) => {
                          const selectedId = event.target.value;
                          const branch = branchesParaResponsable.find((b) => b.id === selectedId);
                          updateRow(row.localId, {
                            sucursal_responsable_id: selectedId,
                            sucursal_responsable: branch?.name || '',
                          });
                        }}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                      >
                        <option value="">{sucursalResponsableRequired ? 'Seleccioná sucursal…' : 'Ninguna / no aplica'}</option>
                        {branchesParaResponsable.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    ) : (
                      /* Fallback: lista de texto de config (sin IDs reales) */
                      <select
                        value={row.sucursal_responsable}
                        onChange={(event) => updateRow(row.localId, {
                          sucursal_responsable: event.target.value,
                          sucursal_responsable_id: '',
                        })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                      >
                        <option value="">{sucursalResponsableRequired ? 'Seleccioná sucursal…' : 'Ninguna / no aplica'}</option>
                        {(options?.sucursales || []).map((suc) => (
                          <option key={suc} value={suc}>{suc}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* ── PRODUCTO + CAMPOS TÉCNICOS ──────────────────────────────── */}
                <div className="grid grid-cols-12 gap-4">
                  {/* Producto con búsqueda */}
                  <label className="relative col-span-12 lg:col-span-6">
                    <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
                      <Search size={15} /> Producto <span className="text-red-400">*</span>
                    </span>
                    <input
                      value={row.productQuery || row.producto}
                      onChange={(event) => onProductTextChange(row, event.target.value)}
                      placeholder="Escribí producto, descripción, SKU o marca"
                      autoComplete="off"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                    {(row.searching || row.suggestions.length > 0) && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
                        {row.searching && (
                          <div className="px-4 py-3 text-sm text-slate-400">Buscando…</div>
                        )}
                        {row.suggestions.map((product) => (
                          <button
                            key={`${product.sku}-${product.producto}`}
                            type="button"
                            onClick={() => chooseProduct(row, product)}
                            className="block w-full border-b border-slate-800 px-4 py-3 text-left active:bg-slate-900 sm:hover:bg-slate-900"
                          >
                            <div className="font-semibold text-slate-100">
                              {product.producto || product.label}
                            </div>
                            <div className="text-xs text-slate-400">
                              SKU: {product.sku || '-'} · {product.marca || 'Sin marca'} · {product.tipo || 'Sin tipo'}
                            </div>
                            {(product.pvp_texto || product.provider_name) && (
                              <div className="mt-1 text-xs text-blue-200">
                                {product.pvp_texto ? `PVP ${product.pvp_texto}` : ''}
                                {product.provider_name ? ` · Proveedor: ${product.provider_name}` : ''}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </label>

                  <label className="col-span-6 sm:col-span-4 lg:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">
                      Fecha ingreso <span className="text-red-400">*</span>
                    </span>
                    <input
                      type="date"
                      value={row.fecha_ingreso || todayInputDate()}
                      onChange={(event) => updateRow(row.localId, { fecha_ingreso: event.target.value })}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                  </label>

                  <label className="col-span-6 sm:col-span-4 lg:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">SKU</span>
                    <input
                      value={row.sku || ''}
                      onChange={(event) => updateRow(row.localId, { sku: event.target.value })}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                  </label>

                  <label className="col-span-6 sm:col-span-4 lg:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">N° Serie</span>
                    <input
                      value={row.serie || ''}
                      onChange={(event) => updateRow(row.localId, { serie: event.target.value })}
                      placeholder="N° de serie"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                  </label>

                  {/* Depósito destino/carga */}
                  <label className="col-span-12 sm:col-span-4 lg:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">
                      {row.tipo_ingreso === 'cliente_sucursal' ? 'Destino obligatorio' : (isDepositoOperativo ? 'Depósito asignado' : 'Depósito de ingreso')} <span className="text-red-400">*</span>
                    </span>
                    {row.tipo_ingreso === 'cliente_sucursal' ? (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-base font-semibold text-emerald-100">
                        {centralDepositName}
                        <div className="mt-1 text-xs font-normal text-emerald-200/80">Todo ingreso desde sucursal va a Chiclana.</div>
                      </div>
                    ) : isDeposito && userBranchName ? (
                      <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base font-semibold text-white">
                        {userBranchName}
                      </div>
                    ) : branchesParaDeposito.length > 0 ? (
                      /* Depósitos reales del sistema */
                      <select
                        value={row.deposito}
                        onChange={(event) => updateRow(row.localId, { deposito: event.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                      >
                        <option value="">Seleccioná…</option>
                        {branchesParaDeposito.map((b) => (
                          <option key={b.id} value={b.name}>{b.name}{b.company_name ? ` · ${b.company_name}` : ''}</option>
                        ))}
                      </select>
                    ) : (
                      /* Fallback: lista de config */
                      <select
                        value={row.deposito}
                        onChange={(event) => updateRow(row.localId, { deposito: event.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                      >
                        <option value="">Seleccioná…</option>
                        {(options?.depositos || []).map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    )}
                  </label>

                  {/* Falla */}
                  <label className="col-span-12 lg:col-span-6">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">
                      Falla / problema <span className="text-red-400">*</span>
                    </span>
                    <textarea
                      value={row.falla}
                      onChange={(event) => updateRow(row.localId, { falla: event.target.value })}
                      placeholder="Ej: no enciende, hace ruido, pantalla rota…"
                      rows={3}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                  </label>

                  {/* Observaciones */}
                  <label className="col-span-12 lg:col-span-6">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">Observaciones</span>
                    <textarea
                      value={row.observaciones || ''}
                      onChange={(event) => updateRow(row.localId, { observaciones: event.target.value })}
                      placeholder="Opcional — accesorios entregados, condición del equipo, etc."
                      rows={3}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                  </label>

                  {/* Proveedor sugerido */}
                  <label className="col-span-12 sm:col-span-6">
                    <span className="mb-2 block text-sm font-semibold text-slate-300">
                      Proveedor / fabricante
                    </span>
                    <input
                      value={row.proveedor || ''}
                      onChange={(event) => updateRow(row.localId, { proveedor: event.target.value })}
                      placeholder="Se autocompleta al elegir producto (editable)"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                    />
                  </label>
                </div>

                {/* ── DATOS DEL CLIENTE ───────────────────────────────────── */}
                {isClientIngreso(row.tipo_ingreso) && groupUnderOneId ? (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
                    Los datos del cliente se cargan una sola vez arriba porque activaste “Todo lo cargado pertenece al mismo caso”.
                  </div>
                ) : (
                  <div className={`rounded-2xl border ${isClientIngreso(row.tipo_ingreso) ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700/60 bg-slate-900/40'}`}>
                    <button
                      type="button"
                      onClick={() => updateRow(row.localId, { showClientData: !row.showClientData })}
                      className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-300 hover:text-white"
                    >
                      <span className="flex items-center gap-2">
                        <User size={15} />
                        Datos del cliente
                        {isClientIngreso(row.tipo_ingreso) ? (
                          <span className="text-xs font-bold text-amber-200">(obligatorio)</span>
                        ) : (
                          <span className="text-xs font-normal text-slate-500">(opcional)</span>
                        )}
                      </span>
                      {(row.showClientData || isClientIngreso(row.tipo_ingreso)) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {(row.showClientData || isClientIngreso(row.tipo_ingreso)) && (
                      <div className="grid grid-cols-12 gap-4 border-t border-slate-700/60 p-4">
                        <label className="col-span-12 sm:col-span-6">
                          <span className="mb-2 block text-sm font-semibold text-slate-300">Nombre del cliente {isClientIngreso(row.tipo_ingreso) && <span className="text-red-400">*</span>}</span>
                          <input
                            value={row.cliente_nombre || ''}
                            onChange={(event) => updateRow(row.localId, { cliente_nombre: event.target.value })}
                            placeholder="Apellido y nombre"
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                          />
                        </label>

                        <label className="col-span-12 sm:col-span-6">
                          <span className="mb-2 block text-sm font-semibold text-slate-300">Teléfono {isClientIngreso(row.tipo_ingreso) && <span className="text-red-400">*</span>}</span>
                          <input
                            value={row.cliente_telefono || ''}
                            onChange={(event) => updateRow(row.localId, { cliente_telefono: event.target.value })}
                            placeholder="Número de contacto"
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                          />
                        </label>

                        <label className="col-span-12 sm:col-span-6">
                          <span className="mb-2 block text-sm font-semibold text-slate-300">Correo electrónico <span className="text-xs font-normal text-slate-500">(opcional)</span></span>
                          <input
                            type="email"
                            value={row.cliente_email || ''}
                            onChange={(event) => updateRow(row.localId, { cliente_email: event.target.value })}
                            placeholder="cliente@email.com"
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                          />
                        </label>

                        <label className="col-span-12 sm:col-span-3">
                          <span className="mb-2 block text-sm font-semibold text-slate-300">N° factura / ticket {isClientIngreso(row.tipo_ingreso) && <span className="text-red-400">*</span>}</span>
                          <input
                            value={row.numero_factura || ''}
                            onChange={(event) => updateRow(row.localId, { numero_factura: event.target.value })}
                            placeholder="Ej: 0001-00012345"
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                          />
                        </label>

                        <label className="col-span-12 sm:col-span-3">
                          <span className="mb-2 block text-sm font-semibold text-slate-300">Fecha de compra {isClientIngreso(row.tipo_ingreso) && <span className="text-red-400">*</span>}</span>
                          <input
                            type="date"
                            value={row.fecha_compra || ''}
                            onChange={(event) => updateRow(row.localId, { fecha_compra: event.target.value })}
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Botones — desktop */}
        <div className="hidden flex-wrap gap-3 md:flex">
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-3 font-bold text-slate-100 hover:bg-slate-900"
          >
            <Plus size={18} /> Agregar otra garantía
          </button>
          <button
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-bold text-white shadow-lg hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={18} /> {saving ? 'Guardando…' : `Guardar ${validRows.length || 1} garantía(s)`}
          </button>
        </div>

        {/* Botones — mobile fijo al fondo */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 p-3 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-7xl gap-2">
            <button
              type="button"
              onClick={addRow}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-600 px-3 py-3 text-sm font-bold text-slate-100 active:bg-slate-900"
            >
              <Plus size={18} /> Agregar
            </button>
            <button
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-3 text-sm font-bold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={18} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
