import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CloudOff, CloudUpload, Copy, Loader2, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  describeDraft, formatDraftNoteForCopy, isUnsyncedDraftOverdue, NEEDS_REVIEW_DRAFT_STATES, rejectedMessage,
  staleMessage, SYNC_OUTCOME_MESSAGES, UNRESOLVED_DRAFT_STATES, useDismissOfflineServiceDraft,
  useSyncOfflineServiceDraft, useUnsyncedServiceDraftEntries,
  useUnsyncedServiceDrafts,
} from "@/hooks/useOfflineServiceDrafts";
import { useRunAllOfflineSyncs } from "@/hooks/useOfflineSyncRunner";
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
import { draftKindOf, type OfflineDraftSyncState, type OfflineFloorDraft } from "@/lib/offlineServiceDraftSafety";

function copyNote(draft: OfflineFloorDraft, toast: ReturnType<typeof useToast>["toast"]) {
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

function reviewMessage(draft: OfflineFloorDraft): string {
  if (draft.syncState === "rejected") return rejectedMessage(draft.lastSyncError);
  // 'stale' reads differently per kind -- a task that left the plan versus a change-of-condition
  // event that closed with the observation still in hand. See staleMessage.
  if (draft.syncState === "stale") return staleMessage(draft);
  if (draft.syncState === "conflict") {
    return SYNC_OUTCOME_MESSAGES[draft.syncState as OfflineDraftSyncState & keyof typeof SYNC_OUTCOME_MESSAGES];
  }
  return "This note needs review.";
}

/**
 * Unsynced offline documentation drafts (BACKLOG.md E5).
 *
 * This is a DEVICE-level outbox, not a page-level one: it lists every unsynced draft on this device
 * regardless of which surface captured it. Tier 1 mounted it only on Floor, when every draft was a
 * task from the queue that page shows. Tier 3 captures observations on ChangeOfConditionDetail, so
 * it is mounted there too -- a draft whose only surface an aide never happens to open would sit
 * invisible until the purge ceiling silently deleted it, which is the one failure this panel exists
 * to prevent. It renders nothing when there is no backlog, so a second mount costs an empty render.
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
  const { run, isPending: syncAllPending } = useRunAllOfflineSyncs();
  const dismiss = useDismissOfflineServiceDraft();

  // Vitals queued offline from the caregiver chart share this device and this panel -- an aide who
  // lost signal should find everything they still owe in one place, not two.
  const observationEntries = useUnsyncedObservationDraftEntries();
  const observationDrafts = useUnsyncedObservationDrafts();
  const syncOneObservation = useSyncOfflineObservationDraft();
  const dismissObservation = useDismissOfflineObservationDraft();

  const pendingCount = (entries.data ?? []).filter((entry) => (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;
  const reviewCount = (entries.data ?? []).filter((entry) => (NEEDS_REVIEW_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (NEEDS_REVIEW_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;

  // The two-lane run now lives in useOfflineSyncRunner, shared with the shell-mounted
  // OfflineSyncManager that owns the automatic loop (BACKLOG.md open question 7a). This component
  // keeps only the parts a user drives: the list, "Sync now", and dismissing a flagged draft.
  // The runner serialises concurrent calls, so pressing the button mid-background-run joins that
  // run rather than starting a second one against the same shared device registration.
  const runSyncAll = async () => { await run(); };

  if (!entries.isLoading && !observationEntries.isLoading
    && pendingCount === 0 && reviewCount === 0) return null;

  const needsReview = (drafts.data ?? []).filter((draft) => (NEEDS_REVIEW_DRAFT_STATES as string[]).includes(draft.syncState));
  const pending = (drafts.data ?? []).filter((draft) => (UNRESOLVED_DRAFT_STATES as string[]).includes(draft.syncState));
  const observationsNeedingReview = (observationDrafts.data ?? [])
    .filter((draft) => (NEEDS_REVIEW_OBSERVATION_DRAFT_STATES as string[]).includes(draft.syncState));
  const observationsPending = (observationDrafts.data ?? [])
    .filter((draft) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(draft.syncState));
  const syncingAll = syncAllPending;

  return (
    <Card>
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
                  {describeDraft(draft)}
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
          const overdue = isUnsyncedDraftOverdue({ draftId: draft.draftId, kind: draftKindOf(draft), syncState: draft.syncState, createdAt: draft.createdAt });
          return (
            <div key={draft.draftId} className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{draft.residentDisplayLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {describeDraft(draft)}
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
