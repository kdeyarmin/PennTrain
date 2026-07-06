import { useState } from "react";
import {
  useListNotificationDeliveries,
  useOrganizationNameMap,
  useRetryNotificationDelivery,
} from "@/hooks/useAdminNotificationDeliveries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell } from "lucide-react";
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

export default function NotificationDeliveries() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  const { data: deliveriesData, isLoading } = useListNotificationDeliveries({
    status: statusFilter !== "all" ? statusFilter : undefined,
    channel: channelFilter !== "all" ? channelFilter : undefined,
  });
  const { data: orgNameMap } = useOrganizationNameMap();
  const { mutate: retryDelivery, isPending: retrying } = useRetryNotificationDelivery();

  const deliveries = deliveriesData ?? [];

  const handleRetry = (deliveryId: string) => {
    retryDelivery(deliveryId, {
      onSuccess: () => toast({ title: "Delivery queued for retry" }),
      onError: (e: Error) => toast({ title: "Failed to retry delivery", description: e.message, variant: "destructive" }),
    });
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
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={(v) => setChannelFilter(v as ChannelFilter)}>
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
          ) : !deliveries.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Bell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No notification deliveries found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your filters, or check back after the next notification run.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                {deliveries.map((delivery) => {
                  const { color, label } = getStatusDisplay(delivery.status);
                  const orgName = orgNameMap?.[delivery.organization_id] ?? delivery.organization_id;
                  return (
                    <TableRow key={delivery.id}>
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
                            disabled={retrying}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
