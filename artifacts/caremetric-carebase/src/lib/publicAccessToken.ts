import { appPath } from "./appUrl";

// Keep a supplied grant usable for this document when browser storage is blocked
// or full. This fallback is never persisted and disappears on a full reload.
const unavailableStorageTokens = new Map<string, string>();

export function publicGuestWorkspaceError(error: unknown): "terms_required" | "token_rejected" | "rate_limited" | "facility_inactive" | "retryable" {
  const detail = error as { code?: unknown; message?: unknown } | null;
  if (detail?.code !== "42501" || typeof detail.message !== "string") return "retryable";
  // The guest RPCs deliberately share one HTTP/SQL error code for these distinct
  // outcomes. Only an explicit grant denial means a stored token should be lost.
  if (/^(Move-in guest|Resident agreement) terms acceptance required$/i.test(detail.message)) return "terms_required";
  if (/^(Move-in guest|Resident agreement) access denied$/i.test(detail.message)) return "token_rejected";
  if (/^Too many (requests|invalid access attempts) from this connection\./i.test(detail.message)) return "rate_limited";
  if (/^This facility's account is not active\./i.test(detail.message)) return "facility_inactive";
  return "retryable";
}

export function publicGuestRetryMessage(state: ReturnType<typeof publicGuestWorkspaceError>): string {
  if (state === "rate_limited") return "Too many requests from this connection. Wait a minute, then try again.";
  if (state === "facility_inactive") return "This facility's account is not active. Please contact the facility directly.";
  return "We could not load this link right now. Please try again.";
}

export function storePublicAccessToken(storageKey: string, token: string): void {
  try {
    sessionStorage.setItem(storageKey, token);
    unavailableStorageTokens.delete(storageKey);
  } catch {
    unavailableStorageTokens.set(storageKey, token);
  }
}

export function readPublicAccessToken(storageKey: string): string {
  // A failed write must take precedence over an older stored credential.
  if (unavailableStorageTokens.has(storageKey)) return unavailableStorageTokens.get(storageKey)!;
  try {
    return sessionStorage.getItem(storageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export interface PublicAccessFlow {
  name: string;
  tokenPath: string;
  cleanPath: string;
  storageKey: string | null;
  requiresServerAudit: boolean;
}

export const PUBLIC_ACCESS_FLOWS: readonly PublicAccessFlow[] = [
  { name: "documentation guest", tokenPath: "/evidence-access/:token", cleanPath: "/evidence-access", storageKey: "carebase-evidence-room-token", requiresServerAudit: true },
  { name: "move-in guest", tokenPath: "/move-in-access/:token", cleanPath: "/move-in-access", storageKey: "carebase-move-in-guest-token", requiresServerAudit: true },
  { name: "resident agreement guest", tokenPath: "/resident-agreement-access/:token", cleanPath: "/resident-agreement-access", storageKey: "carebase-resident-agreement-token", requiresServerAudit: true },
  { name: "survey packet guest", tokenPath: "/survey-packet-access/:token", cleanPath: "/survey-packet-access", storageKey: "carebase-survey-packet-token", requiresServerAudit: true },
  { name: "maintenance/check-in", tokenPath: "/checkin/:token", cleanPath: "/checkin", storageKey: "checkin-access-token", requiresServerAudit: true },
  { name: "training passport", tokenPath: "/passport/:slug", cleanPath: "/passport", storageKey: null, requiresServerAudit: false },
  { name: "certificate verification", tokenPath: "/verify/:slug", cleanPath: "/verify", storageKey: null, requiresServerAudit: false },
] as const;

export interface PublicAccessFlowGovernanceIssue {
  flow: string;
  issue: "missing_storage_key" | "missing_clean_path" | "token_not_scrubbed";
  message: string;
}

export function publicAccessFlowGovernanceIssues(
  flows: readonly PublicAccessFlow[] = PUBLIC_ACCESS_FLOWS,
): PublicAccessFlowGovernanceIssue[] {
  const issues: PublicAccessFlowGovernanceIssue[] = [];
  for (const flow of flows) {
    if (!flow.cleanPath.startsWith("/")) {
      issues.push({ flow: flow.name, issue: "missing_clean_path", message: "Clean public path must be absolute." });
    }
    if (flow.storageKey && !flow.tokenPath.includes(":token")) {
      issues.push({ flow: flow.name, issue: "token_not_scrubbed", message: "Tab-scoped token flow must declare a tokenized route." });
    }
    // A server-audited flow without a storage key is a single condition and is
    // reported once (previously two overlapping rules double-reported it).
    if (flow.requiresServerAudit && !flow.storageKey) {
      issues.push({ flow: flow.name, issue: "missing_storage_key", message: "Sensitive server-audited flow must use a tab-scoped storage key so the credential can be scrubbed from the URL and history." });
    }
  }
  return issues;
}

export function consumePublicAccessToken(
  routeToken: string | undefined,
  storageKey: string,
  cleanPath: string,
): string {
  const supplied = routeToken?.trim() ?? "";
  if (supplied) {
    storePublicAccessToken(storageKey, supplied);
    const current = new URL(window.location.href);
    // appPath, not the bare cleanPath: under a BASE_PATH deploy the tokenized
    // URL is /train/evidence-access/<token>, and rewriting to /evidence-access
    // leaves the SPA entirely. Tests run with BASE_URL="/" so this is a no-op there.
    window.history.replaceState(null, "", `${appPath(cleanPath)}${current.search}${current.hash}`);
    return supplied;
  }
  return readPublicAccessToken(storageKey);
}

/**
 * Drop a stored public-access credential once the server has definitively
 * rejected it (expired, revoked, or invalid). Without this, the dead token
 * lingered in sessionStorage for the tab's lifetime and was silently replayed
 * on every later visit to the flow's clean path. Call it from a flow's
 * server-rejection path -- not on transient/network failures, which say
 * nothing about the token itself. Accepts null so slug-based flows (no
 * storage key) can share call sites.
 */
export function clearStoredPublicAccessToken(storageKey: string | null): void {
  if (!storageKey) return;
  try {
    sessionStorage.removeItem(storageKey);
    unavailableStorageTokens.delete(storageKey);
  } catch {
    // Also suppress an older persisted credential if browser removal is blocked.
    unavailableStorageTokens.set(storageKey, "");
  }
}
