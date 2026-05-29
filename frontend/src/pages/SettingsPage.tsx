import { Bell, BellOff, BellRing, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchConfigStatus } from '../api/client';
import {
  ErpButton,
  ErpCard,
  ErpInfoGrid,
  ErpInfoRow,
  ErpNotice,
  ErpPageHeader,
} from '../components/ProUI';
import { getPushPermissionStatus, requestPushPermission } from '../services/pushNotifications';
import type { ConfigStatus } from '../types';

function FlagRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-md border p-3 text-[12.5px] ${ok ? 'border-[color:rgba(34,197,94,0.32)] bg-[color:var(--success-soft)] text-[color:var(--success-soft-text)]' : 'border-[color:rgba(239,68,68,0.36)] bg-[color:var(--danger-soft)] text-[color:var(--danger-soft-text)]'}`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      <span>{label}</span>
    </div>
  );
}

function PushPanel() {
  const [status, setStatus] = useState<'granted' | 'denied' | 'prompt' | 'unavailable' | 'loading'>('loading');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    getPushPermissionStatus().then(setStatus);
  }, []);

  async function handleRequest() {
    setRequesting(true);
    const result = await requestPushPermission();
    setStatus(result === 'unavailable' ? 'unavailable' : result);
    setRequesting(false);
  }

  if (status === 'unavailable') return null;

  const variant = status === 'granted' ? 'success' : status === 'denied' ? 'error' : status === 'prompt' ? 'warning' : 'info';
  const icon = status === 'granted' ? <BellRing size={16} /> : status === 'denied' ? <BellOff size={16} /> : <Bell size={16} />;
  const title = status === 'granted' ? 'Notificaciones activas'
    : status === 'denied' ? 'Notificaciones bloqueadas'
    : status === 'prompt' ? 'Notificaciones desactivadas'
    : 'Verificando…';
  const description = status === 'granted' ? 'Vas a recibir alertas de garantías, ventas y más.'
    : status === 'denied' ? 'Activá los permisos en Ajustes del celular → Aplicaciones → ElectroGV → Notificaciones.'
    : status === 'prompt' ? 'Tocá el botón para activarlas.'
    : '';

  return (
    <ErpNotice
      tone={variant}
      title={<span className="inline-flex items-center gap-2">{icon}{title}</span>}
      actions={status === 'prompt' ? (
        <ErpButton variant="primary" size="sm" loading={requesting} onClick={handleRequest}>
          {requesting ? 'Activando…' : 'Activar avisos'}
        </ErpButton>
      ) : undefined}
    >
      {description}
    </ErpNotice>
  );
}

export function SettingsPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchConfigStatus().then(setStatus).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Configuración técnica"
        description="Estado operativo del backend, credenciales y control general de apagado."
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}

      <PushPanel />

      {status && (
        <>
          <ErpCard title="Estado del backend" subtitle="Flags principales que controlan el funcionamiento del sistema.">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <FlagRow ok={status.app_enabled} label={status.app_enabled ? 'APP_ENABLED=true · la app permite ejecutar' : 'APP_ENABLED=false · ejecuciones bloqueadas'} />
              <FlagRow ok={status.legacy_scripts_found} label="Scripts legacy encontrados" />
              <FlagRow ok={status.has_credentials_env || status.has_credentials_file} label="Credenciales Google configuradas" />
              <FlagRow ok={status.has_token_file} label="Token OAuth disponible" />
            </div>
          </ErpCard>

          <ErpCard title="Control total" subtitle="Cómo cerrar o reiniciar la app de manera segura.">
            <ErpInfoGrid columns={2}>
              <ErpInfoRow
                label="Para cerrar la app"
                value={<span>Apagá el deploy, poné <strong>APP_ENABLED=false</strong>, eliminá usuarios o revocá credenciales Google.</span>}
              />
              <ErpInfoRow
                label="Directorio de storage actual"
                value={<code className="font-mono text-[11.5px] text-[color:var(--text-2)]">{status.storage_dir}</code>}
              />
            </ErpInfoGrid>
          </ErpCard>
        </>
      )}
    </div>
  );
}
