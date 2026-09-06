import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useVerifyCorrectiveAction, type CorrectiveAction } from "@/hooks/useCorrectiveActions";
import { facilityToday } from "@/lib/dateUtils";

// Completing a corrective action and verifying it are one step, not two.
//
// `approve_incident_investigation` refuses to approve an investigation while any COMPLETED
// corrective action has an empty `verification_notes`, and the client stage engine blocks closure
// on the same column. Before BACKLOG J13 nothing in the product wrote it -- the Complete button
// sent `{status, completed_date}` and there was no notes field anywhere -- so marking an action
// complete was what made its incident impossible to approve or close. The only escape was
// cancelling every action, which erases the record of the corrective work.
//
// So the button that marks an action complete asks for the verification at the same time, and
// `verify_corrective_action` writes all four columns together.
export function VerifyCorrectiveActionDialog({
  action,
  open,
  onOpenChange,
}: {
  action: CorrectiveAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { mutate: verify, isPending } = useVerifyCorrectiveAction();
  const [notes, setNotes] = useState("");
  const [completedOn, setCompletedOn] = useState("");

  useEffect(() => {
    if (open) {
      setNotes(action?.verification_notes ?? "");
      setCompletedOn(action?.completed_date ?? facilityToday());
    }
  }, [open, action?.id, action?.verification_notes, action?.completed_date]);

  const notesTooShort = notes.trim().length < 10;

  const handleSubmit = () => {
    if (!action || notesTooShort) return;
    verify(
      { id: action.id, verificationNotes: notes.trim(), completedOn: completedOn || undefined },
      {
        onSuccess: () => {
          toast({
            title: "Corrective action verified",
            description: "The action is recorded complete and verified, so the investigation can be approved.",
          });
          onOpenChange(false);
        },
        onError: (e: Error) =>
          toast({ title: "Could not verify the corrective action", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete and verify this corrective action</DialogTitle>
          <DialogDescription>
            {action?.description ?? "Record what was done and what you checked."} The investigation cannot be
            approved or closed until every completed action carries a verification, so both are recorded here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="corrective-action-completed-on">Completed on</Label>
            <Input
              id="corrective-action-completed-on"
              type="date"
              value={completedOn}
              max={facilityToday()}
              onChange={(e) => setCompletedOn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The day the work was actually done, not today, if they differ.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="corrective-action-verification">What you verified</Label>
            <Textarea
              id="corrective-action-verification"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What you checked, what you found, and how you know the action was effective."
            />
            <p className="text-xs text-muted-foreground">
              At least a sentence. This is what a surveyor reads as the evidence the correction happened.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || notesTooShort || !action}>
            Complete and verify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
