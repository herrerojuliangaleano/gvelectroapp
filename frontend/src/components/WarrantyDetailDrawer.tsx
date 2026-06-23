import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Copy, Eye, Mail, MapPin, MessageCircle, MessageSquareReply,
  PackageCheck, PencilLine, Phone, Send,
} from 'lucide-react';
import {
  can,
  cancelWarranty,
  changeWarrantyStatus,
  confirmWarrantyShipment,
  downloadRemitoPdf,
  fetchAvailableWarrantiesForProviderDelivery,
  fetchWarrantyDetail,
  generateProviderDeliveryRemito,
  registerWarrantyClaim,
  registerWarrantyProviderResponse,
  resendWarrantyProviderMail,
  resolveWarrantyProviderCorrection,
} from '../api/client';
import {
  ErpBadge,
  ErpButton,
  ErpConfirmDialog,
  ErpDrawer,
  ErpErrorState,
  ErpField,
  ErpInfoGrid,
  ErpInfoRow,
  ErpInput,
  ErpLoadingState,
  ErpNotice,
  ErpSelect,
  ErpTextarea,
  ErpTimeline,
  ErpTimelineItem,
  type ErpBadgeTone,
} from './ProUI';
import type { ProviderDeliveryWarranty, WarrantyDetailResponse } from '../types';
import {
  canManuallyChangeStatus,
  getManualStatusTransitions,
  getProviderResponseTypeMeta,
  getReviewStatusMeta,
  getWarrantyNextStep,
  getWarrantyStatusMeta,
  historyEventLabel,
} from '../warrantyFlow';

const CLOSED_STATUSES = ['8 - RECHAZADO', '9 - ANULADA', '10 - FINALIZADO'];
const RESUELTO = '7 - RESUELTO';
const RECHAZADO = '8 - RECHAZADO';
const RESOLUTION_TYPES = [
  { value: 'nota_credito', label: 'Nota de crédito' },
  { value: 'reparacion', label: 'Reparación' },
  { value: 'cambio_equipo', label: 'Cambio de equipo' },
];
// Qué pidió el proveedor cuando respondió. Define cómo sigue el flujo.
const PROVIDER_RESPONSE_TYPES = [
  { value: 'retiro', label: 'Solicitó retiro', hint: 'El proveedor pasa a retirar el equipo. Asegurate de que esté en Depósito Chiclana (si no, se marca como retiro urgente).' },
  { value: 'revision', label: 'Solicitó revisión', hint: 'Hay que enviarle el equipo al proveedor para que lo revise.' },
  { value: 'correccion', label: 'Pidió corrección', hint: 'El proveedor pide corregir datos/serie antes de continuar.' },
];

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

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => undefined);
}

type ActionKey = 'confirm' | 'response' | 'correction' | 'provider_remito' | 'resend' | 'claim' | 'status' | null;

export function WarrantyDetailDrawer({
  open,
  warrantyId,
  onClose,
  onChanged,
}: {
  open: boolean;
  warrantyId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<WarrantyDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [activeAction, setActiveAction] = useState<ActionKey>(null);
  const [working, setWorking] = useState(false);

  // Estados de form por acción
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmProvider, setConfirmProvider] = useState('');
  const [responseCaseId, setResponseCaseId] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [responseStatus, setResponseStatus] = useState('6 - RESPONDIDO POR PROVEEDOR');
  const [responsePickupDate, setResponsePickupDate] = useState('');
  // Tipo de respuesta del proveedor (retiro / revisión / corrección) + detalle.
  const [responseType, setResponseType] = useState('');
  // Correcciones pedidas por el proveedor, por ítem (keyed por row_number).
  const [itemCorrections, setItemCorrections] = useState<Record<number, string>>({});
  // Nota al cerrar una corrección pendiente (reenvío al proveedor).
  const [correctionResolveNote, setCorrectionResolveNote] = useState('');
  // Remito de entrega al proveedor (cuando el proveedor solicitó retiro y el equipo está en depósito).
  const [providerRemitoName, setProviderRemitoName] = useState('');
  const [providerRemitoNote, setProviderRemitoNote] = useState('');
  // El proveedor puede llevarse varios equipos: listamos los listos del mismo proveedor.
  const [providerRemitoOptions, setProviderRemitoOptions] = useState<ProviderDeliveryWarranty[]>([]);
  const [providerRemitoSelected, setProviderRemitoSelected] = useState<Set<string>>(new Set());
  const [providerRemitoLoading, setProviderRemitoLoading] = useState(false);
  const [resendNote, setResendNote] = useState('');
  const [claimNote, setClaimNote] = useState('');
  const [statusNew, setStatusNew] = useState('');
  const [statusNote, setStatusNote] = useState('');
  // Tipo de resolución cuando el estado pasa a "7 - RESUELTO".
  const [resolutionType, setResolutionType] = useState('');

  // Anular
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  function resetForms(detail?: WarrantyDetailResponse | null) {
    setActiveAction(null);
    setConfirmCode('');
    setConfirmProvider(detail?.summary.provider_name || '');
    setResponseCaseId(detail?.summary.id_de_caso || '');
    setResponseNote('');
    setResponseStatus('6 - RESPONDIDO POR PROVEEDOR');
    setResponsePickupDate('');
    setResponseType('');
    setItemCorrections({});
    setCorrectionResolveNote('');
    setProviderRemitoName(detail?.summary.provider_name || '');
    setProviderRemitoNote('');
    setProviderRemitoOptions([]);
    setProviderRemitoSelected(new Set());
    setProviderRemitoLoading(false);
    setResendNote('');
    setClaimNote('');
    setStatusNew('');
    setStatusNote('');
    setResolutionType('');
    setActionMessage(null);
    setActionError(null);
  }

  async function load(id: string) {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchWarrantyDetail(id);
      setData(detail);
      resetForms(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el detalle');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !warrantyId) return;
    setData(null);
    setCancelReason('');
    load(warrantyId);
  }, [open, warrantyId]);

  const providerName = data?.summary.provider_name || '';
  // Al abrir "Remito a proveedor", traemos las garantías listas para retiro del
  // MISMO proveedor (el proveedor puede llevarse varios equipos en una visita).
  useEffect(() => {
    if (activeAction !== 'provider_remito' || !warrantyId) return;
    let cancelled = false;
    setProviderRemitoLoading(true);
    fetchAvailableWarrantiesForProviderDelivery()
      .then((res) => {
        if (cancelled) return;
        const prov = providerName.trim().toLowerCase();
        const opts = res.items.filter(
          (w) => w.warranty_code === warrantyId || (w.provider_name || '').trim().toLowerCase() === prov,
        );
        setProviderRemitoOptions(opts);
        setProviderRemitoSelected(new Set([warrantyId]));
      })
      .catch(() => { if (!cancelled) { setProviderRemitoOptions([]); setProviderRemitoSelected(new Set([warrantyId])); } })
      .finally(() => { if (!cancelled) setProviderRemitoLoading(false); });
    return () => { cancelled = true; };
  }, [activeAction, warrantyId, providerName]);

  const summary = data?.summary;
  const statusMeta = summary ? getWarrantyStatusMeta(summary.estado) : null;
  const dias = summary?.dias_pendiente || 0;
  const diasSinResp = Number(summary?.dias_sin_respuesta || 0);
  const isDelayed = diasSinResp >= 15;
  const isWarning = diasSinResp >= 7 && diasSinResp < 15;

  // ── Disponibilidad de acciones según estado ─────────────────────────────
  const flags = useMemo(() => {
    if (!summary) return null;
    const estado = summary.estado || '';
    const isClosed = CLOSED_STATUSES.includes(estado);
    const isPendingConfirm = Boolean(summary.shipment_code) && !summary.fecha_envio_proveedor;
    const isApprovedPending = estado === '2 - PENDIENTE' && !summary.shipment_code;
    const hasProvider = Boolean(summary.provider_name || summary.fecha_envio_proveedor);
    const canTrack = hasProvider && !isApprovedPending && !isPendingConfirm && !isClosed;
    // Transiciones manuales válidas según el flujo canónico (warrantyFlow.ts).
    // Estados < 4 no permiten cambio manual: avanzan vía revisión, exportación o
    // confirmación de envío. Si no hay transiciones, NO mostramos la pill.
    const validTransitions = getManualStatusTransitions(estado);
    const allowManualStatus = canManuallyChangeStatus(estado);
    // El proveedor pidió corregir datos: queda marcado hasta que posventa corrige y reenvía.
    const hasPendingCorrection = summary.provider_response_type === 'correccion';

    return {
      isClosed,
      isPendingConfirm,
      isApprovedPending,
      validTransitions,
      hasPendingCorrection,
      // confirm: mail enviado al proveedor con el código del lote
      confirm: isPendingConfirm && can('warranties.manage_provider'),
      // response: registrar respuesta del proveedor
      response: canTrack && ['4 - ENVIADO AL PROVEEDOR', '5 - EN EL PROVEEDOR', '6 - RESPONDIDO POR PROVEEDOR'].includes(estado) && can('warranties.register_provider_response'),
      // correction: cerrar la corrección pedida por el proveedor (corregido + reenviado)
      correction: hasPendingCorrection && canTrack && can('warranties.register_provider_response'),
      // providerRemito: generar remito de entrega al proveedor (proveedor solicitó retiro y equipo en depósito)
      providerRemito: summary.estado_retiro_proveedor === 'listo_para_retiro' && !summary.remito_proveedor && can('warranties.remitos.provider_delivery'),
      // resend: mail reenviado (resetea contador) — solo en estado 4
      resend: estado === '4 - ENVIADO AL PROVEEDOR' && canTrack && can('warranties.register_claim'),
      // claim: reclamo
      claim: canTrack && ['4 - ENVIADO AL PROVEEDOR', '5 - EN EL PROVEEDOR', '6 - RESPONDIDO POR PROVEEDOR'].includes(estado) && can('warranties.register_claim'),
      // status: cambiar estado SOLO si hay transiciones manuales válidas
      status: allowManualStatus && can('warranties.change_status'),
      // cancel: anular
      cancel: !estado.toUpperCase().includes('ANULAD') && can('warranties.cancel'),
    };
  }, [summary]);

  // Texto del "próximo paso" del flujo — sirve como guía cuando no hay
  // acción manual disponible para avanzar (ej. estado 2 → 3 vía ENV).
  const nextStepHint = summary && !flags?.isClosed ? getWarrantyNextStep(summary) : null;

  // Acciones disponibles para mostrar como pills
  const actionPills: { key: Exclude<ActionKey, null>; label: string; icon: JSX.Element; tone: 'primary' | 'success' | 'warning' | 'info' | 'neutral' }[] = [];
  if (flags?.confirm) actionPills.push({ key: 'confirm', label: 'Confirmar envío', icon: <PackageCheck size={13} />, tone: 'warning' });
  if (flags?.resend) actionPills.push({ key: 'resend', label: 'Mail reenviado', icon: <Send size={13} />, tone: 'info' });
  if (flags?.response) actionPills.push({ key: 'response', label: 'Respuesta proveedor', icon: <MessageSquareReply size={13} />, tone: 'success' });
  if (flags?.correction) actionPills.push({ key: 'correction', label: 'Corrección aplicada', icon: <CheckCircle2 size={13} />, tone: 'primary' });
  if (flags?.providerRemito) actionPills.push({ key: 'provider_remito', label: 'Remito a proveedor', icon: <PackageCheck size={13} />, tone: 'primary' });
  if (flags?.claim) actionPills.push({ key: 'claim', label: 'Reclamo', icon: <MessageSquareReply size={13} />, tone: 'warning' });
  if (flags?.status) actionPills.push({ key: 'status', label: 'Cambiar estado', icon: <ArrowRight size={13} />, tone: 'neutral' });

  // ── Submit handlers ──────────────────────────────────────────────────────
  async function runAction(action: Exclude<ActionKey, null>) {
    if (!warrantyId) return;
    setWorking(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (action === 'confirm') {
        await confirmWarrantyShipment(warrantyId, {
          shipment_code: confirmCode.trim(),
          provider_name: confirmProvider.trim() || undefined,
        });
        setActionMessage('Envío confirmado.');
      } else if (action === 'response') {
        const corrections = Object.entries(itemCorrections)
          .map(([rn, n]) => ({ row_number: Number(rn), note: n.trim() }))
          .filter((c) => c.note);
        if (responseType === 'correccion' && corrections.length === 0) {
          setActionError('Indicá qué pidió corregir el proveedor en al menos un ítem.');
          setWorking(false);
          return;
        }
        await registerWarrantyProviderResponse(warrantyId, {
          fecha_retiro_acordada: responseType === 'retiro' && responsePickupDate ? responsePickupDate : undefined,
          provider_case_id: responseCaseId.trim() || undefined,
          note: responseNote.trim() || undefined,
          estado: responseStatus || '6 - RESPONDIDO POR PROVEEDOR',
          response_type: responseType || undefined,
          item_corrections: responseType === 'correccion' ? corrections : undefined,
        });
        setActionMessage('Respuesta del proveedor registrada.');
      } else if (action === 'correction') {
        await resolveWarrantyProviderCorrection(warrantyId, {
          note: correctionResolveNote.trim() || undefined,
        });
        setActionMessage('Corrección aplicada. Se reenvió al proveedor y volvió a "esperando respuesta".');
      } else if (action === 'provider_remito') {
        if (!providerRemitoName.trim()) { setActionError('Indicá el nombre del proveedor.'); setWorking(false); return; }
        const codes = providerRemitoSelected.size > 0 ? Array.from(providerRemitoSelected) : [warrantyId];
        const res = await generateProviderDeliveryRemito({
          warranty_codes: codes,
          proveedor: providerRemitoName.trim(),
          nota: providerRemitoNote.trim() || undefined,
        });
        setActionMessage(codes.length > 1 ? `Remito de entrega generado con ${codes.length} garantías.` : 'Remito de entrega al proveedor generado.');
        // Abre el PDF del remito en nueva ventana para imprimir directo.
        const newCode = res.remito_code || res.remitos?.[0]?.remito_code;
        if (newCode) {
          try {
            const blob = await downloadRemitoPdf(newCode);
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          } catch (pdfErr) {
            console.warn('No se pudo abrir el PDF del remito al proveedor:', pdfErr);
          }
        }
      } else if (action === 'resend') {
        await resendWarrantyProviderMail(warrantyId, {
          note: resendNote.trim() || undefined,
        });
        setActionMessage('Mail reenviado. Se reinició el contador de días sin respuesta.');
      } else if (action === 'claim') {
        if (!claimNote.trim()) { setActionError('La nota del reclamo es obligatoria.'); setWorking(false); return; }
        await registerWarrantyClaim(warrantyId, { note: claimNote.trim() });
        setActionMessage('Reclamo registrado.');
      } else if (action === 'status') {
        if (!statusNew) { setActionError('Elegí un estado nuevo.'); setWorking(false); return; }
        if (statusNew === RESUELTO && !resolutionType) {
          setActionError('Elegí el tipo de resolución (nota de crédito, reparación o cambio).');
          setWorking(false);
          return;
        }
        await changeWarrantyStatus(warrantyId, {
          estado: statusNew,
          note: statusNote.trim() || undefined,
          // Tipo de resolución cuando se marca Resuelto.
          resultado_resolucion: statusNew === RESUELTO ? resolutionType : undefined,
          // Para Rechazado, la nota cumple de razón (opcional).
          resolution_note: statusNew === RESUELTO ? (statusNote.trim() || undefined) : undefined,
        });
        setActionMessage('Estado actualizado.');
      }
      await load(warrantyId);
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo completar la acción');
    } finally {
      setWorking(false);
    }
  }

  async function doCancel() {
    if (!warrantyId || !cancelReason.trim()) return;
    setWorking(true);
    setActionError(null);
    try {
      await cancelWarranty(warrantyId, { reason: cancelReason.trim() });
      setConfirmCancelOpen(false);
      setCancelReason('');
      onChanged?.();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo anular');
    } finally {
      setWorking(false);
    }
  }

  const codeMatches = summary?.shipment_code
    ? confirmCode.trim().toUpperCase() === (summary.shipment_code || '').toUpperCase()
    : false;

  return (
    <>
      <ErpDrawer
        open={open}
        onClose={onClose}
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">Garantía</span>
            {statusMeta && (
              <ErpBadge tone={flowToneToBadgeTone(statusMeta.tone)}>{statusMeta.shortLabel || summary?.estado}</ErpBadge>
            )}
            {summary?.review_status && (
              <ErpBadge tone={flowToneToBadgeTone(getReviewStatusMeta(summary.review_status).tone)}>
                {summary.review_status_label || getReviewStatusMeta(summary.review_status).label}
              </ErpBadge>
            )}
            {summary?.provider_response_type && (
              <ErpBadge tone={flowToneToBadgeTone(getProviderResponseTypeMeta(summary.provider_response_type)?.tone)}>
                {summary.provider_response_type_label || getProviderResponseTypeMeta(summary.provider_response_type)?.label || summary.provider_response_type}
              </ErpBadge>
            )}
            {diasSinResp > 0 && (
              <ErpBadge tone={isDelayed ? 'solid-danger' : isWarning ? 'warning' : 'neutral'}>
                {diasSinResp} día{diasSinResp === 1 ? '' : 's'} s/r
              </ErpBadge>
            )}
          </div>
        }
        subtitle={
          summary ? (
            <div className="mt-1.5">
              <div className="text-[15px] font-semibold text-[color:var(--text)] leading-tight">
                <span className="font-mono">{summary.id_garantia}</span> · {summary.producto_principal || 'Sin producto'}
              </div>
              <div className="mt-0.5 text-[12.5px] text-[color:var(--text-2)]">
                {[summary.cliente_nombre, summary.cliente_telefono, summary.sucursal].filter(Boolean).join(' · ') || 'Sin datos de cliente'}
              </div>
            </div>
          ) : (
            <span>Cargando…</span>
          )
        }
        headerActions={
          warrantyId && (
            <>
              <button type="button" className="erp-btn erp-btn-secondary erp-btn-sm" onClick={() => copyText(warrantyId)} title="Copiar ID">
                <Copy size={13} /> Copiar
              </button>
              <Link
                to={`/warranties/${encodeURIComponent(warrantyId)}`}
                className="erp-btn erp-btn-secondary erp-btn-sm"
                onClick={onClose}
              >
                <PencilLine size={13} /> Editar completo
              </Link>
              <Link
                to={`/warranties/${encodeURIComponent(warrantyId)}`}
                className="erp-btn erp-btn-primary erp-btn-sm"
                onClick={onClose}
              >
                <Eye size={13} /> Abrir
              </Link>
            </>
          )
        }
        footer={
          flags?.cancel && (
            <button
              type="button"
              className="erp-btn erp-btn-danger erp-btn-sm"
              onClick={() => {
                const reason = window.prompt('Motivo de anulación (obligatorio):', '');
                if (!reason || !reason.trim()) return;
                setCancelReason(reason.trim());
                setConfirmCancelOpen(true);
              }}
            >
              Anular garantía
            </button>
          )
        }
      >
        {loading && <ErpLoadingState />}
        {!loading && error && <ErpErrorState description={error} retry={() => warrantyId && load(warrantyId)} />}
        {!loading && !error && data && summary && flags && (
          <div className="erp-stack-4">
            {/* Mensajes de acción */}
            {actionMessage && <ErpNotice tone="success">{actionMessage}</ErpNotice>}
            {actionError && <ErpNotice tone="error">{actionError}</ErpNotice>}

            {/* Notice contextual de demora */}
            {isDelayed && (
              <ErpNotice tone="error" title={`Sin respuesta del proveedor hace ${diasSinResp} días`}>
                Se recomienda escalar el reclamo. {summary.fecha_ultimo_reclamo ? `Último reclamo: ${summary.fecha_ultimo_reclamo}.` : ''}
              </ErpNotice>
            )}
            {!isDelayed && isWarning && (
              <ErpNotice tone="warning" title={`${diasSinResp} días sin respuesta`}>
                Se acerca al umbral de 15 días. Considerá un recordatorio al proveedor.
              </ErpNotice>
            )}
            {summary.review_status === 'requiere_correccion' && (
              <ErpNotice tone="warning" title="Requiere corrección">
                {summary.review_note || 'El revisor devolvió esta garantía con observaciones.'}
              </ErpNotice>
            )}
            {summary.provider_response_type === 'correccion' && (
              <ErpNotice tone="warning" title="El proveedor pidió corrección">
                {data.rows.some((r) => r.correction_note) ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {data.rows.filter((r) => r.correction_note).map((r) => (
                      <li key={r.row_number}>
                        <span className="font-medium">{[r.producto, r.serie ? `S/N ${r.serie}` : ''].filter(Boolean).join(' · ') || 'Ítem'}</span>: {r.correction_note}
                      </li>
                    ))}
                  </ul>
                ) : (
                  summary.provider_correction_note || 'Corregí los datos y reenviá la información al proveedor.'
                )}
              </ErpNotice>
            )}
            {flags.isPendingConfirm && (
              <ErpNotice tone="info" title="Lote generado, esperando confirmación de mail enviado">
                El lote <strong className="font-mono">{summary.shipment_code}</strong> fue creado. Confirmá el envío del mail desde el panel de acciones.
              </ErpNotice>
            )}

            {/* Próximo paso del flujo — guía cuando el cambio de estado no es manual.
                Aparece si no hay pills disponibles (estados 1, 2 sin lote, etc.)
                o si la única acción es informativa. */}
            {nextStepHint && actionPills.length === 0 && !flags.isPendingConfirm && (
              <ErpNotice tone="info" title="Próximo paso">
                {nextStepHint}
                {summary.estado === '2 - PENDIENTE' && !summary.shipment_code && can('warranties.export') && (
                  <div className="mt-2">
                    <Link to="/warranties/export" className="erp-btn erp-btn-primary erp-btn-sm">
                      <ArrowRight size={13} /> Ir a Exportación
                    </Link>
                  </div>
                )}
                {summary.estado === '1 - INGRESO' && can('warranties.review') && (
                  <div className="mt-2">
                    <Link to="/warranties/gestor" className="erp-btn erp-btn-primary erp-btn-sm">
                      <ArrowRight size={13} /> Ir a Revisión
                    </Link>
                  </div>
                )}
              </ErpNotice>
            )}

            {/* Panel de acciones — pills + form contextual */}
            {actionPills.length > 0 && (
              <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">
                  Acciones disponibles
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {actionPills.map((pill) => (
                    <button
                      key={pill.key}
                      type="button"
                      onClick={() => { setActiveAction((prev) => prev === pill.key ? null : pill.key); setActionError(null); setActionMessage(null); }}
                      className={`erp-btn erp-btn-sm ${activeAction === pill.key ? 'erp-btn-primary' : 'erp-btn-secondary'}`}
                    >
                      {pill.icon}
                      <span>{pill.label}</span>
                    </button>
                  ))}
                </div>

                {/* Forms expandidos según activeAction */}
                {activeAction === 'confirm' && flags.confirm && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpField
                      label="Código de lote"
                      hint={`Ingresá el código del lote para confirmar que el mail fue enviado. Lote actual: ${summary.shipment_code || '—'}`}
                      required
                    >
                      <ErpInput
                        value={confirmCode}
                        onChange={(e) => setConfirmCode(e.target.value.toUpperCase())}
                        placeholder={summary.shipment_code || 'ENV-...'}
                        style={{ fontFamily: 'ui-monospace, monospace' }}
                        invalid={!!confirmCode && !codeMatches}
                      />
                    </ErpField>
                    <ErpField label="Nombre del proveedor (opcional)">
                      <ErpInput value={confirmProvider} onChange={(e) => setConfirmProvider(e.target.value)} placeholder="Ej. Samsung AR Service" />
                    </ErpField>
                    <div className="flex justify-end">
                      <ErpButton
                        variant="primary"
                        disabled={!codeMatches || working}
                        loading={working}
                        onClick={() => runAction('confirm')}
                        leftIcon={<Send size={13} />}
                      >
                        Confirmar envío al proveedor
                      </ErpButton>
                    </div>
                  </div>
                )}

                {activeAction === 'response' && flags.response && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpField label="¿Qué pidió el proveedor?" hint="Define cómo sigue el flujo. Para marcar Resuelto / Rechazado usá “Cambiar estado”.">
                      <ErpSelect value={responseType} onChange={(e) => { setResponseType(e.target.value); if (e.target.value !== 'correccion') setItemCorrections({}); }}>
                        <option value="">Solo registrar respuesta</option>
                        {PROVIDER_RESPONSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </ErpSelect>
                    </ErpField>
                    {responseType && (
                      <ErpNotice tone={responseType === 'correccion' ? 'warning' : 'info'}>
                        {PROVIDER_RESPONSE_TYPES.find((t) => t.value === responseType)?.hint}
                      </ErpNotice>
                    )}
                    {responseType === 'retiro' && (
                      <ErpField label="Fecha acordada de retiro (opcional)" hint="Cuándo dijo el proveedor que pasa a buscar el equipo. Si no la sabés todavía, podés dejarla vacía y completarla después.">
                        <ErpInput
                          type="date"
                          value={responsePickupDate}
                          onChange={(e) => setResponsePickupDate(e.target.value)}
                        />
                      </ErpField>
                    )}
                    {responseType === 'correccion' && (
                      <div className="erp-stack-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-3)]">
                          ¿Qué hay que corregir? {data.rows.length > 1 ? '(por ítem)' : ''}
                        </div>
                        {data.rows.map((r) => (
                          <ErpField
                            key={r.row_number}
                            label={[r.producto || 'Ítem', r.serie ? `S/N ${r.serie}` : ''].filter(Boolean).join(' · ')}
                          >
                            <ErpInput
                              value={itemCorrections[r.row_number] || ''}
                              onChange={(e) => setItemCorrections((prev) => ({ ...prev, [r.row_number]: e.target.value }))}
                              placeholder="Ej: el N° de serie no coincide; falta foto de la etiqueta…"
                            />
                          </ErpField>
                        ))}
                      </div>
                    )}
                    <ErpField label="ID de caso del proveedor (opcional)">
                      <ErpInput value={responseCaseId} onChange={(e) => setResponseCaseId(e.target.value)} placeholder="Ej. SMS-AR-44218" />
                    </ErpField>
                    <ErpField label="Nota (opcional)">
                      <ErpTextarea value={responseNote} onChange={(e) => setResponseNote(e.target.value)} rows={2} placeholder="Resumen de la respuesta del proveedor..." />
                    </ErpField>
                    <div className="flex justify-end">
                      <ErpButton variant="primary" disabled={responseType === 'correccion' && !Object.values(itemCorrections).some((v) => v.trim())} loading={working} onClick={() => runAction('response')} leftIcon={<MessageSquareReply size={13} />}>
                        Registrar respuesta
                      </ErpButton>
                    </div>
                  </div>
                )}

                {activeAction === 'correction' && flags.correction && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpNotice tone="warning" title="Corrección pedida por el proveedor">
                      {summary.provider_correction_note || 'El proveedor pidió corregir datos antes de continuar.'}
                    </ErpNotice>
                    <p className="text-[12px] text-[color:var(--text-2)] leading-[1.5]">
                      Corregí los datos con “Editar completo” y luego confirmá acá. Se reenvía al proveedor y la garantía vuelve a “Enviado · esperando respuesta”.
                    </p>
                    <ErpField label="Nota (opcional)">
                      <ErpTextarea value={correctionResolveNote} onChange={(e) => setCorrectionResolveNote(e.target.value)} rows={2} placeholder="Qué se corrigió y cómo se reenvió…" />
                    </ErpField>
                    <div className="flex justify-end">
                      <ErpButton variant="primary" loading={working} onClick={() => runAction('correction')} leftIcon={<CheckCircle2 size={13} />}>
                        Corrección aplicada → reenviar
                      </ErpButton>
                    </div>
                  </div>
                )}

                {activeAction === 'provider_remito' && flags.providerRemito && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpNotice tone="info">
                      El proveedor solicitó el retiro y el equipo está en el depósito. Generá el remito de entrega (depósito → proveedor). Si el proveedor se lleva varios equipos, marcalos todos.
                    </ErpNotice>
                    <ErpField label="Proveedor" required>
                      <ErpInput value={providerRemitoName} onChange={(e) => setProviderRemitoName(e.target.value)} placeholder="Ej. Samsung AR Service" />
                    </ErpField>
                    <ErpField label={`Garantías a incluir${providerRemitoSelected.size > 0 ? ` (${providerRemitoSelected.size})` : ''}`} hint="Listas para retiro del mismo proveedor. La actual viene marcada.">
                      {providerRemitoLoading ? (
                        <div className="text-[12.5px] text-[color:var(--text-3)]">Buscando garantías listas…</div>
                      ) : providerRemitoOptions.length === 0 ? (
                        <div className="text-[12.5px] text-[color:var(--text-3)]">Solo esta garantía está lista para retiro.</div>
                      ) : (
                        <div className="erp-stack-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1.5">
                          {providerRemitoOptions.map((w) => {
                            const checked = providerRemitoSelected.has(w.warranty_code);
                            const isCurrent = w.warranty_code === warrantyId;
                            return (
                              <label
                                key={w.warranty_code}
                                className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition ${checked ? 'bg-[color:var(--primary-soft)]' : 'hover:bg-[color:var(--surface-hover)]'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={checked}
                                  disabled={isCurrent}
                                  onChange={(e) => {
                                    setProviderRemitoSelected((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(w.warranty_code);
                                      else next.delete(w.warranty_code);
                                      return next;
                                    });
                                  }}
                                />
                                <span className="min-w-0">
                                  <span className="font-mono text-[color:var(--text)]">{w.warranty_code}</span>
                                  {isCurrent && <span className="ml-1 text-[10.5px] text-[color:var(--text-3)]">(actual)</span>}
                                  <span className="block truncate text-[color:var(--text-2)]">
                                    {[w.producto, w.serie ? `S/N ${w.serie}` : ''].filter(Boolean).join(' · ') || '—'}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </ErpField>
                    <ErpField label="Nota (opcional)">
                      <ErpTextarea value={providerRemitoNote} onChange={(e) => setProviderRemitoNote(e.target.value)} rows={2} placeholder="Remito de retiro, contacto, día acordado…" />
                    </ErpField>
                    <div className="flex justify-end">
                      <ErpButton variant="primary" disabled={!providerRemitoName.trim() || providerRemitoSelected.size === 0} loading={working} onClick={() => runAction('provider_remito')} leftIcon={<PackageCheck size={13} />}>
                        Generar remito a proveedor{providerRemitoSelected.size > 1 ? ` (${providerRemitoSelected.size})` : ''}
                      </ErpButton>
                    </div>
                  </div>
                )}

                {activeAction === 'resend' && flags.resend && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpNotice tone="info">
                      Confirmar reenvío del mail al proveedor. Reinicia el contador de días sin respuesta.
                    </ErpNotice>
                    <ErpField label="Nota (opcional)">
                      <ErpTextarea value={resendNote} onChange={(e) => setResendNote(e.target.value)} rows={2} placeholder="Detalle del reenvío..." />
                    </ErpField>
                    <div className="flex justify-end">
                      <ErpButton variant="primary" loading={working} onClick={() => runAction('resend')} leftIcon={<Send size={13} />}>
                        Confirmar mail reenviado
                      </ErpButton>
                    </div>
                  </div>
                )}

                {activeAction === 'claim' && flags.claim && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpField label="Nota del reclamo" required>
                      <ErpTextarea value={claimNote} onChange={(e) => setClaimNote(e.target.value)} rows={3} placeholder="Detalle del reclamo, mail enviado, etc." />
                    </ErpField>
                    <div className="flex justify-end">
                      <ErpButton variant="primary" loading={working} onClick={() => runAction('claim')} leftIcon={<MessageSquareReply size={13} />}>
                        Registrar reclamo
                      </ErpButton>
                    </div>
                  </div>
                )}

                {activeAction === 'status' && flags.status && (
                  <div className="mt-3 erp-stack-3 border-t border-[color:var(--divider)] pt-3">
                    <ErpField label="Nuevo estado" required hint="Solo se listan los estados a los que se puede transicionar manualmente desde el estado actual.">
                      <ErpSelect value={statusNew} onChange={(e) => { setStatusNew(e.target.value); if (e.target.value !== RESUELTO) setResolutionType(''); }}>
                        <option value="">— Elegí estado —</option>
                        {flags.validTransitions.map((st) => (
                          <option key={st} value={st}>{getWarrantyStatusMeta(st).shortLabel || st}</option>
                        ))}
                      </ErpSelect>
                    </ErpField>

                    {/* Tipo de resolución cuando se marca Resuelto */}
                    {statusNew === RESUELTO && (
                      <ErpField label="Tipo de resolución" required hint="Cómo lo resolvió el proveedor. Los detalles (NC, reparación, reemplazo) se completan en la edición completa.">
                        <ErpSelect value={resolutionType} onChange={(e) => setResolutionType(e.target.value)}>
                          <option value="">— Elegí tipo —</option>
                          {RESOLUTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </ErpSelect>
                      </ErpField>
                    )}

                    <ErpField label={statusNew === RECHAZADO ? 'Razón / observación (opcional)' : 'Nota (opcional)'}>
                      <ErpTextarea
                        value={statusNote}
                        onChange={(e) => setStatusNote(e.target.value)}
                        rows={2}
                        placeholder={statusNew === RECHAZADO ? 'Ej: daño por mal uso, fuera de garantía…' : statusNew === RESUELTO ? 'Detalle breve de la resolución…' : 'Motivo del cambio…'}
                      />
                    </ErpField>

                    <div className="flex justify-end">
                      <ErpButton variant="primary" disabled={!statusNew || (statusNew === RESUELTO && !resolutionType)} loading={working} onClick={() => runAction('status')} leftIcon={<ArrowRight size={13} />}>
                        Aplicar cambio
                      </ErpButton>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Acciones rápidas de contacto (móvil-first, también útiles en desktop) */}
            {(summary.cliente_telefono || summary.cliente_email) && (
              <div className="erp-contact-actions">
                {summary.cliente_telefono && (
                  <a
                    href={`tel:${summary.cliente_telefono.replace(/\s+/g, '')}`}
                    className="erp-contact-btn erp-contact-btn-call"
                    aria-label={`Llamar a ${summary.cliente_nombre || 'cliente'}`}
                  >
                    <Phone size={14} /> Llamar
                  </a>
                )}
                {summary.cliente_email && (
                  <a
                    href={`mailto:${summary.cliente_email}?subject=${encodeURIComponent(`Garantía ${summary.id_garantia}`)}`}
                    className="erp-contact-btn erp-contact-btn-email"
                    aria-label={`Email a ${summary.cliente_nombre || 'cliente'}`}
                  >
                    <Mail size={14} /> Email
                  </a>
                )}
                {summary.cliente_telefono && (
                  <a
                    href={`https://wa.me/${summary.cliente_telefono.replace(/[^\d]/g, '')}?text=${encodeURIComponent(`Hola ${summary.cliente_nombre || ''}, te contactamos por tu garantía ${summary.id_garantia}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="erp-contact-btn erp-contact-btn-whatsapp"
                    aria-label="WhatsApp"
                  >
                    <MessageCircle size={14} /> WhatsApp
                  </a>
                )}
              </div>
            )}

            {/* Grid de datos clave */}
            <ErpInfoGrid columns={2}>
              <ErpInfoRow label="Producto" value={<span className="block">{summary.producto_principal || '—'}{summary.cantidad_items > 1 && <span className="text-[color:var(--text-3)]"> · {summary.cantidad_items} ítems</span>}</span>} />
              <ErpInfoRow label="N.º de serie" value={<span className="font-mono">{summary.serie || '—'}</span>} />
              <ErpInfoRow label="Sucursal venta" value={summary.sucursal_responsable || summary.sucursal || '—'} />
              <ErpInfoRow label="Vendedor" value={summary.responsable || '—'} />
              <ErpInfoRow label="Proveedor" value={summary.provider_name || '—'} />
              <ErpInfoRow label="ID caso proveedor" value={summary.id_de_caso || '—'} />
              <ErpInfoRow label="Ingreso" value={<span className="tabular-nums">{summary.ingreso || '—'}</span>} />
              <ErpInfoRow
                label="Último contacto proveedor"
                value={
                  summary.fecha_ultima_respuesta || summary.fecha_ultimo_reclamo
                    ? <span className={`tabular-nums ${isDelayed ? 'text-[color:var(--danger-soft-text)]' : ''}`}>{summary.fecha_ultima_respuesta || summary.fecha_ultimo_reclamo}</span>
                    : '—'
                }
              />
              <ErpInfoRow
                label="Lugar actual"
                value={
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} className="text-[color:var(--text-3)]" />
                    {summary.ubicacion_actual_label || summary.lugar_llegada || summary.deposito || '—'}
                  </span>
                }
              />
              <ErpInfoRow label="Lote ENV" value={summary.shipment_code ? <span className="font-mono">{summary.shipment_code}</span> : '—'} />
            </ErpInfoGrid>

            {summary.falla && (
              <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-1">Falla reportada</div>
                <div className="text-[12.5px] text-[color:var(--text)] leading-[1.55]">{summary.falla}</div>
              </div>
            )}

            {/* Historial */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-[color:var(--text)]">Historial</h3>
                <span className="text-[11.5px] text-[color:var(--text-3)] tabular-nums">{data.history.length} evento{data.history.length === 1 ? '' : 's'}</span>
              </div>
              {data.history.length === 0 ? (
                <div className="text-[12.5px] text-[color:var(--text-3)]">Todavía no hay movimientos registrados.</div>
              ) : (
                <ErpTimeline>
                  {data.history.map((event, idx) => {
                    const details = event.details as Record<string, unknown> | undefined;
                    const oldStatus = details?.old_status as string | undefined;
                    const newStatus = details?.new_status as string | undefined;
                    const dotState: 'now' | 'err' | 'warn' | 'default' =
                      idx === 0 ? 'now'
                      : event.status === 'error' ? 'err'
                      : event.event_type.includes('cancel') || event.event_type.includes('reject') ? 'err'
                      : event.event_type.includes('incomplete') || event.event_type.includes('warning') || event.event_type.includes('recordatorio') ? 'warn'
                      : 'default';
                    return (
                      <ErpTimelineItem
                        key={event.id}
                        state={dotState}
                        title={
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span>{historyEventLabel(event.event_type)}</span>
                            {oldStatus && newStatus && (
                              <span className="text-[11.5px] font-normal text-[color:var(--text-3)]">
                                {getWarrantyStatusMeta(oldStatus).shortLabel} <ArrowRight size={9} className="inline align-middle" /> <span className="text-[color:var(--text-2)]">{getWarrantyStatusMeta(newStatus).shortLabel}</span>
                              </span>
                            )}
                          </span>
                        }
                        meta={
                          <>
                            <span>{event.created_at}</span>
                            {(event.actor_display_name || event.actor_username) && <span> · {event.actor_display_name || event.actor_username}</span>}
                          </>
                        }
                        note={event.message || undefined}
                      />
                    );
                  })}
                </ErpTimeline>
              )}
            </div>
          </div>
        )}
      </ErpDrawer>

      <ErpConfirmDialog
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        onConfirm={doCancel}
        title="Anular garantía"
        tone="warning"
        confirmLabel="Sí, anular"
        cancelLabel="Volver"
        loading={working}
        body={
          <>
            La garantía <strong className="font-mono">{warrantyId}</strong> se marcará como anulada y quedará registrada en historial con el motivo:
            <div className="mt-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5 text-[12.5px] italic">
              {cancelReason || 'Sin motivo'}
            </div>
          </>
        }
      />
    </>
  );
}
