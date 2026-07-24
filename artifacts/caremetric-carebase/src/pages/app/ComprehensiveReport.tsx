import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Printer, Loader2, FileText, ListChecks, Building2 } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useGetOrganization } from "@/hooks/useOrganizations";
import { useOrgDashboardSummary } from "@/hooks/useDashboardSummary";
import {
  useOperationsCommandCenter,
  usePortfolioOperationsCommandCenter,
} from "@/hooks/useOperationsCommandCenter";
import {
  useIncidentListSummary,
  useComplaintListSummary,
  useConfidentialIntakeListSummary,
  useResidentListSummary,
  useEvidenceCollectionListSummary,
  useWorkItemListSummary,
} from "@/hooks/useDomainListSummaries";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
import { PCH_ALR_ONLY_FACILITY_TYPES, hasAnyFacilityType } from "@/lib/facilityTypes";
import { toLocalIsoDate } from "@/lib/dateUtils";
import {
  buildComprehensiveReport,
  REPORT_FACETS,
  type MetricTone,
  type OperationsReportModel,
  type ReportFacet,
  type ReportSectionData,
  type WorkforceReportModel,
} from "@/lib/comprehensiveReport";

const TONE_TILE: Record<MetricTone, string> = {
  default: "bg-muted/50 text-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
};

export default function ComprehensiveReport() {
  const { user } = useAuth();
  const organizationId = user?.organizationId ?? undefined;

  // A single point-in-time stamp for the whole snapshot. Held in state (not recomputed each
  // render) so the date-scoped summary query keys below stay stable and don't refetch in a loop.
  const [today] = useState(() => toLocalIsoDate());
  const [now] = useState(() => new Date().toISOString());
  const [generatedAt] = useState(() => new Date());

  const [facilityId, setFacilityId] = useState<string>("all");
  const [periodLabel, setPeriodLabel] = useState("");
  const [preparedBy, setPreparedBy] = useState(
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim(),
  );
  const [notes, setNotes] = useState("");
  const [selectedFacets, setSelectedFacets] = useState<Set<ReportFacet>>(
    () => new Set(REPORT_FACETS.map((f) => f.id)),
  );

  const { facilityTypes } = useVisibleFacilityTypes();

  const organizationQuery = useGetOrganization(organizationId);
  const facilitiesQuery = useListFacilities({});
  const facilities = (facilitiesQuery.data ?? []).filter((f) => !f.is_sandbox);
  const facilityName = facilityId !== "all" ? facilities.find((f) => f.id === facilityId)?.name : undefined;
  const scopeFacilityId = facilityId === "all" ? undefined : facilityId;

  // Residents/census modules are PCH/ALF-only (see facilityTypes.ts). For a single-facility scope,
  // gate on that facility's own type; for "All facilities", fall back to the org-level union of
  // visible facility types. While a selected facility's row is still loading, fail closed (hide the
  // section) rather than show a resident section for a facility that may not be PCH/ALF.
  const selectedFacilityType = scopeFacilityId
    ? facilities.find((f) => f.id === scopeFacilityId)?.facility_type
    : undefined;
  const includeResidents = scopeFacilityId
    ? hasAnyFacilityType(
        selectedFacilityType ? new Set([selectedFacilityType]) : undefined,
        PCH_ALR_ONLY_FACILITY_TYPES,
      )
    : hasAnyFacilityType(facilityTypes, PCH_ALR_ONLY_FACILITY_TYPES);

  const dashboardQuery = useOrgDashboardSummary();
  const portfolioOpsQuery = usePortfolioOperationsCommandCenter();
  const facilityOpsQuery = useOperationsCommandCenter(scopeFacilityId);

  const incidentsQuery = useIncidentListSummary({ facilityId: scopeFacilityId, today });
  const complaintsQuery = useComplaintListSummary({ organizationId, facilityId: scopeFacilityId });
  const confidentialQuery = useConfidentialIntakeListSummary({ organizationId, facilityId: scopeFacilityId });
  const residentsQuery = useResidentListSummary({ facilityId: scopeFacilityId, today });
  const evidenceQuery = useEvidenceCollectionListSummary({ organizationId, facilityId: scopeFacilityId });
  const workItemsQuery = useWorkItemListSummary({ organizationId, facilityId: scopeFacilityId, now });

  const retentionQuery = useQuery({
    queryKey: ["workforce-retention-metrics", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_workforce_retention_metrics", {
        p_facility_id: scopeFacilityId,
      });
      if (error) throw error;
      return data as {
        segments?: Array<{
          role: string;
          annualizedTurnoverRate: number | null;
          ninetyDayRetentionRate: number | null;
          averageTenureDays: number | null;
          currentHeadcount: number;
        }>;
      };
    },
  });

  const operations = useMemo<OperationsReportModel | null>(() => {
    if (scopeFacilityId) {
      const snap = facilityOpsQuery.data;
      if (!snap) return null;
      const sig = snap.signals;
      const wq = snap.workQueue;
      return {
        scopeLabel: snap.facility.name,
        workforceGaps: sig.workforceGaps,
        residentReadinessGaps: sig.residentReadinessGaps,
        activeEmergencyEvents: sig.activeEmergencyEvents,
        emergencyUnaccounted: sig.emergencyUnaccounted,
        highRiskWorkOrders: sig.highRiskWorkOrders,
        activeResidents: sig.activeResidents,
        openWork: wq.openCount,
        urgentWork: wq.urgentCount,
        overdueWork: wq.overdueCount,
        unassignedWork: wq.unassignedCount,
        pendingApproval: wq.pendingApprovalCount,
        medicationFollowUps: sig.medicationFollowUps,
        incidentComplaintOpen: sig.incidentComplaintOpen,
        overdueCorrectiveActions: sig.overdueCorrectiveActions,
        overduePolicyAttestations: sig.overduePolicyAttestations,
        sourceBreakdown: snap.sourceBreakdown.map((s) => ({
          sourceType: s.sourceType,
          openCount: s.openCount,
          urgentCount: s.urgentCount,
          overdueCount: s.overdueCount,
        })),
      };
    }
    const portfolio = portfolioOpsQuery.data;
    if (!portfolio) return null;
    const s = portfolio.summary;
    return {
      scopeLabel: "Organization-wide",
      workforceGaps: s.workforceGaps,
      residentReadinessGaps: s.residentReadinessGaps,
      activeEmergencyEvents: s.activeEmergencyEvents,
      emergencyUnaccounted: s.emergencyUnaccounted,
      highRiskWorkOrders: s.highRiskWorkOrders,
      activeResidents: s.activeResidents,
      openWork: s.openWork,
      urgentWork: s.urgentWork,
      overdueWork: s.overdueWork,
      unassignedWork: s.unassignedWork,
      facilityCounts: {
        critical: s.criticalFacilities,
        attention: s.attentionFacilities,
        ready: s.readyFacilities,
      },
      facilityReadiness: portfolio.facilities.map((f) => ({
        name: f.facility.name,
        type: f.facility.facilityType,
        status: f.readinessStatus,
        riskScore: f.riskScore,
      })),
    };
  }, [scopeFacilityId, facilityOpsQuery.data, portfolioOpsQuery.data]);

  const workforce = useMemo<WorkforceReportModel | null>(() => {
    const total = retentionQuery.data?.segments?.find((seg) => seg.role === "All roles");
    if (!total) return null;
    return {
      annualizedTurnoverRate: total.annualizedTurnoverRate,
      ninetyDayRetentionRate: total.ninetyDayRetentionRate,
      averageTenureDays: total.averageTenureDays,
      currentHeadcount: total.currentHeadcount,
    };
  }, [retentionQuery.data]);

  const report = useMemo(
    () =>
      buildComprehensiveReport({
        dashboard: dashboardQuery.data,
        operations,
        workforce,
        incidents: incidentsQuery.data,
        complaints: complaintsQuery.data,
        confidential: confidentialQuery.data,
        residents: residentsQuery.data,
        evidence: evidenceQuery.data,
        workItems: workItemsQuery.data,
        includeResidents,
        errored: {
          compliance: dashboardQuery.isError,
          training: dashboardQuery.isError,
          workforce: retentionQuery.isError,
          facilities: dashboardQuery.isError,
          operations: scopeFacilityId ? facilityOpsQuery.isError : portfolioOpsQuery.isError,
          incidents: incidentsQuery.isError && complaintsQuery.isError && confidentialQuery.isError,
          residents: residentsQuery.isError,
          documentation: evidenceQuery.isError && dashboardQuery.isError && workItemsQuery.isError,
          alerts: dashboardQuery.isError,
        },
      }),
    [
      dashboardQuery.data,
      dashboardQuery.isError,
      operations,
      workforce,
      retentionQuery.isError,
      incidentsQuery.data,
      incidentsQuery.isError,
      complaintsQuery.data,
      complaintsQuery.isError,
      confidentialQuery.data,
      confidentialQuery.isError,
      residentsQuery.data,
      residentsQuery.isError,
      evidenceQuery.data,
      evidenceQuery.isError,
      workItemsQuery.data,
      workItemsQuery.isError,
      includeResidents,
      scopeFacilityId,
      facilityOpsQuery.isError,
      portfolioOpsQuery.isError,
    ],
  );

  const availableFacets = REPORT_FACETS.filter((f) => f.id !== "residents" || includeResidents);
  const visibleSections = report.sections.filter((s) => selectedFacets.has(s.id));

  const isInitialLoading = dashboardQuery.isLoading && !dashboardQuery.data;

  const toggleFacet = (facet: ReportFacet) => {
    setSelectedFacets((prev) => {
      const next = new Set(prev);
      if (next.has(facet)) next.delete(facet);
      else next.add(facet);
      return next;
    });
  };

  const orgName = organizationQuery.data?.name;
  const generatedLabel = generatedAt.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      {/* Controls -- hidden when printing */}
      <div className="no-print space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Comprehensive Report</h1>
            <p className="text-muted-foreground">
              A single, printable snapshot across every facet of {orgName || "your organization"} — training compliance,
              workforce, operations, incidents, residents, documentation, and alerts. Choose a scope and the sections to
              include, then print or save as PDF.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="All Facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities (organization-wide)</SelectItem>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => window.print()} disabled={isInitialLoading}>
              <Printer className="mr-2 h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Report contents</h2>
            <span className="text-xs text-muted-foreground">
              {availableFacets.filter((f) => selectedFacets.has(f.id)).length} of {availableFacets.length} sections selected
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setSelectedFacets(new Set(availableFacets.map((f) => f.id)))}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setSelectedFacets(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {availableFacets.map((facet) => (
              <label
                key={facet.id}
                htmlFor={`facet-${facet.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
              >
                <Checkbox
                  id={`facet-${facet.id}`}
                  checked={selectedFacets.has(facet.id)}
                  onCheckedChange={() => toggleFacet(facet.id)}
                />
                <span>{facet.title}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-period" className="text-xs text-muted-foreground">
                Reporting period (optional)
              </Label>
              <Input
                id="report-period"
                value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)}
                placeholder="e.g. Q3 2026 or July 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-prepared-by" className="text-xs text-muted-foreground">
                Prepared by
              </Label>
              <Input
                id="report-prepared-by"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="report-notes" className="text-xs text-muted-foreground">
                Notes (optional)
              </Label>
              <Textarea
                id="report-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Context printed under the report header"
                rows={2}
              />
            </div>
          </div>
        </div>
      </div>

      {/* The printable document */}
      <div className="print-report space-y-6">
        <div className="creport-cover flex flex-wrap items-start justify-between gap-4 border-b-2 pb-5" style={{ borderColor: BRAND_BLUE }}>
          <div className="flex items-center gap-3">
            <LogoMark className="h-11 w-11" />
            <div>
              <h1 className="text-xl font-bold" style={{ color: BRAND_BLUE }}>
                <BrandName />
              </h1>
              <p className="text-sm text-muted-foreground">Comprehensive Operations &amp; Compliance Report</p>
            </div>
          </div>
          <div className="text-right text-sm">
            {orgName && <p className="text-base font-semibold">{orgName}</p>}
            <p className="text-muted-foreground">
              Scope: <span className="font-medium text-foreground">{facilityName ?? "All facilities (organization-wide)"}</span>
            </p>
            {periodLabel && (
              <p className="text-muted-foreground">
                Period: <span className="font-medium text-foreground">{periodLabel}</span>
              </p>
            )}
            <p className="text-muted-foreground">Generated: {generatedLabel}</p>
            {preparedBy && <p className="text-muted-foreground">Prepared by: {preparedBy}</p>}
          </div>
        </div>

        {notes.trim() && (
          <p className="creport-notes rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{notes.trim()}</p>
        )}

        {isInitialLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Assembling report…</span>
          </div>
        ) : (
          <>
            {/* Executive summary */}
            {report.executive.length > 0 && (
              <section className="creport-section">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Executive Summary</h2>
                </div>
                <MetricGrid metrics={report.executive} />
              </section>
            )}

            {visibleSections.map((section) => (
              <ReportSection key={section.id} section={section} />
            ))}

            {visibleSections.length === 0 && (
              <div className="no-print rounded-lg border border-dashed py-16 text-center text-muted-foreground">
                No sections selected. Choose at least one section under “Report contents” above.
              </div>
            )}

            <div className="creport-footer flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>
                CareMetric CareBase · Comprehensive Report · {facilityName ?? "All facilities"}
              </span>
              <span>Generated {generatedLabel} · cmcarebase.com</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: ReportSectionData["metrics"] }) {
  return (
    <div className="creport-metrics grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {metrics.map((metric, i) => (
        <div key={i} className={`creport-metric rounded-lg px-4 py-3 ${TONE_TILE[metric.tone ?? "default"]}`}>
          <p className="text-2xl font-bold leading-tight">{metric.value}</p>
          <p className="text-xs font-medium opacity-80">{metric.label}</p>
          {metric.hint && <p className="mt-0.5 text-[11px] opacity-70">{metric.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function ReportSection({ section }: { section: ReportSectionData }) {
  return (
    <section className="creport-section">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{section.title}</h2>
        {section.reference && (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {section.reference}
          </Badge>
        )}
      </div>
      {section.description && <p className="mb-3 text-sm text-muted-foreground">{section.description}</p>}

      {!section.available ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          {section.unavailableReason ?? "Data unavailable for the current scope."}
        </p>
      ) : (
        <>
          {section.metrics.length > 0 && <MetricGrid metrics={section.metrics} />}
          {section.table && section.table.rows.length > 0 && (
            <div className="print-table-container mt-3 overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <table className="print-table w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      {section.table.columns.map((col, i) => (
                        <th
                          key={i}
                          className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row, ri) => (
                      <tr key={ri} className={`border-t border-border/60 ${ri % 2 === 1 ? "bg-muted/30" : ""}`}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-4 py-2.5">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
