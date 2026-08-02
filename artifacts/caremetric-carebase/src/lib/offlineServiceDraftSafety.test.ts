import { describe, expect, it } from "vitest";
import { assertServiceDraftAllowed, type OfflineServiceDraft } from "./offlineServiceDraftSafety";

function draft(overrides: Partial<OfflineServiceDraft> = {}): OfflineServiceDraft {
  return {
    draftId: "draft-1",
    taskId: "task-1",
    residentId: "resident-1",
    residentDisplayLabel: "Jamie Resident · Room 12",
    organizationId: "org-1",
    facilityId: "facility-1",
    profileId: "profile-1",
    serviceName: "Bathing assistance",
    scheduledStart: "2026-08-02T13:00:00.000Z",
    scheduledEnd: "2026-08-02T14:00:00.000Z",
    taskKind: "scheduled_care",
    acceptableResponses: ["completed_as_planned", "resident_refused"],
    refusalHandling: "Offer again in 30 minutes.",
    response: "completed_as_planned",
    exceptionDetails: {},
    idempotencyKey: "idem-1",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    syncState: "draft",
    lastSyncOutcome: null,
    lastSyncError: null,
    ...overrides,
  };
}

describe("offline service draft safety", () => {
  it("accepts a routine draft with no exception details", () => {
    expect(() => assertServiceDraftAllowed(draft())).not.toThrow();
  });

  it("accepts a draft whose exception details match its response's follow-up fields", () => {
    expect(() => assertServiceDraftAllowed(draft({
      response: "resident_refused",
      exceptionDetails: { refusal_words: "Said not now.", reoffered: true, supervisor_notified: false },
    }))).not.toThrow();
  });

  it("rejects a response that is not one of the seven recognized completion responses", () => {
    expect(() => assertServiceDraftAllowed(draft({ response: "made_up_response" as never })))
      .toThrow(/not a recognized completion response/);
  });

  it("rejects an exception-detail key that does not belong to the chosen response", () => {
    expect(() => assertServiceDraftAllowed(draft({
      response: "completed_as_planned",
      // completed_as_planned has no follow-up fields at all -- see serviceExceptionFollowUp.ts.
      exceptionDetails: { assistance_level: "one_person" },
    }))).toThrow(/not a recognized follow-up field/);
  });

  it("rejects an exception-detail key from a DIFFERENT response's follow-up set", () => {
    expect(() => assertServiceDraftAllowed(draft({
      response: "not_completed",
      // "reoffered" belongs to resident_refused, not not_completed.
      exceptionDetails: { reason: "Ran out of shift time.", reoffered: true },
    }))).toThrow(/not a recognized follow-up field/);
  });

  it.each([
    "draftId", "taskId", "residentId", "organizationId", "facilityId", "profileId", "idempotencyKey",
  ] as const)("rejects an empty %s", (field) => {
    expect(() => assertServiceDraftAllowed(draft({ [field]: "" }))).toThrow(new RegExp(field));
  });

  it("rejects a whitespace-only id field", () => {
    expect(() => assertServiceDraftAllowed(draft({ taskId: "   " }))).toThrow(/taskId/);
  });

  it("caps residentDisplayLabel, serviceName, and refusalHandling at ~4000 characters", () => {
    const tooLong = "x".repeat(4001);
    expect(() => assertServiceDraftAllowed(draft({ residentDisplayLabel: tooLong })))
      .toThrow(/residentDisplayLabel.*exceeds 4000/);
    expect(() => assertServiceDraftAllowed(draft({ serviceName: tooLong })))
      .toThrow(/serviceName.*exceeds 4000/);
    expect(() => assertServiceDraftAllowed(draft({ refusalHandling: tooLong })))
      .toThrow(/refusalHandling.*exceeds 4000/);
  });

  it("caps free-text exception-detail values at ~4000 characters", () => {
    expect(() => assertServiceDraftAllowed(draft({
      response: "not_completed",
      exceptionDetails: { reason: "x".repeat(4001) },
    }))).toThrow(/exceptionDetails\.reason.*exceeds 4000/);
  });

  it("allows exactly 4000 characters (the cap is inclusive)", () => {
    expect(() => assertServiceDraftAllowed(draft({ serviceName: "x".repeat(4000) }))).not.toThrow();
  });

  it("allows a null refusalHandling", () => {
    expect(() => assertServiceDraftAllowed(draft({ refusalHandling: null }))).not.toThrow();
  });
});
