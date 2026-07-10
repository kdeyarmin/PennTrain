// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

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

  // Caller-scoped client: identifies who is actually calling and respects RLS.
  // Never used to perform the privileged create -- only to resolve the caller's own role/org.
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
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
    password?: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    organization_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body.password === "string" ? body.password : undefined;
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : undefined;
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;
  const organization_id = typeof body.organization_id === "string" ? body.organization_id.trim() : undefined;

  if (!email || !password || !first_name || !last_name || !role) {
    return json({ error: "email, password, first_name, last_name, and role are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address" }, 400);
  }
  if (first_name.length > 100 || last_name.length > 100) {
    return json({ error: "first_name and last_name must be 100 characters or fewer" }, 400);
  }
  if (!VALID_ROLES.includes(role)) {
    return json({ error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
  }
  if (password.length < 8) {
    return json({ error: "password must be at least 8 characters" }, 400);
  }

  const callerRole = callerProfile.role as string;
  const callerOrgId = callerProfile.organization_id as string | null;

  // Authorization matrix: who may create which role, in which org.
  if (callerRole === "platform_admin") {
    if (role !== "platform_admin" && !organization_id) {
      return json({ error: "organization_id is required for non-platform_admin users" }, 400);
    }
  } else if (callerRole === "org_admin") {
    if (role === "platform_admin") {
      return json({ error: "org_admin cannot create platform_admin users" }, 403);
    }
    if (organization_id && organization_id !== callerOrgId) {
      return json({ error: "org_admin can only create users within their own organization" }, 403);
    }
  } else if (callerRole === "facility_manager") {
    if (!["trainer", "employee"].includes(role)) {
      return json({ error: "facility_manager can only create trainer or employee users" }, 403);
    }
    if (organization_id && organization_id !== callerOrgId) {
      return json({ error: "facility_manager can only create users within their own organization" }, 403);
    }
  } else {
    return json({ error: "not authorized to create users" }, 403);
  }

  const effectiveOrgId = callerRole === "platform_admin" ? (organization_id ?? null) : callerOrgId;

  // Service-role admin client: the ONLY place the service-role key is used in this function.
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name,
      last_name,
    },
    // role/organization_id go in app_metadata, not user_metadata: app_metadata can only be set
    // via this service-role Admin API call, never by a client calling the public signup
    // endpoint, which is exactly why handle_new_user() trusts it for these two RLS-determining
    // fields and defaults to role="employee"/organization_id=null otherwise.
    app_metadata: {
      role,
      organization_id: effectiveOrgId,
    },
  });

  if (createError) return json({ error: createError.message }, 400);

  // handle_new_user() trigger already populated profiles from app_metadata on insert.
  return json({ success: true, user: { id: created.user.id, email: created.user.email } });
});
