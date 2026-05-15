import { useEffect, useMemo, useState } from 'react';
import { fetchEmployeePhoto } from '../api/client';

export function EmployeePhoto({ username, name, hasPhoto, size = 'md' }: { username?: string | null; name?: string | null; hasPhoto?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const [url, setUrl] = useState('');
  const initials = useMemo(() => {
    const parts = String(name || username || '?').trim().split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || '?') + (parts[1]?.[0] || '');
  }, [name, username]);
  const sizeClass = size === 'lg' ? 'h-28 w-28 text-3xl' : size === 'sm' ? 'h-12 w-12 text-sm' : 'h-16 w-16 text-lg';

  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    if (!username || !hasPhoto) {
      setUrl('');
      return;
    }
    fetchEmployeePhoto(username)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(''));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [username, hasPhoto]);

  if (url) {
    return <img src={url} alt={name || username || 'Empleado'} className={`${sizeClass} rounded-2xl border border-slate-700 object-cover`} />;
  }
  return <div className={`${sizeClass} flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 font-black uppercase text-slate-400`}>{initials}</div>;
}
