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
