import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  initializeOfflineFloorDevice, listObservationDraftEntries, purgeExpiredObservationDrafts,
  readAllObservationDrafts, removeObservationDraft, saveObservationDraft, saveOfflineFloorDeviceId,
  updateObservationDraft, wipeOfflineServiceDrafts,
  type ObservationDraftListEntry, type OfflineFloorIdentity,
} from "@/lib/offlineServiceDraftCache";
import {
  assertObservationDraftAllowed, UNRESOLVED_OBSERVATION_DRAFT_STATES,
  type OfflineObservationDraft, type OfflineObservationSyncOutcome, type OfflineObservationSyncResult,
} from "@/lib/offlineObservationDraftSafety";
import { isCriticalFlag, OBSERVATION_CONFIG } from "@/lib/clinicalObservations";
import type { ObservationType } from "@/hooks/useClinicalObservations";

const QUERY_KEY = ["offline-observation-drafts"];

// Mirrors what the ONLINE recording/amendment mutations invalidate (useClinicalObservations.ts's
// CLINICAL_OBSERVATIONS_KEY/CLINICAL_CHART_SUMMARY_KEY), so a chart already open when an offline
// reading applies picks it up the same way one recorded online would -- QUERY_KEY above only covers
// this device's own outbox list, not the resident's chart. Literal keys, not imported, matching the
// sibling useOfflineServiceDrafts.ts's invalidateDomainFor: cross-domain invalidation here is by
// hand-verified key rather than an import across every domain hook.
function invalidateChartFor(queryClient: ReturnType<typeof useQueryClient>, residentIds: Iterable<string>): void {
  for (const residentId of new Set(residentIds)) {
    queryClient.invalidateQueries({ queryKey: ["clinical-observations", residentId] });
    queryClient.invalidateQueries({ queryKey: ["clinical-chart-summary", residentId] });
  }
}

function draftsSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function floorIdentity(userId: string, organizationId: string): OfflineFloorIdentity {
  return { organizationId, profileId: userId, role: "employee" };
}

/** Per-outcome copy for a floor worker -- block-and-flag, never raw server text. */
export const OBSERVATION_SYNC_MESSAGES: Record<OfflineObservationSyncOutcome, string> = {
  applied: "Recorded.",
  duplicate: "Recorded.",
  rejected: "This reading couldn't be submitted. Talk to your supervisor.",
  wipe_required: "This device's offline access was turned off. Unsynced readings here were cleared.",
};

/** Plain-text summary for the "copy reading" affordance on an overdue or flagged draft. */
export function formatObservationDraftForCopy(draft: OfflineObservationDraft): string {
  const config = OBSERVATION_CONFIG[draft.observationType];
  const label = draft.observationType === "custom" ? draft.customLabel ?? "Observation" : config.label;
  const value = draft.valueNumeric != null
    ? `${draft.valueNumeric}${draft.valueSecondary != null ? `/${draft.valueSecondary}` : ""}${draft.unit ? ` ${draft.unit}` : ""}`
    : draft.valueText ?? "—";
  const lines = [
    draft.residentDisplayLabel,
    `${label}: ${value}`,
    `Observed: ${new Date(draft.observedAt).toLocaleString()}`,
  ];
  if (draft.note) lines.push(`Note: ${draft.note}`);
  lines.push(`Saved on this device: ${new Date(draft.createdAt).toLocaleString()}`);
  return lines.join("\n");
}

export interface NewOfflineObservationDraftInput {
  residentId: string;
  residentDisplayLabel: string;
  observationType: ObservationType;
  observedAt: string;
  valueNumeric: number | null;
  valueSecondary: number | null;
  valueText: string | null;
  unit: string | null;
  customLabel: string | null;
  loincCode: string | null;
  note: string | null;
}

export function useUnsyncedObservationDraftEntries() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEY, "entries", user?.id],
    enabled: Boolean(user?.id && user.role === "employee" && draftsSupported()),
    queryFn: async (): Promise<ObservationDraftListEntry[]> => {
      await purgeExpiredObservationDrafts();
      return listObservationDraftEntries();
    },
  });
}

export function useUnsyncedObservationDrafts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEY, "full", user?.id],
    enabled: Boolean(user?.id && user.organizationId && user.role === "employee" && draftsSupported()),
    queryFn: async (): Promise<OfflineObservationDraft[]> => {
      if (!user?.id || !user.organizationId) return [];
      await purgeExpiredObservationDrafts();
      return readAllObservationDrafts(floorIdentity(user.id, user.organizationId));
    },
  });
}

export function useSaveOfflineObservationDraft() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewOfflineObservationDraftInput): Promise<OfflineObservationDraft> => {
      if (!user?.id || !user.organizationId || user.role !== "employee") {
        throw new Error("Offline vitals capture requires an active employee account.");
      }
      // Local only -- generates/holds this device's key and identity with no network round trip, so
      // the first reading on a device can be queued before that device has ever been online.
      await initializeOfflineFloorDevice(floorIdentity(user.id, user.organizationId));
      const now = new Date().toISOString();
      const draft: OfflineObservationDraft = {
        draftId: crypto.randomUUID(),
        residentId: input.residentId,
        residentDisplayLabel: input.residentDisplayLabel,
        organizationId: user.organizationId,
        profileId: user.id,
        observationType: input.observationType,
        observedAt: input.observedAt,
        valueNumeric: input.valueNumeric,
        valueSecondary: input.valueSecondary,
        valueText: input.valueText,
        unit: input.unit,
        customLabel: input.customLabel,
        loincCode: input.loincCode,
        note: input.note,
        idempotencyKey: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        syncState: "draft",
        lastSyncOutcome: null,
        lastSyncError: null,
      };
      assertObservationDraftAllowed(draft);
      return saveObservationDraft(draft);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

async function ensureRegisteredDeviceId(identity: OfflineFloorIdentity): Promise<string> {
  const initialized = await initializeOfflineFloorDevice(identity);
  if (initialized.metadata.deviceId) return initialized.metadata.deviceId;
  // The same device registration the service-draft lane uses -- one device, one row, whatever kind
  // of draft happens to be queued on it.
  const { data, error } = await supabase.rpc("register_offline_service_device", {
    p_device_public_key: initialized.metadata.publicMarker,
    p_device_fingerprint_sha256: initialized.metadata.fingerprintSha256,
  });
  if (error) throw error;
  const deviceId = data as string;
  await saveOfflineFloorDeviceId(deviceId);
  return deviceId;
}

async function syncDraft(
  identity: OfflineFloorIdentity, draft: OfflineObservationDraft,
): Promise<OfflineObservationSyncResult> {
  const deviceId = await ensureRegisteredDeviceId(identity);
  const { data, error } = await supabase.rpc("sync_offline_clinical_observation_draft", {
    p_device_id: deviceId,
    p_resident_id: draft.residentId,
    p_idempotency_key: draft.idempotencyKey,
    p_client_occurred_at: draft.createdAt,
    p_observation_type: draft.observationType,
    p_observed_at: draft.observedAt,
    p_value_numeric: draft.valueNumeric ?? undefined,
    p_value_secondary: draft.valueSecondary ?? undefined,
    p_value_text: draft.valueText ?? undefined,
    p_unit: draft.unit ?? undefined,
    p_custom_label: draft.customLabel ?? undefined,
    p_loinc_code: draft.loincCode ?? undefined,
    p_note: draft.note ?? undefined,
  });
  if (error) throw error;
  const result = data as unknown as {
    outcome: OfflineObservationSyncOutcome; errorMessage: string | null;
    observationId: string | null; abnormalFlag: string | null;
  };
  if (result.outcome === "wipe_required") {
    // The device itself is no longer trusted, so both draft kinds go -- this wipes the whole
    // "carebase-offline-floor" database, matching an explicit device revoke.
    await wipeOfflineServiceDrafts();
  } else if (result.outcome === "applied" || result.outcome === "duplicate") {
    await removeObservationDraft(draft.draftId);
  } else {
    await updateObservationDraft(
      draft.draftId,
      { syncState: result.outcome, lastSyncOutcome: result.outcome, lastSyncError: result.errorMessage },
      identity,
    );
  }
  return {
    outcome: result.outcome,
    observationId: result.observationId ?? null,
    abnormalFlag: result.abnormalFlag ?? null,
  };
}

export function useSyncOfflineObservationDraft() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string): Promise<OfflineObservationSyncResult> => {
      if (!user?.id || !user.organizationId) throw new Error("Sign in to sync offline readings.");
      const identity = floorIdentity(user.id, user.organizationId);
      const drafts = await readAllObservationDrafts(identity);
      const draft = drafts.find((entry) => entry.draftId === draftId);
      if (!draft) throw new Error("This reading is no longer on this device.");
      try {
        const result = await syncDraft(identity, draft);
        if (result.outcome === "applied") invalidateChartFor(queryClient, [draft.residentId]);
        return result;
      } catch (error) {
        await updateObservationDraft(
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

export interface ObservationSyncAllResult {
  attempted: number;
  applied: number;
  needsReview: number;
  wipeRequired: boolean;
  failed: number;
  /**
   * Readings this run charted that the server flagged critical, with enough context to name the
   * resident. The re-check dialog lives on the chart and only fires for a reading submitted while
   * the caregiver is standing there; one queued offline and flushed later would otherwise be
   * charted with no prompt at all -- the case where the caregiver is least likely to be looking at
   * the resident, and so the one that most needs saying out loud.
   */
  criticalReadings: { observationId: string; residentId: string; residentLabel: string }[];
}

/** Syncs every unresolved (draft/syncing/error) reading, sequentially. Stops early on wipe_required. */
export function useSyncAllOfflineObservationDrafts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ObservationSyncAllResult> => {
      if (!user?.id || !user.organizationId) throw new Error("Sign in to sync offline readings.");
      const identity = floorIdentity(user.id, user.organizationId);
      const drafts = (await readAllObservationDrafts(identity))
        .filter((draft) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(draft.syncState));
      const result: ObservationSyncAllResult = {
        attempted: 0, applied: 0, needsReview: 0, wipeRequired: false, failed: 0, criticalReadings: [],
      };
      const appliedResidentIds: string[] = [];
      for (const draft of drafts) {
        result.attempted += 1;
        try {
          const { outcome, observationId, abnormalFlag } = await syncDraft(identity, draft);
          if (outcome === "wipe_required") { result.wipeRequired = true; break; }
          if (outcome === "applied" || outcome === "duplicate") {
            result.applied += 1;
            if (outcome === "applied") appliedResidentIds.push(draft.residentId);
            if (observationId && abnormalFlag && isCriticalFlag(abnormalFlag)) {
              result.criticalReadings.push({
                observationId, residentId: draft.residentId, residentLabel: draft.residentDisplayLabel,
              });
            }
          }
          else result.needsReview += 1;
        } catch (error) {
          result.failed += 1;
          await updateObservationDraft(
            draft.draftId,
            { syncState: "error", lastSyncError: error instanceof Error ? error.message : String(error) },
            identity,
          ).catch(() => undefined);
        }
      }
      invalidateChartFor(queryClient, appliedResidentIds);
      return result;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** A human has reviewed a rejected reading and is discarding it. */
export function useDismissOfflineObservationDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => removeObservationDraft(draftId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
