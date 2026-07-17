export type PrivilegedIdentityClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type PrivilegedIdentityResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** Require both an AAL2 JWT and the repository's freshness window for an operation. */
export async function requireFreshAal2(
  client: PrivilegedIdentityClient,
  operation = "identity_admin",
): Promise<PrivilegedIdentityResult> {
  const { data: isCurrent, error: freshnessError } = await client.rpc(
    "identity_assurance_is_current",
    { p_operation: operation },
  );
  if (freshnessError) {
    return { ok: false, status: 503, error: "Identity assurance could not be verified" };
  }
  if (isCurrent !== true) {
    return { ok: false, status: 403, error: "Recent multi-factor authentication is required" };
  }
  return { ok: true };
}
