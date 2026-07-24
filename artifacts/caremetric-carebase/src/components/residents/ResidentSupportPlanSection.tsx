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
  useReviewSupportPlanProposal,
  useSubmitSupportPlan,
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
import { AlertTriangle, ClipboardList, FileCheck2, GitBranch } from "lucide-react";

const PLAN_STATE_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  in_review: { label: "In review", className: "bg-warning text-warning-foreground" },
  approved: { label: "Approved", className: "bg-success text-success-foreground" },
  effective: { label: "Active", className: "bg-success text-success-foreground" },
  superseded: { label: "Superseded", className: "bg-muted text-muted-foreground" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function itemLabel(item: Record<string, unknown>): string {
  for (const key of ["name", "service_name", "need", "goal", "intervention", "description", "text", "title"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "Item";
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
  const approvePlan = useApproveSupportPlan();
  const generateProposal = useGenerateSupportPlanProposal();
  const reviewProposal = useReviewSupportPlanProposal();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [approveFor, setApproveFor] = useState<ResidentSupportPlan | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(toLocalIsoDate());
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [attested, setAttested] = useState(false);
  const [reviewFor, setReviewFor] = useState<SupportPlanProposal | null>(null);
  const [decision, setDecision] = useState<"accepted" | "modified" | "rejected">("accepted");
  const [rationale, setRationale] = useState("");

  const plans = plansQuery.data ?? [];
  const effectivePlan = plans.find((p) => p.state === "effective");
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
              const meta = PLAN_STATE_META[plan.state] ?? PLAN_STATE_META.draft;
              const isOpen = expanded === plan.id;
              return (
                <div key={plan.id} className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className="flex items-center gap-2 text-left" onClick={() => setExpanded(isOpen ? null : plan.id)}>
                      <span className="font-medium">Version {plan.version_number}</span>
                      <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                      {plan.state === "effective" && plan.effective_date && (
                        <span className="text-xs text-muted-foreground">Effective {formatDateForDisplay(plan.effective_date)}{plan.review_due_date ? ` · review by ${formatDateForDisplay(plan.review_due_date)}` : ""}</span>
                      )}
                    </button>
                    {canManage && (
                      <div className="flex gap-1.5">
                        {plan.state === "draft" && <Button size="sm" variant="outline" onClick={() => submit(plan)} disabled={submitPlan.isPending}>Submit for review</Button>}
                        {plan.state === "in_review" && <Button size="sm" onClick={() => openApprove(plan)}>Approve</Button>}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <JsonbList label="Needs" value={plan.needs} />
                      <JsonbList label="Goals" value={plan.goals} />
                      <JsonbList label="Services" value={plan.services} />
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
            <DialogDescription>Record your decision. Accepting or modifying keeps the proposal for planning; rejecting closes it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Decision</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="accepted">Accept</SelectItem>
                  <SelectItem value="modified">Accept with modifications</SelectItem>
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
    </Card>
  );
}
