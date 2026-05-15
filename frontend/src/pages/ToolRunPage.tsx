import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { fetchTool, runTool } from '../api/client';
import { DynamicForm } from '../components/DynamicForm';
import type { ToolInfo } from '../types';

export function ToolRunPage() {
  const { toolId } = useParams();
  const navigate = useNavigate();
  const [tool, setTool] = useState<ToolInfo | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!toolId) return;
    fetchTool(toolId).then(setTool).catch((err) => setError(err.message));
  }, [toolId]);

  async function submit(values: Record<string, unknown>, files: Record<string, File[]>) {
    if (!toolId || !tool) return;
    if (tool.dangerous && !window.confirm('Vas a ejecutar una herramienta sensible. Revisá los datos antes de continuar. ¿Ejecutar?')) return;
    setRunning(true);
    setError('');
    try {
      const res = await runTool(toolId, values, files);
      navigate(`/jobs/${res.job_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ejecutar');
      setRunning(false);
    }
  }

  if (!tool) {
    return <div>{error || 'Cargando herramienta...'}</div>;
  }

  return (
    <div>
      <Link to="/tools" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white"><ArrowLeft size={16} /> Volver a herramientas</Link>
      <div className="mb-7 rounded-3xl border border-slate-700 bg-slate-900/70 p-6 shadow-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800 text-3xl">{tool.icon}</div>
          <div>
            <h1 className="text-3xl font-black">{tool.name}</h1>
            <p className="mt-2 max-w-3xl text-slate-400">{tool.description}</p>
          </div>
        </div>
      </div>
      {error && <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,760px)_1fr]">
        <DynamicForm tool={tool} disabled={running} onSubmit={submit} />
        <aside className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-sm text-slate-300">
          <h2 className="mb-3 font-bold text-white">Criterio operativo</h2>
          <p className="leading-6">Cada ejecución crea un job independiente, copia los scripts legacy a una carpeta temporal y guarda logs. Las credenciales reales no van al repositorio.</p>
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">Si necesitás cerrar la app, apagás el deploy o ponés <b>APP_ENABLED=false</b>.</div>
        </aside>
      </div>
    </div>
  );
}
