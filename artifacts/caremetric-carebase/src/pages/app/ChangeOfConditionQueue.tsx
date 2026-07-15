import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Plus,
  Siren,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import {
  useChangeEventResidentOptions,
  useListResidentChangeEvents,
  type ResidentChangeEventWithRelations,
} from "@/hooks/useResidentChangeEvents";
import { LogChangeOfConditionDialog } from "@/components/residents/LogChangeOfConditionDialog";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = [
  "fall", "emergency_department_visit", "hospital_return", "mobility_decline",
  "skin_concern", "appetite_intake_change", "weight_concern",
  "mental_status_change", "behavioral_change", "infection_symptoms",
  "continence_change", "new_supervision_concern",
  "hospice_end_of_life_change", "other_significant_change",
];
const STATUSES = ["open", "monitoring", "follow_up_due", "pending_supervisor_review", "closed"];
const CHANGE_QUEUE_URL_DEFAULTS = { facility: "all", resident: "all", status: "active", category: "all", search: "" };
const STATUS_CLASS: Record<string, string> = {
  open: "bg-blue-100 text-blue-900",
  monitoring: "bg-cyan-100 text-cyan-900",
  follow_up_due: "bg-red-100 text-red-900",
  pending_supervisor_review: "bg-purple-100 text-purple-900",
  closed: "bg-emerald-100 text-emerald-900",
};

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function detailPath(role: string | undefined, id: string): string {
  return `${role === "employee" ? "/me" : "/app"}/change-of-condition/${id}`;
}

function isOverdue(event: ResidentChangeEventWithRelations): boolean {
  return event.status !== "closed" && new Date(event.follow_up_due_at) < new Date();
}

export default function ChangeOfConditionQueue() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const isEmployee = user?.role === "employee";
  const canCreate = user?.role !== "auditor";
  const [filters, setFilters] = useUrlState(CHANGE_QUEUE_URL_DEFAULTS);
  const facilityId = filters.facility;
  const status = filters.status;
  const category = filters.category;
  const search = filters.search;
  const [showCreate, setShowCreate] = useState(false);
  const events = useListResidentChangeEvents({
    organizationId,
    facilityId: facilityId === "all" ? undefined : facilityId,
    residentId: filters.resident === "all" ? undefined : filters.resident,
    status: status !== "all" && status !== "active" ? status : undefined,
    assignedProfileId: isEmployee ? user?.id : undefined,
    category: category === "all" ? undefined : category,
  });
  const { data: facilities } = useListFacilities({ organizationId });
  const residentOptions = useChangeEventResidentOptions();

  const filtered = useMemo(() => (events.data ?? []).filter(event => {
    if (status === "active" && event.status === "closed") return false;
    if (search && !`${event.resident?.first_name} ${event.resident?.last_name} ${event.immediate_observations}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [events.data, search, status]);
  const openCount = (events.data ?? []).filter(event => event.status !== "closed").length;
  const overdueCount = (events.data ?? []).filter(isOverdue).length;
  const emergencyCount = (events.data ?? []).filter(event => event.emergency_transfer && event.status !== "closed").length;
  const reviewCount = (events.data ?? []).filter(event => event.status === "pending_supervisor_review").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Activity className="h-6 w-6" />{isEmployee ? "My Change Follow-Ups" : "Change-of-Condition Management"}</h1>
          <p className="text-muted-foreground">Guided observations, notifications, monitoring, reassessment, follow-up, and supervisor review—without diagnosis.</p>
        </div>
        {canCreate && <Button onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Report change</Button>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Open events", value: openCount, icon: Activity, color: "text-blue-600" },
          { label: "Follow-up overdue", value: overdueCount, icon: Clock3, color: "text-red-600" },
          { label: "Emergency transfers", value: emergencyCount, icon: Siren, color: "text-amber-600" },
          { label: "Supervisor review", value: reviewCount, icon: CheckCircle2, color: "text-purple-600" },
        ].map(metric => <Card key={metric.label}><CardContent className="flex items-center gap-3 pt-6"><metric.icon className={`h-7 w-7 ${metric.color}`} /><div><p className="text-2xl font-bold">{events.isLoading ? "—" : metric.value}</p><p className="text-sm text-muted-foreground">{metric.label}</p></div></CardContent></Card>)}
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {!isEmployee && <Select value={facilityId} onValueChange={(value) => setFilters({ facility: value, resident: "all" })}><SelectTrigger><SelectValue placeholder="All facilities" /></SelectTrigger><SelectContent><SelectItem value="all">All facilities</SelectItem>{facilities?.map(facility => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select>}
            <Select value={filters.resident} onValueChange={(value) => setFilters({ resident: value })}><SelectTrigger><SelectValue placeholder="All residents" /></SelectTrigger><SelectContent><SelectItem value="all">All residents</SelectItem>{(residentOptions.data ?? []).map((resident) => <SelectItem key={resident.id} value={resident.id}>{resident.last_name}, {resident.first_name}</SelectItem>)}</SelectContent></Select>
            <Select value={status} onValueChange={(value) => setFilters({ status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">All active</SelectItem><SelectItem value="all">All statuses</SelectItem>{STATUSES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>
            <Select value={category} onValueChange={(value) => setFilters({ category: value })}><SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>
            <Input value={search} onChange={event => setFilters({ search: event.target.value })} placeholder="Search resident or observations" />
          </div>

          {events.isError ? <QueryError what="change-of-condition events" error={events.error} onRetry={() => events.refetch()} /> : events.isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, index) => <div key={index} className="h-16 animate-pulse rounded bg-muted" />)}</div>
          ) : !filtered.length ? (
            <div className="py-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" /><p className="font-medium">No change events match this view</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead><tr><th>Resident</th><th>Change</th><th>Identified</th><th>Assigned</th><th>Follow-up due</th><th>Decisions</th><th>Status</th><th /></tr></thead>
                <tbody>{filtered.map(event => (
                  <tr key={event.id}>
                    <td><p className="font-medium">{event.resident?.first_name} {event.resident?.last_name}</p><p className="text-xs text-muted-foreground">{event.facility?.name} · Room {event.resident?.room ?? "—"}</p></td>
                    <td><p className="font-medium">{humanize(event.category)}</p><p className="max-w-[240px] truncate text-xs text-muted-foreground">{event.immediate_observations}</p></td>
                    <td className="text-sm">{new Date(event.identified_at).toLocaleString()}</td>
                    <td className="text-sm">{event.assigned ? `${event.assigned.first_name} ${event.assigned.last_name}` : "Unassigned"}</td>
                    <td className={`text-sm ${isOverdue(event) ? "font-medium text-red-700" : ""}`}>{isOverdue(event) && <AlertTriangle className="mr-1 inline h-4 w-4" />}{new Date(event.follow_up_due_at).toLocaleString()}</td>
                    <td className="text-xs"><p>Incident: {humanize(event.incident_decision)}</p><p>Reassessment: {event.reassessment_required ? "Required" : "Not required"}</p></td>
                    <td><Badge variant="outline" className={`border-0 ${STATUS_CLASS[event.status]}`}>{humanize(event.status)}</Badge></td>
                    <td><Button asChild size="sm" variant="outline"><Link href={detailPath(user?.role, event.id)}>Open <ChevronRight className="h-4 w-4" /></Link></Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <LogChangeOfConditionDialog open={showCreate} onOpenChange={setShowCreate} residents={residentOptions.data ?? []} />
    </div>
  );
}
