import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated signup endpoint by design (see verify_jwt:false in
// supabase/config.toml) -- this is the self-service "create my organization" entry point for a
// facility admin, so there is no caller session to check first. It always creates a brand-new
// organization and grants org_admin on it; it never lets a caller attach to an existing
// organization or request a different role, which is what keeps it safe to leave public. role/
// organization_id are set via app_metadata on auth.admin.createUser -- the same trust boundary
// create-user uses -- never from client-controlled fields, so this can't be used to spoof a role
// or organization the way the pre-fix handle_new_user() trigger once allowed (see
// 20260704180244_fix_handle_new_user_trust_boundary.sql).

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "org"
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
    organization_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { email, password, first_name, last_name, organization_name } = body;
  if (!email || !password || !first_name || !last_name || !organization_name) {
    return json({ error: "email, password, first_name, last_name, and organization_name are required" }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address" }, 400);
  if (password.length < 8) return json({ error: "password must be at least 8 characters" }, 400);
  if (organization_name.trim().length < 2) return json({ error: "organization_name is too short" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: signupSetting } = await adminClient
    .from("platform_settings")
    .select("value")
    .eq("key", "signup_enabled")
    .maybeSingle();
  const signupEnabled = signupSetting?.value !== false;
  if (!signupEnabled) {
    return json({ error: "Self-service signup is currently disabled. Please contact us directly." }, 403);
  }

  const { data: trialDaysSetting } = await adminClient
    .from("platform_settings")
    .select("value")
    .eq("key", "default_trial_days")
    .maybeSingle();
  const trialDays = typeof trialDaysSetting?.value === "number" ? trialDaysSetting.value : 14;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  const baseSlug = slugify(organization_name);
  let organization: { id: string; name: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await adminClient
      .from("organizations")
      .insert({ name: organization_name.trim(), slug, trial_ends_at: trialEndsAt })
      .select("id, name")
      .single();
    if (!error) {
      organization = data;
      break;
    }
    if (error.code !== "23505") return json({ error: error.message }, 400); // not a slug collision -- give up
  }
  if (!organization) return json({ error: "Could not allocate a unique organization slug -- try again" }, 500);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name, last_name },
    app_metadata: { role: "org_admin", organization_id: organization.id },
  });

  if (createError) {
    // Don't strand an organization with no admin if account creation failed (e.g. email taken).
    await adminClient.from("organizations").delete().eq("id", organization.id);
    return json({ error: createError.message }, 400);
  }

  return json({
    success: true,
    user: { id: created.user.id, email: created.user.email },
    organization: { id: organization.id, name: organization.name },
  });
});
