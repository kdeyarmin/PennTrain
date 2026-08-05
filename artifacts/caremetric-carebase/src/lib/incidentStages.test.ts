import { describe, expect, it } from "vitest";
import {
  AUTO_NOTIFIED_INCIDENT_TYPES,
  buildIncidentFollowThrough,
  buildIncidentStages,
  qapiConsiderationApplies,
  reviewStagesApply,
  type CorrectiveActionLike,
  type IncidentNotificationLike,
  type IncidentRowLike,
  type IncidentStageInput,
  type IncidentStageKey,
} from "./incidentStages";

const NOW = new Date("2026-07-25T12:00:00Z");

function incident(overrides: Partial<IncidentRowLike> = {}): IncidentRowLike {
  return {
    id: "incident-1",
    incident_type: "significant_injury",
    status: "investigating",
    severity: "major",
    occurred_at: "2026-07-24T08:00:00Z",
    resident_id: "resident-1",
    narrative: "Found on the floor of their room.",
    pathway_key: null,
    pathway_answers: null,
    pathway_completed_at: null,
    immediate_response: null,
    reportability_status: "pending_review",
    reportability_determined_at: null,
    reportability_rationale: null,
    investigation_started_at: null,
    investigation_findings: null,
    root_cause: null,
    root_cause_method: null,
    qapi_consideration: "pending",
    qapi_project_id: null,
    administrator_approved_at: null,
    final_report_submitted_at: null,
    closed_at: null,
    ...overrides,
  };
}

function input(overrides: Partial<IncidentStageInput> = {}): IncidentStageInput {
  return {
    incident: incident(),
    notifications: [],
    correctiveActions: [],
    assessmentReviewFinalized: false,
    supportPlanRevisedAfterIncident: false,
    now: NOW,
    ...overrides,
  };
}

function statusOf(stages: ReturnType<typeof buildIncidentStages>, key: IncidentStageKey) {
  return stages.find((stage) => stage.key === key)!.status;
}

/** An incident with everything done, used as the base for "one thing missing" cases. */
function completeInput(overrides: Partial<IncidentStageInput> = {}): IncidentStageInput {
  return input({
    incident: incident({
      status: "closed",
      pathway_key: "fall",
      pathway_completed_at: "2026-07-24T10:00:00Z",
      immediate_response: "Assisted to bed, vitals taken, no injury observed.",
      reportability_status: "not_reportable",
      reportability_determined_at: "2026-07-24T11:00:00Z",
      reportability_rationale: "No injury requiring treatment beyond first aid.",
      investigation_started_at: "2026-07-24T09:00:00Z",
      investigation_findings: "Resident reached for the call bell without their walker.",
      root_cause: "Call bell mounted out of reach from the chair.",
      root_cause_method: "five_whys",
      qapi_consideration: "linked",
      qapi_project_id: "qapi-1",
      administrator_approved_at: "2026-07-25T09:00:00Z",
      final_report_submitted_at: "2026-07-25T09:30:00Z",
      closed_at: "2026-07-25T10:00:00Z",
    }),
    correctiveActions: [{
      status: "completed", due_date: "2026-07-25",
      completed_date: "2026-07-25", verification_notes: "Bell relocated and tested.",
    }],
    assessmentReviewFinalized: true,
    supportPlanRevisedAfterIncident: true,
    ...overrides,
  });
}

describe("stage list shape", () => {
  it("produces the eleven required stages in order", () => {
    expect(buildIncidentStages(input()).map((stage) => stage.key)).toEqual([
      "immediate_response", "notifications", "reportability_review", "investigation",
      "root_cause", "corrective_action", "assessment_review", "support_plan_review",
      "qapi_consideration", "administrator_approval", "closure",
    ]);
  });

  it("gives every incomplete stage something concrete to do", () => {
    for (const stage of buildIncidentStages(input())) {
      if (stage.status === "complete" || stage.status === "not_applicable") {
        expect(stage.outstanding, stage.key).toBeNull();
      } else {
        expect(stage.outstanding, stage.key).toBeTruthy();
      }
    }
  });

  it("only names prerequisites that are stages", () => {
    const stages = buildIncidentStages(input());
    const keys = new Set(stages.map((stage) => stage.key));
    for (const stage of stages) {
      for (const prerequisite of stage.prerequisites) {
        expect(keys.has(prerequisite), `${stage.key} -> ${prerequisite}`).toBe(true);
      }
    }
  });
});

describe("immediate response", () => {
  it("is not started when nothing was recorded, and complete once it is", () => {
    expect(statusOf(buildIncidentStages(input()), "immediate_response")).toBe("not_started");
    expect(statusOf(
      buildIncidentStages(input({ incident: incident({ immediate_response: "Assisted to bed." }) })),
      "immediate_response",
    )).toBe("complete");
  });

  it("does not accept whitespace as a response", () => {
    expect(statusOf(
      buildIncidentStages(input({ incident: incident({ immediate_response: "   " }) })),
      "immediate_response",
    )).toBe("not_started");
  });
});

describe("notifications", () => {
  const pending = (due: string): IncidentNotificationLike => ({
    notification_type: "state_hotline", status: "pending", due_at: due, completed_at: null,
  });

  it("waits rather than claiming completeness while reportability is undetermined", () => {
    expect(statusOf(buildIncidentStages(input()), "notifications")).toBe("waiting");
  });

  it("becomes not required once a human determines the event is not reportable", () => {
    const stages = buildIncidentStages(input({
      incident: incident({ reportability_status: "not_reportable" }),
    }));
    expect(statusOf(stages, "notifications")).toBe("not_applicable");
  });

  it("does not treat a reportable event with no notification rows as done", () => {
    const stages = buildIncidentStages(input({
      incident: incident({ reportability_status: "reportable", immediate_response: "Assisted." }),
    }));
    expect(statusOf(stages, "notifications")).toBe("not_started");
  });

  it("is complete when every notification is completed", () => {
    const stages = buildIncidentStages(input({
      notifications: [{
        notification_type: "state_hotline", status: "completed",
        due_at: "2026-07-24T10:00:00Z", completed_at: "2026-07-24T09:00:00Z",
      }],
    }));
    expect(statusOf(stages, "notifications")).toBe("complete");
  });

  it("counts a row completed by timestamp even if its status lags", () => {
    const stages = buildIncidentStages(input({
      notifications: [{
        notification_type: "state_hotline", status: "pending",
        due_at: "2026-07-24T10:00:00Z", completed_at: "2026-07-24T09:00:00Z",
      }],
    }));
    expect(statusOf(stages, "notifications")).toBe("complete");
  });

  it("treats a stood-down notification as settled rather than outstanding", () => {
    // `not_required` is a row a person determined was not needed, with the reasoning written onto
    // it. Counting it as open would put every non-reportable fall back in the queue.
    const stages = buildIncidentStages(input({
      notifications: [{
        notification_type: "state_hotline", status: "not_required",
        due_at: "2026-07-24T10:00:00Z", completed_at: null,
      }],
    }));
    expect(statusOf(stages, "notifications")).toBe("not_applicable");
  });

  it("is complete, not merely not-required, when some rows were genuinely sent", () => {
    const stages = buildIncidentStages(input({
      notifications: [
        {
          notification_type: "state_hotline", status: "not_required",
          due_at: "2026-07-24T10:00:00Z", completed_at: null,
        },
        {
          notification_type: "law_enforcement", status: "completed",
          due_at: "2026-07-24T10:00:00Z", completed_at: "2026-07-24T09:00:00Z",
        },
      ],
    }));
    expect(statusOf(stages, "notifications")).toBe("complete");
  });

  it("reports overdue when a deadline has passed", () => {
    const stages = buildIncidentStages(input({ notifications: [pending("2026-07-24T10:00:00Z")] }));
    const stage = stages.find((entry) => entry.key === "notifications")!;
    expect(stage.status).toBe("overdue");
    expect(stage.outstanding).toContain("past the required deadline");
  });

  it("is not overdue while the deadline is still ahead", () => {
    expect(statusOf(
      buildIncidentStages(input({ notifications: [pending("2026-07-26T10:00:00Z")] })),
      "notifications",
    )).toBe("not_started");
  });
});

describe("reportability", () => {
  it("stays open until somebody decides, in either direction", () => {
    expect(statusOf(buildIncidentStages(input()), "reportability_review")).toBe("not_started");
    for (const status of ["reportable", "not_reportable"]) {
      expect(statusOf(
        buildIncidentStages(input({ incident: incident({ reportability_status: status }) })),
        "reportability_review",
      )).toBe("complete");
    }
  });
});

describe("investigation and root cause", () => {
  it("asks for a pathway first, then the questions, then the findings", () => {
    const noPathway = buildIncidentStages(input()).find((s) => s.key === "investigation")!;
    expect(noPathway.outstanding).toContain("pathway");

    const started = buildIncidentStages(input({
      incident: incident({ pathway_key: "fall", investigation_started_at: "2026-07-24T09:00:00Z" }),
    })).find((s) => s.key === "investigation")!;
    expect(started.status).toBe("in_progress");
    expect(started.outstanding).toContain("pathway questions");

    const answered = buildIncidentStages(input({
      incident: incident({ pathway_key: "fall", pathway_completed_at: "2026-07-24T10:00:00Z" }),
    })).find((s) => s.key === "investigation")!;
    expect(answered.outstanding).toContain("findings");
  });

  it("is complete only with both the questions and the findings", () => {
    expect(statusOf(buildIncidentStages(input({
      incident: incident({
        pathway_key: "fall", pathway_completed_at: "2026-07-24T10:00:00Z",
        investigation_findings: "Reached for the call bell.",
      }),
    })), "investigation")).toBe("complete");
  });

  it("treats a root cause with no named method as unfinished", () => {
    const stage = buildIncidentStages(input({
      incident: incident({ root_cause: "Call bell out of reach." }),
    })).find((s) => s.key === "root_cause")!;
    expect(stage.status).toBe("in_progress");
    expect(stage.outstanding).toContain("method");
  });

  it("is complete with both a cause and a method", () => {
    expect(statusOf(buildIncidentStages(input({
      incident: incident({ root_cause: "Call bell out of reach.", root_cause_method: "five_whys" }),
    })), "root_cause")).toBe("complete");
  });
});

describe("corrective action", () => {
  const action = (overrides: Partial<CorrectiveActionLike> = {}): CorrectiveActionLike => ({
    status: "open", due_date: "2026-07-30", completed_date: null, verification_notes: null,
    ...overrides,
  });

  it("treats no recorded action as unfinished rather than as nothing to do", () => {
    const stage = buildIncidentStages(input()).find((s) => s.key === "corrective_action")!;
    expect(stage.status).toBe("waiting");
    expect(stage.outstanding).toContain("none is needed is also an answer");
  });

  it("is in progress while actions are open and not yet due", () => {
    expect(statusOf(
      buildIncidentStages(input({ correctiveActions: [action()] })),
      "corrective_action",
    )).toBe("in_progress");
  });

  it("is overdue once a due date has passed", () => {
    expect(statusOf(
      buildIncidentStages(input({ correctiveActions: [action({ due_date: "2026-07-24" })] })),
      "corrective_action",
    )).toBe("overdue");
  });

  it("does not count a completed action as done until it is verified", () => {
    const stage = buildIncidentStages(input({
      correctiveActions: [action({ status: "completed", completed_date: "2026-07-25" })],
    })).find((s) => s.key === "corrective_action")!;
    expect(stage.status).toBe("in_progress");
    expect(stage.outstanding).toContain("verification");
  });

  it("is complete when every action is completed and verified", () => {
    expect(statusOf(buildIncidentStages(input({
      correctiveActions: [action({
        status: "completed", completed_date: "2026-07-25", verification_notes: "Bell relocated.",
      })],
    })), "corrective_action")).toBe("complete");
  });

  it("ignores cancelled actions entirely", () => {
    expect(statusOf(
      buildIncidentStages(input({ correctiveActions: [action({ status: "cancelled" })] })),
      "corrective_action",
    )).toBe("not_applicable");
  });
});

describe("resident review stages", () => {
  it("applies only to a resident-linked incident of major or worse severity", () => {
    expect(reviewStagesApply(incident({ severity: "major" }))).toBe(true);
    expect(reviewStagesApply(incident({ severity: "critical" }))).toBe(true);
    expect(reviewStagesApply(incident({ severity: "minor" }))).toBe(false);
    expect(reviewStagesApply(incident({ severity: "critical", resident_id: null }))).toBe(false);
  });

  it("marks both review stages not required for a minor event", () => {
    const stages = buildIncidentStages(input({ incident: incident({ severity: "minor" }) }));
    expect(statusOf(stages, "assessment_review")).toBe("not_applicable");
    expect(statusOf(stages, "support_plan_review")).toBe("not_applicable");
  });

  it("completes each review stage from evidence outside the incident row", () => {
    const stages = buildIncidentStages(input({
      assessmentReviewFinalized: true, supportPlanRevisedAfterIncident: true,
    }));
    expect(statusOf(stages, "assessment_review")).toBe("complete");
    expect(statusOf(stages, "support_plan_review")).toBe("complete");
  });
});

describe("QAPI consideration", () => {
  it("always applies to the kinds that warrant a pattern check, whatever the severity", () => {
    expect(qapiConsiderationApplies(incident({ incident_type: "medication_error", severity: "minor" }))).toBe(true);
    expect(qapiConsiderationApplies(incident({ incident_type: "abuse_allegation", severity: "minor" }))).toBe(true);
  });

  it("applies to any major or critical event", () => {
    expect(qapiConsiderationApplies(incident({ incident_type: "other", severity: "critical" }))).toBe(true);
  });

  it("does not apply to a minor property matter", () => {
    expect(qapiConsiderationApplies(incident({ incident_type: "other", severity: "minor" }))).toBe(false);
  });

  it("accepts 'not indicated' as a completed consideration", () => {
    expect(statusOf(
      buildIncidentStages(input({ incident: incident({ qapi_consideration: "not_indicated" }) })),
      "qapi_consideration",
    )).toBe("complete");
  });
});

describe("sequencing", () => {
  it("marks a stage waiting when the work before it is outstanding", () => {
    const stages = buildIncidentStages(input());
    expect(statusOf(stages, "root_cause")).toBe("waiting");
    expect(statusOf(stages, "administrator_approval")).toBe("waiting");
    expect(statusOf(stages, "closure")).toBe("waiting");
  });

  it("does not mark a stage waiting on a prerequisite that does not apply", () => {
    // support_plan_review waits on assessment_review; when the latter is not required the former
    // should still read as its own real state rather than blocked behind nothing.
    const stages = buildIncidentStages(input({
      incident: incident({ severity: "minor" }),
    }));
    expect(statusOf(stages, "support_plan_review")).toBe("not_applicable");
  });

  it("never demotes a stage that has already started", () => {
    const stages = buildIncidentStages(input({
      incident: incident({ root_cause: "Call bell out of reach." }),
    }));
    expect(statusOf(stages, "root_cause")).toBe("in_progress");
  });
});

describe("closure gate", () => {
  it("cannot close while anything required is outstanding", () => {
    const state = buildIncidentFollowThrough(input());
    expect(state.canClose).toBe(false);
    expect(state.blockingClosure.length).toBeGreaterThan(0);
  });

  it("can close when every required stage is complete and the report is recorded", () => {
    const state = buildIncidentFollowThrough(completeInput());
    expect(state.blockingClosure).toEqual([]);
    expect(state.canClose).toBe(true);
  });

  it("refuses closure without the final report even when every stage is done", () => {
    const state = buildIncidentFollowThrough(completeInput({
      incident: { ...completeInput().incident, final_report_submitted_at: null, status: "investigating" },
    }));
    expect(state.blockingClosure).toEqual([]);
    expect(state.canClose).toBe(false);
  });

  it("blocks closure on an unapproved investigation", () => {
    const base = completeInput();
    const state = buildIncidentFollowThrough({
      ...base,
      incident: { ...base.incident, administrator_approved_at: null },
    });
    expect(state.blockingClosure.map((stage) => stage.key)).toEqual(["administrator_approval"]);
    expect(state.canClose).toBe(false);
  });
});

describe("next action and counts", () => {
  it("points at the first thing to do on a fresh incident", () => {
    expect(buildIncidentFollowThrough(input()).nextAction?.key).toBe("immediate_response");
  });

  it("prefers an overdue stage over an earlier merely-unstarted one", () => {
    const state = buildIncidentFollowThrough(input({
      incident: incident({ reportability_status: "reportable" }),
      notifications: [{
        notification_type: "state_hotline", status: "pending",
        due_at: "2026-07-24T10:00:00Z", completed_at: null,
      }],
    }));
    expect(state.nextAction?.key).toBe("notifications");
    expect(state.overdueCount).toBe(1);
  });

  it("has no next action once everything is done", () => {
    expect(buildIncidentFollowThrough(completeInput()).nextAction).toBeNull();
  });

  it("counts progress over applicable stages only", () => {
    const state = buildIncidentFollowThrough(input({ incident: incident({ severity: "minor" }) }));
    // Both resident-review stages drop out for a minor event, and so does QAPI consideration —
    // a minor significant-injury event is not one of the always-considered kinds.
    expect(state.applicableCount).toBe(8);
    expect(state.completedCount).toBe(0);
  });
});

describe("AUTO_NOTIFIED_INCIDENT_TYPES", () => {
  // Mirrors the preset table in auto_create_incident_notifications (20260705144728). If a type is
  // added to the trigger and not here, the filing form demands a manual notification that the
  // database is about to create anyway; if a type is added here and not to the trigger, a
  // high-severity incident files with no notification at all -- so the pair has to stay in step.
  it("names every incident type the reporting form offers except the catch-all", () => {
    const formOptions = [
      "death", "elopement", "abuse_allegation", "neglect_allegation", "medication_error",
      "significant_injury", "assault", "fire", "environmental_emergency", "other",
    ];
    expect(formOptions.filter((type) => !AUTO_NOTIFIED_INCIDENT_TYPES.has(type))).toEqual(["other"]);
  });

  it("does not cover 'other', which is why the manual requirement still exists", () => {
    expect(AUTO_NOTIFIED_INCIDENT_TYPES.has("other")).toBe(false);
  });
});
