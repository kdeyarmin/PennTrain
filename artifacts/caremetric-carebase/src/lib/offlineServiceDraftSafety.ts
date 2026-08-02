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
import { followUpFieldsFor, type FollowUpAnswers } from "./serviceExceptionFollowUp";

/** Where a draft sits in its own lifecycle. See UnsyncedDraftsPanel.tsx / useOfflineServiceDrafts.ts. */
export type OfflineDraftSyncState =
  | "draft"      // saved locally, not yet attempted
  | "syncing"    // a sync attempt is in flight
  | "applied"    // server accepted it -- deleted immediately, same session
  | "duplicate"  // server had already seen this attempt -- deleted immediately, same session
  | "conflict"   // someone else documented this task first -- kept, needs a human to dismiss
  | "stale"      // the task is no longer active (plan changed) -- kept, needs a human to dismiss
  | "rejected"   // the server refused it (authorization/validation) -- kept, needs a human to dismiss
  | "error";     // the sync attempt itself failed (network, etc.) -- kept, will retry

/** Mirrors sync_offline_service_task_draft's `outcome` column exactly. */
export type OfflineDraftSyncOutcome =
  | "applied" | "duplicate" | "conflict" | "stale" | "rejected" | "wipe_required";

/** Draft states that still need connectivity to resolve; the 24h/72h purge clock applies to these. */
export const UNRESOLVED_DRAFT_STATES: OfflineDraftSyncState[] = ["draft", "syncing", "error"];
/** Draft states that need a human to look at them; the 7-day ceiling applies to these regardless. */
export const NEEDS_REVIEW_DRAFT_STATES: OfflineDraftSyncState[] = ["conflict", "stale", "rejected"];

export interface OfflineServiceDraft {
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
