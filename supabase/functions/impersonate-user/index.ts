// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";

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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  if (callerProfile.role !== "platform_admin") {
    return json({ error: "not authorized to impersonate users" }, 403);
  }

  let body: {
    action?: string;
    target_user_id?: string;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, target_user_id, reason } = body;

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  if (action === "start") {
    if (!target_user_id) return json({ error: "target_user_id is required" }, 400);
    if (!reason || reason.trim().length < 3) {
      return json({ error: "reason is required and must be at least 3 characters" }, 400);
    }
    if (target_user_id === callerUser.id) {
      return json({ error: "cannot impersonate yourself" }, 400);
    }

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, email, role, organization_id, is_active, first_name, last_name")
      .eq("id", target_user_id)
      .single();
    if (targetError || !targetProfile) return json({ error: "target user not found" }, 404);

    if (targetProfile.role === "platform_admin") {
      return json({ error: "cannot impersonate another platform_admin" }, 403);
    }
    if (targetProfile.is_active === false) {
      return json({ error: "cannot impersonate a deactivated user" }, 403);
    }

    const assurance = await requireFreshAal2(callerClient, "identity_admin");
    if (!assurance.ok) return json({ error: assurance.error }, assurance.status);

    // Authorization evidence must exist before a bearer credential is minted.
    const { error: authorizationAuditError } = await adminClient.from("audit_logs").insert({
      organization_id: targetProfile.organization_id,
      actor_profile_id: callerUser.id,
      entity_type: "impersonation",
      entity_id: target_user_id,
      action: "impersonation_authorized",
      new_values: { reason: reason.trim(), target_email: targetProfile.email, assurance: "aal2" },
    });
    if (authorizationAuditError) {
      return json({ error: "Failed to record authorization evidence; impersonation aborted." }, 500);
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: targetProfile.email,
    });
    if (linkError || !linkData) return json({ error: linkError?.message ?? "failed to generate session" }, 400);

    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) return json({ error: "failed to generate session token" }, 400);

    // The mandatory-reason audit trail is this feature's entire safety net -- if the insert
    // fails, abort instead of handing back a working session token for an unaudited
    // impersonation. The token is never returned to the caller in that case, so it can't be
    // used to complete the session swap client-side.
    const { error: auditInsertError } = await adminClient.from("audit_logs").insert({
      organization_id: targetProfile.organization_id,
      actor_profile_id: callerUser.id,
      entity_type: "impersonation",
      entity_id: target_user_id,
      action: "impersonation_start",
      new_values: { reason, target_email: targetProfile.email },
    });
    if (auditInsertError) {
      return json({ error: "Failed to record the required audit log entry; impersonation aborted." }, 500);
    }

    return json({
      success: true,
      token_hash: tokenHash,
      target: {
        id: targetProfile.id,
        email: targetProfile.email,
        firstName: targetProfile.first_name,
        lastName: targetProfile.last_name,
        role: targetProfile.role,
        organizationId: targetProfile.organization_id,
      },
    });
  }

  if (action === "end") {
    if (!target_user_id) return json({ error: "target_user_id is required" }, 400);

    // Stamp the target's organization_id (rather than null) so end events don't disappear from
    // organization-filtered audit views -- the caller's own session has already been restored to
    // the admin by this point, so this lookup must go through the service-role client, not
    // callerClient (whose JWT no longer belongs to the target's org).
    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", target_user_id)
      .maybeSingle();

    const { error: auditInsertError } = await adminClient.from("audit_logs").insert({
      organization_id: targetProfile?.organization_id ?? null,
      actor_profile_id: callerUser.id,
      entity_type: "impersonation",
      entity_id: target_user_id,
      action: "impersonation_end",
      new_values: { reason: reason ?? null },
    });
    if (auditInsertError) {
      return json({ error: "Failed to record the impersonation-end audit log entry." }, 500);
    }

    return json({ success: true });
  }

  return json({ error: "action must be one of start, end" }, 400);
});
