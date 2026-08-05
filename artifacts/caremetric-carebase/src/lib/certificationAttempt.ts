/**
 * Observed-competency certification (BACKLOG.md G8).
 *
 * The whole capability had no entry point: nothing created an attempt or recorded a checklist item,
 * so `approve_certification_attempt` -- a rigorous function -- approved rows that could not exist.
 * Migration `20260804120000` supplies the observation path. This module owns the reading of it:
 * which items are still outstanding, and whether the attempt is ready to submit.
 *
 * Pure and clock-injectable, so the same definition drives the screen and the tests, and the server
 * enforces the same completeness rule independently at both submit and approve.
 */

export type AttemptResult = "met" | "not_met" | "not_applicable";
export type AttemptStatus = "in_progress" | "submitted" | "passed" | "failed" | "voided";

export interface ChecklistItemLike {
  id: string;
  item_key: string;
  prompt: string;
  evidence_required: boolean;
  signature_required: boolean;
}

export interface RecordedItemLike {
  checklist_item_id: string;
  result: string;
  evidence: unknown;
  signed_at: string | null;
}

export interface ChecklistRow {
  item: ChecklistItemLike;
  recorded: RecordedItemLike | null;
}

export interface OutstandingItem {
  itemKey: string;
  prompt: string;
  /** What specifically is missing, in the words the assessor needs to act on. */
  missing: string;
}

function hasEvidence(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== "object") return false;
  return Object.keys(evidence as Record<string, unknown>).length > 0;
}

/**
 * Items that would stop this attempt being submitted or approved.
 *
 * Mirrors the server's rule exactly: an item is incomplete if it was never recorded, or it requires
 * evidence and carries none, or it requires a signature and has none. `not_applicable` is the one
 * escape -- an item that genuinely does not apply cannot be expected to carry evidence of something
 * that did not happen, and the server's `record` path allows it for that reason.
 */
export function outstandingChecklistItems(rows: ChecklistRow[]): OutstandingItem[] {
  const outstanding: OutstandingItem[] = [];
  for (const { item, recorded } of rows) {
    if (!recorded) {
      outstanding.push({ itemKey: item.item_key, prompt: item.prompt, missing: "not yet observed" });
      continue;
    }
    if (recorded.result === "not_applicable") continue;
    if (item.evidence_required && !hasEvidence(recorded.evidence)) {
      outstanding.push({ itemKey: item.item_key, prompt: item.prompt, missing: "evidence required" });
      continue;
    }
    if (item.signature_required && !recorded.signed_at) {
      outstanding.push({ itemKey: item.item_key, prompt: item.prompt, missing: "signature required" });
    }
  }
  return outstanding;
}

export function attemptStatusLabel(status: string): string {
  switch (status) {
    case "in_progress": return "Observation in progress";
    case "submitted": return "Awaiting decision";
    case "passed": return "Passed";
    case "failed": return "Failed";
    case "voided": return "Voided";
    default: return status;
  }
}

/** Stages where somebody still owes something. */
export function attemptIsOpen(status: string): boolean {
  return status === "in_progress" || status === "submitted";
}

/**
 * The assessor's signature, as the server's `^[0-9a-f]{64}$` check demands.
 *
 * Deliberately a hash of a typed attestation rather than a random token: the value is stored as the
 * evidence that a named person signed, so it has to be derived from something that person actually
 * entered. This is not a cryptographic identity proof and does not pretend to be -- the identity
 * comes from the authenticated session, which the server checks against `assessor_profile_id`.
 */
export async function signatureDigest(attestation: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(attestation));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Null when the decision is submittable; otherwise what is wrong with it. */
export function decisionIssue(input: { reason: string; typedName: string }): string | null {
  if (!input.typedName.trim()) {
    return "Type your name to sign the decision.";
  }
  // Matches `length(btrim(coalesce(p_reason, ''))) < 5` in approve_certification_attempt.
  if (input.reason.trim().length < 5) {
    return "Give a reason of at least five characters — it is stored as part of the signed decision.";
  }
  return null;
}
