import { Building2, Plus, RefreshCw, Save, Store, ToggleLeft, ToggleRight } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { can, createBranch, createCompany, fetchOperationalStructure, updateBranch, updateCompany } from '../api/client';
import type { BranchInfo, BranchType, CompanyInfo } from '../types';

type MessageState = { type: 'ok' | 'error'; text: string } | null;

const branchTypeLabels: Record<BranchType, string> = {
  physical: 'Física',
  web: 'WEB',
  deposit: 'Depósito',
  admin: 'Administración',
};

const branchTypeHelp: Record<BranchType, string> = {
  physical: 'Sucursal de atención/venta presencial.',
  web: 'Unidad operativa web. Puede depender de una sucursal física.',
  deposit: 'Depósito o unidad logística.',
  admin: 'Área administrativa sin atención comercial directa.',
};

function emptyCompanyForm() {
  return { name: '', legal_name: '', cuit: '', is_active: true };
}

function emptyBranchForm(companies: CompanyInfo[]) {
  return { company_id: companies[0]?.id || '', name: '', code: '', type: 'physical' as BranchType, parent_branch_id: '', is_active: true };
}

export function CompaniesBranchesPage() {
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm());
  const [branchForm, setBranchForm] = useState(emptyBranchForm([]));
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const canManageCompanies = can('companies.manage');
  const canManageBranches = can('branches.manage');

  async function load() {
    setLoading(true);
    try {
      const data = await fetchOperationalStructure();
      setCompanies(data.companies);
      setBranches(data.branches);
      setBranchForm((current) => ({ ...current, company_id: current.company_id || data.companies[0]?.id || '' }));
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cargar la estructura operativa.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const activePhysicalBranches = useMemo(() => branches.filter((branch) => branch.type === 'physical' && branch.is_active), [branches]);
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const stats = useMemo(() => {
    const activeCompanies = companies.filter((company) => company.is_active).length;
    const activeBranches = branches.filter((branch) => branch.is_active).length;
    const webBranches = branches.filter((branch) => branch.type === 'web').length;
    const physicalBranches = branches.filter((branch) => branch.type === 'physical').length;
    const depositBranches = branches.filter((branch) => branch.type === 'deposit').length;
    return { activeCompanies, activeBranches, webBranches, physicalBranches, depositBranches };
  }, [companies, branches]);

  function editCompany(company: CompanyInfo) {
    setEditingCompanyId(company.id);
    setCompanyForm({ name: company.name, legal_name: company.legal_name || '', cuit: company.cuit || '', is_active: company.is_active });
    setMessage(null);
  }

  function resetCompanyForm() {
    setEditingCompanyId(null);
    setCompanyForm(emptyCompanyForm());
  }

  async function saveCompany(event: FormEvent) {
    event.preventDefault();
    if (!canManageCompanies) return;
    setSaving(true);
    try {
      if (editingCompanyId) {
        await updateCompany(editingCompanyId, companyForm);
        setMessage({ type: 'ok', text: 'Empresa actualizada.' });
      } else {
        await createCompany(companyForm);
        setMessage({ type: 'ok', text: 'Empresa creada.' });
      }
      resetCompanyForm();
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo guardar la empresa.' });
    } finally {
      setSaving(false);
    }
  }

  function editBranch(branch: BranchInfo) {
    setEditingBranchId(branch.id);
    setBranchForm({
      company_id: branch.company_id,
      name: branch.name,
      code: branch.code,
      type: branch.type,
      parent_branch_id: branch.parent_branch_id || '',
      is_active: branch.is_active,
    });
    setMessage(null);
  }

  function resetBranchForm() {
    setEditingBranchId(null);
    setBranchForm(emptyBranchForm(companies));
  }

  async function saveBranch(event: FormEvent) {
    event.preventDefault();
    if (!canManageBranches) return;
    setSaving(true);
    try {
      const payload = { ...branchForm, parent_branch_id: branchForm.parent_branch_id || null };
      if (editingBranchId) {
        await updateBranch(editingBranchId, payload);
        setMessage({ type: 'ok', text: 'Sucursal operativa actualizada.' });
      } else {
        await createBranch(payload);
        setMessage({ type: 'ok', text: 'Sucursal operativa creada.' });
      }
      resetBranchForm();
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo guardar la sucursal.' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompany(company: CompanyInfo) {
    if (!canManageCompanies) return;
    setSaving(true);
    try {
      await updateCompany(company.id, { is_active: !company.is_active });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cambiar el estado de la empresa.' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleBranch(branch: BranchInfo) {
    if (!canManageBranches) return;
    setSaving(true);
    try {
      await updateBranch(branch.id, { is_active: !branch.is_active });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cambiar el estado de la sucursal.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-950/75 p-6 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-blue-200">
              Fase 2 · Estructura operativa
            </div>
            <h1 className="mt-4 text-3xl font-black text-white">Empresas y sucursales</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Base para manejar Electro GV, Electro ABC SRL y las unidades operativas como Caseros - WEB o Canning - WEB. Todavía no migra usuarios ni ventas: prepara la estructura sin romper lo actual.
            </p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900 disabled:opacity-60">
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Empresas activas" value={stats.activeCompanies} />
          <StatCard label="Unidades activas" value={stats.activeBranches} />
          <StatCard label="Físicas" value={stats.physicalBranches} />
          <StatCard label="Depósitos" value={stats.depositBranches} />
          <StatCard label="WEB" value={stats.webBranches} />
        </div>

        {message && <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-bold ${message.type === 'ok' ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>{message.text}</div>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-950/75 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-500/15 p-3 text-blue-200"><Building2 size={22} /></div>
            <div>
              <h2 className="text-xl font-black text-white">Empresas</h2>
              <p className="text-sm text-slate-400">Razón social o unidad legal.</p>
            </div>
          </div>

          {canManageCompanies && (
            <form onSubmit={(event) => void saveCompany(event)} className="mt-5 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Nombre" value={companyForm.name} onChange={(value) => setCompanyForm((current) => ({ ...current, name: value }))} required />
                <Input label="Razón social" value={companyForm.legal_name} onChange={(value) => setCompanyForm((current) => ({ ...current, legal_name: value }))} />
                <Input label="CUIT" value={companyForm.cuit} onChange={(value) => setCompanyForm((current) => ({ ...current, cuit: value }))} />
                <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold text-slate-200">
                  <input type="checkbox" checked={companyForm.is_active} onChange={(event) => setCompanyForm((current) => ({ ...current, is_active: event.target.checked }))} /> Activa
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-60"><Save size={16} /> {editingCompanyId ? 'Guardar empresa' : 'Crear empresa'}</button>
                {editingCompanyId && <button type="button" onClick={resetCompanyForm} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-900">Cancelar edición</button>}
              </div>
            </form>
          )}

          <div className="mt-5 space-y-3">
            {loading && <SkeletonLines />}
            {!loading && companies.map((company) => (
              <div key={company.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-black text-white">{company.name}</h3>
                      <StatusPill active={company.is_active} />
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{company.legal_name || 'Sin razón social cargada'}</p>
                    {company.cuit && <p className="mt-1 text-xs font-bold text-slate-500">CUIT {company.cuit}</p>}
                  </div>
                  {canManageCompanies && <button onClick={() => void toggleCompany(company)} className="rounded-xl border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title={company.is_active ? 'Desactivar' : 'Activar'}>{company.is_active ? <ToggleRight /> : <ToggleLeft />}</button>}
                </div>
                {canManageCompanies && <button onClick={() => editCompany(company)} className="mt-3 rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 hover:bg-slate-800">Editar</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-950/75 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-500/15 p-3 text-cyan-200"><Store size={22} /></div>
            <div>
              <h2 className="text-xl font-black text-white">Sucursales operativas</h2>
              <p className="text-sm text-slate-400">Físicas, WEB, depósito o administración.</p>
            </div>
          </div>

          {canManageBranches && (
            <form onSubmit={(event) => void saveBranch(event)} className="mt-5 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Select label="Empresa" value={branchForm.company_id} onChange={(value) => setBranchForm((current) => ({ ...current, company_id: value }))} options={companies.map((company) => ({ label: company.name, value: company.id }))} />
                <Input label="Nombre" value={branchForm.name} onChange={(value) => setBranchForm((current) => ({ ...current, name: value }))} required placeholder="Ej: Caseros - WEB" />
                <Input label="Código" value={branchForm.code} onChange={(value) => setBranchForm((current) => ({ ...current, code: value.toUpperCase().replace(/\s+/g, '_') }))} placeholder="Ej: CASEROS_WEB" />
                <Select label="Tipo" value={branchForm.type} onChange={(value) => setBranchForm((current) => ({ ...current, type: value as BranchType }))} options={(Object.keys(branchTypeLabels) as BranchType[]).map((type) => ({ label: branchTypeLabels[type], value: type }))} />
                <Select label="Sucursal base" value={branchForm.parent_branch_id} onChange={(value) => setBranchForm((current) => ({ ...current, parent_branch_id: value }))} options={[{ label: 'Sin sucursal base', value: '' }, ...activePhysicalBranches.filter((branch) => branch.id !== editingBranchId).map((branch) => ({ label: `${branch.name} · ${branch.company_name}`, value: branch.id }))]} />
                <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold text-slate-200">
                  <input type="checkbox" checked={branchForm.is_active} onChange={(event) => setBranchForm((current) => ({ ...current, is_active: event.target.checked }))} /> Activa
                </label>
              </div>
              <p className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">{branchTypeHelp[branchForm.type]}</p>
              <div className="flex flex-wrap gap-2">
                <button disabled={saving || !branchForm.company_id} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white hover:bg-blue-400 disabled:opacity-60"><Plus size={16} /> {editingBranchId ? 'Guardar sucursal' : 'Crear sucursal'}</button>
                {editingBranchId && <button type="button" onClick={resetBranchForm} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-900">Cancelar edición</button>}
              </div>
            </form>
          )}

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
            <div className="grid grid-cols-[1.2fr_1fr_0.7fr_1fr_0.6fr] gap-3 bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500 max-lg:hidden">
              <div>Sucursal</div><div>Empresa</div><div>Tipo</div><div>Base</div><div>Estado</div>
            </div>
            {loading && <div className="p-4"><SkeletonLines /></div>}
            {!loading && branches.map((branch) => (
              <div key={branch.id} className="grid gap-3 border-t border-slate-800 bg-slate-950/60 px-4 py-4 text-sm text-slate-300 lg:grid-cols-[1.2fr_1fr_0.7fr_1fr_0.6fr] lg:items-center">
                <div>
                  <div className="font-black text-white">{branch.name}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{branch.code}</div>
                </div>
                <div>{companyById.get(branch.company_id)?.name || branch.company_name || '-'}</div>
                <div><BranchTypePill type={branch.type} /></div>
                <div>{branch.parent_branch_name || '-'}</div>
                <div className="flex items-center justify-between gap-2 lg:justify-start">
                  <StatusPill active={branch.is_active} />
                  {canManageBranches && <button onClick={() => void toggleBranch(branch)} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title={branch.is_active ? 'Desactivar' : 'Activar'}>{branch.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>}
                  {canManageBranches && <button onClick={() => editBranch(branch)} className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-black text-slate-300 hover:bg-slate-800">Editar</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div><div className="mt-2 text-3xl font-black text-white">{value}</div></div>;
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${active ? 'bg-green-500/15 text-green-200' : 'bg-slate-700 text-slate-300'}`}>{active ? 'Activa' : 'Inactiva'}</span>;
}

function BranchTypePill({ type }: { type: BranchType }) {
  return <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-black text-slate-200">{branchTypeLabels[type]}</span>;
}

function Input({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <label className="block text-sm font-bold text-slate-300">
      {label}
      <input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) {
  return (
    <label className="block text-sm font-bold text-slate-300">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-400">
        {options.map((option) => <option key={`${label}-${option.value}`} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SkeletonLines() {
  return <div className="space-y-2"><div className="h-4 w-3/4 animate-pulse rounded bg-slate-800" /><div className="h-4 w-1/2 animate-pulse rounded bg-slate-800" /><div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" /></div>;
}
