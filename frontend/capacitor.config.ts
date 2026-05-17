import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.vayori.electrogv',
  appName: 'ElectroGV',
  webDir: 'dist',
  server: {
    // La app carga el sistema desde el dominio online.
    // No necesitás recompilar APK para ver cambios de frontend/backend.
    // Solo recompilás APK cuando cambian plugins nativos, ícono, permisos, etc.
    url: 'https://electrogv.vayori.net',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0b1220',
  },
};

export default config;
