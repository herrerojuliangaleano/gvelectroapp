import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Clock,
  ExternalLink, Eye, MapPin, Package, RefreshCw, ShieldCheck, Truck, Wrench, X, XCircle,
} from 'lucide-react';
import {
  approveWarrantyReview, can, fetchWarranties, markWarrantyIncomplete, takeWarrantyIntoReview,
} from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpKpiCard,
  ErpLoadingState,
  ErpNotice,
  ErpPageHeader,
  ErpTextarea,
  erpBtnGhost,
  erpBtnSecondary,
  type ErpBadgeTone,
  type ErpKpiVariant,
} from '../components/ProUI';
import { WarrantyDetailDrawer } from '../components/WarrantyDetailDrawer';
import type { WarrantySummary, WarrantyListResponse } from '../types';
import {
  computeLogisticsAlerts, getWarrantyStatusMeta, getReviewStatusMeta, type LogisticsAlert,
} from '../warrantyFlow';

// ─── helpers ─────────────────────────────────────────────────────────────────

const FINAL_ESTADOS = new Set(['10 - FINALIZADO', '9 - ANULADA', '8 - RECHAZADO']);

function flowToneToBadgeTone(tone?: string): ErpBadgeTone {
  switch (tone) {
    case 'success': case 'green': return 'success';
    case 'warning': case 'amber': case 'yellow': return 'warning';
    case 'danger': case 'red': return 'danger';
    case 'info': case 'blue': case 'cyan': return 'info';
    case 'violet': case 'purple': return 'violet';
    default: return 'neutral';
  }
}

function priorityKpiVariant(priority: 'base' | 'warn' | 'danger' | 'ok'): ErpKpiVariant {
  if (priority === 'danger') return 'danger';
  if (priority === 'warn') return 'alert';
  if (priority === 'ok') return 'success';
  return 'default';
}

function alertNoticeT(priority: LogisticsAlert['priority']): 'error' | 'warning' | 'info' {
  if (priority === 'high') return 'error';
  if (priority === 'medium') return 'warning';
  return 'info';
}

// ─── Card del gestor (vista general) ─────────────────────────────────────────

function GestorCard({ item, onOpen }: { item: WarrantySummary; onOpen: () => void }) {
  const alerts = computeLogisticsAlerts(item).filter((a) => a.targetRole !== 'posventa');
  const topAlert = alerts[0];
  const statusMeta = getWarrantyStatusMeta(item.estado);
  const reviewMeta = getReviewStatusMeta(item.review_status);

  return (
    <ErpCard
      size="sm"
      className={topAlert?.priority === 'high' ? 'border-[color:rgba(239,68,68,0.36)]' : ''}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="font-mono text-[14px] font-semibold text-[color:var(--text)] hover:text-[color:var(--primary-soft-text)]">
            {item.id_garantia}
          </Link>
          <ErpBadge tone={flowToneToBadgeTone(statusMeta.tone)}>{statusMeta.shortLabel}</ErpBadge>
          {item.review_status && (
            <ErpBadge tone={flowToneToBadgeTone(reviewMeta.tone)}>
              {item.review_status_label || reviewMeta.label}
            </ErpBadge>
          )}
        </div>
        <ErpBadge tone="neutral">
          <Clock size={11} className="inline mr-0.5" /> {item.dias_pendiente ?? 0}d
        </ErpBadge>
      </div>

      <div className="mt-2 text-[13px] font-medium text-[color:var(--text)]">{item.producto_principal || 'Sin producto'}</div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[color:var(--text-2)]">
        {item.sucursal && <span><span className="text-[color:var(--text-3)]">Sucursal:</span> {item.sucursal}</span>}
        {item.provider_name && <span><span className="text-[color:var(--text-3)]">Proveedor:</span> {item.provider_name}</span>}
        {item.marca && <span><span className="text-[color:var(--text-3)]">Marca:</span> {item.marca}</span>}
        {item.serie && <span><span className="text-[color:var(--text-3)]">Serie:</span> {item.serie}</span>}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[color:var(--text-2)]">
        <MapPin size={11} className="shrink-0 text-[color:var(--text-3)]" />
        <span>{item.ubicacion_actual_label || item.ubicacion_actual || (item.transit_status === 'en_transito' ? 'En tránsito' : '—')}</span>
        {item.transit_status === 'en_transito' && <ErpBadge tone="warning" withDot={false}>en tránsito</ErpBadge>}
        {item.transit_status === 'en_deposito' && <ErpBadge tone="success" withDot={false}>en depósito</ErpBadge>}
      </div>

      {alerts.length > 0 && (
        <div className="mt-3 erp-stack-2">
          {alerts.map((alert, idx) => (
            <ErpNotice key={idx} tone={alertNoticeT(alert.priority)}>
              <div className="text-[12px] font-semibold">{alert.message}</div>
              <div className="text-[11.5px] opacity-80">→ {alert.action}</div>
            </ErpNotice>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={onOpen} className="erp-btn erp-btn-primary erp-btn-sm">
          <Eye size={13} /> Vista rápida
        </button>
        <Link to={`/warranties/${encodeURIComponent(item.id_garantia)}`} className="erp-btn erp-btn-secondary erp-btn-sm">
          <ArrowRight size={13} /> Detalle completo
        </Link>
        {(item.transit_status === 'en_transito' || item.origen_ingreso === 'sucursal') && can('warranties.remitos.view') && (
          <Link to="/warranties/remitos" className="erp-btn erp-btn-ghost erp-btn-sm">
            <Truck size={13} /> Remitos
          </Link>
        )}
      </div>
    </ErpCard>
  );
}

// ─── Card de acciones de revisión (bandeja revisión / corrección) ────────────

function ReviewActionCard({
  item, note, setNote, saving,
  onTake, onApprove, onIncomplete, onDirectApprove, onDirectIncomplete,
}: {
  item: WarrantySummary;
  note: string;
  setNote: (v: string) => void;
  saving: boolean;
  onTake?: () => void;
  onApprove?: () => void;
  onIncomplete?: () => void;
  onDirectApprove?: () => void;
  onDirectIncomplete?: () => void;
}) {
  const [showReturnForm, setShowReturnForm] = useState(false);
  const isPending    = !item.review_status || item.review_status === 'pendiente_revision';
  const isInProgress = item.review_status === 'en_revision';
  const isCorrection = item.review_status === 'requiere_correccion';
  const detailUrl    = `/warranties/${encodeURIComponent(item.id_garantia)}?from=revision`;

  const reviewTone: ErpBadgeTone =
    item.review_status === 'requiere_correccion' ? 'warning' :
    item.review_status === 'revisada' ? 'success' :
    item.review_status === 'en_revision' ? 'violet' : 'info';

  return (
    <ErpCard
      size="sm"
      className={
        isInProgress ? 'border-[color:rgba(167,139,250,0.40)]' :
        isCorrection ? 'border-[color:rgba(245,158,11,0.36)]' :
        ''
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Link to={detailUrl} className="font-mono text-[14px] font-semibold text-[color:var(--text)] hover:text-[color:var(--primary-soft-text)]">
          {item.id_garantia}
        </Link>
        <ErpBadge tone={reviewTone}>{item.review_status_label || 'Pendiente de revisión'}</ErpBadge>
        {item.dias_pendiente != null && Number(item.dias_pendiente) > 0 && (
          <ErpBadge tone="neutral">
            <Clock size={10} className="inline mr-0.5" /> {item.dias_pendiente}d
          </ErpBadge>
        )}
      </div>

      <div className="mt-1.5 text-[13px] font-medium text-[color:var(--text)]">{item.producto_principal || 'Sin producto'}</div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[color:var(--text-2)]">
        {item.sucursal && <span><span className="text-[color:var(--text-3)]">Sucursal:</span> {item.sucursal}</span>}
        {item.sku      && <span><span className="text-[color:var(--text-3)]">SKU:</span> {item.sku}</span>}
        {item.serie    && <span><span className="text-[color:var(--text-3)]">Serie:</span> {item.serie}</span>}
        {item.tipo_ingreso_label && <span><span className="text-[color:var(--text-3)]">Tipo:</span> {item.tipo_ingreso_label}</span>}
      </div>

      {item.falla && (
        <div className="mt-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-[12px] text-[color:var(--text-2)]">
          <span className="font-semibold text-[color:var(--text-3)]">Falla: </span>{item.falla}
        </div>
      )}

      {item.review_note && (
        <div className="mt-2">
          <ErpNotice tone="warning"><span className="font-semibold">Nota de revisión: </span>{item.review_note}</ErpNotice>
        </div>
      )}

      <div className="mt-3">
        {isPending && can('warranties.review') && (
          <div className="erp-stack-2">
            <div className="flex flex-wrap gap-1.5">
              {can('warranties.approve_review') && onDirectApprove && (
                <ErpButton size="sm" variant="primary" disabled={saving} onClick={onDirectApprove} leftIcon={<CheckCircle2 size={13} />}>
                  Aprobar
                </ErpButton>
              )}
              {onTake && (
                <ErpButton size="sm" variant="secondary" disabled={saving} onClick={onTake} leftIcon={<Eye size={13} />} rightIcon={<ArrowRight size={12} />}>
                  Revisar en detalle
                </ErpButton>
              )}
              {can('warranties.mark_incomplete') && onDirectIncomplete && (
                <ErpButton size="sm" variant={showReturnForm ? 'primary' : 'ghost'} disabled={saving} onClick={() => setShowReturnForm((v) => !v)} leftIcon={<AlertTriangle size={13} />} rightIcon={showReturnForm ? <X size={11} /> : undefined}>
                  Devolver
                </ErpButton>
              )}
            </div>
            {showReturnForm && can('warranties.mark_incomplete') && onDirectIncomplete && (
              <div className="rounded-md border border-[color:rgba(245,158,11,0.36)] bg-[color:var(--warning-soft)] p-3">
                <ErpTextarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Motivo de corrección (obligatorio)..."
                />
                <div className="mt-2 flex gap-2">
                  <ErpButton size="sm" variant="primary" disabled={saving || !note.trim()} onClick={onDirectIncomplete} leftIcon={<AlertTriangle size={12} />}>
                    Devolver con nota
                  </ErpButton>
                  <button type="button" onClick={() => setShowReturnForm(false)} className="erp-btn erp-btn-ghost erp-btn-sm">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isInProgress && (
          <div className="flex flex-wrap items-end gap-3">
            <Link to={detailUrl} className="erp-btn erp-btn-secondary erp-btn-sm">
              <ExternalLink size={13} /> Continuar revisión
            </Link>
            {(can('warranties.mark_incomplete') || can('warranties.approve_review')) && (
              <div className="flex flex-wrap items-end gap-2">
                <ErpTextarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Nota (obligatoria para corrección)..."
                  style={{ minHeight: 56, width: 220 }}
                />
                <div className="flex flex-col gap-1.5">
                  {can('warranties.mark_incomplete') && onIncomplete && (
                    <ErpButton size="sm" variant="ghost" disabled={saving || !note.trim()} onClick={onIncomplete} leftIcon={<AlertTriangle size={12} />}>
                      Corrección
                    </ErpButton>
                  )}
                  {can('warranties.approve_review') && onApprove && (
                    <ErpButton size="sm" variant="primary" disabled={saving} onClick={onApprove} leftIcon={<CheckCircle2 size={12} />}>
                      Aprobar
                    </ErpButton>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {isCorrection && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11.5px] text-[color:var(--warning-soft-text)]">Esperando que la sucursal corrija. Vuelve a revisión automáticamente.</p>
            <Link to={detailUrl} className="erp-btn erp-btn-ghost erp-btn-sm">
              <ExternalLink size={12} /> Ver detalle
            </Link>
          </div>
        )}
      </div>
    </ErpCard>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function WarrantyGestorPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<string>('revision');
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  async function reviewAction(id: string, type: 'take' | 'approve' | 'incomplete' | 'direct_approve' | 'direct_incomplete') {
    setSavingId(id); setActionMsg(''); setActionErr('');
    try {
      const note = (notes[id] || '').trim();
      if (type === 'take') {
        await takeWarrantyIntoReview(id, {});
        navigate(`/warranties/${encodeURIComponent(id)}?from=revision`);
        return;
      } else if (type === 'approve') {
        await approveWarrantyReview(id, { note: note || undefined });
        setActionMsg('Garantía aprobada.');
      } else if (type === 'incomplete') {
        await markWarrantyIncomplete(id, { note: note || undefined });
        setActionMsg('Devuelta a sucursal para corrección.');
      } else if (type === 'direct_approve') {
        await takeWarrantyIntoReview(id, {});
        await approveWarrantyReview(id, { note: note || undefined });
        setActionMsg('Garantía tomada y aprobada.');
      } else {
        await takeWarrantyIntoReview(id, {});
        await markWarrantyIncomplete(id, { note: note || undefined });
        setActionMsg('Devuelta a sucursal para corrección.');
      }
      setNotes((prev) => ({ ...prev, [id]: '' }));
      await load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'No se pudo completar la acción');
    } finally {
      setSavingId('');
    }
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await fetchWarranties({ limit: 500 });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el panel del gestor');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const allActive = useMemo(
    () => (data?.items || []).filter((item) => !FINAL_ESTADOS.has(item.estado || '') && !item.cancelled),
    [data],
  );

  const pendingReview = useMemo(
    () => allActive.filter((item) => !item.review_status || item.review_status === 'pendiente_revision' || item.review_status === 'en_revision'),
    [allActive],
  );
  const needsCorrection = useMemo(
    () => allActive.filter((item) => item.review_status === 'requiere_correccion'),
    [allActive],
  );
  const readyForPosventa = useMemo(
    () => allActive.filter((item) => item.review_status === 'revisada' && item.estado === '1 - INGRESO'),
    [allActive],
  );
  const inTransit = useMemo(
    () => allActive.filter((item) => item.transit_status === 'en_transito'),
    [allActive],
  );
  const logisticsAlerts = useMemo(
    () => allActive.filter((item) => computeLogisticsAlerts(item).some((a) => a.targetRole !== 'posventa')),
    [allActive],
  );
  const pickupRequested = useMemo(
    () => allActive.filter((item) => item.estado_retiro_proveedor === 'retiro_solicitado'),
    [allActive],
  );

  const TABS: Array<{ id: string; label: string; icon: ReactNode; count: number; priority: 'base' | 'warn' | 'danger' | 'ok'; items: WarrantySummary[] }> = [
    { id: 'revision',   label: 'Revisión pendiente',   icon: <ClipboardCheck size={13} />, count: pendingReview.length,    priority: 'base',  items: pendingReview },
    { id: 'correccion', label: 'Requieren corrección', icon: <XCircle size={13} />,        count: needsCorrection.length,  priority: 'warn',  items: needsCorrection },
    { id: 'posventa',   label: 'Listas para Posventa', icon: <CheckCircle2 size={13} />,   count: readyForPosventa.length, priority: 'ok',    items: readyForPosventa },
    { id: 'transito',   label: 'En tránsito',           icon: <Truck size={13} />,          count: inTransit.length,        priority: 'warn',  items: inTransit },
    { id: 'logistica',  label: 'Alertas logísticas',    icon: <AlertTriangle size={13} />,  count: logisticsAlerts.length,  priority: logisticsAlerts.some((i) => computeLogisticsAlerts(i).some((a) => a.priority === 'high' && a.targetRole !== 'posventa')) ? 'danger' : 'warn', items: logisticsAlerts },
    { id: 'retiro',     label: 'Retiro solicitado',     icon: <Package size={13} />,        count: pickupRequested.length,  priority: pickupRequested.length > 0 ? 'danger' : 'base', items: pickupRequested },
  ];

  const activeTabData = TABS.find((t) => t.id === activeTab) || TABS[0];
  const totalAlerts = needsCorrection.length + pickupRequested.length;

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Mesa de trabajo del gestor"
        description="Control interno, revisión, logística y preparación para Posventa."
        actions={
          <button type="button" onClick={load} className={erpBtnSecondary} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'erp-spin' : ''} /> Actualizar
          </button>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}
      {actionErr && <ErpNotice tone="error">{actionErr}</ErpNotice>}
      {actionMsg && <ErpNotice tone="success">{actionMsg}</ErpNotice>}

      {/* KPIs clickables — funcionan como tabs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Bandejas del gestor">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`text-left transition-all ${activeTab === tab.id ? 'ring-2 ring-[color:var(--primary)]' : ''}`}
          >
            <ErpKpiCard
              label={tab.label}
              value={tab.count}
              icon={tab.icon}
              variant={priorityKpiVariant(tab.priority)}
            />
          </button>
        ))}
      </section>

      {/* Alertas urgentes consolidadas */}
      {totalAlerts > 0 && (
        <ErpNotice tone="error" title={totalAlerts === 1 ? 'Hay 1 caso que requiere atención urgente' : `Hay ${totalAlerts} casos que requieren atención urgente`}>
          Revisalos primero antes de avanzar con el resto de la bandeja.
        </ErpNotice>
      )}

      {/* Contenido del tab activo */}
      <ErpCard
        title={
          <span className="inline-flex items-center gap-2">
            {activeTabData.icon}
            {activeTabData.label}
          </span>
        }
        subtitle={`${activeTabData.count} caso${activeTabData.count === 1 ? '' : 's'}`}
      >
        {loading && <ErpLoadingState />}

        {!loading && activeTabData.items.length === 0 && (
          <ErpEmptyState
            icon={<Package size={20} />}
            title="Sin casos en esta bandeja"
            description="Cuando aparezcan, los vas a ver acá ordenados por prioridad."
          />
        )}

        {!loading && activeTabData.items.length > 0 && (
          <div className="erp-stack-3">
            {activeTabData.items
              .sort((a, b) => {
                if (activeTab === 'revision') {
                  const aInProg = a.review_status === 'en_revision' ? 1 : 0;
                  const bInProg = b.review_status === 'en_revision' ? 1 : 0;
                  if (aInProg !== bInProg) return bInProg - aInProg;
                }
                const aHigh = computeLogisticsAlerts(a).some((al) => al.priority === 'high' && al.targetRole !== 'posventa');
                const bHigh = computeLogisticsAlerts(b).some((al) => al.priority === 'high' && al.targetRole !== 'posventa');
                if (aHigh && !bHigh) return -1;
                if (!aHigh && bHigh) return 1;
                return Number(b.dias_pendiente || 0) - Number(a.dias_pendiente || 0);
              })
              .map((item) =>
                (activeTab === 'revision' || activeTab === 'correccion') ? (
                  <ReviewActionCard
                    key={item.id_garantia}
                    item={item}
                    note={notes[item.id_garantia] || ''}
                    setNote={(v) => setNotes((p) => ({ ...p, [item.id_garantia]: v }))}
                    saving={savingId === item.id_garantia}
                    onTake={() => reviewAction(item.id_garantia, 'take')}
                    onApprove={() => reviewAction(item.id_garantia, 'approve')}
                    onIncomplete={() => reviewAction(item.id_garantia, 'incomplete')}
                    onDirectApprove={() => reviewAction(item.id_garantia, 'direct_approve')}
                    onDirectIncomplete={() => reviewAction(item.id_garantia, 'direct_incomplete')}
                  />
                ) : (
                  <GestorCard
                    key={item.id_garantia}
                    item={item}
                    onOpen={() => setDrawerId(item.id_garantia)}
                  />
                ),
              )}
          </div>
        )}
      </ErpCard>

      <WarrantyDetailDrawer
        open={drawerId !== null}
        warrantyId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => load()}
      />
    </div>
  );
}
