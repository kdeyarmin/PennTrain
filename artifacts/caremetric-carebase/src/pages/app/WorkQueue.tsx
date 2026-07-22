import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardList, Clock3, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import { useUrlState } from "@/hooks/useUrlState";
import { usePaginatedWorkItems } from "@/hooks/useWorkItems";
import { useWorkItemListSummary, EMPTY_WORK_ITEM_LIST_SUMMARY } from "@/hooks/useDomainListSummaries";
import {
  isWorkItemOverdue,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_STATES,
  WORK_ITEM_STATE_LABELS,
  workQueuePathForRole,
  workQueuePresentationForRole,
} from "@/lib/workItemQueue";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const URL_DEFAULTS = {
  scope: "mine",
  search: "",
  facilityId: "all",
  state: "active",
  priority: "all",
  sourceType: "all",
  due: "all",
  ownerId: "all",
  page: "1",
};

const PAGE_SIZE = 25;

const SOURCE_LABELS: Record<string, string> = {
  incident: "Incident",
  near_miss: "Near miss",
  violation: "Violation",
  inspection: "Inspection",
  training_gap: "Training gap",
  exclusion_match: "Exclusion match",
  credential: "Credential",
  policy: "Policy",
  rule_exception: "Rule exception",
  move_in: "Move-in",
  complaint: "Complaint",
  support_plan: "Support plan",
  qapi: "QAPI",
  resident_calendar: "Resident calendar",
  resident_finance: "Resident finance",
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "border-red-300 bg-red-100 text-red-900",
  high: "border-amber-300 bg-amber-100 text-amber-900",
  normal: "border-blue-300 bg-blue-100 text-blue-900",
  low: "bg-muted text-muted-foreground",
};

const STATE_CLASS: Record<string, string> = {
  open: "bg-blue-100 text-blue-900",
  in_progress: "bg-cyan-100 text-cyan-900",
  blocked: "bg-red-100 text-red-900",
  pending_approval: "bg-purple-100 text-purple-900",
  closed: "bg-emerald-100 text-emerald-900",
  canceled: "bg-muted text-muted-foreground",
};

const DAY_MS = 86_400_000;

function formatDueDate(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WorkQueue() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const [filters, setFilters] = useUrlState(URL_DEFAULTS);
  const isEmployee = user?.role === "employee";
  const canSeeOrganization = ["platform_admin", "org_admin", "auditor"].includes(user?.role ?? "");
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const presentation = workQueuePresentationForRole(user?.role);
  const effectiveScope = isEmployee ? "mine" : filters.scope;
  const page = Math.max(1, Number(filters.page) || 1);

  // A single "now" for this page view: the overdue-first sort, the overdue tile, and the per-row
  // overdue styling must all agree, and the value has to be stable so it doesn't retrigger the
  // query on every render. Refresh it once a minute so operational deadlines actually age -- an
  // ops queue left open across a due boundary would otherwise keep sorting/filtering against a
  // frozen mount-time timestamp. A one-minute cadence is well below any due-window granularity and
  // placeholderData keeps the previous page visible across the refetch.
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const facilityScope = effectiveScope === "facility" && filters.facilityId !== "all" ? filters.facilityId : undefined;
  const ownerScope = effectiveScope === "mine" ? user?.id : undefined;
  // In "My work" scope the queue is already pinned to the current user, so the owner dropdown is
  // meaningless there -- ignore it (and hide it below). Sending both ownerProfileId=<me> and a
  // different ownerId would AND to zero rows, collapsing the list and tiles to empty.
  const ownerFilter = effectiveScope !== "mine" && filters.ownerId !== "all" ? filters.ownerId : undefined;
  const specificState = filters.state !== "all" && filters.state !== "active" ? filters.state : undefined;
  const activeOnly = filters.state === "active";
  const priorityScope = filters.priority !== "all" ? filters.priority : undefined;
  const sourceScope = filters.sourceType !== "all" ? filters.sourceType : undefined;
  const overdueOnly = filters.due === "overdue";
  const dueBefore = /^\d+$/.test(filters.due)
    ? new Date(now.getTime() + Number(filters.due) * DAY_MS).toISOString()
    : undefined;

  const workItems = usePaginatedWorkItems({
    organizationId,
    facilityId: facilityScope,
    ownerProfileId: ownerScope,
    ownerId: ownerFilter,
    state: specificState,
    activeOnly,
    priority: priorityScope,
    sourceType: sourceScope,
    search: filters.search,
    now: nowIso,
    overdueOnly,
    dueBefore,
    page,
    pageSize: PAGE_SIZE,
  });
  // Tiles measure the whole scope (org + facility + owner) plus priority/source/search, but not the
  // state or due-window selection -- they are about states, so filtering their denominator by a
  // chosen state would make them meaningless.
  const summaryQuery = useWorkItemListSummary({
    organizationId,
    facilityId: facilityScope,
    ownerProfileId: ownerScope,
    ownerId: ownerFilter,
    priority: priorityScope,
    sourceType: sourceScope,
    search: filters.search,
    now: nowIso,
  });
  const summary = summaryQuery.data ?? EMPTY_WORK_ITEM_LIST_SUMMARY;
  const { data: facilities } = useListFacilities({ organizationId });
  const { data: profiles } = useListProfiles({ organizationId });

  const rows = workItems.data?.rows ?? [];
  const total = workItems.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const detailBase = workQueuePathForRole(user?.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ClipboardList className="h-6 w-6" />
            {presentation.title}
          </h1>
          <p className="text-muted-foreground">
            {presentation.description}
          </p>
        </div>
        {presentation.showScopeSwitcher && (
          <div className="flex rounded-lg border p-1">
            <Button
              size="sm"
              variant={effectiveScope === "mine" ? "default" : "ghost"}
              onClick={() => setFilters({ scope: "mine", page: "1" })}
            >
              My work
            </Button>
            <Button
              size="sm"
              variant={effectiveScope === "facility" ? "default" : "ghost"}
              onClick={() => setFilters({ scope: "facility", page: "1" })}
            >
              Facility
            </Button>
            {canSeeOrganization && (
              <Button
                size="sm"
                variant={effectiveScope === "organization" ? "default" : "ghost"}
                onClick={() => setFilters({ scope: "organization", page: "1" })}
              >
                Organization
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Open", value: summary.open, icon: Clock3, className: "text-blue-600" },
          { label: "Overdue", value: summary.overdue, icon: AlertTriangle, className: "text-red-600" },
          { label: "Blocked", value: summary.blocked, icon: AlertTriangle, className: "text-amber-600" },
          { label: "Pending approval", value: summary.pendingApproval, icon: CheckCircle2, className: "text-purple-600" },
        ].map(metric => (
          <Card key={metric.label}>
            <CardContent className="flex items-center gap-3 pt-6">
              <metric.icon className={`h-7 w-7 ${metric.className}`} />
              <div>
                <p className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : metric.value}</p>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <Input
              value={filters.search}
              onChange={event => setFilters({ search: event.target.value, page: "1" })}
              placeholder="Search title or description"
              aria-label="Search work"
            />
            {presentation.showFacilityFilter && (
              <Select value={filters.facilityId} onValueChange={facilityId => setFilters({ facilityId, page: "1" })}>
                <SelectTrigger><SelectValue placeholder="All facilities" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All facilities</SelectItem>
                  {facilities?.map(facility => (
                    <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={filters.state} onValueChange={state => setFilters({ state, page: "1" })}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">All active</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                {WORK_ITEM_STATES.map(state => (
                  <SelectItem key={state} value={state}>{WORK_ITEM_STATE_LABELS[state]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.priority} onValueChange={priority => setFilters({ priority, page: "1" })}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {WORK_ITEM_PRIORITIES.map(priority => (
                  <SelectItem key={priority} value={priority}>{WORK_ITEM_PRIORITY_LABELS[priority]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.sourceType} onValueChange={sourceType => setFilters({ sourceType, page: "1" })}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.due} onValueChange={due => setFilters({ due, page: "1" })}>
              <SelectTrigger><SelectValue placeholder="Due date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any due date</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="7">Due in 7 days</SelectItem>
                <SelectItem value="30">Due in 30 days</SelectItem>
              </SelectContent>
            </Select>
            {presentation.showOwnerFilter && canManage && effectiveScope !== "mine" && (
              <Select value={filters.ownerId} onValueChange={ownerId => setFilters({ ownerId, page: "1" })}>
                <SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem>
                  {profiles?.filter(profile => profile.is_active).map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.first_name} {profile.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {workItems.isError ? (
            <QueryError what="operational work" error={workItems.error as Error} onRetry={() => workItems.refetch()} />
          ) : workItems.isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : total === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
              <p className="font-medium">{presentation.emptyTitle}</p>
              <p className="text-sm text-muted-foreground">{presentation.emptyDescription}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="data-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th>Work item</th>
                      {presentation.showFacilityColumn && <th>Facility</th>}
                      {presentation.showSourceColumn && <th>Source</th>}
                      {presentation.showOwnerColumn && <th>Owner</th>}
                      <th>Priority</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(item => {
                      const overdue = isWorkItemOverdue(item, now);
                      return (
                        <tr key={item.id}>
                          <td>
                            <p className="max-w-[280px] truncate font-medium">{item.title}</p>
                            {item.escalated_at && <p className="text-xs text-red-600">Escalated</p>}
                          </td>
                          {presentation.showFacilityColumn && <td className="text-sm">{item.facility?.name ?? "—"}</td>}
                          {presentation.showSourceColumn && <td className="text-sm">{SOURCE_LABELS[item.source_type] ?? item.source_type}</td>}
                          {presentation.showOwnerColumn && (
                            <td className="text-sm">
                              {item.owner
                                ? <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{item.owner.first_name} {item.owner.last_name}</span>
                                : <span className="text-muted-foreground">Unassigned</span>}
                            </td>
                          )}
                          <td>
                            <Badge variant="outline" className={PRIORITY_CLASS[item.priority]}>
                              {WORK_ITEM_PRIORITY_LABELS[item.priority] ?? item.priority}
                            </Badge>
                          </td>
                          <td className={overdue ? "font-medium text-red-700" : "text-muted-foreground"}>
                            <span className="inline-flex items-center gap-1 text-sm">
                              {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                              {formatDueDate(item.due_at)}
                            </span>
                          </td>
                          <td>
                            <Badge variant="outline" className={`border-0 ${STATE_CLASS[item.state] ?? ""}`}>
                              {WORK_ITEM_STATE_LABELS[item.state] ?? item.state}
                            </Badge>
                          </td>
                          <td>
                            <Button asChild variant="outline" size="sm">
                              <Link href={`${detailBase}/${item.id}`}>
                                Open <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilters({ page: String(page - 1) })}>Previous</Button>
                  <span className="px-1 text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setFilters({ page: String(page + 1) })}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
