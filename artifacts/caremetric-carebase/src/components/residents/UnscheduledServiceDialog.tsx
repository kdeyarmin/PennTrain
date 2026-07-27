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
  open, onOpenChange, residentId, residentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
}) {
  const { toast } = useToast();
  const record = useRecordUnscheduledService();
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
