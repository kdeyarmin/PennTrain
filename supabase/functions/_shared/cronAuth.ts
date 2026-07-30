export const CRON_SECRET_HEADER = "x-caremetric-cron-secret";

/**
 * Enrich Allow-Headers with the cron secret header for server-to-server callers.
 * Strips Access-Control-Allow-Origin if present — cron/webhook endpoints are not
 * browser-invoked and must not advertise wildcard (or any) CORS origin.
 */
export function withCronCorsHeader(headers: Record<string, string>): Record<string, string> {
  const { ["Access-Control-Allow-Origin"]: _omitOrigin, ...rest } = headers;
  const existing = rest["Access-Control-Allow-Headers"] ?? "";
  const parts = new Set(
    existing
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  parts.add(CRON_SECRET_HEADER);
  return { ...rest, "Access-Control-Allow-Headers": Array.from(parts).join(", ") };
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let i = 0; i < length; i++) {
    diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }

  return diff === 0;
}

export function requireCronRequest(
  req: Request,
  corsHeaders: Record<string, string>,
  configuredSecret?: string,
): Response | null {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const expectedSecret = configuredSecret ?? Deno.env.get("CRON_SHARED_SECRET");
  if (!expectedSecret) {
    console.error("CRON_SHARED_SECRET is not configured");
    return new Response(JSON.stringify({ error: "Cron secret is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const actualSecret = req.headers.get(CRON_SECRET_HEADER) ?? "";
  if (!actualSecret || !constantTimeEqual(actualSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return null;
}
