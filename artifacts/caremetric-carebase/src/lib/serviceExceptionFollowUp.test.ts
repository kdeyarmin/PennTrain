import { describe, expect, it } from "vitest";
import {
  documentedAssistanceLevel, followUpFieldsFor, responseRequiresFollowUp, suggestsChangeOfCondition,
  summarizeException, supervisorWasNotified, taskStatusForResponse, validateFollowUp,
} from "./serviceExceptionFollowUp";
import { COMPLETION_RESPONSES, isExceptionResponse } from "./serviceDeliveryContract";

describe("the routine path stays one tap", () => {
  it("asks nothing for 'completed as planned'", () => {
    // If the routine path costs more than one tap, staff pick it for everything and the exception
    // data becomes worthless.
    expect(followUpFieldsFor("completed_as_planned")).toEqual([]);
    expect(responseRequiresFollowUp("completed_as_planned")).toBe(false);
    expect(validateFollowUp("completed_as_planned", {})).toEqual([]);
  });

  it("asks something for every exception response", () => {
    for (const response of COMPLETION_RESPONSES.filter(isExceptionResponse)) {
      expect(followUpFieldsFor(response).length).toBeGreaterThan(0);
    }
  });

  it("returns nothing for an unrecognized response rather than throwing", () => {
    expect(followUpFieldsFor("teleported")).toEqual([]);
    expect(validateFollowUp("teleported", {})).toEqual([]);
  });
});

describe("increased assistance", () => {
  const complete = { assistance_level: "two_person", persistence: "ongoing", supervisor_notified: true };

  it("asks the four questions the request names", () => {
    const keys = followUpFieldsFor("completed_with_more_assistance").map((field) => field.key);
    expect(keys).toEqual([
      "assistance_level", "persistence", "supervisor_notified", "change_of_condition_suggested",
    ]);
  });

  it("requires the level and the persistence", () => {
    const issues = validateFollowUp("completed_with_more_assistance", {});
    expect(issues.map((issue) => issue.fieldKey)).toEqual(["assistance_level", "persistence"]);
  });

  it("does not require the supervisor or change-of-condition answers", () => {
    expect(validateFollowUp("completed_with_more_assistance", { assistance_level: "one_person", persistence: "temporary" })).toEqual([]);
  });

  it("rejects an assistance level outside the shared vocabulary", () => {
    // The level is compared against the care header's transfer values; a novel string would make
    // that comparison silently useless.
    const issues = validateFollowUp("completed_with_more_assistance", { ...complete, assistance_level: "a lot" });
    expect(issues.map((issue) => issue.fieldKey)).toContain("assistance_level");
  });

  it("exposes the documented level for conflict detection", () => {
    expect(documentedAssistanceLevel("completed_with_more_assistance", complete)).toBe("two_person");
  });

  it("exposes no level for other responses", () => {
    expect(documentedAssistanceLevel("resident_refused", { assistance_level: "two_person" })).toBeNull();
    expect(documentedAssistanceLevel("completed_with_more_assistance", {})).toBeNull();
  });
});

describe("other exception responses", () => {
  it("asks what was done and what remains on a partial completion", () => {
    const issues = validateFollowUp("partially_completed", {});
    expect(issues.map((issue) => issue.fieldKey)).toEqual(["what_was_done", "what_remains"]);
  });

  it("asks what the resident said on a refusal, and whether it was re-offered", () => {
    const keys = followUpFieldsFor("resident_refused").map((field) => field.key);
    expect(keys).toContain("refusal_words");
    expect(keys).toContain("reoffered");
    expect(validateFollowUp("resident_refused", {}).map((issue) => issue.fieldKey)).toEqual(["refusal_words"]);
  });

  it("constrains where the resident was on an unavailable", () => {
    const issues = validateFollowUp("resident_unavailable", { reason: "napping" });
    expect(issues.map((issue) => issue.fieldKey)).toContain("reason");
    expect(validateFollowUp("resident_unavailable", { reason: "appointment" })).toEqual([]);
  });

  it("requires the observation on a concern", () => {
    expect(validateFollowUp("concern_observed", {}).map((issue) => issue.fieldKey)).toEqual(["concern"]);
  });

  it("treats whitespace-only free text as unanswered", () => {
    expect(validateFollowUp("not_completed", { reason: "   " }).map((issue) => issue.fieldKey)).toEqual(["reason"]);
  });
});

describe("change-of-condition hand-off", () => {
  it("suggests one only when the person answered yes", () => {
    expect(suggestsChangeOfCondition("completed_with_more_assistance", { change_of_condition_suggested: true })).toBe(true);
    expect(suggestsChangeOfCondition("completed_with_more_assistance", { change_of_condition_suggested: false })).toBe(false);
    expect(suggestsChangeOfCondition("completed_with_more_assistance", {})).toBe(false);
  });

  it("never suggests one for a response that does not carry the question", () => {
    // The app must not decide on its own that a resident's condition changed.
    expect(suggestsChangeOfCondition("resident_unavailable", { change_of_condition_suggested: true })).toBe(false);
    expect(suggestsChangeOfCondition("partially_completed", { change_of_condition_suggested: true })).toBe(false);
  });

  it("reads the supervisor-notified flag", () => {
    expect(supervisorWasNotified({ supervisor_notified: true })).toBe(true);
    expect(supervisorWasNotified({ supervisor_notified: false })).toBe(false);
    expect(supervisorWasNotified({})).toBe(false);
  });
});

describe("status mapping", () => {
  it("keeps care that happened as completed, even with an exception", () => {
    // Treating "completed with more assistance" as not-completed would understate delivery and
    // overstate missed care in every downstream metric.
    expect(taskStatusForResponse("completed_as_planned")).toBe("completed");
    expect(taskStatusForResponse("completed_with_more_assistance")).toBe("completed");
    expect(taskStatusForResponse("partially_completed")).toBe("completed");
    expect(taskStatusForResponse("concern_observed")).toBe("completed");
  });

  it("maps the responses where care did not happen to their own statuses", () => {
    expect(taskStatusForResponse("resident_refused")).toBe("resident_refused");
    expect(taskStatusForResponse("resident_unavailable")).toBe("resident_unavailable");
    expect(taskStatusForResponse("not_completed")).toBe("not_completed");
  });

  it("maps every response to a status the task enum accepts", () => {
    const allowed = new Set(["completed", "resident_refused", "resident_unavailable", "not_completed"]);
    for (const response of COMPLETION_RESPONSES) {
      expect(allowed.has(taskStatusForResponse(response))).toBe(true);
    }
  });
});

describe("summary", () => {
  it("returns the plain label for a routine completion", () => {
    expect(summarizeException("completed_as_planned", {})).toBe("Completed as planned");
  });

  it("packs the level, persistence, and notification into one line", () => {
    expect(summarizeException("completed_with_more_assistance", {
      assistance_level: "two_person", persistence: "ongoing", supervisor_notified: true,
    })).toBe("Completed with more assistance · two person · ongoing · supervisor notified");
  });

  it("omits parts that were not answered", () => {
    expect(summarizeException("resident_refused", {})).toBe("Resident refused");
  });
});
