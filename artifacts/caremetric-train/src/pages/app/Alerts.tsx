import { useState } from "react";
import { Link } from "wouter";
import { useListAlerts, useUpdateAlert, useBulkUpdateAlerts, type Alert } from "@/hooks/useAlerts";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListAllIncidentNotifications } from "@/hooks/useIncidents";
import { useListCorrectiveActions } from "@/hooks/useCorrectiveActions";
import { useListAllInspectionEvents } from "@/hooks/useInspectionEvents";
import { useListAllResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
<<<<<<< HEAD
=======
import { useUrlState } from "@/hooks/useUrlState";
>>>>>>> origin/main
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, AlertTriangle, CheckCircle, Info, X, Search, ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type Role } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";

const PAGE_SIZE = 10;
type SortField = "severity" | "createdAt" | "title";

// Matches the alerts_write RLS policy (org_admin/facility_manager, or platform_admin
// via is_platform_admin()) — roles outside this list can reach /app/alerts (read-only)
// but Postgres will reject any write, so those controls must not be shown to them.
const ALERTS_WRITE_ROLES: Role[] = ["org_admin", "facility_manager", "platform_admin"];

// Synced into the URL query string via useUrlState so opening a linked employee/incident/
// inspection/resident record (below) and hitting Back returns to the same filtered/sorted/paged
// view instead of resetting to these defaults.
const ALERTS_FILTER_DEFAULTS = {
  status: "open",
  severity: "all",
  facilityId: "all",
  search: "",
  sortField: "createdAt",
  sortDir: "desc",
  page: "1",
};

export default function Alerts() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const canWrite = !!user && ALERTS_WRITE_ROLES.includes(user.role);
  // This page is mounted at both /admin/alerts (platform_admin) and /app/alerts
  // (org roles) -- EmployeeDetail/IncidentDetail/InspectionItemDetail all have a matching
  // route under each prefix, so every deep link below must match whichever one the viewer is under.
  const employeeDetailBase = user?.role === "platform_admin" ? "/admin/employees" : "/app/employees";
  const incidentDetailBase = user?.role === "platform_admin" ? "/admin/incidents" : "/app/incidents";
  const inspectionDetailBase = user?.role === "platform_admin" ? "/admin/inspections" : "/app/inspections";
  const [filters, setFilters] = useUrlState(ALERTS_FILTER_DEFAULTS);
  const { status, severity, facilityId, search } = filters;
  const sortField = filters.sortField as SortField;
  const sortDir = filters.sortDir as "asc" | "desc";
  const page = Math.max(1, Number(filters.page) || 1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: facilities } = useListFacilities({ organizationId: viewingOrgId ?? undefined });
  const { data: alerts, isLoading } = useListAlerts({
    status: status !== "all" ? status : undefined,
    severity: severity !== "all" ? severity : undefined,
    facilityId: facilityId !== "all" ? facilityId : undefined,
    organizationId: viewingOrgId ?? undefined,
  });
  // Alerts don't carry an incident_id/inspection_item_id directly for every alert type --
  // incident_notification_overdue only has incident_notification_id, and
  // corrective_action_overdue's corrective_actions row can point at either an incident or an
  // inspection event -- so these small unfiltered lookups resolve the real deep-link target.
  const { data: incidentNotifications } = useListAllIncidentNotifications();
  const { data: correctiveActions } = useListCorrectiveActions();
  const { data: inspectionEvents } = useListAllInspectionEvents();
  // Residents only have a single /app/residents/:id route (no /admin mirror -- RESIDENT_ROLES
  // excludes platform_admin), so there's no base-path switch to make the way employee/incident/
  // inspection links above have -- resolveAlertLink() below omits the link entirely for that role.
  const { data: residentComplianceItems } = useListAllResidentComplianceItems();
  const { toast } = useToast();

  const notificationIncidentId = new Map((incidentNotifications ?? []).map((n) => [n.id, n.incident_id]));
  const correctiveActionById = new Map((correctiveActions ?? []).map((ca) => [ca.id, ca]));
  const inspectionEventItemId = new Map((inspectionEvents ?? []).map((e) => [e.id, e.inspection_item_id]));
  const complianceItemResidentId = new Map((residentComplianceItems ?? []).map((i) => [i.id, i.resident_id]));

  function resolveAlertLink(alert: Alert): { href: string; label: string } | null {
    if (alert.employee_id) return { href: `${employeeDetailBase}/${alert.employee_id}`, label: "View Employee" };
    if (alert.inspection_item_id) return { href: `${inspectionDetailBase}/${alert.inspection_item_id}`, label: "View Inspection Item" };
    if (alert.incident_notification_id) {
      const incidentId = notificationIncidentId.get(alert.incident_notification_id);
      if (incidentId) return { href: `${incidentDetailBase}/${incidentId}`, label: "View Incident" };
    }
    if (alert.corrective_action_id) {
      const ca = correctiveActionById.get(alert.corrective_action_id);
      if (ca?.incident_id) return { href: `${incidentDetailBase}/${ca.incident_id}`, label: "View Incident" };
      if (ca?.inspection_event_id) {
        const itemId = inspectionEventItemId.get(ca.inspection_event_id);
        if (itemId) return { href: `${inspectionDetailBase}/${itemId}`, label: "View Inspection Item" };
      }
    }
    if (alert.resident_compliance_item_id && user?.role !== "platform_admin") {
      // Unlike employee/incident/inspection links above, residents have no /admin mirror route
      // (RESIDENT_ROLES in App.tsx deliberately excludes platform_admin) -- omit the link entirely
      // for that viewer rather than offering one that redirects them away.
      const residentId = complianceItemResidentId.get(alert.resident_compliance_item_id);
      if (residentId) return { href: `/app/residents/${residentId}`, label: "View Resident" };
    }
    return null;
  }

  const { mutate: updateAlert } = useUpdateAlert();
  const { mutate: bulkUpdateAlerts, isPending: bulkUpdating } = useBulkUpdateAlerts();
  const [pendingBulkStatus, setPendingBulkStatus] = useState<"dismissed" | "resolved" | null>(null);

  const handleAction = (id: string, action: "dismiss" | "resolve") => {
    setPendingId(id);
    updateAlert(
      { id, status: action === "resolve" ? "resolved" : "dismissed" },
      {
        onSuccess: () => {
          toast({ title: action === "resolve" ? "Alert resolved" : "Alert dismissed", variant: "success" });
          setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        },
        onError: () => toast({ variant: "destructive", title: "Action failed" }),
        onSettled: () => setPendingId(null),
      },
    );
  };

  // Status-agnostic on purpose (useBulkUpdateAlerts just takes a status) so "Resolve Selected" and
  // "Bulk Dismiss" below share one handler and one in-flight-request guard instead of two
  // independent mutation hooks that could race each other.
  const handleBulkAction = (targetStatus: "dismissed" | "resolved") => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setPendingBulkStatus(targetStatus);
    bulkUpdateAlerts(
      { ids, status: targetStatus },
      {
        onSuccess: () => {
          toast({ title: `${ids.length} alert(s) ${targetStatus}`, variant: "success" });
          setSelectedIds(new Set());
        },
        onError: () => toast({ variant: "destructive", title: `Bulk ${targetStatus === "resolved" ? "resolve" : "dismiss"} failed` }),
        onSettled: () => setPendingBulkStatus(null),
      },
    );
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const severityIcon = (sev: string) => {
    if (sev === "critical") return <AlertCircle className="h-4 w-4 text-red-600" />;
    if (sev === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <Info className="h-4 w-4 text-blue-600" />;
  };

  const severityBadgeClass = (sev: string) => {
    if (sev === "critical") return "bg-red-100 text-red-800 border-red-200";
    if (sev === "warning") return "bg-yellow-100 text-yellow-800 border-yellow-200";
    return "bg-blue-100 text-blue-800 border-blue-200";
  };

  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };

  const allAlerts = alerts ?? [];

  const filtered = allAlerts.filter(a => {
    if (!search) return true;
    const s = search.toLowerCase();
    return a.title.toLowerCase().includes(s) || (a.message ?? "").toLowerCase().includes(s);
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "severity") {
      cmp = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    } else if (sortField === "createdAt") {
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else if (sortField === "title") {
      cmp = a.title.localeCompare(b.title);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const openOnPage = paginated.filter(a => a.status === "open");
  const allPageSelected = openOnPage.length > 0 && openOnPage.every(a => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        openOnPage.forEach(a => next.delete(a.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        openOnPage.forEach(a => next.add(a.id));
        return next;
      });
    }
  };

  function toggleSort(field: SortField) {
    if (sortField === field) setFilters({ sortDir: sortDir === "asc" ? "desc" : "asc", page: "1" });
    else setFilters({ sortField: field, sortDir: "desc", page: "1" });
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-muted-foreground">Track and manage compliance alerts across your organization.</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search alerts..."
            value={search}
            onChange={e => setFilters({ search: e.target.value, page: "1" })}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={v => { setFilters({ status: v, page: "1" }); setSelectedIds(new Set()); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={v => setFilters({ severity: v, page: "1" })}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={facilityId} onValueChange={v => setFilters({ facilityId: v, page: "1" })}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            variant={sortField === "severity" ? "default" : "outline"}
            size="sm"
            onClick={() => toggleSort("severity")}
          >
            Severity{sortIndicator("severity")}
          </Button>
          <Button
            variant={sortField === "createdAt" ? "default" : "outline"}
            size="sm"
            onClick={() => toggleSort("createdAt")}
          >
            Date{sortIndicator("createdAt")}
          </Button>
        </div>
      </div>

      {canWrite && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted rounded-md border">
          <span className="text-sm font-medium">{selectedIds.size} alert(s) selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkAction("resolved")}
            disabled={bulkUpdating}
          >
            {pendingBulkStatus === "resolved" ? "Resolving..." : "Resolve Selected"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleBulkAction("dismissed")}
            disabled={bulkUpdating}
          >
            {pendingBulkStatus === "dismissed" ? "Dismissing..." : "Bulk Dismiss"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear Selection
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : paginated.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <p className="text-muted-foreground">No {status} alerts found.</p>
            </div>
          ) : (
            <>
              {canWrite && status === "open" && openOnPage.length > 0 && (
                <div className="flex items-center gap-2 pb-3 mb-3 border-b">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-xs text-muted-foreground">Select all on page</span>
                </div>
              )}
              <div className="space-y-3">
                {paginated.map((alert: Alert) => {
                  const alertLink = resolveAlertLink(alert);
                  return (
                  <div key={alert.id} className="flex items-start gap-4 p-4 rounded-lg border">
                    {canWrite && alert.status === "open" && (
                      <div className="mt-0.5">
                        <Checkbox
                          checked={selectedIds.has(alert.id)}
                          onCheckedChange={() => toggleSelected(alert.id)}
                        />
                      </div>
                    )}
                    <div className="mt-0.5">{severityIcon(alert.severity)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{alert.title}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${severityBadgeClass(alert.severity)}`}>
                          {alert.severity}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <p className="text-xs text-muted-foreground">
                          {new Date(alert.created_at).toLocaleDateString()}
                        </p>
                        {alertLink && (
                          <Link
                            href={alertLink.href}
                            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <UserRound className="h-3 w-3" /> {alertLink.label}
                          </Link>
                        )}
                      </div>
                    </div>
                    {canWrite && alert.status === "open" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(alert.id, "resolve")}
                          disabled={pendingId === alert.id}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAction(alert.id, "dismiss")}
                          disabled={pendingId === alert.id}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setFilters({ page: String(Math.max(1, page - 1)) })} disabled={page === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setFilters({ page: String(Math.min(totalPages, page + 1)) })} disabled={page === totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
