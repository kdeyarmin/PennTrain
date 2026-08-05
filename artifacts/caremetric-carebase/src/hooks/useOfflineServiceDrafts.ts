import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  getOfflineFloorDeviceMetadata,
  initializeOfflineFloorDevice, isUnsyncedDraftOverdue, listServiceDraftEntries,
  purgeExpiredServiceDrafts, readAllServiceDrafts, removeServiceDraft, saveOfflineFloorDeviceId,
  saveServiceDraft, updateServiceDraft, wipeOfflineServiceDrafts,
  type DraftListEntry, type OfflineFloorIdentity,
} from "@/lib/offlineServiceDraftCache";
import {
  assertChangeObservationDraftAllowed, assertServiceDraftAllowed,
  assertUnscheduledServiceDraftAllowed, draftKindOf, isChangeObservationDraft,
  isUnscheduledServiceDraft, NEEDS_REVIEW_DRAFT_STATES, UNRESOLVED_DRAFT_STATES,
  type OfflineChangeObservationDraft, type OfflineDraftKind, type OfflineDraftSyncOutcome,
  type OfflineFloorDraft, type OfflineServiceDraft, type OfflineUnscheduledServiceDraft,
} from "@/lib/offlineServiceDraftSafety";
import { followUpFieldsFor } from "@/lib/serviceExceptionFollowUp";
import type { CompletionResponse } from "@/lib/serviceDeliveryContract";
import type { Json } from "@/lib/database.types";

const QUERY_KEY = ["offline-service-drafts"];

function draftsSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function floorIdentity(userId: string, organizationId: string): OfflineFloorIdentity {
  return { organizationId, profileId: userId, role: "employee" };
}

/** Per-outcome copy the panel and dialog show -- block-and-flag, never raw server text for a human floor worker. */
export const SYNC_OUTCOME_MESSAGES: Record<OfflineDraftSyncOutcome, string> = {
  applied: "Recorded.",
  duplicate: "Recorded.",
  conflict: "Someone else documented this while your device was offline. Your note wasn't submitted.",
  stale: "This resident's plan changed and the task is no longer active. Your note wasn't submitted — check with your supervisor.",
  rejected: "This couldn't be submitted. Talk to your supervisor.",
  wipe_required: "This device's offline access was turned off. Unsynced notes here were cleared.",
};

/**
 * 'stale' means the server moved on, but WHAT moved is different per kind, and the difference is
 * what the aide has to act on: a task that left the plan is nothing they can still do anything
 * about, while a closed change-of-condition event means their observation is real, unfiled, and
 * needs a supervisor who can decide where it goes. One generic sentence would lose that.
 */
export function staleMessage(draft: OfflineFloorDraft): string {
  if (isChangeObservationDraft(draft)) {
    return "This change-of-condition event was closed before your observation could be filed. "
      + "It wasn't submitted — take it to your supervisor.";
  }
  return SYNC_OUTCOME_MESSAGES.stale;
}

function rejectedMessage(errorMessage: string | null): string {
  return errorMessage
    ? `This couldn't be submitted (${errorMessage}). Talk to your supervisor.`
    : SYNC_OUTCOME_MESSAGES.rejected;
}

/** Plain-text summary of a draft, for the "copy note" affordance on an overdue or flagged draft. */
/**
 * One-line summary for the drafts panel, for either kind.
 *
 * Lives here beside formatDraftNoteForCopy rather than in the panel so the two descriptions of a
 * draft cannot say different things about the same record.
 */
export function describeDraft(draft: OfflineFloorDraft): string {
  if (isUnscheduledServiceDraft(draft)) {
    return `${draft.serviceKind.replace(/_/g, " ")} · unscheduled`;
  }
  if (isChangeObservationDraft(draft)) {
    return `${draft.eventLabel} · monitoring observation`;
  }
  return `${draft.serviceName} · ${draft.response}`;
}

export function formatDraftNoteForCopy(draft: OfflineFloorDraft): string {
  if (isChangeObservationDraft(draft)) {
    const observationLines = [
      `${draft.residentDisplayLabel} — ${draft.eventLabel} (monitoring observation)`,
      `Observed: ${new Date(draft.observedAt).toLocaleString()}`,
      `Observations: ${draft.observations}`,
    ];
    if (draft.actionTaken) observationLines.push(`Action taken: ${draft.actionTaken}`);
    if (draft.supervisorNotified) observationLines.push("Supervisor was notified");
    observationLines.push(`Saved on this device: ${new Date(draft.createdAt).toLocaleString()}`);
    return observationLines.join("\n");
  }
  if (isUnscheduledServiceDraft(draft)) {
    const unscheduledLines = [
      `${draft.residentDisplayLabel} — ${draft.serviceKind.replace(/_/g, " ")} (unscheduled)`,
      `Occurred: ${new Date(draft.occurredAt).toLocaleString()}`,
    ];
    if (draft.durationMinutes !== null) unscheduledLines.push(`Duration: ${draft.durationMinutes} minutes`);
    if (draft.requiresTwoStaff) unscheduledLines.push("Required two staff");
    if (draft.note) unscheduledLines.push(`Note: ${draft.note}`);
    unscheduledLines.push(`Saved on this device: ${new Date(draft.createdAt).toLocaleString()}`);
    return unscheduledLines.join("\n");
  }
  const lines = [
    `${draft.residentDisplayLabel} — ${draft.serviceName}`,
    `Response: ${draft.response}`,
  ];
  for (const field of followUpFieldsFor(draft.response)) {
    const value = draft.exceptionDetails[field.key];
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${field.label}: ${String(value)}`);
  }
  lines.push(`Saved on this device: ${new Date(draft.createdAt).toLocaleString()}`);
  return lines.join("\n");
}

export interface NewOfflineServiceDraftInput {
  taskId: string;
  residentId: string;
  residentDisplayLabel: string;
  organizationId: string;
  facilityId: string;
  serviceName: string;
  scheduledStart: string;
  scheduledEnd: string;
  taskKind: string;
  acceptableResponses: CompletionResponse[];
  refusalHandling: string | null;
  response: CompletionResponse;
  exceptionDetails: OfflineServiceDraft["exceptionDetails"];
}

export interface NewOfflineChangeObservationDraftInput {
  eventId: string;
  residentDisplayLabel: string;
  /** Short label for the event (e.g. "Mobility Decline") -- not its narrative. */
  eventLabel: string;
  organizationId: string;
  facilityId: string;
  /** When the aide actually looked at the resident, which is not when the device found signal. */
  observedAt: string;
  observations: string;
  actionTaken: string | null;
  supervisorNotified: boolean;
}

export interface NewOfflineUnscheduledDraftInput {
  residentId: string;
  residentDisplayLabel: string;
  organizationId: string;
  facilityId: string;
  /** One of resident_unscheduled_services' closed set; the server is authoritative. */
  serviceKind: string;
  /** When the care actually happened, which is not when it was written down. */
  occurredAt: string;
  durationMinutes: number | null;
  requiresTwoStaff: boolean;
  note: string | null;
}

/**
 * Plaintext-only listing (draftId/taskId/syncState/createdAt) for the panel's counts -- cheap, no
 * decryption. Expired drafts are purged as part of the same read, since this is the surface every
 * mount of Floor re-queries anyway.
 */
export function useUnsyncedServiceDraftEntries() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEY, "entries", user?.id],
    enabled: Boolean(user?.id && user.role === "employee" && draftsSupported()),
    queryFn: async (): Promise<DraftListEntry[]> => {
      await purgeExpiredServiceDrafts();
      return listServiceDraftEntries();
    },
  });
}

/** Full, decrypted drafts -- used by the panel's per-item review list where content is actually shown. */
export function useUnsyncedServiceDrafts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEY, "full", user?.id],
    enabled: Boolean(user?.id && user.organizationId && user.role === "employee" && draftsSupported()),
    queryFn: async (): Promise<OfflineFloorDraft[]> => {
      if (!user?.id || !user.organizationId) return [];
      await purgeExpiredServiceDrafts();
      return readAllServiceDrafts(floorIdentity(user.id, user.organizationId));
    },
  });
}

export function useSaveOfflineServiceDraft() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewOfflineServiceDraftInput): Promise<OfflineServiceDraft> => {
      if (!user?.id || !user.organizationId || user.role !== "employee") {
        throw new Error("Offline service documentation requires an active employee account.");
      }
      // Local only -- generates/holds this device's key and identity with no network round trip, so
      // the very first draft on a device can be saved before that device has ever been online.
      await initializeOfflineFloorDevice(floorIdentity(user.id, user.organizationId));
      const now = new Date().toISOString();
      const draft: OfflineServiceDraft = {
        draftId: crypto.randomUUID(),
        taskId: input.taskId,
        residentId: input.residentId,
        residentDisplayLabel: input.residentDisplayLabel,
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        profileId: user.id,
        serviceName: input.serviceName,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        taskKind: input.taskKind,
        acceptableResponses: input.acceptableResponses,
        refusalHandling: input.refusalHandling,
        response: input.response,
        exceptionDetails: input.exceptionDetails,
        idempotencyKey: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        syncState: "draft",
        lastSyncOutcome: null,
        lastSyncError: null,
      };
      assertServiceDraftAllowed(draft);
      return saveServiceDraft(draft);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

async function ensureRegisteredDeviceId(identity: OfflineFloorIdentity): Promise<string> {
  const initialized = await initializeOfflineFloorDevice(identity);
  if (initialized.metadata.deviceId) return initialized.metadata.deviceId;
  const { data, error } = await supabase.rpc("register_offline_service_device", {
    p_device_public_key: initialized.metadata.publicMarker,
    p_device_fingerprint_sha256: initialized.metadata.fingerprintSha256,
  });
  if (error) throw error;
  const deviceId = data as string;
  await saveOfflineFloorDeviceId(deviceId);
  return deviceId;
}

/**
 * Syncs one draft and applies the result locally: applied/duplicate delete it immediately;
 * conflict/stale/rejected keep it, labeled, for a human to review and dismiss; wipe_required wipes
 * the entire local store, matching an explicit device revoke.
 */
// All three kinds share everything after the call: the outcome handling below is what makes a draft
// disappear, get flagged, or trigger a wipe, and duplicating it per kind is how they would drift.
// Only the RPC and its arguments differ.
async function callSyncRpc(deviceId: string, draft: OfflineFloorDraft) {
  if (isChangeObservationDraft(draft)) {
    return supabase.rpc("sync_offline_change_observation_draft", {
      p_device_id: deviceId,
      p_event_id: draft.eventId,
      p_idempotency_key: draft.idempotencyKey,
      p_client_observed_at: draft.observedAt,
      p_observations: draft.observations,
      p_action_taken: draft.actionTaken ?? undefined,
      p_supervisor_notified: draft.supervisorNotified,
    });
  }
  if (isUnscheduledServiceDraft(draft)) {
    return supabase.rpc("sync_offline_unscheduled_service_draft", {
      p_device_id: deviceId,
      p_resident_id: draft.residentId,
      p_idempotency_key: draft.idempotencyKey,
      p_client_occurred_at: draft.occurredAt,
      p_service_kind: draft.serviceKind,
      p_duration_minutes: draft.durationMinutes ?? undefined,
      p_requires_two_staff: draft.requiresTwoStaff,
      p_note: draft.note ?? undefined,
    });
  }
  return supabase.rpc("sync_offline_service_task_draft", {
    p_device_id: deviceId,
    p_task_id: draft.taskId,
    p_idempotency_key: draft.idempotencyKey,
    p_client_occurred_at: draft.createdAt,
    p_response: draft.response,
    p_exception_details: draft.exceptionDetails as Json,
  });
}

/**
 * Codex review finding (P2). A synced draft changes a domain record, not just the local store, and
 * the surface showing that record is often open at the moment the sync lands -- the drafts panel is
 * mounted on ChangeOfConditionDetail, which renders the very monitoring history a change-observation
 * sync just appended to. Invalidating only ["offline-service-drafts"] makes the draft disappear and
 * the toast say "recorded" while the immutable history below it still shows nothing, until a reload
 * or some unrelated invalidation happens by.
 *
 * Keyed per kind rather than invalidating everything: a service-task sync has no reason to refetch
 * change events, and vice versa.
 */
// Taken from what each domain's own online mutation already invalidates (useResidentServiceTasks'
// invalidateServiceTasks, useResidentCareDelivery's invalidateResidentCare, useResidentChangeEvents'
// invalidateChangeEvents) rather than guessed, so the offline path refreshes exactly what the online
// path does.
const DOMAIN_QUERY_KEYS_BY_KIND: Record<OfflineDraftKind, string[][]> = {
  service_task: [["resident-service-tasks"], ["service-task-alerts"], ["resident-360"], ["work-items"]],
  unscheduled_service: [["resident-care-delivery"], ["resident-service-tasks"], ["work-items"], ["daily-operations-command-center"]],
  change_observation: [["resident-change-events"], ["resident_compliance_items"], ["work-items"]],
};

function invalidateDomainFor(
  queryClient: ReturnType<typeof useQueryClient>,
  drafts: OfflineFloorDraft[],
): void {
  const kinds = new Set(drafts.map(draftKindOf));
  for (const kind of kinds) {
    for (const key of DOMAIN_QUERY_KEYS_BY_KIND[kind]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }
}

async function syncDraft(identity: OfflineFloorIdentity, draft: OfflineFloorDraft): Promise<OfflineDraftSyncOutcome> {
  const deviceId = await ensureRegisteredDeviceId(identity);
  const { data, error } = await callSyncRpc(deviceId, draft);
  if (error) throw error;
  const result = data as { outcome: OfflineDraftSyncOutcome; errorMessage: string | null };
  if (result.outcome === "wipe_required") {
    await wipeOfflineServiceDrafts();
  } else if (result.outcome === "applied" || result.outcome === "duplicate") {
    await removeServiceDraft(draft.draftId);
  } else {
    await updateServiceDraft(
      draft.draftId,
      { syncState: result.outcome, lastSyncOutcome: result.outcome, lastSyncError: result.errorMessage },
      identity,
    );
  }
  return result.outcome;
}


/**
 * Capture unscheduled care offline (BACKLOG.md E5 Tier 2).
 *
 * Separate from useSaveOfflineServiceDraft rather than a mode on it: the two drafts share no
 * required field beyond identity, and folding them together would make taskId, response and the
 * acceptable-response set optional for both -- which is precisely the shape
 * assertServiceDraftAllowed exists to refuse.
 *
 * occurredAt is the caller's, not now(): an aide writes this up minutes or hours after the care,
 * and the server treats a plausible client time as authoritative for occurred_at. createdAt stays
 * the moment it was written, because that is what the purge clock and the "unsynced for N hours"
 * warning are about.
 */
export function useSaveOfflineUnscheduledDraft() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewOfflineUnscheduledDraftInput): Promise<OfflineUnscheduledServiceDraft> => {
      if (!user?.id || !user.organizationId || user.role !== "employee") {
        throw new Error("Offline service documentation requires an active employee account.");
      }
      await initializeOfflineFloorDevice(floorIdentity(user.id, user.organizationId));
      const now = new Date().toISOString();
      const draft: OfflineUnscheduledServiceDraft = {
        kind: "unscheduled_service",
        draftId: crypto.randomUUID(),
        residentId: input.residentId,
        residentDisplayLabel: input.residentDisplayLabel,
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        profileId: user.id,
        serviceKind: input.serviceKind,
        occurredAt: input.occurredAt,
        durationMinutes: input.durationMinutes,
        requiresTwoStaff: input.requiresTwoStaff,
        note: input.note,
        idempotencyKey: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        syncState: "draft",
        lastSyncOutcome: null,
        lastSyncError: null,
      };
      assertUnscheduledServiceDraftAllowed(draft);
      return saveServiceDraft(draft);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/**
 * Capture one monitoring observation offline (BACKLOG.md E5 Tier 3).
 *
 * observedAt is the caller's, not now(): the aide may write this up a few minutes after the check,
 * and the server trusts a plausible client time. createdAt stays the moment it was written, because
 * that is what the purge clock and the "unsynced for over a day" warning are about.
 */
export function useSaveOfflineChangeObservationDraft() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewOfflineChangeObservationDraftInput): Promise<OfflineChangeObservationDraft> => {
      if (!user?.id || !user.organizationId || user.role !== "employee") {
        throw new Error("Offline service documentation requires an active employee account.");
      }
      await initializeOfflineFloorDevice(floorIdentity(user.id, user.organizationId));
      const now = new Date().toISOString();
      const draft: OfflineChangeObservationDraft = {
        kind: "change_observation",
        draftId: crypto.randomUUID(),
        eventId: input.eventId,
        residentDisplayLabel: input.residentDisplayLabel,
        eventLabel: input.eventLabel,
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        profileId: user.id,
        observedAt: input.observedAt,
        observations: input.observations,
        actionTaken: input.actionTaken,
        supervisorNotified: input.supervisorNotified,
        idempotencyKey: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        syncState: "draft",
        lastSyncOutcome: null,
        lastSyncError: null,
      };
      assertChangeObservationDraftAllowed(draft);
      return saveServiceDraft(draft);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useSyncOfflineServiceDraft() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string): Promise<OfflineDraftSyncOutcome> => {
      if (!user?.id || !user.organizationId) throw new Error("Sign in to sync offline drafts.");
      const identity = floorIdentity(user.id, user.organizationId);
      const drafts = await readAllServiceDrafts(identity);
      const draft = drafts.find((entry) => entry.draftId === draftId);
      if (!draft) throw new Error("This draft is no longer on this device.");
      try {
        const outcome = await syncDraft(identity, draft);
        if (outcome === "applied") invalidateDomainFor(queryClient, [draft]);
        return outcome;
      } catch (error) {
        await updateServiceDraft(
          draftId,
          { syncState: "error", lastSyncError: error instanceof Error ? error.message : String(error) },
          identity,
        );
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export interface SyncAllResult {
  attempted: number;
  applied: number;
  needsReview: number;
  wipeRequired: boolean;
  failed: number;
}

/** Syncs every unresolved (draft/syncing/error) draft, sequentially. Stops early on wipe_required. */
export function useSyncAllOfflineServiceDrafts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SyncAllResult> => {
      if (!user?.id || !user.organizationId) throw new Error("Sign in to sync offline drafts.");
      const identity = floorIdentity(user.id, user.organizationId);
      const drafts = (await readAllServiceDrafts(identity))
        .filter((draft) => (UNRESOLVED_DRAFT_STATES as string[]).includes(draft.syncState));
      const result: SyncAllResult = { attempted: 0, applied: 0, needsReview: 0, wipeRequired: false, failed: 0 };
      const applied: OfflineFloorDraft[] = [];
      for (const draft of drafts) {
        result.attempted += 1;
        try {
          const outcome = await syncDraft(identity, draft);
          if (outcome === "wipe_required") { result.wipeRequired = true; break; }
          if (outcome === "applied" || outcome === "duplicate") {
            result.applied += 1;
            if (outcome === "applied") applied.push(draft);
          } else result.needsReview += 1;
        } catch (error) {
          result.failed += 1;
          await updateServiceDraft(
            draft.draftId,
            { syncState: "error", lastSyncError: error instanceof Error ? error.message : String(error) },
            identity,
          ).catch(() => undefined);
        }
      }
      invalidateDomainFor(queryClient, applied);
      return result;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** A human has reviewed a conflict/stale/rejected draft and is discarding it. */
export function useDismissOfflineServiceDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => removeServiceDraft(draftId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/**
 * Is this device registered for offline service documentation, and does it still hold drafts?
 *
 * Read-only: it never registers a device as a side effect of being asked about one.
 */
export function useOfflineServiceDeviceRegistration() {
  return useQuery({
    queryKey: ["offline-service-device"],
    queryFn: async () => {
      const metadata = await getOfflineFloorDeviceMetadata();
      return metadata ? { deviceId: metadata.deviceId ?? null, registeredAt: metadata.createdAt } : null;
    },
  });
}

/**
 * Ending this device's registration, and wiping what it holds (BACKLOG.md G12.6).
 *
 * `register_offline_service_device` had five callers and `revoke_offline_service_device` had none,
 * so a phone could be enrolled to document care offline and never un-enrolled -- the same one-way
 * door closed for survey-packet guest grants in G9, and the same shape the learning device already
 * avoids via `useWipeOfflineCourses`.
 *
 * The caller is expected to refuse this while unsynced drafts remain: wiping the store destroys
 * care documentation that never reached the server, and no server-side undo exists. That check
 * lives in the surface, where the pending count is already known and can be shown.
 */
export function useRevokeOfflineServiceDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const metadata = await getOfflineFloorDeviceMetadata();
      // Revoke first: if the wipe failed afterwards the registration is still gone, which is the
      // safe order. Wiping first and failing to revoke would leave a device the server still trusts.
      if (metadata?.deviceId) {
        const { error } = await supabase.rpc("revoke_offline_service_device" as never, {
          p_device_id: metadata.deviceId,
        } as never);
        if (error) throw error;
      }
      await wipeOfflineServiceDrafts();
      return true;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["offline-service-device"] }),
        queryClient.invalidateQueries({ queryKey: ["offline-service-drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["offline-observation-drafts"] }),
      ]);
    },
  });
}

export { isUnsyncedDraftOverdue, NEEDS_REVIEW_DRAFT_STATES, UNRESOLVED_DRAFT_STATES, rejectedMessage };
