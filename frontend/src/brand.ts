import type { CurrentUser } from './types';

export type BrandKey = 'gv' | 'abc';

export interface BrandDefinition {
  key: BrandKey;
  name: string;
  shortName: string;
  subtitle: string;
  logo: string;
  accent: 'blue' | 'cyan';
}

export const BRANDS: Record<BrandKey, BrandDefinition> = {
  gv: {
    key: 'gv',
    name: 'GV Electro',
    shortName: 'GV',
    subtitle: 'Ecosistema interno',
    logo: '/brand/gv-electro.png',
    accent: 'blue',
  },
  abc: {
    key: 'abc',
    name: 'ABC Electro',
    shortName: 'ABC',
    subtitle: 'Outlet premium',
    logo: '/brand/abc-electro.png',
    accent: 'cyan',
  },
};

export function getBrandForUser(user?: Partial<CurrentUser> | null): BrandDefinition {
  if (!user) return BRANDS.gv;
  const role = String(user.role || '').toUpperCase();
  const company = `${user.company_name || ''} ${user.company_id || ''}`.toUpperCase();

  const isGlobalProfile = role.includes('SUPERADMIN') || role.includes('GERENTE') || role.includes('ADMIN');
  if (isGlobalProfile || !company.trim()) return BRANDS.gv;
  if (company.includes('ABC')) return BRANDS.abc;
  return BRANDS.gv;
}
