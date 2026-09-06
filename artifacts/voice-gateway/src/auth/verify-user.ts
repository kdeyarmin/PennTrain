// End-user JWT verification against the owning app's Supabase project.
//
// Same semantics as the repo's edge functions (auth.getUser() + a
// profiles.role/is_active allowlist check under RLS), implemented with
// plain fetch against Supabase's REST surface so the gateway carries no
// supabase-js dependency and tests can stub one function. Verification is
// revocation-aware (GoTrue checks the session server-side) and runs once
// per session creation — never per audio frame.

import type { AppDefinition } from "../apps/types.js";

export interface VerifiedUser {
  userId: string;
  role: string;
  /** Caller's organization; null for platform-internal staff without an org. */
  organizationId: string | null;
}

export interface VerifyFailure {
  status: 401 | 403 | 502;
  code: string;
}

export type VerifyResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; failure: VerifyFailure };

/**
 * The `exp` claim, in epoch seconds, or null when the token has no readable one.
 *
 * Read, never trusted for authorization: `verifyAppUser` above is what decides whether a token is
 * good, by asking GoTrue. This is only used to answer "can this token last as long as the session
 * we are about to open", which is a scheduling question — and getting it wrong in the permissive
 * direction (unreadable claim -> null -> allowed) leaves today's behaviour exactly as it was.
 */
export function accessTokenExpiry(jwt: string): number | null {
  const segments = jwt.split(".");
  if (segments.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

export async function verifyAppUser(
  app: AppDefinition,
  jwt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const { supabaseUrl, anonKey, allowedRoles } = app.auth;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${jwt}`,
  };

  let userRes: Response;
  try {
    userRes = await fetchImpl(`${supabaseUrl}/auth/v1/user`, { headers });
  } catch {
    return { ok: false, failure: { status: 502, code: "auth_unreachable" } };
  }
  if (!userRes.ok) {
    return { ok: false, failure: { status: 401, code: "invalid_token" } };
  }
  let user: { id?: unknown };
  try {
    user = (await userRes.json()) as { id?: unknown };
  } catch {
    // A 200 with a malformed body is an auth-service anomaly, not a bad token.
    return { ok: false, failure: { status: 502, code: "auth_unreachable" } };
  }
  if (typeof user.id !== "string" || !user.id) {
    return { ok: false, failure: { status: 401, code: "invalid_token" } };
  }

  // The caller's own JWT scopes this read — RLS lets a user see their own
  // profile row, exactly as the edge functions rely on.
  let profileRes: Response;
  try {
    profileRes = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_active,organization_id`,
      { headers: { ...headers, Accept: "application/vnd.pgrst.object+json" } },
    );
  } catch {
    return { ok: false, failure: { status: 502, code: "auth_unreachable" } };
  }
  if (!profileRes.ok) {
    return { ok: false, failure: { status: 403, code: "no_profile" } };
  }
  let profile: { role?: unknown; is_active?: unknown; organization_id?: unknown };
  try {
    profile = (await profileRes.json()) as {
      role?: unknown;
      is_active?: unknown;
      organization_id?: unknown;
    };
  } catch {
    return { ok: false, failure: { status: 502, code: "auth_unreachable" } };
  }
  if (
    profile.is_active !== true ||
    typeof profile.role !== "string" ||
    !allowedRoles.includes(profile.role)
  ) {
    return { ok: false, failure: { status: 403, code: "role_not_allowed" } };
  }

  const organizationId =
    typeof profile.organization_id === "string" && profile.organization_id
      ? profile.organization_id
      : null;

  return {
    ok: true,
    user: { userId: user.id, role: profile.role, organizationId },
  };
}

/**
 * BAA-gated org AI check via the caller's JWT (public.org_ai_allowed).
 * Fails closed on network/RPC errors when an organization is in scope.
 * Platform-internal callers with no organizationId are allowed (platform
 * kill-switch still applies at tool time).
 */
export async function orgAiAllowedForUser(
  app: AppDefinition,
  jwt: string,
  organizationId: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!organizationId) return true;
  const { supabaseUrl, anonKey } = app.auth;
  try {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/org_ai_allowed`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_org: organizationId }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body === true;
  } catch {
    return false;
  }
}
