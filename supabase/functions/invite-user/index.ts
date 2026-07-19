import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { resolveAppRedirect } from "../_shared/appRedirect.ts";
import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";
import { isDemoOrganization } from "../_shared/demoTenant.ts";

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Falls back to this default when redirect_to is missing/invalid -- lands the invited user on the
// same reset-password flow the frontend normally requests.
const DEFAULT_APP_ORIGIN = "https://cmcarebase.com";
const DEFAULT_ALLOWED_APP_ORIGINS = new Set([
  "https://cmcarebase.com",
]);

function allowedRedirectOrigins(): Set<string> {
  const configured = (Deno.env.get("SIGNUP_REDIRECT_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APP_ORIGINS, ...configured]);
}

function resolveRedirectTo(candidate: string | undefined): string {
  const fallbackOrigin = (Deno.env.get("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  const allowLocalhostRedirects = Deno.env.get("ALLOW_LOCALHOST_SIGNUP_REDIRECTS") === "true";
  return resolveAppRedirect(
    candidate,
    `${fallbackOrigin}/reset-password`,
    allowedRedirectOrigins(),
    allowLocalhostRedirects,
  );
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
    first_name?: string;
    last_name?: string;
    role?: string;
    organization_id?: string;
    employee_id?: string;
    redirect_to?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : undefined;
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;
  const organization_id = typeof body.organization_id === "string" ? body.organization_id.trim() : undefined;
  const employee_id = typeof body.employee_id === "string" ? body.employee_id.trim() : undefined;
  const redirect_to = typeof body.redirect_to === "string" ? body.redirect_to.trim() : undefined;
  if (!email || !first_name || !last_name || !role) {
    return json({ error: "email, first_name, last_name, and role are required" }, 400);
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
  if (organization_id && !UUID_PATTERN.test(organization_id)) {
    return json({ error: "organization_id must be a valid UUID" }, 400);
  }
  if (employee_id && !UUID_PATTERN.test(employee_id)) {
    return json({ error: "employee_id must be a valid UUID" }, 400);
  }

  const callerRole = callerProfile.role as string;
  const callerOrgId = callerProfile.organization_id as string | null;

  try {
    if (await isDemoOrganization(callerClient, callerOrgId)) {
      return json({ error: "Demo workspaces cannot invite or provision users" }, 403);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to verify demo workspace" }, 500);
  }

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

  const assurance = await requireFreshAal2(callerClient, "identity_admin");
  if (!assurance.ok) return json({ error: assurance.error }, assurance.status);

  // Employee self-service depends on employees.profile_id. Inviting an employee without linking
  // that row produces a valid login that can only show "No employee profile is linked" across
  // the portal. Resolve and authorize the employee before sending any email. RLS on callerClient
  // also ensures a facility_manager can only target an employee in one of their assigned
  // facilities.
  let employeeToLink: { id: string; profile_id: string | null; email: string | null } | null = null;
  if (role === "employee") {
    if (!effectiveOrgId) {
      return json({ error: "organization_id is required for employee users" }, 400);
    }

    let employeeQuery = callerClient
      .from("employees")
      .select("id, profile_id, email")
      .eq("organization_id", effectiveOrgId);
    employeeQuery = employee_id
      ? employeeQuery.eq("id", employee_id)
      : employeeQuery.ilike("email", email).limit(2);

    const { data: employeeMatches, error: employeeLookupError } = await employeeQuery;
    if (employeeLookupError) {
      return json({ error: "Unable to verify the employee record" }, 500);
    }
    if (!employeeMatches?.length) {
      return json({
        error: employee_id
          ? "Employee not found or you do not manage their facility"
          : "Create an employee record with this email before sending a portal invite",
      }, 400);
    }
    if (employeeMatches.length > 1) {
      return json({ error: "Multiple employee records use this email; invite from the intended employee record" }, 409);
    }

    employeeToLink = employeeMatches[0];
    if (employeeToLink.profile_id) {
      return json({ error: "This employee already has portal access" }, 409);
    }
    if ((employeeToLink.email ?? "").trim().toLowerCase() !== email) {
      return json({ error: "The invite email must match the employee record email" }, 400);
    }
  }

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  let redirectTo: string;
  try {
    redirectTo = resolveRedirectTo(redirect_to);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid invite redirect URL" }, 400);
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { first_name, last_name },
    redirectTo,
  });
  if (inviteError) return json({ error: inviteError.message }, 400);

  // handle_new_user() already inserted a profiles row from the invite's auth.users INSERT, but it
  // only ever defaults to role="employee"/organization_id=null there -- an invite has no
  // app_metadata to read yet at insert time. Employee provisioning uses one trusted database
  // transaction to set role/org and link employees.profile_id; all other roles use the existing
  // trusted profile RPC. Direct service-role table updates are intentionally not granted.
  const profileRpc = employeeToLink
    ? adminClient.rpc("provision_invited_employee_profile", {
        p_user_id: invited.user.id,
        p_employee_id: employeeToLink.id,
        p_organization_id: effectiveOrgId,
      })
    : adminClient.rpc("admin_update_profile", {
        p_user_id: invited.user.id,
        p_role: role,
        p_organization_id: effectiveOrgId,
      });
  const { data: updatedProfile, error: rpcError } = await profileRpc;
  if (rpcError) {
    // Log the RPC error before attempting cleanup so it is always captured, even when cleanup
    // succeeds and the outer branch would otherwise return without any trace of what went wrong.
    console.error("invite-user provisioning rpc failed", {
      user_id: invited.user.id,
      rpc_error: rpcError.message,
    });
    // The invite creates auth.users (and therefore a default employee profile) before this RPC
    // applies the intended tenant and role. Compensate on failure so a retry cannot leave behind
    // a usable, mis-provisioned account or fail because the email already exists.
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invited.user.id);
    if (cleanupError) {
      console.error("invite-user cleanup failed", {
        user_id: invited.user.id,
        rpc_error: rpcError.message,
        cleanup_error: cleanupError.message,
      });
      return json({ error: "Invite provisioning failed and requires administrator review" }, 500);
    }
    return json({ error: "Invite provisioning failed; no account was created" }, 500);
  }

  return json({
    success: true,
    user: { id: invited.user.id, email: invited.user.email },
    profile: updatedProfile,
    employee_id: employeeToLink?.id ?? null,
  });
});
