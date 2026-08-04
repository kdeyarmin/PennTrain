import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, CircleDashed, Hospital } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useResidentAssessmentReviews } from "@/hooks/useResidentAssessmentReviews";
import { useResidentSupportPlans } from "@/hooks/useResidentCareDelivery";
import {
  buildReconciliationState, episodeStateLabel, recordedChanges, type HospitalEpisodeLike,
} from "@/lib/hospitalReconciliation";
import { formatDateForDisplay } from "@/lib/dateUtils";
import RecordHospitalReturnDialog from "@/components/residents/RecordHospitalReturnDialog";

function useHospitalEpisodes(residentId: string) {
  return useQuery({
    queryKey: ["hospital-episodes", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hospital_transfer_episodes")
        .select("id, status, transfer_time, return_time, destination, reason, discharge_document_id, medication_reconciliation_status, changed_order_ack_status, assessment_review_required, support_plan_review_required, condition_changes, diet_changes, mobility_changes, skin_concerns")
        .eq("resident_id", residentId)
        .order("transfer_time", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as HospitalEpisodeLike[];
    },
  });
}

function useCompleteReconciliation(residentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { episodeId: string; note?: string }) => {
      const { data, error } = await supabase.rpc("complete_hospital_return_reconciliation" as never, {
        p_episode_id: input.episodeId,
        p_note: input.note ?? null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospital-episodes", residentId] });
      queryClient.invalidateQueries({ queryKey: ["resident-care-header", residentId] });
      queryClient.invalidateQueries({ queryKey: ["resident-timeline", residentId] });
    },
  });
}

/**
 * Hospital leave and return. The episode schema already carried the departure and return detail;
 * what was missing was any surface that showed the reconciliation as a checklist with a deadline,
 * and any gate stopping a return being closed with steps outstanding.
 *
 * The closure button is deliberately disabled rather than hidden while steps remain: a person needs
 * to see what is blocking them, not wonder where the button went. The server enforces the same rule
 * regardless.
 */
export default function ResidentHospitalSection({
  residentId, residentHref, canManage,
}: {
  residentId: string;
  residentHref: string;
  /** Manager-tier roles only; the server enforces the same rule in every RPC below. */
  canManage: boolean;
}) {
  const { toast } = useToast();
  const episodes = useHospitalEpisodes(residentId);
  const { data: reviews } = useResidentAssessmentReviews(residentId);
  const { data: plans } = useResidentSupportPlans(residentId);
  const complete = useCompleteReconciliation(residentId);
  const [closing, setClosing] = useState<HospitalEpisodeLike | null>(null);
  const [recordingReturn, setRecordingReturn] = useState(false);
  const [note, setNote] = useState("");

  const episode = episodes.data?.[0];
  if (!episode) return null;

  const returnReviewFinal = (reviews ?? []).some((review) =>
    review.hospital_episode_id === episode.id && review.status === "final");
  const planRevised = (plans ?? []).some((plan) =>
    ["draft", "awaiting_clinical_review", "awaiting_participation", "awaiting_signature", "approved"].includes(plan.state)
    || (plan.state === "active" && episode.return_time !== null
      && plan.effective_date !== null && plan.effective_date >= episode.return_time.slice(0, 10)));

  const state = buildReconciliationState({
    episode,
    assessmentReviewFinalized: returnReviewFinal,
    supportPlanRevisedAfterReturn: planRevised,
  });
  const changes = recordedChanges(episode);

  const submit = async () => {
    if (!closing) return;
    try {
      await complete.mutateAsync({ episodeId: closing.id, note: note.trim() || undefined });
      toast({ title: "Reconciliation closed" });
      setClosing(null);
      setNote("");
    } catch (error) {
      toast({
        title: "Could not close the reconciliation",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Hospital className="h-5 w-5" /> Hospital {episodeStateLabel(episode).toLowerCase()}
              </CardTitle>
              <CardDescription>
                {episode.destination ?? "Hospital"} · left {formatDateForDisplay(episode.transfer_time.slice(0, 10))}
                {episode.return_time ? ` · returned ${formatDateForDisplay(episode.return_time.slice(0, 10))}` : ""}
              </CardDescription>
            </div>
            {state.applicable && (
              state.complete
                ? <Badge variant="outline" className="border-emerald-600 text-emerald-700 dark:text-emerald-500">Reconciled</Badge>
                : <Badge variant="outline" className={state.overdue ? "border-destructive text-destructive" : "border-amber-500 text-amber-700 dark:text-amber-500"}>
                  {state.overdue
                    ? `Overdue by ${Math.abs(state.hoursRemaining ?? 0)}h`
                    : `${state.hoursRemaining ?? 0}h remaining`}
                </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {episode.status === "out" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The resident is currently out. Recording their return opens the reconciliation
                checklist and starts its 24-hour clock.
              </p>
              {canManage && (
                <Button size="sm" onClick={() => setRecordingReturn(true)}>Record return</Button>
              )}
            </div>
          ) : (
            <>
              {changes.length > 0 && (
                <div className="rounded-md border bg-muted/40 p-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recorded on return
                  </p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {changes.map((change) => (
                      <li key={change.label}><span className="font-medium">{change.label}:</span> {change.detail}</li>
                    ))}
                  </ul>
                </div>
              )}

              <ul className="space-y-1.5">
                {state.steps.map((step) => (
                  <li key={step.key} className="flex items-start gap-2 text-sm">
                    {step.notApplicable ? (
                      <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : step.complete ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <span className={step.notApplicable ? "text-muted-foreground" : ""}>
                      <span className="font-medium">{step.label}</span>
                      {step.notApplicable && " — not required for this return"}
                      {!step.notApplicable && !step.complete && (
                        <span className="block text-xs text-muted-foreground">{step.why}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={!state.complete || complete.isPending}
                  onClick={() => { setClosing(episode); setNote(""); }}
                  // Disabled rather than hidden: a person needs to see what is blocking them.
                  title={state.complete ? undefined : `Outstanding: ${state.outstanding.map((s) => s.label).join(", ")}`}
                >
                  Close reconciliation
                </Button>
                <Link href={`${residentHref}?tab=assessments`} className="text-sm text-primary hover:underline">
                  Open return review
                </Link>
                <Link href={`${residentHref}?tab=support-plan`} className="text-sm text-primary hover:underline">
                  Open support plan
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <RecordHospitalReturnDialog
        open={recordingReturn}
        onOpenChange={setRecordingReturn}
        residentId={residentId}
        episodeId={episode.id}
        transferTime={episode.transfer_time}
        destination={episode.destination}
      />

      <Dialog open={!!closing} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close hospital-return reconciliation</DialogTitle>
            <DialogDescription>
              This closes the follow-up work item. The server re-checks every step, so a race with
              somebody else's edit fails rather than closing on stale information.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="reconciliation-note">Closing note (optional)</Label>
            <Textarea id="reconciliation-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>Cancel</Button>
            <Button onClick={submit} disabled={complete.isPending}>
              {complete.isPending ? "Closing..." : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
