/**
 * Mirrors `update_complaint_case`'s closure matrix. The investigation card already
 * rendered the checklist; the Approve closure button ignored it.
 */

export interface ComplaintClosureChecklist {
  acknowledgementRecorded: boolean;
  investigatorAssigned: boolean;
  notesComplete: boolean;
  findingsComplete: boolean;
  writtenResponseRecorded: boolean;
  /**
   * True when no appeal was requested, or the outcome is long enough for
   * `update_complaint_case`. The RPC refuses close when `appeal_requested_at`
   * is set and `appeal_outcome` is under 5 characters.
   */
  appealComplete: boolean;
  /** null while activity is still loading or failed -- not ready. */
  correctiveActionsComplete: boolean | null;
  /** null while activity is still loading or failed -- not ready. */
  monitoringComplete: boolean | null;
}

export function complaintAppealComplete(
  appealRequestedAt: string | null | undefined,
  appealOutcome: string | null | undefined,
): boolean {
  if (!appealRequestedAt) return true;
  return (appealOutcome ?? "").trim().length >= 5;
}

export function complaintClosureReady(checklist: ComplaintClosureChecklist): boolean {
  return checklist.acknowledgementRecorded
    && checklist.investigatorAssigned
    && checklist.notesComplete
    && checklist.findingsComplete
    && checklist.writtenResponseRecorded
    && checklist.appealComplete
    && checklist.correctiveActionsComplete === true
    && checklist.monitoringComplete === true;
}
