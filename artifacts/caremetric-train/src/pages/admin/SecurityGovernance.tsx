import { useState } from "react";
import {
  useAuditCoverage,
  useAuditGovernanceStatus,
  useListSecurityAuditLog,
  useProfileNameMap,
  type SecurityAuditEntityType,
} from "@/hooks/useSecurityAuditLog";
import type { Tables } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Building2, Sliders, ShieldAlert, ShieldCheck, Archive, Scale, type LucideIcon } from "lucide-react";

type SecurityAuditRow = Tables<"audit_logs">;

type TabValue = "all" | SecurityAuditEntityType;

const TABS: { value: TabValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "impersonation", label: "Impersonation" },
  { value: "organizations", label: "Organization Changes" },
  { value: "platform_settings", label: "Settings Changes" },
];

// Whether an `organizations` row's before/after values actually cross a
// subscription_status boundary (the "real" suspend/reactivate signal) rather
// than some other org field edit that also lands in this audit trail.
function subscriptionStatusChanged(log: SecurityAuditRow): boolean {
  if (log.entity_type !== "organizations" || !log.old_values || !log.new_values) return false;
  const oldStatus = (log.old_values as Record<string, unknown>).subscription_status;
  const newStatus = (log.new_values as Record<string, unknown>).subscription_status;
  return oldStatus !== newStatus;
}

interface EntityBadge {
  Icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  badgeColor: string;
  badgeLabel: string;
}

function getEntityBadge(log: SecurityAuditRow): EntityBadge {
  if (log.entity_type === "impersonation") {
    return { Icon: Eye, iconBg: "bg-blue-100", iconColor: "text-blue-600", badgeColor: "bg-blue-100 text-blue-800", badgeLabel: "Impersonation" };
  }
  if (log.entity_type === "organizations") {
    if (subscriptionStatusChanged(log)) {
      return { Icon: Building2, iconBg: "bg-red-100", iconColor: "text-red-600", badgeColor: "bg-red-100 text-red-800", badgeLabel: "Subscription Change" };
    }
    return { Icon: Building2, iconBg: "bg-amber-100", iconColor: "text-amber-600", badgeColor: "bg-amber-100 text-amber-800", badgeLabel: "Organization" };
  }
  return { Icon: Sliders, iconBg: "bg-purple-100", iconColor: "text-purple-600", badgeColor: "bg-purple-100 text-purple-800", badgeLabel: "Platform Setting" };
}

// Resolves the profile id responsible for a row. platform_settings rows are
// sometimes written by a service-role edge function with actor_profile_id
// left null -- in that case new_values.updated_by carries the acting admin.
function getActorId(log: SecurityAuditRow): string | null {
  if (log.actor_profile_id) return log.actor_profile_id;
  if (log.entity_type === "platform_settings" && log.new_values) {
    const updatedBy = (log.new_values as Record<string, unknown>).updated_by;
    if (typeof updatedBy === "string") return updatedBy;
  }
  return null;
}

function describeRow(log: SecurityAuditRow, profileNames: Record<string, string>): { primary: string; secondary?: string } {
  const actorId = getActorId(log);
  const actorName = actorId ? profileNames[actorId] ?? `User #${actorId}` : "System";
  const newValues = (log.new_values ?? {}) as Record<string, unknown>;

  if (log.entity_type === "impersonation") {
    const reason = typeof newValues.reason === "string" ? newValues.reason : undefined;
    if (log.action === "impersonation_start") {
      const target = typeof newValues.target_email === "string" ? newValues.target_email : log.entity_id ?? "unknown user";
      return { primary: `${actorName} logged in as ${target}`, secondary: reason };
    }
    return { primary: `${actorName} returned to their own session`, secondary: reason };
  }

  if (log.entity_type === "organizations") {
    if (subscriptionStatusChanged(log)) {
      const newStatus = (log.new_values as Record<string, unknown>)?.subscription_status;
      const verb = newStatus === "suspended" ? "suspended" : "reactivated";
      return { primary: `${actorName} ${verb} organization ${log.entity_id}` };
    }
    if (log.action.endsWith("_created")) return { primary: `${actorName} created organization ${log.entity_id}` };
    if (log.action.endsWith("_deleted")) return { primary: `${actorName} deleted organization ${log.entity_id}` };
    return { primary: `${actorName} updated organization ${log.entity_id}` };
  }

  // platform_settings
  return { primary: `${actorName} changed ${log.entity_id} to ${String(newValues.value)}` };
}

export default function SecurityGovernance() {
  const [tab, setTab] = useState<TabValue>("all");

  const { data: logsData, isLoading } = useListSecurityAuditLog({
    entityType: tab === "all" ? undefined : tab,
  });
  const { data: profileNameMap } = useProfileNameMap();
  const { data: coverageData, isLoading: coverageLoading } = useAuditCoverage();
  const { data: governance } = useAuditGovernanceStatus();

  const logs = logsData ?? [];
  const profileNames = profileNameMap ?? {};
  const regulatedCoverage = (coverageData ?? []).filter(
    (entry) => entry.contains_regulated_data || !entry.has_required_trigger,
  );
  const coverageGaps = regulatedCoverage.filter((entry) => !entry.has_required_trigger);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Security & Governance</h1>
        <p className="text-muted-foreground">
          Impersonation sessions, organization suspensions, and platform settings changes across the entire platform.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <ShieldCheck className="h-7 w-7 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold">v{governance?.hashVersion ?? 2}</p>
              <p className="text-sm text-muted-foreground">Audit hash format</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <ShieldAlert className="h-7 w-7 text-red-600" />
            <div>
              <p className="text-2xl font-bold">{governance?.openIntegrityIssues ?? 0}</p>
              <p className="text-sm text-muted-foreground">Open integrity issues</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Scale className="h-7 w-7 text-violet-600" />
            <div>
              <p className="text-2xl font-bold">{governance?.activeLegalHolds ?? 0}</p>
              <p className="text-sm text-muted-foreground">Active legal holds</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Archive className="h-7 w-7 text-blue-600" />
            <div>
              <p className="text-2xl font-bold">{governance?.plannedArchives ?? 0}</p>
              <p className="text-sm text-muted-foreground">Archive batches planned</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Audit Coverage</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved evidence mode and trigger health for regulated and administrative tables.
            </p>
          </div>
          <Badge variant={coverageGaps.length === 0 ? "secondary" : "destructive"}>
            {coverageGaps.length === 0 ? "Complete" : String(coverageGaps.length) + " gaps"}
          </Badge>
        </CardHeader>
        <CardContent>
          {coverageLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Evidence mode</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Rationale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regulatedCoverage.map((entry) => (
                  <TableRow key={entry.table_name}>
                    <TableCell className="font-medium">{entry.table_name}</TableCell>
                    <TableCell>{entry.audit_mode.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Badge variant={entry.has_required_trigger ? "outline" : "destructive"}>
                        {entry.has_required_trigger ? "Covered" : "Missing trigger"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-lg text-sm text-muted-foreground">
                      {entry.rationale}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>Sensitive Activity</CardTitle>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <ShieldAlert className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No security events found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Impersonation, organization suspension, and platform settings changes will be recorded here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => {
                const { Icon, iconBg, iconColor, badgeColor, badgeLabel } = getEntityBadge(log);
                const { primary, secondary } = describeRow(log, profileNames);
                return (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className={`h-8 w-8 rounded-md ${iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-4 w-4 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeColor}`}>
                          {badgeLabel}
                        </span>
                        <p className="text-sm font-medium">{primary}</p>
                      </div>
                      {secondary && <p className="text-xs text-muted-foreground mt-0.5 italic">{secondary}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
