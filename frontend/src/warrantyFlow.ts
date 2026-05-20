import type { WarrantySummary } from './types';

export type FlowTone = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

// ─── Logistics alert system ───────────────────────────────────────────────────

export const ALERT_THRESHOLDS = {
  transit_delay_medium:    2,   // días en tránsito para alerta media
  transit_delay_high:      4,   // días en tránsito para alerta alta
  review_pending_medium:   1,   // días sin revisar para alerta media
  aftersales_ready_medium: 2,   // días revisada sin pasar a Posventa
  provider_no_response:    7,   // días sin respuesta proveedor (alerta Posventa)
  provider_no_response_high: 15, // días sin respuesta → alta prioridad
} as const;

export type AlertPriority = 'high' | 'medium' | 'low';
export type AlertTargetRole = 'gestor' | 'encargado' | 'posventa' | 'all';

export interface LogisticsAlert {
  type: string;
  priority: AlertPriority;
  message: string;
  action: string;
  targetRole: AlertTargetRole;
}

const FINAL_ESTADOS = new Set(['10 - FINALIZADO', '9 - ANULADA', '8 - RECHAZADO']);

function normUbicacion(value?: string | null): string {
  return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

function isAtDeposit(item: Pick<WarrantySummary, 'transit_status' | 'ubicacion_actual'>): boolean {
  const loc = normUbicacion(item.ubicacion_actual);
  return item.transit_status === 'en_deposito' || loc === 'DEPOSITO' || loc.startsWith('DEPOSITO ');
}

export function computeLogisticsAlerts(item: WarrantySummary): LogisticsAlert[] {
  const alerts: LogisticsAlert[] = [];
  if (FINAL_ESTADOS.has(item.estado || '') || item.cancelled) return alerts;

  const dias = Number(item.dias_pendiente || 0);
  const diasSinResp = Number(item.dias_sin_respuesta || 0);
  const inTransit = item.transit_status === 'en_transito';
  const inDeposit = isAtDeposit(item);
  const atProvider = item.ubicacion_actual === 'proveedor' || item.ubicacion_actual === 'en_transito_proveedor';

  // 1. Producto necesita moverse de sucursal a depósito
  if (
    item.origen_ingreso === 'sucursal' &&
    !inTransit && !inDeposit && !atProvider &&
    !['8 - RECHAZADO', '9 - ANULADA', '10 - FINALIZADO'].includes(item.estado || '')
  ) {
    alerts.push({
      type: 'needs_transfer',
      priority: item.estado_retiro_proveedor === 'retiro_solicitado' ? 'high' : 'medium',
      message: `Equipo en ${item.sucursal || 'sucursal'} — debe enviarse a depósito`,
      action: 'Generar remito interno',
      targetRole: 'encargado',
    });
  }

  // 2. En tránsito (puede estar demorado)
  if (inTransit) {
    const isHigh = dias >= ALERT_THRESHOLDS.transit_delay_high;
    alerts.push({
      type: isHigh ? 'transit_delayed' : 'transit_active',
      priority: isHigh ? 'high' : 'medium',
      message: isHigh
        ? `Tránsito demorado — ${dias} días sin confirmar llegada`
        : `Producto en tránsito a depósito`,
      action: 'Confirmar llegada a depósito',
      targetRole: 'gestor',
    });
  }

  // 3. Retiro proveedor solicitado
  if (item.estado_retiro_proveedor === 'retiro_solicitado') {
    alerts.push({
      type: 'pickup_needed',
      priority: 'high',
      message: inDeposit
        ? 'Proveedor solicitó retiro — equipo listo en depósito'
        : 'URGENTE: proveedor solicitó retiro — equipo NO está en depósito',
      action: inDeposit ? 'Coordinar entrega al proveedor' : 'Enviar a depósito urgente',
      targetRole: 'gestor',
    });
  }

  // 4. Pendiente de revisión demorada
  const reviewPending = !item.review_status || item.review_status === 'pendiente_revision';
  if (reviewPending && dias >= ALERT_THRESHOLDS.review_pending_medium) {
    alerts.push({
      type: 'review_delayed',
      priority: 'medium',
      message: `Sin revisar hace ${dias} días`,
      action: 'Revisar garantía',
      targetRole: 'gestor',
    });
  }

  // 5. Revisada pero sin pasar a Posventa
  if (item.review_status === 'revisada' && item.estado === '1 - INGRESO' && dias >= ALERT_THRESHOLDS.aftersales_ready_medium) {
    alerts.push({
      type: 'ready_for_aftersales',
      priority: 'medium',
      message: `Revisada y lista para Posventa hace ${dias} días`,
      action: 'Pasar a estado Pendiente',
      targetRole: 'gestor',
    });
  }

  // 6. Sin respuesta del proveedor (alerta Posventa)
  if (
    diasSinResp >= ALERT_THRESHOLDS.provider_no_response &&
    ['4 - ENVIADO AL PROVEEDOR', '5 - EN EL PROVEEDOR'].includes(item.estado || '')
  ) {
    alerts.push({
      type: 'no_provider_response',
      priority: diasSinResp >= ALERT_THRESHOLDS.provider_no_response_high ? 'high' : 'medium',
      message: `${diasSinResp} días sin respuesta del proveedor`,
      action: 'Reclamar al proveedor',
      targetRole: 'posventa',
    });
  }

  return alerts;
}

// ─── Unified history event labels ────────────────────────────────────────────

export const HISTORY_EVENT_LABELS: Record<string, string> = {
  // Garantía
  warranty_created:                 'Garantía creada',
  warranty_updated:                 'Garantía actualizada',
  warranty_finalized:               'Garantía finalizada',
  warranty_cancelled:               'Garantía anulada',
  warranty_deleted:                 'Garantía eliminada',
  created:                          'Garantía creada',
  cancelled:                        'Garantía anulada',
  entry_updated:                    'Datos de ingreso actualizados',
  // Revisión
  review_taken:                     'Tomada en revisión interna',
  review_approved:                  'Revisión aprobada',
  review_incomplete:                'Corrección solicitada',
  review_started:                   'Revisión iniciada',
  // Estado
  status_changed:                   'Estado actualizado',
  status_change:                    'Estado actualizado',
  // Proveedor
  sent_to_provider:                 'Enviado al proveedor',
  provider_notified:                'Mail enviado al proveedor',
  provider_mail_resent:             'Mail reenviado al proveedor',
  provider_response_registered:     'Respuesta del proveedor registrada',
  provider_pickup_requested:        'Retiro solicitado por proveedor',
  claim_registered:                 'Reclamo registrado',
  resolution_set:                   'Resolución definida',
  // Remitos
  provider_delivery_generated:      'Remito a proveedor generado',
  provider_delivery_confirmed:      'Entrega al proveedor confirmada',
  internal_remito_generated:        'Remito interno generado',
  remito_dispatched:                'Remito despachado',
  remito_arrived:                   'Remito recibido en depósito',
  shipment_confirmed:               'Envío al proveedor confirmado',
  // Ubicación / tránsito
  transit_updated:                  'Estado de tránsito actualizado',
  location_updated:                 'Ubicación actualizada',
  // Observaciones
  observation_added:                'Movimiento / nota agregada',
  // Alertas
  logistics_alert_generated:        'Alerta logística generada',
  logistics_alert_resolved:         'Alerta logística resuelta',
};

export function historyEventLabel(eventType: string): string {
  return HISTORY_EVENT_LABELS[eventType] || eventType.replace(/_/g, ' ');
}

export function alertPriorityClass(priority: AlertPriority): string {
  if (priority === 'high') return 'border-red-500/50 bg-red-500/10 text-red-100';
  if (priority === 'medium') return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  return 'border-slate-600 bg-slate-800/50 text-slate-300';
}

export const CANONICAL_WARRANTY_STATUSES = [
  '1 - INGRESO',
  '2 - PENDIENTE',
  '3 - LISTO PARA ENVIAR',
  '4 - ENVIADO AL PROVEEDOR',
  '5 - EN EL PROVEEDOR',
  '6 - RESPONDIDO POR PROVEEDOR',
  '7 - RESUELTO',
  '8 - RECHAZADO',
  '9 - ANULADA',
  '10 - FINALIZADO',
];

const STATUS_META: Record<string, { label: string; shortLabel: string; tone: FlowTone; helper: string }> = {
  '1 - INGRESO': {
    label: 'Ingreso',
    shortLabel: 'Ingreso',
    tone: 'blue',
    helper: 'Recién cargada. Debe revisarse o, si está en sucursal, viajar a Chiclana por remito interno.',
  },
  '2 - PENDIENTE': {
    label: 'Pendiente de gestión',
    shortLabel: 'Pendiente',
    tone: 'violet',
    helper: 'Ya fue revisada. El próximo paso es crear el ENV desde Exportación.',
  },
  '3 - LISTO PARA ENVIAR': {
    label: 'Listo para enviar mail',
    shortLabel: 'Listo ENV',
    tone: 'amber',
    helper: 'Tiene ENV/Excel generado. Falta confirmar el mail enviado al proveedor.',
  },
  '4 - ENVIADO AL PROVEEDOR': {
    label: 'Mail enviado al proveedor',
    shortLabel: 'Mail enviado',
    tone: 'amber',
    helper: 'El proveedor fue notificado. Se puede reenviar mail, registrar respuesta o solicitud de retiro.',
  },
  '5 - EN EL PROVEEDOR': {
    label: 'En el proveedor',
    shortLabel: 'En proveedor',
    tone: 'violet',
    helper: 'El proveedor ya tiene físicamente el producto. Falta respuesta o resolución.',
  },
  '6 - RESPONDIDO POR PROVEEDOR': {
    label: 'Respondido por proveedor',
    shortLabel: 'Respondido',
    tone: 'blue',
    helper: 'Ya hubo respuesta. Falta definir resolución, rechazo o anulación.',
  },
  '7 - RESUELTO': {
    label: 'Resuelto',
    shortLabel: 'Resuelto',
    tone: 'green',
    helper: 'El proveedor definió una solución. Falta ejecutar/cerrar esa solución para finalizar.',
  },
  '8 - RECHAZADO': {
    label: 'Rechazado',
    shortLabel: 'Rechazado',
    tone: 'red',
    helper: 'Caso rechazado. Solo deberían quedar acciones administrativas de cierre si correspondiera.',
  },
  '9 - ANULADA': {
    label: 'Anulada',
    shortLabel: 'Anulada',
    tone: 'red',
    helper: 'Garantía anulada. No debe tener acciones operativas.',
  },
  '10 - FINALIZADO': {
    label: 'Finalizado',
    shortLabel: 'Finalizado',
    tone: 'green',
    helper: 'Caso cerrado. No quedan acciones operativas pendientes.',
  },
};

const REVIEW_META: Record<string, { label: string; tone: FlowTone; helper: string }> = {
  pendiente_revision: { label: 'Pendiente de revisión', tone: 'blue', helper: 'Todavía no fue validada por depósito/gestión.' },
  en_revision: { label: 'En revisión interna', tone: 'violet', helper: 'Depósito/gestión ya la tomó para revisar.' },
  requiere_correccion: { label: 'Requiere corrección', tone: 'amber', helper: 'La sucursal o responsable debe corregir datos antes de avanzar.' },
  revisada: { label: 'Revisada', tone: 'green', helper: 'Aprobada internamente. Puede pasar a gestión/ENV.' },
};

const RESOLUTION_LABELS: Record<string, string> = {
  nota_credito: 'Nota de crédito',
  reparacion: 'Reparación',
  cambio_equipo: 'Cambio de equipo',
  rechazo: 'Rechazo',
  anulacion: 'Anulación',
};

export type DetailMode = 'editable' | 'operational' | 'readonly';

export interface DetailStateConfig {
  mode: DetailMode;
  isFinal: boolean;
  showProviderAlerts: boolean;
  showReviewBlock: boolean;
}

const DETAIL_STATE_CONFIG_MAP: Record<string, DetailStateConfig> = {
  '1 - INGRESO':               { mode: 'editable',     isFinal: false, showProviderAlerts: false, showReviewBlock: true  },
  '2 - PENDIENTE':             { mode: 'operational',  isFinal: false, showProviderAlerts: false, showReviewBlock: false },
  '3 - LISTO PARA ENVIAR':     { mode: 'operational',  isFinal: false, showProviderAlerts: true,  showReviewBlock: false },
  '4 - ENVIADO AL PROVEEDOR':  { mode: 'operational',  isFinal: false, showProviderAlerts: true,  showReviewBlock: false },
  '5 - EN EL PROVEEDOR':       { mode: 'operational',  isFinal: false, showProviderAlerts: true,  showReviewBlock: false },
  '6 - RESPONDIDO POR PROVEEDOR': { mode: 'operational', isFinal: false, showProviderAlerts: true, showReviewBlock: false },
  '7 - RESUELTO':              { mode: 'operational',  isFinal: false, showProviderAlerts: false, showReviewBlock: false },
  '8 - RECHAZADO':             { mode: 'readonly',     isFinal: true,  showProviderAlerts: false, showReviewBlock: false },
  '9 - ANULADA':               { mode: 'readonly',     isFinal: true,  showProviderAlerts: false, showReviewBlock: false },
  '10 - FINALIZADO':           { mode: 'readonly',     isFinal: true,  showProviderAlerts: false, showReviewBlock: false },
};

export function getDetailStateConfig(estado?: string): DetailStateConfig {
  return DETAIL_STATE_CONFIG_MAP[estado || ''] ?? { mode: 'operational', isFinal: false, showProviderAlerts: false, showReviewBlock: false };
}

export function getWarrantyStatusMeta(status?: string) {
  return STATUS_META[status || ''] || { label: status || 'Sin estado', shortLabel: status || 'Sin estado', tone: 'slate' as FlowTone, helper: 'Estado no reconocido. Revisar normalización.' };
}

export function getReviewStatusMeta(reviewStatus?: string) {
  return REVIEW_META[reviewStatus || ''] || { label: reviewStatus || 'Sin revisión', tone: 'slate' as FlowTone, helper: 'Sin revisión registrada.' };
}

export function getResolutionLabel(value?: string) {
  if (!value) return '';
  return RESOLUTION_LABELS[value] || value;
}

export function flowToneClass(tone: FlowTone) {
  const map: Record<FlowTone, string> = {
    slate: 'border-slate-700 bg-slate-900/70 text-slate-200',
    blue: 'border-blue-500/40 bg-blue-500/10 text-blue-100',
    green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    red: 'border-red-500/40 bg-red-500/10 text-red-100',
    violet: 'border-violet-500/40 bg-violet-500/10 text-violet-100',
  };
  return map[tone];
}

export function getWarrantyNextStep(item: Pick<WarrantySummary, 'estado' | 'review_status' | 'origen_ingreso' | 'ubicacion_actual' | 'transit_status' | 'shipment_code' | 'fecha_envio_proveedor' | 'estado_retiro_proveedor' | 'resultado_resolucion' | 'fecha_ultima_respuesta'>) {
  if (item.estado === '10 - FINALIZADO') return 'Caso finalizado. No requiere acciones.';
  if (item.estado === '9 - ANULADA') return 'Caso anulado. No requiere acciones operativas.';
  if (item.estado === '8 - RECHAZADO') return 'Caso rechazado. Revisar cierre administrativo si corresponde.';

  if (item.review_status === 'requiere_correccion') return 'Corregir datos de ingreso y reenviar a revisión.';
  if (item.review_status === 'pendiente_revision' || !item.review_status) return 'Esperando revisión interna.';
  if (item.review_status === 'en_revision') return 'En revisión interna: aprobar o pedir corrección.';

  if (item.estado === '1 - INGRESO') return 'Aprobada internamente pendiente de pasar a gestión.';
  if (item.estado === '2 - PENDIENTE') return 'Crear ENV desde Exportación.';
  if (item.estado === '3 - LISTO PARA ENVIAR') return 'Confirmar mail enviado al proveedor.';
  if (item.estado === '4 - ENVIADO AL PROVEEDOR') {
    if (item.estado_retiro_proveedor === 'retiro_solicitado') {
      const loc = (item.ubicacion_actual || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
      const ready = item.transit_status === 'en_deposito' || loc === 'DEPOSITO' || loc.startsWith('DEPOSITO ');
      return ready ? 'Listo para que el proveedor retire.' : 'Urgente: traer a Chiclana para retiro del proveedor.';
    }
    return 'Esperar respuesta, reenviar mail o registrar solicitud de retiro.';
  }
  if (item.estado === '5 - EN EL PROVEEDOR') {
    return item.fecha_ultima_respuesta
      ? 'El proveedor ya respondió. Verificar y definir resolución, rechazo o avanzar estado.'
      : 'Cargar respuesta, rechazo o resolución del proveedor.';
  }
  if (item.estado === '6 - RESPONDIDO POR PROVEEDOR') return 'Definir resolución, rechazo o anulación.';
  if (item.estado === '7 - RESUELTO') return item.resultado_resolucion ? 'Ejecutar la resolución y finalizar cuando esté cerrada.' : 'Completar tipo de resolución.';
  return getWarrantyStatusMeta(item.estado).helper;
}
