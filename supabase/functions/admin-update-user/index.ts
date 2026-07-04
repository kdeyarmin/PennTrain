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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    user_id?: string;
    role?: string;
    organization_id?: string;
    is_active?: boolean;
    email?: string;
    first_name?: string;
    last_name?: string;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { user_id, role, organization_id, is_active, email, first_name, last_name, password } = body;
  if (!user_id) return json({ error: "user_id is required" }, 400);
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return json({ error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
  }
  if (password !== undefined && password.length < 8) {
    return json({ error: "password must be at least 8 characters" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: targetProfile, error: targetError } = await adminClient
    .from("profiles")
    .select("id, role, organization_id")
    .eq("id", user_id)
    .single();
  if (targetError || !targetProfile) return json({ error: "target user not found" }, 404);

  const callerRole = callerProfile.role as string;
  const callerOrgId = callerProfile.organization_id as string | null;

  // Only platform_admin and org_admin may call this function at all -- identity-level changes
  // (role/org/active/email) are too sensitive for facility_manager, unlike create-user's narrower
  // trainer/employee creation allowance.
  if (callerRole === "platform_admin") {
    // no additional restriction
  } else if (callerRole === "org_admin") {
    if (targetProfile.organization_id !== callerOrgId) {
      return json({ error: "org_admin can only manage users within their own organization" }, 403);
    }
    if (targetProfile.role === "platform_admin" || role === "platform_admin") {
      return json({ error: "org_admin cannot manage or grant platform_admin" }, 403);
    }
    if (organization_id !== undefined && organization_id !== callerOrgId) {
      return json({ error: "org_admin cannot move a user to a different organization" }, 403);
    }
    if (user_id === callerUser.id && is_active === false) {
      return json({ error: "cannot deactivate your own account" }, 403);
    }
  } else {
    return json({ error: "not authorized to manage users" }, 403);
  }

  // auth.users-level changes (email/password) via the Admin API.
  if (email !== undefined || password !== undefined) {
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(user_id, {
      ...(email !== undefined ? { email, email_confirm: true } : {}),
      ...(password !== undefined ? { password } : {}),
    });
    if (authUpdateError) return json({ error: authUpdateError.message }, 400);
  }

  // profiles-level changes (role/organization_id/is_active/email sync/names) via the trusted RPC --
  // a direct .update() here would be silently reverted by protect_profile_privileged_fields() since
  // this service-role connection has no auth.uid().
  const { data: updatedProfile, error: rpcError } = await adminClient.rpc("admin_update_profile", {
    p_user_id: user_id,
    p_first_name: first_name ?? null,
    p_last_name: last_name ?? null,
    p_role: role ?? null,
    p_organization_id: organization_id ?? null,
    p_is_active: is_active ?? null,
    p_email: email ?? null,
  });
  if (rpcError) return json({ error: rpcError.message }, 400);

  return json({ success: true, profile: updatedProfile });
});
