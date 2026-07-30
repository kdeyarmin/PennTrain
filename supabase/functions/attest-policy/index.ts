import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

// ESIGN/UETA needs an attributable, non-repudiable record of intent -- this only runs as an Edge
// Function (rather than a plain RPC) because a plain Postgres RPC has no way to read the caller's
// IP address or User-Agent from the request itself.
function clientIp(req: Request): string | null {
  const trusted = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (trusted) return trusted;
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : null;
}

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

  let body: { attestationId?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const { attestationId } = body;
  if (!attestationId) return json(req, { error: "attestationId is required" }, 400);

  // RLS-scoped read on the caller's own client: policy_attestations_select already gates
  // visibility (owns_employee, or org_admin/auditor/facility_manager) -- but attesting is a
  // personal act, so we additionally require the row belongs to the caller's own employee record
  // below, not merely that they're allowed to view it.
  const { data: attestation, error: attestationError } = await callerClient
    .from("policy_attestations")
    .select(
      "id, status, employee_id, policy_document_version_id, employees(profile_id), " +
        "policy_document_versions(content_hash)",
    )
    .eq("id", attestationId)
    .maybeSingle();
  if (attestationError) return json(req, { error: attestationError.message }, 500);
  if (!attestation) return json(req, { error: "Attestation not found" }, 404);

  const typedAttestation = attestation as unknown as {
    id: string;
    status: string;
    employee_id: string;
    policy_document_version_id: string;
    employees: { profile_id: string | null } | null;
    policy_document_versions: { content_hash: string } | null;
  };

  const employeeProfileId = typedAttestation.employees?.profile_id;
  if (employeeProfileId !== callerUser.id) {
    return json(req, { error: "You may only attest to your own assigned policies" }, 403);
  }
  if (typedAttestation.status !== "pending") {
    return json(req, { error: "This policy has already been attested" }, 409);
  }

  const contentHash = typedAttestation.policy_document_versions?.content_hash ?? null;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: updated, error: updateError } = await adminClient
    .from("policy_attestations")
    .update({
      status: "attested",
      attested_at: new Date().toISOString(),
      document_version_hash: contentHash,
      auth_method: "authenticated_session",
      ip_address: clientIp(req),
      user_agent: req.headers.get("user-agent"),
    })
    .eq("id", attestationId)
    .eq("status", "pending")
    .select("id, status, attested_at")
    .maybeSingle();
  if (updateError) return json(req, { error: updateError.message }, 500);
  if (!updated) return json(req, { error: "This policy has already been attested" }, 409);

  return json(req, { success: true, attestation: updated });
});
