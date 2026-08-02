import { useEffect, useState } from "react";
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
import { COMPLETION_RESPONSE_LABELS, type CompletionResponse } from "@/lib/serviceDeliveryContract";
import type { OfflineServiceDraft } from "@/lib/offlineServiceDraftSafety";

function copyNote(draft: OfflineServiceDraft, toast: ReturnType<typeof useToast>["toast"]) {
  void navigator.clipboard.writeText(formatDraftNoteForCopy(draft))
    .then(() => toast({ title: "Note copied", description: "Paste it wherever your supervisor needs it." }))
    .catch(() => toast({ title: "Couldn't copy the note", variant: "destructive" }));
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

  const pendingCount = (entries.data ?? []).filter((entry) => (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)).length;
  const reviewCount = (entries.data ?? []).filter((entry) => (NEEDS_REVIEW_DRAFT_STATES as string[]).includes(entry.syncState)).length;

  const runSyncAll = async () => {
    try {
      const result = await syncAll.mutateAsync();
      if (result.wipeRequired) {
        toast({ title: "Offline access was turned off for this device", description: SYNC_OUTCOME_MESSAGES.wipe_required, variant: "destructive" });
      } else if (result.attempted === 0) {
        // Nothing pending -- typical for the automatic online-event trigger firing with no backlog.
      } else if (result.needsReview > 0 || result.failed > 0) {
        toast({
          title: `${result.applied} recorded, ${result.needsReview + result.failed} need attention`,
          description: "Review the flagged notes below.",
          variant: "destructive",
        });
      } else {
        toast({ title: result.applied === 1 ? "1 note recorded" : `${result.applied} notes recorded` });
      }
    } catch (error) {
      toast({ title: "Sync failed", description: error instanceof Error ? error.message : "Try again when connected.", variant: "destructive" });
    }
  };

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

  if (!entries.isLoading && pendingCount === 0 && reviewCount === 0) return null;

  const needsReview = (drafts.data ?? []).filter((draft) => (NEEDS_REVIEW_DRAFT_STATES as string[]).includes(draft.syncState));
  const pending = (drafts.data ?? []).filter((draft) => (UNRESOLVED_DRAFT_STATES as string[]).includes(draft.syncState));

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
            disabled={!isOnline || syncAll.isPending || pendingCount === 0}
            onClick={() => void runSyncAll()}
          >
            {syncAll.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing…</>
              : <><CloudUpload className="mr-2 h-4 w-4" />Sync now</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
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
