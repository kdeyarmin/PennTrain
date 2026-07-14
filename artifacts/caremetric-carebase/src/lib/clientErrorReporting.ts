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
  visibility: DocumentVisibilityState;
  correlationId: string;
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
    route: window.location.pathname,
    release: import.meta.env.VITE_RELEASE_ID || "unknown",
    component: componentStack ? sanitizeClientErrorText(componentStack, MAX_COMPONENT_LENGTH) : null,
    online: navigator.onLine,
    visibility: document.visibilityState,
    correlationId: crypto.randomUUID(),
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
