import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Modo local (sin ngrok):
//   - Backend FastAPI corriendo en http://127.0.0.1:8000
//   - npm run dev levanta el frontend en :5173
//   - El proxy reenvía las llamadas /api, /auth y /storage al backend
//   - Las llamadas siguen siendo relativas; no requiere CORS ni .env
//
// Modo Vercel/producción:
//   - VITE_API_BASE_URL apunta al dominio público (ngrok o el que corresponda)
//   - El proxy de Vite no interviene (solo aplica en dev server)
//
// Si querés forzar una URL absoluta también en dev, creá frontend/.env.local
// con VITE_API_BASE_URL=http://127.0.0.1:8000 y reiniciá `npm run dev`.
const LOCAL_BACKEND = 'http://127.0.0.1:8000';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useProxy = !env.VITE_API_BASE_URL;
  const proxy = useProxy
    ? {
        '/api': { target: LOCAL_BACKEND, changeOrigin: true },
        '/auth': { target: LOCAL_BACKEND, changeOrigin: true },
        '/storage': { target: LOCAL_BACKEND, changeOrigin: true },
        '/downloads': { target: LOCAL_BACKEND, changeOrigin: true },
      }
    : undefined;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy,
    },
    preview: {
      port: 4173,
      host: '0.0.0.0',
    },
  };
});
