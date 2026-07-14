import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  PencilLine,
  Printer,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useCreateResident, useListResidents } from "@/hooks/useResidents";
import {
  useAnalyzerEnabled,
  useApproveAnalyzerJob,
  useDeclineAnalyzerChart,
  useExportAnalyzerPacket,
  useListAnalyzerJobs,
  useMarkAnalyzerChartCreated,
  useRetryAnalyzerJob,
  useUpdateAnalyzerDraft,
  useUploadAnalyzerDocuments,
} from "@/hooks/useDocumentAnalyzer";
import {
  type AnalyzerJobDraft,
  canReviewAnalyzerStatus,
  type DocumentAnalyzerJob,
  isDraftCompleteForApproval,
  isDraftDirty,
  isPotentialResidentDuplicate,
  jobToDraft,
  parseAnalyzerIssues,
  splitResidentName,
  summarizeAnalyzerJobs,
} from "@/lib/documentAnalyzer";
import { QueryError, QueryLoading } from "@/components/QueryState";

function statusLabel(status: string) {
  switch (status) {
    case "queued": return "Queued";
    case "processing": return "Processing";
    case "needs_review": return "Needs review";
    case "ready": return "Ready";
    case "failed": return "Failed";
    default: return status;
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready") return "default";
  if (status === "failed") return "destructive";
  if (status === "needs_review") return "secondary";
  return "outline";
}

const EMPTY_DRAFT: AnalyzerJobDraft = {
  residentName: "",
  facilityName: "",
  stateFormTemplate: "",
  reviewDueDate: "",
  admissionDate: "",
  notes: "",
  facilityId: "",
};

// Maps an extraction issue's field key onto the editable draft, so "Apply" writes the
// suggested value into the right input.
const ISSUE_FIELD_TO_DRAFT_KEY: Partial<Record<string, keyof AnalyzerJobDraft>> = {
  resident_name: "residentName",
  facility_name: "facilityName",
  state_form_template: "stateFormTemplate",
  review_due_date: "reviewDueDate",
  admission_date: "admissionDate",
  notes: "notes",
};

export default function DocumentAnalyzer() {
  const { toast } = useToast();
  const { data: facilities } = useListFacilities();
  const { data: analyzerEnabled, isLoading: isEnabledLoading } = useAnalyzerEnabled();
  const jobsQuery = useListAnalyzerJobs();
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);

  const uploadDocuments = useUploadAnalyzerDocuments();
  const updateDraft = useUpdateAnalyzerDraft();
  const approveJob = useApproveAnalyzerJob();
  const retryJob = useRetryAnalyzerJob();
  const markChartCreated = useMarkAnalyzerChartCreated();
  const declineChart = useDeclineAnalyzerChart();
  const exportPacket = useExportAnalyzerPacket();
  const { mutate: createResident, isPending: isCreatingResident } = useCreateResident();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnalyzerJobDraft>(EMPTY_DRAFT);
  const [appliedIssueKeys, setAppliedIssueKeys] = useState<Set<string>>(new Set());

  const summary = useMemo(() => summarizeAnalyzerJobs(jobs), [jobs]);
  const selectedJob: DocumentAnalyzerJob | undefined =
    jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const canReview = !!selectedJob && canReviewAnalyzerStatus(selectedJob.status);

  // Re-seed the local draft whenever a different job is selected or the row changes
  // underneath us (extraction finished, another save landed).
  const draftSourceKey = selectedJob ? `${selectedJob.id}:${selectedJob.updated_at}` : null;
  const lastDraftSourceKey = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedJob || draftSourceKey === lastDraftSourceKey.current) return;
    lastDraftSourceKey.current = draftSourceKey;
    setDraft(jobToDraft(selectedJob));
    setAppliedIssueKeys(new Set());
  }, [selectedJob, draftSourceKey]);

  const issues = useMemo(
    () => (selectedJob ? parseAnalyzerIssues(selectedJob.issues) : []),
    [selectedJob],
  );
  const openIssues = issues.filter((_, index) => !appliedIssueKeys.has(`${selectedJob?.id}:${index}`));

  const dirty = !!selectedJob && isDraftDirty(selectedJob, draft);
  const selectedFacility = facilities?.find((facility) => facility.id === draft.facilityId);
  const { data: existingResidents } = useListResidents(
    { facilityId: draft.facilityId || undefined },
    { enabled: Boolean(draft.facilityId) },
  );
  const possibleDuplicateResident = selectedJob
    ? existingResidents?.find((resident) => isPotentialResidentDuplicate(draft, resident))
    : undefined;

  // One completion toast per batch, driven by the polled rows instead of a local timer.
  const previousInProgress = useRef(0);
  useEffect(() => {
    if (previousInProgress.current > 0 && summary.inProgress === 0 && summary.total > 0) {
      toast({
        title: "Document batch finished",
        description: `${summary.ready} ready, ${summary.needsReview} needing review, ${summary.failed} failed. Review and approve each form before export.`,
      });
    }
    previousInProgress.current = summary.inProgress;
  }, [summary.failed, summary.inProgress, summary.needsReview, summary.ready, summary.total, toast]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    uploadDocuments.mutate(Array.from(files), {
      onSuccess: (result) => {
        if (result.enqueued.length > 0) {
          setSelectedJobId((current) => current ?? result.enqueued[0].id);
          toast({
            title: `${result.enqueued.length} PDF${result.enqueued.length === 1 ? "" : "s"} queued`,
            description: "Extraction runs in the background -- you can leave this page and come back.",
          });
        }
        if (result.rejected.length > 0) {
          toast({
            title: `${result.rejected.length} file${result.rejected.length === 1 ? "" : "s"} skipped`,
            description: result.rejected.map((r) => `${r.fileName}: ${r.reason}`).join(" · "),
            variant: "destructive",
          });
        }
      },
      onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
    });
  };

  const saveDraft = (onSaved?: (job: DocumentAnalyzerJob) => void) => {
    if (!selectedJob) return;
    updateDraft.mutate(
      { jobId: selectedJob.id, ...draft },
      {
        onSuccess: (job) => onSaved?.(job),
        onError: (e: Error) => toast({ title: "Failed to save corrections", description: e.message, variant: "destructive" }),
      },
    );
  };

  const approveSelectedJob = () => {
    if (!selectedJob) return;
    const approve = () =>
      approveJob.mutate(selectedJob.id, {
        onSuccess: (job) => toast({ title: "Form approved", description: `${job.file_name} is ready for packet export and printing.` }),
        onError: (e: Error) => toast({ title: "Failed to approve form", description: e.message, variant: "destructive" }),
      });
    if (dirty) saveDraft(() => approve());
    else approve();
  };

  const applySuggestion = (index: number) => {
    if (!selectedJob) return;
    const issue = issues[index];
    const draftKey = issue ? ISSUE_FIELD_TO_DRAFT_KEY[issue.field] : undefined;
    if (!issue?.suggested_value || !draftKey) return;
    setDraft((current) => ({
      ...current,
      [draftKey]: draftKey === "notes" && current.notes
        ? `${current.notes}\n${issue.suggested_value}`
        : issue.suggested_value!,
    }));
    setAppliedIssueKeys((current) => new Set(current).add(`${selectedJob.id}:${index}`));
  };

  const linkExistingResidentChart = () => {
    if (!selectedJob || !possibleDuplicateResident) return;
    const link = () =>
      markChartCreated.mutate(
        { jobId: selectedJob.id, residentId: possibleDuplicateResident.id },
        {
          onSuccess: () =>
            toast({
              title: "Existing resident linked",
              description: `${possibleDuplicateResident.first_name} ${possibleDuplicateResident.last_name} is linked to this analyzed form.`,
            }),
          onError: (e: Error) => toast({ title: "Failed to link resident", description: e.message, variant: "destructive" }),
        },
      );
    if (dirty) saveDraft(() => link());
    else link();
  };

  const createResidentChart = () => {
    if (!selectedJob || !selectedFacility) {
      toast({ title: "Choose a facility first", description: "Select where this resident should be created before adding them to the system.", variant: "destructive" });
      return;
    }
    const residentName = draft.residentName.trim();
    if (!residentName) {
      toast({ title: "Resident name required", description: "Enter the resident name extracted from the form before creating the resident chart.", variant: "destructive" });
      return;
    }
    if (!draft.admissionDate.trim()) {
      toast({ title: "Admission date required", description: "Enter the admission date extracted from the form before creating the resident chart.", variant: "destructive" });
      return;
    }

    const finishChart = () => {
      const { firstName, lastName } = splitResidentName(residentName);
      createResident(
        {
          organization_id: selectedFacility.organization_id,
          facility_id: selectedFacility.id,
          first_name: firstName,
          last_name: lastName,
          admission_date: draft.admissionDate,
          room: null,
          sdcu: false,
          hospice: false,
          admission_track: "standard",
        },
        {
          onSuccess: (resident) => {
            markChartCreated.mutate(
              { jobId: selectedJob.id, residentId: resident.id },
              {
                onSuccess: () => toast({ title: "Resident added", description: `${firstName} ${lastName} was entered into the system so a full chart can be built.` }),
                onError: (e: Error) => toast({ title: "Resident created but not linked", description: e.message, variant: "destructive" }),
              },
            );
          },
          onError: (error: Error) => toast({ title: "Failed to add resident", description: error.message, variant: "destructive" }),
        },
      );
    };
    // The facility choice lives on the job row (the RPC validates against it), so persist
    // the draft before creating the resident.
    if (dirty) saveDraft(() => finishChart());
    else finishChart();
  };

  const declineResidentChart = () => {
    if (!selectedJob) return;
    declineChart.mutate(selectedJob.id, {
      onError: (e: Error) => toast({ title: "Failed to update chart choice", description: e.message, variant: "destructive" }),
    });
  };

  const retryFailedJob = (jobId: string) => {
    retryJob.mutate(jobId, {
      onError: (e: Error) => toast({ title: "Failed to retry extraction", description: e.message, variant: "destructive" }),
    });
  };

  const openPacket = (kind: "export" | "print") => {
    exportPacket.mutate(undefined, {
      onSuccess: (result) => {
        window.open(result.url!, "_blank", "noopener,noreferrer");
        toast({
          title: kind === "print" ? "Packet ready to print" : "Packet exported",
          description: `${result.jobCount} approved form${result.jobCount === 1 ? "" : "s"} included. ${kind === "print" ? "Use the browser PDF viewer to print." : "The download link is valid for 10 minutes."}`,
        });
      },
      onError: (e: Error) => toast({ title: "Failed to generate packet", description: e.message, variant: "destructive" }),
    });
  };

  const uploadsDisabled = uploadDocuments.isPending || analyzerEnabled === false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Badge variant="secondary" className="w-fit gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Super admin only</Badge>
          <h1 className="text-3xl font-bold tracking-tight">State Form Document Analyzer</h1>
          <p className="max-w-3xl text-muted-foreground">
            Convert historical state forms into current templates: batch-upload scanned PDFs, review the AI
            extraction, correct and approve each form, then export or print the approved packet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!summary.approved || exportPacket.isPending} onClick={() => openPacket("export")}>
            {exportPacket.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Export approved PDFs
          </Button>
          <Button disabled={!summary.approved || exportPacket.isPending} onClick={() => openPacket("print")}>
            {exportPacket.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />} Print approved packet
          </Button>
        </div>
      </div>

      {!isEnabledLoading && analyzerEnabled === false && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>AI extraction is turned off</AlertTitle>
          <AlertDescription>
            Scanned state forms contain resident records, so extraction stays disabled until the PHI/BAA
            review for the AI vendor is confirmed. Enable “AI Document Analyzer” in{" "}
            <Link href="/admin/settings" className="underline">Platform Settings</Link> to start processing uploads.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Uploaded</p><p className="text-2xl font-bold">{summary.total}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Processing</p><p className="text-2xl font-bold">{summary.inProgress}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Ready</p><p className="text-2xl font-bold">{summary.ready}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Approved</p><p className="text-2xl font-bold">{summary.approved}</p></CardContent></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[460px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UploadCloud className="h-5 w-5" /> Batch upload old form PDFs</CardTitle>
              <CardDescription>Add a single PDF or hundreds of scanned forms. Each file becomes an independent extraction job.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-dashed p-6 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <Label htmlFor="state-form-upload" className="cursor-pointer font-medium">Choose PDF files to analyze</Label>
                <Input
                  id="state-form-upload"
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="mt-3"
                  disabled={uploadsDisabled}
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Files are stored securely and process in the background with per-form retry and review states.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Processing queue</CardTitle>
              <CardDescription>Track every upload, select a result to review, or retry any failed job.</CardDescription>
            </CardHeader>
            <CardContent>
              {jobsQuery.isLoading && <QueryLoading what="the processing queue" />}
              {jobsQuery.isError && <QueryError what="the processing queue" error={jobsQuery.error} onRetry={() => jobsQuery.refetch()} />}
              {!jobsQuery.isLoading && !jobsQuery.isError && (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>File</TableHead><TableHead>Status</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No PDFs uploaded yet.</TableCell></TableRow>
                    )}
                    {jobs.map((job) => (
                      <TableRow key={job.id} className={selectedJob?.id === job.id ? "bg-muted/50" : undefined}>
                        <TableCell className="max-w-[150px] font-medium">
                          <span className="block truncate" title={job.file_name}>{job.file_name}</span>
                          {job.status === "failed" && job.last_error_message && (
                            <span className="block truncate text-xs text-destructive" title={job.last_error_message}>
                              {job.last_error_message}
                            </span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge></TableCell>
                        <TableCell>{job.confidence !== null ? `${job.confidence}%` : "—"}</TableCell>
                        <TableCell className="text-right">
                          {job.status === "failed" ? (
                            <Button variant="ghost" size="sm" disabled={retryJob.isPending} onClick={() => retryFailedJob(job.id)}>
                              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(job.id)}>Review</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PencilLine className="h-5 w-5" /> Editable generated state form</CardTitle>
              <CardDescription>AI output remains draft-only and fully editable. Corrections are saved to the job's audit-logged record.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedJob && (
                <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">Upload PDFs to create editable state form drafts.</div>
              )}
              {selectedJob && !canReview && (
                <div className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
                  {selectedJob.status === "queued" ? <Clock3 className="h-4 w-4" /> : selectedJob.status === "failed" ? <AlertCircle className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                  {selectedJob.status === "failed"
                    ? `${selectedJob.file_name} failed: ${selectedJob.last_error_message ?? "extraction error"}. Retry it from the queue.`
                    : `${selectedJob.file_name} is ${statusLabel(selectedJob.status).toLowerCase()}. You can leave this page while processing continues in the background.`}
                </div>
              )}
              {selectedJob && canReview && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2"><Label>Resident name</Label><Input value={draft.residentName} onChange={(event) => setDraft((d) => ({ ...d, residentName: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>State form template</Label><Input value={draft.stateFormTemplate} onChange={(event) => setDraft((d) => ({ ...d, stateFormTemplate: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>Facility name from form</Label><Input value={draft.facilityName} onChange={(event) => setDraft((d) => ({ ...d, facilityName: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>System facility for resident chart</Label><Select value={draft.facilityId || "unassigned"} onValueChange={(value) => setDraft((d) => ({ ...d, facilityId: value === "unassigned" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Choose facility before creating chart</SelectItem>{(facilities ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-2"><Label>Review due date</Label><Input value={draft.reviewDueDate} onChange={(event) => setDraft((d) => ({ ...d, reviewDueDate: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>Admission date for resident chart</Label><Input type="date" value={draft.admissionDate} onChange={(event) => setDraft((d) => ({ ...d, admissionDate: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>Extraction confidence</Label><Input value={selectedJob.confidence !== null ? `${selectedJob.confidence}%` : "—"} readOnly /></div>
                    <div className="space-y-2"><Label>Export approval</Label><Input value={selectedJob.approved_for_export ? "Approved" : "Pending super admin approval"} readOnly /></div>
                  </div>
                  <div className="space-y-2">
                    <Label>Transferred handwritten notes and corrections</Label>
                    <Textarea value={draft.notes} onChange={(event) => setDraft((d) => ({ ...d, notes: event.target.value }))} rows={7} />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => saveDraft(() => toast({ title: "Corrections saved" }))} disabled={!dirty || updateDraft.isPending}>
                        {updateDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PencilLine className="mr-2 h-4 w-4" />} Save corrections
                      </Button>
                      <Button
                        onClick={approveSelectedJob}
                        disabled={approveJob.isPending || updateDraft.isPending || !isDraftCompleteForApproval(draft) || (selectedJob.approved_for_export && !dirty)}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Approve for export
                      </Button>
                    </div>
                    {!isDraftCompleteForApproval(draft) && (
                      <p className="text-xs text-muted-foreground">
                        Resident name, facility, state form template, and review due date are required before approval.
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {selectedJob && canReview && selectedJob.chart_creation_status !== "created" && (
            <Card>
              <CardHeader>
                <CardTitle>Create resident chart?</CardTitle>
                <CardDescription>Do you want to enter this resident into the system automatically so staff can build the complete resident chart without manually retyping demographics?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This creates the resident record from the extracted name, selected system facility, and admission date. Compliance checklist generation will follow the existing resident creation workflow.
                </p>
                {possibleDuplicateResident && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Possible existing resident found</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{possibleDuplicateResident.first_name} {possibleDuplicateResident.last_name} already exists at this facility. Link the analyzed form to that chart instead of creating a duplicate.</p>
                      <Button size="sm" variant="outline" disabled={markChartCreated.isPending} onClick={linkExistingResidentChart}>Use existing resident chart</Button>
                    </AlertDescription>
                  </Alert>
                )}
                {selectedJob.chart_creation_status === "declined" && <Badge variant="secondary">Skipped for this form</Badge>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={createResidentChart} disabled={isCreatingResident || markChartCreated.isPending || !!possibleDuplicateResident || !draft.facilityId || !draft.admissionDate || !draft.residentName.trim() || selectedJob.chart_creation_status === "declined"}>
                    {isCreatingResident ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Yes, create resident
                  </Button>
                  <Button variant="outline" onClick={declineResidentChart} disabled={declineChart.isPending || selectedJob.chart_creation_status === "declined"}>Not now</Button>
                </div>
              </CardContent>
            </Card>
          )}
          {selectedJob?.chart_creation_status === "created" && selectedJob.chart_resident_id && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Resident entered into system</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>Resident ID {selectedJob.chart_resident_id} is now available for creating the full chart.</p>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/residents/${selectedJob.chart_resident_id}`}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Open resident chart
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5" /> Logic checks and suggestions</CardTitle>
              <CardDescription>Extraction flags stale dates, missing information, and illegible handwriting for human verification.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{issues.length - openIssues.length} applied</Badge>
                <Badge variant={openIssues.length ? "destructive" : "default"}>{openIssues.length} open suggestions</Badge>
                <Badge variant="outline">Editable audit trail retained</Badge>
                <Badge variant="outline">{summary.totalIssues} batch issues</Badge>
                <Badge variant="outline">{summary.approved} approved for export</Badge>
              </div>
              {issues.map((issue, index) => {
                const key = `${selectedJob?.id}:${index}`;
                if (appliedIssueKeys.has(key)) return null;
                const applicable = Boolean(issue.suggested_value && ISSUE_FIELD_TO_DRAFT_KEY[issue.field]);
                return (
                  <div key={key} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-medium">{ISSUE_FIELD_TO_DRAFT_KEY[issue.field] ? issue.field.replace(/_/g, " ") : "Document"}</p>
                        <p className="text-sm text-muted-foreground">{issue.message}</p>
                        {issue.suggested_value && (
                          <p className="mt-2 text-sm"><span className="font-medium">Suggested value:</span> {issue.suggested_value}</p>
                        )}
                      </div>
                      {applicable && (
                        <Button size="sm" onClick={() => applySuggestion(index)} disabled={!canReview}>Apply</Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {selectedJob && canReview && openIssues.length === 0 && (
                <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-600" /> No open extraction flags for this form. Continue manual review before approving.
                </div>
              )}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Final human review required</AlertTitle>
                <AlertDescription>AI extraction only drafts the converted form. A super admin must review and approve every form before it can be exported or printed.</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
