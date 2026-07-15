import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Car, CheckCircle2, Clock3, MapPin, Plus, UserRound } from "lucide-react";
import { useAuth, hasRole } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListResidents } from "@/hooks/useResidents";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListProfiles } from "@/hooks/useProfiles";
import { useResidentNavigationContext } from "@/hooks/useResidentNavigationContext";
import {
  type ResidentServiceCalendarEventView,
  useCreateResidentServiceCalendarEvent,
  useFacilityTransportVehicles,
  useRecordResidentServiceCalendarOutcome,
  useResidentServicesCalendar,
  useRescheduleResidentServiceCalendarEvent,
  useSaveFacilityTransportVehicle,
} from "@/hooks/useResidentServicesCalendar";
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
import { toDateTimeLocal, toLocalIsoDate } from "@/lib/dateUtils";

const EVENT_TYPES = [
  "medical_appointment", "dental_appointment", "behavioral_health_appointment",
  "laboratory_visit", "therapy", "community_service", "family_visit",
  "transportation", "facility_activity", "outside_activity",
];
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000);

function Field({ label, children, span = false }: { label: string; children: React.ReactNode; span?: boolean }) {
  return <div className={`space-y-1 ${span ? "sm:col-span-2" : ""}`}><Label>{label}</Label>{children}</div>;
}

function Choice({ value, onChange, values, placeholder, disabled }: { value: string; onChange: (value: string) => void; values: Array<string | { value: string; label: string }>; placeholder?: string; disabled?: boolean }) {
  return <Select value={value || undefined} onValueChange={onChange} disabled={disabled}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{values.map((item) => { const option = typeof item === "string" ? { value: item, label: human(item) } : item; return <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>; })}</SelectContent></Select>;
}

export default function ResidentServicesCalendar() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = hasRole(user, "platform_admin", "org_admin", "facility_manager");
  const canRecord = !hasRole(user, "auditor");
  const facilities = useListFacilities({ organizationId });
  const { facilityId, residentId, setFacilityId, setResidentId } = useResidentNavigationContext();
  useEffect(() => { if (!facilityId && facilities.data?.length === 1) setFacilityId(facilities.data[0].id); }, [facilityId, facilities.data]);
  const [fromDate, setFromDate] = useState(toLocalIsoDate(addDays(-7)));
  const [throughDate, setThroughDate] = useState(toLocalIsoDate(addDays(30)));
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const residents = useListResidents({ facilityId, status: "active" }, { enabled: !!facilityId });
  const employees = useListEmployees({ facilityId, status: "active", organizationId }, { enabled: !!facilityId });
  const profiles = useListProfiles({ organizationId });
  const vehicles = useFacilityTransportVehicles(facilityId);
  const safeFromDate = fromDate || toLocalIsoDate(addDays(-7));
  const safeThroughDate = throughDate || toLocalIsoDate(addDays(30));
  const events = useResidentServicesCalendar({
    facilityId: facilityId || undefined,
    from: new Date(`${safeFromDate}T00:00:00`).toISOString(),
    through: new Date(`${safeThroughDate}T23:59:59`).toISOString(),
    residentId: residentId || undefined,
    eventType: eventType || undefined,
    status: status || undefined,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [outcomeEvent, setOutcomeEvent] = useState<ResidentServiceCalendarEventView | null>(null);
  const [rescheduleEvent, setRescheduleEvent] = useState<ResidentServiceCalendarEventView | null>(null);
  const grouped = useMemo(() => {
    const groups = new Map<string, ResidentServiceCalendarEventView[]>();
    for (const event of events.data ?? []) {
      const key = toLocalIsoDate(new Date(event.starts_at));
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()];
  }, [events.data]);
  const selectedFacility = facilities.data?.find((facility) => facility.id === facilityId);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="h-6 w-6" />Resident Services Calendar</h1><p className="text-muted-foreground">Appointments, transportation, activities, community and family services, preparation, outcomes, and return follow-up.</p></div>{canManage && <Button disabled={!facilityId} onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Schedule service</Button>}</div>
    <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-3 xl:grid-cols-6"><Field label="Facility"><Choice value={facilityId} onChange={setFacilityId} values={(facilities.data ?? []).map((item) => ({ value: item.id, label: item.name }))} placeholder="Select facility" /></Field><Field label="From"><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label="Through"><Input type="date" value={throughDate} onChange={(event) => setThroughDate(event.target.value)} /></Field><Field label="Resident"><Choice value={residentId} onChange={(value) => setResidentId(value === "all" ? "" : value)} values={[{ value: "all", label: "All residents" }, ...(residents.data ?? []).map((item) => ({ value: item.id, label: `${item.last_name}, ${item.first_name}` }))]} placeholder="All residents" /></Field><Field label="Service type"><Choice value={eventType} onChange={(value) => setEventType(value === "all" ? "" : value)} values={[{ value: "all", label: "All types" }, ...EVENT_TYPES]} placeholder="All types" /></Field><Field label="Status"><Choice value={status} onChange={(value) => setStatus(value === "all" ? "" : value)} values={[{ value: "all", label: "All statuses" }, "scheduled", "completed", "canceled", "no_show"]} placeholder="All statuses" /></Field></CardContent></Card>
    <Tabs defaultValue="agenda" className="space-y-4"><TabsList><TabsTrigger value="agenda"><CalendarDays className="mr-2 h-4 w-4" />Agenda</TabsTrigger><TabsTrigger value="vehicles"><Car className="mr-2 h-4 w-4" />Transportation fleet</TabsTrigger></TabsList>
      <TabsContent value="agenda"><Card><CardHeader><CardTitle>{selectedFacility?.name ?? "Assigned resident services"}</CardTitle><CardDescription>{hasRole(user, "employee") ? "Only events where you are assigned as driver or accompanying staff are shown." : "Calendar events are ordered by service date and time."}</CardDescription></CardHeader><CardContent className="space-y-5">{events.isError ? <p className="text-sm text-destructive">Could not load calendar: {events.error.message}</p> : grouped.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No resident services match this date range.</p> : grouped.map(([day, items]) => <section key={day} className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">{new Date(`${day}T00:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2>{items.map((event) => <EventRow key={event.id} event={event} canManage={canManage} canRecord={canRecord} onOutcome={setOutcomeEvent} onReschedule={setRescheduleEvent} />)}</section>)}</CardContent></Card></TabsContent>
      <TabsContent value="vehicles"><VehicleWorkspace facilityId={facilityId} vehicles={vehicles.data ?? []} canManage={canManage} /></TabsContent>
    </Tabs>
    <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} residents={residents.data ?? []} employees={employees.data ?? []} vehicles={vehicles.data ?? []} />
    <OutcomeDialog event={outcomeEvent} onClose={() => setOutcomeEvent(null)} profiles={profiles.data ?? []} />
    <RescheduleDialog event={rescheduleEvent} onClose={() => setRescheduleEvent(null)} />
  </div>;
}

function EventRow({ event, canManage, canRecord, onOutcome, onReschedule }: { event: ResidentServiceCalendarEventView; canManage: boolean; canRecord: boolean; onOutcome: (event: ResidentServiceCalendarEventView) => void; onReschedule: (event: ResidentServiceCalendarEventView) => void }) {
  const badge = event.status === "scheduled" ? "default" : event.status === "completed" ? "secondary" : "destructive";
  return <div className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[140px_1fr_230px_auto] lg:items-center"><div><p className="font-semibold">{new Date(event.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p><p className="text-xs text-muted-foreground">to {new Date(event.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p></div><div><div className="flex flex-wrap items-center gap-2"><strong>{event.title}</strong><Badge variant={badge}>{human(event.status)}</Badge><Badge variant="outline">{human(event.event_type)}</Badge></div><p className="text-sm text-muted-foreground">{event.resident ? `${event.resident.first_name} ${event.resident.last_name}${event.resident.room ? ` · Room ${event.resident.room}` : ""}` : "Resident"}</p><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{event.provider_name && <span><UserRound className="mr-1 inline h-3 w-3" />{event.provider_name}</span>}{event.location_name && <span><MapPin className="mr-1 inline h-3 w-3" />{event.location_name}</span>}{event.required_records.length > 0 && <span>{event.required_records.length} record{event.required_records.length === 1 ? "" : "s"} to accompany</span>}</div></div><div className="text-sm"><p><Car className="mr-1 inline h-4 w-4" />{event.vehicle?.label ?? human(event.transportation_mode)}</p><p className="mt-1 text-xs text-muted-foreground">{event.staff.length ? event.staff.map((staff) => staff.employee ? `${staff.employee.first_name} ${staff.employee.last_name} (${human(staff.assignment_role)})` : `${staff.external_staff_name} (${human(staff.assignment_role)})`).join(" · ") : "No assigned staff"}</p></div>{event.status === "scheduled" && <div className="flex gap-2">{canManage && <Button size="sm" variant="outline" onClick={() => onReschedule(event)}><Clock3 className="h-4 w-4" /></Button>}{canRecord && <Button size="sm" onClick={() => onOutcome(event)}><CheckCircle2 className="mr-1 h-4 w-4" />Outcome</Button>}</div>}</div>;
}

function CreateEventDialog({ open, onOpenChange, residents, employees, vehicles }: { open: boolean; onOpenChange: (open: boolean) => void; residents: any[]; employees: any[]; vehicles: any[] }) {
  const { toast } = useToast();
  const mutation = useCreateResidentServiceCalendarEvent();
  const [form, setForm] = useState({ residentId: "", eventType: "medical_appointment", title: "", provider: "", providerContact: "", location: "", address: "", starts: toDateTimeLocal(addDays(1)), ends: toDateTimeLocal(new Date(addDays(1).getTime() + 3_600_000)), transport: "none", vehicleId: "", vendor: "", driverId: "", externalDriver: "", escortId: "", records: "", preparation: "", notes: "" });
  const submit = () => {
    const staff = [] as Array<Record<string, string>>;
    if (form.driverId) staff.push({ employeeId: form.driverId, role: "driver" });
    else if (form.externalDriver.trim()) staff.push({ externalName: form.externalDriver.trim(), role: "driver" });
    if (form.escortId && form.escortId !== form.driverId) staff.push({ employeeId: form.escortId, role: "accompanying_staff" });
    mutation.mutate({ residentId: form.residentId, event: { eventType: form.eventType, title: form.title, providerName: form.provider, providerContact: form.providerContact, locationName: form.location, locationAddress: form.address, startsAt: new Date(form.starts).toISOString(), endsAt: new Date(form.ends).toISOString(), transportationMode: form.transport, vehicleId: form.vehicleId || null, transportationVendor: form.vendor, requiredRecords: list(form.records), preparationInstructions: form.preparation, notes: form.notes }, staff }, { onSuccess: () => { toast({ title: "Resident service scheduled" }); onOpenChange(false); }, onError: (error: Error) => toast({ title: "Could not schedule service", description: error.message, variant: "destructive" }) });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Schedule resident service</DialogTitle><DialogDescription>Appointments, transportation, facility/outside activities, community services, and family visits share this workflow.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><Field label="Resident"><Choice value={form.residentId} onChange={(value) => setForm({ ...form, residentId: value })} values={residents.map((item) => ({ value: item.id, label: `${item.last_name}, ${item.first_name}` }))} placeholder="Select resident" /></Field><Field label="Service type"><Choice value={form.eventType} onChange={(value) => setForm({ ...form, eventType: value })} values={EVENT_TYPES} /></Field><Field label="Title" span><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Provider / organization"><Input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} /></Field><Field label="Provider contact"><Input value={form.providerContact} onChange={(event) => setForm({ ...form, providerContact: event.target.value })} /></Field><Field label="Starts"><Input type="datetime-local" value={form.starts} onChange={(event) => setForm({ ...form, starts: event.target.value })} /></Field><Field label="Ends"><Input type="datetime-local" value={form.ends} onChange={(event) => setForm({ ...form, ends: event.target.value })} /></Field><Field label="Location"><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field><Field label="Address"><Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field><Field label="Transportation"><Choice value={form.transport} onChange={(value) => setForm({ ...form, transport: value, vehicleId: value === "facility_vehicle" ? form.vehicleId : "" })} values={["none", "facility_vehicle", "family", "vendor", "public_transit", "rideshare", "walking", "other"]} /></Field>{form.transport === "facility_vehicle" ? <Field label="Vehicle"><Choice value={form.vehicleId} onChange={(value) => setForm({ ...form, vehicleId: value })} values={vehicles.filter((item) => item.status === "available").map((item) => ({ value: item.id, label: `${item.label}${item.wheelchair_accessible ? " · Accessible" : ""}` }))} placeholder="Select available vehicle" /></Field> : <Field label="Vendor / transportation detail"><Input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></Field>}<Field label="Employee driver"><Choice value={form.driverId} onChange={(value) => setForm({ ...form, driverId: value, externalDriver: "" })} values={employees.map((item) => ({ value: item.id, label: `${item.first_name} ${item.last_name}` }))} placeholder="Optional employee driver" /></Field><Field label="External driver"><Input disabled={!!form.driverId} value={form.externalDriver} onChange={(event) => setForm({ ...form, externalDriver: event.target.value })} /></Field><Field label="Accompanying staff"><Choice value={form.escortId} onChange={(value) => setForm({ ...form, escortId: value })} values={employees.map((item) => ({ value: item.id, label: `${item.first_name} ${item.last_name}` }))} placeholder="Optional accompanying staff" /></Field><Field label="Records to accompany"><Input value={form.records} onChange={(event) => setForm({ ...form, records: event.target.value })} placeholder="Insurance card, MAR, referral" /></Field><Field label="Preparation instructions" span><Textarea value={form.preparation} onChange={(event) => setForm({ ...form, preparation: event.target.value })} /></Field><Field label="Notes" span><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={mutation.isPending || !form.residentId || form.title.trim().length < 3 || form.ends <= form.starts || (form.transport === "facility_vehicle" && !form.vehicleId)} onClick={submit}>Schedule service</Button></DialogFooter></DialogContent></Dialog>;
}

function OutcomeDialog({ event, onClose, profiles }: { event: ResidentServiceCalendarEventView | null; onClose: () => void; profiles: any[] }) {
  const { toast } = useToast();
  const mutation = useRecordResidentServiceCalendarOutcome();
  const [status, setStatus] = useState("completed");
  const [reason, setReason] = useState("");
  const [instructions, setInstructions] = useState("");
  const [next, setNext] = useState("");
  const [draft, setDraft] = useState({ title: "", description: "", owner: "", due: toDateTimeLocal(addDays(3)), priority: "high" });
  const [followUps, setFollowUps] = useState<Array<typeof draft>>([]);
  useEffect(() => { if (event) { setStatus("completed"); setReason(""); setInstructions(""); setNext(""); setFollowUps([]); } }, [event]);
  const add = () => { setFollowUps((items) => [...items, draft]); setDraft({ title: "", description: "", owner: "", due: toDateTimeLocal(addDays(3)), priority: "high" }); };
  const submit = () => { if (!event) return; mutation.mutate({ eventId: event.id, status, resolvedAt: new Date().toISOString(), reason, returnInstructions: instructions, followUps: followUps.map((item) => ({ title: item.title, description: item.description, ownerProfileId: item.owner || null, dueAt: new Date(item.due).toISOString(), priority: item.priority })), nextAppointmentAt: next ? new Date(next).toISOString() : undefined }, { onSuccess: () => { toast({ title: "Calendar outcome recorded", description: followUps.length ? `${followUps.length} follow-up work item${followUps.length === 1 ? "" : "s"} created.` : undefined }); onClose(); }, onError: (error: Error) => toast({ title: "Could not record outcome", description: error.message, variant: "destructive" }) }); };
  return <Dialog open={!!event} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Record outcome · {event?.title}</DialogTitle><DialogDescription>Document completion, cancellation or no-show, return instructions, next appointment, and each required follow-up.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><Field label="Outcome"><Choice value={status} onChange={setStatus} values={["completed", "canceled", "no_show"]} /></Field><Field label="Next appointment"><Input type="datetime-local" value={next} onChange={(input) => setNext(input.target.value)} /></Field><Field label="Outcome reason" span><Textarea value={reason} onChange={(input) => setReason(input.target.value)} placeholder={status === "completed" ? "Completion note" : "Required cancellation or no-show reason"} /></Field><Field label="Return instructions" span><Textarea value={instructions} onChange={(input) => setInstructions(input.target.value)} /></Field><div className="rounded-lg border p-3 sm:col-span-2"><p className="mb-3 font-medium">New follow-up work</p><div className="grid gap-2 sm:grid-cols-2"><Input placeholder="Task title" value={draft.title} onChange={(input) => setDraft({ ...draft, title: input.target.value })} /><Input placeholder="Description" value={draft.description} onChange={(input) => setDraft({ ...draft, description: input.target.value })} /><Choice value={draft.owner} onChange={(value) => setDraft({ ...draft, owner: value })} values={profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: `${profile.first_name} ${profile.last_name}` }))} placeholder="Optional owner" /><Input type="datetime-local" value={draft.due} onChange={(input) => setDraft({ ...draft, due: input.target.value })} /><Choice value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value })} values={["urgent", "high", "normal", "low"]} /><Button type="button" variant="outline" disabled={draft.title.trim().length < 3 || draft.description.trim().length < 5} onClick={add}>Add follow-up</Button></div>{followUps.length > 0 && <div className="mt-3 space-y-1">{followUps.map((item, index) => <div key={`${item.title}-${index}`} className="flex justify-between rounded bg-muted/50 p-2 text-sm"><span>{item.title} · {new Date(item.due).toLocaleString()}</span><button type="button" className="text-destructive" onClick={() => setFollowUps((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>}</div></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending || (status !== "completed" && reason.trim().length < 5)} onClick={submit}>Record outcome</Button></DialogFooter></DialogContent></Dialog>;
}

function RescheduleDialog({ event, onClose }: { event: ResidentServiceCalendarEventView | null; onClose: () => void }) {
  const { toast } = useToast();
  const mutation = useRescheduleResidentServiceCalendarEvent();
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { if (event) { setStarts(toDateTimeLocal(event.starts_at)); setEnds(toDateTimeLocal(event.ends_at)); setReason(""); } }, [event]);
  return <Dialog open={!!event} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Reschedule {event?.title}</DialogTitle><DialogDescription>Vehicle and staff conflicts are checked before the new time is accepted.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><Field label="Starts"><Input type="datetime-local" value={starts} onChange={(input) => setStarts(input.target.value)} /></Field><Field label="Ends"><Input type="datetime-local" value={ends} onChange={(input) => setEnds(input.target.value)} /></Field><Field label="Reason" span><Textarea value={reason} onChange={(input) => setReason(input.target.value)} /></Field></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!event || mutation.isPending || reason.trim().length < 5 || ends <= starts} onClick={() => event && mutation.mutate({ eventId: event.id, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(), reason }, { onSuccess: () => { toast({ title: "Service rescheduled" }); onClose(); }, onError: (error: Error) => toast({ title: "Could not reschedule service", description: error.message, variant: "destructive" }) })}>Reschedule</Button></DialogFooter></DialogContent></Dialog>;
}

function VehicleWorkspace({ facilityId, vehicles, canManage }: { facilityId: string; vehicles: any[]; canManage: boolean }) {
  const { toast } = useToast();
  const mutation = useSaveFacilityTransportVehicle();
  const [form, setForm] = useState({ label: "", type: "van", plate: "", capacity: "6", accessible: false, status: "available", notes: "" });
  const save = () => mutation.mutate({ facilityId, label: form.label, vehicleType: form.type, licensePlate: form.plate, capacity: Number(form.capacity), wheelchairAccessible: form.accessible, status: form.status, notes: form.notes }, { onSuccess: () => { toast({ title: "Vehicle saved" }); setForm({ label: "", type: "van", plate: "", capacity: "6", accessible: false, status: "available", notes: "" }); }, onError: (error: Error) => toast({ title: "Could not save vehicle", description: error.message, variant: "destructive" }) });
  return <div className="grid gap-4 xl:grid-cols-[380px_1fr]">{canManage && <Card><CardHeader><CardTitle>Add facility vehicle</CardTitle><CardDescription>Available vehicles can be reserved on resident services; overlapping reservations are blocked.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Field label="Label" span><Input value={form.label} onChange={(input) => setForm({ ...form, label: input.target.value })} /></Field><Field label="Type"><Choice value={form.type} onChange={(value) => setForm({ ...form, type: value })} values={["car", "van", "wheelchair_van", "bus", "other"]} /></Field><Field label="License plate"><Input value={form.plate} onChange={(input) => setForm({ ...form, plate: input.target.value })} /></Field><Field label="Capacity"><Input type="number" value={form.capacity} onChange={(input) => setForm({ ...form, capacity: input.target.value })} /></Field><Field label="Status"><Choice value={form.status} onChange={(value) => setForm({ ...form, status: value })} values={["available", "maintenance", "out_of_service", "retired"]} /></Field><label className="flex items-center gap-2 pt-7 text-sm"><input type="checkbox" checked={form.accessible} onChange={(input) => setForm({ ...form, accessible: input.target.checked })} />Wheelchair accessible</label><Field label="Notes" span><Textarea value={form.notes} onChange={(input) => setForm({ ...form, notes: input.target.value })} /></Field><Button className="sm:col-span-2" disabled={!facilityId || form.label.trim().length < 2 || mutation.isPending} onClick={save}>Save vehicle</Button></CardContent></Card>}<Card><CardHeader><CardTitle>Transportation fleet</CardTitle></CardHeader><CardContent className="space-y-2">{vehicles.length ? vehicles.map((vehicle) => <div key={vehicle.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><div><strong>{vehicle.label}</strong><p className="text-sm text-muted-foreground">{human(vehicle.vehicle_type)} · Capacity {vehicle.capacity}{vehicle.license_plate ? ` · ${vehicle.license_plate}` : ""}</p></div><div className="flex gap-2">{vehicle.wheelchair_accessible && <Badge variant="outline">Accessible</Badge>}<Badge variant={vehicle.status === "available" ? "secondary" : "destructive"}>{human(vehicle.status)}</Badge></div></div>) : <p className="py-10 text-center text-sm text-muted-foreground">No facility vehicles recorded.</p>}</CardContent></Card></div>;
}
