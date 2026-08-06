import { useEffect, useState } from "react";
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
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  useApproveIncidentInvestigation, useDetermineIncidentReportability,
  useIncidentFollowThrough, useSaveIncidentInvestigationStep,
  useSetIncidentQapiConsideration,
} from "@/hooks/useIncidentFollowThrough";
import { useListQapiProjects } from "@/hooks/useQapi";
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

  useEffect(() => {
    if (open) {
      setStatus("");
      setRationale("");
    }
  }, [open]);

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

  useEffect(() => {
    if (!open) return;
    setImmediateResponse(initial.immediateResponse);
    setFindings(initial.findings);
    setRootCause(initial.rootCause);
    setMethod(initial.rootCauseMethod);
  }, [open, initial]);

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
/**
 * The QAPI decision (BACKLOG.md G16.8).
 *
 * The close-loop checklist has always listed "QAPI consideration" as a stage that blocks closure,
 * and there was no way to do it: `set_incident_qapi_consideration` had a hook nothing rendered, so
 * an incident that needed the decision could never leave that stage. The checklist named the step
 * and offered no button, which is the most legible form this class of gap takes.
 *
 * The two answers are the server's own vocabulary. `linked` demands a project in this incident's
 * facility, so the picker offers only those and the confirm is disabled until one is chosen --
 * offering an option that can only fail is the mistake this codebase has made before.
 * `not_indicated` takes a note, which the server appends to the investigation findings, because a
 * decision that quality improvement is not indicated is only worth anything with the reasoning
 * attached.
 */
function QapiConsiderationDialog({
  open, onOpenChange, incidentId, facilityId, current, currentProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  facilityId: string | null | undefined;
  current: string;
  currentProjectId: string | null;
}) {
  const { toast } = useToast();
  const setConsideration = useSetIncidentQapiConsideration(incidentId);
  const projects = useListQapiProjects({ facilityId: facilityId ?? undefined });
  const [consideration, setChoice] = useState(current === "pending" ? "linked" : current);
  const [projectId, setProjectId] = useState(currentProjectId ?? "");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setChoice(current === "pending" ? "linked" : current);
    setProjectId(currentProjectId ?? "");
    setNote("");
  }, [open, current, currentProjectId]);

  const options = projects.data ?? [];
  const canSubmit = consideration === "linked"
    ? Boolean(projectId) && !projects.isError && !projects.isLoading
    : true;

  const submit = async () => {
    try {
      await setConsideration.mutateAsync({
        consideration: consideration as "linked" | "not_indicated",
        qapiProjectId: consideration === "linked" ? projectId : undefined,
        note: note.trim() || undefined,
      });
      toast({ title: consideration === "linked" ? "Linked to the QAPI project" : "Recorded as not indicated" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not record the QAPI decision",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QAPI consideration</DialogTitle>
          <DialogDescription>
            Whether the pattern behind this incident belongs in a quality-improvement project. Either
            answer closes the stage; only one of them opens a project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="qapi-consideration">Decision</Label>
            <Select value={consideration} onValueChange={setChoice}>
              <SelectTrigger id="qapi-consideration"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linked">Link to a QAPI project</SelectItem>
                <SelectItem value="not_indicated">Not indicated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {consideration === "linked" ? (
            <div className="space-y-2">
              <Label htmlFor="qapi-project">Project</Label>
              {projects.isError ? (
                <QueryError what="QAPI projects" error={projects.error} onRetry={() => void projects.refetch()} />
              ) : (
                <>
                  <Select value={projectId} onValueChange={setProjectId} disabled={projects.isLoading}>
                    <SelectTrigger id="qapi-project">
                      <SelectValue placeholder={
                        projects.isLoading
                          ? "Loading projects…"
                          : options.length
                            ? "Pick a project"
                            : "No QAPI project exists for this facility"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((project) => (
                        <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!projects.isLoading && options.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      The server refuses a link to a project outside this incident&apos;s facility, so
                      there is nothing to offer until one exists. Open a project first, or record the
                      decision as not indicated.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="qapi-note">Why quality improvement is not indicated</Label>
              <Textarea
                id="qapi-note" rows={3} value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Isolated equipment failure, resolved at source; no pattern across the quarter."
              />
              <p className="text-xs text-muted-foreground">
                Kept on the investigation findings. Optional to the server, but a &ldquo;not
                indicated&rdquo; with no reasoning is not a decision anyone can review later.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit || setConsideration.isPending} onClick={() => void submit()}>
            {setConsideration.isPending ? "Recording…" : "Record decision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function IncidentFollowThroughSection({
  incidentId, canManage, facilityId,
}: {
  incidentId: string;
  canManage: boolean;
  /** Scopes the QAPI project picker; the server refuses a project outside the incident's facility. */
  facilityId: string | null | undefined;
}) {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useIncidentFollowThrough(incidentId);
  const approve = useApproveIncidentInvestigation(incidentId);
  const [pathwayOpen, setPathwayOpen] = useState(false);
  const [reportabilityOpen, setReportabilityOpen] = useState(false);
  const [stepOpen, setStepOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [qapiOpen, setQapiOpen] = useState(false);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) {
    return <QueryError what="incident follow-through" error={error} onRetry={() => void refetch()} />;
  }
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
      case "qapi_consideration":
        return { label: "Decide", run: () => setQapiOpen(true) };
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
                <ClipboardCheck className="h-5 w-5" /> Close-loop checklist
              </CardTitle>
              <CardDescription>
                One job from report through close: {state.completedCount} of {state.applicableCount} stages done
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
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${state.applicableCount ? Math.round((state.completedCount / state.applicableCount) * 100) : 0}%` }}
            />
          </div>
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
        key={reportabilityOpen ? "reportability-open" : "reportability-closed"}
        open={reportabilityOpen}
        onOpenChange={setReportabilityOpen}
        incidentId={incidentId}
        prompts={prompts}
      />
      {/*
        Re-keyed on open for the same reason as InvestigationStepDialog below: `not_indicated`
        APPENDS into investigation_findings, and the choice/project/note state is seeded once from
        props. Without a remount, a second open can re-append the note or save a stale project id.
      */}
      <QapiConsiderationDialog
        key={qapiOpen ? "qapi-open" : "qapi-closed"}
        open={qapiOpen}
        onOpenChange={setQapiOpen}
        incidentId={incidentId}
        facilityId={facilityId}
        current={incident.qapi_consideration}
        currentProjectId={incident.qapi_project_id}
      />
      {/*
        Re-keyed on open so the textareas seed from the incident as it is NOW, not as it was when
        this section first mounted. The state initializers run once, and the record changes
        underneath them: record_incident_qapi_decision APPENDS to the same column this dialog
        edits -- `coalesce(investigation_findings || E'\n\n', '') || 'QAPI not indicated: ' ...`
        (20260726080100_incident_pathways_and_follow_through.sql). So a manager who recorded a QAPI
        decision and then opened "Investigation record" saw the pre-append narrative, and saving
        wrote that back over the appended QAPI reasoning -- deleting it from the incident record.
      */}
      <InvestigationStepDialog
        key={stepOpen ? "investigation-open" : "investigation-closed"}
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
