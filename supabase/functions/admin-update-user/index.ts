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

const VALID_ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];

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
    if (listError) return json(req, { error: listError.message }, 400);
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
          error: `removed ${removed.length} of ${factors.length} factor(s), then failed on ${factor.id}: ${deleteError.message}`,
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
        error: `factors were removed but the target's sessions could not be revoked: ${revokeError.message}`,
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
        error: `multi-factor enrolment was reset but the audit entry failed to record: ${auditError.message}`,
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
      return json(req, { error: targetAuthError?.message ?? "target auth user not found" }, 400);
    }
    previousEmail = targetAuthUser.user.email ?? null;
  }
  if (email !== undefined || password !== undefined) {
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(user_id, {
      ...(email !== undefined ? { email, email_confirm: true } : {}),
      ...(password !== undefined ? { password } : {}),
    });
    if (authUpdateError) return json(req, { error: authUpdateError.message }, 400);
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
        return json(req, {
          error: `${rpcError.message} (additionally, reverting the login email failed: ${revertError.message} -- the login email is now ${email} while the profile still shows ${previousEmail})`,
        }, 500);
      }
    }
    return json(req, { error: rpcError.message }, 400);
  }

  return json(req, { success: true, profile: updatedProfile });
});
