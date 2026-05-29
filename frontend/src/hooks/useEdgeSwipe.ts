import { useEffect, useRef } from 'react';

/**
 * Detecta swipe horizontal desde el borde de la pantalla.
 *
 * - Para ABRIR un drawer: el touchstart debe iniciar dentro de los primeros
 *   `edgeThreshold` px del borde izquierdo (o derecho), y el swipe debe ser
 *   horizontal (más X que Y) y superar `openThreshold` px.
 * - Para CERRAR un drawer abierto: el touchstart inicia en cualquier punto del
 *   ref pasado, y el swipe debe ir en dirección opuesta (left para drawer-left,
 *   right para drawer-right) superando `closeThreshold` px.
 *
 * Solo se activa en touch devices. No interfiere con scroll vertical.
 */
export function useEdgeSwipe(opts: {
  /** "left" = swipe desde el borde izquierdo abre el drawer. */
  edge: 'left' | 'right';
  /** Llamado cuando se detecta un swipe-to-open completado. */
  onOpen: () => void;
  /** Llamado cuando se detecta un swipe-to-close. Recibe el ref del drawer abierto. */
  onClose?: () => void;
  /** Si el drawer está abierto, escuchamos swipe-to-close dentro de este ref. */
  drawerRef?: React.RefObject<HTMLElement>;
  /** Distancia desde el borde donde se acepta el inicio del touch (open). */
  edgeThreshold?: number;
  /** Mínimo desplazamiento horizontal para considerar "abrir". */
  openThreshold?: number;
  /** Mínimo desplazamiento horizontal para considerar "cerrar". */
  closeThreshold?: number;
  /** Si el drawer está abierto. Cuando true, se escucha el swipe-to-close. */
  isOpen?: boolean;
  /** Desactiva el hook (ej. cuando estamos en desktop). */
  disabled?: boolean;
}) {
  const {
    edge,
    onOpen,
    onClose,
    drawerRef,
    edgeThreshold = 24,
    openThreshold = 60,
    closeThreshold = 60,
    isOpen = false,
    disabled = false,
  } = opts;

  const startRef = useRef<{ x: number; y: number; mode: 'open' | 'close' | null }>({ x: 0, y: 0, mode: null });

  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;

    function handleTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      // Si el drawer está abierto, escuchamos para cerrarlo.
      if (isOpen && drawerRef?.current && drawerRef.current.contains(e.target as Node)) {
        startRef.current = { x: t.clientX, y: t.clientY, mode: 'close' };
        return;
      }
      // Si el drawer está cerrado, escuchamos en el borde.
      if (!isOpen) {
        const width = window.innerWidth;
        const fromEdge = edge === 'left' ? t.clientX <= edgeThreshold : t.clientX >= width - edgeThreshold;
        if (fromEdge) {
          startRef.current = { x: t.clientX, y: t.clientY, mode: 'open' };
          return;
        }
      }
      startRef.current = { x: 0, y: 0, mode: null };
    }

    function handleTouchEnd(e: TouchEvent) {
      const start = startRef.current;
      if (!start.mode) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      // Horizontal claro (más X que Y).
      if (Math.abs(dx) <= Math.abs(dy)) {
        startRef.current = { x: 0, y: 0, mode: null };
        return;
      }
      if (start.mode === 'open') {
        const wantPositiveDx = edge === 'left';
        const ok = wantPositiveDx ? dx > openThreshold : dx < -openThreshold;
        if (ok) onOpen();
      } else if (start.mode === 'close' && onClose) {
        const wantNegativeDx = edge === 'left';
        const ok = wantNegativeDx ? dx < -closeThreshold : dx > closeThreshold;
        if (ok) onClose();
      }
      startRef.current = { x: 0, y: 0, mode: null };
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [edge, onOpen, onClose, drawerRef, edgeThreshold, openThreshold, closeThreshold, isOpen, disabled]);
}
