// Per-organization BAA-gated AI (PT-019).
//
// Every edge function that talks to the AI provider must pass BOTH gates before any
// provider request: the existing platform-wide platform_settings switch (unchanged)
// AND public.org_ai_allowed(p_org) -- org exists, ai_features_enabled, and either a
// demo org (synthetic data only) or a recorded BAA acceptance on the organizations row.
//
// Pure decision logic lives here (deno-testable without env or I/O per the _shared
// convention); the RPC round trip is the thin `orgAiAllowed` wrapper below.

export const ORG_AI_DISABLED_CODE = "org_ai_disabled";
export const ORG_AI_DISABLED_MESSAGE =
  "AI features are disabled for your organization. A signed Business Associate Agreement is required — contact your administrator.";

export interface OrgAiRpcResult {
  data: unknown;
  error: { message: string } | null;
}

// Fail-closed interpretation of the org_ai_allowed RPC result.
//
// `orgId` null/undefined means the request has no organization context at all
// (vendor-internal platform_admin work such as drafting the system course catalog,
// where courses.organization_id is NULL). There is no tenant whose BAA could apply,
// so only the platform-wide switches gate that path. Whenever an organization IS in
// scope, anything other than an errorless `true` from the RPC denies.
export function orgAiGateDecision(
  orgId: string | null | undefined,
  rpcResult: OrgAiRpcResult | null | undefined,
): "allow" | "deny" {
  if (!orgId) return "allow";
  if (!rpcResult || rpcResult.error) return "deny";
  return rpcResult.data === true ? "allow" : "deny";
}

// 403 body for a denied request. Keeps each function's existing `{ error: ... }`
// envelope (the message is user-presentable) and adds a stable machine code.
export function orgAiDisabledBody(): { error: string; code: string } {
  return { error: ORG_AI_DISABLED_MESSAGE, code: ORG_AI_DISABLED_CODE };
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<OrgAiRpcResult>;
}

// Resolve the gate for one organization id. Works with either the caller-scoped
// client (authenticated users may ask about their own org; platform admins about
// any) or a service-role client -- public.org_ai_allowed enforces that scoping.
export async function orgAiAllowed(
  client: RpcClient,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!orgId) return true;
  let result: OrgAiRpcResult | null;
  try {
    result = await client.rpc("org_ai_allowed", { p_org: orgId });
  } catch {
    result = null;
  }
  return orgAiGateDecision(orgId, result) === "allow";
}
