/**
 * Hospital leave and return reconciliation (program plan Phase 5b).
 *
 * `hospital_transfer_episodes` already modelled almost all of this — departure, bed hold, medication
 * reconciliation status, changed-order acknowledgement, condition/diet/mobility/skin changes, and
 * `assessment_review_required` / `support_plan_review_required` flags. What was missing was anything
 * that made those flags *matter*: they were set on return and then nothing read them.
 *
 * This module owns the reconciliation checklist — what must be true before a return is closed,
 * which steps are outstanding, and whether the completion deadline has passed. Pure, so the same
 * definition drives the resident record, the work item, and the tests.
 *
 * A return is the moment a resident's plan is most likely to be wrong: medications, diet, and
 * mobility all commonly change during a stay, and the plan predates all of it. Closing a return with
 * steps outstanding is how that goes unnoticed.
 */

export type ReconciliationStepKey =
  | "discharge_paperwork"
  | "medication_reconciliation"
  | "changed_orders_acknowledged"
  | "assessment_review"
  | "support_plan_review";

export interface ReconciliationStep {
  key: ReconciliationStepKey;
  label: string;
  /** Why this step exists, in the words someone would use defending the closure. */
  why: string;
  complete: boolean;
  /** True when the episode did not require this step at all. */
  notApplicable: boolean;
  responsibleRole: string;
}

export interface HospitalEpisodeLike {
  id: string;
  status: string;
  transfer_time: string;
  return_time: string | null;
  destination: string | null;
  reason: string | null;
  discharge_document_id: string | null;
  medication_reconciliation_status: string;
  changed_order_ack_status: string;
  assessment_review_required: boolean;
  support_plan_review_required: boolean;
  condition_changes?: string | null;
  diet_changes?: string | null;
  mobility_changes?: string | null;
  skin_concerns?: string | null;
}

/** Hours after return before the reconciliation is overdue. Matches the work item's 24-hour due_at. */
export const RECONCILIATION_DEADLINE_HOURS = 24;

export interface ReconciliationState {
  applicable: boolean;
  steps: ReconciliationStep[];
  outstanding: ReconciliationStep[];
  complete: boolean;
  deadline: string | null;
  overdue: boolean;
  hoursRemaining: number | null;
}

/**
 * `assessmentReviewFinalized` / `supportPlanRevisedAfterReturn` come from records outside the
 * episode, so the caller supplies them rather than this module guessing from the episode alone.
 */
export function buildReconciliationState({
  episode,
  assessmentReviewFinalized,
  supportPlanRevisedAfterReturn,
  now = new Date(),
}: {
  episode: HospitalEpisodeLike;
  assessmentReviewFinalized: boolean;
  supportPlanRevisedAfterReturn: boolean;
  now?: Date;
}): ReconciliationState {
  // Reconciliation only exists once the resident is back. While they are still out, the open work is
  // the stay itself.
  if (episode.status !== "returned" || !episode.return_time) {
    return {
      applicable: false, steps: [], outstanding: [], complete: false,
      deadline: null, overdue: false, hoursRemaining: null,
    };
  }

  const steps: ReconciliationStep[] = [
    {
      key: "discharge_paperwork",
      label: "Discharge paperwork received",
      why: "Without the discharge summary there is no authoritative record of what changed during the stay.",
      complete: Boolean(episode.discharge_document_id),
      notApplicable: false,
      responsibleRole: "Facility manager",
    },
    {
      key: "medication_reconciliation",
      label: "Medication changes reviewed",
      why: "A medication started, stopped, or changed in hospital that never reaches the MAR is the highest-consequence miss on this list.",
      complete: ["completed", "authorized_exception"].includes(episode.medication_reconciliation_status),
      notApplicable: episode.medication_reconciliation_status === "not_applicable",
      responsibleRole: "Facility manager",
    },
    {
      key: "changed_orders_acknowledged",
      label: "New physician orders acknowledged",
      why: "An order nobody acknowledged is an order nobody is carrying out.",
      complete: episode.changed_order_ack_status === "acknowledged",
      notApplicable: episode.changed_order_ack_status === "not_applicable",
      responsibleRole: "Facility manager",
    },
    {
      key: "assessment_review",
      label: "Hospital-return assessment review finalized",
      why: "The return review is what turns 'something changed' into recorded, comparable answers.",
      complete: assessmentReviewFinalized,
      notApplicable: !episode.assessment_review_required,
      responsibleRole: "Administrator",
    },
    {
      key: "support_plan_review",
      label: "Support plan revised or explicitly confirmed",
      why: "A plan that predates the stay is the conflict this whole workflow exists to prevent.",
      complete: supportPlanRevisedAfterReturn,
      notApplicable: !episode.support_plan_review_required,
      responsibleRole: "Administrator",
    },
  ];

  const outstanding = steps.filter((step) => !step.notApplicable && !step.complete);
  const returnedAt = new Date(episode.return_time);
  const deadline = Number.isNaN(returnedAt.getTime())
    ? null
    : new Date(returnedAt.getTime() + RECONCILIATION_DEADLINE_HOURS * 3_600_000);
  const hoursRemaining = deadline
    ? Math.round((deadline.getTime() - now.getTime()) / 3_600_000)
    : null;

  return {
    applicable: true,
    steps,
    outstanding,
    complete: outstanding.length === 0,
    deadline: deadline?.toISOString() ?? null,
    // An already-complete reconciliation is never overdue, however late it was finished.
    overdue: outstanding.length > 0 && Boolean(deadline) && now.getTime() > deadline!.getTime(),
    hoursRemaining,
  };
}

/** The changes the return recorded, as a list worth reading before revising a plan. */
export function recordedChanges(episode: HospitalEpisodeLike): { label: string; detail: string }[] {
  const entries: { label: string; detail: string }[] = [
    { label: "Condition", detail: episode.condition_changes ?? "" },
    { label: "Diet", detail: episode.diet_changes ?? "" },
    { label: "Mobility", detail: episode.mobility_changes ?? "" },
    { label: "Skin", detail: episode.skin_concerns ?? "" },
  ];
  return entries.filter((entry) => entry.detail.trim().length > 0);
}

/** The free-text change fields a return records, in the order the dialog asks for them. */
export const RETURN_CHANGE_FIELDS = [
  { key: "condition_changes", label: "Condition changes" },
  { key: "diet_changes", label: "Diet changes" },
  { key: "mobility_changes", label: "Mobility changes" },
  { key: "skin_concerns", label: "Skin concerns" },
  { key: "dme_changes", label: "Equipment changes" },
] as const;

export type ReturnChangeKey = typeof RETURN_CHANGE_FIELDS[number]["key"];

export interface SuggestedReviewFlags {
  assessmentReviewRequired: boolean;
  supportPlanReviewRequired: boolean;
  /** Why the suggestion came out this way, so the person can disagree knowingly. */
  reason: string;
}

/**
 * What the return form should propose for the two review-required flags.
 *
 * `complete_hospital_return` defaults both to true, which is the safe default for a *server*. On a
 * form it is the wrong default to leave unexplained: a person who ticks past two pre-checked boxes
 * on every return stops reading them, and the flags are what seed the return assessment review and
 * gate the reconciliation. So the suggestion is derived from what the person actually typed.
 *
 * Any recorded change means the plan predates something. Medication reconciliation still pending or
 * orders awaiting review means the same thing from the clinical side. With none of that, nothing on
 * this form says the stay changed anything -- and proposing a reassessment anyway is how the
 * proposal loses its meaning.
 */
export function suggestedReviewFlags(input: {
  changes: Partial<Record<ReturnChangeKey, string | null | undefined>>;
  medicationReconciliationStatus: string;
  changedOrderAckStatus: string;
}): SuggestedReviewFlags {
  const recorded = RETURN_CHANGE_FIELDS
    .filter((field) => (input.changes[field.key] ?? "").trim().length > 0)
    .map((field) => field.label.toLowerCase());
  const medicationOutstanding = input.medicationReconciliationStatus === "pending";
  const ordersOutstanding = input.changedOrderAckStatus === "pending_review";

  if (recorded.length === 0 && !medicationOutstanding && !ordersOutstanding) {
    return {
      assessmentReviewRequired: false,
      supportPlanReviewRequired: false,
      reason: "Nothing on this form records a change, so neither review is proposed. Tick them if the stay changed something this form does not capture.",
    };
  }

  const drivers = [
    ...recorded,
    ...(medicationOutstanding ? ["medication reconciliation still pending"] : []),
    ...(ordersOutstanding ? ["new orders awaiting review"] : []),
  ];
  return {
    assessmentReviewRequired: true,
    supportPlanReviewRequired: true,
    reason: `Proposed because this return records ${drivers.join(", ")}. A plan written before the stay predates that.`,
  };
}

export function episodeStateLabel(episode: HospitalEpisodeLike): string {
  if (episode.status === "out") return "Out at hospital";
  if (episode.status === "canceled") return "Cancelled";
  return "Returned";
}
