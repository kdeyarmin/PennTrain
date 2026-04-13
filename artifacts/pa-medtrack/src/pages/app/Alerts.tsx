import { useState } from "react";
import { useListAlerts, getListAlertsQueryKey } from "@workspace/api-client-react";
import type { Alert } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

async function patchAlert(id: number, action: "dismiss" | "resolve") {
  await fetch(`/api/alerts/${id}/${action}`, { method: "PATCH", credentials: "include" });
}

export default function Alerts() {
  const [status, setStatus] = useState<string>("open");
  const [severity, setSeverity] = useState<string>("all");
  const { data: alerts, isLoading } = useListAlerts({
    status: (status && status !== "all" ? status : undefined) as "open" | "dismissed" | "resolved" | undefined,
    severity: (severity && severity !== "all" ? severity : undefined) as "info" | "warning" | "critical" | undefined,
  });
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const handleAction = async (id: number, action: "dismiss" | "resolve") => {
    setPendingId(id);
    try {
      await patchAlert(id, action);
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      toast({ title: action === "resolve" ? "Alert resolved" : "Alert dismissed" });
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setPendingId(null);
    }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-muted-foreground">Track and manage compliance alerts across your organization.</p>
      </div>

      <div className="flex gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
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
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {(alerts as Alert[])?.map((alert: Alert) => (
                <div key={alert.id} className="flex items-start gap-4 p-4 rounded-lg border">
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
                      {new Date(alert.createdAt).toLocaleDateString()}
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
              {(!alerts || (alerts as Alert[]).length === 0) && (
                <div className="text-center py-12">
                  <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                  <p className="text-muted-foreground">No {status} alerts found.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
