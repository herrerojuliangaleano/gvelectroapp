import { useEffect, useState } from 'react';
import { Cpu, Globe, HardDrive, Info } from 'lucide-react';
import { fetchSystemAbout } from '../api/client';
import { ErpCard, ErpErrorState, ErpInfoGrid, ErpInfoRow, ErpLoadingState, ErpPageHeader } from '../components/ProUI';
import type { SystemAbout } from '../types';

export function AboutSystemPage() {
  const [about, setAbout] = useState<SystemAbout | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError('');
    fetchSystemAbout()
      .then((value) => { setAbout(value); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }

  useEffect(load, []);

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Acerca del sistema"
        description="Versión, entorno, dependencias y novedades."
      />

      {loading && <ErpLoadingState />}
      {!loading && error && <ErpErrorState description={error} retry={load} />}

      {about && (
        <>
          <ErpCard title="Identificación" subtitle="Datos generales del backend en ejecución">
            <ErpInfoGrid columns={4}>
              <ErpInfoRow label="Sistema" value={about.app_name} />
              <ErpInfoRow label="Versión" value={about.version} />
              <ErpInfoRow label="Entorno" value={about.environment} />
              <ErpInfoRow label="Python" value={about.python} />
            </ErpInfoGrid>
          </ErpCard>

          <ErpCard
            title="Rutas y tecnología"
            subtitle="Ubicaciones de servicios y archivos clave"
            actions={<Globe size={14} aria-hidden="true" />}
          >
            <ErpInfoGrid columns={2}>
              <ErpInfoRow label={<span className="inline-flex items-center gap-1.5"><Globe size={11} />Backend</span>} value={about.backend} />
              <ErpInfoRow label={<span className="inline-flex items-center gap-1.5"><Cpu size={11} />Frontend</span>} value={about.frontend} />
              <ErpInfoRow label={<span className="inline-flex items-center gap-1.5"><HardDrive size={11} />Storage</span>} value={about.storage_dir} />
              <ErpInfoRow label={<span className="inline-flex items-center gap-1.5"><HardDrive size={11} />Base de datos</span>} value={about.database_path} />
            </ErpInfoGrid>
          </ErpCard>

          <ErpCard title="Novedades" subtitle="Cambios incluidos en cada versión publicada">
            <div className="erp-stack-3">
              {about.changelog.map((entry) => (
                <div key={entry.version} className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--text)]">
                    <span className="erp-tag erp-tag-primary">v{entry.version}</span>
                    <span>{entry.title}</span>
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-[1.55] text-[color:var(--text-2)]">
                    {entry.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ))}
              {about.changelog.length === 0 && (
                <div className="flex items-center gap-2 text-[12.5px] text-[color:var(--text-3)]">
                  <Info size={13} /> Sin cambios publicados todavía.
                </div>
              )}
            </div>
          </ErpCard>
        </>
      )}
    </div>
  );
}
