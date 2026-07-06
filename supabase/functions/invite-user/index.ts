import { createClient } from "jsr:@supabase/supabase-js@2";

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

const VALID_ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];

// Falls back to this default when redirect_to is missing/invalid -- lands the invited user on the
// same reset-password flow the frontend normally requests.
const DEFAULT_APP_ORIGIN = "https://caremetrictrain.com";
// Known app origins (see DEPLOYMENT.md's Supabase Auth redirect URL config) -- the caller-supplied
// redirect_to is only honored if it matches one of these, so this endpoint can't be used to embed
// an attacker-controlled domain in the invite email GoTrue sends.
const ALLOWED_APP_ORIGINS = new Set([
  "https://caremetrictrain.com",
  "https://penntrain-production.up.railway.app",
]);

function resolveRedirectTo(candidate: string | undefined): string {
  if (candidate) {
    try {
      if (ALLOWED_APP_ORIGINS.has(new URL(candidate).origin)) return candidate;
    } catch {
      // fall through to default
    }
  }
  return `${DEFAULT_APP_ORIGIN}/reset-password`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller-scoped client: identifies who is actually calling and respects RLS. Never used to
  // perform the privileged invite -- only to resolve the caller's own role/org (same pattern as
  // create-user).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }

  let body: {
    email?: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    organization_id?: string;
    redirect_to?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { email, first_name, last_name, role, organization_id, redirect_to } = body;
  if (!email || !first_name || !last_name || !role) {
    return json({ error: "email, first_name, last_name, and role are required" }, 400);
  }
  if (!VALID_ROLES.includes(role)) {
    return json({ error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
  }

  const callerRole = callerProfile.role as string;
  const callerOrgId = callerProfile.organization_id as string | null;

  // Same authorization matrix as create-user, minus the password/org-required distinction --
  // an invite always targets the caller's own organization (or platform_admin's chosen one).
  if (callerRole === "platform_admin") {
    if (role !== "platform_admin" && !organization_id) {
      return json({ error: "organization_id is required for non-platform_admin users" }, 400);
    }
  } else if (callerRole === "org_admin") {
    if (role === "platform_admin") {
      return json({ error: "org_admin cannot invite platform_admin users" }, 403);
    }
    if (organization_id && organization_id !== callerOrgId) {
      return json({ error: "org_admin can only invite users within their own organization" }, 403);
    }
  } else if (callerRole === "facility_manager") {
    if (!["trainer", "employee"].includes(role)) {
      return json({ error: "facility_manager can only invite trainer or employee users" }, 403);
    }
    if (organization_id && organization_id !== callerOrgId) {
      return json({ error: "facility_manager can only invite users within their own organization" }, 403);
    }
  } else {
    return json({ error: "not authorized to invite users" }, 403);
  }

  const effectiveOrgId = callerRole === "platform_admin" ? (organization_id ?? null) : callerOrgId;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { first_name, last_name },
    redirectTo: resolveRedirectTo(redirect_to),
  });
  if (inviteError) return json({ error: inviteError.message }, 400);

  // handle_new_user() already inserted a profiles row from the invite's auth.users INSERT, but it
  // only ever defaults to role="employee"/organization_id=null there -- an invite has no
  // app_metadata to read yet at insert time. admin_update_profile() is the trusted RPC (same one
  // admin-update-user uses) that applies the real role/organization_id: a direct service-role
  // .update() would be silently reverted by protect_profile_privileged_fields() since this
  // connection has no auth.uid().
  const { data: updatedProfile, error: rpcError } = await adminClient.rpc("admin_update_profile", {
    p_user_id: invited.user.id,
    p_role: role,
    p_organization_id: effectiveOrgId,
  });
  if (rpcError) return json({ error: rpcError.message }, 400);

  return json({
    success: true,
    user: { id: invited.user.id, email: invited.user.email },
    profile: updatedProfile,
  });
});
