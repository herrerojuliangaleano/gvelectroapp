import type {
  AuditEvent,
  ConfirmRemitoArrivalPayload,
  DispatchRemitoPayload,
  GenerateRemitosPayload,
  DepositTransferOptions,
  DepositTransferPayload,
  WarrantyRemitoInfo,
  WarrantyRemitosResponse,
  SalesBIAnalyzeResponse,
  SalesBIImport,
  SalesBIImportDetail,
  SalesBIRecord,
  SalesBIBalance,
  SalesBIStats,
  BackupInfo,
  BranchInfo,
  BudgetCreatePayload,
  BudgetCreateResponse,
  BudgetOptions,
  BudgetProduct,
  CompanyInfo,
  ConfigStatus,
  CurrentUser,
  EmployeeInfo,
  GoogleAdminStatus,
  JobInfo,
  NotificationInfo,
  NotificationFilters,
  NotificationSummary,
  OperationalConfigPayload,
  OperationalConfigResponse,
  OperationalConfigValidationResult,
  OperationalStructure,
  PermissionInfo,
  ProductBrandInfo,
  ProductCatalogStatus,
  ProductInfo,
  ProductListResponse,
  ProductSyncLogInfo,
  ProductSyncResult,
  ProviderInfo,
  ProviderPayload,
  BrandProviderInfo,
  BrandProviderPayload,
  PayrollBulkPreviewResponse,
  PayrollBulkUploadResponse,
  PayrollReceipt,
  PayrollReceiptListResponse,
  PriceCostProductLookup,
  PriceCostUpdate,
  PriceCostUpdateCreatePayload,
  PriceCostUpdateHistory,
  PriceCostUpdateType,
  RoleInfo,
  SalesWebCreatePayload,
  SalesWebOptions,
  SalesWebRequest,
  SystemAbout,
  SystemDiagnostics,
  SystemPublicStatus,
  SystemRepairResult,
  SystemSummary,
  ToolInfo,
  UserInfo,
  WarrantyCounterInfo,
  WarrantyCountersResponse,
  WarrantyCreateResponse,
  WarrantyConfigResponse,
  WarrantyConfigSavePayload,
  WarrantyCancelPayload,
  WarrantyDashboardResponse,
  WarrantyDiagnosticsResponse,
  WarrantyDetailResponse,
  WarrantyItemPayload,
  WarrantyListResponse,
  WarrantyOptions,
  WarrantyProduct,
  WarrantyReviewPayload,
  WarrantyProviderSendPayload,
  WarrantyProviderResponsePayload,
  WarrantyProviderPickupPayload,
  WarrantyClaimPayload,
  WarrantyResendMailPayload,
  WarrantyStatusChangePayload,
  ConfirmShipmentPayload,
  WarrantyBatchExportPayload,
  WarrantyExportInfo,
  WarrantyExportListResponse,
  WarrantyExportPayload,
  SetupSheetResult,
  WarrantySyncLogsResponse,
  WarrantySyncResult,
  WarrantySyncStatus,
  WarrantyResetPreviewResponse,
  WarrantyResetResponse,
  WarrantyUpdatePayload,
  WarrantyEntryBaseUpdatePayload,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const TOKEN_KEY = 'electrogv_token';
const SESSION_KEY = 'electrogv_session';

// Claves viejas mantenidas solo para migración automática al nuevo formato consolidado.
const LEGACY_KEYS = [
  'electrogv_username', 'electrogv_display_name', 'electrogv_role', 'electrogv_roles',
  'electrogv_sucursal', 'electrogv_company_id', 'electrogv_company_name',
  'electrogv_branch_id', 'electrogv_branch_name', 'electrogv_branch_code',
  'electrogv_branch_type', 'electrogv_branches', 'electrogv_branch_ids',
  'electrogv_permissions', 'electrogv_must_change_password',
];

interface SessionData {
  username: string;
  display_name: string;
  role: string;
  roles: string[];
  sucursal: string;
  company_id: string;
  company_name: string;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  branch_type: string;
  branches: CurrentUser['branches'];
  branch_ids: string[];
  permissions: string[];
  must_change_password: boolean;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function readSession(): SessionData | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) return parseJson<SessionData | null>(raw, null);
  // Migración: leer claves viejas y consolidar.
  const username = localStorage.getItem('electrogv_username');
  if (!username) return null;
  return {
    username,
    display_name: localStorage.getItem('electrogv_display_name') || username,
    role: localStorage.getItem('electrogv_role') || '',
    roles: parseJson<string[]>(localStorage.getItem('electrogv_roles'), []),
    sucursal: localStorage.getItem('electrogv_sucursal') || '',
    company_id: localStorage.getItem('electrogv_company_id') || '',
    company_name: localStorage.getItem('electrogv_company_name') || '',
    branch_id: localStorage.getItem('electrogv_branch_id') || '',
    branch_name: localStorage.getItem('electrogv_branch_name') || '',
    branch_code: localStorage.getItem('electrogv_branch_code') || '',
    branch_type: localStorage.getItem('electrogv_branch_type') || '',
    branches: parseJson<CurrentUser['branches']>(localStorage.getItem('electrogv_branches'), []),
    branch_ids: parseJson<string[]>(localStorage.getItem('electrogv_branch_ids'), []),
    permissions: parseJson<string[]>(localStorage.getItem('electrogv_permissions'), []),
    must_change_password: localStorage.getItem('electrogv_must_change_password') === '1',
  };
}

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(token: string): void { localStorage.setItem(TOKEN_KEY, token); }

export function setSession(token: string, username?: string, displayName?: string, role?: string, permissions: string[] = [], mustChangePassword = false, sucursal = '', org: Partial<CurrentUser> = {}): void {
  const data: SessionData = {
    username: username || '',
    display_name: displayName || username || '',
    role: role || '',
    roles: org.roles || (role ? [role] : []),
    sucursal: sucursal || org.branch_name || '',
    company_id: org.company_id || '',
    company_name: org.company_name || '',
    branch_id: org.branch_id || '',
    branch_name: org.branch_name || '',
    branch_code: org.branch_code || '',
    branch_type: org.branch_type || '',
    branches: org.branches || [],
    branch_ids: org.branch_ids || [],
    permissions,
    must_change_password: mustChangePassword,
  };
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
}

export function getCurrentUsername(): string | null { return readSession()?.username ?? null; }

export function getCurrentUserFromStorage(): CurrentUser | null {
  const s = readSession();
  if (!s?.username) return null;
  return {
    username: s.username,
    display_name: s.display_name,
    role: s.role,
    roles: s.roles,
    sucursal: s.sucursal,
    company_id: s.company_id,
    company_name: s.company_name,
    branch_id: s.branch_id,
    branch_name: s.branch_name,
    branch_code: s.branch_code,
    branch_type: s.branch_type,
    branches: s.branches,
    branch_ids: s.branch_ids,
    employee: null,
    permissions: s.permissions,
    is_active: true,
    must_change_password: s.must_change_password,
  };
}

export function can(permission: string): boolean {
  const user = getCurrentUserFromStorage();
  if (!user || user.must_change_password) return false;
  return user.permissions.includes('*') || user.permissions.includes(permission);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
}
export function logout(): void { clearSession(); }

const CONNECTION_ERROR = 'No se pudo conectar con el servidor local. Verificá que el backend esté encendido y que la URL de conexión sea correcta.';

async function _fetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set('ngrok-skip-browser-warning', 'true');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    if (res.status === 401) clearSession();
    return res;
  } catch {
    throw new Error(CONNECTION_ERROR);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await _fetch(path, options);
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data: any = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  if (!res.ok) {
    const message = data && typeof data === 'object'
      ? (data.detail || data.message || `Error ${res.status}`)
      : String(data || `Error ${res.status}`);
    throw new Error(message);
  }

  if (!isJson) {
    const text = String(data || '');
    if (text.toLowerCase().includes('ngrok')) {
      throw new Error('Ngrok devolvió una página de advertencia en vez de JSON. Revisá VITE_API_BASE_URL y el header ngrok-skip-browser-warning.');
    }
    return text as T;
  }
  return data as T;
}

async function requestBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const res = await _fetch(path, options);
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    let message = `Error ${res.status}`;
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      message = data?.detail || data?.message || message;
    } else {
      message = await res.text().catch(() => message);
    }
    throw new Error(message);
  }
  return res.blob();
}

export interface LoginResponse extends CurrentUser { token: string; access_token: string; }

function _parseAuthResponse(res: Partial<LoginResponse>, fallbackUsername: string): LoginResponse {
  const token = res.token || res.access_token;
  if (!token) throw new Error('El backend no devolvió token de sesión.');
  return {
    token,
    access_token: token,
    username: res.username || fallbackUsername,
    display_name: res.display_name || res.username || fallbackUsername,
    role: res.role || '',
    roles: res.roles || (res.role ? [res.role] : []),
    permissions: res.permissions || [],
    sucursal: res.sucursal || '',
    company_id: res.company_id || '',
    company_name: res.company_name || '',
    branch_id: res.branch_id || '',
    branch_name: res.branch_name || '',
    branch_code: res.branch_code || '',
    branch_type: res.branch_type || '',
    branches: res.branches || [],
    branch_ids: res.branch_ids || [],
    employee: res.employee || null,
    must_change_password: !!res.must_change_password,
  };
}

function buildQs(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await request<Partial<LoginResponse>>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  return _parseAuthResponse(res, username);
}

export async function changePassword(newPassword: string): Promise<LoginResponse> {
  const res = await request<Partial<LoginResponse>>('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ new_password: newPassword }),
  });
  return _parseAuthResponse(res, '');
}

export async function fetchMe(): Promise<CurrentUser> { return request('/api/auth/me'); }
export async function uploadMyEmployeePhoto(file: File): Promise<CurrentUser> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/employees/me/photo', { method: 'POST', body: form });
}
export async function fetchEmployeePhoto(username: string): Promise<Blob> {
  return requestBlob(`/api/employees/${encodeURIComponent(username)}/photo`);
}
export async function requestEmployeePhoto(username: string): Promise<UserInfo> {
  return request(`/api/employees/${encodeURIComponent(username)}/photo/request`, { method: 'POST' });
}
export async function approveEmployeePhoto(username: string): Promise<UserInfo> {
  return request(`/api/employees/${encodeURIComponent(username)}/photo/approve`, { method: 'POST' });
}
export async function rejectEmployeePhoto(username: string): Promise<UserInfo> {
  return request(`/api/employees/${encodeURIComponent(username)}/photo/reject`, { method: 'POST' });
}

export async function fetchTools(): Promise<ToolInfo[]> { return request('/api/tools'); }
export async function fetchTool(toolId: string): Promise<ToolInfo> { return request(`/api/tools/${toolId}`); }
export async function runTool(toolId: string, payload: Record<string, unknown>, files: Record<string, File[]>): Promise<{ job_id: string; status: string }> {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  Object.entries(files).forEach(([field, fieldFiles]) => fieldFiles.forEach((file) => form.append('files', file, `${field}__FIELD__${file.name}`)));
  return request(`/api/tools/${toolId}/run`, { method: 'POST', body: form });
}

export async function fetchJobs(): Promise<JobInfo[]> { return request('/api/jobs'); }
export async function fetchJob(jobId: string): Promise<JobInfo> { return request(`/api/jobs/${jobId}`); }
export async function fetchJobLogs(jobId: string): Promise<{ job_id: string; logs: string }> { return request(`/api/jobs/${jobId}/logs`); }
export async function cancelJob(jobId: string): Promise<{ ok: boolean }> { return request(`/api/jobs/${jobId}/cancel`, { method: 'POST' }); }
export async function fetchConfigStatus(): Promise<ConfigStatus> { return request('/api/config/status'); }

export async function fetchWarrantyOptions(): Promise<WarrantyOptions> { return request('/api/warranties/options'); }
export async function searchWarrantyProducts(query: string): Promise<WarrantyProduct[]> { return request(`/api/warranties/products?q=${encodeURIComponent(query)}&limit=20`); }
export async function createWarrantyEntries(items: WarrantyItemPayload[], groupUnderOneId = false): Promise<WarrantyCreateResponse> {
  return request('/api/warranties/entries', { method: 'POST', body: JSON.stringify({ items, group_under_one_id: groupUnderOneId }) });
}
export async function fetchWarranties(params: Record<string, string | number | undefined> = {}): Promise<WarrantyListResponse> {
  return request(`/api/warranties/list${buildQs(params)}`);
}
export async function fetchWarrantyReviewQueue(params: Record<string, string | number | undefined> = {}): Promise<WarrantyListResponse> {
  return request(`/api/warranties/review-queue${buildQs(params)}`);
}
export async function fetchWarrantyManagement(params: Record<string, string | number | undefined> = {}): Promise<WarrantyListResponse> {
  return request(`/api/warranties/management${buildQs(params)}`);
}
export async function fetchDelayedWarranties(params: Record<string, string | number | undefined> = {}): Promise<WarrantyListResponse> {
  return request(`/api/warranties/delayed${buildQs(params)}`);
}
export async function fetchWarrantyDetail(id: string): Promise<WarrantyDetailResponse> { return request(`/api/warranties/${encodeURIComponent(id)}`); }
export async function updateWarranty(id: string, payload: WarrantyUpdatePayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function updateWarrantyEntryBase(id: string, payload: WarrantyEntryBaseUpdatePayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/entry-base`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function takeWarrantyIntoReview(id: string, payload: WarrantyReviewPayload = {}): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/take-review`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function markWarrantyIncomplete(id: string, payload: WarrantyReviewPayload = {}): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/mark-incomplete`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function approveWarrantyReview(id: string, payload: WarrantyReviewPayload = {}): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/approve-review`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function sendWarrantyToProvider(id: string, payload: WarrantyProviderSendPayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/send-provider`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function registerWarrantyProviderResponse(id: string, payload: WarrantyProviderResponsePayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/provider-response`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function registerWarrantyProviderPickupRequest(id: string, payload: WarrantyProviderPickupPayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/provider-pickup-request`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function registerWarrantyClaim(id: string, payload: WarrantyClaimPayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/claim`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function resendWarrantyProviderMail(id: string, payload: WarrantyResendMailPayload = {}): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/resend-provider-mail`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function changeWarrantyStatus(id: string, payload: WarrantyStatusChangePayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function confirmWarrantyShipment(id: string, payload: ConfirmShipmentPayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/confirm-shipment`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function fetchEligibleWarranties(params: Record<string, string | number | undefined> = {}): Promise<WarrantyListResponse> {
  return request(`/api/warranties/export/eligible${buildQs(params)}`);
}
export async function createBatchExport(payload: WarrantyBatchExportPayload): Promise<WarrantyExportInfo> {
  return request('/api/warranties/export/batch', { method: 'POST', body: JSON.stringify(payload) });
}
export async function createWarrantyExport(payload: WarrantyExportPayload): Promise<WarrantyExportInfo> {
  return request('/api/warranties/export/provider', { method: 'POST', body: JSON.stringify(payload) });
}
export async function fetchExportProviderSuggestions(query = '', selectedIds: string[] = []): Promise<{ items: string[] }> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  for (const id of selectedIds) params.append('warranty_ids', id);
  const qs = params.toString();
  return request(`/api/warranties/export/provider-suggestions${qs ? `?${qs}` : ''}`);
}

export async function fetchWarrantyExports(limit = 50): Promise<WarrantyExportListResponse> {
  return request(`/api/warranties/exports?limit=${encodeURIComponent(String(limit))}`);
}
export async function downloadWarrantyExport(exportId: number): Promise<Blob> {
  return requestBlob(`/api/warranties/exports/${encodeURIComponent(String(exportId))}/download`);
}

export async function fetchWarrantyConfig(): Promise<WarrantyConfigResponse> { return request('/api/warranties/config'); }
export async function fetchWarrantyDiagnostics(): Promise<WarrantyDiagnosticsResponse> { return request('/api/warranties/diagnostics'); }
export async function saveWarrantyConfig(payload: WarrantyConfigSavePayload): Promise<WarrantyConfigResponse> {
  return request('/api/warranties/config', { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function cancelWarranty(id: string, payload: WarrantyCancelPayload): Promise<WarrantyDetailResponse> {
  return request(`/api/warranties/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteWarranty(id: string): Promise<{ ok: boolean; deleted: string }> {
  return request(`/api/warranties/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchWarrantyDashboard(params: Record<string, string | number | undefined> = {}): Promise<WarrantyDashboardResponse> {
  return request(`/api/warranties/dashboard${buildQs(params)}`);
}

export async function fetchWarrantySyncStatus(): Promise<WarrantySyncStatus> { return request('/api/warranties/sync/status'); }
export async function fetchWarrantySyncLogs(limit = 30): Promise<WarrantySyncLogsResponse> { return request(`/api/warranties/sync/logs?limit=${encodeURIComponent(String(limit))}`); }
export async function setupWarrantySheet(): Promise<SetupSheetResult> { return request('/api/warranties/sync/setup-sheet', { method: 'POST' }); }
export async function pushWarrantiesToSheet(): Promise<WarrantySyncResult> { return request('/api/warranties/sync/push-to-sheet', { method: 'POST' }); }
export async function pullWarrantiesFromSheet(): Promise<WarrantySyncResult> { return request('/api/warranties/sync/pull-from-sheet', { method: 'POST' }); }
export async function fetchWarrantyProductionResetPreview(): Promise<WarrantyResetPreviewResponse> { return request('/api/warranties/production-reset/preview'); }
export async function downloadWarrantyProductionResetBackup(): Promise<Blob> { return requestBlob('/api/warranties/production-reset/backup', { method: 'POST' }); }
export async function executeWarrantyProductionReset(payload: { confirmation: string; reset_generated_files?: boolean }): Promise<WarrantyResetResponse> {
  return request('/api/warranties/production-reset/execute', { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchWarrantyCounters(): Promise<WarrantyCountersResponse> { return request('/api/warranties/counters'); }
export async function resyncWarrantyCounters(): Promise<WarrantyCountersResponse> { return request('/api/warranties/counters/resync', { method: 'POST' }); }

// ── Remitos internos ─────────────────────────────────────────────────────────

export async function fetchAvailableWarrantiesForRemito(sucursal = ''): Promise<{ items: import('../types').AvailableWarrantyForRemito[]; total: number }> {
  return request(`/api/warranties/remitos/available-warranties${buildQs(sucursal ? { sucursal } : {})}`);
}

export async function generateRemitos(payload: GenerateRemitosPayload): Promise<{ ok: boolean; remitos: WarrantyRemitoInfo[]; count: number }> {
  const res = await request<{ ok: boolean; created: WarrantyRemitoInfo[]; skipped_existing: string[] }>(
    '/api/warranties/remitos/generate', { method: 'POST', body: JSON.stringify(payload) }
  );
  return { ok: res.ok, remitos: res.created, count: res.created.length };
}

export async function fetchDepositTransferOptions(): Promise<DepositTransferOptions> {
  return request('/api/warranties/remitos/deposit-transfer/options');
}
export async function fetchAvailableWarrantiesForDepositTransfer(): Promise<{ items: import('../types').AvailableWarrantyForRemito[]; total: number; origen_deposito: string }> {
  return request('/api/warranties/remitos/deposit-transfer/available-warranties');
}
export async function generateDepositTransferRemito(payload: DepositTransferPayload): Promise<{ ok: boolean; remitos: WarrantyRemitoInfo[]; count: number }> {
  const res = await request<{ ok: boolean; created: WarrantyRemitoInfo[] }>(
    '/api/warranties/remitos/deposit-transfer/generate', { method: 'POST', body: JSON.stringify(payload) }
  );
  return { ok: res.ok, remitos: res.created, count: res.created.length };
}

export async function fetchRemitos(params: { shipment_code?: string; remito_code?: string; status?: string; brand?: string; origen_sucursal?: string } = {}): Promise<WarrantyRemitosResponse> {
  // Mantener la barra final: sin ella FastAPI puede resolver /api/warranties/remitos como warranty_id=remitos
  // por el catch-all de garantías y devolver "Garantía no encontrada".
  return request(`/api/warranties/remitos/${buildQs(params)}`);
}
export async function fetchRemito(remitoCode: string): Promise<WarrantyRemitoInfo> {
  return request(`/api/warranties/remitos/${encodeURIComponent(remitoCode)}`);
}
export async function fetchRemitoByCode(remitoCode: string): Promise<WarrantyRemitoInfo> {
  return request(`/api/warranties/remitos/by-code/${encodeURIComponent(remitoCode)}`);
}
export async function dispatchRemito(remitoCode: string, payload: DispatchRemitoPayload): Promise<{ ok: boolean; remito_code: string; status: string }> {
  return request(`/api/warranties/remitos/${encodeURIComponent(remitoCode)}/dispatch`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function confirmRemitoArrival(remitoCode: string, payload: ConfirmRemitoArrivalPayload): Promise<{ ok: boolean; remito_code: string; status: string; lote_consolidado: boolean }> {
  return request(`/api/warranties/remitos/${encodeURIComponent(remitoCode)}/confirm-arrival`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function confirmRemitoArrivalByCode(payload: ConfirmRemitoArrivalPayload): Promise<{ ok: boolean; remito_code: string; status: string; lote_consolidado: boolean }> {
  return request('/api/warranties/remitos/confirm-arrival-by-code', { method: 'POST', body: JSON.stringify(payload) });
}
export async function downloadRemitoPdf(remitoCode: string): Promise<Blob> {
  return requestBlob(`/api/warranties/remitos/${encodeURIComponent(remitoCode)}/pdf`);
}
export async function deleteRemito(remitoCode: string): Promise<{ ok: boolean; deleted: string; warranties_unlinked: number }> {
  return request(`/api/warranties/remitos/${encodeURIComponent(remitoCode)}`, { method: 'DELETE' });
}
export async function fetchAvailableWarrantiesForProviderDelivery(): Promise<{ items: import('../types').ProviderDeliveryWarranty[]; total: number }> {
  return request('/api/warranties/remitos/provider-delivery/available-warranties');
}
export async function generateProviderDeliveryRemito(payload: import('../types').ProviderDeliveryPayload): Promise<{ ok: boolean; remitos: import('../types').WarrantyRemitoInfo[]; count: number }> {
  const res = await request<{ ok: boolean; created: import('../types').WarrantyRemitoInfo[] }>(
    '/api/warranties/remitos/provider-delivery/generate', { method: 'POST', body: JSON.stringify(payload) }
  );
  return { ok: res.ok, remitos: res.created, count: res.created.length };
}

export async function fetchBudgetOptions(): Promise<BudgetOptions> { return request('/api/budgets/options'); }
export async function searchBudgetProducts(query: string): Promise<BudgetProduct[]> { return request(`/api/budgets/products?q=${encodeURIComponent(query)}&limit=20`); }
export async function createBudget(payload: BudgetCreatePayload): Promise<BudgetCreateResponse> { return request('/api/budgets/entries', { method: 'POST', body: JSON.stringify(payload) }); }

export async function fetchPermissions(): Promise<PermissionInfo[]> { return request('/api/admin/permissions'); }
export async function fetchRoles(): Promise<RoleInfo[]> { return request('/api/admin/roles'); }
export async function updateRole(roleName: string, payload: { label: string; level: number; permissions: string[] }): Promise<RoleInfo> { return request(`/api/admin/roles/${encodeURIComponent(roleName)}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export async function fetchUsers(): Promise<UserInfo[]> { return request('/api/admin/users'); }
export async function saveUser(payload: { username: string; display_name: string; role: string; roles?: string[]; sucursal?: string; company_id?: string; branch_id?: string; branch_ids?: string[]; employee?: Partial<EmployeeInfo>; password?: string; is_active: boolean }): Promise<UserInfo> { return request('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }); }
export async function activateUser(username: string): Promise<UserInfo> { return request(`/api/admin/users/${encodeURIComponent(username)}/activate`, { method: 'POST' }); }
export async function deactivateUser(username: string): Promise<UserInfo> { return request(`/api/admin/users/${encodeURIComponent(username)}/deactivate`, { method: 'POST' }); }
export async function resetUserPassword(username: string): Promise<UserInfo> { return request(`/api/admin/users/${encodeURIComponent(username)}/reset-password`, { method: 'POST' }); }
export async function deleteUser(username: string): Promise<{ ok: boolean }> { return request(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }); }
export async function repairUserBranchLinks(): Promise<{ ok: boolean; changed: number; synced: number; total: number }> { return request('/api/admin/users/repair-branch-links', { method: 'POST' }); }
export async function repairUserLegacyRoles(): Promise<{ ok: boolean; created_roles: number; changed_users: number; synced: number; total: number }> { return request('/api/admin/users/repair-legacy-roles', { method: 'POST' }); }
export async function repairUserEmployees(): Promise<{ ok: boolean; created: number; updated: number; total: number }> { return request('/api/admin/users/repair-employees', { method: 'POST' }); }
export async function fetchAudit(limit = 200, filters: { actor?: string; event_type?: string; status?: string } = {}): Promise<AuditEvent[]> {
  return request(`/api/admin/audit${buildQs({ limit, ...filters })}`);
}
export async function fetchMyActivity(limit = 10): Promise<AuditEvent[]> {
  const username = getCurrentUsername() || '';
  return fetchAudit(limit, username ? { actor: username } : {});
}

export async function fetchGoogleAdminStatus(): Promise<GoogleAdminStatus> { return request('/api/admin/google/status'); }
export async function saveGoogleCredentials(jsonText: string): Promise<{ ok: boolean; status: GoogleAdminStatus['credentials'] }> { return request('/api/admin/google/credentials', { method: 'POST', body: JSON.stringify({ json_text: jsonText }) }); }
export async function saveGoogleToken(jsonText: string): Promise<{ ok: boolean; status: GoogleAdminStatus['token'] }> { return request('/api/admin/google/token', { method: 'POST', body: JSON.stringify({ json_text: jsonText }) }); }
export async function deleteGoogleToken(): Promise<{ ok: boolean; deleted: boolean; status: GoogleAdminStatus['token'] }> { return request('/api/admin/google/token', { method: 'DELETE' }); }
export async function refreshGoogleToken(): Promise<{ ok: boolean; status: GoogleAdminStatus['token'] }> { return request('/api/admin/google/refresh-token', { method: 'POST' }); }
export async function startGoogleLocalReconnect(): Promise<{ ok: boolean; reconnect: GoogleAdminStatus['reconnect'] }> { return request('/api/admin/google/reconnect-local/start', { method: 'POST' }); }
export async function fetchGoogleReconnectStatus(): Promise<{ ok: boolean; reconnect: GoogleAdminStatus['reconnect']; status: GoogleAdminStatus['token'] }> { return request('/api/admin/google/reconnect-local/status'); }

export async function fetchOperationalConfig(): Promise<OperationalConfigResponse> { return request('/api/admin/operational-config'); }
export async function saveOperationalConfig(config: OperationalConfigPayload, lock = false): Promise<OperationalConfigResponse> { return request('/api/admin/operational-config', { method: 'PUT', body: JSON.stringify({ config, lock_after_save: lock }) }); }
export async function unlockOperationalConfig(): Promise<OperationalConfigResponse> { return request('/api/admin/operational-config/unlock', { method: 'POST' }); }
export async function lockOperationalConfig(): Promise<OperationalConfigResponse> { return request('/api/admin/operational-config/lock', { method: 'POST' }); }
export async function validateOperationalSection(section: string): Promise<OperationalConfigValidationResult> { return request('/api/admin/operational-config/validate', { method: 'POST', body: JSON.stringify({ section }) }); }

export async function fetchSystemStatus(): Promise<SystemPublicStatus> { return request('/api/system/status'); }
export async function fetchSystemSummary(): Promise<SystemSummary> { return request('/api/system/summary'); }
export async function fetchSystemDiagnostics(): Promise<SystemDiagnostics> { return request('/api/system/diagnostics'); }
export async function repairSystemDiagnostics(): Promise<SystemRepairResult> { return request('/api/system/diagnostics/repair', { method: 'POST' }); }
export async function setSystemMode(mode: string): Promise<SystemPublicStatus> { return request('/api/system/mode', { method: 'POST', body: JSON.stringify({ mode }) }); }
export async function fetchSystemAbout(): Promise<SystemAbout> { return request('/api/system/about'); }

export function backupDownloadUrl(filename: string): string { return `${API_BASE_URL}/api/admin/backups/${encodeURIComponent(filename)}`; }
export async function fetchBackups(): Promise<BackupInfo[]> { return request('/api/admin/backups'); }
export async function createBackup(): Promise<BackupInfo> { return request('/api/admin/backups', { method: 'POST' }); }


export async function registerFcmToken(token: string): Promise<void> {
  await request('/api/notifications/push/fcm-token', { method: 'POST', body: JSON.stringify({ token }) });
}
export async function unregisterFcmToken(token: string): Promise<void> {
  await request('/api/notifications/push/fcm-token', { method: 'DELETE', body: JSON.stringify({ token }) });
}

export async function fetchNotifications(options: boolean | NotificationFilters = false): Promise<NotificationInfo[]> {
  if (typeof options === 'boolean') {
    return request(`/api/notifications${options ? '?unread_only=true' : ''}`);
  }
  const params = new URLSearchParams();
  if (options.unreadOnly) params.set('unread_only', 'true');
  if (options.module) params.set('module', options.module);
  if (options.priority) params.set('priority', options.priority);
  if (options.readStatus && options.readStatus !== 'all') params.set('read_status', options.readStatus);
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return request(`/api/notifications${qs ? `?${qs}` : ''}`);
}
export async function fetchNotificationSummary(): Promise<NotificationSummary> { return request('/api/notifications/summary'); }
export async function fetchUnreadNotificationsCount(): Promise<{ count: number }> { return request('/api/notifications/unread-count'); }
export async function markNotificationRead(id: number): Promise<NotificationInfo> { return request(`/api/notifications/${id}/read`, { method: 'POST' }); }
export async function markAllNotificationsRead(module?: string): Promise<{ ok: boolean }> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : '';
  return request(`/api/notifications/mark-all-read${qs}`, { method: 'POST' });
}

export async function fetchSalesWebOptions(): Promise<SalesWebOptions> { return request('/api/sales-web/options'); }
export async function searchSalesWebProducts(query: string): Promise<BudgetProduct[]> { return request(`/api/sales-web/products?q=${encodeURIComponent(query)}&limit=20`); }
export async function createSalesWebRequest(payload: SalesWebCreatePayload): Promise<SalesWebRequest> { return request('/api/sales-web/requests', { method: 'POST', body: JSON.stringify(payload) }); }
export async function fetchSalesWebRequests(params: { estado?: string; q?: string; mine?: boolean; active_only?: boolean; sucursal?: string; limit?: number } = {}): Promise<SalesWebRequest[]> {
  return request(`/api/sales-web/requests${buildQs(params)}`);
}
export async function fetchSalesWebRequest(id: string | number): Promise<SalesWebRequest> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}`); }
export async function updateSalesWebRequest(id: string | number, payload: { numero_remito_prefactura?: string; observacion_admin?: string }): Promise<SalesWebRequest> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function takeSalesWebRequest(id: string | number): Promise<SalesWebRequest> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}/take`, { method: 'POST' }); }
export async function completeSalesWebRequest(id: string | number, payload: { numero_remito_prefactura?: string; observacion_admin?: string }): Promise<SalesWebRequest> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}/complete`, { method: 'POST', body: JSON.stringify(payload) }); }
export async function sendSalesWebRequest(id: string | number, payload: { observacion_admin?: string } = {}): Promise<SalesWebRequest> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}/send-to-sales`, { method: 'POST', body: JSON.stringify(payload) }); }
export async function cancelSalesWebRequest(id: string | number, cancelReason: string): Promise<SalesWebRequest> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}/cancel`, { method: 'POST', body: JSON.stringify({ cancel_reason: cancelReason }) }); }
export async function deleteSalesWebRequest(id: string | number): Promise<{ ok: boolean; deleted: boolean; numero_solicitud: string }> { return request(`/api/sales-web/requests/${encodeURIComponent(String(id))}`, { method: 'DELETE' }); }


export async function fetchPriceCostUpdates(params: { type?: PriceCostUpdateType | ''; estado?: string; q?: string; limit?: number } = {}): Promise<PriceCostUpdate[]> {
  return request(`/api/price-cost-updates${buildQs(params)}`);
}
export async function lookupPriceCostProduct(sku: string, type: PriceCostUpdateType): Promise<PriceCostProductLookup> {
  const qs = new URLSearchParams({ sku, type });
  return request(`/api/price-cost-updates/lookup-product?${qs.toString()}`);
}
export async function createPriceCostUpdate(payload: PriceCostUpdateCreatePayload): Promise<PriceCostUpdate> {
  return request('/api/price-cost-updates', { method: 'POST', body: JSON.stringify(payload) });
}
export async function fetchPriceCostUpdate(id: string | number): Promise<PriceCostUpdate> {
  return request(`/api/price-cost-updates/${encodeURIComponent(String(id))}`);
}
export async function updatePriceCostUpdate(id: string | number, payload: Partial<PriceCostUpdateCreatePayload>): Promise<PriceCostUpdate> {
  return request(`/api/price-cost-updates/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function setPriceCostUpdateCheck(id: string | number, checkKey: string, checked: boolean): Promise<PriceCostUpdate> {
  return request(`/api/price-cost-updates/${encodeURIComponent(String(id))}/check`, { method: 'POST', body: JSON.stringify({ check_key: checkKey, checked }) });
}
export async function cancelPriceCostUpdate(id: string | number, cancelReason = ''): Promise<PriceCostUpdate> {
  return request(`/api/price-cost-updates/${encodeURIComponent(String(id))}/cancel`, { method: 'POST', body: JSON.stringify({ cancel_reason: cancelReason }) });
}
export async function fetchPriceCostUpdateHistory(id: string | number): Promise<PriceCostUpdateHistory[]> {
  return request(`/api/price-cost-updates/${encodeURIComponent(String(id))}/history`);
}


export async function fetchCompanies(): Promise<CompanyInfo[]> { return request('/api/companies'); }
export async function createCompany(payload: { name: string; legal_name?: string; cuit?: string; is_active?: boolean }): Promise<CompanyInfo> {
  return request('/api/companies', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateCompany(id: string, payload: Partial<{ name: string; legal_name: string; cuit: string; is_active: boolean }>): Promise<CompanyInfo> {
  return request(`/api/companies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function fetchBranches(): Promise<BranchInfo[]> { return request('/api/branches'); }
export async function createBranch(payload: { company_id: string; name: string; code?: string; type?: string; parent_branch_id?: string | null; is_active?: boolean }): Promise<BranchInfo> {
  return request('/api/branches', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateBranch(id: string, payload: Partial<{ company_id: string; name: string; code: string; type: string; parent_branch_id: string | null; is_active: boolean }>): Promise<BranchInfo> {
  return request(`/api/branches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function fetchOperationalStructure(): Promise<OperationalStructure> { return request('/api/operational-structure'); }


export async function fetchPayrollReceipts(params: { scope?: 'auto' | 'own' | 'all'; status?: string; q?: string; period_year?: number | string; period_month?: number | string; limit?: number } = {}): Promise<PayrollReceiptListResponse> {
  return request(`/api/payroll/receipts${buildQs(params)}`);
}

export async function uploadPayrollReceipt(payload: { employee_id?: string; employee_username?: string; employee_dni?: string; period_year: number; period_month: number; receipt_type?: string; file: File }): Promise<PayrollReceipt> {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('period_year', String(payload.period_year));
  form.append('period_month', String(payload.period_month));
  form.append('receipt_type', payload.receipt_type || 'mensual');
  if (payload.employee_id) form.append('employee_id', payload.employee_id);
  if (payload.employee_username) form.append('employee_username', payload.employee_username);
  if (payload.employee_dni) form.append('employee_dni', payload.employee_dni);
  return request('/api/payroll/receipts', { method: 'POST', body: form });
}


type PayrollBulkMapping = Record<string, { dni?: string; employee_id?: string; username?: string }>;

function payrollBulkForm(payload: { files: File[]; period_year: number; period_month: number; receipt_type?: string; mappings?: PayrollBulkMapping; duplicate_strategy?: string }): FormData {
  const form = new FormData();
  payload.files.forEach((file) => form.append('files', file));
  form.append('period_year', String(payload.period_year));
  form.append('period_month', String(payload.period_month));
  form.append('receipt_type', payload.receipt_type || 'mensual');
  form.append('mappings_json', JSON.stringify(payload.mappings || {}));
  if (payload.duplicate_strategy) form.append('duplicate_strategy', payload.duplicate_strategy);
  return form;
}

export async function previewPayrollBulkReceipts(payload: { files: File[]; period_year: number; period_month: number; receipt_type?: string; mappings?: PayrollBulkMapping }): Promise<PayrollBulkPreviewResponse> {
  return request('/api/payroll/receipts/bulk/preview', { method: 'POST', body: payrollBulkForm(payload) });
}

export async function uploadPayrollBulkReceipts(payload: { files: File[]; period_year: number; period_month: number; receipt_type?: string; mappings?: PayrollBulkMapping; duplicate_strategy?: 'skip' | 'replace' | 'keep_both' | string }): Promise<PayrollBulkUploadResponse> {
  return request('/api/payroll/receipts/bulk/upload', { method: 'POST', body: payrollBulkForm(payload) });
}

export async function fetchPayrollReceipt(id: string): Promise<PayrollReceipt> { return request(`/api/payroll/receipts/${encodeURIComponent(id)}`); }
export async function fetchPayrollReceiptFile(id: string): Promise<Blob> { return requestBlob(`/api/payroll/receipts/${encodeURIComponent(id)}/file`); }
export async function signPayrollReceipt(id: string): Promise<PayrollReceipt> { return request(`/api/payroll/receipts/${encodeURIComponent(id)}/sign`, { method: 'POST' }); }
export async function observePayrollReceipt(id: string, message: string): Promise<PayrollReceipt> { return request(`/api/payroll/receipts/${encodeURIComponent(id)}/observe`, { method: 'POST', body: JSON.stringify({ message }) }); }
export async function respondPayrollObservation(id: string, observationId: string, answerMessage: string, status = 'respondida'): Promise<PayrollReceipt> { return request(`/api/payroll/receipts/${encodeURIComponent(id)}/observations/respond`, { method: 'POST', body: JSON.stringify({ observation_id: observationId, answer_message: answerMessage, status }) }); }
export async function cancelPayrollReceipt(id: string, reason = ''): Promise<PayrollReceipt> { return request(`/api/payroll/receipts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); }

// Catálogo local de productos / Planilla Madre
export async function fetchProductCatalogStatus(): Promise<ProductCatalogStatus> { return request('/api/products/status'); }
export async function fetchProducts(params: Record<string, string | number | undefined> = {}): Promise<ProductListResponse> {
  return request(`/api/products/catalog${buildQs(params)}`);
}
export async function searchProducts(query: string, limit = 20): Promise<ProductInfo[]> { return request(`/api/products/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`); }
export async function syncProductsFromSheet(): Promise<ProductSyncResult> { return request('/api/products/sync/from-sheet', { method: 'POST' }); }
export async function fetchProductSyncLogs(limit = 20): Promise<ProductSyncLogInfo[]> { return request(`/api/products/sync/logs?limit=${encodeURIComponent(String(limit))}`); }
export async function fetchProductBrands(): Promise<ProductBrandInfo[]> { return request('/api/products/brands'); }
export async function fetchProviders(includeInactive = false): Promise<ProviderInfo[]> { return request(`/api/products/providers?include_inactive=${includeInactive ? 'true' : 'false'}`); }
export async function createProvider(payload: ProviderPayload): Promise<ProviderInfo> { return request('/api/products/providers', { method: 'POST', body: JSON.stringify(payload) }); }
export async function updateProvider(id: number, payload: ProviderPayload): Promise<ProviderInfo> { return request(`/api/products/providers/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function fetchBrandProviders(): Promise<BrandProviderInfo[]> { return request('/api/products/brand-providers'); }
export async function setBrandProvider(payload: BrandProviderPayload): Promise<BrandProviderInfo> { return request('/api/products/brand-providers', { method: 'POST', body: JSON.stringify(payload) }); }
export async function deleteBrandProvider(id: number): Promise<{ ok: boolean }> { return request(`/api/products/brand-providers/${encodeURIComponent(String(id))}`, { method: 'DELETE' }); }

// ── Sales BI ──────────────────────────────────────────────────────────────────

export async function salesBIAnalyzeFile(file: File, sucursal?: string): Promise<SalesBIAnalyzeResponse> {
  const form = new FormData();
  form.append('file', file);
  if (sucursal) form.append('sucursal', sucursal);
  return request('/api/sales-bi/analyze', { method: 'POST', body: form });
}

export async function salesBIAnalyzeUrl(sheetUrl: string, sucursal?: string): Promise<SalesBIAnalyzeResponse> {
  const form = new FormData();
  form.append('sheet_url', sheetUrl);
  if (sucursal) form.append('sucursal', sucursal);
  return request('/api/sales-bi/analyze', { method: 'POST', body: form });
}

export async function salesBIConfirm(payload: {
  temp_file_key?: string;
  sheet_url?: string;
  sheet_names?: string[];
  replace?: boolean;
  sucursal?: string;
}): Promise<{ imported: { sheet_name: string; import_id: number; fecha: string; sucursal: string; tipo: string; total_records: number }[]; skipped: { sheet_name: string; reason: string }[] }> {
  return request('/api/sales-bi/confirm', { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchSalesBIImports(params: {
  fecha_desde?: string;
  fecha_hasta?: string;
  sucursal?: string;
  tipo?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: SalesBIImport[]; total: number }> {
  return request(`/api/sales-bi/imports${buildQs(params)}`);
}

export async function fetchSalesBIImport(id: number): Promise<SalesBIImportDetail> {
  return request(`/api/sales-bi/imports/${encodeURIComponent(String(id))}`);
}

export async function voidSalesBIImport(id: number, reason = ''): Promise<{ ok: boolean }> {
  return request(`/api/sales-bi/imports/${encodeURIComponent(String(id))}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function fetchSalesBIRecords(params: {
  import_id?: number;
  fecha_desde?: string;
  fecha_hasta?: string;
  sucursal?: string;
  tipo?: string;
  vendedor?: string;
  categoria?: string;
  condicion?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: SalesBIRecord[]; total: number }> {
  return request(`/api/sales-bi/records${buildQs(params)}`);
}

export async function fetchSalesBIBalances(params: {
  import_id?: number;
  fecha_desde?: string;
  fecha_hasta?: string;
  sucursal?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: SalesBIBalance[]; total: number }> {
  return request(`/api/sales-bi/balances${buildQs(params)}`);
}

export async function fetchSalesBIStats(): Promise<SalesBIStats> {
  return request('/api/sales-bi/stats');
}
