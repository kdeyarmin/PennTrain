import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, CalendarClock, Plus, RefreshCw, Search, ShieldAlert, Wrench } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/utils";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import {
  useCreateMaintenanceLocation,
  useCreatePreventiveMaintenanceSchedule,
  useCreateWorkOrder,
  useGenerateDuePreventiveMaintenance,
  useListMaintenanceLocations,
  useListPreventiveMaintenanceSchedules,
  useListWorkOrders,
  useUpdatePreventiveMaintenanceSchedule,
  type WorkOrder,
} from "@/hooks/useWorkOrders";
import { MaintenanceQrCode } from "@/components/maintenance/MaintenanceQrCode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const OPEN_STATUSES = new Set(["open", "assigned", "in_progress", "on_hold", "pending_verification"]);

function workOrderBadge(order: WorkOrder) {
  const overdue = OPEN_STATUSES.has(order.status) && !!order.target_completion_at && new Date(order.target_completion_at) < new Date();
  if (overdue) return <Badge className="bg-destructive text-destructive-foreground">Overdue</Badge>;
  const classes = order.status === "verified" ? "bg-success text-success-foreground"
    : order.status === "pending_verification" ? "bg-warning text-warning-foreground"
    : order.status === "canceled" ? "bg-muted text-muted-foreground"
    : "bg-primary/10 text-primary";
  return <Badge className={classes} variant="outline">{humanize(order.status)}</Badge>;
}

const emptyOrder = {
  facilityId: "", assetId: "none", locationId: "none", locationDetail: "", roomNumber: "",
  description: "", safetyRisk: "low", priority: "routine", protectiveAction: "",
  employeeId: "none", vendor: "", target: "", parts: "", estimatedCost: "", residentImpact: "",
};

const emptySchedule = {
  facilityId: "", assetId: "none", locationId: "none", title: "", description: "",
  frequencyUnit: "month", frequencyInterval: "1", nextDueDate: toLocalIsoDate(),
  priority: "routine", employeeId: "none", vendor: "", durationMinutes: "", estimatedCost: "", parts: "",
};

export default function Maintenance() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const canManage = ["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");
  const canConfigure = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const [facilityId, setFacilityId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [showOrder, setShowOrder] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [scheduleForm, setScheduleForm] = useState(emptySchedule);
  const [locationForm, setLocationForm] = useState({ facilityId: "", label: "", roomNumber: "", detail: "" });

  const selectedFacility = facilityId === "all" ? undefined : facilityId;
  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees({ status: "active" });
  const { data: assets } = useListInspectionItems({ isActive: true });
  // Keep the complete RLS-scoped location set available to create dialogs. The dashboard tab
  // applies its own facility filter below; otherwise choosing a different facility inside a
  // dialog after filtering the page would incorrectly show no locations for that facility.
  const { data: locations } = useListMaintenanceLocations();
  const { data: schedules } = useListPreventiveMaintenanceSchedules(selectedFacility);
  const { data: orders, isLoading } = useListWorkOrders({
    facilityId: selectedFacility,
    status: status === "all" ? undefined : status,
  });
  const createOrder = useCreateWorkOrder();
  const createLocation = useCreateMaintenanceLocation();
  const createSchedule = useCreatePreventiveMaintenanceSchedule();
  const updateSchedule = useUpdatePreventiveMaintenanceSchedule();
  const generateDue = useGenerateDuePreventiveMaintenance();

  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const assetById = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a])), [assets]);
  const locationById = useMemo(() => new Map((locations ?? []).map((l) => [l.id, l])), [locations]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("action") !== "add") return;
    const assetId = params.get("assetId");
    const locationId = params.get("locationId");
    const asset = (assets ?? []).find((item) => item.id === assetId);
    const location = (locations ?? []).find((item) => item.id === locationId);
    if (asset) setOrderForm((form) => ({ ...form, facilityId: asset.facility_id, assetId: asset.id, locationId: "none", locationDetail: asset.location_detail ?? "" }));
    if (location) setOrderForm((form) => ({ ...form, facilityId: location.facility_id, assetId: "none", locationId: location.id, roomNumber: location.room_number ?? "", locationDetail: location.location_detail ?? "" }));
    if (asset || location) setShowOrder(true);
  }, [assets, locations]);

  useEffect(() => {
    if (facilities?.length !== 1) return;
    const id = facilities[0].id;
    setOrderForm((form) => form.facilityId ? form : { ...form, facilityId: id });
    setScheduleForm((form) => form.facilityId ? form : { ...form, facilityId: id });
    setLocationForm((form) => form.facilityId ? form : { ...form, facilityId: id });
  }, [facilities]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return orders ?? [];
    return (orders ?? []).filter((order) => [order.work_order_number, order.problem_description, order.room_number, order.location_detail, order.external_vendor]
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [orders, search]);

  const allOrders = orders ?? [];
  const openCount = allOrders.filter((o) => OPEN_STATUSES.has(o.status)).length;
  const overdueCount = allOrders.filter((o) => OPEN_STATUSES.has(o.status) && o.target_completion_at && new Date(o.target_completion_at) < new Date()).length;
  const verificationCount = allOrders.filter((o) => o.status === "pending_verification").length;

  const submitOrder = () => {
    if (!orderForm.facilityId || orderForm.description.trim().length < 3) {
      toast({ title: "Facility and problem description are required", variant: "destructive" });
      return;
    }
    createOrder.mutate({
      facilityId: orderForm.facilityId,
      problemDescription: orderForm.description.trim(),
      inspectionItemId: orderForm.assetId === "none" ? null : orderForm.assetId,
      maintenanceLocationId: orderForm.locationId === "none" ? null : orderForm.locationId,
      locationDetail: orderForm.locationDetail || null,
      roomNumber: orderForm.roomNumber || null,
      safetyRisk: orderForm.safetyRisk,
      priority: orderForm.priority,
      temporaryProtectiveAction: orderForm.protectiveAction || null,
      assignedEmployeeId: orderForm.employeeId === "none" ? null : orderForm.employeeId,
      externalVendor: orderForm.vendor || null,
      targetCompletionAt: orderForm.target ? new Date(orderForm.target).toISOString() : null,
      partsNeeded: orderForm.parts || null,
      estimatedCost: orderForm.estimatedCost ? Number(orderForm.estimatedCost) : null,
      residentImpact: orderForm.residentImpact || null,
    }, {
      onSuccess: (id) => { setShowOrder(false); setOrderForm(emptyOrder); navigate(`/app/maintenance/${id}`); },
      onError: (error: Error) => toast({ title: "Could not create work order", description: error.message, variant: "destructive" }),
    });
  };

  const submitLocation = () => {
    const facility = facilityById.get(locationForm.facilityId);
    if (!facility || !locationForm.label.trim()) return;
    createLocation.mutate({
      organization_id: facility.organization_id,
      facility_id: facility.id,
      label: locationForm.label.trim(),
      room_number: locationForm.roomNumber || null,
      location_detail: locationForm.detail || null,
    }, {
      onSuccess: () => { setShowLocation(false); setLocationForm({ facilityId: "", label: "", roomNumber: "", detail: "" }); toast({ title: "Maintenance location created" }); },
      onError: (error: Error) => toast({ title: "Could not create location", description: error.message, variant: "destructive" }),
    });
  };

  const submitSchedule = () => {
    const facility = facilityById.get(scheduleForm.facilityId);
    if (!facility || !scheduleForm.title.trim() || !scheduleForm.description.trim() || (scheduleForm.assetId === "none" && scheduleForm.locationId === "none")) {
      toast({ title: "Facility, asset/location, title, and instructions are required", variant: "destructive" });
      return;
    }
    createSchedule.mutate({
      organization_id: facility.organization_id,
      facility_id: facility.id,
      inspection_item_id: scheduleForm.assetId === "none" ? null : scheduleForm.assetId,
      maintenance_location_id: scheduleForm.locationId === "none" ? null : scheduleForm.locationId,
      title: scheduleForm.title.trim(),
      description: scheduleForm.description.trim(),
      frequency_unit: scheduleForm.frequencyUnit,
      frequency_interval: Number(scheduleForm.frequencyInterval) || 1,
      next_due_date: scheduleForm.nextDueDate,
      default_priority: scheduleForm.priority,
      assigned_employee_id: scheduleForm.employeeId === "none" ? null : scheduleForm.employeeId,
      external_vendor: scheduleForm.vendor || null,
      estimated_duration_minutes: scheduleForm.durationMinutes ? Number(scheduleForm.durationMinutes) : null,
      estimated_cost: scheduleForm.estimatedCost ? Number(scheduleForm.estimatedCost) : null,
      parts_needed: scheduleForm.parts || null,
      created_by_profile_id: user?.id ?? null,
    }, {
      onSuccess: () => { setShowSchedule(false); setScheduleForm(emptySchedule); toast({ title: "Preventive-maintenance schedule created" }); },
      onError: (error: Error) => toast({ title: "Could not create schedule", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Maintenance &amp; Work Orders</h1>
          <p>Control environmental repairs from report through supervisor verification, with QR labels and recurring preventive maintenance.</p>
        </div>
        {canManage && <Button onClick={() => setShowOrder(true)}><Plus className="mr-2 h-4 w-4" /> New work order</Button>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="pt-5"><Wrench className="h-5 w-5 text-primary" /><p className="mt-2 text-2xl font-bold">{openCount}</p><p className="text-sm text-muted-foreground">Open work orders</p></CardContent></Card>
        <Card><CardContent className="pt-5"><AlertTriangle className="h-5 w-5 text-destructive" /><p className="mt-2 text-2xl font-bold">{overdueCount}</p><p className="text-sm text-muted-foreground">Past target completion</p></CardContent></Card>
        <Card><CardContent className="pt-5"><ShieldAlert className="h-5 w-5 text-warning" /><p className="mt-2 text-2xl font-bold">{verificationCount}</p><p className="text-sm text-muted-foreground">Awaiting supervisor verification</p></CardContent></Card>
        <Card><CardContent className="pt-5"><CalendarClock className="h-5 w-5 text-primary" /><p className="mt-2 text-2xl font-bold">{(schedules ?? []).filter((s) => s.is_active).length}</p><p className="text-sm text-muted-foreground">Active PM schedules</p></CardContent></Card>
      </div>

      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList><TabsTrigger value="orders">Work orders</TabsTrigger><TabsTrigger value="preventive">Preventive maintenance</TabsTrigger><TabsTrigger value="locations">Room QR labels</TabsTrigger></TabsList>
        <TabsContent value="orders" className="space-y-4">
          <div className="filter-bar premium-card">
            <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search work orders" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <Select value={facilityId} onValueChange={setFacilityId}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All facilities</SelectItem>{facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select>
            <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{["open","assigned","in_progress","on_hold","pending_verification","verified","canceled"].map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="premium-card overflow-x-auto">
            {isLoading ? <div className="space-y-2 p-6">{[1,2,3].map((n) => <div key={n} className="h-12 animate-pulse rounded bg-muted" />)}</div> : filteredOrders.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">No work orders match these filters.</div> : (
              <table className="data-table min-w-[900px]"><thead><tr><th>Work order</th><th>Facility / location</th><th>Problem</th><th>Assignment</th><th>Target</th><th>Status</th></tr></thead><tbody>{filteredOrders.map((order) => {
                const employee = order.assigned_employee_id ? employeeById.get(order.assigned_employee_id) : undefined;
                const asset = order.inspection_item_id ? assetById.get(order.inspection_item_id) : undefined;
                const location = order.maintenance_location_id ? locationById.get(order.maintenance_location_id) : undefined;
                return <tr key={order.id}><td><Link className="font-semibold text-primary hover:underline" href={`/app/maintenance/${order.id}`}>{order.work_order_number}</Link><p className="mt-1 text-xs text-muted-foreground">{humanize(order.priority)} · {humanize(order.safety_risk)} risk</p></td><td><p>{facilityById.get(order.facility_id)?.name ?? "—"}</p><p className="text-xs text-muted-foreground">{asset?.label ?? location?.label ?? order.room_number ?? order.location_detail ?? "General"}</p></td><td className="max-w-sm"><p className="line-clamp-2">{order.problem_description}</p>{order.resident_impact && <p className="mt-1 text-xs text-warning">Resident impact recorded</p>}</td><td>{employee ? `${employee.first_name} ${employee.last_name}` : order.external_vendor || "Unassigned"}</td><td>{order.target_completion_at ? new Date(order.target_completion_at).toLocaleString() : "—"}</td><td>{workOrderBadge(order)}</td></tr>;
              })}</tbody></table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="preventive" className="space-y-4">
          <div className="flex flex-wrap justify-between gap-2">
            <p className="text-sm text-muted-foreground">Due schedules generate one open work order at a time and advance to their next recurring due date.</p>
            {canConfigure && <div className="flex gap-2"><Button variant="outline" onClick={() => generateDue.mutate(undefined, { onSuccess: (count) => toast({ title: `${count} due work order${count === 1 ? "" : "s"} generated` }), onError: (error: Error) => toast({ title: "Generation failed", description: error.message, variant: "destructive" }) })} disabled={generateDue.isPending}><RefreshCw className="mr-2 h-4 w-4" /> Generate due</Button><Button onClick={() => setShowSchedule(true)}><Plus className="mr-2 h-4 w-4" /> Add schedule</Button></div>}
          </div>
          <div className="grid gap-3">{(schedules ?? []).map((schedule) => {
            const asset = schedule.inspection_item_id ? assetById.get(schedule.inspection_item_id) : undefined;
            const location = schedule.maintenance_location_id ? locationById.get(schedule.maintenance_location_id) : undefined;
            return <Card key={schedule.id}><CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5"><div><div className="flex items-center gap-2"><p className="font-semibold">{schedule.title}</p><Badge variant={schedule.is_active ? "outline" : "secondary"}>{schedule.is_active ? "Active" : "Paused"}</Badge></div><p className="text-sm text-muted-foreground">{asset?.label ?? location?.label ?? "Maintenance location"} · Every {schedule.frequency_interval} {schedule.frequency_unit}{schedule.frequency_interval === 1 ? "" : "s"}</p><p className="mt-1 text-sm">Next due {schedule.next_due_date}</p></div>{canConfigure && <Button variant="outline" size="sm" onClick={() => updateSchedule.mutate({ id: schedule.id, is_active: !schedule.is_active })}>{schedule.is_active ? "Pause" : "Resume"}</Button>}</CardContent></Card>;
          })}{!schedules?.length && <div className="premium-card py-16 text-center text-sm text-muted-foreground">No preventive-maintenance schedules yet.</div>}</div>
        </TabsContent>

        <TabsContent value="locations" className="space-y-4">
          <div className="flex justify-between gap-2"><p className="text-sm text-muted-foreground">Create durable QR labels for rooms and shared environmental locations.</p>{canConfigure && <Button onClick={() => setShowLocation(true)}><Plus className="mr-2 h-4 w-4" /> Add location</Button>}</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{(locations ?? []).filter((location) => !selectedFacility || location.facility_id === selectedFacility).map((location) => <MaintenanceQrCode key={location.id} path={`/app/maintenance/scan/location/${location.qr_token}`} fileName={`maintenance-${location.label.replace(/\s+/g, "-").toLowerCase()}`} label={`${location.label}${location.room_number ? ` · Room ${location.room_number}` : ""}`} />)}{!(locations ?? []).some((location) => !selectedFacility || location.facility_id === selectedFacility) && <div className="premium-card col-span-full py-16 text-center text-sm text-muted-foreground">No room QR labels have been created.</div>}</div>
        </TabsContent>
      </Tabs>

      <Dialog open={showOrder} onOpenChange={setShowOrder}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>New environmental work order</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2">
        <div><Label>Facility *</Label><Select value={orderForm.facilityId} onValueChange={(value) => setOrderForm({ ...orderForm, facilityId: value, assetId: "none", locationId: "none" })}><SelectTrigger><SelectValue placeholder="Choose facility" /></SelectTrigger><SelectContent>{facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Asset / equipment</Label><Select value={orderForm.assetId} onValueChange={(value) => setOrderForm({ ...orderForm, assetId: value, locationId: value === "none" ? orderForm.locationId : "none" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No linked asset</SelectItem>{assets?.filter((a) => !orderForm.facilityId || a.facility_id === orderForm.facilityId).map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Room / QR location</Label><Select value={orderForm.locationId} onValueChange={(value) => setOrderForm({ ...orderForm, locationId: value, assetId: value === "none" ? orderForm.assetId : "none" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No linked room</SelectItem>{locations?.filter((l) => !orderForm.facilityId || l.facility_id === orderForm.facilityId).map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Room number</Label><Input value={orderForm.roomNumber} onChange={(e) => setOrderForm({ ...orderForm, roomNumber: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Problem description *</Label><Textarea value={orderForm.description} onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })} placeholder="Describe what is wrong and what was observed" /></div>
        <div><Label>Safety risk</Label><Select value={orderForm.safetyRisk} onValueChange={(value) => setOrderForm({ ...orderForm, safetyRisk: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["none","low","moderate","high","immediate_danger"].map((v) => <SelectItem key={v} value={v}>{humanize(v)}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Priority</Label><Select value={orderForm.priority} onValueChange={(value) => setOrderForm({ ...orderForm, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["routine","urgent","emergency"].map((v) => <SelectItem key={v} value={v}>{humanize(v)}</SelectItem>)}</SelectContent></Select></div>
        <div className="sm:col-span-2"><Label>Temporary protective action</Label><Textarea value={orderForm.protectiveAction} onChange={(e) => setOrderForm({ ...orderForm, protectiveAction: e.target.value })} placeholder="Area secured, equipment removed from service, alternate route posted…" /></div>
        <div><Label>Assigned maintenance employee</Label><Select value={orderForm.employeeId} onValueChange={(value) => setOrderForm({ ...orderForm, employeeId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{employees?.filter((e) => !orderForm.facilityId || e.facility_id === orderForm.facilityId).map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>External vendor</Label><Input value={orderForm.vendor} onChange={(e) => setOrderForm({ ...orderForm, vendor: e.target.value })} /></div>
        <div><Label>Target completion</Label><Input type="datetime-local" value={orderForm.target} onChange={(e) => setOrderForm({ ...orderForm, target: e.target.value })} /></div>
        <div><Label>Estimated cost</Label><Input type="number" min="0" step="0.01" value={orderForm.estimatedCost} onChange={(e) => setOrderForm({ ...orderForm, estimatedCost: e.target.value })} /></div>
        <div><Label>Parts needed</Label><Input value={orderForm.parts} onChange={(e) => setOrderForm({ ...orderForm, parts: e.target.value })} /></div>
        <div><Label>Location detail</Label><Input value={orderForm.locationDetail} onChange={(e) => setOrderForm({ ...orderForm, locationDetail: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Resident impact</Label><Textarea value={orderForm.residentImpact} onChange={(e) => setOrderForm({ ...orderForm, residentImpact: e.target.value })} placeholder="Access, noise, relocation, service interruption, or no resident impact" /></div>
      </div><DialogFooter><Button variant="outline" onClick={() => setShowOrder(false)}>Cancel</Button><Button onClick={submitOrder} disabled={createOrder.isPending}>{createOrder.isPending ? "Creating…" : "Create work order"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={showLocation} onOpenChange={setShowLocation}><DialogContent><DialogHeader><DialogTitle>Add room or maintenance location</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div><Label>Facility *</Label><Select value={locationForm.facilityId} onValueChange={(value) => setLocationForm({ ...locationForm, facilityId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Location label *</Label><Input value={locationForm.label} onChange={(e) => setLocationForm({ ...locationForm, label: e.target.value })} placeholder="East hallway bathroom" /></div><div><Label>Room number</Label><Input value={locationForm.roomNumber} onChange={(e) => setLocationForm({ ...locationForm, roomNumber: e.target.value })} /></div><div><Label>Location detail</Label><Textarea value={locationForm.detail} onChange={(e) => setLocationForm({ ...locationForm, detail: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowLocation(false)}>Cancel</Button><Button onClick={submitLocation} disabled={createLocation.isPending}>Create QR location</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={showSchedule} onOpenChange={setShowSchedule}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Add preventive-maintenance schedule</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2"><div><Label>Facility *</Label><Select value={scheduleForm.facilityId} onValueChange={(value) => setScheduleForm({ ...scheduleForm, facilityId: value, assetId: "none", locationId: "none" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Asset</Label><Select value={scheduleForm.assetId} onValueChange={(value) => setScheduleForm({ ...scheduleForm, assetId: value, locationId: value === "none" ? scheduleForm.locationId : "none" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Use a room instead</SelectItem>{assets?.filter((a) => a.facility_id === scheduleForm.facilityId).map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent></Select></div><div><Label>Room / location</Label><Select value={scheduleForm.locationId} onValueChange={(value) => setScheduleForm({ ...scheduleForm, locationId: value, assetId: value === "none" ? scheduleForm.assetId : "none" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Use an asset instead</SelectItem>{locations?.filter((l) => l.facility_id === scheduleForm.facilityId).map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}</SelectContent></Select></div><div><Label>Title *</Label><Input value={scheduleForm.title} onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })} /></div><div className="sm:col-span-2"><Label>Maintenance instructions *</Label><Textarea value={scheduleForm.description} onChange={(e) => setScheduleForm({ ...scheduleForm, description: e.target.value })} /></div><div><Label>Repeat every</Label><div className="flex gap-2"><Input type="number" min="1" value={scheduleForm.frequencyInterval} onChange={(e) => setScheduleForm({ ...scheduleForm, frequencyInterval: e.target.value })} /><Select value={scheduleForm.frequencyUnit} onValueChange={(value) => setScheduleForm({ ...scheduleForm, frequencyUnit: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["day","week","month","year"].map((v) => <SelectItem key={v} value={v}>{humanize(v)}</SelectItem>)}</SelectContent></Select></div></div><div><Label>Next due date</Label><Input type="date" value={scheduleForm.nextDueDate} onChange={(e) => setScheduleForm({ ...scheduleForm, nextDueDate: e.target.value })} /></div><div><Label>Default priority</Label><Select value={scheduleForm.priority} onValueChange={(value) => setScheduleForm({ ...scheduleForm, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["routine","urgent","emergency"].map((v) => <SelectItem key={v} value={v}>{humanize(v)}</SelectItem>)}</SelectContent></Select></div><div><Label>Assigned employee</Label><Select value={scheduleForm.employeeId} onValueChange={(value) => setScheduleForm({ ...scheduleForm, employeeId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{employees?.filter((e) => e.facility_id === scheduleForm.facilityId).map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent></Select></div><div><Label>External vendor</Label><Input value={scheduleForm.vendor} onChange={(e) => setScheduleForm({ ...scheduleForm, vendor: e.target.value })} /></div><div><Label>Estimated duration (minutes)</Label><Input type="number" min="0" value={scheduleForm.durationMinutes} onChange={(e) => setScheduleForm({ ...scheduleForm, durationMinutes: e.target.value })} /></div><div><Label>Estimated cost</Label><Input type="number" min="0" step="0.01" value={scheduleForm.estimatedCost} onChange={(e) => setScheduleForm({ ...scheduleForm, estimatedCost: e.target.value })} /></div><div><Label>Parts / supplies</Label><Input value={scheduleForm.parts} onChange={(e) => setScheduleForm({ ...scheduleForm, parts: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowSchedule(false)}>Cancel</Button><Button onClick={submitSchedule} disabled={createSchedule.isPending}>Save schedule</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
