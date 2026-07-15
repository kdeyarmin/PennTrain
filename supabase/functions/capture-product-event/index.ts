import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const EVENTS = new Set(["route_viewed","course_assigned","course_started","course_completed","report_exported","mock_inspection_started","mock_inspection_completed","payroll_exported","benchmark_viewed","regulatory_draft_reviewed","push_permission_changed"]);
const PROPERTY_KEYS = new Set(["source","surface","variant","result","count","durationBucket","deviceClass","offline","entryPoint"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function normalizeRoute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, "https://telemetry.invalid");
    const parts = url.pathname.split("/").map((part) =>
      /^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) ? ":id" : part.toLowerCase().replace(/[^-a-z0-9_]/g, ""));
    const route = parts.join("/").replace(/\/{2,}/g, "/");
    return route.startsWith("/") && route.length <= 160 ? route : null;
  } catch { return null; }
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Telemetry is not configured" }, 500);
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return json({ error: "Invalid or expired session" }, 401);
  const { data: profile } = await caller.from("profiles").select("organization_id,role,is_active").eq("id", user.id).single();
  if (!profile?.is_active) return json({ error: "Active profile required" }, 403);
  let body: { eventName?: unknown; route?: unknown; properties?: unknown; sessionId?: unknown; occurredAt?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (typeof body.eventName !== "string" || !EVENTS.has(body.eventName)) return json({ error: "Event is not allowlisted" }, 400);
  const route = normalizeRoute(body.route);
  const rawProperties = body.properties && typeof body.properties === "object" && !Array.isArray(body.properties)
    ? body.properties as Record<string, unknown> : {};
  const properties: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (!PROPERTY_KEYS.has(key)) return json({ error: `Property is not allowlisted: ${key}` }, 400);
    if (typeof value === "string") properties[key] = value.slice(0, 80);
    else if (typeof value === "number" && Number.isFinite(value)) properties[key] = value;
    else if (typeof value === "boolean") properties[key] = value;
    else return json({ error: `Property must be a scalar: ${key}` }, 400);
  }
  const occurredAt = typeof body.occurredAt === "string" && Math.abs(Date.now() - Date.parse(body.occurredAt)) <= 86_400_000
    ? new Date(body.occurredAt).toISOString() : new Date().toISOString();
  const sessionHash = typeof body.sessionId === "string" && body.sessionId.length <= 200
    ? await sha256(`${user.id}:${body.sessionId}`) : null;
  const admin = createClient(url, service);
  const { error } = await admin.from("product_events").insert({
    organization_id: profile.organization_id,
    actor_profile_id: user.id,
    actor_role: profile.role,
    event_name: body.eventName,
    route_template: route,
    properties,
    session_hash: sessionHash,
    occurred_at: occurredAt,
  });
  return error ? json({ error: "Event could not be recorded" }, 500) : new Response(null, { status: 204, headers: CORS });
});
