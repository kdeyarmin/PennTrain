/**
 * Offline service documentation draft safety (BACKLOG.md E5, Tier 1).
 *
 * This is a deliberately separate store from offlineLearning.ts / offlineCourseCache.ts, not an
 * extension of it: the course-content store allowlists a handful of read-only training domains and
 * blocklists everything else inside an open `data: unknown` bag. That is the wrong shape for a
 * store that exists specifically to hold a service-documentation response about a resident.
 *
 * OfflineServiceDraft is a closed interface -- named fields only, no `unknown`-typed nesting, no
 * open bag -- so what can be written to disk is fixed by the TypeScript shape itself, not by a
 * runtime scan trying to catch everything a resident record could contain. What is explicitly never
 * stored here, by construction: the full resident record (DOB, diagnoses, medications, allergies,
 * contacts), any resident other than the one on the task being drafted, and any historical
 * documentation. `residentDisplayLabel` is a short "name + room" string for the dialog header, not a
 * resident record.
 *
 * assertServiceDraftAllowed is the runtime half: it does not need to defend against an extra key
 * appearing (the type already prevents that everywhere in this codebase), but the *values* inside
 * the fixed shape still need checking -- a tampered payload read back from IndexedDB, or a future
 * bug, could otherwise carry a response the server does not recognize, an exception-detail key that
 * does not belong to that response, or unbounded text.
 */
import {
  COMPLETION_RESPONSES, type CompletionResponse,
} from "./serviceDeliveryContract";
import { assertDraftLifecycleFields } from "./offlineDraftFieldGuards";
import { followUpFieldsFor, type FollowUpAnswers } from "./serviceExceptionFollowUp";

/** Where a draft sits in its own lifecycle. See UnsyncedDraftsPanel.tsx / useOfflineServiceDrafts.ts. */
export type OfflineDraftSyncState =
  | "draft"      // saved locally, not yet attempted
  | "syncing"    // a sync attempt is in flight
  | "applied"    // server accepted it -- deleted immediately, same session
  | "duplicate"  // server had already seen this attempt -- deleted immediately, same session
  | "conflict"   // someone else documented this task first -- kept, needs a human to dismiss
  // The server moved on while the device was offline and this can no longer be filed: the task is
  // no longer active (plan changed), or the change-of-condition event was closed. Kept, needs a
  // human -- the observation is real, it just has nowhere left to go on its own.
  | "stale"
  | "rejected"   // the server refused it (authorization/validation) -- kept, needs a human to dismiss
  | "error";     // the sync attempt itself failed (network, etc.) -- kept, will retry

/** Mirrors sync_offline_service_task_draft's `outcome` column exactly. */
export type OfflineDraftSyncOutcome =
  | "applied" | "duplicate" | "conflict" | "stale" | "rejected" | "wipe_required";

/**
 * The declared states, as a runtime list the safety gate can check membership against.
 *
 * Typed as Record<OfflineDraftSyncState, true> rather than written as a plain array so the compiler
 * enforces that it stays exhaustive: add a state to the union above and forget it here, and tsc
 * fails on this object instead of the gate silently rejecting a legitimate draft at runtime, on a
 * device, where nobody would see it.
 */
const ALL_DRAFT_SYNC_STATES: Record<OfflineDraftSyncState, true> = {
  draft: true, syncing: true, applied: true, duplicate: true,
  conflict: true, stale: true, rejected: true, error: true,
};
export const OFFLINE_DRAFT_SYNC_STATES = Object.keys(ALL_DRAFT_SYNC_STATES) as OfflineDraftSyncState[];

/** Draft states that still need connectivity to resolve; the 24h/72h purge clock applies to these. */
export const UNRESOLVED_DRAFT_STATES: OfflineDraftSyncState[] = ["draft", "syncing", "error"];
/** Draft states that need a human to look at them; the 7-day ceiling applies to these regardless. */
export const NEEDS_REVIEW_DRAFT_STATES: OfflineDraftSyncState[] = ["conflict", "stale", "rejected"];

/**
 * Which offline surface produced a draft.
 *
 * Absent on records written before Tier 2 -- every reader must treat a missing kind as
 * "service_task" rather than rejecting it. Those records sit on aides' devices holding the only
 * copy of care documentation that has not synced yet.
 */
export type OfflineDraftKind = "service_task" | "unscheduled_service" | "change_observation";

export interface OfflineServiceDraft {
  /** Optional so drafts written before Tier 2 still parse; absent means "service_task". */
  kind?: "service_task";
  draftId: string;
  taskId: string;
  residentId: string;
  /** Short display string (e.g. "Jamie Resident · Room 12") -- never a full resident record. */
  residentDisplayLabel: string;
  organizationId: string;
  facilityId: string;
  profileId: string;
  serviceName: string;
  scheduledStart: string;
  scheduledEnd: string;
  taskKind: string;
  acceptableResponses: CompletionResponse[];
  refusalHandling: string | null;
  response: CompletionResponse;
  exceptionDetails: FollowUpAnswers;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  syncState: OfflineDraftSyncState;
  lastSyncOutcome: OfflineDraftSyncOutcome | null;
  lastSyncError: string | null;
  /**
   * How many times the SERVER has executed this draft and refused it. Absent on records written
   * before the column existed, which read as zero. See nextStateAfterSyncFailure: a failure that
   * never reached the server does not count, so this is not an attempt count.
   */
  failedAttempts?: number;
}

/**
 * Care that was never on the queue (BACKLOG.md E5 Tier 2).
 *
 * Deliberately NOT an extension of OfflineServiceDraft: it has no task, no acceptable-response
 * set and no exception follow-ups, and modelling it as "a service draft with optional fields"
 * would make every one of those fields optional for the service kind too -- which is exactly the
 * shape assertServiceDraftAllowed exists to refuse.
 */
export interface OfflineUnscheduledServiceDraft {
  kind: "unscheduled_service";
  draftId: string;
  residentId: string;
  /** Short display string (e.g. "Jamie Resident - Room 12") -- never a full resident record. */
  residentDisplayLabel: string;
  organizationId: string;
  facilityId: string;
  profileId: string;
  /** One of resident_unscheduled_services' closed service_kind set; the server is authoritative. */
  serviceKind: string;
  occurredAt: string;
  durationMinutes: number | null;
  requiresTwoStaff: boolean;
  note: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  syncState: OfflineDraftSyncState;
  lastSyncOutcome: OfflineDraftSyncOutcome | null;
  lastSyncError: string | null;
  /**
   * How many times the SERVER has executed this draft and refused it. Absent on records written
   * before the column existed, which read as zero. See nextStateAfterSyncFailure: a failure that
   * never reached the server does not count, so this is not an attempt count.
   */
  failedAttempts?: number;
}

/**
 * One observation on a change-of-condition event's monitoring cadence (BACKLOG.md E5 Tier 3).
 *
 * Its subject is an EVENT, not a resident or a task -- which is why it is a third member of the
 * union rather than a variant of either existing one. `residentDisplayLabel` is still carried, but
 * only so the drafts panel can say whose observation this is; the event is what the draft is about
 * and what its encryption scope binds to.
 */
export interface OfflineChangeObservationDraft {
  kind: "change_observation";
  draftId: string;
  eventId: string;
  /** Short display string (e.g. "Jamie Resident - Room 12") -- never a full resident record. */
  residentDisplayLabel: string;
  /** Short label for the event itself (e.g. "Mobility Decline") -- not the event's own narrative. */
  eventLabel: string;
  organizationId: string;
  facilityId: string;
  profileId: string;
  observedAt: string;
  observations: string;
  actionTaken: string | null;
  supervisorNotified: boolean;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  syncState: OfflineDraftSyncState;
  lastSyncOutcome: OfflineDraftSyncOutcome | null;
  lastSyncError: string | null;
  /**
   * How many times the SERVER has executed this draft and refused it. Absent on records written
   * before the column existed, which read as zero. See nextStateAfterSyncFailure: a failure that
   * never reached the server does not count, so this is not an attempt count.
   */
  failedAttempts?: number;
}

export type OfflineFloorDraft =
  | OfflineServiceDraft
  | OfflineUnscheduledServiceDraft
  | OfflineChangeObservationDraft;

/** Narrows without depending on the discriminator being present on legacy records. */
export function draftKindOf(draft: OfflineFloorDraft): OfflineDraftKind {
  return draft.kind ?? "service_task";
}

export function isUnscheduledServiceDraft(
  draft: OfflineFloorDraft,
): draft is OfflineUnscheduledServiceDraft {
  return draft.kind === "unscheduled_service";
}

export function isChangeObservationDraft(
  draft: OfflineFloorDraft,
): draft is OfflineChangeObservationDraft {
  return draft.kind === "change_observation";
}

const MAX_TEXT_LENGTH = 4000;

function assertNonEmptyId(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Offline service draft is missing "${field}"`);
  }
}

function assertTextWithinLimit(value: string | null | undefined, field: string): void {
  if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
    throw new Error(`Offline service draft field "${field}" exceeds ${MAX_TEXT_LENGTH} characters`);
  }
}

/**
 * Validates a draft before it is ever written to disk or sent to sync_offline_service_task_draft.
 * Throws on the first problem found -- this is a hard gate, not a best-effort sanitizer.
 */
export function assertServiceDraftAllowed(draft: OfflineServiceDraft): void {
  assertDraftLifecycleFields(draft, OFFLINE_DRAFT_SYNC_STATES);
  assertNonEmptyId(draft.draftId, "draftId");
  assertNonEmptyId(draft.taskId, "taskId");
  assertNonEmptyId(draft.residentId, "residentId");
  assertNonEmptyId(draft.organizationId, "organizationId");
  assertNonEmptyId(draft.facilityId, "facilityId");
  assertNonEmptyId(draft.profileId, "profileId");
  assertNonEmptyId(draft.idempotencyKey, "idempotencyKey");

  if (!(COMPLETION_RESPONSES as string[]).includes(draft.response)) {
    throw new Error(`Offline service draft response "${draft.response}" is not a recognized completion response`);
  }

  assertTextWithinLimit(draft.residentDisplayLabel, "residentDisplayLabel");
  assertTextWithinLimit(draft.serviceName, "serviceName");
  assertTextWithinLimit(draft.refusalHandling, "refusalHandling");

  // The follow-up key set is derived from serviceExceptionFollowUp.ts directly rather than
  // re-listing the seven responses' fields here -- that module is the one place this vocabulary is
  // allowed to change, and duplicating it would let the two drift.
  const allowedKeys = new Set(followUpFieldsFor(draft.response).map((field) => field.key));
  for (const [key, value] of Object.entries(draft.exceptionDetails ?? {})) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `Offline service draft exception detail "${key}" is not a recognized follow-up field for "${draft.response}"`,
      );
    }
    if (typeof value === "string") assertTextWithinLimit(value, `exceptionDetails.${key}`);
  }
}

/**
 * Hard gate for an unscheduled draft, mirroring assertServiceDraftAllowed.
 *
 * serviceKind is checked for presence and length only. Its closed vocabulary lives on
 * resident_unscheduled_services and is enforced there -- restating the eight values here would
 * give the client a second copy to drift out of step with, and an unrecognised value already
 * comes back as a `rejected` receipt the panel can flag rather than something that silently
 * disappears.
 */
export function assertUnscheduledServiceDraftAllowed(draft: OfflineUnscheduledServiceDraft): void {
  assertDraftLifecycleFields(draft, OFFLINE_DRAFT_SYNC_STATES);
  assertNonEmptyId(draft.draftId, "draftId");
  assertNonEmptyId(draft.residentId, "residentId");
  assertNonEmptyId(draft.organizationId, "organizationId");
  assertNonEmptyId(draft.facilityId, "facilityId");
  assertNonEmptyId(draft.profileId, "profileId");
  assertNonEmptyId(draft.idempotencyKey, "idempotencyKey");
  assertNonEmptyId(draft.serviceKind, "serviceKind");

  assertTextWithinLimit(draft.residentDisplayLabel, "residentDisplayLabel");
  assertTextWithinLimit(draft.serviceKind, "serviceKind");
  assertTextWithinLimit(draft.note, "note");

  if (
    draft.durationMinutes !== null
    && (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes < 1 || draft.durationMinutes > 480)
  ) {
    throw new Error("Offline unscheduled service draft duration must be a whole number of minutes between 1 and 480");
  }
}

/**
 * Hard gate for a monitoring observation, mirroring the other two.
 *
 * The three-character minimum matches add_change_event_monitoring's own floor rather than adding a
 * second, looser opinion client-side: a draft that would come back 'rejected' for empty text is
 * better refused at capture time, while the aide is still standing there and can type more.
 */
export function assertChangeObservationDraftAllowed(draft: OfflineChangeObservationDraft): void {
  assertDraftLifecycleFields(draft, OFFLINE_DRAFT_SYNC_STATES);
  assertNonEmptyId(draft.draftId, "draftId");
  assertNonEmptyId(draft.eventId, "eventId");
  assertNonEmptyId(draft.organizationId, "organizationId");
  assertNonEmptyId(draft.facilityId, "facilityId");
  assertNonEmptyId(draft.profileId, "profileId");
  assertNonEmptyId(draft.idempotencyKey, "idempotencyKey");

  if (typeof draft.observations !== "string" || draft.observations.trim().length < 3) {
    throw new Error("Offline change-of-condition observation needs at least a few words of observation");
  }

  assertTextWithinLimit(draft.residentDisplayLabel, "residentDisplayLabel");
  assertTextWithinLimit(draft.eventLabel, "eventLabel");
  assertTextWithinLimit(draft.observations, "observations");
  assertTextWithinLimit(draft.actionTaken, "actionTaken");
}

/** Dispatches to the gate for whichever kind this is. Legacy records narrow to service_task. */
export function assertFloorDraftAllowed(draft: OfflineFloorDraft): void {
  if (isUnscheduledServiceDraft(draft)) assertUnscheduledServiceDraftAllowed(draft);
  else if (isChangeObservationDraft(draft)) assertChangeObservationDraftAllowed(draft);
  else assertServiceDraftAllowed(draft);
}

export interface OfflineServiceDraftIdentitySnapshot { profileId: string; organizationId: string; role: string }

/**
 * Mirrors offlineLearning.ts's shouldWipeOfflineData -- same signature, same logic (role must stay
 * "employee", profile/org/role must stay identical, the account must stay active). Unlike that
 * helper, this one is actually wired to fire proactively: see the auth-state-change / profile-
 * resolution effect in auth.tsx, which calls this on every observed identity change rather than
 * leaving the check for the next time something happens to open the store.
 */
export function shouldWipeOfflineServiceDraftData(
  previous: OfflineServiceDraftIdentitySnapshot | null,
  current: (OfflineServiceDraftIdentitySnapshot & { active: boolean }) | null,
): boolean {
  if (!previous || !current) return previous !== null;
  return !current.active || current.role !== "employee"
    || previous.profileId !== current.profileId
    || previous.organizationId !== current.organizationId
    || previous.role !== current.role;
}

/**
 * Codex review finding: a `null` current identity is not always a real sign-out. The resolved-
 * profile effect in auth.tsx derives `current` from the profile query, which reads as no-data (and
 * therefore `user === null`) any time a still-valid session's profile hasn't resolved yet -- e.g.
 * right after the SIGNED_IN handler there clears the React Query cache and the profile is being
 * fetched again, or during a transient offline/network retry (see that query's own retry comment).
 * shouldWipeOfflineServiceDraftData itself is correct as written: given a real `null` it must treat
 * that as "no identity" and wipe if one was previously recorded -- that is exactly right for an
 * actual sign-out, and SIGNED_OUT already calls it that way directly. The bug is calling it AT ALL
 * with a `current` that is null only because the profile hasn't resolved for an existing session.
 * This is the caller-side guard for that: true while a session exists but nothing has resolved
 * either way (found, or -- via the definitive-absence effect signing the session out, which reaches
 * the explicit SIGNED_OUT wipe path -- absent) yet, so the wipe comparison should be skipped rather
 * than run with a misleadingly-empty `current`.
 */
export function isOfflineServiceDraftIdentityPending(hasSession: boolean, hasResolvedUser: boolean): boolean {
  return hasSession && !hasResolvedUser;
}

/**
 * Codex review finding: `navigator.onLine` only reflects whether the device has a link-layer
 * connection, not whether Supabase is actually reachable -- a LAN with no route out, a bad DNS
 * resolver, a captive portal, or Supabase itself being down all commonly leave it `true`. Documenting
 * care must not silently fail in exactly those cases, so DocumentCareDialog falls back to an offline
 * draft when the online mutation fails this way too -- but only this way; a real server rejection
 * (wrong role, task already documented, plan changed) must still reach the user, not vanish into a
 * silent draft.
 *
 * @supabase/postgrest-js sets `code` to `""` in exactly one place: the client-side catch around the
 * fetch call itself, before any HTTP response exists (DNS/connection failure, a captive portal
 * intercepting the request, CORS, etc. -- see its own PostgrestBuilder comment, "we don't populate
 * code/hint for client-side network errors since those fields are meant for upstream service
 * errors"). Every response PostgREST/Postgres actually sends back -- including this app's RPC
 * functions' own authorization (42501) and validation errors -- carries a real, non-empty error
 * code, so checking for the empty string distinguishes "never reached the server" from "the server
 * answered and said no" without guessing from message text.
 */
export function isNetworkLevelSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  return (error as { code?: unknown }).code === "";
}
