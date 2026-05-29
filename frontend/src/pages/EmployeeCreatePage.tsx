import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { createEmployee, fetchOperationalStructure } from '../api/client';
import { ErpButton, ErpField, ErpInput, ErpNotice, ErpPageHeader, ErpSelect } from '../components/ProUI';
import type { BranchInfo, CompanyInfo, EmployeeCreatePayload } from '../types';

/**
 * E-02 · Alta de empleado (sin acceso).
 * Crea la identidad legal/operativa. El acceso (usuario) se vincula aparte.
 */
export function EmployeeCreatePage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [form, setForm] = useState<EmployeeCreatePayload>({ status: 'alta' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOperationalStructure().then((s) => { setCompanies(s.companies || []); setBranches(s.branches || []); }).catch(() => undefined);
  }, []);

  const set = (patch: Partial<EmployeeCreatePayload>) => setForm((prev) => ({ ...prev, ...patch }));

  async function submit() {
    setError(null);
    if (!String(form.first_name || '').trim() && !String(form.last_name || '').trim()) {
      setError('Indicá al menos nombre y apellido.');
      return;
    }
    setSaving(true);
    try {
      const created = await createEmployee(form);
      navigate(`/administracion/empleados/${encodeURIComponent(created.id || '')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el empleado');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12.5px] text-[color:var(--text-3)]">
        <Link to="/administracion/empleados" className="inline-flex items-center gap-1 hover:text-[color:var(--text)]"><ArrowLeft size={13} /> Empleados</Link>
        <span>/</span><span className="text-[color:var(--text-2)]">Nuevo empleado</span>
      </div>

      <ErpPageHeader title="Nuevo empleado" description="Identidad legal y operativa de la persona. No crea acceso al sistema; el usuario se vincula después." />

      {error && <div className="my-3"><ErpNotice tone="error">{error}</ErpNotice></div>}

      <section className="erp-card mt-2 p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Datos personales</h3>
        <div className="erp-form-grid">
          <ErpField label="Nombre" required><ErpInput value={form.first_name || ''} onChange={(e) => set({ first_name: e.target.value })} /></ErpField>
          <ErpField label="Apellido" required><ErpInput value={form.last_name || ''} onChange={(e) => set({ last_name: e.target.value })} /></ErpField>
          <ErpField label="DNI"><ErpInput value={form.dni || ''} onChange={(e) => set({ dni: e.target.value })} placeholder="Sin puntos" /></ErpField>
          <ErpField label="Fecha de nacimiento"><ErpInput type="date" value={form.birthdate || ''} onChange={(e) => set({ birthdate: e.target.value })} /></ErpField>
          <ErpField label="Género"><ErpInput value={form.gender || ''} onChange={(e) => set({ gender: e.target.value })} /></ErpField>
          <ErpField label="Estado civil"><ErpInput value={form.civil_status || ''} onChange={(e) => set({ civil_status: e.target.value })} /></ErpField>
        </div>
      </section>

      <section className="erp-card mt-4 p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Datos laborales</h3>
        <div className="erp-form-grid">
          <ErpField label="Empresa">
            <ErpSelect value={form.company_id || ''} onChange={(e) => set({ company_id: e.target.value })}>
              <option value="">—</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </ErpSelect>
          </ErpField>
          <ErpField label="Sucursal de trabajo">
            <ErpSelect value={form.work_branch_id || ''} onChange={(e) => set({ work_branch_id: e.target.value })}>
              <option value="">—</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </ErpSelect>
          </ErpField>
          <ErpField label="Puesto"><ErpInput value={form.position || ''} onChange={(e) => set({ position: e.target.value })} /></ErpField>
          <ErpField label="Área / depto"><ErpInput value={form.department || ''} onChange={(e) => set({ department: e.target.value })} /></ErpField>
          <ErpField label="Tipo de contrato"><ErpInput value={form.contract_type || ''} onChange={(e) => set({ contract_type: e.target.value })} placeholder="Ej: relación de dependencia" /></ErpField>
          <ErpField label="Fecha de ingreso"><ErpInput type="date" value={form.hire_date || ''} onChange={(e) => set({ hire_date: e.target.value })} /></ErpField>
        </div>
      </section>

      <section className="erp-card mt-4 p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Contacto personal</h3>
        <div className="erp-form-grid">
          <ErpField label="Teléfono"><ErpInput value={form.phone || ''} onChange={(e) => set({ phone: e.target.value })} /></ErpField>
          <ErpField label="Email personal"><ErpInput value={form.personal_email || ''} onChange={(e) => set({ personal_email: e.target.value })} /></ErpField>
          <ErpField label="Domicilio" wide><ErpInput value={form.address || ''} onChange={(e) => set({ address: e.target.value })} /></ErpField>
        </div>
      </section>

      <div className="mt-4 flex justify-end gap-2">
        <button className="erp-btn erp-btn-secondary" onClick={() => navigate('/administracion/empleados')}>Cancelar</button>
        <ErpButton variant="primary" loading={saving} leftIcon={<Save size={14} />} onClick={submit}>Crear empleado</ErpButton>
      </div>
    </div>
  );
}
