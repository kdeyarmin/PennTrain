import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CloudOff, CloudUpload, Copy, Loader2, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  formatDraftNoteForCopy, isUnsyncedDraftOverdue, NEEDS_REVIEW_DRAFT_STATES, rejectedMessage,
  SYNC_OUTCOME_MESSAGES, UNRESOLVED_DRAFT_STATES, useDismissOfflineServiceDraft,
  useSyncAllOfflineServiceDrafts, useSyncOfflineServiceDraft, useUnsyncedServiceDraftEntries,
  useUnsyncedServiceDrafts,
} from "@/hooks/useOfflineServiceDrafts";
import {
  formatObservationDraftForCopy, OBSERVATION_SYNC_MESSAGES, useDismissOfflineObservationDraft,
  useSyncAllOfflineObservationDrafts, useSyncOfflineObservationDraft,
  useUnsyncedObservationDraftEntries, useUnsyncedObservationDrafts,
} from "@/hooks/useOfflineObservationDrafts";
import { isUnsyncedObservationDraftOverdue } from "@/lib/offlineServiceDraftCache";
import {
  NEEDS_REVIEW_OBSERVATION_DRAFT_STATES, UNRESOLVED_OBSERVATION_DRAFT_STATES,
  type OfflineObservationDraft,
} from "@/lib/offlineObservationDraftSafety";
import { OBSERVATION_CONFIG } from "@/lib/clinicalObservations";
import { COMPLETION_RESPONSE_LABELS, type CompletionResponse } from "@/lib/serviceDeliveryContract";
import type { OfflineServiceDraft } from "@/lib/offlineServiceDraftSafety";

function copyNote(draft: OfflineServiceDraft, toast: ReturnType<typeof useToast>["toast"]) {
  void navigator.clipboard.writeText(formatDraftNoteForCopy(draft))
    .then(() => toast({ title: "Note copied", description: "Paste it wherever your supervisor needs it." }))
    .catch(() => toast({ title: "Couldn't copy the note", variant: "destructive" }));
}

function copyReading(draft: OfflineObservationDraft, toast: ReturnType<typeof useToast>["toast"]) {
  void navigator.clipboard.writeText(formatObservationDraftForCopy(draft))
    .then(() => toast({ title: "Reading copied", description: "Paste it wherever your supervisor needs it." }))
    .catch(() => toast({ title: "Couldn't copy the reading", variant: "destructive" }));
}

/** "Blood pressure · 190/125 mm[Hg]" -- the one line that identifies a queued reading. */
function observationSummary(draft: OfflineObservationDraft): string {
  const label = draft.observationType === "custom"
    ? draft.customLabel ?? "Observation"
    : OBSERVATION_CONFIG[draft.observationType].label;
  const value = draft.valueNumeric != null
    ? `${draft.valueNumeric}${draft.valueSecondary != null ? `/${draft.valueSecondary}` : ""}${draft.unit ? ` ${draft.unit}` : ""}`
    : draft.valueText ?? "—";
  return `${label} · ${value}`;
}

function reviewMessage(draft: OfflineServiceDraft): string {
  if (draft.syncState === "rejected") return rejectedMessage(draft.lastSyncError);
  if (draft.syncState === "conflict" || draft.syncState === "stale") return SYNC_OUTCOME_MESSAGES[draft.syncState];
  return "This note needs review.";
}

/**
 * Unsynced offline service-documentation drafts (BACKLOG.md E5, Tier 1). Local to Floor -- not
 * global chrome -- because these drafts are always about a task from the queue this same page shows.
 *
 * Block-and-flag: a conflict/stale/rejected draft is never merged, auto-reconciled, or silently
 * retried. It stays here, clearly labeled, until a human dismisses it or the purge ceiling hits.
 */
export function UnsyncedDraftsPanel() {
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const entries = useUnsyncedServiceDraftEntries();
  const drafts = useUnsyncedServiceDrafts();
  const syncOne = useSyncOfflineServiceDraft();
  const syncAll = useSyncAllOfflineServiceDrafts();
  const dismiss = useDismissOfflineServiceDraft();

  // Vitals queued offline from the caregiver chart share this device and this panel -- an aide who
  // lost signal should find everything they still owe in one place, not two.
  const observationEntries = useUnsyncedObservationDraftEntries();
  const observationDrafts = useUnsyncedObservationDrafts();
  const syncOneObservation = useSyncOfflineObservationDraft();
  const syncAllObservations = useSyncAllOfflineObservationDrafts();
  const dismissObservation = useDismissOfflineObservationDraft();

  const pendingCount = (entries.data ?? []).filter((entry) => (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;
  const reviewCount = (entries.data ?? []).filter((entry) => (NEEDS_REVIEW_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (NEEDS_REVIEW_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;

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
    let critical: { observationId: string; residentId: string; residentLabel: string }[] = [];

    // Written out rather than looped over both mutations: the two lanes return different result
    // shapes (only the observation lane can report a critical reading), and a loop collapses them to
    // a union that has to be narrowed back apart at every use.
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

    // Raised before the ordinary success/failure reporting below, and kept on screen rather than
    // folded into a count. A vital sign the server flagged critical was charted here without anyone
    // watching -- the caregiver took it offline, possibly hours ago, and the chart's re-check dialog
    // never ran because they were not on that page when it synced. A line reading "3 items recorded"
    // is the wrong way to learn that.
    setCriticalFromSync(critical);

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
  // is heard only by components that were already mounted -- so a caregiver who lost signal on the
  // resident chart, regained it there, and then walked back to Floor would arrive with a backlog and
  // nothing to trigger it: the transition happened while no listener existed, and returning here
  // used to be a no-op. That left a charted reading device-only until someone noticed the panel and
  // pressed "Sync now", which is not what the offline toast promises.
  //
  // Gated on there actually being unresolved work so a normal visit costs no device registration or
  // IndexedDB read, and it waits for the draft queries to settle so a first paint with empty data
  // does not read as an empty backlog.
  const [criticalFromSync, setCriticalFromSync] =
    useState<{ observationId: string; residentId: string; residentLabel: string }[]>([]);

  const hasSettledEntries = entries.isSuccess && observationEntries.isSuccess;
  const syncedOnMountRef = useRef(false);
  useEffect(() => {
    if (syncedOnMountRef.current || !hasSettledEntries || !isOnline || pendingCount === 0) return;
    syncedOnMountRef.current = true;
    void runSyncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSettledEntries, isOnline, pendingCount]);

  // Best-effort automatic sync whenever this device regains connectivity, in addition to the manual
  // button below. Deliberately does not retry on a timer or on every render -- only on the browser's
  // own online signal, which is exactly the moment a backlog can first make progress.
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); void runSyncAll(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // criticalFromSync keeps the panel mounted after a clean run. Without it the successful sync that
  // charted the critical reading would empty the queue, this early return would fire, and the
  // warning would unmount in the same tick it was raised.
  if (!entries.isLoading && !observationEntries.isLoading
    && pendingCount === 0 && reviewCount === 0 && criticalFromSync.length === 0) return null;

  const needsReview = (drafts.data ?? []).filter((draft) => (NEEDS_REVIEW_DRAFT_STATES as string[]).includes(draft.syncState));
  const pending = (drafts.data ?? []).filter((draft) => (UNRESOLVED_DRAFT_STATES as string[]).includes(draft.syncState));
  const observationsNeedingReview = (observationDrafts.data ?? [])
    .filter((draft) => (NEEDS_REVIEW_OBSERVATION_DRAFT_STATES as string[]).includes(draft.syncState));
  const observationsPending = (observationDrafts.data ?? [])
    .filter((draft) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(draft.syncState));
  const syncingAll = syncAll.isPending || syncAllObservations.isPending;

  return (
    <Card>
      {criticalFromSync.length > 0 && (
        <div className="border-b border-destructive/30 bg-destructive/10 p-4" role="alert">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-destructive">
                {criticalFromSync.length === 1
                  ? "A reading just synced is outside the critical range"
                  : `${criticalFromSync.length} readings just synced are outside the critical range`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                These were taken offline and charted when this device reconnected. Re-check the
                resident and escalate if the reading stands.
              </p>
              <ul className="mt-3 space-y-2">
                {criticalFromSync.map((reading) => (
                  <li key={reading.observationId} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{reading.residentLabel}</span>
                    <Button asChild size="sm" variant="destructive" className="h-9">
                      <Link href={`/me/residents/${reading.residentId}`}>Open chart</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Dismiss critical reading warning"
              onClick={() => setCriticalFromSync([])}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><CloudOff className="h-4 w-4" />Unsynced documentation</CardTitle>
            <CardDescription>
              {pendingCount} pending{reviewCount > 0 ? `, ${reviewCount} need${reviewCount === 1 ? "s" : ""} review` : ""}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!isOnline || syncingAll || pendingCount === 0}
            onClick={() => void runSyncAll()}
          >
            {syncingAll
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing…</>
              : <><CloudUpload className="mr-2 h-4 w-4" />Sync now</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {observationsNeedingReview.map((draft) => (
          <div key={draft.draftId} className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{draft.residentDisplayLabel}</p>
                <p className="text-xs text-muted-foreground">{observationSummary(draft)}</p>
              </div>
              <Badge variant="outline" className="shrink-0 capitalize">{draft.syncState}</Badge>
            </div>
            <p className="text-sm text-destructive">
              {draft.lastSyncError
                ? `This reading couldn't be submitted (${draft.lastSyncError}). Talk to your supervisor.`
                : OBSERVATION_SYNC_MESSAGES.rejected}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copyReading(draft, toast)}>
                <Copy className="mr-2 h-3.5 w-3.5" />Copy reading
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={dismissObservation.isPending}
                onClick={() => void dismissObservation.mutateAsync(draft.draftId)}
              >
                <X className="mr-2 h-3.5 w-3.5" />Dismiss
              </Button>
            </div>
          </div>
        ))}

        {observationsPending.map((draft) => {
          const overdue = isUnsyncedObservationDraftOverdue({
            draftId: draft.draftId, residentId: draft.residentId, syncState: draft.syncState, createdAt: draft.createdAt,
          });
          return (
            <div key={draft.draftId} className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{draft.residentDisplayLabel}</p>
                <p className="text-xs text-muted-foreground">{observationSummary(draft)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {draft.syncState === "error"
                    ? "Couldn't sync yet on this device — will retry."
                    : "Saved on this device — will sync when you're back online."}
                </p>
                {overdue && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium text-warning-strong">
                      <TriangleAlert className="h-3.5 w-3.5" />Unsynced for over a day
                    </span>
                    <Button size="sm" variant="outline" onClick={() => copyReading(draft, toast)}>
                      <Copy className="mr-2 h-3.5 w-3.5" />Copy reading
                    </Button>
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                disabled={!isOnline || syncOneObservation.isPending}
                onClick={() => void syncOneObservation.mutateAsync(draft.draftId)}
              >
                Sync
              </Button>
            </div>
          );
        })}

        {needsReview.map((draft) => (
          <div key={draft.draftId} className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{draft.residentDisplayLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {draft.serviceName} · {COMPLETION_RESPONSE_LABELS[draft.response as CompletionResponse] ?? draft.response}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 capitalize">{draft.syncState}</Badge>
            </div>
            <p className="text-sm text-destructive">{reviewMessage(draft)}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copyNote(draft, toast)}>
                <Copy className="mr-2 h-3.5 w-3.5" />Copy note
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={dismiss.isPending}
                onClick={() => void dismiss.mutateAsync(draft.draftId)}
              >
                <X className="mr-2 h-3.5 w-3.5" />Dismiss
              </Button>
            </div>
          </div>
        ))}

        {pending.map((draft) => {
          const overdue = isUnsyncedDraftOverdue({ draftId: draft.draftId, taskId: draft.taskId, syncState: draft.syncState, createdAt: draft.createdAt });
          return (
            <div key={draft.draftId} className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{draft.residentDisplayLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {draft.serviceName} · {COMPLETION_RESPONSE_LABELS[draft.response as CompletionResponse] ?? draft.response}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {draft.syncState === "error"
                    ? "Couldn't sync yet on this device — will retry."
                    : "Saved on this device — will sync when you're back online."}
                </p>
                {overdue && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium text-warning-strong">
                      <TriangleAlert className="h-3.5 w-3.5" />Unsynced for over a day
                    </span>
                    <Button size="sm" variant="outline" onClick={() => copyNote(draft, toast)}>
                      <Copy className="mr-2 h-3.5 w-3.5" />Copy note
                    </Button>
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                disabled={!isOnline || syncOne.isPending}
                onClick={() => void syncOne.mutateAsync(draft.draftId)}
              >
                Sync
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
