import { useMemo, useState } from "react";
import { useListAuditLogs } from "@/hooks/useAuditLogs";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function useProfileNameMap() {
  return useQuery({
    queryKey: ["profiles", "name_map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, first_name, last_name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = `${p.first_name} ${p.last_name}`.trim();
      return map;
    },
  });
}

const ENTITY_TYPE_ALL = "all";
const ORG_ALL = "all";

export default function AuditLog() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";

  const [entityTypeFilter, setEntityTypeFilter] = useState(ENTITY_TYPE_ALL);
  const [orgFilter, setOrgFilter] = useState(ORG_ALL);

  const { data: logsData, isLoading } = useListAuditLogs({
    limit: 300,
    entityType: entityTypeFilter !== ENTITY_TYPE_ALL ? entityTypeFilter : undefined,
    organizationId: isPlatformAdmin && orgFilter !== ORG_ALL ? orgFilter : undefined,
  });
  const { data: profileNameMap } = useProfileNameMap();
  const { data: organizations } = useListOrganizations();
  const { data: employeesData } = useListEmployees();
  const { data: facilitiesData } = useListFacilities();
  const orgNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of organizations ?? []) map[o.id] = o.name;
    return map;
  }, [organizations]);
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

  // Resolves the two entity_types with an unambiguous, single-table row id
  // (audit_log_trigger() targets, per 20260704053624_compliance_rpcs_and_audit_trigger.sql) to a
  // human-readable label; every other entity_type keeps the raw #<uuid> fallback rather than
  // attempting unbounded generic resolution across the dozens of other audited tables.
  function getEntityLabel(entityType: string, entityId: string): string {
    if (entityType === "employees") return employeeNameById.get(entityId) ?? `#${entityId}`;
    if (entityType === "facilities") return facilityNameById.get(entityId) ?? `#${entityId}`;
    return `#${entityId}`;
  }

  const logs = logsData ?? [];

  // Entity-type options are derived from whatever's currently loaded rather than a fixed list --
  // this table spans ~25+ audited tables and the set naturally grows as new features ship, so a
  // hardcoded dropdown would constantly drift out of date.
  const entityTypeOptions = useMemo(() => {
    const types = new Set(logs.map((l) => l.entity_type).filter(Boolean));
    return Array.from(types).sort();
  }, [logs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground">Complete history of all system actions and changes.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>Recent Activity</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Entity Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ENTITY_TYPE_ALL}>All Entity Types</SelectItem>
                {entityTypeOptions.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isPlatformAdmin && (
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Organizations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_ALL}>All Organizations</SelectItem>
                  {organizations?.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
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
                const actorName = log.actor_profile_id ? profileNameMap?.[log.actor_profile_id] ?? "Unknown user" : "System";
                const orgName = log.organization_id ? orgNameMap[log.organization_id] : undefined;
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
                      {isPlatformAdmin && orgName && <span className="text-xs text-muted-foreground">· {orgName}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {actorName} · {new Date(log.created_at).toLocaleString()}
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
