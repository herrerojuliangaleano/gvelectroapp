import { Link } from 'react-router-dom';
import type { ToolInfo } from '../types';

export function ToolCard({ tool }: { tool: ToolInfo }) {
  return (
    <Link to={`/tools/${tool.id}`} className="group block rounded-2xl border border-slate-700/70 bg-slate-900/80 p-5 shadow-xl transition hover:-translate-y-0.5 hover:border-slate-500 hover:bg-slate-900">
      <div className="mb-4 h-1.5 rounded-full" style={{ backgroundColor: tool.color }} />
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-2xl shadow-inner">{tool.icon}</div>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-2">
            {tool.category && <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold uppercase text-slate-400">{tool.category}</span>}
            {tool.weight === 'pesado' && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase text-amber-200">Proceso pesado</span>}
          </div>
          <h3 className="font-bold text-slate-100 group-hover:text-white">{tool.name}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">{tool.description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {tool.recommended_device && <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">{tool.recommended_device}</span>}
        {(tool.tags || []).slice(0, 3).map((tag) => <span key={tag} className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">{tag}</span>)}
      </div>
      {tool.dangerous && <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Requiere confirmación para modo real.</div>}
    </Link>
  );
}
