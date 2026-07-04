import { useState } from "react";
import { useListAlerts, useUpdateAlert, useBulkUpdateAlerts, type Alert } from "@/hooks/useAlerts";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, AlertTriangle, CheckCircle, Info, X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 10;
type SortField = "severity" | "createdAt" | "title";

export default function Alerts() {
  const [status, setStatus] = useState<string>("open");
  const [severity, setSeverity] = useState<string>("all");
  const [facilityId, setFacilityId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: facilities } = useListFacilities();
  const { data: alerts, isLoading } = useListAlerts({
    status: status !== "all" ? status : undefined,
    severity: severity !== "all" ? severity : undefined,
    facilityId: facilityId !== "all" ? facilityId : undefined,
  });
  const { toast } = useToast();

  const { mutate: updateAlert } = useUpdateAlert();
  const { mutate: bulkUpdateAlerts, isPending: bulkDismissing } = useBulkUpdateAlerts();

  const handleAction = (id: string, action: "dismiss" | "resolve") => {
    setPendingId(id);
    updateAlert(
      { id, status: action === "resolve" ? "resolved" : "dismissed" },
      {
        onSuccess: () => {
          toast({ title: action === "resolve" ? "Alert resolved" : "Alert dismissed" });
          setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        },
        onError: () => toast({ variant: "destructive", title: "Action failed" }),
        onSettled: () => setPendingId(null),
      },
    );
  };

  const handleBulkDismiss = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    bulkUpdateAlerts(
      { ids, status: "dismissed" },
      {
        onSuccess: () => {
          toast({ title: `${ids.length} alert(s) dismissed` });
          setSelectedIds(new Set());
        },
        onError: () => toast({ variant: "destructive", title: "Bulk dismiss failed" }),
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
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(1);
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
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); setSelectedIds(new Set()); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={v => { setSeverity(v); setPage(1); }}>
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
        <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
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

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted rounded-md border">
          <span className="text-sm font-medium">{selectedIds.size} alert(s) selected</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDismiss}
            disabled={bulkDismissing}
          >
            {bulkDismissing ? "Dismissing..." : "Bulk Dismiss"}
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
              {status === "open" && openOnPage.length > 0 && (
                <div className="flex items-center gap-2 pb-3 mb-3 border-b">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-xs text-muted-foreground">Select all on page</span>
                </div>
              )}
              <div className="space-y-3">
                {paginated.map((alert: Alert) => (
                  <div key={alert.id} className="flex items-start gap-4 p-4 rounded-lg border">
                    {alert.status === "open" && (
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
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(alert.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {alert.status === "open" && (
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
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
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
