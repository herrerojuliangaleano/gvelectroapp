import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRANDS } from '../brand';
import { BrandLogo } from '../components/BrandLogo';
import { login, setSession } from '../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await login(username.trim(), password);
      setSession(res.token, res.username, res.display_name, res.role, res.permissions, !!res.must_change_password, res.sucursal || '', res);
      if (res.must_change_password) {
        navigate('/set-password');
        return;
      }
      if (res.permissions.includes('*') || res.permissions.includes('dashboard.view')) navigate('/');
      else navigate('/warranties/new');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-[radial-gradient(circle_at_top_left,#12365c_0,#08111f_45%,#050914_100%)] text-slate-100 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden min-h-screen items-center justify-center p-10 lg:flex">
        <div className="max-w-xl">
          <BrandLogo brand={BRANDS.gv} size="lg" />
          <div className="mt-10 rounded-[2rem] border border-slate-800 bg-slate-950/55 p-8 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-blue-100">Sistema interno</div>
            <h1 className="mt-5 text-4xl font-black leading-tight text-white">Gestión operativa para GV y ABC Electro</h1>
            <p className="mt-4 text-base leading-7 text-slate-300">Ventas, garantías, productos, recibos, usuarios y herramientas internas en un único panel de trabajo.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <MiniStat label="Operación" value="Ventas" />
              <MiniStat label="Gestión" value="Garantías" />
              <MiniStat label="Control" value="Auditoría" />
            </div>
          </div>
        </div>
      </section>
      <section className="flex min-h-screen items-center justify-center p-4 sm:p-8">
        <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-slate-700/80 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <div className="mb-7 text-center lg:hidden">
            <BrandLogo brand={BRANDS.gv} size="lg" className="justify-center" />
          </div>
          <div className="mb-7">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-blue-200">Acceso seguro</div>
            <h2 className="mt-2 text-2xl font-black text-white">Ingresar al sistema</h2>
            <p className="mt-2 text-sm text-slate-400">Usá tu usuario interno para continuar.</p>
          </div>
          {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-300">Usuario</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <label className="mb-2 block">
            <span className="mb-2 block text-sm font-semibold text-slate-300">Contraseña</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <p className="mb-6 text-xs leading-5 text-slate-500">En el primer ingreso, si tu usuario fue creado sin contraseña, el sistema te va a pedir configurar una nueva.</p>
          <button disabled={loading} className="w-full rounded-2xl bg-blue-500 px-4 py-3 font-black text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-400 disabled:opacity-50">{loading ? 'Ingresando...' : 'Ingresar'}</button>
        </form>
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 font-black text-white">{value}</div></div>;
}
