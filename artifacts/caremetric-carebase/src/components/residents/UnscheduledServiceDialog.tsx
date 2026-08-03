import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRecordUnscheduledService } from "@/hooks/useFloorMode";
import { useSaveOfflineUnscheduledDraft } from "@/hooks/useOfflineServiceDrafts";
import { isNetworkLevelSupabaseError } from "@/lib/offlineServiceDraftSafety";

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
  const record = useRecordUnscheduledService();
  const saveOfflineDraft = useSaveOfflineUnscheduledDraft();
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
    const saveDraftLocally = async () => {
      await saveOfflineDraft.mutateAsync({
        residentId,
        residentDisplayLabel: residentName,
        organizationId,
        facilityId,
        serviceKind: chosen,
        // The care happened now; the sync may be hours away. The server trusts a plausible client
        // time for occurred_at, so recording it here is what keeps the note dated when it happened
        // rather than when the device next found signal.
        occurredAt: new Date().toISOString(),
        durationMinutes: null,
        requiresTwoStaff,
        note: note.trim() || null,
      });
      toast({
        title: "Saved on this device",
        description: "It will sync when you are back online. It stays here until it does.",
      });
      onOpenChange(false);
    };

    // Decided fresh at submit time rather than from render state, mirroring DocumentCareDialog:
    // an aide can walk out of signal between opening this and tapping a service kind.
    if (navigator.onLine === false) {
      try {
        await saveDraftLocally();
      } catch (error) {
        toast({
          title: "Could not save this offline",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
      return;
    }
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
      // navigator.onLine reads true with a LAN link but no route to Supabase (bad DNS, captive
      // portal, service outage), so the branch above misses that and the call fails having never
      // reached the server. Fall back only for that failure shape -- a real rejection
      // (authorization, an unrecognised service kind) must still surface rather than disappear
      // into a silent draft.
      if (isNetworkLevelSupabaseError(error)) {
        try {
          await saveDraftLocally();
        } catch (draftError) {
          toast({
            title: "Could not save this offline",
            description: draftError instanceof Error ? draftError.message : String(draftError),
            variant: "destructive",
          });
        }
        return;
      }
      toast({
        title: "Could not record this",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

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
              disabled={record.isPending}
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
          <Button className="h-12" disabled={!kind || record.isPending} onClick={() => kind && void submit(kind)}>
            {record.isPending ? "Saving..." : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
