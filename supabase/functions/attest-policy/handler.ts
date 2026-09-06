import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
// The shared, trusted-hop derivation. See submit-confidential-intake for the full reasoning: the
// local version this replaces honored `cf-connecting-ip` / `x-real-ip` unconditionally -- headers
// any caller can set unless Cloudflare verifiably fronts the function -- and then fell back to the
// FIRST hop of x-forwarded-for, which is the half of that list the caller writes. Only the LAST hop
// is the address the platform gateway itself observed and appended.
import { clientIp } from "../_shared/clientIp.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

// ESIGN/UETA needs an attributable, non-repudiable record of intent -- this only runs as an Edge
// Function (rather than a plain RPC) because a plain Postgres RPC has no way to read the caller's
// IP address or User-Agent from the request itself. That record is the reason the derivation has
// to be the trusted-hop one: an address the attester chose is worse than no address, because the
// column reads as evidence.
function attestationIp(req: Request): string | null {
  const derived = clientIp(req);
  return derived === "unknown" ? null : derived;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientFactory = (url: string, key: string, options?: Record<string, unknown>) => any;

export interface AttestPolicyDependencies {
  createClient: ClientFactory;
  getEnv?: (name: string) => string | undefined;
}

export function createAttestPolicyHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
}: AttestPolicyDependencies) {
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
        "id, status, employee_id, campaign_id, policy_document_version_id, employees(profile_id), " +
          "policy_document_versions(content_hash)",
      )
      .eq("id", attestationId)
      .maybeSingle();
    if (attestationError) {
      console.error("attest-policy: attestation read failed", attestationError.message);
      return json(req, { error: "Unable to load this attestation" }, 500);
    }
    if (!attestation) return json(req, { error: "Attestation not found" }, 404);

    const typedAttestation = attestation as unknown as {
      id: string;
      status: string;
      employee_id: string;
      campaign_id: string;
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

    // An attestation IS the claim "I read this exact document", and `document_version_hash` is the
    // only thing in the row that says which bytes those were. Recording it as null produced an
    // ESIGN/UETA record attesting to nothing: the version could be replaced afterwards and the
    // attestation would still read as signed, with nothing to compare it against (BACKLOG.md J74,
    // Policy). `policy_document_versions.content_hash` is NOT NULL at the table, so a null here
    // means the embedded read did not resolve -- an RLS or product-module refusal on the version,
    // not a version without a hash -- and either way the honest answer is to refuse, not to sign.
    const contentHash = typedAttestation.policy_document_versions?.content_hash?.trim() || null;
    if (!contentHash) {
      console.error(
        "attest-policy: no document hash for version",
        typedAttestation.policy_document_version_id,
      );
      return json(req, {
        error:
          "This policy version's document fingerprint could not be read, so an attestation cannot record what you signed. Ask an administrator to re-publish the version, then try again.",
      }, 409);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Knowledge-check gate (BACKLOG.md E4). Read with the service-role client on purpose: the
    // employee attesting cannot see policy_campaign_questions at all -- that table holds the answer
    // key, and its RLS stops at the administrators who author it. Counting through the caller's own
    // client would therefore always come back 0 and silently disable this gate for exactly the
    // person it applies to -- the same shape of bug as an empty-RLS-read being mistaken for
    // "nothing to check".
    const { count: questionCount, error: questionCountError } = await adminClient
      .from("policy_campaign_questions")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", typedAttestation.campaign_id);
    if (questionCountError) {
      console.error("attest-policy: question count read failed", questionCountError.message);
      return json(req, { error: "Unable to verify the knowledge check" }, 500);
    }

    if ((questionCount ?? 0) > 0) {
      const { data: passedAttempt, error: attemptError } = await adminClient
        .from("policy_knowledge_check_attempts")
        .select("id")
        .eq("attestation_id", typedAttestation.id)
        .eq("passed", true)
        .limit(1)
        .maybeSingle();
      if (attemptError) {
        console.error("attest-policy: attempt read failed", attemptError.message);
        return json(req, { error: "Unable to verify the knowledge check" }, 500);
      }
      if (!passedAttempt) {
        return json(req, {
          error: "This policy requires passing its knowledge check before you can attest.",
          knowledgeCheckRequired: true,
        }, 403);
      }
    }

    const { data: updated, error: updateError } = await adminClient
      .from("policy_attestations")
      .update({
        status: "attested",
        attested_at: new Date().toISOString(),
        document_version_hash: contentHash,
        auth_method: "authenticated_session",
        ip_address: attestationIp(req),
        user_agent: req.headers.get("user-agent"),
      })
      .eq("id", attestationId)
      .eq("status", "pending")
      .select("id, status, attested_at")
      .maybeSingle();
    if (updateError) {
      console.error("attest-policy: attestation update failed", updateError.message);
      return json(req, { error: "Unable to record this attestation" }, 500);
    }
    if (!updated) return json(req, { error: "This policy has already been attested" }, 409);

    return json(req, { success: true, attestation: updated });
  };
}
