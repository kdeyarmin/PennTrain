/**
 * Raise a supervisor follow-up on a service exception (BACKLOG.md G10).
 *
 * Documenting an exception could set a `supervisor_notified` flag -- a self-report by the person
 * recording it -- but nothing created a tracked item anybody had to close.
 * `record_service_exception_follow_up`, the only function that does, had no caller anywhere in the
 * repository. So the "Exceptions" tile counted work with no next step, whether or not somebody had
 * ticked the box.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** The four task statuses `record_service_exception_follow_up` accepts; anything else raises 22023. */
export const SERVICE_EXCEPTION_STATUSES = [
  "resident_refused",
  "resident_unavailable",
  "not_completed",
  "completed_late",
];

export function isServiceException(status: string): boolean {
  return SERVICE_EXCEPTION_STATUSES.includes(status);
}

export function ServiceExceptionFollowUpDialog({
  taskName,
  residentName,
  existingNote,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  taskName: string;
  residentName: string;
  existingNote: string | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) setReason(""); onOpenChange(next); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise supervisor follow-up</DialogTitle>
          <DialogDescription>
            Creates one review item for {residentName}&rsquo;s {taskName} and marks the task as escalated.
            Raising it twice reuses the same item rather than creating a second.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {existingNote && (
            <p className="rounded-md border bg-muted/30 p-2 text-sm text-muted-foreground">
              Recorded at the time: {existingNote}
            </p>
          )}
          <Label htmlFor="service-exception-reason">What the supervisor needs to know</Label>
          <Textarea
            id="service-exception-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Third refusal this week; resident says the morning slot is too early"
          />
          <p className="text-xs text-muted-foreground">
            Left blank, the item carries the note recorded at the time instead.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(""); onOpenChange(false); }} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={async () => { await onConfirm(reason.trim()); setReason(""); }}
          >
            Raise follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
