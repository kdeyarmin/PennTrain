import { History } from "lucide-react";
import { useListAuditLogs } from "@/hooks/useAuditLogs";
import { auditActionDescription } from "@/lib/auditEntityResolver";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";

interface EntityHistoryDrawerProps {
  entityType: string;
  entityId?: string | null;
  title?: string;
  triggerLabel?: string;
  /** Optional class on the trigger button */
  className?: string;
  limit?: number;
}

/**
 * Lightweight entity-scoped audit history drawer for detail pages
 * (incidents, complaints, residents, policies). Reuses the same audit_logs
 * feed as EmployeeDetail "Recent Activity".
 */
export function EntityHistoryDrawer({
  entityType,
  entityId,
  title = "Record history",
  triggerLabel = "History",
  className,
  limit = 40,
}: EntityHistoryDrawerProps) {
  const logsQuery = useListAuditLogs(
    { entityType, entityId: entityId ?? undefined, limit },
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className} disabled={!entityId}>
          <History className="mr-2 h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Recent audited changes for this record. Full platform history is in Audit Log.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3">
          {!entityId ? (
            <p className="text-sm text-muted-foreground">Record not loaded yet.</p>
          ) : logsQuery.isError ? (
            <QueryError what="history" error={logsQuery.error} onRetry={() => void logsQuery.refetch()} />
          ) : logsQuery.isLoading ? (
            <QueryLoading what="history" />
          ) : !(logsQuery.data?.length) ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No audited changes yet for this record.</p>
          ) : (
            logsQuery.data.map((log) => {
              const label = auditActionDescription(log.action, log.entity_type);
              return (
                <div key={log.id} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {log.action?.includes("_created")
                        ? "Created"
                        : log.action?.includes("_updated")
                          ? "Updated"
                          : log.action?.includes("_deleted")
                            ? "Deleted"
                            : "Event"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {log.created_at ? formatDateForDisplay(log.created_at) : "—"}
                      {log.created_at ? ` · ${new Date(log.created_at).toLocaleTimeString()}` : ""}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{label}</p>
                  {log.actor_profile_id && (
                    <p className="text-xs text-muted-foreground">Actor profile · {log.actor_profile_id.slice(0, 8)}…</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
