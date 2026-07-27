import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, CircleDashed, Circle, ClipboardCheck, Clock, ShieldQuestion,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useApproveIncidentInvestigation, useDetermineIncidentReportability,
  useIncidentFollowThrough, useSaveIncidentInvestigationStep,
} from "@/hooks/useIncidentFollowThrough";
import {
  buildIncidentFollowThrough, INCIDENT_STAGE_STATUS_LABELS, REPORTABILITY_STATUS_LABELS,
  ROOT_CAUSE_METHODS,
  type IncidentStage, type IncidentStageStatus, type ReportabilityStatus,
} from "@/lib/incidentStages";
import { getIncidentPathway, reportabilityPrompts } from "@/lib/incidentPathways";
import type { TemplateAnswers } from "@/lib/assessmentTemplates";
import { IncidentPathwayDialog } from "./IncidentPathwayDialog";

function StageIcon({ status }: { status: IncidentStageStatus }) {
  if (status === "complete") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />;
  if (status === "not_applicable") return <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
  if (status === "overdue") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  if (status === "waiting") return <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />;
}

function ReportabilityDialog({
  open, onOpenChange, incidentId, prompts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  prompts: string[];
}) {
  const { toast } = useToast();
  const determine = useDetermineIncidentReportability(incidentId);
  const [status, setStatus] = useState<ReportabilityStatus | "">("");
  const [rationale, setRationale] = useState("");

  const submit = async () => {
    if (status !== "reportable" && status !== "not_reportable") return;
    try {
      await determine.mutateAsync({ status, rationale: rationale.trim() });
      toast({ title: `Recorded as ${REPORTABILITY_STATUS_LABELS[status].toLowerCase()}` });
      onOpenChange(false);
      setStatus("");
      setRationale("");
    } catch (error) {
      toast({
        title: "Could not record the determination",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reportability determination</DialogTitle>
          <DialogDescription>
            Whether this is a reportable event is a judgement a person makes and signs. Recording it
            as reportable creates the required notifications with their deadlines; recording it as
            not reportable stands down any that were raised automatically, keeping the record and
            the reason.
          </DialogDescription>
        </DialogHeader>

        {prompts.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-500">
              <ShieldQuestion className="h-4 w-4" /> Worth considering
            </p>
            <ul className="mt-1 space-y-0.5 pl-5 text-xs text-muted-foreground">
              {prompts.map((prompt) => <li key={prompt} className="list-disc">{prompt}</li>)}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="reportability-status">Determination</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as ReportabilityStatus)}>
              <SelectTrigger id="reportability-status"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reportable">Reportable</SelectItem>
                <SelectItem value="not_reportable">Not reportable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="reportability-rationale">Reasoning</Label>
            <Textarea
              id="reportability-rationale"
              rows={3}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Why this does or does not meet the reporting threshold"
            />
            <p className="text-[11px] text-muted-foreground">
              Required either way — &ldquo;not reportable&rdquo; is the answer that has to be defensible.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!status || rationale.trim().length < 10 || determine.isPending}>
            {determine.isPending ? "Recording..." : "Record determination"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvestigationStepDialog({
  open, onOpenChange, incidentId, initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  initial: { immediateResponse: string; findings: string; rootCause: string; rootCauseMethod: string };
}) {
  const { toast } = useToast();
  const save = useSaveIncidentInvestigationStep(incidentId);
  const [immediateResponse, setImmediateResponse] = useState(initial.immediateResponse);
  const [findings, setFindings] = useState(initial.findings);
  const [rootCause, setRootCause] = useState(initial.rootCause);
  const [method, setMethod] = useState(initial.rootCauseMethod);

  const submit = async () => {
    try {
      await save.mutateAsync({
        immediateResponse: immediateResponse.trim() || undefined,
        investigationFindings: findings.trim() || undefined,
        rootCause: rootCause.trim() || undefined,
        rootCauseMethod: method || undefined,
      });
      toast({ title: "Investigation updated" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Investigation record</DialogTitle>
          <DialogDescription>
            The immediate response is kept apart from the narrative on purpose: a write-up that blurs
            what happened with what was done cannot answer the second question.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="immediate-response">Immediate response</Label>
            <Textarea
              id="immediate-response" rows={3} value={immediateResponse}
              onChange={(event) => setImmediateResponse(event.target.value)}
              placeholder="What was done for the resident in the first minutes"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="investigation-findings">Findings</Label>
            <Textarea
              id="investigation-findings" rows={3} value={findings}
              onChange={(event) => setFindings(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="root-cause">Root cause</Label>
            <Textarea
              id="root-cause" rows={3} value={rootCause}
              onChange={(event) => setRootCause(event.target.value)}
              placeholder="A cause that names something changeable"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="root-cause-method">Method used</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="root-cause-method"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {ROOT_CAUSE_METHODS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Naming the method is what separates an analysis from a first impression.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The eleven stages of incident follow-through, derived from the incident and its related rows
 * rather than from a status field somebody remembered to advance.
 *
 * The approval button is disabled rather than hidden while stages are outstanding, and it names what
 * is blocking. The server re-checks every rule, so a race with somebody else's edit fails rather
 * than approving on stale information.
 */
export default function IncidentFollowThroughSection({
  incidentId, canManage,
}: {
  incidentId: string;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useIncidentFollowThrough(incidentId);
  const approve = useApproveIncidentInvestigation(incidentId);
  const [pathwayOpen, setPathwayOpen] = useState(false);
  const [reportabilityOpen, setReportabilityOpen] = useState(false);
  const [stepOpen, setStepOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState("");

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data?.incident) return null;

  const incident = data.incident;
  const state = buildIncidentFollowThrough({
    incident,
    notifications: data.notifications ?? [],
    correctiveActions: data.corrective_actions ?? [],
    assessmentReviewFinalized: data.assessment_review_finalized,
    supportPlanRevisedAfterIncident: data.support_plan_revised_after_incident,
  });

  const pathway = incident.pathway_key ? getIncidentPathway(incident.pathway_key) : undefined;
  const prompts = pathway
    ? reportabilityPrompts(pathway, (incident.pathway_answers ?? {}) as TemplateAnswers)
    : [];
  const reportability = incident.reportability_status as ReportabilityStatus;

  const stageAction = (stage: IncidentStage) => {
    if (stage.status === "complete" || stage.status === "not_applicable") return null;
    switch (stage.key) {
      case "immediate_response":
      case "investigation":
      case "root_cause":
        return { label: stage.key === "investigation" && !incident.pathway_key ? "Choose pathway" : "Record", run: () => (stage.key === "investigation" ? setPathwayOpen(true) : setStepOpen(true)) };
      case "reportability_review":
        return { label: "Determine", run: () => setReportabilityOpen(true) };
      default:
        return null;
    }
  };

  const submitApproval = async () => {
    try {
      await approve.mutateAsync({ note: approveNote.trim() || undefined });
      toast({ title: "Investigation approved" });
      setApproveOpen(false);
      setApproveNote("");
    } catch (error) {
      toast({
        title: "Could not approve the investigation",
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
                <ClipboardCheck className="h-5 w-5" /> Follow-through
              </CardTitle>
              <CardDescription>
                {state.completedCount} of {state.applicableCount} stages complete
                {state.nextAction ? ` · next: ${state.nextAction.label}` : " · nothing outstanding"}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={reportability === "pending_review"
                  ? "border-amber-500 text-amber-700 dark:text-amber-500"
                  : undefined}
              >
                {REPORTABILITY_STATUS_LABELS[reportability] ?? reportability}
              </Badge>
              {pathway && <Badge variant="outline">{pathway.label} pathway</Badge>}
              {state.overdueCount > 0 && (
                <Badge variant="outline" className="border-destructive text-destructive">
                  {state.overdueCount} overdue
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5">
            {state.stages.map((stage) => {
              const action = canManage ? stageAction(stage) : null;
              return (
                <li key={stage.key} className="flex items-start gap-2 text-sm">
                  <StageIcon status={stage.status} />
                  <span className={stage.status === "not_applicable" ? "flex-1 text-muted-foreground" : "flex-1"}>
                    <span className="font-medium">{stage.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {INCIDENT_STAGE_STATUS_LABELS[stage.status]}
                    </span>
                    {stage.outstanding && (
                      <span className="block text-xs text-muted-foreground">{stage.outstanding}</span>
                    )}
                  </span>
                  {action && (
                    <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={action.run}>
                      {action.label}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {incident.reportability_rationale && (
            <div className="rounded-md border bg-muted/40 p-2 text-xs">
              <p className="font-medium uppercase tracking-wide text-muted-foreground">
                Reportability reasoning
              </p>
              <p className="mt-0.5">{incident.reportability_rationale}</p>
            </div>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                disabled={state.blockingClosure.length > 0 || Boolean(incident.administrator_approved_at) || approve.isPending}
                onClick={() => setApproveOpen(true)}
                title={state.blockingClosure.length > 0
                  ? `Outstanding: ${state.blockingClosure.map((stage) => stage.label).join(", ")}`
                  : undefined}
              >
                {incident.administrator_approved_at ? "Approved" : "Approve investigation"}
              </Button>
              {incident.pathway_key && (
                <Button size="sm" variant="outline" onClick={() => setPathwayOpen(true)}>
                  Open pathway questions
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setStepOpen(true)}>
                Edit investigation record
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <IncidentPathwayDialog
        open={pathwayOpen}
        onOpenChange={setPathwayOpen}
        incidentId={incidentId}
        incidentType={incident.incident_type}
        currentPathwayKey={incident.pathway_key}
        currentAnswers={(incident.pathway_answers ?? {}) as TemplateAnswers}
      />
      <ReportabilityDialog
        open={reportabilityOpen}
        onOpenChange={setReportabilityOpen}
        incidentId={incidentId}
        prompts={prompts}
      />
      <InvestigationStepDialog
        open={stepOpen}
        onOpenChange={setStepOpen}
        incidentId={incidentId}
        initial={{
          immediateResponse: incident.immediate_response ?? "",
          findings: incident.investigation_findings ?? "",
          rootCause: incident.root_cause ?? "",
          rootCauseMethod: incident.root_cause_method ?? "",
        }}
      />

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve the investigation</DialogTitle>
            <DialogDescription>
              This records that someone accountable read the whole file and found it complete. The
              server re-checks every stage, so an approval cannot land on stale information.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="approval-note">Note (optional)</Label>
            <Textarea id="approval-note" rows={3} value={approveNote} onChange={(event) => setApproveNote(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={submitApproval} disabled={approve.isPending}>
              {approve.isPending ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
