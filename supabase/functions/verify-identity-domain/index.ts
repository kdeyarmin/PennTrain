import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  dnsTxtValues,
  findMatchingVerificationValue,
  normalizeDomain,
  verificationRecordName,
} from "../_shared/phase2DomainVerification.ts";
import { sha256Hex } from "../_shared/phase2IdentitySecurity.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

const IDENTITY_CORS = {
  headers:
    "authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id",
};

function json(req: Request, body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeadersForRequest(req, IDENTITY_CORS),
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return corsPreflightResponse(request, IDENTITY_CORS);
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

  const requestId = request.headers.get("X-Request-Id")?.trim() || crypto.randomUUID();
  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, { error: "Identity verification service is not configured" }, 503, requestId);
  }
  if (!accessToken) return json(request, { error: "Authentication required" }, 401, requestId);

  let body: { domainId?: string };
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "Invalid JSON body" }, 400, requestId);
  }
  if (!body.domainId || !/^[0-9a-f-]{36}$/i.test(body.domainId)) {
    return json(request, { error: "domainId must be a UUID" }, 400, requestId);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await caller.auth.getUser(accessToken);
  if (userError || !user) return json(request, { error: "Invalid or expired session" }, 401, requestId);
  // BACKLOG J74 (P3, identity). This used to decode the access token and refuse anything whose
  // raw `aal` claim was not "aal2", BEFORE the organization's policy was consulted. That is not
  // what the product promises: identity_operation_requires_aal2() reads
  // public.identity_security_policies and deliberately exempts demo tenants -- the same exemption
  // get_my_mfa_policy makes at the login gate -- so a demo org_admin who was told no authenticator
  // was needed was refused here anyway, by a message naming a factor nobody had asked them to
  // enrol. identity_assurance_is_current() is the single gate: it still requires an aal2 claim and
  // a session inside max_privileged_session_minutes wherever the policy asks for one, and it
  // returns true only where the policy genuinely does not.
  const { data: assuranceCurrent, error: assuranceError } = await caller.rpc(
    "identity_assurance_is_current",
    { p_operation: "identity_admin" },
  );
  if (assuranceError || assuranceCurrent !== true) {
    return json(request, {
      error:
        "A current administrator session that satisfies your organization's identity policy is required",
    }, 403, requestId);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: profile, error: profileError }, { data: domainRow, error: domainError }] = await Promise.all([
    admin.from("profiles").select("organization_id, role, is_active").eq("id", user.id).single(),
    admin.from("organization_identity_domains")
      .select("id, organization_id, domain, verification_status, verification_challenge_sha256")
      .eq("id", body.domainId)
      .single(),
  ]);
  if (profileError || !profile?.is_active) return json(request, { error: "Active administrator profile required" }, 403, requestId);
  if (domainError || !domainRow) return json(request, { error: "Identity domain not found" }, 404, requestId);
  const authorized = profile.role === "platform_admin" ||
    (profile.role === "org_admin" && profile.organization_id === domainRow.organization_id);
  if (!authorized) return json(request, { error: "Identity administrator access required" }, 403, requestId);
  if (domainRow.verification_status === "verified") {
    return json(request, { verified: true, domainId: domainRow.id, domain: domainRow.domain, alreadyVerified: true }, 200, requestId);
  }

  const domain = normalizeDomain(domainRow.domain);
  if (!domain) return json(request, { error: "Stored identity domain is invalid" }, 409, requestId);
  const recordName = verificationRecordName(domain);
  const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
  dnsUrl.searchParams.set("name", recordName);
  dnsUrl.searchParams.set("type", "TXT");

  let dnsPayload: unknown;
  try {
    const dnsResponse = await fetch(dnsUrl, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(7_500),
    });
    if (!dnsResponse.ok) throw new Error(`DNS resolver returned ${dnsResponse.status}`);
    dnsPayload = await dnsResponse.json();
  } catch (error) {
    console.error("Identity-domain DNS lookup failed", { requestId, domainId: body.domainId, error: String(error) });
    return json(request, { error: "DNS verification is temporarily unavailable" }, 503, requestId);
  }

  const matchingValue = await findMatchingVerificationValue(
    dnsTxtValues(dnsPayload),
    domainRow.verification_challenge_sha256,
  );
  if (!matchingValue) {
    return json(request, {
      verified: false,
      domainId: domainRow.id,
      domain,
      recordName,
      message: "The expected TXT proof was not found. DNS changes can take time to propagate.",
    }, 409, requestId);
  }

  const observedHash = await sha256Hex(matchingValue);
  const { data: verified, error: verifyError } = await admin.rpc("verify_identity_domain", {
    p_domain_id: domainRow.id,
    p_observed_challenge_sha256: observedHash,
  });
  if (verifyError || verified !== true) {
    console.error("Trusted identity-domain verification RPC failed", { requestId, domainId: body.domainId, code: verifyError?.code });
    return json(request, { error: "Domain proof could not be recorded" }, 409, requestId);
  }
  return json(request, { verified: true, domainId: domainRow.id, domain, recordName }, 200, requestId);
});
