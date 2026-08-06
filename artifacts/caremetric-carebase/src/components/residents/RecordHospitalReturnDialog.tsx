import { useEffect, useMemo, useState } from "react";
import { facilityDateTimeLocalToUtcIso } from "@/lib/dateUtils";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import {
  RETURN_CHANGE_FIELDS, suggestedReviewFlags, type ReturnChangeKey,
} from "@/lib/hospitalReconciliation";

/**
 * Recording that a resident came back from hospital.
 *
 * THE GAP THIS CLOSES. `complete_hospital_return` shipped in 20260714100000 and was re-declared by
 * Phase 5b's reconciliation migration, and no application code has ever called it.
 * `start_hospital_transfer` *is* wired, so an episode could reach `status = 'out'` and stop there
 * forever -- and `ResidentHospitalSection` said, in as many words, "the resident is currently out,
 * reconciliation starts when they return", with no way to record a return.
 *
 * Everything Phase 5b delivered hangs off this call: the reconciliation checklist, the gated
 * closure, the seeded hospital-return assessment review, the follow-up work item, and the
 * `hospital_return_reconciliation` card in Needs Attention. All of it was unreachable.
 *
 * The two review-required flags are proposed rather than pre-ticked -- see `suggestedReviewFlags`.
 */
function useCompleteHospitalReturn(residentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      episodeId: string;
      returnTime: string;
      dischargeDocumentId?: string;
      changedOrderAckStatus: string;
      medicationReconciliationStatus: string;
      conditionChanges?: string;
      dietChanges?: string;
      mobilityChanges?: string;
      skinConcerns?: string;
      dmeChanges?: string;
      assessmentReviewRequired: boolean;
      supportPlanReviewRequired: boolean;
    }) => {
      const { data, error } = await supabase.rpc("complete_hospital_return" as never, {
        p_episode_id: input.episodeId,
        p_return_time: input.returnTime,
        p_discharge_document_id: input.dischargeDocumentId ?? null,
        p_changed_order_ack_status: input.changedOrderAckStatus,
        p_medication_reconciliation_status: input.medicationReconciliationStatus,
        p_condition_changes: input.conditionChanges ?? null,
        p_diet_changes: input.dietChanges ?? null,
        p_mobility_changes: input.mobilityChanges ?? null,
        p_skin_concerns: input.skinConcerns ?? null,
        p_dme_changes: input.dmeChanges ?? null,
        p_assessment_review_required: input.assessmentReviewRequired,
        p_support_plan_review_required: input.supportPlanReviewRequired,
      } as never);
      if (error) throw error;
      // The follow-up work item's id.
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospital-episodes", residentId] });
      queryClient.invalidateQueries({ queryKey: ["resident-care-header", residentId] });
      queryClient.invalidateQueries({ queryKey: ["resident-timeline", residentId] });
      queryClient.invalidateQueries({ queryKey: ["resident-assessment-reviews", residentId] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

const MEDICATION_OPTIONS = [
  { value: "pending", label: "Pending — not yet reconciled" },
  { value: "completed", label: "Completed" },
  { value: "authorized_exception", label: "Authorized exception" },
  { value: "not_applicable", label: "Not applicable — no medication changes" },
];

const ORDER_OPTIONS = [
  { value: "pending_review", label: "New or changed orders came back — awaiting review" },
  { value: "not_applicable", label: "No new or changed orders" },
];

/** `datetime-local` wants local wall-clock with no zone; toISOString would shift it. */
function localNowForInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export default function RecordHospitalReturnDialog({
  open, onOpenChange, residentId, episodeId, transferTime, destination,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  episodeId: string;
  transferTime: string;
  destination: string | null;
}) {
  const { toast } = useToast();
  const complete = useCompleteHospitalReturn(residentId);
  const { data: documents } = useListResidentDocuments(residentId);

  const [returnTime, setReturnTime] = useState("");
  const [dischargeDocumentId, setDischargeDocumentId] = useState("");
  const [medicationStatus, setMedicationStatus] = useState("pending");
  const [orderStatus, setOrderStatus] = useState("pending_review");
  const [changes, setChanges] = useState<Partial<Record<ReturnChangeKey, string>>>({});
  // Null until the person touches a box: before that the proposal drives the value, after it their
  // decision does. Silently overwriting a deliberate choice on the next keystroke would be worse
  // than a bad default.
  const [overrides, setOverrides] = useState<{ assessment: boolean | null; plan: boolean | null }>(
    { assessment: null, plan: null },
  );

  useEffect(() => {
    if (!open) return;
    setReturnTime(localNowForInput());
    setDischargeDocumentId("");
    setMedicationStatus("pending");
    setOrderStatus("pending_review");
    setChanges({});
    setOverrides({ assessment: null, plan: null });
  }, [open]);

  const suggestion = useMemo(() => suggestedReviewFlags({
    changes,
    medicationReconciliationStatus: medicationStatus,
    changedOrderAckStatus: orderStatus,
  }), [changes, medicationStatus, orderStatus]);

  const assessmentReviewRequired = overrides.assessment ?? suggestion.assessmentReviewRequired;
  const supportPlanReviewRequired = overrides.plan ?? suggestion.supportPlanReviewRequired;

  const returnedAt = returnTime ? new Date(returnTime) : null;
  const departedAt = new Date(transferTime);
  const returnBeforeDeparture = Boolean(returnedAt && returnedAt.getTime() < departedAt.getTime());

  const submit = async () => {
    if (!returnTime) return;
    try {
      await complete.mutateAsync({
        episodeId,
        returnTime: facilityDateTimeLocalToUtcIso(returnTime),
        dischargeDocumentId: dischargeDocumentId || undefined,
        changedOrderAckStatus: orderStatus,
        medicationReconciliationStatus: medicationStatus,
        conditionChanges: changes.condition_changes?.trim() || undefined,
        dietChanges: changes.diet_changes?.trim() || undefined,
        mobilityChanges: changes.mobility_changes?.trim() || undefined,
        skinConcerns: changes.skin_concerns?.trim() || undefined,
        dmeChanges: changes.dme_changes?.trim() || undefined,
        assessmentReviewRequired,
        supportPlanReviewRequired,
      });
      toast({
        title: "Return recorded",
        description: "The reconciliation checklist is now open, with 24 hours to complete it.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not record the return",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record return from hospital</DialogTitle>
          <DialogDescription>
            {destination ?? "Hospital"} · left {new Date(transferTime).toLocaleString()}. A return is
            the moment a resident&apos;s plan is most likely to be wrong, so what you record here
            opens the reconciliation checklist rather than closing the episode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="return-time">Returned at</Label>
            <Input
              id="return-time" type="datetime-local" value={returnTime}
              onChange={(e) => setReturnTime(e.target.value)}
            />
            {returnBeforeDeparture && (
              <p className="text-xs text-destructive">
                The return cannot be before the transfer. The server refuses this too.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-discharge-doc">Discharge paperwork</Label>
            <Select
              value={dischargeDocumentId || "none"}
              onValueChange={(value) => setDischargeDocumentId(value === "none" ? "" : value)}
            >
              <SelectTrigger id="return-discharge-doc"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not received yet</SelectItem>
                {(documents ?? []).map((doc) => (
                  <SelectItem key={doc.id} value={doc.id}>{doc.file_name ?? doc.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Upload it on the Documents tab first if it is not listed. The reconciliation cannot be
              closed without it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-medication">Medication reconciliation</Label>
            <Select value={medicationStatus} onValueChange={setMedicationStatus}>
              <SelectTrigger id="return-medication"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEDICATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-orders">Physician orders</Label>
            <Select value={orderStatus} onValueChange={setOrderStatus}>
              <SelectTrigger id="return-orders"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-md border p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What changed during the stay
            </p>
            {RETURN_CHANGE_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`return-${field.key}`} className="text-xs">{field.label}</Label>
                <Textarea
                  id={`return-${field.key}`} rows={2}
                  value={changes[field.key] ?? ""}
                  onChange={(e) => setChanges((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-md border border-dashed p-2">
            <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox" className="mt-0.5" checked={assessmentReviewRequired}
                onChange={(e) => setOverrides((prev) => ({ ...prev, assessment: e.target.checked }))}
              />
              <span>
                <span className="font-medium">Hospital-return assessment review required</span>
                <span className="block text-xs text-muted-foreground">
                  Creates the review as a draft, pre-filled with what you recorded above.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox" className="mt-0.5" checked={supportPlanReviewRequired}
                onChange={(e) => setOverrides((prev) => ({ ...prev, plan: e.target.checked }))}
              />
              <span>
                <span className="font-medium">Support plan revision required</span>
                <span className="block text-xs text-muted-foreground">
                  The reconciliation stays open until a plan is revised or explicitly confirmed.
                </span>
              </span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => void submit()}
            disabled={!returnTime || returnBeforeDeparture || complete.isPending}
          >
            {complete.isPending ? "Recording…" : "Record return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
