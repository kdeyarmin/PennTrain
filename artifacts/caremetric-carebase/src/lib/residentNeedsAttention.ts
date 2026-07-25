// Resident "Needs Attention" evaluator (program plan Phase 1c).
//
// One prioritized answer to "what requires attention for this resident today?", unioning signals
// that are currently scattered across the compliance checklist, the move-in packet, the change-of-
// condition queue, the incident list, the agreement workspace, and the care-level review.
//
// Two rules govern everything in this file:
//
//   1. Every card is derived from records, never from a score. The request is explicit about this
//      for change detection ("do not create a black-box AI risk score") and the same standard
//      applies here: a card states what is true, which records make it true, and what to do.
//   2. A card only exists if the data behind it exists today. Several cards named in the request --
//      "increased assistance documented" and refusal-specific counts -- need the structured service
//      exceptions that arrive with the floor-execution phase. They are deliberately absent rather
//      than approximated from free text; see UNAVAILABLE_CARDS below, which the UI renders as a
//      stated limitation so the panel never implies coverage it does not have.
//
// Pure and injectable-clock, in the style of moveInReadiness.ts / careLevelReview.ts.

export type NeedsAttentionSeverity = "urgent" | "high" | "attention" | "info";

export type NeedsAttentionKind =
  | "assessment_overdue"
  | "support_plan_review"
  | "support_plan_missing"
  | "change_of_condition_open"
  | "incident_follow_up"
  | "hospital_return_reconciliation"
  | "agreement_unsigned"
  | "missing_physician"
  | "fall_cluster"
  | "service_exceptions"
  | "missing_state_form"
  | "care_level_review"
  | "move_in_blockers"
  | "care_profile_stale";

export interface NeedsAttentionCard {
  id: string;
  kind: NeedsAttentionKind;
  severity: NeedsAttentionSeverity;
  /** What is true. */
  title: string;
  /** Why it matters, in the words an administrator would use defending it at survey. */
  why: string;
  /** The records behind the card, so nothing is asserted without a source. */
  evidence: string;
  /** Role expected to act. Not a person -- per-card ownership arrives with the work-item contract. */
  owner: string;
  dueDate: string | null;
  since: string | null;
  actionLabel: string;
  href: string;
}

export interface NeedsAttentionComplianceItemLike {
  id: string;
  item_type: string;
  status: string;
  due_date?: string | null;
  completed_date?: string | null;
}
export interface NeedsAttentionDocumentLike {
  compliance_item_id?: string | null;
  is_state_form?: boolean | null;
}
export interface NeedsAttentionChangeEventLike {
  id: string;
  category: string;
  status: string;
  identified_at: string;
  follow_up_due_at?: string | null;
}
export interface NeedsAttentionIncidentLike {
  id: string;
  incident_type: string;
  status: string;
  occurred_at: string;
}
export interface NeedsAttentionAgreementLike {
  id: string;
  status?: string | null;
  title?: string | null;
}
export interface NeedsAttentionResidentLike {
  id: string;
  status: string;
  primary_physician_name?: string | null;
  primary_physician_phone?: string | null;
}

export interface NeedsAttentionInput {
  resident: NeedsAttentionResidentLike;
  residentHref: string;
  complianceItems: NeedsAttentionComplianceItemLike[];
  documents: NeedsAttentionDocumentLike[];
  changeEvents: NeedsAttentionChangeEventLike[];
  incidents: NeedsAttentionIncidentLike[];
  agreements: NeedsAttentionAgreementLike[];
  /** Blocker count from buildMoveInReadinessPacket(), so the packet stays the single source. */
  moveInBlockers: number;
  hospitalState: "in_facility" | "out_at_hospital" | "returned_reconciliation_incomplete";
  hospitalSince: string | null;
  supportPlan: { versionNumber: number; state: string; reviewDueDate: string | null } | null;
  careProfileStale: boolean;
  careProfileAsOf: string | null;
  /** Aggregate from get_resident_360_snapshot. Split into typed exception kinds in a later phase. */
  serviceExceptionsLast7Days: number;
  /** Flags from careLevelReview.ts, already computed by the caller. */
  careLevelFlags: { kind: string; message: string }[];
  now?: Date;
}

const SEVERITY_RANK: Record<NeedsAttentionSeverity, number> = { urgent: 4, high: 3, attention: 2, info: 1 };

/** 55 Pa. Code Ch. 2600/2800 reassessment cadence -- the same constant careLevelReview.ts uses. */
const ANNUAL_DAYS = 365;

/** Three falls in thirty days is the request's stated clustering threshold. */
export const FALL_CLUSTER_COUNT = 3;
export const FALL_CLUSTER_WINDOW_DAYS = 30;

/** Service-delivery exceptions in a 7-day window before the pattern is worth a human look. */
export const SERVICE_EXCEPTION_THRESHOLD = 3;

const ASSESSMENT_ITEM_TYPES = new Set([
  "preadmission_screening",
  "initial_assessment_15day",
  "annual_reassessment",
  "significant_change_reassessment",
]);

const OPEN_COMPLIANCE_STATUSES = new Set(["missing", "expired", "due_soon", "overdue"]);

/**
 * resident_agreements.status is pending_signature | partially_executed | executed | refused |
 * unable_to_sign | voided. Only the first two are outstanding work.
 */
const OPEN_AGREEMENT_STATUSES = new Set(["pending_signature", "partially_executed"]);

/**
 * Cards named in the request that this phase deliberately does not compute, and what unblocks each.
 * Surfaced in the UI: a panel that silently omits a promised check is worse than one that says which
 * checks it does not yet run.
 */
export const UNAVAILABLE_CARDS: { label: string; blockedBy: string }[] = [
  {
    label: "Increased assistance documented",
    blockedBy: "Needs structured service-exception documentation (floor-execution phase).",
  },
  {
    label: "Repeated service refusals",
    blockedBy: "Needs refusal-typed exception records; today only an aggregate exception count exists.",
  },
  {
    label: "Care-level review recommended",
    blockedBy:
      "Evaluator supports it, but the resident page does not yet load rate agreements — wiring lands with the Financial tab.",
  },
];

function daysBetween(from: string | null | undefined, now: Date): number | null {
  if (!from) return null;
  const at = new Date(from);
  if (Number.isNaN(at.getTime())) return null;
  return Math.floor((now.getTime() - at.getTime()) / 86_400_000);
}

function isOverdue(dueDate: string | null | undefined, now: Date): boolean {
  const days = daysBetween(dueDate, now);
  return days !== null && days > 0;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildResidentNeedsAttention(input: NeedsAttentionInput): NeedsAttentionCard[] {
  const now = input.now ?? new Date();
  const base = input.residentHref;
  const cards: NeedsAttentionCard[] = [];

  // A discharged resident has no live obligations; keeping the panel loud after discharge trains
  // people to ignore it. Records stay reachable through the tabs.
  if (input.resident.status === "discharged") return cards;

  // --- Assessment and state-form obligations -------------------------------------------------
  const assessmentItems = input.complianceItems.filter((item) => ASSESSMENT_ITEM_TYPES.has(item.item_type));
  for (const item of assessmentItems) {
    if (!OPEN_COMPLIANCE_STATUSES.has(item.status)) continue;
    const overdue = isOverdue(item.due_date, now);
    cards.push({
      id: `assessment-${item.id}`,
      kind: "assessment_overdue",
      severity: overdue ? "urgent" : "high",
      title: overdue ? "Assessment overdue" : "Assessment due soon",
      why: "PA requires a current assessment on the DHS-prescribed form before care decisions rest on it.",
      evidence: `Compliance item ${item.item_type} is ${item.status}.`,
      owner: "Administrator",
      dueDate: item.due_date ?? null,
      since: null,
      actionLabel: "Open compliance checklist",
      href: `${base}?tab=assessments`,
    });
  }

  // A completed assessment item with no signed state form attached is a documentation gap even
  // though the checklist reads "compliant" -- complete_resident_compliance_item() requires the form,
  // so this catches rows completed before that rule, or completed against a non-state document.
  const signedFormItemIds = new Set(
    input.documents.filter((doc) => doc.is_state_form && doc.compliance_item_id).map((doc) => doc.compliance_item_id),
  );
  for (const item of assessmentItems) {
    if (OPEN_COMPLIANCE_STATUSES.has(item.status)) continue;
    if (item.status === "not_applicable") continue;
    if (signedFormItemIds.has(item.id)) continue;
    cards.push({
      id: `state-form-${item.id}`,
      kind: "missing_state_form",
      severity: "high",
      title: "Signed state form not on file",
      why: "Only the signed DHS-prescribed form satisfies the requirement; a completed checklist row alone does not.",
      evidence: `Compliance item ${item.item_type} is ${item.status} with no linked state-form document.`,
      owner: "Administrator",
      dueDate: item.due_date ?? null,
      since: item.completed_date ?? null,
      actionLabel: "Upload signed form",
      href: `${base}?tab=assessments`,
    });
  }

  // --- Support plan ---------------------------------------------------------------------------
  if (!input.supportPlan) {
    cards.push({
      id: "support-plan-missing",
      kind: "support_plan_missing",
      severity: "high",
      title: "No support plan on file",
      why: "Care delivery and staff tasks derive from the support plan; without one, nothing downstream is governed.",
      evidence: "No support-plan version exists for this resident.",
      owner: "Administrator",
      dueDate: null,
      since: null,
      actionLabel: "Start support plan",
      href: `${base}?tab=support-plan`,
    });
  } else if (isOverdue(input.supportPlan.reviewDueDate, now)) {
    cards.push({
      id: "support-plan-review",
      kind: "support_plan_review",
      severity: "urgent",
      title: "Support-plan review overdue",
      why: "An out-of-date plan means staff tasks may no longer match assessed needs.",
      evidence: `Version ${input.supportPlan.versionNumber} (${input.supportPlan.state}) review was due ${input.supportPlan.reviewDueDate}.`,
      owner: "Administrator",
      dueDate: input.supportPlan.reviewDueDate,
      since: null,
      actionLabel: "Review support plan",
      href: `${base}?tab=support-plan`,
    });
  }

  // --- Change of condition --------------------------------------------------------------------
  const openChanges = input.changeEvents.filter((event) => event.status !== "closed");
  for (const event of openChanges) {
    const overdue = isOverdue(event.follow_up_due_at, now);
    const age = daysBetween(event.identified_at, now);
    cards.push({
      id: `change-${event.id}`,
      kind: "change_of_condition_open",
      severity: overdue ? "urgent" : "high",
      title: overdue ? "Change-of-condition follow-up overdue" : "Open change in condition",
      why: "An unresolved condition change leaves notification, monitoring, and reassessment steps unproven.",
      evidence: `${event.category} identified ${event.identified_at}${age !== null ? ` (${formatCount(age, "day")} ago)` : ""}.`,
      owner: "Facility manager",
      dueDate: event.follow_up_due_at ?? null,
      since: event.identified_at,
      actionLabel: "Open change record",
      href: `/app/change-of-condition/${event.id}`,
    });
  }

  // --- Incidents ------------------------------------------------------------------------------
  const openIncidents = input.incidents.filter((incident) => incident.status !== "closed");
  for (const incident of openIncidents) {
    cards.push({
      id: `incident-${incident.id}`,
      kind: "incident_follow_up",
      severity: "high",
      title: "Open incident follow-up",
      why: "An incident is not complete when the form is submitted; notification, investigation, and review still have to close.",
      evidence: `${incident.incident_type} on ${incident.occurred_at}, status ${incident.status}.`,
      owner: "Administrator",
      dueDate: null,
      since: incident.occurred_at,
      actionLabel: "Open incident",
      href: `/app/incidents/${incident.id}`,
    });
  }

  // Falls are counted from both incidents and change events, because a fall without injury is
  // routinely recorded only as a condition change. Counting one source would undercount the cluster.
  const fallWindowStart = now.getTime() - FALL_CLUSTER_WINDOW_DAYS * 86_400_000;
  const recentFalls = [
    ...input.incidents
      .filter((incident) => /fall/i.test(incident.incident_type))
      .map((incident) => incident.occurred_at),
    ...input.changeEvents.filter((event) => event.category === "fall").map((event) => event.identified_at),
  ].filter((at) => {
    const time = new Date(at).getTime();
    return !Number.isNaN(time) && time >= fallWindowStart && time <= now.getTime();
  });
  if (recentFalls.length >= FALL_CLUSTER_COUNT) {
    cards.push({
      id: "fall-cluster",
      kind: "fall_cluster",
      severity: "urgent",
      title: `${formatCount(recentFalls.length, "fall")} in ${FALL_CLUSTER_WINDOW_DAYS} days`,
      why: "Repeat falls indicate the current fall-prevention interventions are not working.",
      evidence: `${formatCount(recentFalls.length, "fall record")} across incidents and condition changes since ${new Date(fallWindowStart).toISOString().slice(0, 10)}.`,
      owner: "Administrator",
      dueDate: null,
      since: recentFalls.sort()[0] ?? null,
      actionLabel: "Review falls",
      href: `${base}?tab=incidents`,
    });
  }

  // --- Hospital return ------------------------------------------------------------------------
  if (input.hospitalState === "returned_reconciliation_incomplete") {
    cards.push({
      id: "hospital-return",
      kind: "hospital_return_reconciliation",
      severity: "urgent",
      title: "Hospital return reconciliation incomplete",
      why: "Medication changes and new orders from the stay are not confirmed against the resident's current care.",
      evidence: `Returned ${input.hospitalSince ?? "recently"} with medication reconciliation or order acknowledgement still pending.`,
      owner: "Facility manager",
      dueDate: null,
      since: input.hospitalSince,
      actionLabel: "Complete reconciliation",
      href: `${base}?tab=timeline`,
    });
  }

  // --- Agreements -----------------------------------------------------------------------------
  // Only genuinely open signature states count. `refused` and `unable_to_sign` are *documented
  // outcomes* -- the move-in packet already treats a recorded refusal as satisfying the rights
  // acknowledgement -- and `voided` is not an obligation. Flagging those would manufacture work
  // that has no correct resolution.
  const unsigned = input.agreements.filter((agreement) =>
    OPEN_AGREEMENT_STATUSES.has((agreement.status ?? "").toLowerCase()));
  for (const agreement of unsigned) {
    cards.push({
      id: `agreement-${agreement.id}`,
      kind: "agreement_unsigned",
      severity: "attention",
      title: "Agreement not signed",
      why: "An unsigned resident agreement is a survey finding and leaves the financial relationship undocumented.",
      evidence: `${agreement.title ?? "Resident agreement"} is ${agreement.status}.`,
      owner: "Administrator",
      dueDate: null,
      since: null,
      actionLabel: "Open agreements",
      href: `${base}?tab=financial`,
    });
  }

  // --- Contacts -------------------------------------------------------------------------------
  if (!input.resident.primary_physician_name?.trim() || !input.resident.primary_physician_phone?.trim()) {
    cards.push({
      id: "missing-physician",
      kind: "missing_physician",
      severity: "high",
      title: "Physician information incomplete",
      why: "Provider notification is a required step in every condition change and incident pathway.",
      evidence: input.resident.primary_physician_name?.trim()
        ? "Physician name on file with no phone number."
        : "No primary physician recorded.",
      owner: "Administrator",
      dueDate: null,
      since: null,
      actionLabel: "Edit contacts",
      href: `${base}?tab=overview`,
    });
  }

  // --- Move-in readiness ----------------------------------------------------------------------
  if (input.moveInBlockers > 0) {
    cards.push({
      id: "move-in-blockers",
      kind: "move_in_blockers",
      severity: "high",
      title: `${formatCount(input.moveInBlockers, "move-in blocker")}`,
      why: "Admission documentation gaps are the most common resident-record finding at survey.",
      evidence: "Move-in readiness packet reports unresolved blockers.",
      owner: "Administrator",
      dueDate: null,
      since: null,
      actionLabel: "Open readiness packet",
      href: `${base}?tab=overview`,
    });
  }

  // --- Service delivery -----------------------------------------------------------------------
  if (input.serviceExceptionsLast7Days >= SERVICE_EXCEPTION_THRESHOLD) {
    cards.push({
      id: "service-exceptions",
      kind: "service_exceptions",
      severity: "attention",
      title: `${formatCount(input.serviceExceptionsLast7Days, "service exception")} in 7 days`,
      why: "Repeated refusals or missed services are the earliest signal that the plan no longer fits the resident.",
      evidence: "Aggregate service-task exception count from the resident snapshot.",
      owner: "Facility manager",
      dueDate: null,
      since: null,
      actionLabel: "Review care delivery",
      href: `${base}?tab=care`,
    });
  }

  // --- Care-level review ----------------------------------------------------------------------
  for (const flag of input.careLevelFlags) {
    cards.push({
      id: `care-level-${flag.kind}`,
      kind: "care_level_review",
      severity: "attention",
      title: "Care-level review recommended",
      why: "The billed level of care should be substantiated by a current assessment.",
      evidence: flag.message,
      owner: "Administrator",
      dueDate: null,
      since: null,
      actionLabel: "Open care-level review",
      href: `${base}?tab=financial`,
    });
  }

  // --- Care header currency -------------------------------------------------------------------
  if (input.careProfileStale) {
    const age = daysBetween(input.careProfileAsOf, now);
    cards.push({
      id: "care-profile-stale",
      kind: "care_profile_stale",
      severity: "attention",
      title: input.careProfileAsOf ? "Care header out of date" : "Care header never reviewed",
      why: "Staff read the header as current; an unreviewed header quietly presents defaults as assessed facts.",
      evidence: input.careProfileAsOf
        ? `Last reviewed ${input.careProfileAsOf}${age !== null ? ` (${formatCount(age, "day")} ago)` : ""}.`
        : "No recorded review of the coded care fields.",
      owner: "Administrator",
      dueDate: null,
      since: input.careProfileAsOf,
      actionLabel: "Review care header",
      href: `${base}?tab=overview`,
    });
  }

  // Highest severity first; within a severity, the oldest due date leads, then a stable id sort so
  // the panel does not reshuffle between renders.
  return cards.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function summarizeNeedsAttention(cards: NeedsAttentionCard[]) {
  return {
    total: cards.length,
    urgent: cards.filter((card) => card.severity === "urgent").length,
    high: cards.filter((card) => card.severity === "high").length,
    attention: cards.filter((card) => card.severity === "attention").length,
  };
}
