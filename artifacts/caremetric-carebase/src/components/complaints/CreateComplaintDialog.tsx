import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toDateTimeLocal } from "@/lib/dateUtils";
import { useCreateComplaint } from "@/hooks/useComplaints";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import { useListResidents } from "@/hooks/useResidents";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const COMPLAINT_CATEGORIES = ["billing", "food", "staff_conduct", "service", "privacy", "resident_rights", "environmental", "other"];
export const COMPLAINT_STATUSES = ["received", "acknowledged", "investigating", "response_pending", "appeal", "monitoring", "pending_closure", "closed"];
export const humanizeComplaint = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

const METHODS = ["in_person", "phone", "email", "letter", "portal", "staff_report", "other"];
const COMPLAINANT_TYPES = ["resident", "designated_person", "family", "anonymous", "staff_on_behalf", "other"];
const REPORTABLE = ["abuse", "neglect", "exploitation", "serious_injury", "other_reportable_event"];

export function CreateComplaintDialog({ open, onOpenChange, organizationId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const create = useCreateComplaint();
  const facilities = useListFacilities({ organizationId });
  const profiles = useListProfiles({ organizationId });
  const [facilityId, setFacilityId] = useState("");
  const residents = useListResidents({ facilityId, status: "active" }, { enabled: !!facilityId });
  const [dateReceived, setDateReceived] = useState(() => toDateTimeLocal());
  const [method, setMethod] = useState("in_person");
  const [complainantType, setComplainantType] = useState("resident");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [residentId, setResidentId] = useState("none");
  const [category, setCategory] = useState("service");
  const [description, setDescription] = useState("");
  const [risk, setRisk] = useState("none");
  const [immediateAction, setImmediateAction] = useState("");
  const [investigator, setInvestigator] = useState(user?.id ?? "none");
  const [reportable, setReportable] = useState<string[]>([]);

  const setAnonymousState = (checked: boolean) => {
    setAnonymous(checked);
    if (checked) {
      setComplainantType("anonymous");
      setName("");
      setContact("");
    } else if (complainantType === "anonymous") setComplainantType("resident");
  };
  const toggleReportable = (value: string, checked: boolean) => setReportable(current => checked ? [...current, value] : current.filter(item => item !== value));
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setDescription(""); setImmediateAction(""); setReportable([]); setName(""); setContact("");
    }
  };
  const submit = () => create.mutate({
    facilityId,
    dateReceived: new Date(dateReceived).toISOString(),
    methodReceived: method,
    complainantType,
    complainantName: name.trim() || undefined,
    complainantContact: contact.trim() || undefined,
    isAnonymous: anonymous,
    residentId: residentId === "none" ? undefined : residentId,
    category,
    description: description.trim(),
    immediateRisk: risk,
    immediateActionTaken: immediateAction.trim() || undefined,
    reportableConcerns: reportable,
    assignedInvestigatorProfileId: investigator === "none" ? undefined : investigator,
  }, {
    onSuccess: id => {
      toast({
        title: reportable.length ? "Complaint and linked incident created" : "Complaint case created",
        description: reportable.length ? "Reportability indicators started the incident workflow automatically." : "The complaint is ready for acknowledgement and investigation.",
      });
      close(false);
      location.href = `/app/complaints/${id}`;
    },
    onError: (error: Error) => toast({ title: "Could not create complaint", description: error.message, variant: "destructive" }),
  });
  const requiresImmediateAction = risk === "high" || risk === "imminent";
  const valid = facilityId && dateReceived && description.trim().length >= 10
    && (anonymous || name.trim().length >= 2)
    && (!requiresImmediateAction || immediateAction.trim().length >= 5);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New complaint or grievance</DialogTitle>
          <DialogDescription>Use this workflow for concerns that are not necessarily reportable incidents. Safety indicators still trigger incident handling.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1"><Label>Facility *</Label><Select value={facilityId} onValueChange={value => { setFacilityId(value); setResidentId("none"); }}><SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger><SelectContent>{facilities.data?.map(facility => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Date received *</Label><Input type="datetime-local" value={dateReceived} onChange={event => setDateReceived(event.target.value)} /></div>
          <div className="space-y-1"><Label>Method received *</Label><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Complainant type *</Label><Select disabled={anonymous} value={complainantType} onValueChange={value => { setComplainantType(value); if (value === "anonymous") setAnonymousState(true); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMPLAINANT_TYPES.map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={anonymous} onCheckedChange={value => setAnonymousState(value === true)} />Anonymous complaint</label>
          {!anonymous && <><div className="space-y-1"><Label>Complainant name *</Label><Input value={name} onChange={event => setName(event.target.value)} /></div><div className="space-y-1"><Label>Contact information</Label><Input value={contact} onChange={event => setContact(event.target.value)} /></div></>}
          <div className="space-y-1"><Label>Resident involved</Label><Select value={residentId} onValueChange={setResidentId} disabled={!facilityId}><SelectTrigger><SelectValue placeholder="Optional resident" /></SelectTrigger><SelectContent><SelectItem value="none">No resident selected</SelectItem>{residents.data?.map(resident => <SelectItem key={resident.id} value={resident.id}>{resident.last_name}, {resident.first_name}{resident.room ? ` · Room ${resident.room}` : ""}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Category *</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMPLAINT_CATEGORIES.map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>Complaint description *</Label><Textarea value={description} onChange={event => setDescription(event.target.value)} className="min-h-24" placeholder="Record the concern in the complainant's own terms where possible." /></div>
          <div className="space-y-1"><Label>Immediate risk *</Label><Select value={risk} onValueChange={setRisk}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["none", "low", "high", "imminent"].map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Assigned investigator</Label><Select value={investigator} onValueChange={setInvestigator}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{profiles.data?.filter(profile => profile.is_active && ["org_admin", "facility_manager"].includes(profile.role)).map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>Immediate protective action {requiresImmediateAction ? "*" : ""}</Label><Textarea value={immediateAction} onChange={event => setImmediateAction(event.target.value)} placeholder="Document protection, separation, escalation, or other immediate response." /></div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Reportability indicators</Label>
            <p className="text-xs text-muted-foreground">Select every concern suggested by the complaint. Any selection automatically starts and links the incident workflow.</p>
            <div className="grid gap-2 sm:grid-cols-2">{REPORTABLE.map(value => <label key={value} className="flex items-center gap-2 rounded border p-2 text-sm"><Checkbox checked={reportable.includes(value)} onCheckedChange={checked => toggleReportable(value, checked === true)} />{humanizeComplaint(value)}</label>)}</div>
          </div>
          {reportable.length > 0 && <Alert variant="destructive" className="sm:col-span-2"><AlertTriangle className="h-4 w-4" /><AlertTitle>Incident workflow will start automatically</AlertTitle><AlertDescription>A linked reportable incident will be created in the same transaction. Human review of required external reporting remains part of the incident workflow.</AlertDescription></Alert>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => close(false)}>Cancel</Button><Button disabled={!valid || create.isPending} onClick={submit}>{create.isPending ? "Creating..." : "Create complaint case"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
