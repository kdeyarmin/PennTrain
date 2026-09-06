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
    getRegistrations: () => Promise<readonly { unregister: () => Promise<boolean> }[]>;
  };
  caches?: {
    keys: () => Promise<string[]>;
    delete: (cacheName: string) => Promise<boolean>;
  };
  reload: () => void;
  /**
   * Whether the page is holding work the visitor has not saved. Absent means "nothing to lose",
   * which is what a caller that does not know should assume -- see recoverFromStaleDeployment.
   */
  hasUnsavedInput?: () => boolean;
  /** Shows the "reload when you are ready" notice instead of reloading. */
  announceStale?: () => void;
}

/**
 * A visitor's unsaved typing, as far as the DOM can tell.
 *
 * BACKLOG J74 (P3, guest/server). Deliberately conservative in one direction only: it can miss a
 * change (a controlled component whose defaultValue was re-synced), never invent one -- a false
 * positive would leave a genuinely broken shell un-reloaded, which is the worse failure.
 */
export function documentHasUnsavedInput(doc: Document = document): boolean {
  const fields = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  for (const field of fields) {
    if (field.disabled || field.readOnly) continue;
    if (field instanceof HTMLInputElement && ["hidden", "submit", "button", "reset"].includes(field.type)) continue;
    if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
      if (field.checked !== field.defaultChecked) return true;
      continue;
    }
    if (field.value.trim() && field.value !== field.defaultValue) return true;
  }
  for (const editable of doc.querySelectorAll<HTMLElement>("[contenteditable='true']")) {
    if ((editable.textContent ?? "").trim()) return true;
  }
  return false;
}

function browserEnvironment(): RecoveryEnvironment {
  return {
    sessionStorage: window.sessionStorage,
    serviceWorker: navigator.serviceWorker,
    caches: window.caches,
    reload: () => window.location.reload(),
    hasUnsavedInput: () => documentHasUnsavedInput(),
    announceStale: () => showStaleShellNotice(),
  };
}

const NOTICE_ID = "carebase-stale-deployment-notice";

/**
 * The one thing this file was missing: a way to say "this tab is out of date" that is not a reload.
 *
 * Plain DOM rather than a React component on purpose. It has to be able to appear when the React
 * tree cannot render the route it was asked for (a lazy chunk the new release deleted), it has to
 * work identically on the marketing pages and inside the app shell, and it must not depend on any
 * chunk that might itself be the missing one.
 */
export function showStaleShellNotice(doc: Document = document): void {
  if (doc.getElementById(NOTICE_ID)) return;
  const bar = doc.createElement("div");
  bar.id = NOTICE_ID;
  bar.setAttribute("role", "status");
  bar.style.cssText = [
    "position:fixed", "left:50%", "bottom:16px", "transform:translateX(-50%)", "z-index:2147483647",
    "max-width:min(640px,calc(100vw - 24px))", "display:flex", "gap:12px", "align-items:center",
    // The bar itself is transparent to the pointer; only its two buttons take clicks. Without this
    // a fixed, full-width-on-mobile element at z-index 2147483647 swallows every click inside its
    // rectangle -- CI caught it sitting on top of the Sign in button, and a real visitor would have
    // hit the same wall with no idea what was eating the tap.
    "pointer-events:none",
    "padding:12px 16px", "border-radius:10px", "border:1px solid #cfe2f4", "background:#0d2742",
    "color:#ffffff", "box-shadow:0 8px 24px rgba(13,39,66,0.28)",
    "font:600 14px/1.45 'Segoe UI',Helvetica,Arial,sans-serif",
  ].join(";");
  const text = doc.createElement("span");
  text.style.cssText = "flex:1;font-weight:500;";
  text.textContent = "A new version of CareBase was released. Finish and save what you are working on, then reload this page.";
  const reload = doc.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload now";
  reload.style.cssText =
    "flex:none;pointer-events:auto;cursor:pointer;border:0;border-radius:8px;background:#1b6fc2;color:#ffffff;font:inherit;padding:8px 14px;";
  reload.addEventListener("click", () => window.location.reload());
  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss update notice");
  dismiss.textContent = "\u00d7";
  dismiss.style.cssText =
    "flex:none;pointer-events:auto;cursor:pointer;border:0;background:transparent;color:#9fc4e8;font:inherit;font-size:18px;line-height:1;padding:4px 6px;";
  dismiss.addEventListener("click", () => bar.remove());
  bar.append(text, reload, dismiss);
  doc.body.appendChild(bar);
}

export async function recoverFromStaleDeployment(
  reason: unknown,
  environment: RecoveryEnvironment = browserEnvironment(),
): Promise<boolean> {
  if (!isDeploymentAssetError(reason)) return false;

  reportClientError(reason, "deployment-asset");
  if (environment.sessionStorage.getItem(RECOVERY_KEY)) return false;

  // BACKLOG J74 (P3, guest/server). The first lazy-chunk miss after a deploy used to reload the
  // page here, unconditionally -- which is the right repair for a stale shell and the wrong thing
  // to do to somebody halfway through an incident report or a resident assessment: the route they
  // asked for failed, but everything they had typed was still on screen, and the reload took it.
  // A missed chunk is a route that did not open, not a broken document, so when there is unsaved
  // work the tab keeps it and says so instead. The guard key is NOT written on this path, so the
  // reload is still available the moment the page is safe to reload.
  if (environment.hasUnsavedInput?.()) {
    environment.announceStale?.();
    return false;
  }

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
  // BACKLOG J74 (P3, guest/server). vite-plugin-pwa runs with registerType "autoUpdate", so a
  // deploy's new service worker skipWaiting()s and claims this tab while the tab is still running
  // the PREVIOUS release's JS. Nothing told anyone: the shell silently became a mixture of two
  // releases, and the first route that needed a chunk the new release had deleted was where it
  // showed up. `controllerchange` is the moment that happens, and it is the moment to say so.
  // Never an automatic reload -- the visitor may be mid-form, and unlike a chunk miss nothing is
  // broken yet.
  //
  // `controllerchange` also fires the FIRST time a service worker claims a tab that had none --
  // an ordinary first visit, not a release replacing the code already running. Announcing there
  // told every new visitor their brand-new page was out of date, and the notice sat on the login
  // form while they read it. So the announcement is conditional on there having been a controller
  // to replace, captured when the listener is installed rather than read at event time, because
  // by then `controller` is already the new worker either way.
  const hadControllerAtInstall = Boolean(navigator.serviceWorker?.controller);
  const onControllerChange = () => {
    if (!hadControllerAtInstall) return;
    showStaleShellNotice();
  };
  navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
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
    navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
