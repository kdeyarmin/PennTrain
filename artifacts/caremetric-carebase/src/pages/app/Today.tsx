import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity, Bot, CalendarDays, Clock3, HelpCircle, Info, LayoutDashboard, RefreshCw, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { RoleQuickStart } from "@/components/RoleQuickStart";
import { OrganizationSetupGuide } from "@/components/OrganizationSetupGuide";
import { SurfacePurpose } from "@/components/SurfacePurpose";
import { useAuth } from "@/lib/auth";
import { getTodayDestinations } from "@/lib/todayWorkspace";
import { buildHomeMetrics, firstCall, highlightMetrics } from "@/lib/homeMetrics";
import { groupByCategory, workItemSourceLabel } from "@/lib/workItemSources";
import { formatTimestampLabel, latestQueryUpdatedAt } from "@/lib/freshness";
import { addFacilityCalendarDays, facilityDayBounds, facilityToday } from "@/lib/dateUtils";
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

/**
 * Today -- the daily command centre (program plan Phase 7b, request item 16).
 *
 * WHY THIS IS STILL /app/today. The plan called for a new Today route with redirects from the old
 * ones. Reusing this route does the same job better: every existing link, sidebar entry, saved
 * navigation favourite, and user bookmark keeps working with no redirect hop and no chance of one
 * being missed. The surface is renamed; the address is not.
 *
 * EVERY NUMBER HERE HAS ONE DEFINITION. The counts come from `homeMetrics.ts`, which exists because
 * "Critical alerts" meant an org-wide figure on Dashboard and a facility-scoped one on Today, with
 * neither surface saying which. Each card states its scope, and its rule is one hover away -- a
 * number whose definition is invisible is a number two people will read differently.
 */
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
  // Bound is facility end-of-day seven calendar days out — not browser `Date.now() + 7d`.
  const dueBefore = useMemo(
    () => facilityDayBounds(addFacilityCalendarDays(facilityToday(), 7)).through,
    [],
  );
  const operations = useDailyOperationsCommandCenter(facilityId);
  const work = useListWorkItems({ facilityId, dueBefore });
  const alerts = useListAlerts({ facilityId, status: "open" });
  const value = useProductValueWorkspace(facilityId);
  const destinations = getTodayDestinations(user?.role);
  // Only an org_admin can create facilities or invite users (see facilities_insert /
  // profiles RLS), so nobody else is shown a checklist they cannot act on.
  const canSetUpOrganization = user?.role === "org_admin";
  const isAuditor = user?.role === "auditor";
  const PrimaryIcon = isAuditor ? ShieldCheck : Activity;
  const queries = [facilities, myAssignments, operations, work, alerts, value];
  const isRefreshing = queries.some((query) => query.isFetching);
  const refreshedAt = latestQueryUpdatedAt(queries.map((query) => query.dataUpdatedAt));

  if (queries.some((query) => query.isLoading)) return <QueryLoading what="today's priorities" />;
  const failed = queries.find((query) => query.isError);
  if (failed?.error) {
    // Still offer the setup path here: an organization with no facility yet is exactly the
    // one whose daily-operations RPCs are most likely to come back unhappy, and bouncing a
    // brand-new admin to a bare error is the dead end this guide exists to remove.
    return <div className="space-y-6">
      {canSetUpOrganization && <OrganizationSetupGuide organizationId={user?.organizationId ?? undefined} />}
      <QueryError
        what="today's priorities"
        error={failed.error}
        onRetry={() => void Promise.all(queries.map((query) => query.refetch()))}
      />
    </div>;
  }

  const changeFacility = (next: string) => {
    const facility = next === ALL_FACILITIES ? "" : next;
    setSelectedFacilityId(facility);
    storeFacilityId(facility);
  };

  const daily = operations.data?.dailyExecution ?? {};
  const selectedFacility = facilityList.find((facility) => facility.id === facilityId);
  const workItems = work.data ?? [];

  const metrics = buildHomeMetrics({
    workItems,
    alerts: alerts.data ?? [],
    unfilledShifts: Number(daily.unfilledShifts ?? 0),
    openHandoffs: Number(daily.openHandoffItems ?? 0),
    facilityName: selectedFacility?.name ?? null,
  });
  const shown = highlightMetrics(metrics);
  const next = firstCall(metrics);
  const scopeLabel = metrics[0]?.scopeLabel ?? "all permitted facilities";

  // What the outstanding work actually is, by the Phase 7a taxonomy. A queue of forty items reads
  // as forty things; grouped, it reads as "three assessments and a credential".
  const activeItems = workItems.filter((item) => !["closed", "canceled"].includes(item.state));
  const groups = groupByCategory(activeItems);
  const soonest = [...activeItems]
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
    .slice(0, 8);

  // The queue defaults to "My work". Today's figures are not owner-filtered, so a card linking
  // through without a scope would land on a list that disagrees with the number just clicked.
  const scopedHref = (href: string) => {
    if (!href.startsWith("/app/work")) return href;
    const [path, query] = href.split("?");
    const params = new URLSearchParams(query ?? "");
    if (facilityId) {
      params.set("scope", "facility");
      params.set("facilityId", facilityId);
    } else {
      params.set("scope", "organization");
    }
    return `${path}?${params.toString()}`;
  };

  const pendingDrafts = value.data?.copilotDrafts.filter((item) => item.status === "draft") ?? [];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Start here</Badge>
          <span className="text-xs text-muted-foreground">Refreshed {formatTimestampLabel(refreshedAt)}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <p className="text-muted-foreground">
          Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {user?.firstName}.
          {next
            ? ` Start with ${next.label.toLowerCase()}.`
            : " Nothing is overdue or urgent right now."} This surface owns action, due work, and manager decisions.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Every figure below covers {scopeLabel}.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {facilityList.length > 1 && <Select value={facilityId ?? ALL_FACILITIES} onValueChange={changeFacility}>
          <SelectTrigger className="w-56" aria-label="Facility scope"><SelectValue placeholder="Select facility" /></SelectTrigger>
          <SelectContent>
            {!isManager && <SelectItem value={ALL_FACILITIES}>All permitted facilities</SelectItem>}
            {facilityList.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}
          </SelectContent>
        </Select>}
        <Button asChild variant="outline">
          <Link href="/app">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Compliance scorecard
          </Link>
        </Button>
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

    <SurfacePurpose purpose="Today = action and due work. Compliance scorecard = health and trends. Inspection Readiness = prep. Survey Day = the live entrance conference." />

    {/* A brand-new organization has no facility and no roster, so every card below reads
        zero and the daily quick start points at pages that are all empty. This is the
        first-run path out of that; it retires itself once the org is operating. */}
    {canSetUpOrganization && <OrganizationSetupGuide organizationId={user?.organizationId ?? undefined} />}

    <RoleQuickStart
      role={user?.role}
      title="Your daily quick start"
      description="Use these role-specific steps when you are not sure where to begin."
    />

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {shown.map((metric) => (
        <Link
          key={metric.key}
          href={scopedHref(metric.href)}
          className={`rounded-xl border bg-card p-5 shadow-sm transition hover:bg-muted/40 ${metric.urgent ? "border-destructive/50" : ""}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">{metric.label}</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              {/* The rule is one hover away on every card. Two surfaces disagreeing about what a
                  number meant is what this whole merge exists to end. */}
              <TooltipContent className="max-w-xs">{metric.definition}</TooltipContent>
            </Tooltip>
          </div>
          <p className={`mt-1 text-3xl font-bold ${metric.urgent ? "text-destructive" : ""}`}>{metric.value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{metric.scopeLabel}</p>
        </Link>
      ))}
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Next work to complete</CardTitle>
          <CardDescription>The soonest-due open work for {scopeLabel}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {soonest.length ? soonest.map((item) => (
            <Button key={item.id} asChild variant="outline" className="h-auto w-full justify-between py-3 text-left">
              <Link href={`/app/work/${item.id}`}>
                <span>
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {workItemSourceLabel(item.source_type)} · {item.facility?.name ?? "Facility"} · due {new Date(item.due_at).toLocaleString()}
                  </span>
                </span>
                <Badge variant={item.priority === "urgent" ? "destructive" : "secondary"}>{human(item.priority)}</Badge>
              </Link>
            </Button>
          )) : (
            <div className="flex items-center gap-2 rounded border border-dashed p-6 text-sm text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              No work is due in the next seven days. The cards above show what else is open.
            </div>
          )}
          {activeItems.length > soonest.length && (
            <Button asChild variant="ghost" className="w-full">
              <Link href={scopedHref("/app/work")}>View all {activeItems.length} open work items</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />What the work is</CardTitle>
          <CardDescription>Open work grouped by where it came from, using the shared source taxonomy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length ? groups.map((group) => (
            <div key={group.category}>
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">{group.label}</p>
                <span className="text-sm tabular-nums text-muted-foreground">{group.count}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {group.types.map((type) => (
                  <Link key={type.key} href={scopedHref(`/app/work?sourceType=${type.key}`)}>
                    <Badge variant="outline" className="hover:bg-muted">
                      {type.label} <span className="ml-1 tabular-nums text-muted-foreground">{type.count}</span>
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">No open work in this scope.</p>
          )}
        </CardContent>
      </Card>
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Human review queue</CardTitle>
          <CardDescription>Assistant drafts and automation stay governed until a responsible person reviews the proposed action.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded border p-4">
            <p className="text-sm text-muted-foreground">Assistant drafts awaiting review</p>
            <p className="text-3xl font-bold">{pendingDrafts.length}</p>
          </div>
          <div className="rounded border p-4">
            <p className="text-sm text-muted-foreground">Recent automation receipts</p>
            <p className="text-3xl font-bold">{value.data?.automationRuns.length ?? 0}</p>
          </div>
          <Button asChild><Link href={destinations.primary.href}>{isAuditor ? "Review supporting records" : "Review governed actions"}</Link></Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Morning huddle</CardTitle>
          <CardDescription>Current facility operations assembled from scheduling, services, handoffs, and open work.</CardDescription>
        </CardHeader>
        <CardContent>
          {operations.data?.morningHuddle?.length ? (
            <div className="grid gap-3">
              {operations.data.morningHuddle.slice(0, 8).map((item, index) => (
                <div key={`${item.title ?? "huddle"}-${index}`} className="rounded border p-3">
                  <p className="font-medium">{item.title ?? item.label ?? "Operational update"}</p>
                  <p className="text-sm text-muted-foreground">{item.detail ?? item.description ?? human(item.status)}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No huddle exceptions are active.</p>}
        </CardContent>
      </Card>
    </div>

    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">How to use Today</p>
            <p className="text-sm text-muted-foreground">
              Clear the red cards first, then work the soonest-due list. Hover any figure to see
              exactly what it counts.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/app/help">Open help center</Link></Button>
      </CardContent>
    </Card>
  </div>;
}
