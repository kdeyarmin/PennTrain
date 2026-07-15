import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

interface SubscriptionBody {
  subscription?: {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
  endpoint?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 40 || value.length > 4096) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (!["GET", "POST", "DELETE"].includes(req.method)) return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Push service is not configured" }, 500);
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return json({ error: "Invalid or expired session" }, 401);
  const { data: profile, error: profileError } = await caller.from("profiles")
    .select("id,organization_id,is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active || !profile.organization_id) return json({ error: "Active organization profile required" }, 403);

  if (req.method === "GET") {
    const publicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
    return publicKey ? json({ publicKey }) : json({ error: "Web push is not configured" }, 503);
  }
  let body: SubscriptionBody;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const admin = createClient(supabaseUrl, serviceKey);
  if (req.method === "DELETE") {
    if (!validEndpoint(body.endpoint)) return json({ error: "A valid HTTPS endpoint is required" }, 400);
    const { error } = await admin.from("push_subscriptions")
      .update({ disabled_at: new Date().toISOString() })
      .eq("profile_id", user.id).eq("endpoint_hash", await sha256(body.endpoint));
    return error ? json({ error: "Failed to disable push subscription" }, 500) : json({ disabled: true });
  }

  const subscription = body.subscription;
  if (!validEndpoint(subscription?.endpoint)
      || typeof subscription?.keys?.p256dh !== "string"
      || subscription.keys.p256dh.length < 20
      || typeof subscription.keys.auth !== "string"
      || subscription.keys.auth.length < 8) {
    return json({ error: "A valid browser PushSubscription is required" }, 400);
  }
  const expiration = typeof subscription.expirationTime === "number"
    ? new Date(subscription.expirationTime).toISOString() : null;
  const userAgent = req.headers.get("user-agent") || "unknown";
  const { error } = await admin.from("push_subscriptions").upsert({
    organization_id: profile.organization_id,
    profile_id: user.id,
    endpoint: subscription.endpoint,
    endpoint_hash: await sha256(subscription.endpoint),
    p256dh_key: subscription.keys.p256dh,
    auth_key: subscription.keys.auth,
    expiration_time: expiration,
    user_agent_sha256: await sha256(userAgent),
    disabled_at: null,
    last_used_at: new Date().toISOString(),
  }, { onConflict: "endpoint_hash" });
  return error ? json({ error: "Failed to save push subscription" }, 500) : json({ active: true }, 201);
});
