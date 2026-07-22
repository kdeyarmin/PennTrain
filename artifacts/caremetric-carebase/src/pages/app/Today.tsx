import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Activity, AlertTriangle, BedDouble, Bot, CalendarDays, ClipboardList, Clock3, HelpCircle, Radar, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { RoleQuickStart } from "@/components/RoleQuickStart";
import { useAuth } from "@/lib/auth";
import { getTodayDestinations, summarizeDueWork } from "@/lib/todayWorkspace";
import { formatTimestampLabel, latestQueryUpdatedAt } from "@/lib/freshness";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListMyFacilityAssignments } from "@/hooks/useFacilityAssignments";
import { useListWorkItems } from "@/hooks/useWorkItems";
import { useListAlerts } from "@/hooks/useAlerts";
import { useDailyOperationsCommandCenter } from "@/hooks/useDailyOperations";
import { useProductValueWorkspace } from "@/hooks/useProductValueOperatingSystem";

function human(value: unknown) {
  return String(value ?? "").replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

// Persisted per tab so the chosen facility survives navigating away and back.
const FACILITY_STORAGE_KEY = "cmtrain.today.facilityId";
const ALL_FACILITIES = "all";

function loadStoredFacilityId(): string {
  try {
    return window.sessionStorage.getItem(FACILITY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeFacilityId(facilityId: string): void {
  try {
    window.sessionStorage.setItem(FACILITY_STORAGE_KEY, facilityId);
  } catch {
    // sessionStorage unavailable (private browsing, quota) -- the selection just won't persist
  }
}

export default function Today() {
  const { user } = useAuth();
  const isManager = user?.role === "facility_manager";
  const facilities = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  // facilities_select is org-wide, but the RPCs behind this page reject facilities the caller
  // isn't scoped to -- and is_assigned_to_facility() only auto-passes org_admin/auditor. So a
  // facility_manager's picker must be limited to their facility_assignments rows.
  const myAssignments = useListMyFacilityAssignments(user?.id, isManager);
  const [selectedFacilityId, setSelectedFacilityId] = useState(loadStoredFacilityId);
  const assignedIds = new Set((myAssignments.data ?? []).map((assignment) => assignment.facility_id));
  const facilityList = (facilities.data ?? []).filter((facility) => !isManager || assignedIds.has(facility.id));
  // A stored id may belong to another org/session; only honor it if it's still visible.
  const validSelection = facilityList.some((facility) => facility.id === selectedFacilityId) ? selectedFacilityId : "";
  // facility_manager is always scoped to one facility (defaulting to their first); org_admin
  // and auditor default to the whole portfolio and may narrow to one facility.
  const facilityId = isManager ? (validSelection || facilityList[0]?.id) : (validSelection || undefined);
  // Keep the React Query key stable for the life of this page. Rebuilding an ISO timestamp
  // during every render creates a distinct key on every render and can continuously refetch.
  const dueBefore = useMemo(() => new Date(Date.now() + 7 * 86_400_000).toISOString(), []);
  const operations = useDailyOperationsCommandCenter(facilityId);
  const work = useListWorkItems({ facilityId, dueBefore });
  const alerts = useListAlerts({ facilityId, status: "open" });
  const value = useProductValueWorkspace(facilityId);
  const destinations = getTodayDestinations(user?.role);
  const isAuditor = user?.role === "auditor";
  const PrimaryIcon = isAuditor ? ShieldCheck : Activity;
  const queries = [facilities, myAssignments, operations, work, alerts, value];
  const isRefreshing = queries.some((query) => query.isFetching);
  const refreshedAt = latestQueryUpdatedAt(queries.map((query) => query.dataUpdatedAt));

  if (queries.some((query) => query.isLoading)) return <QueryLoading what="today's priorities" />;
  const failed = queries.find((query) => query.isError);
  if (failed?.error) {
    return <QueryError
      what="today's priorities"
      error={failed.error}
      onRetry={() => void Promise.all(queries.map((query) => query.refetch()))}
    />;
  }

  const changeFacility = (next: string) => {
    const facility = next === ALL_FACILITIES ? "" : next;
    setSelectedFacilityId(facility);
    storeFacilityId(facility);
  };

  const daily = operations.data?.dailyExecution ?? {};
  const dueWork = summarizeDueWork(work.data ?? []);
  const criticalAlerts = (alerts.data ?? []).filter((item) => item.severity === "critical");
  const portalRequests = value.data?.portalRequests.filter((item) => item.status === "open") ?? [];
  const medicationExceptions = value.data?.medicationExceptions ?? [];
  const pendingDrafts = value.data?.copilotDrafts.filter((item) => item.status === "draft") ?? [];
  const warRoomRequests = (value.data?.warRooms ?? []).flatMap((room) => room.requests ?? []).filter((item) => !["verified", "closed", "canceled"].includes(item.status));
  const selectedFacility = facilityList.find((facility) => facility.id === facilityId);
  const scopeLabel = selectedFacility?.name ?? "all permitted facilities";

  const priorities = [
    { label: "Critical alerts", value: criticalAlerts.length, detail: "Compliance risks requiring review", href: "/app/alerts", icon: AlertTriangle, urgent: criticalAlerts.length > 0 },
    {
      label: "Due work",
      value: dueWork.totalCount,
      detail: dueWork.overdueCount > 0
        ? `${dueWork.overdueCount} overdue · ${dueWork.upcomingCount} due within seven days`
        : `${dueWork.upcomingCount} due within seven days`,
      href: "/app/work",
      icon: ClipboardList,
      urgent: dueWork.overdueCount > 0 || dueWork.activeItems.some((item) => item.priority === "urgent"),
    },
    { label: "Open handoffs", value: Number(daily.openHandoffItems ?? 0), detail: `${Number(daily.urgentHandoffItems ?? 0)} urgent`, href: destinations.handoffs, icon: RefreshCw, urgent: Number(daily.urgentHandoffItems ?? 0) > 0 },
    { label: "Coverage gaps", value: Number(daily.unfilledShifts ?? 0), detail: `${Number(daily.openShiftOffers ?? 0)} open-shift offers`, href: destinations.coverage, icon: Users, urgent: Number(daily.unfilledShifts ?? 0) > 0 },
    { label: "Inspection requests", value: warRoomRequests.length, detail: "Evidence requests awaiting verification", href: destinations.inspection, icon: Radar, urgent: false },
    { label: "Resident & med requests", value: portalRequests.length + medicationExceptions.length, detail: `${portalRequests.length} portal · ${medicationExceptions.length} medication`, href: destinations.residentAndMedication, icon: BedDouble, urgent: medicationExceptions.some((item) => item.severity === "urgent") },
  ];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Start here</Badge>
          <span className="text-xs text-muted-foreground">Refreshed {formatTimestampLabel(refreshedAt)}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <p className="text-muted-foreground">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {user?.firstName}. These are the decisions and follow-ups that move care, staffing, and compliance forward now.</p>
        <p className="mt-1 text-xs text-muted-foreground">Showing {scopeLabel}.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {facilityList.length > 1 && <Select value={facilityId ?? ALL_FACILITIES} onValueChange={changeFacility}>
          <SelectTrigger className="w-56" aria-label="Facility scope"><SelectValue placeholder="Select facility" /></SelectTrigger>
          <SelectContent>
            {!isManager && <SelectItem value={ALL_FACILITIES}>All permitted facilities</SelectItem>}
            {facilityList.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}
          </SelectContent>
        </Select>}
        <Button
          type="button"
          variant="outline"
          disabled={isRefreshing}
          onClick={() => void Promise.all(queries.map((query) => query.refetch()))}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />Refresh
        </Button>
        <Button asChild variant="outline"><Link href={destinations.primary.href}><PrimaryIcon className="mr-2 h-4 w-4" />{destinations.primary.label}</Link></Button>
      </div>
    </div>
    <RoleQuickStart
      role={user?.role}
      title="Your daily quick start"
      description="Use these role-specific steps when you are not sure where to begin."
    />
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">How to use Today</p>
            <p className="text-sm text-muted-foreground">Work left to right: clear urgent red cards first, complete due work, then review automation drafts before the end of shift.</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/app/help">Open help center</Link></Button>
      </CardContent>
    </Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{priorities.map((item) => <Link key={item.label} href={item.href} className={`rounded-xl border bg-card p-5 shadow-sm transition hover:bg-muted/40 ${item.urgent ? "border-destructive/50" : ""}`}><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">{item.label}</p><p className="mt-1 text-3xl font-bold">{item.value}</p></div><item.icon className={`h-5 w-5 ${item.urgent ? "text-destructive" : "text-muted-foreground"}`} /></div><p className="mt-3 text-xs text-muted-foreground">{item.detail}</p></Link>)}</div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Next work to complete</CardTitle><CardDescription>Overdue work and items due within seven days for {scopeLabel}.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {dueWork.visibleItems.length ? dueWork.visibleItems.map((item) => <Button key={item.id} asChild variant="outline" className="h-auto w-full justify-between py-3 text-left"><Link href={`/app/work/${item.id}`}><span><span className="block font-medium">{item.title}</span><span className="block text-xs text-muted-foreground">{item.facility?.name ?? "Facility"} · due {new Date(item.due_at).toLocaleString()}</span></span><Badge variant={item.priority === "urgent" ? "destructive" : "secondary"}>{human(item.priority)}</Badge></Link></Button>) : <div className="flex items-center gap-2 rounded border border-dashed p-6 text-sm text-emerald-700"><ShieldCheck className="h-4 w-4" />No work items are due within seven days. Use the cards above to review alerts, handoffs, and coverage next.</div>}
          {dueWork.totalCount > dueWork.visibleItems.length && <Button asChild variant="ghost" className="w-full"><Link href="/app/work">View all {dueWork.totalCount} due work items</Link></Button>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Human review queue</CardTitle><CardDescription>Assistant drafts and automation stay governed until a responsible person reviews the proposed action.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="rounded border p-4"><p className="text-sm text-muted-foreground">Assistant drafts awaiting review</p><p className="text-3xl font-bold">{pendingDrafts.length}</p></div><div className="rounded border p-4"><p className="text-sm text-muted-foreground">Recent automation receipts</p><p className="text-3xl font-bold">{value.data?.automationRuns.length ?? 0}</p></div><Button asChild><Link href={destinations.primary.href}>{isAuditor ? "Review supporting records" : "Review governed actions"}</Link></Button></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Morning huddle</CardTitle><CardDescription>Current facility operations assembled from scheduling, services, handoffs, and open work.</CardDescription></CardHeader><CardContent>{operations.data?.morningHuddle?.length ? <div className="grid gap-3 md:grid-cols-2">{operations.data.morningHuddle.map((item, index) => <div key={`${item.title ?? "huddle"}-${index}`} className="rounded border p-3"><p className="font-medium">{item.title ?? item.label ?? "Operational update"}</p><p className="text-sm text-muted-foreground">{item.detail ?? item.description ?? human(item.status)}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No huddle exceptions are active.</p>}</CardContent></Card>
  </div>;
}
