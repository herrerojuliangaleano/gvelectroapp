import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, UserPlus } from 'lucide-react';
import { fetchOperationalStructure, fetchRoles, saveUser } from '../api/client';
import { ErpButton, ErpField, ErpInput, ErpNotice, ErpPageHeader, ErpSelect } from '../components/ProUI';
import type { BranchInfo, CompanyInfo, RoleInfo } from '../types';

const STEPS = ['Datos de acceso', 'Rol y permisos', 'Alcance', 'Vínculo con empleado'];

function branchTypeLabel(t?: string) {
  if (t === 'web') return 'WEB';
  if (t === 'physical') return 'Física';
  if (t === 'deposit') return 'Depósito';
  if (t === 'admin') return 'Admin';
  return '—';
}

/** U-02 · Crear usuario (wizard 4 pasos). */
export function UserCreateWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // form
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [secondaryRoles, setSecondaryRoles] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [empDni, setEmpDni] = useState('');
  const [empPosition, setEmpPosition] = useState('');

  useEffect(() => {
    fetchRoles().then(setRoles).catch(() => setRoles([]));
    fetchOperationalStructure().then((s) => { setCompanies(s.companies || []); setBranches(s.branches || []); }).catch(() => undefined);
  }, []);

  const companyBranches = useMemo(
    () => branches.filter((b) => !companyId || b.company_id === companyId),
    [branches, companyId],
  );

  function toggleSecondary(name: string) {
    setSecondaryRoles((prev) => (prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name]));
  }
  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!username.trim()) return 'El nombre de usuario es obligatorio.';
      if (!displayName.trim()) return 'El nombre visible es obligatorio.';
    }
    if (step === 1 && !role) return 'Elegí un rol principal.';
    return null;
  }

  function next() {
    const v = validateStep();
    if (v) { setError(v); return; }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() { setError(null); setStep((s) => Math.max(0, s - 1)); }

  async function submit() {
    const v = validateStep();
    if (v) { setError(v); return; }
    setSaving(true);
    setError(null);
    try {
      const allRoles = [role, ...secondaryRoles.filter((r) => r !== role)];
      await saveUser({
        username: username.trim(),
        display_name: displayName.trim(),
        role,
        roles: allRoles,
        company_id: companyId || undefined,
        branch_id: branchIds[0] || undefined,
        branch_ids: branchIds,
        password: password.trim() || undefined,
        is_active: true,
        employee: empDni.trim() || empPosition.trim() ? { dni: empDni.trim(), position: empPosition.trim() } : undefined,
      });
      navigate(`/administracion/usuarios/${encodeURIComponent(username.trim())}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12.5px] text-[color:var(--text-3)]">
        <Link to="/administracion/usuarios" className="inline-flex items-center gap-1 hover:text-[color:var(--text)]"><ArrowLeft size={13} /> Usuarios</Link>
        <span>/</span><span className="text-[color:var(--text-2)]">Nuevo usuario</span>
      </div>

      <ErpPageHeader title="Nuevo usuario" description="Identidad técnica de acceso: credenciales, roles, alcance y vínculo opcional con un empleado." />

      {/* Stepper */}
      <div className="my-4 flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${i === step ? 'bg-[color:var(--primary)] text-white' : i < step ? 'bg-[color:var(--primary-soft)] text-[color:var(--primary-soft-text)]' : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)]'}`}>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-black/20 text-[10px]">{i < step ? <Check size={11} /> : i + 1}</span>
              {label}
            </span>
            {i < STEPS.length - 1 && <ArrowRight size={12} className="text-[color:var(--text-3)]" />}
          </div>
        ))}
      </div>

      {error && <div className="mb-3"><ErpNotice tone="error">{error}</ErpNotice></div>}

      <section className="erp-card p-4">
        {step === 0 && (
          <div className="erp-form-grid">
            <ErpField label="Nombre de usuario" required hint="Con el que inicia sesión. No usar espacios."><ErpInput value={username} onChange={(e) => setUsername(e.target.value.replace(/\s+/g, '').toLowerCase())} placeholder="jperez" /></ErpField>
            <ErpField label="Nombre visible" required><ErpInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Juan Pérez" /></ErpField>
            <ErpField label="Contraseña inicial" hint="Si la dejás vacía, el usuario la crea en su primer ingreso." wide><ErpInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="(opcional)" /></ErpField>
          </div>
        )}

        {step === 1 && (
          <div className="erp-stack-3">
            <ErpField label="Rol principal" required>
              <ErpSelect value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">— Elegí rol —</option>
                {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
              </ErpSelect>
            </ErpField>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-2)]">Roles secundarios (opcional)</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {roles.filter((r) => r.name !== role).map((r) => (
                  <label key={r.name} className="flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2 text-[12.5px]">
                    <input type="checkbox" checked={secondaryRoles.includes(r.name)} onChange={() => toggleSecondary(r.name)} />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="erp-stack-3">
            <ErpField label="Empresa">
              <ErpSelect value={companyId} onChange={(e) => { setCompanyId(e.target.value); setBranchIds([]); }}>
                <option value="">Todas / sin definir</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ErpSelect>
            </ErpField>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-2)]">Sucursales asignadas <span className="text-[color:var(--text-3)]">({branchIds.length})</span></div>
              <div className="grid max-h-72 gap-1.5 overflow-auto sm:grid-cols-2">
                {companyBranches.map((b) => (
                  <label key={b.id} className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[12.5px] ${branchIds.includes(b.id) ? 'border-[color:var(--primary)] bg-[color:var(--primary-soft)]' : 'border-[color:var(--border)] bg-[color:var(--surface-2)]'}`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                      <span>{b.name}</span>
                    </span>
                    <span className="text-[10.5px] text-[color:var(--text-3)]">{branchTypeLabel(b.type)}</span>
                  </label>
                ))}
                {companyBranches.length === 0 && <div className="text-[12.5px] text-[color:var(--text-3)]">No hay sucursales para esta empresa.</div>}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="erp-stack-3">
            <ErpNotice tone="info">Opcional. Podés cargar el DNI y puesto del empleado ahora, o dejarlo y completar el legajo después desde Empleados.</ErpNotice>
            <div className="erp-form-grid">
              <ErpField label="DNI del empleado"><ErpInput value={empDni} onChange={(e) => setEmpDni(e.target.value)} placeholder="(opcional)" /></ErpField>
              <ErpField label="Puesto"><ErpInput value={empPosition} onChange={(e) => setEmpPosition(e.target.value)} placeholder="(opcional)" /></ErpField>
            </div>
          </div>
        )}
      </section>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button className="erp-btn erp-btn-secondary" onClick={step === 0 ? () => navigate('/administracion/usuarios') : back}>
          {step === 0 ? 'Cancelar' : 'Atrás'}
        </button>
        {step < STEPS.length - 1
          ? <ErpButton variant="primary" rightIcon={<ArrowRight size={14} />} onClick={next}>Siguiente</ErpButton>
          : <ErpButton variant="primary" loading={saving} leftIcon={<UserPlus size={14} />} onClick={submit}>Crear usuario</ErpButton>}
      </div>
    </div>
  );
}
