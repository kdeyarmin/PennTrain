import { useListAuditLogs, type AuditLog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-800",
  login: "bg-purple-100 text-purple-800",
  deactivate: "bg-orange-100 text-orange-800",
};

export default function AuditLog() {
  const { data: logsData, isLoading } = useListAuditLogs({ limit: 100 });
  const logs: AuditLog[] = logsData?.logs ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground">Complete history of all system actions and changes.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {logs?.map((log: any) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-800"}`}>
                        {log.action}
                      </span>
                      <span className="text-sm font-medium capitalize">{log.entityType?.replace(/_/g, " ")}</span>
                      {log.entityId && <span className="text-xs text-muted-foreground">#{log.entityId}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      User #{log.userId ?? "System"} · {new Date(log.createdAt).toLocaleString()}
                      {log.ipAddress && ` · ${log.ipAddress}`}
                    </p>
                  </div>
                </div>
              ))}
              {(!logs || logs.length === 0) && (
                <p className="text-center text-muted-foreground py-8">No audit log entries found.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
