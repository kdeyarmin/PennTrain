export type ClientErrorSource =
  | "react-boundary"
  | "window-error"
  | "unhandled-rejection"
  | "deployment-asset"
  | "query-error";

interface ClientErrorReport {
  source: ClientErrorSource;
  name: string;
  message: string;
  route: string;
  release: string;
  component: string | null;
  online: boolean;
  visibility: DocumentVisibilityState | "unknown";
  correlationId: string;
}

// Building a report must not assume a DOM:
//
//   * Vitest executes these modules in its node environment, where `window`, `document`,
//     `navigator` and `crypto` are all absent. That is how this surfaced: Railway's builder
//     sets NODE_ENV=production, Vite derives `import.meta.env.PROD` from NODE_ENV alone (mode
//     is still "test"), so the PROD gate below stopped short-circuiting inside the test run
//     and deploymentRecovery.test.ts died on `window is not defined` -- a build failure with
//     no product change behind it, green on every developer machine.
//   * A web worker has `location` and `navigator` but no `window` or `document`.
//   * `crypto.randomUUID` is secure-context only, so `crypto` is undefined in a real browser
//     on any http:// origin -- a LAN IP, an internal host, anything not localhost or TLS.
//     Minting the correlation id would throw there.
//
// A throw here is strictly worse than a dropped report: reportClientError is called from
// ErrorBoundary and QueryError, so it would turn a recoverable render failure into a blank
// page -- the exact outcome the reporting exists to detect. Read every ambient global
// through this optional view and fall back instead of dereferencing.
const ambient = globalThis as Partial<Window & typeof globalThis>;

function currentRoute(): string {
  // A worker has no `window` but does have `location`, so this still reports a real route
  // there. With no location at all there is no route to report, and the report-client-error
  // function rejects anything that does not start with "/" -- fall back to root rather than
  // to a sentinel the endpoint would 400 on.
  const pathname = ambient.location?.pathname;
  return typeof pathname === "string" && pathname.startsWith("/") ? pathname : "/";
}

function correlationId(): string {
  const uuid = ambient.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Only reached where randomUUID is unavailable. The id exists to join a client report to a
  // server log line, not to be unguessable, so a non-cryptographic v4-shaped value is enough
  // -- and it has to keep that shape, because the edge function replaces any correlation id
  // that fails its strict UUID check with a server-minted one.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const nibble = Math.floor(Math.random() * 16);
    return (char === "x" ? nibble : (nibble & 0x3) | 0x8).toString(16);
  });
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_COMPONENT_LENGTH = 240;
const reported = new Set<string>();

export function sanitizeClientErrorText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? "Unknown error");
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\+?[1-9]\d{7,14}/g, "[redacted-number]")
    .replace(/https?:\/\/[^\s?#]+[^\s]*/gi, (url) => url.split(/[?#]/, 1)[0])
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function errorDetails(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: sanitizeClientErrorText(error.name || "Error", 80),
      message: sanitizeClientErrorText(error.message),
    };
  }
  return { name: "Error", message: sanitizeClientErrorText(error) };
}

export function buildClientErrorReport(
  error: unknown,
  source: ClientErrorSource,
  componentStack?: string,
): ClientErrorReport {
  const details = errorDetails(error);
  return {
    source,
    ...details,
    route: currentRoute(),
    release: import.meta.env.VITE_RELEASE_ID || "unknown",
    component: componentStack ? sanitizeClientErrorText(componentStack, MAX_COMPONENT_LENGTH) : null,
    // Unknown connectivity reports as online: the server records `online === true` only, and
    // claiming the client was offline when nothing said so would misdirect triage.
    online: ambient.navigator?.onLine ?? true,
    visibility: ambient.document?.visibilityState ?? "unknown",
    correlationId: correlationId(),
  };
}

export function reportClientError(
  error: unknown,
  source: ClientErrorSource,
  componentStack?: string,
): void {
  const enabled =
    import.meta.env.PROD &&
    import.meta.env.VITE_CLIENT_ERROR_REPORTING_ENABLED !== "false";
  if (!enabled) return;

  // The .catch below only covers a rejected request. Callers are error handlers -- the last
  // code standing between a failure and a rendered fallback -- so nothing on this path may
  // propagate synchronously either, including a missing global the guards above did not
  // anticipate.
  try {
    const report = buildClientErrorReport(error, source, componentStack);
    const fingerprint = `${report.source}:${report.name}:${report.message}:${report.route}`;
    if (reported.has(fingerprint)) return;
    reported.add(fingerprint);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return;

    void fetch(`${supabaseUrl}/functions/v1/report-client-error`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(report),
    }).catch(() => {
      // Reporting must never create another application failure.
    });
  } catch {
    // Same rule, synchronous half.
  }
}

export function installGlobalErrorReporting(): () => void {
  const onError = (event: ErrorEvent) => {
    reportClientError(event.error ?? event.message, "window-error");
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, "unhandled-rejection");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
