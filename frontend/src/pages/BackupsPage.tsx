import { Download, RefreshCw, Archive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { backupDownloadUrl, createBackup, fetchBackups, getToken } from '../api/client';
import {
  ErpButton,
  ErpDataTable,
  ErpNotice,
  ErpPageHeader,
  type ErpColumn,
  type ErpRowAction,
} from '../components/ProUI';
import type { BackupInfo } from '../types';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsPage() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setBackups(await fetchBackups());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar backups');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function makeBackup() {
    setError(''); setMessage(''); setCreating(true);
    try {
      const res = await createBackup();
      setMessage(`Backup creado: ${res.filename}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear backup');
    } finally {
      setCreating(false);
    }
  }

  async function download(filename: string) {
    try {
      const token = getToken();
      const res = await fetch(backupDownloadUrl(filename), { headers: { Authorization: `Bearer ${token || ''}`, 'ngrok-skip-browser-warning': 'true' } });
      if (!res.ok) throw new Error('No se pudo descargar backup');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar backup');
    }
  }

  const columns: ErpColumn<BackupInfo>[] = [
    {
      key: 'filename',
      header: 'Archivo',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Archive size={13} className="text-[color:var(--text-3)] shrink-0" />
          <span className="font-mono text-[12.5px]">{row.filename}</span>
        </div>
      ),
    },
    {
      key: 'size',
      header: 'Tamaño',
      width: 110,
      align: 'right',
      muted: true,
      render: (row) => formatBytes(row.size_bytes),
    },
    {
      key: 'created_at',
      header: 'Creado',
      width: 170,
      muted: true,
      render: (row) => <span className="tabular-nums">{new Date(row.created_at).toLocaleString('es-AR')}</span>,
    },
  ];

  const rowActions: ErpRowAction<BackupInfo>[] = [
    {
      key: 'download',
      label: 'Descargar',
      icon: <Download size={14} />,
      onClick: (row) => download(row.filename),
    },
  ];

  return (
    <div className="erp-stack-6">
      <ErpPageHeader
        title="Backups"
        description="Respaldo local de usuarios, roles, configuración, base SQLite y logs. Se guardan en backend/storage/backups/."
        actions={
          <ErpButton variant="primary" onClick={makeBackup} loading={creating} leftIcon={<RefreshCw size={14} />}>
            {creating ? 'Creando...' : 'Crear backup ahora'}
          </ErpButton>
        }
      />

      {error && <ErpNotice tone="error">{error}</ErpNotice>}
      {message && <ErpNotice tone="success">{message}</ErpNotice>}

      <ErpDataTable<BackupInfo>
        columns={columns}
        rows={backups}
        rowKey={(row) => row.filename}
        loading={loading}
        rowActions={rowActions}
        empty={{
          title: 'Todavía no hay backups',
          description: 'Generá el primer backup con el botón de arriba.',
        }}
      />
    </div>
  );
}
