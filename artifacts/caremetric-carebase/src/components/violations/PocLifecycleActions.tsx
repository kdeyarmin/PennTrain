import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import {
  useListPocVersions,
  useSubmitPlanOfCorrection,
  useMarkPlanOfCorrectionCorrected,
  useVerifyPlanOfCorrection,
} from "@/hooks/usePocLifecycle";
import { formatDateForDisplay } from "@/lib/dateUtils";

interface PocLifecycleActionsProps {
  violationId: string;
  status: string;
  canManage: boolean;
  /** Pre-types-regen rows may not expose this column. */
  effectivenessNotes?: string | null;
}

/**
 * POC status transitions via SECURITY DEFINER RPCs (C1–C3).
 * Use next to Generate POC PDF on ViolationDetail.
 */
export function PocLifecycleActions({
  violationId,
  status,
  canManage,
  effectivenessNotes,
}: PocLifecycleActionsProps) {
  const { toast } = useToast();
  const submitPoc = useSubmitPlanOfCorrection();
  const markCorrected = useMarkPlanOfCorrectionCorrected();
  const verifyPoc = useVerifyPlanOfCorrection();
  const { data: versions } = useListPocVersions(violationId);
  const [amendmentReason, setAmendmentReason] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [notes, setNotes] = useState("");
  const pending = submitPoc.isPending || markCorrected.isPending || verifyPoc.isPending;

  if (!canManage) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              submitPoc.mutate(
                { violationId },
                {
                  onSuccess: () => toast({ title: "Plan of Correction submitted (version frozen)" }),
                  onError: (e: Error) =>
                    toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
                },
              );
            }}
          >
            Submit Plan of Correction
          </Button>
        )}
        {status === "poc_submitted" && (
          <>
            <Input
              placeholder="Amendment reason (if resubmitting)"
              value={amendmentReason}
              onChange={(e) => setAmendmentReason(e.target.value)}
              className="h-9 w-56"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                submitPoc.mutate(
                  { violationId, amendmentReason: amendmentReason.trim() || undefined },
                  {
                    onSuccess: () => {
                      setAmendmentReason("");
                      toast({ title: "POC version recorded" });
                    },
                    onError: (e: Error) =>
                      toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
                  },
                );
              }}
            >
              Resubmit / Amend POC
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                markCorrected.mutate(violationId, {
                  onSuccess: () => toast({ title: "Marked corrected" }),
                  onError: (e: Error) =>
                    toast({ title: "Cannot mark corrected", description: e.message, variant: "destructive" }),
                });
              }}
            >
              Mark Corrected
            </Button>
          </>
        )}
        {status === "corrected" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => { setNotes(""); setShowVerify(true); }}>
            Mark Verified (Effectiveness Review)
          </Button>
        )}
      </div>

      {versions && versions.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-medium text-muted-foreground">Submitted versions</p>
          <ul className="space-y-1 text-sm">
            {versions.map((ver) => (
              <li key={ver.id} className="rounded border px-2 py-1">
                Version {ver.version_number}
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatDateForDisplay(ver.submitted_at.slice(0, 10))}
                  {ver.amendment_reason ? ` · ${ver.amendment_reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {effectivenessNotes && (
        <div className="border-t pt-2 text-sm">
          <p className="text-xs text-muted-foreground">Effectiveness review</p>
          <p className="whitespace-pre-wrap">{effectivenessNotes}</p>
        </div>
      )}

      <AlertDialog open={showVerify} onOpenChange={(open) => { if (!open) { setShowVerify(false); setNotes(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Effectiveness review</AlertDialogTitle>
            <AlertDialogDescription>
              Record how you confirmed the corrective actions worked before marking this violation verified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was observed? Who reviewed? Any residual risk?"
            rows={4}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={notes.trim().length < 12 || verifyPoc.isPending}
              onClick={(e) => {
                e.preventDefault();
                verifyPoc.mutate(
                  { violationId, notes: notes.trim() },
                  {
                    onSuccess: () => {
                      setShowVerify(false);
                      setNotes("");
                      toast({ title: "Violation verified" });
                    },
                    onError: (err: Error) =>
                      toast({ title: "Verify failed", description: err.message, variant: "destructive" }),
                  },
                );
              }}
            >
              {verifyPoc.isPending ? "Saving…" : "Confirm verified"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
