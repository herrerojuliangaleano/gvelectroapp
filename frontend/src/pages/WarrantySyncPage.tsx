import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, ArrowUpToLine, ArrowDownToLine, Clock3, Database, FileSpreadsheet, Wand2, Trash2, Download, ShieldAlert, ChevronDown } from 'lucide-react';
import { can, downloadWarrantyProductionResetBackup, executeWarrantyProductionReset, fetchWarrantyProductionResetPreview, fetchWarrantySyncLogs, fetchWarrantySyncStatus, pullWarrantiesFromSheet, pushWarrantiesToSheet, setupWarrantySheet } from '../api/client';
import type { SetupSheetResult, WarrantyResetPreviewResponse, WarrantyResetResponse, WarrantySyncLogInfo, WarrantySyncResult, WarrantySyncStatus } from '../types';

function StatusBadge({ status }: { status: string }) {
  const value = (status || '').toLowerCase();
  const cls = value === 'success' ? 'border-green-500/40 bg-green-500/10 text-green-200' : value === 'partial' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : value === 'failed' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-slate-700 bg-slate-900 text-slate-300';
  const label = value === 'success' ? 'Correcta' : value === 'partial' ? 'Con avisos' : value === 'failed' ? 'Fallida' : 'Sin actividad';
  return <span className={`rounded-full border px-2 py-1 text-xs font-black ${cls}`}>{label}</span>;
}

function SyncTypeLabel({ type }: { type: string }) {
  if (type === 'push_to_sheet') return <span>App → Google Sheet</span>;
  if (type === 'pull_from_sheet') return <span>Google Sheet → App</span>;
  return <span>-</span>;
}

export function WarrantySyncPage() {
  const [status, setStatus] = useState<WarrantySyncStatus | null>(null);
  const [logs, setLogs] = useState<WarrantySyncLogInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'push' | 'pull' | 'setup' | 'backup' | 'reset' | ''>('');
  const [result, setResult] = useState<WarrantySyncResult | null>(null);
  const [setupResult, setSetupResult] = useState<SetupSheetResult | null>(null);
  const [error, setError] = useState('');
  const [resetPreview, setResetPreview] = useState<WarrantyResetPreviewResponse | null>(null);
  const [resetResult, setResetResult] = useState<WarrantyResetResponse | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetGeneratedFiles, setResetGeneratedFiles] = useState(true);
  const [resetExpanded, setResetExpanded] = useState(false);

  const canPush = can('warranties.sync_to_sheet');
  const canPull = can('warranties.sync_from_sheet');
  const canReset = can('warranties.reset_data');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [syncStatus, syncLogs] = await Promise.all([fetchWarrantySyncStatus(), fetchWarrantySyncLogs(30)]);
      setStatus(syncStatus);
      setLogs(syncLogs.items || []);
      if (can('warranties.reset_data')) {
        try { setResetPreview(await fetchWarrantyProductionResetPreview()); } catch { /* se muestra solo si tiene permiso y backend responde */ }
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar la sincronización.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function runSetup() {
    setRunning('setup');
    setError('');
    setSetupResult(null);
    setResult(null);
    try {
      const res = await setupWarrantySheet();
      setSetupResult(res);
    } catch (err: any) {
      setError(err?.message || 'No se pudo configurar la planilla.');
    } finally {
      setRunning('');
    }
  }

  async function runPush() {
    setRunning('push');
    setError('');
    setResult(null);
    setSetupResult(null);
    try {
      const res = await pushWarrantiesToSheet();
      setResult(res);
      await load();
    } catch (err: any) {
      setError(err?.message || 'No se pudo actualizar Google Sheet.');
    } finally {
      setRunning('');
    }
  }

  async function runPull() {
    setRunning('pull');
    setError('');
    setResult(null);
    setSetupResult(null);
    try {
      const res = await pullWarrantiesFromSheet();
      setResult(res);
      await load();
    } catch (err: any) {
      setError(err?.message || 'No se pudo importar desde Google Sheet.');
    } finally {
      setRunning('');
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  async function runBackup() {
    setRunning('backup');
    setError('');
    try {
      const blob = await downloadWarrantyProductionResetBackup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadBlob(blob, `backup-garantias-pre-reset-${stamp}.json`);
    } catch (err: any) {
      setError(err?.message || 'No se pudo descargar el backup.');
    } finally {
      setRunning('');
    }
  }

  async function runProductionReset() {
    if (!resetPreview) return;
    if (resetConfirmation.trim().toUpperCase() !== resetPreview.confirmation_phrase) {
      setError(`Para resetear escribí exactamente: ${resetPreview.confirmation_phrase}`);
      return;
    }
    const ok = window.confirm('Esto va a borrar garantías, remitos, ENV, eventos y correlativos de prueba. Se genera backup antes de limpiar. ¿Confirmás?');
    if (!ok) return;
    setRunning('reset');
    setError('');
    setResetResult(null);
    try {
      const res = await executeWarrantyProductionReset({ confirmation: resetConfirmation, reset_generated_files: resetGeneratedFiles });
      setResetResult(res);
      setResetConfirmation('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'No se pudo ejecutar el reset.');
    } finally {
      setRunning('');
    }
  }

  const pendingLabel = useMemo(() => {
    const count = status?.pending_to_sheet ?? 0;
    if (count === 0) return 'Sin pendientes';
    if (count === 1) return '1 garantía pendiente';
    return `${count} garantías pendientes`;
  }, [status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">Garantías</p>
          <h1 className="mt-1 text-3xl font-black text-white">Sincronización</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Espejo manual de garantías, remitos, ENV y eventos hacia Google Sheets. La app sigue siendo la fuente principal.</p>
        </div>
        <button onClick={load} disabled={loading || !!running} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900 disabled:opacity-60">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar vista
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-100">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400"><Database size={16} /> Total en base</div>
          <div className="mt-3 text-3xl font-black text-white">{status?.total_guarantees ?? '-'}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400"><FileSpreadsheet size={16} /> Pendientes de Sheet</div>
          <div className="mt-3 text-2xl font-black text-white">{pendingLabel}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400"><Clock3 size={16} /> Última sincronización</div>
          <div className="mt-3 text-sm font-black text-white">{status?.last_sync_at || 'Sin registros'}</div>
          <div className="mt-2 text-xs text-slate-400">{status?.last_sync_user || ''}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400"><CheckCircle2 size={16} /> Estado</div>
          <div className="mt-3"><StatusBadge status={status?.last_sync_status || ''} /></div>
          <div className="mt-2 text-xs text-slate-400"><SyncTypeLabel type={status?.last_sync_type || ''} /></div>
        </div>
      </div>

      {/* Configuración automática */}
      {canPush && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-violet-500/15 p-3 text-violet-300"><Wand2 size={22} /></div>
            <div className="flex-1">
              <h2 className="text-xl font-black text-white">Conectar planilla automáticamente</h2>
              <p className="mt-1 text-sm text-slate-400">
                Configurá la URL del spreadsheet en <strong className="text-slate-200">Configuración → Garantías</strong> y hacé clic acá.
                El sistema crea/verifica <code className="rounded bg-slate-800 px-1 text-violet-300">00_RAW_GARANTIAS</code> y las pestañas espejo <code className="rounded bg-slate-800 px-1 text-violet-300">GARANTIAS</code>, <code className="rounded bg-slate-800 px-1 text-violet-300">REMITOS</code>, <code className="rounded bg-slate-800 px-1 text-violet-300">LOTES_ENV</code> y <code className="rounded bg-slate-800 px-1 text-violet-300">EVENTOS</code>.
              </p>
              {setupResult && (
                <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  <CheckCircle2 size={16} className="mb-0.5 mr-2 inline" />
                  {setupResult.message}
                  {setupResult.tab_created && <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold">Pestaña nueva creada</span>}
                </div>
              )}
            </div>
          </div>
          <button onClick={runSetup} disabled={!!running} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">
            <Wand2 size={16} />
            {running === 'setup' ? 'Configurando planilla...' : 'Configurar planilla automáticamente'}
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-500/15 p-3 text-blue-200"><ArrowUpToLine size={22} /></div>
            <div>
              <h2 className="text-xl font-black text-white">Actualizar Google Sheet</h2>
              <p className="mt-1 text-sm text-slate-400">Reescribe el espejo completo con los datos vigentes del sistema: garantías, ítems, remitos, lotes ENV y eventos.</p>
            </div>
          </div>
          <button onClick={runPush} disabled={!canPush || !!running} className="mt-5 w-full rounded-xl bg-blue-500 px-4 py-3 text-sm font-black text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50">
            {running === 'push' ? 'Sincronizando...' : 'Actualizar Google Sheet'}
          </button>
          {!canPush && <p className="mt-3 text-xs text-slate-500">No tenés permiso para ejecutar esta acción.</p>}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/15 p-3 text-amber-200"><ArrowDownToLine size={22} /></div>
            <div>
              <h2 className="text-xl font-black text-white">Actualizar desde Google Sheet</h2>
              <p className="mt-1 text-sm text-slate-400">Importación legacy desde 00_RAW_GARANTIAS. El espejo nuevo es principalmente de lectura/reporting.</p>
            </div>
          </div>
          <button onClick={runPull} disabled={!canPull || !!running} className="mt-5 w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
            {running === 'pull' ? 'Importando...' : 'Actualizar desde Google Sheet'}
          </button>
          {!canPull && <p className="mt-3 text-xs text-slate-500">No tenés permiso para ejecutar esta acción.</p>}
        </div>
      </div>

      {canReset && resetPreview && (
        <>
          {/* Separador zona de peligro */}
          <div className="flex items-center gap-4 py-2">
            <div className="h-px flex-1 bg-red-500/25" />
            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-red-500/70">
              <ShieldAlert size={12} /> Zona de peligro
            </span>
            <div className="h-px flex-1 bg-red-500/25" />
          </div>

          {/* Acordeón colapsable */}
          <div className="rounded-2xl border border-red-500/40 bg-red-950/20 overflow-hidden">
            {/* Header — siempre visible, actúa como toggle */}
            <button
              type="button"
              onClick={() => setResetExpanded((v) => !v)}
              className="flex w-full items-center gap-4 p-5 text-left hover:bg-red-500/5 transition-colors"
            >
              <div className="rounded-xl bg-red-500/20 p-3 text-red-400 shrink-0">
                <ShieldAlert size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-black text-red-100">Reset de producción de garantías</h2>
                  <span className="rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-xs font-black text-red-400 uppercase tracking-wide">Destructivo</span>
                </div>
                <p className="mt-1 text-sm text-red-200/50">
                  Elimina garantías, remitos, ENV y eventos de prueba. Reinicia correlativos. Esta acción no se puede deshacer.
                </p>
              </div>
              <ChevronDown
                size={20}
                className={`shrink-0 text-red-400 transition-transform duration-200 ${resetExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Panel expandido */}
            {resetExpanded && (
              <div className="border-t border-red-500/25 p-5 space-y-5">
                {/* Aviso destructivo */}
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100/90">
                  <AlertTriangle size={14} className="mr-2 inline text-red-400" />
                  Limpia datos operativos de prueba y reinicia correlativos GAR/REM/ENV. Conserva usuarios, empresas, sucursales, depósitos, roles, permisos y configuración.
                  <span className="ml-2 font-black text-red-300">Descargá un backup antes de continuar.</span>
                </div>

                {/* Contadores */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-red-500/20 bg-slate-950/50 p-4"><div className="text-xs font-bold text-slate-400">Garantías</div><div className="text-2xl font-black text-white">{resetPreview.summary.guarantees}</div></div>
                  <div className="rounded-xl border border-red-500/20 bg-slate-950/50 p-4"><div className="text-xs font-bold text-slate-400">Remitos</div><div className="text-2xl font-black text-white">{resetPreview.summary.remitos}</div></div>
                  <div className="rounded-xl border border-red-500/20 bg-slate-950/50 p-4"><div className="text-xs font-bold text-slate-400">Lotes ENV</div><div className="text-2xl font-black text-white">{resetPreview.summary.exports}</div></div>
                  <div className="rounded-xl border border-red-500/20 bg-slate-950/50 p-4"><div className="text-xs font-bold text-slate-400">Eventos</div><div className="text-2xl font-black text-white">{resetPreview.summary.guarantee_history}</div></div>
                </div>

                {/* Lo que se conserva */}
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
                  <div className="font-black text-white">Se conserva:</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {resetPreview.preserved.map((item) => <span key={item} className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-200">{item}</span>)}
                  </div>
                </div>

                {/* Backup */}
                <button onClick={runBackup} disabled={!!running} className="inline-flex items-center gap-2 rounded-xl border border-red-400/40 px-4 py-2.5 text-sm font-black text-red-100 hover:bg-red-500/10 disabled:opacity-50">
                  <Download size={15} /> {running === 'backup' ? 'Generando backup...' : 'Descargar backup JSON antes de resetear'}
                </button>

                {/* Resultado del reset */}
                {resetResult && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    <CheckCircle2 size={16} className="mb-0.5 mr-2 inline" />
                    {resetResult.message} Backup generado: <b>{resetResult.backup_file}</b>. Archivos Excel borrados: <b>{resetResult.deleted_generated_files}</b>.
                  </div>
                )}

                {/* Confirmación y botón de reset */}
                <div className="rounded-xl border border-red-500/30 bg-slate-950/60 p-4 space-y-4">
                  <div className="text-xs font-black uppercase tracking-widest text-red-400">Confirmación obligatoria para ejecutar</div>
                  <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <label className="block">
                      <input
                        value={resetConfirmation}
                        onChange={(e) => setResetConfirmation(e.target.value)}
                        placeholder={resetPreview.confirmation_phrase}
                        className="w-full rounded-xl border border-red-500/30 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-300"
                      />
                      <span className="mt-1.5 block text-xs text-red-200/60">Escribí exactamente: <span className="font-black text-red-200">{resetPreview.confirmation_phrase}</span></span>
                    </label>
                    <button
                      onClick={runProductionReset}
                      disabled={!!running || resetConfirmation.trim().toUpperCase() !== resetPreview.confirmation_phrase}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={16} /> {running === 'reset' ? 'Reseteando...' : 'Ejecutar reset'}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <input type="checkbox" checked={resetGeneratedFiles} onChange={(e) => setResetGeneratedFiles(e.target.checked)} className="h-4 w-4" />
                    Borrar también archivos Excel de ENV generados en pruebas.
                  </label>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {result && (
        <div className={`rounded-2xl border p-5 ${result.ok ? 'border-green-500/30 bg-green-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <div className="flex items-center gap-2 text-lg font-black text-white">{result.ok ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />} Resultado</div>
          <div className="mt-3 grid gap-3 text-sm text-slate-200 sm:grid-cols-4">
            <div><span className="text-slate-400">Procesadas:</span> <b>{result.rows_processed}</b></div>
            <div><span className="text-slate-400">Creadas:</span> <b>{result.rows_created}</b></div>
            <div><span className="text-slate-400">Actualizadas:</span> <b>{result.rows_updated}</b></div>
            <div><span className="text-slate-400">Omitidas:</span> <b>{result.rows_skipped}</b></div>
          </div>
          {result.errors?.length > 0 && <div className="mt-4 space-y-1 text-sm text-amber-100">{result.errors.slice(0, 8).map((item, index) => <div key={`${item}-${index}`}>• {item}</div>)}</div>}
        </div>
      )}

      {status?.errors?.length ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="flex items-center gap-2 text-lg font-black text-amber-100"><AlertTriangle size={20} /> Avisos recientes</div>
          <div className="mt-3 space-y-1 text-sm text-amber-100/90">{status.errors.slice(0, 8).map((item, index) => <div key={`${item}-${index}`}>• {item}</div>)}</div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-white">Historial de sincronización</h2>
          <span className="text-xs font-bold text-slate-500">Últimos {logs.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2 text-right">Procesadas</th>
                <th className="px-3 py-2 text-right">Creadas</th>
                <th className="px-3 py-2 text-right">Actualizadas</th>
                <th className="px-3 py-2 text-right">Omitidas</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-3 whitespace-nowrap">{item.finished_at || item.started_at}</td>
                  <td className="px-3 py-3 whitespace-nowrap"><SyncTypeLabel type={item.sync_type} /></td>
                  <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-3 py-3">{item.actor_name || item.actor_username || '-'}</td>
                  <td className="px-3 py-3 text-right">{item.rows_processed}</td>
                  <td className="px-3 py-3 text-right">{item.rows_created}</td>
                  <td className="px-3 py-3 text-right">{item.rows_updated}</td>
                  <td className="px-3 py-3 text-right">{item.rows_skipped}</td>
                </tr>
              ))}
              {!loading && logs.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Todavía no hay sincronizaciones registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
