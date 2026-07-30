import { describe, expect, it } from "vitest";
import {
  COMPLETION_RESPONSE_LABELS, COMPLETION_RESPONSES, DEFAULT_COMPLETION_RESPONSES,
  completionResponseForServiceOutcome, defaultResponsesForKind, describeServiceDeliveryContract,
  isExceptionResponse, isFloorTaskKind, isServiceDeliveryContractValid,
  SERVICE_TASK_KIND_DESCRIPTIONS, SERVICE_TASK_KIND_LABELS, SERVICE_TASK_KINDS,
  taskKindHasDueWindow, validateServiceDeliveryContract, type ServiceDeliveryContract,
} from "./serviceDeliveryContract";

function contract(overrides: Partial<ServiceDeliveryContract> = {}): ServiceDeliveryContract {
  return {
    taskKind: "scheduled_care",
    requiredQualificationKey: null,
    acceptableCompletionResponses: [...DEFAULT_COMPLETION_RESPONSES],
    refusalHandling: "Offer again in 30 minutes and tell the shift lead if refused twice.",
    escalationConditions: null,
    escalateAfterExceptions: null,
    effectiveFrom: "2026-07-01",
    expiresOn: null,
    ...overrides,
  };
}

describe("vocabulary", () => {
  it("defines the seven task kinds", () => {
    expect(SERVICE_TASK_KINDS).toEqual([
      "scheduled_care", "shift_task", "weekly_task", "as_needed",
      "observation", "manager_review", "documentation_requirement",
    ]);
  });

  it("labels and describes every task kind", () => {
    for (const kind of SERVICE_TASK_KINDS) {
      expect(SERVICE_TASK_KIND_LABELS[kind]).toBeTruthy();
      expect(SERVICE_TASK_KIND_DESCRIPTIONS[kind]).toBeTruthy();
    }
  });

  it("defines the seven completion responses the request names", () => {
    expect(COMPLETION_RESPONSES).toEqual([
      "completed_as_planned", "completed_with_more_assistance", "partially_completed",
      "resident_refused", "resident_unavailable", "not_completed", "concern_observed",
    ]);
    for (const response of COMPLETION_RESPONSES) {
      expect(COMPLETION_RESPONSE_LABELS[response]).toBeTruthy();
    }
  });

  it("maps the manager's legacy statuses into the same structured response contract", () => {
    expect(completionResponseForServiceOutcome("completed")).toBe("completed_as_planned");
    expect(completionResponseForServiceOutcome("completed_late")).toBe("completed_as_planned");
    expect(completionResponseForServiceOutcome("completed_by_other")).toBe("completed_as_planned");
    expect(completionResponseForServiceOutcome("resident_refused")).toBe("resident_refused");
    expect(completionResponseForServiceOutcome("resident_unavailable")).toBe("resident_unavailable");
    expect(completionResponseForServiceOutcome("not_completed")).toBe("not_completed");
  });

  it("passes the structured vocabulary through unchanged and rejects unknown outcomes", () => {
    for (const response of COMPLETION_RESPONSES) {
      expect(completionResponseForServiceOutcome(response)).toBe(response);
    }
    expect(() => completionResponseForServiceOutcome("teleported")).toThrow(/Unsupported service outcome/);
  });

  it("treats only 'completed as planned' as a non-exception", () => {
    // That is the whole premise of exception-based documentation: one response closes a task with
    // nothing more to say, and every other response asks for more.
    expect(isExceptionResponse("completed_as_planned")).toBe(false);
    for (const response of COMPLETION_RESPONSES.filter((entry) => entry !== "completed_as_planned")) {
      expect(isExceptionResponse(response)).toBe(true);
    }
  });

  it("knows which kinds have a due window", () => {
    expect(taskKindHasDueWindow("scheduled_care")).toBe(true);
    expect(taskKindHasDueWindow("shift_task")).toBe(true);
    expect(taskKindHasDueWindow("weekly_task")).toBe(true);
    // An as-needed task has no window, so a missed-window alert on one would be meaningless.
    expect(taskKindHasDueWindow("as_needed")).toBe(false);
    expect(taskKindHasDueWindow("manager_review")).toBe(false);
  });

  it("separates floor work from manager work", () => {
    expect(isFloorTaskKind("scheduled_care")).toBe(true);
    expect(isFloorTaskKind("observation")).toBe(true);
    expect(isFloorTaskKind("manager_review")).toBe(false);
    expect(isFloorTaskKind("documentation_requirement")).toBe(false);
  });
});

describe("default responses per kind", () => {
  it("offers all seven for hands-on care", () => {
    expect(defaultResponsesForKind("scheduled_care")).toEqual(DEFAULT_COMPLETION_RESPONSES);
  });

  it("does not offer a resident refusal on manager or documentation work", () => {
    expect(defaultResponsesForKind("manager_review")).not.toContain("resident_refused");
    expect(defaultResponsesForKind("documentation_requirement")).not.toContain("resident_refused");
  });

  it("keeps 'concern observed' available on observation tasks", () => {
    expect(defaultResponsesForKind("observation")).toContain("concern_observed");
    expect(defaultResponsesForKind("observation")).not.toContain("resident_refused");
  });

  it("falls back to the full set for an unrecognized kind", () => {
    expect(defaultResponsesForKind("something_new")).toEqual(DEFAULT_COMPLETION_RESPONSES);
  });
});

describe("validation", () => {
  it("accepts a well-formed contract", () => {
    expect(validateServiceDeliveryContract(contract())).toEqual([]);
    expect(isServiceDeliveryContractValid(contract())).toBe(true);
  });

  it("rejects an unknown task kind", () => {
    const issues = validateServiceDeliveryContract(contract({ taskKind: "telepathy" }));
    expect(issues.map((issue) => issue.kind)).toContain("unknown_task_kind");
  });

  it("rejects a service that can never be closed", () => {
    const issues = validateServiceDeliveryContract(contract({ acceptableCompletionResponses: [] }));
    expect(issues.map((issue) => issue.kind)).toContain("empty_responses");
  });

  it("rejects an unrecognized response, reporting it once", () => {
    const issues = validateServiceDeliveryContract(contract({
      acceptableCompletionResponses: ["completed_as_planned", "teleported", "vanished"],
    }));
    expect(issues.filter((issue) => issue.kind === "unknown_response")).toHaveLength(1);
  });

  it("requires refusal handling when refusal is an allowed outcome", () => {
    const issues = validateServiceDeliveryContract(contract({ refusalHandling: null }));
    expect(issues.map((issue) => issue.kind)).toContain("missing_refusal_handling");
  });

  it("does not require refusal handling when refusal is not offered", () => {
    const issues = validateServiceDeliveryContract(contract({
      taskKind: "manager_review",
      acceptableCompletionResponses: defaultResponsesForKind("manager_review"),
      refusalHandling: null,
    }));
    expect(issues).toEqual([]);
  });

  it("treats whitespace-only refusal handling as missing", () => {
    const issues = validateServiceDeliveryContract(contract({ refusalHandling: "   " }));
    expect(issues.map((issue) => issue.kind)).toContain("missing_refusal_handling");
  });

  it("validates the qualification key against the certification-definition shape", () => {
    expect(validateServiceDeliveryContract(contract({ requiredQualificationKey: "medication_administration" }))).toEqual([]);
    const issues = validateServiceDeliveryContract(contract({ requiredQualificationKey: "Medication Admin" }));
    expect(issues.map((issue) => issue.kind)).toContain("invalid_qualification_key");
  });

  it("allows no qualification requirement", () => {
    expect(validateServiceDeliveryContract(contract({ requiredQualificationKey: null }))).toEqual([]);
  });

  it("bounds the escalation threshold", () => {
    expect(validateServiceDeliveryContract(contract({ escalateAfterExceptions: 3 }))).toEqual([]);
    for (const value of [0, -1, 51, 2.5]) {
      const issues = validateServiceDeliveryContract(contract({ escalateAfterExceptions: value }));
      expect(issues.map((issue) => issue.kind)).toContain("invalid_escalation_threshold");
    }
  });

  it("rejects an end date before the effective date", () => {
    const issues = validateServiceDeliveryContract(contract({ effectiveFrom: "2026-07-01", expiresOn: "2026-06-01" }));
    expect(issues.map((issue) => issue.kind)).toContain("end_before_start");
  });

  it("accepts an end date on the effective date", () => {
    expect(validateServiceDeliveryContract(contract({ effectiveFrom: "2026-07-01", expiresOn: "2026-07-01" }))).toEqual([]);
  });
});

describe("description", () => {
  it("summarizes the contract in one line", () => {
    expect(describeServiceDeliveryContract(contract({
      taskKind: "shift_task",
      requiredQualificationKey: "medication_administration",
      escalateAfterExceptions: 3,
      expiresOn: "2026-12-31",
    }))).toBe("Shift task · requires medication_administration · escalates after 3 exceptions · ends 2026-12-31");
  });

  it("omits the parts that are not set", () => {
    expect(describeServiceDeliveryContract(contract())).toBe("Scheduled care");
  });

  it("passes an unrecognized kind through rather than rendering blank", () => {
    expect(describeServiceDeliveryContract(contract({ taskKind: "legacy_kind" }))).toBe("legacy_kind");
  });
});
