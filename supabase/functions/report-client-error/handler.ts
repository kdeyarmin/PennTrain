import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_SOURCES = new Set([
  "react-boundary",
  "window-error",
  "unhandled-rejection",
  "deployment-asset",
  "query-error",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function sanitizeClientReportValue(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\+?[1-9]\d{7,14}/g, "[redacted-number]")
    .replace(/https?:\/\/[^\s?#]+[^\s]*/gi, (url) => url.split(/[?#]/, 1)[0])
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export async function handleReportClientErrorRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody(req, 8_192);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json({ error: error.status === 413 ? "Payload too large" : "Invalid JSON" }, error.status);
    }
    return json({ error: "Invalid JSON" }, 400);
  }

  const source = sanitizeClientReportValue(payload.source, 40);
  const route = sanitizeClientReportValue(payload.route, 200);
  if (!ALLOWED_SOURCES.has(source) || !route.startsWith("/") || route.includes("?")) {
    return json({ error: "Invalid report" }, 400);
  }

  const event = {
    event: "client_application_error",
    source,
    severity: source === "deployment-asset" ? "warning" : "error",
    name: sanitizeClientReportValue(payload.name, 80),
    message: sanitizeClientReportValue(payload.message, 500),
    route,
    release: sanitizeClientReportValue(payload.release, 120),
    component: payload.component ? sanitizeClientReportValue(payload.component, 240) : null,
    online: payload.online === true,
    visibility: sanitizeClientReportValue(payload.visibility, 20),
    correlation_id: sanitizeClientReportValue(payload.correlationId, 80),
    observed_at: new Date().toISOString(),
  };

  // Structured, PHI-scrubbed telemetry remains in the existing Supabase logging boundary.
  // Operators can alert on event=client_application_error without introducing a new processor.
  console.error(JSON.stringify(event));
  return json({ accepted: true }, 202);
}
