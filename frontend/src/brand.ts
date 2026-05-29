import type { CurrentUser } from './types';

export type BrandKey = 'gv' | 'abc';

export interface BrandDefinition {
  key: BrandKey | string;
  name: string;
  shortName: string;
  subtitle: string;
  logo: string;
  accent: 'blue' | 'cyan';
  // Acento del brand: color del dot junto al logo en el sidebar/topbar.
  // dark = tema actual; light = se usará cuando se active el light mode.
  accentDark: string;
  accentLight: string;
  // Palabras clave que matchean en company_name / company_id (uppercase).
  matchKeywords: string[];
}

// Para agregar un brand nuevo: sumar una entrada acá. Si nada matchea,
// se usa `defaultBrandKey` (definido más abajo).
export const BRANDS: Record<string, BrandDefinition> = {
  gv: {
    key: 'gv',
    name: 'GV Electro',
    shortName: 'GV',
    subtitle: 'Ecosistema interno',
    logo: '/brand/gv-electro.png',
    accent: 'blue',
    accentDark: '#6366F1',
    accentLight: '#4F46E5',
    matchKeywords: ['GV'],
  },
  abc: {
    key: 'abc',
    name: 'ABC Electro',
    shortName: 'ABC',
    subtitle: 'Outlet premium',
    logo: '/brand/abc-electro.png',
    accent: 'cyan',
    accentDark: '#22D3EE',
    accentLight: '#0EA5E9',
    matchKeywords: ['ABC'],
  },
};

export const defaultBrandKey: BrandKey = 'gv';

export function getBrandForUser(user?: Partial<CurrentUser> | null): BrandDefinition {
  if (!user) return BRANDS[defaultBrandKey];
  const role = String(user.role || '').toUpperCase();
  const company = `${user.company_name || ''} ${user.company_id || ''}`.toUpperCase().trim();

  const isGlobalProfile = role.includes('SUPERADMIN') || role.includes('GERENTE') || role.includes('ADMIN');
  if (isGlobalProfile || !company) return BRANDS[defaultBrandKey];

  // Matchea por keywords definidos en cada brand.
  for (const brand of Object.values(BRANDS)) {
    if (brand.key === defaultBrandKey) continue; // default queda como fallback
    if (brand.matchKeywords.some((kw) => company.includes(kw.toUpperCase()))) {
      return brand;
    }
  }

  return BRANDS[defaultBrandKey];
}
