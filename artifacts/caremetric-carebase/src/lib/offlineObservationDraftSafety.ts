/**
 * Offline vitals draft safety -- the observation counterpart of offlineServiceDraftSafety.ts.
 *
 * Same discipline, deliberately not the same type: OfflineObservationDraft is a closed interface
 * (named fields only, no `unknown`-typed nesting, no open bag), so what can reach disk is fixed by
 * the TypeScript shape rather than by a runtime scan. What is explicitly never stored here: the
 * resident record itself (DOB, diagnoses, medications, allergies, contacts), any resident other than
 * the one being charted, and any historical observation. `residentDisplayLabel` is a short
 * "name + room" string for the panel, not a resident record.
 *
 * The sync-state vocabulary is narrower than the service lane's on purpose. A vital sign cannot be
 * documented by someone else first, and cannot be superseded by a plan revision, so there is no
 * `conflict` or `stale` -- see the header of 20260803020000_offline_clinical_observation_drafts.sql.
 */
import type { ObservationType } from "@/hooks/useClinicalObservations";
import { OBSERVATION_CONFIG } from "./clinicalObservations";

/** Where a draft sits in its own lifecycle. Mirrors OfflineDraftSyncState minus conflict/stale. */
export type OfflineObservationSyncState =
  | "draft"      // saved locally, not yet attempted
  | "syncing"    // a sync attempt is in flight
  | "applied"    // server charted it -- deleted immediately
  | "duplicate"  // server had already seen this attempt -- deleted immediately
  | "rejected"   // the server refused it (authorization/validation) -- kept for a human
  | "error";     // the attempt itself failed (network) -- kept, will retry

/** Mirrors sync_offline_clinical_observation_draft's `outcome` column exactly. */
export type OfflineObservationSyncOutcome = "applied" | "duplicate" | "rejected" | "wipe_required";

export const UNRESOLVED_OBSERVATION_DRAFT_STATES: OfflineObservationSyncState[] = ["draft", "syncing", "error"];
export const NEEDS_REVIEW_OBSERVATION_DRAFT_STATES: OfflineObservationSyncState[] = ["rejected"];

export interface OfflineObservationDraft {
  draftId: string;
  residentId: string;
  /** Short display string (e.g. "Jamie Resident · Room 12") -- never a full resident record. */
  residentDisplayLabel: string;
  organizationId: string;
  profileId: string;
  observationType: ObservationType;
  /** The clinical fact: when the reading was taken, as the caregiver entered it. */
  observedAt: string;
  valueNumeric: number | null;
  valueSecondary: number | null;
  valueText: string | null;
  unit: string | null;
  customLabel: string | null;
  loincCode: string | null;
  note: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  syncState: OfflineObservationSyncState;
  lastSyncOutcome: OfflineObservationSyncOutcome | null;
  lastSyncError: string | null;
}

const MAX_TEXT_LENGTH = 4000;

function assertNonEmptyId(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Offline observation draft is missing "${field}"`);
  }
}

function assertTextWithinLimit(value: string | null | undefined, field: string): void {
  if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
    throw new Error(`Offline observation draft field "${field}" exceeds ${MAX_TEXT_LENGTH} characters`);
  }
}

function assertFiniteOrNull(value: number | null, field: string): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Offline observation draft field "${field}" is not a finite number`);
  }
}

/**
 * Validates a draft before it is written to disk or sent to sync_offline_clinical_observation_draft.
 * Throws on the first problem -- a hard gate, not a best-effort sanitizer.
 */
export function assertObservationDraftAllowed(draft: OfflineObservationDraft): void {
  assertNonEmptyId(draft.draftId, "draftId");
  assertNonEmptyId(draft.residentId, "residentId");
  assertNonEmptyId(draft.organizationId, "organizationId");
  assertNonEmptyId(draft.profileId, "profileId");
  assertNonEmptyId(draft.idempotencyKey, "idempotencyKey");

  // The observation vocabulary is owned by OBSERVATION_CONFIG, which is itself keyed by the
  // ObservationType union the RPC accepts -- derived, not re-listed, so the two cannot drift.
  if (!Object.prototype.hasOwnProperty.call(OBSERVATION_CONFIG, draft.observationType)) {
    throw new Error(`Offline observation draft type "${draft.observationType}" is not a recognized observation type`);
  }

  if (Number.isNaN(Date.parse(draft.observedAt))) {
    throw new Error('Offline observation draft field "observedAt" is not a valid timestamp');
  }

  assertFiniteOrNull(draft.valueNumeric, "valueNumeric");
  assertFiniteOrNull(draft.valueSecondary, "valueSecondary");

  // record_clinical_observation needs something to store; a draft carrying neither would sync only
  // to be rejected, after the caregiver was told it was saved.
  if (draft.valueNumeric === null && (draft.valueText === null || draft.valueText.trim() === "")) {
    throw new Error("Offline observation draft has no numeric or text value");
  }
  if (draft.observationType === "custom" && (draft.customLabel === null || draft.customLabel.trim() === "")) {
    throw new Error("Offline observation draft of type \"custom\" needs a label");
  }

  assertTextWithinLimit(draft.residentDisplayLabel, "residentDisplayLabel");
  assertTextWithinLimit(draft.valueText, "valueText");
  assertTextWithinLimit(draft.unit, "unit");
  assertTextWithinLimit(draft.customLabel, "customLabel");
  assertTextWithinLimit(draft.loincCode, "loincCode");
  assertTextWithinLimit(draft.note, "note");
}
