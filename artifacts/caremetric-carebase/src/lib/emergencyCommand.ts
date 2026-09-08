/**
 * Client mirrors of `transition_emergency_event`, `save_emergency_after_action`,
 * and `add_emergency_corrective_action`. The page used to enable every command on
 * a non-empty string and let the RPC refuse; a live incident is the wrong place
 * to learn the rule from a toast.
 */

export const EMERGENCY_TRANSITION_REASON_MIN = 5;
export const EMERGENCY_REVIEW_SUMMARY_MIN = 10;
export const EMERGENCY_REVIEW_FINDING_MIN = 5;
export const EMERGENCY_ACTION_TITLE_MIN = 3;

export function emergencyTransitionReasonIsReady(reason: string): boolean {
  return reason.trim().length >= EMERGENCY_TRANSITION_REASON_MIN;
}

export function canStabilizeEmergencyEvent(input: {
  reason: string;
  residentUnaccounted: number;
  staffUnaccounted: number;
}): boolean {
  return emergencyTransitionReasonIsReady(input.reason)
    && input.residentUnaccounted === 0
    && input.staffUnaccounted === 0;
}

export function canCloseEmergencyEvent(input: {
  reason: string;
  afterActionStatus: string | null | undefined;
}): boolean {
  return emergencyTransitionReasonIsReady(input.reason)
    && input.afterActionStatus === "approved";
}

export function canCancelEmergencyEvent(reason: string): boolean {
  return emergencyTransitionReasonIsReady(reason);
}

export function canSaveEmergencyAfterAction(input: {
  status: string;
  responseSummary: string;
  strengths: string;
  gaps: string;
  correctivePlan: string;
}): boolean {
  if (input.responseSummary.trim().length < EMERGENCY_REVIEW_SUMMARY_MIN) return false;
  if (!["draft", "submitted", "approved"].includes(input.status)) return false;
  if (input.status === "draft") return true;
  return input.strengths.trim().length >= EMERGENCY_REVIEW_FINDING_MIN
    && input.gaps.trim().length >= EMERGENCY_REVIEW_FINDING_MIN
    && input.correctivePlan.trim().length >= EMERGENCY_REVIEW_FINDING_MIN;
}

export function canCreateEmergencyCorrectiveWork(input: {
  title: string;
  ownerProfileId: string;
  dueAt: string;
  now?: Date;
}): boolean {
  if (input.title.trim().length < EMERGENCY_ACTION_TITLE_MIN) return false;
  if (!input.ownerProfileId) return false;
  if (!input.dueAt) return false;
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() > (input.now ?? new Date()).getTime();
}
