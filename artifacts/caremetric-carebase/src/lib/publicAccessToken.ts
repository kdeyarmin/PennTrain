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
  { name: "maintenance/check-in", tokenPath: "/checkin/:token", cleanPath: "/checkin", storageKey: "checkin-access-token", requiresServerAudit: true },
  { name: "training passport", tokenPath: "/passport/:slug", cleanPath: "/passport", storageKey: null, requiresServerAudit: false },
  { name: "certificate verification", tokenPath: "/verify/:slug", cleanPath: "/verify", storageKey: null, requiresServerAudit: false },
] as const;

export interface PublicAccessFlowGovernanceIssue {
  flow: string;
  issue: "missing_storage_key" | "missing_clean_path" | "token_not_scrubbed" | "server_audit_required";
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
    if (flow.tokenPath.includes(":token") && !flow.storageKey && flow.requiresServerAudit) {
      issues.push({ flow: flow.name, issue: "missing_storage_key", message: "Sensitive token flow must use a tab-scoped storage key before history is scrubbed." });
    }
    if (flow.requiresServerAudit && !flow.storageKey) {
      issues.push({ flow: flow.name, issue: "server_audit_required", message: "Sensitive guest flow must be auditable on the server boundary." });
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
    sessionStorage.setItem(storageKey, supplied);
    const current = new URL(window.location.href);
    window.history.replaceState(null, "", `${cleanPath}${current.search}${current.hash}`);
    return supplied;
  }
  return sessionStorage.getItem(storageKey)?.trim() ?? "";
}
