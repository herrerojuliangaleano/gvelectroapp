/**
 * ErrorBoundary — captura errores de renderizado en su subtree y muestra
 * un fallback en vez de dejar que React desmonte todo el árbol.
 *
 * Antes de existir esto: cualquier `report.X.map(...)` con X undefined hacía
 * que React desmonte la app completa (sidebar, header, todo) y el usuario
 * veía una pantalla en blanco. Pasaba seguido en SalesBICommercialPage
 * cuando un endpoint no devolvía las matrices cruzadas.
 *
 * Uso: envolvé las páginas o secciones grandes con `<ErrorBoundary>...</ErrorBoundary>`.
 * En dev, el error completo va a la consola; en cualquier caso el usuario ve
 * un mensaje legible con un botón de reintentar (forza un re-render limpio).
 */
import { AlertOctagon, RotateCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Mensaje opcional para mostrar arriba del error. */
  fallbackTitle?: string;
  /** Reintenta cuando este valor cambia (típicamente la ruta o el id). */
  resetKey?: string | number;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logueado en consola sí o sí — facilita el debug en prod si el usuario
    // reporta "pantalla blanca".
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const message = this.state.error.message || String(this.state.error);
      return (
        <div className="mx-auto max-w-2xl rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-6 text-red-100">
          <div className="flex items-start gap-3">
            <AlertOctagon size={24} className="mt-0.5 shrink-0 text-red-300" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-white">
                {this.props.fallbackTitle || 'Algo se rompió al renderizar esta pantalla.'}
              </h2>
              <p className="mt-2 text-sm text-red-100/80">
                El error es local — el resto de la app sigue funcionando. Probá
                reintentar; si persiste, refrescá la página y avisame qué
                acción lo disparó.
              </p>
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-red-200">
                {message}
              </pre>
              <button
                type="button"
                onClick={this.handleRetry}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-500/20 px-4 py-2 text-sm font-bold text-red-100 hover:bg-red-500/30"
              >
                <RotateCw size={15} /> Reintentar
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
