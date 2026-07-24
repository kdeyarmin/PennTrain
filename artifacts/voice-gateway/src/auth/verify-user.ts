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
}

export interface VerifyFailure {
  status: 401 | 403 | 502;
  code: string;
}

export type VerifyResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; failure: VerifyFailure };

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
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_active`,
      { headers: { ...headers, Accept: "application/vnd.pgrst.object+json" } },
    );
  } catch {
    return { ok: false, failure: { status: 502, code: "auth_unreachable" } };
  }
  if (!profileRes.ok) {
    return { ok: false, failure: { status: 403, code: "no_profile" } };
  }
  let profile: { role?: unknown; is_active?: unknown };
  try {
    profile = (await profileRes.json()) as { role?: unknown; is_active?: unknown };
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

  return { ok: true, user: { userId: user.id, role: profile.role } };
}
