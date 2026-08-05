import { describe, expect, it } from "vitest";
import {
  buildReconciliationState, episodeStateLabel, RECONCILIATION_DEADLINE_HOURS, recordedChanges,
  RETURN_CHANGE_FIELDS, suggestedReviewFlags,
  type HospitalEpisodeLike,
} from "./hospitalReconciliation";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

/** A returned resident with every step still outstanding. */
function episode(overrides: Partial<HospitalEpisodeLike> = {}): HospitalEpisodeLike {
  return {
    id: "ep-1",
    status: "returned",
    transfer_time: hoursAgo(72),
    return_time: hoursAgo(4),
    destination: "Mercy General",
    reason: "Shortness of breath",
    discharge_document_id: null,
    medication_reconciliation_status: "pending",
    changed_order_ack_status: "pending_review",
    assessment_review_required: true,
    support_plan_review_required: true,
    ...overrides,
  };
}

const state = (overrides: Partial<HospitalEpisodeLike> = {}, flags = {}) =>
  buildReconciliationState({
    episode: episode(overrides),
    assessmentReviewFinalized: false,
    supportPlanRevisedAfterReturn: false,
    now: NOW,
    ...flags,
  });

describe("applicability", () => {
  it("does not apply while the resident is still out", () => {
    // The open work during a stay is the stay, not the reconciliation.
    const result = state({ status: "out", return_time: null });
    expect(result.applicable).toBe(false);
    expect(result.steps).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it("does not apply to a cancelled episode", () => {
    expect(state({ status: "canceled", return_time: null }).applicable).toBe(false);
  });

  it("does not apply when the status says returned but no return time was recorded", () => {
    expect(state({ return_time: null }).applicable).toBe(false);
  });
});

describe("steps", () => {
  it("lists all five steps with a reason each", () => {
    const result = state();
    expect(result.steps.map((step) => step.key)).toEqual([
      "discharge_paperwork", "medication_reconciliation", "changed_orders_acknowledged",
      "assessment_review", "support_plan_review",
    ]);
    for (const step of result.steps) {
      expect(step.label).toBeTruthy();
      expect(step.why.length).toBeGreaterThan(20);
      expect(step.responsibleRole).toBeTruthy();
    }
  });

  it("counts every step outstanding on a fresh return", () => {
    const result = state();
    expect(result.outstanding).toHaveLength(5);
    expect(result.complete).toBe(false);
  });

  it("marks discharge paperwork complete once a document is linked", () => {
    const result = state({ discharge_document_id: "doc-1" });
    expect(result.steps.find((step) => step.key === "discharge_paperwork")!.complete).toBe(true);
  });

  it("accepts an authorized exception as medication reconciliation", () => {
    // A documented exception is a decision, not an omission.
    expect(state({ medication_reconciliation_status: "completed" })
      .steps.find((s) => s.key === "medication_reconciliation")!.complete).toBe(true);
    expect(state({ medication_reconciliation_status: "authorized_exception" })
      .steps.find((s) => s.key === "medication_reconciliation")!.complete).toBe(true);
  });

  it("treats not-applicable statuses as not outstanding rather than complete", () => {
    const result = state({
      medication_reconciliation_status: "not_applicable",
      changed_order_ack_status: "not_applicable",
    });
    const med = result.steps.find((step) => step.key === "medication_reconciliation")!;
    expect(med.notApplicable).toBe(true);
    expect(med.complete).toBe(false);
    expect(result.outstanding.map((step) => step.key)).not.toContain("medication_reconciliation");
  });

  it("drops the assessment and plan steps when the return did not flag them", () => {
    const result = state({ assessment_review_required: false, support_plan_review_required: false });
    expect(result.outstanding.map((step) => step.key)).toEqual([
      "discharge_paperwork", "medication_reconciliation", "changed_orders_acknowledged",
    ]);
  });

  it("reads the assessment and plan steps from records outside the episode", () => {
    const result = state({}, { assessmentReviewFinalized: true, supportPlanRevisedAfterReturn: true });
    expect(result.outstanding.map((step) => step.key)).toEqual([
      "discharge_paperwork", "medication_reconciliation", "changed_orders_acknowledged",
    ]);
  });

  it("is complete only when nothing applicable is outstanding", () => {
    const result = buildReconciliationState({
      episode: episode({
        discharge_document_id: "doc-1",
        medication_reconciliation_status: "completed",
        changed_order_ack_status: "acknowledged",
      }),
      assessmentReviewFinalized: true,
      supportPlanRevisedAfterReturn: true,
      now: NOW,
    });
    expect(result.complete).toBe(true);
    expect(result.outstanding).toEqual([]);
  });
});

describe("deadline", () => {
  it("sets the deadline a fixed window after the return", () => {
    const result = state({ return_time: hoursAgo(4) });
    expect(result.deadline).toBe(new Date(new Date(hoursAgo(4)).getTime() + RECONCILIATION_DEADLINE_HOURS * 3_600_000).toISOString());
    expect(result.hoursRemaining).toBe(RECONCILIATION_DEADLINE_HOURS - 4);
    expect(result.overdue).toBe(false);
  });

  it("goes overdue once the window passes with steps outstanding", () => {
    const result = state({ return_time: hoursAgo(RECONCILIATION_DEADLINE_HOURS + 2) });
    expect(result.overdue).toBe(true);
    expect(result.hoursRemaining).toBeLessThan(0);
  });

  it("is never overdue once complete, however late it was finished", () => {
    const result = buildReconciliationState({
      episode: episode({
        return_time: hoursAgo(200),
        discharge_document_id: "doc-1",
        medication_reconciliation_status: "completed",
        changed_order_ack_status: "acknowledged",
      }),
      assessmentReviewFinalized: true,
      supportPlanRevisedAfterReturn: true,
      now: NOW,
    });
    expect(result.complete).toBe(true);
    expect(result.overdue).toBe(false);
  });

  it("tolerates an unparseable return time without throwing", () => {
    const result = state({ return_time: "not-a-date" });
    expect(result.deadline).toBeNull();
    expect(result.overdue).toBe(false);
  });
});

describe("recorded changes", () => {
  it("lists only the change fields that were filled in", () => {
    expect(recordedChanges(episode({
      diet_changes: "Now on minced and moist",
      mobility_changes: "  ",
      skin_concerns: "Stage 1 on left heel",
    }))).toEqual([
      { label: "Diet", detail: "Now on minced and moist" },
      { label: "Skin", detail: "Stage 1 on left heel" },
    ]);
  });

  it("returns nothing when the return recorded no changes", () => {
    expect(recordedChanges(episode())).toEqual([]);
  });
});

describe("state label", () => {
  it("names each episode state", () => {
    expect(episodeStateLabel(episode({ status: "out" }))).toBe("Out at hospital");
    expect(episodeStateLabel(episode({ status: "canceled" }))).toBe("Cancelled");
    expect(episodeStateLabel(episode())).toBe("Returned");
  });
});

describe("suggested review flags", () => {
  const flags = (overrides: Parameters<typeof suggestedReviewFlags>[0]) => suggestedReviewFlags(overrides);
  const clean = {
    changes: {},
    medicationReconciliationStatus: "not_applicable",
    changedOrderAckStatus: "not_applicable",
  };

  it("proposes neither review when the form records no change at all", () => {
    // Pre-checking both on every return is how people stop reading them, and these flags are what
    // seed the return assessment review and gate the reconciliation.
    const result = flags(clean);
    expect(result.assessmentReviewRequired).toBe(false);
    expect(result.supportPlanReviewRequired).toBe(false);
    expect(result.reason).toContain("Tick them");
  });

  it("proposes both as soon as any change is recorded, and says which", () => {
    const result = flags({ ...clean, changes: { diet_changes: "Now on minced and moist" } });
    expect(result.assessmentReviewRequired).toBe(true);
    expect(result.supportPlanReviewRequired).toBe(true);
    expect(result.reason).toContain("diet changes");
  });

  it("ignores whitespace-only entries", () => {
    expect(flags({ ...clean, changes: { skin_concerns: "   " } }).assessmentReviewRequired).toBe(false);
  });

  it("treats pending medication reconciliation as a change on its own", () => {
    const result = flags({ ...clean, medicationReconciliationStatus: "pending" });
    expect(result.assessmentReviewRequired).toBe(true);
    expect(result.reason).toContain("medication reconciliation still pending");
  });

  it("treats orders awaiting review as a change on its own", () => {
    const result = flags({ ...clean, changedOrderAckStatus: "pending_review" });
    expect(result.supportPlanReviewRequired).toBe(true);
    expect(result.reason).toContain("new orders awaiting review");
  });

  it("names every driver, not just the first", () => {
    const result = flags({
      changes: { diet_changes: "Minced", mobility_changes: "Now uses a walker" },
      medicationReconciliationStatus: "pending",
      changedOrderAckStatus: "pending_review",
    });
    for (const fragment of ["diet changes", "mobility changes", "medication reconciliation", "new orders"]) {
      expect(result.reason).toContain(fragment);
    }
  });

  it("covers every change field the dialog can write", () => {
    // A field the dialog collects but this function ignores would silently stop proposing a review.
    for (const field of RETURN_CHANGE_FIELDS) {
      expect(flags({ ...clean, changes: { [field.key]: "something" } }).assessmentReviewRequired).toBe(true);
    }
  });
});
