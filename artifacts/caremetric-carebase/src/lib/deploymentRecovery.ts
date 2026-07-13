import { reportClientError } from "./clientErrorReporting";

const RECOVERY_KEY = "caremetric-deployment-recovery";
const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk [\d-]+ failed/i,
  /unable to preload css/i,
];

export function isDeploymentAssetError(reason: unknown): boolean {
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? "");
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export interface RecoveryEnvironment {
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  serviceWorker?: {
    getRegistrations: () => Promise<Array<{ unregister: () => Promise<boolean> }>>;
  };
  caches?: {
    keys: () => Promise<string[]>;
    delete: (cacheName: string) => Promise<boolean>;
  };
  reload: () => void;
}

function browserEnvironment(): RecoveryEnvironment {
  return {
    sessionStorage: window.sessionStorage,
    serviceWorker: navigator.serviceWorker,
    caches: window.caches,
    reload: () => window.location.reload(),
  };
}

export async function recoverFromStaleDeployment(
  reason: unknown,
  environment: RecoveryEnvironment = browserEnvironment(),
): Promise<boolean> {
  if (!isDeploymentAssetError(reason)) return false;

  reportClientError(reason, "deployment-asset");
  if (environment.sessionStorage.getItem(RECOVERY_KEY)) return false;
  environment.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

  try {
    const registrations = await environment.serviceWorker?.getRegistrations();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
    const cacheNames = await environment.caches?.keys();
    await Promise.all((cacheNames ?? []).map((cacheName) => environment.caches!.delete(cacheName)));
  } finally {
    environment.reload();
  }
  return true;
}

export function installDeploymentRecovery(): () => void {
  const clearGuard = window.setTimeout(() => {
    window.sessionStorage.removeItem(RECOVERY_KEY);
  }, 10_000);
  const onPreloadError = (event: Event) => {
    const payload = event as Event & { payload?: unknown };
    event.preventDefault();
    void recoverFromStaleDeployment(payload.payload);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isDeploymentAssetError(event.reason)) return;
    event.preventDefault();
    void recoverFromStaleDeployment(event.reason);
  };

  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.clearTimeout(clearGuard);
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
