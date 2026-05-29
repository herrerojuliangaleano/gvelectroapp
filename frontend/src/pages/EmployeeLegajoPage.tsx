import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Link2, PencilLine, RefreshCw, UserMinus, UserPlus } from 'lucide-react';
import {
  can,
  changeEmployeeStatus,
  fetchEmployee,
  fetchEmployeeLinkCandidates,
  fetchEmployeeStatusHistory,
  fetchOperationalStructure,
  linkEmployeeUser,
  unlinkEmployeeUser,
  updateEmployee,
} from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpErrorState,
  ErpField,
  ErpInfoGrid,
  ErpInfoRow,
  ErpInput,
  ErpLoadingState,
  ErpModal,
  ErpNotice,
  ErpSelect,
  ErpTabBar,
  ErpTextarea,
  type ErpBadgeTone,
} from '../components/ProUI';
import type { BranchInfo, CompanyInfo, EmployeeInfo, EmployeeStatusHistoryItem, UserLinkCandidate } from '../types';

const STATUS_META: Record<string, { label: string; tone: ErpBadgeTone }> = {
  alta: { label: 'Alta', tone: 'success' },
  licencia: { label: 'Licencia', tone: 'warning' },
  baja: { label: 'Baja', tone: 'danger' },
};
function statusMeta(s?: string | null) {
  return STATUS_META[String(s || 'alta').toLowerCase()] || { label: s || '—', tone: 'neutral' as ErpBadgeTone };
}
function initials(name?: string | null) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase() : '—';
}

type Tab = 'resumen' | 'laboral' | 'recibos' | 'historial';
type EmpForm = Partial<EmployeeInfo>;

export function EmployeeLegajoPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [emp, setEmp] = useState<EmployeeInfo | null>(null);
  const [history, setHistory] = useState<EmployeeStatusHistoryItem[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('resumen');
  const [msg, setMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EmpForm>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [statusOpen, setStatusOpen] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: 'licencia', motivo: '', categoria: '', fecha_desde: '', fecha_hasta: '', observaciones: '' });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [candidates, setCandidates] = useState<UserLinkCandidate[]>([]);

  const canManage = can('employees.manage');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [e, h] = await Promise.all([fetchEmployee(id), fetchEmployeeStatusHistory(id).catch(() => ({ items: [] }))]);
      setEmp(e);
      setHistory(h.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el legajo');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    fetchOperationalStructure().then((s) => { setCompanies(s.companies || []); setBranches(s.branches || []); }).catch(() => undefined);
  }, []);

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  function startEdit() {
    if (!emp) return;
    setForm({ ...emp });
    setFormError(null);
    setEditing(true);
    setTab('laboral');
  }

  async function saveEdit() {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        dni: form.dni || '', first_name: form.first_name || '', last_name: form.last_name || '',
        position: form.position || '', department: form.department || '', phone: form.phone || '',
        personal_email: form.personal_email || '', address: form.address || '', birthdate: form.birthdate || '',
        gender: form.gender || '', civil_status: form.civil_status || '', contract_type: form.contract_type || '',
        hire_date: form.hire_date || '', company_id: form.company_id || '', work_branch_id: form.work_branch_id || '',
      };
      const updated = await updateEmployee(id, payload);
      setEmp(updated);
      setEditing(false);
      setMsg('Legajo actualizado.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function applyStatus() {
    setSaving(true);
    try {
      const updated = await changeEmployeeStatus(id, statusForm);
      setEmp(updated);
      setStatusOpen(false);
      setMsg(`Estado laboral cambiado a ${statusMeta(updated.status).label}.`);
      const h = await fetchEmployeeStatusHistory(id).catch(() => ({ items: [] }));
      setHistory(h.items || []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    } finally {
      setSaving(false);
    }
  }

  async function openLink() {
    setLinkOpen(true);
    setLinkQuery('');
    try { setCandidates((await fetchEmployeeLinkCandidates('')).items); } catch { setCandidates([]); }
  }
  async function searchCandidates(q: string) {
    setLinkQuery(q);
    try { setCandidates((await fetchEmployeeLinkCandidates(q)).items); } catch { setCandidates([]); }
  }
  async function doLink(username: string) {
    setSaving(true);
    try {
      const updated = await linkEmployeeUser(id, username);
      setEmp(updated);
      setLinkOpen(false);
      setMsg(`Usuario ${username} vinculado.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo vincular');
    } finally {
      setSaving(false);
    }
  }
  async function doUnlink() {
    if (!window.confirm('¿Desvincular el usuario de este empleado? El usuario seguirá existiendo.')) return;
    setSaving(true);
    try {
      const updated = await unlinkEmployeeUser(id);
      setEmp(updated);
      setMsg('Usuario desvinculado.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo desvincular');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-2"><ErpLoadingState /></div>;
  if (error || !emp) return <div className="p-2"><ErpErrorState description={error || 'Empleado no encontrado'} retry={load} /></div>;

  const sm = statusMeta(emp.status);
  const set = (patch: EmpForm) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12.5px] text-[color:var(--text-3)]">
        <Link to="/administracion/empleados" className="inline-flex items-center gap-1 hover:text-[color:var(--text)]"><ArrowLeft size={13} /> Empleados</Link>
        <span>/</span><span className="text-[color:var(--text-2)]">{emp.display_name}</span>
      </div>

      {msg && <div className="mb-3"><ErpNotice tone="success">{msg}</ErpNotice></div>}
      {formError && <div className="mb-3"><ErpNotice tone="error">{formError}</ErpNotice></div>}

      <div className="erp-card mb-4 flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--primary-soft)] text-lg font-bold text-[color:var(--primary-soft-text)]">{initials(emp.display_name)}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-bold text-[color:var(--text)]">{emp.display_name}</h1>
              <ErpBadge tone={sm.tone}>{sm.label}</ErpBadge>
            </div>
            <div className="mt-0.5 text-[12.5px] text-[color:var(--text-2)]">
              DNI <span className="font-mono">{emp.dni || '—'}</span> · {emp.position || 'Sin puesto'} · {emp.work_branch_name || emp.branch_name || 'Sin sucursal'}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={load}><RefreshCw size={14} /> Actualizar</button>
            <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => setStatusOpen(true)}>Cambiar estado</button>
            {emp.has_user
              ? <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={doUnlink}><UserMinus size={14} /> Desvincular</button>
              : <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={openLink}><Link2 size={14} /> Vincular usuario</button>}
            <button className="erp-btn erp-btn-primary erp-btn-sm" onClick={startEdit}><PencilLine size={14} /> Editar legajo</button>
          </div>
        )}
      </div>

      <ErpTabBar
        tabs={[{ key: 'resumen', label: 'Resumen' }, { key: 'laboral', label: 'Datos laborales' }, { key: 'recibos', label: 'Recibos' }, { key: 'historial', label: 'Historial', count: history.length }]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <div className="mt-4">
        {tab === 'resumen' && (
          <div className="erp-stack-4">
            <section className="erp-card p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Identidad legal</h3>
              <ErpInfoGrid columns={3}>
                <ErpInfoRow label="DNI" value={<span className="font-mono">{emp.dni || '—'}</span>} />
                <ErpInfoRow label="Nombre completo" value={emp.display_name || '—'} />
                <ErpInfoRow label="Nacimiento" value={emp.birthdate || '—'} />
                <ErpInfoRow label="Género" value={emp.gender || '—'} />
                <ErpInfoRow label="Estado civil" value={emp.civil_status || '—'} />
              </ErpInfoGrid>
            </section>

            <section className="erp-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Usuario vinculado</h3>
                {emp.has_user && emp.user
                  ? <Link to={`/administracion/usuarios/${encodeURIComponent(emp.user.username)}`} className="text-[12px] font-semibold text-[color:var(--primary)]">Ver usuario →</Link>
                  : null}
              </div>
              {emp.has_user && emp.user ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-[13px]">{emp.user.username}</div>
                    <div className="text-[12px] text-[color:var(--text-3)]">{(emp.user.roles || []).join(' · ') || emp.user.role}</div>
                  </div>
                  <ErpBadge tone={emp.user.is_active ? 'success' : 'neutral'}>{emp.user.is_active ? 'Activo' : 'Inactivo'}</ErpBadge>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px] text-[color:var(--text-3)]">Este empleado no tiene acceso al sistema.</span>
                  {canManage && <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={openLink}><UserPlus size={14} /> Vincular / crear</button>}
                </div>
              )}
            </section>

            <section className="erp-card p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Datos laborales</h3>
              <ErpInfoGrid columns={3}>
                <ErpInfoRow label="Empresa" value={emp.company_name || '—'} />
                <ErpInfoRow label="Sucursal de trabajo" value={emp.work_branch_name || emp.branch_name || '—'} />
                <ErpInfoRow label="Puesto" value={emp.position || '—'} />
                <ErpInfoRow label="Área / depto" value={emp.department || '—'} />
                <ErpInfoRow label="Tipo de contrato" value={emp.contract_type || '—'} />
                <ErpInfoRow label="Fecha de ingreso" value={emp.hire_date || '—'} />
              </ErpInfoGrid>
            </section>

            <section className="erp-card p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Contacto</h3>
              <ErpInfoGrid columns={3}>
                <ErpInfoRow label="Teléfono" value={emp.phone || '—'} />
                <ErpInfoRow label="Email personal" value={emp.personal_email || '—'} />
                <ErpInfoRow label="Domicilio" value={emp.address || '—'} />
              </ErpInfoGrid>
            </section>
          </div>
        )}

        {tab === 'laboral' && (
          <section className="erp-card p-4">
            {!editing ? (
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[12.5px] text-[color:var(--text-2)]">Datos laborales y de contacto.</span>
                {canManage && <button className="erp-btn erp-btn-primary erp-btn-sm" onClick={startEdit}><PencilLine size={14} /> Editar</button>}
              </div>
            ) : null}
            <div className="erp-form-grid">
              <ErpField label="Nombre"><ErpInput value={form.first_name ?? emp.first_name ?? ''} disabled={!editing} onChange={(e) => set({ first_name: e.target.value })} /></ErpField>
              <ErpField label="Apellido"><ErpInput value={form.last_name ?? emp.last_name ?? ''} disabled={!editing} onChange={(e) => set({ last_name: e.target.value })} /></ErpField>
              <ErpField label="DNI"><ErpInput value={form.dni ?? emp.dni ?? ''} disabled={!editing} onChange={(e) => set({ dni: e.target.value })} /></ErpField>
              <ErpField label="Fecha de nacimiento"><ErpInput type="date" value={form.birthdate ?? emp.birthdate ?? ''} disabled={!editing} onChange={(e) => set({ birthdate: e.target.value })} /></ErpField>
              <ErpField label="Puesto"><ErpInput value={form.position ?? emp.position ?? ''} disabled={!editing} onChange={(e) => set({ position: e.target.value })} /></ErpField>
              <ErpField label="Área / depto"><ErpInput value={form.department ?? emp.department ?? ''} disabled={!editing} onChange={(e) => set({ department: e.target.value })} /></ErpField>
              <ErpField label="Empresa">
                <ErpSelect value={form.company_id ?? emp.company_id ?? ''} disabled={!editing} onChange={(e) => set({ company_id: e.target.value })}>
                  <option value="">—</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </ErpSelect>
              </ErpField>
              <ErpField label="Sucursal de trabajo">
                <ErpSelect value={form.work_branch_id ?? emp.work_branch_id ?? ''} disabled={!editing} onChange={(e) => set({ work_branch_id: e.target.value })}>
                  <option value="">—</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </ErpSelect>
              </ErpField>
              <ErpField label="Tipo de contrato"><ErpInput value={form.contract_type ?? emp.contract_type ?? ''} disabled={!editing} onChange={(e) => set({ contract_type: e.target.value })} placeholder="Ej: relación de dependencia" /></ErpField>
              <ErpField label="Fecha de ingreso"><ErpInput type="date" value={form.hire_date ?? emp.hire_date ?? ''} disabled={!editing} onChange={(e) => set({ hire_date: e.target.value })} /></ErpField>
              <ErpField label="Teléfono"><ErpInput value={form.phone ?? emp.phone ?? ''} disabled={!editing} onChange={(e) => set({ phone: e.target.value })} /></ErpField>
              <ErpField label="Email personal"><ErpInput value={form.personal_email ?? emp.personal_email ?? ''} disabled={!editing} onChange={(e) => set({ personal_email: e.target.value })} /></ErpField>
              <ErpField label="Género"><ErpInput value={form.gender ?? emp.gender ?? ''} disabled={!editing} onChange={(e) => set({ gender: e.target.value })} /></ErpField>
              <ErpField label="Estado civil"><ErpInput value={form.civil_status ?? emp.civil_status ?? ''} disabled={!editing} onChange={(e) => set({ civil_status: e.target.value })} /></ErpField>
              <ErpField label="Domicilio" wide><ErpInput value={form.address ?? emp.address ?? ''} disabled={!editing} onChange={(e) => set({ address: e.target.value })} /></ErpField>
            </div>
            {editing && (
              <div className="mt-3 flex justify-end gap-2">
                <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => setEditing(false)}>Cancelar</button>
                <ErpButton variant="primary" size="sm" loading={saving} onClick={saveEdit}>Guardar cambios</ErpButton>
              </div>
            )}
          </section>
        )}

        {tab === 'recibos' && (
          <section className="erp-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold text-[color:var(--text)]">Recibos de sueldo</h3>
                <p className="text-[12.5px] text-[color:var(--text-2)]">Los recibos se gestionan por DNI en el módulo de Recibos de sueldo.</p>
              </div>
              <Link to="/recibos" className="erp-btn erp-btn-primary erp-btn-sm"><FileText size={14} /> Ir a Recibos</Link>
            </div>
          </section>
        )}

        {tab === 'historial' && (
          <section className="erp-card p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-[color:var(--text)]">Historial de estado laboral</h3>
            {history.length === 0 ? (
              <div className="text-[12.5px] text-[color:var(--text-3)]">Todavía no hay cambios de estado registrados.</div>
            ) : (
              <ul className="erp-stack-2">
                {history.map((h) => (
                  <li key={h.id} className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5 text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <ErpBadge tone={statusMeta(h.status).tone}>{statusMeta(h.status).label}</ErpBadge>
                      {h.previous_status && <span className="text-[11.5px] text-[color:var(--text-3)]">desde {statusMeta(h.previous_status).label}</span>}
                      <span className="ml-auto text-[11.5px] text-[color:var(--text-3)] tabular-nums">{(h.created_at || '').slice(0, 10)}</span>
                    </div>
                    {(h.motivo || h.observaciones) && <div className="mt-1 text-[color:var(--text-2)]">{[h.motivo, h.observaciones].filter(Boolean).join(' — ')}</div>}
                    {(h.fecha_desde || h.fecha_hasta) && <div className="mt-0.5 text-[11.5px] text-[color:var(--text-3)]">{h.fecha_desde} {h.fecha_hasta ? `→ ${h.fecha_hasta}` : ''}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* Modal: cambiar estado */}
      <ErpModal open={statusOpen} onClose={() => setStatusOpen(false)} title="Cambiar estado laboral"
        footer={<><button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => setStatusOpen(false)}>Cancelar</button><ErpButton variant="primary" size="sm" loading={saving} onClick={applyStatus}>Aplicar</ErpButton></>}>
        <div className="erp-stack-3">
          <ErpField label="Estado" required>
            <ErpSelect value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
              <option value="alta">Alta</option>
              <option value="licencia">Licencia</option>
              <option value="baja">Baja</option>
            </ErpSelect>
          </ErpField>
          <ErpField label="Motivo"><ErpInput value={statusForm.motivo} onChange={(e) => setStatusForm({ ...statusForm, motivo: e.target.value })} placeholder="Ej: licencia médica, renuncia…" /></ErpField>
          {statusForm.status === 'licencia' && (
            <div className="erp-form-grid">
              <ErpField label="Desde"><ErpInput type="date" value={statusForm.fecha_desde} onChange={(e) => setStatusForm({ ...statusForm, fecha_desde: e.target.value })} /></ErpField>
              <ErpField label="Hasta"><ErpInput type="date" value={statusForm.fecha_hasta} onChange={(e) => setStatusForm({ ...statusForm, fecha_hasta: e.target.value })} /></ErpField>
            </div>
          )}
          <ErpField label="Observaciones"><ErpTextarea rows={2} value={statusForm.observaciones} onChange={(e) => setStatusForm({ ...statusForm, observaciones: e.target.value })} /></ErpField>
        </div>
      </ErpModal>

      {/* Modal: vincular usuario */}
      <ErpModal open={linkOpen} onClose={() => setLinkOpen(false)} title={`Vincular usuario a ${emp.display_name}`}>
        <div className="erp-stack-3">
          <ErpField label="Buscar usuario sin empleado vinculado" hint="Buscamos por username o nombre. Solo aparecen usuarios sin vínculo.">
            <ErpInput value={linkQuery} onChange={(e) => searchCandidates(e.target.value)} placeholder="Ej: jperez" />
          </ErpField>
          <div className="erp-stack-2 max-h-72 overflow-auto">
            {candidates.length === 0 ? (
              <div className="text-[12.5px] text-[color:var(--text-3)]">No hay usuarios disponibles para vincular.</div>
            ) : candidates.map((c) => (
              <button key={c.username} type="button" className="flex w-full items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5 text-left hover:bg-[color:var(--surface-hover)]" onClick={() => doLink(c.username)}>
                <span>
                  <span className="block font-mono text-[12.5px] text-[color:var(--text)]">{c.username}</span>
                  <span className="block text-[11.5px] text-[color:var(--text-3)]">{c.display_name} · {c.role}</span>
                </span>
                <span className="erp-btn erp-btn-primary erp-btn-sm">Vincular</span>
              </button>
            ))}
          </div>
          <ErpNotice tone="info">¿El usuario todavía no existe? Creá uno desde <Link className="font-semibold text-[color:var(--primary)]" to="/administracion/usuarios/nuevo">Nuevo usuario</Link> y luego vinculalo.</ErpNotice>
        </div>
      </ErpModal>
    </div>
  );
}
