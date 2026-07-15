// @ts-nocheck
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

function sanitize(value: unknown, maxLength: number): string {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 8_192) return json({ error: "Payload too large" }, 413);

  let payload: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 8_192) return json({ error: "Payload too large" }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const source = sanitize(payload.source, 40);
  const route = sanitize(payload.route, 200);
  if (!ALLOWED_SOURCES.has(source) || !route.startsWith("/") || route.includes("?")) {
    return json({ error: "Invalid report" }, 400);
  }

  const event = {
    event: "client_application_error",
    source,
    severity: source === "deployment-asset" ? "warning" : "error",
    name: sanitize(payload.name, 80),
    message: sanitize(payload.message, 500),
    route,
    release: sanitize(payload.release, 120),
    component: payload.component ? sanitize(payload.component, 240) : null,
    online: payload.online === true,
    visibility: sanitize(payload.visibility, 20),
    correlation_id: sanitize(payload.correlationId, 80),
    observed_at: new Date().toISOString(),
  };

  // Structured, PHI-scrubbed telemetry remains in the existing Supabase logging boundary.
  // Operators can alert on event=client_application_error without introducing a new processor.
  console.error(JSON.stringify(event));
  return json({ accepted: true }, 202);
});
