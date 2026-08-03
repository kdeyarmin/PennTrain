import { describe, expect, it } from "vitest";
import {
  assertDraftLifecycleFields, assertKnownSyncState, assertParseableTimestamp,
} from "./offlineDraftFieldGuards";
import {
  assertServiceDraftAllowed, OFFLINE_DRAFT_SYNC_STATES, NEEDS_REVIEW_DRAFT_STATES,
  UNRESOLVED_DRAFT_STATES, type OfflineServiceDraft,
} from "./offlineServiceDraftSafety";
import {
  assertObservationDraftAllowed, OFFLINE_OBSERVATION_SYNC_STATES,
  NEEDS_REVIEW_OBSERVATION_DRAFT_STATES, UNRESOLVED_OBSERVATION_DRAFT_STATES,
  type OfflineObservationDraft,
} from "./offlineObservationDraftSafety";
import { isUnsyncedDraftOverdue } from "./offlineServiceDraftCache";

function serviceDraft(overrides: Partial<OfflineServiceDraft> = {}): OfflineServiceDraft {
  return {
    draftId: "d1", taskId: "t1", residentId: "r1", residentDisplayLabel: "Jamie · Room 12",
    organizationId: "org1", facilityId: "f1", profileId: "p1", serviceName: "Bathing assistance",
    scheduledStart: "2026-08-02T13:00:00.000Z", scheduledEnd: "2026-08-02T14:00:00.000Z",
    taskKind: "scheduled_care", acceptableResponses: ["completed_as_planned"], refusalHandling: null,
    response: "completed_as_planned", exceptionDetails: {}, idempotencyKey: "i1",
    createdAt: "2026-08-02T12:00:00.000Z", updatedAt: "2026-08-02T12:00:00.000Z",
    syncState: "draft", lastSyncOutcome: null, lastSyncError: null,
    ...overrides,
  };
}

function observationDraft(overrides: Partial<OfflineObservationDraft> = {}): OfflineObservationDraft {
  return {
    draftId: "o1", residentId: "r1", residentDisplayLabel: "Jamie · Room 12",
    organizationId: "org1", profileId: "p1", observationType: "blood_pressure",
    observedAt: "2026-08-02T12:00:00.000Z", valueNumeric: 120, valueSecondary: 80,
    valueText: null, unit: "mmHg", customLabel: null, loincCode: null, note: null,
    idempotencyKey: "i1", createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z", syncState: "draft",
    lastSyncOutcome: null, lastSyncError: null,
    ...overrides,
  } as OfflineObservationDraft;
}

describe("assertParseableTimestamp", () => {
  it("accepts an ISO timestamp", () => {
    expect(() => assertParseableTimestamp("2026-08-02T12:00:00.000Z", "createdAt")).not.toThrow();
  });

  for (const bad of ["", "not-a-date", "2026-13-45T99:99:99Z"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => assertParseableTimestamp(bad, "createdAt")).toThrow(/parseable timestamp/);
    });
  }

  it("rejects a non-string", () => {
    expect(() => assertParseableTimestamp(undefined, "createdAt")).toThrow(/parseable timestamp/);
  });
});

describe("assertKnownSyncState", () => {
  it("accepts a declared state", () => {
    expect(() => assertKnownSyncState("draft", ["draft", "error"], "syncState")).not.toThrow();
  });

  it("rejects one outside the lane's set, naming the value", () => {
    expect(() => assertKnownSyncState("wat", ["draft", "error"], "syncState")).toThrow(/"wat"/);
  });
});

// This is the property that made the gap worth closing rather than just noting. The purge clocks
// and the overdue warning all compare `now - Date.parse(createdAt)`, and every comparison against
// NaN is false -- so an unparseable createdAt is not "expires at a weird time", it is "never
// expires and is never flagged". Asserted against the real clock helpers, not restated.
describe("why an unparseable createdAt had to be rejected", () => {
  it("would never be overdue, however far the clock runs", () => {
    const entry = {
      draftId: "d1", kind: "service_task" as const, syncState: "draft" as const,
      createdAt: "not-a-date",
    };
    // Deliberately only the pure helper. purgeExpiredServiceDrafts shares the identical
    // `now - Date.parse(createdAt)` comparison, but asserting on it here would prove nothing:
    // it opens IndexedDB, which does not exist in this environment, so it would reject for a
    // reason that has nothing to do with NaN and the test would pass while testing nothing.
    expect(isUnsyncedDraftOverdue(entry, Date.parse("2099-01-01T00:00:00.000Z"))).toBe(false);
    expect(isUnsyncedDraftOverdue({ ...entry, createdAt: "2026-08-02T12:00:00.000Z" },
      Date.parse("2099-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("so the gate refuses it up front", () => {
    expect(() => assertServiceDraftAllowed(serviceDraft({ createdAt: "not-a-date" })))
      .toThrow(/parseable timestamp/);
  });
});

describe("both lanes now validate the two lifecycle fields", () => {
  it("service lane rejects an unrecognized syncState", () => {
    expect(() => assertServiceDraftAllowed(
      serviceDraft({ syncState: "totally-made-up" as OfflineServiceDraft["syncState"] }),
    )).toThrow(/not a recognized sync state/);
  });

  it("observation lane rejects an unrecognized syncState", () => {
    expect(() => assertObservationDraftAllowed(
      observationDraft({ syncState: "totally-made-up" as OfflineObservationDraft["syncState"] }),
    )).toThrow(/not a recognized sync state/);
  });

  it("observation lane rejects an unparseable createdAt", () => {
    expect(() => assertObservationDraftAllowed(observationDraft({ createdAt: "" })))
      .toThrow(/parseable timestamp/);
  });

  it("neither lane rejects a legitimate draft", () => {
    expect(() => assertServiceDraftAllowed(serviceDraft())).not.toThrow();
    expect(() => assertObservationDraftAllowed(observationDraft())).not.toThrow();
  });
});

// The two lanes deliberately disagree, and that disagreement is load-bearing: `conflict` and
// `stale` are real service-lane outcomes and impossible observation-lane ones. A future "tidy-up"
// that unified the two vocabularies would start accepting states the observation flow can never
// produce, which is exactly what this gate exists to catch.
describe("the two lanes keep separate vocabularies", () => {
  it("service knows conflict and stale; observation does not", () => {
    expect(OFFLINE_DRAFT_SYNC_STATES).toEqual(expect.arrayContaining(["conflict", "stale"]));
    expect(OFFLINE_OBSERVATION_SYNC_STATES).not.toContain("conflict");
    expect(OFFLINE_OBSERVATION_SYNC_STATES).not.toContain("stale");
  });

  // Every state the panel sorts on must be a declared state, or a draft could be routed to a list
  // the gate would then refuse to let it be written back into.
  it("every routing state is a declared state, in both lanes", () => {
    for (const state of [...UNRESOLVED_DRAFT_STATES, ...NEEDS_REVIEW_DRAFT_STATES]) {
      expect(OFFLINE_DRAFT_SYNC_STATES).toContain(state);
    }
    for (const state of [...UNRESOLVED_OBSERVATION_DRAFT_STATES, ...NEEDS_REVIEW_OBSERVATION_DRAFT_STATES]) {
      expect(OFFLINE_OBSERVATION_SYNC_STATES).toContain(state);
    }
  });

  it("the shared helper is what both lanes call, with their own set", () => {
    expect(() => assertDraftLifecycleFields(
      { createdAt: "2026-08-02T12:00:00.000Z", syncState: "conflict" }, OFFLINE_DRAFT_SYNC_STATES,
    )).not.toThrow();
    expect(() => assertDraftLifecycleFields(
      { createdAt: "2026-08-02T12:00:00.000Z", syncState: "conflict" }, OFFLINE_OBSERVATION_SYNC_STATES,
    )).toThrow(/not a recognized sync state/);
  });
});
