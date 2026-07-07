import { useState } from "react";
import {
  useListNotificationDeliveries,
  useOrganizationNameMap,
  useRetryNotificationDelivery,
  useBulkRetryNotificationDeliveries,
} from "@/hooks/useAdminNotificationDeliveries";
import { useUrlState } from "@/hooks/useUrlState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type StatusFilter = "all" | "pending" | "sent" | "failed" | "skipped";
type ChannelFilter = "all" | "email" | "sms";

// Mirrors AuditLog.tsx's getActionDisplay color-map convention. StatusBadge
// (@/components/ui/status-badge) doesn't have a type variant whose switch
// covers pending/sent/failed/skipped, so we inline the mapping here instead
// of forcing an unrelated variant onto it.
function getStatusDisplay(status: string): { color: string; label: string } {
  switch (status.toLowerCase()) {
    case "sent":
      return { color: "bg-green-100 text-green-800", label: "Sent" };
    case "pending":
      return { color: "bg-amber-100 text-amber-800", label: "Pending" };
    case "failed":
      return { color: "bg-red-100 text-red-800", label: "Failed" };
    case "skipped":
      return { color: "bg-gray-100 text-gray-600", label: "Skipped" };
    default:
      return { color: "bg-gray-100 text-gray-800", label: status };
  }
}

// Synced into the URL via useUrlState so a deep link like AdminDashboard's "Failed Deliveries"
// tile (?status=failed) pre-selects the matching filter on load, and Back/Forward between two
// filtered views of this page works instead of resetting to "all" every time.
const NOTIFICATION_DELIVERIES_URL_DEFAULTS = {
  status: "all",
  channel: "all",
  search: "",
};

export default function NotificationDeliveries() {
  const { toast } = useToast();
  const [urlState, setUrlState] = useUrlState(NOTIFICATION_DELIVERIES_URL_DEFAULTS);
  const statusFilter = urlState.status as StatusFilter;
  const channelFilter = urlState.channel as ChannelFilter;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: deliveriesData, isLoading } = useListNotificationDeliveries({
    status: statusFilter !== "all" ? statusFilter : undefined,
    channel: channelFilter !== "all" ? channelFilter : undefined,
  });
  const { data: orgNameMap } = useOrganizationNameMap();
  const { mutate: retryDelivery, isPending: retrying } = useRetryNotificationDelivery();
  const { mutateAsync: bulkRetry, isPending: bulkRetrying } = useBulkRetryNotificationDeliveries();
  const anyRetryInFlight = retrying || bulkRetrying;

  const deliveries = deliveriesData ?? [];

  // Client-side, not server-side: useListNotificationDeliveries caps at 200 rows (its own
  // .limit()), so the full filtered set is already sitting in memory -- no need for a server round
  // trip per keystroke. Matches the raw recipient column plus the organization name resolved via
  // orgNameMap, since organization_id alone isn't human-searchable.
  const search = urlState.search.trim().toLowerCase();
  const filteredDeliveries = search
    ? deliveries.filter((d) => {
        const orgName = orgNameMap?.[d.organization_id] ?? "";
        return d.recipient.toLowerCase().includes(search) || orgName.toLowerCase().includes(search);
      })
    : deliveries;

  // Based on the full (unfiltered-by-search) fetch, not filteredDeliveries -- a row that scrolls
  // out of view because of the search box shouldn't silently vanish from the bulk-retry count.
  const failedIds = new Set(deliveries.filter((d) => d.status === "failed").map((d) => d.id));
  const selectedFailedIds = Array.from(selectedIds).filter((id) => failedIds.has(id));
  const visibleFailedIds = filteredDeliveries.filter((d) => d.status === "failed").map((d) => d.id);
  const allVisibleFailedSelected = visibleFailedIds.length > 0 && visibleFailedIds.every((id) => selectedIds.has(id));

  const handleRetry = (deliveryId: string) => {
    retryDelivery(deliveryId, {
      onSuccess: () => toast({ title: "Delivery queued for retry", variant: "success" }),
      onError: (e: Error) => toast({ title: "Failed to retry delivery", description: e.message, variant: "destructive" }),
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisibleFailed = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleFailedSelected) visibleFailedIds.forEach((id) => next.delete(id));
      else visibleFailedIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBulkRetry = async () => {
    if (!selectedFailedIds.length) return;
    const ids = selectedFailedIds;
    const results = await bulkRetry(ids);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failedCount = results.length - succeeded;
    setSelectedIds(new Set());
    if (failedCount === 0) {
      toast({ title: `${succeeded} deliver${succeeded === 1 ? "y" : "ies"} queued for retry`, variant: "success" });
    } else if (succeeded === 0) {
      toast({ title: `Failed to queue ${failedCount} deliver${failedCount === 1 ? "y" : "ies"} for retry`, variant: "destructive" });
    } else {
      toast({
        title: `${succeeded} of ${results.length} deliveries queued for retry`,
        description: `${failedCount} could not be queued -- try again.`,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Deliveries</h1>
        <p className="text-muted-foreground">Cross-organization email/SMS delivery log -- retry failed sends.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>All Deliveries</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search deliveries..."
                value={urlState.search}
                onChange={(e) => setUrlState({ search: e.target.value })}
                className="pl-9 h-9 w-56"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setUrlState({ status: v })}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={(v) => setUrlState({ channel: v })}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All Channels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !filteredDeliveries.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Bell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No notification deliveries found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your search or filters, or check back after the next notification run.</p>
            </div>
          ) : (
            <>
              {selectedFailedIds.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 mb-3 bg-muted rounded-md border flex-wrap">
                  <span className="text-sm font-medium">
                    {selectedFailedIds.length} failed deliver{selectedFailedIds.length === 1 ? "y" : "ies"} selected
                  </span>
                  <Button size="sm" variant="outline" onClick={handleBulkRetry} disabled={anyRetryInFlight}>
                    {bulkRetrying ? "Retrying..." : "Retry Selected Failed"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear Selection</Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleFailedSelected}
                        onCheckedChange={toggleSelectAllVisibleFailed}
                        disabled={visibleFailedIds.length === 0}
                        aria-label="Select all failed deliveries"
                      />
                    </TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created / Sent</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeliveries.map((delivery) => {
                    const { color, label } = getStatusDisplay(delivery.status);
                    const orgName = orgNameMap?.[delivery.organization_id] ?? delivery.organization_id;
                    return (
                      <TableRow key={delivery.id}>
                        <TableCell>
                          {delivery.status === "failed" && (
                            <Checkbox
                              checked={selectedIds.has(delivery.id)}
                              onCheckedChange={() => toggleSelected(delivery.id)}
                              aria-label={`Select delivery to ${delivery.recipient}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{orgName}</TableCell>
                        <TableCell>{delivery.recipient}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-xs">{delivery.channel}</Badge>
                        </TableCell>
                        <TableCell className="capitalize">{delivery.delivery_type.replace(/_/g, " ")}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium ${color}`}>
                              {label}
                            </span>
                            {delivery.error_message && (
                              <span className="text-xs text-destructive">{delivery.error_message}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <div>{new Date(delivery.created_at).toLocaleString()}</div>
                          {delivery.sent_at && <div>Sent {new Date(delivery.sent_at).toLocaleString()}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          {delivery.status === "failed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={anyRetryInFlight}
                              onClick={() => handleRetry(delivery.id)}
                            >
                              Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
