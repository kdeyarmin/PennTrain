import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
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
  type FacilityTransportVehicle,
  useCreateResidentServiceCalendarEvent,
  useFacilityTransportVehicles,
  useRecordResidentServiceCalendarOutcome,
  useResidentServicesCalendar,
  useRescheduleResidentServiceCalendarEvent,
  useSaveFacilityTransportVehicle,
} from "@/hooks/useResidentServicesCalendar";
import { QueryError } from "@/components/QueryState";
import { careDateTimeInstant, isCareCalendarDate } from "@/lib/careFormDates";
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
import { addFacilityCalendarDays, facilityDateRangeBounds, facilityToday, formatDateForDisplay, formatFacilityTimeForDisplay, toFacilityDateTimeLocal } from "@/lib/dateUtils";

const EVENT_TYPES = [
  "medical_appointment", "dental_appointment", "behavioral_health_appointment",
  "laboratory_visit", "therapy", "community_service", "family_visit",
  "transportation", "facility_activity", "outside_activity",
];
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const defaultFromDate = () => addFacilityCalendarDays(facilityToday(), -7);
const defaultThroughDate = () => addFacilityCalendarDays(facilityToday(), 30);
/** Facility wall-clock datetime-local default N calendar days ahead at HH:mm. */
const facilityDefaultAt = (days: number, timeHHmm = "09:00") =>
  `${addFacilityCalendarDays(facilityToday(), days)}T${timeHHmm}`;

function Field({ label, children, span = false }: { label: string; children: React.ReactNode; span?: boolean }) {
  // Visual label stays a plain <p>; clone aria-label onto Choice/Input children for a11y.
  const enriched = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const props = child.props as { "aria-label"?: string };
    return cloneElement(child as React.ReactElement<{ "aria-label"?: string }>, {
      "aria-label": props["aria-label"] ?? label,
    });
  });
  return <div className={`space-y-1 ${span ? "sm:col-span-2" : ""}`}><p className="text-sm font-medium leading-none">{label}</p>{enriched}</div>;
}

function Choice({ value, onChange, values, placeholder, disabled, "aria-label": ariaLabel }: { value: string; onChange: (value: string) => void; values: Array<string | { value: string; label: string }>; placeholder?: string; disabled?: boolean; "aria-label"?: string }) {
  return <Select value={value || undefined} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={ariaLabel}><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{values.map((item) => { const option = typeof item === "string" ? { value: item, label: human(item) } : item; return <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>; })}</SelectContent></Select>;
}

export default function ResidentServicesCalendar() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const context = useResidentNavigationContext();
  // Changing facility replaces drafts and mutation observers, including a later return to A.
  return <CalendarWorkspace key={`${viewingOrgId ?? user?.organizationId ?? ""}:${context.facilityId}`} context={context} />;
}

function CalendarWorkspace({ context }: { context: ReturnType<typeof useResidentNavigationContext> }) {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = hasRole(user, "platform_admin", "org_admin", "facility_manager");
  const canRecord = !hasRole(user, "auditor");
  const facilities = useListFacilities({ organizationId });
  const { facilityId, residentId, setFacilityId, setResidentId, adoptDefaultFacility } = context;
  // adoptDefaultFacility, not setFacilityId: the latter clears the resident, and on `?resident=X`
  // with no facility this effect runs before the resident query resolves the facility.
  useEffect(() => { if (!facilityId && facilities.data?.length === 1) adoptDefaultFacility(facilities.data[0].id); }, [facilityId, facilities.data]);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [throughDate, setThroughDate] = useState(defaultThroughDate);
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const selectedFacility = facilities.data?.find(facility => facility.id === facilityId && (!organizationId || facility.organization_id === organizationId));
  const scopeReady = !facilities.isLoading && !facilities.isError && (!facilityId || !!selectedFacility);
  const residents = useListResidents({ facilityId, status: "active" }, { enabled: scopeReady && !!facilityId });
  const employees = useListEmployees({ facilityId, status: "active", organizationId }, { enabled: scopeReady && !!facilityId });
  const profiles = useListProfiles({ organizationId });
  const vehicles = useFacilityTransportVehicles(scopeReady ? facilityId : undefined);
  const datesValid = isCareCalendarDate(fromDate) && isCareCalendarDate(throughDate) && fromDate <= throughDate;
  const rangeBounds = datesValid ? facilityDateRangeBounds(fromDate, throughDate) : { from: "", through: "" };
  const events = useResidentServicesCalendar({
    organizationId,
    facilityId: facilityId || undefined,
    from: rangeBounds.from,
    through: rangeBounds.through,
    residentId: residentId || undefined,
    eventType: eventType || undefined,
    status: status || undefined,
  }, { enabled: datesValid && scopeReady });
  const [createOpen, setCreateOpen] = useState(false);
  const [outcomeEvent, setOutcomeEvent] = useState<ResidentServiceCalendarEventView | null>(null);
  const [rescheduleEvent, setRescheduleEvent] = useState<ResidentServiceCalendarEventView | null>(null);
  const grouped = useMemo(() => {
    const groups = new Map<string, ResidentServiceCalendarEventView[]>();
    for (const event of events.data ?? []) {
      // Group by Pennsylvania facility day — browser toLocalIsoDate drifts across zones.
      const key = facilityToday(new Date(event.starts_at));
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()];
  }, [events.data]);
  const activeOutcome = scopeReady && !events.isError ? outcomeEvent : null;
  const activeReschedule = scopeReady && !events.isError ? rescheduleEvent : null;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="h-6 w-6" />Resident Services Calendar</h1><p className="text-muted-foreground">Appointments, transportation, activities, community and family services, preparation, outcomes, and return follow-up.</p></div>{canManage && <Button disabled={!facilityId || facilities.isLoading || facilities.isError || !facilities.data?.some(item => item.id === facilityId)} onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Schedule service</Button>}</div>
    <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-3 xl:grid-cols-6"><Field label="Facility"><Choice value={facilityId} onChange={setFacilityId} values={(facilities.data ?? []).map((item) => ({ value: item.id, label: item.name }))} placeholder="Select facility" aria-label="Facility" /></Field><Field label="From"><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" /></Field><Field label="Through"><Input type="date" value={throughDate} onChange={(event) => setThroughDate(event.target.value)} aria-label="Through date" /></Field><Field label="Resident"><Choice value={residentId} onChange={(value) => setResidentId(value === "all" ? "" : value)} values={[{ value: "all", label: "All residents" }, ...(residents.data ?? []).map((item) => ({ value: item.id, label: `${item.last_name}, ${item.first_name}` }))]} placeholder="All residents" aria-label="Resident" /></Field><Field label="Service type"><Choice value={eventType} onChange={(value) => setEventType(value === "all" ? "" : value)} values={[{ value: "all", label: "All types" }, ...EVENT_TYPES]} placeholder="All types" aria-label="Service type" /></Field><Field label="Status"><Choice value={status} onChange={(value) => setStatus(value === "all" ? "" : value)} values={[{ value: "all", label: "All statuses" }, "scheduled", "completed", "canceled", "no_show"]} placeholder="All statuses" aria-label="Status" /></Field></CardContent></Card>
    {facilities.isError ? <QueryError what="calendar facilities" error={facilities.error} onRetry={facilities.refetch} /> : facilities.isLoading ? <p>Loading calendar facilities...</p> : !scopeReady ? <p role="alert">Select a facility in the current organization to review its calendar.</p> : null}
    <Tabs defaultValue="agenda" className="space-y-4"><TabsList><TabsTrigger value="agenda"><CalendarDays className="mr-2 h-4 w-4" />Agenda</TabsTrigger><TabsTrigger value="vehicles"><Car className="mr-2 h-4 w-4" />Transportation fleet</TabsTrigger></TabsList>
      <TabsContent value="agenda"><Card><CardHeader><CardTitle>{selectedFacility?.name ?? "Assigned resident services"}</CardTitle><CardDescription>{hasRole(user, "employee") ? "Only events where you are assigned as driver or accompanying staff are shown." : "Calendar events are ordered by service date and time."}</CardDescription></CardHeader><CardContent className="space-y-5">{!scopeReady ? null : !datesValid ? <p className="text-sm text-destructive">Enter valid From and Through dates in chronological order.</p> : events.isError ? <QueryError error={events.error} onRetry={events.refetch} /> : events.isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading calendar…</p> : grouped.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No resident services match this date range.</p> : grouped.map(([day, items]) => <section key={day} className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">{formatDateForDisplay(day, { weekday: "long", month: "long", day: "numeric" })}</h2>{items.map((event) => <EventRow key={event.id} event={event} canManage={canManage} canRecord={canRecord} onOutcome={setOutcomeEvent} onReschedule={setRescheduleEvent} />)}</section>)}</CardContent></Card></TabsContent>
      <TabsContent value="vehicles">{scopeReady && <VehicleWorkspace facilityId={facilityId} vehicles={vehicles.data ?? []} vehiclesLoading={vehicles.isLoading} vehiclesError={vehicles.isError} onRetry={vehicles.refetch} canManage={canManage && !facilities.isLoading && !facilities.isError && !!selectedFacility} />}</TabsContent>
    </Tabs>
    <CreateEventDialog key={createOpen ? "create-open" : "create-closed"} open={createOpen} onOpenChange={setCreateOpen} residents={scopeReady && !residents.isLoading && !residents.isError ? residents.data ?? [] : []} employees={scopeReady && !employees.isLoading && !employees.isError ? employees.data ?? [] : []} vehicles={scopeReady && !vehicles.isLoading && !vehicles.isError ? vehicles.data ?? [] : []} referenceError={!scopeReady || residents.isError || employees.isError || vehicles.isError} onRetry={() => { void residents.refetch(); void employees.refetch(); void vehicles.refetch(); }} />
    <OutcomeDialog key={activeOutcome?.id ?? "none"} event={activeOutcome} onClose={() => setOutcomeEvent(null)} profiles={profiles.data ?? []} />
    <RescheduleDialog key={activeReschedule?.id ?? "none"} event={activeReschedule} onClose={() => setRescheduleEvent(null)} />
  </div>;
}

function EventRow({ event, canManage, canRecord, onOutcome, onReschedule }: { event: ResidentServiceCalendarEventView; canManage: boolean; canRecord: boolean; onOutcome: (event: ResidentServiceCalendarEventView) => void; onReschedule: (event: ResidentServiceCalendarEventView) => void }) {
  const badge = event.status === "scheduled" ? "default" : event.status === "completed" ? "secondary" : "destructive";
  return <div className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[140px_1fr_230px_auto] lg:items-center"><div><p className="font-semibold">{formatFacilityTimeForDisplay(event.starts_at)}</p><p className="text-xs text-muted-foreground">to {formatFacilityTimeForDisplay(event.ends_at)}</p></div><div><div className="flex flex-wrap items-center gap-2"><strong>{event.title}</strong><Badge variant={badge}>{human(event.status)}</Badge><Badge variant="outline">{human(event.event_type)}</Badge></div><p className="text-sm text-muted-foreground">{event.resident ? `${event.resident.first_name} ${event.resident.last_name}${event.resident.room ? ` · Room ${event.resident.room}` : ""}` : "Resident"}</p><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{event.provider_name && <span><UserRound className="mr-1 inline h-3 w-3" />{event.provider_name}</span>}{event.location_name && <span><MapPin className="mr-1 inline h-3 w-3" />{event.location_name}</span>}{event.required_records.length > 0 && <span>{event.required_records.length} record{event.required_records.length === 1 ? "" : "s"} to accompany</span>}</div></div><div className="text-sm"><p><Car className="mr-1 inline h-4 w-4" />{event.vehicle?.label ?? human(event.transportation_mode)}</p><p className="mt-1 text-xs text-muted-foreground">{event.staff.length ? event.staff.map((staff) => staff.employee ? `${staff.employee.first_name} ${staff.employee.last_name} (${human(staff.assignment_role)})` : `${staff.external_staff_name} (${human(staff.assignment_role)})`).join(" · ") : "No assigned staff"}</p></div>{event.status === "scheduled" && <div className="flex gap-2">{canManage && <Button size="sm" variant="outline" onClick={() => onReschedule(event)}><Clock3 className="h-4 w-4" /></Button>}{canRecord && <Button size="sm" onClick={() => onOutcome(event)}><CheckCircle2 className="mr-1 h-4 w-4" />Outcome</Button>}</div>}</div>;
}

function CreateEventDialog({ open, onOpenChange, residents, employees, vehicles, referenceError, onRetry }: { open: boolean; onOpenChange: (open: boolean) => void; residents: any[]; employees: any[]; vehicles: any[]; referenceError: boolean; onRetry: () => void }) {
  const { toast } = useToast();
  const mutation = useCreateResidentServiceCalendarEvent();
  const submitting = useRef(false);
  const emptyForm = () => ({
    residentId: "",
    eventType: "medical_appointment",
    title: "",
    provider: "",
    providerContact: "",
    location: "",
    address: "",
    starts: facilityDefaultAt(1, "09:00"),
    ends: facilityDefaultAt(1, "10:00"),
    transport: "none",
    vehicleId: "",
    vendor: "",
    driverId: "",
    externalDriver: "",
    escortId: "",
    records: "",
    preparation: "",
    notes: "",
  });
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);
  const startsAt = careDateTimeInstant(form.starts);
  const endsAt = careDateTimeInstant(form.ends);
  const valid = !referenceError && residents.some(item => item.id === form.residentId)
    && form.title.trim().length >= 3 && startsAt && endsAt && endsAt > startsAt
    && (!form.driverId || employees.some(item => item.id === form.driverId))
    && (!form.escortId || employees.some(item => item.id === form.escortId))
    && (form.transport !== "facility_vehicle" || vehicles.some(item => item.id === form.vehicleId && item.status === "available"));
  const close = (next: boolean) => { if (!submitting.current && !mutation.isPending) onOpenChange(next); };
  const submit = () => {
    if (!valid || submitting.current || mutation.isPending) return;
    submitting.current = true;
    const staff = [] as Array<Record<string, string>>;
    if (form.driverId) staff.push({ employeeId: form.driverId, role: "driver" });
    else if (form.externalDriver.trim()) staff.push({ externalName: form.externalDriver.trim(), role: "driver" });
    if (form.escortId && form.escortId !== form.driverId) staff.push({ employeeId: form.escortId, role: "accompanying_staff" });
    mutation.mutate({ residentId: form.residentId, event: { eventType: form.eventType, title: form.title, providerName: form.provider, providerContact: form.providerContact, locationName: form.location, locationAddress: form.address, startsAt, endsAt, transportationMode: form.transport, vehicleId: form.vehicleId || null, transportationVendor: form.vendor, requiredRecords: list(form.records), preparationInstructions: form.preparation, notes: form.notes }, staff }, { onSuccess: () => { toast({ title: "Resident service scheduled" }); setForm(emptyForm()); onOpenChange(false); }, onError: (error: Error) => toast({ title: "Could not schedule service", description: error.message, variant: "destructive" }), onSettled: () => { submitting.current = false; } });
  };
  return <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Schedule resident service</DialogTitle><DialogDescription>Appointments, transportation, facility/outside activities, community services, and family visits share this workflow.</DialogDescription></DialogHeader>{referenceError && <QueryError error={new Error("Could not load service scheduling choices.")} onRetry={onRetry} />}<fieldset disabled={mutation.isPending} className="grid gap-3 sm:grid-cols-2"><Field label="Resident"><Choice value={form.residentId} onChange={(value) => setForm({ ...form, residentId: value })} values={residents.map((item) => ({ value: item.id, label: `${item.last_name}, ${item.first_name}` }))} placeholder="Select resident" /></Field><Field label="Service type"><Choice value={form.eventType} onChange={(value) => setForm({ ...form, eventType: value })} values={EVENT_TYPES} /></Field><Field label="Title" span><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Provider / organization"><Input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} /></Field><Field label="Provider contact"><Input value={form.providerContact} onChange={(event) => setForm({ ...form, providerContact: event.target.value })} /></Field><Field label="Starts"><Input type="datetime-local" value={form.starts} onChange={(event) => setForm({ ...form, starts: event.target.value })} /></Field><Field label="Ends"><Input type="datetime-local" value={form.ends} onChange={(event) => setForm({ ...form, ends: event.target.value })} /></Field><Field label="Location"><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field><Field label="Address"><Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field><Field label="Transportation"><Choice value={form.transport} onChange={(value) => setForm({ ...form, transport: value, vehicleId: value === "facility_vehicle" ? form.vehicleId : "" })} values={["none", "facility_vehicle", "family", "vendor", "public_transit", "rideshare", "walking", "other"]} /></Field>{form.transport === "facility_vehicle" ? <Field label="Vehicle"><Choice value={form.vehicleId} onChange={(value) => setForm({ ...form, vehicleId: value })} values={vehicles.filter((item) => item.status === "available").map((item) => ({ value: item.id, label: `${item.label}${item.wheelchair_accessible ? " · Accessible" : ""}` }))} placeholder="Select available vehicle" /></Field> : <Field label="Vendor / transportation detail"><Input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></Field>}<Field label="Employee driver"><Choice value={form.driverId} onChange={(value) => setForm({ ...form, driverId: value, externalDriver: "" })} values={employees.map((item) => ({ value: item.id, label: `${item.first_name} ${item.last_name}` }))} placeholder="Optional employee driver" /></Field><Field label="External driver"><Input disabled={!!form.driverId} value={form.externalDriver} onChange={(event) => setForm({ ...form, externalDriver: event.target.value })} /></Field><Field label="Accompanying staff"><Choice value={form.escortId} onChange={(value) => setForm({ ...form, escortId: value })} values={employees.map((item) => ({ value: item.id, label: `${item.first_name} ${item.last_name}` }))} placeholder="Optional accompanying staff" /></Field><Field label="Records to accompany"><Input value={form.records} onChange={(event) => setForm({ ...form, records: event.target.value })} placeholder="Insurance card, MAR, referral" /></Field><Field label="Preparation instructions" span><Textarea value={form.preparation} onChange={(event) => setForm({ ...form, preparation: event.target.value })} /></Field><Field label="Notes" span><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field></fieldset><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => close(false)}>Cancel</Button><Button disabled={mutation.isPending || !valid} onClick={submit}>Schedule service</Button></DialogFooter></DialogContent></Dialog>;
}

function OutcomeDialog({ event, onClose, profiles }: { event: ResidentServiceCalendarEventView | null; onClose: () => void; profiles: any[] }) {
  const { toast } = useToast();
  const mutation = useRecordResidentServiceCalendarOutcome();
  const submitting = useRef(false);
  const [status, setStatus] = useState("completed");
  const [reason, setReason] = useState("");
  const [instructions, setInstructions] = useState("");
  const [next, setNext] = useState("");
  const [draft, setDraft] = useState({ title: "", description: "", owner: "", due: facilityDefaultAt(3, "17:00"), priority: "high" });
  const [followUps, setFollowUps] = useState<Array<typeof draft>>([]);
  useEffect(() => { if (event) { setStatus("completed"); setReason(""); setInstructions(""); setNext(""); setFollowUps([]); setDraft({ title: "", description: "", owner: "", due: facilityDefaultAt(3, "17:00"), priority: "high" }); } }, [event?.id]);
  const add = () => { if (mutation.isPending || submitting.current || !careDateTimeInstant(draft.due) || draft.title.trim().length < 3 || draft.description.trim().length < 5) return; setFollowUps((items) => [...items, draft]); setDraft({ title: "", description: "", owner: "", due: facilityDefaultAt(3, "17:00"), priority: "high" }); };
  const valid = (!next || !!careDateTimeInstant(next)) && followUps.every(item => !!careDateTimeInstant(item.due)) && (status === "completed" || reason.trim().length >= 5);
  const close = () => { if (!submitting.current && !mutation.isPending) onClose(); };
  const submit = () => { if (!event || !valid || submitting.current || mutation.isPending) return; submitting.current = true; mutation.mutate({ eventId: event.id, status, resolvedAt: new Date().toISOString(), reason, returnInstructions: instructions, followUps: followUps.map((item) => ({ title: item.title, description: item.description, ownerProfileId: item.owner || null, dueAt: careDateTimeInstant(item.due)!, priority: item.priority })), nextAppointmentAt: next ? careDateTimeInstant(next)! : undefined }, { onSuccess: () => { toast({ title: "Calendar outcome recorded", description: followUps.length ? `${followUps.length} follow-up work item${followUps.length === 1 ? "" : "s"} created.` : undefined }); onClose(); }, onError: (error: Error) => toast({ title: "Could not record outcome", description: error.message, variant: "destructive" }), onSettled: () => { submitting.current = false; } }); };
  return <Dialog open={!!event} onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Record outcome · {event?.title}</DialogTitle><DialogDescription>Document completion, cancellation or no-show, return instructions, next appointment, and each required follow-up.</DialogDescription></DialogHeader><fieldset disabled={mutation.isPending} className="grid gap-3 sm:grid-cols-2"><Field label="Outcome"><Choice value={status} onChange={setStatus} values={["completed", "canceled", "no_show"]} /></Field><Field label="Next appointment"><Input type="datetime-local" value={next} onChange={(input) => setNext(input.target.value)} /></Field><Field label="Outcome reason" span><Textarea value={reason} onChange={(input) => setReason(input.target.value)} placeholder={status === "completed" ? "Completion note" : "Required cancellation or no-show reason"} /></Field><Field label="Return instructions" span><Textarea value={instructions} onChange={(input) => setInstructions(input.target.value)} /></Field><div className="rounded-lg border p-3 sm:col-span-2"><p className="mb-3 font-medium">New follow-up work</p><div className="grid gap-2 sm:grid-cols-2"><Input placeholder="Task title" value={draft.title} onChange={(input) => setDraft({ ...draft, title: input.target.value })} aria-label="Follow-up task title" /><Input placeholder="Description" value={draft.description} onChange={(input) => setDraft({ ...draft, description: input.target.value })} aria-label="Follow-up description" /><Choice value={draft.owner} onChange={(value) => setDraft({ ...draft, owner: value })} values={profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: `${profile.first_name} ${profile.last_name}` }))} placeholder="Optional owner" aria-label="Follow-up owner" /><Input type="datetime-local" value={draft.due} onChange={(input) => setDraft({ ...draft, due: input.target.value })} aria-label="Follow-up due" /><Choice value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value })} values={["urgent", "high", "normal", "low"]} aria-label="Follow-up priority" /><Button type="button" variant="outline" disabled={draft.title.trim().length < 3 || draft.description.trim().length < 5 || !careDateTimeInstant(draft.due) || mutation.isPending} onClick={add}>Add follow-up</Button></div>{followUps.length > 0 && <div className="mt-3 space-y-1">{followUps.map((item, index) => <div key={`${item.title}-${index}`} className="flex justify-between rounded bg-muted/50 p-2 text-sm"><span>{item.title} · {formatDateForDisplay(item.due.slice(0, 10))} {item.due.slice(11)}</span><button type="button" className="text-destructive" onClick={() => setFollowUps((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>}</div></fieldset><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={close}>Cancel</Button><Button disabled={mutation.isPending || !valid} onClick={submit}>Record outcome</Button></DialogFooter></DialogContent></Dialog>;
}

function RescheduleDialog({ event, onClose }: { event: ResidentServiceCalendarEventView | null; onClose: () => void }) {
  const { toast } = useToast();
  const mutation = useRescheduleResidentServiceCalendarEvent();
  const submitting = useRef(false);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { if (event) { setStarts(toFacilityDateTimeLocal(event.starts_at)); setEnds(toFacilityDateTimeLocal(event.ends_at)); setReason(""); } }, [event?.id]);
  const startsAt = careDateTimeInstant(starts), endsAt = careDateTimeInstant(ends);
  const valid = !!event && reason.trim().length >= 5 && !!startsAt && !!endsAt && endsAt > startsAt;
  const close = () => { if (!submitting.current && !mutation.isPending) onClose(); };
  const submit = () => {
    if (!event || !valid || submitting.current || mutation.isPending) return;
    submitting.current = true;
    mutation.mutate({ eventId: event.id, startsAt: startsAt!, endsAt: endsAt!, reason }, {
      onSuccess: () => { toast({ title: "Service rescheduled" }); onClose(); },
      onError: (error: Error) => toast({ title: "Could not reschedule service", description: error.message, variant: "destructive" }),
      onSettled: () => { submitting.current = false; },
    });
  };
  return <Dialog open={!!event} onOpenChange={(open) => !open && close()}><DialogContent><DialogHeader><DialogTitle>Reschedule {event?.title}</DialogTitle><DialogDescription>Vehicle and staff conflicts are checked before the new time is accepted.</DialogDescription></DialogHeader><fieldset disabled={mutation.isPending} className="grid gap-3 sm:grid-cols-2"><Field label="Starts"><Input type="datetime-local" value={starts} onChange={(input) => setStarts(input.target.value)} /></Field><Field label="Ends"><Input type="datetime-local" value={ends} onChange={(input) => setEnds(input.target.value)} /></Field><Field label="Reason" span><Textarea value={reason} onChange={(input) => setReason(input.target.value)} /></Field></fieldset><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={close}>Cancel</Button><Button disabled={mutation.isPending || !valid} onClick={submit}>Reschedule</Button></DialogFooter></DialogContent></Dialog>;
}

function VehicleWorkspace({ facilityId, vehicles, vehiclesLoading = false, vehiclesError = false, onRetry, canManage }: { facilityId: string; vehicles: FacilityTransportVehicle[]; vehiclesLoading?: boolean; vehiclesError?: boolean; onRetry: () => void; canManage: boolean }) {
  const { toast } = useToast();
  const mutation = useSaveFacilityTransportVehicle();
  const submitting = useRef(false);
  const empty = () => ({ label: "", type: "van", plate: "", capacity: "6", accessible: false, status: "available", notes: "" });
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const capacity = Number(form.capacity);
  const valid = canManage && !!facilityId && form.label.trim().length >= 2 && form.capacity.trim() !== ""
    && Number.isInteger(capacity) && capacity >= 1 && capacity <= 100
    && (!editingId || (!vehiclesLoading && !vehiclesError && vehicles.some(vehicle => vehicle.id === editingId && vehicle.facility_id === facilityId)));
  const clear = () => { setForm(empty()); setEditingId(null); };
  const edit = (vehicle: FacilityTransportVehicle) => {
    if (!canManage || submitting.current || mutation.isPending || vehicle.facility_id !== facilityId) return;
    setEditingId(vehicle.id);
    setForm({ label: vehicle.label, type: vehicle.vehicle_type, plate: vehicle.license_plate ?? "", capacity: String(vehicle.capacity), accessible: vehicle.wheelchair_accessible, status: vehicle.status, notes: vehicle.notes ?? "" });
  };
  const save = () => {
    if (!valid || submitting.current || mutation.isPending) return;
    submitting.current = true;
    mutation.mutate({ facilityId, vehicleId: editingId ?? undefined, label: form.label, vehicleType: form.type, licensePlate: form.plate, capacity, wheelchairAccessible: form.accessible, status: form.status, notes: form.notes }, {
      onSuccess: () => { toast({ title: "Vehicle saved" }); clear(); },
      onError: (error: Error) => toast({ title: "Could not save vehicle", description: error.message, variant: "destructive" }),
      onSettled: () => { submitting.current = false; },
    });
  };
  return <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
    {canManage && <Card><CardHeader><CardTitle>{editingId ? "Edit facility vehicle" : "Add facility vehicle"}</CardTitle><CardDescription>Available vehicles can be reserved on resident services; overlapping reservations are blocked.</CardDescription></CardHeader>
      <CardContent><fieldset disabled={mutation.isPending} className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" span><Input value={form.label} onChange={(input) => setForm({ ...form, label: input.target.value })} /></Field>
        <Field label="Type"><Choice disabled={mutation.isPending} value={form.type} onChange={(value) => setForm({ ...form, type: value })} values={["car", "van", "wheelchair_van", "bus", "other"]} /></Field>
        <Field label="License plate"><Input value={form.plate} onChange={(input) => setForm({ ...form, plate: input.target.value })} /></Field>
        <Field label="Capacity"><Input type="number" min={1} max={100} step={1} value={form.capacity} onChange={(input) => setForm({ ...form, capacity: input.target.value })} /></Field>
        <Field label="Status"><Choice disabled={mutation.isPending} value={form.status} onChange={(value) => setForm({ ...form, status: value })} values={["available", "maintenance", "out_of_service", "retired"]} /></Field>
        <label className="flex items-center gap-2 pt-7 text-sm"><input type="checkbox" checked={form.accessible} onChange={(input) => setForm({ ...form, accessible: input.target.checked })} />Wheelchair accessible</label>
        <Field label="Notes" span><Textarea value={form.notes} onChange={(input) => setForm({ ...form, notes: input.target.value })} /></Field>
        <Button className="sm:col-span-2" disabled={!valid || mutation.isPending} onClick={save}>Save vehicle</Button>
        {editingId && <Button className="sm:col-span-2" variant="outline" disabled={mutation.isPending} onClick={() => { if (!submitting.current && !mutation.isPending) clear(); }}>Cancel edit</Button>}
      </fieldset></CardContent>
    </Card>}
    <Card><CardHeader><CardTitle>Transportation fleet</CardTitle></CardHeader><CardContent className="space-y-2">
      {vehiclesError ? <QueryError error={new Error("Could not load vehicles.")} onRetry={onRetry} /> : vehiclesLoading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading vehicles...</p> : vehicles.length ? vehicles.map((vehicle) => <div key={vehicle.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
        <div><strong>{vehicle.label}</strong><p className="text-sm text-muted-foreground">{human(vehicle.vehicle_type)} · Capacity {vehicle.capacity}{vehicle.license_plate ? ` · ${vehicle.license_plate}` : ""}</p></div>
        <div className="flex gap-2">{vehicle.wheelchair_accessible && <Badge variant="outline">Accessible</Badge>}<Badge variant={vehicle.status === "available" ? "secondary" : "destructive"}>{human(vehicle.status)}</Badge>{canManage && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => edit(vehicle)}>Edit</Button>}</div>
      </div>) : <p className="py-10 text-center text-sm text-muted-foreground">No facility vehicles recorded.</p>}
    </CardContent></Card>
  </div>;
}
