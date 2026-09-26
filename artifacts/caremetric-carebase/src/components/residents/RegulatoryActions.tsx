import { useId, useState } from "react";
import { Link } from "wouter";
import { useResidentRegulatoryActions, useSaveResidentRegulatoryAction, type ResidentRegulatoryAction } from "@/hooks/useResidentRegulatoryActions";
import { REGULATORY_ACTIONS, regulatoryActionRecipients, regulatoryActionStatus, type RegulatoryActionType } from "@/lib/residentRegulatoryActions";
import { facilityDateTimeLocalToUtcIso } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { QueryError } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RegulatoryEvents } from "./RegulatoryEvents";

const EMPTY = { anchor: "", reason: "", destination: "", recipientName: "", completed: "", evidence: "", exception: "", language: "", ombudsman: "", rights: "", accommodation: "" };
const local = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T");
const display = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function RegulatoryActions({ organizationId, facilityId, residentId, facilityType }: { organizationId: string; facilityId: string; residentId?: string; facilityType?: string }) {
  const id = useId();
  const { user } = useAuth();
  const { toast } = useToast();
  const query = useResidentRegulatoryActions(facilityId, residentId);
  const save = useSaveResidentRegulatoryAction();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ResidentRegulatoryAction | null>(null);
  const [correctionOf, setCorrectionOf] = useState<ResidentRegulatoryAction | null>(null);
  const [type, setType] = useState<RegulatoryActionType>(residentId ? "discharge_notice" : "closure_department_notice");
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState("pending");
  const completionLocked = editing?.status === "completed";
  const canManage = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role ?? "");
  const set = (key: keyof typeof EMPTY, value: string) => setForm((previous) => ({ ...previous, [key]: value }));
  const edit = (row: ResidentRegulatoryAction) => {
    const details = row.details as Record<string, string>;
    setEditing(row); setCorrectionOf(null); setType(row.action_type as RegulatoryActionType); setStatus(row.status);
    setForm({ anchor: local(row.anchor_at), reason: row.reason, destination: row.destination ?? "", recipientName: row.recipient_name ?? "", completed: row.completed_at ? local(row.completed_at) : "", evidence: row.evidence ?? "", exception: row.exception_basis ?? "", language: details.language ?? "", ombudsman: details.ombudsman_contacts ?? "", rights: details.rights_and_appeal ?? "", accommodation: details.aging_in_place_attempts ?? "" });
    setOpen(true);
  };
  const correct = (row: ResidentRegulatoryAction) => {
    edit(row);
    setEditing(null); setCorrectionOf(row); setStatus("pending");
    setForm((previous) => ({ ...previous, reason: "", completed: "", evidence: "", exception: "" }));
  };
  const submit = () => {
    if (completionLocked) return;
    if (!form.anchor || form.reason.trim().length < 3 || (status === "completed" && (!form.completed || form.evidence.trim().length < 3)) || (status === "not_applicable" && form.exception.trim().length < 3)) {
      toast({ title: "Enter the event time, reason and completion or exception evidence", variant: "destructive" }); return;
    }
    const common = { action_type: type, anchor_at: facilityDateTimeLocalToUtcIso(form.anchor), reason: form.reason.trim(), destination: form.destination.trim() || null,
      recipient_name: form.recipientName.trim() || null, status, completed_at: form.completed ? facilityDateTimeLocalToUtcIso(form.completed) : null,
      evidence: form.evidence.trim() || null, exception_basis: form.exception.trim() || null,
      details: { ...(editing?.details as Record<string, string> | undefined), language: form.language, ombudsman_contacts: form.ombudsman, rights_and_appeal: form.rights, aging_in_place_attempts: form.accommodation,
        ...(correctionOf ? { corrects_action_id: correctionOf.id } : {}) } };
    save.mutate(editing ? { id: editing.id, changes: common } : { rows: (correctionOf ? [correctionOf.recipient_role] : regulatoryActionRecipients(type)).map((recipient) => ({ ...common, organization_id: organizationId, facility_id: facilityId, resident_id: correctionOf ? correctionOf.resident_id : residentId ?? null, recipient_role: recipient })) }, {
      onSuccess: () => { setOpen(false); toast({ title: editing ? "Record updated" : "Deadlines created" }); },
      onError: (error: Error) => toast({ title: "Could not save regulatory record", description: error.message, variant: "destructive" }),
    });
  };
  const field = (key: keyof typeof EMPTY, label: string, inputType?: string) => <div className="space-y-1"><Label htmlFor={`${id}-${key}`}>{label}</Label>{inputType ? <Input id={`${id}-${key}`} type={inputType} value={form[key]} disabled={completionLocked} onChange={(e) => set(key, e.target.value)} /> : <Textarea id={`${id}-${key}`} value={form[key]} disabled={completionLocked} onChange={(e) => set(key, e.target.value)} />}</div>;

  return <Card>
    <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Notices, transfers and fund deadlines</CardTitle>{canManage && <Button className="print:hidden" onClick={() => { setEditing(null); setCorrectionOf(null); setForm(EMPTY); setStatus("pending"); setType(residentId ? "discharge_notice" : "closure_department_notice"); setOpen(true); }}>Add deadline</Button>}</CardHeader>
    <CardContent className="space-y-3">
      <RegulatoryEvents facilityId={facilityId} residentId={residentId} canManage={canManage} />
      <p className="text-sm text-muted-foreground">Record actual delivery and transaction evidence for each recipient. Times use Pennsylvania time. Creating a deadline does not send a notice, transfer a resident or move funds.</p>
      {query.isError ? <QueryError what="regulatory deadlines" error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading deadlines…</p> : !query.data?.length ? <p className="text-sm text-muted-foreground">No notice or fund deadlines recorded.</p> : query.data.filter(row => Object.hasOwn(REGULATORY_ACTIONS,row.action_type)).map((row) => <div key={row.id} className="border rounded-md p-3 text-sm space-y-1">
        <div className="flex justify-between gap-3"><strong>{REGULATORY_ACTIONS[row.action_type as RegulatoryActionType]?.label ?? humanize(row.action_type)}</strong><span>{regulatoryActionStatus(row)}</span></div>
        <p>{humanize(row.recipient_role)}{row.recipient_name ? `: ${row.recipient_name}` : ""} · Due {display(row.due_at)}</p>
        <p>Event: {display(row.anchor_at)} · {row.reason}{row.destination ? ` · Destination: ${row.destination}` : ""}</p>
        {(row.details as Record<string, unknown>).initiator === "emergency" && <p>Certified emergency: {(row.details as Record<string, string>).certification_evidence}. Review the exception and actual practicable notice; the original 30-day comparison remains visible.</p>}
        {row.evidence && <p>Evidence: {row.evidence}{row.completed_at ? ` · Completed ${display(row.completed_at)}` : ""}</p>}
        {row.exception_basis && <p>Exception basis: {row.exception_basis}</p>}
        {typeof (row.details as Record<string, unknown>).corrects_action_id === "string" && <p>Correction to record: {(row.details as Record<string, string>).corrects_action_id}</p>}
        {!residentId && row.resident_id && <Link href={`/${user?.role === "platform_admin" ? "admin" : "app"}/residents/${row.resident_id}`} className="text-primary underline">Resident record: {row.resident_id}</Link>}
        {canManage && <div className="flex gap-2 print:hidden"><Button variant="outline" size="sm" onClick={() => edit(row)}>{row.status === "completed" ? "View completed record" : "Record delivery / update"}</Button>{row.status === "completed" && <Button variant="outline" size="sm" onClick={() => correct(row)}>Add correction</Button>}</div>}
      </div>)}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{completionLocked ? "Completed regulatory record" : correctionOf ? "Append correction record" : editing ? "Update regulatory record" : "Create regulatory deadline"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label htmlFor={`${id}-type`}>Duty</Label><Select value={type} disabled={!!editing || !!correctionOf} onValueChange={(value) => setType(value as RegulatoryActionType)}><SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REGULATORY_ACTIONS).filter(([key]) => editing?.action_type === key || correctionOf?.action_type === key || !!residentId !== ["closure_department_notice", "closure_license_return"].includes(key)).map(([key, rule]) => <SelectItem key={key} value={key}>{rule.label}</SelectItem>)}</SelectContent></Select>
          <p className="text-sm text-muted-foreground">{REGULATORY_ACTIONS[type].note}</p>
          {correctionOf && <p className="text-sm">This appends a correction to record {correctionOf.id} for {humanize(correctionOf.recipient_role)}. Explain the correction and record its evidence; the original remains unchanged.</p>}
          {!editing && !correctionOf && regulatoryActionRecipients(type).length > 1 && <p className="text-sm">Creates separate pending records for the resident, designated person/family and referral agent. Record each actual delivery separately.</p>}
          {field("anchor", `${REGULATORY_ACTIONS[type].anchor} (Pennsylvania time) *`, "datetime-local")}
          {field("reason", "Reason / triggering event *")}
          {["discharge_notice", "closure_resident_notice", "transfer_record"].includes(type) && field("destination", "Destination (or explain that it is unknown)")}
          {(facilityType === "ALR" || editing?.resident_id || correctionOf?.resident_id) && ["discharge_notice", "closure_resident_notice"].includes(type) && <>{field("language", "Notice language / accessible delivery format (ALF)")}{field("ombudsman", "State and local ombudsman names, mailing addresses and phone numbers (ALF)")}{field("rights", "Discharge rights and how to challenge the decision (ALF)")}{field("accommodation", "Aging-in-place accommodations attempted / supporting record (ALF)")}</>}
          {(editing || correctionOf) && <>
            {field("recipientName", `Recipient: ${humanize((editing ?? correctionOf)!.recipient_role)}`, "text")}
            <Label htmlFor={`${id}-status`}>Record status</Label><Select value={status} disabled={completionLocked} onValueChange={setStatus}><SelectTrigger id={`${id}-status`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="completed">Completed / written rescission received</SelectItem><SelectItem value="not_applicable">Exception documented</SelectItem></SelectContent></Select>
            {completionLocked && <p className="text-sm text-muted-foreground">This completed record is read-only. Use Add correction to append a separate record with supporting evidence.</p>}
            {status === "completed" && <>{field("completed", "Actual completion / written delivery time *", "datetime-local")}{field("evidence", "Written notice, delivery or payment evidence / document reference *")}</>}
            {status === "not_applicable" && field("exception", "Why the duty does not apply; document physician/DHS certification when required *")}
          </>}
          {!completionLocked && <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save record"}</Button>}
        </div>
      </DialogContent></Dialog>
    </CardContent>
  </Card>;
}
