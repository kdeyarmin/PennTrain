import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListIncidents, useCreateIncident, type IncidentInsert,
} from "@/hooks/useIncidents";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

const INCIDENT_TYPE_OPTIONS = [
  "death", "elopement", "abuse_allegation", "neglect_allegation", "medication_error",
  "significant_injury", "assault", "fire", "environmental_emergency", "other",
] as const;

const NOTIFICATION_TYPE_OPTIONS = [
  "state_hotline", "family_guardian", "law_enforcement", "licensing_agency", "other",
] as const;

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SeverityBadge({ severity }: { severity: string }) {
  const className =
    severity === "critical" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : severity === "major" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : severity === "moderate" ? "bg-info text-info-foreground hover:bg-info/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"; // minor
  return <Badge className={className} variant="outline">{humanize(severity)}</Badge>;
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "closed" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "investigating" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : "bg-muted text-muted-foreground"; // reported
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

interface IncidentFormData {
  facilityId: string;
  incidentType: (typeof INCIDENT_TYPE_OPTIONS)[number];
  occurredAt: string;
  residentIdentifier: string;
  locationDetail: string;
  narrative: string;
  severity: "minor" | "moderate" | "major" | "critical";
}

// A function, not a frozen constant: occurredAt must reflect "now" at the moment a form is
// actually opened/reset, not the moment this module was first loaded -- a tab left open for
// hours (or a second incident reported after the first) would otherwise keep prefilling a
// long-stale timestamp instead of the current time.
function emptyForm(): IncidentFormData {
  return {
    facilityId: "", incidentType: "other", occurredAt: toLocalDatetimeInputValue(new Date()),
    residentIdentifier: "", locationDetail: "", narrative: "", severity: "moderate",
  };
}

interface StaffRow { employeeId: string; involvementType: "involved_party" | "witness" | "first_responder" | "reporter" }
interface NotificationRow { notificationType: (typeof NOTIFICATION_TYPE_OPTIONS)[number]; dueInHours: string }

export default function Incidents() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [facilityFilter, setFacilityFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<IncidentFormData>(emptyForm);
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>([]);

  // Matches incidents_select RLS -- trainer and self-service are both excluded, unlike almost
  // every other module, since incident sensitivity is about the incident itself, not one
  // employee's own record.
  const canManage = ["org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: incidents, isLoading } = useListIncidents({
    facilityId: facilityFilter !== "all" ? facilityFilter : undefined,
    severity: severityFilter !== "all" ? severityFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { mutate: createIncident, isPending: creating } = useCreateIncident();

  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);

  const allIncidents = incidents ?? [];
  const totalPages = Math.max(1, Math.ceil(allIncidents.length / PAGE_SIZE));
  const paginated = allIncidents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setForm(emptyForm());
    setStaffRows([]);
    setNotificationRows([]);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.facilityId || !form.narrative.trim()) {
      toast({ title: "Facility and narrative are required", variant: "destructive" });
      return;
    }
    const facility = facilityById.get(form.facilityId);
    if (!facility) return;

    const payload: IncidentInsert = {
      organization_id: facility.organization_id,
      facility_id: facility.id,
      incident_type: form.incidentType,
      occurred_at: new Date(form.occurredAt).toISOString(),
      resident_identifier: form.residentIdentifier || null,
      location_detail: form.locationDetail || null,
      narrative: form.narrative.trim(),
      severity: form.severity,
      reported_by_profile_id: user?.id ?? null,
    };

    createIncident(
      {
        ...payload,
        staffInvolved: staffRows.filter((r) => r.employeeId).map((r) => ({ employee_id: r.employeeId, involvement_type: r.involvementType, statement: null })),
        notifications: notificationRows.map((r) => ({
          notification_type: r.notificationType,
          due_at: new Date(Date.now() + Number(r.dueInHours || 24) * 3600_000).toISOString(),
        })),
      },
      {
        onSuccess: () => { toast({ title: "Incident reported" }); setShowForm(false); },
        onError: (e: Error) => toast({ title: "Failed to report incident", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Incidents &amp; Complaints</h1>
          <p>Log and track reportable incidents, required notifications, and investigations.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Report Incident
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <Select value={facilityFilter} onValueChange={(v) => { setFacilityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card"><SelectValue placeholder="All Facilities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9 bg-card"><SelectValue placeholder="All Severities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              {["minor", "moderate", "major", "critical"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9 bg-card"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["reported", "investigating", "closed"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No incidents found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Report an incident to get started." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Occurred</th>
                    <th>Facility</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((i) => (
                    <tr key={i.id}>
                      <td className="text-muted-foreground">{new Date(i.occurred_at).toLocaleString()}</td>
                      <td className="font-medium text-foreground">{facilityById.get(i.facility_id)?.name ?? "—"}</td>
                      <td className="text-muted-foreground">{humanize(i.incident_type)}</td>
                      <td><SeverityBadge severity={i.severity} /></td>
                      <td><StatusPill status={i.status} /></td>
                      <td>
                        <Link href={`/app/incidents/${i.id}`} className="text-sm text-primary hover:underline">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, allIncidents.length)}</span> of {allIncidents.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Report Incident</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Facility *</Label>
                <Select value={form.facilityId} onValueChange={(v) => setForm((f) => ({ ...f, facilityId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>
                    {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Incident Type *</Label>
                <Select value={form.incidentType} onValueChange={(v) => setForm((f) => ({ ...f, incidentType: v as IncidentFormData["incidentType"] }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Occurred At *</Label>
                <Input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Severity *</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v as IncidentFormData["severity"] }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["minor", "moderate", "major", "critical"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Resident Identifier</Label>
                <Input value={form.residentIdentifier} onChange={(e) => setForm((f) => ({ ...f, residentIdentifier: e.target.value }))} placeholder="Name or room number" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Location</Label>
                <Input value={form.locationDetail} onChange={(e) => setForm((f) => ({ ...f, locationDetail: e.target.value }))} className="h-9" />
              </div>
              <div className="col-span-full space-y-1.5">
                <Label className="text-[13px]">Narrative *</Label>
                <Textarea value={form.narrative} onChange={(e) => setForm((f) => ({ ...f, narrative: e.target.value }))} placeholder="What happened, what was done immediately" rows={4} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[13px]">Staff Involved</Label>
                <Button variant="outline" size="sm" onClick={() => setStaffRows((r) => [...r, { employeeId: "", involvementType: "witness" }])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              </div>
              {staffRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={row.employeeId} onValueChange={(v) => setStaffRows((rs) => rs.map((r, i) => i === idx ? { ...r, employeeId: v } : r))}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
                    <SelectContent>
                      {employees?.map((e) => <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={row.involvementType} onValueChange={(v) => setStaffRows((rs) => rs.map((r, i) => i === idx ? { ...r, involvementType: v as StaffRow["involvementType"] } : r))}>
                    <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["involved_party", "witness", "first_responder", "reporter"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setStaffRows((rs) => rs.filter((_, i) => i !== idx))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[13px]">Additional Notifications</Label>
                  <p className="text-xs text-muted-foreground">
                    The state-hotline/law-enforcement notification this incident type requires is added automatically on save. Add any others here (e.g. family/guardian).
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setNotificationRows((r) => [...r, { notificationType: "family_guardian", dueInHours: "24" }])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              </div>
              {notificationRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={row.notificationType} onValueChange={(v) => setNotificationRows((rs) => rs.map((r, i) => i === idx ? { ...r, notificationType: v as NotificationRow["notificationType"] } : r))}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NOTIFICATION_TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Input type="number" min={1} value={row.dueInHours} onChange={(e) => setNotificationRows((rs) => rs.map((r, i) => i === idx ? { ...r, dueInHours: e.target.value } : r))} className="h-9 w-20" />
                    <span className="text-xs text-muted-foreground">hrs</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setNotificationRows((rs) => rs.filter((_, i) => i !== idx))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating} className="shadow-sm">
              {creating ? "Saving..." : "Report Incident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
