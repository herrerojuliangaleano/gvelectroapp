import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  can,
  cancelPayrollReceipt,
  fetchPayrollReceipt,
  fetchPayrollReceiptFile,
  fetchPayrollReceipts,
  fetchUsers,
  getCurrentUsername,
  observePayrollReceipt,
  previewPayrollBulkReceipts,
  respondPayrollObservation,
  signPayrollReceipt,
  uploadPayrollBulkReceipts,
  uploadPayrollReceipt,
} from '../api/client';
import type { PayrollBulkPreviewResponse, PayrollBulkUploadResponse, PayrollObservation, PayrollReceipt, PayrollReceiptListResponse, UserInfo } from '../types';

const MONTHS = [
  { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' }, { value: 3, label: 'Marzo' }, { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' }, { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' }, { value: 10, label: 'Octubre' }, { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

export function PayrollReceiptsPage() {
  const [data, setData] = useState<PayrollReceiptListResponse>({ items: [], total: 0, pending: 0, signed: 0, observed: 0 });
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selected, setSelected] = useState<PayrollReceipt | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState<'auto' | 'own' | 'all'>(can('payroll_receipts.view_all') ? 'all' : 'own');

  const [employeeId, setEmployeeId] = useState('');
  const [employeeDni, setEmployeeDni] = useState('');
  const [periodYear, setPeriodYear] = useState(currentYear);
  const [periodMonth, setPeriodMonth] = useState(currentMonth);
  const [receiptType, setReceiptType] = useState('mensual');
  const [file, setFile] = useState<File | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkPreview, setBulkPreview] = useState<PayrollBulkPreviewResponse | null>(null);
  const [bulkResult, setBulkResult] = useState<PayrollBulkUploadResponse | null>(null);
  const [bulkDniOverrides, setBulkDniOverrides] = useState<Record<string, string>>({});
  const [bulkDuplicateStrategy, setBulkDuplicateStrategy] = useState<'skip' | 'replace' | 'keep_both'>('skip');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [observeText, setObserveText] = useState('');
  const [answerText, setAnswerText] = useState<Record<string, string>>({});

  const canAdmin = can('payroll_receipts.view_all');
  const canUpload = can('payroll_receipts.upload');
  const canBulkUpload = can('payroll_receipts.bulk_upload') || canUpload;
  const canSign = can('payroll_receipts.sign_own');
  const canObserve = can('payroll_receipts.observe_own');
  const canRespond = can('payroll_receipts.respond_observation');
  const canCancel = can('payroll_receipts.cancel');
  const currentUsername = getCurrentUsername() || '';
  const selectedIsOwn = !!selected && selected.employee_username === currentUsername;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await fetchPayrollReceipts({ scope, status, q, limit: 200 });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los recibos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [scope, status]);
  useEffect(() => { if (canUpload && can('users.view')) fetchUsers().then(setUsers).catch(() => setUsers([])); }, [canUpload]);

  const employeeOptions = useMemo(() => users.filter((u) => !!u.employee?.id).sort((a, b) => String(a.employee?.display_name || a.display_name).localeCompare(String(b.employee?.display_name || b.display_name))), [users]);

  async function submitUpload(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!employeeId && !employeeDni.trim()) return setError('Elegí un empleado o escribí el DNI.');
    if (!file) return setError('Elegí el archivo del recibo.');
    try {
      await uploadPayrollReceipt({ employee_id: employeeId, employee_dni: employeeDni.trim(), period_year: periodYear, period_month: periodMonth, receipt_type: receiptType, file });
      setMessage('Recibo cargado correctamente. El empleado recibirá una notificación interna.');
      setFile(null);
      setEmployeeDni('');
      const input = document.getElementById('payroll-file-input') as HTMLInputElement | null;
      if (input) input.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el recibo');
    }
  }

  function bulkMappings() {
    return Object.fromEntries(
      Object.entries(bulkDniOverrides)
        .map(([fileName, dni]) => [fileName, { dni: dni.trim() }])
        .filter(([, value]) => !!(value as { dni: string }).dni)
    ) as Record<string, { dni: string }>;
  }

  async function previewBulkUpload(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setMessage('');
    setBulkResult(null);
    if (!bulkFiles.length) return setError('Elegí uno o varios recibos para previsualizar.');
    setBulkLoading(true);
    try {
      const result = await previewPayrollBulkReceipts({ files: bulkFiles, period_year: periodYear, period_month: periodMonth, receipt_type: receiptType, mappings: bulkMappings() });
      setBulkPreview(result);
      setMessage(`Previsualización lista: ${result.ready} de ${result.total} archivos se pueden cargar.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo previsualizar la carga masiva');
    } finally {
      setBulkLoading(false);
    }
  }

  async function confirmBulkUpload() {
    setError('');
    setMessage('');
    if (!bulkFiles.length) return setError('Elegí uno o varios recibos.');
    if (!bulkPreview) return setError('Primero hacé la previsualización.');
    const ready = bulkPreview.items.filter((item) => item.can_upload).length;
    if (!ready) return setError('No hay archivos listos para cargar. Revisá DNI, empleado o formato.');
    if (!window.confirm(`Confirmás la carga masiva de ${ready} recibos?`)) return;
    setBulkLoading(true);
    try {
      const result = await uploadPayrollBulkReceipts({ files: bulkFiles, period_year: periodYear, period_month: periodMonth, receipt_type: receiptType, duplicate_strategy: bulkDuplicateStrategy, mappings: bulkMappings() });
      setBulkResult(result);
      setBulkPreview(null);
      setBulkFiles([]);
      setBulkDniOverrides({});
      const input = document.getElementById('payroll-bulk-file-input') as HTMLInputElement | null;
      if (input) input.value = '';
      setMessage(`Carga masiva procesada: ${result.uploaded} cargados, ${result.skipped} saltados, ${result.errors} con error.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar la carga masiva');
    } finally {
      setBulkLoading(false);
    }
  }

  async function openDetail(receipt: PayrollReceipt) {
    setError('');
    try {
      const detail = await fetchPayrollReceipt(receipt.id);
      setSelected(detail);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el recibo');
    }
  }

  async function openFile(receipt: PayrollReceipt) {
    setError('');
    try {
      const blob = await fetchPayrollReceiptFile(receipt.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el archivo');
    }
  }

  async function signSelected() {
    if (!selected) return;
    if (!window.confirm('Confirmás que recibiste y revisaste este recibo en conformidad?')) return;
    setError(''); setMessage('');
    try {
      const updated = await signPayrollReceipt(selected.id);
      setSelected(updated);
      setMessage('Recibo firmado en conformidad.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo firmar'); }
  }

  async function observeSelected(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const updated = await observePayrollReceipt(selected.id, observeText);
      setSelected(updated);
      setObserveText('');
      setMessage('Observación enviada a administración.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar la observación'); }
  }

  async function respond(obs: PayrollObservation) {
    if (!selected) return;
    const answer = answerText[obs.id] || '';
    setError(''); setMessage('');
    try {
      const updated = await respondPayrollObservation(selected.id, obs.id, answer, 'respondida');
      setSelected(updated);
      setAnswerText((prev) => ({ ...prev, [obs.id]: '' }));
      setMessage('Respuesta guardada.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo responder'); }
  }

  async function cancelSelected() {
    if (!selected) return;
    const reason = window.prompt('Motivo de anulación, opcional:') || '';
    if (!window.confirm('¿Anular este recibo?')) return;
    setError(''); setMessage('');
    try {
      const updated = await cancelPayrollReceipt(selected.id, reason);
      setSelected(updated);
      setMessage('Recibo anulado.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo anular'); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">Recibos de sueldo</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Gestión de recibos, conformidades y observaciones del personal.</p>
        </div>
        <button onClick={load} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">Actualizar</button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">{message}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Metric label="Total" value={data.total} />
        <Metric label="Pendientes / vistos" value={data.pending} />
        <Metric label="Firmados" value={data.signed} />
        <Metric label="Observados" value={data.observed} />
      </div>

      {canUpload && <form onSubmit={submitUpload} className="mb-5 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="mb-4"><h2 className="text-lg font-black">Subir recibo individual</h2><p className="mt-1 text-sm text-slate-400">Registrá el recibo de un empleado y dejalo disponible en su perfil.</p></div>
        <div className="grid gap-3 lg:grid-cols-[1.2fr_150px_100px_140px_130px_1.4fr_auto]">
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Empleado</span><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"><option value="">Elegir empleado</option>{employeeOptions.map((u) => <option key={u.employee?.id || u.username} value={u.employee?.id || ''}>{u.employee?.display_name || u.display_name} · DNI {u.employee?.dni || 'pendiente'} · {u.username}</option>)}</select></label><label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">O DNI</span><input value={employeeDni} onChange={(e) => setEmployeeDni(e.target.value)} placeholder="DNI" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2" /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Año</span><input type="number" value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2" /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Mes</span><select value={periodMonth} onChange={(e) => setPeriodMonth(Number(e.target.value))} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">{MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Tipo</span><select value={receiptType} onChange={(e) => setReceiptType(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"><option value="mensual">Mensual</option><option value="sac">SAC</option><option value="ajuste">Ajuste</option><option value="otro">Otro</option></select></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Archivo PDF/imagen</span><input id="payroll-file-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2" /></label>
          <div className="flex items-end"><button className="w-full rounded-xl bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-400">Subir</button></div>
        </div>
      </form>}

      {canBulkUpload && <section className="mb-5 rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5">
        <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div>
            <h2 className="text-lg font-black text-white">Carga masiva de recibos</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">Subí una tanda de archivos, revisá las coincidencias detectadas y confirmá la carga cuando esté validada.</p>
          </div>
          <div className="rounded-2xl border border-blue-500/30 bg-slate-950 px-4 py-3 text-xs text-blue-100">
            Nombre sugerido: <b>12345678_2026-05.pdf</b>
          </div>
        </div>
        <form onSubmit={previewBulkUpload} className="grid gap-3 lg:grid-cols-[1fr_220px_180px_auto]">
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Archivos</span><input id="payroll-bulk-file-input" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { const files = Array.from(e.target.files || []); setBulkFiles(files); setBulkPreview(null); setBulkResult(null); }} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2" /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-400">Duplicados</span><select value={bulkDuplicateStrategy} onChange={(e) => setBulkDuplicateStrategy(e.target.value as 'skip' | 'replace' | 'keep_both')} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"><option value="skip">Saltar duplicados</option><option value="replace">Reemplazar anterior</option><option value="keep_both">Mantener ambos</option></select></label>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-400"><b>{bulkFiles.length}</b> archivo/s seleccionados<br />Usa el período elegido arriba.</div>
          <div className="flex items-end"><button disabled={bulkLoading} className="w-full rounded-xl bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-400 disabled:opacity-60">{bulkLoading ? 'Procesando...' : 'Previsualizar'}</button></div>
        </form>

        {bulkPreview && <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-800 bg-slate-900/70 p-4 md:flex-row md:items-center">
            <div className="text-sm text-slate-300"><b>{bulkPreview.ready}</b> listos · <b>{bulkPreview.duplicates}</b> duplicados · <b>{bulkPreview.missing_dni}</b> sin DNI · <b>{bulkPreview.not_found}</b> sin empleado · <b>{bulkPreview.invalid}</b> inválidos</div>
            <button type="button" onClick={confirmBulkUpload} disabled={bulkLoading || !bulkPreview.ready} className="rounded-xl bg-green-500 px-4 py-2 text-sm font-bold text-white hover:bg-green-400 disabled:opacity-60">Confirmar carga masiva</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-950 text-xs uppercase text-slate-400"><tr><th className="px-4 py-3 text-left">Archivo</th><th className="px-4 py-3 text-left">DNI</th><th className="px-4 py-3 text-left">Empleado</th><th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3 text-left">Corrección</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {bulkPreview.items.map((item) => <tr key={item.file_name}>
                  <td className="px-4 py-3 font-semibold text-white">{item.file_name}</td>
                  <td className="px-4 py-3 text-slate-300">{item.detected_dni || '-'}</td>
                  <td className="px-4 py-3"><div className="font-semibold text-slate-100">{item.employee_name || '-'}</div>{item.employee_username && <div className="text-xs text-slate-500">{item.employee_username}</div>}</td>
                  <td className="px-4 py-3"><BulkStatus status={item.status} message={item.message} /></td>
                  <td className="px-4 py-3"><input value={bulkDniOverrides[item.file_name] || ''} onChange={(e) => setBulkDniOverrides((prev) => ({ ...prev, [item.file_name]: e.target.value }))} placeholder="DNI manual" className="w-36 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs" /></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {(bulkPreview.missing_dni > 0 || bulkPreview.not_found > 0) && <div className="border-t border-slate-800 bg-amber-500/10 p-4 text-sm text-amber-100">Si modificás un DNI, volvé a generar la previsualización antes de confirmar.</div>}
        </div>}

        {bulkResult && <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 text-sm font-black uppercase text-slate-400">Resultado de la última carga</div>
          <div className="grid gap-3 sm:grid-cols-4"><Metric label="Cargados" value={bulkResult.uploaded} /><Metric label="Saltados" value={bulkResult.skipped} /><Metric label="Errores" value={bulkResult.errors} /><Metric label="Reemplazados" value={bulkResult.replaced} /></div>
          <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-800"><table className="min-w-full text-xs"><tbody className="divide-y divide-slate-800">{bulkResult.items.map((item) => <tr key={`${item.file_name}-${item.status}`}><td className="px-3 py-2 font-semibold text-white">{item.file_name}</td><td className="px-3 py-2 text-slate-300">{item.employee_name || item.employee_dni || '-'}</td><td className="px-3 py-2 text-slate-400">{item.message}</td></tr>)}</tbody></table></div>
        </div>}
      </section>}

      <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-950/60 p-4 md:flex-row">
        {canAdmin && <select value={scope} onChange={(e) => setScope(e.target.value as 'auto' | 'own' | 'all')} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><option value="all">Todos los empleados</option><option value="own">Solo mis recibos</option></select>}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><option value="">Todos los estados</option><option value="pendiente">Pendiente</option><option value="visto">Visto</option><option value="firmado_conforme">Firmado conforme</option><option value="observado">Observado</option><option value="anulado">Anulado</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} placeholder="Buscar empleado, DNI, archivo..." className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
        <button onClick={load} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">Buscar</button>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/60">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase text-slate-400"><tr><th className="px-4 py-3 text-left">Período</th><th className="px-4 py-3 text-left">Empleado</th><th className="px-4 py-3 text-left">Archivo</th><th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3 text-left">Carga</th><th className="px-4 py-3 text-right">Acciones</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {data.items.map((r) => <tr key={r.id} className="hover:bg-slate-900/50"><td className="px-4 py-3 font-bold text-white">{String(r.period_month).padStart(2, '0')}/{r.period_year}</td><td className="px-4 py-3"><div className="font-semibold text-white">{r.employee_name || r.employee_username}</div><div className="text-xs text-slate-500">DNI {r.employee_dni || 'pendiente'}</div></td><td className="px-4 py-3 text-slate-300">{r.file_name}</td><td className="px-4 py-3"><StatusBadge status={r.status} /></td><td className="px-4 py-3 text-xs text-slate-400">{r.uploaded_at ? new Date(r.uploaded_at).toLocaleString() : '-'}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><button onClick={() => openDetail(r)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-slate-800">Detalle</button><button onClick={() => openFile(r)} className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-400">Ver</button></div></td></tr>)}
              {!loading && data.items.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No hay recibos para mostrar.</td></tr>}
              {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Cargando...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur" onClick={() => setSelected(null)}>
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-700 bg-slate-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Recibo {String(selected.period_month).padStart(2, '0')}/{selected.period_year}</h2><p className="mt-1 text-sm text-slate-400">{selected.employee_name} · DNI {selected.employee_dni || 'pendiente'}</p></div><button onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm">Cerrar</button></div>
          <div className="grid gap-3 sm:grid-cols-3"><Info label="Estado" value={statusLabel(selected.status)} /><Info label="Archivo" value={selected.file_name} /><Info label="Hash" value={(selected.file_hash || '').slice(0, 12) || '-'} /></div>
          <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => openFile(selected)} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white">Ver archivo</button>{canSign && selectedIsOwn && !['firmado_conforme', 'anulado', 'reemplazado'].includes(selected.status) && <button onClick={signSelected} className="rounded-xl bg-green-500 px-4 py-2 text-sm font-bold text-white">Firmar conformidad</button>}{canCancel && selected.status !== 'anulado' && <button onClick={cancelSelected} className="rounded-xl border border-red-500/40 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/10">Anular</button>}</div>
          {canObserve && selectedIsOwn && !['firmado_conforme', 'anulado', 'reemplazado'].includes(selected.status) && <form onSubmit={observeSelected} className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><div className="mb-2 text-sm font-black text-amber-100">Enviar observación</div><textarea value={observeText} onChange={(e) => setObserveText(e.target.value)} rows={3} placeholder="Detalle de la observación..." className="w-full rounded-xl border border-amber-400/30 bg-slate-950 px-3 py-2 text-sm" /><button className="mt-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950">Enviar observación</button></form>}
          <div className="mt-5"><h3 className="mb-3 text-sm font-black uppercase text-slate-400">Observaciones</h3><div className="space-y-3">{(selected.observations || []).map((obs) => <div key={obs.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="text-sm font-bold text-white">{obs.message}</div><div className="mt-1 text-xs text-slate-500">{new Date(obs.created_at).toLocaleString()} · {obs.status}</div>{obs.answer_message && <div className="mt-3 rounded-xl bg-slate-950 p-3 text-sm text-green-100"><b>Respuesta:</b> {obs.answer_message}<div className="mt-1 text-xs text-slate-500">{obs.answered_by_name || obs.answered_by} · {obs.answered_at ? new Date(obs.answered_at).toLocaleString() : ''}</div></div>}{canRespond && !obs.answer_message && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={answerText[obs.id] || ''} onChange={(e) => setAnswerText((prev) => ({ ...prev, [obs.id]: e.target.value }))} placeholder="Responder observación..." className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /><button onClick={() => respond(obs)} className="rounded-xl bg-green-500 px-4 py-2 text-sm font-bold text-white">Responder</button></div>}</div>)}{!(selected.observations || []).length && <div className="rounded-2xl border border-slate-800 p-4 text-sm text-slate-500">Sin observaciones.</div>}</div></div>
        </div>
      </div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-slate-900/70 p-4"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 truncate font-bold text-white" title={value}>{value}</div></div>; }
function statusLabel(status: string) { if (status === 'firmado_conforme') return 'Firmado conforme'; if (status === 'observado') return 'Observado'; if (status === 'visto') return 'Visto'; if (status === 'anulado') return 'Anulado'; if (status === 'reemplazado') return 'Reemplazado'; return 'Pendiente'; }
function BulkStatus({ status, message }: { status: string; message: string }) { const cls = status === 'listo' ? 'border-green-500/40 bg-green-500/10 text-green-200' : status === 'duplicado' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : status === 'sin_dni' || status === 'empleado_no_encontrado' ? 'border-orange-500/40 bg-orange-500/10 text-orange-200' : 'border-red-500/40 bg-red-500/10 text-red-200'; const label = status === 'listo' ? 'Listo' : status === 'duplicado' ? 'Duplicado' : status === 'sin_dni' ? 'Sin DNI' : status === 'empleado_no_encontrado' ? 'Sin empleado' : 'Inválido'; return <span title={message} className={`inline-flex max-w-xs rounded-full border px-3 py-1 text-xs font-bold ${cls}`}>{label}</span>; }
function StatusBadge({ status }: { status: string }) { const cls = status === 'firmado_conforme' ? 'border-green-500/40 bg-green-500/10 text-green-200' : status === 'observado' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : status === 'anulado' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-blue-500/40 bg-blue-500/10 text-blue-200'; return <span className={`rounded-full border px-3 py-1 text-xs font-bold ${cls}`}>{statusLabel(status)}</span>; }
