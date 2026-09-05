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
 * `conflict` or `stale` -- see the header of 20260803110000_offline_clinical_observation_drafts.sql.
 */
import type { ObservationType } from "@/hooks/useClinicalObservations";
import { assertDraftLifecycleFields } from "./offlineDraftFieldGuards";
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

/**
 * What a sync attempt actually reported back.
 *
 * `observationId` is carried rather than dropped because it is the only reliable way to identify the
 * row that was just charted: a caregiver may backdate a reading, and another caregiver may record
 * one concurrently, so "newest of this type" can name a different observation entirely. It is null
 * whenever nothing was charted -- a rejected or wipe_required attempt -- and can also be null on a
 * `duplicate` replay of a receipt whose own attempt never applied.
 */
export interface OfflineObservationSyncResult {
  outcome: OfflineObservationSyncOutcome;
  observationId: string | null;
  /** Server-derived flag for the charted reading, so a delayed sync can still raise a critical value. */
  abnormalFlag: string | null;
}

/**
 * The declared states, as a runtime list the safety gate can check membership against. Exhaustive
 * by construction via Record<OfflineObservationSyncState, true> -- see the service lane's twin.
 *
 * Deliberately NOT the same set as the service lane's: no `conflict` or `stale`, because a vital
 * sign is an observation this caregiver personally took and there is no shared row for anyone else
 * to document first or for a plan revision to supersede. The RULE is shared
 * (offlineDraftFieldGuards.ts); the alphabet is not.
 */
const ALL_OBSERVATION_SYNC_STATES: Record<OfflineObservationSyncState, true> = {
  draft: true, syncing: true, applied: true, duplicate: true, rejected: true, error: true,
};
export const OFFLINE_OBSERVATION_SYNC_STATES =
  Object.keys(ALL_OBSERVATION_SYNC_STATES) as OfflineObservationSyncState[];

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
  /** Server refusals, not attempts. See OfflineServiceDraft.failedAttempts. */
  failedAttempts?: number;
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
  assertDraftLifecycleFields(draft, OFFLINE_OBSERVATION_SYNC_STATES);
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
