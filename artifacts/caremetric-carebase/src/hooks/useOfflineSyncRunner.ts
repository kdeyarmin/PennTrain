import { useToast } from "@/hooks/use-toast";
import { createRunLatch } from "@/lib/runLatch";
import { publishCriticalReadings } from "@/lib/criticalReadingBus";
import { SYNC_OUTCOME_MESSAGES, useSyncAllOfflineServiceDrafts } from "@/hooks/useOfflineServiceDrafts";
import { useSyncAllOfflineObservationDrafts } from "@/hooks/useOfflineObservationDrafts";

export interface OfflineCriticalReading {
  observationId: string;
  residentId: string;
  residentLabel: string;
}

export interface OfflineSyncRunResult {
  critical: OfflineCriticalReading[];
  /** Something actually reached the server, so a backoff can reset. */
  appliedAny: boolean;
  /** Nothing was pending -- the common case for a background tick. */
  idle: boolean;
  wiped: boolean;
}

// One run at a time, process-wide: the panel's manual button and the shell's background loop are
// different components, so only a module-level latch can serialise them. See lib/runLatch.ts for
// why overlapping runs are unsafe rather than merely wasteful.
const runLatch = createRunLatch<OfflineSyncRunResult>();

/**
 * Syncs both offline lanes and reports what happened.
 *
 * Lifted out of UnsyncedDraftsPanel so the background loop and the manual button share one
 * implementation. Splitting them would mean two copies of the lane ordering below, which is the
 * kind of duplication this program has already had to unpick twice.
 */
export function useRunAllOfflineSyncs() {
  const { toast } = useToast();
  const syncAll = useSyncAllOfflineServiceDrafts();
  const syncAllObservations = useSyncAllOfflineObservationDrafts();

  const runAll = async (): Promise<OfflineSyncRunResult> => {
    // Sequential, not Promise.all, for two reasons.
    //
    // 1. Promise.all discards the other lane's fulfilled result the moment one rejects -- a run
    //    that actually charted readings would report only "Sync failed", and a wipe_required from
    //    the surviving lane would never reach the user.
    // 2. Both lanes share one IndexedDB database, one device key, and one device registration. If
    //    the observation lane hits wipe_required it clears the whole store, including the device
    //    key and metadata; a service lane running concurrently would then find no metadata, mint a
    //    fresh key, and call register_offline_service_device -- whose upsert sets status='active'
    //    and clears wipe_required_at, re-activating the device that was just revoked and syncing
    //    the drafts the wipe existed to destroy. Stopping on the first wipe closes that.
    let applied = 0;
    let attempted = 0;
    let needsAttention = 0;
    let wiped = false;
    let failure: unknown = null;
    let critical: OfflineCriticalReading[] = [];

    // Written out rather than looped over both mutations: the two lanes return different result
    // shapes (only the observation lane can report a critical reading), and a loop collapses them
    // to a union that has to be narrowed back apart at every use.
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

    if (wiped) {
      toast({
        title: "Offline access was turned off for this device",
        description: SYNC_OUTCOME_MESSAGES.wipe_required,
        variant: "destructive",
      });
      return { critical, appliedAny: applied > 0, idle: false, wiped: true };
    }
    // Report what did land before reporting what did not -- a lane that charted readings should
    // say so even if the other lane threw.
    if (failure && applied === 0) {
      toast({
        title: "Sync failed",
        description: failure instanceof Error ? failure.message : "Try again when connected.",
        variant: "destructive",
      });
      return { critical, appliedAny: false, idle: false, wiped: false };
    }
    if (attempted === 0 && !failure) {
      // Nothing pending. The common case for a background tick, and deliberately silent.
      return { critical, appliedAny: false, idle: true, wiped: false };
    }
    if (needsAttention > 0 || failure) {
      toast({
        title: `${applied} recorded, ${needsAttention + (failure ? 1 : 0)} need attention`,
        description: "Review the flagged items below.",
        variant: "destructive",
      });
      return { critical, appliedAny: applied > 0, idle: false, wiped: false };
    }
    toast({ title: applied === 1 ? "1 item recorded" : `${applied} items recorded` });
    return { critical, appliedAny: applied > 0, idle: false, wiped: false };
  };

  // Published here, not by the caller. The manual "Sync now" used to drop these on the floor, and
  // the latch means a manual click during a background backoff JOINS that run rather than starting
  // one the manager would observe -- so a caller-side copy is not merely duplicated, it is missable.
  const run = (): Promise<OfflineSyncRunResult> => runLatch(async () => {
    const result = await runAll();
    publishCriticalReadings(result.critical);
    return result;
  });

  return { run, isPending: syncAll.isPending || syncAllObservations.isPending };
}
