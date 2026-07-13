import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  BedDouble,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  Hospital,
  Plus,
  RefreshCw,
  UserRoundPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListResidents } from "@/hooks/useResidents";
import {
  useCreateAdmissionProspect,
  useCreateReferralSource,
  useCreateRoomWithBeds,
  useListAdmissionProspects,
  useListCensusEvents,
  useListFacilityBeds,
  useListMoveInWorkspaces,
  useListReferralSources,
  useRecordAdmissionActivity,
  useReserveBedForProspect,
  useSetBedAvailability,
  useStartMoveInWorkspace,
  useTransitionResidentCensus,
  useUpdateAdmissionProspect,
  type AdmissionProspectWithRelations,
  type FacilityBedWithRelations,
} from "@/hooks/useAdmissions";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const STAGES = ["prospect", "applicant", "approved", "waitlisted", "reserved", "admitted", "declined", "lost"];
const REVIEW_STATUSES = ["not_started", "in_review", "needs_information", "approved", "declined"];
const CENSUS_STATUSES = ["active", "temporarily_out", "hospital_leave", "discharged", "deceased"];

const STAGE_CLASS: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-900",
  applicant: "bg-cyan-100 text-cyan-900",
  approved: "bg-emerald-100 text-emerald-900",
  waitlisted: "bg-amber-100 text-amber-900",
  reserved: "bg-purple-100 text-purple-900",
  admitted: "bg-green-100 text-green-900",
  declined: "bg-red-100 text-red-900",
  lost: "bg-muted text-muted-foreground",
};

const BED_CLASS: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-900",
  reserved: "bg-purple-100 text-purple-900",
  occupied: "bg-blue-100 text-blue-900",
  temporarily_unavailable: "bg-amber-100 text-amber-900",
  maintenance_hold: "bg-red-100 text-red-900",
};

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function ProspectDialog({
  open,
  onClose,
  facilityId,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  facilityId: string;
  sources: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const create = useCreateAdmissionProspect();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sourceId, setSourceId] = useState("none");
  const [expectedDate, setExpectedDate] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRelationship, setContactRelationship] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    create.mutate({
      facilityId,
      firstName,
      lastName,
      dateOfBirth,
      phone,
      email,
      referralSourceId: sourceId === "none" ? undefined : sourceId,
      expectedMoveInDate: expectedDate,
      primaryContactName: contactName,
      primaryContactRelationship: contactRelationship,
      primaryContactPhone: contactPhone,
      notes,
    }, {
      onSuccess: () => {
        toast({ title: "Prospect added to admission pipeline" });
        onClose();
      },
      onError: (error: Error) => toast({ title: "Couldn't add prospect", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New referral or inquiry</DialogTitle>
          <DialogDescription>Create a pre-admission record without adding the person to active census.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>First name *</Label><Input value={firstName} onChange={event => setFirstName(event.target.value)} /></div>
          <div className="space-y-1"><Label>Last name *</Label><Input value={lastName} onChange={event => setLastName(event.target.value)} /></div>
          <div className="space-y-1"><Label>Date of birth</Label><Input type="date" value={dateOfBirth} onChange={event => setDateOfBirth(event.target.value)} /></div>
          <div className="space-y-1"><Label>Expected move-in</Label><Input type="date" value={expectedDate} onChange={event => setExpectedDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={event => setPhone(event.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={event => setEmail(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Referral source</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Direct inquiry / not specified</SelectItem>{sources.map(source => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Primary contact</Label><Input value={contactName} onChange={event => setContactName(event.target.value)} /></div>
          <div className="space-y-1"><Label>Relationship</Label><Input value={contactRelationship} onChange={event => setContactRelationship(event.target.value)} /></div>
          <div className="space-y-1"><Label>Contact phone</Label><Input value={contactPhone} onChange={event => setContactPhone(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={event => setNotes(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!firstName.trim() || !lastName.trim() || !facilityId || create.isPending} onClick={submit}>{create.isPending ? "Adding..." : "Add prospect"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProspectReviewDialog({
  prospect,
  availableBeds,
  onClose,
}: {
  prospect: AdmissionProspectWithRelations | null;
  availableBeds: FacilityBedWithRelations[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateAdmissionProspect();
  const activity = useRecordAdmissionActivity();
  const reserve = useReserveBedForProspect();
  const startWorkspace = useStartMoveInWorkspace();
  const [stage, setStage] = useState(prospect?.stage ?? "prospect");
  const [clinical, setClinical] = useState(prospect?.clinical_review_status ?? "not_started");
  const [financial, setFinancial] = useState(prospect?.financial_review_status ?? "not_started");
  const [expectedDate, setExpectedDate] = useState(prospect?.expected_move_in_date ?? "");
  const [reason, setReason] = useState(prospect?.decision_reason ?? "");
  const [notes, setNotes] = useState(prospect?.notes ?? "");
  const [activityType, setActivityType] = useState("contact_attempt");
  const [activityNotes, setActivityNotes] = useState("");
  const [bedId, setBedId] = useState("");

  const saveReview = () => {
    if (!prospect) return;
    update.mutate({
      prospectId: prospect.id,
      stage,
      clinicalReviewStatus: clinical,
      financialReviewStatus: financial,
      expectedMoveInDate: expectedDate || null,
      decisionReason: reason,
      notes,
    }, {
      onSuccess: () => toast({ title: "Admission review updated" }),
      onError: (error: Error) => toast({ title: "Couldn't update review", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open={!!prospect} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{prospect?.first_name} {prospect?.last_name}</DialogTitle><DialogDescription>Clinical, financial, tour, room reservation, and move-in decisions.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label>Pipeline stage</Label><Select value={stage} onValueChange={setStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STAGES.filter(value => value !== "admitted").map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Expected move-in</Label><Input type="date" value={expectedDate} onChange={event => setExpectedDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>Clinical review</Label><Select value={clinical} onValueChange={setClinical}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REVIEW_STATUSES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Financial review</Label><Select value={financial} onValueChange={setFinancial}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REVIEW_STATUSES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>Decision reason</Label><Input value={reason} onChange={event => setReason(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={event => setNotes(event.target.value)} /></div>
        </div>
        <Button onClick={saveReview} disabled={update.isPending}>{update.isPending ? "Saving..." : "Save review"}</Button>

        <div className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">Contact and tour activity</h3>
          <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
            <Select value={activityType} onValueChange={setActivityType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["contact_attempt", "tour_scheduled", "tour_completed", "tour_canceled", "note"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>
            <Input value={activityNotes} onChange={event => setActivityNotes(event.target.value)} placeholder="Outcome or notes" />
            <Button variant="outline" disabled={!activityNotes.trim() || activity.isPending} onClick={() => prospect && activity.mutate({ prospectId: prospect.id, activityType, notes: activityNotes, outcome: activityNotes }, { onSuccess: () => { toast({ title: "Activity recorded" }); setActivityNotes(""); } })}>Add activity</Button>
          </div>
        </div>

        {["approved", "waitlisted", "reserved"].includes(prospect?.stage ?? "") && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="font-semibold">Room and move-in</h3>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Select value={bedId} onValueChange={setBedId}><SelectTrigger><SelectValue placeholder="Choose available bed" /></SelectTrigger><SelectContent>{availableBeds.filter(bed => bed.facility_id === prospect?.facility_id).map(bed => <SelectItem key={bed.id} value={bed.id}>{bed.room?.building?.name} · Room {bed.room?.room_number} · Bed {bed.bed_label}</SelectItem>)}</SelectContent></Select>
              <Button disabled={!bedId || reserve.isPending} onClick={() => prospect && reserve.mutate({ prospectId: prospect.id, bedId }, { onSuccess: () => toast({ title: "Bed reserved" }), onError: (error: Error) => toast({ title: "Couldn't reserve bed", description: error.message, variant: "destructive" }) })}><BedDouble className="mr-2 h-4 w-4" />Reserve bed</Button>
            </div>
            {prospect?.stage === "reserved" && (
              <Button disabled={startWorkspace.isPending} onClick={() => prospect && startWorkspace.mutate(prospect.id, { onSuccess: id => { toast({ title: "Move-in workspace created" }); window.location.href = `/app/admissions/move-ins/${id}`; }, onError: (error: Error) => toast({ title: "Couldn't start move-in", description: error.message, variant: "destructive" }) })}><ClipboardList className="mr-2 h-4 w-4" />Open move-in workspace</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({ open, onClose, facilityId }: { open: boolean; onClose: () => void; facilityId: string }) {
  const { toast } = useToast();
  const create = useCreateRoomWithBeds();
  const [building, setBuilding] = useState("Main Building");
  const [unit, setUnit] = useState("");
  const [room, setRoom] = useState("");
  const [roomType, setRoomType] = useState("private");
  const [beds, setBeds] = useState("1");
  const [restriction, setRestriction] = useState("none");
  const [capacity, setCapacity] = useState("");
  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add room and beds</DialogTitle><DialogDescription>Residential inventory is separate from scheduling units.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Building *</Label><Input value={building} onChange={event => setBuilding(event.target.value)} /></div>
          <div className="space-y-1"><Label>Residential unit</Label><Input value={unit} onChange={event => setUnit(event.target.value)} placeholder="e.g. First Floor" /></div>
          <div className="space-y-1"><Label>Room number *</Label><Input value={room} onChange={event => setRoom(event.target.value)} /></div>
          <div className="space-y-1"><Label>Room type</Label><Select value={roomType} onValueChange={setRoomType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["private", "semi_private", "shared", "suite", "studio", "other"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Bed count</Label><Input type="number" min={1} max={8} value={beds} onChange={event => setBeds(event.target.value)} /></div>
          <div className="space-y-1"><Label>Compatibility restriction</Label><Select value={restriction} onValueChange={setRestriction}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["none", "female", "male", "compatibility_review"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>Building licensed capacity</Label><Input type="number" min={0} value={capacity} onChange={event => setCapacity(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!facilityId || !building.trim() || !room.trim() || create.isPending} onClick={() => create.mutate({ facilityId, buildingName: building, unitName: unit, roomNumber: room, roomType, bedCount: Number(beds), genderRestriction: restriction, licensedCapacity: capacity ? Number(capacity) : null }, { onSuccess: () => { toast({ title: "Room inventory added" }); onClose(); }, onError: (error: Error) => toast({ title: "Couldn't add room", description: error.message, variant: "destructive" }) })}>Add room</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdmissionOperations() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const [facilityId, setFacilityId] = useState("all");
  const [stage, setStage] = useState("active");
  const [search, setSearch] = useState("");
  const [showProspect, setShowProspect] = useState(false);
  const [showRoom, setShowRoom] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState<AdmissionProspectWithRelations | null>(null);
  const [censusResidentId, setCensusResidentId] = useState("");
  const [censusTarget, setCensusTarget] = useState("temporarily_out");
  const [censusReason, setCensusReason] = useState("");

  const { data: facilities } = useListFacilities({ organizationId });
  const prospects = useListAdmissionProspects({ organizationId, facilityId: facilityId === "all" ? undefined : facilityId });
  const sources = useListReferralSources(organizationId);
  const beds = useListFacilityBeds({ organizationId, facilityId: facilityId === "all" ? undefined : facilityId });
  const workspaces = useListMoveInWorkspaces({ organizationId, facilityId: facilityId === "all" ? undefined : facilityId });
  const residents = useListResidents({ facilityId: facilityId === "all" ? undefined : facilityId });
  const censusEvents = useListCensusEvents({ organizationId, facilityId: facilityId === "all" ? undefined : facilityId });
  const createSource = useCreateReferralSource();
  const setBed = useSetBedAvailability();
  const transitionCensus = useTransitionResidentCensus();

  const activeStages = ["prospect", "applicant", "approved", "waitlisted", "reserved"];
  const filteredProspects = (prospects.data ?? []).filter(prospect => {
    if (stage === "active" && !activeStages.includes(prospect.stage)) return false;
    if (stage !== "all" && stage !== "active" && prospect.stage !== stage) return false;
    if (search && !`${prospect.first_name} ${prospect.last_name} ${prospect.referral_source?.name ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const availableBeds = (beds.data ?? []).filter(bed => bed.status === "available");
  const openWorkspaces = (workspaces.data ?? []).filter(workspace => ["active", "ready"].includes(workspace.state));
  const activeResidents = (residents.data ?? []).filter(resident => resident.status === "active");
  const occupiedBeds = (beds.data ?? []).filter(bed => bed.status === "occupied").length;
  const licensedCapacity = useMemo(() => {
    const buildings = new Map<string, number>();
    for (const bed of beds.data ?? []) if (bed.room?.building) buildings.set(bed.room.building.id, bed.room.building.licensed_capacity);
    return [...buildings.values()].reduce((sum, value) => sum + value, 0);
  }, [beds.data]);
  const metrics: { label: string; value: string | number; icon: LucideIcon; className: string }[] = [
    { label: "Active leads", value: filteredProspects.length, icon: Users, className: "text-blue-600" },
    { label: "Approved", value: (prospects.data ?? []).filter(item => item.stage === "approved").length, icon: CheckCircle2, className: "text-emerald-600" },
    { label: "Available beds", value: availableBeds.length, icon: BedDouble, className: "text-emerald-600" },
    { label: "Open move-ins", value: openWorkspaces.length, icon: ClipboardList, className: "text-purple-600" },
    { label: "Census / capacity", value: `${activeResidents.length} / ${licensedCapacity || (beds.data ?? []).length}`, icon: Hospital, className: "text-cyan-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><DoorOpen className="h-6 w-6" />Admissions, Census & Rooms</h1>
          <p className="text-muted-foreground">Referral conversion, approval, room reservation, move-in readiness, and temporal census management.</p>
        </div>
        {canManage && <div className="flex gap-2"><Button variant="outline" onClick={() => setShowRoom(true)} disabled={facilityId === "all"}><Building2 className="mr-2 h-4 w-4" />Add room</Button><Button onClick={() => setShowProspect(true)} disabled={facilityId === "all"}><UserRoundPlus className="mr-2 h-4 w-4" />New inquiry</Button></div>}
      </div>

      <Card><CardContent className="grid gap-2 pt-6 sm:grid-cols-3"><Select value={facilityId} onValueChange={setFacilityId}><SelectTrigger><SelectValue placeholder="All facilities" /></SelectTrigger><SelectContent><SelectItem value="all">All facilities</SelectItem>{facilities?.map(facility => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select><Select value={stage} onValueChange={setStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active pipeline</SelectItem><SelectItem value="all">All stages</SelectItem>{STAGES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search prospect or referral source" /></CardContent></Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(({ label, value, icon: Icon, className }) => <Card key={label}><CardContent className="flex items-center gap-3 pt-6"><Icon className={`h-7 w-7 ${className}`} /><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div></CardContent></Card>)}
      </div>

      <Tabs defaultValue="pipeline">
        <TabsList className="h-auto flex-wrap"><TabsTrigger value="pipeline">Referral pipeline</TabsTrigger><TabsTrigger value="inventory">Rooms & beds</TabsTrigger><TabsTrigger value="moveins">Move-in workspaces</TabsTrigger><TabsTrigger value="census">Census history</TabsTrigger></TabsList>
        <TabsContent value="pipeline" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Admission pipeline</CardTitle><CardDescription>Prospect through review, reservation, and admission with referral-source attribution.</CardDescription></CardHeader>
            <CardContent>
              {prospects.isError ? <QueryError what="admission prospects" error={prospects.error} onRetry={() => prospects.refetch()} /> : !filteredProspects.length ? <p className="py-10 text-center text-sm text-muted-foreground">No prospects match this view.</p> : (
                <div className="overflow-x-auto"><table className="data-table min-w-[900px]"><thead><tr><th>Prospect</th><th>Facility</th><th>Referral</th><th>Clinical</th><th>Financial</th><th>Expected move-in</th><th>Stage</th><th /></tr></thead><tbody>{filteredProspects.map(prospect => <tr key={prospect.id}><td><p className="font-medium">{prospect.first_name} {prospect.last_name}</p><p className="text-xs text-muted-foreground">Inquiry {new Date(prospect.inquiry_date).toLocaleDateString()}</p></td><td>{prospect.facility?.name}</td><td>{prospect.referral_source?.name ?? "Direct inquiry"}</td><td><Badge variant="outline">{humanize(prospect.clinical_review_status)}</Badge></td><td><Badge variant="outline">{humanize(prospect.financial_review_status)}</Badge></td><td>{prospect.expected_move_in_date ? new Date(`${prospect.expected_move_in_date}T00:00:00`).toLocaleDateString() : "—"}</td><td><Badge variant="outline" className={`border-0 ${STAGE_CLASS[prospect.stage]}`}>{humanize(prospect.stage)}</Badge></td><td>{canManage && <Button size="sm" variant="outline" onClick={() => setSelectedProspect(prospect)}>Review <ChevronRight className="h-4 w-4" /></Button>}</td></tr>)}</tbody></table></div>
              )}
              {canManage && organizationId && (
                <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
                  <div className="space-y-1"><Label className="text-xs">Quick-add referral source</Label><Input id="quick-referral-source" placeholder="e.g. Regional Hospital" className="w-64" /></div>
                  <Button variant="outline" onClick={() => { const input = document.getElementById("quick-referral-source") as HTMLInputElement | null; if (!input?.value.trim()) return; createSource.mutate({ organizationId, name: input.value.trim(), sourceType: "other" }, { onSuccess: () => { toast({ title: "Referral source added" }); input.value = ""; } }); }}>Add source</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <Card><CardHeader><CardTitle>Residential room and bed inventory</CardTitle><CardDescription>{occupiedBeds} occupied · {availableBeds.length} available · licensed capacity {licensedCapacity || "not set"}. QR identifiers support room/asset workflows.</CardDescription></CardHeader><CardContent>{beds.isError ? <QueryError what="bed inventory" error={beds.error} onRetry={() => beds.refetch()} /> : !(beds.data ?? []).length ? <p className="py-10 text-center text-sm text-muted-foreground">Select a facility and add its first room.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(beds.data ?? []).map(bed => <div key={bed.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{bed.room?.building?.name} · Room {bed.room?.room_number}</p><p className="text-sm text-muted-foreground">{humanize(bed.room?.room_type ?? "")} · Bed {bed.bed_label}{bed.room?.unit ? ` · ${bed.room.unit.name}` : ""}</p></div><Badge variant="outline" className={`border-0 ${BED_CLASS[bed.status]}`}>{humanize(bed.status)}</Badge></div><p className="mt-2 font-mono text-xs text-muted-foreground">{bed.qr_code}</p>{bed.prospect && <p className="mt-2 text-sm">Reserved: {bed.prospect.first_name} {bed.prospect.last_name}</p>}{bed.resident && <p className="mt-2 text-sm">Resident: {bed.resident.first_name} {bed.resident.last_name}</p>}{canManage && ["available", "temporarily_unavailable", "maintenance_hold"].includes(bed.status) && <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setBed.mutate({ bedId: bed.id, status: bed.status === "available" ? "maintenance_hold" : "available", holdReason: bed.status === "available" ? "Maintenance review" : undefined }, { onSuccess: () => toast({ title: bed.status === "available" ? "Bed placed on maintenance hold" : "Bed returned to available" }) })}>{bed.status === "available" ? "Maintenance hold" : "Make available"}</Button></div>}</div>)}</div>}</CardContent></Card>
        </TabsContent>

        <TabsContent value="moveins" className="mt-4">
          <Card><CardHeader><CardTitle>Move-in coordinator dashboard</CardTitle><CardDescription>Documents, signatures, clinical/financial approvals, room readiness, transportation, vendor readiness, family uploads, guest signing, and final admission.</CardDescription></CardHeader><CardContent>{workspaces.isError ? <QueryError what="move-in workspaces" error={workspaces.error} onRetry={() => workspaces.refetch()} /> : !(workspaces.data ?? []).length ? <p className="py-10 text-center text-sm text-muted-foreground">Reserve a bed for an approved prospect to start a move-in workspace.</p> : <div className="space-y-3">{(workspaces.data ?? []).map(workspace => { const ready = workspace.tasks.filter(task => ["completed", "approved"].includes(task.state) || (task.state === "exception" && task.approved_at)).length; return <div key={workspace.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_180px_180px_auto] md:items-center"><div><p className="font-semibold">{workspace.resident?.first_name} {workspace.resident?.last_name}</p><p className="text-sm text-muted-foreground">{workspace.facility?.name} · Room {workspace.resident?.room ?? "—"}</p></div><div><p className="text-sm font-medium">Target {new Date(`${workspace.target_move_in_date}T00:00:00`).toLocaleDateString()}</p><p className="text-xs text-muted-foreground">{ready} of {workspace.tasks.length} tasks ready</p></div><Badge variant="outline">{humanize(workspace.state)}</Badge><Button asChild size="sm"><Link href={`/app/admissions/move-ins/${workspace.id}`}>Open workspace <ChevronRight className="h-4 w-4" /></Link></Button></div>; })}</div>}</CardContent></Card>
        </TabsContent>

        <TabsContent value="census" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
            <Card><CardHeader><CardTitle>Current census</CardTitle><CardDescription>Admitted, temporarily out, hospital leave, discharged, and deceased states.</CardDescription></CardHeader><CardContent className="space-y-3">{(residents.data ?? []).map(resident => <div key={resident.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><p className="font-medium">{resident.first_name} {resident.last_name}</p><p className="text-xs text-muted-foreground">Room {resident.room ?? "—"}</p></div><Badge variant="outline">{humanize(resident.status)}</Badge></div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle>Census and transfer history</CardTitle><CardDescription>Append-only admission, leave, return, transfer, discharge, and death events.</CardDescription></CardHeader><CardContent className="space-y-3">{canManage && <div className="grid gap-2 border-b pb-4 sm:grid-cols-2"><Select value={censusResidentId} onValueChange={setCensusResidentId}><SelectTrigger><SelectValue placeholder="Select resident" /></SelectTrigger><SelectContent>{(residents.data ?? []).filter(r => !["reserved", "discharged", "deceased"].includes(r.status)).map(resident => <SelectItem key={resident.id} value={resident.id}>{resident.first_name} {resident.last_name}</SelectItem>)}</SelectContent></Select><Select value={censusTarget} onValueChange={setCensusTarget}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CENSUS_STATUSES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select><Input className="sm:col-span-2" value={censusReason} onChange={event => setCensusReason(event.target.value)} placeholder="Reason for census change" /><Button className="sm:col-span-2" disabled={!censusResidentId || censusReason.trim().length < 3 || transitionCensus.isPending} onClick={() => transitionCensus.mutate({ residentId: censusResidentId, targetStatus: censusTarget, reason: censusReason }, { onSuccess: () => { toast({ title: "Census updated" }); setCensusReason(""); }, onError: (error: Error) => toast({ title: "Couldn't update census", description: error.message, variant: "destructive" }) })}><RefreshCw className="mr-2 h-4 w-4" />Record census change</Button></div>}{(censusEvents.data ?? []).slice(0, 30).map(event => <div key={event.id} className="flex justify-between gap-3 border-b pb-2 text-sm"><div><p className="font-medium">{event.resident?.first_name} {event.resident?.last_name} · {humanize(event.event_type)}</p><p className="text-xs text-muted-foreground">{event.reason ?? `${humanize(event.prior_status ?? "")} → ${humanize(event.resulting_status)}`}</p></div><span className="shrink-0 text-xs text-muted-foreground">{new Date(event.effective_at).toLocaleString()}</span></div>)}</CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>

      <ProspectDialog open={showProspect} onClose={() => setShowProspect(false)} facilityId={facilityId === "all" ? "" : facilityId} sources={sources.data ?? []} />
      <ProspectReviewDialog key={selectedProspect?.id} prospect={selectedProspect} availableBeds={availableBeds} onClose={() => setSelectedProspect(null)} />
      <RoomDialog open={showRoom} onClose={() => setShowRoom(false)} facilityId={facilityId === "all" ? "" : facilityId} />
    </div>
  );
}
