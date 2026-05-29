import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Download, FileText } from 'lucide-react';
import { can, fetchMe, fetchPayrollReceiptFile, fetchPayrollReceipts, uploadMyEmployeePhoto } from '../api/client';
import { EmployeePhoto } from '../components/EmployeePhoto';
import { ErpBadge, ErpErrorState, ErpInfoGrid, ErpInfoRow, ErpLoadingState, ErpNotice, ErpPageHeader, type ErpBadgeTone } from '../components/ProUI';
import type { CurrentUser, PayrollReceipt } from '../types';

const MONTHS = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const EMP_STATUS: Record<string, { label: string; tone: ErpBadgeTone }> = {
  alta: { label: 'Alta', tone: 'success' }, activo: { label: 'Alta', tone: 'success' },
  licencia: { label: 'Licencia', tone: 'warning' },
  baja: { label: 'Baja', tone: 'danger' }, inactivo: { label: 'Baja', tone: 'danger' },
};

export function MyLegajoPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [receipts, setReceipts] = useState<PayrollReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canReceipts = can('payroll_receipts.view_own');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const u = await fetchMe();
      setMe(u);
      if (canReceipts) {
        try { setReceipts((await fetchPayrollReceipts({ scope: 'own', limit: 6 })).items || []); } catch { setReceipts([]); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu legajo');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setMsg(null); setError(null);
    try {
      const u = await uploadMyEmployeePhoto(file);
      setMe(u);
      setMsg('Foto enviada. Queda pendiente de aprobación.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la foto');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function download(r: PayrollReceipt) {
    try {
      const blob = await fetchPayrollReceiptFile(r.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('No se pudo abrir el recibo.');
    }
  }

  if (loading) return <div className="p-2"><ErpLoadingState /></div>;
  if (error && !me) return <div className="p-2"><ErpErrorState description={error} retry={load} /></div>;

  const emp = me?.employee;
  const st = EMP_STATUS[String(emp?.status || 'alta').toLowerCase()] || { label: emp?.status || '—', tone: 'neutral' as ErpBadgeTone };

  return (
    <div className="mx-auto max-w-xl">
      <ErpPageHeader title="Mi legajo" description="Tus datos laborales, foto profesional y recibos de sueldo." />

      {msg && <div className="mb-3"><ErpNotice tone="success">{msg}</ErpNotice></div>}
      {error && <div className="mb-3"><ErpNotice tone="error">{error}</ErpNotice></div>}

      <section className="erp-card mb-4 p-4">
        <div className="flex items-center gap-3">
          <EmployeePhoto username={me?.username} name={me?.display_name} hasPhoto={['aprobada', 'pendiente_aprobacion', 'solicitada_nuevamente'].includes(String(emp?.photo_status || ''))} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold text-[color:var(--text)]">{me?.display_name}</h2>
              <ErpBadge tone={st.tone}>{st.label}</ErpBadge>
            </div>
            <div className="mt-0.5 text-[12.5px] text-[color:var(--text-2)]">{emp?.position || 'Sin puesto'}</div>
            <div className="text-[12px] text-[color:var(--text-3)]">{[emp?.company_name, emp?.work_branch_name || emp?.branch_name].filter(Boolean).join(' · ') || '—'}</div>
          </div>
        </div>
        <div className="mt-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          <button className="erp-btn erp-btn-primary erp-btn-sm w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Camera size={14} /> {uploading ? 'Subiendo…' : 'Cambiar foto profesional'}
          </button>
        </div>
      </section>

      <section className="erp-card mb-4 p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Datos personales</h3>
        <ErpInfoGrid columns={2}>
          <ErpInfoRow label="DNI" value={<span className="font-mono">{emp?.dni || '—'}</span>} />
          <ErpInfoRow label="Nacimiento" value={emp?.birthdate || '—'} />
          <ErpInfoRow label="Ingreso" value={emp?.hire_date || '—'} />
          <ErpInfoRow label="Tipo de contrato" value={emp?.contract_type || '—'} />
          <ErpInfoRow label="Teléfono" value={emp?.phone || '—'} />
          <ErpInfoRow label="Email" value={emp?.personal_email || '—'} />
        </ErpInfoGrid>
      </section>

      {canReceipts && (
        <section className="erp-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Últimos recibos</h3>
            <Link to="/recibos" className="text-[12px] font-semibold text-[color:var(--primary)]">Ver todos →</Link>
          </div>
          {receipts.length === 0 ? (
            <div className="text-[12.5px] text-[color:var(--text-3)]">Todavía no tenés recibos cargados.</div>
          ) : (
            <ul className="erp-stack-2">
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[color:var(--text)]">{MONTHS[r.period_month] || ''} {r.period_year}</span>
                    <span className="block text-[11.5px] text-[color:var(--text-3)]">{r.receipt_type || 'Sueldo'} · {r.status}</span>
                  </span>
                  <button className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => download(r)}><Download size={13} /> Abrir</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mt-4 text-center">
        <Link to="/me" className="text-[12.5px] font-semibold text-[color:var(--primary)]"><FileText size={12} className="mr-1 inline" /> Ver mi usuario y acceso</Link>
      </div>
    </div>
  );
}
