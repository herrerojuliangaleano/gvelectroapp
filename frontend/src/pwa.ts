export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global {
  interface WindowEventMap {
    'electrogv:pwa-install-available': CustomEvent<BeforeInstallPromptEvent>;
    'electrogv:pwa-update-available': CustomEvent<ServiceWorkerRegistration>;
  }
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let reloadWaitingForController = false;

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt;
}

export function clearDeferredInstallPrompt(): void {
  deferredInstallPrompt = null;
}

export function isStandalonePwa(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
}

export function registerPwa(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent('electrogv:pwa-install-available', { detail: deferredInstallPrompt }));
  });

  window.addEventListener('appinstalled', () => {
    clearDeferredInstallPrompt();
    localStorage.setItem('electrogv_pwa_installed_at', new Date().toISOString());
  });

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('electrogv:pwa-update-available', { detail: registration }));
          }
        });
      });

      if (registration.waiting && navigator.serviceWorker.controller) {
        window.dispatchEvent(new CustomEvent('electrogv:pwa-update-available', { detail: registration }));
      }
    }).catch(() => undefined);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloadWaitingForController) return;
      window.location.reload();
    });
  });
}

export function activateWaitingServiceWorker(registration: ServiceWorkerRegistration): void {
  const worker = registration.waiting || registration.installing;
  if (!worker) return;
  reloadWaitingForController = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
}
