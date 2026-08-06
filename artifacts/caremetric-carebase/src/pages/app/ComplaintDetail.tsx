import { useId, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, MessageSquareText, Plus, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { addFacilityCalendarDays, facilityDateTimeToUtc, facilityToday, toDateTimeLocal } from "@/lib/dateUtils";
import {
  useAddComplaintCorrectiveAction,
  useAddComplaintInterview,
  useAddComplaintMonitoring,
  useComplaintActivity,
  useGetComplaint,
  useUpdateComplaintCase,
} from "@/hooks/useComplaints";
import { useListProfiles } from "@/hooks/useProfiles";
import { usePageTitle } from "@/lib/pageTitle";
import { useToast } from "@/hooks/use-toast";
import { COMPLAINT_STATUSES, humanizeComplaint } from "@/components/complaints/CreateComplaintDialog";
import { QueryError } from "@/components/QueryState";
import { EntityHistoryDrawer } from "@/components/EntityHistoryDrawer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const local = (value: string | null) => value ? toDateTimeLocal(new Date(value)) : "";
const iso = (value: string) => value ? new Date(value).toISOString() : undefined;

export default function ComplaintDetail() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const complaint = useGetComplaint(id);
  usePageTitle(complaint.data?.complaint_number);
  const activity = useComplaintActivity(id);
  const profiles = useListProfiles({ organizationId: complaint.data?.organization_id });
  const update = useUpdateComplaintCase();
  const addInterview = useAddComplaintInterview();
  const addAction = useAddComplaintCorrectiveAction();
  const addMonitoring = useAddComplaintMonitoring();
  const canManage = user?.role !== "auditor" && complaint.data?.status !== "closed";
  const [status, setStatus] = useState("received");
  const [acknowledgement, setAcknowledgement] = useState("");
  const [investigator, setInvestigator] = useState("none");
  const [notes, setNotes] = useState("");
  const [findings, setFindings] = useState("");
  const [correctiveSummary, setCorrectiveSummary] = useState("");
  const [writtenResponse, setWrittenResponse] = useState("");
  const [writtenResponseDate, setWrittenResponseDate] = useState("");
  const [appealAt, setAppealAt] = useState("");
  const [appealDetails, setAppealDetails] = useState("");
  const [appealOutcome, setAppealOutcome] = useState("");
  const [ombudsmanAt, setOmbudsmanAt] = useState("");
  const [ombudsmanReference, setOmbudsmanReference] = useState("");
  const [monitoringRequired, setMonitoringRequired] = useState(false);
  const [monitoringUntil, setMonitoringUntil] = useState("");
  const [reason, setReason] = useState("");
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [monitoringOpen, setMonitoringOpen] = useState(false);

  useEffect(() => {
    const value = complaint.data;
    if (!value) return;
    setStatus(value.status); setAcknowledgement(local(value.acknowledgement_date));
    setInvestigator(value.assigned_investigator_profile_id ?? "none"); setNotes(value.investigation_notes ?? "");
    setFindings(value.findings ?? ""); setCorrectiveSummary(value.corrective_action_summary ?? "");
    setWrittenResponse(value.written_response ?? ""); setWrittenResponseDate(local(value.written_response_date));
    setAppealAt(local(value.appeal_requested_at)); setAppealDetails(value.appeal_or_reconsideration ?? "");
    setAppealOutcome(value.appeal_outcome ?? ""); setOmbudsmanAt(local(value.ombudsman_referral_at));
    setOmbudsmanReference(value.ombudsman_reference ?? ""); setMonitoringRequired(value.nonretaliation_monitoring_required);
    setMonitoringUntil(local(value.nonretaliation_monitoring_until));
  }, [complaint.data]);

  if (complaint.isLoading) return <div className="h-80 animate-pulse rounded bg-muted" />;
  if (complaint.isError || !complaint.data) return <QueryError what="complaint case" error={complaint.error} onRetry={() => complaint.refetch()} />;
  const c = complaint.data;
  const save = () => update.mutate({
    id: c.id, status, acknowledgementDate: iso(acknowledgement),
    assignedInvestigatorProfileId: investigator === "none" ? undefined : investigator,
    investigationNotes: notes, findings, correctiveActionSummary: correctiveSummary,
    writtenResponse, writtenResponseDate: iso(writtenResponseDate), appealRequestedAt: iso(appealAt),
    appealOrReconsideration: appealDetails, appealOutcome, ombudsmanReferralAt: iso(ombudsmanAt),
    ombudsmanReference, nonretaliationMonitoringRequired: monitoringRequired,
    nonretaliationMonitoringUntil: iso(monitoringUntil), reason,
  }, {
    onSuccess: () => { toast({ title: status === "closed" ? "Complaint closed with approval" : "Complaint case updated" }); setReason(""); },
    onError: (error: Error) => toast({ title: "Could not update complaint", description: error.message, variant: "destructive" }),
  });
  const openActions = (activity.data?.actions ?? []).filter(action => action.work_item && !["closed", "canceled"].includes(action.work_item.state));

  return (
    <div className="space-y-6">
      <div><Button asChild variant="ghost" size="sm"><Link href="/app/complaints"><ArrowLeft className="mr-1 h-4 w-4" />Complaints</Link></Button><div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{c.complaint_number}</h1><p className="text-muted-foreground">{c.facility?.name} · Received {new Date(c.date_received).toLocaleString()}</p></div><div className="flex flex-wrap items-center gap-2"><EntityHistoryDrawer entityType="complaints" entityId={c.id} title="Complaint history" /><Badge variant={c.status === "closed" ? "secondary" : "outline"}>{humanizeComplaint(c.status)}</Badge></div></div></div>
      {c.incident && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Reportable incident workflow linked</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{humanizeComplaint(c.incident.incident_type)} · {humanizeComplaint(c.incident.severity)} · {humanizeComplaint(c.incident.status)}</span><Button asChild size="sm" variant="outline"><Link href={`/app/incidents/${c.incident.id}`}>Open incident</Link></Button></AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader><CardTitle>Complaint intake</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Complainant</p><p className="font-medium">{c.is_anonymous ? "Anonymous" : c.complainant_name}</p><p className="text-sm text-muted-foreground">{humanizeComplaint(c.complainant_type)} · {humanizeComplaint(c.method_received)}</p></div><div><p className="text-xs text-muted-foreground">Resident</p><p className="font-medium">{c.resident ? `${c.resident.first_name} ${c.resident.last_name}` : "No resident linked"}</p><p className="text-sm text-muted-foreground">{c.resident?.room ? `Room ${c.resident.room}` : ""}</p></div><div><p className="text-xs text-muted-foreground">Category</p><p className="font-medium">{humanizeComplaint(c.category)}</p></div><div><p className="text-xs text-muted-foreground">Immediate risk</p><Badge variant={["high", "imminent"].includes(c.immediate_risk) ? "destructive" : "outline"}>{humanizeComplaint(c.immediate_risk)}</Badge></div></div><div><p className="text-xs text-muted-foreground">Concern</p><p className="whitespace-pre-wrap text-sm">{c.description}</p></div>{c.immediate_action_taken && <div><p className="text-xs text-muted-foreground">Immediate protective action</p><p className="whitespace-pre-wrap text-sm">{c.immediate_action_taken}</p></div>}{c.reportable_concerns.length > 0 && <div><p className="text-xs text-muted-foreground">Reportability indicators</p><div className="mt-1 flex flex-wrap gap-1">{c.reportable_concerns.map(value => <Badge key={value} variant="destructive">{humanizeComplaint(value)}</Badge>)}</div></div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Closure readiness</CardTitle><CardDescription>Database-enforced requirements</CardDescription></CardHeader><CardContent className="space-y-2 text-sm">{[
          [!!acknowledgement, "Acknowledgement recorded"], [investigator !== "none", "Investigator assigned"],
          [notes.trim().length >= 10, "Investigation notes complete"], [findings.trim().length >= 10, "Findings complete"],
          [writtenResponse.trim().length >= 10 && !!writtenResponseDate, "Written response recorded"],
          [openActions.length === 0, "Corrective actions complete"],
          [!monitoringRequired || (!!monitoringUntil && new Date(monitoringUntil) <= new Date() && (activity.data?.monitoring.length ?? 0) > 0), "Nonretaliation monitoring complete"],
        ].map(([ready, label]) => <div key={String(label)} className="flex items-center gap-2">{ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}<span>{String(label)}</span></div>)}</CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle>Investigation, response & closure</CardTitle><CardDescription>Auditors can review this record; only authorized managers can change it.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-status`}>Status</Label><Select disabled={!canManage} value={status} onValueChange={setStatus}><SelectTrigger id={`${__fieldIds}-status`}><SelectValue /></SelectTrigger><SelectContent>{COMPLAINT_STATUSES.map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-acknowledgement-date`}>Acknowledgement date</Label><Input id={`${__fieldIds}-acknowledgement-date`} disabled={!canManage} type="datetime-local" value={acknowledgement} onChange={event => setAcknowledgement(event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-assigned-investigator`}>Assigned investigator</Label><Select disabled={!canManage} value={investigator} onValueChange={setInvestigator}><SelectTrigger id={`${__fieldIds}-assigned-investigator`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{profiles.data?.filter(profile => profile.is_active && ["org_admin", "facility_manager"].includes(profile.role)).map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-investigation-notes`}>Investigation notes</Label><Textarea id={`${__fieldIds}-investigation-notes`} disabled={!canManage} className="min-h-24" value={notes} onChange={event => setNotes(event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-findings`}>Findings</Label><Textarea id={`${__fieldIds}-findings`} disabled={!canManage} className="min-h-24" value={findings} onChange={event => setFindings(event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-corrective-action-summary`}>Corrective-action summary</Label><Textarea id={`${__fieldIds}-corrective-action-summary`} disabled={!canManage} value={correctiveSummary} onChange={event => setCorrectiveSummary(event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-written-response`}>Written response</Label><Textarea id={`${__fieldIds}-written-response`} disabled={!canManage} className="min-h-24" value={writtenResponse} onChange={event => setWrittenResponse(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-written-response-date`}>Written response date</Label><Input id={`${__fieldIds}-written-response-date`} disabled={!canManage} type="datetime-local" value={writtenResponseDate} onChange={event => setWrittenResponseDate(event.target.value)} /></div><div />
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-appeal-reconsideration-requested`}>Appeal / reconsideration requested</Label><Input id={`${__fieldIds}-appeal-reconsideration-requested`} disabled={!canManage} type="datetime-local" value={appealAt} onChange={event => setAppealAt(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-appeal-outcome`}>Appeal outcome</Label><Input id={`${__fieldIds}-appeal-outcome`} disabled={!canManage} value={appealOutcome} onChange={event => setAppealOutcome(event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-appeal-or-reconsideration-details`}>Appeal or reconsideration details</Label><Textarea id={`${__fieldIds}-appeal-or-reconsideration-details`} disabled={!canManage} value={appealDetails} onChange={event => setAppealDetails(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-ombudsman-referral-date`}>Ombudsman referral date</Label><Input id={`${__fieldIds}-ombudsman-referral-date`} disabled={!canManage} type="datetime-local" value={ombudsmanAt} onChange={event => setOmbudsmanAt(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor={`${__fieldIds}-ombudsman-reference`}>Ombudsman reference</Label><Input id={`${__fieldIds}-ombudsman-reference`} disabled={!canManage} value={ombudsmanReference} onChange={event => setOmbudsmanReference(event.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox disabled={!canManage} checked={monitoringRequired} onCheckedChange={value => setMonitoringRequired(value === true)} />Nonretaliation monitoring required</label>
        {monitoringRequired && <div className="space-y-1"><Label htmlFor={`${__fieldIds}-monitor-through`}>Monitor through</Label><Input id={`${__fieldIds}-monitor-through`} disabled={!canManage} type="datetime-local" value={monitoringUntil} onChange={event => setMonitoringUntil(event.target.value)} /></div>}
        {canManage && <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${__fieldIds}-reason-for-this-update`}>Reason for this update *</Label><Input id={`${__fieldIds}-reason-for-this-update`} value={reason} onChange={event => setReason(event.target.value)} placeholder="Document the decision or documentation added" /></div>}
        {canManage && <div className="sm:col-span-2"><Button disabled={reason.trim().length < 5 || update.isPending} onClick={save}>{update.isPending ? "Saving..." : status === "closed" ? "Approve closure" : "Save case update"}</Button></div>}
      </CardContent></Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Interviews</CardTitle><CardDescription>Append-only investigation documentation</CardDescription></div>{canManage && <Button size="sm" onClick={() => setInterviewOpen(true)}><Plus className="h-4 w-4" /></Button>}</CardHeader><CardContent className="space-y-3">{activity.isError ? <QueryError what="interviews" error={activity.error} onRetry={() => void activity.refetch()} /> : !activity.data?.interviews.length ? <p className="text-sm text-muted-foreground">No interviews recorded.</p> : activity.data.interviews.map(item => <div key={item.id} className="rounded border p-3"><p className="font-medium">{item.person_name}</p><p className="text-xs text-muted-foreground">{item.relationship_to_case} · {new Date(item.interviewed_at).toLocaleString()}</p><p className="mt-2 text-sm">{item.notes}</p></div>)}</CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />Corrective actions</CardTitle><CardDescription>Owned in Operational Work</CardDescription></div>{canManage && <Button size="sm" onClick={() => setActionOpen(true)}><Plus className="h-4 w-4" /></Button>}</CardHeader><CardContent className="space-y-3">{activity.isError ? <QueryError what="corrective actions" error={activity.error} onRetry={() => void activity.refetch()} /> : !activity.data?.actions.length ? <p className="text-sm text-muted-foreground">No corrective actions assigned.</p> : activity.data.actions.map(item => <div key={item.id} className="rounded border p-3"><p className="font-medium">{item.work_item?.title}</p><p className="text-xs text-muted-foreground">Due {item.work_item ? new Date(item.work_item.due_at).toLocaleString() : "—"}</p><div className="mt-2 flex items-center justify-between"><Badge variant="outline">{humanizeComplaint(item.work_item?.state ?? "unknown")}</Badge>{item.work_item && <Button asChild size="sm" variant="outline"><Link href={`/app/work/${item.work_item.id}`}>Open</Link></Button>}</div></div>)}</CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Nonretaliation monitoring</CardTitle><CardDescription>Append-only observations</CardDescription></div>{canManage && <Button size="sm" onClick={() => setMonitoringOpen(true)}><Plus className="h-4 w-4" /></Button>}</CardHeader><CardContent className="space-y-3">{activity.isError ? <QueryError what="monitoring entries" error={activity.error} onRetry={() => void activity.refetch()} /> : !activity.data?.monitoring.length ? <p className="text-sm text-muted-foreground">No monitoring entries recorded.</p> : activity.data.monitoring.map(item => <div key={item.id} className="rounded border p-3"><div className="flex justify-between gap-2"><p className="text-xs text-muted-foreground">{new Date(item.observed_at).toLocaleString()}</p>{item.retaliation_concern_identified && <Badge variant="destructive">Concern identified</Badge>}</div><p className="mt-2 text-sm">{item.observations}</p>{item.action_taken && <p className="mt-1 text-xs">Action: {item.action_taken}</p>}</div>)}</CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Case history</CardTitle></CardHeader><CardContent className="space-y-2">{activity.isError ? <QueryError what="case history" error={activity.error} onRetry={() => void activity.refetch()} /> : !activity.data?.history.length ? <p className="text-sm text-muted-foreground">No history recorded yet.</p> : activity.data.history.map(item => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 border-b py-2 text-sm"><div><p className="font-medium">{humanizeComplaint(item.event_type)}</p><p className="text-muted-foreground">{item.reason}</p></div><div className="text-right text-xs text-muted-foreground"><p>{new Date(item.occurred_at).toLocaleString()}</p>{item.resulting_status && <p>{humanizeComplaint(item.resulting_status)}</p>}</div></div>)}</CardContent></Card>
      <InterviewDialog key={interviewOpen ? "interview-open" : "interview-closed"} open={interviewOpen} onOpenChange={setInterviewOpen} complaintId={c.id} mutation={addInterview} />
      <ActionDialog key={actionOpen ? "action-open" : "action-closed"} open={actionOpen} onOpenChange={setActionOpen} complaintId={c.id} profiles={profiles.data ?? []} mutation={addAction} />
      <MonitoringDialog key={monitoringOpen ? "monitoring-open" : "monitoring-closed"} open={monitoringOpen} onOpenChange={setMonitoringOpen} complaintId={c.id} mutation={addMonitoring} />
    </div>
  );
}

function InterviewDialog({ open, onOpenChange, complaintId, mutation }: { open: boolean; onOpenChange: (open: boolean) => void; complaintId: string; mutation: ReturnType<typeof useAddComplaintInterview> }) {
  const __fieldIds = useId();
  const { toast } = useToast(); const [at, setAt] = useState(() => toDateTimeLocal()); const [name, setName] = useState(""); const [relationship, setRelationship] = useState(""); const [notes, setNotes] = useState("");
  const submit = () => mutation.mutate({ complaintId, interviewedAt: new Date(at).toISOString(), personName: name, relationship, notes }, { onSuccess: () => { toast({ title: "Interview recorded" }); onOpenChange(false); setName(""); setRelationship(""); setNotes(""); }, onError: (error: Error) => toast({ title: "Could not record interview", description: error.message, variant: "destructive" }) });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Record interview</DialogTitle></DialogHeader><div className="space-y-3"><div className="space-y-1"><Label htmlFor={`${__fieldIds}-date-and-time`}>Date and time</Label><Input id={`${__fieldIds}-date-and-time`} type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-person-interviewed`}>Person interviewed</Label><Input id={`${__fieldIds}-person-interviewed`} value={name} onChange={event => setName(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-relationship-to-case`}>Relationship to case</Label><Input id={`${__fieldIds}-relationship-to-case`} value={relationship} onChange={event => setRelationship(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-interview-notes`}>Interview notes</Label><Textarea id={`${__fieldIds}-interview-notes`} value={notes} onChange={event => setNotes(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={name.trim().length < 2 || relationship.trim().length < 2 || notes.trim().length < 5 || mutation.isPending} onClick={submit}>Record interview</Button></DialogFooter></DialogContent></Dialog>;
}

function ActionDialog({ open, onOpenChange, complaintId, profiles, mutation }: { open: boolean; onOpenChange: (open: boolean) => void; complaintId: string; profiles: Array<{ id: string; first_name: string; last_name: string; is_active: boolean }>; mutation: ReturnType<typeof useAddComplaintCorrectiveAction> }) {
  const __fieldIds = useId();
  const { toast } = useToast(); const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [owner, setOwner] = useState(""); const [priority, setPriority] = useState("high"); const [due, setDue] = useState(() => toDateTimeLocal(facilityDateTimeToUtc(addFacilityCalendarDays(facilityToday(), 14), "17:00:00")));
  const submit = () => mutation.mutate({ complaintId, title, description, ownerProfileId: owner, priority, dueAt: new Date(due).toISOString() }, { onSuccess: () => { toast({ title: "Corrective action assigned", description: "The action is now in Operational Work." }); onOpenChange(false); setTitle(""); setDescription(""); }, onError: (error: Error) => toast({ title: "Could not assign action", description: error.message, variant: "destructive" }) });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Add corrective action</DialogTitle></DialogHeader><div className="space-y-3"><div className="space-y-1"><Label htmlFor={`${__fieldIds}-title`}>Title</Label><Input id={`${__fieldIds}-title`} value={title} onChange={event => setTitle(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-description`}>Description</Label><Textarea id={`${__fieldIds}-description`} value={description} onChange={event => setDescription(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-owner`}>Owner</Label><Select value={owner} onValueChange={setOwner}><SelectTrigger id={`${__fieldIds}-owner`}><SelectValue placeholder="Select owner" /></SelectTrigger><SelectContent>{profiles.filter(profile => profile.is_active).map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor={`${__fieldIds}-priority`}>Priority</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger id={`${__fieldIds}-priority`}><SelectValue /></SelectTrigger><SelectContent>{["low", "normal", "high", "urgent"].map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-due`}>Due</Label><Input id={`${__fieldIds}-due`} type="datetime-local" value={due} onChange={event => setDue(event.target.value)} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={title.trim().length < 3 || description.trim().length < 5 || !owner || mutation.isPending} onClick={submit}>Assign action</Button></DialogFooter></DialogContent></Dialog>;
}

function MonitoringDialog({ open, onOpenChange, complaintId, mutation }: { open: boolean; onOpenChange: (open: boolean) => void; complaintId: string; mutation: ReturnType<typeof useAddComplaintMonitoring> }) {
  const __fieldIds = useId();
  const { toast } = useToast(); const [at, setAt] = useState(() => toDateTimeLocal()); const [observations, setObservations] = useState(""); const [concern, setConcern] = useState(false); const [action, setAction] = useState("");
  const submit = () => mutation.mutate({ complaintId, observedAt: new Date(at).toISOString(), observations, concern, actionTaken: action }, { onSuccess: () => { toast({ title: "Monitoring entry recorded" }); onOpenChange(false); setObservations(""); setConcern(false); setAction(""); }, onError: (error: Error) => toast({ title: "Could not record monitoring", description: error.message, variant: "destructive" }) });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Record nonretaliation monitoring</DialogTitle></DialogHeader><div className="space-y-3"><div className="space-y-1"><Label htmlFor={`${__fieldIds}-observed-at`}>Observed at</Label><Input id={`${__fieldIds}-observed-at`} type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${__fieldIds}-observations`}>Observations</Label><Textarea id={`${__fieldIds}-observations`} value={observations} onChange={event => setObservations(event.target.value)} /></div><label className="flex items-center gap-2 text-sm"><Checkbox checked={concern} onCheckedChange={value => setConcern(value === true)} />Retaliation concern identified</label>{concern && <div className="space-y-1"><Label htmlFor={`${__fieldIds}-action-taken`}>Action taken *</Label><Textarea id={`${__fieldIds}-action-taken`} value={action} onChange={event => setAction(event.target.value)} /></div>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={observations.trim().length < 5 || (concern && action.trim().length < 5) || mutation.isPending} onClick={submit}>Record monitoring</Button></DialogFooter></DialogContent></Dialog>;
}
