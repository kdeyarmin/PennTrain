import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListResidentAssessmentForms } from "@/hooks/useResidentAssessmentForms";
import {
  useApproveSupportPlan,
  useCreateSupportPlanDraft,
  useGenerateSupportPlanProposal,
  useResidentSupportPlanProposals,
  useResidentSupportPlans,
  useRecordSupportPlanParticipation,
  useRecordSupportPlanSignature,
  useReviewSupportPlanProposal,
  useSubmitSupportPlan,
  useTransitionSupportPlan,
  type ResidentSupportPlan,
  type SupportPlanProposal,
} from "@/hooks/useResidentCareDelivery";
import { formatDateForDisplay, toLocalIsoDate } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ClipboardList, FileCheck2, GitBranch, GitCompareArrows } from "lucide-react";
import {
  allowedSupportPlanTransitions, diffSupportPlanVersions, summarizePlanDiff,
  SUPPORT_PLAN_STATE_DESCRIPTIONS, supportPlanStateLabel, transitionRequiresReason,
  type SupportPlanState,
} from "@/lib/supportPlanLifecycle";
import { SupportPlanVersionComparison } from "@/components/residents/SupportPlanVersionComparison";
import {
  COMPLETION_RESPONSE_LABELS, defaultResponsesForKind, SERVICE_TASK_KIND_LABELS,
  type CompletionResponse, type ServiceTaskKind,
} from "@/lib/serviceDeliveryContract";

// Colour only; the label and description come from supportPlanLifecycle.ts so the UI cannot drift
// from the server's state set.
const PLAN_STATE_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  awaiting_clinical_review: "bg-warning text-warning-foreground",
  awaiting_participation: "bg-warning text-warning-foreground",
  awaiting_signature: "bg-warning text-warning-foreground",
  approved: "bg-success text-success-foreground",
  active: "bg-success text-success-foreground",
  revision_required: "bg-destructive text-destructive-foreground",
  superseded: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

// A plan must carry actual content before it can advance; approving an empty draft would activate a
// RASP with no needs/goals/services and generate no care tasks. Content arrives by copying the active
// plan into the draft or by accepting an assessment proposal (this section has no free-form editor).
function planHasContent(plan: ResidentSupportPlan): boolean {
  return asArray(plan.needs).length > 0
    || asArray(plan.goals).length > 0
    || asArray(plan.services).length > 0
    || asArray(plan.interventions).length > 0
    || (typeof plan.staff_instructions === "string" && plan.staff_instructions.trim().length > 0);
}

function itemLabel(item: Record<string, unknown>): string {
  for (const key of ["name", "service_name", "need", "goal", "intervention", "description", "text", "title"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "Item";
}

/**
 * Services carry a delivery contract -- what kind of task it is, who is qualified, what closes it,
 * and what happens on a refusal. Showing it here is the difference between a plan that reads like an
 * intention and one an aide can actually act on.
 */
function ServiceList({ value }: { value: unknown }) {
  const items = asArray(value);
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">Services ({items.length})</p>
      <div className="mt-1 space-y-1.5">
        {items.map((item, index) => {
          const kind = typeof item.task_kind === "string" ? item.task_kind : "scheduled_care";
          const responses = Array.isArray(item.acceptable_completion_responses)
            ? (item.acceptable_completion_responses as string[])
            : defaultResponsesForKind(kind);
          const qualification = typeof item.required_qualification_key === "string" ? item.required_qualification_key : null;
          const refusal = typeof item.refusal_handling === "string" ? item.refusal_handling : null;
          const escalation = typeof item.escalation_conditions === "string" ? item.escalation_conditions : null;
          const suppressed = item.generate_service === false;
          return (
            <div key={index} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{itemLabel(item)}</span>
                <Badge variant="outline" className="text-[10px]">
                  {SERVICE_TASK_KIND_LABELS[kind as ServiceTaskKind] ?? kind}
                </Badge>
                {qualification && <Badge variant="outline" className="text-[10px]">requires {qualification}</Badge>}
                {suppressed && (
                  <Badge variant="outline" className="text-[10px]">No staff task generated</Badge>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Closes with: {responses.map((response) =>
                  COMPLETION_RESPONSE_LABELS[response as CompletionResponse] ?? response).join(", ")}
              </p>
              {refusal && <p className="text-[11px] text-muted-foreground">On refusal: {refusal}</p>}
              {escalation && <p className="text-[11px] text-muted-foreground">Escalate when: {escalation}</p>}
              {!refusal && responses.includes("resident_refused") && (
                <p className="text-[11px] text-amber-700 dark:text-amber-500">
                  Refusal is an allowed outcome but the plan does not say what staff should do next.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JsonbList({ label, value }: { label: string; value: unknown }) {
  const items = asArray(value);
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label} ({items.length})</p>
      <ul className="ml-4 list-disc text-sm">
        {items.slice(0, 12).map((item, i) => <li key={i}>{itemLabel(item)}</li>)}
      </ul>
    </div>
  );
}

export function ResidentSupportPlanSection({ residentId, canManage }: { residentId: string; canManage: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const plansQuery = useResidentSupportPlans(residentId);
  const proposalsQuery = useResidentSupportPlanProposals(residentId);
  const { data: assessmentForms } = useListResidentAssessmentForms(residentId);

  const createDraft = useCreateSupportPlanDraft();
  const submitPlan = useSubmitSupportPlan();
  const transitionPlan = useTransitionSupportPlan();
  const recordParticipation = useRecordSupportPlanParticipation();
  const recordSignature = useRecordSupportPlanSignature();
  const approvePlan = useApproveSupportPlan();
  const generateProposal = useGenerateSupportPlanProposal();
  const reviewProposal = useReviewSupportPlanProposal();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [approveFor, setApproveFor] = useState<ResidentSupportPlan | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(toLocalIsoDate());
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [attested, setAttested] = useState(false);
  const [transitionFor, setTransitionFor] = useState<{ plan: ResidentSupportPlan; next: SupportPlanState } | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [participationFor, setParticipationFor] = useState<ResidentSupportPlan | null>(null);
  const [participationDate, setParticipationDate] = useState(toLocalIsoDate());
  const [participationNotes, setParticipationNotes] = useState("");
  const [residentTookPart, setResidentTookPart] = useState(true);
  const [designatedTookPart, setDesignatedTookPart] = useState(false);
  const [signatureFor, setSignatureFor] = useState<ResidentSupportPlan | null>(null);
  const [signatureOutcome, setSignatureOutcome] = useState("signed");
  const [signatureNote, setSignatureNote] = useState("");
  const [reviewFor, setReviewFor] = useState<SupportPlanProposal | null>(null);
  const [decision, setDecision] = useState<"accepted" | "rejected">("accepted");
  const [rationale, setRationale] = useState("");

  const plans = plansQuery.data ?? [];
  const effectivePlan = plans.find((p) => p.state === "active");
  const openProposals = (proposalsQuery.data ?? []).filter((p) => p.state === "proposed");
  const latestFinalizedAssessment = useMemo(
    () => (assessmentForms ?? []).filter((f) => f.status === "finalized").sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    [assessmentForms],
  );

  function oneYearOut(from: string): string {
    const d = new Date(`${from}T00:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    return toLocalIsoDate(d);
  }

  async function startDraft() {
    try {
      await createDraft.mutateAsync({ residentId, priorPlanId: effectivePlan?.id });
      toast({ title: "Draft support plan created", description: effectivePlan ? "Copied from the active plan — edit and submit for review." : "Blank draft created." });
    } catch (e) {
      toast({ title: "Could not create draft", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function submit(plan: ResidentSupportPlan) {
    if (!planHasContent(plan)) {
      toast({
        title: "Add plan content first",
        description: "An empty support plan can't be submitted. Start the draft from the active plan or accept an assessment proposal so it has needs, goals, services, or interventions.",
        variant: "destructive",
      });
      return;
    }
    try {
      await submitPlan.mutateAsync(plan.id);
      toast({ title: "Submitted for review" });
    } catch (e) {
      toast({ title: "Could not submit", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  function openApprove(plan: ResidentSupportPlan) {
    setApproveFor(plan);
    setEffectiveDate(toLocalIsoDate());
    setReviewDueDate(oneYearOut(toLocalIsoDate()));
    setAttested(false);
  }

  async function confirmApprove() {
    if (!approveFor) return;
    if (!attested) {
      toast({ title: "Attestation required", description: "Confirm your approval to make the plan active.", variant: "destructive" });
      return;
    }
    try {
      await approvePlan.mutateAsync({
        planId: approveFor.id,
        effectiveDate,
        reviewDueDate,
        staffSignature: {
          attested_by_name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
          method: "in_app_attestation",
          statement: "I approve this support plan and its interventions.",
        },
      });
      toast({ title: "Support plan is active", description: "Care tasks are generated from its services." });
      setApproveFor(null);
    } catch (e) {
      toast({ title: "Could not approve", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function checkAssessment() {
    if (!latestFinalizedAssessment) return;
    try {
      await generateProposal.mutateAsync({ assessmentFormId: latestFinalizedAssessment.id });
      toast({ title: "Assessment reviewed", description: "A support-plan proposal was generated for review." });
    } catch (e) {
      toast({ title: "Could not generate proposal", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function confirmReview() {
    if (!reviewFor) return;
    if (rationale.trim().length < 5) {
      toast({ title: "Add a rationale", description: "At least 5 characters.", variant: "destructive" });
      return;
    }
    try {
      await reviewProposal.mutateAsync({ proposalId: reviewFor.id, decision, rationale: rationale.trim() });
      toast({ title: "Proposal reviewed" });
      setReviewFor(null);
      setRationale("");
      setDecision("accepted");
    } catch (e) {
      toast({ title: "Could not record review", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function runTransition() {
    if (!transitionFor) return;
    try {
      await transitionPlan.mutateAsync({
        planId: transitionFor.plan.id,
        nextState: transitionFor.next,
        reason: transitionReason.trim() || undefined,
      });
      toast({ title: `Moved to ${supportPlanStateLabel(transitionFor.next).toLowerCase()}` });
      setTransitionFor(null);
      setTransitionReason("");
    } catch (e) {
      toast({ title: "Could not move the plan", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function saveParticipation() {
    if (!participationFor) return;
    try {
      await recordParticipation.mutateAsync({
        planId: participationFor.id,
        participationDate,
        participants: {
          resident: residentTookPart ? "participated" : "did_not_participate",
          designated_person: designatedTookPart ? "participated" : "did_not_participate",
          notes: participationNotes.trim() || null,
        },
      });
      toast({ title: "Participation recorded", description: "The plan now awaits signature." });
      setParticipationFor(null);
      setParticipationNotes("");
    } catch (e) {
      toast({ title: "Could not record participation", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function saveSignature() {
    if (!signatureFor) return;
    try {
      await recordSignature.mutateAsync({
        planId: signatureFor.id,
        signature: { outcome: signatureOutcome, note: signatureNote.trim() || null, recorded_at: new Date().toISOString() },
      });
      toast({ title: "Signature outcome recorded" });
      setSignatureFor(null);
      setSignatureNote("");
    } catch (e) {
      toast({ title: "Could not record the signature", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Support Plan (RASP)</CardTitle>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {latestFinalizedAssessment && (
                <Button variant="outline" size="sm" onClick={checkAssessment} disabled={generateProposal.isPending}>
                  <FileCheck2 className="mr-1.5 h-4 w-4" />Check assessment for changes
                </Button>
              )}
              <Button size="sm" onClick={startDraft} disabled={createDraft.isPending}>
                <ClipboardList className="mr-1.5 h-4 w-4" />Start new draft
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Proposals needing review (conflict warnings surfaced) */}
        {openProposals.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Proposals awaiting review</p>
            {openProposals.map((proposal) => {
              const p = (proposal.proposal ?? {}) as Record<string, unknown>;
              return (
                <div key={proposal.id} className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{proposal.rationale || "Assessment-driven support-plan proposal"}</p>
                      <p className="text-xs text-muted-foreground">
                        {asArray(p.proposedNeeds).length} needs · {asArray(p.proposedServices).length} services · {asArray(p.proposedInterventions).length} interventions
                        {proposal.due_at ? ` · due ${formatDateForDisplay(proposal.due_at)}` : ""}
                      </p>
                    </div>
                    {canManage && <Button size="sm" variant="outline" onClick={() => { setReviewFor(proposal); setDecision("accepted"); setRationale(""); }}>Review</Button>}
                  </div>
                  {proposal.conflict_warnings.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {proposal.conflict_warnings.map((w, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive-strong ring-1 ring-inset ring-destructive/20">
                          <AlertTriangle className="h-3 w-3" />{w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Plan versions */}
        {plansQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No support plan yet. {canManage ? "Start a draft to begin, or check a finalized assessment for a proposed plan." : ""}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {plans.map((plan) => {
              const stateClass = PLAN_STATE_CLASS[plan.state] ?? PLAN_STATE_CLASS.draft;
              const isOpen = expanded === plan.id;
              return (
                <div key={plan.id} className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className="flex items-center gap-2 text-left" onClick={() => setExpanded(isOpen ? null : plan.id)}>
                      <span className="font-medium">Version {plan.version_number}</span>
                      <Badge variant="outline" className={stateClass} title={SUPPORT_PLAN_STATE_DESCRIPTIONS[plan.state as SupportPlanState] ?? undefined}>{supportPlanStateLabel(plan.state)}</Badge>
                      {plan.state === "active" && plan.effective_date && (
                        <span className="text-xs text-muted-foreground">Effective {formatDateForDisplay(plan.effective_date)}{plan.review_due_date ? ` · review by ${formatDateForDisplay(plan.review_due_date)}` : ""}</span>
                      )}
                    </button>
                    {canManage && (
                      <div className="flex gap-1.5">
                        {plan.state === "draft" && <Button size="sm" variant="outline" onClick={() => submit(plan)} disabled={submitPlan.isPending || !planHasContent(plan)} title={!planHasContent(plan) ? "Add plan content before submitting" : undefined}>Submit for review</Button>}
                        {plan.state === "awaiting_participation" && <Button size="sm" onClick={() => { setParticipationFor(plan); setParticipationDate(toLocalIsoDate()); }}>Record participation</Button>}
                        {plan.state === "awaiting_signature" && <Button size="sm" variant="outline" onClick={() => setSignatureFor(plan)}>Record signature</Button>}
                        {(plan.state === "awaiting_signature" || plan.state === "approved") && <Button size="sm" onClick={() => openApprove(plan)}>Approve</Button>}
                        {/* Every remaining legal move comes from the shared transition table, so the
                            UI can never offer an edge the server will reject. Participation and
                            signature have their own dialogs above because they capture evidence. */}
                        {allowedSupportPlanTransitions(plan.state)
                          .filter((next) => !(plan.state === "awaiting_participation" && next === "awaiting_signature"))
                          .filter((next) => !(plan.state === "awaiting_signature" && next === "approved"))
                          .filter((next) => !(plan.state === "draft" && next === "awaiting_clinical_review"))
                          .map((next) => (
                            <Button
                              key={next}
                              size="sm"
                              variant={next === "revision_required" ? "outline" : "ghost"}
                              onClick={() => { setTransitionFor({ plan, next }); setTransitionReason(""); }}
                            >
                              {next === "revision_required" ? "Return for revision" : `Move to ${supportPlanStateLabel(next).toLowerCase()}`}
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <JsonbList label="Needs" value={plan.needs} />
                      <JsonbList label="Goals" value={plan.goals} />
                      <ServiceList value={plan.services} />
                      <JsonbList label="Interventions" value={plan.interventions} />
                      {plan.staff_instructions && <div><p className="text-xs font-medium text-muted-foreground">Staff instructions</p><p className="text-sm whitespace-pre-wrap">{plan.staff_instructions}</p></div>}
                      {asArray(plan.needs).length === 0 && asArray(plan.services).length === 0 && !plan.staff_instructions && (
                        <p className="text-sm text-muted-foreground">This version has no content yet.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Approve dialog */}
      <Dialog open={!!approveFor} onOpenChange={(o) => !o && setApproveFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve &amp; activate support plan</DialogTitle>
            <DialogDescription>Approving supersedes the current active plan and regenerates resident care tasks from this plan's services.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="sp-eff">Effective date</Label><Input id="sp-eff" type="date" value={effectiveDate} onChange={(e) => { setEffectiveDate(e.target.value); if (e.target.value) setReviewDueDate(oneYearOut(e.target.value)); }} /></div>
              <div className="grid gap-2"><Label htmlFor="sp-rev">Review due date</Label><Input id="sp-rev" type="date" value={reviewDueDate} onChange={(e) => setReviewDueDate(e.target.value)} /></div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5" />
              I approve this support plan and its interventions as {user?.firstName} {user?.lastName}.
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveFor(null)}>Cancel</Button>
            <Button onClick={confirmApprove} disabled={approvePlan.isPending || !attested}>{approvePlan.isPending ? "Approving…" : "Approve & activate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proposal review dialog */}
      <Dialog open={!!reviewFor} onOpenChange={(o) => !o && setReviewFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review support-plan proposal</DialogTitle>
            <DialogDescription>Record your decision. Accepting keeps the proposal for planning; rejecting closes it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Decision</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="accepted">Accept</SelectItem>
                  <SelectItem value="rejected">Reject</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label htmlFor="sp-rat">Rationale</Label><Textarea id="sp-rat" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this decision (min 5 characters)" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewFor(null)}>Cancel</Button>
            <Button onClick={confirmReview} disabled={reviewProposal.isPending}>{reviewProposal.isPending ? "Saving…" : "Record decision"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SupportPlanVersionComparison plans={plans} />

      <Dialog open={!!transitionFor} onOpenChange={(open) => !open && setTransitionFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transitionFor?.next === "revision_required" ? "Return for revision" : `Move to ${transitionFor ? supportPlanStateLabel(transitionFor.next).toLowerCase() : ""}`}
            </DialogTitle>
            <DialogDescription>
              {transitionFor ? SUPPORT_PLAN_STATE_DESCRIPTIONS[transitionFor.next] : ""}
            </DialogDescription>
          </DialogHeader>
          {transitionFor && transitionRequiresReason(transitionFor.next) && (
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="plan-transition-reason">Reason</Label>
              <Textarea
                id="plan-transition-reason"
                rows={3}
                value={transitionReason}
                onChange={(event) => setTransitionReason(event.target.value)}
                placeholder="What needs to change, and why. This is recorded on the version."
              />
              <p className="text-[11px] text-muted-foreground">
                Required — the next author and the survey record both need to know what prompted the revision.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransitionFor(null)}>Cancel</Button>
            <Button
              onClick={runTransition}
              disabled={transitionPlan.isPending || (!!transitionFor && transitionRequiresReason(transitionFor.next) && !transitionReason.trim())}
            >
              {transitionPlan.isPending ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!participationFor} onOpenChange={(open) => !open && setParticipationFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record participation</DialogTitle>
            <DialogDescription>
              The resident and their designated person have a right to take part in developing the plan.
              Recording that they did not is a legitimate outcome — leaving it blank is not.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="participation-date">Participation date</Label>
              <Input id="participation-date" type="date" value={participationDate} onChange={(event) => setParticipationDate(event.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={residentTookPart} onCheckedChange={(value) => setResidentTookPart(value === true)} />
              Resident took part
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={designatedTookPart} onCheckedChange={(value) => setDesignatedTookPart(value === true)} />
              Designated person took part
            </label>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="participation-notes">Notes</Label>
              <Textarea id="participation-notes" rows={2} value={participationNotes} onChange={(event) => setParticipationNotes(event.target.value)} placeholder="Who else was present, or why someone could not take part." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParticipationFor(null)}>Cancel</Button>
            <Button onClick={saveParticipation} disabled={recordParticipation.isPending || !participationDate}>
              {recordParticipation.isPending ? "Saving..." : "Record participation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!signatureFor} onOpenChange={(open) => !open && setSignatureFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record signature outcome</DialogTitle>
            <DialogDescription>
              A refusal or an inability to sign is a documented outcome, exactly as it is on the state form —
              not a failure to record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="signature-outcome">Outcome</Label>
              <Select value={signatureOutcome} onValueChange={setSignatureOutcome}>
                <SelectTrigger id="signature-outcome"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="signed">Signed</SelectItem>
                  <SelectItem value="declined">Declined to sign</SelectItem>
                  <SelectItem value="unable_to_sign">Unable to sign</SelectItem>
                  <SelectItem value="unavailable">Not available to sign</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="signature-note">Note</Label>
              <Textarea id="signature-note" rows={2} value={signatureNote} onChange={(event) => setSignatureNote(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignatureFor(null)}>Cancel</Button>
            <Button onClick={saveSignature} disabled={recordSignature.isPending}>
              {recordSignature.isPending ? "Saving..." : "Record outcome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Card>
  );
}
