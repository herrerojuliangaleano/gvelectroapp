/**
 * Helpers de formato compartidos.
 *
 * `fmtMoney` simple ($ 1.234.567 sin decimales) para uso en pantallas
 * tipo POS / consulta de precios donde los centavos solo agregan ruido.
 *
 * `fmtMoneyExact` con decimales para casos donde se necesita precision
 * (ej. reportes contables, comparaciones precio-costo).
 */

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formatea un número como precio AR sin decimales: `$ 1.234.567`. */
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '$ 0';
  return `$ ${moneyFormatter.format(Math.round(value))}`;
}

/** Formatea con decimales: `$ 1.234.567,89`. Para presupuestos formales. */
export function fmtMoneyExact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '$ 0,00';
  return `$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}
