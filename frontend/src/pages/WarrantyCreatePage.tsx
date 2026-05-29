import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Package,
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
import { canCrossSelectBranches } from '../branchAccess';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpField,
  ErpInput,
  ErpNotice,
  ErpPageHeader,
  ErpSelect,
  ErpTextarea,
  ErpTag,
} from '../components/ProUI';
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
  const canManage   = can('warranties.manage') || can('warranties.manage_provider');
  // El usuario puede elegir CUALQUIER sucursal en los selects si:
  //   - tiene permisos de gestión global (canManage), o
  //   - tiene el permiso explícito branches.cross_select.
  // En cualquier otro caso, queda limitado a su sucursal asignada.
  const canChooseAnyBranch = canManage || canCrossSelectBranches(currentUser);

  // El alcance principal es default operativo, no una cárcel.
  // - Gestores/Admin/Superadmin (canChooseAnyBranch) usan la unidad principal como
  //   sugerencia, pero pueden cargar desde cualquier sucursal/depósito permitido.
  // - Personal de depósito (branch_type=deposit) sin permisos de elección usa su
  //   depósito asignado aunque la branch principal haya quedado en otra unidad.
  // - Vendedores usan su sucursal principal.
  const branchType  = currentUser?.branch_type || primaryAssignedBranch?.type || depositAssignedBranch?.type || '';
  const branchTypeKey = normalizeKey(branchType);
  const isDepositBranchType = branchTypeKey === 'deposit' || branchTypeKey === 'deposito';
  const operationalDepositFallback = !canChooseAnyBranch && isDepositBranchType ? depositAssignedBranch : null;
  const effectiveBranch = canChooseAnyBranch
    ? (primaryAssignedBranch || depositAssignedBranch)
    : (operationalDepositFallback || primaryAssignedBranch || depositAssignedBranch);
  const userBranchNameRaw = currentUser?.branch_name || currentUser?.sucursal || effectiveBranch?.name || '';
  const userBranchNameKey = normalizeKey(userBranchNameRaw);

  // WEB: no puede cargar garantías.
  const isWebBranch = branchTypeKey === 'web';

  // Sucursal física: branch_type = "physical" sin posibilidad de cambiar.
  // Fallback legacy: sin branch_type pero sin canChooseAnyBranch → asumimos sucursal,
  // salvo que el nombre apunte claramente a un depósito.
  const looksLikeDepositUser = isDepositBranchType || userBranchNameKey.startsWith('deposito');
  const isSucursalFisica = ((branchTypeKey === 'physical' || branchTypeKey === 'sucursal' || branchTypeKey === 'sucursal fisica') && !canChooseAnyBranch)
    || (!branchTypeKey && !canChooseAnyBranch && Boolean(currentUser?.branch_name || currentUser?.sucursal) && !looksLikeDepositUser);
  // Depósito: branch_type = "deposit" o branch_name = "depósito ..."
  const isDeposito = looksLikeDepositUser;
  // Depósito operativo: personal de depósito sin permisos de elegir otra sucursal.
  // Estos usuarios solo cargan "Cliente en depósito"; las otras opciones quedan para
  // gestores/admin o usuarios con branches.cross_select.
  const isDepositoOperativo = isDeposito && !canChooseAnyBranch;

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
      <div className="erp-stack-6">
        <ErpPageHeader title="Carga de garantías" />
        <ErpNotice tone="warning" title="Sucursal web — sin carga directa de garantías">
          Los usuarios de sucursal web no cargan garantías directamente. Las garantías deben ingresarse desde la{' '}
          <strong>sucursal física</strong> o el <strong>depósito</strong> que recibe el producto. Si recibís un
          producto para garantía, coordiná con el depósito o sucursal correspondiente.
        </ErpNotice>
      </div>
    );
  }

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Carga de garantías"
        description="Registrá garantías con responsable automático, ID interno y seguimiento operativo."
        actions={
          <ErpTag>
            Responsable: <strong style={{ color: 'var(--text)' }}>{username}</strong>
            {userSucursal && !canManage ? ` · ${userSucursal}` : ''}
          </ErpTag>
        }
      />

      {error && <ErpNotice tone="error" title="Revisá los datos">{error}</ErpNotice>}

      {/* Resultado exitoso */}
      {success && (
        <ErpNotice tone="success" title="Garantías guardadas correctamente">
          <div className="erp-stack-3">
            <div>Se registraron {success.count} producto(s) en la base operativa.</div>

            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-[color:var(--text)]">ID para WhatsApp</div>
                  <div className="text-[11.5px] text-[color:var(--text-2)]">Copiá el ID para identificar fotos y seguimiento interno.</div>
                </div>
                <ErpButton variant="primary" size="sm" onClick={() => copyToClipboard(whatsappIdsText)} leftIcon={copiedLabel(copied, whatsappIdsText)}>
                  Copiar {successIds.length > 1 ? 'todos' : 'ID'}
                </ErpButton>
              </div>
              <textarea
                readOnly
                value={whatsappIdsText}
                onFocus={(event) => event.currentTarget.select()}
                className="erp-input font-mono"
                style={{ minHeight: 80, fontWeight: 700 }}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {successIds.map((id) => (
                  <button key={id} type="button" onClick={() => copyToClipboard(id)} className="erp-tag font-mono" style={{ cursor: 'pointer' }}>
                    {id} {copiedLabel(copied, id)}
                  </button>
                ))}
              </div>
            </div>

            <div className="erp-stack-2 text-[12.5px] text-[color:var(--text-2)]">
              {success.items.map((item, index) => (
                <div key={`${item.id_garantia}-${index}`} className="break-words">
                  <span className="font-mono font-semibold text-[color:var(--text)]">{item.id_garantia}</span>
                  {' · '}{item.producto}{item.sku ? ` · SKU ${item.sku}` : ''}
                </div>
              ))}
            </div>
          </div>
        </ErpNotice>
      )}

      <form onSubmit={submit} className="erp-stack-4">
        {/* Opción: agrupar bajo un mismo ID */}
        <ErpCard>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={groupUnderOneId}
              onChange={(event) => setGroupUnderOneId(event.target.checked)}
              className="erp-checkbox mt-0.5"
              style={{ width: 18, height: 18 }}
            />
            <span>
              <span className="block text-[13.5px] font-semibold text-[color:var(--text)]">
                Todo lo cargado pertenece al mismo caso
              </span>
              <span className="mt-1 block text-[12px] text-[color:var(--text-2)] leading-[1.5]">
                Activá esto cuando cargás varios productos del mismo cliente/caso. Se generan ítems operativos separados:
                <span className="font-mono"> GAR-2026-CAS-0001-01</span>, <span className="font-mono">…-02</span>. Sin activar, cada producto genera un caso independiente.
              </span>
            </span>
          </label>
        </ErpCard>

        {/* Datos compartidos del cliente (modo agrupado) */}
        {groupUnderOneId && validRows.some((row) => isClientIngreso(row.tipo_ingreso)) && (
          <ErpCard title="Datos del cliente para esta garantía" subtitle="Se cargan una sola vez y se copian a todos los ítems del caso. El mail es opcional.">
            <div className="erp-form-grid erp-form-grid-2">
              <ErpField label="Nombre del cliente" required>
                <ErpInput value={sharedClientData.cliente_nombre} onChange={(e) => updateSharedClientData({ cliente_nombre: e.target.value })} placeholder="Apellido y nombre" />
              </ErpField>
              <ErpField label="Teléfono" required>
                <ErpInput value={sharedClientData.cliente_telefono} onChange={(e) => updateSharedClientData({ cliente_telefono: e.target.value })} placeholder="Número de contacto" />
              </ErpField>
              <ErpField label="Correo electrónico" hint="Opcional" wide>
                <ErpInput type="email" value={sharedClientData.cliente_email} onChange={(e) => updateSharedClientData({ cliente_email: e.target.value })} placeholder="cliente@email.com" />
              </ErpField>
              <ErpField label="N° factura / ticket" required>
                <ErpInput value={sharedClientData.numero_factura} onChange={(e) => updateSharedClientData({ numero_factura: e.target.value })} placeholder="Ej: 0001-00012345" />
              </ErpField>
              <ErpField label="Fecha de compra" required>
                <ErpInput type="date" value={sharedClientData.fecha_compra} onChange={(e) => updateSharedClientData({ fecha_compra: e.target.value })} />
              </ErpField>
            </div>
          </ErpCard>
        )}

        {/* Filas de garantías */}
        {rows.map((row, index) => {
          const isSucursal = row.tipo_ingreso === 'cliente_sucursal';
          const isDepositoTipo = row.tipo_ingreso === 'cliente_deposito';
          const sucursalLocked = isSucursal && isSucursalFisica;
          const showSucursalResponsable = !isSucursalFisica && row.tipo_ingreso !== '' && !isSucursal;
          const sucursalResponsableRequired = isDepositoTipo;

          return (
            <ErpCard
              key={row.localId}
              title={<span className="inline-flex items-center gap-2"><Package size={14} /> Garantía #{index + 1}</span>}
              subtitle={<>Estado inicial: <span className="text-[color:var(--text)]">{options?.estado_default || '1 - INGRESO'}</span></>}
              actions={
                <ErpButton variant="danger" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => removeRow(row.localId)} disabled={rows.length === 1}>
                  Quitar
                </ErpButton>
              }
            >
              <div className="erp-stack-4">
                {/* ── TIPO DE INGRESO ───────────────────────────────────────── */}
                {isSucursalFisica ? (
                  <ErpNotice tone="info">
                    <span className="inline-flex items-center gap-2">Tipo de ingreso: <ErpBadge tone="info">Cliente en sucursal</ErpBadge></span>
                  </ErpNotice>
                ) : isDepositoOperativo ? (
                  <ErpNotice tone="success" title={<span className="inline-flex items-center gap-2">Tipo de ingreso: <ErpBadge tone="success">Cliente en depósito</ErpBadge></span>}>
                    Para personal de depósito este ingreso es automático. Falla al recibir mercadería, stock interno y otros tipos quedan para gestores/administradores.
                  </ErpNotice>
                ) : (
                  <ErpField label="Tipo de ingreso" required hint="¿Cómo llegó el producto a la garantía?">
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
                          className={`erp-btn ${row.tipo_ingreso === opt.value ? 'erp-btn-primary' : 'erp-btn-secondary'}`}
                          style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px' }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </ErpField>
                )}

                {/* ── DEPÓSITO ASIGNADO (usuario de depósito) ────────────────── */}
                {isDeposito && userBranchName && (
                  <div className="erp-info-row" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="erp-info-label">Depósito de carga (asignado)</span>
                    <ErpBadge tone="neutral" withDot={false}>{userBranchName}</ErpBadge>
                  </div>
                )}

                {/* ── SUCURSAL DE ORIGEN (cliente_sucursal) ──────────────────── */}
                {isSucursal && (
                  <ErpField label="Sucursal de origen" required>
                    {sucursalLocked ? (
                      <div className="erp-info-row" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: 'var(--primary)', background: 'var(--primary-soft)' }}>
                        <span className="erp-info-value">{userSucursal}</span>
                        <span className="text-[11px] text-[color:var(--text-3)]">(tu sucursal)</span>
                      </div>
                    ) : branchesParaSucursal.length > 0 ? (
                      <ErpSelect value={row.sucursal} onChange={(e) => updateRow(row.localId, { sucursal: e.target.value })}>
                        <option value="">Seleccioná sucursal…</option>
                        {branchesParaSucursal.map((b) => (
                          <option key={b.id} value={b.name}>{b.name}{b.company_name ? ` · ${b.company_name}` : ''}</option>
                        ))}
                      </ErpSelect>
                    ) : (
                      <ErpSelect value={row.sucursal} onChange={(e) => updateRow(row.localId, { sucursal: e.target.value })}>
                        <option value="">Seleccioná sucursal…</option>
                        {(options?.sucursales || []).map((item) => <option key={item} value={item}>{item}</option>)}
                      </ErpSelect>
                    )}
                  </ErpField>
                )}

                {/* ── SUCURSAL RESPONSABLE ──────────────────────────────────── */}
                {showSucursalResponsable && (
                  <ErpField
                    label="Sucursal responsable"
                    required={sucursalResponsableRequired}
                    hint={isDepositoTipo ? '¿En qué sucursal compró el cliente?' : '¿Qué sucursal es responsable comercialmente? (opcional)'}
                  >
                    {branchesParaResponsable.length > 0 ? (
                      <ErpSelect
                        value={row.sucursal_responsable_id}
                        onChange={(e) => {
                          const selectedId = e.target.value;
                          const branch = branchesParaResponsable.find((b) => b.id === selectedId);
                          updateRow(row.localId, { sucursal_responsable_id: selectedId, sucursal_responsable: branch?.name || '' });
                        }}
                      >
                        <option value="">{sucursalResponsableRequired ? 'Seleccioná sucursal…' : 'Ninguna / no aplica'}</option>
                        {branchesParaResponsable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </ErpSelect>
                    ) : (
                      <ErpSelect
                        value={row.sucursal_responsable}
                        onChange={(e) => updateRow(row.localId, { sucursal_responsable: e.target.value, sucursal_responsable_id: '' })}
                      >
                        <option value="">{sucursalResponsableRequired ? 'Seleccioná sucursal…' : 'Ninguna / no aplica'}</option>
                        {(options?.sucursales || []).map((suc) => <option key={suc} value={suc}>{suc}</option>)}
                      </ErpSelect>
                    )}
                  </ErpField>
                )}

                {/* ── PRODUCTO + CAMPOS TÉCNICOS ──────────────────────────────── */}
                <div className="erp-form-grid erp-form-grid-3">
                  {/* Producto con búsqueda */}
                  <div className="erp-field erp-field-wide" style={{ position: 'relative' }}>
                    <label className="erp-field-label">
                      <span className="inline-flex items-center gap-1.5"><Search size={13} /> Producto <span className="erp-field-required">*</span></span>
                    </label>
                    <ErpInput
                      value={row.productQuery || row.producto}
                      onChange={(e) => onProductTextChange(row, e.target.value)}
                      placeholder="Escribí producto, descripción, SKU o marca"
                      autoComplete="off"
                    />
                    {(row.searching || row.suggestions.length > 0) && (
                      <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-elevated)] shadow-[var(--sh-pop)]" style={{ top: '100%' }}>
                        {row.searching && <div className="px-3 py-2 text-[12.5px] text-[color:var(--text-2)]">Buscando…</div>}
                        {row.suggestions.map((product) => (
                          <button
                            key={`${product.sku}-${product.producto}`}
                            type="button"
                            onClick={() => chooseProduct(row, product)}
                            className="block w-full border-b border-[color:var(--divider)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[color:var(--surface-hover)]"
                          >
                            <div className="text-[13px] font-medium text-[color:var(--text)]">{product.producto || product.label}</div>
                            <div className="text-[11px] text-[color:var(--text-3)]">SKU: {product.sku || '-'} · {product.marca || 'Sin marca'} · {product.tipo || 'Sin tipo'}</div>
                            {(product.pvp_texto || product.provider_name) && (
                              <div className="mt-0.5 text-[11px] text-[color:var(--info-soft-text)]">
                                {product.pvp_texto ? `PVP ${product.pvp_texto}` : ''}{product.provider_name ? ` · Prov: ${product.provider_name}` : ''}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <ErpField label="Fecha ingreso" required>
                    <ErpInput type="date" value={row.fecha_ingreso || todayInputDate()} onChange={(e) => updateRow(row.localId, { fecha_ingreso: e.target.value })} />
                  </ErpField>
                  <ErpField label="SKU">
                    <ErpInput value={row.sku || ''} onChange={(e) => updateRow(row.localId, { sku: e.target.value })} />
                  </ErpField>
                  <ErpField label="N° Serie">
                    <ErpInput value={row.serie || ''} onChange={(e) => updateRow(row.localId, { serie: e.target.value })} placeholder="N° de serie" />
                  </ErpField>

                  {/* Depósito destino/carga */}
                  <ErpField label={`${row.tipo_ingreso === 'cliente_sucursal' ? 'Destino obligatorio' : (isDepositoOperativo ? 'Depósito asignado' : 'Depósito de ingreso')}`} required>
                    {row.tipo_ingreso === 'cliente_sucursal' ? (
                      <div className="erp-info-row" style={{ borderColor: 'rgba(34,197,94,0.32)', background: 'var(--success-soft)' }}>
                        <span className="erp-info-value">{centralDepositName}</span>
                        <span className="text-[10.5px] text-[color:var(--text-3)]">Todo ingreso desde sucursal va a Chiclana.</span>
                      </div>
                    ) : isDeposito && userBranchName ? (
                      <div className="erp-info-row"><span className="erp-info-value">{userBranchName}</span></div>
                    ) : branchesParaDeposito.length > 0 ? (
                      <ErpSelect value={row.deposito} onChange={(e) => updateRow(row.localId, { deposito: e.target.value })}>
                        <option value="">Seleccioná…</option>
                        {branchesParaDeposito.map((b) => <option key={b.id} value={b.name}>{b.name}{b.company_name ? ` · ${b.company_name}` : ''}</option>)}
                      </ErpSelect>
                    ) : (
                      <ErpSelect value={row.deposito} onChange={(e) => updateRow(row.localId, { deposito: e.target.value })}>
                        <option value="">Seleccioná…</option>
                        {(options?.depositos || []).map((item) => <option key={item} value={item}>{item}</option>)}
                      </ErpSelect>
                    )}
                  </ErpField>

                  {/* Proveedor */}
                  <ErpField label="Proveedor / fabricante" hint="Se autocompleta al elegir producto (editable)">
                    <ErpInput value={row.proveedor || ''} onChange={(e) => updateRow(row.localId, { proveedor: e.target.value })} placeholder="Proveedor" />
                  </ErpField>

                  {/* Falla */}
                  <ErpField label="Falla / problema" required wide>
                    <ErpTextarea value={row.falla} onChange={(e) => updateRow(row.localId, { falla: e.target.value })} placeholder="Ej: no enciende, hace ruido, pantalla rota…" rows={3} />
                  </ErpField>

                  {/* Observaciones */}
                  <ErpField label="Observaciones" wide>
                    <ErpTextarea value={row.observaciones || ''} onChange={(e) => updateRow(row.localId, { observaciones: e.target.value })} placeholder="Opcional — accesorios entregados, condición del equipo, etc." rows={3} />
                  </ErpField>
                </div>

                {/* ── DATOS DEL CLIENTE ───────────────────────────────────── */}
                {isClientIngreso(row.tipo_ingreso) && groupUnderOneId ? (
                  <ErpNotice tone="warning">
                    Los datos del cliente se cargan una sola vez arriba porque activaste "Todo lo cargado pertenece al mismo caso".
                  </ErpNotice>
                ) : (
                  <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)]">
                    <button
                      type="button"
                      onClick={() => updateRow(row.localId, { showClientData: !row.showClientData })}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-[13px] font-semibold text-[color:var(--text-2)]"
                    >
                      <span className="flex items-center gap-2">
                        <User size={14} /> Datos del cliente
                        {isClientIngreso(row.tipo_ingreso)
                          ? <ErpBadge tone="warning" withDot={false}>obligatorio</ErpBadge>
                          : <span className="text-[11px] font-normal text-[color:var(--text-3)]">(opcional)</span>}
                      </span>
                      {(row.showClientData || isClientIngreso(row.tipo_ingreso)) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {(row.showClientData || isClientIngreso(row.tipo_ingreso)) && (
                      <div className="erp-form-grid erp-form-grid-2 border-t border-[color:var(--divider)] p-3">
                        <ErpField label={<>Nombre del cliente {isClientIngreso(row.tipo_ingreso) && <span className="erp-field-required">*</span>}</>}>
                          <ErpInput value={row.cliente_nombre || ''} onChange={(e) => updateRow(row.localId, { cliente_nombre: e.target.value })} placeholder="Apellido y nombre" />
                        </ErpField>
                        <ErpField label={<>Teléfono {isClientIngreso(row.tipo_ingreso) && <span className="erp-field-required">*</span>}</>}>
                          <ErpInput value={row.cliente_telefono || ''} onChange={(e) => updateRow(row.localId, { cliente_telefono: e.target.value })} placeholder="Número de contacto" />
                        </ErpField>
                        <ErpField label="Correo electrónico" hint="Opcional" wide>
                          <ErpInput type="email" value={row.cliente_email || ''} onChange={(e) => updateRow(row.localId, { cliente_email: e.target.value })} placeholder="cliente@email.com" />
                        </ErpField>
                        <ErpField label={<>N° factura / ticket {isClientIngreso(row.tipo_ingreso) && <span className="erp-field-required">*</span>}</>}>
                          <ErpInput value={row.numero_factura || ''} onChange={(e) => updateRow(row.localId, { numero_factura: e.target.value })} placeholder="Ej: 0001-00012345" />
                        </ErpField>
                        <ErpField label={<>Fecha de compra {isClientIngreso(row.tipo_ingreso) && <span className="erp-field-required">*</span>}</>}>
                          <ErpInput type="date" value={row.fecha_compra || ''} onChange={(e) => updateRow(row.localId, { fecha_compra: e.target.value })} />
                        </ErpField>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ErpCard>
          );
        })}

        {/* Botones — desktop */}
        <div className="hidden flex-wrap gap-2 md:flex">
          <ErpButton type="button" variant="secondary" leftIcon={<Plus size={14} />} onClick={addRow}>
            Agregar otra garantía
          </ErpButton>
          <ErpButton type="submit" variant="primary" loading={saving} leftIcon={<Save size={14} />}>
            {saving ? 'Guardando…' : `Guardar ${validRows.length || 1} garantía(s)`}
          </ErpButton>
        </div>

        {/* Botones — mobile fijo al fondo (oculta el bottom nav vía :has()) */}
        <div data-mobile-form-footer className="erp-mobile-form-footer fixed inset-x-0 bottom-0 z-[46] border-t border-[color:var(--border)] bg-[color:var(--surface)] p-3 md:hidden">
          <div className="flex gap-2">
            <ErpButton type="button" variant="secondary" fullWidth leftIcon={<Plus size={16} />} onClick={addRow}>
              Agregar
            </ErpButton>
            <ErpButton type="submit" variant="primary" fullWidth loading={saving} leftIcon={<Save size={16} />}>
              {saving ? 'Guardando…' : 'Guardar'}
            </ErpButton>
          </div>
        </div>
      </form>
    </div>
  );
}
