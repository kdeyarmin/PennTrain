// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

// Public, unauthenticated status-check endpoint by design (see verify_jwt:false in
// supabase/config.toml) -- the signup page and a pre-auth maintenance banner need to know
// whether signups are open and whether the platform is in maintenance mode before there is any
// caller session to check. It reads public.platform_settings via the service-role client (that
// table is platform_admin-only at the RLS layer -- see 20260706043635_create_platform_settings.sql)
// but only ever surfaces the two curated fields below; it must never echo back the full table or
// any other settings key, since anyone can call this without a JWT.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  // Accept both GET and POST -- supabase-js's functions.invoke() defaults to POST with no body,
  // and this endpoint takes no input either way, so there's no meaningful REST distinction here.
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  // Defensive fallbacks only -- these two rows are seeded by the platform_settings migration and
  // should always be present, but this endpoint must never throw just because a row is missing.
  let maintenanceMode = false;
  let signupEnabled = true;

  const { data: rows } = await adminClient
    .from("platform_settings")
    .select("key, value")
    .in("key", ["maintenance_mode", "signup_enabled"]);

  for (const row of rows ?? []) {
    if (row.key === "maintenance_mode") maintenanceMode = Boolean(row.value);
    if (row.key === "signup_enabled") signupEnabled = Boolean(row.value);
  }

  return json({ maintenanceMode, signupEnabled });
});
