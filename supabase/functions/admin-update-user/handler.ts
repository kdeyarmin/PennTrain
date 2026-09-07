import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";
import { isDemoOrganization } from "../_shared/demoTenant.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const VALID_ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];

/**
 * SQLSTATEs this codebase raises deliberately, whose message is written for a person.
 *
 * BACKLOG.md I23: every failure path below returned the raw error text straight to the browser --
 * Postgres internals, Auth internals, constraint names, and in one case both the old and new login
 * email addresses in a single string that a toast then displayed and client error reporting then
 * captured. Blanket-replacing all of them would have been worse than the leak, because the useful
 * ones are our own raises ("org_admin cannot grant platform_admin"), and losing those leaves an
 * administrator with "something went wrong" and no idea what.
 *
 * So the line is drawn where the codebase already draws it: a SQLSTATE we chose carries a message
 * we wrote, and passes through. Anything else is an internal detail the caller cannot act on, and
 * is logged with a correlation id instead.
 */
const DELIBERATE_SQLSTATES = new Set([
  "P0001", // raise_exception -- our own `raise exception ... ` with no explicit errcode
  "42501", // insufficient_privilege -- an authorization refusal we wrote
  "22023", // invalid_parameter_value
  "02000", // no_data_found -- admin_update_profile's "profile % not found"
  "23505", // unique_violation -- an email already in use, which the admin can fix
]);

/**
 * What to show the caller, and what to log. Returns the public message; the raw detail goes to the
 * function log under `correlationId`, which is also returned so a support request can name it.
 */
function publicError(
  context: string,
  correlationId: string,
  raw: { message?: string; code?: string } | null | undefined,
  fallback: string,
): string {
  const message = raw?.message ?? "unknown error";
  console.error(`admin-update-user: ${context}`, { correlationId, code: raw?.code, message });
  if (raw?.code && DELIBERATE_SQLSTATES.has(raw.code)) return message;
  return `${fallback} (reference ${correlationId})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientFactory = (url: string, key: string, options?: Record<string, unknown>) => any;

export interface AdminUpdateUserDependencies {
  createClient: ClientFactory;
  getEnv?: (name: string) => string | undefined;
}

export function createAdminUpdateUserHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
}: AdminUpdateUserDependencies) {
  return async (req: Request): Promise<Response> => {
    const correlationId = crypto.randomUUID();
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
      action?: string;
      reason?: string;
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
      return json(req, { error: "Invalid JSON body" }, 400);
    }

    const { action, reason, user_id, role, organization_id, is_active, email, first_name, last_name, password } = body;
    if (!user_id) return json(req, { error: "user_id is required" }, 400);
    if (action !== undefined && action !== "reset_mfa") {
      return json(req, { error: "action, when given, must be reset_mfa" }, 400);
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return json(req, { error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
    }
    if (password !== undefined && password.length < 8) {
      return json(req, { error: "password must be at least 8 characters" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, role, organization_id")
      .eq("id", user_id)
      .single();
    if (targetError || !targetProfile) return json(req, { error: "target user not found" }, 404);

    const callerRole = callerProfile.role as string;
    const callerOrgId = callerProfile.organization_id as string | null;

    try {
      if (await isDemoOrganization(callerClient, callerOrgId)) {
        return json(req, { error: "Demo workspaces cannot modify user identities" }, 403);
      }
    } catch (error) {
      console.error("admin-update-user: demo workspace check failed", error instanceof Error ? error.message : error);
      return json(req, { error: "Unable to verify demo workspace" }, 500);
    }

    // Only platform_admin and org_admin may call this function at all -- identity-level changes
    // (role/org/active/email) are too sensitive for facility_manager, unlike create-user's narrower
    // trainer/employee creation allowance.
    if (callerRole === "platform_admin") {
      // no additional restriction
    } else if (callerRole === "org_admin") {
      if (targetProfile.organization_id !== callerOrgId) {
        return json(req, { error: "org_admin can only manage users within their own organization" }, 403);
      }
      if (targetProfile.role === "platform_admin" || role === "platform_admin") {
        return json(req, { error: "org_admin cannot manage or grant platform_admin" }, 403);
      }
      if (organization_id !== undefined && organization_id !== callerOrgId) {
        return json(req, { error: "org_admin cannot move a user to a different organization" }, 403);
      }
      if (user_id === callerUser.id && is_active === false) {
        return json(req, { error: "cannot deactivate your own account" }, 403);
      }
      // Credentials are not a tenant-administrable field, and this is the same refusal the
      // reset_mfa branch below already writes down: "an org_admin resetting a peer org_admin's
      // factor is a takeover of an equally-privileged account from inside the tenant". Setting
      // that peer's PASSWORD is the stronger version of the same move -- it does not merely
      // remove a factor, it hands over a working session, and every audit row written from it
      // names the victim as the actor. The login email is the same takeover one step removed: own
      // the address and the reset link arrives in your inbox.
      //
      // Nothing in the product sends either field (useProfiles.ts's useAdminUpdateUser posts
      // role / organization_id / is_active / email, and no screen sets email), so this closes a
      // path that only a hand-made request could reach. Changing your OWN login email stays
      // allowed; role, organization, activation and names are untouched.
      if (password !== undefined) {
        return json(req, {
          error: "only a platform administrator can set another user's password; send a password reset instead",
        }, 403);
      }
      if (email !== undefined && user_id !== callerUser.id) {
        return json(req, {
          error: "only a platform administrator can change another user's login email",
        }, 403);
      }
    } else {
      return json(req, { error: "not authorized to manage users" }, 403);
    }

    const assurance = await requireFreshAal2(callerClient, "identity_admin");
    if (!assurance.ok) return json(req, { error: assurance.error }, assurance.status);

    // Lost-device MFA recovery (BACKLOG.md I8).
    //
    // Nothing in the product could remove an enrolled factor. get_identity_control_plane READS
    // auth.mfa_factors to count administrators without one, and that was the whole of it; GoTrue
    // refuses self-unenrolment at AAL1, and MfaPolicyGate blocks every route but /account/security.
    // So a manager who lost their phone was locked out of the product entirely, and the only way
    // back was the Supabase dashboard -- which the people running a pilot facility do not have, and
    // should not. An earlier pass recorded "a second platform admin removes the factor" as the
    // recovery path; no such control existed.
    //
    // Platform admin only, deliberately. An org_admin resetting a peer org_admin's factor is a
    // takeover of an equally-privileged account from inside the tenant, with no second party -- the
    // exact move an attacker who phished ONE administrator would make next. The vendor operates the
    // pilot, so the second party is real.
    //
    // Resetting also revokes the target's sessions, through the same audited, checksummed
    // revoke_identity_sessions the console's own revocation uses -- called with the ADMIN's JWT, not
    // the service role, so require_identity_administrator runs against a real identity and the
    // evidence row names who did it. Leaving live sessions up would be the actual hazard here: if
    // the device is in someone else's hands, a still-valid session on it now needs no second factor
    // at all.
    if (action === "reset_mfa") {
      if (callerRole !== "platform_admin") {
        return json(req, { error: "only a platform administrator can reset multi-factor enrolment" }, 403);
      }
      // Not on yourself: the reset revokes the target's sessions, so aiming it at your own account
      // ends the request's own session mid-flight. Replacing your own device is an unenrol and
      // re-enrol on /account/security, which needs no administrative authority at all.
      if (user_id === callerUser.id) {
        return json(req, {
          error: "use account security to replace your own factor; this action is for recovering someone else's",
        }, 400);
      }
      const trimmedReason = (reason ?? "").trim();
      if (trimmedReason.length < 10) {
        return json(req, {
          error: "a reason of at least 10 characters is required (e.g. who reported the lost device, and how they were identified)",
        }, 400);
      }

      const { data: factorList, error: listError } = await adminClient.auth.admin.mfa.listFactors({
        userId: user_id,
      });
      if (listError) {
        return json(req, {
          error: publicError("listing factors failed", correlationId, listError,
            "Could not read this user's multi-factor enrolment"),
          correlationId,
        }, 400);
      }
      const factors = factorList?.factors ?? [];

      const removed: string[] = [];
      for (const factor of factors) {
        const { error: deleteError } = await adminClient.auth.admin.mfa.deleteFactor({
          id: factor.id,
          userId: user_id,
        });
        // Report the partial result rather than a bare failure: some factors may already be gone,
        // and an operator retrying needs to know the reset did not finish.
        if (deleteError) {
          return json(req, {
            error: publicError("factor removal failed part-way", correlationId, deleteError,
              `Removed ${removed.length} of ${factors.length} factor(s), then could not remove the rest`),
            correlationId,
          }, 500);
        }
        removed.push(factor.id);
      }

      const { error: revokeError } = await callerClient.rpc("revoke_identity_sessions", {
        p_profile_id: user_id,
        p_reason: `MFA reset: ${trimmedReason}`,
        p_source: "administrator",
        p_external_request_id: null,
        p_deactivate_profile: false,
      });
      if (revokeError) {
        return json(req, {
          error: publicError("session revocation failed after factor reset", correlationId, revokeError,
            "The factors were removed but this user's existing sessions could not be signed out"),
          correlationId,
        }, 500);
      }

      const { error: auditError } = await adminClient.from("audit_logs").insert({
        organization_id: targetProfile.organization_id,
        actor_profile_id: callerUser.id,
        entity_type: "identity",
        entity_id: user_id,
        action: "mfa_reset",
        reason: trimmedReason,
        new_values: { removed_factor_ids: removed, factor_count: removed.length },
      });
      // The factors are already gone; a missing audit row is a reportable failure, not a silent one.
      if (auditError) {
        return json(req, {
          error: publicError("audit entry failed after factor reset", correlationId, auditError,
            "Multi-factor enrolment was reset but the audit entry did not record"),
          correlationId,
        }, 500);
      }

      return json(req, {
        success: true,
        removed_factor_ids: removed,
        // The account is now single-factor. MfaPolicyGate will require re-enrolment on the target's
        // next sign-in wherever the organization's policy demands a factor.
        requires_reenrolment: removed.length > 0,
      });
    }

    // auth.users-level changes (email/password) via the Admin API. When changing the email,
    // capture the previous value first so a subsequent profile-RPC failure can be compensated --
    // otherwise Auth would hold the new login email while profiles kept the old one, splitting
    // the user's identity with no automatic repair path.
    let previousEmail: string | null = null;
    if (email !== undefined) {
      const { data: targetAuthUser, error: targetAuthError } = await adminClient.auth.admin.getUserById(user_id);
      if (targetAuthError || !targetAuthUser?.user) {
        return json(req, {
          error: publicError("target auth user lookup failed", correlationId, targetAuthError,
            "Could not read this user's login record"),
          correlationId,
        }, 400);
      }
      previousEmail = targetAuthUser.user.email ?? null;
    }
    if (email !== undefined || password !== undefined) {
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(user_id, {
        ...(email !== undefined ? { email, email_confirm: true } : {}),
        ...(password !== undefined ? { password } : {}),
      });
      if (authUpdateError) {
        return json(req, {
          error: publicError("auth update failed", correlationId, authUpdateError,
            "Could not update the login email or password"),
          correlationId,
        }, 400);
      }
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
    if (rpcError) {
      // Compensate the already-applied Auth email change so login email and profile email
      // stay consistent. (Passwords need no compensation: profiles never store them.)
      if (email !== undefined && previousEmail && previousEmail !== email) {
        const { error: revertError } = await adminClient.auth.admin.updateUserById(user_id, {
          email: previousEmail,
          email_confirm: true,
        });
        if (revertError) {
          // Both addresses used to be in this string, which a toast displayed and client error
          // reporting captured. The administrator is looking at the user's record and can read both
          // there; what they need from here is that the two are now out of step, and a reference.
          console.error("admin-update-user: login email revert failed, identity is split", {
            correlationId, userId: user_id, rpcCode: rpcError.code, revertCode: revertError.code,
          });
          return json(req, {
            error: "The profile update failed and the login email could not be put back, so the "
              + "login email and the profile email are now different. Set the email again to bring "
              + `them back into step. (reference ${correlationId})`,
            correlationId,
          }, 500);
        }
      }
      return json(req, {
        error: publicError("admin_update_profile failed", correlationId, rpcError,
          "Could not update this user's profile"),
        correlationId,
      }, 400);
    }

    return json(req, { success: true, profile: updatedProfile });
  };
}
