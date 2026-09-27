/** Kept only in memory until auth-js establishes the session from this URL. */
export interface RecoveryGrant {
  type: "invite" | "recovery";
  accessToken: string;
}

export function readRecoveryGrant(hash: string): RecoveryGrant | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.has("error") || params.has("error_code")) return null;
  const type = params.get("type");
  const accessToken = params.get("access_token");
  if ((type !== "invite" && type !== "recovery") || !accessToken?.trim()) return null;
  return { type, accessToken };
}

/** An invite-looking URL does not turn an unrelated session already in storage into a grant. */
export function recoveryGrantMatchesSession(
  grant: RecoveryGrant | null,
  session: { access_token: string } | null,
): boolean {
  return !!grant && !!session && session.access_token === grant.accessToken;
}
