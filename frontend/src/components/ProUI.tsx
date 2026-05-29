import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Search, XCircle } from 'lucide-react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="pro-page-header">
      <div className="min-w-0">
        {eyebrow && <div className="pro-eyebrow">{eyebrow}</div>}
        <h1 className="pro-title">{title}</h1>
        {description && <p className="pro-description">{description}</p>}
      </div>
      {actions && <div className="pro-actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  children,
  className = '',
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return <section className={`pro-panel ${compact ? 'pro-panel-compact' : ''} ${className}`}>{children}</section>;
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pro-section-header">
      <div className="min-w-0">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="pro-section-actions">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  detail,
  tone = 'slate',
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
}) {
  return (
    <div className={`pro-kpi pro-kpi-${tone}`}>
      <div className="pro-kpi-label">{label}</div>
      <div className="pro-kpi-value">{value}</div>
      {detail && <div className="pro-kpi-detail">{detail}</div>}
    </div>
  );
}

export function Notice({
  children,
  tone = 'info',
  title,
}: {
  children: ReactNode;
  title?: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error';
}) {
  const icon = tone === 'success' ? <CheckCircle2 size={18} /> : tone === 'error' ? <XCircle size={18} /> : tone === 'warning' ? <AlertTriangle size={18} /> : <Info size={18} />;
  return <div className={`pro-notice pro-notice-${tone}`}>{icon}<div>{title && <div className="pro-notice-title">{title}</div>}<div>{children}</div></div></div>;
}

export function Tabs({ children }: { children: ReactNode }) {
  return <nav className="pro-tabs">{children}</nav>;
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`pro-tab ${active ? 'pro-tab-active' : ''}`}>{children}</button>;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="pro-search-field">
      <Search size={18} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder || 'Buscar'} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pro-empty-state">
      <div className="pro-empty-icon"><Info size={22} /></div>
      <div>
        <div className="pro-empty-title">{title}</div>
        {description && <div className="pro-empty-description">{description}</div>}
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Cargando información' }: { label?: ReactNode }) {
  return (
    <div className="pro-loading-state">
      <Loader2 className="pro-spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ title = 'No se pudo completar la operación', children, action }: { title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="pro-error-state">
      <XCircle size={22} />
      <div className="min-w-0">
        <div className="pro-error-title">{title}</div>
        {children && <div className="pro-error-detail">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function FormField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="pro-field">
      <span className="pro-field-label">{label}</span>
      {children}
      {hint && <span className="pro-field-hint">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' }) {
  return <span className={`pro-badge pro-badge-${tone}`}>{children}</span>;
}

export function ResponsiveTable({ children }: { children: ReactNode }) {
  return <div className="pro-table-wrap">{children}</div>;
}

export const proInputClass = 'pro-input';
export const primaryButtonClass = 'pro-btn pro-btn-primary';
export const secondaryButtonClass = 'pro-btn pro-btn-secondary';
export const subtleButtonClass = 'pro-btn pro-btn-subtle';

/* ─────────────────────────────────────────────────────────────────────────
   Fase 1 — Componentes ERP (dark)
   Conviven con los `pro-*` anteriores. Sólo los usa la Dashboard piloto
   por ahora; el resto de las páginas migra en fases posteriores.
   ───────────────────────────────────────────────────────────────────────── */

export function ErpPageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="erp-page-header">
      <div className="min-w-0">
        <h1 className="erp-page-title">{title}</h1>
        {description && <p className="erp-page-description">{description}</p>}
      </div>
      {actions && <div className="erp-page-actions">{actions}</div>}
    </header>
  );
}

export type ErpKpiVariant = 'default' | 'alert' | 'danger' | 'success';

export function ErpKpiCard({
  label,
  value,
  detail,
  variant = 'default',
  icon,
  delta,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  variant?: ErpKpiVariant;
  icon?: ReactNode;
  delta?: { value: ReactNode; direction: 'up' | 'down' };
}) {
  const variantClass = variant === 'alert' ? 'is-alert' : variant === 'danger' ? 'is-danger' : variant === 'success' ? 'is-success' : '';
  return (
    <div className={`erp-kpi ${variantClass}`}>
      <div className="erp-kpi-label">
        {icon && <span style={{ display: 'inline-flex' }} aria-hidden="true">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="erp-kpi-value">{value}</div>
      {(detail || delta) && (
        <div className="erp-kpi-detail">
          {delta && (
            <span className={`erp-kpi-delta ${delta.direction === 'up' ? 'erp-kpi-delta-up' : 'erp-kpi-delta-down'}`}>
              {delta.direction === 'up' ? '▲' : '▼'} {delta.value}
            </span>
          )}
          {delta && detail && <span> · </span>}
          {detail}
        </div>
      )}
    </div>
  );
}

export type ErpBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'primary' | 'solid-danger';

export function ErpBadge({ children, tone = 'neutral', withDot = true }: { children: ReactNode; tone?: ErpBadgeTone; withDot?: boolean }) {
  const cls = tone === 'solid-danger' ? 'erp-badge erp-badge-solid-danger' : `erp-badge erp-badge-${tone}`;
  return (
    <span className={cls}>
      {withDot && tone !== 'solid-danger' && <span className="erp-badge-dot" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}

export const erpBtnPrimary = 'erp-btn erp-btn-primary';
export const erpBtnSecondary = 'erp-btn erp-btn-secondary';
export const erpBtnGhost = 'erp-btn erp-btn-ghost';
export const erpBtnDanger = 'erp-btn erp-btn-danger';

/* ─────────────────────────────────────────────────────────────────────────
   Fase 2 — Primitivos ERP
   ───────────────────────────────────────────────────────────────────────── */

import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type ErpButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ErpButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ErpButtonVariant;
  size?: 'sm' | 'md';
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

export function ErpButton({
  variant = 'secondary',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...rest
}: ErpButtonProps) {
  const variantCls = {
    primary: 'erp-btn-primary',
    secondary: 'erp-btn-secondary',
    ghost: 'erp-btn-ghost',
    danger: 'erp-btn-danger',
  }[variant];
  const sizeCls = size === 'sm' ? 'erp-btn-sm' : '';
  const widthCls = fullWidth ? 'w-full' : '';
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`erp-btn ${variantCls} ${sizeCls} ${widthCls} ${className}`.trim()}
    >
      {loading ? <Loader2 className="erp-spin" size={14} /> : leftIcon}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
}

interface ErpInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function ErpInput({ invalid, className = '', ...rest }: ErpInputProps) {
  return <input {...rest} aria-invalid={invalid || undefined} className={`erp-input ${invalid ? 'is-error' : ''} ${className}`.trim()} />;
}

interface ErpTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function ErpTextarea({ invalid, className = '', ...rest }: ErpTextareaProps) {
  return <textarea {...rest} aria-invalid={invalid || undefined} className={`erp-input ${invalid ? 'is-error' : ''} ${className}`.trim()} />;
}

interface ErpSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function ErpSelect({ invalid, className = '', children, ...rest }: ErpSelectProps) {
  return (
    <select {...rest} aria-invalid={invalid || undefined} className={`erp-input ${invalid ? 'is-error' : ''} ${className}`.trim()}>
      {children}
    </select>
  );
}

export function ErpField({
  label,
  hint,
  error,
  required,
  htmlFor,
  wide,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`erp-field ${wide ? 'erp-field-wide' : ''}`.trim()}>
      {label && (
        <label className="erp-field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="erp-field-required" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="erp-field-error" role="alert">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>{error}</span>
        </span>
      ) : hint ? (
        <span className="erp-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function ErpCard({
  title,
  subtitle,
  actions,
  children,
  footer,
  size = 'md',
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeCls = size === 'sm' ? 'erp-card-sm' : size === 'lg' ? 'erp-card-lg' : '';
  return (
    <section className={`erp-card ${sizeCls} ${className}`.trim()}>
      {(title || actions) && (
        <header className="erp-card-header">
          <div className="min-w-0">
            {title && <h3 className="erp-card-title">{title}</h3>}
            {subtitle && <div className="erp-card-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <div className="erp-form-actions mt-3">{footer}</div>}
    </section>
  );
}

export function ErpSection({
  n,
  title,
  subtitle,
  actions,
  children,
}: {
  n?: number;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="erp-section">
      {(title || actions) && (
        <div className="erp-section-head" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
            {typeof n === 'number' && <span className="erp-section-num" aria-hidden="true">{n}</span>}
            <div className="min-w-0">
              {title && <h2 className="erp-section-title">{title}</h2>}
              {subtitle && <p className="erp-section-sub">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export type ErpNoticeTone = 'info' | 'success' | 'warning' | 'error';

export function ErpNotice({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: ErpNoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const icon = tone === 'success' ? <CheckCircle2 size={16} /> : tone === 'warning' ? <AlertTriangle size={16} /> : tone === 'error' ? <XCircle size={16} /> : <Info size={16} />;
  return (
    <div className={`erp-notice erp-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="erp-notice-icon" aria-hidden="true">{icon}</span>
      <div className="erp-notice-body">
        {title && <div className="erp-notice-title">{title}</div>}
        {children && <div>{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function ErpEmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  cta?: ReactNode;
}) {
  return (
    <div className="erp-empty-state">
      <div className="erp-empty-icon">{icon || <Info size={20} />}</div>
      <h4 className="erp-empty-title">{title}</h4>
      {description && <p className="erp-empty-description">{description}</p>}
      {cta && <div className="erp-state-cta">{cta}</div>}
    </div>
  );
}

export function ErpLoadingState({
  title = 'Cargando información',
  description,
}: {
  title?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="erp-loading-state">
      <div className="erp-loading-icon"><Loader2 className="erp-spin" size={20} /></div>
      <h4 className="erp-loading-title">{title}</h4>
      {description && <p className="erp-loading-description">{description}</p>}
    </div>
  );
}

export function ErpErrorState({
  title = 'No pudimos cargar esta información',
  description,
  retry,
}: {
  title?: ReactNode;
  description?: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="erp-error-state">
      <div className="erp-error-icon"><XCircle size={20} /></div>
      <h4 className="erp-error-title">{title}</h4>
      {description && <p className="erp-error-description">{description}</p>}
      {retry && (
        <div className="erp-state-cta">
          <ErpButton variant="secondary" size="sm" onClick={retry}>Reintentar</ErpButton>
        </div>
      )}
    </div>
  );
}

export function ErpInfoRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="erp-info-row">
      <span className="erp-info-label">{label}</span>
      <span className="erp-info-value">{value}</span>
    </div>
  );
}

export function ErpInfoGrid({ columns = 2, children }: { columns?: 2 | 3 | 4; children: ReactNode }) {
  return <div className={`erp-info-grid erp-info-grid-${columns}`}>{children}</div>;
}

export interface ErpTabDef {
  key: string;
  label: ReactNode;
  count?: number;
}

export function ErpTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: ErpTabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="erp-tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          onClick={() => onChange(tab.key)}
          className={`erp-tab ${tab.key === active ? 'is-active' : ''}`}
        >
          <span>{tab.label}</span>
          {typeof tab.count === 'number' && <span className="erp-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ErpTag({ tone, children }: { tone?: 'primary' | 'success'; children: ReactNode }) {
  const cls = tone === 'primary' ? 'erp-tag erp-tag-primary' : tone === 'success' ? 'erp-tag erp-tag-success' : 'erp-tag';
  return <span className={cls}>{children}</span>;
}

/* ─────────────────────────────────────────────────────────────────────────
   Fase 4 — DataTable, FilterBar, RowMenu
   ───────────────────────────────────────────────────────────────────────── */

import { MoreHorizontal, Search as SearchIcon, X as XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type ErpColumnAlign = 'left' | 'right' | 'center';

export interface ErpColumn<T> {
  key: string;
  header: ReactNode;
  align?: ErpColumnAlign;
  width?: string | number;
  className?: string;
  muted?: boolean;
  render: (row: T, index: number) => ReactNode;
}

export interface ErpRowAction<T> {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: (row: T) => boolean;
  onClick: (row: T) => void;
}

interface ErpDataTableProps<T> {
  columns: ErpColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: string | null;
  onRowClick?: (row: T) => void;
  rowActions?: ErpRowAction<T>[];
  selectable?: boolean;
  selected?: Set<string | number>;
  onSelectionChange?: (next: Set<string | number>) => void;
  bulkActions?: ReactNode;
  compact?: boolean;
  empty?: { title?: ReactNode; description?: ReactNode; cta?: ReactNode };
  footer?: ReactNode;
  minWidth?: number;
  rowClassName?: (row: T) => string | undefined;
  /**
   * Si está presente, en mobile (<768 px) se renderiza una lista de cards
   * verticales en lugar de la tabla con scroll horizontal. Esto da una vista
   * más cómoda al tacto en pantallas chicas.
   */
  renderMobileCard?: (row: T, index: number) => ReactNode;
}

function alignClass(align?: ErpColumnAlign, kind: 'th' | 'td' = 'td') {
  if (align === 'right') return 'is-numeric';
  if (align === 'center') return 'is-center';
  return '';
}

export function ErpDataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRowClick,
  rowActions,
  selectable = false,
  selected,
  onSelectionChange,
  bulkActions,
  compact = false,
  empty,
  footer,
  minWidth,
  rowClassName,
  renderMobileCard,
}: ErpDataTableProps<T>) {
  const hasActions = !!rowActions && rowActions.length > 0;
  const colCount = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const allKeys = rows.map(rowKey);
  const allSelected = selectable && allKeys.length > 0 && allKeys.every((k) => selected?.has(k));
  const someSelected = selectable && !allSelected && allKeys.some((k) => selected?.has(k));

  function toggleAll(checked: boolean) {
    if (!onSelectionChange) return;
    const next = new Set<string | number>(selected || []);
    if (checked) allKeys.forEach((k) => next.add(k));
    else allKeys.forEach((k) => next.delete(k));
    onSelectionChange(next);
  }

  function toggleRow(key: string | number, checked: boolean) {
    if (!onSelectionChange) return;
    const next = new Set<string | number>(selected || []);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectionChange(next);
  }

  const hasMobileCards = !!renderMobileCard;
  return (
    <div className={`erp-table-wrap${hasMobileCards ? ' has-mobile-cards' : ''}`}>
      {selectable && selected && selected.size > 0 && (
        <div className="erp-table-bulkbar">
          <span>{selected.size} seleccionada{selected.size === 1 ? '' : 's'}</span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions}</div>
        </div>
      )}
      {hasMobileCards && (
        <div className="erp-table-mobile-cards">
          {loading && rows.length === 0 && <ErpLoadingState />}
          {!loading && error && <ErpErrorState description={error} />}
          {!loading && !error && rows.length === 0 && (
            <ErpEmptyState
              title={empty?.title || 'Sin resultados'}
              description={empty?.description || 'Ajustá los filtros para ver registros.'}
              cta={empty?.cta}
            />
          )}
          {!loading && !error && rows.map((row, idx) => (
            <div key={`mcard-${rowKey(row)}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {renderMobileCard!(row, idx)}
            </div>
          ))}
        </div>
      )}
      <div className="erp-table-scroller">
        <table className={`erp-table ${compact ? 'erp-table-compact' : ''}`} style={minWidth ? { minWidth } : undefined}>
          <thead>
            <tr>
              {selectable && (
                <th className="is-check">
                  <input
                    type="checkbox"
                    className="erp-checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="Seleccionar todos"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th key={col.key} className={`${alignClass(col.align, 'th')} ${col.className || ''}`.trim()} style={col.width ? { width: col.width } : undefined}>
                  {col.header}
                </th>
              ))}
              {hasActions && <th className="is-action" aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colCount} className="erp-table-state">
                  <ErpLoadingState />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={colCount} className="erp-table-state">
                  <ErpErrorState description={error} />
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="erp-table-state">
                  <ErpEmptyState
                    title={empty?.title || 'Sin resultados'}
                    description={empty?.description || 'Ajustá los filtros para ver registros.'}
                    cta={empty?.cta}
                  />
                </td>
              </tr>
            )}
            {!loading && !error && rows.map((row, idx) => {
              const key = rowKey(row);
              const isSelected = !!selected?.has(key);
              const customCls = rowClassName?.(row) || '';
              const cls = `${onRowClick ? 'is-clickable' : ''} ${isSelected ? 'is-selected' : ''} ${customCls}`.trim();
              return (
                <tr
                  key={key}
                  className={cls}
                  onClick={onRowClick ? (e) => {
                    // No disparar onRowClick si clickearon un input/button/link dentro de la fila
                    const target = e.target as HTMLElement;
                    if (target.closest('button, a, input, select, [data-stop-row-click]')) return;
                    onRowClick(row);
                  } : undefined}
                >
                  {selectable && (
                    <td className="is-check">
                      <input
                        type="checkbox"
                        className="erp-checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleRow(key, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Seleccionar fila ${idx + 1}`}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={`${alignClass(col.align)} ${col.muted ? 'is-muted' : ''} ${col.className || ''}`.trim()}>
                      {col.render(row, idx)}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="is-action" data-stop-row-click>
                      <ErpRowMenu actions={rowActions!.filter((a) => !a.hidden?.(row))} row={row} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer && <div className="erp-table-footer">{footer}</div>}
    </div>
  );
}

export function ErpRowMenu<T>({ actions, row }: { actions: ErpRowAction<T>[]; row: T }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function compute() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuW = 220;
      const top = rect.bottom + 4;
      const left = Math.max(8, rect.right - menuW);
      setPos({ top, left });
    }
    compute();
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`erp-rowmenu-trigger ${open ? 'is-open' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Acciones de la fila"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="erp-rowmenu"
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((action, idx) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className={`erp-rowmenu-item ${action.danger ? 'is-danger' : ''}`}
              onClick={() => { setOpen(false); action.onClick(row); }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
          {/* placeholder anchor por si querés divisores en el futuro */}
          {actions.length === 0 && <span key="placeholder" />}
        </div>
      )}
    </>
  );
}

export interface ErpFilterChipDef {
  key: string;
  label: ReactNode;
  active?: boolean;
  onClear?: () => void;
  onClick?: () => void;
}

export function ErpFilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Buscar',
  chips,
  onReset,
  showReset = true,
  extra,
}: {
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  chips?: ErpFilterChipDef[];
  onReset?: () => void;
  showReset?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="erp-filterbar">
      {onSearch && (
        <div className="erp-filterbar-search">
          <SearchIcon size={14} className="erp-filterbar-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={search || ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      )}
      {chips?.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={`erp-chip ${chip.active ? 'is-active' : ''}`}
          onClick={chip.onClick}
        >
          <span>{chip.label}</span>
          {chip.active && chip.onClear && (
            <span
              className="erp-chip-clear"
              onClick={(e) => { e.stopPropagation(); chip.onClear?.(); }}
              role="button"
              aria-label="Quitar filtro"
            >
              <XIcon size={11} />
            </span>
          )}
        </button>
      ))}
      <div className="erp-filterbar-spacer" />
      {extra}
      {showReset && onReset && <button type="button" className="erp-filterbar-reset" onClick={onReset}>Limpiar filtros</button>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Fase 5 — Drawer, Modal, ConfirmDialog, Timeline
   ───────────────────────────────────────────────────────────────────────── */

import { createPortal } from 'react-dom';
import { X as CloseIcon } from 'lucide-react';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);
}

export function ErpDrawer({
  open,
  onClose,
  title,
  subtitle,
  headerActions,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="erp-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="erp-drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="erp-drawer-header">
          <div className="min-w-0">
            <h2 className="erp-drawer-title">{title}</h2>
            {subtitle && <div className="erp-drawer-sub">{subtitle}</div>}
          </div>
          <div className="erp-drawer-actions">
            {headerActions}
            <button type="button" className="erp-drawer-close" onClick={onClose} aria-label="Cerrar">
              <CloseIcon size={16} />
            </button>
          </div>
        </header>
        <div className="erp-drawer-body">{children}</div>
        {footer && <div className="erp-drawer-footer">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

export type ErpModalSize = 'sm' | 'md' | 'lg';

export function ErpModal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
  showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ErpModalSize;
  children: ReactNode;
  footer?: ReactNode;
  showClose?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  const sizeCls = size === 'sm' ? 'erp-modal-sm' : size === 'lg' ? 'erp-modal-lg' : '';
  return createPortal(
    <>
      <div className="erp-overlay" onClick={onClose} aria-hidden="true" />
      <div className={`erp-modal ${sizeCls}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        {(title || showClose) && (
          <header className="erp-modal-header">
            <div className="min-w-0 flex-1">
              {title && <h2 className="erp-drawer-title">{title}</h2>}
            </div>
            {showClose && (
              <button type="button" className="erp-drawer-close" onClick={onClose} aria-label="Cerrar">
                <CloseIcon size={16} />
              </button>
            )}
          </header>
        )}
        <div className="erp-modal-body">{children}</div>
        {footer && <div className="erp-modal-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export type ErpConfirmTone = 'danger' | 'warning' | 'info' | 'primary';

export function ErpConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'primary',
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: ErpConfirmTone;
  loading?: boolean;
}) {
  const icon = tone === 'danger' ? <XCircle size={20} /> : tone === 'warning' ? <AlertTriangle size={20} /> : <Info size={20} />;
  const iconWrapCls = tone === 'danger' ? 'erp-modal-icon-danger' : tone === 'warning' ? 'erp-modal-icon-warning' : 'erp-modal-icon-info';
  const confirmVariant: ErpButtonVariant = tone === 'danger' ? 'danger' : 'primary';

  return (
    <ErpModal open={open} onClose={loading ? () => undefined : onClose} title={undefined} size="sm" showClose={false} footer={
      <>
        <ErpButton variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</ErpButton>
        <ErpButton variant={confirmVariant} onClick={() => onConfirm()} loading={loading}>{confirmLabel}</ErpButton>
      </>
    }>
      <div className="flex gap-3">
        <span className={iconWrapCls} aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h2 className="erp-drawer-title">{title}</h2>
          {body && <div className="mt-1 text-[color:var(--text-2)]">{body}</div>}
        </div>
      </div>
    </ErpModal>
  );
}

export type ErpTimelineDotState = 'default' | 'ok' | 'warn' | 'err' | 'now';

export interface ErpTimelineItemProps {
  state?: ErpTimelineDotState;
  title: ReactNode;
  meta?: ReactNode;
  note?: ReactNode;
}

export function ErpTimeline({ children }: { children: ReactNode }) {
  return <ol className="erp-timeline">{children}</ol>;
}

export function ErpTimelineItem({ state = 'default', title, meta, note }: ErpTimelineItemProps) {
  const dotCls = state === 'ok' ? 'is-ok' : state === 'warn' ? 'is-warn' : state === 'err' ? 'is-err' : state === 'now' ? 'is-now' : '';
  return (
    <li className="erp-timeline-item">
      <span className={`erp-timeline-dot ${dotCls}`} aria-hidden="true" />
      <div className="erp-timeline-content">
        <div className="erp-timeline-title">{title}</div>
        {meta && <div className="erp-timeline-meta">{meta}</div>}
        {note && <div className="erp-timeline-note">{note}</div>}
      </div>
    </li>
  );
}
