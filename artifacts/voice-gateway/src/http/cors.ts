// Per-app origin allowlisting. Stricter than the repo's edge functions
// (which use `*`): the gateway echoes only an origin the app registered.
// Requests without an Origin header (server-to-server, curl) pass the
// origin check — authentication still gates them.

import type { AppDefinition } from "../apps/types.js";

export function isOriginAllowed(
  app: AppDefinition,
  origin: string | undefined,
): boolean {
  if (!origin) return true;
  return app.allowedOrigins.includes(origin.replace(/\/+$/, ""));
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
