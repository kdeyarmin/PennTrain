import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  constantTimeEqualHex,
  hashScimSecret,
  parseScimAuthorization,
  sha256Hex,
} from "../_shared/phase2IdentitySecurity.ts";
import { readTextBody, RequestBodyError } from "../_shared/requestBody.ts";
import {
  escapeLikePattern,
  evaluateScimRoleGuard,
  type GovernedProfile,
  type ScimOperation,
} from "./roleGuard.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const REQUEST_ID_HEADER = "x-scim-request-id";
const MAX_BODY_BYTES = 256 * 1024;

function json(body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(requestId ? { "X-SCIM-Request-Id": requestId } : {}),
    },
  });
}

interface ScimBody {
  operation?: "create" | "update" | "suspend" | "deprovision";
  externalId?: string;
  userName?: string;
  active?: boolean;
  name?: { givenName?: string; familyName?: string };
  employeeNumber?: string;
  jobTitle?: string;
  groups?: Array<string | { value?: string; id?: string }>;
}

interface ScimAuthMaterial {
  connection_id: string;
  organization_id: string;
  connection_status: string;
  credential_salt: string;
  credential_hash_sha256: string;
}

/** The service-role client the guard lookups below run on (RLS bypassed, reads only). */
type AdminClient = SupabaseClient;

/** The group ids a payload asserts, read the way apply_scim_change reads them. */
function payloadGroupIds(groups: ScimBody["groups"]): string[] {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : (entry && typeof entry === "object" ? entry.value ?? entry.id : null)
    )
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * The role this payload ACTUALLY asserts, or null when it asserts none.
 *
 * Mirrors apply_scim_change's mapping lookup exactly -- `order by priority, external_group_id
 * limit 1` -- but stops at `coalesce(..., 'employee')`. That coalesce is where the payload's
 * silence becomes an assertion of `employee`, which is the half of BACKLOG.md J22 that demotes
 * people (see roleGuard.ts).
 */
async function assertedRoleForPayload(
  admin: AdminClient,
  connectionId: string,
  groups: ScimBody["groups"],
): Promise<{ role: string | null } | { failed: true }> {
  const groupIds = payloadGroupIds(groups);
  if (groupIds.length === 0) return { role: null };
  const { data, error } = await admin
    .from("scim_group_mappings")
    .select("app_role, priority, external_group_id")
    .eq("scim_connection_id", connectionId)
    .in("external_group_id", groupIds)
    .order("priority", { ascending: true })
    .order("external_group_id", { ascending: true })
    .limit(1);
  if (error) return { failed: true };
  const mapping = (data ?? [])[0] as { app_role?: string } | undefined;
  return { role: mapping?.app_role ?? null };
}

/**
 * Every profile `app_private.resolve_scim_link_profile_id` could hand to
 * `admin_update_profile` / `revoke_identity_sessions` for this subject.
 *
 * Arm 1 (`employees.profile_id`) is returned alone when it exists, because the resolver's coalesce
 * stops there. Otherwise every same-organization profile carrying this email is returned, not just
 * the one the resolver's `order by` would pick: with duplicate emails the ordering decides which
 * login gets rewritten, and a guard that inspected only one of them would have a hole exactly the
 * width of the case it exists to stop.
 */
/**
 * How many same-email candidates are read before the set is treated as untrustworthy.
 *
 * Not a page size to tune: it is the line past which this guard stops answering. See the refusal
 * below for why a full page has to be refused rather than filtered.
 */
const GOVERNED_CANDIDATE_PAGE = 100;


async function governedProfileCandidates(
  admin: AdminClient,
  organizationId: string,
  connectionId: string,
  externalSubjectId: string,
  userName: string,
): Promise<GovernedProfile[] | { failed: true }> {
  // `profile_id` as well as `employee_id`, because `apply_scim_change` targets
  // `coalesce(resolve_scim_link_profile_id(...), v_link.profile_id)` and that last arm is the one
  // this guard could not see (BACKLOG J94). It is used exactly when the resolver comes back empty
  // -- the employee row detached by a revocation or an organization move, and the address no
  // longer matching -- which is also precisely when this function used to return no candidates at
  // all and wave the write through.
  const link = await admin
    .from("scim_subject_links")
    .select("employee_id, profile_id")
    .eq("scim_connection_id", connectionId)
    .eq("external_subject_id", externalSubjectId)
    .maybeSingle();
  if (link.error) return { failed: true };

  const linkRow = link.data as { employee_id?: string; profile_id?: string } | null;
  const employeeId = linkRow?.employee_id ?? null;
  const linkProfileId = linkRow?.profile_id ?? null;
  if (employeeId) {
    const employee = await admin
      .from("employees")
      .select("profile_id")
      .eq("id", employeeId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (employee.error) return { failed: true };
    const profileId = (employee.data as { profile_id?: string } | null)?.profile_id ?? null;
    if (profileId) {
      const profile = await admin
        .from("profiles")
        .select("id, role, is_active")
        .eq("id", profileId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (profile.error) return { failed: true };
      const row = profile.data as { id: string; role: string; is_active: boolean } | null;
      if (row) {
        return [{ id: row.id, role: row.role, is_active: row.is_active, resolution: "employee_link" }];
      }
    }
  }

  // `ilike` so a stored mixed-case address still matches the way `lower(p.email) = lower(...)`
  // does in SQL -- but the pattern is ESCAPED first, so this is an exact case-insensitive
  // comparison rather than a pattern at all.
  //
  // An earlier version passed the userName through raw, with a comment arguing that over-matching
  // was harmless because the exact filter is redone below. That was wrong, and the reason is the
  // `.limit()` on the next line: the limit truncates BEFORE the in-memory filter runs, so a pattern
  // matching many rows can push the real profile past the cut and leave this guard with no
  // candidate at all. `resolve_scim_link_profile_id` matches exactly and would still find it, so
  // the push would proceed against a profile the protected-role check never saw -- which is the one
  // thing this function exists to stop. A `%` in a userName (the SCIM grammar permits it in a
  // quoted local part) matched every address in the organization, turning "over-matching" into
  // "the guard is off" for any tenant with more than a page of profiles.
  const profiles = await admin
    .from("profiles")
    .select("id, role, is_active, email")
    .eq("organization_id", organizationId)
    .ilike("email", escapeLikePattern(userName))
    .limit(GOVERNED_CANDIDATE_PAGE);
  if (profiles.error) return { failed: true };
  const rows = profiles.data as Array<{ id: string; role: string; is_active: boolean; email: string | null }>;
  // A FULL page means the set may be truncated, and a truncated set cannot answer this question:
  // the exact match could be one of the rows that did not come back, and this guard would then
  // report no protected candidate while `resolve_scim_link_profile_id`, which matches exactly in
  // SQL, goes on to find and re-role that very profile. Refusing is the only safe reading. With the
  // wildcards escaped this is unreachable for a real address -- an organization does not hold a
  // hundred profiles at one email -- so it costs nothing in ordinary traffic and closes the case
  // where an unescapable `*` widened the pattern.
  if (rows.length >= GOVERNED_CANDIDATE_PAGE) return { failed: true };
  const matches = rows
    .filter((row) => (row.email ?? "").toLowerCase() === userName)
    .map((row) => ({
      id: row.id,
      role: row.role,
      is_active: row.is_active,
      resolution: "email_match" as const,
    }));
  if (matches.length > 0) return matches;

  // Nothing resolved, which is the case the RPC answers with the link's recorded profile. Load and
  // hand it over so the guard judges what will actually be written, rather than concluding there
  // is nothing to protect. Scoped to the organization like every other lookup here: a profile
  // moved out of this tenant is no longer this connection's to touch, and if the RPC still reaches
  // it that is a separate defect this guard should not paper over.
  if (linkProfileId) {
    const linked = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", linkProfileId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (linked.error) return { failed: true };
    const row = linked.data as { id: string; role: string; is_active: boolean } | null;
    if (row) {
      return [{ id: row.id, role: row.role, is_active: row.is_active, resolution: "link_fallback" }];
    }
  }
  return [];
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestId = request.headers.get(REQUEST_ID_HEADER)?.trim() ?? "";
  if (requestId.length < 8 || requestId.length > 200) {
    return json({ error: "X-SCIM-Request-Id must contain 8-200 characters" }, 400);
  }

  const credential = parseScimAuthorization(request.headers.get("Authorization"));
  if (!credential) return json({ error: "Unauthorized" }, 401, requestId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SCIM provisioning is missing required server credentials");
    return json({ error: "Service unavailable" }, 503, requestId);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: materialData, error: materialError } = await admin
    .rpc("get_scim_auth_material", { p_connection_key: credential.connectionKey })
    .single();
  const material = materialData as ScimAuthMaterial | null;
  if (materialError || !material || !["pilot", "active"].includes(material.connection_status)) {
    return json({ error: "Unauthorized" }, 401, requestId);
  }
  const candidateHash = await hashScimSecret(material.credential_salt, credential.secret);
  // Drop the plaintext reference before any later parsing/error path. The value
  // is never logged, returned, or sent to Postgres.
  credential.secret = "";
  if (!constantTimeEqualHex(candidateHash, material.credential_hash_sha256)) {
    return json({ error: "Unauthorized" }, 401, requestId);
  }

  // Per-connection rate limit (after auth, before body work) — credential theft
  // cannot mass-provision / map org_admin without a throttle.
  const { data: rateRows, error: rateError } = await admin.rpc("consume_scim_rate_limit", {
    p_connection_id: material.connection_id,
    p_cost: 1,
  });
  if (rateError) {
    console.error("SCIM rate limit unavailable", rateError.message);
    return json({ error: "Service unavailable" }, 503, requestId);
  }
  const rate = Array.isArray(rateRows) ? rateRows[0] : rateRows;
  if (!rate || rate.allowed !== true) {
    return json({ error: "rate_limit_exceeded" }, 429, requestId);
  }

  let rawBody: string;
  try {
    rawBody = await readTextBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json({ error: "Request body is too large" }, 413, requestId);
    }
    throw error;
  }

  let body: ScimBody;
  try {
    body = JSON.parse(rawBody) as ScimBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400, requestId);
  }
  if (
    !body.operation || !["create", "update", "suspend", "deprovision"].includes(body.operation) ||
    typeof body.externalId !== "string" || !body.externalId.trim() ||
    typeof body.userName !== "string" || !body.userName.trim()
  ) {
    return json({ error: "operation, externalId, and userName are required" }, 400, requestId);
  }
  // The residual administrator guard, ahead of the RPC so a refused push leaves nothing behind: no
  // receipt, no employee row, no lifecycle event, and above all no rewritten role. It covers only
  // what apply_scim_change cannot decide for itself -- see roleGuard.ts, which says which half is
  // SQL's and why this must not turn SQL's recorded declines into errors (BACKLOG.md J22). The
  // lookups fail closed: a guard that waves the request through when it cannot see the profile it
  // is protecting is not a guard.
  const operation = body.operation as ScimOperation;
  const userName = body.userName.trim().toLowerCase();
  const asserted = await assertedRoleForPayload(admin, material.connection_id, body.groups);
  const candidates = await governedProfileCandidates(
    admin,
    material.organization_id,
    material.connection_id,
    body.externalId.trim(),
    userName,
  );
  if ("failed" in asserted || "failed" in candidates) {
    console.error("SCIM administrator guard could not read the tenant's identity state");
    return json({ error: "Service unavailable" }, 503, requestId);
  }
  const verdict = evaluateScimRoleGuard({
    operation,
    assertedRole: asserted.role,
    candidates,
  });
  if (!verdict.allowed) {
    // 409, not 5xx: this is a permanent, explained refusal of one payload, and a SCIM connector
    // must not retry it for ever. It is the closest available equivalent of the `declined` field
    // apply_scim_change returns for the cases it handles itself.
    return json(
      { ok: false, errorCode: verdict.errorCode, error: verdict.message },
      409,
      requestId,
    );
  }

  const payloadHash = await sha256Hex(rawBody);
  const { data: result, error: applyError } = await admin.rpc("apply_scim_change", {
    p_connection_id: material.connection_id,
    p_request_id: requestId,
    p_payload_sha256: payloadHash,
    p_operation: body.operation,
    p_external_subject_id: body.externalId.trim(),
    p_payload: body,
  });
  if (applyError) {
    const status = applyError.code === "23505" ? 409 :
      applyError.code === "42501" ? 403 :
      ["22023", "23514"].includes(applyError.code ?? "") ? 400 : 500;
    return json({ error: status === 500 ? "SCIM request failed" : applyError.message }, status, requestId);
  }
  if (!result?.ok) {
    const status = result?.errorCode === "P0002" ? 404 :
      result?.errorCode === "42501" ? 403 :
      result?.errorCode === "23505" ? 409 : 422;
    return json(result, status, requestId);
  }
  return json(result, body.operation === "create" && !result.replayed ? 201 : 200, requestId);
});
