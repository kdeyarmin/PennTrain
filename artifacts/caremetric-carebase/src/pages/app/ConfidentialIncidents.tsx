import { useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListConfidentialIntakes, type ConfidentialIntake } from "@/hooks/useConfidentialIncidents";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { ShieldAlert, Search, ChevronRight, AlertTriangle, Inbox, FolderSearch } from "lucide-react";

const SEVERITY_VARIANT: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  moderate: "bg-blue-100 text-blue-900",
  high: "bg-amber-100 text-amber-900",
  critical: "bg-red-100 text-red-900",
};

const STATUS_VARIANT: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-900",
  triage: "bg-amber-100 text-amber-900",
  investigating: "bg-amber-100 text-amber-900",
  review: "bg-purple-100 text-purple-900",
  closed: "bg-muted text-muted-foreground",
  retained: "bg-muted text-muted-foreground",
};

export function IntakePill({ value, map }: { value: string; map: Record<string, string> }) {
  return (
    <Badge variant="outline" className={`border-0 font-medium capitalize ${map[value] ?? "bg-muted text-muted-foreground"}`}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  incident: "Incident",
  near_miss: "Near miss",
  safety_concern: "Safety concern",
};

const URL_DEFAULTS = { search: "", facilityId: "all", status: "all", severity: "all" };

export default function ConfidentialIncidents() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const [urlState, setUrlState] = useUrlState(URL_DEFAULTS);

  const {
    data: intakes,
    isLoading,
    isError,
    error,
    refetch,
  } = useListConfidentialIntakes({ organizationId: viewingOrgId ?? undefined });
  const { data: facilities } = useListFacilities({ organizationId: viewingOrgId ?? undefined });
  const facilityNameById = useMemo(() => new Map((facilities ?? []).map(f => [f.id, f.name])), [facilities]);

  const all = intakes ?? [];
  const filtered = all.filter((i: ConfidentialIntake) => {
    if (urlState.facilityId !== "all" && i.facility_id !== urlState.facilityId) return false;
    if (urlState.status !== "all" && i.status !== urlState.status) return false;
    if (urlState.severity !== "all" && i.severity !== urlState.severity) return false;
    if (urlState.search) {
      const needle = urlState.search.toLowerCase();
      if (!i.public_summary.toLowerCase().includes(needle) && !i.intake_number.toLowerCase().includes(needle)) {
        return false;
      }
    }
    return true;
  });

  const awaitingTriage = all.filter(i => i.status === "submitted").length;
  const investigating = all.filter(i => ["triage", "investigating", "review"].includes(i.status)).length;
  const criticalOpen = all.filter(i => i.severity === "critical" && i.status !== "closed" && i.status !== "retained").length;

  const canReviewDetails = ["platform_admin", "org_admin", "auditor"].includes(user?.role ?? "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-6 w-6" /> Confidential Reports
        </h1>
        <p className="text-muted-foreground">
          Safety reports and near misses submitted through the confidential intake channel.
          {canReviewDetails
            ? " Protected narratives open only with a recorded review purpose; every view and status change is logged."
            : " You can see the triage summary for your facilities; protected details are restricted to organization administrators and auditors."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Inbox className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-2xl font-bold">{isLoading ? "—" : awaitingTriage}</p>
              <p className="text-sm text-muted-foreground">Awaiting Triage</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <FolderSearch className="h-8 w-8 text-amber-600" />
            <div>
              <p className="text-2xl font-bold">{isLoading ? "—" : investigating}</p>
              <p className="text-sm text-muted-foreground">Under Investigation</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-2xl font-bold">{isLoading ? "—" : criticalOpen}</p>
              <p className="text-sm text-muted-foreground">Critical Open</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={urlState.search}
                onChange={e => setUrlState({ search: e.target.value })}
                placeholder="Search summary or intake number"
                className="h-9 pl-8"
              />
            </div>
            <Select value={urlState.facilityId} onValueChange={v => setUrlState({ facilityId: v })}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Facilities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {facilities?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={urlState.status} onValueChange={v => setUrlState({ status: v })}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="triage">Triage</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="retained">Retained</SelectItem>
              </SelectContent>
            </Select>
            <Select value={urlState.severity} onValueChange={v => setUrlState({ severity: v })}>
              <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All Severities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isError ? (
            <QueryError what="confidential reports" error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-10">
              No confidential reports match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Intake</th>
                    <th>Facility</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Reported</th>
                    <th>Status</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(i => (
                    <tr key={i.id}>
                      <td>
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-muted-foreground">{i.intake_number}</p>
                          <p className="font-medium truncate max-w-[280px]">{i.public_summary}</p>
                        </div>
                      </td>
                      <td className="text-sm">{facilityNameById.get(i.facility_id) ?? "—"}</td>
                      <td className="text-sm">{REPORT_TYPE_LABELS[i.report_type] ?? i.report_type}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <IntakePill value={i.severity} map={SEVERITY_VARIANT} />
                          {i.immediate_danger && (
                            <AlertTriangle className="h-4 w-4 text-red-600" aria-label="Immediate danger reported" />
                          )}
                        </div>
                      </td>
                      <td className="text-sm text-muted-foreground">{formatDateForDisplay(i.reported_at)}</td>
                      <td><IntakePill value={i.status} map={STATUS_VARIANT} /></td>
                      <td>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/app/confidential-incidents/${i.id}`}>
                            Open <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
