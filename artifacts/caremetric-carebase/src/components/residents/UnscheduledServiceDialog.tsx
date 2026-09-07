import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useRecordUnscheduledService } from "@/hooks/useFloorMode";
import {
  SYNC_OUTCOME_MESSAGES, useSaveOfflineUnscheduledDraft, useSyncOfflineServiceDraft,
} from "@/hooks/useOfflineServiceDrafts";

/**
 * The eight kinds the request names. Kept as a flat grid of large buttons because the whole value of
 * this capture is that it costs two taps -- care that was provided but not scheduled only becomes
 * evidence if recording it is faster than deciding whether to bother.
 */
const SERVICE_KINDS: { value: string; label: string }[] = [
  { value: "unscheduled_toileting", label: "Unscheduled toileting" },
  { value: "extra_transfer_assistance", label: "Extra transfer help" },
  { value: "additional_redirection", label: "Additional redirection" },
  { value: "increased_supervision", label: "Increased supervision" },
  { value: "extra_meal_assistance", label: "Extra meal help" },
  { value: "additional_hygiene", label: "Additional hygiene" },
  { value: "behavioral_intervention", label: "Behavioral intervention" },
  { value: "unplanned_safety_check", label: "Unplanned safety check" },
];

export function UnscheduledServiceDialog({
  open, onOpenChange, residentId, residentName, organizationId, facilityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
  // Needed only for the offline-draft path (BACKLOG.md E5 Tier 2). Floor already has both from the
  // task queue it loaded, so capturing offline needs no extra fetch.
  organizationId: string;
  facilityId: string;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const record = useRecordUnscheduledService();
  const saveOfflineDraft = useSaveOfflineUnscheduledDraft();
  const syncOfflineDraft = useSyncOfflineServiceDraft();
  // Only an employee has an offline store to mint an idempotency key in (useSaveOfflineUnscheduled-
  // Draft refuses any other role outright). Floor is employee-only today, but the dialog does not
  // get to assume that.
  const canDraftOffline = user?.role === "employee";
  const [kind, setKind] = useState<string | null>(null);
  const [requiresTwoStaff, setRequiresTwoStaff] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setRequiresTwoStaff(false);
    setNote("");
  }, [open]);

  const submit = async (chosen: string) => {
    // The care happened now; the sync may be hours away. The server trusts a plausible client time
    // for occurred_at, so recording it here is what keeps the note dated when it happened rather
    // than when the device next found signal.
    const occurredAt = new Date().toISOString();

    const attemptDirectWrite = async () => {
      try {
        await record.mutateAsync({
          residentId,
          serviceKind: chosen,
          requiresTwoStaff,
          note: note.trim() || undefined,
        });
        toast({ title: "Recorded", description: "Extra care logged for this resident." });
        onOpenChange(false);
      } catch (error) {
        toast({
          title: "Could not record this",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
    };

    if (!canDraftOffline) {
      // No offline store means no key that survives a retry, so the lost-response window below is
      // not closable for this caller. Keep the direct call it has always had.
      if (navigator.onLine === false) {
        toast({
          title: "You are offline",
          description: "This can't be recorded until this device is back online.",
          variant: "destructive",
        });
        return;
      }
      await attemptDirectWrite();
      return;
    }

    // Draft-first, online or not -- the same rule the caregiver charting surface and the
    // change-of-condition monitoring lane follow, for the same reason.
    //
    // record_unscheduled_service takes no idempotency key and has no natural guard: calling it twice
    // simply records the extra care twice. An online call whose HTTP response is lost in transit has
    // already committed but is indistinguishable client-side from one that never reached PostgreSQL
    // -- postgrest-js reports the same empty-code fetch error for both. Falling back to a NEW draft
    // with a NEW idempotency key, which is what this lane used to do, therefore double-records the
    // service on the next sync. Creating the draft (and therefore its idempotency key) BEFORE the
    // first network attempt is what closes that window: the retry carries the same key, and
    // sync_offline_unscheduled_service_draft's unique (device_id, idempotency_key) collapses it to
    // a 'duplicate' instead of a second entry in the resident's record.
    let draftId: string;
    try {
      const draft = await saveOfflineDraft.mutateAsync({
        residentId,
        residentDisplayLabel: residentName,
        organizationId,
        facilityId,
        serviceKind: chosen,
        occurredAt,
        durationMinutes: null,
        requiresTwoStaff,
        note: note.trim() || null,
      });
      draftId = draft.draftId;
    } catch {
      // No local store (private browsing, quota, a blocked upgrade) means the idempotent path is
      // simply unavailable. Refusing the write outright would be worse than the narrow
      // lost-response risk -- the care is real and the aide is standing at the bedside -- so fall
      // through to the direct call rather than losing it.
      await attemptDirectWrite();
      return;
    }

    // Durably on the device from here on, so the dialog can close whatever the network does next.
    onOpenChange(false);

    if (navigator.onLine === false) {
      toast({
        title: "Saved on this device",
        description: "It will sync when you are back online. It stays here until it does.",
      });
      return;
    }

    try {
      const outcome = await syncOfflineDraft.mutateAsync(draftId);
      if (outcome === "applied" || outcome === "duplicate") {
        toast({ title: "Recorded", description: "Extra care logged for this resident." });
        return;
      }
      // A real refusal (not your resident, an unrecognised service kind) is block-and-flagged in the
      // drafts panel rather than vanishing with the toast, which is the whole point of that panel.
      toast({
        title: "Could not record this",
        description: SYNC_OUTCOME_MESSAGES[outcome],
        variant: "destructive",
      });
    } catch {
      // navigator.onLine reads true with a LAN link but no route to Supabase (bad DNS, captive
      // portal, service outage), so the branch above misses that. The draft is already saved and
      // flagged for retry, so this is a status message, not a loss.
      toast({
        title: "Saved on this device",
        description: "It couldn't sync just now. It stays here and will retry.",
      });
    }
  };

  const busy = record.isPending || saveOfflineDraft.isPending || syncOfflineDraft.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Extra care</DialogTitle>
          <DialogDescription>
            Care you gave {residentName} that was not on the plan. Recorded now, counted later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SERVICE_KINDS.map((entry) => (
            <Button
              key={entry.value}
              variant={kind === entry.value ? "default" : "outline"}
              className="h-14 justify-start text-base"
              disabled={busy}
              onClick={() => (kind === entry.value ? void submit(entry.value) : setKind(entry.value))}
            >
              {entry.label}
            </Button>
          ))}
        </div>

        {kind && (
          <div className="space-y-3 border-t pt-3">
            <label className="flex min-h-11 items-center gap-3 text-base">
              <Checkbox className="h-6 w-6" checked={requiresTwoStaff} onCheckedChange={(next) => setRequiresTwoStaff(next === true)} />
              Needed two staff
            </label>
            <div className="space-y-1">
              <Label className="text-sm" htmlFor="unscheduled-note">Anything worth noting (optional)</Label>
              <Textarea id="unscheduled-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-12" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-12" disabled={!kind || busy} onClick={() => kind && void submit(kind)}>
            {busy ? "Saving..." : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
