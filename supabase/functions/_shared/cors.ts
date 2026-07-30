/**
 * Origin-aware CORS for browser-called Edge Functions.
 *
 * Reflects Access-Control-Allow-Origin only when the request Origin is on the
 * allow-list. Non-browser callers (no Origin header) get the standard headers
 * without a wildcard origin.
 *
 * Configure with:
 *   PUBLIC_APP_URL                 e.g. https://cmcarebase.com
 *   ALLOWED_CORS_ORIGINS           comma-separated origins (preferred)
 *   SIGNUP_REDIRECT_ORIGINS        comma-separated origins (reused if ALLOWED_CORS_ORIGINS unset)
 *   ALLOW_LOCALHOST_CORS=true      adds http://localhost:5173 and 127.0.0.1:5173
 */

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://cmcarebase.com",
]);

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function allowedCorsOrigins(): Set<string> {
  const fromEnv = (
    Deno.env.get("ALLOWED_CORS_ORIGINS") ??
    Deno.env.get("SIGNUP_REDIRECT_ORIGINS") ??
    ""
  )
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  const origins = new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv]);

  const publicApp = normalizeOrigin(Deno.env.get("PUBLIC_APP_URL") ?? "");
  if (publicApp) {
    try {
      origins.add(new URL(publicApp).origin);
    } catch {
      // ignore malformed PUBLIC_APP_URL
    }
  }

  if (Deno.env.get("ALLOW_LOCALHOST_CORS") === "true") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

export type CorsOptions = {
  headers?: string;
  methods?: string;
};

const DEFAULT_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type";

/**
 * Build CORS response headers for a given request.
 * Always sets Vary: Origin so caches do not mix responses across apps.
 */
export function corsHeadersForRequest(
  req: Request,
  options: CorsOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": options.headers ?? DEFAULT_ALLOW_HEADERS,
    Vary: "Origin",
  };
  if (options.methods) {
    headers["Access-Control-Allow-Methods"] = options.methods;
  }

  const origin = req.headers.get("Origin");
  if (origin && allowedCorsOrigins().has(normalizeOrigin(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

/** Convenience: OPTIONS preflight response. */
export function corsPreflightResponse(
  req: Request,
  options: CorsOptions = {},
): Response {
  return new Response("ok", { headers: corsHeadersForRequest(req, options) });
}
