import {
  createContext, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  SYNC_OUTCOME_MESSAGES, UNRESOLVED_DRAFT_STATES, useSyncAllOfflineServiceDrafts,
  useUnsyncedServiceDraftEntries,
} from "@/hooks/useOfflineServiceDrafts";
import { useSyncAllOfflineObservationDrafts, useUnsyncedObservationDraftEntries } from "@/hooks/useOfflineObservationDrafts";
import { UNRESOLVED_OBSERVATION_DRAFT_STATES } from "@/lib/offlineObservationDraftSafety";

export interface CriticalSyncedReading { observationId: string; residentId: string; residentLabel: string }

interface OfflineFloorSyncContextValue {
  isOnline: boolean;
  isSyncingAll: boolean;
  pendingCount: number;
  runSyncAll: () => Promise<void>;
  criticalReadings: CriticalSyncedReading[];
  dismissCriticalReadings: () => void;
}

const OfflineFloorSyncContext = createContext<OfflineFloorSyncContextValue | null>(null);

export function useOfflineFloorSync(): OfflineFloorSyncContextValue {
  const ctx = useContext(OfflineFloorSyncContext);
  if (!ctx) throw new Error("useOfflineFloorSync must be used within OfflineFloorSyncProvider");
  return ctx;
}

/**
 * BACKLOG.md item 7(a). UnsyncedDraftsPanel used to own the connectivity watch (sync on mount, sync
 * on the `online` event) itself, which meant the watch only existed while Floor or the roster
 * happened to be the mounted page -- nobody watched connectivity while a caregiver sat on the chart
 * itself (`/me/residents/:id`), which is exactly where a reading is taken. This provider is mounted
 * once in MainLayout -- the shell every authenticated route renders inside -- so the watch runs no
 * matter which page is open.
 *
 * This has to be the *only* place that triggers an automatic sync-all, not one more of them:
 * runSyncAll's own sequencing (below) exists because a wipe_required from one draft lane mid-loop
 * has to stop the run before the other lane can mint a fresh device registration against a store
 * that was just wiped -- two independent auto-sync loops (e.g. one here and one still in the panel)
 * could hit that same hazard against each other. UnsyncedDraftsPanel reads isOnline/isSyncingAll/
 * runSyncAll from this context for its manual "Sync now" button instead of keeping a second copy.
 */
export function OfflineFloorSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isEmployee = user?.role === "employee";
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [criticalReadings, setCriticalReadings] = useState<CriticalSyncedReading[]>([]);

  // Both queries already gate on user.role === "employee" internally (enabled), so pendingCount
  // and hasSettledEntries below are naturally inert for every other role.
  const entries = useUnsyncedServiceDraftEntries();
  const observationEntries = useUnsyncedObservationDraftEntries();
  const syncAll = useSyncAllOfflineServiceDrafts();
  const syncAllObservations = useSyncAllOfflineObservationDrafts();

  const pendingCount = (entries.data ?? []).filter((entry) => (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;

  const runSyncAll = async () => {
    // Sequential, not Promise.all, for two reasons.
    //
    // 1. Promise.all discards the other lane's fulfilled result the moment one rejects -- a run that
    //    actually charted readings would report only "Sync failed", and a wipe_required from the
    //    surviving lane would never reach the user.
    // 2. Both lanes share one IndexedDB database, one device key, and one device registration. If the
    //    observation lane hits wipe_required it clears the whole store, including the device key and
    //    metadata; a service lane running concurrently would then find no metadata, mint a fresh key,
    //    and call register_offline_service_device -- whose upsert sets status='active' and clears
    //    wipe_required_at, re-activating the device that was just revoked and syncing the drafts the
    //    wipe existed to destroy. Stopping on the first wipe closes that.
    let applied = 0;
    let attempted = 0;
    let needsAttention = 0;
    let wiped = false;
    let failure: unknown = null;
    let critical: CriticalSyncedReading[] = [];

    try {
      const result = await syncAll.mutateAsync();
      attempted += result.attempted;
      applied += result.applied;
      needsAttention += result.needsReview + result.failed;
      if (result.wipeRequired) wiped = true;
    } catch (error) {
      failure = error;
    }

    if (!wiped) {
      try {
        const result = await syncAllObservations.mutateAsync();
        attempted += result.attempted;
        applied += result.applied;
        needsAttention += result.needsReview + result.failed;
        critical = result.criticalReadings;
        if (result.wipeRequired) wiped = true;
      } catch (error) {
        failure = error;
      }
    }

    // Accumulated, not replaced: this provider stays mounted for the whole session (not just one
    // page visit), so a later, unrelated sync pass reporting zero new critical readings must not
    // silently drop a still-undismissed warning from an earlier pass. Deduped by observationId as a
    // simple guard, though in practice a reading can only ever be reported once -- an applied draft
    // is removed from IndexedDB immediately, so it cannot be re-synced and re-reported.
    if (critical.length > 0) {
      setCriticalReadings((current) => {
        const seen = new Set(current.map((reading) => reading.observationId));
        const additions = critical.filter((reading) => !seen.has(reading.observationId));
        return additions.length > 0 ? [...current, ...additions] : current;
      });
    }

    if (wiped) {
      toast({ title: "Offline access was turned off for this device", description: SYNC_OUTCOME_MESSAGES.wipe_required, variant: "destructive" });
      return;
    }
    // Report what did land before reporting what did not -- a lane that charted readings should say
    // so even if the other lane threw.
    if (failure && applied === 0) {
      toast({ title: "Sync failed", description: failure instanceof Error ? failure.message : "Try again when connected.", variant: "destructive" });
      return;
    }
    if (attempted === 0 && !failure) {
      // Nothing pending -- typical for the automatic online-event trigger firing with no backlog.
      return;
    }
    if (needsAttention > 0 || failure) {
      toast({
        title: `${applied} recorded, ${needsAttention + (failure ? 1 : 0)} need attention`,
        description: "Review the flagged items below.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: applied === 1 ? "1 item recorded" : `${applied} items recorded` });
  };

  // Catch up on mount, not only on the `online` event. The event fires once, at the transition, and
  // is heard only while this provider is mounted -- which is now the whole authenticated session, so
  // this also covers a tab that was simply left open and reconnected before ever regaining focus.
  const hasSettledEntries = entries.isSuccess && observationEntries.isSuccess;
  const syncedOnMountRef = useRef(false);
  useEffect(() => {
    if (syncedOnMountRef.current || !hasSettledEntries || !isOnline || pendingCount === 0) return;
    syncedOnMountRef.current = true;
    void runSyncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSettledEntries, isOnline, pendingCount]);

  // Best-effort automatic sync whenever this device regains connectivity, in addition to the manual
  // button in UnsyncedDraftsPanel. Deliberately does not retry on a timer or on every render -- only
  // on the browser's own online signal, which is exactly the moment a backlog can first make
  // progress. Gated on isEmployee explicitly (rather than relying on the mutations' own no-op-for-
  // wrong-identity behavior) so every other role's tab does not open an IndexedDB connection on every
  // reconnect for no reason -- this provider is mounted for every authenticated route, not just /me.
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (isEmployee) void runSyncAll();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployee]);

  return (
    <OfflineFloorSyncContext.Provider
      value={{
        isOnline,
        isSyncingAll: syncAll.isPending || syncAllObservations.isPending,
        pendingCount,
        runSyncAll,
        criticalReadings,
        dismissCriticalReadings: () => setCriticalReadings([]),
      }}
    >
      {children}
    </OfflineFloorSyncContext.Provider>
  );
}
