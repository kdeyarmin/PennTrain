/**
 * Starting an HRIS import run (BACKLOG.md G10).
 *
 * The request ID is the whole idempotency story: `create_hris_import_run` upserts on
 * `(source_system_id, request_id)`, so re-submitting the same pair returns the existing run instead
 * of starting a second one against the same extract. That makes the value a claim about *which
 * extract this is*, not a label — which is why the suggestion below is derived from the source and
 * the moment rather than being a random token.
 */

export interface ImportRunForm {
  sourceSystemId: string;
  requestId: string;
}

/** What is wrong with the form, or an empty list when the server will accept it. */
export function importRunIssues(form: ImportRunForm): string[] {
  const issues: string[] = [];
  if (!form.sourceSystemId) issues.push("Choose the source system this extract came from.");
  const trimmed = form.requestId.trim();
  // Mirrors `check (length(btrim(request_id)) between 8 and 200)` on hris_import_runs.
  if (trimmed.length < 8) {
    issues.push("The request ID has to be at least 8 characters — it is the idempotency key for this extract.");
  } else if (trimmed.length > 200) {
    issues.push("The request ID cannot exceed 200 characters.");
  }
  return issues;
}

/**
 * A request ID derived from the source and the minute the run was started.
 *
 * Deliberately minute-resolution: two clicks in the same minute against the same source collapse to
 * one run, which is the behaviour somebody double-clicking a button wants. A finer clock would make
 * the accident produce two runs over one extract.
 */
export function suggestedRequestId(sourceKey: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${sourceKey}-${stamp}`;
}

export function importRunStatusLabel(status: string): string {
  switch (status) {
    case "staging": return "Awaiting staged rows";
    case "validated": return "Validated";
    case "blocked": return "Blocked on review";
    case "applying": return "Applying";
    case "applied": return "Applied";
    case "reconciled": return "Reconciled";
    case "failed": return "Failed";
    case "canceled": return "Canceled";
    default: return status;
  }
}
