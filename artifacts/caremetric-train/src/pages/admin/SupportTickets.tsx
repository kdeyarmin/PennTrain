import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LifeBuoy, Search } from "lucide-react";
import { useListSupportTickets, SUPPORT_TICKET_CATEGORIES } from "@/hooks/useSupportTickets";
import { useOrganizationNameMap } from "@/hooks/useAdminNotificationDeliveries";
import { useProfileNameMap } from "@/hooks/useSecurityAuditLog";
import { useUrlState } from "@/hooks/useUrlState";
import { summarizeSupportTicketAnalytics } from "@/lib/supportTicketAnalytics";

type StatusFilter = "all" | "open" | "in_progress" | "resolved" | "closed";

const STATUS_DISPLAY: Record<string, { color: string; label: string }> = {
  open: { color: "bg-blue-100 text-blue-800", label: "Open" },
  in_progress: { color: "bg-amber-100 text-amber-800", label: "In Progress" },
  resolved: { color: "bg-green-100 text-green-800", label: "Resolved" },
  closed: { color: "bg-gray-100 text-gray-600", label: "Closed" },
};

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  normal: "bg-blue-50 text-blue-700",
  high: "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-800",
};

// Synced into the URL via useUrlState so a deep link like AdminDashboard's "Open Support Tickets"
// tile (?status=open) pre-selects the matching filter on load, and Back/Forward between two
// filtered views of this page works instead of resetting to "all" every time.
const SUPPORT_TICKETS_URL_DEFAULTS = {
  status: "all",
  search: "",
};

export default function SupportTickets() {
  const [urlState, setUrlState] = useUrlState(SUPPORT_TICKETS_URL_DEFAULTS);
  const statusFilter = urlState.status as StatusFilter;

  // useListSupportTickets' search runs server-side (see that hook's own comment for why), so
  // debounce before it drives a request -- the box itself stays bound to the undebounced
  // urlState.search for a snappy feel, matching Employees.tsx's identical convention.
  const [debouncedSearch, setDebouncedSearch] = useState(urlState.search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(urlState.search), 300);
    return () => clearTimeout(t);
  }, [urlState.search]);

  const { data: ticketsData, isLoading } = useListSupportTickets({
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: debouncedSearch || undefined,
  });
  // Independent of statusFilter/search -- deriving this from the (possibly filtered) list above
  // would read as 0 whenever a non-"open" filter or search term is active.
  const { data: openTicketsData } = useListSupportTickets({ status: "open" });
  const { data: allTicketsData } = useListSupportTickets({});
  const { data: orgNameMap } = useOrganizationNameMap();
  const { data: profileNameMap } = useProfileNameMap();

  const tickets = ticketsData ?? [];
  const openCount = openTicketsData?.length ?? 0;
  const supportSummary = useMemo(() => summarizeSupportTicketAnalytics(
    (allTicketsData ?? []).map((ticket) => ({
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      created_at: ticket.created_at,
      last_message_at: ticket.last_message_at,
    })),
    new Date().toISOString().slice(0, 10),
  ), [allTicketsData]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Support Tickets</h1>
        <p className="text-muted-foreground">
          Requests submitted from every organization's Help Center -- {openCount} awaiting first response.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <button type="button" className="rounded-lg border bg-card p-4 text-left hover:border-primary/40" onClick={() => setUrlState({ status: "open" })}>
          <p className="text-xs font-medium text-muted-foreground">Open tickets</p>
          <p className="mt-1 text-2xl font-semibold">{supportSummary.open}</p>
          <p className="mt-1 text-xs text-muted-foreground">{supportSummary.total} total support requests.</p>
        </button>
        <button type="button" className="rounded-lg border bg-card p-4 text-left hover:border-amber-300" onClick={() => setUrlState({ status: "in_progress" })}>
          <p className="text-xs font-medium text-muted-foreground">In progress</p>
          <p className="mt-1 text-2xl font-semibold">{supportSummary.inProgress}</p>
          <p className="mt-1 text-xs text-muted-foreground">Average active age: {supportSummary.averageAgeDays} days.</p>
        </button>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Urgent active</p>
          <p className="mt-1 text-2xl font-semibold text-destructive">{supportSummary.urgentOpen}</p>
          <p className="mt-1 text-xs text-muted-foreground">{supportSummary.staleOpen} active tickets have been quiet 3+ days.</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Oldest active</p>
          <p className="mt-1 text-lg font-semibold">{supportSummary.oldestOpenTicketId ? "Needs review" : "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {supportSummary.oldestOpenTicketId ? (
              <Link href={`/admin/support-tickets/${supportSummary.oldestOpenTicketId}`} className="text-primary hover:underline">Open oldest active ticket</Link>
            ) : "No active tickets."}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>All Tickets</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tickets..."
                value={urlState.search}
                onChange={(e) => setUrlState({ search: e.target.value })}
                className="pl-9 h-9 w-56"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setUrlState({ status: v })}>
              <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !tickets.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <LifeBuoy className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No support tickets found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your search or filters, or check back after the next submission.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="whitespace-nowrap">Last Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => {
                  const status = STATUS_DISPLAY[t.status] ?? { color: "bg-gray-100 text-gray-800", label: t.status };
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <Link href={`/admin/support-tickets/${t.id}`} className="hover:underline">{t.subject}</Link>
                      </TableCell>
                      <TableCell>{orgNameMap?.[t.organization_id] ?? t.organization_id}</TableCell>
                      <TableCell>{profileNameMap?.[t.created_by] ?? "Unknown"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {SUPPORT_TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs capitalize ${PRIORITY_BADGE[t.priority] ?? ""}`}>
                          {t.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(t.last_message_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
