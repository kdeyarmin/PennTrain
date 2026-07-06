import { useMemo } from "react";
import { useListAuditLogs } from "@/hooks/useAuditLogs";
import { useListProfiles } from "@/hooks/useProfiles";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

// audit_log_trigger() (see supabase/migrations/20260704053624_compliance_rpcs_and_audit_trigger.sql)
// writes actions as `${tg_table_name}_${created|updated|deleted}`, e.g. "employees_created".
// Match on the verb suffix rather than the old pre-migration exact-string convention.
function getActionDisplay(action: string): { color: string; label: string } {
  if (action.endsWith("_created")) return { color: "bg-green-100 text-green-800", label: "Created" };
  if (action.endsWith("_updated")) return { color: "bg-blue-100 text-blue-800", label: "Updated" };
  if (action.endsWith("_deleted")) return { color: "bg-red-100 text-red-800", label: "Deleted" };
  return { color: "bg-gray-100 text-gray-800", label: action };
}

export default function AuditLog() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  const { data: logsData, isLoading } = useListAuditLogs({ limit: 100 });
  const { data: profilesData } = useListProfiles();
  const { data: employeesData } = useListEmployees();
  const { data: facilitiesData } = useListFacilities();
  const { data: organizationsData } = useListOrganizations();
  const logs = logsData ?? [];

  const actorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profilesData ?? []) map.set(p.id, `${p.first_name} ${p.last_name}`.trim());
    return map;
  }, [profilesData]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employeesData ?? []) map.set(e.id, `${e.first_name} ${e.last_name}`.trim());
    return map;
  }, [employeesData]);

  const facilityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of facilitiesData ?? []) map.set(f.id, f.name);
    return map;
  }, [facilitiesData]);

  const organizationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of organizationsData ?? []) map.set(o.id, o.name);
    return map;
  }, [organizationsData]);

  function getEntityLabel(entityType: string, entityId: string): string {
    if (entityType === "employees") return employeeNameById.get(entityId) ?? `#${entityId}`;
    if (entityType === "facilities") return facilityNameById.get(entityId) ?? `#${entityId}`;
    return `#${entityId}`;
  }

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
              {logs.map((log) => {
                const { color, label } = getActionDisplay(log.action);
                return (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
                        {label}
                      </span>
                      <span className="text-sm font-medium capitalize">{log.entity_type?.replace(/_/g, " ")}</span>
                      {log.entity_id && (
                        <span className="text-xs text-muted-foreground">{getEntityLabel(log.entity_type, log.entity_id)}</span>
                      )}
                      {isPlatformAdmin && log.organization_id && (
                        <span className="text-xs text-muted-foreground">
                          · {organizationNameById.get(log.organization_id) ?? `Org #${log.organization_id}`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {log.actor_profile_id ? actorNameById.get(log.actor_profile_id) ?? `User #${log.actor_profile_id}` : "System"}
                      {" · "}{new Date(log.created_at).toLocaleString()}
                      {log.ip_address && ` · ${log.ip_address}`}
                    </p>
                  </div>
                </div>
                );
              })}
              {logs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <ShieldAlert className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">No audit log entries yet</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Activity will be recorded here as changes are made.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
