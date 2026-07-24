// Human disposition of a citation-backed copilot answer (Area 10 follow-up). The copilot writes an
// immutable receipt of what it *said* (`compliance_copilot_runs`); a disposition records what a
// reviewer *decided* about that answer. Pure and unit-tested; consumed by the Regulatory Copilot page.

export type CopilotDisposition = "accepted" | "rejected" | "needs_review";

export interface DispositionOption {
  value: CopilotDisposition;
  label: string;
  /** Plain-language meaning shown next to the control. */
  description: string;
}

// Ordered as they appear in the UI: the affirmative decision first, then the two that require a note.
export const DISPOSITION_OPTIONS: DispositionOption[] = [
  { value: "accepted", label: "Accept", description: "The answer is sound; I'm relying on it." },
  { value: "needs_review", label: "Needs review", description: "Set aside for a closer second look." },
  { value: "rejected", label: "Reject", description: "The answer is wrong, unusable, or unsupported." },
];

const DISPOSITION_META: Record<CopilotDisposition, { label: string; badgeClass: string }> = {
  accepted: { label: "Accepted", badgeClass: "bg-success text-success-foreground hover:bg-success/80" },
  needs_review: { label: "Needs review", badgeClass: "bg-warning text-warning-foreground hover:bg-warning/80" },
  rejected: { label: "Rejected", badgeClass: "bg-destructive text-destructive-foreground hover:bg-destructive/80" },
};

export function dispositionLabel(value: string): string {
  return (DISPOSITION_META as Record<string, { label: string }>)[value]?.label ?? value;
}

export function dispositionBadgeClass(value: string): string {
  return (DISPOSITION_META as Record<string, { badgeClass: string }>)[value]?.badgeClass
    ?? "bg-muted text-muted-foreground";
}

// A note justifies a decision not to rely on the answer. Server-enforced too (the RPC rejects a
// too-short note for these), but gate the UI so the reviewer isn't bounced by a round trip.
export function dispositionRequiresNote(value: CopilotDisposition): boolean {
  return value === "rejected" || value === "needs_review";
}

export const DISPOSITION_NOTE_MIN = 5;

export function isDispositionNoteValid(value: CopilotDisposition, note: string): boolean {
  if (!dispositionRequiresNote(value)) return true;
  return note.trim().length >= DISPOSITION_NOTE_MIN;
}

export interface DispositionRecordLike {
  run_id: string;
  disposition: string;
  disposition_note?: string | null;
  created_at: string;
  decided_by?: string | null;
}

/**
 * Reduce an append-only disposition log to the latest decision per run. Dispositions are
 * event-sourced (a reviewer can change their mind), so the most recent row for each run is the
 * current state. Robust to unordered input.
 */
export function latestDispositionByRun<T extends DispositionRecordLike>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!row.run_id) continue;
    const existing = latest.get(row.run_id);
    if (!existing || new Date(row.created_at).getTime() > new Date(existing.created_at).getTime()) {
      latest.set(row.run_id, row);
    }
  }
  return latest;
}
