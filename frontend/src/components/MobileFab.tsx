import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface FabConfig {
  /** Texto accesible para el botón. */
  label: string;
  /** Icono (15-20px). */
  icon: ReactNode;
  /** Ruta a la que navega. Si se pasa onClick, se ignora. */
  to?: string;
  /** Handler custom (alternativa a `to`). */
  onClick?: () => void;
}

interface MobileFabContextValue {
  set: (config: FabConfig | null) => void;
}

const MobileFabContext = createContext<MobileFabContextValue>({ set: () => undefined });

export function MobileFabProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<FabConfig | null>(null);

  const set = useCallback((c: FabConfig | null) => setConfig(c), []);
  const value = useMemo(() => ({ set }), [set]);

  return (
    <MobileFabContext.Provider value={value}>
      {children}
      {config && <MobileFabButton config={config} />}
    </MobileFabContext.Provider>
  );
}

/**
 * Hook para declarar el FAB de la pantalla actual. Se desmonta cuando la página
 * se desmonta. Solo se renderiza en mobile (lg:hidden).
 */
export function useMobileFab(config: FabConfig | null, deps: any[] = []) {
  const ctx = useContext(MobileFabContext);
  useEffect(() => {
    ctx.set(config);
    return () => ctx.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function MobileFabButton({ config }: { config: FabConfig }) {
  const cls = 'erp-mobile-fab';
  if (config.to) {
    return (
      <Link to={config.to} className={cls} aria-label={config.label} title={config.label}>
        {config.icon}
      </Link>
    );
  }
  return (
    <button type="button" onClick={config.onClick} className={cls} aria-label={config.label} title={config.label}>
      {config.icon}
    </button>
  );
}
