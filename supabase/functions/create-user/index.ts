import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";
import { isDemoOrganization } from "../_shared/demoTenant.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const VALID_ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(req, { error: "Service is not configured" }, 503);
  }

  // Caller-scoped client: identifies who is actually calling and respects RLS.
  // Never used to perform the privileged create -- only to resolve the caller's own role/org.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json(req, { error: "Caller profile not found or inactive" }, 403);
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
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body.password === "string" ? body.password : undefined;
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : undefined;
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;
  const organization_id = typeof body.organization_id === "string" ? body.organization_id.trim() : undefined;

  if (!email || !password || !first_name || !last_name || !role) {
    return json(req, { error: "email, password, first_name, last_name, and role are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(req, { error: "Enter a valid email address" }, 400);
  }
  if (first_name.length > 100 || last_name.length > 100) {
    return json(req, { error: "first_name and last_name must be 100 characters or fewer" }, 400);
  }
  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    return json(req, { error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
  }
  if (password.length < 8) {
    return json(req, { error: "password must be at least 8 characters" }, 400);
  }

  const callerRole = callerProfile.role as string;
  const callerOrgId = callerProfile.organization_id as string | null;

  try {
    if (await isDemoOrganization(callerClient, callerOrgId)) {
      return json(req, { error: "Demo workspaces cannot invite or provision users" }, 403);
    }
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Unable to verify demo workspace" }, 500);
  }

  // Authorization matrix: who may create which role, in which org.
  if (callerRole === "platform_admin") {
    if (role !== "platform_admin" && !organization_id) {
      return json(req, { error: "organization_id is required for non-platform_admin users" }, 400);
    }
  } else if (callerRole === "org_admin") {
    if (role === "platform_admin") {
      return json(req, { error: "org_admin cannot create platform_admin users" }, 403);
    }
    if (organization_id && organization_id !== callerOrgId) {
      return json(req, { error: "org_admin can only create users within their own organization" }, 403);
    }
  } else if (callerRole === "facility_manager") {
    if (!["trainer", "employee"].includes(role)) {
      return json(req, { error: "facility_manager can only create trainer or employee users" }, 403);
    }
    if (organization_id && organization_id !== callerOrgId) {
      return json(req, { error: "facility_manager can only create users within their own organization" }, 403);
    }
  } else {
    return json(req, { error: "not authorized to create users" }, 403);
  }

  const effectiveOrgId = callerRole === "platform_admin" ? (organization_id ?? null) : callerOrgId;

  // Every account created here is immediately confirmed and can receive privileged
  // app metadata, so require step-up directly before the irreversible Admin API call.
  const assurance = await requireFreshAal2(callerClient, "identity_admin");
  if (!assurance.ok) return json(req, { error: assurance.error }, assurance.status);

  // Service-role admin client: the ONLY place the service-role key is used in this function.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

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
      role: role as ValidRole,
      organization_id: effectiveOrgId,
    },
  });

  if (createError) return json(req, { error: createError.message }, 400);

  // handle_new_user() trigger already populated profiles from app_metadata on insert.
  return json(req, { success: true, user: { id: created.user.id, email: created.user.email } });
});
