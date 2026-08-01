import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface QuarantinePackageDialogProps {
  open: boolean;
  packagePath?: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

/** B5 — in-app quarantine reason (replaces window.prompt). */
export function QuarantinePackageDialog({
  open,
  packagePath,
  pending = false,
  onOpenChange,
  onConfirm,
}: QuarantinePackageDialogProps) {
  const [reason, setReason] = useState("");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quarantine learning package</AlertDialogTitle>
          <AlertDialogDescription>
            Learners will no longer be able to launch this package. Record why it failed review.
            To recover, upload a corrected zip on the course — registration creates a new package
            for accept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {packagePath ? (
          <p className="truncate text-xs text-muted-foreground">{packagePath}</p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="quarantine-reason">Reject reason</Label>
          <Textarea
            id="quarantine-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Missing manifest, hostile paths, vendor runtime never connects…"
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={reason.trim().length < 8 || pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(reason.trim());
            }}
          >
            {pending ? "Saving…" : "Confirm quarantine"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
