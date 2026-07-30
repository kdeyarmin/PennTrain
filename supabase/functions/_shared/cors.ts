/**
 * Origin-aware CORS for browser-called Edge Functions.
 *
 * Reflects Access-Control-Allow-Origin only when the request Origin is on the
 * allow-list. Non-browser callers (no Origin header) get the standard headers
 * without a reflected origin.
 *
 * Configure with (origins only — scheme + host + optional port, no path):
 *   PUBLIC_APP_URL                 e.g. https://cmcarebase.com
 *   ALLOWED_CORS_ORIGINS           comma-separated origins (preferred)
 *   SIGNUP_REDIRECT_ORIGINS        comma-separated origins (fallback if ALLOWED_CORS_ORIGINS unset)
 *   ALLOW_LOCALHOST_CORS=true      adds http://localhost:5173|3000 and 127.0.0.1 equivalents
 *
 * Cron / webhook-only functions should not use this helper. Prefer omitting
 * Access-Control-Allow-Origin entirely (withCronCorsHeader strips it).
 */

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://cmcarebase.com",
]);

const DEFAULT_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type";

/** Default methods for browser Edge Functions (override per endpoint as needed). */
const DEFAULT_ALLOW_METHODS = "GET, POST, OPTIONS";

/** Cache preflight for 24h; origin is still validated on every actual request. */
const DEFAULT_MAX_AGE = "86400";

export type EnvReader = (name: string) => string | undefined;

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    // deno test without --allow-env: fail closed (defaults only)
    return undefined;
  }
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function allowedCorsOrigins(getEnv: EnvReader = readEnv): Set<string> {
  const fromEnv = (
    getEnv("ALLOWED_CORS_ORIGINS") ??
    getEnv("SIGNUP_REDIRECT_ORIGINS") ??
    ""
  )
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  const origins = new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv]);

  const publicApp = normalizeOrigin(getEnv("PUBLIC_APP_URL") ?? "");
  if (publicApp) {
    try {
      origins.add(new URL(publicApp).origin);
    } catch {
      // ignore malformed PUBLIC_APP_URL
    }
  }

  if (getEnv("ALLOW_LOCALHOST_CORS") === "true") {
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
  maxAge?: string;
  /** Injectable env reader for tests. */
  getEnv?: EnvReader;
};

/**
 * Build CORS response headers for a given request.
 * Always sets Vary: Origin so caches do not mix responses across apps.
 */
export function corsHeadersForRequest(
  req: Request,
  options: CorsOptions = {},
): Record<string, string> {
  const getEnv = options.getEnv ?? readEnv;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": options.headers ?? DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": options.methods ?? DEFAULT_ALLOW_METHODS,
    "Access-Control-Max-Age": options.maxAge ?? DEFAULT_MAX_AGE,
    Vary: "Origin",
  };

  const origin = req.headers.get("Origin");
  if (origin && allowedCorsOrigins(getEnv).has(normalizeOrigin(origin))) {
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
