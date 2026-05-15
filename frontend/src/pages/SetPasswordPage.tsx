import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword, getCurrentUserFromStorage, setSession } from '../api/client';

export function SetPasswordPage() {
  const navigate = useNavigate();
  const user = getCurrentUserFromStorage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const res = await changePassword(password);
      setSession(res.token, res.username, res.display_name, res.role, res.permissions, !!res.must_change_password, res.sucursal || '', res);
      if (res.permissions.includes('*') || res.permissions.includes('dashboard.view')) navigate('/');
      else navigate('/warranties/new');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la contraseña');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#12365c_0,#08111f_45%,#050914_100%)] p-4 text-slate-100 sm:p-8">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-950/75 p-6 shadow-2xl backdrop-blur sm:p-8">
        <div className="mb-7 text-center">
          <div className="text-5xl">🔐</div>
          <h1 className="mt-4 text-2xl font-black sm:text-3xl">Crear contraseña</h1>
          <p className="mt-2 text-sm text-slate-400 sm:text-base">Primer ingreso o contraseña blanqueada</p>
          {user && <p className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-slate-300">{user.display_name} · {user.username}</p>}
        </div>
        {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        <label className="mb-4 block">
          <span className="mb-2 block text-sm font-semibold text-slate-300">Nueva contraseña</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400" />
        </label>
        <label className="mb-6 block">
          <span className="mb-2 block text-sm font-semibold text-slate-300">Repetir contraseña</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-400" />
        </label>
        <button disabled={loading} className="w-full rounded-xl bg-blue-500 px-4 py-3 font-bold text-white shadow-lg transition hover:bg-blue-400 disabled:opacity-50">{loading ? 'Guardando...' : 'Guardar contraseña'}</button>
      </form>
    </div>
  );
}
