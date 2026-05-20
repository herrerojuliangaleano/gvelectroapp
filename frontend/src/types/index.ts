export type FieldType = 'text' | 'number' | 'date' | 'textarea' | 'checkbox' | 'select' | 'file' | 'multi_file' | 'section';

export interface ToolField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  default?: unknown;
  options?: { label: string; value: string }[];
  accept?: string;
  help?: string;
  /** Name of the parent section field this field belongs to */
  section?: string;
  /** Only for type=section: whether the section starts collapsed */
  collapsible?: boolean;
  default_open?: boolean;
  /** 'arca' → validates filename contains emitidos/recibidos + CUIT */
  validate_filename?: string;
}

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  dangerous?: boolean;
  fields: ToolField[];
  category?: string;
  tags?: string[];
  recommended_device?: string;
  weight?: string;
}

export type JobStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export interface JobInfo {
  id: string;
  tool_id: string;
  tool_name: string;
  status: JobStatus;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_seconds?: number | null;
  user?: string | null;
  payload?: Record<string, unknown>;
  error?: string | null;
  pid?: number | null;
}

export interface ConfigStatus {
  app_enabled: boolean;
  has_credentials_env: boolean;
  has_credentials_file: boolean;
  has_token_file: boolean;
  legacy_scripts_found: boolean;
  storage_dir: string;
}

export interface WarrantyProduct {
  producto: string;
  sku?: string;
  marca?: string;
  tipo?: string;
  label: string;
  pvp_texto?: string;
  costo_texto?: string;
  provider_name?: string;
}

export interface WarrantyTipoIngreso {
  value: string;
  label: string;
}

export interface WarrantyBranchOperativa {
  id: string;
  name: string;
  code: string;
  type: 'physical' | 'deposit' | 'admin' | string;
  company_id: string;
  company_name: string;
}

export interface WarrantyOptions {
  sucursales: string[];
  depositos: string[];
  warranty_central_deposit?: WarrantyBranchOperativa;
  estados?: string[];
  estado_default: string;
  tipos_ingreso?: WarrantyTipoIngreso[];
  ubicacion_labels?: Record<string, string>;
  review_statuses?: WarrantyTipoIngreso[];
  resolution_options?: WarrantyTipoIngreso[];
  final_statuses?: string[];
  delay_ranges?: number[];
  required_review_fields?: string[];
  /** Branches reales del sistema (physical + deposit) con IDs para selectores. */
  branches_operativas?: WarrantyBranchOperativa[];
  source?: Record<string, unknown>;
}

export interface WarrantyItemPayload {
  // ── Producto ─────────────────────────────────────────────────────────────
  producto: string;
  sku?: string;
  marca?: string;
  tipo?: string;
  serie?: string;
  falla: string;
  observaciones?: string;
  // ── Origen / tipo de ingreso ─────────────────────────────────────────────
  tipo_ingreso: string;               // obligatorio — determina origen y ubicación
  sucursal: string;                   // obligatorio solo si tipo_ingreso = "cliente_sucursal"
  sucursal_responsable?: string;      // nombre de display (derivado del ID por el backend)
  sucursal_responsable_id?: string;   // branch_id real — obligatorio para cliente_deposito
  deposito: string;
  lugar_llegada?: string;
  // ── Proveedor (sugerido por catálogo) ────────────────────────────────────
  proveedor?: string;
  // ── Datos del cliente (opcionales) ──────────────────────────────────────
  cliente_nombre?: string;
  cliente_telefono?: string;
  cliente_email?: string;
  numero_factura?: string;
  fecha_compra?: string;
  fecha_ingreso?: string;
}

export interface WarrantyCreatedItem {
  id_garantia: string;
  parent_warranty_code?: string;
  parent_item_index?: number | null;
  producto: string;
  sku?: string | null;
}

export interface WarrantyCreateResponse {
  ok: boolean;
  count: number;
  ids: string[];
  items: WarrantyCreatedItem[];
}

export interface UserBranchAssignment {
  id: string;
  name: string;
  code?: string;
  type?: string;
  company_id?: string;
  company_name?: string;
  parent_branch_id?: string | null;
  parent_branch_name?: string;
  is_primary?: boolean;
}

export interface EmployeeInfo {
  id?: string;
  username?: string;
  dni?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  personal_email?: string | null;
  position?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_type?: string | null;
  photo_url?: string | null;
  photo_status?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CurrentUser {
  username: string;
  display_name: string;
  role: string;
  roles?: string[];
  permissions: string[];
  sucursal?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  branch_type?: string | null;
  branches?: UserBranchAssignment[];
  branch_ids?: string[];
  employee?: EmployeeInfo | null;
  is_active?: boolean;
  must_change_password?: boolean;
  last_login_at?: string | null;
  last_movement_at?: string | null;
  last_movement?: string | null;
}

export interface RoleInfo {
  name: string;
  label: string;
  level: number;
  permissions: string[];
}

export interface UserInfo {
  username: string;
  display_name: string;
  role: string;
  roles?: string[];
  sucursal?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  branch_type?: string | null;
  branches?: UserBranchAssignment[];
  branch_ids?: string[];
  employee?: EmployeeInfo | null;
  is_active: boolean;
  must_change_password?: boolean;
  last_login_at?: string | null;
  last_movement_at?: string | null;
  last_movement?: string | null;
}

export interface PermissionInfo {
  id: string;
  label: string;
  group?: string | null;
}

export interface AuditEvent {
  id: number;
  created_at: string;
  event_type: string;
  actor_username?: string | null;
  actor_display_name?: string | null;
  actor_role?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  status?: string | null;
  message?: string | null;
  details?: Record<string, unknown> | null;
}

export interface GoogleCredentialStatus {
  path: string;
  exists: boolean;
  exists_file: boolean;
  exists_env: boolean;
  kind: string;
  client_id?: string | null;
  project_id?: string | null;
}

export interface GoogleTokenStatus {
  path: string;
  exists: boolean;
  valid: boolean;
  expired?: boolean | null;
  has_refresh_token: boolean;
  scopes: string[];
  expiry?: string | null;
  source: string;
  error?: string;
}

export interface GoogleReconnectStatus {
  running: boolean;
  status: 'idle' | 'starting' | 'running' | 'success' | 'error' | string;
  message: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
}

export interface GoogleAdminStatus {
  credentials: GoogleCredentialStatus;
  token: GoogleTokenStatus;
  storage_private_dir: string;
  scopes: string[];
  reconnect: GoogleReconnectStatus;
}

export interface BudgetProduct {
  producto: string;
  sku?: string | null;
  marca?: string | null;
  tipo?: string | null;
  condicion?: string | null;
  precio?: number | null;
  precio_texto?: string | null;
  stock?: string | null;
  label: string;
}

export interface BudgetShippingOption {
  id: string;
  label: string;
  price?: number | null;
  price_text: string;
}

export interface BudgetOptions {
  sucursales: string[];
  shipping_options: BudgetShippingOption[];
  estado_default: string;
}

export interface BudgetLinePayload {
  producto: string;
  sku?: string | null;
  marca?: string | null;
  tipo?: string | null;
  condicion?: string | null;
  cantidad: number;
  precio_unitario: number;
}

export interface BudgetCreatePayload {
  sucursal: string;
  cliente?: string;
  telefono?: string;
  envio_zona?: string;
  envio: number;
  observaciones?: string;
  items: BudgetLinePayload[];
}

// ── Sales BI ─────────────────────────────────────────────────────────────────

export interface SalesBIRecord {
  id: number;
  import_id: number;
  nro_linea: number;
  remito: string;
  vendedor: string;
  producto: string;
  sku: string;
  marca: string;
  tipo_producto: string;
  condicion: string;
  categoria: string;
  linea: string;
  cantidad: number;
  pvp: number;
  costo?: number;
  diferencia?: number;
  margen_porcentaje?: number;
  efectivo: number;
  transferencia: number;
  tarjeta: number;
  usd: number;
  cuenta_corriente: number;
  otros: number;
  total_cobrado: number;
  saldo: number;
  fecha?: string;
  sucursal?: string;
  tipo?: string;
}

export interface SalesBIBalance {
  id: number;
  import_id: number;
  remito: string;
  efectivo: number;
  transferencia: number;
  tarjeta: number;
  usd: number;
  otros: number;
  total: number;
  fecha?: string;
  sucursal?: string;
}

export interface SalesBIImport {
  id: number;
  fecha: string;
  sucursal: string;
  tipo: string;
  branch_id: string | null;
  branch_name?: string;
  branch_type?: string;
  fuente: string;
  fuente_url: string;
  fuente_nombre: string;
  status: string;
  total_records: number;
  total_pvp: number;
  total_costo: number;
  total_efectivo: number;
  total_transferencia: number;
  total_tarjeta: number;
  total_usd: number;
  total_cuenta_corriente: number;
  total_otros: number;
  cotizacion_dolar: number | null;
  imported_by: string;
  imported_by_name: string;
  created_at: string;
  voided_at: string;
  voided_by: string;
  void_reason: string;
  warnings: string[];
}

export interface SalesBIImportDetail extends SalesBIImport {
  records: SalesBIRecord[];
  balances: SalesBIBalance[];
}

export interface SalesBISheetPreview {
  sheet_name: string;
  fecha: string;
  sucursal: string;
  tipo: string;
  cotizacion_dolar: number | null;
  total_records: number;
  total_pvp: number;
  total_efectivo: number;
  total_transferencia: number;
  total_tarjeta: number;
  total_usd: number;
  total_cuenta_corriente: number;
  total_otros: number;
  warnings: string[];
  ok: boolean;
  conflict_import_id: number | null;
  conflict_import_fecha: string | null;
  branch_id: string | null;
  branch_name: string | null;
  branch_type: string | null;
  records_preview: SalesBIRecord[];
  balances: SalesBIBalance[];
}

export interface SalesBIAnalyzeResponse {
  sheets: SalesBISheetPreview[];
  temp_file_key: string | null;
}

export interface SalesBIStats {
  total_imports: number;
  total_records: number;
  total_pvp: number;
  last_import: { fecha: string; sucursal: string; created_at: string } | null;
}

export interface BudgetCreatedLine {
  sku?: string | null;
  producto: string;
  cantidad: number;
  precio_unitario: number;
  total_linea: number;
}

export interface BudgetCreateResponse {
  ok: boolean;
  id_presupuesto: string;
  subtotal_productos: number;
  envio: number;
  total_final: number;
  whatsapp_text: string;
  items: BudgetCreatedLine[];
}

export interface OperationalConfigPayload {
  version?: number;
  locked: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
  system: {
    mode: 'open' | 'closed' | 'maintenance' | string;
    open_time: string;
    close_time: string;
    timezone: string;
    closed_message: string;
    maintenance_message: string;
  };
  products?: {
    spreadsheet_url?: string;
    spreadsheet_id?: string;
    sheet_name?: string;
    header_row?: number;
    range?: string;
    cache_seconds?: number;
    columns?: {
      marca?: string;
      tipo?: string;
      descripcion?: string;
      sku?: string;
      pvp?: string;
      costo_vigente?: string;
    };
    required_headers?: string[];
    recommended_headers?: string[];
  };
  warranties: {
    spreadsheet_url: string;
    spreadsheet_id?: string;
    raw_sheet: string;
    product_sheet: string;
    counter_sheet: string;
    estado_default: string;
    sucursales: string[];
    depositos: string[];
    product_cache_seconds: number;
    required_headers?: string[];
    recommended_headers?: string[];
  };
  sales?: {
    label?: string;
    default_channel?: string;
    sucursales?: string[];
  };
  budgets: {
    spreadsheet_url: string;
    spreadsheet_id?: string;
    price_sheet: string;
    shipping_sheet: string;
    raw_sheet: string;
    detail_sheet: string;
    estado_default: string;
    product_cache_seconds: number;
    price_required_headers?: string[];
    price_recommended_headers?: string[];
    shipping_required_headers?: string[];
    shipping_recommended_headers?: string[];
    raw_recommended_headers?: string[];
    detail_recommended_headers?: string[];
  };
  audit: {
    sync_to_google_sheets: boolean;
    spreadsheet_url: string;
    spreadsheet_id?: string;
    sheet: string;
    recommended_headers?: string[];
  };
  payroll?: {
    storage?: string;
    allowed_file_types?: string[];
    max_file_mb?: number;
    bulk_upload_enabled?: boolean;
    filename_hint?: string;
  };
  tools?: {
    enabled?: boolean;
    workspace_description?: string;
  };
  price_cost_updates?: {
    source?: string;
    price_targets?: string[];
    cost_targets?: string[];
  };
  arca: {
    cutoff_day: number;
    cutoff_description: string;
  };
}

export interface OperationalConfigSchemaInfo {
  products?: Record<string, string[]>;
  warranties: Record<string, string[]>;
  budgets: Record<string, string[]>;
  audit: Record<string, string[]>;
}

export interface OperationalConfigResponse {
  config: OperationalConfigPayload;
  schemas: OperationalConfigSchemaInfo;
  sheet_urls: Record<string, string | null>;
}

export interface OperationalConfigValidationResult {
  ok: boolean;
  section: string;
  results: Array<{
    ok: boolean;
    sheet: string;
    headers_found?: string[];
    required_headers?: string[];
    missing_headers?: string[];
    message?: string;
    error?: string;
  }>;
}


export type BranchType = 'physical' | 'web' | 'deposit' | 'admin';

export interface CompanyInfo {
  id: string;
  name: string;
  legal_name: string;
  cuit: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BranchInfo {
  id: string;
  company_id: string;
  company_name: string;
  name: string;
  code: string;
  type: BranchType;
  parent_branch_id?: string | null;
  parent_branch_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OperationalStructure {
  companies: CompanyInfo[];
  branches: BranchInfo[];
}

export interface SystemPublicStatus {
  ok: boolean;
  app: string;
  version: string;
  backend_online: boolean;
  app_enabled: boolean;
  mode: string;
  available: boolean;
  inside_schedule: boolean;
  open_time: string;
  close_time: string;
  timezone: string;
  now: string;
  message: string;
}

export interface SystemSummary {
  status: SystemPublicStatus;
  counts: {
    users_total: number;
    users_active: number;
    tools_visible: number;
    jobs_recent: number;
    jobs_running: number;
    jobs_errors_recent: number;
  };
  google: {
    credentials_file: boolean;
    token_file: boolean;
  };
  paths: {
    storage_dir: string;
    database_path: string;
  };
  recent_jobs: JobInfo[];
  recent_events: AuditEvent[];
}


export type DiagnosticSeverity = 'ok' | 'info' | 'warning' | 'critical' | string;

export interface SystemDiagnosticIssue {
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface SystemDiagnostics {
  status: DiagnosticSeverity;
  generated_at: string;
  summary: Record<string, number | boolean | string>;
  issues: SystemDiagnosticIssue[];
  recent_errors: JobInfo[];
  recommended_actions?: Array<{ label: string; action: string }>;
}

export interface SystemRepairResult {
  ok: boolean;
  roles: Record<string, number | string | boolean>;
  branches: Record<string, number | string | boolean>;
  employees: Record<string, number | string | boolean>;
}

export interface SystemAbout {
  app_name: string;
  version: string;
  environment: string;
  backend: string;
  frontend: string;
  python: string;
  system: string;
  storage_dir: string;
  database_path: string;
  frontend_dist_dir: string;
  notes: string[];
  changelog: Array<{ version: string; title: string; items: string[] }>;
}

export interface BackupInfo {
  filename: string;
  size_bytes: number;
  created_at: string;
}

export interface WarrantyRow {
  row_number: number;
  id_garantia: string;
  responsable: string;
  usuario: string;
  ingreso: string;
  ingreso_iso?: string;
  producto: string;
  sku: string;
  marca: string;
  tipo: string;
  serie: string;
  falla: string;
  sucursal: string;
  deposito: string;
  lugar_llegada?: string;
  estado: string;
  observaciones: string;
  actualizado_por: string;
  fecha_ultima_actualizacion: string;
}

export interface WarrantySummary {
  id_garantia: string;
  parent_warranty_code?: string;
  parent_item_index?: number | null;
  grouped_item_label?: string;
  ingreso: string;
  ingreso_iso?: string;
  responsible_username?: string;
  responsable: string;
  usuario: string;
  producto_principal: string;
  productos: string[];
  cantidad_items: number;
  marca?: string;
  sku: string;
  serie: string;
  falla: string;
  sucursal: string;
  sucursal_code?: string;
  company_id?: string;
  sucursal_responsable?: string;
  sucursal_responsable_id?: string;
  deposito: string;
  lugar_llegada?: string;
  estado: string;
  review_status?: string;
  review_status_label?: string;
  reviewed_by?: string;
  reviewed_by_name?: string;
  reviewed_at?: string;
  review_note?: string;
  observaciones: string;
  photos_reference?: string;
  // ── Origen / tipo / ubicación física (Fase 1) ────────────────────────────
  tipo_ingreso?: string;
  tipo_ingreso_label?: string;
  origen_ingreso?: string;
  ubicacion_actual?: string;
  ubicacion_actual_label?: string;
  // ── Datos del cliente (Fase 1) ───────────────────────────────────────────
  cliente_nombre?: string;
  cliente_telefono?: string;
  cliente_email?: string;
  numero_factura?: string;
  fecha_compra?: string;
  // ── Proveedor / gestión ──────────────────────────────────────────────────
  provider_name?: string;
  id_de_caso?: string;
  fecha_envio_proveedor?: string;
  fecha_ultima_respuesta?: string;
  fecha_ultimo_reclamo?: string;
  estado_retiro_proveedor?: string;
  estado_retiro_proveedor_label?: string;
  fecha_solicitud_retiro_proveedor?: string;
  fecha_retiro_proveedor?: string;
  dias_pendiente?: number;
  shipment_code?: string;
  shipment_file_name?: string;
  resolution_note?: string;
  resolution_reference?: string;
  resultado_resolucion?: string;
  resultado_resolucion_label?: string;
  numero_nota_credito?: string;
  importe_nota_credito?: string;
  fecha_nota_credito?: string;
  detalle_reparacion?: string;
  fecha_reparacion?: string;
  producto_reemplazo?: string;
  sku_reemplazo?: string;
  serie_reemplazo?: string;
  fecha_recepcion_reemplazo?: string;
  fecha_finalizacion?: string;
  finalizacion?: string;
  remito_interno?: string;
  remito_proveedor?: string;
  transit_status?: string;
  dias_sin_respuesta?: number | null;
  synced_to_google_sheet?: boolean;
  fecha_ultima_sincronizacion?: string;
  actualizado_por: string;
  fecha_ultima_actualizacion: string;
  cancelled?: boolean;
  cancel_reason?: string;
  cancelled_by?: string;
  cancelled_at?: string;
}

export interface WarrantyListResponse {
  items: WarrantySummary[];
  total: number;
  limit: number;
}

export interface WarrantyDetailResponse {
  summary: WarrantySummary;
  rows: WarrantyRow[];
  history: AuditEvent[];
}

export interface WarrantyItemUpdatePayload {
  row_number: number;
  producto?: string;
  sku?: string;
  marca?: string;
  tipo?: string;
  serie?: string;
  falla?: string;
  observaciones?: string;
}

export interface WarrantyUpdatePayload {
  estado?: string;
  sucursal?: string;
  deposito?: string;
  lugar_llegada?: string;
  ubicacion_actual?: string;
  observaciones?: string;
  photos_reference?: string;
  append_observation?: string;
  items?: WarrantyItemUpdatePayload[];
}

export interface WarrantyEntryBaseUpdatePayload {
  fecha_ingreso?: string;
  observaciones?: string;
  photos_reference?: string;
  proveedor?: string;
  cliente_nombre?: string;
  cliente_telefono?: string;
  cliente_email?: string;
  numero_factura?: string;
  fecha_compra?: string;
  items?: WarrantyItemUpdatePayload[];
}

export interface WarrantyReviewPayload {
  note?: string;
}

export interface WarrantyProviderSendPayload {
  provider_name: string;
  provider_case_id?: string;
  note?: string;
}

export interface WarrantyProviderResponsePayload {
  note?: string;
  provider_case_id?: string;
  estado?: string;
}

export interface WarrantyClaimPayload {
  note: string;
}

export interface WarrantyResendMailPayload {
  note?: string;
}

export interface WarrantyProviderPickupPayload {
  note?: string;
  provider_case_id?: string;
  fecha_retiro_acordada?: string;
}

export interface WarrantyStatusChangePayload {
  estado: string;
  note?: string;
  resolution_note?: string;
  resolution_reference?: string;
  resultado_resolucion?: string;
  numero_nota_credito?: string;
  importe_nota_credito?: string;
  fecha_nota_credito?: string;
  detalle_reparacion?: string;
  fecha_reparacion?: string;
  producto_reemplazo?: string;
  sku_reemplazo?: string;
  serie_reemplazo?: string;
  fecha_recepcion_reemplazo?: string;
  finalizacion?: string;
}

export interface SetupSheetResult {
  ok: boolean;
  spreadsheet_id: string;
  sheet: string;
  tab_created: boolean;
  headers_count: number;
  message: string;
}

export interface WarrantyExportPayload {
  marca?: string;
  proveedor?: string;
  estado?: string;
  sucursal?: string;
  deposito?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}

export interface WarrantyExportInfo {
  id: number;
  created_at: string;
  created_by: string;
  provider_name: string;
  marca: string;
  filters: Record<string, string | number | boolean | null | undefined>;
  file_name: string;
  row_count: number;
  download_url: string;
  shipment_code?: string;
  file_format?: 'excel' | 'pdf' | string;
  logo_brand?: 'gv' | 'abc' | string;
}

export interface WarrantyBatchExportPayload {
  warranty_ids: string[];
  proveedor?: string;
  nota?: string;
  formato?: 'excel' | 'pdf' | string;
  logo_brand?: 'gv' | 'abc' | string;
}

export interface ConfirmShipmentPayload {
  shipment_code: string;
  provider_name?: string;
  nota?: string;
}

export interface WarrantyExportListResponse {
  items: WarrantyExportInfo[];
}


export interface WarrantySyncStatus {
  last_sync_at: string;
  last_sync_type: string;
  last_sync_status: string;
  last_sync_user: string;
  pending_to_sheet: number;
  total_guarantees: number;
  errors: string[];
}

export interface WarrantySyncResult {
  ok: boolean;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string;
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  errors: string[];
}

export interface WarrantyResetSummary {
  guarantees: number;
  guarantee_items: number;
  guarantee_history: number;
  remitos: number;
  exports: number;
  sync_logs: number;
  counters: number;
  generated_export_files: number;
}

export interface WarrantyResetPreviewResponse {
  ok: boolean;
  generated_at: string;
  summary: WarrantyResetSummary;
  preserved: string[];
  warning: string;
  confirmation_phrase: string;
}

export interface WarrantyResetResponse {
  ok: boolean;
  reset_at: string;
  summary_before: WarrantyResetSummary;
  backup_file: string;
  deleted_generated_files: number;
  message: string;
}

export interface WarrantySyncLogInfo {
  id: number;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string;
  actor_username: string;
  actor_name: string;
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  errors: string[];
}

export interface WarrantySyncLogsResponse {
  items: WarrantySyncLogInfo[];
}



export interface WarrantyConfigCatalog {
  statuses: string[];
  final_statuses: string[];
  sucursales: string[];
  depositos: string[];
  delay_ranges: number[];
  required_review_fields: string[];
  sheet_raw: string;
  spreadsheet_url: string;
  products_source_label: string;
}

export interface WarrantyConfigResponse {
  config: WarrantyConfigCatalog;
  providers_count: number;
  brands_count: number;
  mapped_brands_count: number;
  unmapped_brands_count: number;
  pending_review_count: number;
  active_count: number;
}

export interface WarrantyConfigSavePayload {
  statuses?: string[];
  final_statuses?: string[];
  sucursales?: string[];
  depositos?: string[];
  delay_ranges?: number[];
  required_review_fields?: string[];
  raw_sheet?: string;
  spreadsheet_url?: string;
}

export interface WarrantyCancelPayload {
  reason: string;
}


export interface WarrantyDiagnosticItem {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | string;
  detail: string;
  count: number;
}

export interface WarrantyDiagnosticsResponse {
  status: 'ok' | 'warning' | 'error' | string;
  generated_at: string;
  items: WarrantyDiagnosticItem[];
  next_actions: string[];
}

export interface WarrantyDashboardPoint {
  label: string;
  value: number;
  extra?: Record<string, string | number | boolean | null | undefined>;
}

export interface WarrantyDashboardMetrics {
  total: number;
  ingreso: number;
  pendientes_revision: number;
  pendientes_proveedor: number;
  enviadas_proveedor: number;
  en_revision: number;
  resueltas: number;
  rechazadas: number;
  demoradas_7: number;
  demoradas_15: number;
  promedio_dias_pendiente: number;
  promedio_resolucion: number;
  promedio_dias_sin_respuesta: number;
}

export interface WarrantyDashboardResponse {
  metrics: WarrantyDashboardMetrics;
  by_status: WarrantyDashboardPoint[];
  by_brand: WarrantyDashboardPoint[];
  by_provider: WarrantyDashboardPoint[];
  by_branch: WarrantyDashboardPoint[];
  by_deposit: WarrantyDashboardPoint[];
  by_delay_range: WarrantyDashboardPoint[];
  monthly_entries: WarrantyDashboardPoint[];
  avg_resolution_by_provider: WarrantyDashboardPoint[];
  final_resolutions: WarrantyDashboardPoint[];
  critical: WarrantySummary[];
  filters: Record<string, string | number | boolean | null | undefined>;
}

export interface WarrantyCounterInfo {
  year: number;
  sucursal: string;
  last_number: number;
}

export interface WarrantyCountersResponse {
  counters: WarrantyCounterInfo[];
}

// ── Remitos internos ─────────────────────────────────────────────────────────

export interface WarrantyRemitoInfo {
  id: number;
  remito_code: string;
  shipment_code: string;
  tipo_remito?: 'sucursal_a_deposito' | 'deposito_a_deposito' | 'deposito_a_proveedor' | string;
  company_brand: string;
  company_name: string;
  origen_sucursal: string;
  destino_deposito: string;
  warranty_ids: string[];
  warranties_count: number;
  proveedor?: string | null;
  status: 'pendiente' | 'en_transito' | 'llegado';
  created_at: string;
  created_at_display: string;
  created_by_name: string;
  fecha_despacho?: string | null;
  fecha_despacho_display?: string | null;
  despachado_por_name?: string | null;
  fecha_llegada?: string | null;
  fecha_llegada_display?: string | null;
  recibido_por_name?: string | null;
  nota?: string | null;
  warranties?: Array<{
    warranty_code: string;
    producto: string;
    sku?: string | null;
    serie?: string | null;
    falla?: string | null;
  }>;
}

export interface WarrantyRemitosResponse {
  items: WarrantyRemitoInfo[];
  total: number;
}

export interface AvailableWarrantyForRemito {
  warranty_code: string;
  sucursal: string;
  estado: string;
  producto: string;
  sku: string;
  serie: string;
  falla: string;
  marca: string;
}

export interface GenerateRemitosPayload {
  destino_deposito: string;
  /** Garantías elegidas por el usuario desde el picker. */
  warranty_codes?: string[];
  /** Si no hay warranty_codes, filtra por esta sucursal. */
  sucursal?: string;
  nota?: string;
}

export interface DepositTransferOptions {
  origen_deposito: string;
  destinos: Array<{ id: string; name: string; code: string; company_id: string }>;
}

export interface DepositTransferPayload {
  destino_deposito: string;
  warranty_codes: string[];
  nota?: string;
}

export interface ProviderDeliveryWarranty {
  warranty_code: string;
  sucursal: string;
  estado: string;
  provider_name: string;
  deposito: string;
  estado_retiro_proveedor: string;
  fecha_solicitud_retiro_proveedor: string;
  producto: string;
  sku: string;
  serie: string;
  falla: string;
  marca: string;
}

export interface ProviderDeliveryPayload {
  warranty_codes: string[];
  proveedor: string;
  nota?: string;
}

export interface DispatchRemitoPayload {
  lugar_salida: string;
  nota?: string;
}

export interface ConfirmRemitoArrivalPayload {
  remito_code: string;
  lugar_llegada?: string;
  nota?: string;
}


export interface NotificationInfo {
  id: number;
  username: string;
  title: string;
  message: string;
  type: string;
  module?: string;
  module_label?: string;
  event_type?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical' | string;
  sales_request_id?: number | null;
  entity_type?: string | null;
  entity_id?: string | null;
  link_url?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  target_role?: string | null;
  metadata?: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
  read_at?: string | null;
}

export interface NotificationSummary {
  unread_total: number;
  unread_high_priority: number;
  unread_by_module: Record<string, number>;
  modules: Record<string, string>;
}

export interface NotificationFilters {
  unreadOnly?: boolean;
  module?: string;
  priority?: string;
  readStatus?: 'all' | 'unread' | 'read';
  limit?: number;
}

export interface SalesWebItem {
  id?: number | null;
  sku?: string | null;
  producto: string;
  marca?: string | null;
  tipo?: string | null;
  condicion?: string | null;
  cantidad: number;
  precio_unitario?: string | null;
  total_linea?: string | null;
}

export interface SalesWebCreatePayload {
  dni: string;
  apellido_nombre: string;
  domicilio: string;
  codigo_postal: string;
  localidad: string;
  telefono: string;
  correo_electronico: string;
  pago_tipo: string;
  entrega_tipo: string;
  barrio?: string | null;
  entre_calles?: string | null;
  observaciones?: string | null;
  costo_envio?: string | number | null;
  senia_monto?: string | number | null;
  sucursal?: string | null;
  canal?: string | null;
  items: Array<{
    sku?: string | null;
    producto: string;
    marca?: string | null;
    tipo?: string | null;
    condicion?: string | null;
    cantidad: number;
    precio_unitario?: string | number | null;
  }>;
}

export interface SalesWebOptions {
  estados: string[];
  pagos: string[];
  entregas: string[];
  sucursales: string[];
}

export interface SalesWebRequest {
  id: number;
  numero_solicitud: string;
  numero_remito_prefactura?: string | null;
  estado: string;
  vendedor_id: string;
  vendedor_nombre: string;
  sucursal?: string | null;
  canal?: string | null;
  dni: string;
  apellido_nombre: string;
  telefono: string;
  correo_electronico: string;
  domicilio: string;
  codigo_postal: string;
  localidad: string;
  barrio?: string | null;
  entre_calles?: string | null;
  observaciones?: string | null;
  pago_tipo: string;
  entrega_tipo: string;
  costo_envio?: string | null;
  senia_monto?: string | null;
  saldo_restante?: string | null;
  observacion_admin?: string | null;
  created_at: string;
  updated_at: string;
  created_at_text: string;
  updated_at_text: string;
  taken_at?: string | null;
  taken_by?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  sent_to_sales_at?: string | null;
  sent_to_sales_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  items: SalesWebItem[];
}

export type PriceCostUpdateType = 'price' | 'cost';

export interface PriceCostUpdateCheck {
  key: string;
  label: string;
  checked: boolean;
  checked_by?: string | null;
  checked_by_name?: string | null;
  checked_at?: string | null;
}

export interface PriceCostUpdate {
  id: number;
  type: PriceCostUpdateType;
  producto: string;
  sku: string;
  marca?: string | null;
  valor_anterior?: string | null;
  valor_nuevo: string;
  diferencia?: string | null;
  estado: string;
  lookup_warning?: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  checks: PriceCostUpdateCheck[];
  checked_count: number;
  total_checks: number;
  progress_percent: number;
  source?: string;
  auto_created?: boolean;
}

export interface PriceCostUpdateCreatePayload {
  type: PriceCostUpdateType;
  sku: string;
  producto?: string | null;
  marca?: string | null;
  valor_nuevo: string;
  valor_anterior?: string | null;
}

export interface PriceCostProductLookup {
  found: boolean;
  type: PriceCostUpdateType;
  sku: string;
  producto: string;
  marca: string;
  valor_anterior: string;
  valor_anterior_texto: string;
  warning: string;
  source: string;
}

export interface PriceCostUpdateHistory {
  id: number;
  update_id: number;
  created_at: string;
  username: string;
  display_name: string;
  action: string;
  detail: Record<string, unknown>;
}


export type PayrollReceiptStatus = 'pendiente' | 'visto' | 'firmado_conforme' | 'observado' | 'reemplazado' | 'anulado' | string;

export interface PayrollObservation {
  id: string;
  receipt_id: string;
  employee_id?: string;
  employee_username?: string;
  message: string;
  status: string;
  created_at: string;
  answered_by?: string;
  answered_by_name?: string;
  answered_at?: string;
  answer_message?: string;
}

export interface PayrollReceipt {
  id: string;
  employee_id: string;
  employee_username?: string;
  employee_dni?: string;
  employee_name?: string;
  period_year: number;
  period_month: number;
  receipt_type?: string;
  file_name: string;
  file_content_type?: string;
  file_size?: number;
  file_hash?: string;
  status: PayrollReceiptStatus;
  uploaded_by?: string;
  uploaded_by_name?: string;
  uploaded_at?: string;
  viewed_at?: string;
  viewed_by?: string;
  signed_at?: string;
  signed_by?: string;
  observed_at?: string;
  cancelled_at?: string;
  cancelled_by?: string;
  cancel_reason?: string;
  replaced_by_receipt_id?: string;
  created_at?: string;
  updated_at?: string;
  observations?: PayrollObservation[];
}

export interface PayrollReceiptListResponse {
  items: PayrollReceipt[];
  total: number;
  pending: number;
  signed: number;
  observed: number;
}

export interface PayrollBulkPreviewItem {
  file_name: string;
  file_size?: number;
  content_type?: string;
  detected_dni?: string;
  employee_id?: string;
  employee_username?: string;
  employee_name?: string;
  employee_dni?: string;
  duplicate_receipt_id?: string;
  duplicate_status?: string;
  status: string;
  message: string;
  can_upload?: boolean;
}

export interface PayrollBulkPreviewResponse {
  items: PayrollBulkPreviewItem[];
  total: number;
  ready: number;
  missing_dni: number;
  not_found: number;
  duplicates: number;
  invalid: number;
}

export interface PayrollBulkUploadItem {
  file_name: string;
  detected_dni?: string;
  employee_id?: string;
  employee_username?: string;
  employee_name?: string;
  employee_dni?: string;
  receipt_id?: string;
  duplicate_receipt_id?: string;
  status: string;
  message: string;
}

export interface PayrollBulkUploadResponse {
  items: PayrollBulkUploadItem[];
  total: number;
  uploaded: number;
  skipped: number;
  errors: number;
  replaced: number;
}

export interface ProductInfo {
  id: number;
  sku: string;
  marca: string;
  tipo: string;
  descripcion: string;
  producto: string;
  pvp?: number | null;
  pvp_text?: string;
  pvp_texto?: string;
  precio?: number | null;
  precio_texto?: string;
  costo_vigente?: number | null;
  costo_text?: string;
  costo_texto?: string;
  condicion?: string;
  condicion_producto?: string;
  source_row?: number | null;
  last_synced_at?: string;
  updated_at?: string;
  is_active: boolean;
  label: string;
}

export interface ProductListResponse {
  items: ProductInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductBrandInfo {
  id: number;
  name: string;
  normalized_name: string;
  is_active: boolean;
  provider_id?: number | null;
  provider_name?: string | null;
  updated_at?: string;
}

export interface ProviderInfo {
  id: number;
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProviderPayload {
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  is_active?: boolean;
}

export interface BrandProviderInfo {
  id: number;
  brand_id: number;
  brand_name: string;
  provider_id: number;
  provider_name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrandProviderPayload {
  brand_id: number;
  provider_id: number;
  is_default?: boolean;
}

export interface ProductSyncLogInfo {
  id: number;
  source: string;
  status: string;
  started_at: string;
  finished_at: string;
  actor_username?: string;
  actor_name?: string;
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  brands_created: number;
  errors: string[];
  spreadsheet_id?: string;
  sheet_name?: string;
  price_changes_detected?: number;
  cost_changes_detected?: number;
  price_cost_updates_created?: number;
  price_cost_updates_skipped?: number;
}

export interface ProductCatalogStatus {
  total_products: number;
  active_products: number;
  total_brands: number;
  total_providers: number;
  mapped_brands: number;
  last_sync?: ProductSyncLogInfo | null;
  config: Record<string, unknown>;
}

export interface ProductSyncResult {
  ok: boolean;
  status: string;
  started_at: string;
  finished_at: string;
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  brands_created: number;
  errors: string[];
  spreadsheet_id?: string;
  sheet_name?: string;
  price_changes_detected: number;
  cost_changes_detected: number;
  price_cost_updates_created: number;
  price_cost_updates_skipped: number;
}
