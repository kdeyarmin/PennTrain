import { describe, expect, it } from "vitest";
import {
  allowedSupportPlanTransitions, canTransitionSupportPlan, diffSupportPlanVersions,
  isActivationOverdue, isSupportPlanInFlight, isSupportPlanState, summarizePlanDiff,
  SUPPORT_PLAN_STATE_DESCRIPTIONS,
  SUPPORT_PLAN_STATE_LABELS, SUPPORT_PLAN_STATES, supportPlanStateLabel, transitionRequiresReason,
} from "./supportPlanLifecycle";

describe("state set", () => {
  it("carries the nine lifecycle states", () => {
    expect(SUPPORT_PLAN_STATES).toEqual([
      "draft", "awaiting_clinical_review", "awaiting_participation", "awaiting_signature",
      "approved", "active", "revision_required", "superseded", "closed",
    ]);
  });

  it("labels and describes every state", () => {
    for (const state of SUPPORT_PLAN_STATES) {
      expect(SUPPORT_PLAN_STATE_LABELS[state]).toBeTruthy();
      expect(SUPPORT_PLAN_STATE_DESCRIPTIONS[state]).toBeTruthy();
    }
  });

  it("passes an unrecognized state through rather than rendering blank", () => {
    // A row written by an older release must still show something a human can read.
    expect(supportPlanStateLabel("some_legacy_state")).toBe("some_legacy_state");
    expect(isSupportPlanState("some_legacy_state")).toBe(false);
  });
});

describe("transitions", () => {
  it("walks the happy path from draft to approved", () => {
    expect(canTransitionSupportPlan("draft", "awaiting_clinical_review")).toBe(true);
    expect(canTransitionSupportPlan("awaiting_clinical_review", "awaiting_participation")).toBe(true);
    expect(canTransitionSupportPlan("awaiting_participation", "awaiting_signature")).toBe(true);
    expect(canTransitionSupportPlan("awaiting_signature", "approved")).toBe(true);
  });

  it("never offers 'active' as a generic transition", () => {
    // Putting a plan in force also generates service requirements, so it goes through the approval
    // RPC. Offering it here would produce a button that always fails.
    for (const state of SUPPORT_PLAN_STATES) {
      expect(allowedSupportPlanTransitions(state)).not.toContain("active");
    }
  });

  it("allows rework from every review stage", () => {
    for (const state of ["awaiting_clinical_review", "awaiting_participation", "awaiting_signature", "approved", "active"]) {
      expect(canTransitionSupportPlan(state, "revision_required")).toBe(true);
    }
  });

  it("restarts the review cycle after rework instead of reactivating", () => {
    expect(canTransitionSupportPlan("revision_required", "draft")).toBe(true);
    expect(canTransitionSupportPlan("revision_required", "active")).toBe(false);
    expect(canTransitionSupportPlan("revision_required", "approved")).toBe(false);
  });

  it("treats closed as terminal", () => {
    expect(allowedSupportPlanTransitions("closed")).toEqual([]);
  });

  it("lets a superseded plan only be closed", () => {
    expect(allowedSupportPlanTransitions("superseded")).toEqual(["closed"]);
  });

  it("rejects skipping participation or signature", () => {
    expect(canTransitionSupportPlan("awaiting_clinical_review", "approved")).toBe(false);
    expect(canTransitionSupportPlan("draft", "approved")).toBe(false);
    expect(canTransitionSupportPlan("awaiting_participation", "approved")).toBe(false);
  });

  it("rejects unknown states on either side", () => {
    expect(canTransitionSupportPlan("nonsense", "draft")).toBe(false);
    expect(canTransitionSupportPlan("draft", "nonsense")).toBe(false);
    expect(allowedSupportPlanTransitions("nonsense")).toEqual([]);
  });

  it("requires a reason only for rework", () => {
    expect(transitionRequiresReason("revision_required")).toBe(true);
    expect(transitionRequiresReason("awaiting_participation")).toBe(false);
    expect(transitionRequiresReason("closed")).toBe(false);
  });

  it("classifies in-flight versus settled states", () => {
    expect(isSupportPlanInFlight("draft")).toBe(true);
    expect(isSupportPlanInFlight("revision_required")).toBe(true);
    expect(isSupportPlanInFlight("active")).toBe(false);
    expect(isSupportPlanInFlight("superseded")).toBe(false);
    expect(isSupportPlanInFlight("closed")).toBe(false);
  });
});

describe("version comparison", () => {
  const v1 = {
    version_number: 1,
    needs: [{ key: "toileting", need: "Requires extensive toileting assistance" }],
    goals: [],
    services: [
      { key: "toileting-schedule", service_name: "Scheduled toileting", frequency: "hourly", requires_two_staff: false },
      { key: "walker", service_name: "Walker within reach", frequency: "daily" },
    ],
    interventions: [{ key: "cue", intervention: "Cue resident to call for help" }],
  };

  it("reports every entry as added when there is no prior version", () => {
    // "No changes" on a v1 would be actively misleading.
    const diff = diffSupportPlanVersions(null, v1);
    expect(diff.fromVersion).toBeNull();
    expect(diff.toVersion).toBe(1);
    expect(diff.totalChanges).toBe(4);
    expect(summarizePlanDiff(diff)).toBe("4 added");
  });

  it("detects an added service", () => {
    const v2 = { ...v1, version_number: 2, services: [...v1.services, { key: "fall-checks", service_name: "Fall-prevention checks", frequency: "hourly" }] };
    const diff = diffSupportPlanVersions(v1, v2);
    const services = diff.sections.find((section) => section.section === "services")!;
    expect(services.added).toBe(1);
    expect(services.entries.find((entry) => entry.kind === "added")!.label).toBe("Fall-prevention checks");
  });

  it("detects a removed service", () => {
    const v2 = { ...v1, version_number: 2, services: [v1.services[0]] };
    const services = diffSupportPlanVersions(v1, v2).sections.find((section) => section.section === "services")!;
    expect(services.removed).toBe(1);
    expect(services.entries.find((entry) => entry.kind === "removed")!.label).toBe("Walker within reach");
  });

  it("names the exact fields that changed on a modified entry", () => {
    const v2 = {
      ...v1,
      version_number: 2,
      services: [
        { key: "toileting-schedule", service_name: "Scheduled toileting", frequency: "daily", requires_two_staff: true },
        v1.services[1],
      ],
    };
    const services = diffSupportPlanVersions(v1, v2).sections.find((section) => section.section === "services")!;
    const modified = services.entries.find((entry) => entry.kind === "modified")!;
    expect(modified.fieldChanges).toEqual([
      { field: "frequency", from: "hourly", to: "daily" },
      { field: "requires_two_staff", from: "false", to: "true" },
    ]);
  });

  it("marks untouched entries unchanged rather than omitting them", () => {
    const diff = diffSupportPlanVersions(v1, { ...v1, version_number: 2 });
    const services = diff.sections.find((section) => section.section === "services")!;
    expect(services.entries.every((entry) => entry.kind === "unchanged")).toBe(true);
    expect(diff.totalChanges).toBe(0);
    expect(summarizePlanDiff(diff)).toBe("No changes");
  });

  it("matches entries by label when no explicit key exists", () => {
    const before = { version_number: 1, services: [{ service_name: "Standby assistance", frequency: "daily" }] };
    const after = { version_number: 2, services: [{ service_name: "Standby assistance", frequency: "hourly" }] };
    const services = diffSupportPlanVersions(before, after).sections.find((section) => section.section === "services")!;
    expect(services.modified).toBe(1);
    expect(services.added).toBe(0);
  });

  it("shows an add plus a remove rather than inventing a modification for unrelated entries", () => {
    const before = { version_number: 1, services: [{ service_name: "Standby assistance" }] };
    const after = { version_number: 2, services: [{ service_name: "Two-person transfer" }] };
    const services = diffSupportPlanVersions(before, after).sections.find((section) => section.section === "services")!;
    expect(services.added).toBe(1);
    expect(services.removed).toBe(1);
    expect(services.modified).toBe(0);
  });

  it("detects a change inside a nested object rather than treating it as equal", () => {
    const before = { version_number: 1, services: [{ key: "s1", service_name: "Bathing", window: { start: "09:00", end: "11:00" } }] };
    const after = { version_number: 2, services: [{ key: "s1", service_name: "Bathing", window: { start: "07:00", end: "11:00" } }] };
    const services = diffSupportPlanVersions(before, after).sections.find((section) => section.section === "services")!;
    expect(services.modified).toBe(1);
    expect(services.entries[0].fieldChanges[0].field).toBe("window");
  });

  it("tolerates missing, null, and non-array sections without throwing", () => {
    const diff = diffSupportPlanVersions(
      { version_number: 1, needs: null, services: "not an array" as unknown },
      { version_number: 2 },
    );
    expect(diff.totalChanges).toBe(0);
    expect(diff.sections.map((section) => section.section)).toEqual(["needs", "goals", "services", "interventions"]);
  });

  it("ignores non-object entries inside a section array", () => {
    const diff = diffSupportPlanVersions(
      { version_number: 1, services: [null, "text", 42] as unknown },
      { version_number: 2, services: [{ service_name: "Real service" }] },
    );
    const services = diff.sections.find((section) => section.section === "services")!;
    expect(services.added).toBe(1);
    expect(services.removed).toBe(0);
  });

  it("summarizes mixed changes in a stable order", () => {
    const before = { version_number: 1, services: [{ key: "a", service_name: "A", frequency: "daily" }, { key: "b", service_name: "B" }] };
    const after = { version_number: 2, services: [{ key: "a", service_name: "A", frequency: "weekly" }, { key: "c", service_name: "C" }] };
    expect(summarizePlanDiff(diffSupportPlanVersions(before, after))).toBe("1 added, 1 removed, 1 changed");
  });
});

describe("isActivationOverdue", () => {
  const today = new Date(2026, 6, 26); // 26 July 2026, local

  it("is true once the effective date has passed", () => {
    expect(isActivationOverdue("2026-07-24", today)).toBe(true);
  });

  // The server's condition is `effective_date <= current_date`, so today counts. A plan effective
  // today whose promotion has not run is already late by the time anyone looks.
  it("is true on the effective date itself", () => {
    expect(isActivationOverdue("2026-07-26", today)).toBe(true);
  });

  it("is false for a plan legitimately scheduled ahead", () => {
    expect(isActivationOverdue("2026-08-03", today)).toBe(false);
  });

  it("is false when there is no effective date", () => {
    expect(isActivationOverdue(null, today)).toBe(false);
    expect(isActivationOverdue(undefined, today)).toBe(false);
  });

  // Regression guard: `new Date("2026-07-26")` is UTC midnight, which is 25 July in any western
  // zone -- a plan effective today would then read as NOT overdue, hiding the button precisely
  // when it is needed.
  it("compares calendar dates, not UTC instants", () => {
    expect(isActivationOverdue("2026-07-26", new Date(2026, 6, 26, 1, 0, 0))).toBe(true);
  });
});
