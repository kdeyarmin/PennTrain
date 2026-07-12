import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLogResidentChangeOfCondition } from "@/hooks/useResidentComplianceItems";

export interface ChangeOfConditionResidentOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface LogChangeOfConditionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Exactly one of the two: a fixed resident (ResidentDetail) or a picker list (State Forms
  // Center, where the user hasn't navigated to a specific resident yet).
  residentId?: string;
  residents?: ChangeOfConditionResidentOption[];
}

export function LogChangeOfConditionDialog({ open, onOpenChange, residentId, residents }: LogChangeOfConditionDialogProps) {
  const { toast } = useToast();
  const logChangeOfCondition = useLogResidentChangeOfCondition();
  const [notes, setNotes] = useState("");
  const [selectedResidentId, setSelectedResidentId] = useState("");

  const targetResidentId = residentId ?? selectedResidentId;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setNotes("");
      setSelectedResidentId("");
    }
  };

  const handleSubmit = () => {
    if (!targetResidentId) return;
    logChangeOfCondition.mutate(
      { residentId: targetResidentId, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: "Significant change reassessment logged" });
          close(false);
        },
        onError: (e: Error) => toast({ title: "Failed to log change of condition", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Change of Condition</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            PA DHS requires a reassessment when a resident's condition significantly changes, but
            specifies no exact turnaround time — this schedules it as due immediately so it stays
            visible until completed.
          </p>
          {!residentId && (
            <div className="space-y-1">
              <Label className="text-xs">Resident</Label>
              <Select value={selectedResidentId} onValueChange={setSelectedResidentId}>
                <SelectTrigger><SelectValue placeholder="Select a resident" /></SelectTrigger>
                <SelectContent>
                  {(residents ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.last_name}, {r.first_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Textarea
            placeholder="Optional note (e.g. fall, ER visit 7/3)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!targetResidentId || logChangeOfCondition.isPending}>
            {logChangeOfCondition.isPending ? "Logging..." : "Log Change of Condition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
