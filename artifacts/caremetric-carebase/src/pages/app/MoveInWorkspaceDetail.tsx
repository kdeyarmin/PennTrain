import { useId, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileSignature,
  FileUp,
  History,
  Link2,
  Loader2,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useAssignMoveInTask,
  useCompleteMoveInAdmission,
  useGetMoveInWorkspace,
  useIssueMoveInGuestGrant,
  useListMoveInGuestGrants,
  useListMoveInTaskHistory,
  useRevokeMoveInGuestGrant,
  useUpdateMoveInTask,
  type MoveInTaskWithOwner,
} from "@/hooks/useAdmissions";
import { useListProfiles } from "@/hooks/useProfiles";
import { useGetFacility } from "@/hooks/useFacilities";
import { useListResidentDocuments, useUploadResidentDocument } from "@/hooks/useResidentDocuments";
import { QueryError } from "@/components/QueryState";
import { addFacilityCalendarDays, facilityDayBounds, facilityToday, formatDateForDisplay, facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import { absoluteAppUrl } from "@/lib/appUrl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ResidentAgreementWorkspace } from "@/components/residents/ResidentAgreementWorkspace";

const TASK_STATES = ["open", "in_progress", "submitted", "approved", "exception", "completed"];
const STATE_CLASS: Record<string, string> = {
  open: "bg-blue-100 text-blue-900",
  in_progress: "bg-cyan-100 text-cyan-900",
  submitted: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  exception: "bg-red-100 text-red-900",
  completed: "bg-green-100 text-green-900",
};

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function taskReady(task: MoveInTaskWithOwner): boolean {
  return ["completed", "approved"].includes(task.state) || (task.state === "exception" && !!task.approved_at);
}

export default function MoveInWorkspaceDetail() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  // Router navigation, not window.location: the app can be served under a base path
  // (BASE_URL), and a hard reload also drops the SPA state for no reason.
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const workspace = useGetMoveInWorkspace(id);
  const { data: admissionFacility } = useGetFacility(workspace.data?.facility_id);
  const allowContractAfterAdmission = admissionFacility?.facility_type === "ALR"
    && (admissionFacility as typeof admissionFacility & { resident_regulatory_policy?: Record<string, unknown> }).resident_regulatory_policy?.alf_contract_timing === "within_24_hours";
  const history = useListMoveInTaskHistory(id);
  const grants = useListMoveInGuestGrants(id);
  const { data: profiles } = useListProfiles({ organizationId: user?.organizationId ?? undefined });
  const { data: documents } = useListResidentDocuments(workspace.data?.resident_id);
  const uploadDocument = useUploadResidentDocument();
  const updateTask = useUpdateMoveInTask();
  const assignTask = useAssignMoveInTask();
  const issueGrant = useIssueMoveInGuestGrant();
  const revokeGrant = useRevokeMoveInGuestGrant();
  const admit = useCompleteMoveInAdmission();
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const [selectedTask, setSelectedTask] = useState<MoveInTaskWithOwner | null>(null);
  const [targetState, setTargetState] = useState("in_progress");
  const [reason, setReason] = useState("");
  const [documentId, setDocumentId] = useState("none");
  const [signatureName, setSignatureName] = useState("");
  const [signatureRelationship, setSignatureRelationship] = useState("");
  const [signatureSignedAt, setSignatureSignedAt] = useState("");
  const [certifierRole, setCertifierRole] = useState("");
  const [consultedProvider, setConsultedProvider] = useState("");
  const [certifiedBeforeAdmission, setCertifiedBeforeAdmission] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestLabel, setGuestLabel] = useState("Designated person");
  const [guestTaskIds, setGuestTaskIds] = useState<string[]>([]);
  const [guestDays, setGuestDays] = useState("7");
  const [issuedLink, setIssuedLink] = useState("");
  const [admitReason, setAdmitReason] = useState("");
  const [admissionDate, setAdmissionDate] = useState(facilityToday());
  const [admissionTime, setAdmissionTime] = useState("");

  const data = workspace.data;
  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const readyCount = tasks.filter(taskReady).length;
  const blockers = tasks.filter(task => !taskReady(task) && !(allowContractAfterAdmission && (task.task_key === "resident_agreement" || (task.task_key === "guest_signing" && task.depends_on_task_keys.includes("resident_agreement"))))).length;
  const progress = tasks.length ? Math.round((readyCount / tasks.length) * 100) : 0;

  if (workspace.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (workspace.isError || !data) return <QueryError what="move-in workspace" error={workspace.error} onRetry={() => workspace.refetch()} />;

  const openTask = (task: MoveInTaskWithOwner) => {
    setSelectedTask(task);
    setTargetState(task.requires_approval ? "approved" : "completed");
    setReason("");
    setDocumentId(task.document_id ?? "none");
    setSignatureName("");
    setSignatureRelationship("");
    setSignatureSignedAt(""); setCertifierRole(""); setConsultedProvider(""); setCertifiedBeforeAdmission(false);
    setUploadFile(null);
  };

  const saveTask = () => {
    if (!selectedTask) return;
    if (signatureName.trim() && ["resident_agreement","alf_needs_certification"].includes(selectedTask.task_key) && !signatureSignedAt) {
      toast({ title: "Enter the actual signature date and time", variant: "destructive" }); return;
    }
    const signatureEvidence = selectedTask.requires_signature && signatureName.trim()
      ? {
          signerName: signatureName.trim(),
          relationship: signatureRelationship.trim(),
          signedAt: signatureSignedAt ? facilityDateTimeLocalToUtcIso(signatureSignedAt) : new Date().toISOString(),
          authenticationMethod: "authenticated_staff_capture",
          ...(selectedTask.task_key === "alf_needs_certification" ? {
            certifierRole, consultedProvider, canMeetNeeds: true, priorToAdmission: certifiedBeforeAdmission,
          } : {}),
        }
      : null;
    updateTask.mutate({
      taskId: selectedTask.id,
      targetState,
      documentId: documentId === "none" ? null : documentId,
      signatureEvidence,
      reason: reason || `${humanize(targetState)} by move-in coordinator`,
    }, {
      onSuccess: () => {
        toast({ title: "Move-in task updated" });
        setSelectedTask(null);
      },
      onError: (error: Error) => toast({ title: "Couldn't update task", description: error.message, variant: "destructive" }),
    });
  };

  const uploadAndLink = () => {
    if (!uploadFile || !selectedTask) return;
    uploadDocument.mutate({
      file: uploadFile,
      organizationId: data.organization_id,
      facilityId: data.facility_id,
      residentId: data.resident_id,
      documentLabel: selectedTask.title,
    }, {
      onSuccess: document => {
        setDocumentId(document.id);
        toast({ title: "Document uploaded and selected" });
      },
      onError: (error: Error) => toast({ title: "Couldn't upload document", description: error.message, variant: "destructive" }),
    });
  };

  const createGuestLink = () => {
    const days = Number(guestDays);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Invalid expiration", description: "Guest days must be a positive number", variant: "destructive" });
      return;
    }
    issueGrant.mutate({
      workspaceId: data.id,
      guestLabel,
      taskIds: guestTaskIds,
      expiresAt: facilityDayBounds(addFacilityCalendarDays(facilityToday(), days)).through,
    }, {
      onSuccess: result => {
        const link = absoluteAppUrl(`/move-in-access/${result.token}`);
        setIssuedLink(link);
        toast({ title: "Guest signing link created", description: "Copy it now; the token is not stored in plain text." });
      },
      onError: (error: Error) => toast({ title: "Couldn't create guest link", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2"><Link href="/app/admissions"><ArrowLeft className="mr-1 h-4 w-4" />Admissions</Link></Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{data.resident?.first_name} {data.resident?.last_name} move-in</h1>
          <Badge variant="outline">{humanize(data.state)}</Badge>
        </div>
        <p className="text-muted-foreground">{data.facility?.name} · Room {data.resident?.room ?? "—"} · Target {formatDateForDisplay(data.target_move_in_date)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{progress}%</p><p className="text-sm text-muted-foreground">Ready</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{readyCount}</p><p className="text-sm text-muted-foreground">Completed / approved</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold text-amber-700">{blockers}</p><p className="text-sm text-muted-foreground">Remaining blockers</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{grants.isLoading || grants.isError ? "—" : (grants.data?.filter(grant => !grant.revoked_at && new Date(grant.expires_at) > new Date()).length ?? 0)}</p><p className="text-sm text-muted-foreground">Active guest links</p></CardContent></Card>
      </div>

      {data.state === "ready" && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Ready to admit</AlertTitle>
          <AlertDescription>Admission prerequisites are clear.{allowContractAfterAdmission ? " The resident contract remains due within 24 hours of actual admission if still open." : " Required contracts are complete before admission."}</AlertDescription>
        </Alert>
      )}

      <ResidentAgreementWorkspace
        residentId={data.resident_id}
        documents={documents ?? []}
        canManage={canManage}
      />

      <Card>
        <CardHeader><CardTitle>Admission task checklist</CardTitle><CardDescription>Tasks cannot complete until their dependencies and required documentation are satisfied.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[1fr_180px_190px_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {taskReady(task) ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <ClipboardCheck className="h-5 w-5 text-blue-600" />}
                  <p className="font-semibold">{task.title}</p>
                  {task.requires_document && <Badge variant="outline"><FileUp className="mr-1 h-3 w-3" />Document</Badge>}
                  {task.requires_signature && <Badge variant="outline"><FileSignature className="mr-1 h-3 w-3" />Signature</Badge>}
                  {task.requires_approval && <Badge variant="outline"><ShieldCheck className="mr-1 h-3 w-3" />Approval</Badge>}
                </div>
                {!!task.depends_on_task_keys.length && <p className="mt-1 text-xs text-muted-foreground">Depends on: {task.depends_on_task_keys.map(humanize).join(", ")}</p>}
                {task.exception_reason && <p className="mt-1 text-sm text-red-700">Exception: {task.exception_reason}</p>}
                {task.task_key === "resident_agreement" && data.facility?.facility_type === "ALR" && <p className="mt-1 text-xs text-muted-foreground">2800.22(a)(5): {allowContractAfterAdmission ? "The recorded facility policy permits completion within 24 hours after actual admission. An unfinished agreement remains on this checklist after admission." : "Facility policy requires the agreement before admission."}</p>}
              </div>
              <div>
                <Select
                  value={task.owner_profile_id ?? "unassigned"}
                  disabled={!canManage}
                  onValueChange={ownerId => assignTask.mutate(
                    { taskId: task.id, ownerProfileId: ownerId === "unassigned" ? null : ownerId, dueAt: task.due_at },
                    {
                      onError: (error) => toast({
                        title: "Could not update task owner",
                        description: error instanceof Error ? error.message : String(error),
                        variant: "destructive",
                      }),
                    },
                  )}
                >
                  <SelectTrigger aria-label="Task owner"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{profiles?.filter(profile => profile.is_active).map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : "No due date"}</p>
              </div>
              <div><Badge variant="outline" className={`border-0 ${STATE_CLASS[task.state]}`}>{humanize(task.state)}</Badge>{task.document && <p className="mt-1 truncate text-xs text-muted-foreground">{task.document.document_label ?? task.document.file_name}</p>}{task.signature_evidence && <p className="mt-1 text-xs text-emerald-700">Signature captured</p>}</div>
              {canManage && <Button size="sm" variant="outline" onClick={() => openTask(task)}>Update</Button>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />Family and designated-person access</CardTitle><CardDescription>Issue expiring, task-scoped links for external signatures. Access and signing are logged.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {canManage && <Button onClick={() => { setGuestLabel(""); setGuestTaskIds([]); setGuestDays("7"); setGuestOpen(true); }}><FileSignature className="mr-2 h-4 w-4" />Create guest signing link</Button>}
            {issuedLink && <div className="flex gap-2 rounded-md border p-2"><Input readOnly value={issuedLink} /><Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(issuedLink)}><Copy className="h-4 w-4" /></Button></div>}
            {grants.isError ? (
              <QueryError what="guest signing links" error={grants.error} onRetry={() => void grants.refetch()} />
            ) : grants.data?.map(grant => (
              <div key={grant.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <div><p className="font-medium">{grant.guest_label}</p><p className="text-xs text-muted-foreground">{grant.allowed_task_ids.length} scoped task(s) · expires {new Date(grant.expires_at).toLocaleString()}</p></div>
                <Badge variant="outline">{grant.revoked_at ? "Revoked" : new Date(grant.expires_at) <= new Date() ? "Expired" : grant.accepted_at ? "Accepted" : "Issued"}</Badge>
                {canManage && !grant.revoked_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revokeGrant.isPending}
                    onClick={() => revokeGrant.mutate(
                      { grantId: grant.id, reason: "Coordinator revoked guest access" },
                      {
                        onError: (error) => toast({
                          title: "Could not revoke guest access",
                          description: error instanceof Error ? error.message : String(error),
                          variant: "destructive",
                        }),
                      },
                    )}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Move-in history</CardTitle><CardDescription>Append-only task assignment, documentation, approval, exception, and guest-signature events.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {history.isError ? (
              <QueryError what="move-in history" error={history.error} onRetry={() => void history.refetch()} />
            ) : history.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading move-in history…</p>
            ) : !history.data?.length ? (
              <p className="text-sm text-muted-foreground">No task events yet.</p>
            ) : history.data.slice(0, 20).map(event => (
              <div key={event.id} className="flex justify-between gap-3 border-b pb-2 text-sm">
                <div><p className="font-medium">{humanize(event.event_type)}{event.resulting_state ? ` · ${humanize(event.resulting_state)}` : ""}</p><p className="text-xs text-muted-foreground">{event.reason}</p></div>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {canManage && data.state === "ready" && (
        <Card className="border-emerald-300">
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRoundCheck className="h-5 w-5 text-emerald-600" />One-click admission</CardTitle><CardDescription>Atomically activates census, occupies the reserved bed, completes the workspace, and preserves the readiness snapshot.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] grow space-y-1"><Label htmlFor={`${__fieldIds}-admission-decision-reason`}>Admission decision reason *</Label><Input id={`${__fieldIds}-admission-decision-reason`} value={admitReason} onChange={event => setAdmitReason(event.target.value)} placeholder="All admission requirements verified" /></div>
            <div className="space-y-1"><Label htmlFor={`${__fieldIds}-actual-admission-date`}>First day residing at the facility *</Label><Input id={`${__fieldIds}-actual-admission-date`} type="date" max={facilityToday()} value={admissionDate} onChange={event => setAdmissionDate(event.target.value)} /><p className="text-xs text-muted-foreground">Admission deadlines run from this day.</p></div>
            {allowContractAfterAdmission && <div className="space-y-1"><Label htmlFor={`${__fieldIds}-actual-admission-time`}>Actual admission time (Pennsylvania) *</Label><Input id={`${__fieldIds}-actual-admission-time`} type="time" value={admissionTime} onChange={event => setAdmissionTime(event.target.value)} /></div>}
            <Button disabled={admitReason.trim().length < 5 || !admissionDate || admissionDate > facilityToday() || (allowContractAfterAdmission && !admissionTime) || admit.isPending} onClick={() => admit.mutate({ workspaceId: data.id, reason: admitReason, admissionDate, admittedAt: admissionTime ? facilityDateTimeLocalToUtcIso(`${admissionDate}T${admissionTime}`) : undefined }, { onSuccess: residentId => { toast({ title: "Resident admitted to active census" }); navigate(`/app/residents/${residentId}`); }, onError: (error: Error) => toast({ title: "Couldn't complete admission", description: error.message, variant: "destructive" }) })}>{admit.isPending ? "Admitting..." : "Admit resident"}</Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedTask} onOpenChange={value => !value && setSelectedTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selectedTask?.title}</DialogTitle><DialogDescription>Attach documentation, capture a staff-assisted signature, document an exception, or advance the task.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor={`${__fieldIds}-new-state`}>New state</Label><Select value={targetState} onValueChange={setTargetState}><SelectTrigger id={`${__fieldIds}-new-state`}><SelectValue /></SelectTrigger><SelectContent>{TASK_STATES.map(state => <SelectItem key={state} value={state}>{humanize(state)}</SelectItem>)}</SelectContent></Select></div>
            {selectedTask?.requires_document && (
              <div className="space-y-2">
                <Label htmlFor={`${__fieldIds}-required-document`}>Required document</Label>
                <Select value={documentId} onValueChange={setDocumentId}><SelectTrigger id={`${__fieldIds}-required-document`}><SelectValue placeholder="Select existing document" /></SelectTrigger><SelectContent><SelectItem value="none">No document selected</SelectItem>{documents?.map(document => <SelectItem key={document.id} value={document.id}>{document.document_label ?? document.file_name}</SelectItem>)}</SelectContent></Select>
                <div className="flex gap-2"><Input type="file" onChange={event => setUploadFile(event.target.files?.[0] ?? null)} /><Button variant="outline" disabled={!uploadFile || uploadDocument.isPending} onClick={uploadAndLink}>Upload</Button></div>
              </div>
            )}
            {selectedTask?.requires_signature && (
              <div className="grid gap-2 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`${__fieldIds}-signer-name`}>Signer name</Label><Input id={`${__fieldIds}-signer-name`} value={signatureName} onChange={event => setSignatureName(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-relationship-authority`}>Relationship / authority</Label><Input id={`${__fieldIds}-relationship-authority`} value={signatureRelationship} onChange={event => setSignatureRelationship(event.target.value)} /></div></div>
            )}
            {selectedTask?.requires_signature && <div className="space-y-1"><Label htmlFor={`${__fieldIds}-signed-at`}>Actual signature date and time{["alf_needs_certification","resident_agreement"].includes(selectedTask.task_key) ? " *" : ""}</Label><Input id={`${__fieldIds}-signed-at`} type="datetime-local" max={toFacilityDateTimeLocal()} value={signatureSignedAt} onChange={event => setSignatureSignedAt(event.target.value)} /></div>}
            {selectedTask?.task_key === "alf_needs_certification" && <div className="space-y-3 rounded border p-3">
              <p className="text-xs text-muted-foreground">2800.22(b): signed certification that this residence can meet the resident's needs, made before admission.</p>
              <Label htmlFor={`${__fieldIds}-certifier-role`}>Certifier authority *</Label><Select value={certifierRole} onValueChange={setCertifierRole}><SelectTrigger id={`${__fieldIds}-certifier-role`}><SelectValue placeholder="Select qualified certifier" /></SelectTrigger><SelectContent><SelectItem value="administrator_consulted">Administrator consulting supplemental health care providers</SelectItem><SelectItem value="physician">Resident's physician</SelectItem><SelectItem value="crnp">Resident's certified registered nurse practitioner</SelectItem><SelectItem value="medical_director">Residence medical director</SelectItem></SelectContent></Select>
              {certifierRole === "administrator_consulted" && <><Label htmlFor={`${__fieldIds}-consulted-provider`}>Supplemental health care provider consulted *</Label><Input id={`${__fieldIds}-consulted-provider`} value={consultedProvider} onChange={event => setConsultedProvider(event.target.value)} /></>}
              <label className="flex gap-2 text-sm"><Checkbox checked={certifiedBeforeAdmission} onCheckedChange={checked => setCertifiedBeforeAdmission(checked === true)} />The signed certification confirms that needs can be met and was made before the resident's admission.</label>
            </div>}
            <div className="space-y-1"><Label htmlFor={`${__fieldIds}-reason-notes`}>Reason / notes {targetState === "exception" ? "*" : ""}</Label><Textarea id={`${__fieldIds}-reason-notes`} value={reason} onChange={event => setReason(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSelectedTask(null)}>Cancel</Button><Button disabled={updateTask.isPending || (targetState === "exception" && reason.trim().length < 5) || (selectedTask?.task_key === "alf_needs_certification" && ["approved", "completed", "exception"].includes(targetState) && (!signatureName.trim() || !signatureSignedAt || !certifierRole || !certifiedBeforeAdmission || (certifierRole === "administrator_consulted" && !consultedProvider.trim())))} onClick={saveTask}>{updateTask.isPending ? "Saving..." : "Update task"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={guestOpen} onOpenChange={setGuestOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create guest signing link</DialogTitle><DialogDescription>Select only the tasks this guest may view or sign.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor={`${__fieldIds}-guest-label`}>Guest label</Label><Input id={`${__fieldIds}-guest-label`} value={guestLabel} onChange={event => setGuestLabel(event.target.value)} /></div>
            <div className="space-y-2" role="group" aria-labelledby={`${__fieldIds}-allowed-tasks`}><Label id={`${__fieldIds}-allowed-tasks`}>Allowed tasks</Label>{tasks.filter(task => task.requires_signature || task.requires_document).map(task => <label key={task.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><Checkbox checked={guestTaskIds.includes(task.id)} onCheckedChange={checked => setGuestTaskIds(current => checked ? [...current, task.id] : current.filter(id => id !== task.id))} />{task.title}</label>)}</div>
            <div className="space-y-1"><Label htmlFor={`${__fieldIds}-expires-in-days`}>Expires in days</Label><Input id={`${__fieldIds}-expires-in-days`} type="number" min={1} max={30} value={guestDays} onChange={event => setGuestDays(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setGuestOpen(false)}>Cancel</Button><Button disabled={!guestLabel.trim() || !guestTaskIds.length || issueGrant.isPending} onClick={createGuestLink}>{issueGrant.isPending ? "Creating..." : "Create link"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
