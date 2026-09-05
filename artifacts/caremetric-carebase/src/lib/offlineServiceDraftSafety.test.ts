import { describe, expect, it } from "vitest";
import {
  assertServiceDraftAllowed, isNetworkLevelSupabaseError, isOfflineServiceDraftIdentityPending,
  shouldWipeOfflineServiceDraftData, type OfflineServiceDraft,
} from "./offlineServiceDraftSafety";

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

describe("shouldWipeOfflineServiceDraftData", () => {
  const identity = { profileId: "p1", organizationId: "org-1", role: "employee" };
  const active = { ...identity, active: true };

  it("does nothing the first time an identity resolves -- nothing was recorded yet to wipe", () => {
    expect(shouldWipeOfflineServiceDraftData(null, active)).toBe(false);
  });

  it("does nothing when there was never a previous identity and there still isn't one", () => {
    expect(shouldWipeOfflineServiceDraftData(null, null)).toBe(false);
  });

  it("does not wipe on an unchanged-identity re-check", () => {
    expect(shouldWipeOfflineServiceDraftData(identity, active)).toBe(false);
  });

  // This is deliberately correct in isolation -- a bare `current === null` after a previous identity
  // was recorded IS a genuine sign-out shape, and SIGNED_OUT in auth.tsx calls this function exactly
  // this way. The Codex review finding was never about this function; it was about auth.tsx's OTHER
  // caller invoking it with a `current` that reads null merely because a still-valid session's
  // profile hasn't resolved yet. See isOfflineServiceDraftIdentityPending below for that guard.
  it("wipes when the current identity is null after a previous identity was recorded", () => {
    expect(shouldWipeOfflineServiceDraftData(identity, null)).toBe(true);
  });

  it("wipes on a different profileId, organizationId, or role", () => {
    expect(shouldWipeOfflineServiceDraftData(identity, { ...active, profileId: "p2" })).toBe(true);
    expect(shouldWipeOfflineServiceDraftData(identity, { ...active, organizationId: "org-2" })).toBe(true);
    expect(shouldWipeOfflineServiceDraftData(identity, { ...active, role: "trainer" })).toBe(true);
  });

  it("wipes when the account is no longer active", () => {
    expect(shouldWipeOfflineServiceDraftData(identity, { ...active, active: false })).toBe(true);
  });

  // BACKLOG.md I23. A transfer inside the same organization moves employees.facility_id and leaves
  // profile id, organization id and role exactly where they were, so every assertion above passes
  // and nothing wiped -- the device went on holding drafts naming residents, rooms and care given
  // at a facility this caregiver no longer works at.
  it("wipes on a facility transfer inside the same organization", () => {
    expect(shouldWipeOfflineServiceDraftData(
      { ...identity, facilityId: "f1" }, { ...active, facilityId: "f2" },
    )).toBe(true);
  });

  it("wipes when the employee row is gone, which is a resolved value and not an unknown one", () => {
    expect(shouldWipeOfflineServiceDraftData(
      { ...identity, facilityId: "f1" }, { ...active, facilityId: null },
    )).toBe(true);
  });

  it("does not wipe while the facility query has not settled, on either side", () => {
    // `undefined` appears in the ordinary lifecycle every time the facility query is in flight.
    // Treating it as a change would destroy a caregiver's pending documentation on an ordinary
    // sign-in -- the exact loss this whole store exists to prevent. Same rule, same reasoning, as
    // signedInIdentityChanged in sessionIdentity.ts.
    expect(shouldWipeOfflineServiceDraftData(
      { ...identity, facilityId: undefined }, { ...active, facilityId: "f1" },
    )).toBe(false);
    expect(shouldWipeOfflineServiceDraftData(
      { ...identity, facilityId: "f1" }, { ...active, facilityId: undefined },
    )).toBe(false);
  });

  it("does not wipe when the facility is unchanged", () => {
    expect(shouldWipeOfflineServiceDraftData(
      { ...identity, facilityId: "f1" }, { ...active, facilityId: "f1" },
    )).toBe(false);
  });
});

describe("isOfflineServiceDraftIdentityPending", () => {
  it("is pending when a session exists but no profile has resolved for it yet", () => {
    expect(isOfflineServiceDraftIdentityPending(true, false)).toBe(true);
  });

  it("is not pending once a session-bearing profile resolves", () => {
    expect(isOfflineServiceDraftIdentityPending(true, true)).toBe(false);
  });

  it("is not pending with no session at all, whether or not a stale user object lingers", () => {
    expect(isOfflineServiceDraftIdentityPending(false, false)).toBe(false);
    expect(isOfflineServiceDraftIdentityPending(false, true)).toBe(false);
  });
});

describe("isNetworkLevelSupabaseError", () => {
  it("is true for the exact shape @supabase/postgrest-js produces on a client-side network failure", () => {
    // See PostgrestBuilder's fetch-rejection handler: code is set to "" specifically (and only) when
    // the request never got a response -- DNS/connection failure, a captive portal, CORS, etc.
    expect(isNetworkLevelSupabaseError({
      message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch", hint: "", code: "",
    })).toBe(true);
  });

  it("is false for a real rejection from this app's own RPC functions, which always carry a non-empty code", () => {
    // record_service_task_response's own errcodes (see the migration): 42501 for out-of-scope
    // authorization, 22023 for a response/detail the plan doesn't accept.
    expect(isNetworkLevelSupabaseError({
      message: "Service task is outside caller scope", details: "", hint: "", code: "42501",
    })).toBe(false);
    expect(isNetworkLevelSupabaseError({
      message: "Response is not accepted for this service", details: "", hint: "", code: "22023",
    })).toBe(false);
  });

  it("is false when there is no code field at all, not just when it's non-empty", () => {
    // postgrest-js's own non-JSON-body fallback omits `code` entirely -- a real (if malformed) HTTP
    // response, not a network failure, and this must not be swept into the same bucket.
    expect(isNetworkLevelSupabaseError({ message: "Internal Server Error" })).toBe(false);
  });

  it("is false for non-object, nullish, or plain Error values", () => {
    expect(isNetworkLevelSupabaseError(null)).toBe(false);
    expect(isNetworkLevelSupabaseError(undefined)).toBe(false);
    expect(isNetworkLevelSupabaseError("some string error")).toBe(false);
    expect(isNetworkLevelSupabaseError(new Error("plain error, no code property at all"))).toBe(false);
  });
});
