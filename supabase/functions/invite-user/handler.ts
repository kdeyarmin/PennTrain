import { resolveAppRedirect } from "../_shared/appRedirect.ts";
import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";
import { isDemoOrganization } from "../_shared/demoTenant.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

type EnvReader = (name: string) => string | undefined;

const VALID_ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Falls back to this default when redirect_to is missing/invalid -- lands the invited user on the
// same reset-password flow the frontend normally requests.
const DEFAULT_APP_ORIGIN = "https://cmcarebase.com";
const DEFAULT_ALLOWED_APP_ORIGINS = new Set([
  "https://cmcarebase.com",
]);

function allowedRedirectOrigins(getEnv: EnvReader): Set<string> {
  const configured = (getEnv("SIGNUP_REDIRECT_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APP_ORIGINS, ...configured]);
}

function resolveRedirectTo(candidate: string | undefined, getEnv: EnvReader): string {
  const fallbackOrigin = (getEnv("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  const allowLocalhostRedirects = getEnv("ALLOW_LOCALHOST_SIGNUP_REDIRECTS") === "true";
  return resolveAppRedirect(
    candidate,
    `${fallbackOrigin}/reset-password`,
    allowedRedirectOrigins(getEnv),
    allowLocalhostRedirects,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientFactory = (url: string, key: string, options?: Record<string, unknown>) => any;

export interface InviteUserDependencies {
  createClient: ClientFactory;
  getEnv?: EnvReader;
}

export function createInviteUserHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
}: InviteUserDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return corsPreflightResponse(req);
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

    const supabaseUrl = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(req, { error: "Service is not configured" }, 503);
    }

    // Caller-scoped client: identifies who is actually calling and respects RLS. Never used to
    // perform the privileged invite -- only to resolve the caller's own role/org (same pattern as
    // create-user).
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
      return json(req, { error: "Invalid JSON body" }, 400);
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
    const first_name = typeof body.first_name === "string" ? body.first_name.trim() : undefined;
    const last_name = typeof body.last_name === "string" ? body.last_name.trim() : undefined;
    const role = typeof body.role === "string" ? body.role : undefined;
    const organization_id = typeof body.organization_id === "string" ? body.organization_id.trim() : undefined;
    const employee_id = typeof body.employee_id === "string" ? body.employee_id.trim() : undefined;
    const redirect_to = typeof body.redirect_to === "string" ? body.redirect_to.trim() : undefined;
    if (!email || !first_name || !last_name || !role) {
      return json(req, { error: "email, first_name, last_name, and role are required" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(req, { error: "Enter a valid email address" }, 400);
    }
    if (first_name.length > 100 || last_name.length > 100) {
      return json(req, { error: "first_name and last_name must be 100 characters or fewer" }, 400);
    }
    if (!VALID_ROLES.includes(role)) {
      return json(req, { error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
    }
    if (organization_id && !UUID_PATTERN.test(organization_id)) {
      return json(req, { error: "organization_id must be a valid UUID" }, 400);
    }
    if (employee_id && !UUID_PATTERN.test(employee_id)) {
      return json(req, { error: "employee_id must be a valid UUID" }, 400);
    }

    const callerRole = callerProfile.role as string;
    const callerOrgId = callerProfile.organization_id as string | null;

    try {
      if (await isDemoOrganization(callerClient, callerOrgId)) {
        return json(req, { error: "Demo workspaces cannot invite or provision users" }, 403);
      }
    } catch (error) {
      console.error("invite-user: demo workspace check failed", error instanceof Error ? error.message : error);
      return json(req, { error: "Unable to verify demo workspace" }, 500);
    }

    // Same authorization matrix as create-user, minus the password/org-required distinction --
    // an invite always targets the caller's own organization (or platform_admin's chosen one).
    if (callerRole === "platform_admin") {
      if (role !== "platform_admin" && !organization_id) {
        return json(req, { error: "organization_id is required for non-platform_admin users" }, 400);
      }
    } else if (callerRole === "org_admin") {
      if (role === "platform_admin") {
        return json(req, { error: "org_admin cannot invite platform_admin users" }, 403);
      }
      if (organization_id && organization_id !== callerOrgId) {
        return json(req, { error: "org_admin can only invite users within their own organization" }, 403);
      }
    } else if (callerRole === "facility_manager") {
      if (!["trainer", "employee"].includes(role)) {
        return json(req, { error: "facility_manager can only invite trainer or employee users" }, 403);
      }
      if (organization_id && organization_id !== callerOrgId) {
        return json(req, { error: "facility_manager can only invite users within their own organization" }, 403);
      }
    } else {
      return json(req, { error: "not authorized to invite users" }, 403);
    }

    const effectiveOrgId = callerRole === "platform_admin" ? (organization_id ?? null) : callerOrgId;

    const assurance = await requireFreshAal2(callerClient, "identity_admin");
    if (!assurance.ok) return json(req, { error: assurance.error }, assurance.status);

    // Employee self-service depends on employees.profile_id. Inviting an employee without linking
    // that row produces a valid login that can only show "No employee profile is linked" across
    // the portal. Resolve and authorize the employee before sending any email. RLS on callerClient
    // also ensures a facility_manager can only target an employee in one of their assigned
    // facilities.
    let employeeToLink: { id: string; profile_id: string | null; email: string | null } | null = null;
    if (role === "employee") {
      if (!effectiveOrgId) {
        return json(req, { error: "organization_id is required for employee users" }, 400);
      }

      let employeeQuery = callerClient
        .from("employees")
        .select("id, profile_id, email")
        .eq("organization_id", effectiveOrgId);
      // ilike here means "case-insensitive equality", not a pattern match -- but '%' and '_' are LIKE
      // metacharacters, so an unescaped term matched more than the address asked for. The exact
      // re-check below already refuses a mismatched row, so this was never a way to invite someone
      // else; the reachable symptom was a legitimate address containing '_' (first_last@example.com
      // is ordinary) also matching first-any-char-last@example.com and failing the whole invite with
      // the "Multiple employee records use this email" 409. Escaping restores plain equality.
      const emailPattern = email.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      employeeQuery = employee_id
        ? employeeQuery.eq("id", employee_id)
        : employeeQuery.ilike("email", emailPattern).limit(2);

      const { data: employeeMatches, error: employeeLookupError } = await employeeQuery;
      if (employeeLookupError) {
        return json(req, { error: "Unable to verify the employee record" }, 500);
      }
      if (!employeeMatches?.length) {
        return json(req, {
          error: employee_id
            ? "Employee not found or you do not manage their facility"
            : "Create an employee record with this email before sending a portal invite",
        }, 400);
      }
      if (employeeMatches.length > 1) {
        return json(req, { error: "Multiple employee records use this email; invite from the intended employee record" }, 409);
      }

      // Checked through a const rather than the outer `let`: the provisioning closure below
      // captures employeeToLink, and a captured `let` loses its narrowing.
      const matchedEmployee = employeeMatches[0];
      if (matchedEmployee.profile_id) {
        return json(req, { error: "This employee already has portal access" }, 409);
      }
      if ((matchedEmployee.email ?? "").trim().toLowerCase() !== email) {
        return json(req, { error: "The invite email must match the employee record email" }, 400);
      }
      employeeToLink = matchedEmployee;
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    let redirectTo: string;
    try {
      redirectTo = resolveRedirectTo(redirect_to, getEnv);
    } catch (error) {
      return json(req, { error: error instanceof Error ? error.message : "Invalid invite redirect URL" }, 400);
    }

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name },
      redirectTo,
    });
    if (inviteError) return json(req, { error: inviteError.message }, 400);

    // handle_new_user() already inserted a profiles row from the invite's auth.users INSERT, but it
    // only ever defaults to role="employee"/organization_id=null there -- an invite has no
    // app_metadata to read yet at insert time. Employee provisioning uses one trusted database
    // transaction to set role/org and link employees.profile_id; all other roles use the existing
    // trusted profile RPC. Direct service-role table updates are intentionally not granted.
    //
    // p_is_active is the re-invite half of that. revoke_user_invitation sets
    // profiles.is_active = false, and record_user_invitation_sent now reopens the ledger row on a
    // re-invite -- but GoTrue re-invites an UNCONFIRMED address by reusing the SAME auth user, so
    // no auth.users INSERT happens, handle_new_user never runs again, and nothing on this path
    // turned is_active back on. The invitee opened the new link, set a password, and was told
    // "Your account has been deactivated." Provisioning an invite means the account is being
    // stood up, so it says so; on a first invite the profile is already active and this is a
    // no-op.
    //
    // provision_invited_employee_profile takes (uuid, uuid, uuid) and has no p_is_active to pass
    // -- the admin_update_profile call inside it omits it too -- so the employee path reactivates
    // through the same trusted RPC in its own call, placed BEFORE provisioning so the
    // compensating delete below still covers a failure here.
    const provisionInvitedProfile = async () => {
      if (!employeeToLink) {
        return await adminClient.rpc("admin_update_profile", {
          p_user_id: invited.user.id,
          p_role: role,
          p_organization_id: effectiveOrgId,
          p_is_active: true,
        });
      }
      const reactivated = await adminClient.rpc("admin_update_profile", {
        p_user_id: invited.user.id,
        p_is_active: true,
      });
      if (reactivated.error) return reactivated;
      return await adminClient.rpc("provision_invited_employee_profile", {
        p_user_id: invited.user.id,
        p_employee_id: employeeToLink.id,
        p_organization_id: effectiveOrgId,
      });
    };
    const { data: updatedProfile, error: rpcError } = await provisionInvitedProfile();
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
        return json(req, { error: "Invite provisioning failed and requires administrator review" }, 500);
      }
      return json(req, { error: "Invite provisioning failed; no account was created" }, 500);
    }

    // A successful auth invite is not operationally complete until it has a durable lifecycle receipt.
    // Make this part of the same compensating transaction boundary: an untracked pending identity is
    // deleted so the manager can retry cleanly instead of being left with an email that now appears
    // "already registered" but has no invitation status in CareBase.
    const { data: invitationId, error: invitationError } = await adminClient.rpc("record_user_invitation_sent", {
      p_invited_user_id: invited.user.id,
      p_email: email,
      p_first_name: first_name,
      p_last_name: last_name,
      p_invited_role: role,
      p_organization_id: effectiveOrgId,
      p_employee_id: employeeToLink?.id ?? null,
      p_redirect_to: redirectTo,
      p_created_by: callerUser.id,
    });
    if (invitationError) {
      console.error("invite-user lifecycle receipt failed", {
        user_id: invited.user.id,
        lifecycle_error: invitationError.message,
      });
      // On an employee invite, provisioning already linked employees.profile_id to the new
      // profile, and that FK (ON DELETE NO ACTION) blocks the auth-user delete below -- the
      // compensating cleanup then failed and the "retry cleanly" promise broke with an
      // account stuck half-provisioned. Detach the link first so the delete can succeed.
      if (employeeToLink?.id) {
        const { error: detachError } = await adminClient
          .from("employees")
          .update({ profile_id: null })
          .eq("id", employeeToLink.id)
          .eq("profile_id", invited.user.id);
        if (detachError) {
          console.error("invite-user lifecycle cleanup could not detach employee link", {
            user_id: invited.user.id,
            employee_id: employeeToLink.id,
            detach_error: detachError.message,
          });
        }
      }
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invited.user.id);
      if (cleanupError) {
        console.error("invite-user lifecycle cleanup failed", {
          user_id: invited.user.id,
          lifecycle_error: invitationError.message,
          cleanup_error: cleanupError.message,
        });
        return json(req, { error: "Invitation was sent but its lifecycle receipt requires administrator review" }, 500);
      }
      return json(req, { error: "Invitation could not be recorded; no account was kept" }, 500);
    }

    return json(req, {
      success: true,
      user: { id: invited.user.id, email: invited.user.email },
      profile: updatedProfile,
      employee_id: employeeToLink?.id ?? null,
      invitation_id: invitationId,
    });
  };
}
