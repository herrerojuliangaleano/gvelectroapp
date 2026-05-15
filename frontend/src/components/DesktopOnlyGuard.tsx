import { ReactNode } from 'react';

export function DesktopOnlyGuard({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="min-h-screen bg-slate-950 text-slate-100 md:hidden flex items-center justify-center p-6 text-center">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <div className="text-4xl mb-4">🖥️</div>
          <h1 className="text-xl font-bold">Uso desde PC</h1>
          <p className="mt-2 text-slate-300">Esta herramienta está diseñada para navegador de PC o notebook.</p>
        </div>
      </div>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
