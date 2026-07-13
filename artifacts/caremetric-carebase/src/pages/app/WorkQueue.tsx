import { useMemo } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardList, Clock3, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import { useUrlState } from "@/hooks/useUrlState";
import { useListWorkItems, type WorkItemWithRelations } from "@/hooks/useWorkItems";
import {
  isWorkItemOpen,
  isWorkItemOverdue,
  sortWorkItems,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_STATES,
  WORK_ITEM_STATE_LABELS,
  workQueuePathForRole,
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
};

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
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "border-red-300 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  high: "border-amber-300 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  normal: "border-blue-300 bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  low: "bg-muted text-muted-foreground",
};

const STATE_CLASS: Record<string, string> = {
  open: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  in_progress: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
  blocked: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  pending_approval: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  closed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  canceled: "bg-muted text-muted-foreground",
};

function dueDateMatches(item: WorkItemWithRelations, filter: string, now: Date): boolean {
  if (filter === "all") return true;
  if (filter === "overdue") return isWorkItemOverdue(item, now);
  const days = Number(filter);
  return new Date(item.due_at).getTime() <= now.getTime() + days * 86_400_000;
}

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
  const effectiveScope = isEmployee ? "mine" : filters.scope;
  const ownerProfileId = effectiveScope === "mine" ? user?.id : undefined;

  const query = useListWorkItems({
    organizationId: viewingOrgId ?? user?.organizationId ?? undefined,
    facilityId: effectiveScope === "facility" && filters.facilityId !== "all" ? filters.facilityId : undefined,
    ownerProfileId,
    state: filters.state !== "all" && filters.state !== "active" ? filters.state : undefined,
    priority: filters.priority !== "all" ? filters.priority : undefined,
    sourceType: filters.sourceType !== "all" ? filters.sourceType : undefined,
  });
  const { data: facilities } = useListFacilities({
    organizationId: viewingOrgId ?? user?.organizationId ?? undefined,
  });
  const { data: profiles } = useListProfiles({
    organizationId: viewingOrgId ?? user?.organizationId ?? undefined,
  });

  const now = useMemo(() => new Date(), [query.dataUpdatedAt]);
  const all = query.data ?? [];
  const filtered = sortWorkItems(all.filter(item => {
    if (filters.state === "active" && !isWorkItemOpen(item)) return false;
    if (filters.ownerId !== "all" && item.owner_profile_id !== filters.ownerId) return false;
    if (!dueDateMatches(item, filters.due, now)) return false;
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      if (!`${item.title} ${item.description ?? ""}`.toLowerCase().includes(needle)) return false;
    }
    return true;
  }), now);

  const openCount = all.filter(isWorkItemOpen).length;
  const overdueCount = all.filter(item => isWorkItemOverdue(item, now)).length;
  const approvalCount = all.filter(item => item.state === "pending_approval").length;
  const blockedCount = all.filter(item => item.state === "blocked").length;
  const detailBase = workQueuePathForRole(user?.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ClipboardList className="h-6 w-6" />
            {isEmployee ? "My Work" : "Operational Work Queue"}
          </h1>
          <p className="text-muted-foreground">
            {isEmployee
              ? "Compliance and administrative work assigned to you."
              : "Owned remediation across facilities, sources, approvals, and deadlines."}
          </p>
        </div>
        {!isEmployee && (
          <div className="flex rounded-lg border p-1">
            <Button
              size="sm"
              variant={effectiveScope === "mine" ? "default" : "ghost"}
              onClick={() => setFilters({ scope: "mine" })}
            >
              My work
            </Button>
            <Button
              size="sm"
              variant={effectiveScope === "facility" ? "default" : "ghost"}
              onClick={() => setFilters({ scope: "facility" })}
            >
              Facility
            </Button>
            {canSeeOrganization && (
              <Button
                size="sm"
                variant={effectiveScope === "organization" ? "default" : "ghost"}
                onClick={() => setFilters({ scope: "organization" })}
              >
                Organization
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Open", value: openCount, icon: Clock3, className: "text-blue-600" },
          { label: "Overdue", value: overdueCount, icon: AlertTriangle, className: "text-red-600" },
          { label: "Blocked", value: blockedCount, icon: AlertTriangle, className: "text-amber-600" },
          { label: "Pending approval", value: approvalCount, icon: CheckCircle2, className: "text-purple-600" },
        ].map(metric => (
          <Card key={metric.label}>
            <CardContent className="flex items-center gap-3 pt-6">
              <metric.icon className={`h-7 w-7 ${metric.className}`} />
              <div>
                <p className="text-2xl font-bold">{query.isLoading ? "—" : metric.value}</p>
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
              onChange={event => setFilters({ search: event.target.value })}
              placeholder="Search title or description"
              aria-label="Search work"
            />
            {!isEmployee && (
              <Select value={filters.facilityId} onValueChange={facilityId => setFilters({ facilityId })}>
                <SelectTrigger><SelectValue placeholder="All facilities" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All facilities</SelectItem>
                  {facilities?.map(facility => (
                    <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={filters.state} onValueChange={state => setFilters({ state })}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">All active</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                {WORK_ITEM_STATES.map(state => (
                  <SelectItem key={state} value={state}>{WORK_ITEM_STATE_LABELS[state]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.priority} onValueChange={priority => setFilters({ priority })}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {WORK_ITEM_PRIORITIES.map(priority => (
                  <SelectItem key={priority} value={priority}>{WORK_ITEM_PRIORITY_LABELS[priority]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.sourceType} onValueChange={sourceType => setFilters({ sourceType })}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.due} onValueChange={due => setFilters({ due })}>
              <SelectTrigger><SelectValue placeholder="Due date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any due date</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="7">Due in 7 days</SelectItem>
                <SelectItem value="30">Due in 30 days</SelectItem>
              </SelectContent>
            </Select>
            {canManage && (
              <Select value={filters.ownerId} onValueChange={ownerId => setFilters({ ownerId })}>
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

          {query.isError ? (
            <QueryError what="operational work" error={query.error} onRetry={() => query.refetch()} />
          ) : query.isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
              <p className="font-medium">No work matches these filters</p>
              <p className="text-sm text-muted-foreground">Change the scope or filters to review other work.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>Work item</th>
                    <th>Facility</th>
                    <th>Source</th>
                    <th>Owner</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const overdue = isWorkItemOverdue(item, now);
                    return (
                      <tr key={item.id}>
                        <td>
                          <p className="max-w-[280px] truncate font-medium">{item.title}</p>
                          {item.escalated_at && <p className="text-xs text-red-600">Escalated</p>}
                        </td>
                        <td className="text-sm">{item.facility?.name ?? "—"}</td>
                        <td className="text-sm">{SOURCE_LABELS[item.source_type] ?? item.source_type}</td>
                        <td className="text-sm">
                          {item.owner
                            ? <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{item.owner.first_name} {item.owner.last_name}</span>
                            : <span className="text-muted-foreground">Unassigned</span>}
                        </td>
                        <td>
                          <Badge variant="outline" className={PRIORITY_CLASS[item.priority]}>
                            {WORK_ITEM_PRIORITY_LABELS[item.priority] ?? item.priority}
                          </Badge>
                        </td>
                        <td className={overdue ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
