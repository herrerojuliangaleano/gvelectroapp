// Consulta de precios — pantalla pública de mostrador / mobile para vendedores.
//
// Adaptada del componente entregado por Victor (CONSULTA-PRECIOS.md +
// consulta-precios.tsx). Cambios respecto al original:
//   • TanStack Router → React Router (este proyecto).
//   • Mock `PRODUCTOS_TOP` → fetch real a `/api/products/search` con cache local.
//   • Colores del prototipo (sky/hsl crudo) → tokens ProUI (indigo / slate).
//   • `fmtMoney` desde `lib/format.ts` (helper compartido del proyecto).
//   • Animations `animate-in` definidas en styles.css (subset propio,
//     no dependemos del plugin tailwindcss-animate).
//
// La pantalla NO guarda en backend — todo el estado vive en localStorage.
// Para presupuestos formales que se persisten en BD, usar `/budgets/new`.
//
// Permiso requerido: `budgets.view` (igual que el viejo BudgetCreatePage).

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  Search, X, Star, Plus, Minus, Trash2, ShoppingBag, Store, Truck,
  Share2, ChevronDown, Banknote, CreditCard, Split, Undo2, Redo2,
  Keyboard, Command, Loader2,
} from 'lucide-react';

import { searchBudgetProducts } from '../api/client';
import type { BudgetProduct } from '../types';
import { fmtMoney } from '../lib/format';

/* ============================================================
 *  DATA — producto minimo en memoria + cache local
 * ========================================================== */

interface Prod {
  sku: string;
  descripcion: string;
  marca: string;
  pvp: number;
}

/** Mapea un BudgetProduct del backend al shape minimo que usamos aca. */
function mapProductInfo(p: BudgetProduct): Prod | null {
  const sku = (p.sku || '').trim();
  if (!sku) return null; // sin SKU no podemos cachearlo
  const price = typeof p.precio === 'number' ? p.precio : 0;
  return {
    sku,
    descripcion: p.producto || p.label || sku,
    marca: p.marca || '',
    pvp: price,
  };
}

/* ============================================================
 *  STORAGE
 * ========================================================== */
const BUDGET_KEY = 'egv_budget_v2';
const FAVS_KEY = 'egv_fav_skus';
const PICKS_KEY = 'egv_sku_picks';
// Cache local de productos vistos (para favoritos / items del budget al
// recargar sin tener que re-fetch el catalogo entero).
const PRODUCT_CACHE_KEY = 'egv_product_cache_v1';

function jsonLoad<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function jsonSave(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

/* ============================================================
 *  BUDGET MODEL
 * ========================================================== */
type Entrega = 'RETIRO' | 'ENVIO';
type PayMode = 'EFECTIVO' | 'POSNET' | 'MIXTO';

interface BudgetItem { sku: string; qty: number }
interface Budget {
  items: BudgetItem[];
  entrega: Entrega;
  envio: number;
  payMode: PayMode;
  posnetAmount: number;
}
const POSNET_RECARGO = 0.085;
const EMPTY_BUDGET: Budget = {
  items: [], entrega: 'RETIRO', envio: 0, payMode: 'EFECTIVO', posnetAmount: 0,
};

interface Totals {
  subtotal: number; efectivo: number; posnetBase: number;
  recargo: number; envio: number; total: number;
}
function computeTotals(b: Budget, cache: Record<string, Prod>): Totals {
  const subtotal = b.items.reduce((a, it) => {
    const p = cache[it.sku];
    return p ? a + p.pvp * it.qty : a;
  }, 0);
  let posnetBase = 0;
  if (b.payMode === 'POSNET') posnetBase = subtotal;
  else if (b.payMode === 'MIXTO') posnetBase = Math.max(0, Math.min(b.posnetAmount, subtotal));
  const efectivo = subtotal - posnetBase;
  const recargo = Math.round(posnetBase * POSNET_RECARGO);
  const envio = b.entrega === 'ENVIO' ? b.envio : 0;
  return { subtotal, efectivo, posnetBase, recargo, envio, total: subtotal + recargo + envio };
}

/* ============================================================
 *  HOOKS
 * ========================================================== */
function useDebounced<T>(value: T, ms = 180) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface HistoryState<T> { past: T[]; present: T; future: T[] }
interface HistoryApi<T> {
  value: T;
  set: (next: T | ((prev: T) => T), record?: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** History hook for undo/redo. Caps depth at 50. */
function useHistory<T>(initial: T): HistoryApi<T> {
  const [state, setStateRaw] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });

  const set = useCallback((next: T | ((prev: T) => T), record = true) => {
    setStateRaw((s) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next;
      if (Object.is(value, s.present)) return s;
      if (!record) return { ...s, present: value };
      const past = [...s.past, s.present].slice(-50);
      return { past, present: value, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setStateRaw((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future].slice(0, 50) };
    });
  }, []);

  const redo = useCallback(() => {
    setStateRaw((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return { past: [...s.past, s.present].slice(-50), present: next, future: s.future.slice(1) };
    });
  }, []);

  return {
    value: state.present, set, undo, redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

/* ============================================================
 *  PAGE
 * ========================================================== */
export function ConsultaPreciosPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 220);
  const [favs, setFavs] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, number>>({});
  // Cache de productos: SKU -> Prod. Se hidrata desde localStorage y
  // se va llenando con los resultados de search + las altas a fav/budget.
  const [productCache, setProductCache] = useState<Record<string, Prod>>({});
  const history = useHistory<Budget>(EMPTY_BUDGET);
  const budget = history.value;
  const setBudget = history.set;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    action?: { label: string; icon?: ReactNode; run: () => void };
    id: number;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resultados de búsqueda (asíncronos, vienen del backend).
  const [results, setResults] = useState<Prod[]>([]);
  const [searching, setSearching] = useState(false);
  // Productos "destacados" — se cargan una sola vez al montar.
  const [featured, setFeatured] = useState<Prod[]>([]);

  /* hydrate */
  useEffect(() => {
    setFavs(jsonLoad<string[]>(FAVS_KEY, []));
    setPicks(jsonLoad<Record<string, number>>(PICKS_KEY, {}));
    setProductCache(jsonLoad<Record<string, Prod>>(PRODUCT_CACHE_KEY, {}));
    const saved = jsonLoad<Partial<Budget>>(BUDGET_KEY, {});
    history.set({ ...EMPTY_BUDGET, ...saved }, false);
    // Carga inicial de "destacados" (los primeros del catalogo).
    void searchBudgetProducts('').then((items) => {
      const mapped = items.map(mapProductInfo).filter((p): p is Prod => p !== null);
      setFeatured(mapped.slice(0, 12));
      setProductCache((c) => {
        const next = { ...c };
        for (const p of mapped) next[p.sku] = p;
        return next;
      });
    }).catch(() => { /* silent — la pantalla sigue siendo usable sin destacados */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { jsonSave(BUDGET_KEY, budget); }, [budget]);
  useEffect(() => { jsonSave(FAVS_KEY, favs); }, [favs]);
  useEffect(() => { jsonSave(PICKS_KEY, picks); }, [picks]);
  useEffect(() => { jsonSave(PRODUCT_CACHE_KEY, productCache); }, [productCache]);

  /* search efectiva contra el backend con debounce */
  useEffect(() => {
    const term = dq.trim();
    if (!term) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    searchBudgetProducts(term).then((items) => {
      if (cancelled) return;
      const mapped = items.map(mapProductInfo).filter((p): p is Prod => p !== null);
      setResults(mapped);
      setProductCache((c) => {
        const next = { ...c };
        for (const p of mapped) next[p.sku] = p;
        return next;
      });
    }).catch(() => {
      if (!cancelled) setResults([]);
    }).finally(() => {
      if (!cancelled) setSearching(false);
    });
    return () => { cancelled = true; };
  }, [dq]);

  /* toast */
  const showToast = useCallback(
    (msg: string, action?: { label: string; icon?: ReactNode; run: () => void }) => {
      const id = Date.now();
      setToast({ msg, action, id });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3500);
    },
    [],
  );

  /* favorites */
  const autoFavs = useMemo(
    () => Object.entries(picks).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sku]) => sku),
    [picks],
  );
  const favList = useMemo(() => {
    const set = new Set<string>(favs);
    for (const s of autoFavs) set.add(s);
    return Array.from(set).map((s) => productCache[s]).filter(Boolean).slice(0, 10);
  }, [favs, autoFavs, productCache]);
  const isFav = (sku: string) => favs.includes(sku);
  const toggleFav = (sku: string) =>
    setFavs((f) => (f.includes(sku) ? f.filter((x) => x !== sku) : [...f, sku]));

  /* budget actions */
  const itemCount = budget.items.reduce((a, i) => a + i.qty, 0);
  const totals = useMemo(() => computeTotals(budget, productCache), [budget, productCache]);

  const addToBudget = useCallback(
    (sku: string) => {
      setBudget((b) => {
        const found = b.items.find((i) => i.sku === sku);
        const items = found
          ? b.items.map((i) => (i.sku === sku ? { ...i, qty: i.qty + 1 } : i))
          : [...b.items, { sku, qty: 1 }];
        const newSubtotal = items.reduce(
          (a, it) => a + (productCache[it.sku]?.pvp ?? 0) * it.qty, 0,
        );
        const posnetAmount =
          b.payMode === 'MIXTO' ? Math.min(b.posnetAmount, newSubtotal)
          : b.payMode === 'POSNET' ? newSubtotal
          : b.posnetAmount;
        return { ...b, items, posnetAmount };
      });
      setPicks((p) => ({ ...p, [sku]: (p[sku] ?? 0) + 1 }));
      const p = productCache[sku];
      showToast(`Agregado · ${p?.marca ?? ''}`, {
        label: 'Deshacer',
        icon: <Undo2 className="size-3.5" />,
        run: history.undo,
      });
    },
    [setBudget, showToast, history.undo, productCache],
  );

  /* keyboard shortcuts */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable === true;
    };
    const h = (e: KeyboardEvent) => {
      const cmd = e.ctrlKey || e.metaKey;

      if (cmd && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (history.canRedo) { history.redo(); showToast('Rehecho'); }
        } else if (history.canUndo) {
          history.undo();
          showToast('Deshecho', { label: 'Rehacer', icon: <Redo2 className="size-3.5" />, run: history.redo });
        }
        return;
      }
      if (cmd && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (history.canRedo) { history.redo(); showToast('Rehecho'); }
        return;
      }
      if (e.key === 'Escape') {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (sheetOpen) setSheetOpen(false);
        return;
      }
      if (isTyping(e.target)) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (totals.subtotal > 0 && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        const map: Record<string, PayMode> = { '1': 'EFECTIVO', '2': 'MIXTO', '3': 'POSNET' };
        const mode = map[e.key];
        setBudget((b) => {
          const sub = b.items.reduce((a, it) => a + (productCache[it.sku]?.pvp ?? 0) * it.qty, 0);
          let posnetAmount = b.posnetAmount;
          if (mode === 'EFECTIVO') posnetAmount = 0;
          else if (mode === 'POSNET') posnetAmount = sub;
          else if (mode === 'MIXTO' && (posnetAmount <= 0 || posnetAmount >= sub))
            posnetAmount = Math.round(sub / 2);
          return { ...b, payMode: mode, posnetAmount };
        });
        return;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [history, shortcutsOpen, sheetOpen, totals.subtotal, setBudget, showToast, productCache]);

  const showingResults = q.trim().length > 0;

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 antialiased -mx-6 -my-6">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-30 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800/80">
        <div className="mx-auto w-full max-w-7xl px-4 lg:px-8 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-bold">
                ElectroGV
              </div>
              <h1 className="text-[19px] lg:text-[22px] font-black tracking-tight leading-tight text-slate-50">
                Consulta de precios
              </h1>
            </div>
            <div className="flex items-center gap-1.5">
              <HistoryControls history={history} />
              <button
                onClick={() => setShortcutsOpen(true)}
                title="Atajos de teclado (?)"
                className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-700/80 bg-slate-900/70 hover:bg-slate-800/80 text-slate-300 text-xs font-semibold transition"
              >
                <Keyboard className="size-3.5" />
                Atajos
              </button>
              <FavCount n={favList.length} />
            </div>
          </div>

          <div className="lg:max-w-2xl">
            <SearchInput
              ref={searchRef}
              value={q}
              onChange={setQ}
              searching={searching}
              placeholder="Buscar producto, marca o código…  (Ctrl+K)"
              onEnter={() => { if (results.length > 0) addToBudget(results[0].sku); }}
            />
          </div>
        </div>
      </header>

      {/* ===== BODY ===== */}
      <div className="mx-auto w-full max-w-7xl px-4 lg:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-8 lg:items-start">
        <main className="pb-40 lg:pb-12 pt-4">
          {!showingResults && favList.length > 0 && (
            <section className="mb-5">
              <SectionLabel
                icon={<Star className="size-3.5" />}
                text="Tus favoritos"
                hint={favs.length === 0 ? 'Sugeridos por uso' : undefined}
              />
              <FavRow items={favList} onPick={addToBudget} isFav={isFav} onToggleFav={toggleFav} />
            </section>
          )}

          {!showingResults && (
            <section>
              <SectionLabel text="Más consultados" />
              {featured.length === 0 ? (
                <FeaturedSkeleton />
              ) : (
                <ProductGrid items={featured} term="" onAdd={addToBudget} isFav={isFav} onToggleFav={toggleFav} />
              )}
            </section>
          )}

          {showingResults && (
            <section>
              <SectionLabel
                text={
                  searching ? `Buscando "${q.trim()}"...`
                  : results.length === 0 ? `Sin resultados para "${q.trim()}"`
                  : `${results.length} resultado${results.length === 1 ? '' : 's'}`
                }
              />
              {searching && results.length === 0 ? (
                <FeaturedSkeleton />
              ) : results.length === 0 ? (
                <EmptyState onClear={() => setQ('')} />
              ) : (
                <ProductGrid items={results} term={dq} onAdd={addToBudget} isFav={isFav} onToggleFav={toggleFav} />
              )}
            </section>
          )}
        </main>

        {/* Desktop budget panel (sticky) */}
        <aside className="hidden lg:block lg:sticky lg:top-[132px] pt-4 pb-12">
          <BudgetPanel
            budget={budget}
            setBudget={setBudget}
            totals={totals}
            productCache={productCache}
            variant="desktop"
            onClose={() => {}}
          />
        </aside>
      </div>

      {/* ===== BOTTOM BAR (mobile only) ===== */}
      {itemCount > 0 && (
        <div className="lg:hidden">
          <BottomBar items={itemCount} total={totals.total} onOpen={() => setSheetOpen(true)} />
        </div>
      )}

      {/* ===== BUDGET SHEET (mobile only) ===== */}
      <div className="lg:hidden">
        {sheetOpen && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setSheetOpen(false)} />
            <div
              role="dialog"
              aria-modal="true"
              className="absolute inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl bg-slate-900 border-t border-slate-700/80 shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-200"
            >
              <div className="pt-3 pb-1 flex justify-center">
                <div className="h-1.5 w-10 rounded-full bg-slate-600/50" />
              </div>
              <BudgetPanel
                budget={budget}
                setBudget={setBudget}
                totals={totals}
                productCache={productCache}
                variant="sheet"
                onClose={() => setSheetOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ===== SHORTCUTS PANEL ===== */}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {/* ===== TOAST ===== */}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 lg:bottom-8 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-50 text-slate-900 pl-4 pr-2 py-2 shadow-2xl shadow-black/50 animate-in fade-in slide-in-from-bottom-2">
            <span className="text-sm font-semibold">{toast.msg}</span>
            {toast.action && (
              <button
                onClick={() => { toast.action?.run(); setToast(null); }}
                className="rounded-full bg-slate-900 text-white text-xs font-semibold px-3 py-1.5 flex items-center gap-1 hover:bg-slate-800 transition"
              >
                {toast.action.icon}
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 *  HEADER PIECES
 * ========================================================== */
function HistoryControls({ history }: { history: HistoryApi<Budget> }) {
  return (
    <div className="flex items-center rounded-lg border border-slate-700/80 bg-slate-900/70 overflow-hidden">
      <button
        onClick={history.undo}
        disabled={!history.canUndo}
        title="Deshacer (Ctrl+Z)"
        aria-label="Deshacer"
        className="size-9 flex items-center justify-center text-slate-300 hover:bg-slate-800/80 disabled:text-slate-600 disabled:hover:bg-transparent transition"
      >
        <Undo2 className="size-4" />
      </button>
      <div className="w-px h-5 bg-slate-700/80" />
      <button
        onClick={history.redo}
        disabled={!history.canRedo}
        title="Rehacer (Ctrl+Shift+Z)"
        aria-label="Rehacer"
        className="size-9 flex items-center justify-center text-slate-300 hover:bg-slate-800/80 disabled:text-slate-600 disabled:hover:bg-transparent transition"
      >
        <Redo2 className="size-4" />
      </button>
    </div>
  );
}

function FavCount({ n }: { n: number }) {
  return (
    <div className="hidden sm:flex items-center gap-1.5 text-slate-400 text-xs font-semibold px-2">
      <Star className="size-3.5" />
      <span className="tabular-nums">{n}</span>
    </div>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  searching?: boolean;
}
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ value, onChange, placeholder, onEnter, searching }, ref) {
    return (
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-[18px] text-slate-500" />
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
          placeholder={placeholder}
          inputMode="search"
          autoComplete="off"
          className="w-full h-12 rounded-2xl bg-slate-900/70 border border-slate-700/80 pl-11 pr-11 text-[15px] text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/10"
        />
        {searching && !value && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 size-4 text-slate-500 animate-spin" />
        )}
        {value && (
          <button
            onClick={() => onChange('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 size-8 rounded-full hover:bg-slate-700/60 flex items-center justify-center text-slate-400 hover:text-slate-100 transition"
          >
            {searching ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          </button>
        )}
      </div>
    );
  },
);

function SectionLabel({ text, icon, hint }: { text: string; icon?: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-slate-400 font-bold">
        {icon}
        {text}
      </div>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

/* ============================================================
 *  PRODUCT GRID & CARD
 * ========================================================== */
function ProductGrid({
  items, term, onAdd, isFav, onToggleFav,
}: {
  items: Prod[]; term: string;
  onAdd: (sku: string) => void;
  isFav: (sku: string) => boolean;
  onToggleFav: (sku: string) => void;
}) {
  return (
    <ul className="space-y-2.5">
      {items.map((p) => (
        <ProductCard
          key={p.sku}
          p={p}
          term={term}
          onAdd={() => onAdd(p.sku)}
          fav={isFav(p.sku)}
          onToggleFav={() => onToggleFav(p.sku)}
        />
      ))}
    </ul>
  );
}

function FeaturedSkeleton() {
  return (
    <ul className="space-y-2.5">
      {[1, 2, 3, 4].map((i) => (
        <li key={i} className="rounded-2xl bg-slate-900/50 border border-slate-700/50 p-4 animate-pulse">
          <div className="h-3 w-1/3 rounded bg-slate-700/50 mb-2" />
          <div className="h-4 w-3/4 rounded bg-slate-700/50 mb-3" />
          <div className="flex justify-between">
            <div className="h-7 w-32 rounded bg-slate-700/50" />
            <div className="h-10 w-24 rounded-xl bg-slate-700/50" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProductCard({
  p, term, onAdd, fav, onToggleFav,
}: {
  p: Prod; term: string;
  onAdd: () => void;
  fav: boolean;
  onToggleFav: () => void;
}) {
  const posnet = Math.round(p.pvp * (1 + POSNET_RECARGO));
  return (
    <li className="group relative rounded-2xl bg-slate-900/70 border border-slate-700/80 hover:border-slate-600/80 hover:bg-slate-900 transition">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">
              {p.marca} · {p.sku}
            </div>
            <h3 className="text-[15px] font-semibold leading-snug text-slate-100 line-clamp-2">
              <Highlight text={p.descripcion} term={term} />
            </h3>
          </div>
          <button
            onClick={onToggleFav}
            aria-label={fav ? 'Quitar de favoritos' : 'Marcar favorito'}
            aria-pressed={fav}
            className={`shrink-0 size-9 rounded-full flex items-center justify-center transition ${
              fav ? 'text-amber-400 bg-amber-400/10' : 'text-slate-600 hover:text-amber-400 hover:bg-amber-400/10'
            }`}
          >
            <Star className="size-[18px]" fill={fav ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[28px] leading-none font-black tabular-nums tracking-tight text-slate-50">
              {fmtMoney(p.pvp)}
            </div>
            <div className="mt-1 text-[12px] text-slate-400 tabular-nums">
              Posnet <span className="text-slate-200 font-semibold">{fmtMoney(posnet)}</span>
            </div>
          </div>
          <button
            onClick={onAdd}
            className="shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 active:scale-[0.98] transition text-white text-sm font-bold shadow-lg shadow-indigo-950/30"
          >
            <Plus className="size-4" />
            Agregar
          </button>
        </div>
      </div>
    </li>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.trim();
  if (!t) return <>{text}</>;
  const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) ? (
          <mark key={i} className="rounded bg-amber-400/20 text-amber-200 px-0.5">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function FavRow({
  items, onPick, isFav, onToggleFav,
}: {
  items: Prod[];
  onPick: (sku: string) => void;
  isFav: (sku: string) => boolean;
  onToggleFav: (sku: string) => void;
}) {
  return (
    <div className="-mx-4 px-4 lg:mx-0 lg:px-0 overflow-x-auto scrollbar-none">
      <ul className="flex gap-2 pb-1 min-w-min">
        {items.map((p) => (
          <li key={p.sku}>
            <button
              onClick={() => onPick(p.sku)}
              onContextMenu={(e) => { e.preventDefault(); onToggleFav(p.sku); }}
              className="group flex flex-col items-start gap-1.5 w-[180px] rounded-2xl bg-slate-900/70 border border-slate-700/80 hover:border-slate-600/80 hover:bg-slate-900 active:scale-[0.98] transition px-3.5 py-3 text-left"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                  {p.marca}
                </span>
                <Star
                  className={`size-3.5 ${isFav(p.sku) ? 'text-amber-400' : 'text-slate-600'}`}
                  fill={isFav(p.sku) ? 'currentColor' : 'none'}
                />
              </div>
              <div className="text-[12.5px] text-slate-200 font-semibold leading-tight line-clamp-2 h-8">
                {p.descripcion}
              </div>
              <div className="mt-auto text-[15px] font-black tabular-nums text-slate-50">
                {fmtMoney(p.pvp)}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="text-center py-14">
      <div className="mx-auto size-12 rounded-full bg-slate-900/70 border border-slate-700/80 flex items-center justify-center text-slate-500 mb-3">
        <Search className="size-5" />
      </div>
      <p className="text-sm text-slate-400 mb-3">
        Probá con otra palabra o el código del producto.
      </p>
      <button
        onClick={onClear}
        className="text-sm font-semibold text-slate-100 underline underline-offset-4"
      >
        Limpiar búsqueda
      </button>
    </div>
  );
}

/* ============================================================
 *  BOTTOM BAR (mobile)
 * ========================================================== */
function BottomBar({ items, total, onOpen }: { items: number; total: number; onOpen: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pb-[max(env(safe-area-inset-bottom),12px)] px-3 pointer-events-none">
      <div className="mx-auto max-w-2xl pointer-events-auto">
        <button
          onClick={onOpen}
          className="w-full flex items-center justify-between rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white px-4 h-16 shadow-[0_18px_40px_-12px_rgba(99,102,241,0.55)] active:scale-[0.99] transition"
        >
          <div className="flex items-center gap-3">
            <div className="relative size-10 rounded-xl bg-white/15 flex items-center justify-center">
              <ShoppingBag className="size-5" />
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-amber-400 text-slate-900 text-[11px] font-black flex items-center justify-center px-1 tabular-nums">
                {items}
              </span>
            </div>
            <div className="text-left">
              <div className="text-[11px] uppercase tracking-wider text-white/70 font-bold">
                Presupuesto
              </div>
              <div className="text-[17px] font-black tabular-nums leading-none mt-0.5">
                {fmtMoney(total)}
              </div>
            </div>
          </div>
          <span className="text-sm font-bold text-white/90 flex items-center gap-1">
            Ver
            <ChevronDown className="size-4 rotate-180" />
          </span>
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 *  BUDGET PANEL
 * ========================================================== */
function BudgetPanel({
  budget, setBudget, totals, productCache, variant, onClose,
}: {
  budget: Budget;
  setBudget: (next: Budget | ((prev: Budget) => Budget)) => void;
  totals: Totals;
  productCache: Record<string, Prod>;
  variant: 'desktop' | 'sheet';
  onClose: () => void;
}) {
  const setQty = (sku: string, qty: number) =>
    setBudget((b) => {
      const items = qty <= 0
        ? b.items.filter((i) => i.sku !== sku)
        : b.items.map((i) => (i.sku === sku ? { ...i, qty } : i));
      const sub = items.reduce((a, it) => a + (productCache[it.sku]?.pvp ?? 0) * it.qty, 0);
      const posnetAmount =
        b.payMode === 'MIXTO' ? Math.min(b.posnetAmount, sub)
        : b.payMode === 'POSNET' ? sub
        : b.posnetAmount;
      return { ...b, items, posnetAmount };
    });

  const setPayMode = (mode: PayMode) =>
    setBudget((b) => {
      const sub = b.items.reduce((a, it) => a + (productCache[it.sku]?.pvp ?? 0) * it.qty, 0);
      let posnetAmount = b.posnetAmount;
      if (mode === 'EFECTIVO') posnetAmount = 0;
      else if (mode === 'POSNET') posnetAmount = sub;
      else if (mode === 'MIXTO' && (posnetAmount <= 0 || posnetAmount >= sub))
        posnetAmount = Math.round(sub / 2);
      return { ...b, payMode: mode, posnetAmount };
    });

  const setPosnetAmount = (v: number) =>
    setBudget((b) => {
      const sub = b.items.reduce((a, it) => a + (productCache[it.sku]?.pvp ?? 0) * it.qty, 0);
      return { ...b, posnetAmount: Math.max(0, Math.min(v, sub)) };
    });

  const shareWhatsApp = () => {
    const lines: string[] = ['*Presupuesto ElectroGV*', ''];
    for (const it of budget.items) {
      const p = productCache[it.sku];
      if (!p) continue;
      lines.push(`• ${it.qty}× ${p.descripcion} — ${fmtMoney(p.pvp * it.qty)}`);
    }
    lines.push('');
    lines.push(`Subtotal: ${fmtMoney(totals.subtotal)}`);
    if (totals.posnetBase > 0) {
      lines.push(`Posnet: ${fmtMoney(totals.posnetBase)} (+${fmtMoney(totals.recargo)} 8,5%)`);
      if (totals.efectivo > 0) lines.push(`Efectivo/Transf.: ${fmtMoney(totals.efectivo)}`);
    }
    if (totals.envio > 0) lines.push(`Envío: ${fmtMoney(totals.envio)}`);
    lines.push(`*TOTAL: ${fmtMoney(totals.total)}*`);
    const url = `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank');
  };

  const clear = () => {
    if (budget.items.length === 0) return;
    setBudget(EMPTY_BUDGET);
  };

  const isDesktop = variant === 'desktop';
  const wrapper = isDesktop
    ? 'rounded-2xl bg-slate-900/70 border border-slate-700/80 flex flex-col max-h-[calc(100dvh-180px)]'
    : 'flex flex-col flex-1 min-h-0';

  return (
    <div className={wrapper}>
      {/* header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-slate-700/60">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
            Presupuesto
          </div>
          <div className="text-lg font-black tracking-tight text-slate-50">
            {budget.items.length === 0
              ? 'Vacío'
              : `${budget.items.reduce((a, i) => a + i.qty, 0)} ${
                  budget.items.reduce((a, i) => a + i.qty, 0) === 1 ? 'unidad' : 'unidades'
                } · ${budget.items.length} SKU`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {budget.items.length > 0 && (
            <button
              onClick={clear}
              className="size-9 rounded-full text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 flex items-center justify-center transition"
              aria-label="Vaciar"
              title="Vaciar presupuesto (Ctrl+Z para revertir)"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {!isDesktop && (
            <button
              onClick={onClose}
              className="size-9 rounded-full text-slate-400 hover:bg-slate-700/60 flex items-center justify-center transition"
              aria-label="Cerrar"
            >
              <X className="size-5" />
            </button>
          )}
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4 space-y-5">
        {budget.items.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-14">
            <ShoppingBag className="size-8 mx-auto mb-3 text-slate-600" />
            Tu presupuesto está vacío.
            <div className="mt-1 text-xs text-slate-600">Buscá un producto y agregalo.</div>
          </div>
        ) : (
          <ul className="space-y-2">
            {budget.items.map((it) => {
              const p = productCache[it.sku];
              if (!p) {
                return (
                  <li key={it.sku} className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 text-xs text-slate-500">
                    SKU {it.sku} (sin datos · re-cargá la página)
                  </li>
                );
              }
              return (
                <li
                  key={it.sku}
                  className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 flex items-center gap-3 transition hover:border-slate-600/80 hover:bg-slate-900/70 animate-in fade-in slide-in-from-top-1 duration-200"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/80">
                        {p.marca}
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-500">
                        {fmtMoney(p.pvp)} c/u
                      </span>
                    </div>
                    <div className="mt-1 text-[14px] text-slate-100 leading-snug line-clamp-2">
                      {p.descripcion}
                    </div>
                    <div className="mt-1 text-[13px] tabular-nums font-black text-slate-50">
                      {fmtMoney(p.pvp * it.qty)}
                    </div>
                  </div>
                  <QtyStepper value={it.qty} onChange={(v) => setQty(it.sku, v)} />
                </li>
              );
            })}
          </ul>
        )}

        {/* entrega */}
        <div>
          <SectionLabel text="Entrega" />
          <div className="grid grid-cols-2 gap-2">
            <SegBtn
              active={budget.entrega === 'RETIRO'}
              onClick={() => setBudget((b) => ({ ...b, entrega: 'RETIRO' }))}
              icon={<Store className="size-4" />}
              label="Retiro"
            />
            <SegBtn
              active={budget.entrega === 'ENVIO'}
              onClick={() => setBudget((b) => ({ ...b, entrega: 'ENVIO' }))}
              icon={<Truck className="size-4" />}
              label="Envío"
            />
          </div>
          {budget.entrega === 'ENVIO' && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-slate-400 px-1">Costo de envío</label>
              <input
                type="number"
                inputMode="numeric"
                value={budget.envio || ''}
                onChange={(e) =>
                  setBudget((b) => ({ ...b, envio: Math.max(0, Number(e.target.value) || 0) }))
                }
                placeholder="0"
                className="flex-1 h-10 rounded-lg border border-slate-700/80 bg-slate-900/70 px-3 text-sm text-slate-100 tabular-nums outline-none focus:border-indigo-500/60"
              />
            </div>
          )}
        </div>

        {/* pago */}
        {totals.subtotal > 0 && (
          <div>
            <SectionLabel text="Medio de pago" hint={isDesktop ? '1 / 2 / 3' : undefined} />
            <PaymentSegment mode={budget.payMode} onChange={setPayMode} />
            {budget.payMode === 'MIXTO' && (
              <MixtoControls
                subtotal={totals.subtotal}
                posnetAmount={budget.posnetAmount}
                onChange={setPosnetAmount}
              />
            )}
          </div>
        )}
      </div>

      {/* total + actions */}
      {budget.items.length > 0 && (
        <div className="border-t border-slate-700/60 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] bg-slate-900">
          <TotalBreakdown totals={totals} payMode={budget.payMode} />
          <div className="mt-3">
            <button
              onClick={shareWhatsApp}
              className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] transition text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/30"
            >
              <Share2 className="size-4" />
              Compartir por WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QtyStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/80 rounded-full p-1">
      <button
        onClick={() => onChange(value - 1)}
        className="size-8 rounded-full bg-slate-700/60 text-slate-200 hover:text-white hover:bg-slate-700 flex items-center justify-center active:scale-95 transition"
        aria-label="Restar"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-7 text-center text-sm font-black tabular-nums text-slate-100">
        {value}
      </span>
      <button
        onClick={() => onChange(value + 1)}
        className="size-8 rounded-full bg-slate-700/60 text-slate-200 hover:text-white hover:bg-slate-700 flex items-center justify-center active:scale-95 transition"
        aria-label="Sumar"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function SegBtn({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-12 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition ${
        active
          ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-950/30'
          : 'bg-slate-900/70 border-slate-700/80 text-slate-300 hover:border-slate-600/80 hover:bg-slate-900'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

const PAY_OPTIONS: { mode: PayMode; label: string; icon: ReactNode; bg: string; hint: string }[] = [
  { mode: 'EFECTIVO', label: 'Efectivo', icon: <Banknote className="size-4" />,   bg: 'bg-emerald-500 shadow-lg shadow-emerald-950/30', hint: '1' },
  { mode: 'MIXTO',    label: 'Mixto',    icon: <Split className="size-4" />,      bg: 'bg-amber-500 shadow-lg shadow-amber-950/30',     hint: '2' },
  { mode: 'POSNET',   label: 'Posnet',   icon: <CreditCard className="size-4" />, bg: 'bg-indigo-500 shadow-lg shadow-indigo-950/30',   hint: '3' },
];

function PaymentSegment({ mode, onChange }: { mode: PayMode; onChange: (m: PayMode) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-900/70 border border-slate-700/80 rounded-2xl">
      {PAY_OPTIONS.map((o) => {
        const active = o.mode === mode;
        return (
          <button
            key={o.mode}
            onClick={() => onChange(o.mode)}
            aria-pressed={active}
            title={`Atajo: ${o.hint}`}
            className={`relative h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition ${
              active ? `${o.bg} text-white` : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MixtoControls({
  subtotal, posnetAmount, onChange,
}: {
  subtotal: number; posnetAmount: number; onChange: (v: number) => void;
}) {
  const efectivo = Math.max(0, subtotal - posnetAmount);
  const recargo = Math.round(posnetAmount * POSNET_RECARGO);
  return (
    <div className="mt-3 rounded-2xl bg-slate-900/70 border border-slate-700/80 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Anticipo efectivo" color="emerald" value={efectivo} max={subtotal}
          onChange={(v) => onChange(subtotal - v)} />
        <MoneyField label="En Posnet" color="indigo" value={posnetAmount} max={subtotal}
          onChange={onChange}
          hint={recargo > 0 ? `+ ${fmtMoney(recargo)} 8,5%` : undefined} />
      </div>
      <input
        type="range"
        min={0}
        max={subtotal}
        step={Math.max(1, Math.round(subtotal / 200))}
        value={posnetAmount}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-500"
        aria-label="Porción en Posnet"
      />
      <div className="flex items-center justify-between text-[11px] text-slate-500 -mt-1">
        <span>Todo efectivo</span>
        <span>Todo Posnet</span>
      </div>
    </div>
  );
}

function MoneyField({
  label, color, value, max, onChange, hint,
}: {
  label: string;
  color: 'emerald' | 'indigo';
  value: number;
  max: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const ring = color === 'emerald' ? 'focus:border-emerald-500/60' : 'focus:border-indigo-500/60';
  const dot = color === 'emerald' ? 'bg-emerald-400' : 'bg-indigo-400';
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1">
        <span className={`size-2 rounded-full ${dot}`} />
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value || ''}
        onChange={(e) => {
          const n = Math.max(0, Math.min(Number(e.target.value) || 0, max));
          onChange(n);
        }}
        className={`w-full h-11 rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 text-[15px] font-black tabular-nums text-slate-100 outline-none transition ${ring}`}
        placeholder="0"
      />
      {hint && (
        <span className="block mt-1 text-[11px] text-slate-400 tabular-nums">{hint}</span>
      )}
    </label>
  );
}

function TotalBreakdown({ totals, payMode }: { totals: Totals; payMode: PayMode }) {
  return (
    <div>
      {(payMode !== 'EFECTIVO' || totals.envio > 0) && (
        <dl className="space-y-1 text-[13px] text-slate-400 mb-2">
          <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
          {totals.efectivo > 0 && payMode === 'MIXTO' && (
            <Row label="Efectivo / Transf." value={fmtMoney(totals.efectivo)} accent="emerald" />
          )}
          {totals.posnetBase > 0 && (
            <Row label="Posnet" value={fmtMoney(totals.posnetBase)} accent="indigo" />
          )}
          {totals.recargo > 0 && (
            <Row label="Recargo Posnet (8,5%)" value={`+ ${fmtMoney(totals.recargo)}`} />
          )}
          {totals.envio > 0 && <Row label="Envío" value={`+ ${fmtMoney(totals.envio)}`} />}
        </dl>
      )}
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Total</span>
        <span
          key={totals.total}
          className="text-[32px] leading-none font-black tabular-nums tracking-tight text-slate-50 animate-in fade-in slide-in-from-bottom-1 duration-200"
        >
          {fmtMoney(totals.total)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'indigo' }) {
  const dotClass = accent === 'emerald' ? 'bg-emerald-400' : accent === 'indigo' ? 'bg-indigo-400' : '';
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        {accent && <span className={`size-1.5 rounded-full ${dotClass}`} />}
        {label}
      </span>
      <span className="tabular-nums text-slate-200 font-semibold">{value}</span>
    </div>
  );
}

/* ============================================================
 *  SHORTCUTS MODAL
 * ========================================================== */
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const sections: { title: string; items: { keys: string[]; label: string }[] }[] = [
    {
      title: 'General',
      items: [
        { keys: ['Ctrl', 'K'], label: 'Foco en buscador' },
        { keys: ['?'], label: 'Mostrar / ocultar atajos' },
        { keys: ['Esc'], label: 'Cerrar paneles' },
      ],
    },
    {
      title: 'Presupuesto',
      items: [
        { keys: ['Ctrl', 'Z'], label: 'Deshacer' },
        { keys: ['Ctrl', '⇧', 'Z'], label: 'Rehacer' },
        { keys: ['Ctrl', 'Y'], label: 'Rehacer (alt.)' },
      ],
    },
    {
      title: 'Medio de pago',
      items: [
        { keys: ['1'], label: 'Efectivo' },
        { keys: ['2'], label: 'Mixto' },
        { keys: ['3'], label: 'Posnet' },
      ],
    },
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl animate-in fade-in zoom-in-95"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Command className="size-4 text-indigo-400" />
            <h2 className="text-base font-black text-slate-50">Atajos de teclado</h2>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-full text-slate-400 hover:bg-slate-700/60 hover:text-slate-100 flex items-center justify-center transition"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-5">
          {sections.map((s) => (
            <div key={s.title}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-2">
                {s.title}
              </div>
              <ul className="space-y-1.5">
                {s.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-3 text-sm text-slate-200">
                    <span>{it.label}</span>
                    <span className="flex items-center gap-1">
                      {it.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-2 h-6 min-w-6 inline-flex items-center justify-center rounded-md border border-slate-700/80 bg-slate-800/80 text-[11px] font-semibold text-slate-200 tabular-nums"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="px-5 pb-4 text-[11px] text-slate-500">
          Los atajos numéricos se ignoran mientras escribís en un campo.
        </div>
      </div>
    </div>
  );
}
