import { describe, expect, it } from "vitest";
import {
  assertObservationDraftAllowed,
  NEEDS_REVIEW_OBSERVATION_DRAFT_STATES,
  UNRESOLVED_OBSERVATION_DRAFT_STATES,
  type OfflineObservationDraft,
} from "./offlineObservationDraftSafety";

function draft(overrides: Partial<OfflineObservationDraft> = {}): OfflineObservationDraft {
  return {
    draftId: "draft-1",
    residentId: "resident-1",
    residentDisplayLabel: "Jamie Resident · Room 12",
    organizationId: "org-1",
    profileId: "profile-1",
    observationType: "blood_pressure",
    observedAt: "2026-08-03T09:00:00.000Z",
    valueNumeric: 120,
    valueSecondary: 80,
    valueText: null,
    unit: "mm[Hg]",
    customLabel: null,
    loincCode: "85354-9",
    note: null,
    idempotencyKey: "idem-1",
    createdAt: "2026-08-03T09:00:01.000Z",
    updatedAt: "2026-08-03T09:00:01.000Z",
    syncState: "draft",
    lastSyncOutcome: null,
    lastSyncError: null,
    ...overrides,
  };
}

describe("assertObservationDraftAllowed", () => {
  it("accepts a well-formed numeric reading", () => {
    expect(() => assertObservationDraftAllowed(draft())).not.toThrow();
  });

  it("accepts a custom observation carrying a label and text value", () => {
    expect(() => assertObservationDraftAllowed(draft({
      observationType: "custom", customLabel: "Peak flow", valueNumeric: null, valueText: "400",
    }))).not.toThrow();
  });

  it.each(["draftId", "residentId", "organizationId", "profileId", "idempotencyKey"] as const)(
    "rejects a draft missing %s",
    (field) => {
      expect(() => assertObservationDraftAllowed(draft({ [field]: "" }))).toThrow(/missing/u);
    },
  );

  it("rejects an observation type outside the recognized vocabulary", () => {
    expect(() => assertObservationDraftAllowed(
      draft({ observationType: "not_a_vital" as OfflineObservationDraft["observationType"] }),
    )).toThrow(/not a recognized observation type/u);
  });

  it("rejects a draft that carries no value at all", () => {
    // Would sync only to be rejected by record_clinical_observation, after the caregiver was told
    // it was saved -- the one failure mode an offline queue must not have.
    expect(() => assertObservationDraftAllowed(draft({ valueNumeric: null, valueText: null })))
      .toThrow(/no numeric or text value/u);
    expect(() => assertObservationDraftAllowed(draft({ valueNumeric: null, valueText: "   " })))
      .toThrow(/no numeric or text value/u);
  });

  it("rejects a custom observation with no label", () => {
    expect(() => assertObservationDraftAllowed(draft({ observationType: "custom", customLabel: null })))
      .toThrow(/needs a label/u);
  });

  it("rejects a non-finite numeric value", () => {
    expect(() => assertObservationDraftAllowed(draft({ valueNumeric: Number.NaN })))
      .toThrow(/not a finite number/u);
    expect(() => assertObservationDraftAllowed(draft({ valueSecondary: Number.POSITIVE_INFINITY })))
      .toThrow(/not a finite number/u);
  });

  it("rejects an unparseable observed-at timestamp", () => {
    expect(() => assertObservationDraftAllowed(draft({ observedAt: "sometime yesterday" })))
      .toThrow(/not a valid timestamp/u);
  });

  it("rejects text fields beyond the storage limit", () => {
    expect(() => assertObservationDraftAllowed(draft({ note: "x".repeat(4001) })))
      .toThrow(/exceeds 4000 characters/u);
  });
});

describe("observation draft lifecycle states", () => {
  it("treats only network-resolvable states as unresolved", () => {
    expect(UNRESOLVED_OBSERVATION_DRAFT_STATES).toEqual(["draft", "syncing", "error"]);
  });

  it("flags only a server rejection for human review", () => {
    // A vital sign has no conflict/stale case -- nobody else can record the reading this caregiver
    // took, and it cannot be superseded by a plan revision.
    expect(NEEDS_REVIEW_OBSERVATION_DRAFT_STATES).toEqual(["rejected"]);
  });
});
