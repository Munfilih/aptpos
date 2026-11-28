const PWA_SYSTEM_CODE_KEY = 'aptpos_pwa_system_code_v1';
const PWA_TERMINAL_NAME_KEY = 'aptpos_pwa_terminal_name_v1';

export interface DeferredInstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredInstallPrompt: DeferredInstallPrompt | null = null;
const installPromptListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  // Capture as early as possible (before React mounts) so the event is never missed
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as DeferredInstallPrompt;
    installPromptListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installPromptListeners.forEach((fn) => fn());
  });
}

export function getDeferredInstallPrompt(): DeferredInstallPrompt | null {
  return deferredInstallPrompt;
}

export function onInstallPromptChange(listener: () => void): () => void {
  installPromptListeners.add(listener);
  return () => {
    installPromptListeners.delete(listener);
  };
}

export async function triggerPwaInstall(): Promise<boolean> {
  const promptEvent = deferredInstallPrompt;
  if (!promptEvent) return false;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  installPromptListeners.forEach((fn) => fn());
  return choice?.outcome === 'accepted';
}

let fetchPatched = false;
let swUpdateListeners = new Set<() => void>();
let waitingWorker: ServiceWorker | null = null;

export function isRunningInElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
}

export function isRunningInStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)');
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(mq?.matches || nav.standalone === true);
}

export function isRemoteLanBrowser(): boolean {
  if (typeof window === 'undefined' || isRunningInElectron()) return false;
  const host = window.location.hostname.toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]';
}

function generateTenDigitCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return (value % 10_000_000_000n).toString().padStart(10, '0');
}

export function getOrCreatePwaSystemCode(): string {
  try {
    const existing = localStorage.getItem(PWA_SYSTEM_CODE_KEY);
    if (existing && /^\d{10}$/.test(existing)) return existing;
    const created = generateTenDigitCode();
    localStorage.setItem(PWA_SYSTEM_CODE_KEY, created);
    return created;
  } catch {
    return generateTenDigitCode();
  }
}

export function getPwaTerminalName(): string {
  try {
    const saved = localStorage.getItem(PWA_TERMINAL_NAME_KEY)?.trim();
    if (saved) return saved;
  } catch {
    // Ignore storage errors
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPad/i.test(ua)) return 'iPad POS';
  if (/iPhone/i.test(ua)) return 'iPhone POS';
  if (/Android/i.test(ua)) return 'Android Tablet POS';
  return 'Web / PWA Terminal';
}

export function setPwaTerminalName(name: string): void {
  try {
    const cleaned = name.trim().slice(0, 80);
    if (cleaned) localStorage.setItem(PWA_TERMINAL_NAME_KEY, cleaned);
  } catch {
    // Ignore
  }
}

/**
 * Automatically injects this browser/tablet's persistent 10-digit System Code
 * into same-origin `/api/*` requests when opened over LAN Wi-Fi outside Electron,
 * so mobile/tablet PWAs integrate seamlessly with the Primary Server's
 * Additional System Registration security gate.
 */
export function installPwaTerminalFetchInterceptor(): void {
  if (typeof window === 'undefined' || fetchPatched || !isRemoteLanBrowser()) return;
  fetchPatched = true;

  const originalFetch = window.fetch.bind(window);
  const systemCode = getOrCreatePwaSystemCode();

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const resolved = new URL(rawUrl, window.location.origin);
      if (resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/')) {
        const headers = new Headers(
          init?.headers || (input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('X-Terminal-System-Code')) {
          headers.set('X-Terminal-System-Code', systemCode);
        }
        if (!headers.has('X-Terminal-Name')) {
          headers.set('X-Terminal-Name', getPwaTerminalName());
        }
        if (!headers.has('X-Terminal-Shell-Version')) {
          headers.set('X-Terminal-Shell-Version', isRunningInStandalonePwa() ? 'pwa-standalone' : 'pwa-web');
        }
        return originalFetch(input, { ...init, headers });
      }
    } catch {
      // Fall through to original fetch on URL parse errors
    }
    return originalFetch(input, init);
  };
}

export function buildPwaEventSourceUrl(path = '/api/events'): string {
  if (!isRemoteLanBrowser()) return path;
  const code = getOrCreatePwaSystemCode();
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}terminalCode=${encodeURIComponent(code)}`;
}

export function onPwaUpdateAvailable(listener: () => void): () => void {
  swUpdateListeners.add(listener);
  if (waitingWorker) listener();
  return () => {
    swUpdateListeners.delete(listener);
  };
}

export function applyPwaUpdate(): void {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  } else if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

export function registerPwaServiceWorker(): void {
  if (typeof window === 'undefined' || isRunningInElectron()) return;
  if (!('serviceWorker' in navigator)) return;

  // Service Workers require a secure context (HTTPS or localhost)
  if (!window.isSecureContext) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (registration.waiting) {
          waitingWorker = registration.waiting;
          swUpdateListeners.forEach((fn) => fn());
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = installing;
              swUpdateListeners.forEach((fn) => fn());
            }
          });
        });

        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });
      })
      .catch((error) => {
        console.warn('PWA service worker registration skipped:', error);
      });
  });
}
