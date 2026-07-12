import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  BellRing,
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
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useCreateResident, useListResidents } from "@/hooks/useResidents";
import {
  approveJobForExport,
  createDocumentAnalyzerJob,
  declineResidentChartCreation,
  isPdfFileName,
  isPotentialResidentDuplicate,
  nextJobState,
  markResidentChartCreated,
  splitResidentName,
  summarizeBatch,
  updateJobDraft,
  type DocumentAnalyzerJob,
} from "@/lib/documentAnalyzer";

type Suggestion = {
  id: string;
  field: string;
  message: string;
  replacement: string;
  severity: "warning" | "info";
};

const initialSuggestions: Suggestion[] = [
  {
    id: "date",
    field: "Review due date",
    message: "The prior form is older than 12 months. Use today's review date before printing the updated packet.",
    replacement: "07/12/2026",
    severity: "warning",
  },
  {
    id: "mobility",
    field: "Mobility status",
    message: "Handwriting reads as 'walker with standby assist', but fall-risk logic expects a matching support note.",
    replacement: "Walker with standby assist; fall-risk precautions reviewed with care team.",
    severity: "info",
  },
  {
    id: "contact",
    field: "Emergency contact phone",
    message: "Phone number appears to be missing an area code. Confirm before exporting the final state form.",
    replacement: "(555) 014-2219",
    severity: "warning",
  },
];

function statusLabel(status: DocumentAnalyzerJob["status"]) {
  switch (status) {
    case "queued": return "Queued";
    case "processing": return "Processing";
    case "needs_review": return "Needs review";
    case "ready": return "Ready";
    case "failed": return "Failed";
  }
}

function statusVariant(status: DocumentAnalyzerJob["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready") return "default";
  if (status === "failed") return "destructive";
  if (status === "needs_review") return "secondary";
  return "outline";
}

export default function DocumentAnalyzer() {
  const { toast } = useToast();
  const { data: facilities } = useListFacilities();
  const { mutate: createResident, isPending: isCreatingResident } = useCreateResident();
  const [jobs, setJobs] = useState<DocumentAnalyzerJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const summary = useMemo(() => summarizeBatch(jobs), [jobs]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const canReview = !!selectedJob && ["ready", "needs_review"].includes(selectedJob.status);
  const selectedFacility = facilities?.find((facility) => facility.id === selectedJob?.facilityId);
  const { data: existingResidents } = useListResidents({ facilityId: selectedJob?.facilityId || "__no_facility_selected__" });
  const possibleDuplicateResident = selectedJob
    ? existingResidents?.find((resident) => isPotentialResidentDuplicate(selectedJob, resident))
    : undefined;

  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "processing")) return;

    const timer = window.setInterval(() => {
      setJobs((current) => current.map((job) => nextJobState(job)));
    }, 1_200);

    return () => window.clearInterval(timer);
  }, [jobs]);

  useEffect(() => {
    if (!summary.isComplete) return;
    toast({
      title: "Document batch finished",
      description: `${summary.ready} ready, ${summary.needsReview} needing review, ${summary.failed} failed. Super admins can now edit and export the completed forms.`,
    });
  }, [summary.failed, summary.isComplete, summary.needsReview, summary.ready, toast]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;

    const pdfFiles = Array.from(files).filter((file) => isPdfFileName(file.name));
    const rejected = files.length - pdfFiles.length;
    if (rejected > 0) {
      toast({ title: "Some files were skipped", description: "Only PDF state forms can be added to the analyzer queue.", variant: "destructive" });
    }

    const nextJobs = pdfFiles.map((file) => createDocumentAnalyzerJob(file));
    setJobs((current) => [...current, ...nextJobs]);
    setSelectedJobId((current) => current ?? nextJobs[0]?.id ?? null);
  };

  const updateSelectedDraft = (patch: Parameters<typeof updateJobDraft>[1]) => {
    if (!selectedJob) return;
    setJobs((current) => current.map((job) => job.id === selectedJob.id ? updateJobDraft(job, patch) : job));
  };

  const applySuggestion = (suggestion: Suggestion) => {
    updateSelectedDraft({ notes: `${selectedJob?.notes ?? ""}\n${suggestion.field}: ${suggestion.replacement}`.trim() });
    setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
  };

  const approveSelectedJob = () => {
    if (!selectedJob) return;
    setJobs((current) => current.map((job) => job.id === selectedJob.id ? approveJobForExport(job) : job));
    toast({ title: "Form approved", description: `${selectedJob.fileName} is ready for batch export and printing.` });
  };

  const linkExistingResidentChart = () => {
    if (!selectedJob || !possibleDuplicateResident) return;
    setJobs((current) => current.map((job) => job.id === selectedJob.id ? markResidentChartCreated(job, possibleDuplicateResident.id) : job));
    toast({ title: "Existing resident linked", description: `${possibleDuplicateResident.first_name} ${possibleDuplicateResident.last_name} is linked to this analyzed form.` });
  };

  const createResidentChart = () => {
    if (!selectedJob || !selectedFacility) {
      toast({ title: "Choose a facility first", description: "Select where this resident should be created before adding them to the system.", variant: "destructive" });
      return;
    }
    if (!selectedJob.admissionDate.trim()) {
      toast({ title: "Admission date required", description: "Enter the admission date extracted from the form before creating the resident chart.", variant: "destructive" });
      return;
    }

    const { firstName, lastName } = splitResidentName(selectedJob.residentName);
    createResident(
      {
        organization_id: selectedFacility.organization_id,
        facility_id: selectedFacility.id,
        first_name: firstName,
        last_name: lastName,
        admission_date: selectedJob.admissionDate,
        room: null,
        sdcu: false,
        hospice: false,
        admission_track: selectedFacility.facility_type === "ALR" ? "standard" : "standard",
      },
      {
        onSuccess: (resident) => {
          setJobs((current) => current.map((job) => job.id === selectedJob.id ? markResidentChartCreated(job, resident.id) : job));
          toast({ title: "Resident added", description: `${firstName} ${lastName} was entered into the system so a full chart can be built.` });
        },
        onError: (error: Error) => toast({ title: "Failed to add resident", description: error.message, variant: "destructive" }),
      },
    );
  };

  const declineResidentChart = () => {
    if (!selectedJob) return;
    setJobs((current) => current.map((job) => job.id === selectedJob.id ? declineResidentChartCreation(job) : job));
  };

  const retryJob = (jobId: string) => {
    setJobs((current) => current.map((job) => job.id === jobId ? { ...job, status: "queued", progress: 0, issues: 0, confidence: null } : job));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="w-fit gap-1"><Sparkles className="h-3.5 w-3.5" /> Super admin only</Badge>
          <h1 className="text-3xl font-bold tracking-tight">State Form Document Analyzer</h1>
          <p className="max-w-3xl text-muted-foreground">
            Batch upload old state form PDFs, let AI asynchronously extract typed and handwritten information, map each record into the current state template, and notify the super admin when forms are ready for final review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!summary.approved}><Download className="mr-2 h-4 w-4" /> Export approved PDFs</Button>
          <Button disabled={!summary.approved}><Printer className="mr-2 h-4 w-4" /> Print approved packet</Button>
        </div>
      </div>

      <Alert>
        <BellRing className="h-4 w-4" />
        <AlertTitle>Asynchronous backlog processing</AlertTitle>
        <AlertDescription>
          Large batches can keep processing after upload. When the queue finishes, the super admin receives a completion notification and can review any flagged forms before exporting or printing.
        </AlertDescription>
      </Alert>

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
              <CardDescription>Add a single PDF or hundreds of scanned forms. Each file becomes an independent asynchronous job.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-dashed p-6 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <Label htmlFor="state-form-upload" className="cursor-pointer font-medium">Choose PDF files to analyze</Label>
                <Input id="state-form-upload" type="file" accept="application/pdf" multiple className="mt-3" onChange={(event) => addFiles(event.target.files)} />
                <p className="mt-2 text-xs text-muted-foreground">Queued files process in the background with per-form retry and review states.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Processing queue</CardTitle>
              <CardDescription>Track every upload, select a result to review, or retry any failed job.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>File</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No PDFs uploaded yet.</TableCell></TableRow>
                  )}
                  {jobs.map((job) => (
                    <TableRow key={job.id} className={selectedJob?.id === job.id ? "bg-muted/50" : undefined}>
                      <TableCell className="max-w-[150px] truncate font-medium">{job.fileName}</TableCell>
                      <TableCell><Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge></TableCell>
                      <TableCell className="min-w-[120px]"><Progress value={job.progress} /></TableCell>
                      <TableCell className="text-right">
                        {job.status === "failed" ? (
                          <Button variant="ghost" size="sm" onClick={() => retryJob(job.id)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(job.id)}>Review</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PencilLine className="h-5 w-5" /> Editable generated state form</CardTitle>
              <CardDescription>AI output remains draft-only and fully editable for corrections, future reprints, and audit review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedJob && (
                <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">Upload PDFs to create editable state form drafts.</div>
              )}
              {selectedJob && !canReview && (
                <div className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
                  {selectedJob.status === "queued" ? <Clock3 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                  {selectedJob.fileName} is {statusLabel(selectedJob.status).toLowerCase()}. You can leave this page while processing continues asynchronously.
                </div>
              )}
              {selectedJob && canReview && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2"><Label>Resident name</Label><Input value={selectedJob.residentName} onChange={(event) => updateSelectedDraft({ residentName: event.target.value })} /></div>
                    <div className="space-y-2"><Label>State form template</Label><Input value={selectedJob.currentStateForm} onChange={(event) => updateSelectedDraft({ currentStateForm: event.target.value })} /></div>
                    <div className="space-y-2"><Label>Facility name from form</Label><Input value={selectedJob.facility} onChange={(event) => updateSelectedDraft({ facility: event.target.value })} /></div>
                    <div className="space-y-2"><Label>System facility for resident chart</Label><Select value={selectedJob.facilityId || "unassigned"} onValueChange={(value) => updateSelectedDraft({ facilityId: value === "unassigned" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Choose facility before creating chart</SelectItem>{(facilities ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-2"><Label>Review due date</Label><Input value={selectedJob.reviewDueDate} onChange={(event) => updateSelectedDraft({ reviewDueDate: event.target.value })} /></div>
                    <div className="space-y-2"><Label>Admission date for resident chart</Label><Input type="date" value={selectedJob.admissionDate} onChange={(event) => updateSelectedDraft({ admissionDate: event.target.value })} /></div>
                    <div className="space-y-2"><Label>OCR / handwriting confidence</Label><Input value={`${selectedJob.confidence ?? 0}%`} readOnly /></div>
                    <div className="space-y-2"><Label>Export approval</Label><Input value={selectedJob.approvedForExport ? "Approved" : "Pending super admin approval"} readOnly /></div>
                  </div>
                  <div className="space-y-2">
                    <Label>Transferred handwritten notes and corrections</Label>
                    <Textarea value={selectedJob.notes} onChange={(event) => updateSelectedDraft({ notes: event.target.value })} rows={7} />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={approveSelectedJob} disabled={!canReview || selectedJob.approvedForExport}>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Approve for export
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {selectedJob && canReview && selectedJob.chartCreationStatus !== "created" && (
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
                      <Button size="sm" variant="outline" onClick={linkExistingResidentChart}>Use existing resident chart</Button>
                    </AlertDescription>
                  </Alert>
                )}
                {selectedJob.chartCreationStatus === "declined" && <Badge variant="secondary">Skipped for this form</Badge>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={createResidentChart} disabled={isCreatingResident || !!possibleDuplicateResident || !selectedJob.facilityId || !selectedJob.admissionDate || selectedJob.chartCreationStatus === "declined"}>
                    {isCreatingResident ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Yes, create resident
                  </Button>
                  <Button variant="outline" onClick={declineResidentChart} disabled={selectedJob.chartCreationStatus === "declined"}>Not now</Button>
                </div>
              </CardContent>
            </Card>
          )}
          {selectedJob?.chartCreationStatus === "created" && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Resident entered into system</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>Resident ID {selectedJob.chartResidentId} is now available for creating the full chart.</p>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/residents/${selectedJob.chartResidentId}`}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Open resident chart
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5" /> Logic checks and suggestions</CardTitle>
              <CardDescription>Apply quick fixes when AI detects stale dates, missing information, or conflicts in handwritten data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{initialSuggestions.length - suggestions.length} applied</Badge>
                <Badge variant={suggestions.length ? "destructive" : "default"}>{suggestions.length} open suggestions</Badge>
                <Badge variant="outline">Editable audit trail retained</Badge>
                <Badge variant="outline">{summary.totalIssues} batch issues</Badge>
                <Badge variant="outline">{summary.approved} approved for export</Badge>
              </div>
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-medium">{suggestion.field}</p>
                      <p className="text-sm text-muted-foreground">{suggestion.message}</p>
                      <p className="mt-2 text-sm"><span className="font-medium">Suggested value:</span> {suggestion.replacement}</p>
                    </div>
                    <Button size="sm" onClick={() => applySuggestion(suggestion)} disabled={!canReview}>Apply</Button>
                  </div>
                </div>
              ))}
              {!suggestions.length && (
                <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-600" /> All current suggestions have been applied. Continue manual review before printing.
                </div>
              )}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Final human review required</AlertTitle>
                <AlertDescription>AI validates completeness and consistency, but super admins must approve flagged forms before export.</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
