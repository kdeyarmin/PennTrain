import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListAuditLogsPaginated } from "@/hooks/useAuditLogs";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { auditActionDescription, auditEntityLabel, auditEntityRoute } from "@/lib/auditEntityResolver";

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

// Populates the entity-type filter dropdown from a wide, unfiltered sample of entity_type values
// (only that one column, not full rows) independent of the paginated/filtered query below -- so
// picking one entity type doesn't shrink the dropdown down to just that type on the next render.
// This table spans ~25+ audited tables and the set naturally grows as new features ship, so (as
// before this page had pagination) the option list is derived from real data instead of a
// hardcoded list that would constantly drift out of date.
function useEntityTypeOptions() {
  return useQuery({
    queryKey: ["audit_logs", "entity_types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("entity_type")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const types = new Set((data ?? []).map((l) => l.entity_type).filter(Boolean));
      return Array.from(types).sort();
    },
  });
}

const ENTITY_TYPE_ALL = "all";
const ORG_ALL = "all";
const PAGE_SIZE = 25;

// Synced into the URL query string via useUrlState so opening a linked employee/facility/incident/
// etc. record below and hitting Back returns to the same filtered/paged view instead of resetting.
const AUDIT_LOG_FILTER_DEFAULTS = {
  entityType: ENTITY_TYPE_ALL,
  org: ORG_ALL,
  dateFrom: "",
  dateTo: "",
  page: "1",
};

export default function AuditLog() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  const canExportManifest = ["platform_admin", "org_admin", "auditor"].includes(user?.role ?? "");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const [filters, setFilters] = useUrlState(AUDIT_LOG_FILTER_DEFAULTS);
  const { entityType: entityTypeFilter, org: orgFilter, dateFrom, dateTo } = filters;
  const page = Math.max(1, Number(filters.page) || 1);
  const hasActiveFilters = entityTypeFilter !== ENTITY_TYPE_ALL || orgFilter !== ORG_ALL || !!dateFrom || !!dateTo;

  const { data: logsPage, isLoading } = useListAuditLogsPaginated({
    entityType: entityTypeFilter !== ENTITY_TYPE_ALL ? entityTypeFilter : undefined,
    organizationId: isPlatformAdmin && orgFilter !== ORG_ALL ? orgFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const logs = logsPage?.rows ?? [];
  const totalCount = logsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const { data: entityTypeOptions } = useEntityTypeOptions();
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

  // Role-aware base paths for entity types with a mirrored /admin and /app detail route -- same
  // pattern already used by Alerts.tsx/GlobalSearch.tsx/FacilityDetail.tsx for cross-page links.

  async function downloadExportManifest() {
    setIsExporting(true);
    try {
      const from = dateFrom
        ? new Date(`${dateFrom}T00:00:00`).toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const toDate = dateTo ? new Date(`${dateTo}T00:00:00`) : new Date();
      if (dateTo) toDate.setDate(toDate.getDate() + 1);
      const { data, error } = await supabase.rpc("get_audit_export_manifest", {
        p_from: from,
        p_to: toDate.toISOString(),
        p_organization_id: isPlatformAdmin && orgFilter !== ORG_ALL ? orgFilter : undefined,
      });
      if (error) throw error;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit-manifest-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: "Audit manifest created", description: "The JSON includes the independently verifiable SHA-256 checksum." });
    } catch (error) {
      toast({
        title: "Audit export failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  // Resolves the entity_types with an unambiguous, single-table row id and a name worth showing
  // (audit_log_trigger() targets, per 20260704053624_compliance_rpcs_and_audit_trigger.sql) to a
  // human-readable label; every other entity_type keeps the raw #<uuid> fallback rather than
  // attempting unbounded generic resolution across the dozens of other audited tables.
  function getEntityLabel(entityType: string, entityId: string): string {
    return auditEntityLabel(entityType, entityId, { employeeNameById, facilityNameById });
  }

  // Maps an audit_logs row to the detail route for that record, using the same role-aware base
  // paths every other cross-linking page in this app already uses. Only entity types with a real,
  // reachable detail route are covered here; everything else (training_documents, employee_
  // credentials, course_assignments, employee_training_records, and the many other audited
  // sub-resource tables with no page of their own) falls through to plain, unlinked text below
  // rather than guessing a route that doesn't exist.
  function getEntityHref(entityType: string, entityId: string): string | null {
    return auditEntityRoute(entityType, entityId, user?.role);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground">Complete history of all system actions and changes.</p>
        </div>
        {canExportManifest && (
          <Button variant="outline" onClick={() => void downloadExportManifest()} disabled={isExporting}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Checksumming..." : "Export checksum manifest"}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>Recent Activity</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={entityTypeFilter} onValueChange={(v) => setFilters({ entityType: v, page: "1" })}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Entity Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ENTITY_TYPE_ALL}>All Entity Types</SelectItem>
                {(entityTypeOptions ?? []).map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isPlatformAdmin && (
              <Select value={orgFilter} onValueChange={(v) => setFilters({ org: v, page: "1" })}>
                <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Organizations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_ALL}>All Organizations</SelectItem>
                  {organizations?.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-1.5">
              <Label htmlFor="audit-date-from" className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
              <Input
                id="audit-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setFilters({ dateFrom: e.target.value, page: "1" })}
                className="w-40 h-9"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="audit-date-to" className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
              <Input
                id="audit-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setFilters({ dateTo: e.target.value, page: "1" })}
                className="w-40 h-9"
              />
            </div>
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
                const { color } = getActionDisplay(log.action);
                const label = auditActionDescription(log.action, log.entity_type);
                const actorName = log.actor_profile_id ? profileNameMap?.[log.actor_profile_id] ?? "Unknown user" : "System";
                const orgName = log.organization_id ? orgNameMap[log.organization_id] : undefined;
                const entityLabel = log.entity_id ? getEntityLabel(log.entity_type, log.entity_id) : null;
                const entityHref = log.entity_id ? getEntityHref(log.entity_type, log.entity_id) : null;
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
                      {entityLabel && (
                        entityHref ? (
                          <Link href={entityHref} className="text-xs text-primary hover:underline underline-offset-2">
                            {entityLabel}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">{entityLabel}</span>
                        )
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
                  <p className="font-medium text-muted-foreground">
                    {hasActiveFilters ? "No audit log entries match these filters" : "No audit log entries yet"}
                  </p>
                  <p className="text-sm text-muted-foreground/60 mt-1">
                    {hasActiveFilters
                      ? "Try widening the entity type, organization, or date range."
                      : "Activity will be recorded here as changes are made."}
                  </p>
                </div>
              )}
            </div>
          )}
          {!isLoading && logs.length > 0 && (
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)}</span> of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setFilters({ page: String(Math.max(1, page - 1)) })}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setFilters({ page: String(Math.min(totalPages, page + 1)) })}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
