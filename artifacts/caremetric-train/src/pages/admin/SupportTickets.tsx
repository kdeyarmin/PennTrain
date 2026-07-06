import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LifeBuoy } from "lucide-react";
import { useListSupportTickets, SUPPORT_TICKET_CATEGORIES } from "@/hooks/useSupportTickets";
import { useOrganizationNameMap } from "@/hooks/useAdminNotificationDeliveries";
import { useProfileNameMap } from "@/hooks/useSecurityAuditLog";

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

export default function SupportTickets() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: ticketsData, isLoading } = useListSupportTickets({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const { data: orgNameMap } = useOrganizationNameMap();
  const { data: profileNameMap } = useProfileNameMap();

  const tickets = ticketsData ?? [];
  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Support Tickets</h1>
        <p className="text-muted-foreground">
          Requests submitted from every organization's Help Center -- {openCount} awaiting first response.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>All Tickets</CardTitle>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
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
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your filter, or check back after the next submission.</p>
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
