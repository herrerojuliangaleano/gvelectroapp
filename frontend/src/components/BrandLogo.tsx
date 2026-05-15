import type { BrandDefinition } from '../brand';

export function BrandLogo({ brand, size = 'md', withText = true, className = '' }: { brand: BrandDefinition; size?: 'sm' | 'md' | 'lg'; withText?: boolean; className?: string }) {
  const sizeClass = size === 'lg' ? 'h-20 w-20' : size === 'sm' ? 'h-10 w-10' : 'h-14 w-14';
  const textTitle = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg';
  const textSubtitle = size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <div className={`${sizeClass} shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white p-1.5 shadow-lg shadow-black/20`}>
        <img src={brand.logo} alt={brand.name} className="h-full w-full object-contain" />
      </div>
      {withText && (
        <div className="min-w-0">
          <div className={`${textTitle} truncate font-black text-white`}>{brand.name}</div>
          <div className={`${textSubtitle} truncate font-semibold uppercase tracking-[0.12em] text-slate-400`}>{brand.subtitle}</div>
        </div>
      )}
    </div>
  );
}
