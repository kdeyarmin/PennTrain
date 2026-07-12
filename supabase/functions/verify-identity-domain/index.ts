import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  dnsTxtValues,
  findMatchingVerificationValue,
  normalizeDomain,
  verificationRecordName,
} from "../_shared/phase2DomainVerification.ts";
import { sha256Hex } from "../_shared/phase2IdentitySecurity.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id",
};

function json(body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
  });
}

function jwtAssuranceLevel(token: string): string | null {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return (JSON.parse(atob(padded)) as { aal?: unknown }).aal as string ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestId = request.headers.get("X-Request-Id")?.trim() || crypto.randomUUID();
  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Identity verification service is not configured" }, 503, requestId);
  }
  if (!accessToken) return json({ error: "Authentication required" }, 401, requestId);

  let body: { domainId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, requestId);
  }
  if (!body.domainId || !/^[0-9a-f-]{36}$/i.test(body.domainId)) {
    return json({ error: "domainId must be a UUID" }, 400, requestId);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await caller.auth.getUser(accessToken);
  if (userError || !user) return json({ error: "Invalid or expired session" }, 401, requestId);
  if (jwtAssuranceLevel(accessToken) !== "aal2") {
    return json({ error: "AAL2 verification is required" }, 403, requestId);
  }
  const { data: assuranceCurrent, error: assuranceError } = await caller.rpc(
    "identity_assurance_is_current",
    { p_operation: "identity_admin" },
  );
  if (assuranceError || assuranceCurrent !== true) {
    return json({ error: "A fresh AAL2 administrator session is required" }, 403, requestId);
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
  if (profileError || !profile?.is_active) return json({ error: "Active administrator profile required" }, 403, requestId);
  if (domainError || !domainRow) return json({ error: "Identity domain not found" }, 404, requestId);
  const authorized = profile.role === "platform_admin" ||
    (profile.role === "org_admin" && profile.organization_id === domainRow.organization_id);
  if (!authorized) return json({ error: "Identity administrator access required" }, 403, requestId);
  if (domainRow.verification_status === "verified") {
    return json({ verified: true, domainId: domainRow.id, domain: domainRow.domain, alreadyVerified: true }, 200, requestId);
  }

  const domain = normalizeDomain(domainRow.domain);
  if (!domain) return json({ error: "Stored identity domain is invalid" }, 409, requestId);
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
    return json({ error: "DNS verification is temporarily unavailable" }, 503, requestId);
  }

  const matchingValue = await findMatchingVerificationValue(
    dnsTxtValues(dnsPayload),
    domainRow.verification_challenge_sha256,
  );
  if (!matchingValue) {
    return json({
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
    return json({ error: "Domain proof could not be recorded" }, 409, requestId);
  }
  return json({ verified: true, domainId: domainRow.id, domain, recordName }, 200, requestId);
});
