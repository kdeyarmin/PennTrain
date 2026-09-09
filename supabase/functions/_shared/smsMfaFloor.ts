export type SmsMfaFloorClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; hint?: string; message?: string } | null;
  }>;
};

type SmsMfaFloorResult =
  | { ok: true }
  | { ok: false; status: 403 | 503; error: string; code: string };

/**
 * Call with the authenticated user's client before privileged work. Own-profile
 * reads remain available for MFA setup and therefore cannot establish assurance.
 * Accounts that have never enabled SMS retain their existing authorization rules.
 */
export async function requireSmsMfaFloor(client: SmsMfaFloorClient): Promise<SmsMfaFloorResult> {
  const denied: SmsMfaFloorResult = {
    ok: false, status: 403, error: "Multi-factor authentication is required", code: "mfa_required",
  };
  const unavailable: SmsMfaFloorResult = {
    ok: false, status: 503, error: "Session assurance could not be verified", code: "assurance_unavailable",
  };
  try {
    const { data, error } = await client.rpc("current_sms_mfa_satisfied", {});
    // The Data API pre-request hook rejects this RPC for an unverified SMS
    // session before executing it. Never relax that hook to make the check pass.
    if (error) return error.code === "42501" || error.hint === "mfa_required" ? denied : unavailable;
    return data === true ? { ok: true } : denied;
  } catch {
    return unavailable;
  }
}
