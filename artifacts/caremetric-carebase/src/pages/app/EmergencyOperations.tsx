import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  Bus,
  ChevronRight,
  ClipboardCheck,
  Droplets,
  FileCheck2,
  Fuel,
  Plus,
  Radio,
  ShieldCheck,
  Siren,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  useAddEmergencyInventoryItem,
  useAddEmergencyResource,
  useAddEmergencyStaffAssignment,
  useEmergencyEvents,
  useEmergencyReadiness,
  usePublishEmergencyPlanVersion,
  useStartEmergencyEvent,
  useUpsertResidentEvacuationProfile,
} from "@/hooks/useEmergencyOperations";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const human = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localDateTime = () => {
  const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return value.toISOString().slice(0, 16);
};

type DialogName = "plan" | "event" | "profile" | "resource" | "inventory" | "assignment" | null;

export default function EmergencyOperations() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const facilities = useListFacilities({ organizationId });
  const [facilityId, setFacilityId] = useState("");
  const [dialog, setDialog] = useState<DialogName>(null);
  const readiness = useEmergencyReadiness(facilityId);
  const events = useEmergencyEvents({ organizationId, facilityId: facilityId || undefined });
  const employees = useListEmployees({ organizationId, facilityId, status: "active" }, { enabled: Boolean(facilityId) });
  const profiles = useListProfiles({ organizationId });

  const publishPlan = usePublishEmergencyPlanVersion();
  const startEvent = useStartEmergencyEvent();
  const upsertProfile = useUpsertResidentEvacuationProfile();
  const addResource = useAddEmergencyResource();
  const addInventory = useAddEmergencyInventoryItem();
  const addAssignment = useAddEmergencyStaffAssignment();

  const [planTitle, setPlanTitle] = useState("All-Hazards Emergency Plan");
  const [planEffectiveDate, setPlanEffectiveDate] = useState(toLocalIsoDate());
  const [planSummary, setPlanSummary] = useState("");
  const [evacuationProcedure, setEvacuationProcedure] = useState("");
  const [accountabilityProcedure, setAccountabilityProcedure] = useState("");
  const [notificationProcedure, setNotificationProcedure] = useState("");
  const [continuityProcedure, setContinuityProcedure] = useState("");

  const [eventMode, setEventMode] = useState("drill");
  const [eventType, setEventType] = useState("fire");
  const [eventStartedAt, setEventStartedAt] = useState(localDateTime());
  const [eventSummary, setEventSummary] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [assemblyPoint, setAssemblyPoint] = useState("");
  const [commanderId, setCommanderId] = useState(user?.id ?? "");

  const [residentId, setResidentId] = useState("");
  const [assistanceLevel, setAssistanceLevel] = useState("independent");
  const [mobilityNeeds, setMobilityNeeds] = useState("");
  const [transportationNeeds, setTransportationNeeds] = useState("");
  const [evacuationMethod, setEvacuationMethod] = useState("");
  const [requiredEquipment, setRequiredEquipment] = useState("");
  const [communicationNeeds, setCommunicationNeeds] = useState("");
  const [relocationNotes, setRelocationNotes] = useState("");
  const [profileNotes, setProfileNotes] = useState("");

  const [resourceType, setResourceType] = useState("relocation_site");
  const [resourceName, setResourceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState("");
  const [contractReference, setContractReference] = useState("");
  const [availabilityNotes, setAvailabilityNotes] = useState("");

  const [inventoryType, setInventoryType] = useState("water");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [minimumQuantity, setMinimumQuantity] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("ready");
  const [inventoryLocation, setInventoryLocation] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [emergencyRole, setEmergencyRole] = useState("resident_accountability");
  const [responsibility, setResponsibility] = useState("");
  const [isBackup, setIsBackup] = useState(false);

  const activeEvents = events.data?.filter((event) => event.status === "active" || event.status === "stabilized") ?? [];
  const profileByResident = useMemo(
    () => new Map((readiness.data?.profiles ?? []).map((profile) => [profile.resident_id, profile])),
    [readiness.data?.profiles],
  );
  const missingProfiles = (readiness.data?.residents ?? []).filter((resident) => !profileByResident.has(resident.id));
  const lowInventory = (readiness.data?.inventory ?? []).filter(
    (item) => item.status !== "ready" || Number(item.quantity) < Number(item.minimum_quantity),
  );
  const relocationSites = (readiness.data?.resources ?? []).filter(
    (resource) => resource.resource_type === "relocation_site" && resource.is_active,
  );

  const mutationError = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: "destructive" });

  const openProfile = (id: string) => {
    const existing = profileByResident.get(id);
    setResidentId(id);
    setAssistanceLevel(existing?.assistance_level ?? "independent");
    setMobilityNeeds(existing?.mobility_needs ?? "");
    setTransportationNeeds(existing?.transportation_needs ?? "");
    setEvacuationMethod(existing?.evacuation_method ?? "");
    setRequiredEquipment(existing?.required_equipment ?? "");
    setCommunicationNeeds(existing?.communication_needs ?? "");
    setRelocationNotes(existing?.preferred_relocation_notes ?? "");
    setProfileNotes(existing?.notes ?? "");
    setDialog("profile");
  };

  const submitPlan = () =>
    publishPlan.mutate(
      {
        facilityId,
        title: planTitle,
        effectiveDate: planEffectiveDate,
        changeSummary: planSummary,
        planSnapshot: {
          evacuationProcedure,
          accountabilityProcedure,
          notificationProcedure,
          continuityProcedure,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Emergency plan version approved" });
          setDialog(null);
          setPlanSummary("");
        },
        onError: mutationError("Could not publish emergency plan"),
      },
    );

  const submitEvent = () =>
    startEvent.mutate(
      {
        facilityId,
        eventMode,
        eventType,
        startedAt: new Date(eventStartedAt || Date.now()).toISOString(),
        summary: eventSummary,
        locationDescription: eventLocation,
        assemblyPoint,
        incidentCommander: commanderId,
      },
      {
        onSuccess: (id) => {
          toast({ title: `${human(eventMode)} activated`, description: "Resident and staff rosters were snapshotted." });
          setDialog(null);
          window.location.href = `/app/emergency/${id}`;
        },
        onError: mutationError("Could not activate emergency event"),
      },
    );

  const submitProfile = () =>
    upsertProfile.mutate(
      {
        residentId,
        assistanceLevel,
        mobilityNeeds,
        transportationNeeds,
        evacuationMethod,
        requiredEquipment,
        communicationNeeds,
        preferredRelocationNotes: relocationNotes,
        notes: profileNotes,
      },
      {
        onSuccess: () => {
          toast({ title: "Evacuation profile reviewed" });
          setDialog(null);
        },
        onError: mutationError("Could not save evacuation profile"),
      },
    );

  const submitResource = () =>
    organizationId && addResource.mutate(
      {
        organizationId,
        facilityId,
        resourceType,
        name: resourceName,
        contactName,
        phone,
        email,
        address,
        capacity: capacity ? Number(capacity) : undefined,
        contractReference,
        availabilityNotes,
      },
      {
        onSuccess: () => {
          toast({ title: "Emergency resource added" });
          setDialog(null);
          setResourceName("");
        },
        onError: mutationError("Could not add emergency resource"),
      },
    );

  const submitInventory = () =>
    organizationId && addInventory.mutate(
      {
        organizationId,
        facilityId,
        inventoryType,
        itemName,
        quantity: Number(quantity),
        unit,
        minimumQuantity: Number(minimumQuantity),
        expirationDate: expirationDate || undefined,
        status: inventoryStatus,
        location: inventoryLocation,
        notes: "",
        checkedBy: user?.id,
      },
      {
        onSuccess: () => {
          toast({ title: "Emergency inventory recorded" });
          setDialog(null);
          setItemName("");
        },
        onError: mutationError("Could not add emergency inventory"),
      },
    );

  const submitAssignment = () =>
    organizationId && addAssignment.mutate(
      {
        organizationId,
        facilityId,
        employeeId,
        emergencyRole,
        responsibility,
        isBackup,
        createdBy: user?.id,
      },
      {
        onSuccess: () => {
          toast({ title: "Emergency staff assignment added" });
          setDialog(null);
          setResponsibility("");
        },
        onError: mutationError("Could not add staff assignment"),
      },
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Siren className="h-6 w-6" /> Emergency Operations
          </h1>
          <p className="text-muted-foreground">
            Plan readiness, live command, evacuation and accountability, communications, and after-action follow-through.
          </p>
        </div>
        {canManage && facilityId && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDialog("plan")}>
              <FileCheck2 className="mr-2 h-4 w-4" /> New plan version
            </Button>
            <Button onClick={() => setDialog("event")}>
              <Siren className="mr-2 h-4 w-4" /> Activate event or drill
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <Select value={facilityId} onValueChange={setFacilityId}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>
              {facilities.data?.filter((facility) => facility.is_active).map((facility) => (
                <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {facilityId && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              [Siren, activeEvents.length, "Active events"],
              [FileCheck2, readiness.data?.plan?.current_version?.version_number ? `v${readiness.data.plan.current_version.version_number}` : "Missing", "Approved plan"],
              [Users, missingProfiles.length, "Profiles missing"],
              [AlertTriangle, lowInventory.length, "Supply exceptions"],
              [Bus, relocationSites.length, "Relocation sites"],
              [ShieldCheck, readiness.data?.assignments.filter((assignment) => assignment.is_active).length ?? 0, "Staff assignments"],
            ].map(([Icon, value, label]) => {
              const MetricIcon = Icon as typeof Siren;
              return (
                <Card key={String(label)}>
                  <CardContent className="pt-5">
                    <MetricIcon className="mb-2 h-4 w-4 text-muted-foreground" />
                    <p className="text-2xl font-bold">{String(value)}</p>
                    <p className="text-xs text-muted-foreground">{String(label)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Tabs defaultValue="events" className="space-y-4">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="events">Events & drills</TabsTrigger>
              <TabsTrigger value="plans">Plan & resident assistance</TabsTrigger>
              <TabsTrigger value="resources">Staff, vendors & supplies</TabsTrigger>
            </TabsList>

            <TabsContent value="events">
              <Card>
                <CardHeader>
                  <CardTitle>Emergency event history</CardTitle>
                  <CardDescription>Each activation preserves its plan version and live accountability documentation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!events.data?.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No emergency events or drills recorded.</p>
                  ) : events.data.map((event) => (
                    <div key={event.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_180px_130px_auto] md:items-center">
                      <div>
                        <p className="font-semibold">{event.event_number} · {human(event.event_type)}</p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{event.summary}</p>
                      </div>
                      <div className="text-sm">
                        <p>{new Date(event.started_at).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Plan v{event.plan_version?.version_number ?? "—"}</p>
                      </div>
                      <div className="flex gap-2"><Badge variant="outline">{human(event.event_mode)}</Badge><Badge>{human(event.status)}</Badge></div>
                      <Button asChild size="sm"><Link href={`/app/emergency/${event.id}`}>Open <ChevronRight className="h-4 w-4" /></Link></Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="plans" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Version-controlled emergency plan</CardTitle>
                  <CardDescription>Every event records the exact approved plan version in force when it was declared.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!readiness.data?.versions.length ? <p className="text-sm text-muted-foreground">No approved emergency plan version.</p> : readiness.data.versions.map((version) => (
                    <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
                      <div><p className="font-medium">Version {version.version_number} · effective {new Date(`${version.effective_date}T00:00:00`).toLocaleDateString()}</p><p className="text-sm text-muted-foreground">{version.change_summary}</p></div>
                      {readiness.data?.plan?.current_version_id === version.id && <Badge>Current</Badge>}
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Resident evacuation-assistance profiles</CardTitle>
                  <CardDescription>Mobility, transportation, equipment, communication, and relocation needs are snapshotted at activation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {readiness.data?.residents.map((resident) => {
                    const profile = profileByResident.get(resident.id);
                    return (
                      <div key={resident.id} className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_180px_auto] sm:items-center">
                        <div><p className="font-medium">{resident.first_name} {resident.last_name}</p><p className="text-xs text-muted-foreground">Room {resident.room || "—"} · {profile?.mobility_needs || "Mobility needs not reviewed"}</p></div>
                        <Badge variant={profile ? "outline" : "destructive"}>{profile ? human(profile.assistance_level) : "Profile missing"}</Badge>
                        {canManage && <Button variant="outline" size="sm" onClick={() => openProfile(resident.id)}>{profile ? "Review" : "Create"}</Button>}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="resources" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-3">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Emergency staff</CardTitle><CardDescription>Primary and backup command responsibilities.</CardDescription></CardHeader>
                  <CardContent className="space-y-2">
                    {readiness.data?.assignments.map((assignment) => (
                      <div key={assignment.id} className="rounded border p-3 text-sm"><p className="font-medium">{assignment.employee?.first_name} {assignment.employee?.last_name}</p><p>{human(assignment.emergency_role)}{assignment.is_backup ? " · Backup" : ""}</p><p className="text-muted-foreground">{assignment.responsibility}</p></div>
                    ))}
                    {canManage && <Button className="w-full" variant="outline" onClick={() => setDialog("assignment")}><Plus className="mr-2 h-4 w-4" /> Add assignment</Button>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5" /> Contacts & relocation</CardTitle><CardDescription>Sites, transportation, utilities, eMAR, and emergency contacts.</CardDescription></CardHeader>
                  <CardContent className="space-y-2">
                    {readiness.data?.resources.map((resource) => (
                      <div key={resource.id} className="rounded border p-3 text-sm"><div className="flex justify-between gap-2"><p className="font-medium">{resource.name}</p><Badge variant="outline">{human(resource.resource_type)}</Badge></div><p className="text-muted-foreground">{resource.phone || resource.email || resource.address || "No contact details"}</p></div>
                    ))}
                    {canManage && <Button className="w-full" variant="outline" onClick={() => setDialog("resource")}><Plus className="mr-2 h-4 w-4" /> Add resource</Button>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Fuel className="h-5 w-5" /> Supplies & fuel</CardTitle><CardDescription>Food, water, generator fuel, medication continuity, and emergency inventory.</CardDescription></CardHeader>
                  <CardContent className="space-y-2">
                    {readiness.data?.inventory.map((item) => (
                      <div key={item.id} className="rounded border p-3 text-sm"><div className="flex justify-between gap-2"><p className="font-medium">{item.item_name}</p><Badge variant={item.status === "ready" ? "outline" : "destructive"}>{human(item.status)}</Badge></div><p>{String(item.quantity)} {item.unit} · minimum {String(item.minimum_quantity)}</p><p className="text-muted-foreground">{item.location || "Location not recorded"}</p></div>
                    ))}
                    {canManage && <Button className="w-full" variant="outline" onClick={() => setDialog("inventory")}><Plus className="mr-2 h-4 w-4" /> Add inventory</Button>}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={dialog === "plan"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Approve a new emergency plan version</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Plan title</Label><Input value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} /></div>
            <div className="space-y-1"><Label>Effective date</Label><Input type="date" value={planEffectiveDate} onChange={(event) => setPlanEffectiveDate(event.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Change summary</Label><Textarea value={planSummary} onChange={(event) => setPlanSummary(event.target.value)} /></div>
            <div className="space-y-1"><Label>Evacuation procedure</Label><Textarea value={evacuationProcedure} onChange={(event) => setEvacuationProcedure(event.target.value)} /></div>
            <div className="space-y-1"><Label>Accountability procedure</Label><Textarea value={accountabilityProcedure} onChange={(event) => setAccountabilityProcedure(event.target.value)} /></div>
            <div className="space-y-1"><Label>Family/designated-person notification</Label><Textarea value={notificationProcedure} onChange={(event) => setNotificationProcedure(event.target.value)} /></div>
            <div className="space-y-1"><Label>Utilities, transportation & medication continuity</Label><Textarea value={continuityProcedure} onChange={(event) => setContinuityProcedure(event.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submitPlan} disabled={!planSummary || publishPlan.isPending}>Approve version</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "event"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Activate emergency command</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={eventMode} onValueChange={setEventMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="drill">Drill</SelectItem><SelectItem value="actual">Actual event</SelectItem></SelectContent></Select>
            <Select value={eventType} onValueChange={setEventType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["fire","severe_weather","power_outage","water_outage","hvac_outage","evacuation","shelter_in_place","missing_person","infectious_disease","transportation_disruption","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select>
            <div className="space-y-1"><Label>Started at</Label><Input type="datetime-local" value={eventStartedAt} onChange={(event) => setEventStartedAt(event.target.value)} /></div>
            <div className="space-y-1"><Label>Incident commander</Label><Select value={commanderId} onValueChange={setCommanderId}><SelectTrigger><SelectValue placeholder="Select commander" /></SelectTrigger><SelectContent>{profiles.data?.filter((profile) => profile.is_active).map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1 sm:col-span-2"><Label>Situation summary</Label><Textarea value={eventSummary} onChange={(event) => setEventSummary(event.target.value)} /></div>
            <div className="space-y-1"><Label>Location</Label><Input value={eventLocation} onChange={(event) => setEventLocation(event.target.value)} /></div>
            <div className="space-y-1"><Label>Assembly point</Label><Input value={assemblyPoint} onChange={(event) => setAssemblyPoint(event.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Activation snapshots all active residents, their assistance profiles, scheduled staff, and standing emergency assignments.</p>
          <DialogFooter><Button onClick={submitEvent} disabled={!eventSummary || startEvent.isPending}>Activate command</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "profile"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Resident evacuation-assistance profile</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Assistance level</Label><Select value={assistanceLevel} onValueChange={setAssistanceLevel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["independent","cueing","one_person","two_person","full_assistance"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Mobility needs</Label><Input value={mobilityNeeds} onChange={(event) => setMobilityNeeds(event.target.value)} /></div>
            <div className="space-y-1"><Label>Transportation needs</Label><Input value={transportationNeeds} onChange={(event) => setTransportationNeeds(event.target.value)} /></div>
            <div className="space-y-1"><Label>Evacuation method</Label><Input value={evacuationMethod} onChange={(event) => setEvacuationMethod(event.target.value)} /></div>
            <div className="space-y-1"><Label>Required equipment</Label><Input value={requiredEquipment} onChange={(event) => setRequiredEquipment(event.target.value)} /></div>
            <div className="space-y-1"><Label>Communication needs</Label><Input value={communicationNeeds} onChange={(event) => setCommunicationNeeds(event.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Preferred relocation / transportation notes</Label><Textarea value={relocationNotes} onChange={(event) => setRelocationNotes(event.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Review notes</Label><Textarea value={profileNotes} onChange={(event) => setProfileNotes(event.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submitProfile} disabled={upsertProfile.isPending}>Save reviewed profile</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "resource"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Add emergency resource</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={resourceType} onValueChange={setResourceType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["relocation_site","transportation_vendor","utility_contact","medication_emar_vendor","emergency_service","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Resource name" value={resourceName} onChange={(event) => setResourceName(event.target.value)} />
            <Input placeholder="Contact name" value={contactName} onChange={(event) => setContactName(event.target.value)} />
            <Input placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
            <Input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <Input placeholder="Address" value={address} onChange={(event) => setAddress(event.target.value)} />
            <Input type="number" placeholder="Capacity" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
            <Input placeholder="Contract reference" value={contractReference} onChange={(event) => setContractReference(event.target.value)} />
            <Textarea className="sm:col-span-2" placeholder="Availability and activation notes" value={availabilityNotes} onChange={(event) => setAvailabilityNotes(event.target.value)} />
          </div>
          <DialogFooter><Button onClick={submitResource} disabled={!resourceName || addResource.isPending}>Add resource</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "inventory"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>Add emergency inventory</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={inventoryType} onValueChange={setInventoryType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["food","water","generator_fuel","medication_continuity","batteries","first_aid","sanitation","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Item name" value={itemName} onChange={(event) => setItemName(event.target.value)} />
            <Input type="number" placeholder="Quantity" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <Input placeholder="Unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
            <Input type="number" placeholder="Minimum quantity" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} />
            <Input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} />
            <Select value={inventoryStatus} onValueChange={setInventoryStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["ready","low","expired","unavailable"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Storage location" value={inventoryLocation} onChange={(event) => setInventoryLocation(event.target.value)} />
          </div>
          <DialogFooter><Button onClick={submitInventory} disabled={!itemName || !quantity || !unit || addInventory.isPending}>Add inventory</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "assignment"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>Add emergency staff assignment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger><SelectContent>{employees.data?.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name} · {employee.job_title}</SelectItem>)}</SelectContent></Select>
            <Select value={emergencyRole} onValueChange={setEmergencyRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["incident_commander","resident_accountability","staff_accountability","evacuation_lead","transportation_lead","communications_lead","medication_continuity","utilities_lead","logistics","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select>
            <Textarea placeholder="Responsibility" value={responsibility} onChange={(event) => setResponsibility(event.target.value)} />
            <Button type="button" variant={isBackup ? "default" : "outline"} onClick={() => setIsBackup((value) => !value)}>{isBackup ? "Backup assignment" : "Primary assignment"}</Button>
          </div>
          <DialogFooter><Button onClick={submitAssignment} disabled={!employeeId || !responsibility || addAssignment.isPending}>Add assignment</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
