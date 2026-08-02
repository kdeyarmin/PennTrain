import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  initializeOfflineFloorDevice, isUnsyncedDraftOverdue, listServiceDraftEntries,
  purgeExpiredServiceDrafts, readAllServiceDrafts, removeServiceDraft, saveOfflineFloorDeviceId,
  saveServiceDraft, updateServiceDraft, wipeOfflineServiceDrafts,
  type DraftListEntry, type OfflineFloorIdentity,
} from "@/lib/offlineServiceDraftCache";
import {
  assertServiceDraftAllowed, NEEDS_REVIEW_DRAFT_STATES, UNRESOLVED_DRAFT_STATES,
  type OfflineDraftSyncOutcome, type OfflineServiceDraft,
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

function rejectedMessage(errorMessage: string | null): string {
  return errorMessage
    ? `This couldn't be submitted (${errorMessage}). Talk to your supervisor.`
    : SYNC_OUTCOME_MESSAGES.rejected;
}

/** Plain-text summary of a draft, for the "copy note" affordance on an overdue or flagged draft. */
export function formatDraftNoteForCopy(draft: OfflineServiceDraft): string {
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
    queryFn: async (): Promise<OfflineServiceDraft[]> => {
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
async function syncDraft(identity: OfflineFloorIdentity, draft: OfflineServiceDraft): Promise<OfflineDraftSyncOutcome> {
  const deviceId = await ensureRegisteredDeviceId(identity);
  const { data, error } = await supabase.rpc("sync_offline_service_task_draft", {
    p_device_id: deviceId,
    p_task_id: draft.taskId,
    p_idempotency_key: draft.idempotencyKey,
    p_client_occurred_at: draft.createdAt,
    p_response: draft.response,
    p_exception_details: draft.exceptionDetails as Json,
  });
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
        return await syncDraft(identity, draft);
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
      for (const draft of drafts) {
        result.attempted += 1;
        try {
          const outcome = await syncDraft(identity, draft);
          if (outcome === "wipe_required") { result.wipeRequired = true; break; }
          if (outcome === "applied" || outcome === "duplicate") result.applied += 1;
          else result.needsReview += 1;
        } catch (error) {
          result.failed += 1;
          await updateServiceDraft(
            draft.draftId,
            { syncState: "error", lastSyncError: error instanceof Error ? error.message : String(error) },
            identity,
          ).catch(() => undefined);
        }
      }
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

export { isUnsyncedDraftOverdue, NEEDS_REVIEW_DRAFT_STATES, UNRESOLVED_DRAFT_STATES, rejectedMessage };
