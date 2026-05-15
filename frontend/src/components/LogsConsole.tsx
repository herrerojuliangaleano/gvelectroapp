export function LogsConsole({ logs }: { logs: string }) {
  return (
    <pre className="log-console min-h-[360px] max-h-[560px] overflow-auto rounded-2xl border border-slate-700 bg-black/70 p-4 text-xs leading-5 text-emerald-100 shadow-inner whitespace-pre-wrap">
      {logs || 'Todavía no hay logs para mostrar.'}
    </pre>
  );
}
